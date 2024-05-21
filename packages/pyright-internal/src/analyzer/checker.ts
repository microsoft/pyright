/*
 * checker.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * A parse tree walker that performs static type checking for
 * a source file. Most of its work is performed by the type
 * evaluator, but this module touches every node in the file
 * to ensure that all statements and expressions are evaluated
 * and checked. It also performs some additional checks that
 * cannot (or should not be) performed lazily.
 */

import { CancellationToken } from 'vscode-languageserver';

import { Commands } from '../commands/commands';
import { appendArray } from '../common/collectionUtils';
import { DiagnosticLevel } from '../common/configOptions';
import { assert, assertNever } from '../common/debug';
import { ActionKind, Diagnostic, DiagnosticAddendum, RenameShadowedFileAction } from '../common/diagnostic';
import { DiagnosticRule } from '../common/diagnosticRules';
import { pythonVersion3_12, pythonVersion3_5, pythonVersion3_6 } from '../common/pythonVersion';
import { TextRange } from '../common/textRange';
import { Uri } from '../common/uri/uri';
import { DefinitionProvider } from '../languageService/definitionProvider';
import { LocAddendum, LocMessage } from '../localization/localize';
import {
    ArgumentCategory,
    AssertNode,
    AssignmentExpressionNode,
    AssignmentNode,
    AugmentedAssignmentNode,
    AwaitNode,
    BinaryOperationNode,
    CallNode,
    CaseNode,
    ClassNode,
    DelNode,
    DictionaryNode,
    ErrorNode,
    ExceptNode,
    ExpressionNode,
    ForNode,
    FormatStringNode,
    FunctionNode,
    GlobalNode,
    IfNode,
    ImportAsNode,
    ImportFromAsNode,
    ImportFromNode,
    IndexNode,
    LambdaNode,
    ListComprehensionIfNode,
    ListComprehensionNode,
    ListNode,
    MatchNode,
    MemberAccessNode,
    ModuleNameNode,
    ModuleNode,
    NameNode,
    NonlocalNode,
    ParameterCategory,
    ParameterNode,
    ParseNode,
    ParseNodeType,
    PatternClassNode,
    RaiseNode,
    ReturnNode,
    SetNode,
    SliceNode,
    StatementListNode,
    StatementNode,
    StringListNode,
    StringNode,
    SuiteNode,
    TernaryNode,
    TryNode,
    TupleNode,
    TypeAliasNode,
    TypeAnnotationNode,
    TypeParameterListNode,
    TypeParameterNode,
    UnaryOperationNode,
    UnpackNode,
    WhileNode,
    WithNode,
    YieldFromNode,
    YieldNode,
    isExpressionNode,
} from '../parser/parseNodes';
import { ParserOutput } from '../parser/parser';
import { UnescapeError, UnescapeErrorType, getUnescapedString } from '../parser/stringTokenUtils';
import { OperatorType, StringTokenFlags, TokenType } from '../parser/tokenizerTypes';
import { AnalyzerFileInfo } from './analyzerFileInfo';
import * as AnalyzerNodeInfo from './analyzerNodeInfo';
import { getBoundCallMethod, getBoundInitMethod, getBoundNewMethod } from './constructors';
import { Declaration, DeclarationType, isAliasDeclaration } from './declaration';
import { getNameNodeForDeclaration } from './declarationUtils';
import { deprecatedAliases, deprecatedSpecialForms } from './deprecatedSymbols';
import { getEnumDeclaredValueType, isEnumClassWithMembers, transformTypeForEnumMember } from './enums';
import { ImportResolver, ImportedModuleDescriptor, createImportedModuleDescriptor } from './importResolver';
import { ImportResult, ImportType } from './importResult';
import { getRelativeModuleName, getTopLevelImports } from './importStatementUtils';
import { getParameterListDetails } from './parameterUtils';
import * as ParseTreeUtils from './parseTreeUtils';
import { ParseTreeWalker } from './parseTreeWalker';
import { validateClassPattern } from './patternMatching';
import { isMethodOnlyProtocol, isProtocolUnsafeOverlap } from './protocols';
import { ScopeType } from './scope';
import { getScopeForNode } from './scopeUtils';
import { IPythonMode } from './sourceFile';
import { SourceMapper, isStubFile } from './sourceMapper';
import { evaluateStaticBoolExpression } from './staticExpressions';
import { Symbol } from './symbol';
import * as SymbolNameUtils from './symbolNameUtils';
import { getLastTypedDeclarationForSymbol } from './symbolUtils';
import { maxCodeComplexity } from './typeEvaluator';
import {
    FunctionArgument,
    FunctionTypeResult,
    MemberAccessDeprecationInfo,
    TypeEvaluator,
    TypeResult,
} from './typeEvaluatorTypes';
import {
    getElementTypeForContainerNarrowing,
    isIsinstanceFilterSubclass,
    isIsinstanceFilterSuperclass,
    narrowTypeForContainerElementType,
} from './typeGuards';
import {
    AssignTypeFlags,
    ClassMember,
    MemberAccessFlags,
    applySolvedTypeVars,
    buildTypeVarContextFromSpecializedClass,
    convertToInstance,
    derivesFromAnyOrUnknown,
    derivesFromClassRecursive,
    doForEachSubtype,
    getClassFieldsRecursive,
    getDeclaredGeneratorReturnType,
    getGeneratorTypeArgs,
    getProtocolSymbolsRecursive,
    getSpecializedTupleType,
    getTypeVarArgumentsRecursive,
    getTypeVarScopeId,
    isLiteralType,
    isLiteralTypeOrUnion,
    isNoneInstance,
    isPartlyUnknown,
    isProperty,
    isTupleClass,
    isUnboundedTupleClass,
    lookUpClassMember,
    mapSubtypes,
    partiallySpecializeType,
    selfSpecializeClass,
    transformPossibleRecursiveTypeAlias,
} from './typeUtils';
import { TypeVarContext } from './typeVarContext';
import { getEffectiveExtraItemsEntryType, getTypedDictMembersForClass } from './typedDicts';
import {
    AnyType,
    ClassType,
    ClassTypeFlags,
    EnumLiteral,
    FunctionType,
    FunctionTypeFlags,
    OverloadedFunctionType,
    Type,
    TypeBase,
    TypeCategory,
    TypeVarScopeType,
    TypeVarType,
    TypedDictEntry,
    UnknownType,
    Variance,
    combineTypes,
    isAnyOrUnknown,
    isClass,
    isClassInstance,
    isFunction,
    isInstantiableClass,
    isModule,
    isNever,
    isOverloadedFunction,
    isParamSpec,
    isPossiblyUnbound,
    isTypeSame,
    isTypeVar,
    isUnbound,
    isUnion,
    isUnknown,
} from './types';

interface TypeVarUsageInfo {
    typeVar: TypeVarType;
    isExempt: boolean;
    returnTypeUsageCount: number;
    paramTypeUsageCount: number;
    paramTypeWithEllipsisUsageCount: number;
    paramWithEllipsis: string | undefined;
    nodes: NameNode[];
}

// When enabled, this debug flag causes the code complexity of
// functions to be emitted.
const isPrintCodeComplexityEnabled = false;

export class Checker extends ParseTreeWalker {
    private readonly _moduleNode: ModuleNode;
    private readonly _fileInfo: AnalyzerFileInfo;
    private _isUnboundCheckSuppressed = false;

    // A list of all nodes that are defined within the module that
    // have their own scopes.
    private _scopedNodes: AnalyzerNodeInfo.ScopedNode[] = [];

    // A list of all visited type parameter lists.
    private _typeParameterLists: TypeParameterListNode[] = [];

    constructor(
        private _importResolver: ImportResolver,
        private _evaluator: TypeEvaluator,
        parseResults: ParserOutput,
        private _sourceMapper: SourceMapper,
        private _dependentFiles?: ParserOutput[]
    ) {
        super();

        this._moduleNode = parseResults.parseTree;
        this._fileInfo = AnalyzerNodeInfo.getFileInfo(this._moduleNode)!;
    }

    check() {
        this._scopedNodes.push(this._moduleNode);

        this._conditionallyReportShadowedModule();

        // Report code complexity issues for the module.
        const codeComplexity = AnalyzerNodeInfo.getCodeFlowComplexity(this._moduleNode);

        if (isPrintCodeComplexityEnabled) {
            console.log(
                `Code complexity of module ${this._fileInfo.fileUri.toUserVisibleString()} is ${codeComplexity.toString()}`
            );
        }

        if (codeComplexity > maxCodeComplexity) {
            this._evaluator.addDiagnosticForTextRange(
                this._fileInfo,
                this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.codeTooComplexToAnalyze(),
                { start: 0, length: 0 }
            );
        }

        this._walkStatementsAndReportUnreachable(this._moduleNode.statements);

        // Mark symbols accessed by __all__ as accessed.
        const dunderAllInfo = AnalyzerNodeInfo.getDunderAllInfo(this._moduleNode);
        if (dunderAllInfo) {
            this._evaluator.markNamesAccessed(this._moduleNode, dunderAllInfo.names);

            this._reportUnusedDunderAllSymbols(dunderAllInfo.stringNodes);
        }

        // Perform a one-time validation of symbols in all scopes
        // defined in this module for things like unaccessed variables.
        this._validateSymbolTables();

        this._reportDuplicateImports();
    }

    override walk(node: ParseNode) {
        if (!AnalyzerNodeInfo.isCodeUnreachable(node)) {
            super.walk(node);
        } else {
            this._evaluator.suppressDiagnostics(node, () => {
                super.walk(node);
            });
        }
    }

    override visitSuite(node: SuiteNode): boolean {
        this._walkStatementsAndReportUnreachable(node.statements);
        return false;
    }

    override visitStatementList(node: StatementListNode) {
        node.statements.forEach((statement) => {
            if (isExpressionNode(statement)) {
                // Evaluate the expression in case it wasn't otherwise evaluated
                // through lazy analysis. This will mark referenced symbols as
                // accessed and report any errors associated with it.
                this._evaluator.getType(statement);

                this._reportUnusedExpression(statement);
            }
        });

        return true;
    }

    override visitClass(node: ClassNode): boolean {
        const classTypeResult = this._evaluator.getTypeOfClass(node);

        if (node.typeParameters) {
            this.walk(node.typeParameters);
        }
        this.walk(node.suite);
        this.walkMultiple(node.decorators);
        this.walkMultiple(node.arguments);

        if (classTypeResult) {
            // Protocol classes cannot derive from non-protocol classes.
            if (ClassType.isProtocolClass(classTypeResult.classType)) {
                node.arguments.forEach((arg) => {
                    if (!arg.name) {
                        const baseClassType = this._evaluator.getType(arg.valueExpression);
                        if (
                            baseClassType &&
                            isInstantiableClass(baseClassType) &&
                            !ClassType.isBuiltIn(baseClassType, 'Protocol') &&
                            !ClassType.isBuiltIn(baseClassType, 'Generic')
                        ) {
                            if (!ClassType.isProtocolClass(baseClassType)) {
                                this._evaluator.addDiagnostic(
                                    DiagnosticRule.reportGeneralTypeIssues,
                                    LocMessage.protocolBaseClass().format({
                                        classType: classTypeResult.classType.details.name,
                                        baseType: baseClassType.details.name,
                                    }),
                                    arg.valueExpression
                                );
                            }
                        }
                    }
                });

                // If this is a generic protocol class, verify that its type variables
                // have the proper variance.
                this._validateProtocolTypeParamVariance(node, classTypeResult.classType);
            }

            // Skip the slots check because class variables declared in a stub
            // file are interpreted as instance variables.
            if (!this._fileInfo.isStubFile) {
                this._validateSlotsClassVarConflict(classTypeResult.classType);
            }

            this._validateBaseClassOverrides(classTypeResult.classType);

            this._validateTypedDictOverrides(classTypeResult.classType);

            this._validateOverloadDecoratorConsistency(classTypeResult.classType);

            this._validateMultipleInheritanceBaseClasses(classTypeResult.classType, node.name);

            this._validateMultipleInheritanceCompatibility(classTypeResult.classType, node.name);

            this._validateConstructorConsistency(classTypeResult.classType, node.name);

            this._validateFinalMemberOverrides(classTypeResult.classType);

            this._validateInstanceVariableInitialization(node, classTypeResult.classType);

            this._validateFinalClassNotAbstract(classTypeResult.classType, node);

            this._validateDataClassPostInit(classTypeResult.classType, node);

            this._validateEnumMembers(classTypeResult.classType, node);

            if (ClassType.isTypedDictClass(classTypeResult.classType)) {
                this._validateTypedDictClassSuite(node.suite);
            }

            if (ClassType.isEnumClass(classTypeResult.classType)) {
                this._validateEnumClassOverride(node, classTypeResult.classType);
            }

            this._evaluator.validateInitSubclassArgs(node, classTypeResult.classType);
        }

        this._scopedNodes.push(node);

        return false;
    }

    override visitFunction(node: FunctionNode): boolean {
        if (node.typeParameters) {
            this.walk(node.typeParameters);
        }

        if (!this._fileInfo.diagnosticRuleSet.analyzeUnannotatedFunctions && !this._fileInfo.isStubFile) {
            if (ParseTreeUtils.isUnannotatedFunction(node)) {
                this._evaluator.addInformation(
                    LocMessage.unannotatedFunctionSkipped().format({ name: node.name.value }),
                    node.name
                );
            }
        }

        const functionTypeResult = this._evaluator.getTypeOfFunction(node);
        const containingClassNode = ParseTreeUtils.getEnclosingClass(node, /* stopAtFunction */ true);

        if (functionTypeResult) {
            // Track whether we have seen a *args: P.args parameter. Named
            // parameters after this need to be flagged as an error.
            let sawParamSpecArgs = false;

            const keywordNames = new Set<string>();
            const paramDetails = getParameterListDetails(functionTypeResult.functionType);

            // Report any unknown or missing parameter types.
            node.parameters.forEach((param, index) => {
                if (param.name) {
                    if (param.category === ParameterCategory.Simple && index >= paramDetails.positionOnlyParamCount) {
                        keywordNames.add(param.name.value);
                    }

                    // Determine whether this is a P.args parameter.
                    if (param.category === ParameterCategory.ArgsList) {
                        const annotationExpr = param.typeAnnotation || param.typeAnnotationComment;
                        if (
                            annotationExpr &&
                            annotationExpr.nodeType === ParseNodeType.MemberAccess &&
                            annotationExpr.memberName.value === 'args'
                        ) {
                            const baseType = this._evaluator.getType(annotationExpr.leftExpression);
                            if (baseType && isTypeVar(baseType) && baseType.details.isParamSpec) {
                                sawParamSpecArgs = true;
                            }
                        }
                    } else if (param.category === ParameterCategory.KwargsDict) {
                        sawParamSpecArgs = false;
                    }
                }

                if (param.name && param.category === ParameterCategory.Simple && sawParamSpecArgs) {
                    this._evaluator.addDiagnostic(
                        DiagnosticRule.reportGeneralTypeIssues,
                        LocMessage.namedParamAfterParamSpecArgs().format({ name: param.name.value }),
                        param.name
                    );
                }

                // Allow unknown and missing param types if the param is named '_'.
                if (param.name && param.name.value !== '_') {
                    const functionTypeParam = functionTypeResult.functionType.details.parameters.find(
                        (p) => p.name === param.name?.value
                    );

                    if (functionTypeParam) {
                        const paramType = functionTypeParam.type;

                        if (this._fileInfo.diagnosticRuleSet.reportUnknownParameterType !== 'none') {
                            if (
                                isUnknown(paramType) ||
                                (isTypeVar(paramType) &&
                                    paramType.details.isSynthesized &&
                                    !paramType.details.isSynthesizedSelf)
                            ) {
                                this._evaluator.addDiagnostic(
                                    DiagnosticRule.reportUnknownParameterType,
                                    LocMessage.paramTypeUnknown().format({ paramName: param.name.value }),
                                    param.name
                                );
                            } else if (isPartlyUnknown(paramType)) {
                                const diagAddendum = new DiagnosticAddendum();
                                diagAddendum.addMessage(
                                    LocAddendum.paramType().format({
                                        paramType: this._evaluator.printType(paramType, { expandTypeAlias: true }),
                                    })
                                );
                                this._evaluator.addDiagnostic(
                                    DiagnosticRule.reportUnknownParameterType,
                                    LocMessage.paramTypePartiallyUnknown().format({
                                        paramName: param.name.value,
                                    }) + diagAddendum.getString(),
                                    param.name
                                );
                            }
                        }

                        let hasAnnotation = false;

                        if (functionTypeParam.typeAnnotation) {
                            hasAnnotation = true;
                        } else {
                            // See if this is a "self" and "cls" parameter. They are exempt from this rule.
                            if (isTypeVar(paramType) && paramType.details.isSynthesizedSelf) {
                                hasAnnotation = true;
                            }
                        }

                        if (!hasAnnotation && this._fileInfo.diagnosticRuleSet.reportMissingParameterType !== 'none') {
                            this._evaluator.addDiagnostic(
                                DiagnosticRule.reportMissingParameterType,
                                LocMessage.paramAnnotationMissing().format({ name: param.name.value }),
                                param.name
                            );
                        }
                    }
                }
            });

            // Verify that an unpacked TypedDict doesn't overlap any keyword parameters.
            if (paramDetails.hasUnpackedTypedDict) {
                const kwargsIndex = functionTypeResult.functionType.details.parameters.length - 1;
                const kwargsType = FunctionType.getEffectiveParameterType(functionTypeResult.functionType, kwargsIndex);

                if (isClass(kwargsType) && kwargsType.details.typedDictEntries) {
                    const overlappingEntries = new Set<string>();
                    kwargsType.details.typedDictEntries.knownItems.forEach((_, name) => {
                        if (keywordNames.has(name)) {
                            overlappingEntries.add(name);
                        }
                    });

                    if (overlappingEntries.size > 0) {
                        this._evaluator.addDiagnostic(
                            DiagnosticRule.reportGeneralTypeIssues,
                            LocMessage.overlappingKeywordArgs().format({
                                names: [...overlappingEntries.values()].join(', '),
                            }),
                            node.parameters[kwargsIndex].typeAnnotation ?? node.parameters[kwargsIndex]
                        );
                    }
                }
            }

            // Check for invalid use of ParamSpec P.args and P.kwargs.
            const paramSpecParams = functionTypeResult.functionType.details.parameters.filter((param) => {
                if (param.typeAnnotation && isTypeVar(param.type) && isParamSpec(param.type)) {
                    if (param.category !== ParameterCategory.Simple && param.name && param.type.paramSpecAccess) {
                        return true;
                    }
                }

                return false;
            });

            if (paramSpecParams.length === 1 && paramSpecParams[0].typeAnnotation) {
                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportGeneralTypeIssues,
                    LocMessage.paramSpecArgsKwargsUsage(),
                    paramSpecParams[0].typeAnnotation
                );
            }

            // If this is a stub, ensure that the return type is specified.
            if (this._fileInfo.isStubFile) {
                const returnAnnotation =
                    node.returnTypeAnnotation || node.functionAnnotationComment?.returnTypeAnnotation;
                if (!returnAnnotation) {
                    this._evaluator.addDiagnostic(
                        DiagnosticRule.reportUnknownParameterType,
                        LocMessage.returnTypeUnknown(),
                        node.name
                    );
                }
            }

            if (containingClassNode) {
                this._validateMethod(node, functionTypeResult.functionType, containingClassNode);
            }
        }

        node.parameters.forEach((param, index) => {
            if (param.defaultValue) {
                this.walk(param.defaultValue);
            }

            if (param.typeAnnotation) {
                this.walk(param.typeAnnotation);
            }

            if (param.typeAnnotationComment) {
                this.walk(param.typeAnnotationComment);
            }

            // Look for method parameters that are typed with TypeVars that have the wrong variance.
            if (functionTypeResult) {
                const annotationNode = param.typeAnnotation || param.typeAnnotationComment;
                if (annotationNode && index < functionTypeResult.functionType.details.parameters.length) {
                    const paramType = functionTypeResult.functionType.details.parameters[index].type;
                    const exemptMethods = ['__init__', '__new__'];

                    if (
                        containingClassNode &&
                        isTypeVar(paramType) &&
                        paramType.details.declaredVariance === Variance.Covariant &&
                        !paramType.details.isSynthesized &&
                        !exemptMethods.some((name) => name === functionTypeResult.functionType.details.name)
                    ) {
                        this._evaluator.addDiagnostic(
                            DiagnosticRule.reportGeneralTypeIssues,
                            LocMessage.paramTypeCovariant(),
                            annotationNode
                        );
                    }
                }
            }
        });

        if (node.returnTypeAnnotation) {
            this.walk(node.returnTypeAnnotation);
        }

        if (node.functionAnnotationComment) {
            this.walk(node.functionAnnotationComment);

            if (
                this._fileInfo.diagnosticRuleSet.reportTypeCommentUsage !== 'none' &&
                this._fileInfo.executionEnvironment.pythonVersion.isGreaterOrEqualTo(pythonVersion3_5)
            ) {
                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportTypeCommentUsage,
                    LocMessage.typeCommentDeprecated(),
                    node.functionAnnotationComment
                );
            }
        }

        this.walkMultiple(node.decorators);

        node.parameters.forEach((param) => {
            if (param.name) {
                this.walk(param.name);
            }
        });

        const codeComplexity = AnalyzerNodeInfo.getCodeFlowComplexity(node);
        const isTooComplexToAnalyze = codeComplexity > maxCodeComplexity;

        if (isPrintCodeComplexityEnabled) {
            console.log(`Code complexity of function ${node.name.value} is ${codeComplexity.toString()}`);
        }

        if (isTooComplexToAnalyze) {
            this._evaluator.addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.codeTooComplexToAnalyze(),
                node.name
            );
        } else {
            this.walk(node.suite);
        }

        if (functionTypeResult) {
            // Validate that the function returns the declared type.
            if (!isTooComplexToAnalyze) {
                this._validateFunctionReturn(node, functionTypeResult.functionType);
            }

            // Verify common dunder signatures.
            this._validateDunderSignatures(node, functionTypeResult.functionType, containingClassNode !== undefined);

            // Verify TypeGuard and TypeIs functions.
            this._validateTypeGuardFunction(node, functionTypeResult.functionType, containingClassNode !== undefined);

            this._validateFunctionTypeVarUsage(node, functionTypeResult);

            this._validateGeneratorReturnType(node, functionTypeResult.functionType);

            this._reportDeprecatedClassProperty(node, functionTypeResult);

            // If this is not a method, @final is disallowed.
            if (!containingClassNode && FunctionType.isFinal(functionTypeResult.functionType)) {
                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportGeneralTypeIssues,
                    LocMessage.finalNonMethod().format({ name: node.name.value }),
                    node.name
                );
            }
        }

        // If we're at the module level within a stub file, report a diagnostic
        // if there is a '__getattr__' function defined when in strict mode.
        // This signifies an incomplete stub file that obscures type errors.
        if (this._fileInfo.isStubFile && node.name.value === '__getattr__') {
            const scope = getScopeForNode(node);
            if (scope?.type === ScopeType.Module) {
                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportIncompleteStub,
                    LocMessage.stubUsesGetAttr(),
                    node.name
                );
            }
        }

        this._scopedNodes.push(node);

        if (functionTypeResult && isOverloadedFunction(functionTypeResult.decoratedType)) {
            // If this is the implementation for the overloaded function, skip
            // overload consistency checks.
            if (
                OverloadedFunctionType.getImplementation(functionTypeResult.decoratedType) !==
                functionTypeResult.functionType
            ) {
                const overloads = OverloadedFunctionType.getOverloads(functionTypeResult.decoratedType);
                if (overloads.length > 1) {
                    const maxOverloadConsistencyCheckLength = 100;

                    // The check is n^2 in time, so if the number of overloads
                    // is very large (which can happen for some generated code),
                    // skip this check to avoid quadratic analysis time.
                    if (overloads.length < maxOverloadConsistencyCheckLength) {
                        this._validateOverloadConsistency(
                            node,
                            overloads[overloads.length - 1],
                            overloads.slice(0, overloads.length - 1)
                        );
                    }
                }
            }

            this._validateOverloadAttributeConsistency(node, functionTypeResult.decoratedType);
        }

        return false;
    }

    override visitLambda(node: LambdaNode): boolean {
        this._evaluator.getType(node);

        // Walk the children.
        this.walkMultiple([...node.parameters, node.expression]);

        node.parameters.forEach((param) => {
            if (param.name) {
                const paramType = this._evaluator.getType(param.name);
                if (paramType) {
                    if (isUnknown(paramType)) {
                        this._evaluator.addDiagnostic(
                            DiagnosticRule.reportUnknownLambdaType,
                            LocMessage.paramTypeUnknown().format({ paramName: param.name.value }),
                            param.name
                        );
                    } else if (isPartlyUnknown(paramType)) {
                        this._evaluator.addDiagnostic(
                            DiagnosticRule.reportUnknownLambdaType,
                            LocMessage.paramTypePartiallyUnknown().format({ paramName: param.name.value }),
                            param.name
                        );
                    }
                }
            }
        });

        const returnType = this._evaluator.getType(node.expression);
        if (returnType) {
            if (isUnknown(returnType)) {
                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportUnknownLambdaType,
                    LocMessage.lambdaReturnTypeUnknown(),
                    node.expression
                );
            } else if (isPartlyUnknown(returnType)) {
                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportUnknownLambdaType,
                    LocMessage.lambdaReturnTypePartiallyUnknown().format({
                        returnType: this._evaluator.printType(returnType, { expandTypeAlias: true }),
                    }),
                    node.expression
                );
            }
        }

        this._scopedNodes.push(node);

        return false;
    }

    override visitCall(node: CallNode): boolean {
        this._validateIsInstanceCall(node);

        this._validateIllegalDefaultParamInitializer(node);

        this._validateStandardCollectionInstantiation(node);

        if (
            this._fileInfo.diagnosticRuleSet.reportUnusedCallResult !== 'none' ||
            this._fileInfo.diagnosticRuleSet.reportUnusedCoroutine !== 'none'
        ) {
            if (node.parent?.nodeType === ParseNodeType.StatementList) {
                const isRevealTypeCall =
                    node.leftExpression.nodeType === ParseNodeType.Name && node.leftExpression.value === 'reveal_type';
                const returnType = this._evaluator.getType(node);

                if (!isRevealTypeCall && returnType && this._isTypeValidForUnusedValueTest(returnType)) {
                    this._evaluator.addDiagnostic(
                        DiagnosticRule.reportUnusedCallResult,
                        LocMessage.unusedCallResult().format({
                            type: this._evaluator.printType(returnType),
                        }),
                        node
                    );

                    if (isClassInstance(returnType) && ClassType.isBuiltIn(returnType, 'Coroutine')) {
                        this._evaluator.addDiagnostic(
                            DiagnosticRule.reportUnusedCoroutine,
                            LocMessage.unusedCoroutine(),
                            node
                        );
                    }
                }
            }
        }

        return true;
    }

    override visitAwait(node: AwaitNode) {
        if (this._fileInfo.diagnosticRuleSet.reportUnusedCallResult !== 'none') {
            if (
                node.parent?.nodeType === ParseNodeType.StatementList &&
                node.expression.nodeType === ParseNodeType.Call
            ) {
                const returnType = this._evaluator.getType(node);

                if (returnType && this._isTypeValidForUnusedValueTest(returnType)) {
                    this._evaluator.addDiagnostic(
                        DiagnosticRule.reportUnusedCallResult,
                        LocMessage.unusedCallResult().format({
                            type: this._evaluator.printType(returnType),
                        }),
                        node
                    );
                }
            }
        }

        return true;
    }

    override visitFor(node: ForNode): boolean {
        this._evaluator.evaluateTypesForStatement(node);

        if (node.typeComment) {
            this._evaluator.addDiagnosticForTextRange(
                this._fileInfo,
                this._fileInfo.diagnosticRuleSet.reportInvalidTypeForm,
                DiagnosticRule.reportInvalidTypeForm,
                LocMessage.annotationNotSupported(),
                node.typeComment
            );
        }
        return true;
    }

    override visitList(node: ListNode): boolean {
        this._validateIllegalDefaultParamInitializer(node);
        return true;
    }

    override visitSet(node: SetNode): boolean {
        this._validateIllegalDefaultParamInitializer(node);
        return true;
    }

    override visitDictionary(node: DictionaryNode): boolean {
        this._validateIllegalDefaultParamInitializer(node);
        return true;
    }

    override visitListComprehension(node: ListComprehensionNode): boolean {
        this._scopedNodes.push(node);
        return true;
    }

    override visitListComprehensionIf(node: ListComprehensionIfNode): boolean {
        this._validateConditionalIsBool(node.testExpression);
        this._reportUnnecessaryConditionExpression(node.testExpression);
        return true;
    }

    override visitIf(node: IfNode): boolean {
        this._validateConditionalIsBool(node.testExpression);
        this._reportUnnecessaryConditionExpression(node.testExpression);
        return true;
    }

    override visitWhile(node: WhileNode): boolean {
        this._validateConditionalIsBool(node.testExpression);
        this._reportUnnecessaryConditionExpression(node.testExpression);
        return true;
    }

    override visitWith(node: WithNode): boolean {
        node.withItems.forEach((item) => {
            this._evaluator.evaluateTypesForStatement(item);
        });

        if (node.typeComment) {
            this._evaluator.addDiagnosticForTextRange(
                this._fileInfo,
                this._fileInfo.diagnosticRuleSet.reportInvalidTypeForm,
                DiagnosticRule.reportInvalidTypeForm,
                LocMessage.annotationNotSupported(),
                node.typeComment
            );
        }

        return true;
    }

    override visitReturn(node: ReturnNode): boolean {
        let returnTypeResult: TypeResult;
        let returnType: Type | undefined;

        const enclosingFunctionNode = ParseTreeUtils.getEnclosingFunction(node);
        const declaredReturnType = enclosingFunctionNode
            ? this._evaluator.getFunctionDeclaredReturnType(enclosingFunctionNode)
            : undefined;

        if (node.returnExpression) {
            returnTypeResult = this._evaluator.getTypeResult(node.returnExpression) ?? { type: UnknownType.create() };
        } else {
            // There is no return expression, so "None" is assumed.
            returnTypeResult = { type: this._evaluator.getNoneType() };
        }

        returnType = returnTypeResult.type;

        // If this type is a special form, use the special form instead.
        if (returnType.specialForm) {
            returnType = returnType.specialForm;
        }

        // If the enclosing function is async and a generator, the return
        // statement is not allowed to have an argument. A syntax error occurs
        // at runtime in this case.
        if (enclosingFunctionNode?.isAsync && node.returnExpression) {
            const functionDecl = AnalyzerNodeInfo.getDeclaration(enclosingFunctionNode);
            if (functionDecl?.type === DeclarationType.Function && functionDecl.isGenerator) {
                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportGeneralTypeIssues,
                    LocMessage.returnInAsyncGenerator(),
                    node.returnExpression
                );
            }
        }

        if (this._evaluator.isNodeReachable(node, /* sourceNode */ undefined) && enclosingFunctionNode) {
            if (declaredReturnType) {
                if (isNever(declaredReturnType)) {
                    this._evaluator.addDiagnostic(
                        DiagnosticRule.reportGeneralTypeIssues,
                        LocMessage.noReturnContainsReturn(),
                        node
                    );
                } else {
                    let diagAddendum = new DiagnosticAddendum();
                    let returnTypeMatches = false;

                    if (
                        this._evaluator.assignType(
                            declaredReturnType,
                            returnType,
                            diagAddendum,
                            new TypeVarContext(),
                            /* srcTypeVarContext */ undefined,
                            AssignTypeFlags.AllowBoolTypeGuard
                        )
                    ) {
                        returnTypeMatches = true;
                    } else {
                        // See if the declared return type includes one or more constrained TypeVars. If so,
                        // try to narrow these TypeVars to a single type.
                        const uniqueTypeVars = getTypeVarArgumentsRecursive(declaredReturnType);

                        if (
                            uniqueTypeVars &&
                            uniqueTypeVars.some((typeVar) => typeVar.details.constraints.length > 0)
                        ) {
                            const typeVarContext = new TypeVarContext();

                            for (const typeVar of uniqueTypeVars) {
                                if (typeVar.details.constraints.length > 0) {
                                    const narrowedType = this._evaluator.narrowConstrainedTypeVar(node, typeVar);
                                    if (narrowedType) {
                                        typeVarContext.setTypeVarType(typeVar, narrowedType);
                                        typeVarContext.addSolveForScope(getTypeVarScopeId(typeVar));
                                    }
                                }
                            }

                            if (!typeVarContext.isEmpty()) {
                                const adjustedReturnType = applySolvedTypeVars(declaredReturnType, typeVarContext);

                                if (
                                    this._evaluator.assignType(
                                        adjustedReturnType,
                                        returnType,
                                        diagAddendum,
                                        /* destTypeVarContext */ undefined,
                                        /* srcTypeVarContext */ undefined,
                                        AssignTypeFlags.AllowBoolTypeGuard
                                    )
                                ) {
                                    returnTypeMatches = true;
                                }
                            }
                        }
                    }

                    if (!returnTypeMatches) {
                        // If we have more detailed diagnostic information from
                        // bidirectional type inference, use that.
                        if (returnTypeResult.expectedTypeDiagAddendum) {
                            diagAddendum = returnTypeResult.expectedTypeDiagAddendum;
                        }

                        this._evaluator.addDiagnostic(
                            DiagnosticRule.reportReturnType,
                            LocMessage.returnTypeMismatch().format({
                                exprType: this._evaluator.printType(returnType),
                                returnType: this._evaluator.printType(declaredReturnType),
                            }) + diagAddendum.getString(),
                            node.returnExpression ?? node,
                            returnTypeResult.expectedTypeDiagAddendum?.getEffectiveTextRange()
                        );
                    }
                }
            }

            if (isUnknown(returnType)) {
                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportUnknownVariableType,
                    LocMessage.returnTypeUnknown(),
                    node.returnExpression ?? node
                );
            } else if (isPartlyUnknown(returnType)) {
                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportUnknownVariableType,
                    LocMessage.returnTypePartiallyUnknown().format({
                        returnType: this._evaluator.printType(returnType, { expandTypeAlias: true }),
                    }),
                    node.returnExpression ?? node
                );
            }
        }

        return true;
    }

    override visitYield(node: YieldNode) {
        const yieldTypeResult = node.expression
            ? this._evaluator.getTypeResult(node.expression)
            : { type: this._evaluator.getNoneType() };
        this._validateYieldType(
            node,
            yieldTypeResult?.type ?? UnknownType.create(),
            yieldTypeResult?.expectedTypeDiagAddendum
        );
        return true;
    }

    override visitYieldFrom(node: YieldFromNode) {
        const yieldFromType = this._evaluator.getType(node.expression) || UnknownType.create();
        let yieldType: Type | undefined;
        let sendType: Type | undefined;

        if (isClassInstance(yieldFromType) && ClassType.isBuiltIn(yieldFromType, 'Coroutine')) {
            // Handle the case of old-style (pre-await) coroutines.
            yieldType = UnknownType.create();
        } else {
            yieldType =
                this._evaluator.getTypeOfIterable({ type: yieldFromType }, /* isAsync */ false, node)?.type ??
                UnknownType.create();

            // Does the iterator return a Generator? If so, get the yield type from it.
            // If the iterator doesn't return a Generator, use the iterator return type
            // directly.
            const generatorTypeArgs = getGeneratorTypeArgs(yieldType);
            if (generatorTypeArgs) {
                yieldType = generatorTypeArgs.length >= 1 ? generatorTypeArgs[0] : UnknownType.create();
                sendType = generatorTypeArgs.length >= 2 ? generatorTypeArgs[1] : undefined;
            } else {
                yieldType =
                    this._evaluator.getTypeOfIterator({ type: yieldFromType }, /* isAsync */ false, node)?.type ??
                    UnknownType.create();
            }
        }

        this._validateYieldType(node, yieldType, /* expectedDiagAddendum */ undefined, sendType);

        return true;
    }

    override visitRaise(node: RaiseNode): boolean {
        this._evaluator.verifyRaiseExceptionType(node);

        if (node.valueExpression) {
            const baseExceptionType = this._evaluator.getBuiltInType(node, 'BaseException') as ClassType;
            const exceptionType = this._evaluator.getType(node.valueExpression);

            // Validate that the argument of "raise" is an exception object or None.
            if (exceptionType && baseExceptionType && isInstantiableClass(baseExceptionType)) {
                const diagAddendum = new DiagnosticAddendum();

                doForEachSubtype(exceptionType, (subtype) => {
                    subtype = this._evaluator.makeTopLevelTypeVarsConcrete(subtype);

                    if (!isAnyOrUnknown(subtype) && !isNoneInstance(subtype)) {
                        if (isClass(subtype)) {
                            if (!derivesFromClassRecursive(subtype, baseExceptionType, /* ignoreUnknown */ false)) {
                                diagAddendum.addMessage(
                                    LocMessage.exceptionTypeIncorrect().format({
                                        type: this._evaluator.printType(subtype),
                                    })
                                );
                            }
                        } else {
                            diagAddendum.addMessage(
                                LocMessage.exceptionTypeIncorrect().format({
                                    type: this._evaluator.printType(subtype),
                                })
                            );
                        }
                    }
                });

                if (!diagAddendum.isEmpty()) {
                    this._evaluator.addDiagnostic(
                        DiagnosticRule.reportGeneralTypeIssues,
                        LocMessage.expectedExceptionObj() + diagAddendum.getString(),
                        node.valueExpression
                    );
                }
            }
        }

        return true;
    }

    override visitExcept(node: ExceptNode): boolean {
        if (node.typeExpression) {
            this._evaluator.evaluateTypesForStatement(node);

            const exceptionType = this._evaluator.getType(node.typeExpression);
            if (exceptionType) {
                this._validateExceptionType(exceptionType, node.typeExpression);
            }
        }

        return true;
    }

    override visitAssert(node: AssertNode) {
        if (node.exceptionExpression) {
            this._evaluator.getType(node.exceptionExpression);
        }

        this._validateConditionalIsBool(node.testExpression);

        // Specifically look for a common programming error where the two arguments
        // to an assert are enclosed in parens and interpreted as a two-element tuple.
        //   assert (x > 3, "bad value x")
        const type = this._evaluator.getType(node.testExpression);
        if (type && isClassInstance(type)) {
            if (isTupleClass(type) && type.tupleTypeArguments) {
                if (type.tupleTypeArguments.length > 0) {
                    if (!isUnboundedTupleClass(type)) {
                        this._evaluator.addDiagnosticForTextRange(
                            this._fileInfo,
                            this._fileInfo.diagnosticRuleSet.reportAssertAlwaysTrue,
                            DiagnosticRule.reportAssertAlwaysTrue,
                            LocMessage.assertAlwaysTrue(),
                            node.testExpression
                        );
                    }
                }
            }
        }

        return true;
    }

    override visitAssignment(node: AssignmentNode): boolean {
        this._evaluator.evaluateTypesForStatement(node);

        if (node.typeAnnotationComment) {
            this._evaluator.getType(node.typeAnnotationComment);

            if (
                this._fileInfo.diagnosticRuleSet.reportTypeCommentUsage !== 'none' &&
                this._fileInfo.executionEnvironment.pythonVersion.isGreaterOrEqualTo(pythonVersion3_6)
            ) {
                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportTypeCommentUsage,
                    LocMessage.typeCommentDeprecated(),
                    node.typeAnnotationComment
                );
            }
        }

        // If this isn't a class or global scope, explicit type aliases are not allowed.
        if (node.leftExpression.nodeType === ParseNodeType.TypeAnnotation) {
            const annotationType = this._evaluator.getTypeOfAnnotation(node.leftExpression.typeAnnotation);

            if (isClassInstance(annotationType) && ClassType.isBuiltIn(annotationType, 'TypeAlias')) {
                const scope = getScopeForNode(node);
                if (scope) {
                    if (
                        scope.type !== ScopeType.Class &&
                        scope.type !== ScopeType.Module &&
                        scope.type !== ScopeType.Builtin
                    ) {
                        this._evaluator.addDiagnostic(
                            DiagnosticRule.reportGeneralTypeIssues,
                            LocMessage.typeAliasNotInModuleOrClass(),
                            node.leftExpression.typeAnnotation
                        );
                    }
                }
            }
        }

        return true;
    }

    override visitAssignmentExpression(node: AssignmentExpressionNode): boolean {
        this._evaluator.getType(node);
        return true;
    }

    override visitAugmentedAssignment(node: AugmentedAssignmentNode): boolean {
        this._evaluator.evaluateTypesForStatement(node);
        return true;
    }

    override visitIndex(node: IndexNode): boolean {
        this._evaluator.getType(node);

        // If the index is a literal integer, see if this is a tuple with
        // a known length and the integer value exceeds the length.
        const baseType = this._evaluator.getType(node.baseExpression);
        if (baseType) {
            doForEachSubtype(baseType, (subtype) => {
                const tupleType = getSpecializedTupleType(subtype);

                if (!isClassInstance(subtype) || !tupleType?.tupleTypeArguments || isUnboundedTupleClass(tupleType)) {
                    return;
                }

                const tupleLength = tupleType.tupleTypeArguments.length;

                if (
                    node.items.length !== 1 ||
                    node.trailingComma ||
                    node.items[0].argumentCategory !== ArgumentCategory.Simple ||
                    node.items[0].name
                ) {
                    return;
                }

                const subscriptType = this._evaluator.getType(node.items[0].valueExpression);
                if (
                    !subscriptType ||
                    !isClassInstance(subscriptType) ||
                    !ClassType.isBuiltIn(subscriptType, 'int') ||
                    !isLiteralType(subscriptType) ||
                    typeof subscriptType.literalValue !== 'number'
                ) {
                    return;
                }

                if (
                    (subscriptType.literalValue < 0 || subscriptType.literalValue < tupleLength) &&
                    (subscriptType.literalValue >= 0 || subscriptType.literalValue + tupleLength >= 0)
                ) {
                    return;
                }

                // This can be an expensive check, so we save it for the end once we
                // are about to emit a diagnostic.
                if (this._evaluator.isTypeSubsumedByOtherType(tupleType, baseType, /* allowAnyToSubsume */ false)) {
                    return;
                }

                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportGeneralTypeIssues,
                    LocMessage.tupleIndexOutOfRange().format({
                        index: subscriptType.literalValue,
                        type: this._evaluator.printType(subtype),
                    }),
                    node
                );
            });
        }

        return true;
    }

    override visitBinaryOperation(node: BinaryOperationNode): boolean {
        if (node.operator === OperatorType.And || node.operator === OperatorType.Or) {
            this._validateConditionalIsBool(node.leftExpression);
            this._validateConditionalIsBool(node.rightExpression);
        }

        if (node.operator === OperatorType.Equals || node.operator === OperatorType.NotEquals) {
            // Don't apply this rule if it's within an assert.
            if (!ParseTreeUtils.isWithinAssertExpression(node)) {
                this._validateComparisonTypes(node);
            }
        } else if (node.operator === OperatorType.Is || node.operator === OperatorType.IsNot) {
            // Don't apply this rule if it's within an assert.
            if (!ParseTreeUtils.isWithinAssertExpression(node)) {
                this._validateComparisonTypesForIsOperator(node);
            }
        } else if (node.operator === OperatorType.In || node.operator === OperatorType.NotIn) {
            // Don't apply this rule if it's within an assert.
            if (!ParseTreeUtils.isWithinAssertExpression(node)) {
                this._validateContainmentTypes(node);
            }
        }

        this._evaluator.getType(node);
        return true;
    }

    override visitSlice(node: SliceNode): boolean {
        this._evaluator.getType(node);
        return true;
    }

    override visitUnpack(node: UnpackNode): boolean {
        this._evaluator.getType(node);
        return true;
    }

    override visitTuple(node: TupleNode): boolean {
        this._evaluator.getType(node);
        return true;
    }

    override visitUnaryOperation(node: UnaryOperationNode): boolean {
        if (node.operator === OperatorType.Not) {
            this._validateConditionalIsBool(node.expression);
        }

        this._evaluator.getType(node);
        return true;
    }

    override visitTernary(node: TernaryNode): boolean {
        this._evaluator.getType(node);
        this._validateConditionalIsBool(node.testExpression);
        this._reportUnnecessaryConditionExpression(node.testExpression);
        return true;
    }

    override visitStringList(node: StringListNode): boolean {
        // If this is Python 3.11 or older, there are several restrictions
        // associated with f-strings that we need to validate. Determine whether
        // we're within an f-string (or multiple f-strings if nesting is used).
        const fStringContainers: FormatStringNode[] = [];
        if (this._fileInfo.executionEnvironment.pythonVersion.isLessThan(pythonVersion3_12)) {
            let curNode: ParseNode | undefined = node;
            while (curNode) {
                if (curNode.nodeType === ParseNodeType.FormatString) {
                    fStringContainers.push(curNode);
                }
                curNode = curNode.parent;
            }
        }

        for (const stringNode of node.strings) {
            const stringTokens =
                stringNode.nodeType === ParseNodeType.String ? [stringNode.token] : stringNode.middleTokens;

            stringTokens.forEach((token) => {
                const unescapedResult = getUnescapedString(token);
                let start = token.start;
                if (token.type === TokenType.String) {
                    start += token.prefixLength + token.quoteMarkLength;
                }

                unescapedResult.unescapeErrors.forEach((error: UnescapeError) => {
                    if (error.errorType === UnescapeErrorType.InvalidEscapeSequence) {
                        this._evaluator.addDiagnosticForTextRange(
                            this._fileInfo,
                            this._fileInfo.diagnosticRuleSet.reportInvalidStringEscapeSequence,
                            DiagnosticRule.reportInvalidStringEscapeSequence,
                            LocMessage.stringUnsupportedEscape(),
                            { start: start + error.offset, length: error.length }
                        );
                    }
                });

                // Prior to Python 3.12, it was not allowed to include a slash in an f-string.
                if (fStringContainers.length > 0) {
                    const escapeOffset = token.escapedValue.indexOf('\\');
                    if (escapeOffset >= 0) {
                        this._evaluator.addDiagnosticForTextRange(
                            this._fileInfo,
                            this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                            DiagnosticRule.reportGeneralTypeIssues,
                            LocMessage.formatStringEscape(),
                            { start, length: 1 }
                        );
                    }
                }
            });

            // Prior to Python 3.12, it was not allowed to nest strings that
            // used the same quote scheme within an f-string.
            if (fStringContainers.length > 0) {
                const quoteTypeMask =
                    StringTokenFlags.SingleQuote | StringTokenFlags.DoubleQuote | StringTokenFlags.Triplicate;
                if (
                    fStringContainers.some(
                        (fStringContainer) =>
                            (fStringContainer.token.flags & quoteTypeMask) === (stringNode.token.flags & quoteTypeMask)
                    )
                ) {
                    this._evaluator.addDiagnostic(
                        DiagnosticRule.reportGeneralTypeIssues,
                        LocMessage.formatStringNestedQuote(),
                        stringNode
                    );
                }
            }
        }

        if (node.typeAnnotation) {
            this._evaluator.getType(node);
        }

        if (node.strings.length > 1 && !node.isParenthesized) {
            this._evaluator.addDiagnosticForTextRange(
                this._fileInfo,
                this._fileInfo.diagnosticRuleSet.reportImplicitStringConcatenation,
                DiagnosticRule.reportImplicitStringConcatenation,
                LocMessage.implicitStringConcat(),
                node
            );
        }

        return true;
    }

    override visitFormatString(node: FormatStringNode): boolean {
        node.fieldExpressions.forEach((expr) => {
            this._evaluator.getType(expr);
        });

        node.formatExpressions.forEach((expr) => {
            this._evaluator.getType(expr);
        });

        return true;
    }

    override visitGlobal(node: GlobalNode): boolean {
        this._suppressUnboundCheck(() => {
            node.nameList.forEach((name) => {
                this._evaluator.getType(name);

                this.walk(name);
            });
        });

        return false;
    }

    override visitNonlocal(node: NonlocalNode): boolean {
        this._suppressUnboundCheck(() => {
            node.nameList.forEach((name) => {
                this._evaluator.getType(name);

                this.walk(name);
            });
        });

        return false;
    }

    override visitName(node: NameNode) {
        // Determine if we should log information about private usage.
        this._conditionallyReportPrivateUsage(node);

        // Determine if the name is possibly unbound.
        if (!this._isUnboundCheckSuppressed) {
            this._reportUnboundName(node);
        }

        // Report the use of a deprecated symbol.
        const type = this._evaluator.getType(node);
        this._reportDeprecatedUseForType(node, type);

        return true;
    }

    override visitDel(node: DelNode) {
        node.expressions.forEach((expr) => {
            this._evaluator.verifyDeleteExpression(expr);

            this.walk(expr);
        });

        return false;
    }

    override visitMemberAccess(node: MemberAccessNode) {
        const typeResult = this._evaluator.getTypeResult(node);
        const type = typeResult?.type ?? UnknownType.create();

        const leftExprType = this._evaluator.getType(node.leftExpression);
        this._reportDeprecatedUseForType(
            node.memberName,
            type,
            leftExprType && isModule(leftExprType) && leftExprType.moduleName === 'typing'
        );

        if (typeResult?.memberAccessDeprecationInfo) {
            this._reportDeprecatedUseForMemberAccess(node.memberName, typeResult.memberAccessDeprecationInfo);
        }

        this._conditionallyReportPrivateUsage(node.memberName);

        // Walk the leftExpression but not the memberName.
        this.walk(node.leftExpression);

        return false;
    }

    override visitImportAs(node: ImportAsNode): boolean {
        this._conditionallyReportShadowedImport(node);
        this._evaluator.evaluateTypesForStatement(node);
        return true;
    }

    override visitImportFrom(node: ImportFromNode): boolean {
        // Verify that any "__future__" import occurs at the top of the file.
        if (
            node.module.leadingDots === 0 &&
            node.module.nameParts.length === 1 &&
            node.module.nameParts[0].value === '__future__'
        ) {
            if (!ParseTreeUtils.isValidLocationForFutureImport(node)) {
                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportGeneralTypeIssues,
                    LocMessage.futureImportLocationNotAllowed(),
                    node
                );
            }
        }

        this._conditionallyReportShadowedImport(node);

        if (!node.isWildcardImport) {
            node.imports.forEach((importAs) => {
                this._evaluator.evaluateTypesForStatement(importAs);
            });
        } else {
            this._evaluator.evaluateTypesForStatement(node);

            const importInfo = AnalyzerNodeInfo.getImportInfo(node.module);
            if (
                importInfo &&
                importInfo.isImportFound &&
                importInfo.importType !== ImportType.Local &&
                !this._fileInfo.isStubFile
            ) {
                this._evaluator.addDiagnosticForTextRange(
                    this._fileInfo,
                    this._fileInfo.diagnosticRuleSet.reportWildcardImportFromLibrary,
                    DiagnosticRule.reportWildcardImportFromLibrary,
                    LocMessage.wildcardLibraryImport(),
                    node.wildcardToken || node
                );
            }
        }

        return true;
    }

    override visitImportFromAs(node: ImportFromAsNode): boolean {
        if (this._fileInfo.isStubFile) {
            return false;
        }

        const decls = this._evaluator.getDeclarationsForNameNode(node.name);
        if (!decls) {
            return false;
        }

        for (const decl of decls) {
            if (!isAliasDeclaration(decl) || !decl.submoduleFallback || decl.node !== node) {
                // If it is not implicitly imported module, move to next.
                continue;
            }

            const resolvedAlias = this._evaluator.resolveAliasDeclaration(decl, /* resolveLocalNames */ true);
            const resolvedAliasUri = resolvedAlias?.uri;
            if (!resolvedAliasUri || !isStubFile(resolvedAliasUri)) {
                continue;
            }

            const importResult = this._getImportResult(node, resolvedAliasUri);
            if (!importResult) {
                continue;
            }

            this._addMissingModuleSourceDiagnosticIfNeeded(importResult, node.name);
            break;
        }

        let isImportFromTyping = false;
        if (node.parent?.nodeType === ParseNodeType.ImportFrom) {
            if (node.parent.module.leadingDots === 0 && node.parent.module.nameParts.length === 1) {
                if (node.parent.module.nameParts[0].value === 'typing') {
                    isImportFromTyping = true;
                }
            }
        }

        const type = this._evaluator.getType(node.alias ?? node.name);
        this._reportDeprecatedUseForType(node.name, type, isImportFromTyping);

        return false;
    }

    override visitModuleName(node: ModuleNameNode): boolean {
        if (this._fileInfo.isStubFile) {
            return false;
        }

        const importResult = AnalyzerNodeInfo.getImportInfo(node);
        assert(importResult !== undefined);

        this._addMissingModuleSourceDiagnosticIfNeeded(importResult, node);
        return false;
    }

    override visitTypeParameterList(node: TypeParameterListNode): boolean {
        this._typeParameterLists.push(node);
        return true;
    }

    override visitTypeParameter(node: TypeParameterNode): boolean {
        // Verify that there are no live type variables with the same
        // name in outer scopes.
        let curNode: ParseNode | undefined = node.parent?.parent?.parent;
        let foundDuplicate = false;

        while (curNode) {
            const typeVarScopeNode = ParseTreeUtils.getTypeVarScopeNode(curNode);
            if (!typeVarScopeNode) {
                break;
            }

            if (typeVarScopeNode.nodeType === ParseNodeType.Class) {
                const classType = this._evaluator.getTypeOfClass(typeVarScopeNode)?.classType;

                if (classType?.details.typeParameters.some((param) => param.details.name === node.name.value)) {
                    foundDuplicate = true;
                    break;
                }
            } else if (typeVarScopeNode.nodeType === ParseNodeType.Function) {
                const functionType = this._evaluator.getTypeOfFunction(typeVarScopeNode)?.functionType;

                if (functionType?.details.typeParameters.some((param) => param.details.name === node.name.value)) {
                    foundDuplicate = true;
                    break;
                }
            }

            curNode = typeVarScopeNode.parent;
        }

        if (foundDuplicate) {
            this._evaluator.addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.typeVarUsedByOuterScope().format({ name: node.name.value }),
                node.name
            );
        }

        return false;
    }

    override visitTypeAlias(node: TypeAliasNode): boolean {
        const scope = getScopeForNode(node);
        if (scope) {
            if (scope.type !== ScopeType.Class && scope.type !== ScopeType.Module && scope.type !== ScopeType.Builtin) {
                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportGeneralTypeIssues,
                    LocMessage.typeAliasStatementBadScope(),
                    node.name
                );
            }
        }

        return true;
    }

    override visitTypeAnnotation(node: TypeAnnotationNode): boolean {
        this._evaluator.getType(node.typeAnnotation);
        return true;
    }

    override visitMatch(node: MatchNode): boolean {
        this._evaluator.getType(node.subjectExpression);
        this._validateExhaustiveMatch(node);
        return true;
    }

    override visitCase(node: CaseNode): boolean {
        if (node.guardExpression) {
            this._validateConditionalIsBool(node.guardExpression);
        }

        this._evaluator.evaluateTypesForStatement(node.pattern);
        return true;
    }

    override visitPatternClass(node: PatternClassNode): boolean {
        validateClassPattern(this._evaluator, node);
        return true;
    }

    override visitTry(node: TryNode): boolean {
        this._reportUnusedExceptStatements(node);
        return true;
    }

    override visitError(node: ErrorNode) {
        // Get the type of the child so it's available to
        // the completion provider.
        if (node.child) {
            this._evaluator.getType(node.child);
        }

        // Don't explore further.
        return false;
    }

    private _getImportResult(node: ImportFromAsNode, uri: Uri) {
        const execEnv = this._importResolver.getConfigOptions().findExecEnvironment(uri);
        const moduleNameNode = (node.parent as ImportFromNode).module;

        // Handle both absolute and relative imports.
        const moduleName =
            moduleNameNode.leadingDots === 0
                ? this._importResolver.getModuleNameForImport(uri, execEnv).moduleName
                : getRelativeModuleName(
                      this._importResolver.fileSystem,
                      this._fileInfo.fileUri,
                      uri,
                      this._importResolver.getConfigOptions()
                  );

        if (!moduleName) {
            return undefined;
        }

        return this._importResolver.resolveImport(
            this._fileInfo.fileUri,
            execEnv,
            createImportedModuleDescriptor(moduleName)
        );
    }

    private _addMissingModuleSourceDiagnosticIfNeeded(importResult: ImportResult, node: ParseNode) {
        if (
            importResult.isNativeLib ||
            !importResult.isStubFile ||
            importResult.importType === ImportType.BuiltIn ||
            !importResult.nonStubImportResult ||
            importResult.nonStubImportResult.isImportFound
        ) {
            return;
        }

        // Type stub found, but source is missing.
        this._evaluator.addDiagnostic(
            DiagnosticRule.reportMissingModuleSource,
            LocMessage.importSourceResolveFailure().format({
                importName: importResult.importName,
                venv: this._fileInfo.executionEnvironment.name,
            }),
            node
        );
    }

    private _validateConditionalIsBool(node: ExpressionNode) {
        const operandType = this._evaluator.getType(node);
        if (!operandType) {
            return;
        }

        let isTypeBool = true;
        const diag = new DiagnosticAddendum();
        this._evaluator.mapSubtypesExpandTypeVars(operandType, /* options */ undefined, (expandedSubtype) => {
            if (isAnyOrUnknown(expandedSubtype)) {
                return undefined;
            }

            // If it's a bool (the common case), we're good.
            if (isClassInstance(expandedSubtype) && ClassType.isBuiltIn(expandedSubtype, 'bool')) {
                return undefined;
            }

            // Invoke the __bool__ method on the type.
            const boolReturnType = this._evaluator.getTypeOfMagicMethodCall(
                expandedSubtype,
                '__bool__',
                [],
                node,
                /* inferenceContext */ undefined
            );

            if (!boolReturnType || isAnyOrUnknown(boolReturnType)) {
                return undefined;
            }

            if (isClassInstance(boolReturnType) && ClassType.isBuiltIn(boolReturnType, 'bool')) {
                return undefined;
            }

            // All other types are problematic.
            isTypeBool = false;

            diag.addMessage(
                LocAddendum.conditionalRequiresBool().format({
                    operandType: this._evaluator.printType(expandedSubtype),
                    boolReturnType: this._evaluator.printType(boolReturnType),
                })
            );

            return undefined;
        });

        if (!isTypeBool) {
            this._evaluator.addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.conditionalOperandInvalid().format({
                    type: this._evaluator.printType(operandType),
                }) + diag.getString(),
                node
            );
        }
    }

    private _reportUnnecessaryConditionExpression(expression: ExpressionNode) {
        if (expression.nodeType === ParseNodeType.BinaryOperation) {
            if (expression.operator === OperatorType.And || expression.operator === OperatorType.Or) {
                this._reportUnnecessaryConditionExpression(expression.leftExpression);
                this._reportUnnecessaryConditionExpression(expression.rightExpression);
            }

            return;
        } else if (expression.nodeType === ParseNodeType.UnaryOperation) {
            if (expression.operator === OperatorType.Not) {
                this._reportUnnecessaryConditionExpression(expression.expression);
            }

            return;
        }

        const exprTypeResult = this._evaluator.getTypeOfExpression(expression);
        let isExprFunction = true;
        let isCoroutine = true;

        doForEachSubtype(exprTypeResult.type, (subtype) => {
            subtype = this._evaluator.makeTopLevelTypeVarsConcrete(subtype);

            if (!isFunction(subtype) && !isOverloadedFunction(subtype)) {
                isExprFunction = false;
            }

            if (!isClassInstance(subtype) || !ClassType.isBuiltIn(subtype, 'Coroutine')) {
                isCoroutine = false;
            }
        });

        if (isExprFunction) {
            this._evaluator.addDiagnostic(
                DiagnosticRule.reportUnnecessaryComparison,
                LocMessage.functionInConditionalExpression(),
                expression
            );
        }

        if (isCoroutine) {
            this._evaluator.addDiagnostic(
                DiagnosticRule.reportUnnecessaryComparison,
                LocMessage.coroutineInConditionalExpression(),
                expression
            );
        }
    }

    private _reportUnusedExpression(node: ParseNode) {
        if (this._fileInfo.diagnosticRuleSet.reportUnusedExpression === 'none') {
            return;
        }

        const simpleExpressionTypes = [
            ParseNodeType.UnaryOperation,
            ParseNodeType.BinaryOperation,
            ParseNodeType.Number,
            ParseNodeType.Constant,
            ParseNodeType.Name,
            ParseNodeType.Tuple,
        ];

        let reportAsUnused = false;

        if (simpleExpressionTypes.some((nodeType) => nodeType === node.nodeType)) {
            reportAsUnused = true;
        } else if (
            node.nodeType === ParseNodeType.List ||
            node.nodeType === ParseNodeType.Set ||
            node.nodeType === ParseNodeType.Dictionary
        ) {
            // Exclude comprehensions.
            if (!node.entries.some((entry) => entry.nodeType === ParseNodeType.ListComprehension)) {
                reportAsUnused = true;
            }
        }

        if (
            reportAsUnused &&
            this._fileInfo.ipythonMode === IPythonMode.CellDocs &&
            node.parent?.nodeType === ParseNodeType.StatementList &&
            node.parent.statements[node.parent.statements.length - 1] === node &&
            node.parent.parent?.nodeType === ParseNodeType.Module &&
            node.parent.parent.statements[node.parent.parent.statements.length - 1] === node.parent
        ) {
            // Exclude an expression at the end of a notebook cell, as that is treated as
            // the cell's value.
            reportAsUnused = false;
        }

        if (reportAsUnused) {
            this._evaluator.addDiagnostic(DiagnosticRule.reportUnusedExpression, LocMessage.unusedExpression(), node);
        }
    }

    private _validateExhaustiveMatch(node: MatchNode) {
        // This check can be expensive, so skip it if it's disabled.
        if (this._fileInfo.diagnosticRuleSet.reportMatchNotExhaustive === 'none') {
            return;
        }

        const narrowedTypeResult = this._evaluator.evaluateTypeForSubnode(node, () => {
            this._evaluator.evaluateTypesForMatchStatement(node);
        });

        if (narrowedTypeResult && !isNever(narrowedTypeResult.type)) {
            const diagAddendum = new DiagnosticAddendum();
            diagAddendum.addMessage(
                LocAddendum.matchIsNotExhaustiveType().format({
                    type: this._evaluator.printType(narrowedTypeResult.type),
                })
            );
            diagAddendum.addMessage(LocAddendum.matchIsNotExhaustiveHint());

            this._evaluator.addDiagnostic(
                DiagnosticRule.reportMatchNotExhaustive,
                LocMessage.matchIsNotExhaustive() + diagAddendum.getString(),
                node.subjectExpression
            );
        }
    }

    private _suppressUnboundCheck(callback: () => void) {
        const wasSuppressed = this._isUnboundCheckSuppressed;
        this._isUnboundCheckSuppressed = true;

        try {
            callback();
        } finally {
            this._isUnboundCheckSuppressed = wasSuppressed;
        }
    }

    private _validateIllegalDefaultParamInitializer(node: ParseNode) {
        if (this._fileInfo.diagnosticRuleSet.reportCallInDefaultInitializer !== 'none') {
            if (ParseTreeUtils.isWithinDefaultParamInitializer(node) && !this._fileInfo.isStubFile) {
                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportCallInDefaultInitializer,
                    LocMessage.defaultValueContainsCall(),
                    node
                );
            }
        }
    }

    private _validateStandardCollectionInstantiation(node: CallNode) {
        const leftType = this._evaluator.getType(node.leftExpression);

        if (
            leftType &&
            isInstantiableClass(leftType) &&
            ClassType.isBuiltIn(leftType) &&
            !leftType.includeSubclasses &&
            leftType.aliasName
        ) {
            const nonInstantiable = ['List', 'Set', 'Dict', 'Tuple'];

            if (nonInstantiable.some((name) => name === leftType.aliasName)) {
                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportGeneralTypeIssues,
                    LocMessage.collectionAliasInstantiation().format({
                        type: leftType.aliasName,
                        alias: leftType.details.name,
                    }),
                    node.leftExpression
                );
            }
        }
    }

    private _validateContainmentTypes(node: BinaryOperationNode) {
        const leftType = this._evaluator.getType(node.leftExpression);
        const containerType = this._evaluator.getType(node.rightExpression);

        if (!leftType || !containerType) {
            return;
        }

        if (isNever(leftType) || isNever(containerType)) {
            return;
        }

        // Use the common narrowing logic for containment.
        const elementType = getElementTypeForContainerNarrowing(containerType);
        if (!elementType) {
            return;
        }
        const narrowedType = narrowTypeForContainerElementType(
            this._evaluator,
            leftType,
            this._evaluator.makeTopLevelTypeVarsConcrete(elementType)
        );

        if (isNever(narrowedType)) {
            const getMessage = () => {
                return node.operator === OperatorType.In
                    ? LocMessage.containmentAlwaysFalse()
                    : LocMessage.containmentAlwaysTrue();
            };

            this._evaluator.addDiagnostic(
                DiagnosticRule.reportUnnecessaryContains,
                getMessage().format({
                    leftType: this._evaluator.printType(leftType, { expandTypeAlias: true }),
                    rightType: this._evaluator.printType(elementType, { expandTypeAlias: true }),
                }),
                node
            );
        }
    }

    // Determines whether the types of the two operands for an "is" or "is not"
    // operation have overlapping types.
    private _validateComparisonTypesForIsOperator(node: BinaryOperationNode) {
        const rightType = this._evaluator.getType(node.rightExpression);

        if (!rightType || !isNoneInstance(rightType)) {
            return;
        }

        const leftType = this._evaluator.getType(node.leftExpression);
        if (!leftType) {
            return;
        }

        let foundMatchForNone = false;
        doForEachSubtype(leftType, (subtype) => {
            subtype = this._evaluator.makeTopLevelTypeVarsConcrete(subtype);

            if (this._evaluator.assignType(subtype, this._evaluator.getNoneType())) {
                foundMatchForNone = true;
            }
        });

        const getMessage = () => {
            return node.operator === OperatorType.Is
                ? LocMessage.comparisonAlwaysFalse()
                : LocMessage.comparisonAlwaysTrue();
        };

        if (!foundMatchForNone) {
            this._evaluator.addDiagnostic(
                DiagnosticRule.reportUnnecessaryComparison,
                getMessage().format({
                    leftType: this._evaluator.printType(leftType, { expandTypeAlias: true }),
                    rightType: this._evaluator.printType(rightType),
                }),
                node
            );
        }
    }

    // Determines whether the types of the two operands for an == or != operation
    // have overlapping types.
    private _validateComparisonTypes(node: BinaryOperationNode) {
        let rightExpression = node.rightExpression;

        // Check for chained comparisons.
        if (
            rightExpression.nodeType === ParseNodeType.BinaryOperation &&
            !rightExpression.parenthesized &&
            ParseTreeUtils.operatorSupportsChaining(rightExpression.operator)
        ) {
            // Use the left side of the right expression for comparison purposes.
            rightExpression = rightExpression.leftExpression;
        }

        const leftType = this._evaluator.getType(node.leftExpression);
        const rightType = this._evaluator.getType(rightExpression);

        if (!leftType || !rightType) {
            return;
        }

        if (isNever(leftType) || isNever(rightType)) {
            return;
        }

        const getMessage = () => {
            return node.operator === OperatorType.Equals
                ? LocMessage.comparisonAlwaysFalse()
                : LocMessage.comparisonAlwaysTrue();
        };

        // Check for the special case where the LHS and RHS are both literals.
        if (isLiteralTypeOrUnion(rightType) && isLiteralTypeOrUnion(leftType)) {
            if (
                evaluateStaticBoolExpression(
                    node,
                    this._fileInfo.executionEnvironment,
                    this._fileInfo.definedConstants
                ) === undefined
            ) {
                let isPossiblyTrue = false;

                doForEachSubtype(leftType, (leftSubtype) => {
                    if (this._evaluator.assignType(rightType, leftSubtype)) {
                        isPossiblyTrue = true;
                    }
                });

                if (!isPossiblyTrue) {
                    this._evaluator.addDiagnostic(
                        DiagnosticRule.reportUnnecessaryComparison,
                        getMessage().format({
                            leftType: this._evaluator.printType(leftType, { expandTypeAlias: true }),
                            rightType: this._evaluator.printType(rightType, { expandTypeAlias: true }),
                        }),
                        node
                    );
                }
            }
        } else {
            let isComparable = false;

            doForEachSubtype(leftType, (leftSubtype) => {
                if (isComparable) {
                    return;
                }

                leftSubtype = this._evaluator.makeTopLevelTypeVarsConcrete(leftSubtype);
                doForEachSubtype(rightType, (rightSubtype) => {
                    if (isComparable) {
                        return;
                    }

                    rightSubtype = this._evaluator.makeTopLevelTypeVarsConcrete(rightSubtype);

                    if (this._isTypeComparable(leftSubtype, rightSubtype)) {
                        isComparable = true;
                    }
                });
            });

            if (!isComparable) {
                const leftTypeText = this._evaluator.printType(leftType, { expandTypeAlias: true });
                const rightTypeText = this._evaluator.printType(rightType, { expandTypeAlias: true });

                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportUnnecessaryComparison,
                    getMessage().format({
                        leftType: leftTypeText,
                        rightType: rightTypeText,
                    }),
                    node
                );
            }
        }
    }

    // Determines whether the two types are potentially comparable -- i.e.
    // their types overlap in such a way that it makes sense for them to
    // be compared with an == or != operator.
    private _isTypeComparable(leftType: Type, rightType: Type) {
        if (isAnyOrUnknown(leftType) || isAnyOrUnknown(rightType)) {
            return true;
        }

        if (isNever(leftType) || isNever(rightType)) {
            return false;
        }

        if (isModule(leftType) || isModule(rightType)) {
            return isTypeSame(leftType, rightType);
        }

        if (isNoneInstance(leftType) || isNoneInstance(rightType)) {
            return isTypeSame(leftType, rightType);
        }

        const isLeftCallable = isFunction(leftType) || isOverloadedFunction(leftType);
        const isRightCallable = isFunction(rightType) || isOverloadedFunction(rightType);
        if (isLeftCallable !== isRightCallable) {
            return false;
        }

        if (isInstantiableClass(leftType) || (isClassInstance(leftType) && ClassType.isBuiltIn(leftType, 'type'))) {
            if (
                isInstantiableClass(rightType) ||
                (isClassInstance(rightType) && ClassType.isBuiltIn(rightType, 'type'))
            ) {
                const genericLeftType = ClassType.cloneForSpecialization(
                    leftType,
                    /* typeArguments */ undefined,
                    /* isTypeArgumentExplicit */ false
                );
                const genericRightType = ClassType.cloneForSpecialization(
                    rightType,
                    /* typeArguments */ undefined,
                    /* isTypeArgumentExplicit */ false
                );

                if (
                    this._evaluator.assignType(genericLeftType, genericRightType) ||
                    this._evaluator.assignType(genericRightType, genericLeftType)
                ) {
                    return true;
                }
            }

            // Does the class have an operator overload for eq?
            const metaclass = leftType.details.effectiveMetaclass;
            if (metaclass && isClass(metaclass)) {
                if (lookUpClassMember(metaclass, '__eq__', MemberAccessFlags.SkipObjectBaseClass)) {
                    return true;
                }
            }

            return false;
        }

        if (isClassInstance(leftType)) {
            if (isClassInstance(rightType)) {
                const genericLeftType = ClassType.cloneForSpecialization(
                    leftType,
                    /* typeArguments */ undefined,
                    /* isTypeArgumentExplicit */ false
                );
                const genericRightType = ClassType.cloneForSpecialization(
                    rightType,
                    /* typeArguments */ undefined,
                    /* isTypeArgumentExplicit */ false
                );

                if (
                    this._evaluator.assignType(genericLeftType, genericRightType) ||
                    this._evaluator.assignType(genericRightType, genericLeftType)
                ) {
                    return true;
                }

                // Assume that if the types are disjoint and built-in classes that they
                // will never be comparable.
                if (ClassType.isBuiltIn(leftType) && ClassType.isBuiltIn(rightType)) {
                    return false;
                }
            }

            // Does the class have an operator overload for eq?
            const eqMethod = lookUpClassMember(
                ClassType.cloneAsInstantiable(leftType),
                '__eq__',
                MemberAccessFlags.SkipObjectBaseClass
            );

            if (eqMethod) {
                // If this is a synthesized method for a dataclass, we can assume
                // that other dataclass types will not be comparable.
                if (ClassType.isDataClass(leftType) && eqMethod.symbol.getSynthesizedType()) {
                    return false;
                }

                return true;
            }

            return false;
        }

        return true;
    }

    // If the function is a generator, validates that its annotated return type
    // is appropriate for a generator.
    private _validateGeneratorReturnType(node: FunctionNode, functionType: FunctionType) {
        if (!FunctionType.isGenerator(functionType)) {
            return;
        }

        const declaredReturnType = functionType.details.declaredReturnType;
        if (!declaredReturnType) {
            return;
        }

        if (isNever(declaredReturnType)) {
            return;
        }

        const functionDecl = functionType.details.declaration;
        if (!functionDecl || !functionDecl.yieldStatements || functionDecl.yieldStatements.length === 0) {
            return;
        }

        let generatorType: Type | undefined;
        if (
            !node.isAsync &&
            isClassInstance(declaredReturnType) &&
            ClassType.isBuiltIn(declaredReturnType, 'AwaitableGenerator')
        ) {
            // Handle the old-style (pre-await) generator case
            // if the return type explicitly uses AwaitableGenerator.
            generatorType = this._evaluator.getTypingType(node, 'AwaitableGenerator');
        } else {
            generatorType = this._evaluator.getTypingType(node, node.isAsync ? 'AsyncGenerator' : 'Generator');
        }

        if (!generatorType || !isInstantiableClass(generatorType)) {
            return;
        }

        const specializedGenerator = ClassType.cloneAsInstance(
            ClassType.cloneForSpecialization(
                generatorType,
                [AnyType.create(), AnyType.create(), AnyType.create()],
                /* isTypeArgumentExplicit */ true
            )
        );

        const diagAddendum = new DiagnosticAddendum();
        if (!this._evaluator.assignType(declaredReturnType, specializedGenerator, diagAddendum)) {
            const errorMessage = node.isAsync
                ? LocMessage.generatorAsyncReturnType()
                : LocMessage.generatorSyncReturnType();

            this._evaluator.addDiagnostic(
                DiagnosticRule.reportInvalidTypeForm,
                errorMessage.format({ yieldType: this._evaluator.printType(AnyType.create()) }) +
                    diagAddendum.getString(),
                node.returnTypeAnnotation ?? node.name
            );
        }
    }

    // Determines whether the specified type is one that should trigger
    // an "unused" value diagnostic.
    private _isTypeValidForUnusedValueTest(type: Type) {
        return !isNoneInstance(type) && !isNever(type) && !isAnyOrUnknown(type);
    }

    // Verifies that each local type variable is used more than once.
    private _validateFunctionTypeVarUsage(node: FunctionNode, functionTypeResult: FunctionTypeResult) {
        // Skip this check entirely if it's disabled.
        if (this._fileInfo.diagnosticRuleSet.reportInvalidTypeVarUse === 'none') {
            return;
        }

        const type = functionTypeResult.functionType;
        const localTypeVarUsage = new Map<string, TypeVarUsageInfo>();
        const classTypeVarUsage = new Map<string, TypeVarUsageInfo>();
        let exemptBoundTypeVar = true;
        let curParamNode: ParameterNode | undefined;

        // Is this a constructor (an __init__ method) for a generic class?
        let constructorClass: ClassType | undefined;
        if (FunctionType.isInstanceMethod(type) && node.name.value === '__init__') {
            const containingClassNode = ParseTreeUtils.getEnclosingClassOrFunction(node);
            if (containingClassNode && containingClassNode.nodeType === ParseNodeType.Class) {
                const classType = this._evaluator.getTypeOfClass(containingClassNode);
                if (classType && isClass(classType.classType)) {
                    constructorClass = classType.classType;
                }
            }
        }

        const nameWalker = new ParseTreeUtils.NameNodeWalker((nameNode, subscriptIndex, baseExpression) => {
            const nameType = this._evaluator.getType(nameNode);
            ``;
            if (nameType && isTypeVar(nameType) && !nameType.details.isSynthesizedSelf) {
                // Does this name refer to a TypeVar that is scoped to this function?
                if (nameType.scopeId === ParseTreeUtils.getScopeIdForNode(node)) {
                    // We exempt constrained TypeVars, TypeVars that are type arguments of
                    // other types, and ParamSpecs. There are legitimate uses for singleton
                    // instances in these particular cases.
                    let isExempt =
                        nameType.details.constraints.length > 0 ||
                        nameType.details.isDefaultExplicit ||
                        (exemptBoundTypeVar && subscriptIndex !== undefined) ||
                        isParamSpec(nameType);

                    if (!isExempt && baseExpression && subscriptIndex !== undefined) {
                        // Is this a type argument for a generic type alias? If so,
                        // exempt it from the check because the type alias may repeat
                        // the TypeVar multiple times.
                        const baseType = this._evaluator.getType(baseExpression);
                        if (
                            baseType?.typeAliasInfo &&
                            baseType.typeAliasInfo.typeParameters &&
                            subscriptIndex < baseType.typeAliasInfo.typeParameters.length
                        ) {
                            isExempt = true;
                        }
                    }

                    const existingEntry = localTypeVarUsage.get(nameType.details.name);
                    const isParamTypeWithEllipsisUsage =
                        curParamNode?.defaultValue?.nodeType === ParseNodeType.Ellipsis;

                    if (!existingEntry) {
                        localTypeVarUsage.set(nameType.details.name, {
                            nodes: [nameNode],
                            typeVar: nameType,
                            paramTypeUsageCount: curParamNode !== undefined ? 1 : 0,
                            paramTypeWithEllipsisUsageCount: isParamTypeWithEllipsisUsage ? 1 : 0,
                            returnTypeUsageCount: curParamNode === undefined ? 1 : 0,
                            paramWithEllipsis: isParamTypeWithEllipsisUsage ? curParamNode?.name?.value : undefined,
                            isExempt,
                        });
                    } else {
                        existingEntry.nodes.push(nameNode);
                        if (curParamNode !== undefined) {
                            existingEntry.paramTypeUsageCount += 1;
                            if (isParamTypeWithEllipsisUsage) {
                                existingEntry.paramTypeWithEllipsisUsageCount += 1;
                                if (!existingEntry.paramWithEllipsis) {
                                    existingEntry.paramWithEllipsis = curParamNode?.name?.value;
                                }
                            }
                        } else {
                            existingEntry.returnTypeUsageCount += 1;
                        }
                    }
                }

                // Does this name refer to a TypeVar that is scoped to the class associated with
                // this constructor method?
                if (constructorClass && nameType.scopeId === constructorClass.details.typeVarScopeId) {
                    const existingEntry = classTypeVarUsage.get(nameType.details.name);
                    const isParamTypeWithEllipsisUsage =
                        curParamNode?.defaultValue?.nodeType === ParseNodeType.Ellipsis;
                    const isExempt = !!nameType.details.isDefaultExplicit;

                    if (!existingEntry) {
                        classTypeVarUsage.set(nameType.details.name, {
                            typeVar: nameType,
                            nodes: [nameNode],
                            paramTypeUsageCount: curParamNode !== undefined ? 1 : 0,
                            paramTypeWithEllipsisUsageCount: isParamTypeWithEllipsisUsage ? 1 : 0,
                            returnTypeUsageCount: 0,
                            paramWithEllipsis: isParamTypeWithEllipsisUsage ? curParamNode?.name?.value : undefined,
                            isExempt,
                        });
                    } else {
                        existingEntry.nodes.push(nameNode);
                        if (curParamNode !== undefined) {
                            existingEntry.paramTypeUsageCount += 1;
                            if (isParamTypeWithEllipsisUsage) {
                                existingEntry.paramTypeWithEllipsisUsageCount += 1;
                                if (!existingEntry.paramWithEllipsis) {
                                    existingEntry.paramWithEllipsis = curParamNode?.name?.value;
                                }
                            }
                        }
                    }
                }
            }
        });

        // Find all of the local type variables in signature.
        node.parameters.forEach((param) => {
            const annotation = param.typeAnnotation || param.typeAnnotationComment;
            if (annotation) {
                curParamNode = param;
                nameWalker.walk(annotation);
            }
        });
        curParamNode = undefined;

        if (node.returnTypeAnnotation) {
            // Don't exempt the use of a bound TypeVar when used as a type argument
            // within a return type. This exemption applies only to input parameter
            // annotations.
            exemptBoundTypeVar = false;
            nameWalker.walk(node.returnTypeAnnotation);
        }

        if (node.functionAnnotationComment) {
            node.functionAnnotationComment.paramTypeAnnotations.forEach((expr) => {
                nameWalker.walk(expr);
            });

            if (node.functionAnnotationComment.returnTypeAnnotation) {
                exemptBoundTypeVar = false;
                nameWalker.walk(node.functionAnnotationComment.returnTypeAnnotation);
            }
        }

        localTypeVarUsage.forEach((usage) => {
            // Report error for local type variable that appears only once.
            if (usage.nodes.length === 1 && !usage.isExempt) {
                let altTypeText: string;

                if (usage.typeVar.details.isVariadic) {
                    altTypeText = '"tuple[object, ...]"';
                } else if (usage.typeVar.details.boundType) {
                    altTypeText = `"${this._evaluator.printType(convertToInstance(usage.typeVar.details.boundType))}"`;
                } else {
                    altTypeText = '"object"';
                }

                const diag = new DiagnosticAddendum();
                diag.addMessage(
                    LocAddendum.typeVarUnnecessarySuggestion().format({
                        type: altTypeText,
                    })
                );

                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportInvalidTypeVarUse,
                    LocMessage.typeVarUsedOnlyOnce().format({
                        name: usage.nodes[0].value,
                    }) + diag.getString(),
                    usage.nodes[0]
                );
            }

            // Report error for local type variable that appears in return type
            // (but not as a top-level TypeVar within a union) and appears only
            // within parameters that have default values. These may go unsolved.
            let isUsedInReturnType = usage.returnTypeUsageCount > 0;
            if (usage.returnTypeUsageCount === 1 && type.details.declaredReturnType) {
                // If the TypeVar appears only once in the return type and it's a top-level
                // TypeVar within a union, exempt it from this check. Although these
                // TypeVars may go unsolved, they can be safely eliminated from the union
                // without generating an Unknown type.
                const returnType = type.details.declaredReturnType;
                if (
                    isUnion(returnType) &&
                    returnType.subtypes.some(
                        (subtype) => isTypeVar(subtype) && subtype.details.name === usage.nodes[0].value
                    )
                ) {
                    isUsedInReturnType = false;
                }
            }

            // Skip this check if the function is overloaded because the TypeVar
            // will be solved in terms of the overload signatures.
            const skipUnsolvableTypeVarCheck =
                isOverloadedFunction(functionTypeResult.decoratedType) &&
                !FunctionType.isOverloaded(functionTypeResult.functionType);

            if (
                isUsedInReturnType &&
                usage.paramTypeWithEllipsisUsageCount > 0 &&
                usage.paramTypeUsageCount === usage.paramTypeWithEllipsisUsageCount &&
                !skipUnsolvableTypeVarCheck
            ) {
                const diag = new DiagnosticAddendum();
                diag.addMessage(LocAddendum.typeVarUnsolvableRemedy());

                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportInvalidTypeVarUse,
                    LocMessage.typeVarPossiblyUnsolvable().format({
                        name: usage.nodes[0].value,
                        param: usage.paramWithEllipsis ?? '',
                    }) + diag.getString(),
                    usage.nodes[0]
                );
            }
        });

        // Report error for a class type variable that appears only within
        // constructor parameters that have default values. These may go unsolved.
        classTypeVarUsage.forEach((usage) => {
            if (
                usage.paramTypeWithEllipsisUsageCount > 0 &&
                usage.paramTypeUsageCount === usage.paramTypeWithEllipsisUsageCount &&
                !usage.isExempt
            ) {
                const diag = new DiagnosticAddendum();
                diag.addMessage(LocAddendum.typeVarUnsolvableRemedy());

                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportInvalidTypeVarUse,
                    LocMessage.typeVarPossiblyUnsolvable().format({
                        name: usage.nodes[0].value,
                        param: usage.paramWithEllipsis ?? '',
                    }) + diag.getString(),
                    usage.nodes[0]
                );
            }
        });
    }

    // Validates that overloads use @staticmethod and @classmethod consistently.
    private _validateOverloadAttributeConsistency(node: FunctionNode, functionType: OverloadedFunctionType) {
        let staticMethodCount = 0;
        let classMethodCount = 0;

        functionType.overloads.forEach((overload) => {
            if (FunctionType.isStaticMethod(overload)) {
                staticMethodCount++;
            }

            if (FunctionType.isClassMethod(overload)) {
                classMethodCount++;
            }
        });

        if (staticMethodCount > 0 && staticMethodCount < functionType.overloads.length) {
            this._evaluator.addDiagnostic(
                DiagnosticRule.reportInconsistentOverload,
                LocMessage.overloadStaticMethodInconsistent().format({
                    name: node.name.value,
                }),
                functionType.overloads[0]?.details.declaration?.node.name ?? node.name
            );
        }

        if (classMethodCount > 0 && classMethodCount < functionType.overloads.length) {
            this._evaluator.addDiagnostic(
                DiagnosticRule.reportInconsistentOverload,
                LocMessage.overloadClassMethodInconsistent().format({
                    name: node.name.value,
                }),
                functionType.overloads[0]?.details.declaration?.node.name ?? node.name
            );
        }
    }

    // Validates that overloads do not overlap with inconsistent return results.
    private _validateOverloadConsistency(
        node: FunctionNode,
        functionType: FunctionType,
        prevOverloads: FunctionType[]
    ) {
        for (let i = 0; i < prevOverloads.length; i++) {
            const prevOverload = prevOverloads[i];
            if (this._isOverlappingOverload(functionType, prevOverload, /* partialOverlap */ false)) {
                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportOverlappingOverload,
                    LocMessage.overlappingOverload().format({
                        name: node.name.value,
                        obscured: prevOverloads.length + 1,
                        obscuredBy: i + 1,
                    }),
                    node.name
                );
                break;
            }
        }

        for (let i = 0; i < prevOverloads.length; i++) {
            const prevOverload = prevOverloads[i];
            if (this._isOverlappingOverload(prevOverload, functionType, /* partialOverlap */ true)) {
                const prevReturnType = FunctionType.getSpecializedReturnType(prevOverload);
                const returnType = FunctionType.getSpecializedReturnType(functionType);

                if (
                    prevReturnType &&
                    returnType &&
                    !this._evaluator.assignType(
                        returnType,
                        prevReturnType,
                        /* diag */ undefined,
                        new TypeVarContext(),
                        /* srcTypeVarContext */ undefined,
                        AssignTypeFlags.SkipSolveTypeVars | AssignTypeFlags.IgnoreTypeVarScope
                    )
                ) {
                    const altNode = this._findNodeForOverload(node, prevOverload);
                    this._evaluator.addDiagnostic(
                        DiagnosticRule.reportOverlappingOverload,
                        LocMessage.overloadReturnTypeMismatch().format({
                            name: node.name.value,
                            newIndex: prevOverloads.length + 1,
                            prevIndex: i + 1,
                        }),
                        (altNode || node).name
                    );
                    break;
                }
            }
        }
    }

    // Mypy reports overlapping overload errors on the line that contains the
    // earlier overload. Typeshed stubs contain type: ignore comments on these
    // lines, so it is important for us to report them in the same manner.
    private _findNodeForOverload(functionNode: FunctionNode, overloadType: FunctionType): FunctionNode | undefined {
        const decls = this._evaluator.getDeclarationsForNameNode(functionNode.name);
        if (!decls) {
            return undefined;
        }

        for (const decl of decls) {
            if (decl.type === DeclarationType.Function) {
                const functionType = this._evaluator.getTypeOfFunction(decl.node);
                if (functionType?.functionType === overloadType) {
                    return decl.node;
                }
            }
        }

        return undefined;
    }

    private _isOverlappingOverload(functionType: FunctionType, prevOverload: FunctionType, partialOverlap: boolean) {
        // According to precedent, the __get__ method is special-cased and is
        // exempt from overlapping overload checks. It's not clear why this is
        // the case, but for consistency with other type checkers, we'll honor
        // this rule. See https://github.com/python/typing/issues/253#issuecomment-389262904
        // for details.
        if (FunctionType.isInstanceMethod(functionType) && functionType.details.name === '__get__') {
            return false;
        }

        let flags = AssignTypeFlags.SkipFunctionReturnTypeCheck | AssignTypeFlags.OverloadOverlapCheck;
        if (partialOverlap) {
            flags |= AssignTypeFlags.PartialOverloadOverlapCheck;
        }

        return this._evaluator.assignType(
            functionType,
            prevOverload,
            /* diag */ undefined,
            new TypeVarContext(getTypeVarScopeId(functionType)),
            /* srcTypeVarContext */ undefined,
            flags
        );
    }

    private _isLegalOverloadImplementation(
        overload: FunctionType,
        implementation: FunctionType,
        diag: DiagnosticAddendum | undefined
    ): boolean {
        const implTypeVarContext = new TypeVarContext(getTypeVarScopeId(implementation));
        const overloadTypeVarContext = new TypeVarContext(getTypeVarScopeId(overload));

        // First check the parameters to see if they are assignable.
        let isLegal = this._evaluator.assignType(
            overload,
            implementation,
            diag,
            overloadTypeVarContext,
            implTypeVarContext,
            AssignTypeFlags.SkipFunctionReturnTypeCheck |
                AssignTypeFlags.ReverseTypeVarMatching |
                AssignTypeFlags.SkipSelfClsTypeCheck
        );

        // Now check the return types.
        const overloadReturnType =
            overload.details.declaredReturnType ?? this._evaluator.getFunctionInferredReturnType(overload);
        const implementationReturnType = applySolvedTypeVars(
            implementation.details.declaredReturnType || this._evaluator.getFunctionInferredReturnType(implementation),
            implTypeVarContext
        );

        const returnDiag = new DiagnosticAddendum();
        if (
            !isNever(overloadReturnType) &&
            !this._evaluator.assignType(
                implementationReturnType,
                overloadReturnType,
                returnDiag.createAddendum(),
                implTypeVarContext,
                overloadTypeVarContext,
                AssignTypeFlags.SkipSolveTypeVars
            )
        ) {
            returnDiag.addMessage(
                LocAddendum.functionReturnTypeMismatch().format({
                    sourceType: this._evaluator.printType(overloadReturnType),
                    destType: this._evaluator.printType(implementationReturnType),
                })
            );
            diag?.addAddendum(returnDiag);
            isLegal = false;
        }

        return isLegal;
    }

    private _walkStatementsAndReportUnreachable(statements: StatementNode[]) {
        let reportedUnreachable = false;
        let prevStatement: StatementNode | undefined;

        for (const statement of statements) {
            // No need to report unreachable more than once since the first time
            // covers all remaining statements in the statement list.
            if (!reportedUnreachable) {
                if (!this._evaluator.isNodeReachable(statement, prevStatement)) {
                    // Create a text range that covers the next statement through
                    // the end of the statement list.
                    const start = statement.start;
                    const lastStatement = statements[statements.length - 1];
                    const end = TextRange.getEnd(lastStatement);
                    this._evaluator.addUnreachableCode(statement, { start, length: end - start });

                    reportedUnreachable = true;
                }
            }

            if (!reportedUnreachable && this._fileInfo.isStubFile) {
                this._validateStubStatement(statement);
            }

            this.walk(statement);

            prevStatement = statement;
        }
    }

    private _validateStubStatement(statement: StatementNode) {
        switch (statement.nodeType) {
            case ParseNodeType.If:
            case ParseNodeType.Function:
            case ParseNodeType.Class:
            case ParseNodeType.Error: {
                // These are allowed in a stub file.
                break;
            }

            case ParseNodeType.While:
            case ParseNodeType.For:
            case ParseNodeType.Try:
            case ParseNodeType.With: {
                // These are not allowed.
                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportInvalidStubStatement,
                    LocMessage.invalidStubStatement(),
                    statement
                );
                break;
            }

            case ParseNodeType.StatementList: {
                for (const substatement of statement.statements) {
                    let isValid = true;

                    switch (substatement.nodeType) {
                        case ParseNodeType.Assert:
                        case ParseNodeType.AssignmentExpression:
                        case ParseNodeType.Await:
                        case ParseNodeType.BinaryOperation:
                        case ParseNodeType.Constant:
                        case ParseNodeType.Del:
                        case ParseNodeType.Dictionary:
                        case ParseNodeType.Index:
                        case ParseNodeType.For:
                        case ParseNodeType.FormatString:
                        case ParseNodeType.Global:
                        case ParseNodeType.Lambda:
                        case ParseNodeType.List:
                        case ParseNodeType.MemberAccess:
                        case ParseNodeType.Name:
                        case ParseNodeType.Nonlocal:
                        case ParseNodeType.Number:
                        case ParseNodeType.Raise:
                        case ParseNodeType.Return:
                        case ParseNodeType.Set:
                        case ParseNodeType.Slice:
                        case ParseNodeType.Ternary:
                        case ParseNodeType.Tuple:
                        case ParseNodeType.Try:
                        case ParseNodeType.UnaryOperation:
                        case ParseNodeType.Unpack:
                        case ParseNodeType.While:
                        case ParseNodeType.With:
                        case ParseNodeType.WithItem:
                        case ParseNodeType.Yield:
                        case ParseNodeType.YieldFrom: {
                            isValid = false;
                            break;
                        }

                        case ParseNodeType.AugmentedAssignment: {
                            // Exempt __all__ manipulations.
                            isValid =
                                substatement.operator === OperatorType.AddEqual &&
                                substatement.leftExpression.nodeType === ParseNodeType.Name &&
                                substatement.leftExpression.value === '__all__';
                            break;
                        }

                        case ParseNodeType.Call: {
                            // Exempt __all__ manipulations.
                            isValid =
                                substatement.leftExpression.nodeType === ParseNodeType.MemberAccess &&
                                substatement.leftExpression.leftExpression.nodeType === ParseNodeType.Name &&
                                substatement.leftExpression.leftExpression.value === '__all__';
                            break;
                        }
                    }

                    if (!isValid) {
                        this._evaluator.addDiagnostic(
                            DiagnosticRule.reportInvalidStubStatement,
                            LocMessage.invalidStubStatement(),
                            substatement
                        );
                    }
                }
            }
        }
    }

    private _validateExceptionTypeRecursive(
        exceptionType: Type,
        diag: DiagnosticAddendum,
        baseExceptionType: Type | undefined,
        allowTuple: boolean
    ) {
        const derivesFromBaseException = (classType: ClassType) => {
            if (!baseExceptionType || !isInstantiableClass(baseExceptionType)) {
                return true;
            }

            return derivesFromClassRecursive(classType, baseExceptionType, /* ignoreUnknown */ false);
        };

        doForEachSubtype(exceptionType, (exceptionSubtype) => {
            if (isAnyOrUnknown(exceptionSubtype)) {
                return;
            }

            if (isClass(exceptionSubtype)) {
                if (TypeBase.isInstantiable(exceptionSubtype)) {
                    if (!derivesFromBaseException(exceptionSubtype)) {
                        diag.addMessage(
                            LocMessage.exceptionTypeIncorrect().format({
                                type: this._evaluator.printType(exceptionSubtype),
                            })
                        );
                    }
                    return;
                }

                if (allowTuple && exceptionSubtype.tupleTypeArguments) {
                    exceptionSubtype.tupleTypeArguments.forEach((typeArg) => {
                        this._validateExceptionTypeRecursive(
                            typeArg.type,
                            diag,
                            baseExceptionType,
                            /* allowTuple */ false
                        );
                    });
                    return;
                }

                diag.addMessage(
                    LocMessage.exceptionTypeIncorrect().format({
                        type: this._evaluator.printType(exceptionSubtype),
                    })
                );
            }
        });
    }

    private _validateExceptionType(exceptionType: Type, errorNode: ExpressionNode): void {
        const baseExceptionType = this._evaluator.getBuiltInType(errorNode, 'BaseException');
        const diagAddendum = new DiagnosticAddendum();

        this._validateExceptionTypeRecursive(exceptionType, diagAddendum, baseExceptionType, /* allowTuple */ true);

        if (!diagAddendum.isEmpty()) {
            this._evaluator.addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.exceptionTypeNotClass().format({
                    type: this._evaluator.printType(exceptionType),
                }),
                errorNode
            );
        }
    }

    private _reportUnusedDunderAllSymbols(nodes: StringNode[]) {
        // If this rule is disabled, don't bother doing the work.
        if (this._fileInfo.diagnosticRuleSet.reportUnsupportedDunderAll === 'none') {
            return;
        }

        const moduleScope = AnalyzerNodeInfo.getScope(this._moduleNode);
        if (!moduleScope) {
            return;
        }

        nodes.forEach((node) => {
            if (!moduleScope.symbolTable.has(node.value)) {
                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportUnsupportedDunderAll,
                    LocMessage.dunderAllSymbolNotPresent().format({ name: node.value }),
                    node
                );
            }
        });
    }

    private _validateSymbolTables() {
        const dependentFileInfo = this._dependentFiles?.map((p) => AnalyzerNodeInfo.getFileInfo(p.parseTree));
        for (const scopedNode of this._scopedNodes) {
            const scope = AnalyzerNodeInfo.getScope(scopedNode);

            if (scope) {
                scope.symbolTable.forEach((symbol, name) => {
                    this._conditionallyReportUnusedSymbol(name, symbol, scope.type, dependentFileInfo);

                    this._reportIncompatibleDeclarations(name, symbol);

                    this._reportMultipleFinalDeclarations(name, symbol, scope.type);

                    this._reportMultipleTypeAliasDeclarations(name, symbol);

                    this._reportInvalidOverload(name, symbol);
                });
            }
        }

        // Report unaccessed type parameters.
        const accessedSymbolSet = this._fileInfo.accessedSymbolSet;
        for (const paramList of this._typeParameterLists) {
            const typeParamScope = AnalyzerNodeInfo.getScope(paramList);

            for (const param of paramList.parameters) {
                const symbol = typeParamScope?.symbolTable.get(param.name.value);
                if (!symbol) {
                    // This can happen if the code is unreachable.
                    return;
                }

                if (!accessedSymbolSet.has(symbol.id)) {
                    const decls = symbol.getDeclarations();
                    decls.forEach((decl) => {
                        this._conditionallyReportUnusedDeclaration(decl, /* isPrivate */ false);
                    });
                }
            }
        }
    }

    private _reportInvalidOverload(name: string, symbol: Symbol) {
        const typedDecls = symbol.getTypedDeclarations();
        if (typedDecls.length >= 1) {
            const primaryDecl = typedDecls[0];

            if (primaryDecl.type === DeclarationType.Function) {
                const type = this._evaluator.getEffectiveTypeOfSymbol(symbol);
                const overloadedFunctions = isOverloadedFunction(type)
                    ? OverloadedFunctionType.getOverloads(type)
                    : isFunction(type) && FunctionType.isOverloaded(type)
                    ? [type]
                    : [];

                if (overloadedFunctions.length === 1) {
                    // There should never be a single overload.
                    this._evaluator.addDiagnostic(
                        DiagnosticRule.reportInconsistentOverload,
                        LocMessage.singleOverload().format({ name }),
                        primaryDecl.node.name
                    );
                }

                // If the file is not a stub and this is the first overload,
                // verify that there is an implementation.
                if (!this._fileInfo.isStubFile && overloadedFunctions.length > 0) {
                    let implementationFunction: FunctionType | undefined;
                    let exemptMissingImplementation = false;

                    if (isOverloadedFunction(type)) {
                        implementationFunction = OverloadedFunctionType.getImplementation(type);

                        // If the implementation has no name, it was synthesized probably by a
                        // decorator that used a callable with a ParamSpec that captured the
                        // overloaded signature. We'll exempt it from this check.
                        const overloads = OverloadedFunctionType.getOverloads(type);
                        if (overloads.length > 0 && overloads[0].details.name === '') {
                            exemptMissingImplementation = true;
                        }
                    } else if (isFunction(type) && !FunctionType.isOverloaded(type)) {
                        implementationFunction = type;
                    }

                    if (!implementationFunction) {
                        const containingClassNode = ParseTreeUtils.getEnclosingClassOrFunction(primaryDecl.node);
                        if (containingClassNode && containingClassNode.nodeType === ParseNodeType.Class) {
                            const classType = this._evaluator.getTypeOfClass(containingClassNode);
                            if (classType) {
                                if (ClassType.isProtocolClass(classType.classType)) {
                                    exemptMissingImplementation = true;
                                } else if (ClassType.supportsAbstractMethods(classType.classType)) {
                                    if (
                                        isOverloadedFunction(type) &&
                                        OverloadedFunctionType.getOverloads(type).every((overload) =>
                                            FunctionType.isAbstractMethod(overload)
                                        )
                                    ) {
                                        exemptMissingImplementation = true;
                                    }
                                }
                            }
                        }

                        // If this is a method within a protocol class, don't require that
                        // there is an implementation.
                        if (!exemptMissingImplementation) {
                            this._evaluator.addDiagnostic(
                                DiagnosticRule.reportNoOverloadImplementation,
                                LocMessage.overloadWithoutImplementation().format({
                                    name: primaryDecl.node.name.value,
                                }),
                                primaryDecl.node.name
                            );
                        }
                    } else if (isOverloadedFunction(type)) {
                        // Verify that all overload signatures are assignable to implementation signature.
                        OverloadedFunctionType.getOverloads(type).forEach((overload, index) => {
                            const diag = new DiagnosticAddendum();
                            if (!this._isLegalOverloadImplementation(overload, implementationFunction!, diag)) {
                                if (implementationFunction!.details.declaration) {
                                    const diagnostic = this._evaluator.addDiagnostic(
                                        DiagnosticRule.reportInconsistentOverload,
                                        LocMessage.overloadImplementationMismatch().format({
                                            name,
                                            index: index + 1,
                                        }) + diag.getString(),
                                        implementationFunction!.details.declaration.node.name
                                    );

                                    if (diagnostic && overload.details.declaration) {
                                        diagnostic.addRelatedInfo(
                                            LocAddendum.overloadSignature(),
                                            overload.details.declaration?.uri ?? primaryDecl.uri,
                                            overload.details.declaration?.range ?? primaryDecl.range
                                        );
                                    }
                                }
                            }
                        });
                    }
                }
            }
        }
    }

    private _reportMultipleFinalDeclarations(name: string, symbol: Symbol, scopeType: ScopeType) {
        if (!this._evaluator.isFinalVariable(symbol)) {
            return;
        }

        const decls = symbol.getDeclarations();
        let sawFinal = false;
        let sawAssignment = false;

        decls.forEach((decl) => {
            if (this._evaluator.isFinalVariableDeclaration(decl)) {
                if (sawFinal) {
                    this._evaluator.addDiagnostic(
                        DiagnosticRule.reportGeneralTypeIssues,
                        LocMessage.finalRedeclaration().format({ name }),
                        decl.node
                    );
                }
                sawFinal = true;
            }

            let reportRedeclaration = false;

            if (decl.type === DeclarationType.Variable) {
                if (decl.inferredTypeSource) {
                    if (sawAssignment) {
                        let exemptAssignment = false;

                        if (scopeType === ScopeType.Class) {
                            // We check for assignment of Final instance and class variables
                            // in the type evaluator because we need to take into account whether
                            // the assignment is within an `__init__` method, so ignore class
                            // scopes here.
                            const classOrFunc = ParseTreeUtils.getEnclosingClassOrFunction(decl.node);
                            if (classOrFunc?.nodeType === ParseNodeType.Function) {
                                exemptAssignment = true;
                            }
                        }

                        if (!exemptAssignment) {
                            reportRedeclaration = true;
                        }
                    }
                    sawAssignment = true;
                }
            } else {
                reportRedeclaration = true;
            }

            if (reportRedeclaration) {
                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportGeneralTypeIssues,
                    LocMessage.finalReassigned().format({ name }),
                    getNameNodeForDeclaration(decl) ?? decl.node
                );
            }
        });

        // If it's not a stub file, an assignment must be provided.
        if (!sawAssignment && !this._fileInfo.isStubFile) {
            const firstDecl = decls.find((decl) => decl.type === DeclarationType.Variable && decl.isFinal);
            if (firstDecl) {
                // Is this an instance variable declared within a dataclass? If so, it
                // is implicitly initialized by the synthesized `__init__` method and
                // therefore has an implied assignment.
                let isImplicitlyAssigned = false;

                // Is this a class variable within a protocol class? If so, it can
                // be marked final without providing a value.
                let isProtocolClass = false;

                if (symbol.isClassMember() && !symbol.isClassVar()) {
                    const containingClass = ParseTreeUtils.getEnclosingClass(firstDecl.node, /* stopAtFunction */ true);

                    if (containingClass) {
                        const classType = this._evaluator.getTypeOfClass(containingClass);
                        if (classType && isClass(classType.decoratedType)) {
                            if (ClassType.isDataClass(classType.decoratedType)) {
                                isImplicitlyAssigned = true;
                            }

                            if (ClassType.isProtocolClass(classType.decoratedType)) {
                                isProtocolClass = true;
                            }
                        }
                    }
                }

                if (!isImplicitlyAssigned && !isProtocolClass) {
                    this._evaluator.addDiagnostic(
                        DiagnosticRule.reportGeneralTypeIssues,
                        LocMessage.finalUnassigned().format({ name }),
                        firstDecl.node
                    );
                }
            }
        }
    }

    private _reportMultipleTypeAliasDeclarations(name: string, symbol: Symbol) {
        const decls = symbol.getDeclarations();
        const typeAliasDecl = decls.find((decl) => this._evaluator.isExplicitTypeAliasDeclaration(decl));

        // If this is a type alias, there should be only one declaration.
        if (typeAliasDecl && decls.length > 1) {
            decls.forEach((decl) => {
                if (decl !== typeAliasDecl) {
                    this._evaluator.addDiagnostic(
                        DiagnosticRule.reportRedeclaration,
                        LocMessage.typeAliasRedeclared().format({ name }),
                        decl.node
                    );
                }
            });
        }
    }

    private _reportIncompatibleDeclarations(name: string, symbol: Symbol) {
        // If there's one or more declaration with a declared type,
        // all other declarations should match. The only exception is
        // for functions that have an overload.
        const primaryDecl = getLastTypedDeclarationForSymbol(symbol);

        // If there's no declaration with a declared type, we're done.
        if (!primaryDecl) {
            return;
        }

        // Special case the '_' symbol, which is used in single dispatch
        // code and other cases where the name does not matter.
        if (name === '_') {
            return;
        }

        let otherDecls = symbol.getDeclarations().filter((decl) => decl !== primaryDecl);

        // If it's a function, we can skip any other declarations
        // that are overloads or property setters/deleters.
        if (primaryDecl.type === DeclarationType.Function) {
            const primaryDeclTypeInfo = this._evaluator.getTypeOfFunction(primaryDecl.node);

            otherDecls = otherDecls.filter((decl) => {
                if (decl.type !== DeclarationType.Function) {
                    return true;
                }

                const funcTypeInfo = this._evaluator.getTypeOfFunction(decl.node);
                if (!funcTypeInfo) {
                    return true;
                }

                const decoratedType = primaryDeclTypeInfo
                    ? this._evaluator.makeTopLevelTypeVarsConcrete(primaryDeclTypeInfo.decoratedType)
                    : undefined;

                // We need to handle properties in a careful manner because of
                // the way that setters and deleters are often defined using multiple
                // methods with the same name.
                if (
                    decoratedType &&
                    isClassInstance(decoratedType) &&
                    ClassType.isPropertyClass(decoratedType) &&
                    isClassInstance(funcTypeInfo.decoratedType) &&
                    ClassType.isPropertyClass(funcTypeInfo.decoratedType)
                ) {
                    return funcTypeInfo.decoratedType.details.typeSourceId !== decoratedType.details.typeSourceId;
                }

                return !FunctionType.isOverloaded(funcTypeInfo.functionType);
            });
        }

        // If there are no other declarations to consider, we're done.
        if (otherDecls.length === 0) {
            return;
        }

        let primaryDeclInfo: string;
        if (primaryDecl.type === DeclarationType.Function) {
            if (primaryDecl.isMethod) {
                primaryDeclInfo = LocAddendum.seeMethodDeclaration();
            } else {
                primaryDeclInfo = LocAddendum.seeFunctionDeclaration();
            }
        } else if (primaryDecl.type === DeclarationType.Class) {
            primaryDeclInfo = LocAddendum.seeClassDeclaration();
        } else if (primaryDecl.type === DeclarationType.Parameter) {
            primaryDeclInfo = LocAddendum.seeParameterDeclaration();
        } else if (primaryDecl.type === DeclarationType.Variable) {
            primaryDeclInfo = LocAddendum.seeVariableDeclaration();
        } else if (primaryDecl.type === DeclarationType.TypeAlias) {
            primaryDeclInfo = LocAddendum.seeTypeAliasDeclaration();
        } else {
            primaryDeclInfo = LocAddendum.seeDeclaration();
        }

        const addPrimaryDeclInfo = (diag?: Diagnostic) => {
            if (diag) {
                let primaryDeclNode: ParseNode | undefined;
                if (primaryDecl.type === DeclarationType.Function || primaryDecl.type === DeclarationType.Class) {
                    primaryDeclNode = primaryDecl.node.name;
                } else if (primaryDecl.type === DeclarationType.Variable) {
                    if (primaryDecl.node.nodeType === ParseNodeType.Name) {
                        primaryDeclNode = primaryDecl.node;
                    }
                } else if (
                    primaryDecl.type === DeclarationType.Parameter ||
                    primaryDecl.type === DeclarationType.TypeParameter
                ) {
                    if (primaryDecl.node.name) {
                        primaryDeclNode = primaryDecl.node.name;
                    }
                }

                if (primaryDeclNode) {
                    diag.addRelatedInfo(primaryDeclInfo, primaryDecl.uri, primaryDecl.range);
                }
            }
        };

        for (const otherDecl of otherDecls) {
            if (otherDecl.type === DeclarationType.Class) {
                let duplicateIsOk = false;

                if (primaryDecl.type === DeclarationType.TypeParameter) {
                    // The error will be reported elsewhere if a type parameter is
                    // involved, so don't report it here.
                    duplicateIsOk = true;
                }

                if (!duplicateIsOk) {
                    const diag = this._evaluator.addDiagnostic(
                        DiagnosticRule.reportRedeclaration,
                        LocMessage.obscuredClassDeclaration().format({ name }),
                        otherDecl.node.name
                    );
                    addPrimaryDeclInfo(diag);
                }
            } else if (otherDecl.type === DeclarationType.Function) {
                const primaryType = this._evaluator.getTypeForDeclaration(primaryDecl)?.type;
                let duplicateIsOk = false;

                // If the return type has not yet been inferred, do so now.
                if (primaryType && isFunction(primaryType)) {
                    this._evaluator.getFunctionInferredReturnType(primaryType);
                }

                const otherType = this._evaluator.getTypeForDeclaration(otherDecl)?.type;

                const suite1 = ParseTreeUtils.getEnclosingSuite(primaryDecl.node);
                const suite2 = ParseTreeUtils.getEnclosingSuite(otherDecl.node);

                // Allow same-signature overrides in cases where the declarations
                // are not within the same statement suite (e.g. one in the "if"
                // and another in the "else").
                const isInSameStatementList = suite1 === suite2;

                // If the return type has not yet been inferred, do so now.
                if (otherType && isFunction(otherType)) {
                    this._evaluator.getFunctionInferredReturnType(otherType);
                }

                // If both declarations are functions, it's OK if they
                // both have the same signatures.
                if (!isInSameStatementList && primaryType && otherType && isTypeSame(primaryType, otherType)) {
                    duplicateIsOk = true;
                }

                if (primaryDecl.type === DeclarationType.TypeParameter) {
                    // The error will be reported elsewhere if a type parameter is
                    // involved, so don't report it here.
                    duplicateIsOk = true;
                }

                if (!duplicateIsOk) {
                    const diag = this._evaluator.addDiagnostic(
                        DiagnosticRule.reportRedeclaration,
                        otherDecl.isMethod
                            ? LocMessage.obscuredMethodDeclaration().format({ name })
                            : LocMessage.obscuredFunctionDeclaration().format({ name }),
                        otherDecl.node.name
                    );
                    addPrimaryDeclInfo(diag);
                }
            } else if (otherDecl.type === DeclarationType.Parameter) {
                if (otherDecl.node.name) {
                    let duplicateIsOk = false;

                    if (primaryDecl.type === DeclarationType.TypeParameter) {
                        // The error will be reported elsewhere if a type parameter is
                        // involved, so don't report it here.
                        duplicateIsOk = true;
                    }

                    if (!duplicateIsOk) {
                        const message = LocMessage.obscuredParameterDeclaration();
                        const diag = this._evaluator.addDiagnostic(
                            DiagnosticRule.reportRedeclaration,
                            message.format({ name }),
                            otherDecl.node.name
                        );
                        addPrimaryDeclInfo(diag);
                    }
                }
            } else if (otherDecl.type === DeclarationType.Variable) {
                const primaryType = this._evaluator.getTypeForDeclaration(primaryDecl)?.type;

                if (otherDecl.typeAnnotationNode) {
                    if (otherDecl.node.nodeType === ParseNodeType.Name) {
                        let duplicateIsOk = false;

                        // It's OK if they both have the same declared type.
                        const otherType = this._evaluator.getTypeForDeclaration(otherDecl)?.type;
                        if (primaryType && otherType && isTypeSame(primaryType, otherType)) {
                            duplicateIsOk = true;
                        }

                        if (primaryDecl.type === DeclarationType.TypeParameter) {
                            // The error will be reported elsewhere if a type parameter is
                            // involved, so don't report it here.
                            duplicateIsOk = true;
                        }

                        if (!duplicateIsOk) {
                            const diag = this._evaluator.addDiagnostic(
                                DiagnosticRule.reportRedeclaration,
                                LocMessage.obscuredVariableDeclaration().format({ name }),
                                otherDecl.node
                            );
                            addPrimaryDeclInfo(diag);
                        }
                    }
                }
            } else if (otherDecl.type === DeclarationType.TypeAlias) {
                const diag = this._evaluator.addDiagnostic(
                    DiagnosticRule.reportRedeclaration,
                    LocMessage.obscuredTypeAliasDeclaration().format({ name }),
                    otherDecl.node.name
                );
                addPrimaryDeclInfo(diag);
            }
        }
    }

    private _conditionallyReportUnusedSymbol(
        name: string,
        symbol: Symbol,
        scopeType: ScopeType,
        dependentFileInfo?: AnalyzerFileInfo[]
    ) {
        const accessedSymbolSet = this._fileInfo.accessedSymbolSet;
        if (symbol.isIgnoredForProtocolMatch() || accessedSymbolSet.has(symbol.id)) {
            return;
        }

        // If this file is implicitly imported by other files, we need to make sure the symbol defined in
        // the current file is not accessed from those other files.
        if (dependentFileInfo && dependentFileInfo.some((i) => i.accessedSymbolSet.has(symbol.id))) {
            return;
        }

        // A name of "_" means "I know this symbol isn't used", so
        // don't report it as unused.
        if (name === '_') {
            return;
        }

        if (SymbolNameUtils.isDunderName(name)) {
            return;
        }

        const decls = symbol.getDeclarations();
        decls.forEach((decl) => {
            this._conditionallyReportUnusedDeclaration(decl, this._isSymbolPrivate(name, scopeType));
        });
    }

    private _conditionallyReportUnusedDeclaration(decl: Declaration, isPrivate: boolean) {
        let diagnosticLevel: DiagnosticLevel;
        let nameNode: NameNode | undefined;
        let message: string | undefined;
        let rule: DiagnosticRule | undefined;

        switch (decl.type) {
            case DeclarationType.Alias:
                diagnosticLevel = this._fileInfo.diagnosticRuleSet.reportUnusedImport;
                rule = DiagnosticRule.reportUnusedImport;
                if (decl.node.nodeType === ParseNodeType.ImportAs) {
                    if (decl.node.alias) {
                        // For statements of the form "import x as x", don't mark "x" as unaccessed
                        // because it's assumed to be re-exported.
                        // See https://typing.readthedocs.io/en/latest/source/stubs.html#imports.
                        if (decl.node.alias.value !== decl.moduleName) {
                            nameNode = decl.node.alias;
                        }
                    } else {
                        // Handle multi-part names specially.
                        const nameParts = decl.node.module.nameParts;
                        if (nameParts.length > 0) {
                            const multipartName = nameParts.map((np) => np.value).join('.');
                            let textRange: TextRange = { start: nameParts[0].start, length: nameParts[0].length };
                            textRange = TextRange.extend(textRange, nameParts[nameParts.length - 1]);
                            this._fileInfo.diagnosticSink.addUnusedCodeWithTextRange(
                                LocMessage.unaccessedSymbol().format({ name: multipartName }),
                                textRange,
                                { action: Commands.unusedImport }
                            );

                            this._evaluator.addDiagnosticForTextRange(
                                this._fileInfo,
                                this._fileInfo.diagnosticRuleSet.reportUnusedImport,
                                DiagnosticRule.reportUnusedImport,
                                LocMessage.unaccessedImport().format({ name: multipartName }),
                                textRange
                            );
                            return;
                        }
                    }
                } else if (decl.node.nodeType === ParseNodeType.ImportFromAs) {
                    const importFrom = decl.node.parent as ImportFromNode;

                    // For statements of the form "from y import x as x", don't mark "x" as
                    // unaccessed because it's assumed to be re-exported.
                    const isReexport = decl.node.alias?.value === decl.node.name.value;

                    // If this is a __future__ import, it's OK for the import symbol to be unaccessed.
                    const isFuture =
                        importFrom.module.nameParts.length === 1 &&
                        importFrom.module.nameParts[0].value === '__future__';

                    if (!isReexport && !isFuture) {
                        nameNode = decl.node.alias || decl.node.name;
                    }
                }

                if (nameNode) {
                    message = LocMessage.unaccessedImport().format({ name: nameNode.value });
                }
                break;

            case DeclarationType.TypeAlias:
            case DeclarationType.Variable:
            case DeclarationType.Parameter:
                if (!isPrivate) {
                    return;
                }

                if (this._fileInfo.isStubFile) {
                    // Don't mark variables or parameters as unaccessed in
                    // stub files. It's typical for them to be unaccessed here.
                    return;
                }

                diagnosticLevel = this._fileInfo.diagnosticRuleSet.reportUnusedVariable;

                if (decl.node.nodeType === ParseNodeType.Name) {
                    nameNode = decl.node;

                    // Don't emit a diagnostic if the name starts with an underscore.
                    // This indicates that the variable is unused.
                    if (nameNode.value.startsWith('_')) {
                        diagnosticLevel = 'none';
                    }
                } else if (decl.node.nodeType === ParseNodeType.Parameter) {
                    nameNode = decl.node.name;

                    // Don't emit a diagnostic for unused parameters or type parameters.
                    diagnosticLevel = 'none';
                }

                if (nameNode) {
                    rule = DiagnosticRule.reportUnusedVariable;
                    message = LocMessage.unaccessedVariable().format({ name: nameNode.value });
                }
                break;

            case DeclarationType.Class:
                if (!isPrivate) {
                    return;
                }

                // If a stub is exporting a private type, we'll assume that the author
                // knows what he or she is doing.
                if (this._fileInfo.isStubFile) {
                    return;
                }

                diagnosticLevel = this._fileInfo.diagnosticRuleSet.reportUnusedClass;
                nameNode = decl.node.name;
                rule = DiagnosticRule.reportUnusedClass;
                message = LocMessage.unaccessedClass().format({ name: nameNode.value });
                break;

            case DeclarationType.Function:
                if (!isPrivate) {
                    return;
                }

                // If a stub is exporting a private type, we'll assume that the author
                // knows what he or she is doing.
                if (this._fileInfo.isStubFile) {
                    return;
                }

                diagnosticLevel = this._fileInfo.diagnosticRuleSet.reportUnusedFunction;
                nameNode = decl.node.name;
                rule = DiagnosticRule.reportUnusedFunction;
                message = LocMessage.unaccessedFunction().format({ name: nameNode.value });
                break;

            case DeclarationType.TypeParameter:
                // Never report a diagnostic for an unused TypeParameter.
                diagnosticLevel = 'none';
                nameNode = decl.node.name;
                break;

            case DeclarationType.Intrinsic:
            case DeclarationType.SpecialBuiltInClass:
                return;

            default:
                assertNever(decl);
        }

        const action = rule === DiagnosticRule.reportUnusedImport ? { action: Commands.unusedImport } : undefined;
        if (nameNode) {
            this._fileInfo.diagnosticSink.addUnusedCodeWithTextRange(
                LocMessage.unaccessedSymbol().format({ name: nameNode.value }),
                nameNode,
                action
            );

            if (rule !== undefined && message && diagnosticLevel !== 'none') {
                this._evaluator.addDiagnostic(rule, message, nameNode);
            }
        }
    }

    // Validates that a call to isinstance or issubclass are necessary. This is a
    // common source of programming errors. Also validates that arguments passed
    // to isinstance or issubclass won't generate exceptions.
    private _validateIsInstanceCall(node: CallNode) {
        if (
            node.leftExpression.nodeType !== ParseNodeType.Name ||
            (node.leftExpression.value !== 'isinstance' && node.leftExpression.value !== 'issubclass') ||
            node.arguments.length !== 2
        ) {
            return;
        }

        const callName = node.leftExpression.value;
        const isInstanceCheck = callName === 'isinstance';

        let arg0Type = this._evaluator.getType(node.arguments[0].valueExpression);
        if (!arg0Type) {
            return;
        }
        arg0Type = mapSubtypes(arg0Type, (subtype) => {
            return transformPossibleRecursiveTypeAlias(subtype);
        });

        arg0Type = this._evaluator.expandPromotionTypes(node, arg0Type);

        const arg1Type = this._evaluator.getType(node.arguments[1].valueExpression);
        if (!arg1Type) {
            return;
        }

        let isValidType = true;
        const diag = new DiagnosticAddendum();
        doForEachSubtype(arg1Type, (arg1Subtype) => {
            if (isClassInstance(arg1Subtype) && ClassType.isTupleClass(arg1Subtype) && arg1Subtype.tupleTypeArguments) {
                if (
                    arg1Subtype.tupleTypeArguments.some(
                        (typeArg) => !this._isTypeSupportedTypeForIsInstance(typeArg.type, isInstanceCheck, diag)
                    )
                ) {
                    isValidType = false;
                }
            } else {
                if (!this._isTypeSupportedTypeForIsInstance(arg1Subtype, isInstanceCheck, diag)) {
                    isValidType = false;
                }
            }
        });

        if (!isValidType) {
            this._evaluator.addDiagnostic(
                DiagnosticRule.reportArgumentType,
                isInstanceCheck
                    ? LocMessage.isInstanceInvalidType().format({
                          type: this._evaluator.printType(arg1Type),
                      }) + diag.getString()
                    : LocMessage.isSubclassInvalidType().format({
                          type: this._evaluator.printType(arg1Type),
                      }) + diag.getString(),
                node.arguments[1]
            );
        }

        // If this call is an issubclass, check for the use of a "data protocol",
        // which PEP 544 says cannot be used in issubclass.
        if (!isInstanceCheck) {
            const diag = new DiagnosticAddendum();

            doForEachSubtype(arg1Type, (arg1Subtype) => {
                if (
                    isClassInstance(arg1Subtype) &&
                    ClassType.isTupleClass(arg1Subtype) &&
                    arg1Subtype.tupleTypeArguments
                ) {
                    arg1Subtype.tupleTypeArguments.forEach((typeArg) => {
                        this._validateNotDataProtocol(typeArg.type, diag);
                    });
                } else {
                    this._validateNotDataProtocol(arg1Subtype, diag);
                }
            });

            if (!diag.isEmpty()) {
                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportGeneralTypeIssues,
                    LocMessage.dataProtocolInSubclassCheck(),
                    node.arguments[1]
                );
            }
        }

        // If this call is within an assert statement, we won't check whether
        // it's unnecessary.
        let curNode: ParseNode | undefined = node;
        while (curNode) {
            if (curNode.nodeType === ParseNodeType.Assert) {
                return;
            }
            curNode = curNode.parent;
        }

        // Several built-in classes don't follow the normal class hierarchy
        // rules, so we'll avoid emitting false-positive diagnostics if these
        // are used.
        const nonstandardClassTypes = [
            'FunctionType',
            'LambdaType',
            'BuiltinFunctionType',
            'BuiltinMethodType',
            'type',
            'Type',
        ];

        const classTypeList: ClassType[] = [];
        let arg1IncludesSubclasses = false;

        doForEachSubtype(arg1Type, (arg1Subtype) => {
            if (isClass(arg1Subtype)) {
                if (TypeBase.isInstantiable(arg1Subtype)) {
                    if (arg1Subtype.literalValue === undefined) {
                        classTypeList.push(arg1Subtype);
                        if (
                            ClassType.isBuiltIn(arg1Subtype) &&
                            nonstandardClassTypes.some((name) => name === arg1Subtype.details.name)
                        ) {
                            isValidType = false;
                        }

                        if (arg1Subtype.includeSubclasses) {
                            arg1IncludesSubclasses = true;
                        }
                    }

                    if (arg0Type) {
                        this._validateUnsafeProtocolOverlap(
                            node.arguments[0].valueExpression,
                            convertToInstance(arg1Subtype),
                            isInstanceCheck ? arg0Type : convertToInstance(arg0Type)
                        );
                    }
                } else {
                    // The isinstance and issubclass call supports a variation where the second
                    // parameter is a tuple of classes.
                    if (isTupleClass(arg1Subtype)) {
                        if (arg1Subtype.tupleTypeArguments) {
                            arg1Subtype.tupleTypeArguments.forEach((typeArg) => {
                                if (isInstantiableClass(typeArg.type)) {
                                    classTypeList.push(typeArg.type);

                                    if (typeArg.type.includeSubclasses) {
                                        arg1IncludesSubclasses = true;
                                    }

                                    if (arg0Type) {
                                        this._validateUnsafeProtocolOverlap(
                                            node.arguments[0].valueExpression,
                                            convertToInstance(typeArg.type),
                                            isInstanceCheck ? arg0Type : convertToInstance(arg0Type)
                                        );
                                    }
                                } else {
                                    isValidType = false;
                                }
                            });
                        }
                    } else {
                        if (arg1Subtype.includeSubclasses) {
                            arg1IncludesSubclasses = true;
                        }
                    }

                    if (
                        ClassType.isBuiltIn(arg1Subtype) &&
                        nonstandardClassTypes.some((name) => name === arg1Subtype.details.name)
                    ) {
                        isValidType = false;
                    }
                }
            } else {
                isValidType = false;
            }
        });

        if (!isValidType) {
            return;
        }

        if (derivesFromAnyOrUnknown(arg0Type)) {
            return;
        }

        const finalizeFilteredTypeList = (types: Type[]): Type => {
            return combineTypes(types);
        };

        const filterType = (varType: ClassType): Type[] => {
            const filteredTypes: Type[] = [];

            for (const filterType of classTypeList) {
                const filterIsSuperclass = isIsinstanceFilterSuperclass(
                    this._evaluator,
                    varType,
                    varType,
                    filterType,
                    filterType,
                    isInstanceCheck
                );
                const filterIsSubclass = isIsinstanceFilterSubclass(
                    this._evaluator,
                    varType,
                    filterType,
                    isInstanceCheck
                );

                // Normally, a class should never be both a subclass and a
                // superclass. However, this can happen if one of the classes
                // derives from an unknown type. In this case, we'll add an
                // unknown type into the filtered type list to avoid any
                // false positives.
                const isClassRelationshipIndeterminate =
                    filterIsSuperclass && filterIsSubclass && !ClassType.isSameGenericClass(varType, filterType);

                if (isClassRelationshipIndeterminate) {
                    filteredTypes.push(UnknownType.create());
                } else if (filterIsSuperclass) {
                    // If the variable type is a subclass of the isinstance
                    // filter, we haven't learned anything new about the
                    // variable type.
                    filteredTypes.push(varType);
                } else if (filterIsSubclass) {
                    // If the variable type is a superclass of the isinstance
                    // filter, we can narrow the type to the subclass.
                    filteredTypes.push(filterType);
                }
            }

            if (!isInstanceCheck) {
                return filteredTypes;
            }

            // Make all instantiable classes into instances before returning them.
            return filteredTypes.map((t) => (isInstantiableClass(t) ? ClassType.cloneAsInstance(t) : t));
        };

        let filteredType: Type;
        if (isInstanceCheck && isClassInstance(arg0Type)) {
            const remainingTypes = filterType(ClassType.cloneAsInstantiable(arg0Type));
            filteredType = finalizeFilteredTypeList(remainingTypes);
        } else if (!isInstanceCheck && isInstantiableClass(arg0Type)) {
            const remainingTypes = filterType(arg0Type);
            filteredType = finalizeFilteredTypeList(remainingTypes);
        } else if (isUnion(arg0Type)) {
            let remainingTypes: Type[] = [];
            let foundAnyType = false;

            doForEachSubtype(arg0Type, (subtype) => {
                if (isAnyOrUnknown(subtype)) {
                    foundAnyType = true;
                }

                if (isInstanceCheck && isClassInstance(subtype)) {
                    remainingTypes = remainingTypes.concat(filterType(ClassType.cloneAsInstantiable(subtype)));
                } else if (!isInstanceCheck && isInstantiableClass(subtype)) {
                    remainingTypes = remainingTypes.concat(filterType(subtype));
                }
            });

            filteredType = finalizeFilteredTypeList(remainingTypes);

            // If we found an any or unknown type, all bets are off.
            if (foundAnyType) {
                return;
            }
        } else {
            return;
        }

        const getTestType = () => {
            const objTypeList = classTypeList.map((t) => ClassType.cloneAsInstance(t));
            return combineTypes(objTypeList);
        };

        // If arg1IncludesSubclasses is true, it contains a Type[X] class rather than X. A Type[X]
        // could be a subclass of X, so the "unnecessary isinstance check" may be legit.
        if (!arg1IncludesSubclasses && isTypeSame(filteredType, arg0Type, { ignorePseudoGeneric: true })) {
            this._evaluator.addDiagnostic(
                DiagnosticRule.reportUnnecessaryIsInstance,
                isInstanceCheck
                    ? LocMessage.unnecessaryIsInstanceAlways().format({
                          testType: this._evaluator.printType(arg0Type),
                          classType: this._evaluator.printType(getTestType()),
                      })
                    : LocMessage.unnecessaryIsSubclassAlways().format({
                          testType: this._evaluator.printType(arg0Type),
                          classType: this._evaluator.printType(getTestType()),
                      }),
                node
            );
        }
    }

    private _validateUnsafeProtocolOverlap(errorNode: ExpressionNode, protocol: ClassType, testType: Type) {
        // If this is a protocol class, check for an "unsafe overlap"
        // with the arg0 type.
        if (ClassType.isProtocolClass(protocol)) {
            let isUnsafeOverlap = false;
            const diag = new DiagnosticAddendum();

            doForEachSubtype(testType, (testSubtype) => {
                if (isClassInstance(testSubtype)) {
                    if (isProtocolUnsafeOverlap(this._evaluator, protocol, testSubtype)) {
                        isUnsafeOverlap = true;
                        diag.addMessage(
                            LocAddendum.protocolUnsafeOverlap().format({
                                name: testSubtype.details.name,
                            })
                        );
                    }
                }
            });

            if (isUnsafeOverlap) {
                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportGeneralTypeIssues,
                    LocMessage.protocolUnsafeOverlap().format({
                        name: protocol.details.name,
                    }) + diag.getString(),
                    errorNode
                );
            }
        }
    }

    // Determines whether the specified type is allowed as the second argument
    // to an isinstance or issubclass check.
    private _isTypeSupportedTypeForIsInstance(type: Type, isInstanceCheck: boolean, diag: DiagnosticAddendum) {
        let isSupported = true;

        doForEachSubtype(type, (subtype) => {
            subtype = this._evaluator.makeTopLevelTypeVarsConcrete(subtype);
            subtype = transformPossibleRecursiveTypeAlias(subtype);

            if (subtype.specialForm && ClassType.isBuiltIn(subtype.specialForm, 'TypeAliasType')) {
                diag.addMessage(LocAddendum.typeAliasInstanceCheck());
                isSupported = false;
                return;
            }

            switch (subtype.category) {
                case TypeCategory.Any:
                case TypeCategory.Unknown:
                case TypeCategory.Unbound:
                    break;

                case TypeCategory.Class:
                    if (ClassType.isBuiltIn(subtype, 'TypedDict')) {
                        diag.addMessage(LocAddendum.typedDictNotAllowed());
                        isSupported = false;
                    } else if (ClassType.isBuiltIn(subtype, 'NamedTuple')) {
                        diag.addMessage(LocAddendum.namedTupleNotAllowed());
                        isSupported = false;
                    } else if (isNoneInstance(subtype)) {
                        diag.addMessage(LocAddendum.noneNotAllowed());
                        isSupported = false;
                    } else if (ClassType.isTypedDictClass(subtype)) {
                        diag.addMessage(LocAddendum.typedDictClassNotAllowed());
                        isSupported = false;
                    } else if (subtype.isTypeArgumentExplicit && !subtype.includeSubclasses) {
                        // If it's a class, make sure that it has not been given explicit
                        // type arguments. This will result in a TypeError exception.
                        diag.addMessage(LocAddendum.genericClassNotAllowed());
                        isSupported = false;
                    } else if (
                        ClassType.isProtocolClass(subtype) &&
                        !ClassType.isRuntimeCheckable(subtype) &&
                        !subtype.includeSubclasses
                    ) {
                        // According to PEP 544, protocol classes cannot be used as the right-hand
                        // argument to isinstance or issubclass unless they are annotated as
                        // "runtime checkable".
                        diag.addMessage(LocAddendum.protocolRequiresRuntimeCheckable());
                        isSupported = false;
                    } else if (ClassType.isNewTypeClass(subtype)) {
                        diag.addMessage(LocAddendum.newTypeClassNotAllowed());
                        isSupported = false;
                    } else if (
                        subtype.specialForm &&
                        isInstantiableClass(subtype.specialForm) &&
                        ClassType.isBuiltIn(subtype.specialForm, 'Annotated')
                    ) {
                        diag.addMessage(LocAddendum.annotatedNotAllowed());
                        isSupported = false;
                    }
                    break;

                case TypeCategory.Function:
                    if (!TypeBase.isInstantiable(subtype) || subtype.isCallableWithTypeArgs) {
                        diag.addMessage(LocAddendum.genericClassNotAllowed());
                        isSupported = false;
                    }
                    break;

                case TypeCategory.TypeVar:
                    diag.addMessage(LocAddendum.typeVarNotAllowed());
                    isSupported = false;
                    break;
            }
        });

        return isSupported;
    }

    private _validateNotDataProtocol(type: Type, diag: DiagnosticAddendum) {
        if (isInstantiableClass(type) && ClassType.isProtocolClass(type) && !isMethodOnlyProtocol(type)) {
            diag.addMessage(
                LocAddendum.dataProtocolUnsupported().format({
                    name: type.details.name,
                })
            );
        }
    }

    private _isSymbolPrivate(nameValue: string, scopeType: ScopeType) {
        // All variables within the scope of a function or a list
        // comprehension are considered private.
        if (scopeType === ScopeType.Function || scopeType === ScopeType.ListComprehension) {
            return true;
        }

        // See if the symbol is private.
        if (SymbolNameUtils.isPrivateName(nameValue)) {
            return true;
        }

        if (SymbolNameUtils.isProtectedName(nameValue)) {
            // Protected names outside of a class scope are considered private.
            const isClassScope = scopeType === ScopeType.Class;
            return !isClassScope;
        }

        return false;
    }

    private _reportDeprecatedClassProperty(node: FunctionNode, functionTypeResult: FunctionTypeResult) {
        if (
            !isClassInstance(functionTypeResult.decoratedType) ||
            !ClassType.isClassProperty(functionTypeResult.decoratedType)
        ) {
            return;
        }

        this._reportDeprecatedDiagnostic(node.name, LocMessage.classPropertyDeprecated());
    }

    private _reportDeprecatedUseForMemberAccess(node: NameNode, info: MemberAccessDeprecationInfo) {
        let errorMessage: string | undefined;

        if (info.accessType === 'property') {
            if (info.accessMethod === 'get') {
                errorMessage = LocMessage.deprecatedPropertyGetter().format({ name: node.value });
            } else if (info.accessMethod === 'set') {
                errorMessage = LocMessage.deprecatedPropertySetter().format({ name: node.value });
            } else {
                errorMessage = LocMessage.deprecatedPropertyDeleter().format({ name: node.value });
            }
        } else if (info.accessType === 'descriptor') {
            if (info.accessMethod === 'get') {
                errorMessage = LocMessage.deprecatedDescriptorGetter().format({ name: node.value });
            } else if (info.accessMethod === 'set') {
                errorMessage = LocMessage.deprecatedDescriptorSetter().format({ name: node.value });
            } else {
                errorMessage = LocMessage.deprecatedDescriptorDeleter().format({ name: node.value });
            }
        }

        if (errorMessage) {
            this._reportDeprecatedDiagnostic(node, errorMessage, info.deprecationMessage);
        }
    }

    private _reportDeprecatedUseForType(node: NameNode, type: Type | undefined, isImportFromTyping = false) {
        if (!type) {
            return;
        }

        let errorMessage: string | undefined;
        let deprecatedMessage: string | undefined;

        function getDeprecatedMessageForFunction(functionType: FunctionType): string {
            if (
                functionType.details.declaration &&
                functionType.details.declaration.node.nodeType === ParseNodeType.Function
            ) {
                const containingClass = ParseTreeUtils.getEnclosingClass(
                    functionType.details.declaration.node,
                    /* stopAtFunction */ true
                );

                if (containingClass) {
                    return LocMessage.deprecatedMethod().format({
                        name: functionType.details.name || '<anonymous>',
                        className: containingClass.name.value,
                    });
                }
            }

            return LocMessage.deprecatedFunction().format({
                name: functionType.details.name,
            });
        }

        function getDeprecatedMessageForOverloadedCall(evaluator: TypeEvaluator, type: Type) {
            // Determine if the node is part of a call expression. If so,
            // we can determine which overload(s) were used to satisfy
            // the call expression and determine whether any of them
            // are deprecated.
            let callTypeResult: TypeResult | undefined;

            const callNode = ParseTreeUtils.getCallForName(node);
            if (callNode) {
                callTypeResult = evaluator.getTypeResult(callNode);
            } else {
                const decoratorNode = ParseTreeUtils.getDecoratorForName(node);
                if (decoratorNode) {
                    callTypeResult = evaluator.getTypeResultForDecorator(decoratorNode);
                }
            }

            if (
                callTypeResult &&
                callTypeResult.overloadsUsedForCall &&
                callTypeResult.overloadsUsedForCall.length > 0
            ) {
                callTypeResult.overloadsUsedForCall.forEach((overload) => {
                    if (overload.details.deprecatedMessage !== undefined) {
                        if (node.value === overload.details.name) {
                            deprecatedMessage = overload.details.deprecatedMessage;
                            errorMessage = getDeprecatedMessageForFunction(overload);
                        } else if (isInstantiableClass(type) && overload.details.name === '__init__') {
                            deprecatedMessage = overload.details.deprecatedMessage;
                            errorMessage = LocMessage.deprecatedConstructor().format({
                                name: type.details.name,
                            });
                        } else if (isClassInstance(type) && overload.details.name === '__call__') {
                            deprecatedMessage = overload.details.deprecatedMessage;
                            errorMessage = LocMessage.deprecatedFunction().format({
                                name: node.value,
                            });
                        }
                    }
                });
            }
        }

        doForEachSubtype(type, (subtype) => {
            if (isClass(subtype)) {
                if (
                    !subtype.includeSubclasses &&
                    subtype.details.deprecatedMessage !== undefined &&
                    node.value === subtype.details.name
                ) {
                    deprecatedMessage = subtype.details.deprecatedMessage;
                    errorMessage = LocMessage.deprecatedClass().format({ name: subtype.details.name });
                    return;
                }

                getDeprecatedMessageForOverloadedCall(this._evaluator, subtype);
                return;
            }

            if (isFunction(subtype)) {
                if (subtype.details.deprecatedMessage !== undefined) {
                    if (
                        !subtype.details.name ||
                        subtype.details.name === '__call__' ||
                        node.value === subtype.details.name
                    ) {
                        deprecatedMessage = subtype.details.deprecatedMessage;
                        errorMessage = getDeprecatedMessageForFunction(subtype);
                    }
                }
            } else if (isOverloadedFunction(subtype)) {
                // Determine if the node is part of a call expression. If so,
                // we can determine which overload(s) were used to satisfy
                // the call expression and determine whether any of them
                // are deprecated.
                getDeprecatedMessageForOverloadedCall(this._evaluator, subtype);

                // If there the implementation itself is deprecated, assume it
                // is deprecated even if it's outside of a call expression.
                const overloadImpl = OverloadedFunctionType.getImplementation(subtype);
                if (overloadImpl?.details.deprecatedMessage !== undefined) {
                    if (!overloadImpl.details.name || node.value === overloadImpl.details.name) {
                        deprecatedMessage = overloadImpl.details.deprecatedMessage;
                        errorMessage = getDeprecatedMessageForFunction(overloadImpl);
                    }
                }
            }
        });

        if (errorMessage) {
            this._reportDeprecatedDiagnostic(node, errorMessage, deprecatedMessage);
        }

        if (this._fileInfo.diagnosticRuleSet.deprecateTypingAliases) {
            const deprecatedForm = deprecatedAliases.get(node.value) ?? deprecatedSpecialForms.get(node.value);

            if (deprecatedForm) {
                if (
                    (isInstantiableClass(type) && type.details.fullName === deprecatedForm.fullName) ||
                    type.typeAliasInfo?.fullName === deprecatedForm.fullName
                ) {
                    if (this._fileInfo.executionEnvironment.pythonVersion.isGreaterOrEqualTo(deprecatedForm.version)) {
                        if (!deprecatedForm.typingImportOnly || isImportFromTyping) {
                            if (this._fileInfo.diagnosticRuleSet.reportDeprecated === 'none') {
                                this._evaluator.addDeprecated(
                                    LocMessage.deprecatedType().format({
                                        version: deprecatedForm.version.toString(),
                                        replacement: deprecatedForm.replacementText,
                                    }),
                                    node
                                );
                            } else {
                                this._evaluator.addDiagnostic(
                                    DiagnosticRule.reportDeprecated,
                                    LocMessage.deprecatedType().format({
                                        version: deprecatedForm.version.toString(),
                                        replacement: deprecatedForm.replacementText,
                                    }),
                                    node
                                );
                            }
                        }
                    }
                }
            }
        }
    }

    private _reportDeprecatedDiagnostic(node: ParseNode, diagnosticMessage: string, deprecatedMessage?: string) {
        const diag = new DiagnosticAddendum();
        if (deprecatedMessage) {
            diag.addMessage(deprecatedMessage);
        }

        if (this._fileInfo.diagnosticRuleSet.reportDeprecated === 'none') {
            this._evaluator.addDeprecated(diagnosticMessage + diag.getString(), node);
        } else {
            this._evaluator.addDiagnostic(DiagnosticRule.reportDeprecated, diagnosticMessage + diag.getString(), node);
        }
    }

    private _reportUnboundName(node: NameNode) {
        if (this._fileInfo.diagnosticRuleSet.reportUnboundVariable === 'none') {
            return;
        }

        if (!AnalyzerNodeInfo.isCodeUnreachable(node)) {
            const type = this._evaluator.getType(node);

            if (type) {
                if (isUnbound(type)) {
                    if (this._evaluator.isNodeReachable(node)) {
                        this._evaluator.addDiagnostic(
                            DiagnosticRule.reportUnboundVariable,
                            LocMessage.symbolIsUnbound().format({ name: node.value }),
                            node
                        );
                    }
                } else if (isPossiblyUnbound(type)) {
                    this._evaluator.addDiagnostic(
                        DiagnosticRule.reportPossiblyUnboundVariable,
                        LocMessage.symbolIsPossiblyUnbound().format({ name: node.value }),
                        node
                    );
                }
            }
        }
    }

    private _conditionallyReportShadowedModule() {
        if (this._fileInfo.diagnosticRuleSet.reportShadowedImports === 'none') {
            return;
        }
        // Check the module we're in.
        const moduleName = this._fileInfo.moduleName;
        const desc: ImportedModuleDescriptor = {
            nameParts: moduleName.split('.'),
            leadingDots: 0,
            importedSymbols: new Set<string>(),
        };
        const stdlibPath = this._importResolver.getTypeshedStdLibPath(this._fileInfo.executionEnvironment);
        if (
            stdlibPath &&
            this._importResolver.isStdlibModule(desc, this._fileInfo.executionEnvironment) &&
            this._sourceMapper.isUserCode(this._fileInfo.fileUri)
        ) {
            // This means the user has a module that is overwriting the stdlib module.
            const diag = this._evaluator.addDiagnosticForTextRange(
                this._fileInfo,
                this._fileInfo.diagnosticRuleSet.reportShadowedImports,
                DiagnosticRule.reportShadowedImports,
                LocMessage.stdlibModuleOverridden().format({
                    name: moduleName,
                    path: this._fileInfo.fileUri.toUserVisibleString(),
                }),
                this._moduleNode
            );

            // Add a quick action that renames the file.
            if (diag) {
                const renameAction: RenameShadowedFileAction = {
                    action: ActionKind.RenameShadowedFileAction,
                    oldUri: this._fileInfo.fileUri,
                    newUri: this._sourceMapper.getNextFileName(this._fileInfo.fileUri),
                };
                diag.addAction(renameAction);
            }
        }
    }

    private _conditionallyReportShadowedImport(node: ImportAsNode | ImportFromAsNode | ImportFromNode) {
        if (this._fileInfo.diagnosticRuleSet.reportShadowedImports === 'none') {
            return;
        }

        // Skip this check for relative imports.
        const nodeModule =
            node.nodeType === ParseNodeType.ImportFromAs
                ? node.parent?.nodeType === ParseNodeType.ImportFrom
                    ? node.parent?.module
                    : undefined
                : node.module;
        if (nodeModule?.leadingDots) {
            return;
        }

        // Otherwise use the name to determine if a match for a stdlib module.
        const namePartNodes =
            node.nodeType === ParseNodeType.ImportAs
                ? node.module.nameParts
                : node.nodeType === ParseNodeType.ImportFromAs
                ? [node.name]
                : node.module.nameParts;
        const nameParts = namePartNodes.map((n) => n.value);
        const module: ImportedModuleDescriptor = {
            nameParts,
            leadingDots: 0,
            importedSymbols: new Set<string>(),
        };

        // Make sure the module is a potential stdlib one so we don't spend the time
        // searching for the definition.
        const stdlibPath = this._importResolver.getTypeshedStdLibPath(this._fileInfo.executionEnvironment);
        if (stdlibPath && this._importResolver.isStdlibModule(module, this._fileInfo.executionEnvironment)) {
            // If the definition for this name is in 'user' module, it is overwriting the stdlib module.
            const definitions = DefinitionProvider.getDefinitionsForNode(
                this._sourceMapper,
                this._evaluator,
                namePartNodes[namePartNodes.length - 1],
                namePartNodes[namePartNodes.length - 1].start,
                CancellationToken.None
            );
            const paths = definitions ? definitions.map((d) => d.uri) : [];
            paths.forEach((p) => {
                if (!p.startsWith(stdlibPath) && !isStubFile(p) && this._sourceMapper.isUserCode(p)) {
                    // This means the user has a module that is overwriting the stdlib module.
                    const diag = this._evaluator.addDiagnostic(
                        DiagnosticRule.reportShadowedImports,
                        LocMessage.stdlibModuleOverridden().format({
                            name: nameParts.join('.'),
                            path: p.toUserVisibleString(),
                        }),
                        node
                    );
                    // Add a quick action that renames the file.
                    if (diag) {
                        const renameAction: RenameShadowedFileAction = {
                            action: ActionKind.RenameShadowedFileAction,
                            oldUri: p,
                            newUri: this._sourceMapper.getNextFileName(p),
                        };
                        diag.addAction(renameAction);
                    }
                }
            });
        }
    }

    private _conditionallyReportPrivateUsage(node: NameNode) {
        if (this._fileInfo.diagnosticRuleSet.reportPrivateUsage === 'none') {
            return;
        }

        // Ignore privates in type stubs.
        if (this._fileInfo.isStubFile) {
            return;
        }

        // Ignore privates in named arguments.
        if (node.parent?.nodeType === ParseNodeType.Argument && node.parent.name === node) {
            return;
        }

        const nameValue = node.value;
        const isPrivateName = SymbolNameUtils.isPrivateName(nameValue);
        const isProtectedName = SymbolNameUtils.isProtectedName(nameValue);

        // If it's not a protected or private name, don't bother with
        // any further checks.
        if (!isPrivateName && !isProtectedName) {
            return;
        }

        // Get the declarations for this name node, but filter out
        // any variable declarations that are bound using nonlocal
        // or global explicit bindings.
        const declarations = this._evaluator
            .getDeclarationsForNameNode(node)
            ?.filter((decl) => decl.type !== DeclarationType.Variable || !decl.isExplicitBinding);

        let primaryDeclaration =
            declarations && declarations.length > 0 ? declarations[declarations.length - 1] : undefined;
        if (!primaryDeclaration || primaryDeclaration.node === node) {
            return;
        }

        if (primaryDeclaration.type === DeclarationType.Alias) {
            // If this symbol is an import alias (i.e. it's a local name rather than the
            // original imported name), skip the private check.
            if (primaryDeclaration.usesLocalName) {
                return;
            }

            const resolvedAliasInfo = this._evaluator.resolveAliasDeclarationWithInfo(
                primaryDeclaration,
                /* resolveLocalNames */ true
            );

            if (!resolvedAliasInfo) {
                return;
            }

            primaryDeclaration = resolvedAliasInfo.declaration;

            // If the alias resolved to a stub file or py.typed source file
            // and the declaration is marked "externally visible", it is
            // exempt from private usage checks.
            if (!resolvedAliasInfo.isPrivate) {
                return;
            }
        }

        if (!primaryDeclaration || primaryDeclaration.node === node) {
            return;
        }

        let classNode: ClassNode | undefined;
        if (primaryDeclaration.node) {
            classNode = ParseTreeUtils.getEnclosingClass(primaryDeclaration.node);
        }

        // If this is the name of a class, find the class that contains it rather
        // than constraining the use of the class name within the class itself.
        if (primaryDeclaration.node && primaryDeclaration.node.parent && primaryDeclaration.node.parent === classNode) {
            classNode = ParseTreeUtils.getEnclosingClass(classNode);
        }

        // If it's a class member, check whether it's a legal protected access.
        let isProtectedAccess = false;
        if (classNode) {
            if (isProtectedName) {
                const declClassTypeInfo = this._evaluator.getTypeOfClass(classNode);
                if (declClassTypeInfo && isInstantiableClass(declClassTypeInfo.decoratedType)) {
                    // If it's a member defined in a stub file, we'll assume that it's part
                    // of the public contract even if it's named as though it's private.
                    if (ClassType.isDefinedInStub(declClassTypeInfo.decoratedType)) {
                        return;
                    }

                    // Note that the access is to a protected class member.
                    isProtectedAccess = true;

                    const enclosingClassNode = ParseTreeUtils.getEnclosingClass(node);
                    if (enclosingClassNode) {
                        const enclosingClassTypeInfo = this._evaluator.getTypeOfClass(enclosingClassNode);

                        // If the referencing class is a subclass of the declaring class, it's
                        // allowed to access a protected name.
                        if (enclosingClassTypeInfo && isInstantiableClass(enclosingClassTypeInfo.decoratedType)) {
                            if (
                                derivesFromClassRecursive(
                                    enclosingClassTypeInfo.decoratedType,
                                    declClassTypeInfo.decoratedType,
                                    /* ignoreUnknown */ true
                                )
                            ) {
                                return;
                            }
                        }
                    }
                }
            }
        }

        if (classNode && !ParseTreeUtils.isNodeContainedWithin(node, classNode)) {
            if (isProtectedAccess) {
                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportPrivateUsage,
                    LocMessage.protectedUsedOutsideOfClass().format({ name: nameValue }),
                    node
                );
            } else {
                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportPrivateUsage,
                    LocMessage.privateUsedOutsideOfClass().format({ name: nameValue }),
                    node
                );
            }
        }
    }

    // Validates that an enum class does not attempt to override another
    // enum class that has already defined values.
    private _validateEnumClassOverride(node: ClassNode, classType: ClassType) {
        classType.details.baseClasses.forEach((baseClass, index) => {
            if (isClass(baseClass) && isEnumClassWithMembers(this._evaluator, baseClass)) {
                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportGeneralTypeIssues,
                    LocMessage.enumClassOverride().format({ name: baseClass.details.name }),
                    node.arguments[index]
                );
            }
        });
    }

    // Verifies the rules specified in PEP 589 about TypedDict classes.
    // They cannot have statements other than type annotations, doc
    // strings, and "pass" statements or ellipses.
    private _validateTypedDictClassSuite(suiteNode: SuiteNode) {
        const emitBadStatementError = (node: ParseNode) => {
            this._evaluator.addDiagnostic(DiagnosticRule.reportGeneralTypeIssues, LocMessage.typedDictBadVar(), node);
        };

        suiteNode.statements.forEach((statement) => {
            if (!AnalyzerNodeInfo.isCodeUnreachable(statement)) {
                if (statement.nodeType === ParseNodeType.StatementList) {
                    for (const substatement of statement.statements) {
                        if (
                            substatement.nodeType !== ParseNodeType.TypeAnnotation &&
                            substatement.nodeType !== ParseNodeType.Ellipsis &&
                            substatement.nodeType !== ParseNodeType.StringList &&
                            substatement.nodeType !== ParseNodeType.Pass
                        ) {
                            emitBadStatementError(substatement);
                        }
                    }
                } else {
                    emitBadStatementError(statement);
                }
            }
        });
    }

    private _validateTypeGuardFunction(node: FunctionNode, functionType: FunctionType, isMethod: boolean) {
        const returnType = functionType.details.declaredReturnType;
        if (!returnType) {
            return;
        }

        if (!isClassInstance(returnType) || !returnType.typeArguments || returnType.typeArguments.length < 1) {
            return;
        }

        const isTypeGuard = ClassType.isBuiltIn(returnType, 'TypeGuard');
        const isTypeIs = ClassType.isBuiltIn(returnType, 'TypeIs');

        if (!isTypeGuard && !isTypeIs) {
            return;
        }

        // Make sure there's at least one input parameter provided.
        let paramCount = functionType.details.parameters.length;
        if (isMethod) {
            if (
                FunctionType.isInstanceMethod(functionType) ||
                FunctionType.isConstructorMethod(functionType) ||
                FunctionType.isClassMethod(functionType)
            ) {
                paramCount--;
            }
        }

        if (paramCount < 1) {
            this._evaluator.addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.typeGuardParamCount(),
                node.name
            );
        }

        if (isTypeIs) {
            const typeGuardType = returnType.typeArguments[0];

            // Determine the type of the first parameter.
            const paramIndex = isMethod && !FunctionType.isStaticMethod(functionType) ? 1 : 0;
            if (paramIndex >= functionType.details.parameters.length) {
                return;
            }

            const paramType = FunctionType.getEffectiveParameterType(functionType, paramIndex);

            // Verify that the typeGuardType is a narrower type than the paramType.
            if (!this._evaluator.assignType(paramType, typeGuardType)) {
                const returnAnnotation =
                    node.returnTypeAnnotation || node.functionAnnotationComment?.returnTypeAnnotation;
                if (returnAnnotation) {
                    this._evaluator.addDiagnostic(
                        DiagnosticRule.reportGeneralTypeIssues,
                        LocMessage.typeIsReturnType().format({
                            type: this._evaluator.printType(paramType),
                            returnType: this._evaluator.printType(typeGuardType),
                        }),
                        returnAnnotation
                    );
                }
            }
        }
    }

    private _validateDunderSignatures(node: FunctionNode, functionType: FunctionType, isMethod: boolean) {
        const functionName = functionType.details.name;

        // Is this an '__init__' method? Verify that it returns None.
        if (isMethod && functionName === '__init__') {
            const returnAnnotation = node.returnTypeAnnotation || node.functionAnnotationComment?.returnTypeAnnotation;
            const declaredReturnType = functionType.details.declaredReturnType;

            if (returnAnnotation && declaredReturnType) {
                if (!isNoneInstance(declaredReturnType) && !isNever(declaredReturnType)) {
                    this._evaluator.addDiagnostic(
                        DiagnosticRule.reportGeneralTypeIssues,
                        LocMessage.initMustReturnNone(),
                        returnAnnotation
                    );
                }
            } else {
                const inferredReturnType = this._evaluator.getFunctionInferredReturnType(functionType);
                if (
                    !isNever(inferredReturnType) &&
                    !isNoneInstance(inferredReturnType) &&
                    !isAnyOrUnknown(inferredReturnType)
                ) {
                    this._evaluator.addDiagnostic(
                        DiagnosticRule.reportGeneralTypeIssues,
                        LocMessage.initMustReturnNone(),
                        node.name
                    );
                }
            }
        }
    }

    private _validateFunctionReturn(node: FunctionNode, functionType: FunctionType) {
        // Stub files are allowed not to return an actual value,
        // so skip this if it's a stub file.
        if (this._fileInfo.isStubFile) {
            return;
        }

        const returnAnnotation = node.returnTypeAnnotation || node.functionAnnotationComment?.returnTypeAnnotation;
        if (returnAnnotation) {
            const functionNeverReturns = !this._evaluator.isAfterNodeReachable(node);
            const implicitlyReturnsNone = this._evaluator.isAfterNodeReachable(node.suite);

            let declaredReturnType = functionType.details.declaredReturnType;

            if (declaredReturnType) {
                this._reportUnknownReturnResult(node, declaredReturnType);
                this._validateReturnTypeIsNotContravariant(declaredReturnType, returnAnnotation);
            }

            // Wrap the declared type in a generator type if the function is a generator.
            if (FunctionType.isGenerator(functionType)) {
                declaredReturnType = getDeclaredGeneratorReturnType(functionType);
            }

            // The types of all return statement expressions were already checked
            // against the declared type, but we need to verify the implicit None
            // at the end of the function.
            if (declaredReturnType && !functionNeverReturns && implicitlyReturnsNone) {
                if (isNever(declaredReturnType)) {
                    // If the function consists entirely of "...", assume that it's
                    // an abstract method or a protocol method and don't require that
                    // the return type matches. This check can also be skipped for an overload.
                    if (
                        !ParseTreeUtils.isSuiteEmpty(node.suite) &&
                        !FunctionType.isOverloaded(functionType) &&
                        !FunctionType.isAsync(functionType)
                    ) {
                        this._evaluator.addDiagnostic(
                            DiagnosticRule.reportReturnType,
                            LocMessage.noReturnReturnsNone(),
                            returnAnnotation
                        );
                    }
                } else if (!FunctionType.isAbstractMethod(functionType)) {
                    // Make sure that the function doesn't implicitly return None if the declared
                    // type doesn't allow it. Skip this check for abstract methods.
                    const diagAddendum = new DiagnosticAddendum();

                    // If the declared type isn't compatible with 'None', flag an error.
                    if (!this._evaluator.assignType(declaredReturnType, this._evaluator.getNoneType(), diagAddendum)) {
                        // If the function consists entirely of "...", assume that it's
                        // an abstract method or a protocol method and don't require that
                        // the return type matches. This check can also be skipped for an overload.
                        if (!ParseTreeUtils.isSuiteEmpty(node.suite) && !FunctionType.isOverloaded(functionType)) {
                            this._evaluator.addDiagnostic(
                                DiagnosticRule.reportReturnType,
                                LocMessage.returnMissing().format({
                                    returnType: this._evaluator.printType(declaredReturnType),
                                }) + diagAddendum.getString(),
                                returnAnnotation
                            );
                        }
                    }
                }
            }
        } else {
            const inferredReturnType = this._evaluator.getFunctionInferredReturnType(functionType);
            this._reportUnknownReturnResult(node, inferredReturnType);
            this._validateReturnTypeIsNotContravariant(inferredReturnType, node.name);
        }
    }

    private _validateReturnTypeIsNotContravariant(returnType: Type, errorNode: ExpressionNode) {
        let isContraTypeVar = false;

        doForEachSubtype(returnType, (subtype) => {
            if (
                isTypeVar(subtype) &&
                subtype.details.declaredVariance === Variance.Contravariant &&
                subtype.scopeType === TypeVarScopeType.Class
            ) {
                isContraTypeVar = true;
            }
        });

        if (isContraTypeVar) {
            this._evaluator.addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.returnTypeContravariant(),
                errorNode
            );
        }
    }

    private _reportUnknownReturnResult(node: FunctionNode, returnType: Type) {
        if (isUnknown(returnType)) {
            this._evaluator.addDiagnostic(
                DiagnosticRule.reportUnknownParameterType,
                LocMessage.returnTypeUnknown(),
                node.name
            );
        } else if (isPartlyUnknown(returnType)) {
            this._evaluator.addDiagnostic(
                DiagnosticRule.reportUnknownParameterType,
                LocMessage.returnTypePartiallyUnknown().format({
                    returnType: this._evaluator.printType(returnType, { expandTypeAlias: true }),
                }),
                node.name
            );
        }
    }

    // Validates that any overridden member variables are not marked
    // as Final in parent classes.
    private _validateFinalMemberOverrides(classType: ClassType) {
        ClassType.getSymbolTable(classType).forEach((localSymbol, name) => {
            const parentSymbol = lookUpClassMember(classType, name, MemberAccessFlags.SkipOriginalClass);
            if (parentSymbol && isInstantiableClass(parentSymbol.classType) && !SymbolNameUtils.isPrivateName(name)) {
                // Did the parent class explicitly declare the variable as final?
                if (this._evaluator.isFinalVariable(parentSymbol.symbol)) {
                    const decl = localSymbol.getDeclarations()[0];
                    this._evaluator.addDiagnostic(
                        DiagnosticRule.reportGeneralTypeIssues,
                        LocMessage.finalRedeclarationBySubclass().format({
                            name,
                            className: parentSymbol.classType.details.name,
                        }),
                        decl.node
                    );
                } else if (
                    ClassType.isReadOnlyInstanceVariables(parentSymbol.classType) &&
                    !SymbolNameUtils.isDunderName(name)
                ) {
                    // If the parent class is a named tuple, all instance variables
                    // (other than dundered ones) are implicitly final.
                    const decl = localSymbol.getDeclarations()[0];

                    if (decl.type === DeclarationType.Variable) {
                        this._evaluator.addDiagnostic(
                            DiagnosticRule.reportIncompatibleVariableOverride,
                            LocMessage.namedTupleEntryRedeclared().format({
                                name,
                                className: parentSymbol.classType.details.name,
                            }),
                            decl.node
                        );
                    }
                }
            }
        });
    }

    // Validates that the values associated with enum members are type compatible.
    // Also looks for duplicate values.
    private _validateEnumMembers(classType: ClassType, node: ClassNode) {
        if (!ClassType.isEnumClass(classType) || ClassType.isBuiltIn(classType)) {
            return;
        }

        // Does the "_value_" field have a declared type? If so, we'll enforce it.
        const declaredValueType = getEnumDeclaredValueType(this._evaluator, classType, /* declaredTypesOnly */ true);

        // Is there a custom "__new__" and/or "__init__" method? If so, we'll
        // verify that the signature of these calls is compatible with the values.
        let newMemberTypeResult = getBoundNewMethod(
            this._evaluator,
            node.name,
            classType,
            /* diag */ undefined,
            MemberAccessFlags.SkipObjectBaseClass
        );

        // If this __new__ comes from a built-in class like Enum, we'll ignore it.
        if (newMemberTypeResult?.classType) {
            if (isClass(newMemberTypeResult.classType) && ClassType.isBuiltIn(newMemberTypeResult.classType)) {
                newMemberTypeResult = undefined;
            }
        }

        let initMemberTypeResult = getBoundInitMethod(
            this._evaluator,
            node.name,
            ClassType.cloneAsInstance(classType),
            /* diag */ undefined,
            MemberAccessFlags.SkipObjectBaseClass
        );

        // If this __init__ comes from a built-in class like Enum, we'll ignore it.
        if (initMemberTypeResult?.classType) {
            if (isClass(initMemberTypeResult.classType) && ClassType.isBuiltIn(initMemberTypeResult.classType)) {
                initMemberTypeResult = undefined;
            }
        }

        ClassType.getSymbolTable(classType).forEach((symbol, name) => {
            // Enum members don't have type annotations.
            if (symbol.getTypedDeclarations().length > 0) {
                return;
            }

            const symbolType = transformTypeForEnumMember(this._evaluator, classType, name);

            // Is this symbol a literal instance of the enum class?
            if (
                !symbolType ||
                !isClassInstance(symbolType) ||
                !ClassType.isSameGenericClass(symbolType, classType) ||
                !(symbolType.literalValue instanceof EnumLiteral)
            ) {
                return;
            }

            // Look for a duplicate assignment.
            const decls = symbol.getDeclarations();
            if (decls.length >= 2 && decls[0].type === DeclarationType.Variable) {
                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportGeneralTypeIssues,
                    LocMessage.duplicateEnumMember().format({ name }),
                    decls[1].node
                );

                return;
            }

            if (decls[0].type !== DeclarationType.Variable) {
                return;
            }

            const declNode = decls[0].node;
            const assignedValueType = symbolType.literalValue.itemType;
            const assignmentNode = ParseTreeUtils.getParentNodeOfType<AssignmentNode>(
                declNode,
                ParseNodeType.Assignment
            );
            const errorNode = assignmentNode?.rightExpression ?? declNode;

            // Validate the __new__ and __init__ methods if present.
            if (newMemberTypeResult || initMemberTypeResult) {
                if (!isAnyOrUnknown(assignedValueType)) {
                    // Construct an argument list. If the assigned type is a tuple, we'll
                    // unpack it. Otherwise, only one argument is passed.
                    const argList: FunctionArgument[] = [
                        {
                            argumentCategory:
                                isClassInstance(assignedValueType) && isTupleClass(assignedValueType)
                                    ? ArgumentCategory.UnpackedList
                                    : ArgumentCategory.Simple,
                            typeResult: { type: assignedValueType },
                        },
                    ];

                    if (newMemberTypeResult) {
                        this._evaluator.validateCallArguments(
                            errorNode,
                            argList,
                            newMemberTypeResult,
                            /* typeVarContext */ undefined,
                            /* skipUnknownArgCheck */ undefined,
                            /* inferenceContext */ undefined,
                            /* signatureTracker */ undefined
                        );
                    }

                    if (initMemberTypeResult) {
                        this._evaluator.validateCallArguments(
                            errorNode,
                            argList,
                            initMemberTypeResult,
                            /* typeVarContext */ undefined,
                            /* skipUnknownArgCheck */ undefined,
                            /* inferenceContext */ undefined,
                            /* signatureTracker */ undefined
                        );
                    }
                }
            } else if (declaredValueType) {
                const diag = new DiagnosticAddendum();

                // If the assigned value is already an instance of this enum class, skip this check.
                if (
                    !isClassInstance(assignedValueType) ||
                    !ClassType.isSameGenericClass(assignedValueType, classType)
                ) {
                    if (!this._evaluator.assignType(declaredValueType, assignedValueType, diag)) {
                        this._evaluator.addDiagnostic(
                            DiagnosticRule.reportAssignmentType,
                            LocMessage.typeAssignmentMismatch().format(
                                this._evaluator.printSrcDestTypes(assignedValueType, declaredValueType)
                            ) + diag.getString(),
                            errorNode
                        );
                    }
                }
            }
        });
    }

    // If a class is a dataclass with a `__post_init__` method, verify that its
    // signature is correct.
    private _validateDataClassPostInit(classType: ClassType, errorNode: ClassNode) {
        if (!ClassType.isDataClass(classType)) {
            return;
        }

        const postInitMember = lookUpClassMember(
            classType,
            '__post_init__',
            MemberAccessFlags.SkipBaseClasses | MemberAccessFlags.DeclaredTypesOnly
        );

        // If there's no __post_init__ method, there's nothing to check.
        if (!postInitMember) {
            return;
        }

        // If the class derives from Any, we can't reliably apply the check.
        if (ClassType.derivesFromAnyOrUnknown(classType)) {
            return;
        }

        // Collect the list of init-only variables in the order they were declared.
        const initOnlySymbolMap = new Map<string, Symbol>();
        ClassType.getReverseMro(classType).forEach((mroClass) => {
            if (isClass(mroClass) && ClassType.isDataClass(mroClass)) {
                ClassType.getSymbolTable(mroClass).forEach((symbol, name) => {
                    if (symbol.isInitVar()) {
                        initOnlySymbolMap.set(name, symbol);
                    }
                });
            }
        });

        const postInitType = this._evaluator.getTypeOfMember(postInitMember);
        if (
            !isFunction(postInitType) ||
            !FunctionType.isInstanceMethod(postInitType) ||
            !postInitType.details.declaration
        ) {
            return;
        }

        const paramListDetails = getParameterListDetails(postInitType);
        // If there is an *args or **kwargs parameter or a keyword-only separator,
        // don't bother checking.
        if (
            paramListDetails.argsIndex !== undefined ||
            paramListDetails.kwargsIndex !== undefined ||
            paramListDetails.firstKeywordOnlyIndex !== undefined
        ) {
            return;
        }

        // Verify that the parameter count matches.
        const nonDefaultParams = paramListDetails.params.filter((paramInfo) => !paramInfo.param.hasDefault);

        // We expect to see one param for "self" plus one for each of the InitVars.
        const expectedParamCount = initOnlySymbolMap.size + 1;

        if (expectedParamCount < nonDefaultParams.length || expectedParamCount > paramListDetails.params.length) {
            this._evaluator.addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.dataClassPostInitParamCount().format({ expected: initOnlySymbolMap.size }),
                postInitType.details.declaration.node.name
            );
        }

        // Verify that the parameter types match.
        let paramIndex = 1;

        initOnlySymbolMap.forEach((symbol, fieldName) => {
            if (paramIndex >= paramListDetails.params.length) {
                return;
            }

            const param = paramListDetails.params[paramIndex].param;

            if (param.hasDeclaredType && param.typeAnnotation) {
                const fieldType = this._evaluator.getDeclaredTypeOfSymbol(symbol)?.type;
                const paramType = FunctionType.getEffectiveParameterType(
                    postInitType,
                    paramListDetails.params[paramIndex].index
                );
                const assignTypeDiag = new DiagnosticAddendum();

                if (fieldType && !this._evaluator.assignType(paramType, fieldType, assignTypeDiag)) {
                    const diagnostic = this._evaluator.addDiagnostic(
                        DiagnosticRule.reportGeneralTypeIssues,
                        LocMessage.dataClassPostInitType().format({ fieldName }) + assignTypeDiag.getString(),
                        param.typeAnnotation
                    );

                    if (diagnostic) {
                        const fieldDecls = symbol.getTypedDeclarations();
                        if (fieldDecls.length > 0) {
                            diagnostic.addRelatedInfo(
                                LocAddendum.dataClassFieldLocation(),
                                fieldDecls[0].uri,
                                fieldDecls[0].range
                            );
                        }
                    }
                }
            }

            paramIndex++;
        });
    }

    // If a class is marked final, it must implement all abstract methods,
    // otherwise it is of no use.
    private _validateFinalClassNotAbstract(classType: ClassType, errorNode: ClassNode) {
        if (!ClassType.isFinal(classType)) {
            return;
        }

        if (!ClassType.supportsAbstractMethods(classType)) {
            return;
        }

        const abstractSymbols = this._evaluator.getAbstractSymbols(classType);
        if (abstractSymbols.length === 0) {
            return;
        }

        const diagAddendum = new DiagnosticAddendum();
        const errorsToDisplay = 2;

        abstractSymbols.forEach((abstractMethod, index) => {
            if (index === errorsToDisplay) {
                diagAddendum.addMessage(
                    LocAddendum.memberIsAbstractMore().format({
                        count: abstractSymbols.length - errorsToDisplay,
                    })
                );
            } else if (index < errorsToDisplay) {
                if (isInstantiableClass(abstractMethod.classType)) {
                    const className = abstractMethod.classType.details.name;
                    diagAddendum.addMessage(
                        LocAddendum.memberIsAbstract().format({
                            type: className,
                            name: abstractMethod.symbolName,
                        })
                    );
                }
            }
        });

        this._evaluator.addDiagnostic(
            DiagnosticRule.reportGeneralTypeIssues,
            LocMessage.finalClassIsAbstract().format({
                type: classType.details.name,
            }) + diagAddendum.getString(),
            errorNode.name
        );
    }

    // Reports the case where an instance variable is not declared or initialized
    // within the class body or constructor method.
    private _validateInstanceVariableInitialization(node: ClassNode, classType: ClassType) {
        // This check doesn't apply to stub files.
        if (this._fileInfo.isStubFile) {
            return;
        }

        // This check can be expensive, so don't perform it if the corresponding
        // rule is disabled.
        if (this._fileInfo.diagnosticRuleSet.reportUninitializedInstanceVariable === 'none') {
            return;
        }

        // Protocol classes and ABCs are exempted from this check unless they are
        // marked @final.
        if (
            ClassType.isProtocolClass(classType) ||
            (ClassType.supportsAbstractMethods(classType) && !ClassType.isFinal(classType))
        ) {
            return;
        }

        // If the class is final, see if it has any abstract base classes that define
        // variables. We need to make sure these are initialized.
        const abstractSymbols = new Map<string, ClassMember>();
        if (ClassType.isFinal(classType)) {
            getProtocolSymbolsRecursive(classType, abstractSymbols, ClassTypeFlags.SupportsAbstractMethods);
        }

        ClassType.getSymbolTable(classType).forEach((localSymbol, name) => {
            abstractSymbols.delete(name);

            // This applies only to instance members.
            if (!localSymbol.isInstanceMember()) {
                return;
            }

            const decls = localSymbol.getDeclarations();

            // If the symbol is assigned (or at least declared) within the
            // class body or within the __init__ method, it can be ignored.
            if (
                decls.find((decl) => {
                    const containingClass = ParseTreeUtils.getEnclosingClassOrFunction(decl.node);
                    if (!containingClass) {
                        return true;
                    }

                    if (containingClass.nodeType === ParseNodeType.Class) {
                        // If this is part of an assignment statement, assume it has been
                        // initialized as a class variable.
                        if (decl.node.parent?.nodeType === ParseNodeType.Assignment) {
                            return true;
                        }

                        if (
                            decl.node.parent?.nodeType === ParseNodeType.TypeAnnotation &&
                            decl.node.parent.parent?.nodeType === ParseNodeType.Assignment
                        ) {
                            return true;
                        }

                        // If this is part of a dataclass or a class handled by a dataclass_transform,
                        // exempt it because the class variable will be transformed into an instance
                        // variable in this case.
                        if (ClassType.isDataClass(classType)) {
                            return true;
                        }

                        // If this is part of a TypedDict, exempt it because the class variables
                        // are not actually class variables in a TypedDict.
                        if (ClassType.isTypedDictClass(classType)) {
                            return true;
                        }
                    }

                    if (containingClass.name.value === '__init__') {
                        return true;
                    }

                    return false;
                })
            ) {
                return;
            }

            // If the symbol is declared by its parent, we can assume it
            // is initialized there.
            const parentSymbol = lookUpClassMember(classType, name, MemberAccessFlags.SkipOriginalClass);
            if (parentSymbol) {
                return;
            }

            // Report the variable as uninitialized only on the first decl.
            this._evaluator.addDiagnostic(
                DiagnosticRule.reportUninitializedInstanceVariable,
                LocMessage.uninitializedInstanceVariable().format({ name: name }),
                decls[0].node
            );
        });

        // See if there are any variables from abstract base classes
        // that are not initialized.
        const diagAddendum = new DiagnosticAddendum();
        abstractSymbols.forEach((member, name) => {
            const decls = member.symbol.getDeclarations();

            if (decls.length === 0 || !isClass(member.classType)) {
                return;
            }

            if (decls[0].type === DeclarationType.Variable) {
                // If none of the declarations involve assignments, assume it's
                // not implemented in the protocol.
                if (!decls.some((decl) => decl.type === DeclarationType.Variable && !!decl.inferredTypeSource)) {
                    // This is a variable declaration that is not implemented in the
                    // protocol base class. Make sure it's implemented in the derived class.
                    diagAddendum.addMessage(
                        LocAddendum.uninitializedAbstractVariable().format({
                            name,
                            classType: member.classType.details.name,
                        })
                    );
                }
            }
        });

        if (!diagAddendum.isEmpty()) {
            this._evaluator.addDiagnostic(
                DiagnosticRule.reportUninitializedInstanceVariable,
                LocMessage.uninitializedAbstractVariables().format({ classType: classType.details.name }) +
                    diagAddendum.getString(),
                node.name
            );
        }
    }

    // Validates that the type variables used in a generic protocol class have
    // the proper variance (invariant, covariant, contravariant). See PEP 544
    // for an explanation for why this is important to enforce.
    private _validateProtocolTypeParamVariance(errorNode: ClassNode, classType: ClassType) {
        // If this protocol has no TypeVars with specified variance, there's nothing to do here.
        if (classType.details.typeParameters.length === 0) {
            return;
        }

        const objectType = this._evaluator.getBuiltInType(errorNode, 'object');
        if (!isInstantiableClass(objectType)) {
            return;
        }

        const objectObject = ClassType.cloneAsInstance(objectType);
        const dummyTypeObject = ClassType.createInstantiable(
            '__varianceDummy',
            '',
            '',
            Uri.empty(),
            0,
            0,
            undefined,
            undefined
        );

        classType.details.typeParameters.forEach((param, paramIndex) => {
            // Skip variadics and ParamSpecs.
            if (param.details.isVariadic || param.details.isParamSpec) {
                return;
            }

            // Skip type variables with auto-variance.
            if (param.details.declaredVariance === Variance.Auto) {
                return;
            }

            // Replace all type arguments with a dummy type except for the
            // TypeVar of interest, which is replaced with an object instance.
            const srcTypeArgs = classType.details.typeParameters.map((p, i) => {
                if (p.details.isVariadic) {
                    return p;
                }
                return i === paramIndex ? objectObject : dummyTypeObject;
            });

            // Replace all type arguments with a dummy type except for the
            // TypeVar of interest, which is replaced with itself.
            const destTypeArgs = classType.details.typeParameters.map((p, i) => {
                return i === paramIndex || p.details.isVariadic ? p : dummyTypeObject;
            });

            const srcType = ClassType.cloneForSpecialization(classType, srcTypeArgs, /* isTypeArgumentExplicit */ true);
            const destType = ClassType.cloneForSpecialization(
                classType,
                destTypeArgs,
                /* isTypeArgumentExplicit */ true
            );

            const isDestSubtypeOfSrc = this._evaluator.assignClassToSelf(srcType, destType, Variance.Covariant);

            let expectedVariance: Variance;
            if (isDestSubtypeOfSrc) {
                expectedVariance = Variance.Covariant;
            } else {
                const isSrcSubtypeOfDest = this._evaluator.assignClassToSelf(destType, srcType, Variance.Contravariant);
                if (isSrcSubtypeOfDest) {
                    expectedVariance = Variance.Contravariant;
                } else {
                    expectedVariance = Variance.Invariant;
                }
            }

            if (expectedVariance !== classType.details.typeParameters[paramIndex].details.declaredVariance) {
                let message: string;
                if (expectedVariance === Variance.Covariant) {
                    message = LocMessage.protocolVarianceCovariant().format({
                        variable: param.details.name,
                        class: classType.details.name,
                    });
                } else if (expectedVariance === Variance.Contravariant) {
                    message = LocMessage.protocolVarianceContravariant().format({
                        variable: param.details.name,
                        class: classType.details.name,
                    });
                } else {
                    message = LocMessage.protocolVarianceInvariant().format({
                        variable: param.details.name,
                        class: classType.details.name,
                    });
                }

                this._evaluator.addDiagnostic(DiagnosticRule.reportInvalidTypeVarUse, message, errorNode.name);
            }
        });
    }

    // Validates that a class variable doesn't conflict with a __slots__
    // name. This will generate a runtime exception.
    private _validateSlotsClassVarConflict(classType: ClassType) {
        if (!classType.details.localSlotsNames) {
            // Nothing to check, since this class doesn't use __slots__.
            return;
        }

        // Don't apply this for dataclasses because their class variables
        // are transformed into instance variables.
        if (ClassType.isDataClass(classType)) {
            return;
        }

        ClassType.getSymbolTable(classType).forEach((symbol, name) => {
            const decls = symbol.getDeclarations();
            const isDefinedBySlots = decls.some(
                (decl) => decl.type === DeclarationType.Variable && decl.isDefinedBySlots
            );

            if (isDefinedBySlots) {
                decls.forEach((decl) => {
                    if (
                        decl.type === DeclarationType.Variable &&
                        !decl.isDefinedBySlots &&
                        !decl.isDefinedByMemberAccess
                    ) {
                        if (decl.node.nodeType === ParseNodeType.Name && ParseTreeUtils.isWriteAccess(decl.node)) {
                            this._evaluator.addDiagnostic(
                                DiagnosticRule.reportGeneralTypeIssues,
                                LocMessage.slotsClassVarConflict().format({ name }),
                                decl.node
                            );
                        }
                    }
                });
            }
        });
    }

    // Validates that the __init__ and __new__ method signatures are consistent.
    private _validateConstructorConsistency(classType: ClassType, errorNode: ExpressionNode) {
        // If the class has a custom metaclass with a __call__ method, skip this check.
        const callMethodResult = getBoundCallMethod(this._evaluator, errorNode, classType);
        if (callMethodResult) {
            return;
        }

        const newMethodResult = getBoundNewMethod(this._evaluator, errorNode, classType);
        if (
            !newMethodResult ||
            newMethodResult.typeErrors ||
            !newMethodResult.classType ||
            !isClass(newMethodResult.classType)
        ) {
            return;
        }

        const initMethodResult = getBoundInitMethod(this._evaluator, errorNode, ClassType.cloneAsInstance(classType));
        if (
            !initMethodResult ||
            initMethodResult.typeErrors ||
            !initMethodResult.classType ||
            !isClass(initMethodResult.classType)
        ) {
            return;
        }

        // If both the __new__ and __init__ come from subclasses, don't bother
        // checking for this class.
        if (
            !ClassType.isSameGenericClass(initMethodResult.classType, classType) &&
            !ClassType.isSameGenericClass(newMethodResult.classType, classType)
        ) {
            return;
        }

        let newMemberType: Type | undefined = newMethodResult.type;
        if (!isFunction(newMemberType) && !isOverloadedFunction(newMemberType)) {
            return;
        }

        if (isOverloadedFunction(newMemberType)) {
            // Find the implementation, not the overloaded signatures.
            newMemberType = OverloadedFunctionType.getImplementation(newMemberType);

            if (!newMemberType) {
                return;
            }
        }

        let initMemberType: Type | undefined = initMethodResult.type;
        if (!isFunction(initMemberType) && !isOverloadedFunction(initMemberType)) {
            return;
        }

        if (isOverloadedFunction(initMemberType)) {
            // Find the implementation, not the overloaded signatures.
            initMemberType = OverloadedFunctionType.getImplementation(initMemberType);

            if (!initMemberType) {
                return;
            }
        }

        // If either of the functions has a default parameter signature
        // (* args: Any, ** kwargs: Any), don't proceed with the check.
        if (FunctionType.hasDefaultParameters(initMemberType) || FunctionType.hasDefaultParameters(newMemberType)) {
            return;
        }

        // We'll set the "SkipArgsKwargs" flag for pragmatic reasons since __new__
        // often has an *args and/or **kwargs. We'll also set the ParamSpecValue
        // because we don't care about the return type for this check.
        initMemberType = FunctionType.cloneWithNewFlags(
            initMemberType,
            initMemberType.details.flags |
                FunctionTypeFlags.SkipArgsKwargsCompatibilityCheck |
                FunctionTypeFlags.ParamSpecValue
        );
        newMemberType = FunctionType.cloneWithNewFlags(
            newMemberType,
            initMemberType.details.flags |
                FunctionTypeFlags.SkipArgsKwargsCompatibilityCheck |
                FunctionTypeFlags.ParamSpecValue
        );

        if (
            !this._evaluator.assignType(
                newMemberType,
                initMemberType,
                /* diag */ undefined,
                /* destTypeVarContext */ undefined,
                /* srcTypeVarContext */ undefined,
                AssignTypeFlags.SkipFunctionReturnTypeCheck
            ) ||
            !this._evaluator.assignType(
                initMemberType,
                newMemberType,
                /* diag */ undefined,
                /* destTypeVarContext */ undefined,
                /* srcTypeVarContext */ undefined,
                AssignTypeFlags.SkipFunctionReturnTypeCheck
            )
        ) {
            const displayOnInit = ClassType.isSameGenericClass(initMethodResult.classType, classType);
            const initDecl = initMemberType.details.declaration;
            const newDecl = newMemberType.details.declaration;

            if (initDecl && newDecl) {
                const mainDecl = displayOnInit ? initDecl : newDecl;
                const mainDeclNode =
                    mainDecl.node.nodeType === ParseNodeType.Function ? mainDecl.node.name : mainDecl.node;

                const diagAddendum = new DiagnosticAddendum();
                const initSignature = this._evaluator.printType(initMemberType);
                const newSignature = this._evaluator.printType(newMemberType);

                diagAddendum.addMessage(
                    LocAddendum.initMethodSignature().format({
                        type: initSignature,
                    })
                );
                diagAddendum.addMessage(
                    LocAddendum.newMethodSignature().format({
                        type: newSignature,
                    })
                );

                const diagnostic = this._evaluator.addDiagnostic(
                    DiagnosticRule.reportInconsistentConstructor,
                    LocMessage.constructorParametersMismatch().format({
                        classType: this._evaluator.printType(
                            ClassType.cloneAsInstance(
                                displayOnInit ? initMethodResult.classType : newMethodResult.classType
                            )
                        ),
                    }) + diagAddendum.getString(),
                    mainDeclNode
                );

                if (diagnostic) {
                    const secondaryDecl = displayOnInit ? newDecl : initDecl;

                    diagnostic.addRelatedInfo(
                        (displayOnInit ? LocAddendum.newMethodLocation() : LocAddendum.initMethodLocation()).format({
                            type: this._evaluator.printType(
                                ClassType.cloneAsInstance(
                                    displayOnInit ? newMethodResult.classType : initMethodResult.classType
                                )
                            ),
                        }),
                        secondaryDecl.uri,
                        secondaryDecl.range
                    );
                }
            }
        }
    }

    // Verifies that classes that have more than one base class do not have
    // have conflicting type arguments.
    private _validateMultipleInheritanceBaseClasses(classType: ClassType, errorNode: ParseNode) {
        // Skip this check if the class has only one base class or one or more
        // of the base classes are Any.
        const filteredBaseClasses: ClassType[] = [];
        for (const baseClass of classType.details.baseClasses) {
            if (!isClass(baseClass)) {
                return;
            }

            if (!ClassType.isBuiltIn(baseClass, ['Generic', 'Protocol', 'object'])) {
                filteredBaseClasses.push(baseClass);
            }
        }

        if (filteredBaseClasses.length < 2) {
            return;
        }

        const diagAddendum = new DiagnosticAddendum();

        for (const baseClass of filteredBaseClasses) {
            const typeVarContext = buildTypeVarContextFromSpecializedClass(baseClass);

            for (const baseClassMroClass of baseClass.details.mro) {
                // There's no need to check for conflicts if this class isn't generic.
                if (isClass(baseClassMroClass) && baseClassMroClass.details.typeParameters.length > 0) {
                    const specializedBaseClassMroClass = applySolvedTypeVars(
                        baseClassMroClass,
                        typeVarContext
                    ) as ClassType;

                    // Find the corresponding class in the derived class's MRO list.
                    const matchingMroClass = classType.details.mro.find(
                        (mroClass) =>
                            isClass(mroClass) && ClassType.isSameGenericClass(mroClass, specializedBaseClassMroClass)
                    );

                    if (matchingMroClass && isInstantiableClass(matchingMroClass)) {
                        const matchingMroObject = ClassType.cloneAsInstance(matchingMroClass);
                        const baseClassMroObject = ClassType.cloneAsInstance(specializedBaseClassMroClass);

                        if (!this._evaluator.assignType(matchingMroObject, baseClassMroObject)) {
                            const diag = new DiagnosticAddendum();
                            const baseClassObject = convertToInstance(baseClass);

                            if (isTypeSame(baseClassObject, baseClassMroObject)) {
                                diag.addMessage(
                                    LocAddendum.baseClassIncompatible().format({
                                        baseClass: this._evaluator.printType(baseClassObject),
                                        type: this._evaluator.printType(matchingMroObject),
                                    })
                                );
                            } else {
                                diag.addMessage(
                                    LocAddendum.baseClassIncompatibleSubclass().format({
                                        baseClass: this._evaluator.printType(baseClassObject),
                                        subclass: this._evaluator.printType(baseClassMroObject),
                                        type: this._evaluator.printType(matchingMroObject),
                                    })
                                );
                            }

                            diagAddendum.addAddendum(diag);

                            // Break out of the inner loop so we don't report any redundant errors for this base class.
                            break;
                        }
                    }
                }
            }
        }

        if (!diagAddendum.isEmpty()) {
            this._evaluator.addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.baseClassIncompatible().format({ type: classType.details.name }) + diagAddendum.getString(),
                errorNode
            );
        }
    }

    // Validates that any methods and variables in multiple base classes are
    // compatible with each other.
    private _validateMultipleInheritanceCompatibility(classType: ClassType, errorNode: ParseNode) {
        // Skip this check if reportIncompatibleMethodOverride and reportIncompatibleVariableOverride
        // are disabled because it's a relatively expensive check.
        if (
            this._fileInfo.diagnosticRuleSet.reportIncompatibleMethodOverride === 'none' &&
            this._fileInfo.diagnosticRuleSet.reportIncompatibleVariableOverride === 'none'
        ) {
            return;
        }

        const baseClasses: ClassType[] = [];

        // Filter any unknown base classes. Also remove Generic and Protocol
        // base classes.
        classType.details.baseClasses.forEach((baseClass) => {
            if (
                isClass(baseClass) &&
                !ClassType.isBuiltIn(baseClass, 'Generic') &&
                !ClassType.isBuiltIn(baseClass, 'Protocol')
            ) {
                baseClasses.push(baseClass);
            }
        });

        // If there is only one base class, there's nothing to do.
        if (baseClasses.length < 2) {
            return;
        }

        // Build maps of symbols for each of the base classes.
        const baseClassSymbolMaps = baseClasses.map((baseClass) => {
            const specializedBaseClass = classType.details.mro.find(
                (c) => isClass(c) && ClassType.isSameGenericClass(c, baseClass)
            );
            if (!specializedBaseClass || !isClass(specializedBaseClass)) {
                return new Map<string, ClassMember>();
            }

            // Retrieve all of the specialized symbols from the base class and its ancestors.
            return getClassFieldsRecursive(specializedBaseClass);
        });

        const childClassSymbolMap = getClassFieldsRecursive(classType);

        for (let symbolMapBaseIndex = 1; symbolMapBaseIndex < baseClassSymbolMaps.length; symbolMapBaseIndex++) {
            const baseSymbolMap = baseClassSymbolMaps[symbolMapBaseIndex];

            for (const [name, overriddenClassAndSymbol] of baseSymbolMap) {
                // Special-case dundered methods, which can differ in signature. Also
                // exempt private symbols.
                if (SymbolNameUtils.isDunderName(name) || SymbolNameUtils.isPrivateName(name)) {
                    continue;
                }

                const overriddenClassType = overriddenClassAndSymbol.classType;
                if (!isClass(overriddenClassType)) {
                    continue;
                }

                const overrideClassAndSymbol = childClassSymbolMap.get(name);

                if (overrideClassAndSymbol) {
                    const overrideClassType = overrideClassAndSymbol.classType;

                    // If the override is the same as the overridden, then there's nothing
                    // to check. If the override is the child class, then we can also skip
                    // the check because the normal override checks will report the error.
                    if (
                        !isClass(overrideClassType) ||
                        ClassType.isSameGenericClass(overrideClassType, overriddenClassType) ||
                        ClassType.isSameGenericClass(overrideClassType, classType)
                    ) {
                        continue;
                    }

                    this._validateMultipleInheritanceOverride(
                        overriddenClassAndSymbol,
                        overrideClassAndSymbol,
                        classType,
                        name,
                        errorNode
                    );
                }
            }
        }
    }

    private _validateMultipleInheritanceOverride(
        overriddenClassAndSymbol: ClassMember,
        overrideClassAndSymbol: ClassMember,
        childClassType: ClassType,
        memberName: string,
        errorNode: ParseNode
    ) {
        if (!isClass(overriddenClassAndSymbol.classType) || !isClass(overrideClassAndSymbol.classType)) {
            return;
        }

        // Special case the '_' symbol, which is used in single dispatch
        // code and other cases where the name does not matter.
        if (memberName === '_') {
            return;
        }

        let overriddenType = this._evaluator.getEffectiveTypeOfSymbol(overriddenClassAndSymbol.symbol);
        overriddenType = partiallySpecializeType(overriddenType, overriddenClassAndSymbol.classType);

        const overrideSymbol = overrideClassAndSymbol.symbol;
        let overrideType = this._evaluator.getEffectiveTypeOfSymbol(overrideSymbol);
        overrideType = partiallySpecializeType(overrideType, overrideClassAndSymbol.classType);

        const childOverrideSymbol = ClassType.getSymbolTable(childClassType).get(memberName);
        const childOverrideType = childOverrideSymbol
            ? this._evaluator.getEffectiveTypeOfSymbol(childOverrideSymbol)
            : undefined;

        let diag: Diagnostic | undefined;
        const overrideDecl = getLastTypedDeclarationForSymbol(overrideClassAndSymbol.symbol);
        const overriddenDecl = getLastTypedDeclarationForSymbol(overriddenClassAndSymbol.symbol);

        if (isFunction(overriddenType) || isOverloadedFunction(overriddenType)) {
            const diagAddendum = new DiagnosticAddendum();
            let overrideFunction: FunctionType | undefined;

            if (isFunction(overrideType)) {
                overrideFunction = overrideType;
            } else if (isOverloadedFunction(overrideType)) {
                // Use the last overload.
                overrideFunction = OverloadedFunctionType.getImplementation(overrideType);

                // If the last overload isn't an implementation, skip the check for this symbol.
                if (!overrideFunction) {
                    return;
                }
            }

            if (overrideFunction) {
                if (
                    !this._evaluator.validateOverrideMethod(
                        overriddenType,
                        overrideFunction,
                        /* baseClass */ undefined,
                        diagAddendum,
                        /* enforceParamNameMatch */ true
                    )
                ) {
                    const decl = overrideFunction.details.declaration;
                    if (decl && decl.type === DeclarationType.Function) {
                        diag = this._evaluator.addDiagnostic(
                            DiagnosticRule.reportIncompatibleMethodOverride,
                            LocMessage.baseClassMethodTypeIncompatible().format({
                                classType: childClassType.details.name,
                                name: memberName,
                            }) + diagAddendum.getString(),
                            errorNode
                        );
                    }
                }
            }
        } else if (isProperty(overriddenType)) {
            // Handle properties specially.
            if (!isProperty(overrideType) && !isAnyOrUnknown(overrideType)) {
                const decls = overrideSymbol.getDeclarations();
                if (decls.length > 0) {
                    diag = this._evaluator.addDiagnostic(
                        DiagnosticRule.reportIncompatibleVariableOverride,
                        LocMessage.baseClassVariableTypeIncompatible().format({
                            classType: childClassType.details.name,
                            name: memberName,
                        }),
                        errorNode
                    );
                }
            } else {
                // TODO - check types of property methods fget, fset, fdel.
            }
        } else {
            // This check can be expensive, so don't perform it if the corresponding
            // rule is disabled.
            if (this._fileInfo.diagnosticRuleSet.reportIncompatibleVariableOverride !== 'none') {
                const primaryDecl = getLastTypedDeclarationForSymbol(overriddenClassAndSymbol.symbol);
                let isInvariant = primaryDecl?.type === DeclarationType.Variable && !primaryDecl.isFinal;

                // If the entry is a member of a frozen dataclass, it is immutable,
                // so it does not need to be invariant.
                if (
                    ClassType.isFrozenDataClass(overriddenClassAndSymbol.classType) &&
                    overriddenClassAndSymbol.classType.details.dataClassEntries
                ) {
                    const dataclassEntry = overriddenClassAndSymbol.classType.details.dataClassEntries.find(
                        (entry) => entry.name === memberName
                    );
                    if (dataclassEntry) {
                        isInvariant = false;
                    }
                }

                let overriddenTDEntry: TypedDictEntry | undefined;
                if (overriddenClassAndSymbol.classType.details.typedDictEntries) {
                    overriddenTDEntry =
                        overriddenClassAndSymbol.classType.details.typedDictEntries.knownItems.get(memberName) ??
                        overriddenClassAndSymbol.classType.details.typedDictEntries.extraItems ??
                        getEffectiveExtraItemsEntryType(this._evaluator, overriddenClassAndSymbol.classType);

                    if (overriddenTDEntry?.isReadOnly) {
                        isInvariant = false;
                    }
                }

                let overrideTDEntry: TypedDictEntry | undefined;
                if (overrideClassAndSymbol.classType.details.typedDictEntries) {
                    overrideTDEntry =
                        overrideClassAndSymbol.classType.details.typedDictEntries.knownItems.get(memberName) ??
                        overrideClassAndSymbol.classType.details.typedDictEntries.extraItems ??
                        getEffectiveExtraItemsEntryType(this._evaluator, overrideClassAndSymbol.classType);
                }

                if (
                    !this._evaluator.assignType(
                        overriddenType,
                        childOverrideType ?? overrideType,
                        /* diag */ undefined,
                        /* destTypeVarContext */ undefined,
                        /* srcTypeVarContext */ undefined,
                        isInvariant ? AssignTypeFlags.EnforceInvariance : AssignTypeFlags.Default
                    )
                ) {
                    diag = this._evaluator.addDiagnostic(
                        DiagnosticRule.reportIncompatibleVariableOverride,
                        LocMessage.baseClassVariableTypeIncompatible().format({
                            classType: childClassType.details.name,
                            name: memberName,
                        }),
                        errorNode
                    );
                } else if (overriddenTDEntry && overrideTDEntry) {
                    let isRequiredCompatible: boolean;
                    let isReadOnlyCompatible = true;

                    // If both classes are TypedDicts and they both define this field,
                    // make sure the attributes are compatible.
                    if (overriddenTDEntry.isReadOnly) {
                        isRequiredCompatible = overrideTDEntry.isRequired || !overriddenTDEntry.isRequired;
                    } else {
                        isReadOnlyCompatible = !overrideTDEntry.isReadOnly;
                        isRequiredCompatible = overrideTDEntry.isRequired === overriddenTDEntry.isRequired;
                    }

                    if (!isRequiredCompatible) {
                        const message = overrideTDEntry.isRequired
                            ? LocMessage.typedDictFieldRequiredRedefinition
                            : LocMessage.typedDictFieldNotRequiredRedefinition;
                        diag = this._evaluator.addDiagnostic(
                            DiagnosticRule.reportIncompatibleVariableOverride,
                            message().format({ name: memberName }),
                            errorNode
                        );
                    } else if (!isReadOnlyCompatible) {
                        diag = this._evaluator.addDiagnostic(
                            DiagnosticRule.reportIncompatibleVariableOverride,
                            LocMessage.typedDictFieldReadOnlyRedefinition().format({
                                name: memberName,
                            }),
                            errorNode
                        );
                    }
                }
            }
        }

        if (diag && overrideDecl && overriddenDecl) {
            diag.addRelatedInfo(
                LocAddendum.baseClassOverriddenType().format({
                    baseClass: this._evaluator.printType(convertToInstance(overriddenClassAndSymbol.classType)),
                    type: this._evaluator.printType(overriddenType),
                }),
                overriddenDecl.uri,
                overriddenDecl.range
            );

            diag.addRelatedInfo(
                LocAddendum.baseClassOverridesType().format({
                    baseClass: this._evaluator.printType(convertToInstance(overrideClassAndSymbol.classType)),
                    type: this._evaluator.printType(overrideType),
                }),
                overrideDecl.uri,
                overrideDecl.range
            );
        }
    }

    // Validates that any overloaded methods are consistent in how they
    // are decorated. For example, if the first overload is not marked @final
    // but subsequent ones are, an error should be reported.
    private _validateOverloadDecoratorConsistency(classType: ClassType) {
        ClassType.getSymbolTable(classType).forEach((symbol, name) => {
            const primaryDecl = getLastTypedDeclarationForSymbol(symbol);

            if (!primaryDecl || primaryDecl.type !== DeclarationType.Function) {
                return;
            }

            const typeOfSymbol = this._evaluator.getEffectiveTypeOfSymbol(symbol);

            if (!isOverloadedFunction(typeOfSymbol)) {
                return;
            }

            const overloads = OverloadedFunctionType.getOverloads(typeOfSymbol);

            // If there's an implementation, it will determine whether the
            // function is @final.
            const implementation = OverloadedFunctionType.getImplementation(typeOfSymbol);
            if (implementation) {
                // If one or more of the overloads is marked @final but the
                // implementation is not, report an error.
                if (!FunctionType.isFinal(implementation)) {
                    overloads.forEach((overload) => {
                        if (FunctionType.isFinal(overload) && overload.details.declaration?.node) {
                            this._evaluator.addDiagnostic(
                                DiagnosticRule.reportInconsistentOverload,
                                LocMessage.overloadFinalInconsistencyImpl().format({
                                    name: overload.details.name,
                                }),
                                getNameNodeForDeclaration(overload.details.declaration) ??
                                    overload.details.declaration.node
                            );
                        }
                    });
                }
                return;
            }

            if (!FunctionType.isFinal(overloads[0])) {
                overloads.slice(1).forEach((overload, index) => {
                    if (FunctionType.isFinal(overload) && overload.details.declaration?.node) {
                        this._evaluator.addDiagnostic(
                            DiagnosticRule.reportInconsistentOverload,
                            LocMessage.overloadFinalInconsistencyNoImpl().format({
                                name: overload.details.name,
                                index: index + 2,
                            }),
                            getNameNodeForDeclaration(overload.details.declaration) ?? overload.details.declaration.node
                        );
                    }
                });
            }
        });
    }

    // For a TypedDict class that derives from another TypedDict class
    // that is closed, verify that any new keys are compatible with the
    // base class.
    private _validateTypedDictOverrides(classType: ClassType) {
        if (!ClassType.isTypedDictClass(classType)) {
            return;
        }

        const typedDictEntries = getTypedDictMembersForClass(this._evaluator, classType, /* allowNarrowed */ false);

        for (const baseClass of classType.details.baseClasses) {
            const diag = new DiagnosticAddendum();

            if (
                !isClass(baseClass) ||
                !ClassType.isTypedDictClass(baseClass) ||
                !ClassType.isTypedDictEffectivelyClosed(baseClass)
            ) {
                continue;
            }

            const baseTypedDictEntries = getTypedDictMembersForClass(
                this._evaluator,
                baseClass,
                /* allowNarrowed */ false
            );

            const typeVarContext = buildTypeVarContextFromSpecializedClass(baseClass);

            const baseExtraItemsType = baseTypedDictEntries.extraItems
                ? applySolvedTypeVars(baseTypedDictEntries.extraItems.valueType, typeVarContext)
                : UnknownType.create();

            for (const [name, entry] of typedDictEntries.knownItems) {
                const baseEntry = baseTypedDictEntries.knownItems.get(name);

                if (!baseEntry) {
                    if (!baseTypedDictEntries.extraItems || isNever(baseTypedDictEntries.extraItems.valueType)) {
                        diag.addMessage(
                            LocAddendum.typedDictClosedExtraNotAllowed().format({
                                name,
                            })
                        );
                    } else if (
                        !this._evaluator.assignType(
                            baseExtraItemsType,
                            entry.valueType,
                            /* diag */ undefined,
                            /* destTypeVarContext */ undefined,
                            /* srcTypeVarContext */ undefined,
                            !baseTypedDictEntries.extraItems.isReadOnly
                                ? AssignTypeFlags.EnforceInvariance
                                : AssignTypeFlags.Default
                        )
                    ) {
                        diag.addMessage(
                            LocAddendum.typedDictClosedExtraTypeMismatch().format({
                                name,
                                type: this._evaluator.printType(entry.valueType),
                            })
                        );
                    } else if (!baseTypedDictEntries.extraItems.isReadOnly && entry.isRequired) {
                        diag.addMessage(
                            LocAddendum.typedDictClosedFieldNotRequired().format({
                                name,
                            })
                        );
                    }
                }
            }

            if (typedDictEntries.extraItems && baseTypedDictEntries.extraItems) {
                if (
                    !this._evaluator.assignType(
                        baseExtraItemsType,
                        typedDictEntries.extraItems.valueType,
                        /* diag */ undefined,
                        /* destTypeVarContext */ undefined,
                        /* srcTypeVarContext */ undefined,
                        !baseTypedDictEntries.extraItems.isReadOnly
                            ? AssignTypeFlags.EnforceInvariance
                            : AssignTypeFlags.Default
                    )
                ) {
                    diag.addMessage(
                        LocAddendum.typedDictClosedExtraTypeMismatch().format({
                            name: '__extra_items__',
                            type: this._evaluator.printType(typedDictEntries.extraItems.valueType),
                        })
                    );
                }
            }

            if (!diag.isEmpty() && classType.details.declaration) {
                const declNode = getNameNodeForDeclaration(classType.details.declaration);

                if (declNode) {
                    if (baseTypedDictEntries.extraItems) {
                        this._evaluator.addDiagnostic(
                            DiagnosticRule.reportIncompatibleVariableOverride,
                            LocMessage.typedDictClosedExtras().format({
                                name: baseClass.details.name,
                                type: this._evaluator.printType(baseExtraItemsType),
                            }) + diag.getString(),
                            declNode
                        );
                    } else {
                        this._evaluator.addDiagnostic(
                            DiagnosticRule.reportIncompatibleVariableOverride,
                            LocMessage.typedDictClosedNoExtras().format({
                                name: baseClass.details.name,
                            }) + diag.getString(),
                            declNode
                        );
                    }
                }
            }
        }
    }

    // Validates that any overridden methods or variables contain the same
    // types as the original method. Also marks the class as abstract if one
    // or more abstract methods are not overridden.
    private _validateBaseClassOverrides(classType: ClassType) {
        ClassType.getSymbolTable(classType).forEach((symbol, name) => {
            // Private symbols do not need to match in type since their
            // names are mangled, and subclasses can't access the value in
            // the parent class.
            if (SymbolNameUtils.isPrivateName(name)) {
                return;
            }

            // If the symbol has no declaration, and the type is inferred,
            // skip the type validation but still check for other issues like
            // Final overrides and class/instance variable mismatches.
            let validateType = true;
            if (!symbol.hasTypedDeclarations()) {
                validateType = false;
            }

            // Get the symbol type defined in this class.
            const typeOfSymbol = this._evaluator.getEffectiveTypeOfSymbol(symbol);

            // If the type of the override symbol isn't known, stop here.
            if (isAnyOrUnknown(typeOfSymbol)) {
                return;
            }

            let firstOverride: ClassMember | undefined;

            for (const baseClass of classType.details.baseClasses) {
                if (!isClass(baseClass)) {
                    continue;
                }

                // Look up the base class in the MRO list. It's the same generic class
                // but has already been specialized using the type variables of the classType.
                const mroBaseClass = classType.details.mro.find(
                    (mroClass) => isClass(mroClass) && ClassType.isSameGenericClass(mroClass, baseClass)
                );
                if (!mroBaseClass) {
                    continue;
                }

                assert(isClass(mroBaseClass));
                const baseClassAndSymbol = lookUpClassMember(mroBaseClass, name, MemberAccessFlags.Default);
                if (!baseClassAndSymbol) {
                    continue;
                }

                firstOverride = firstOverride ?? baseClassAndSymbol;

                this._validateBaseClassOverride(
                    baseClassAndSymbol,
                    symbol,
                    validateType ? typeOfSymbol : AnyType.create(),
                    classType,
                    name
                );
            }

            if (!firstOverride) {
                // If this is a method decorated with @override, validate that there
                // is a base class method of the same name.
                this._validateOverrideDecoratorNotPresent(symbol, typeOfSymbol);
            } else {
                this._validateOverrideDecoratorPresent(symbol, typeOfSymbol, firstOverride);
            }
        });
    }

    private _validateOverrideDecoratorPresent(symbol: Symbol, overrideType: Type, baseMember: ClassMember) {
        // Skip this check if disabled.
        if (this._fileInfo.diagnosticRuleSet.reportImplicitOverride === 'none') {
            return;
        }

        let overrideFunction: FunctionType | undefined;

        if (isFunction(overrideType)) {
            overrideFunction = overrideType;
        } else if (isOverloadedFunction(overrideType)) {
            overrideFunction = OverloadedFunctionType.getImplementation(overrideType);
        } else if (isClassInstance(overrideType) && ClassType.isPropertyClass(overrideType)) {
            if (overrideType.fgetInfo) {
                overrideFunction = overrideType.fgetInfo.methodType;
            }
        }

        if (!overrideFunction?.details.declaration || FunctionType.isOverridden(overrideFunction)) {
            return;
        }

        // Constructors are exempt.
        if (this._isMethodExemptFromLsp(overrideFunction.details.name)) {
            return;
        }

        // If the declaration for the override function is not the same as the
        // declaration for the symbol, the function was probably replaced by a decorator.
        if (!symbol.getDeclarations().some((decl) => decl === overrideFunction!.details.declaration)) {
            return;
        }

        // If the base class is unknown, don't report a missing decorator.
        if (isAnyOrUnknown(baseMember.classType)) {
            return;
        }

        const funcNode = overrideFunction.details.declaration.node;
        this._evaluator.addDiagnostic(
            DiagnosticRule.reportImplicitOverride,
            LocMessage.overrideDecoratorMissing().format({
                name: funcNode.name.value,
                className: this._evaluator.printType(convertToInstance(baseMember.classType)),
            }),
            funcNode.name
        );
    }

    // Determines whether the name is exempt from Liskov Substitution Principle rules.
    private _isMethodExemptFromLsp(name: string): boolean {
        const exemptMethods = ['__init__', '__new__', '__init_subclass__', '__post_init__'];
        return exemptMethods.some((n) => n === name);
    }

    // Determines whether the type is a function or overloaded function with an @override
    // decorator. In this case, an error is reported because no base class has declared
    // a method of the same name.
    private _validateOverrideDecoratorNotPresent(symbol: Symbol, overrideType: Type) {
        let overrideFunction: FunctionType | undefined;

        if (isFunction(overrideType)) {
            overrideFunction = overrideType;
        } else if (isOverloadedFunction(overrideType)) {
            overrideFunction = OverloadedFunctionType.getImplementation(overrideType);
        } else if (isClassInstance(overrideType) && ClassType.isPropertyClass(overrideType)) {
            if (overrideType.fgetInfo) {
                overrideFunction = overrideType.fgetInfo.methodType;
            }
        }

        if (!overrideFunction?.details.declaration || !FunctionType.isOverridden(overrideFunction)) {
            return;
        }

        // If the declaration for the override function is not the same as the
        // declaration for the symbol, the function was probably replaced by a decorator.
        if (!symbol.getDeclarations().some((decl) => decl === overrideFunction!.details.declaration)) {
            return;
        }

        const funcNode = overrideFunction.details.declaration.node;
        this._evaluator.addDiagnostic(
            DiagnosticRule.reportGeneralTypeIssues,
            LocMessage.overriddenMethodNotFound().format({ name: funcNode.name.value }),
            funcNode.name
        );
    }

    private _validateBaseClassOverride(
        baseClassAndSymbol: ClassMember,
        overrideSymbol: Symbol,
        overrideType: Type,
        childClassType: ClassType,
        memberName: string
    ) {
        if (!isInstantiableClass(baseClassAndSymbol.classType)) {
            return;
        }

        if (baseClassAndSymbol.symbol.isIgnoredForOverrideChecks() || overrideSymbol.isIgnoredForOverrideChecks()) {
            return;
        }

        // If the base class doesn't provide a type declaration, we won't bother
        // proceeding with additional checks. Type inference is too inaccurate
        // in this case, plus it would be very slow.
        if (!baseClassAndSymbol.symbol.hasTypedDeclarations()) {
            return;
        }

        // Special case the '_' symbol, which is used in single dispatch
        // code and other cases where the name does not matter.
        if (memberName === '_') {
            return;
        }

        const baseClass = baseClassAndSymbol.classType;
        const childClassSelf = ClassType.cloneAsInstance(selfSpecializeClass(childClassType));

        const baseType = partiallySpecializeType(
            this._evaluator.getEffectiveTypeOfSymbol(baseClassAndSymbol.symbol),
            baseClass,
            childClassSelf
        );

        overrideType = partiallySpecializeType(overrideType, childClassType, childClassSelf);

        if (isFunction(baseType) || isOverloadedFunction(baseType)) {
            const diagAddendum = new DiagnosticAddendum();

            // Determine whether this is an attempt to override a method marked @final.
            let reportFinalMethodOverride = false;

            // Private names (starting with double underscore) are exempt from this check.
            if (!SymbolNameUtils.isPrivateName(memberName)) {
                if (isFunction(baseType) && FunctionType.isFinal(baseType)) {
                    reportFinalMethodOverride = true;
                } else if (
                    isOverloadedFunction(baseType) &&
                    baseType.overloads.some((overload) => FunctionType.isFinal(overload))
                ) {
                    reportFinalMethodOverride = true;
                }
            }

            if (reportFinalMethodOverride) {
                const decl = getLastTypedDeclarationForSymbol(overrideSymbol);
                if (decl && decl.type === DeclarationType.Function) {
                    const diag = this._evaluator.addDiagnostic(
                        DiagnosticRule.reportIncompatibleMethodOverride,
                        LocMessage.finalMethodOverride().format({
                            name: memberName,
                            className: baseClass.details.name,
                        }),
                        decl.node.name
                    );

                    const origDecl = getLastTypedDeclarationForSymbol(baseClassAndSymbol.symbol);
                    if (diag && origDecl) {
                        diag.addRelatedInfo(LocAddendum.finalMethod(), origDecl.uri, origDecl.range);
                    }
                }
            }

            if (isFunction(overrideType) || isOverloadedFunction(overrideType)) {
                // Don't enforce parameter names for dundered methods. Many of them
                // are misnamed in typeshed stubs, so this would result in many
                // false positives.
                const enforceParamNameMatch = !SymbolNameUtils.isDunderName(memberName);

                // Don't check certain magic functions or private symbols.
                // Also, skip this check if the class is a TypedDict. The methods for a TypedDict
                // are synthesized, and they can result in many overloads. We assume they
                // are correct and will not produce any errors.
                if (
                    !this._isMethodExemptFromLsp(memberName) &&
                    !SymbolNameUtils.isPrivateName(memberName) &&
                    !ClassType.isTypedDictClass(childClassType)
                ) {
                    if (
                        !this._evaluator.validateOverrideMethod(
                            baseType,
                            overrideType,
                            childClassType,
                            diagAddendum,
                            enforceParamNameMatch
                        )
                    ) {
                        const decl =
                            isFunction(overrideType) && overrideType.details.declaration
                                ? overrideType.details.declaration
                                : getLastTypedDeclarationForSymbol(overrideSymbol);
                        if (decl) {
                            const diag = this._evaluator.addDiagnostic(
                                DiagnosticRule.reportIncompatibleMethodOverride,
                                LocMessage.incompatibleMethodOverride().format({
                                    name: memberName,
                                    className: baseClass.details.name,
                                }) + diagAddendum.getString(),
                                getNameNodeForDeclaration(decl) ?? decl.node
                            );

                            const origDecl = getLastTypedDeclarationForSymbol(baseClassAndSymbol.symbol);
                            if (diag && origDecl) {
                                diag.addRelatedInfo(LocAddendum.overriddenMethod(), origDecl.uri, origDecl.range);
                            }
                        }
                    }
                }
            } else if (!isAnyOrUnknown(overrideType)) {
                // Special-case overrides of methods in '_TypedDict', since
                // TypedDict attributes aren't manifest as attributes but rather
                // as named keys.
                if (!ClassType.isBuiltIn(baseClass, '_TypedDict')) {
                    const decls = overrideSymbol.getDeclarations();
                    if (decls.length > 0) {
                        const lastDecl = decls[decls.length - 1];
                        const diag = this._evaluator.addDiagnostic(
                            DiagnosticRule.reportIncompatibleMethodOverride,
                            LocMessage.methodOverridden().format({
                                name: memberName,
                                className: baseClass.details.name,
                                type: this._evaluator.printType(overrideType),
                            }),
                            getNameNodeForDeclaration(lastDecl) ?? lastDecl.node
                        );

                        const origDecl = getLastTypedDeclarationForSymbol(baseClassAndSymbol.symbol);
                        if (diag && origDecl) {
                            diag.addRelatedInfo(LocAddendum.overriddenMethod(), origDecl.uri, origDecl.range);
                        }
                    }
                }
            }
        } else if (isProperty(baseType)) {
            // Handle properties specially.
            if (!isProperty(overrideType)) {
                const decls = overrideSymbol.getDeclarations();
                if (decls.length > 0 && overrideSymbol.isClassMember()) {
                    const lastDecl = decls[decls.length - 1];
                    this._evaluator.addDiagnostic(
                        DiagnosticRule.reportIncompatibleMethodOverride,
                        LocMessage.propertyOverridden().format({
                            name: memberName,
                            className: baseClass.details.name,
                        }),
                        getNameNodeForDeclaration(lastDecl) ?? lastDecl.node
                    );
                }
            } else {
                const baseClassType = baseClass;
                const propMethodInfo: [string, (c: ClassType) => FunctionType | undefined][] = [
                    ['fget', (c) => c.fgetInfo?.methodType],
                    ['fset', (c) => c.fsetInfo?.methodType],
                    ['fdel', (c) => c.fdelInfo?.methodType],
                ];

                propMethodInfo.forEach((info) => {
                    const diagAddendum = new DiagnosticAddendum();
                    const [methodName, methodAccessor] = info;
                    const baseClassPropMethod = methodAccessor(baseType as ClassType);
                    const subclassPropMethod = methodAccessor(overrideType as ClassType);

                    // Is the method present on the base class but missing in the subclass?
                    if (baseClassPropMethod) {
                        const baseClassMethodType = partiallySpecializeType(baseClassPropMethod, baseClassType);
                        if (isFunction(baseClassMethodType)) {
                            if (!subclassPropMethod) {
                                // The method is missing.
                                diagAddendum.addMessage(
                                    LocAddendum.propertyMethodMissing().format({
                                        name: methodName,
                                    })
                                );
                                const decls = overrideSymbol.getDeclarations();
                                if (decls.length > 0) {
                                    const lastDecl = decls[decls.length - 1];
                                    const diag = this._evaluator.addDiagnostic(
                                        DiagnosticRule.reportIncompatibleMethodOverride,
                                        LocMessage.propertyOverridden().format({
                                            name: memberName,
                                            className: baseClassType.details.name,
                                        }) + diagAddendum.getString(),
                                        getNameNodeForDeclaration(lastDecl) ?? lastDecl.node
                                    );

                                    const origDecl = baseClassMethodType.details.declaration;
                                    if (diag && origDecl) {
                                        diag.addRelatedInfo(
                                            LocAddendum.overriddenMethod(),
                                            origDecl.uri,
                                            origDecl.range
                                        );
                                    }
                                }
                            } else {
                                const subclassMethodType = partiallySpecializeType(subclassPropMethod, childClassType);
                                if (isFunction(subclassMethodType)) {
                                    if (
                                        !this._evaluator.validateOverrideMethod(
                                            baseClassMethodType,
                                            subclassMethodType,
                                            childClassType,
                                            diagAddendum.createAddendum()
                                        )
                                    ) {
                                        diagAddendum.addMessage(
                                            LocAddendum.propertyMethodIncompatible().format({
                                                name: methodName,
                                            })
                                        );
                                        const decl = subclassMethodType.details.declaration;
                                        if (decl && decl.type === DeclarationType.Function) {
                                            const diag = this._evaluator.addDiagnostic(
                                                DiagnosticRule.reportIncompatibleMethodOverride,
                                                LocMessage.propertyOverridden().format({
                                                    name: memberName,
                                                    className: baseClassType.details.name,
                                                }) + diagAddendum.getString(),
                                                decl.node.name
                                            );

                                            const origDecl = baseClassMethodType.details.declaration;
                                            if (diag && origDecl) {
                                                diag.addRelatedInfo(
                                                    LocAddendum.overriddenMethod(),
                                                    origDecl.uri,
                                                    origDecl.range
                                                );
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                });
            }
        } else {
            // This check can be expensive, so don't perform it if the corresponding
            // rule is disabled.
            if (this._fileInfo.diagnosticRuleSet.reportIncompatibleVariableOverride !== 'none') {
                const decls = overrideSymbol.getDeclarations();

                if (decls.length > 0) {
                    const lastDecl = decls[decls.length - 1];
                    const primaryDecl = decls[0];

                    // Verify that the override type is assignable to (same or narrower than)
                    // the declared type of the base symbol.
                    let isInvariant = primaryDecl?.type === DeclarationType.Variable && !primaryDecl.isFinal;

                    // If the entry is a member of a frozen dataclass, it is immutable,
                    // so it does not need to be invariant.
                    if (ClassType.isFrozenDataClass(baseClass) && baseClass.details.dataClassEntries) {
                        const dataclassEntry = baseClass.details.dataClassEntries.find(
                            (entry) => entry.name === memberName
                        );
                        if (dataclassEntry) {
                            isInvariant = false;
                        }
                    }

                    let overriddenTDEntry: TypedDictEntry | undefined;
                    let overrideTDEntry: TypedDictEntry | undefined;

                    if (!overrideSymbol.isIgnoredForProtocolMatch()) {
                        if (baseClass.details.typedDictEntries) {
                            overriddenTDEntry =
                                baseClass.details.typedDictEntries.knownItems.get(memberName) ??
                                baseClass.details.typedDictEntries.extraItems ??
                                getEffectiveExtraItemsEntryType(this._evaluator, baseClass);

                            if (overriddenTDEntry?.isReadOnly) {
                                isInvariant = false;
                            }
                        }

                        if (childClassType.details.typedDictEntries) {
                            // Exempt __extra_items__ here. We'll check this separately
                            // in _validateTypedDictOverrides. If we don't skip it here,
                            // redundant errors will be produced.
                            if (ClassType.isTypedDictMarkedClosed(childClassType) && memberName === '__extra_items__') {
                                overrideTDEntry = overriddenTDEntry;
                                overrideType = baseType;
                            } else {
                                overrideTDEntry =
                                    childClassType.details.typedDictEntries.knownItems.get(memberName) ??
                                    childClassType.details.typedDictEntries.extraItems ??
                                    getEffectiveExtraItemsEntryType(this._evaluator, childClassType);
                            }
                        }
                    }

                    let diagAddendum = new DiagnosticAddendum();
                    if (
                        !this._evaluator.assignType(
                            baseType,
                            overrideType,
                            diagAddendum,
                            /* destTypeVarContext */ undefined,
                            /* srcTypeVarContext */ undefined,
                            isInvariant ? AssignTypeFlags.EnforceInvariance : AssignTypeFlags.Default
                        )
                    ) {
                        if (isInvariant) {
                            diagAddendum = new DiagnosticAddendum();
                            diagAddendum.addMessage(LocAddendum.overrideIsInvariant());
                            diagAddendum.createAddendum().addMessage(
                                LocAddendum.overrideInvariantMismatch().format({
                                    overrideType: this._evaluator.printType(overrideType),
                                    baseType: this._evaluator.printType(baseType),
                                })
                            );
                        }

                        const diag = this._evaluator.addDiagnostic(
                            DiagnosticRule.reportIncompatibleVariableOverride,
                            LocMessage.symbolOverridden().format({
                                name: memberName,
                                className: baseClass.details.name,
                            }) + diagAddendum.getString(),
                            getNameNodeForDeclaration(lastDecl) ?? lastDecl.node
                        );

                        const origDecl = getLastTypedDeclarationForSymbol(baseClassAndSymbol.symbol);
                        if (diag && origDecl) {
                            diag.addRelatedInfo(LocAddendum.overriddenSymbol(), origDecl.uri, origDecl.range);
                        }
                    } else if (overriddenTDEntry && overrideTDEntry) {
                        // Make sure the required/not-required attribute is compatible.
                        let isRequiredCompatible = true;
                        if (overriddenTDEntry.isReadOnly) {
                            // If the read-only flag is set, a not-required field can be overridden
                            // by a required field, but not vice versa.
                            isRequiredCompatible = overrideTDEntry.isRequired || !overriddenTDEntry.isRequired;
                        } else {
                            isRequiredCompatible = overrideTDEntry.isRequired === overriddenTDEntry.isRequired;
                        }

                        if (!isRequiredCompatible) {
                            const message = overrideTDEntry.isRequired
                                ? LocMessage.typedDictFieldRequiredRedefinition
                                : LocMessage.typedDictFieldNotRequiredRedefinition;
                            this._evaluator.addDiagnostic(
                                DiagnosticRule.reportGeneralTypeIssues,
                                message().format({ name: memberName }),
                                getNameNodeForDeclaration(lastDecl) ?? lastDecl.node
                            );
                        }

                        // Make sure that the derived class isn't marking a previously writable
                        // entry as read-only.
                        if (!overriddenTDEntry.isReadOnly && overrideTDEntry.isReadOnly) {
                            this._evaluator.addDiagnostic(
                                DiagnosticRule.reportGeneralTypeIssues,
                                LocMessage.typedDictFieldReadOnlyRedefinition().format({
                                    name: memberName,
                                }),
                                getNameNodeForDeclaration(lastDecl) ?? lastDecl.node
                            );
                        }
                    }

                    // Verify that there is not a Final mismatch.
                    const isBaseVarFinal = this._evaluator.isFinalVariable(baseClassAndSymbol.symbol);
                    const overrideFinalVarDecl = decls.find((d) => this._evaluator.isFinalVariableDeclaration(d));

                    if (!isBaseVarFinal && overrideFinalVarDecl) {
                        const diag = this._evaluator.addDiagnostic(
                            DiagnosticRule.reportIncompatibleVariableOverride,
                            LocMessage.variableFinalOverride().format({
                                name: memberName,
                                className: baseClass.details.name,
                            }),
                            getNameNodeForDeclaration(lastDecl) ?? lastDecl.node
                        );

                        if (diag) {
                            diag.addRelatedInfo(
                                LocAddendum.overriddenSymbol(),
                                overrideFinalVarDecl.uri,
                                overrideFinalVarDecl.range
                            );
                        }
                    }

                    // Verify that a class variable isn't overriding an instance
                    // variable or vice versa.
                    const isBaseClassVar = baseClassAndSymbol.symbol.isClassVar();
                    let isClassVar = overrideSymbol.isClassVar();

                    if (isBaseClassVar && !isClassVar) {
                        // If the subclass doesn't redeclare the type but simply assigns
                        // it without declaring its type, we won't consider it an instance
                        // variable.
                        if (!overrideSymbol.hasTypedDeclarations()) {
                            isClassVar = true;
                        }

                        // If the subclass is declaring an inner class, we'll consider that
                        // to be a ClassVar.
                        if (
                            overrideSymbol.getTypedDeclarations().every((decl) => decl.type === DeclarationType.Class)
                        ) {
                            isClassVar = true;
                        }
                    }

                    // Allow TypedDict members to have the same name as class variables in the
                    // base class because TypedDict members are not really instance members.
                    const ignoreTypedDictOverride = ClassType.isTypedDictClass(childClassType) && !isClassVar;

                    if (isBaseClassVar !== isClassVar && !ignoreTypedDictOverride) {
                        const unformattedMessage = overrideSymbol.isClassVar()
                            ? LocMessage.classVarOverridesInstanceVar()
                            : LocMessage.instanceVarOverridesClassVar();

                        const diag = this._evaluator.addDiagnostic(
                            DiagnosticRule.reportIncompatibleVariableOverride,
                            unformattedMessage.format({
                                name: memberName,
                                className: baseClass.details.name,
                            }),
                            getNameNodeForDeclaration(lastDecl) ?? lastDecl.node
                        );

                        const origDecl = getLastTypedDeclarationForSymbol(baseClassAndSymbol.symbol);
                        if (diag && origDecl) {
                            diag.addRelatedInfo(LocAddendum.overriddenSymbol(), origDecl.uri, origDecl.range);
                        }
                    }
                }
            }
        }
    }

    // Performs checks on a function that is located within a class
    // and has been determined not to be a property accessor.
    private _validateMethod(node: FunctionNode, functionType: FunctionType, classNode: ClassNode) {
        const classTypeInfo = this._evaluator.getTypeOfClass(classNode);
        const classType = classTypeInfo?.classType;

        if (node.name && classType) {
            const superCheckMethods = ['__init__', '__init_subclass__', '__enter__', '__exit__'];
            if (superCheckMethods.some((name) => name === node.name.value)) {
                if (
                    !FunctionType.isAbstractMethod(functionType) &&
                    !FunctionType.isOverloaded(functionType) &&
                    !this._fileInfo.isStubFile
                ) {
                    this._validateSuperCallForMethod(node, functionType, classType);
                }
            }
        }

        if (node.name?.value === '__new__') {
            // __new__ overrides should have a "cls" parameter.
            if (
                node.parameters.length === 0 ||
                !node.parameters[0].name ||
                !['cls', '_cls', '__cls', '__mcls', 'mcls', 'mcs', 'metacls'].some(
                    (name) => node.parameters[0].name!.value === name
                )
            ) {
                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportSelfClsParameterName,
                    LocMessage.newClsParam(),
                    node.parameters.length > 0 ? node.parameters[0] : node.name
                );
            }

            if (classType) {
                this._validateClsSelfParameterType(functionType, classType, /* isCls */ true);
            }
        } else if (node.name?.value === '_generate_next_value_') {
            // Skip this check for _generate_next_value_.
        } else if (FunctionType.isStaticMethod(functionType)) {
            // Static methods should not have "self" or "cls" parameters.
            if (node.parameters.length > 0 && node.parameters[0].name) {
                const paramName = node.parameters[0].name.value;
                if (paramName === 'self' || paramName === 'cls') {
                    this._evaluator.addDiagnostic(
                        DiagnosticRule.reportSelfClsParameterName,
                        LocMessage.staticClsSelfParam(),
                        node.parameters[0].name
                    );
                }
            }
        } else if (FunctionType.isClassMethod(functionType)) {
            let paramName = '';
            if (node.parameters.length > 0 && node.parameters[0].name) {
                paramName = node.parameters[0].name.value;
            }
            // Class methods should have a "cls" parameter. We'll exempt parameter
            // names that start with an underscore since those are used in a few
            // cases in the stdlib pyi files.
            if (paramName !== 'cls') {
                if (!this._fileInfo.isStubFile || (!paramName.startsWith('_') && paramName !== 'metacls')) {
                    this._evaluator.addDiagnostic(
                        DiagnosticRule.reportSelfClsParameterName,
                        LocMessage.classMethodClsParam(),
                        node.parameters.length > 0 ? node.parameters[0] : node.name
                    );
                }
            }

            if (classType) {
                this._validateClsSelfParameterType(functionType, classType, /* isCls */ true);
            }
        } else {
            const decoratorIsPresent = node.decorators.length > 0;
            const isOverloaded = FunctionType.isOverloaded(functionType);

            // The presence of a decorator can change the behavior, so we need
            // to back off from this check if a decorator is present. An overload
            // is a decorator, but we'll ignore that here.
            if (isOverloaded || !decoratorIsPresent) {
                let paramName = '';
                let firstParamIsSimple = true;
                if (node.parameters.length > 0) {
                    if (node.parameters[0].name) {
                        paramName = node.parameters[0].name.value;
                    }

                    if (node.parameters[0].category !== ParameterCategory.Simple) {
                        firstParamIsSimple = false;
                    }
                }

                // Instance methods should have a "self" parameter.
                if (firstParamIsSimple && paramName !== 'self') {
                    // Special-case metaclasses, which can use "cls" or several variants.
                    let isLegalMetaclassName = false;
                    if (['cls', 'mcls', 'mcs'].some((name) => name === paramName)) {
                        const classTypeInfo = this._evaluator.getTypeOfClass(classNode);
                        const typeType = this._evaluator.getBuiltInType(classNode, 'type');
                        if (
                            typeType &&
                            isInstantiableClass(typeType) &&
                            classTypeInfo &&
                            isInstantiableClass(classTypeInfo.classType)
                        ) {
                            if (
                                derivesFromClassRecursive(classTypeInfo.classType, typeType, /* ignoreUnknown */ true)
                            ) {
                                isLegalMetaclassName = true;
                            }
                        }
                    }

                    // Some typeshed stubs use a name that starts with an underscore to designate
                    // a parameter that cannot be positional.
                    const isPrivateName = SymbolNameUtils.isPrivateOrProtectedName(paramName);

                    if (!isLegalMetaclassName && !isPrivateName) {
                        this._evaluator.addDiagnostic(
                            DiagnosticRule.reportSelfClsParameterName,
                            LocMessage.instanceMethodSelfParam(),
                            node.parameters.length > 0 ? node.parameters[0] : node.name
                        );
                    }
                }
            }

            if (classType) {
                this._validateClsSelfParameterType(functionType, classType, /* isCls */ false);
            }
        }
    }

    // Determines whether the method properly calls through to the same method in all
    // parent classes that expose a same-named method.
    private _validateSuperCallForMethod(node: FunctionNode, methodType: FunctionType, classType: ClassType) {
        // This is an expensive test, so if it's not enabled, don't do any work.
        if (this._fileInfo.diagnosticRuleSet.reportMissingSuperCall === 'none') {
            return;
        }

        // If the class is marked final, we can skip the "object" base class
        // because we know that the `__init__` method in `object` doesn't do
        // anything. It's not safe to do this if the class isn't final because
        // it could be combined with other classes in a multi-inheritance
        // situation that effectively adds new superclasses that we don't know
        // about statically.
        let effectiveFlags = MemberAccessFlags.SkipInstanceMembers | MemberAccessFlags.SkipOriginalClass;
        if (ClassType.isFinal(classType)) {
            effectiveFlags |= MemberAccessFlags.SkipObjectBaseClass;
        }

        const methodMember = lookUpClassMember(classType, methodType.details.name, effectiveFlags);
        if (!methodMember) {
            return;
        }

        let foundCallOfMember = false;

        // Now scan the implementation of the method to determine whether
        // super().<method> has been called for all of the required base classes.
        const callNodeWalker = new ParseTreeUtils.CallNodeWalker((node) => {
            if (node.leftExpression.nodeType === ParseNodeType.MemberAccess) {
                // Is it accessing the method by the same name?
                if (node.leftExpression.memberName.value === methodType.details.name) {
                    const memberBaseExpr = node.leftExpression.leftExpression;

                    // Is it a "super" call?
                    if (
                        memberBaseExpr.nodeType === ParseNodeType.Call &&
                        memberBaseExpr.leftExpression.nodeType === ParseNodeType.Name &&
                        memberBaseExpr.leftExpression.value === 'super'
                    ) {
                        foundCallOfMember = true;
                    } else {
                        // Is it an X.<method> direct call?
                        const baseType = this._evaluator.getType(memberBaseExpr);
                        if (baseType && isInstantiableClass(baseType)) {
                            foundCallOfMember = true;
                        }
                    }
                }
            }
        });
        callNodeWalker.walk(node.suite);

        // If we didn't find a call to at least one base class, report the problem.
        if (!foundCallOfMember) {
            this._evaluator.addDiagnostic(
                DiagnosticRule.reportMissingSuperCall,
                LocMessage.missingSuperCall().format({
                    methodName: methodType.details.name,
                }),
                node.name
            );
        }
    }

    // Validates that the annotated type of a "self" or "cls" parameter is
    // compatible with the type of the class that contains it.
    private _validateClsSelfParameterType(functionType: FunctionType, classType: ClassType, isCls: boolean) {
        if (functionType.details.parameters.length < 1) {
            return;
        }

        // If there is no type annotation, there's nothing to check because
        // the type will be inferred.
        const paramInfo = functionType.details.parameters[0];
        if (!paramInfo.typeAnnotation || !paramInfo.name) {
            return;
        }

        // If this is an __init__ method, we need to specifically check for the
        // use of class-scoped TypeVars, which are not allowed in this context
        // according to the typing spec.
        if (functionType.details.name === '__init__' && functionType.details.methodClass) {
            const typeVars = getTypeVarArgumentsRecursive(paramInfo.type);

            if (
                typeVars.some((typeVar) => typeVar.scopeId === functionType.details.methodClass?.details.typeVarScopeId)
            ) {
                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportInvalidTypeVarUse,
                    LocMessage.initMethodSelfParamTypeVar(),
                    paramInfo.typeAnnotation
                );
            }
        }

        // If this is a protocol class, the self and cls parameters can be bound
        // to something other than the class.
        if (ClassType.isProtocolClass(classType)) {
            return;
        }

        const paramType = this._evaluator.makeTopLevelTypeVarsConcrete(paramInfo.type);
        const expectedType = isCls ? classType : convertToInstance(classType);

        // If the declared type is a protocol class or instance, skip
        // the check. This has legitimate uses for mix-in classes.
        if (isInstantiableClass(paramType) && ClassType.isProtocolClass(paramType)) {
            return;
        }
        if (isClassInstance(paramType) && ClassType.isProtocolClass(paramType)) {
            return;
        }

        // If the method starts with a `*args: P.args`, skip the check.
        if (
            paramInfo.category === ParameterCategory.ArgsList &&
            isParamSpec(paramInfo.type) &&
            paramInfo.type.paramSpecAccess === 'args'
        ) {
            return;
        }

        // Don't enforce this for an overloaded method because the "self" param
        // annotation can be used as a filter for the overload. This differs from
        // mypy, which enforces this check for overloads, but there are legitimate
        // uses for this in an overloaded method.
        if (FunctionType.isOverloaded(functionType)) {
            return;
        }

        // If the declared type is LiteralString and the class is str, exempt this case.
        // It's used in the typeshed stubs.
        if (
            isClassInstance(paramType) &&
            ClassType.isBuiltIn(paramType, 'LiteralString') &&
            ClassType.isBuiltIn(classType, 'str')
        ) {
            return;
        }

        const typeVarContext = new TypeVarContext(getTypeVarScopeId(functionType));
        if (!this._evaluator.assignType(paramType, expectedType, /* diag */ undefined, typeVarContext)) {
            // We exempt Never from this check because it has a legitimate use in this case.
            if (!isNever(paramType)) {
                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportGeneralTypeIssues,
                    LocMessage.clsSelfParamTypeMismatch().format({
                        name: paramInfo.name,
                        classType: this._evaluator.printType(expectedType),
                    }),
                    paramInfo.typeAnnotation
                );
            }
        }
    }

    // Determines whether a yield or yield from node is compatible with the
    // return type annotation of the containing function.
    private _validateYieldType(
        node: YieldNode | YieldFromNode,
        yieldType: Type,
        expectedDiagAddendum?: DiagnosticAddendum,
        sendType?: Type
    ) {
        const enclosingFunctionNode = ParseTreeUtils.getEnclosingFunction(node);
        if (!enclosingFunctionNode || !enclosingFunctionNode.returnTypeAnnotation) {
            return;
        }

        const functionTypeResult = this._evaluator.getTypeOfFunction(enclosingFunctionNode);
        if (!functionTypeResult) {
            return;
        }

        const declaredReturnType = FunctionType.getSpecializedReturnType(functionTypeResult.functionType);
        if (!declaredReturnType) {
            return;
        }

        let generatorType: Type | undefined;
        if (
            !enclosingFunctionNode.isAsync &&
            isClassInstance(declaredReturnType) &&
            ClassType.isBuiltIn(declaredReturnType, 'AwaitableGenerator')
        ) {
            // Handle the old-style (pre-await) generator case
            // if the return type explicitly uses AwaitableGenerator.
            generatorType = this._evaluator.getTypingType(node, 'AwaitableGenerator');
        } else {
            generatorType = this._evaluator.getTypingType(
                node,
                enclosingFunctionNode.isAsync ? 'AsyncGenerator' : 'Generator'
            );
        }

        if (!generatorType || !isInstantiableClass(generatorType)) {
            return;
        }

        if (!this._evaluator.isNodeReachable(node, /* sourceNode */ undefined)) {
            return;
        }

        if (isNever(declaredReturnType)) {
            this._evaluator.addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.noReturnContainsYield(),
                node
            );
            return;
        }

        const generatorTypeArgs = [yieldType, sendType ?? UnknownType.create(), UnknownType.create()];
        const specializedGenerator = ClassType.cloneAsInstance(
            ClassType.cloneForSpecialization(generatorType, generatorTypeArgs, /* isTypeArgumentExplicit */ true)
        );

        const diagAddendum = new DiagnosticAddendum();
        if (!this._evaluator.assignType(declaredReturnType, specializedGenerator, diagAddendum)) {
            const errorMessage = enclosingFunctionNode.isAsync
                ? LocMessage.generatorAsyncReturnType()
                : LocMessage.generatorSyncReturnType();

            this._evaluator.addDiagnostic(
                DiagnosticRule.reportReturnType,
                errorMessage.format({ yieldType: this._evaluator.printType(yieldType) }) +
                    (expectedDiagAddendum?.getString() ?? diagAddendum.getString()),
                node.expression ?? node,
                expectedDiagAddendum?.getEffectiveTextRange() ?? node.expression ?? node
            );
        }
    }

    // Determines whether any of the except statements are unreachable because
    // they are redundant.
    private _reportUnusedExceptStatements(node: TryNode) {
        let sawUnknownExceptionType = false;
        const exceptionTypesSoFar: ClassType[] = [];

        node.exceptClauses.forEach((except) => {
            if (sawUnknownExceptionType || except.isExceptGroup || !except.typeExpression) {
                return;
            }

            const exceptionType = this._evaluator.getType(except.typeExpression);
            if (!exceptionType || isAnyOrUnknown(exceptionType)) {
                sawUnknownExceptionType = true;
                return;
            }

            const typesOfThisExcept: ClassType[] = [];

            if (isInstantiableClass(exceptionType)) {
                // If the exception type is a variable whose type could represent
                // subclasses, the actual exception type is statically unknown.
                if (exceptionType.includeSubclasses) {
                    sawUnknownExceptionType = true;
                }

                typesOfThisExcept.push(exceptionType);
            } else if (isClassInstance(exceptionType)) {
                const iterableType =
                    this._evaluator.getTypeOfIterator(
                        { type: exceptionType },
                        /* isAsync */ false,
                        /* errorNode */ except.typeExpression,
                        /* emitNotIterableError */ false
                    )?.type ?? UnknownType.create();

                doForEachSubtype(iterableType, (subtype) => {
                    if (isAnyOrUnknown(subtype)) {
                        sawUnknownExceptionType = true;
                    }

                    if (isInstantiableClass(subtype)) {
                        // If the exception type is a variable whose type could represent
                        // subclasses, the actual exception type is statically unknown.
                        if (subtype.includeSubclasses) {
                            sawUnknownExceptionType = true;
                        }
                        typesOfThisExcept.push(subtype);
                    }
                });
            } else {
                sawUnknownExceptionType = true;
            }

            if (exceptionTypesSoFar.length > 0 && !sawUnknownExceptionType) {
                const diagAddendum = new DiagnosticAddendum();
                let overriddenExceptionCount = 0;

                typesOfThisExcept.forEach((thisExceptType) => {
                    const subtype = exceptionTypesSoFar.find((previousExceptType) => {
                        return derivesFromClassRecursive(thisExceptType, previousExceptType, /* ignoreUnknown */ true);
                    });

                    if (subtype) {
                        diagAddendum.addMessage(
                            LocAddendum.unreachableExcept().format({
                                exceptionType: this._evaluator.printType(convertToInstance(thisExceptType)),
                                parentType: this._evaluator.printType(convertToInstance(subtype)),
                            })
                        );
                        overriddenExceptionCount++;
                    }
                });

                // Were all of the exception types overridden?
                if (typesOfThisExcept.length > 0 && typesOfThisExcept.length === overriddenExceptionCount) {
                    this._evaluator.addDiagnostic(
                        DiagnosticRule.reportUnusedExcept,
                        LocMessage.unreachableExcept() + diagAddendum.getString(),
                        except.typeExpression
                    );
                    this._evaluator.addUnreachableCode(except, except.exceptSuite);
                }
            }

            appendArray(exceptionTypesSoFar, typesOfThisExcept);
        });
    }

    private _reportDuplicateImports() {
        const importStatements = getTopLevelImports(this._moduleNode);

        const importModuleMap = new Map<string, ImportAsNode>();

        importStatements.orderedImports.forEach((importStatement) => {
            if (importStatement.node.nodeType === ParseNodeType.ImportFrom) {
                const symbolMap = new Map<string, ImportFromAsNode>();

                importStatement.node.imports.forEach((importFromAs) => {
                    // Ignore duplicates if they're aliased.
                    if (!importFromAs.alias) {
                        const prevImport = symbolMap.get(importFromAs.name.value);
                        if (prevImport) {
                            this._evaluator.addDiagnostic(
                                DiagnosticRule.reportDuplicateImport,
                                LocMessage.duplicateImport().format({ importName: importFromAs.name.value }),
                                importFromAs.name
                            );
                        } else {
                            symbolMap.set(importFromAs.name.value, importFromAs);
                        }
                    }
                });
            } else if (importStatement.subnode) {
                // Ignore duplicates if they're aliased.
                if (!importStatement.subnode.alias) {
                    const prevImport = importModuleMap.get(importStatement.moduleName);
                    if (prevImport) {
                        this._evaluator.addDiagnostic(
                            DiagnosticRule.reportDuplicateImport,
                            LocMessage.duplicateImport().format({ importName: importStatement.moduleName }),
                            importStatement.subnode
                        );
                    } else {
                        importModuleMap.set(importStatement.moduleName, importStatement.subnode);
                    }
                }
            }
        });
    }
}
