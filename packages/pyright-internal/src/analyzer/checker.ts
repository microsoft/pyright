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
import { PythonVersion, pythonVersion3_12, pythonVersion3_5, pythonVersion3_6 } from '../common/pythonVersion';
import { TextRange } from '../common/textRange';
import { Uri } from '../common/uri/uri';
import { DefinitionProvider } from '../languageService/definitionProvider';
import { LocAddendum, LocMessage } from '../localization/localize';
import {
    ArgCategory,
    AssertNode,
    AssignmentExpressionNode,
    AssignmentNode,
    AugmentedAssignmentNode,
    AwaitNode,
    BinaryOperationNode,
    CallNode,
    CaseNode,
    ClassNode,
    ComprehensionIfNode,
    ComprehensionNode,
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
    ListNode,
    MatchNode,
    MemberAccessNode,
    ModuleNameNode,
    ModuleNode,
    NameNode,
    NonlocalNode,
    ParamCategory,
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
import { ConstraintTracker } from './constraintTracker';
import { getBoundCallMethod, getBoundInitMethod, getBoundNewMethod } from './constructors';
import { addInheritedDataClassEntries } from './dataClasses';
import { Declaration, DeclarationType, isAliasDeclaration, isVariableDeclaration } from './declaration';
import { getNameNodeForDeclaration } from './declarationUtils';
import { deprecatedAliases, deprecatedSpecialForms } from './deprecatedSymbols';
import { getEnumDeclaredValueType, isEnumClassWithMembers, transformTypeForEnumMember } from './enums';
import { ImportResolver, ImportedModuleDescriptor, createImportedModuleDescriptor } from './importResolver';
import { ImportResult, ImportType } from './importResult';
import { getRelativeModuleName, getTopLevelImports } from './importStatementUtils';
import { getParamListDetails } from './parameterUtils';
import * as ParseTreeUtils from './parseTreeUtils';
import { ParseTreeWalker } from './parseTreeWalker';
import { validateClassPattern } from './patternMatching';
import { isMethodOnlyProtocol, isProtocolUnsafeOverlap } from './protocols';
import { Scope, ScopeType } from './scope';
import { getScopeForNode } from './scopeUtils';
import { IPythonMode } from './sourceFile';
import { SourceMapper, isStubFile } from './sourceMapper';
import { evaluateStaticBoolExpression } from './staticExpressions';
import { Symbol } from './symbol';
import * as SymbolNameUtils from './symbolNameUtils';
import { getLastTypedDeclarationForSymbol } from './symbolUtils';
import { getEffectiveExtraItemsEntryType, getTypedDictMembersForClass } from './typedDicts';
import { maxCodeComplexity } from './typeEvaluator';
import {
    Arg,
    AssignTypeFlags,
    FunctionTypeResult,
    MemberAccessDeprecationInfo,
    Reachability,
    TypeEvaluator,
    TypeResult,
} from './typeEvaluatorTypes';
import {
    getElementTypeForContainerNarrowing,
    getIsInstanceClassTypes,
    narrowTypeForContainerElementType,
    narrowTypeForInstanceOrSubclass,
} from './typeGuards';
import {
    AnyType,
    ClassType,
    ClassTypeFlags,
    DataClassEntry,
    EnumLiteral,
    FunctionParam,
    FunctionType,
    ModuleType,
    OverloadedType,
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
    isFunctionOrOverloaded,
    isInstantiableClass,
    isModule,
    isNever,
    isOverloaded,
    isParamSpec,
    isPossiblyUnbound,
    isTypeSame,
    isTypeVar,
    isTypeVarTuple,
    isUnbound,
    isUnion,
    isUnknown,
} from './types';
import {
    ClassMember,
    MemberAccessFlags,
    applySolvedTypeVars,
    buildSolutionFromSpecializedClass,
    convertToInstance,
    derivesFromClassRecursive,
    doForEachSubtype,
    getClassFieldsRecursive,
    getDeclaredGeneratorReturnType,
    getGeneratorTypeArgs,
    getProtocolSymbolsRecursive,
    getSpecializedTupleType,
    getTypeVarArgsRecursive,
    getTypeVarScopeIds,
    isInstantiableMetaclass,
    isLiteralType,
    isLiteralTypeOrUnion,
    isNoneInstance,
    isPartlyUnknown,
    isProperty,
    isTupleClass,
    isUnboundedTupleClass,
    lookUpClassMember,
    makeTypeVarsBound,
    mapSubtypes,
    partiallySpecializeType,
    selfSpecializeClass,
    transformPossibleRecursiveTypeAlias,
} from './typeUtils';

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
    private _typeParamLists: TypeParameterListNode[] = [];

    // A list of all visited multipart import statements.
    private _multipartImports: ImportAsNode[] = [];

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
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.codeTooComplexToAnalyze(),
                { start: 0, length: 0 }
            );
        }

        this._walkStatementsAndReportUnreachable(this._moduleNode.d.statements);

        // Mark symbols accessed by __all__ as accessed.
        const dunderAllInfo = AnalyzerNodeInfo.getDunderAllInfo(this._moduleNode);
        if (dunderAllInfo) {
            this._evaluator.markNamesAccessed(this._moduleNode, dunderAllInfo.names);

            this._reportUnusedDunderAllSymbols(dunderAllInfo.stringNodes);
        }

        // Perform a one-time validation of symbols in all scopes
        // defined in this module for things like unaccessed variables.
        this._validateSymbolTables();

        this._reportUnusedMultipartImports();

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
        this._walkStatementsAndReportUnreachable(node.d.statements);
        return false;
    }

    override visitStatementList(node: StatementListNode) {
        node.d.statements.forEach((statement) => {
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

        if (node.d.typeParams) {
            this.walk(node.d.typeParams);
        }
        this.walk(node.d.suite);
        this.walkMultiple(node.d.decorators);
        this.walkMultiple(node.d.arguments);

        if (classTypeResult) {
            // Protocol classes cannot derive from non-protocol classes.
            if (ClassType.isProtocolClass(classTypeResult.classType)) {
                node.d.arguments.forEach((arg) => {
                    if (!arg.d.name) {
                        const baseClassType = this._evaluator.getType(arg.d.valueExpr);
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
                                        classType: classTypeResult.classType.shared.name,
                                        baseType: baseClassType.shared.name,
                                    }),
                                    arg.d.valueExpr
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

            this._validateMultipleInheritanceBaseClasses(classTypeResult.classType, node.d.name);

            this._validateMultipleInheritanceCompatibility(classTypeResult.classType, node.d.name);

            this._validateConstructorConsistency(classTypeResult.classType, node.d.name);

            this._validateFinalMemberOverrides(classTypeResult.classType);

            this._validateInstanceVariableInitialization(node, classTypeResult.classType);

            this._validateFinalClassNotAbstract(classTypeResult.classType, node);

            this._validateDataClassPostInit(classTypeResult.classType);

            this._validateEnumMembers(classTypeResult.classType, node);

            if (ClassType.isTypedDictClass(classTypeResult.classType)) {
                this._validateTypedDictClassSuite(node.d.suite);
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
        if (node.d.typeParams) {
            this.walk(node.d.typeParams);
        }

        if (!this._fileInfo.diagnosticRuleSet.analyzeUnannotatedFunctions && !this._fileInfo.isStubFile) {
            if (ParseTreeUtils.isUnannotatedFunction(node)) {
                this._evaluator.addInformation(
                    LocMessage.unannotatedFunctionSkipped().format({ name: node.d.name.d.value }),
                    node.d.name
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
            const paramDetails = getParamListDetails(functionTypeResult.functionType);

            // Report any unknown or missing parameter types.
            node.d.params.forEach((param, index) => {
                if (param.d.name) {
                    if (param.d.category === ParamCategory.Simple && index >= paramDetails.positionOnlyParamCount) {
                        keywordNames.add(param.d.name.d.value);
                    }

                    // Determine whether this is a P.args parameter.
                    if (param.d.category === ParamCategory.ArgsList) {
                        const annotationExpr = param.d.annotation ?? param.d.annotationComment;
                        if (
                            annotationExpr &&
                            annotationExpr.nodeType === ParseNodeType.MemberAccess &&
                            annotationExpr.d.member.d.value === 'args'
                        ) {
                            const baseType = this._evaluator.getType(annotationExpr.d.leftExpr);
                            if (baseType && isParamSpec(baseType)) {
                                sawParamSpecArgs = true;
                            }
                        }
                    } else if (param.d.category === ParamCategory.KwargsDict) {
                        sawParamSpecArgs = false;
                    }
                }

                if (param.d.name && param.d.category === ParamCategory.Simple && sawParamSpecArgs) {
                    this._evaluator.addDiagnostic(
                        DiagnosticRule.reportGeneralTypeIssues,
                        LocMessage.namedParamAfterParamSpecArgs().format({ name: param.d.name.d.value }),
                        param.d.name
                    );
                }

                // Allow unknown and missing param types if the param is named '_'.
                if (param.d.name && param.d.name.d.value !== '_') {
                    const paramIndex = functionTypeResult.functionType.shared.parameters.findIndex(
                        (p) => p.name === param.d.name?.d.value
                    );

                    if (paramIndex >= 0) {
                        const functionTypeParam = functionTypeResult.functionType.shared.parameters[paramIndex];
                        const paramType = FunctionType.getParamType(functionTypeResult.functionType, paramIndex);

                        if (this._fileInfo.diagnosticRuleSet.reportUnknownParameterType !== 'none') {
                            if (
                                isUnknown(paramType) ||
                                (isTypeVar(paramType) &&
                                    paramType.shared.isSynthesized &&
                                    !TypeVarType.isSelf(paramType))
                            ) {
                                this._evaluator.addDiagnostic(
                                    DiagnosticRule.reportUnknownParameterType,
                                    LocMessage.paramTypeUnknown().format({ paramName: param.d.name.d.value }),
                                    param.d.name
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
                                        paramName: param.d.name.d.value,
                                    }) + diagAddendum.getString(),
                                    param.d.name
                                );
                            }
                        }

                        let hasAnnotation = false;

                        if (FunctionParam.isTypeDeclared(functionTypeParam)) {
                            hasAnnotation = true;
                        } else {
                            // See if this is a "self" and "cls" parameter. They are exempt from this rule.
                            if (isTypeVar(paramType) && TypeVarType.isSelf(paramType)) {
                                hasAnnotation = true;
                            }
                        }

                        if (!hasAnnotation && this._fileInfo.diagnosticRuleSet.reportMissingParameterType !== 'none') {
                            this._evaluator.addDiagnostic(
                                DiagnosticRule.reportMissingParameterType,
                                LocMessage.paramAnnotationMissing().format({ name: param.d.name.d.value }),
                                param.d.name
                            );
                        }
                    }
                }
            });

            // Verify that an unpacked TypedDict doesn't overlap any keyword parameters.
            if (paramDetails.hasUnpackedTypedDict) {
                const kwargsIndex = functionTypeResult.functionType.shared.parameters.length - 1;
                const kwargsType = FunctionType.getParamType(functionTypeResult.functionType, kwargsIndex);

                if (isClass(kwargsType) && kwargsType.shared.typedDictEntries) {
                    const overlappingEntries = new Set<string>();
                    kwargsType.shared.typedDictEntries.knownItems.forEach((_, name) => {
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
                            node.d.params[kwargsIndex].d.annotation ?? node.d.params[kwargsIndex]
                        );
                    }
                }
            }

            // Check for invalid use of ParamSpec P.args and P.kwargs.
            const paramSpecParams = functionTypeResult.functionType.shared.parameters.filter((param, index) => {
                const paramType = FunctionType.getParamType(functionTypeResult.functionType, index);
                if (FunctionParam.isTypeDeclared(param) && isTypeVar(paramType) && isParamSpec(paramType)) {
                    if (param.category !== ParamCategory.Simple && param.name && paramType.priv.paramSpecAccess) {
                        return true;
                    }
                }

                return false;
            });

            if (paramSpecParams.length === 1 && paramSpecParams[0].name) {
                const paramNode = node.d.params.find((param) => param.d.name?.d.value === paramSpecParams[0].name);
                const annotationNode = paramNode?.d.annotation ?? paramNode?.d.annotationComment;

                if (annotationNode) {
                    this._evaluator.addDiagnostic(
                        DiagnosticRule.reportGeneralTypeIssues,
                        LocMessage.paramSpecArgsKwargsUsage(),
                        annotationNode
                    );
                }
            }

            // If this is a stub, ensure that the return type is specified.
            if (this._fileInfo.isStubFile) {
                const returnAnnotation = node.d.returnAnnotation || node.d.funcAnnotationComment?.d.returnAnnotation;
                if (!returnAnnotation) {
                    this._evaluator.addDiagnostic(
                        DiagnosticRule.reportUnknownParameterType,
                        LocMessage.returnTypeUnknown(),
                        node.d.name
                    );
                }
            }

            if (containingClassNode) {
                this._validateMethod(node, functionTypeResult.functionType, containingClassNode);
            }
        }

        node.d.params.forEach((param, index) => {
            if (param.d.defaultValue) {
                this.walk(param.d.defaultValue);
            }

            if (param.d.annotation) {
                this.walk(param.d.annotation);
            }

            if (param.d.annotationComment) {
                this.walk(param.d.annotationComment);
            }

            // Look for method parameters that are typed with TypeVars that have the wrong variance.
            if (functionTypeResult) {
                const annotationNode = param.d.annotation || param.d.annotationComment;
                if (annotationNode && index < functionTypeResult.functionType.shared.parameters.length) {
                    const paramType = FunctionType.getParamType(functionTypeResult.functionType, index);
                    const exemptMethods = ['__init__', '__new__'];

                    if (
                        containingClassNode &&
                        isTypeVar(paramType) &&
                        paramType.priv.scopeType === TypeVarScopeType.Class &&
                        paramType.shared.declaredVariance === Variance.Covariant &&
                        !paramType.shared.isSynthesized &&
                        !exemptMethods.some((name) => name === functionTypeResult.functionType.shared.name)
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

        if (node.d.returnAnnotation) {
            this.walk(node.d.returnAnnotation);
        }

        if (node.d.funcAnnotationComment) {
            this.walk(node.d.funcAnnotationComment);

            if (
                this._fileInfo.diagnosticRuleSet.reportTypeCommentUsage !== 'none' &&
                PythonVersion.isGreaterOrEqualTo(this._fileInfo.executionEnvironment.pythonVersion, pythonVersion3_5)
            ) {
                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportTypeCommentUsage,
                    LocMessage.typeCommentDeprecated(),
                    node.d.funcAnnotationComment
                );
            }
        }

        this.walkMultiple(node.d.decorators);

        node.d.params.forEach((param) => {
            if (param.d.name) {
                this.walk(param.d.name);
            }
        });

        const codeComplexity = AnalyzerNodeInfo.getCodeFlowComplexity(node);
        const isTooComplexToAnalyze = codeComplexity > maxCodeComplexity;

        if (isPrintCodeComplexityEnabled) {
            console.log(`Code complexity of function ${node.d.name.d.value} is ${codeComplexity.toString()}`);
        }

        if (isTooComplexToAnalyze) {
            this._evaluator.addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.codeTooComplexToAnalyze(),
                node.d.name
            );
        } else {
            this.walk(node.d.suite);
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
                    LocMessage.finalNonMethod().format({ name: node.d.name.d.value }),
                    node.d.name
                );
            }
        }

        // If we're at the module level within a stub file, report a diagnostic
        // if there is a '__getattr__' function defined when in strict mode.
        // This signifies an incomplete stub file that obscures type errors.
        if (this._fileInfo.isStubFile && node.d.name.d.value === '__getattr__') {
            const scope = getScopeForNode(node);
            if (scope?.type === ScopeType.Module) {
                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportIncompleteStub,
                    LocMessage.stubUsesGetAttr(),
                    node.d.name
                );
            }
        }

        this._scopedNodes.push(node);

        if (
            functionTypeResult &&
            isOverloaded(functionTypeResult.decoratedType) &&
            functionTypeResult.functionType.priv.overloaded
        ) {
            // If this is the implementation for the overloaded function, skip
            // overload consistency checks.
            if (
                OverloadedType.getImplementation(functionTypeResult.decoratedType) !== functionTypeResult.functionType
            ) {
                const overloads = OverloadedType.getOverloads(functionTypeResult.decoratedType);
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
        this.walkMultiple([...node.d.params, node.d.expr]);

        node.d.params.forEach((param) => {
            if (param.d.name) {
                const paramType = this._evaluator.getType(param.d.name);
                if (paramType) {
                    if (isUnknown(paramType)) {
                        this._evaluator.addDiagnostic(
                            DiagnosticRule.reportUnknownLambdaType,
                            LocMessage.paramTypeUnknown().format({ paramName: param.d.name.d.value }),
                            param.d.name
                        );
                    } else if (isPartlyUnknown(paramType)) {
                        this._evaluator.addDiagnostic(
                            DiagnosticRule.reportUnknownLambdaType,
                            LocMessage.paramTypePartiallyUnknown().format({ paramName: param.d.name.d.value }),
                            param.d.name
                        );
                    }
                }
            }
        });

        const returnType = this._evaluator.getType(node.d.expr);
        if (returnType) {
            if (isUnknown(returnType)) {
                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportUnknownLambdaType,
                    LocMessage.lambdaReturnTypeUnknown(),
                    node.d.expr
                );
            } else if (isPartlyUnknown(returnType)) {
                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportUnknownLambdaType,
                    LocMessage.lambdaReturnTypePartiallyUnknown().format({
                        returnType: this._evaluator.printType(returnType, { expandTypeAlias: true }),
                    }),
                    node.d.expr
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
                    node.d.leftExpr.nodeType === ParseNodeType.Name && node.d.leftExpr.d.value === 'reveal_type';
                const returnType = this._evaluator.getType(node);

                if (!isRevealTypeCall && returnType && this._isTypeValidForUnusedValueTest(returnType)) {
                    this._evaluator.addDiagnostic(
                        DiagnosticRule.reportUnusedCallResult,
                        LocMessage.unusedCallResult().format({
                            type: this._evaluator.printType(returnType),
                        }),
                        node
                    );

                    if (
                        isClassInstance(returnType) &&
                        ClassType.isBuiltIn(returnType, ['Coroutine', 'CoroutineType'])
                    ) {
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
            if (node.parent?.nodeType === ParseNodeType.StatementList && node.d.expr.nodeType === ParseNodeType.Call) {
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

        if (node.d.typeComment) {
            this._evaluator.addDiagnosticForTextRange(
                this._fileInfo,
                DiagnosticRule.reportInvalidTypeForm,
                LocMessage.annotationNotSupported(),
                node.d.typeComment
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

    override visitComprehension(node: ComprehensionNode): boolean {
        this._scopedNodes.push(node);
        return true;
    }

    override visitComprehensionIf(node: ComprehensionIfNode): boolean {
        this._validateConditionalIsBool(node.d.testExpr);
        this._reportUnnecessaryConditionExpression(node.d.testExpr);
        return true;
    }

    override visitIf(node: IfNode): boolean {
        this._validateConditionalIsBool(node.d.testExpr);
        this._reportUnnecessaryConditionExpression(node.d.testExpr);
        return true;
    }

    override visitWhile(node: WhileNode): boolean {
        this._validateConditionalIsBool(node.d.testExpr);
        this._reportUnnecessaryConditionExpression(node.d.testExpr);
        return true;
    }

    override visitWith(node: WithNode): boolean {
        node.d.withItems.forEach((item) => {
            this._evaluator.evaluateTypesForStatement(item);
        });

        if (node.d.typeComment) {
            this._evaluator.addDiagnosticForTextRange(
                this._fileInfo,
                DiagnosticRule.reportInvalidTypeForm,
                LocMessage.annotationNotSupported(),
                node.d.typeComment
            );
        }

        return true;
    }

    override visitReturn(node: ReturnNode): boolean {
        let returnTypeResult: TypeResult;
        let returnType: Type | undefined;

        const enclosingFunctionNode = ParseTreeUtils.getEnclosingFunction(node);
        let declaredReturnType = enclosingFunctionNode
            ? this._evaluator.getDeclaredReturnType(enclosingFunctionNode)
            : undefined;

        if (node.d.expr) {
            returnTypeResult = this._evaluator.getTypeResult(node.d.expr) ?? { type: UnknownType.create() };
        } else {
            // There is no return expression, so "None" is assumed.
            returnTypeResult = { type: this._evaluator.getNoneType() };
        }

        returnType = returnTypeResult.type;

        // If this type is a special form, use the special form instead.
        if (returnType.props?.specialForm) {
            returnType = returnType.props.specialForm;
        }

        // If the enclosing function is async and a generator, the return
        // statement is not allowed to have an argument. A syntax error occurs
        // at runtime in this case.
        if (enclosingFunctionNode?.d.isAsync && node.d.expr) {
            const functionDecl = AnalyzerNodeInfo.getDeclaration(enclosingFunctionNode);
            if (functionDecl?.type === DeclarationType.Function && functionDecl.isGenerator) {
                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportGeneralTypeIssues,
                    LocMessage.returnInAsyncGenerator(),
                    node.d.expr
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
                    const liveScopes = ParseTreeUtils.getTypeVarScopesForNode(node);
                    declaredReturnType = this._evaluator.stripTypeGuard(declaredReturnType);
                    let adjReturnType = makeTypeVarsBound(declaredReturnType, liveScopes);

                    let diagAddendum = new DiagnosticAddendum();
                    let returnTypeMatches = false;

                    if (this._evaluator.assignType(adjReturnType, returnType, diagAddendum)) {
                        returnTypeMatches = true;
                    } else {
                        // See if the declared return type includes one or more constrained TypeVars. If so,
                        // try to narrow these TypeVars to a single type.
                        const uniqueTypeVars = getTypeVarArgsRecursive(declaredReturnType);

                        if (uniqueTypeVars && uniqueTypeVars.some((typeVar) => TypeVarType.hasConstraints(typeVar))) {
                            const constraints = new ConstraintTracker();

                            for (const typeVar of uniqueTypeVars) {
                                if (TypeVarType.hasConstraints(typeVar)) {
                                    const narrowedType = this._evaluator.narrowConstrainedTypeVar(
                                        node,
                                        TypeVarType.cloneAsBound(typeVar)
                                    );
                                    if (narrowedType) {
                                        constraints.setBounds(typeVar, narrowedType);
                                    }
                                }
                            }

                            if (!constraints.isEmpty()) {
                                adjReturnType = this._evaluator.solveAndApplyConstraints(
                                    declaredReturnType,
                                    constraints
                                );
                                adjReturnType = makeTypeVarsBound(adjReturnType, liveScopes);

                                if (this._evaluator.assignType(adjReturnType, returnType, diagAddendum)) {
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
                            node.d.expr ?? node,
                            returnTypeResult.expectedTypeDiagAddendum?.getEffectiveTextRange()
                        );
                    }
                }
            }

            if (isUnknown(returnType)) {
                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportUnknownVariableType,
                    LocMessage.returnTypeUnknown(),
                    node.d.expr ?? node
                );
            } else if (isPartlyUnknown(returnType)) {
                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportUnknownVariableType,
                    LocMessage.returnTypePartiallyUnknown().format({
                        returnType: this._evaluator.printType(returnType, { expandTypeAlias: true }),
                    }),
                    node.d.expr ?? node
                );
            }
        }

        return true;
    }

    override visitYield(node: YieldNode) {
        const yieldTypeResult = node.d.expr
            ? this._evaluator.getTypeResult(node.d.expr)
            : { type: this._evaluator.getNoneType() };
        this._validateYieldType(
            node,
            yieldTypeResult?.type ?? UnknownType.create(),
            yieldTypeResult?.expectedTypeDiagAddendum
        );
        return true;
    }

    override visitYieldFrom(node: YieldFromNode) {
        const yieldFromType = this._evaluator.getType(node.d.expr) || UnknownType.create();
        let yieldType: Type | undefined;
        let sendType: Type | undefined;

        if (isClassInstance(yieldFromType) && ClassType.isBuiltIn(yieldFromType, ['Coroutine', 'CoroutineType'])) {
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
        if (node.d.expr) {
            this._evaluator.verifyRaiseExceptionType(node.d.expr, /* allowNone */ false);
        }

        if (node.d.fromExpr) {
            this._evaluator.verifyRaiseExceptionType(node.d.fromExpr, /* allowNone */ true);
        }

        return true;
    }

    override visitExcept(node: ExceptNode): boolean {
        if (node.d.typeExpr) {
            this._evaluator.evaluateTypesForStatement(node);

            const exceptionType = this._evaluator.getType(node.d.typeExpr);
            if (exceptionType) {
                this._validateExceptionType(exceptionType, node.d.typeExpr, node.d.isExceptGroup);
            }
        }

        return true;
    }

    override visitAssert(node: AssertNode) {
        if (node.d.exceptionExpr) {
            this._evaluator.getType(node.d.exceptionExpr);
        }

        this._validateConditionalIsBool(node.d.testExpr);

        // Specifically look for a common programming error where the two arguments
        // to an assert are enclosed in parens and interpreted as a two-element tuple.
        //   assert (x > 3, "bad value x")
        const type = this._evaluator.getType(node.d.testExpr);
        if (type && isClassInstance(type)) {
            if (isTupleClass(type) && type.priv.tupleTypeArgs) {
                if (type.priv.tupleTypeArgs.length > 0) {
                    if (!isUnboundedTupleClass(type)) {
                        this._evaluator.addDiagnosticForTextRange(
                            this._fileInfo,
                            DiagnosticRule.reportAssertAlwaysTrue,
                            LocMessage.assertAlwaysTrue(),
                            node.d.testExpr
                        );
                    }
                }
            }
        }

        return true;
    }

    override visitAssignment(node: AssignmentNode): boolean {
        this._evaluator.evaluateTypesForStatement(node);

        if (node.d.annotationComment) {
            this._evaluator.getType(node.d.annotationComment);

            if (
                this._fileInfo.diagnosticRuleSet.reportTypeCommentUsage !== 'none' &&
                PythonVersion.isGreaterOrEqualTo(this._fileInfo.executionEnvironment.pythonVersion, pythonVersion3_6)
            ) {
                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportTypeCommentUsage,
                    LocMessage.typeCommentDeprecated(),
                    node.d.annotationComment
                );
            }
        }

        // If this isn't a class or global scope, explicit type aliases are not allowed.
        if (node.d.leftExpr.nodeType === ParseNodeType.TypeAnnotation) {
            const annotationType = this._evaluator.getTypeOfAnnotation(node.d.leftExpr.d.annotation);

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
                            node.d.leftExpr.d.annotation
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
        const typeResult = this._evaluator.getTypeResult(node);
        this._reportDeprecatedUseForOperation(node.d.destExpr, typeResult);

        return true;
    }

    override visitIndex(node: IndexNode): boolean {
        this._evaluator.getType(node);

        // If the index is a literal integer, see if this is a tuple with
        // a known length and the integer value exceeds the length.
        const baseType = this._evaluator.getType(node.d.leftExpr);
        if (baseType) {
            doForEachSubtype(baseType, (subtype) => {
                const tupleType = getSpecializedTupleType(subtype);

                if (!isClassInstance(subtype) || !tupleType?.priv.tupleTypeArgs || isUnboundedTupleClass(tupleType)) {
                    return;
                }

                const tupleLength = tupleType.priv.tupleTypeArgs.length;

                if (
                    node.d.items.length !== 1 ||
                    node.d.trailingComma ||
                    node.d.items[0].d.argCategory !== ArgCategory.Simple ||
                    node.d.items[0].d.name
                ) {
                    return;
                }

                const subscriptType = this._evaluator.getType(node.d.items[0].d.valueExpr);
                if (
                    !subscriptType ||
                    !isClassInstance(subscriptType) ||
                    !ClassType.isBuiltIn(subscriptType, 'int') ||
                    !isLiteralType(subscriptType) ||
                    typeof subscriptType.priv.literalValue !== 'number'
                ) {
                    return;
                }

                if (
                    (subscriptType.priv.literalValue < 0 || subscriptType.priv.literalValue < tupleLength) &&
                    (subscriptType.priv.literalValue >= 0 || subscriptType.priv.literalValue + tupleLength >= 0)
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
                        index: subscriptType.priv.literalValue,
                        type: this._evaluator.printType(subtype),
                    }),
                    node
                );
            });
        }

        return true;
    }

    override visitBinaryOperation(node: BinaryOperationNode): boolean {
        if (node.d.operator === OperatorType.Equals || node.d.operator === OperatorType.NotEquals) {
            // Don't apply this rule if it's within an assert.
            if (!ParseTreeUtils.isWithinAssertExpression(node)) {
                this._validateComparisonTypes(node);
            }
        } else if (node.d.operator === OperatorType.Is || node.d.operator === OperatorType.IsNot) {
            // Don't apply this rule if it's within an assert.
            if (!ParseTreeUtils.isWithinAssertExpression(node)) {
                this._validateComparisonTypes(node);
            }
        } else if (node.d.operator === OperatorType.In || node.d.operator === OperatorType.NotIn) {
            // Don't apply this rule if it's within an assert.
            if (!ParseTreeUtils.isWithinAssertExpression(node)) {
                this._validateContainmentTypes(node);
            }
        }

        const typeResult = this._evaluator.getTypeResult(node);
        this._reportDeprecatedUseForOperation(node.d.leftExpr, typeResult);

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
        if (node.d.operator === OperatorType.Not) {
            this._validateConditionalIsBool(node.d.expr);
        }

        const typeResult = this._evaluator.getTypeResult(node);
        this._reportDeprecatedUseForOperation(node.d.expr, typeResult);

        return true;
    }

    override visitTernary(node: TernaryNode): boolean {
        this._evaluator.getType(node);
        this._validateConditionalIsBool(node.d.testExpr);
        this._reportUnnecessaryConditionExpression(node.d.testExpr);
        return true;
    }

    override visitStringList(node: StringListNode): boolean {
        // If this is Python 3.11 or older, there are several restrictions
        // associated with f-strings that we need to validate. Determine whether
        // we're within an f-string (or multiple f-strings if nesting is used).
        const fStringContainers: FormatStringNode[] = [];
        if (PythonVersion.isLessThan(this._fileInfo.executionEnvironment.pythonVersion, pythonVersion3_12)) {
            let curNode: ParseNode | undefined = node;
            while (curNode) {
                if (curNode.nodeType === ParseNodeType.FormatString) {
                    fStringContainers.push(curNode);
                }
                curNode = curNode.parent;
            }
        }

        for (const stringNode of node.d.strings) {
            const stringTokens =
                stringNode.nodeType === ParseNodeType.String ? [stringNode.d.token] : stringNode.d.middleTokens;

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
                            DiagnosticRule.reportInvalidStringEscapeSequence,
                            node.d.strings.some((string) => (string.d.token.flags & StringTokenFlags.Bytes) !== 0)
                                ? LocMessage.bytesUnsupportedEscape()
                                : LocMessage.stringUnsupportedEscape(),
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
                            (fStringContainer.d.token.flags & quoteTypeMask) ===
                            (stringNode.d.token.flags & quoteTypeMask)
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

        if (node.d.annotation) {
            this._evaluator.getType(node);
        }

        if (node.d.strings.length > 1 && !node.d.hasParens) {
            this._evaluator.addDiagnosticForTextRange(
                this._fileInfo,
                DiagnosticRule.reportImplicitStringConcatenation,
                LocMessage.implicitStringConcat(),
                node
            );
        }

        return true;
    }

    override visitFormatString(node: FormatStringNode): boolean {
        node.d.fieldExprs.forEach((expr) => {
            this._evaluator.getType(expr);
        });

        node.d.formatExprs.forEach((expr) => {
            this._evaluator.getType(expr);
        });

        return true;
    }

    override visitGlobal(node: GlobalNode): boolean {
        this._suppressUnboundCheck(() => {
            node.d.targets.forEach((name) => {
                this._evaluator.getType(name);

                this.walk(name);
            });
        });

        return false;
    }

    override visitNonlocal(node: NonlocalNode): boolean {
        this._suppressUnboundCheck(() => {
            node.d.targets.forEach((name) => {
                this._evaluator.getType(name);

                this.walk(name);

                this._validateNonlocalTypeParam(name);
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
        node.d.targets.forEach((expr) => {
            this._evaluator.verifyDeleteExpression(expr);

            this.walk(expr);
        });

        return false;
    }

    override visitMemberAccess(node: MemberAccessNode) {
        const typeResult = this._evaluator.getTypeResult(node.d.member);
        const type = typeResult?.type ?? UnknownType.create();

        const leftExprType = this._evaluator.getType(node.d.leftExpr);
        const moduleName = leftExprType && isModule(leftExprType) ? leftExprType.priv.moduleName : undefined;
        const isImportedFromTyping = moduleName === 'typing' || moduleName === 'typing_extensions';
        this._reportDeprecatedUseForType(node.d.member, type, isImportedFromTyping);

        if (typeResult?.memberAccessDeprecationInfo) {
            this._reportDeprecatedUseForMemberAccess(node.d.member, typeResult.memberAccessDeprecationInfo);
        }

        this._conditionallyReportPrivateUsage(node.d.member);

        // Walk the leftExpression but not the memberName.
        this.walk(node.d.leftExpr);

        return false;
    }

    override visitImportAs(node: ImportAsNode): boolean {
        this._conditionallyReportShadowedImport(node);
        this._evaluator.evaluateTypesForStatement(node);

        const nameParts = node.d.module.d.nameParts;
        if (nameParts.length > 1 && !node.d.alias) {
            this._multipartImports.push(node);
        }

        return true;
    }

    override visitImportFrom(node: ImportFromNode): boolean {
        // Verify that any "__future__" import occurs at the top of the file.
        if (
            node.d.module.d.leadingDots === 0 &&
            node.d.module.d.nameParts.length === 1 &&
            node.d.module.d.nameParts[0].d.value === '__future__'
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

        if (!node.d.isWildcardImport) {
            node.d.imports.forEach((importAs) => {
                this._evaluator.evaluateTypesForStatement(importAs);
            });
        } else {
            this._evaluator.evaluateTypesForStatement(node);

            const importInfo = AnalyzerNodeInfo.getImportInfo(node.d.module);
            if (
                importInfo &&
                importInfo.isImportFound &&
                importInfo.importType !== ImportType.Local &&
                !this._fileInfo.isStubFile
            ) {
                this._evaluator.addDiagnosticForTextRange(
                    this._fileInfo,
                    DiagnosticRule.reportWildcardImportFromLibrary,
                    LocMessage.wildcardLibraryImport(),
                    node.d.wildcardToken || node
                );
            }
        }

        return true;
    }

    override visitImportFromAs(node: ImportFromAsNode): boolean {
        if (this._fileInfo.isStubFile) {
            return false;
        }

        const decls = this._evaluator.getDeclInfoForNameNode(node.d.name)?.decls;
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

            this._addMissingModuleSourceDiagnosticIfNeeded(importResult, node.d.name);
            break;
        }

        let isImportFromTyping = false;
        if (node.parent?.nodeType === ParseNodeType.ImportFrom) {
            if (node.parent.d.module.d.leadingDots === 0 && node.parent.d.module.d.nameParts.length === 1) {
                const namePart = node.parent.d.module.d.nameParts[0].d.value;
                if (namePart === 'typing' || namePart === 'typing_extensions') {
                    isImportFromTyping = true;
                }
            }
        }

        const type = this._evaluator.getType(node.d.alias ?? node.d.name);
        this._reportDeprecatedUseForType(node.d.name, type, isImportFromTyping);

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
        this._typeParamLists.push(node);
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

                if (classType?.shared.typeParams.some((param) => param.shared.name === node.d.name.d.value)) {
                    foundDuplicate = true;
                    break;
                }
            } else if (typeVarScopeNode.nodeType === ParseNodeType.Function) {
                const functionType = this._evaluator.getTypeOfFunction(typeVarScopeNode)?.functionType;

                if (functionType?.shared.typeParams.some((param) => param.shared.name === node.d.name.d.value)) {
                    foundDuplicate = true;
                    break;
                }
            }

            curNode = typeVarScopeNode.parent;
        }

        if (foundDuplicate) {
            this._evaluator.addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.typeVarUsedByOuterScope().format({ name: node.d.name.d.value }),
                node.d.name
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
                    node.d.name
                );
            }
        }

        return true;
    }

    override visitTypeAnnotation(node: TypeAnnotationNode): boolean {
        this._evaluator.getType(node.d.annotation);
        return true;
    }

    override visitMatch(node: MatchNode): boolean {
        this._evaluator.getType(node.d.expr);
        this._validateExhaustiveMatch(node);
        return true;
    }

    override visitCase(node: CaseNode): boolean {
        if (node.d.guardExpr) {
            this._validateConditionalIsBool(node.d.guardExpr);
        }

        this._evaluator.evaluateTypesForStatement(node.d.pattern);
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
        if (node.d.child) {
            this._evaluator.getType(node.d.child);
        }

        // Don't explore further.
        return false;
    }

    private _reportUnusedMultipartImports() {
        this._multipartImports.forEach((node) => {
            const nameParts = node.d.module.d.nameParts;

            if (this._isMultipartImportUnused(node)) {
                const multipartName = nameParts.map((np) => np.d.value).join('.');
                let textRange: TextRange = { start: nameParts[0].start, length: nameParts[0].length };
                textRange = TextRange.extend(textRange, nameParts[nameParts.length - 1]);

                this._fileInfo.diagnosticSink.addUnusedCodeWithTextRange(
                    LocMessage.unaccessedSymbol().format({ name: multipartName }),
                    textRange,
                    { action: Commands.unusedImport }
                );

                this._evaluator.addDiagnosticForTextRange(
                    this._fileInfo,
                    DiagnosticRule.reportUnusedImport,
                    LocMessage.unaccessedImport().format({ name: multipartName }),
                    textRange
                );
            }
        });
    }

    private _isMultipartImportUnused(node: ImportAsNode): boolean {
        const nameParts = node.d.module.d.nameParts;
        assert(nameParts.length > 1);

        // Get the top-level module type associated with this import.
        let moduleType = this._evaluator.evaluateTypeForSubnode(node, () => {
            this._evaluator.evaluateTypesForStatement(node);
        })?.type;

        if (!moduleType || !isModule(moduleType)) {
            return false;
        }

        // Walk the module hierarchy to get the submodules in the
        // multi-name import path until we get to the second-to-the-last
        // part.
        for (let i = 1; i < nameParts.length - 1; i++) {
            const symbol = ModuleType.getField(moduleType, nameParts[i].d.value);
            if (!symbol) {
                return false;
            }

            const submoduleType = symbol.getSynthesizedType();
            if (!submoduleType || !isModule(submoduleType.type)) {
                return false;
            }

            moduleType = submoduleType.type;
        }

        // Look up the last part of the import to get its symbol ID.
        const lastPartName = nameParts[nameParts.length - 1].d.value;
        const symbol = ModuleType.getField(moduleType, lastPartName);

        if (!symbol) {
            return false;
        }

        return !this._fileInfo.accessedSymbolSet.has(symbol.id);
    }

    private _getImportResult(node: ImportFromAsNode, uri: Uri) {
        const execEnv = this._importResolver.getConfigOptions().findExecEnvironment(uri);
        const moduleNameNode = (node.parent as ImportFromNode).d.module;

        // Handle both absolute and relative imports.
        const moduleName =
            moduleNameNode.d.leadingDots === 0
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
            )?.type;

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
            if (expression.d.operator === OperatorType.And || expression.d.operator === OperatorType.Or) {
                this._reportUnnecessaryConditionExpression(expression.d.leftExpr);
                this._reportUnnecessaryConditionExpression(expression.d.rightExpr);
            }

            return;
        } else if (expression.nodeType === ParseNodeType.UnaryOperation) {
            if (expression.d.operator === OperatorType.Not) {
                this._reportUnnecessaryConditionExpression(expression.d.expr);
            }

            return;
        }

        const exprTypeResult = this._evaluator.getTypeOfExpression(expression);
        let isExprFunction = true;
        let isCoroutine = true;

        doForEachSubtype(exprTypeResult.type, (subtype) => {
            subtype = this._evaluator.makeTopLevelTypeVarsConcrete(subtype);

            if (!isFunctionOrOverloaded(subtype)) {
                isExprFunction = false;
            }

            if (!isClassInstance(subtype) || !ClassType.isBuiltIn(subtype, ['Coroutine', 'CoroutineType'])) {
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
            if (!node.d.items.some((entry) => entry.nodeType === ParseNodeType.Comprehension)) {
                reportAsUnused = true;
            }
        }

        if (
            reportAsUnused &&
            this._fileInfo.ipythonMode === IPythonMode.CellDocs &&
            node.parent?.nodeType === ParseNodeType.StatementList &&
            node.parent.d.statements[node.parent.d.statements.length - 1] === node &&
            node.parent.parent?.nodeType === ParseNodeType.Module &&
            node.parent.parent.d.statements[node.parent.parent.d.statements.length - 1] === node.parent
        ) {
            // Exclude an expression at the end of a notebook cell, as that is treated as
            // the cell's value.
            reportAsUnused = false;
        }

        if (reportAsUnused) {
            this._evaluator.addDiagnostic(DiagnosticRule.reportUnusedExpression, LocMessage.unusedExpression(), node);
        }
    }

    // Verifies that the target of a nonlocal statement is not a PEP 695-style
    // TypeParameter. This situation results in a runtime exception.
    private _validateNonlocalTypeParam(node: NameNode) {
        // Look up the symbol to see if it's a type parameter.
        const symbolWithScope = this._evaluator.lookUpSymbolRecursive(node, node.d.value, /* honorCodeFlow */ false);
        if (!symbolWithScope || symbolWithScope.scope.type !== ScopeType.TypeParameter) {
            return;
        }

        this._evaluator.addDiagnostic(
            DiagnosticRule.reportGeneralTypeIssues,
            LocMessage.nonlocalTypeParam().format({ name: node.d.value }),
            node
        );
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
                node.d.expr
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
        const leftType = this._evaluator.getType(node.d.leftExpr);

        if (
            leftType &&
            isInstantiableClass(leftType) &&
            ClassType.isBuiltIn(leftType) &&
            !leftType.priv.includeSubclasses &&
            leftType.priv.aliasName
        ) {
            const nonInstantiable = ['List', 'Set', 'Dict', 'Tuple'];

            if (nonInstantiable.some((name) => name === leftType.priv.aliasName)) {
                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportGeneralTypeIssues,
                    LocMessage.collectionAliasInstantiation().format({
                        type: leftType.priv.aliasName,
                        alias: leftType.shared.name,
                    }),
                    node.d.leftExpr
                );
            }
        }
    }

    private _validateContainmentTypes(node: BinaryOperationNode) {
        const leftType = this._evaluator.getType(node.d.leftExpr);
        const containerType = this._evaluator.getType(node.d.rightExpr);

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
                return node.d.operator === OperatorType.In
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

    // Determines whether the types of the two operands for an == or != operation
    // have overlapping types.
    private _validateComparisonTypes(node: BinaryOperationNode) {
        let rightExpression = node.d.rightExpr;
        const assumeIsOperator = node.d.operator === OperatorType.Is || node.d.operator === OperatorType.IsNot;

        // Check for chained comparisons.
        if (
            rightExpression.nodeType === ParseNodeType.BinaryOperation &&
            !rightExpression.d.hasParens &&
            ParseTreeUtils.operatorSupportsChaining(rightExpression.d.operator)
        ) {
            // Use the left side of the right expression for comparison purposes.
            rightExpression = rightExpression.d.leftExpr;
        }

        const leftType = this._evaluator.getType(node.d.leftExpr);
        const rightType = this._evaluator.getType(rightExpression);

        if (!leftType || !rightType) {
            return;
        }

        if (isNever(leftType) || isNever(rightType)) {
            return;
        }

        const getMessage = () => {
            return node.d.operator === OperatorType.Equals || node.d.operator === OperatorType.Is
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

                doForEachSubtype(rightType, (rightSubtype) => {
                    if (this._evaluator.assignType(leftType, rightSubtype)) {
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

            this._evaluator.mapSubtypesExpandTypeVars(leftType, {}, (leftSubtype) => {
                if (isComparable) {
                    return;
                }

                this._evaluator.mapSubtypesExpandTypeVars(rightType, {}, (rightSubtype) => {
                    if (isComparable) {
                        return;
                    }

                    if (this._evaluator.isTypeComparable(leftSubtype, rightSubtype, assumeIsOperator)) {
                        isComparable = true;
                    }

                    return rightSubtype;
                });

                return leftSubtype;
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

    // If the function is a generator, validates that its annotated return type
    // is appropriate for a generator.
    private _validateGeneratorReturnType(node: FunctionNode, functionType: FunctionType) {
        if (!FunctionType.isGenerator(functionType)) {
            return;
        }

        const declaredReturnType = functionType.shared.declaredReturnType;
        if (!declaredReturnType) {
            return;
        }

        if (isNever(declaredReturnType)) {
            return;
        }

        const functionDecl = functionType.shared.declaration;
        if (!functionDecl || !functionDecl.yieldStatements || functionDecl.yieldStatements.length === 0) {
            return;
        }

        let generatorType: Type | undefined;
        if (
            !node.d.isAsync &&
            isClassInstance(declaredReturnType) &&
            ClassType.isBuiltIn(declaredReturnType, 'AwaitableGenerator')
        ) {
            // Handle the old-style (pre-await) generator case
            // if the return type explicitly uses AwaitableGenerator.
            generatorType =
                this._evaluator.getTypeCheckerInternalsType(node, 'AwaitableGenerator') ??
                this._evaluator.getTypingType(node, 'AwaitableGenerator');
        } else {
            generatorType = this._evaluator.getTypingType(node, node.d.isAsync ? 'AsyncGenerator' : 'Generator');
        }

        if (!generatorType || !isInstantiableClass(generatorType)) {
            return;
        }

        const specializedGenerator = ClassType.cloneAsInstance(
            ClassType.specialize(generatorType, [AnyType.create(), AnyType.create(), AnyType.create()])
        );

        const diagAddendum = new DiagnosticAddendum();
        if (!this._evaluator.assignType(declaredReturnType, specializedGenerator, diagAddendum)) {
            const errorMessage = node.d.isAsync
                ? LocMessage.generatorAsyncReturnType()
                : LocMessage.generatorSyncReturnType();

            this._evaluator.addDiagnostic(
                DiagnosticRule.reportInvalidTypeForm,
                errorMessage.format({ yieldType: this._evaluator.printType(AnyType.create()) }) +
                    diagAddendum.getString(),
                node.d.returnAnnotation ?? node.d.name
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
        if (FunctionType.isInstanceMethod(type) && node.d.name.d.value === '__init__') {
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
            if (nameType && isTypeVar(nameType) && !TypeVarType.isSelf(nameType)) {
                // Does this name refer to a TypeVar that is scoped to this function?
                if (nameType.priv.scopeId === ParseTreeUtils.getScopeIdForNode(node)) {
                    // We exempt constrained TypeVars, TypeVars that are type arguments of
                    // other types, and ParamSpecs. There are legitimate uses for singleton
                    // instances in these particular cases.
                    let isExempt =
                        TypeVarType.hasConstraints(nameType) ||
                        nameType.shared.isDefaultExplicit ||
                        (exemptBoundTypeVar && subscriptIndex !== undefined) ||
                        isParamSpec(nameType);

                    if (!isExempt && baseExpression && subscriptIndex !== undefined) {
                        // Is this a type argument for a generic type alias? If so,
                        // exempt it from the check because the type alias may repeat
                        // the TypeVar multiple times.
                        const baseType = this._evaluator.getType(baseExpression);
                        const aliasInfo = baseType?.props?.typeAliasInfo;
                        if (aliasInfo?.shared.typeParams && subscriptIndex < aliasInfo.shared.typeParams.length) {
                            isExempt = true;
                        }
                    }

                    const existingEntry = localTypeVarUsage.get(nameType.shared.name);
                    const isParamTypeWithEllipsisUsage =
                        curParamNode?.d.defaultValue?.nodeType === ParseNodeType.Ellipsis;

                    if (!existingEntry) {
                        localTypeVarUsage.set(nameType.shared.name, {
                            nodes: [nameNode],
                            typeVar: nameType,
                            paramTypeUsageCount: curParamNode !== undefined ? 1 : 0,
                            paramTypeWithEllipsisUsageCount: isParamTypeWithEllipsisUsage ? 1 : 0,
                            returnTypeUsageCount: curParamNode === undefined ? 1 : 0,
                            paramWithEllipsis: isParamTypeWithEllipsisUsage ? curParamNode?.d.name?.d.value : undefined,
                            isExempt,
                        });
                    } else {
                        existingEntry.nodes.push(nameNode);
                        if (curParamNode !== undefined) {
                            existingEntry.paramTypeUsageCount += 1;
                            if (isParamTypeWithEllipsisUsage) {
                                existingEntry.paramTypeWithEllipsisUsageCount += 1;
                                if (!existingEntry.paramWithEllipsis) {
                                    existingEntry.paramWithEllipsis = curParamNode?.d.name?.d.value;
                                }
                            }
                        } else {
                            existingEntry.returnTypeUsageCount += 1;
                        }
                    }
                }

                // Does this name refer to a TypeVar that is scoped to the class associated with
                // this constructor method?
                if (constructorClass && nameType.priv.scopeId === constructorClass.shared.typeVarScopeId) {
                    const existingEntry = classTypeVarUsage.get(nameType.shared.name);
                    const isParamTypeWithEllipsisUsage =
                        curParamNode?.d.defaultValue?.nodeType === ParseNodeType.Ellipsis;
                    const isExempt = !!nameType.shared.isDefaultExplicit;

                    if (!existingEntry) {
                        classTypeVarUsage.set(nameType.shared.name, {
                            typeVar: nameType,
                            nodes: [nameNode],
                            paramTypeUsageCount: curParamNode !== undefined ? 1 : 0,
                            paramTypeWithEllipsisUsageCount: isParamTypeWithEllipsisUsage ? 1 : 0,
                            returnTypeUsageCount: 0,
                            paramWithEllipsis: isParamTypeWithEllipsisUsage ? curParamNode?.d.name?.d.value : undefined,
                            isExempt,
                        });
                    } else {
                        existingEntry.nodes.push(nameNode);
                        if (curParamNode !== undefined) {
                            existingEntry.paramTypeUsageCount += 1;
                            if (isParamTypeWithEllipsisUsage) {
                                existingEntry.paramTypeWithEllipsisUsageCount += 1;
                                if (!existingEntry.paramWithEllipsis) {
                                    existingEntry.paramWithEllipsis = curParamNode?.d.name?.d.value;
                                }
                            }
                        }
                    }
                }
            }
        });

        // Find all of the local type variables in signature.
        node.d.params.forEach((param) => {
            const annotation = param.d.annotation || param.d.annotationComment;
            if (annotation) {
                curParamNode = param;
                nameWalker.walk(annotation);
            }
        });
        curParamNode = undefined;

        if (node.d.returnAnnotation) {
            // Don't exempt the use of a bound TypeVar when used as a type argument
            // within a return type. This exemption applies only to input parameter
            // annotations.
            exemptBoundTypeVar = false;
            nameWalker.walk(node.d.returnAnnotation);
        }

        if (node.d.funcAnnotationComment) {
            node.d.funcAnnotationComment.d.paramAnnotations.forEach((expr) => {
                nameWalker.walk(expr);
            });

            if (node.d.funcAnnotationComment.d.returnAnnotation) {
                exemptBoundTypeVar = false;
                nameWalker.walk(node.d.funcAnnotationComment.d.returnAnnotation);
            }
        }

        localTypeVarUsage.forEach((usage) => {
            // Report error for local type variable that appears only once.
            if (usage.nodes.length === 1 && !usage.isExempt) {
                let altTypeText: string;

                if (isTypeVarTuple(usage.typeVar)) {
                    altTypeText = '"tuple[object, ...]"';
                } else if (usage.typeVar.shared.boundType) {
                    altTypeText = `"${this._evaluator.printType(convertToInstance(usage.typeVar.shared.boundType))}"`;
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
                        name: usage.nodes[0].d.value,
                    }) + diag.getString(),
                    usage.nodes[0]
                );
            }

            // Report error for local type variable that appears in return type
            // (but not as a top-level TypeVar within a union) and appears only
            // within parameters that have default values. These may go unsolved.
            let isUsedInReturnType = usage.returnTypeUsageCount > 0;
            if (usage.returnTypeUsageCount === 1 && type.shared.declaredReturnType) {
                // If the TypeVar appears only once in the return type and it's a top-level
                // TypeVar within a union, exempt it from this check. Although these
                // TypeVars may go unsolved, they can be safely eliminated from the union
                // without generating an Unknown type.
                const returnType = type.shared.declaredReturnType;
                if (
                    isUnion(returnType) &&
                    returnType.priv.subtypes.some(
                        (subtype) => isTypeVar(subtype) && subtype.shared.name === usage.nodes[0].d.value
                    )
                ) {
                    isUsedInReturnType = false;
                }
            }

            // Skip this check if the function is overloaded because the TypeVar
            // will be solved in terms of the overload signatures.
            const skipUnsolvableTypeVarCheck =
                isOverloaded(functionTypeResult.decoratedType) &&
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
                        name: usage.nodes[0].d.value,
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
                        name: usage.nodes[0].d.value,
                        param: usage.paramWithEllipsis ?? '',
                    }) + diag.getString(),
                    usage.nodes[0]
                );
            }
        });
    }

    // Validates that overloads use @staticmethod and @classmethod consistently.
    private _validateOverloadAttributeConsistency(node: FunctionNode, functionType: OverloadedType) {
        // Don't bother with the check if it's suppressed.
        if (this._fileInfo.diagnosticRuleSet.reportInconsistentOverload === 'none') {
            return;
        }

        let staticMethodCount = 0;
        let classMethodCount = 0;

        const overloads = OverloadedType.getOverloads(functionType);
        if (overloads.length === 0) {
            return;
        }
        let totalMethods = overloads.length;

        overloads.forEach((overload) => {
            if (FunctionType.isStaticMethod(overload)) {
                staticMethodCount++;
            }

            if (FunctionType.isClassMethod(overload)) {
                classMethodCount++;
            }
        });

        const impl = OverloadedType.getImplementation(functionType);
        if (impl && isFunction(impl)) {
            totalMethods += 1;
            if (FunctionType.isStaticMethod(impl)) {
                staticMethodCount++;
            }

            if (FunctionType.isClassMethod(impl)) {
                classMethodCount++;
            }
        }

        if (staticMethodCount > 0 && staticMethodCount < totalMethods) {
            this._evaluator.addDiagnostic(
                DiagnosticRule.reportInconsistentOverload,
                LocMessage.overloadStaticMethodInconsistent().format({
                    name: node.d.name.d.value,
                }),
                overloads[0]?.shared.declaration?.node.d.name ?? node.d.name
            );
        }

        if (classMethodCount > 0 && classMethodCount < totalMethods) {
            this._evaluator.addDiagnostic(
                DiagnosticRule.reportInconsistentOverload,
                LocMessage.overloadClassMethodInconsistent().format({
                    name: node.d.name.d.value,
                }),
                overloads[0]?.shared.declaration?.node.d.name ?? node.d.name
            );
        }
    }

    // Validates that overloads do not overlap with inconsistent return results.
    private _validateOverloadConsistency(
        node: FunctionNode,
        functionType: FunctionType,
        prevOverloads: FunctionType[]
    ) {
        // Skip the check entirely if it's disabled.
        if (this._fileInfo.diagnosticRuleSet.reportOverlappingOverload === 'none') {
            return;
        }

        for (let i = 0; i < prevOverloads.length; i++) {
            const prevOverload = prevOverloads[i];
            if (this._isOverlappingOverload(functionType, prevOverload, /* partialOverlap */ false)) {
                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportOverlappingOverload,
                    LocMessage.overlappingOverload().format({
                        name: node.d.name.d.value,
                        obscured: prevOverloads.length + 1,
                        obscuredBy: i + 1,
                    }),
                    node.d.name
                );
                break;
            }
        }

        for (let i = 0; i < prevOverloads.length; i++) {
            const prevOverload = prevOverloads[i];
            if (this._isOverlappingOverload(prevOverload, functionType, /* partialOverlap */ true)) {
                const prevReturnType = FunctionType.getEffectiveReturnType(prevOverload);
                const returnType = FunctionType.getEffectiveReturnType(functionType);

                if (
                    prevReturnType &&
                    returnType &&
                    !this._evaluator.assignType(
                        returnType,
                        prevReturnType,
                        /* diag */ undefined,
                        /* constraints */ undefined,
                        AssignTypeFlags.Default
                    )
                ) {
                    const altNode = this._findNodeForOverload(node, prevOverload);
                    this._evaluator.addDiagnostic(
                        DiagnosticRule.reportOverlappingOverload,
                        LocMessage.overloadReturnTypeMismatch().format({
                            name: node.d.name.d.value,
                            newIndex: prevOverloads.length + 1,
                            prevIndex: i + 1,
                        }),
                        (altNode || node).d.name
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
        const decls = this._evaluator.getDeclInfoForNameNode(functionNode.d.name)?.decls;
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
        if (FunctionType.isInstanceMethod(functionType) && functionType.shared.name === '__get__') {
            return false;
        }

        let flags =
            AssignTypeFlags.SkipReturnTypeCheck |
            AssignTypeFlags.OverloadOverlap |
            AssignTypeFlags.DisallowExtraKwargsForTd;
        if (partialOverlap) {
            flags |= AssignTypeFlags.PartialOverloadOverlap;
        }

        const functionNode = functionType.shared.declaration?.node;
        if (functionNode) {
            const liveTypeVars = ParseTreeUtils.getTypeVarScopesForNode(functionNode);
            functionType = makeTypeVarsBound(functionType, liveTypeVars);
        }

        // Use the parent node of the declaration in this case so we don't transform
        // function-local type variables into bound type variables.
        const prevOverloadNode = prevOverload.shared.declaration?.node?.parent;
        if (prevOverloadNode) {
            const liveTypeVars = ParseTreeUtils.getTypeVarScopesForNode(prevOverloadNode);
            prevOverload = makeTypeVarsBound(prevOverload, liveTypeVars);
        }

        return this._evaluator.assignType(
            functionType,
            prevOverload,
            /* diag */ undefined,
            /* constraints */ undefined,
            flags
        );
    }

    // Determines whether the implementation of an overload is compatible with an
    // overload signature. To be compatible, the implementation must accept all
    // of the same arguments as the overload and return a type that is consistent
    // with the overload's return type.
    private _validateOverloadImplementation(
        overload: FunctionType,
        implementation: FunctionType,
        diag: DiagnosticAddendum | undefined
    ): boolean {
        const constraints = new ConstraintTracker();

        let implBound = implementation;
        let overloadBound = overload;

        const implNode = implementation.shared.declaration?.node?.parent;
        if (implNode) {
            const liveScopeIds = ParseTreeUtils.getTypeVarScopesForNode(implNode);
            implBound = makeTypeVarsBound(implementation, liveScopeIds);
        }

        const overloadNode = overload.shared.declaration?.node;
        if (overloadNode) {
            const liveScopeIds = ParseTreeUtils.getTypeVarScopesForNode(overloadNode);
            overloadBound = makeTypeVarsBound(overload, liveScopeIds);
        }

        // First check the parameters to see if they are assignable.
        let isConsistent = this._evaluator.assignType(
            overloadBound,
            implBound,
            diag,
            constraints,
            AssignTypeFlags.SkipReturnTypeCheck |
                AssignTypeFlags.Contravariant |
                AssignTypeFlags.SkipSelfClsTypeCheck |
                AssignTypeFlags.DisallowExtraKwargsForTd
        );

        // Now check the return types.
        const overloadReturnType = this._evaluator.solveAndApplyConstraints(
            FunctionType.getEffectiveReturnType(overloadBound) ?? this._evaluator.getInferredReturnType(overloadBound),
            constraints
        );
        const implReturnType = this._evaluator.solveAndApplyConstraints(
            FunctionType.getEffectiveReturnType(implBound) ?? this._evaluator.getInferredReturnType(implBound),
            constraints
        );

        const returnDiag = new DiagnosticAddendum();
        if (
            !isNever(overloadReturnType) &&
            !this._evaluator.assignType(
                implReturnType,
                overloadReturnType,
                returnDiag.createAddendum(),
                constraints,
                AssignTypeFlags.Default
            )
        ) {
            returnDiag.addMessage(
                LocAddendum.functionReturnTypeMismatch().format({
                    sourceType: this._evaluator.printType(overloadReturnType),
                    destType: this._evaluator.printType(implReturnType),
                })
            );
            diag?.addAddendum(returnDiag);
            isConsistent = false;
        }

        return isConsistent;
    }

    private _walkStatementsAndReportUnreachable(statements: StatementNode[]) {
        let reportedUnreachable = false;
        let prevStatement: StatementNode | undefined;

        for (const statement of statements) {
            // No need to report unreachable more than once since the first time
            // covers all remaining statements in the statement list.
            if (!reportedUnreachable) {
                const reachability = this._evaluator.getNodeReachability(statement, prevStatement);
                if (reachability !== Reachability.Reachable) {
                    // Create a text range that covers the next statement through
                    // the end of the statement list.
                    const start = statement.start;
                    const lastStatement = statements[statements.length - 1];
                    const end = TextRange.getEnd(lastStatement);
                    this._evaluator.addUnreachableCode(statement, reachability, { start, length: end - start });

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
                for (const substatement of statement.d.statements) {
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
                                substatement.d.operator === OperatorType.AddEqual &&
                                substatement.d.leftExpr.nodeType === ParseNodeType.Name &&
                                substatement.d.leftExpr.d.value === '__all__';
                            break;
                        }

                        case ParseNodeType.Call: {
                            // Exempt __all__ manipulations.
                            isValid =
                                substatement.d.leftExpr.nodeType === ParseNodeType.MemberAccess &&
                                substatement.d.leftExpr.d.leftExpr.nodeType === ParseNodeType.Name &&
                                substatement.d.leftExpr.d.leftExpr.d.value === '__all__';
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
        baseExceptionGroupType: Type | undefined,
        allowTuple: boolean,
        isExceptGroup: boolean
    ) {
        const derivesFromBaseException = (classType: ClassType) => {
            if (!baseExceptionType || !isInstantiableClass(baseExceptionType)) {
                return true;
            }

            return derivesFromClassRecursive(classType, baseExceptionType, /* ignoreUnknown */ false);
        };

        const derivesFromBaseExceptionGroup = (classType: ClassType) => {
            if (!baseExceptionGroupType || !isInstantiableClass(baseExceptionGroupType)) {
                return true;
            }

            return derivesFromClassRecursive(classType, baseExceptionGroupType, /* ignoreUnknown */ false);
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

                    if (isExceptGroup && derivesFromBaseExceptionGroup(exceptionSubtype)) {
                        diag.addMessage(LocMessage.exceptionGroupTypeIncorrect());
                    }
                    return;
                }

                if (allowTuple && exceptionSubtype.priv.tupleTypeArgs) {
                    exceptionSubtype.priv.tupleTypeArgs.forEach((typeArg) => {
                        this._validateExceptionTypeRecursive(
                            typeArg.type,
                            diag,
                            baseExceptionType,
                            baseExceptionGroupType,
                            /* allowTuple */ false,
                            isExceptGroup
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

    private _validateExceptionType(exceptionType: Type, errorNode: ExpressionNode, isExceptGroup: boolean): void {
        const baseExceptionType = this._evaluator.getBuiltInType(errorNode, 'BaseException');
        const baseExceptionGroupType = this._evaluator.getBuiltInType(errorNode, 'BaseExceptionGroup');
        const diagAddendum = new DiagnosticAddendum();

        this._validateExceptionTypeRecursive(
            exceptionType,
            diagAddendum,
            baseExceptionType,
            baseExceptionGroupType,
            /* allowTuple */ true,
            isExceptGroup
        );

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
            if (!moduleScope.symbolTable.has(node.d.value)) {
                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportUnsupportedDunderAll,
                    LocMessage.dunderAllSymbolNotPresent().format({ name: node.d.value }),
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

                    this._reportOverwriteOfImportedFinal(name, symbol);
                    this._reportOverwriteOfBuiltinsFinal(name, symbol, scope);
                    this._reportMultipleFinalDeclarations(name, symbol, scope.type);

                    this._reportFinalInLoop(symbol);

                    this._reportMultipleTypeAliasDeclarations(name, symbol);

                    this._reportInvalidOverload(name, symbol);
                });
            }
        }

        // Report unaccessed type parameters.
        const accessedSymbolSet = this._fileInfo.accessedSymbolSet;
        for (const paramList of this._typeParamLists) {
            const typeParamScope = AnalyzerNodeInfo.getScope(paramList);

            for (const param of paramList.d.params) {
                const symbol = typeParamScope?.symbolTable.get(param.d.name.d.value);
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
        if (typedDecls.length === 0) {
            return;
        }

        const primaryDecl = typedDecls[0];

        if (primaryDecl.type !== DeclarationType.Function) {
            return;
        }

        const type = this._evaluator.getEffectiveTypeOfSymbol(symbol);
        const overloads = isOverloaded(type)
            ? OverloadedType.getOverloads(type)
            : isFunction(type) && FunctionType.isOverloaded(type)
            ? [type]
            : [];

        // If the implementation has no name, it was synthesized probably by a
        // decorator that used a callable with a ParamSpec that captured the
        // overloaded signature. We'll exempt it from this check.
        if (isOverloaded(type)) {
            const overloads = OverloadedType.getOverloads(type);
            if (overloads.length > 0 && overloads[0].shared.name === '') {
                return;
            }
        } else if (isFunction(type)) {
            if (type.shared.name === '') {
                return;
            }
        }

        if (overloads.length === 1) {
            // There should never be a single overload.
            this._evaluator.addDiagnostic(
                DiagnosticRule.reportInconsistentOverload,
                LocMessage.singleOverload().format({ name }),
                primaryDecl.node.d.name
            );
        }

        // If the file is not a stub and this is the first overload,
        // verify that there is an implementation.
        if (this._fileInfo.isStubFile || overloads.length === 0) {
            return;
        }

        let implementation: Type | undefined;

        if (isOverloaded(type)) {
            implementation = OverloadedType.getImplementation(type);
        } else if (isFunction(type) && !FunctionType.isOverloaded(type)) {
            implementation = type;
        }

        if (!implementation) {
            // If this is a method within a protocol class, don't require that
            // there is an implementation.
            const containingClassNode = ParseTreeUtils.getEnclosingClassOrFunction(primaryDecl.node);
            if (containingClassNode && containingClassNode.nodeType === ParseNodeType.Class) {
                const classType = this._evaluator.getTypeOfClass(containingClassNode);
                if (classType) {
                    if (ClassType.isProtocolClass(classType.classType)) {
                        return;
                    }

                    if (ClassType.supportsAbstractMethods(classType.classType)) {
                        if (
                            isOverloaded(type) &&
                            OverloadedType.getOverloads(type).every((overload) =>
                                FunctionType.isAbstractMethod(overload)
                            )
                        ) {
                            return;
                        }
                    }
                }
            }

            // If the declaration isn't associated with any of the overloads in the
            // type, the overloads came from a decorator that captured the overload
            // from somewhere else.
            if (!overloads.find((overload) => overload.shared.declaration === primaryDecl)) {
                return;
            }

            this._evaluator.addDiagnostic(
                DiagnosticRule.reportNoOverloadImplementation,
                LocMessage.overloadWithoutImplementation().format({
                    name: primaryDecl.node.d.name.d.value,
                }),
                primaryDecl.node.d.name
            );

            return;
        }

        if (!isOverloaded(type)) {
            return;
        }

        if (this._fileInfo.diagnosticRuleSet.reportInconsistentOverload === 'none') {
            return;
        }

        // Verify that all overload signatures are assignable to implementation signature.
        OverloadedType.getOverloads(type).forEach((overload, index) => {
            const diag = new DiagnosticAddendum();
            if (
                implementation &&
                isFunction(implementation) &&
                !this._validateOverloadImplementation(overload, implementation, diag)
            ) {
                if (implementation!.shared.declaration) {
                    const diagnostic = this._evaluator.addDiagnostic(
                        DiagnosticRule.reportInconsistentOverload,
                        LocMessage.overloadImplementationMismatch().format({
                            name,
                            index: index + 1,
                        }) + diag.getString(),
                        implementation!.shared.declaration.node.d.name
                    );

                    if (diagnostic && overload.shared.declaration) {
                        diagnostic.addRelatedInfo(
                            LocAddendum.overloadSignature(),
                            overload.shared.declaration?.uri ?? primaryDecl.uri,
                            overload.shared.declaration?.range ?? primaryDecl.range
                        );
                    }
                }
            }
        });
    }

    private _reportFinalInLoop(symbol: Symbol) {
        if (!this._evaluator.isFinalVariable(symbol)) {
            return;
        }

        const decls = symbol.getDeclarations();
        if (decls.length === 0) {
            return;
        }

        if (ParseTreeUtils.isWithinLoop(decls[0].node)) {
            this._evaluator.addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.finalInLoop(),
                decls[0].node
            );
        }
    }

    // If a variable that is marked Final in one module is imported by another
    // module, an attempt to overwrite the imported symbol should generate an
    // error.
    private _reportOverwriteOfImportedFinal(name: string, symbol: Symbol) {
        if (this._evaluator.isFinalVariable(symbol)) {
            return;
        }

        const decls = symbol.getDeclarations();

        const finalImportDecl = decls.find((decl) => {
            if (decl.type === DeclarationType.Alias) {
                const resolvedDecl = this._evaluator.resolveAliasDeclaration(decl, /* resolveLocalNames */ true);
                if (resolvedDecl && isVariableDeclaration(resolvedDecl) && resolvedDecl.isFinal) {
                    return true;
                }
            }

            return false;
        });

        if (!finalImportDecl) {
            return;
        }

        decls.forEach((decl) => {
            if (decl !== finalImportDecl) {
                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportGeneralTypeIssues,
                    LocMessage.finalReassigned().format({ name }),
                    getNameNodeForDeclaration(decl) ?? decl.node
                );
            }
        });
    }

    // If the builtins module (or any implicitly chained module) defines a
    // Final variable, an attempt to overwrite it should generate an error.
    private _reportOverwriteOfBuiltinsFinal(name: string, symbol: Symbol, scope: Scope) {
        if (scope.type !== ScopeType.Module || !scope.parent) {
            return;
        }

        const shadowedSymbolInfo = scope.parent.lookUpSymbolRecursive(name);
        if (!shadowedSymbolInfo) {
            return;
        }

        if (!this._evaluator.isFinalVariable(shadowedSymbolInfo.symbol)) {
            return;
        }

        const decls = symbol.getDeclarations();
        decls.forEach((decl) => {
            this._evaluator.addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.finalReassigned().format({ name }),
                getNameNodeForDeclaration(decl) ?? decl.node
            );
        });
    }

    // If a variable is marked Final, it should receive only one assigned value.
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
                    return funcTypeInfo.decoratedType.shared.typeSourceId !== decoratedType.shared.typeSourceId;
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
        } else if (primaryDecl.type === DeclarationType.Param) {
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
                    primaryDeclNode = primaryDecl.node.d.name;
                } else if (primaryDecl.type === DeclarationType.Variable) {
                    if (primaryDecl.node.nodeType === ParseNodeType.Name) {
                        primaryDeclNode = primaryDecl.node;
                    }
                } else if (
                    primaryDecl.type === DeclarationType.Param ||
                    primaryDecl.type === DeclarationType.TypeParam
                ) {
                    if (primaryDecl.node.d.name) {
                        primaryDeclNode = primaryDecl.node.d.name;
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

                if (primaryDecl.type === DeclarationType.TypeParam) {
                    // The error will be reported elsewhere if a type parameter is
                    // involved, so don't report it here.
                    duplicateIsOk = true;
                }

                if (!duplicateIsOk) {
                    const diag = this._evaluator.addDiagnostic(
                        DiagnosticRule.reportRedeclaration,
                        LocMessage.obscuredClassDeclaration().format({ name }),
                        otherDecl.node.d.name
                    );
                    addPrimaryDeclInfo(diag);
                }
            } else if (otherDecl.type === DeclarationType.Function) {
                const primaryType = this._evaluator.getTypeForDeclaration(primaryDecl)?.type;
                let duplicateIsOk = false;

                // If the return type has not yet been inferred, do so now.
                if (primaryType && isFunction(primaryType)) {
                    this._evaluator.getInferredReturnType(primaryType);
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
                    this._evaluator.getInferredReturnType(otherType);
                }

                // If both declarations are functions, it's OK if they
                // both have the same signatures.
                if (!isInSameStatementList && primaryType && otherType && isTypeSame(primaryType, otherType)) {
                    duplicateIsOk = true;
                }

                if (primaryDecl.type === DeclarationType.TypeParam) {
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
                        otherDecl.node.d.name
                    );
                    addPrimaryDeclInfo(diag);
                }
            } else if (otherDecl.type === DeclarationType.Param) {
                if (otherDecl.node.d.name) {
                    let duplicateIsOk = false;

                    if (primaryDecl.type === DeclarationType.TypeParam) {
                        // The error will be reported elsewhere if a type parameter is
                        // involved, so don't report it here.
                        duplicateIsOk = true;
                    }

                    if (!duplicateIsOk) {
                        const message = LocMessage.obscuredParameterDeclaration();
                        const diag = this._evaluator.addDiagnostic(
                            DiagnosticRule.reportRedeclaration,
                            message.format({ name }),
                            otherDecl.node.d.name
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

                        if (primaryDecl.type === DeclarationType.TypeParam) {
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
                    otherDecl.node.d.name
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
                    if (decl.node.d.alias) {
                        // For statements of the form "import x as x", don't mark "x" as unaccessed
                        // because it's assumed to be re-exported.
                        // See https://typing.readthedocs.io/en/latest/source/stubs.html#imports.
                        if (decl.node.d.alias.d.value !== decl.moduleName) {
                            nameNode = decl.node.d.alias;
                        }
                    } else {
                        const nameParts = decl.node.d.module.d.nameParts;
                        // Multi-part imports are handled separately, so ignore those here.
                        if (nameParts.length === 1) {
                            nameNode = nameParts[0];
                            this._evaluator.addDiagnostic(
                                DiagnosticRule.reportUnusedImport,
                                LocMessage.unaccessedImport().format({ name: nameNode.d.value }),
                                nameNode
                            );
                            message = LocMessage.unaccessedImport().format({ name: nameNode.d.value });
                        }
                    }
                } else if (decl.node.nodeType === ParseNodeType.ImportFromAs) {
                    const importFrom = decl.node.parent as ImportFromNode;

                    // For statements of the form "from y import x as x", don't mark "x" as
                    // unaccessed because it's assumed to be re-exported.
                    const isReexport = decl.node.d.alias?.d.value === decl.node.d.name.d.value;

                    // If this is a __future__ import, it's OK for the import symbol to be unaccessed.
                    const isFuture =
                        importFrom.d.module.d.nameParts.length === 1 &&
                        importFrom.d.module.d.nameParts[0].d.value === '__future__';

                    if (!isReexport && !isFuture) {
                        nameNode = decl.node.d.alias || decl.node.d.name;
                    }
                }

                if (nameNode) {
                    message = LocMessage.unaccessedImport().format({ name: nameNode.d.value });
                }
                break;

            case DeclarationType.TypeAlias:
            case DeclarationType.Variable:
            case DeclarationType.Param:
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
                    if (nameNode.d.value.startsWith('_')) {
                        diagnosticLevel = 'none';
                    }
                } else if (decl.node.nodeType === ParseNodeType.Parameter) {
                    nameNode = decl.node.d.name;

                    // Don't emit a diagnostic for unused parameters or type parameters.
                    diagnosticLevel = 'none';
                }

                if (nameNode) {
                    rule = DiagnosticRule.reportUnusedVariable;
                    message = LocMessage.unaccessedVariable().format({ name: nameNode.d.value });
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
                nameNode = decl.node.d.name;
                rule = DiagnosticRule.reportUnusedClass;
                message = LocMessage.unaccessedClass().format({ name: nameNode.d.value });
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
                nameNode = decl.node.d.name;
                rule = DiagnosticRule.reportUnusedFunction;
                message = LocMessage.unaccessedFunction().format({ name: nameNode.d.value });
                break;

            case DeclarationType.TypeParam:
                // Never report a diagnostic for an unused TypeParam.
                diagnosticLevel = 'none';
                nameNode = decl.node.d.name;
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
                LocMessage.unaccessedSymbol().format({ name: nameNode.d.value }),
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
            node.d.leftExpr.nodeType !== ParseNodeType.Name ||
            (node.d.leftExpr.d.value !== 'isinstance' && node.d.leftExpr.d.value !== 'issubclass') ||
            node.d.args.length !== 2
        ) {
            return;
        }

        const callName = node.d.leftExpr.d.value;
        const isInstanceCheck = callName === 'isinstance';

        let arg0Type = this._evaluator.getType(node.d.args[0].d.valueExpr);
        if (!arg0Type) {
            return;
        }
        arg0Type = mapSubtypes(arg0Type, (subtype) => {
            return transformPossibleRecursiveTypeAlias(subtype);
        });

        arg0Type = this._evaluator.expandPromotionTypes(node, arg0Type);

        const arg1Type = this._evaluator.getType(node.d.args[1].d.valueExpr);
        if (!arg1Type) {
            return;
        }

        let isValidType = true;
        const diag = new DiagnosticAddendum();
        doForEachSubtype(arg1Type, (arg1Subtype) => {
            if (isClassInstance(arg1Subtype) && ClassType.isTupleClass(arg1Subtype) && arg1Subtype.priv.tupleTypeArgs) {
                if (
                    arg1Subtype.priv.tupleTypeArgs.some(
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
                node.d.args[1]
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
                    arg1Subtype.priv.tupleTypeArgs
                ) {
                    arg1Subtype.priv.tupleTypeArgs.forEach((typeArg) => {
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
                    node.d.args[1]
                );
            }
        }

        // If this call is within an assert statement, we won't check whether
        // it's unnecessary.
        if (ParseTreeUtils.isWithinAssertExpression(node)) {
            return;
        }

        const classTypeList = getIsInstanceClassTypes(this._evaluator, arg1Type);
        if (!classTypeList) {
            return;
        }

        // Check for unsafe protocol overlaps.
        classTypeList.forEach((filterType) => {
            if (isInstantiableClass(filterType)) {
                this._validateUnsafeProtocolOverlap(
                    node.d.args[0].d.valueExpr,
                    ClassType.cloneAsInstance(filterType),
                    isInstanceCheck ? arg0Type : convertToInstance(arg0Type)
                );
            }
        });

        // Check for unnecessary isinstance or issubclass calls.
        if (this._fileInfo.diagnosticRuleSet.reportUnnecessaryIsInstance !== 'none') {
            const narrowedTypeNegative = narrowTypeForInstanceOrSubclass(
                this._evaluator,
                arg0Type,
                classTypeList,
                isInstanceCheck,
                /* isTypeIsCheck */ false,
                /* isPositiveTest */ false,
                node
            );

            const narrowedTypePositive = narrowTypeForInstanceOrSubclass(
                this._evaluator,
                arg0Type,
                classTypeList,
                isInstanceCheck,
                /* isTypeIsCheck */ false,
                /* isPositiveTest */ true,
                node
            );

            const isAlwaysTrue = isNever(narrowedTypeNegative);
            const isNeverTrue = isNever(narrowedTypePositive);

            if (isAlwaysTrue || isNeverTrue) {
                const classType = combineTypes(classTypeList.map((t) => convertToInstance(t)));
                const messageTemplate = isAlwaysTrue
                    ? isInstanceCheck
                        ? LocMessage.unnecessaryIsInstanceAlways()
                        : LocMessage.unnecessaryIsSubclassAlways()
                    : isInstanceCheck
                    ? LocMessage.unnecessaryIsInstanceNever()
                    : LocMessage.unnecessaryIsSubclassNever();

                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportUnnecessaryIsInstance,
                    messageTemplate.format({
                        testType: this._evaluator.printType(arg0Type),
                        classType: this._evaluator.printType(classType),
                    }),
                    node
                );
            }
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
                                name: testSubtype.shared.name,
                            })
                        );
                    }
                }
            });

            if (isUnsafeOverlap) {
                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportGeneralTypeIssues,
                    LocMessage.protocolUnsafeOverlap().format({
                        name: protocol.shared.name,
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

            if (subtype.props?.specialForm && ClassType.isBuiltIn(subtype.props.specialForm, 'TypeAliasType')) {
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
                    } else if (subtype.priv.isTypeArgExplicit && !subtype.priv.includeSubclasses) {
                        // If it's a class, make sure that it has not been given explicit
                        // type arguments. This will result in a TypeError exception.
                        diag.addMessage(LocAddendum.genericClassNotAllowed());
                        isSupported = false;
                    } else if (ClassType.isIllegalIsinstanceClass(subtype)) {
                        diag.addMessage(
                            LocAddendum.isinstanceClassNotSupported().format({ type: subtype.shared.name })
                        );
                        isSupported = false;
                    } else if (
                        ClassType.isProtocolClass(subtype) &&
                        !ClassType.isRuntimeCheckable(subtype) &&
                        !subtype.priv.includeSubclasses
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
                        subtype.props?.specialForm &&
                        isClassInstance(subtype.props.specialForm) &&
                        ClassType.isBuiltIn(subtype.props.specialForm, 'Annotated')
                    ) {
                        diag.addMessage(LocAddendum.annotatedNotAllowed());
                        isSupported = false;
                    } else if (
                        subtype.props?.specialForm &&
                        isInstantiableClass(subtype.props.specialForm) &&
                        ClassType.isBuiltIn(subtype.props.specialForm, 'Literal')
                    ) {
                        diag.addMessage(LocAddendum.literalNotAllowed());
                        isSupported = false;
                    }
                    break;

                case TypeCategory.Function:
                    if (!TypeBase.isInstantiable(subtype) || subtype.priv.isCallableWithTypeArgs) {
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
                    name: type.shared.name,
                })
            );
        }
    }

    private _isSymbolPrivate(nameValue: string, scopeType: ScopeType) {
        // All variables within the scope of a function or a list
        // comprehension are considered private.
        if (scopeType === ScopeType.Function || scopeType === ScopeType.Comprehension) {
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

        this._reportDeprecatedDiagnostic(node.d.name, LocMessage.classPropertyDeprecated());
    }

    private _reportDeprecatedUseForMemberAccess(node: NameNode, info: MemberAccessDeprecationInfo) {
        let errorMessage: string | undefined;

        if (info.accessType === 'property') {
            if (info.accessMethod === 'get') {
                errorMessage = LocMessage.deprecatedPropertyGetter().format({ name: node.d.value });
            } else if (info.accessMethod === 'set') {
                errorMessage = LocMessage.deprecatedPropertySetter().format({ name: node.d.value });
            } else {
                errorMessage = LocMessage.deprecatedPropertyDeleter().format({ name: node.d.value });
            }
        } else if (info.accessType === 'descriptor') {
            if (info.accessMethod === 'get') {
                errorMessage = LocMessage.deprecatedDescriptorGetter().format({ name: node.d.value });
            } else if (info.accessMethod === 'set') {
                errorMessage = LocMessage.deprecatedDescriptorSetter().format({ name: node.d.value });
            } else {
                errorMessage = LocMessage.deprecatedDescriptorDeleter().format({ name: node.d.value });
            }
        }

        if (errorMessage) {
            this._reportDeprecatedDiagnostic(node, errorMessage, info.deprecatedMessage);
        }
    }

    private _reportDeprecatedUseForOperation(node: ExpressionNode, typeResult: TypeResult | undefined) {
        const deprecationInfo = typeResult?.magicMethodDeprecationInfo;
        if (!deprecationInfo) {
            return;
        }

        this._reportDeprecatedDiagnostic(
            node,
            LocMessage.deprecatedMethod().format({
                className: deprecationInfo.className,
                name: deprecationInfo.methodName,
            }),
            deprecationInfo.deprecatedMessage
        );
    }

    private _reportDeprecatedUseForType(node: NameNode, type: Type | undefined, isImportFromTyping = false) {
        if (!type) {
            return;
        }

        let errorMessage: string | undefined;
        let deprecatedMessage: string | undefined;

        function getDeprecatedMessageForFunction(functionType: FunctionType): string {
            if (
                functionType.shared.declaration &&
                functionType.shared.declaration.node.nodeType === ParseNodeType.Function
            ) {
                const containingClass = ParseTreeUtils.getEnclosingClass(
                    functionType.shared.declaration.node,
                    /* stopAtFunction */ true
                );

                if (containingClass) {
                    return LocMessage.deprecatedMethod().format({
                        name: functionType.shared.name || '<anonymous>',
                        className: containingClass.d.name.d.value,
                    });
                }
            }

            return LocMessage.deprecatedFunction().format({
                name: functionType.shared.name,
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
                    if (overload.shared.deprecatedMessage !== undefined) {
                        if (node.d.value === overload.shared.name) {
                            deprecatedMessage = overload.shared.deprecatedMessage;
                            errorMessage = getDeprecatedMessageForFunction(overload);
                        } else if (
                            isInstantiableClass(type) &&
                            ['__init__', '__new__'].includes(overload.shared.name)
                        ) {
                            deprecatedMessage = overload.shared.deprecatedMessage;
                            errorMessage = LocMessage.deprecatedConstructor().format({
                                name: type.shared.name,
                            });
                        } else if (isClassInstance(type) && overload.shared.name === '__call__') {
                            deprecatedMessage = overload.shared.deprecatedMessage;
                            errorMessage = LocMessage.deprecatedFunction().format({
                                name: node.d.value,
                            });
                        }
                    }
                });
            }
        }

        doForEachSubtype(type, (subtype) => {
            if (isClass(subtype)) {
                if (
                    !subtype.priv.includeSubclasses &&
                    subtype.shared.deprecatedMessage !== undefined &&
                    node.d.value === subtype.shared.name
                ) {
                    deprecatedMessage = subtype.shared.deprecatedMessage;
                    errorMessage = LocMessage.deprecatedClass().format({ name: subtype.shared.name });
                    return;
                }

                getDeprecatedMessageForOverloadedCall(this._evaluator, subtype);
                return;
            }

            if (isFunction(subtype)) {
                if (subtype.shared.deprecatedMessage !== undefined) {
                    if (
                        !subtype.shared.name ||
                        subtype.shared.name === '__call__' ||
                        node.d.value === subtype.shared.name
                    ) {
                        deprecatedMessage = subtype.shared.deprecatedMessage;
                        errorMessage = getDeprecatedMessageForFunction(subtype);
                    }
                }
            } else if (isOverloaded(subtype)) {
                // Determine if the node is part of a call expression. If so,
                // we can determine which overload(s) were used to satisfy
                // the call expression and determine whether any of them
                // are deprecated.
                getDeprecatedMessageForOverloadedCall(this._evaluator, subtype);

                // If there the implementation itself is deprecated, assume it
                // is deprecated even if it's outside of a call expression.
                const impl = OverloadedType.getImplementation(subtype);
                if (impl && isFunction(impl) && impl.shared.deprecatedMessage !== undefined) {
                    if (!impl.shared.name || node.d.value === impl.shared.name) {
                        deprecatedMessage = impl.shared.deprecatedMessage;
                        errorMessage = getDeprecatedMessageForFunction(impl);
                    }
                }
            }
        });

        if (errorMessage) {
            this._reportDeprecatedDiagnostic(node, errorMessage, deprecatedMessage);
        }

        if (this._fileInfo.diagnosticRuleSet.deprecateTypingAliases) {
            const deprecatedForm = deprecatedAliases.get(node.d.value) ?? deprecatedSpecialForms.get(node.d.value);

            if (deprecatedForm) {
                if (
                    (isInstantiableClass(type) && type.shared.fullName === deprecatedForm.fullName) ||
                    type.props?.typeAliasInfo?.shared.fullName === deprecatedForm.fullName
                ) {
                    if (
                        PythonVersion.isGreaterOrEqualTo(
                            this._fileInfo.executionEnvironment.pythonVersion,
                            deprecatedForm.version
                        )
                    ) {
                        if (!deprecatedForm.typingImportOnly || isImportFromTyping) {
                            this._reportDeprecatedDiagnostic(
                                node,
                                LocMessage.deprecatedType().format({
                                    version: PythonVersion.toString(deprecatedForm.version),
                                    replacement: deprecatedForm.replacementText,
                                })
                            );
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
                            LocMessage.symbolIsUnbound().format({ name: node.d.value }),
                            node
                        );
                    }
                } else if (isPossiblyUnbound(type)) {
                    this._evaluator.addDiagnostic(
                        DiagnosticRule.reportPossiblyUnboundVariable,
                        LocMessage.symbolIsPossiblyUnbound().format({ name: node.d.value }),
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
                    ? node.parent?.d.module
                    : undefined
                : node.d.module;
        if (nodeModule?.d.leadingDots) {
            return;
        }

        // Otherwise use the name to determine if a match for a stdlib module.
        const namePartNodes =
            node.nodeType === ParseNodeType.ImportAs
                ? node.d.module.d.nameParts
                : node.nodeType === ParseNodeType.ImportFromAs
                ? [node.d.name]
                : node.d.module.d.nameParts;
        const nameParts = namePartNodes.map((n) => n.d.value);
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
        if (node.parent?.nodeType === ParseNodeType.Argument && node.parent.d.name === node) {
            return;
        }

        const nameValue = node.d.value;
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
            .getDeclInfoForNameNode(node)
            ?.decls?.filter((decl) => decl.type !== DeclarationType.Variable || !decl.isExplicitBinding);

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
        classType.shared.baseClasses.forEach((baseClass, index) => {
            if (isClass(baseClass) && isEnumClassWithMembers(this._evaluator, baseClass)) {
                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportGeneralTypeIssues,
                    LocMessage.enumClassOverride().format({ name: baseClass.shared.name }),
                    node.d.arguments[index]
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

        suiteNode.d.statements.forEach((statement) => {
            if (!AnalyzerNodeInfo.isCodeUnreachable(statement)) {
                if (statement.nodeType === ParseNodeType.StatementList) {
                    for (const substatement of statement.d.statements) {
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
        const returnType = functionType.shared.declaredReturnType;
        if (!returnType) {
            return;
        }

        if (!isClassInstance(returnType) || !returnType.priv.typeArgs || returnType.priv.typeArgs.length < 1) {
            return;
        }

        const isTypeGuard = ClassType.isBuiltIn(returnType, 'TypeGuard');
        const isTypeIs = ClassType.isBuiltIn(returnType, 'TypeIs');

        if (!isTypeGuard && !isTypeIs) {
            return;
        }

        // Make sure there's at least one input parameter provided.
        let paramCount = functionType.shared.parameters.length;
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
                node.d.name
            );
        }

        if (isTypeIs) {
            const scopeIds = getTypeVarScopeIds(functionType);
            const narrowedType = returnType.priv.typeArgs[0];
            let typeGuardType = makeTypeVarsBound(narrowedType, scopeIds);
            typeGuardType = TypeBase.cloneWithTypeForm(typeGuardType, typeGuardType);

            // Determine the type of the first parameter.
            const paramIndex = isMethod && !FunctionType.isStaticMethod(functionType) ? 1 : 0;
            if (paramIndex >= functionType.shared.parameters.length) {
                return;
            }

            const paramType = makeTypeVarsBound(FunctionType.getParamType(functionType, paramIndex), scopeIds);

            // Verify that the typeGuardType is a narrower type than the paramType.
            if (!this._evaluator.assignType(paramType, typeGuardType)) {
                const returnAnnotation = node.d.returnAnnotation || node.d.funcAnnotationComment?.d.returnAnnotation;
                if (returnAnnotation) {
                    this._evaluator.addDiagnostic(
                        DiagnosticRule.reportGeneralTypeIssues,
                        LocMessage.typeIsReturnType().format({
                            type: this._evaluator.printType(paramType),
                            returnType: this._evaluator.printType(narrowedType),
                        }),
                        returnAnnotation
                    );
                }
            }
        }
    }

    private _validateDunderSignatures(node: FunctionNode, functionType: FunctionType, isMethod: boolean) {
        const functionName = functionType.shared.name;

        // Is this an '__init__' method? Verify that it returns None.
        if (isMethod && functionName === '__init__') {
            const returnAnnotation = node.d.returnAnnotation || node.d.funcAnnotationComment?.d.returnAnnotation;
            const declaredReturnType = functionType.shared.declaredReturnType;

            if (returnAnnotation && declaredReturnType) {
                if (!isNoneInstance(declaredReturnType) && !isNever(declaredReturnType)) {
                    this._evaluator.addDiagnostic(
                        DiagnosticRule.reportGeneralTypeIssues,
                        LocMessage.initMustReturnNone(),
                        returnAnnotation
                    );
                }
            } else {
                const inferredReturnType = this._evaluator.getInferredReturnType(functionType);
                if (
                    !isNever(inferredReturnType) &&
                    !isNoneInstance(inferredReturnType) &&
                    !isAnyOrUnknown(inferredReturnType)
                ) {
                    this._evaluator.addDiagnostic(
                        DiagnosticRule.reportGeneralTypeIssues,
                        LocMessage.initMustReturnNone(),
                        node.d.name
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

        const returnAnnotation = node.d.returnAnnotation || node.d.funcAnnotationComment?.d.returnAnnotation;
        if (returnAnnotation) {
            const functionNeverReturns = !this._evaluator.isAfterNodeReachable(node);
            const implicitlyReturnsNone = this._evaluator.isAfterNodeReachable(node.d.suite);

            let declaredReturnType = functionType.shared.declaredReturnType;

            if (declaredReturnType) {
                this._reportUnknownReturnResult(node, declaredReturnType);
                this._validateReturnTypeIsNotContravariant(declaredReturnType, returnAnnotation);

                const liveScopes = ParseTreeUtils.getTypeVarScopesForNode(node);
                declaredReturnType = makeTypeVarsBound(declaredReturnType, liveScopes);
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
                    if (!ParseTreeUtils.isSuiteEmpty(node.d.suite) && !FunctionType.isOverloaded(functionType)) {
                        this._evaluator.addDiagnostic(
                            DiagnosticRule.reportReturnType,
                            LocMessage.noReturnReturnsNone(),
                            returnAnnotation
                        );
                    }
                } else if (!FunctionType.isAbstractMethod(functionType)) {
                    // If the function consists entirely of "...", assume that it's
                    // an abstract method or a protocol method and don't require that
                    // the return type matches. This check can also be skipped for an overload.
                    const isEmptySuite =
                        ParseTreeUtils.isSuiteEmpty(node.d.suite) || FunctionType.isOverloaded(functionType);

                    // Make sure that the function doesn't implicitly return None if the declared
                    // type doesn't allow it. Skip this check for abstract methods.
                    const diagAddendum = isEmptySuite ? undefined : new DiagnosticAddendum();

                    // If the declared type isn't compatible with 'None', flag an error.
                    if (!this._evaluator.assignType(declaredReturnType, this._evaluator.getNoneType(), diagAddendum)) {
                        if (!isEmptySuite) {
                            this._evaluator.addDiagnostic(
                                DiagnosticRule.reportReturnType,
                                LocMessage.returnMissing().format({
                                    returnType: this._evaluator.printType(declaredReturnType),
                                }) + diagAddendum?.getString(),
                                returnAnnotation
                            );
                        }
                    }
                }
            }
        } else {
            const inferredReturnType = this._evaluator.getInferredReturnType(functionType);
            this._reportUnknownReturnResult(node, inferredReturnType);
            this._validateReturnTypeIsNotContravariant(inferredReturnType, node.d.name);
        }
    }

    private _validateReturnTypeIsNotContravariant(returnType: Type, errorNode: ExpressionNode) {
        let isContraTypeVar = false;

        doForEachSubtype(returnType, (subtype) => {
            if (
                isTypeVar(subtype) &&
                subtype.shared.declaredVariance === Variance.Contravariant &&
                subtype.priv.scopeType === TypeVarScopeType.Class
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
                node.d.name
            );
        } else if (isPartlyUnknown(returnType)) {
            this._evaluator.addDiagnostic(
                DiagnosticRule.reportUnknownParameterType,
                LocMessage.returnTypePartiallyUnknown().format({
                    returnType: this._evaluator.printType(returnType, { expandTypeAlias: true }),
                }),
                node.d.name
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
                            className: parentSymbol.classType.shared.name,
                        }),
                        decl.node
                    );
                } else if (
                    ClassType.hasNamedTupleEntry(parentSymbol.classType, name) &&
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
                                className: parentSymbol.classType.shared.name,
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
            node.d.name,
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
            node.d.name,
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
            // Determine whether this is an enum member. We ignore the presence
            // of an annotation in this case because the runtime does. From a
            // type checking perspective, if the runtime treats the assignment
            // as an enum member but there is a type annotation present, it is
            // considered a type checking error.
            const symbolType = transformTypeForEnumMember(
                this._evaluator,
                classType,
                name,
                /* ignoreAnnotation */ true
            );

            // Is this symbol a literal instance of the enum class?
            if (
                !symbolType ||
                !isClassInstance(symbolType) ||
                !ClassType.isSameGenericClass(symbolType, ClassType.cloneAsInstance(classType)) ||
                !(symbolType.priv.literalValue instanceof EnumLiteral)
            ) {
                return;
            }

            // Enum members should not have type annotations.
            const typedDecls = symbol.getTypedDeclarations();
            if (typedDecls.length > 0) {
                if (typedDecls[0].type === DeclarationType.Variable && typedDecls[0].inferredTypeSource) {
                    this._evaluator.addDiagnostic(
                        DiagnosticRule.reportGeneralTypeIssues,
                        LocMessage.enumMemberTypeAnnotation(),
                        typedDecls[0].node
                    );
                }
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

            // Look for an enum attribute annotated with "Final".
            if (decls[0].isFinal) {
                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportGeneralTypeIssues,
                    LocMessage.enumMemberTypeAnnotation(),
                    decls[0].node
                );
            }

            const declNode = decls[0].node;
            const assignedValueType = symbolType.priv.literalValue.itemType;
            const assignmentNode = ParseTreeUtils.getParentNodeOfType<AssignmentNode>(
                declNode,
                ParseNodeType.Assignment
            );
            const errorNode = assignmentNode?.d.rightExpr ?? declNode;

            // Validate the __new__ and __init__ methods if present.
            if (newMemberTypeResult || initMemberTypeResult) {
                if (!isAnyOrUnknown(assignedValueType)) {
                    // Construct an argument list. If the assigned type is a tuple, we'll
                    // unpack it. Otherwise, only one argument is passed.
                    const argList: Arg[] = [
                        {
                            argCategory:
                                isClassInstance(assignedValueType) && isTupleClass(assignedValueType)
                                    ? ArgCategory.UnpackedList
                                    : ArgCategory.Simple,
                            typeResult: { type: assignedValueType },
                        },
                    ];

                    if (newMemberTypeResult) {
                        this._evaluator.validateCallArgs(
                            errorNode,
                            argList,
                            newMemberTypeResult,
                            /* constraints */ undefined,
                            /* skipUnknownArgCheck */ undefined,
                            /* inferenceContext */ undefined
                        );
                    }

                    if (initMemberTypeResult) {
                        this._evaluator.validateCallArgs(
                            errorNode,
                            argList,
                            initMemberTypeResult,
                            /* constraints */ undefined,
                            /* skipUnknownArgCheck */ undefined,
                            /* inferenceContext */ undefined
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
    private _validateDataClassPostInit(classType: ClassType) {
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
            !postInitType.shared.declaration
        ) {
            return;
        }

        const paramListDetails = getParamListDetails(postInitType);
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
        const nonDefaultParams = paramListDetails.params.filter(
            (paramInfo, index) => FunctionType.getParamDefaultType(postInitType, index) === undefined
        );

        // We expect to see one param for "self" plus one for each of the InitVars.
        const expectedParamCount = initOnlySymbolMap.size + 1;
        const postInitNode = postInitType.shared.declaration.node;

        if (expectedParamCount < nonDefaultParams.length || expectedParamCount > paramListDetails.params.length) {
            this._evaluator.addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.dataClassPostInitParamCount().format({ expected: initOnlySymbolMap.size }),
                postInitNode.d.name
            );
        }

        // Verify that the parameter types match.
        let paramIndex = 1;

        initOnlySymbolMap.forEach((symbol, fieldName) => {
            if (paramIndex >= paramListDetails.params.length) {
                return;
            }

            const param = paramListDetails.params[paramIndex].param;
            const paramNode = postInitNode.d.params.find((node) => node.d.name?.d.value === param.name);
            const annotationNode = paramNode?.d.annotation ?? paramNode?.d.annotationComment;

            if (FunctionParam.isTypeDeclared(param) && annotationNode) {
                const fieldType = this._evaluator.getDeclaredTypeOfSymbol(symbol)?.type;
                const paramType = FunctionType.getParamType(postInitType, paramListDetails.params[paramIndex].index);
                const assignTypeDiag = new DiagnosticAddendum();

                if (fieldType && !this._evaluator.assignType(paramType, fieldType, assignTypeDiag)) {
                    const diagnostic = this._evaluator.addDiagnostic(
                        DiagnosticRule.reportGeneralTypeIssues,
                        LocMessage.dataClassPostInitType().format({ fieldName }) + assignTypeDiag.getString(),
                        annotationNode
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
                    const className = abstractMethod.classType.shared.name;
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
                type: classType.shared.name,
            }) + diagAddendum.getString(),
            errorNode.d.name
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

        // If this is a dataclass, get all of the entries so we can tell which
        // ones are initialized by the synthesized __init__ method.
        const dataClassEntries: DataClassEntry[] = [];
        if (ClassType.isDataClass(classType)) {
            addInheritedDataClassEntries(classType, dataClassEntries);
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

                        // If this is part of a dataclass, a class handled by a dataclass_transform,
                        // or a NamedTuple, exempt it because the class variable will be transformed
                        // into an instance variable in this case.
                        if (ClassType.isDataClass(classType) || ClassType.hasNamedTupleEntry(classType, name)) {
                            return true;
                        }

                        // If this is part of a TypedDict, exempt it because the class variables
                        // are not actually class variables in a TypedDict.
                        if (ClassType.isTypedDictClass(classType)) {
                            return true;
                        }
                    }

                    if (containingClass.d.name.d.value === '__init__') {
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

            if (decls[0].type !== DeclarationType.Variable) {
                return;
            }

            // Dataclass fields are typically exempted from this check because
            // they have synthesized __init__ methods that initialize these variables.
            const dcEntry = dataClassEntries?.find((entry) => entry.name === name);
            if (dcEntry) {
                if (dcEntry.includeInInit) {
                    return;
                }
            } else {
                // Do one or more declarations involve assignments?
                if (decls.some((decl) => decl.type === DeclarationType.Variable && !!decl.inferredTypeSource)) {
                    return;
                }
            }

            diagAddendum.addMessage(
                LocAddendum.uninitializedAbstractVariable().format({
                    name,
                    classType: member.classType.shared.name,
                })
            );
        });

        if (!diagAddendum.isEmpty()) {
            this._evaluator.addDiagnostic(
                DiagnosticRule.reportUninitializedInstanceVariable,
                LocMessage.uninitializedAbstractVariables().format({ classType: classType.shared.name }) +
                    diagAddendum.getString(),
                node.d.name
            );
        }
    }

    // Validates that the type variables used in a generic protocol class have
    // the proper variance (invariant, covariant, contravariant). See PEP 544
    // for an explanation for why this is important to enforce.
    private _validateProtocolTypeParamVariance(errorNode: ClassNode, classType: ClassType) {
        // If this protocol has no TypeVars with specified variance, there's nothing to do here.
        if (classType.shared.typeParams.length === 0) {
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

        classType.shared.typeParams.forEach((param, paramIndex) => {
            // Skip TypeVarTuples and ParamSpecs.
            if (isTypeVarTuple(param) || isParamSpec(param)) {
                return;
            }

            // Skip type variables that have been internally synthesized
            // for a variety of reasons.
            if (param.shared.isSynthesized) {
                return;
            }

            // Skip type variables with auto-variance.
            if (param.shared.declaredVariance === Variance.Auto) {
                return;
            }

            // Replace all type arguments with a dummy type except for the
            // TypeVar of interest, which is replaced with an object instance.
            const srcTypeArgs = classType.shared.typeParams.map((p, i) => {
                if (isTypeVarTuple(p)) {
                    return p;
                }
                return i === paramIndex ? objectObject : dummyTypeObject;
            });

            // Replace all type arguments with a dummy type except for the
            // TypeVar of interest, which is replaced with itself.
            const destTypeArgs = classType.shared.typeParams.map((p, i) => {
                return i === paramIndex || isTypeVarTuple(p) ? p : dummyTypeObject;
            });

            const srcType = ClassType.specialize(classType, srcTypeArgs);
            const destType = ClassType.specialize(classType, destTypeArgs);

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

            if (expectedVariance !== classType.shared.typeParams[paramIndex].shared.declaredVariance) {
                let message: string;
                if (expectedVariance === Variance.Covariant) {
                    message = LocMessage.protocolVarianceCovariant().format({
                        variable: param.shared.name,
                        class: classType.shared.name,
                    });
                } else if (expectedVariance === Variance.Contravariant) {
                    message = LocMessage.protocolVarianceContravariant().format({
                        variable: param.shared.name,
                        class: classType.shared.name,
                    });
                } else {
                    message = LocMessage.protocolVarianceInvariant().format({
                        variable: param.shared.name,
                        class: classType.shared.name,
                    });
                }

                this._evaluator.addDiagnostic(DiagnosticRule.reportInvalidTypeVarUse, message, errorNode.d.name);
            }
        });
    }

    // Validates that a class variable doesn't conflict with a __slots__
    // name. This will generate a runtime exception.
    private _validateSlotsClassVarConflict(classType: ClassType) {
        if (!classType.shared.localSlotsNames) {
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
        if (!isFunctionOrOverloaded(newMemberType)) {
            return;
        }

        if (isOverloaded(newMemberType)) {
            // Find the implementation, not the overloaded signatures.
            newMemberType = OverloadedType.getImplementation(newMemberType);

            if (!newMemberType || !isFunction(newMemberType)) {
                return;
            }
        }

        let initMemberType: Type | undefined = initMethodResult.type;
        if (!isFunctionOrOverloaded(initMemberType)) {
            return;
        }

        if (isOverloaded(initMemberType)) {
            // Find the implementation, not the overloaded signatures.
            initMemberType = OverloadedType.getImplementation(initMemberType);

            if (!initMemberType || !isFunction(initMemberType)) {
                return;
            }
        }

        // If either of the functions has a default parameter signature
        // (* args: Any, ** kwargs: Any), don't proceed with the check.
        if (FunctionType.hasDefaultParams(initMemberType) || FunctionType.hasDefaultParams(newMemberType)) {
            return;
        }

        if (
            !this._evaluator.assignType(
                newMemberType,
                initMemberType,
                /* diag */ undefined,
                /* constraints */ undefined,
                AssignTypeFlags.SkipReturnTypeCheck
            ) ||
            !this._evaluator.assignType(
                initMemberType,
                newMemberType,
                /* diag */ undefined,
                /* constraints */ undefined,
                AssignTypeFlags.SkipReturnTypeCheck
            )
        ) {
            const displayOnInit = ClassType.isSameGenericClass(initMethodResult.classType, classType);
            const initDecl = initMemberType.shared.declaration;
            const newDecl = newMemberType.shared.declaration;

            if (initDecl && newDecl) {
                const mainDecl = displayOnInit ? initDecl : newDecl;
                const mainDeclNode =
                    mainDecl.node.nodeType === ParseNodeType.Function ? mainDecl.node.d.name : mainDecl.node;

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
        for (const baseClass of classType.shared.baseClasses) {
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
            const solution = buildSolutionFromSpecializedClass(baseClass);

            for (const baseClassMroClass of baseClass.shared.mro) {
                // There's no need to check for conflicts if this class isn't generic.
                if (isClass(baseClassMroClass) && baseClassMroClass.shared.typeParams.length > 0) {
                    const specializedBaseClassMroClass = applySolvedTypeVars(baseClassMroClass, solution) as ClassType;

                    // Find the corresponding class in the derived class's MRO list.
                    const matchingMroClass = classType.shared.mro.find(
                        (mroClass) =>
                            isClass(mroClass) && ClassType.isSameGenericClass(mroClass, specializedBaseClassMroClass)
                    );

                    if (matchingMroClass && isInstantiableClass(matchingMroClass)) {
                        const scopeIds = getTypeVarScopeIds(classType);
                        const matchingMroObject = makeTypeVarsBound(
                            ClassType.cloneAsInstance(matchingMroClass),
                            scopeIds
                        );
                        const baseClassMroObject = makeTypeVarsBound(
                            ClassType.cloneAsInstance(specializedBaseClassMroClass),
                            scopeIds
                        );

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
                LocMessage.baseClassIncompatible().format({ type: classType.shared.name }) + diagAddendum.getString(),
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
        classType.shared.baseClasses.forEach((baseClass) => {
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
            const specializedBaseClass = classType.shared.mro.find(
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
        overriddenType = partiallySpecializeType(
            overriddenType,
            overriddenClassAndSymbol.classType,
            this._evaluator.getTypeClassType()
        );

        const overrideSymbol = overrideClassAndSymbol.symbol;
        let overrideType = this._evaluator.getEffectiveTypeOfSymbol(overrideSymbol);
        overrideType = partiallySpecializeType(
            overrideType,
            overrideClassAndSymbol.classType,
            this._evaluator.getTypeClassType()
        );

        const childOverrideSymbol = ClassType.getSymbolTable(childClassType).get(memberName);
        const childOverrideType = childOverrideSymbol
            ? this._evaluator.getEffectiveTypeOfSymbol(childOverrideSymbol)
            : undefined;

        let diag: Diagnostic | undefined;
        const overrideDecl = getLastTypedDeclarationForSymbol(overrideClassAndSymbol.symbol);
        const overriddenDecl = getLastTypedDeclarationForSymbol(overriddenClassAndSymbol.symbol);

        if (isFunctionOrOverloaded(overriddenType)) {
            const diagAddendum = new DiagnosticAddendum();

            if (isFunctionOrOverloaded(overrideType)) {
                if (
                    !this._evaluator.validateOverrideMethod(
                        overriddenType,
                        overrideType,
                        /* baseClass */ undefined,
                        diagAddendum,
                        /* enforceParamNameMatch */ true
                    )
                ) {
                    if (overrideDecl && overrideDecl.type === DeclarationType.Function) {
                        diag = this._evaluator.addDiagnostic(
                            DiagnosticRule.reportIncompatibleMethodOverride,
                            LocMessage.baseClassMethodTypeIncompatible().format({
                                classType: childClassType.shared.name,
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
                            classType: childClassType.shared.name,
                            name: memberName,
                        }),
                        errorNode
                    );
                }
            } else {
                this._validateMultipleInheritancePropertyOverride(
                    overriddenClassAndSymbol.classType,
                    childClassType,
                    overriddenType,
                    overrideType,
                    overrideSymbol,
                    memberName,
                    errorNode
                );
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
                    ClassType.isDataClassFrozen(overriddenClassAndSymbol.classType) &&
                    overriddenClassAndSymbol.classType.shared.dataClassEntries
                ) {
                    const dataclassEntry = overriddenClassAndSymbol.classType.shared.dataClassEntries.find(
                        (entry) => entry.name === memberName
                    );
                    if (dataclassEntry) {
                        isInvariant = false;
                    }
                }

                let overriddenTDEntry: TypedDictEntry | undefined;
                if (overriddenClassAndSymbol.classType.shared.typedDictEntries) {
                    overriddenTDEntry =
                        overriddenClassAndSymbol.classType.shared.typedDictEntries.knownItems.get(memberName) ??
                        overriddenClassAndSymbol.classType.shared.typedDictEntries.extraItems ??
                        getEffectiveExtraItemsEntryType(this._evaluator, overriddenClassAndSymbol.classType);

                    if (overriddenTDEntry?.isReadOnly) {
                        isInvariant = false;
                    }
                }

                let overrideTDEntry: TypedDictEntry | undefined;
                if (overrideClassAndSymbol.classType.shared.typedDictEntries) {
                    overrideTDEntry =
                        overrideClassAndSymbol.classType.shared.typedDictEntries.knownItems.get(memberName) ??
                        overrideClassAndSymbol.classType.shared.typedDictEntries.extraItems ??
                        getEffectiveExtraItemsEntryType(this._evaluator, overrideClassAndSymbol.classType);
                }

                if (
                    !this._evaluator.assignType(
                        overriddenType,
                        childOverrideType ?? overrideType,
                        /* diag */ undefined,
                        /* constraints */ undefined,
                        isInvariant ? AssignTypeFlags.Invariant : AssignTypeFlags.Default
                    )
                ) {
                    diag = this._evaluator.addDiagnostic(
                        DiagnosticRule.reportIncompatibleVariableOverride,
                        LocMessage.baseClassVariableTypeIncompatible().format({
                            classType: childClassType.shared.name,
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
            this._addMultipleInheritanceRelatedInfo(
                diag,
                overriddenClassAndSymbol.classType,
                overriddenType,
                overriddenDecl,
                overrideClassAndSymbol.classType,
                overrideType,
                overrideDecl
            );
        }
    }

    private _addMultipleInheritanceRelatedInfo(
        diag: Diagnostic,
        overriddenClass: ClassType,
        overriddenType: Type,
        overriddenDecl: Declaration,
        overrideClass: ClassType,
        overrideType: Type,
        overrideDecl: Declaration
    ) {
        diag.addRelatedInfo(
            LocAddendum.baseClassOverriddenType().format({
                baseClass: this._evaluator.printType(convertToInstance(overriddenClass)),
                type: this._evaluator.printType(overriddenType),
            }),
            overriddenDecl.uri,
            overriddenDecl.range
        );

        diag.addRelatedInfo(
            LocAddendum.baseClassOverridesType().format({
                baseClass: this._evaluator.printType(convertToInstance(overrideClass)),
                type: this._evaluator.printType(overrideType),
            }),
            overrideDecl.uri,
            overrideDecl.range
        );
    }

    private _validateMultipleInheritancePropertyOverride(
        overriddenClassType: ClassType,
        overrideClassType: ClassType,
        overriddenSymbolType: Type,
        overrideSymbolType: Type,
        overrideSymbol: Symbol,
        memberName: string,
        errorNode: ParseNode
    ) {
        const propMethodInfo: [string, (c: ClassType) => FunctionType | undefined][] = [
            ['fget', (c) => c.priv.fgetInfo?.methodType],
            ['fset', (c) => c.priv.fsetInfo?.methodType],
            ['fdel', (c) => c.priv.fdelInfo?.methodType],
        ];

        propMethodInfo.forEach((info) => {
            const diagAddendum = new DiagnosticAddendum();
            const [methodName, methodAccessor] = info;
            const baseClassPropMethod = methodAccessor(overriddenSymbolType as ClassType);
            const subclassPropMethod = methodAccessor(overrideSymbolType as ClassType);

            // Is the method present on the base class but missing in the subclass?
            if (baseClassPropMethod) {
                const baseClassMethodType = partiallySpecializeType(
                    baseClassPropMethod,
                    overriddenClassType,
                    this._evaluator.getTypeClassType()
                );

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
                                    className: overriddenClassType.shared.name,
                                }) + diagAddendum.getString(),
                                errorNode
                            );

                            const origDecl = baseClassMethodType.shared.declaration;
                            if (diag && origDecl) {
                                this._addMultipleInheritanceRelatedInfo(
                                    diag,
                                    overriddenClassType,
                                    overriddenSymbolType,
                                    origDecl,
                                    overrideClassType,
                                    overrideSymbolType,
                                    lastDecl
                                );
                            }
                        }
                    } else {
                        const subclassMethodType = partiallySpecializeType(
                            subclassPropMethod,
                            overrideClassType,
                            this._evaluator.getTypeClassType()
                        );

                        if (isFunction(subclassMethodType)) {
                            if (
                                !this._evaluator.validateOverrideMethod(
                                    baseClassMethodType,
                                    subclassMethodType,
                                    overrideClassType,
                                    diagAddendum.createAddendum()
                                )
                            ) {
                                diagAddendum.addMessage(
                                    LocAddendum.propertyMethodIncompatible().format({
                                        name: methodName,
                                    })
                                );
                                const decl = subclassMethodType.shared.declaration;

                                if (decl && decl.type === DeclarationType.Function) {
                                    const diag = this._evaluator.addDiagnostic(
                                        DiagnosticRule.reportIncompatibleMethodOverride,
                                        LocMessage.propertyOverridden().format({
                                            name: memberName,
                                            className: overriddenClassType.shared.name,
                                        }) + diagAddendum.getString(),
                                        errorNode
                                    );

                                    const origDecl = baseClassMethodType.shared.declaration;
                                    if (diag && origDecl) {
                                        this._addMultipleInheritanceRelatedInfo(
                                            diag,
                                            overriddenClassType,
                                            overriddenSymbolType,
                                            origDecl,
                                            overrideClassType,
                                            overrideSymbolType,
                                            decl
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

            if (!isOverloaded(typeOfSymbol)) {
                return;
            }

            const overloads = OverloadedType.getOverloads(typeOfSymbol);
            const implementation = OverloadedType.getImplementation(typeOfSymbol);

            this._validateOverloadFinalOverride(overloads, implementation);

            this._validateOverloadAbstractConsistency(overloads, implementation);
        });
    }

    private _validateOverloadAbstractConsistency(overloads: FunctionType[], implementation: Type | undefined) {
        // If there's an implementation, it will determine whether the
        // function is abstract.
        if (implementation && isFunction(implementation)) {
            const isImplAbstract = FunctionType.isAbstractMethod(implementation);
            if (isImplAbstract) {
                return;
            }

            overloads.forEach((overload) => {
                const decl = overload.shared.declaration;

                if (FunctionType.isAbstractMethod(overload) && decl) {
                    this._evaluator.addDiagnostic(
                        DiagnosticRule.reportInconsistentOverload,
                        LocMessage.overloadAbstractImplMismatch().format({
                            name: overload.shared.name,
                        }),
                        getNameNodeForDeclaration(decl) ?? decl.node
                    );
                }
            });
            return;
        }

        if (overloads.length < 2) {
            return;
        }

        // If there was no implementation, make sure all overloads are either
        // abstract or not abstract.
        const isFirstOverloadAbstract = FunctionType.isAbstractMethod(overloads[0]);

        overloads.slice(1).forEach((overload, index) => {
            if (FunctionType.isAbstractMethod(overload) !== isFirstOverloadAbstract && overload.shared.declaration) {
                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportInconsistentOverload,
                    LocMessage.overloadAbstractMismatch().format({
                        name: overload.shared.name,
                    }),
                    getNameNodeForDeclaration(overload.shared.declaration) ?? overload.shared.declaration.node
                );
            }
        });
    }

    private _validateOverloadFinalOverride(overloads: FunctionType[], implementation: Type | undefined) {
        // If there's an implementation, the overloads are not allowed to be marked final or override.
        if (implementation) {
            overloads.forEach((overload) => {
                if (FunctionType.isFinal(overload) && overload.shared.declaration?.node) {
                    this._evaluator.addDiagnostic(
                        DiagnosticRule.reportInconsistentOverload,
                        LocMessage.overloadFinalImpl(),
                        getNameNodeForDeclaration(overload.shared.declaration) ?? overload.shared.declaration.node
                    );
                }

                if (FunctionType.isOverridden(overload) && overload.shared.declaration?.node) {
                    this._evaluator.addDiagnostic(
                        DiagnosticRule.reportInconsistentOverload,
                        LocMessage.overloadOverrideImpl(),
                        getNameNodeForDeclaration(overload.shared.declaration) ?? overload.shared.declaration.node
                    );
                }
            });

            return;
        }

        // If there's not an implementation, only the first overload can be marked final.
        if (overloads.length === 0) {
            return;
        }

        overloads.slice(1).forEach((overload, index) => {
            if (FunctionType.isFinal(overload) && overload.shared.declaration?.node) {
                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportInconsistentOverload,
                    LocMessage.overloadFinalNoImpl(),
                    getNameNodeForDeclaration(overload.shared.declaration) ?? overload.shared.declaration.node
                );
            }

            if (FunctionType.isOverridden(overload) && overload.shared.declaration?.node) {
                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportInconsistentOverload,
                    LocMessage.overloadOverrideNoImpl(),
                    getNameNodeForDeclaration(overload.shared.declaration) ?? overload.shared.declaration.node
                );
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

        for (const baseClass of classType.shared.baseClasses) {
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

            const solution = buildSolutionFromSpecializedClass(baseClass);

            const baseExtraItemsType = baseTypedDictEntries.extraItems
                ? applySolvedTypeVars(baseTypedDictEntries.extraItems.valueType, solution)
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
                            /* constraints */ undefined,
                            !baseTypedDictEntries.extraItems.isReadOnly
                                ? AssignTypeFlags.Invariant
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
                        /* constraints */ undefined,
                        !baseTypedDictEntries.extraItems.isReadOnly
                            ? AssignTypeFlags.Invariant
                            : AssignTypeFlags.Default
                    )
                ) {
                    diag.addMessage(
                        LocAddendum.typedDictClosedExtraTypeMismatch().format({
                            name: 'extra_items',
                            type: this._evaluator.printType(typedDictEntries.extraItems.valueType),
                        })
                    );
                }
            }

            if (!diag.isEmpty() && classType.shared.declaration) {
                const declNode = getNameNodeForDeclaration(classType.shared.declaration);

                if (declNode) {
                    if (baseTypedDictEntries.extraItems) {
                        this._evaluator.addDiagnostic(
                            DiagnosticRule.reportIncompatibleVariableOverride,
                            LocMessage.typedDictClosedExtras().format({
                                name: baseClass.shared.name,
                                type: this._evaluator.printType(baseExtraItemsType),
                            }) + diag.getString(),
                            declNode
                        );
                    } else {
                        this._evaluator.addDiagnostic(
                            DiagnosticRule.reportIncompatibleVariableOverride,
                            LocMessage.typedDictClosedNoExtras().format({
                                name: baseClass.shared.name,
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

            for (const baseClass of classType.shared.baseClasses) {
                if (!isClass(baseClass)) {
                    continue;
                }

                // Look up the base class in the MRO list. It's the same generic class
                // but has already been specialized using the type variables of the classType.
                const mroBaseClass = classType.shared.mro.find(
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
        } else if (isOverloaded(overrideType)) {
            const impl = OverloadedType.getImplementation(overrideType);
            if (impl && isFunction(impl)) {
                overrideFunction = impl;
            }
        } else if (isClassInstance(overrideType) && ClassType.isPropertyClass(overrideType)) {
            if (overrideType.priv.fgetInfo) {
                overrideFunction = overrideType.priv.fgetInfo.methodType;
            }
        }

        if (!overrideFunction?.shared.declaration || FunctionType.isOverridden(overrideFunction)) {
            return;
        }

        // Constructors are exempt.
        if (this._isMethodExemptFromLsp(overrideFunction.shared.name)) {
            return;
        }

        // If the declaration for the override function is not the same as the
        // declaration for the symbol, the function was probably replaced by a decorator.
        if (!symbol.getDeclarations().some((decl) => decl === overrideFunction!.shared.declaration)) {
            return;
        }

        // If the base class is unknown, don't report a missing decorator.
        if (isAnyOrUnknown(baseMember.classType)) {
            return;
        }

        const funcNode = overrideFunction.shared.declaration.node;
        this._evaluator.addDiagnostic(
            DiagnosticRule.reportImplicitOverride,
            LocMessage.overrideDecoratorMissing().format({
                name: funcNode.d.name.d.value,
                className: this._evaluator.printType(convertToInstance(baseMember.classType)),
            }),
            funcNode.d.name
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
        } else if (isOverloaded(overrideType)) {
            const impl = OverloadedType.getImplementation(overrideType);
            if (impl && isFunction(impl)) {
                overrideFunction = impl;
            }

            // If there is no implementation present, use the first overload.
            if (!impl) {
                const overloads = OverloadedType.getOverloads(overrideType);
                if (overloads.length > 0) {
                    overrideFunction = overloads[0];
                }
            }
        } else if (isClassInstance(overrideType) && ClassType.isPropertyClass(overrideType)) {
            if (overrideType.priv.fgetInfo) {
                overrideFunction = overrideType.priv.fgetInfo.methodType;
            }
        }

        if (!overrideFunction?.shared.declaration || !FunctionType.isOverridden(overrideFunction)) {
            return;
        }

        // If the declaration for the override function is not the same as the
        // declaration for the symbol, the function was probably replaced by a decorator.
        if (!symbol.getDeclarations().some((decl) => decl === overrideFunction!.shared.declaration)) {
            return;
        }

        const funcNode = overrideFunction.shared.declaration.node;
        this._evaluator.addDiagnostic(
            DiagnosticRule.reportGeneralTypeIssues,
            LocMessage.overriddenMethodNotFound().format({ name: funcNode.d.name.d.value }),
            funcNode.d.name
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
        const childClassSelf = ClassType.cloneAsInstance(
            selfSpecializeClass(childClassType, { useBoundTypeVars: true })
        );

        // The "Self" value for the base class depends on whether it's a
        // protocol or not. It's not clear from the typing spec whether
        // this is the correct behavior.
        const baseClassSelf = ClassType.isProtocolClass(baseClass)
            ? childClassSelf
            : ClassType.cloneAsInstance(selfSpecializeClass(baseClass, { useBoundTypeVars: true }));

        let baseType = partiallySpecializeType(
            this._evaluator.getEffectiveTypeOfSymbol(baseClassAndSymbol.symbol),
            baseClass,
            this._evaluator.getTypeClassType(),
            baseClassSelf
        );

        overrideType = partiallySpecializeType(
            overrideType,
            childClassType,
            this._evaluator.getTypeClassType(),
            childClassSelf
        );

        if (childClassType.shared.typeVarScopeId) {
            overrideType = makeTypeVarsBound(overrideType, [childClassType.shared.typeVarScopeId]);
            baseType = makeTypeVarsBound(baseType, [childClassType.shared.typeVarScopeId]);
        }

        if (isFunctionOrOverloaded(baseType)) {
            const diagAddendum = new DiagnosticAddendum();

            // Determine whether this is an attempt to override a method marked @final.
            if (this._isFinalFunction(memberName, baseType)) {
                const decl = getLastTypedDeclarationForSymbol(overrideSymbol);
                if (decl && decl.type === DeclarationType.Function) {
                    const diag = this._evaluator.addDiagnostic(
                        DiagnosticRule.reportIncompatibleMethodOverride,
                        LocMessage.finalMethodOverride().format({
                            name: memberName,
                            className: baseClass.shared.name,
                        }),
                        decl.node.d.name
                    );

                    const origDecl = getLastTypedDeclarationForSymbol(baseClassAndSymbol.symbol);
                    if (diag && origDecl) {
                        diag.addRelatedInfo(LocAddendum.finalMethod(), origDecl.uri, origDecl.range);
                    }
                }
            }

            // Don't check certain magic functions or private symbols.
            // Also, skip this check if the class is a TypedDict. The methods for a TypedDict
            // are synthesized, and they can result in many overloads. We assume they
            // are correct and will not produce any errors.
            if (
                this._isMethodExemptFromLsp(memberName) ||
                SymbolNameUtils.isPrivateName(memberName) ||
                ClassType.isTypedDictClass(childClassType)
            ) {
                return;
            }

            if (isFunctionOrOverloaded(overrideType)) {
                // Don't enforce parameter names for dundered methods. Many of them
                // are misnamed in typeshed stubs, so this would result in many
                // false positives.
                const enforceParamNameMatch = !SymbolNameUtils.isDunderName(memberName);

                if (
                    this._evaluator.validateOverrideMethod(
                        baseType,
                        overrideType,
                        childClassType,
                        diagAddendum,
                        enforceParamNameMatch
                    )
                ) {
                    return;
                }

                const decl = getLastTypedDeclarationForSymbol(overrideSymbol);
                if (!decl) {
                    return;
                }

                const diag = this._evaluator.addDiagnostic(
                    DiagnosticRule.reportIncompatibleMethodOverride,
                    LocMessage.incompatibleMethodOverride().format({
                        name: memberName,
                        className: baseClass.shared.name,
                    }) + diagAddendum.getString(),
                    getNameNodeForDeclaration(decl) ?? decl.node
                );

                const origDecl = getLastTypedDeclarationForSymbol(baseClassAndSymbol.symbol);
                if (diag && origDecl) {
                    diag.addRelatedInfo(LocAddendum.overriddenMethod(), origDecl.uri, origDecl.range);
                }
                return;
            }

            if (!isAnyOrUnknown(overrideType)) {
                // Special-case overrides of methods in '_TypedDict', since
                // TypedDict attributes aren't manifest as attributes but rather
                // as named keys.
                if (ClassType.isBuiltIn(baseClass, ['_TypedDict', 'TypedDictFallback'])) {
                    return;
                }

                const decls = overrideSymbol.getDeclarations();
                if (decls.length === 0) {
                    return;
                }

                const lastDecl = decls[decls.length - 1];
                const diag = this._evaluator.addDiagnostic(
                    DiagnosticRule.reportIncompatibleMethodOverride,
                    LocMessage.methodOverridden().format({
                        name: memberName,
                        className: baseClass.shared.name,
                        type: this._evaluator.printType(overrideType),
                    }),
                    getNameNodeForDeclaration(lastDecl) ?? lastDecl.node
                );

                const origDecl = getLastTypedDeclarationForSymbol(baseClassAndSymbol.symbol);
                if (diag && origDecl) {
                    diag.addRelatedInfo(LocAddendum.overriddenMethod(), origDecl.uri, origDecl.range);
                }
            }
            return;
        }

        if (isProperty(baseType)) {
            // Handle properties specially.
            if (!isProperty(overrideType)) {
                const decls = overrideSymbol.getDeclarations();
                if (decls.length > 0 && overrideSymbol.isClassMember()) {
                    const lastDecl = decls[decls.length - 1];
                    this._evaluator.addDiagnostic(
                        DiagnosticRule.reportIncompatibleMethodOverride,
                        LocMessage.propertyOverridden().format({
                            name: memberName,
                            className: baseClass.shared.name,
                        }),
                        getNameNodeForDeclaration(lastDecl) ?? lastDecl.node
                    );
                }
            } else {
                this._validatePropertyOverride(
                    baseClass,
                    childClassType,
                    baseType,
                    overrideType,
                    overrideSymbol,
                    memberName
                );
            }
            return;
        }

        // This check can be expensive, so don't perform it if the corresponding
        // rule is disabled.
        if (this._fileInfo.diagnosticRuleSet.reportIncompatibleVariableOverride !== 'none') {
            const decls = overrideSymbol.getDeclarations();

            if (decls.length === 0) {
                return;
            }

            const lastDecl = decls[decls.length - 1];
            const primaryDecl = decls[0];

            // Verify that the override type is assignable to (same or narrower than)
            // the declared type of the base symbol.
            let isInvariant = primaryDecl?.type === DeclarationType.Variable && !primaryDecl.isFinal;

            // If the entry is a member of a frozen dataclass, it is immutable,
            // so it does not need to be invariant.
            if (ClassType.isDataClassFrozen(baseClass) && baseClass.shared.dataClassEntries) {
                const dataclassEntry = baseClass.shared.dataClassEntries.find((entry) => entry.name === memberName);
                if (dataclassEntry) {
                    isInvariant = false;
                }
            }

            let overriddenTDEntry: TypedDictEntry | undefined;
            let overrideTDEntry: TypedDictEntry | undefined;

            if (!overrideSymbol.isIgnoredForProtocolMatch()) {
                if (baseClass.shared.typedDictEntries) {
                    overriddenTDEntry =
                        baseClass.shared.typedDictEntries.knownItems.get(memberName) ??
                        baseClass.shared.typedDictEntries.extraItems ??
                        getEffectiveExtraItemsEntryType(this._evaluator, baseClass);

                    if (overriddenTDEntry?.isReadOnly) {
                        isInvariant = false;
                    }
                }

                if (childClassType.shared.typedDictEntries) {
                    overrideTDEntry =
                        childClassType.shared.typedDictEntries.knownItems.get(memberName) ??
                        childClassType.shared.typedDictEntries.extraItems ??
                        getEffectiveExtraItemsEntryType(this._evaluator, childClassType);
                }
            }

            let diagAddendum = new DiagnosticAddendum();
            if (
                !this._evaluator.assignType(
                    baseType,
                    overrideType,
                    diagAddendum,
                    /* constraints */ undefined,
                    isInvariant ? AssignTypeFlags.Invariant : AssignTypeFlags.Default
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
                        className: baseClass.shared.name,
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
                        className: baseClass.shared.name,
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
                if (overrideSymbol.getTypedDeclarations().every((decl) => decl.type === DeclarationType.Class)) {
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
                        className: baseClass.shared.name,
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

    private _isFinalFunction(name: string, type: Type) {
        if (SymbolNameUtils.isPrivateName(name)) {
            return false;
        }

        if (isFunction(type) && FunctionType.isFinal(type)) {
            return true;
        }

        if (isOverloaded(type)) {
            const overloads = OverloadedType.getOverloads(type);
            const impl = OverloadedType.getImplementation(type);

            if (overloads.some((overload) => FunctionType.isFinal(overload))) {
                return true;
            }

            if (impl && isFunction(impl) && FunctionType.isFinal(impl)) {
                return true;
            }
        }

        return false;
    }

    private _validatePropertyOverride(
        baseClassType: ClassType,
        childClassType: ClassType,
        baseType: Type,
        childType: Type,
        overrideSymbol: Symbol,
        memberName: string
    ) {
        const propMethodInfo: [string, (c: ClassType) => FunctionType | undefined][] = [
            ['fget', (c) => c.priv.fgetInfo?.methodType],
            ['fset', (c) => c.priv.fsetInfo?.methodType],
            ['fdel', (c) => c.priv.fdelInfo?.methodType],
        ];

        propMethodInfo.forEach((info) => {
            const diagAddendum = new DiagnosticAddendum();
            const [methodName, methodAccessor] = info;
            const baseClassPropMethod = methodAccessor(baseType as ClassType);
            const subclassPropMethod = methodAccessor(childType as ClassType);

            // Is the method present on the base class but missing in the subclass?
            if (baseClassPropMethod) {
                const baseClassMethodType = partiallySpecializeType(
                    baseClassPropMethod,
                    baseClassType,
                    this._evaluator.getTypeClassType()
                );

                if (!isFunction(baseClassMethodType)) {
                    return;
                }

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
                                className: baseClassType.shared.name,
                            }) + diagAddendum.getString(),
                            getNameNodeForDeclaration(lastDecl) ?? lastDecl.node
                        );

                        const origDecl = baseClassMethodType.shared.declaration;
                        if (diag && origDecl) {
                            diag.addRelatedInfo(LocAddendum.overriddenMethod(), origDecl.uri, origDecl.range);
                        }
                    }

                    return;
                } else if (this._isFinalFunction(methodName, baseClassPropMethod)) {
                    const decl = getLastTypedDeclarationForSymbol(overrideSymbol);
                    if (decl && decl.type === DeclarationType.Function) {
                        this._evaluator.addDiagnostic(
                            DiagnosticRule.reportIncompatibleMethodOverride,
                            LocMessage.finalMethodOverride().format({
                                name: memberName,
                                className: baseClassType.shared.name,
                            }),
                            decl.node.d.name
                        );
                    }
                }

                const subclassMethodType = partiallySpecializeType(
                    subclassPropMethod,
                    childClassType,
                    this._evaluator.getTypeClassType()
                );

                if (!isFunction(subclassMethodType)) {
                    return;
                }

                if (
                    this._evaluator.validateOverrideMethod(
                        baseClassMethodType,
                        subclassMethodType,
                        childClassType,
                        diagAddendum.createAddendum()
                    )
                ) {
                    return;
                }

                diagAddendum.addMessage(
                    LocAddendum.propertyMethodIncompatible().format({
                        name: methodName,
                    })
                );
                const decl = subclassMethodType.shared.declaration;
                if (!decl || decl.type !== DeclarationType.Function) {
                    return;
                }

                let diagLocation: ParseNode = decl.node.d.name;

                // Make sure the method decl is contained within the
                // class suite. If not, it probably comes from a decorator
                // in another class. We don't want to report the error
                // in the wrong location.
                const childClassDecl = childClassType.shared.declaration;
                if (
                    !childClassDecl ||
                    childClassDecl.node.nodeType !== ParseNodeType.Class ||
                    !ParseTreeUtils.isNodeContainedWithin(decl.node, childClassDecl.node.d.suite)
                ) {
                    const symbolDecls = overrideSymbol.getDeclarations();
                    if (symbolDecls.length === 0) {
                        return;
                    }
                    const lastSymbolDecl = symbolDecls[symbolDecls.length - 1];
                    diagLocation = getNameNodeForDeclaration(lastSymbolDecl) ?? lastSymbolDecl.node;
                }

                const diag = this._evaluator.addDiagnostic(
                    DiagnosticRule.reportIncompatibleMethodOverride,
                    LocMessage.propertyOverridden().format({
                        name: memberName,
                        className: baseClassType.shared.name,
                    }) + diagAddendum.getString(),
                    diagLocation
                );

                const origDecl = baseClassMethodType.shared.declaration;
                if (diag && origDecl) {
                    diag.addRelatedInfo(LocAddendum.overriddenMethod(), origDecl.uri, origDecl.range);
                }
            }
        });
    }

    // Performs checks on a function that is located within a class
    // and has been determined not to be a property accessor.
    private _validateMethod(node: FunctionNode, functionType: FunctionType, classNode: ClassNode) {
        const classTypeInfo = this._evaluator.getTypeOfClass(classNode);
        if (!classTypeInfo) {
            return;
        }

        const classType = classTypeInfo.classType;
        const methodName = node.d.name.d.value;
        const isMetaclass = isInstantiableMetaclass(classType);

        const superCheckMethods = ['__init__', '__init_subclass__', '__enter__', '__exit__'];
        if (superCheckMethods.includes(methodName)) {
            if (
                !FunctionType.isAbstractMethod(functionType) &&
                !FunctionType.isOverloaded(functionType) &&
                !this._fileInfo.isStubFile
            ) {
                this._validateSuperCallForMethod(node, functionType, classType);
            }
        }

        const selfNames = ['self', '_self', '__self'];
        const clsNames = ['cls', '_cls', '__cls'];
        const clsNamesMetaclass = ['__mcls', 'mcls', 'mcs', 'metacls'];

        if (methodName === '_generate_next_value_') {
            // Skip this check for _generate_next_value_.
            return;
        }

        if (methodName === '__new__') {
            // __new__ overrides should have a "cls" parameter.
            if (node.d.params.length === 0 || !node.d.params[0].d.name) {
                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportSelfClsParameterName,
                    LocMessage.newClsParam(),
                    node.d.name
                );
            } else {
                const paramName = node.d.params[0].d.name.d.value;
                if (!clsNames.includes(paramName) && !(isMetaclass && clsNamesMetaclass.includes(paramName))) {
                    this._evaluator.addDiagnostic(
                        DiagnosticRule.reportSelfClsParameterName,
                        LocMessage.newClsParam(),
                        node.d.params[0]
                    );
                }
            }

            this._validateClsSelfParamType(node, functionType, classType, /* isCls */ true);
            return;
        }

        if (FunctionType.isStaticMethod(functionType)) {
            if (node.d.params.length === 0 || !node.d.params[0].d.name) {
                return;
            }

            // Static methods should not have "self" or "cls" parameters.
            const paramName = node.d.params[0].d.name.d.value;
            if (paramName === 'self' || paramName === 'cls') {
                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportSelfClsParameterName,
                    LocMessage.staticClsSelfParam(),
                    node.d.params[0].d.name
                );
            }
            return;
        }

        if (FunctionType.isClassMethod(functionType)) {
            let paramName = '';
            if (node.d.params.length > 0 && node.d.params[0].d.name) {
                paramName = node.d.params[0].d.name.d.value;
            }

            // Class methods should have a "cls" parameter.
            if (!clsNames.includes(paramName) && !(isMetaclass && clsNamesMetaclass.includes(paramName))) {
                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportSelfClsParameterName,
                    LocMessage.classMethodClsParam(),
                    node.d.params.length > 0 ? node.d.params[0] : node.d.name
                );
            }

            this._validateClsSelfParamType(node, functionType, classType, /* isCls */ true);
            return;
        }

        const decoratorIsPresent = node.d.decorators.length > 0;
        const isOverloaded = FunctionType.isOverloaded(functionType);

        // The presence of a decorator can change the behavior, so we need
        // to back off from this check if a decorator is present. An overload
        // is a decorator, but we'll ignore that here.
        if (isOverloaded || !decoratorIsPresent) {
            let paramName = '';
            let firstParamIsSimple = true;

            if (node.d.params.length > 0) {
                if (node.d.params[0].d.name) {
                    paramName = node.d.params[0].d.name.d.value;
                }

                if (node.d.params[0].d.category !== ParamCategory.Simple) {
                    firstParamIsSimple = false;
                }
            }

            // Instance methods should have a "self" parameter.
            if (firstParamIsSimple && !selfNames.includes(paramName)) {
                const isLegalMetaclassName = isMetaclass && clsNames.includes(paramName);

                // Some typeshed stubs use a name that starts with an underscore to designate
                // a parameter that cannot be positional.
                const isPrivateName = SymbolNameUtils.isPrivateOrProtectedName(paramName);

                if (!isLegalMetaclassName && !isPrivateName) {
                    this._evaluator.addDiagnostic(
                        DiagnosticRule.reportSelfClsParameterName,
                        LocMessage.instanceMethodSelfParam(),
                        node.d.params.length > 0 ? node.d.params[0] : node.d.name
                    );
                }
            }
        }

        this._validateClsSelfParamType(node, functionType, classType, /* isCls */ false);
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

        const methodMember = lookUpClassMember(classType, methodType.shared.name, effectiveFlags);
        if (!methodMember) {
            return;
        }

        let foundCallOfMember = false;

        // Now scan the implementation of the method to determine whether
        // super().<method> has been called for all of the required base classes.
        const callNodeWalker = new ParseTreeUtils.CallNodeWalker((node) => {
            if (node.d.leftExpr.nodeType === ParseNodeType.MemberAccess) {
                // Is it accessing the method by the same name?
                if (node.d.leftExpr.d.member.d.value === methodType.shared.name) {
                    const memberBaseExpr = node.d.leftExpr.d.leftExpr;

                    // Is it a "super" call?
                    if (
                        memberBaseExpr.nodeType === ParseNodeType.Call &&
                        memberBaseExpr.d.leftExpr.nodeType === ParseNodeType.Name &&
                        memberBaseExpr.d.leftExpr.d.value === 'super'
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
        callNodeWalker.walk(node.d.suite);

        // If we didn't find a call to at least one base class, report the problem.
        if (!foundCallOfMember) {
            this._evaluator.addDiagnostic(
                DiagnosticRule.reportMissingSuperCall,
                LocMessage.missingSuperCall().format({
                    methodName: methodType.shared.name,
                }),
                node.d.name
            );
        }
    }

    // Validates that the annotated type of a "self" or "cls" parameter is
    // compatible with the type of the class that contains it.
    private _validateClsSelfParamType(
        node: FunctionNode,
        functionType: FunctionType,
        classType: ClassType,
        isCls: boolean
    ) {
        if (node.d.params.length < 1 || functionType.shared.parameters.length < 1) {
            return;
        }

        // If there is no type annotation, there's nothing to check because
        // the type will be inferred.d.typeAnnotation
        const paramInfo = functionType.shared.parameters[0];
        const paramType = FunctionType.getParamType(functionType, 0);
        const paramAnnotation = node.d.params[0].d.annotation ?? node.d.params[0].d.annotationComment;
        if (!paramAnnotation || !paramInfo.name) {
            return;
        }

        // If this is an __init__ method, we need to specifically check for the
        // use of class-scoped TypeVars, which are not allowed in this context
        // according to the typing spec.
        if (functionType.shared.name === '__init__' && functionType.shared.methodClass) {
            const typeVars = getTypeVarArgsRecursive(paramType);

            if (
                typeVars.some(
                    (typeVar) =>
                        typeVar.priv.scopeId === functionType.shared.methodClass?.shared.typeVarScopeId &&
                        !TypeVarType.isSelf(typeVar)
                )
            ) {
                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportInvalidTypeVarUse,
                    LocMessage.initMethodSelfParamTypeVar(),
                    paramAnnotation
                );
            }
        }

        // If this is a protocol class, the self and cls parameters can be bound
        // to something other than the class.
        if (ClassType.isProtocolClass(classType)) {
            return;
        }

        const concreteParamType = this._evaluator.makeTopLevelTypeVarsConcrete(paramType);
        const expectedType = isCls ? classType : convertToInstance(classType);

        // If the declared type is a protocol class or instance, skip
        // the check. This has legitimate uses for mix-in classes.
        if (isInstantiableClass(concreteParamType) && ClassType.isProtocolClass(concreteParamType)) {
            return;
        }
        if (isClassInstance(concreteParamType) && ClassType.isProtocolClass(concreteParamType)) {
            return;
        }

        // If the method starts with a `*args: P.args`, skip the check.
        if (
            paramInfo.category === ParamCategory.ArgsList &&
            isParamSpec(paramType) &&
            paramType.priv.paramSpecAccess === 'args'
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

        if (!this._evaluator.assignType(paramType, expectedType)) {
            // We exempt Never from this check because it has a legitimate use in this case.
            if (!isNever(paramType)) {
                this._evaluator.addDiagnostic(
                    DiagnosticRule.reportGeneralTypeIssues,
                    LocMessage.clsSelfParamTypeMismatch().format({
                        name: paramInfo.name,
                        classType: this._evaluator.printType(expectedType),
                    }),
                    paramAnnotation
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
        if (!enclosingFunctionNode || !enclosingFunctionNode.d.returnAnnotation) {
            return;
        }

        const functionTypeResult = this._evaluator.getTypeOfFunction(enclosingFunctionNode);
        if (!functionTypeResult) {
            return;
        }

        let declaredReturnType = FunctionType.getEffectiveReturnType(functionTypeResult.functionType);
        if (!declaredReturnType) {
            return;
        }

        const liveScopes = ParseTreeUtils.getTypeVarScopesForNode(node);
        declaredReturnType = makeTypeVarsBound(declaredReturnType, liveScopes);

        let generatorType: Type | undefined;
        if (
            !enclosingFunctionNode.d.isAsync &&
            isClassInstance(declaredReturnType) &&
            ClassType.isBuiltIn(declaredReturnType, 'AwaitableGenerator')
        ) {
            // Handle the old-style (pre-await) generator case
            // if the return type explicitly uses AwaitableGenerator.
            generatorType =
                this._evaluator.getTypeCheckerInternalsType(node, 'AwaitableGenerator') ??
                this._evaluator.getTypingType(node, 'AwaitableGenerator');
        } else {
            generatorType = this._evaluator.getTypingType(
                node,
                enclosingFunctionNode.d.isAsync ? 'AsyncGenerator' : 'Generator'
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
        const specializedGenerator = ClassType.cloneAsInstance(ClassType.specialize(generatorType, generatorTypeArgs));

        const diagAddendum = new DiagnosticAddendum();
        if (!this._evaluator.assignType(declaredReturnType, specializedGenerator, diagAddendum)) {
            const errorMessage = enclosingFunctionNode.d.isAsync
                ? LocMessage.generatorAsyncReturnType()
                : LocMessage.generatorSyncReturnType();

            this._evaluator.addDiagnostic(
                DiagnosticRule.reportReturnType,
                errorMessage.format({ yieldType: this._evaluator.printType(yieldType) }) +
                    (expectedDiagAddendum?.getString() ?? diagAddendum.getString()),
                node.d.expr ?? node,
                expectedDiagAddendum?.getEffectiveTextRange() ?? node.d.expr ?? node
            );
        }
    }

    // Determines whether any of the except statements are unreachable because
    // they are redundant.
    private _reportUnusedExceptStatements(node: TryNode) {
        let sawUnknownExceptionType = false;
        const exceptionTypesSoFar: ClassType[] = [];

        node.d.exceptClauses.forEach((except) => {
            if (sawUnknownExceptionType || except.d.isExceptGroup || !except.d.typeExpr) {
                return;
            }

            const exceptionType = this._evaluator.getType(except.d.typeExpr);
            if (!exceptionType || isAnyOrUnknown(exceptionType)) {
                sawUnknownExceptionType = true;
                return;
            }

            const typesOfThisExcept: ClassType[] = [];

            if (isInstantiableClass(exceptionType)) {
                // If the exception type is a variable whose type could represent
                // subclasses, the actual exception type is statically unknown.
                if (exceptionType.priv.includeSubclasses) {
                    sawUnknownExceptionType = true;
                }

                typesOfThisExcept.push(exceptionType);
            } else if (isClassInstance(exceptionType)) {
                const iterableType =
                    this._evaluator.getTypeOfIterator(
                        { type: exceptionType },
                        /* isAsync */ false,
                        /* errorNode */ except.d.typeExpr,
                        /* emitNotIterableError */ false
                    )?.type ?? UnknownType.create();

                doForEachSubtype(iterableType, (subtype) => {
                    if (isAnyOrUnknown(subtype)) {
                        sawUnknownExceptionType = true;
                    }

                    if (isInstantiableClass(subtype)) {
                        // If the exception type is a variable whose type could represent
                        // subclasses, the actual exception type is statically unknown.
                        if (subtype.priv.includeSubclasses) {
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
                        except.d.typeExpr
                    );
                    this._evaluator.addUnreachableCode(
                        except,
                        Reachability.UnreachableByAnalysis,
                        except.d.exceptSuite
                    );
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

                importStatement.node.d.imports.forEach((importFromAs) => {
                    // Ignore duplicates if they're aliased.
                    if (!importFromAs.d.alias) {
                        const prevImport = symbolMap.get(importFromAs.d.name.d.value);
                        if (prevImport) {
                            this._evaluator.addDiagnostic(
                                DiagnosticRule.reportDuplicateImport,
                                LocMessage.duplicateImport().format({ importName: importFromAs.d.name.d.value }),
                                importFromAs.d.name
                            );
                        } else {
                            symbolMap.set(importFromAs.d.name.d.value, importFromAs);
                        }
                    }
                });
            } else if (importStatement.subnode) {
                // Ignore duplicates if they're aliased.
                if (!importStatement.subnode.d.alias) {
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
