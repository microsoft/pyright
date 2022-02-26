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

import { Commands } from '../commands/commands';
import { DiagnosticLevel } from '../common/configOptions';
import { assert } from '../common/debug';
import { Diagnostic, DiagnosticAddendum } from '../common/diagnostic';
import { DiagnosticRule } from '../common/diagnosticRules';
import { getFileExtension } from '../common/pathUtils';
import { PythonVersion, versionToString } from '../common/pythonVersion';
import { TextRange } from '../common/textRange';
import { Localizer } from '../localization/localize';
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
    FormatStringNode,
    ForNode,
    FunctionNode,
    GlobalNode,
    IfNode,
    ImportAsNode,
    ImportFromAsNode,
    ImportFromNode,
    IndexNode,
    isExpressionNode,
    LambdaNode,
    ListComprehensionNode,
    ListNode,
    MatchNode,
    MemberAccessNode,
    ModuleNode,
    NameNode,
    NonlocalNode,
    ParameterCategory,
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
    TypeAnnotationNode,
    UnaryOperationNode,
    UnpackNode,
    WhileNode,
    WithNode,
    YieldFromNode,
    YieldNode,
} from '../parser/parseNodes';
import { getUnescapedString, UnescapeError, UnescapeErrorType } from '../parser/stringTokenUtils';
import { OperatorType } from '../parser/tokenizerTypes';
import { AnalyzerFileInfo } from './analyzerFileInfo';
import * as AnalyzerNodeInfo from './analyzerNodeInfo';
import { Declaration, DeclarationType } from './declaration';
import { isExplicitTypeAliasDeclaration, isFinalVariableDeclaration } from './declarationUtils';
import { ImportType } from './importResult';
import { getTopLevelImports } from './importStatementUtils';
import * as ParseTreeUtils from './parseTreeUtils';
import { ParseTreeWalker } from './parseTreeWalker';
import { validateClassPattern } from './patternMatching';
import { ScopeType } from './scope';
import { getScopeForNode } from './scopeUtils';
import { evaluateStaticBoolExpression } from './staticExpressions';
import { Symbol } from './symbol';
import * as SymbolNameUtils from './symbolNameUtils';
import { getLastTypedDeclaredForSymbol, isFinalVariable } from './symbolUtils';
import { TypeEvaluator } from './typeEvaluatorTypes';
import {
    ClassType,
    combineTypes,
    FunctionType,
    FunctionTypeFlags,
    isAnyOrUnknown,
    isClass,
    isClassInstance,
    isFunction,
    isInstantiableClass,
    isModule,
    isNever,
    isNoneInstance,
    isOverloadedFunction,
    isParamSpec,
    isPossiblyUnbound,
    isTypeSame,
    isTypeVar,
    isUnbound,
    isUnion,
    isUnknown,
    isVariadicTypeVar,
    NoneType,
    Type,
    TypeBase,
    TypeCategory,
    TypeVarType,
    UnknownType,
    Variance,
} from './types';
import {
    applySolvedTypeVars,
    CanAssignFlags,
    ClassMember,
    ClassMemberLookupFlags,
    convertToInstance,
    derivesFromAnyOrUnknown,
    derivesFromClassRecursive,
    doForEachSubtype,
    getClassFieldsRecursive,
    getDeclaredGeneratorReturnType,
    getGeneratorTypeArgs,
    getGeneratorYieldType,
    getParameterListDetails,
    getProtocolSymbols,
    getTypeVarArgumentsRecursive,
    getTypeVarScopeId,
    isEllipsisType,
    isLiteralType,
    isLiteralTypeOrUnion,
    isPartlyUnknown,
    isProperty,
    isTupleClass,
    isUnboundedTupleClass,
    lookUpClassMember,
    mapSubtypes,
    partiallySpecializeType,
    transformPossibleRecursiveTypeAlias,
} from './typeUtils';
import { TypeVarMap } from './typeVarMap';

interface LocalTypeVarInfo {
    isExempt: boolean;
    nodes: NameNode[];
}

interface DeprecatedForm {
    version: PythonVersion;
    fullName: string;
    replacementText: string;
}

const deprecatedAliases = new Map<string, DeprecatedForm>([
    ['Tuple', { version: PythonVersion.V3_9, fullName: 'builtins.tuple', replacementText: 'tuple' }],
    ['List', { version: PythonVersion.V3_9, fullName: 'builtins.list', replacementText: 'list' }],
    ['Dict', { version: PythonVersion.V3_9, fullName: 'builtins.dict', replacementText: 'dict' }],
    ['Set', { version: PythonVersion.V3_9, fullName: 'builtins.set', replacementText: 'set' }],
    ['FrozenSet', { version: PythonVersion.V3_9, fullName: 'builtins.frozenset', replacementText: 'frozenset' }],
    ['Type', { version: PythonVersion.V3_9, fullName: 'builtins.type', replacementText: 'type' }],
    ['Deque', { version: PythonVersion.V3_9, fullName: 'collections.deque', replacementText: 'collections.deque' }],
    [
        'DefaultDict',
        {
            version: PythonVersion.V3_9,
            fullName: 'collections.defaultdict',
            replacementText: 'collections.defaultdict',
        },
    ],
    [
        'OrderedDict',
        {
            version: PythonVersion.V3_9,
            fullName: 'collections.OrderedDict',
            replacementText: 'collections.OrderedDict',
        },
    ],
    [
        'Counter',
        { version: PythonVersion.V3_9, fullName: 'collections.Counter', replacementText: 'collections.Counter' },
    ],
    [
        'ChainMap',
        { version: PythonVersion.V3_9, fullName: 'collections.ChainMap', replacementText: 'collections.ChainMap' },
    ],
]);

const deprecatedSpecialForms = new Map<string, DeprecatedForm>([
    ['Optional', { version: PythonVersion.V3_10, fullName: 'typing.Optional', replacementText: '| None' }],
    ['Union', { version: PythonVersion.V3_10, fullName: 'typing.Union', replacementText: '|' }],
]);

export class Checker extends ParseTreeWalker {
    private readonly _moduleNode: ModuleNode;
    private readonly _fileInfo: AnalyzerFileInfo;
    private readonly _evaluator: TypeEvaluator;
    private _isUnboundCheckSuppressed = false;

    // A list of all nodes that are defined within the module that
    // have their own scopes.
    private _scopedNodes: AnalyzerNodeInfo.ScopedNode[] = [];

    constructor(node: ModuleNode, evaluator: TypeEvaluator) {
        super();

        this._moduleNode = node;
        this._fileInfo = AnalyzerNodeInfo.getFileInfo(node)!;
        this._evaluator = evaluator;
    }

    check() {
        this._scopedNodes.push(this._moduleNode);

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
            }
        });

        return true;
    }

    override visitClass(node: ClassNode): boolean {
        const classTypeResult = this._evaluator.getTypeOfClass(node);

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
                                this._evaluator.addError(
                                    Localizer.Diagnostic.protocolBaseClass().format({
                                        classType: this._evaluator.printType(
                                            classTypeResult.classType,
                                            /* expandTypeAlias */ false
                                        ),
                                        baseType: this._evaluator.printType(baseClassType, /* expandTypeAlias */ false),
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

            // Skip the overrides check for stub files. Many of the built-in
            // typeshed stub files trigger this diagnostic. Also skip the slots
            // check because class variables declared in a stub file are
            // interpreted as instance variables.
            if (!this._fileInfo.isStubFile) {
                this._validateBaseClassOverrides(classTypeResult.classType);
                this._validateSlotsClassVarConflict(classTypeResult.classType);
            }

            this._validateMultipleInheritanceCompatibility(classTypeResult.classType, node.name);

            this._validateConstructorConsistency(classTypeResult.classType);

            this._validateFinalMemberOverrides(classTypeResult.classType);

            this._validateInstanceVariableInitialization(classTypeResult.classType);

            this._validateFinalClassNotAbstract(classTypeResult.classType, node);

            this._validateDataClassPostInit(classTypeResult.classType, node);

            this._validateProtocolCompatibility(classTypeResult.classType, node);

            this._reportDuplicateEnumMembers(classTypeResult.classType);

            if (ClassType.isTypedDictClass(classTypeResult.classType)) {
                this._validateTypedDictClassSuite(node.suite);
            }

            if (ClassType.isEnumClass(classTypeResult.classType)) {
                this._validateEnumClassOverride(node, classTypeResult.classType);
            }
        }

        this._scopedNodes.push(node);

        return false;
    }

    override visitFunction(node: FunctionNode): boolean {
        const functionTypeResult = this._evaluator.getTypeOfFunction(node);
        const containingClassNode = ParseTreeUtils.getEnclosingClass(node, /* stopAtFunction */ true);

        if (functionTypeResult) {
            // Track whether we have seen a *args: P.args parameter. Named
            // parameters after this need to be flagged as an error.
            let sawParamSpecArgs = false;

            // Report any unknown or missing parameter types.
            node.parameters.forEach((param, index) => {
                if (param.name) {
                    // Determine whether this is a P.args parameter.
                    if (param.category === ParameterCategory.VarArgList) {
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
                    } else if (param.category === ParameterCategory.VarArgDictionary) {
                        sawParamSpecArgs = false;
                    }
                }

                if (param.name && param.category === ParameterCategory.Simple && sawParamSpecArgs) {
                    this._evaluator.addDiagnostic(
                        this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                        DiagnosticRule.reportGeneralTypeIssues,
                        Localizer.Diagnostic.namedParamAfterParamSpecArgs().format({ name: param.name.value }),
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

                        if (
                            isUnknown(paramType) ||
                            (isTypeVar(paramType) &&
                                paramType.details.isSynthesized &&
                                !paramType.details.isSynthesizedSelf)
                        ) {
                            this._evaluator.addDiagnostic(
                                this._fileInfo.diagnosticRuleSet.reportUnknownParameterType,
                                DiagnosticRule.reportUnknownParameterType,
                                Localizer.Diagnostic.paramTypeUnknown().format({ paramName: param.name.value }),
                                param.name
                            );
                        } else if (isPartlyUnknown(paramType)) {
                            const diagAddendum = new DiagnosticAddendum();
                            diagAddendum.addMessage(
                                Localizer.DiagnosticAddendum.paramType().format({
                                    paramType: this._evaluator.printType(paramType, /* expandTypeAlias */ true),
                                })
                            );
                            this._evaluator.addDiagnostic(
                                this._fileInfo.diagnosticRuleSet.reportUnknownParameterType,
                                DiagnosticRule.reportUnknownParameterType,
                                Localizer.Diagnostic.paramTypePartiallyUnknown().format({
                                    paramName: param.name.value,
                                }) + diagAddendum.getString(),
                                param.name
                            );
                        }

                        let hasAnnotation = false;

                        if (functionTypeResult.functionType.details.parameters[index].typeAnnotation) {
                            hasAnnotation = true;
                        } else {
                            // See if this is a "self" and "cls" parameter. They are exempt from this rule.
                            if (isTypeVar(paramType) && paramType.details.isSynthesizedSelf) {
                                hasAnnotation = true;
                            }
                        }

                        if (!hasAnnotation) {
                            this._evaluator.addDiagnostic(
                                this._fileInfo.diagnosticRuleSet.reportMissingParameterType,
                                DiagnosticRule.reportMissingParameterType,
                                Localizer.Diagnostic.paramAnnotationMissing().format({ name: param.name.value }),
                                param.name
                            );
                        }
                    }
                }

                // If it's a stub file, report an issue of the default value expression is not "...".
                if (param.defaultValue && this._fileInfo.isStubFile) {
                    const defaultValueType = this._evaluator.getType(param.defaultValue);
                    if (!defaultValueType || !isEllipsisType(defaultValueType)) {
                        this._evaluator.addDiagnostic(
                            this._fileInfo.diagnosticRuleSet.reportInvalidStubStatement,
                            DiagnosticRule.reportInvalidStubStatement,
                            Localizer.Diagnostic.defaultValueNotEllipsis(),
                            param.defaultValue
                        );
                    }
                }
            });

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
                this._evaluator.addError(
                    Localizer.Diagnostic.paramSpecArgsKwargsUsage(),
                    paramSpecParams[0].typeAnnotation
                );
            }

            // If this is a stub, ensure that the return type is specified.
            if (this._fileInfo.isStubFile) {
                const returnAnnotation =
                    node.returnTypeAnnotation || node.functionAnnotationComment?.returnTypeAnnotation;
                if (!returnAnnotation) {
                    this._evaluator.addDiagnostic(
                        this._fileInfo.diagnosticRuleSet.reportUnknownParameterType,
                        DiagnosticRule.reportUnknownParameterType,
                        Localizer.Diagnostic.returnTypeUnknown(),
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

            if (functionTypeResult) {
                const annotationNode = param.typeAnnotation || param.typeAnnotationComment;
                if (annotationNode && index < functionTypeResult.functionType.details.parameters.length) {
                    const paramType = functionTypeResult.functionType.details.parameters[index].type;
                    if (
                        isTypeVar(paramType) &&
                        paramType.details.variance === Variance.Covariant &&
                        !paramType.details.isSynthesized &&
                        functionTypeResult.functionType.details.name !== '__init__'
                    ) {
                        this._evaluator.addDiagnostic(
                            this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                            DiagnosticRule.reportGeneralTypeIssues,
                            Localizer.Diagnostic.paramTypeCovariant(),
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
        }

        this.walkMultiple(node.decorators);

        node.parameters.forEach((param) => {
            if (param.name) {
                this.walk(param.name);
            }
        });

        this.walk(node.suite);

        if (functionTypeResult) {
            // Validate that the function returns the declared type.
            this._validateFunctionReturn(node, functionTypeResult.functionType);

            // Verify common dunder signatures.
            this._validateDunderSignatures(node, functionTypeResult.functionType, containingClassNode !== undefined);

            // Verify that strict type guard functions don't violate the constraints
            // of strict type guards.
            this._validateStrictTypeGuardFunction(
                node,
                functionTypeResult.functionType,
                containingClassNode !== undefined
            );
        }

        // If we're at the module level within a stub file, report a diagnostic
        // if there is a '__getattr__' function defined when in strict mode.
        // This signifies an incomplete stub file that obscures type errors.
        if (this._fileInfo.isStubFile && node.name.value === '__getattr__') {
            const scope = getScopeForNode(node);
            if (scope?.type === ScopeType.Module) {
                this._evaluator.addDiagnostic(
                    this._fileInfo.diagnosticRuleSet.reportIncompleteStub,
                    DiagnosticRule.reportIncompleteStub,
                    Localizer.Diagnostic.stubUsesGetAttr(),
                    node.name
                );
            }
        }

        this._scopedNodes.push(node);

        this._validateFunctionTypeVarUsage(node);

        if (functionTypeResult && isOverloadedFunction(functionTypeResult.decoratedType)) {
            const overloads = functionTypeResult.decoratedType.overloads;
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
                            this._fileInfo.diagnosticRuleSet.reportUnknownLambdaType,
                            DiagnosticRule.reportUnknownLambdaType,
                            Localizer.Diagnostic.paramTypeUnknown().format({ paramName: param.name.value }),
                            param.name
                        );
                    } else if (isPartlyUnknown(paramType)) {
                        this._evaluator.addDiagnostic(
                            this._fileInfo.diagnosticRuleSet.reportUnknownLambdaType,
                            DiagnosticRule.reportUnknownLambdaType,
                            Localizer.Diagnostic.paramTypePartiallyUnknown().format({ paramName: param.name.value }),
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
                    this._fileInfo.diagnosticRuleSet.reportUnknownLambdaType,
                    DiagnosticRule.reportUnknownLambdaType,
                    Localizer.Diagnostic.lambdaReturnTypeUnknown(),
                    node.expression
                );
            } else if (isPartlyUnknown(returnType)) {
                this._evaluator.addDiagnostic(
                    this._fileInfo.diagnosticRuleSet.reportUnknownLambdaType,
                    DiagnosticRule.reportUnknownLambdaType,
                    Localizer.Diagnostic.lambdaReturnTypePartiallyUnknown().format({
                        returnType: this._evaluator.printType(returnType, /* expandTypeAlias */ true),
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
                        this._fileInfo.diagnosticRuleSet.reportUnusedCallResult,
                        DiagnosticRule.reportUnusedCallResult,
                        Localizer.Diagnostic.unusedCallResult().format({
                            type: this._evaluator.printType(returnType, /* expandTypeAlias */ false),
                        }),
                        node
                    );

                    if (isClassInstance(returnType) && ClassType.isBuiltIn(returnType, 'Coroutine')) {
                        this._evaluator.addDiagnostic(
                            this._fileInfo.diagnosticRuleSet.reportUnusedCoroutine,
                            DiagnosticRule.reportUnusedCoroutine,
                            Localizer.Diagnostic.unusedCoroutine(),
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
                        this._fileInfo.diagnosticRuleSet.reportUnusedCallResult,
                        DiagnosticRule.reportUnusedCallResult,
                        Localizer.Diagnostic.unusedCallResult().format({
                            type: this._evaluator.printType(returnType, /* expandTypeAlias */ false),
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

    override visitIf(node: IfNode): boolean {
        this._evaluator.getType(node.testExpression);
        return true;
    }

    override visitWhile(node: WhileNode): boolean {
        this._evaluator.getType(node.testExpression);
        return true;
    }

    override visitWith(node: WithNode): boolean {
        node.withItems.forEach((item) => {
            this._evaluator.evaluateTypesForStatement(item);
        });

        return true;
    }

    override visitReturn(node: ReturnNode): boolean {
        let returnType: Type;

        const enclosingFunctionNode = ParseTreeUtils.getEnclosingFunction(node);
        const declaredReturnType = enclosingFunctionNode
            ? this._evaluator.getFunctionDeclaredReturnType(enclosingFunctionNode)
            : undefined;

        if (node.returnExpression) {
            returnType = this._evaluator.getType(node.returnExpression) || UnknownType.create();
        } else {
            // There is no return expression, so "None" is assumed.
            returnType = NoneType.createInstance();
        }

        if (this._evaluator.isNodeReachable(node, /* sourceNode */ undefined) && enclosingFunctionNode) {
            if (declaredReturnType) {
                if (isNever(declaredReturnType)) {
                    this._evaluator.addDiagnostic(
                        this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                        DiagnosticRule.reportGeneralTypeIssues,
                        Localizer.Diagnostic.noReturnContainsReturn(),
                        node
                    );
                } else {
                    const diagAddendum = new DiagnosticAddendum();
                    let returnTypeMatches = false;

                    if (
                        this._evaluator.canAssignType(
                            declaredReturnType,
                            returnType,
                            diagAddendum,
                            new TypeVarMap(),
                            CanAssignFlags.AllowBoolTypeGuard
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
                            const typeVarMap = new TypeVarMap();

                            for (const typeVar of uniqueTypeVars) {
                                if (typeVar.details.constraints.length > 0) {
                                    const narrowedType = this._evaluator.narrowConstrainedTypeVar(node, typeVar);
                                    if (narrowedType) {
                                        typeVarMap.setTypeVarType(typeVar, narrowedType);
                                        typeVarMap.addSolveForScope(getTypeVarScopeId(typeVar));
                                    }
                                }
                            }

                            if (!typeVarMap.isEmpty()) {
                                const adjustedReturnType = applySolvedTypeVars(declaredReturnType, typeVarMap);

                                if (
                                    this._evaluator.canAssignType(
                                        adjustedReturnType,
                                        returnType,
                                        diagAddendum,
                                        /* typeVarMap */ undefined,
                                        CanAssignFlags.AllowBoolTypeGuard
                                    )
                                ) {
                                    returnTypeMatches = true;
                                }
                            }
                        }
                    }

                    if (!returnTypeMatches) {
                        this._evaluator.addDiagnostic(
                            this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                            DiagnosticRule.reportGeneralTypeIssues,
                            Localizer.Diagnostic.returnTypeMismatch().format({
                                exprType: this._evaluator.printType(returnType, /* expandTypeAlias */ false),
                                returnType: this._evaluator.printType(declaredReturnType, /* expandTypeAlias */ false),
                            }) + diagAddendum.getString(),
                            node.returnExpression ? node.returnExpression : node
                        );
                    }
                }
            }

            if (isUnknown(returnType)) {
                this._evaluator.addDiagnostic(
                    this._fileInfo.diagnosticRuleSet.reportUnknownVariableType,
                    DiagnosticRule.reportUnknownVariableType,
                    Localizer.Diagnostic.returnTypeUnknown(),
                    node.returnExpression!
                );
            } else if (isPartlyUnknown(returnType)) {
                this._evaluator.addDiagnostic(
                    this._fileInfo.diagnosticRuleSet.reportUnknownVariableType,
                    DiagnosticRule.reportUnknownVariableType,
                    Localizer.Diagnostic.returnTypePartiallyUnknown().format({
                        returnType: this._evaluator.printType(returnType, /* expandTypeAlias */ true),
                    }),
                    node.returnExpression!
                );
            }
        }

        return true;
    }

    override visitYield(node: YieldNode) {
        const yieldType = node.expression ? this._evaluator.getType(node.expression) : NoneType.createInstance();
        this._validateYieldType(node, yieldType || UnknownType.create());
        return true;
    }

    override visitYieldFrom(node: YieldFromNode) {
        const yieldFromType = this._evaluator.getType(node.expression) || UnknownType.create();
        let yieldType: Type | undefined;

        if (isClassInstance(yieldFromType) && ClassType.isBuiltIn(yieldFromType, 'Coroutine')) {
            // Handle the case of old-style (pre-await) coroutines.
            yieldType = UnknownType.create();
        } else {
            yieldType =
                this._evaluator.getTypeFromIterable(yieldFromType, /* isAsync */ false, node) || UnknownType.create();

            // Does the iterator return a Generator? If so, get the yield type from it.
            // If the iterator doesn't return a Generator, use the iterator return type
            // directly.
            const generatorTypeArgs = getGeneratorTypeArgs(yieldType);
            if (generatorTypeArgs) {
                yieldType = generatorTypeArgs.length >= 1 ? generatorTypeArgs[0] : UnknownType.create();
            } else {
                yieldType =
                    this._evaluator.getTypeFromIterator(yieldFromType, /* isAsync */ false, node) ||
                    UnknownType.create();
            }
        }

        this._validateYieldType(node, yieldType);

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
                                    Localizer.Diagnostic.exceptionTypeIncorrect().format({
                                        type: this._evaluator.printType(subtype, /* expandTypeAlias */ false),
                                    })
                                );
                            }
                        } else {
                            diagAddendum.addMessage(
                                Localizer.Diagnostic.exceptionTypeIncorrect().format({
                                    type: this._evaluator.printType(subtype, /* expandTypeAlias */ false),
                                })
                            );
                        }
                    }
                });

                if (!diagAddendum.isEmpty()) {
                    this._evaluator.addError(
                        Localizer.Diagnostic.expectedExceptionObj() + diagAddendum.getString(),
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
                            Localizer.Diagnostic.assertAlwaysTrue(),
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
                if (isClassInstance(subtype) && subtype.tupleTypeArguments && !isUnboundedTupleClass(subtype)) {
                    const tupleLength = subtype.tupleTypeArguments.length;

                    if (
                        node.items.length === 1 &&
                        !node.trailingComma &&
                        node.items[0].argumentCategory === ArgumentCategory.Simple &&
                        !node.items[0].name
                    ) {
                        const subscriptType = this._evaluator.getType(node.items[0].valueExpression);
                        if (
                            subscriptType &&
                            isClassInstance(subscriptType) &&
                            ClassType.isBuiltIn(subscriptType, 'int') &&
                            isLiteralType(subscriptType) &&
                            typeof subscriptType.literalValue === 'number'
                        ) {
                            if (
                                (subscriptType.literalValue >= 0 && subscriptType.literalValue >= tupleLength) ||
                                (subscriptType.literalValue < 0 && subscriptType.literalValue + tupleLength < 0)
                            ) {
                                this._evaluator.addDiagnostic(
                                    this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                                    DiagnosticRule.reportGeneralTypeIssues,
                                    Localizer.Diagnostic.tupleIndexOutOfRange().format({
                                        index: subscriptType.literalValue,
                                        type: this._evaluator.printType(subtype),
                                    }),
                                    node
                                );
                            }
                        }
                    }
                }
            });
        }

        return true;
    }

    override visitBinaryOperation(node: BinaryOperationNode): boolean {
        if (node.operator === OperatorType.Equals || node.operator === OperatorType.NotEquals) {
            // Don't apply this rule if it's within an assert.
            if (!ParseTreeUtils.isWithinAssertExpression(node)) {
                this._validateComparisonTypes(node);
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
        this._evaluator.getType(node);
        return true;
    }

    override visitTernary(node: TernaryNode): boolean {
        this._evaluator.getType(node);
        return true;
    }

    override visitStringList(node: StringListNode): boolean {
        for (const stringNode of node.strings) {
            if (stringNode.hasUnescapeErrors) {
                const unescapedResult = getUnescapedString(stringNode.token);

                unescapedResult.unescapeErrors.forEach((error: UnescapeError) => {
                    const start =
                        stringNode.token.start +
                        stringNode.token.prefixLength +
                        stringNode.token.quoteMarkLength +
                        error.offset;
                    const textRange = { start, length: error.length };

                    if (error.errorType === UnescapeErrorType.InvalidEscapeSequence) {
                        this._evaluator.addDiagnosticForTextRange(
                            this._fileInfo,
                            this._fileInfo.diagnosticRuleSet.reportInvalidStringEscapeSequence,
                            DiagnosticRule.reportInvalidStringEscapeSequence,
                            Localizer.Diagnostic.stringUnsupportedEscape(),
                            textRange
                        );
                    } else if (error.errorType === UnescapeErrorType.EscapeWithinFormatExpression) {
                        this._evaluator.addDiagnosticForTextRange(
                            this._fileInfo,
                            'error',
                            '',
                            Localizer.Diagnostic.formatStringEscape(),
                            textRange
                        );
                    } else if (error.errorType === UnescapeErrorType.SingleCloseBraceWithinFormatLiteral) {
                        this._evaluator.addDiagnosticForTextRange(
                            this._fileInfo,
                            'error',
                            '',
                            Localizer.Diagnostic.formatStringBrace(),
                            textRange
                        );
                    } else if (error.errorType === UnescapeErrorType.UnterminatedFormatExpression) {
                        this._evaluator.addDiagnosticForTextRange(
                            this._fileInfo,
                            'error',
                            '',
                            Localizer.Diagnostic.formatStringUnterminated(),
                            textRange
                        );
                    }
                });
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
                Localizer.Diagnostic.implicitStringConcat(),
                node
            );
        }

        return true;
    }

    override visitFormatString(node: FormatStringNode): boolean {
        node.expressions.forEach((formatExpr) => {
            this._evaluator.getType(formatExpr);
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

        // Report the use of a deprecated symbol. For now, this functionality
        // is disabled. We'll leave it in place for the future.
        // this._reportDeprecatedUse(node);

        return true;
    }

    override visitDel(node: DelNode) {
        this._suppressUnboundCheck(() => {
            node.expressions.forEach((expr) => {
                this._evaluator.verifyDeleteExpression(expr);

                this.walk(expr);
            });
        });

        return false;
    }

    override visitMemberAccess(node: MemberAccessNode) {
        this._evaluator.getType(node);
        this._conditionallyReportPrivateUsage(node.memberName);

        // Walk the leftExpression but not the memberName.
        this.walk(node.leftExpression);

        return false;
    }

    override visitImportAs(node: ImportAsNode): boolean {
        this._evaluator.evaluateTypesForStatement(node);
        return false;
    }

    override visitImportFrom(node: ImportFromNode): boolean {
        if (!node.isWildcardImport) {
            node.imports.forEach((importAs) => {
                this._evaluator.evaluateTypesForStatement(importAs);
            });
        } else {
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
                    Localizer.Diagnostic.wildcardLibraryImport(),
                    node.wildcardToken || node
                );
            }
        }

        return false;
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
            this._evaluator.getType(node.guardExpression);
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

    private _validateExhaustiveMatch(node: MatchNode) {
        // This check can be expensive, so skip it if it's disabled.
        if (this._fileInfo.diagnosticRuleSet.reportMatchNotExhaustive === 'none') {
            return;
        }

        const narrowedTypeResult = this._evaluator.evaluateTypeForSubnode(node, () => {
            this._evaluator.evaluateTypesForMatchNode(node);
        });

        if (narrowedTypeResult && !isNever(narrowedTypeResult.type)) {
            const diagAddendum = new DiagnosticAddendum();
            diagAddendum.addMessage(
                Localizer.DiagnosticAddendum.matchIsNotExhaustiveType().format({
                    type: this._evaluator.printType(narrowedTypeResult.type),
                })
            );
            diagAddendum.addMessage(Localizer.DiagnosticAddendum.matchIsNotExhaustiveHint());

            this._evaluator.addDiagnostic(
                this._fileInfo.diagnosticRuleSet.reportMatchNotExhaustive,
                DiagnosticRule.reportMatchNotExhaustive,
                Localizer.Diagnostic.matchIsNotExhaustive() + diagAddendum.getString(),
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
                    this._fileInfo.diagnosticRuleSet.reportCallInDefaultInitializer,
                    DiagnosticRule.reportCallInDefaultInitializer,
                    Localizer.Diagnostic.defaultValueContainsCall(),
                    node
                );
            }
        }
    }

    // Determines whether the types of the two operands for an == or != operation
    // have overlapping types.
    private _validateComparisonTypes(node: BinaryOperationNode) {
        const leftType = this._evaluator.getType(node.leftExpression);
        const rightType = this._evaluator.getType(node.rightExpression);

        if (!leftType || !rightType) {
            return;
        }

        // Check for the special case where the LHS and RHS are both literals.
        if (isLiteralTypeOrUnion(rightType) && isLiteralTypeOrUnion(leftType)) {
            if (evaluateStaticBoolExpression(node, this._fileInfo.executionEnvironment) === undefined) {
                let isPossiblyTrue = false;

                doForEachSubtype(leftType, (leftSubtype) => {
                    if (this._evaluator.canAssignType(rightType, leftSubtype)) {
                        isPossiblyTrue = true;
                    }
                });

                if (!isPossiblyTrue) {
                    this._evaluator.addDiagnostic(
                        this._fileInfo.diagnosticRuleSet.reportUnnecessaryComparison,
                        DiagnosticRule.reportUnnecessaryComparison,
                        Localizer.Diagnostic.comparisonAlwaysFalse().format({
                            leftType: this._evaluator.printType(leftType, /* expandTypeAlias */ true),
                            rightType: this._evaluator.printType(rightType, /* expandTypeAlias */ true),
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
                const leftTypeText = this._evaluator.printType(leftType, /* expandTypeAlias */ true);
                const rightTypeText = this._evaluator.printType(rightType, /* expandTypeAlias */ true);

                const message =
                    node.operator === OperatorType.Equals
                        ? Localizer.Diagnostic.comparisonAlwaysFalse()
                        : Localizer.Diagnostic.comparisonAlwaysTrue();

                this._evaluator.addDiagnostic(
                    this._fileInfo.diagnosticRuleSet.reportUnnecessaryComparison,
                    DiagnosticRule.reportUnnecessaryComparison,
                    message.format({
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
            return !isTypeSame(leftType, rightType);
        }

        if (isNoneInstance(leftType) || isNoneInstance(rightType)) {
            return !isTypeSame(leftType, rightType);
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
                    this._evaluator.canAssignType(genericLeftType, genericRightType) ||
                    this._evaluator.canAssignType(genericRightType, genericLeftType)
                ) {
                    return true;
                }
            }

            // Does the class have an operator overload for eq?
            const metaclass = leftType.details.effectiveMetaclass;
            if (metaclass && isClass(metaclass)) {
                if (lookUpClassMember(metaclass, '__eq__', ClassMemberLookupFlags.SkipObjectBaseClass)) {
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
                    this._evaluator.canAssignType(genericLeftType, genericRightType) ||
                    this._evaluator.canAssignType(genericRightType, genericLeftType)
                ) {
                    return true;
                }
            }

            // Does the class have an operator overload for eq?
            if (
                lookUpClassMember(
                    ClassType.cloneAsInstantiable(leftType),
                    '__eq__',
                    ClassMemberLookupFlags.SkipObjectBaseClass
                )
            ) {
                return true;
            }

            return false;
        }

        return true;
    }

    // Determines whether the specified type is one that should trigger
    // an "unused" value diagnostic.
    private _isTypeValidForUnusedValueTest(type: Type) {
        return !isNoneInstance(type) && !isNever(type) && !isAnyOrUnknown(type);
    }

    // Verifies that each local type variable is used more than once.
    private _validateFunctionTypeVarUsage(node: FunctionNode) {
        // Skip this check entirely if it's disabled.
        if (this._fileInfo.diagnosticRuleSet.reportInvalidTypeVarUse === 'none') {
            return;
        }

        const localTypeVarUsage = new Map<string, LocalTypeVarInfo>();
        let exemptBoundTypeVar = true;

        const nameWalker = new ParseTreeUtils.NameNodeWalker((nameNode, subscriptIndex, baseExpression) => {
            const nameType = this._evaluator.getType(nameNode);
            ``;
            if (nameType && isTypeVar(nameType)) {
                if (nameType.scopeId === this._evaluator.getScopeIdForNode(node)) {
                    // We exempt constrained TypeVars, bound TypeVars that are type arguments of
                    // other types, and ParamSpecs. There are legitimate uses for singleton
                    // instances in these particular cases.
                    let isExempt =
                        nameType.details.constraints.length > 0 ||
                        (exemptBoundTypeVar &&
                            nameType.details.boundType !== undefined &&
                            subscriptIndex !== undefined) ||
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

                    if (!localTypeVarUsage.has(nameType.details.name)) {
                        localTypeVarUsage.set(nameType.details.name, {
                            nodes: [nameNode],
                            isExempt,
                        });
                    } else {
                        localTypeVarUsage.get(nameType.details.name)!.nodes.push(nameNode);
                    }
                }
            }
        });

        // Find all of the local type variables in signature.
        node.parameters.forEach((param) => {
            const annotation = param.typeAnnotation || param.typeAnnotationComment;
            if (annotation) {
                nameWalker.walk(annotation);
            }
        });

        if (node.returnTypeAnnotation) {
            // Don't exempt the use of a bound TypeVar when used as a type argument
            // within a return type. This exemption applies only to input parameter
            // annotations.
            exemptBoundTypeVar = false;
            nameWalker.walk(node.returnTypeAnnotation);
        }

        // Report errors for all local type variables that appear only once.
        localTypeVarUsage.forEach((usage) => {
            if (usage.nodes.length === 1 && !usage.isExempt) {
                this._evaluator.addDiagnostic(
                    this._fileInfo.diagnosticRuleSet.reportInvalidTypeVarUse,
                    DiagnosticRule.reportInvalidTypeVarUse,
                    Localizer.Diagnostic.typeVarUsedOnlyOnce().format({
                        name: usage.nodes[0].value,
                    }),
                    usage.nodes[0]
                );
            }
        });
    }

    private _validateOverloadConsistency(
        node: FunctionNode,
        functionType: FunctionType,
        prevOverloads: FunctionType[]
    ) {
        for (let i = 0; i < prevOverloads.length; i++) {
            const prevOverload = prevOverloads[i];
            if (
                FunctionType.isOverloaded(functionType) &&
                FunctionType.isOverloaded(prevOverload) &&
                this._isOverlappingOverload(functionType, prevOverload)
            ) {
                this._evaluator.addDiagnostic(
                    this._fileInfo.diagnosticRuleSet.reportOverlappingOverload,
                    DiagnosticRule.reportOverlappingOverload,
                    Localizer.Diagnostic.overlappingOverload().format({
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
            if (
                FunctionType.isOverloaded(functionType) &&
                FunctionType.isOverloaded(prevOverload) &&
                this._isOverlappingOverload(prevOverload, functionType)
            ) {
                const prevReturnType = FunctionType.getSpecializedReturnType(prevOverload);
                const returnType = FunctionType.getSpecializedReturnType(functionType);

                if (
                    prevReturnType &&
                    returnType &&
                    !this._evaluator.canAssignType(
                        returnType,
                        prevReturnType,
                        /* diag */ undefined,
                        new TypeVarMap(),
                        CanAssignFlags.SkipSolveTypeVars
                    )
                ) {
                    const altNode = this._findNodeForOverload(node, prevOverload);
                    this._evaluator.addDiagnostic(
                        this._fileInfo.diagnosticRuleSet.reportOverlappingOverload,
                        DiagnosticRule.reportOverlappingOverload,
                        Localizer.Diagnostic.overloadReturnTypeMismatch().format({
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

    private _isOverlappingOverload(functionType: FunctionType, prevOverload: FunctionType) {
        // According to precedent, the __get__ method is special-cased and is
        // exempt from overlapping overload checks. It's not clear why this is
        // the case, but for consistency with other type checkers, we'll honor
        // this rule. See https://github.com/python/typing/issues/253#issuecomment-389262904
        // for details.
        if (FunctionType.isInstanceMethod(functionType) && functionType.details.name === '__get__') {
            return false;
        }

        return this._evaluator.canAssignType(
            functionType,
            prevOverload,
            /* diag */ undefined,
            /* typeVarMap */ new TypeVarMap(getTypeVarScopeId(functionType)),
            CanAssignFlags.SkipSolveTypeVars |
                CanAssignFlags.SkipFunctionReturnTypeCheck |
                CanAssignFlags.OverloadOverlapCheck
        );
    }

    private _isLegalOverloadImplementation(
        overload: FunctionType,
        implementation: FunctionType,
        diag: DiagnosticAddendum | undefined
    ): boolean {
        const typeVarMap = new TypeVarMap(getTypeVarScopeId(implementation));

        // First check the parameters to see if they are assignable.
        let isLegal = this._evaluator.canAssignType(
            overload,
            implementation,
            diag,
            typeVarMap,
            CanAssignFlags.SkipFunctionReturnTypeCheck |
                CanAssignFlags.ReverseTypeVarMatching |
                CanAssignFlags.SkipSelfClsTypeCheck
        );

        // Now check the return types.
        const overloadReturnType =
            overload.details.declaredReturnType ?? this._evaluator.getFunctionInferredReturnType(overload);
        const implementationReturnType = applySolvedTypeVars(
            implementation.details.declaredReturnType || this._evaluator.getFunctionInferredReturnType(implementation),
            typeVarMap
        );

        const returnDiag = new DiagnosticAddendum();
        if (
            !isNever(overloadReturnType) &&
            !this._evaluator.canAssignType(
                implementationReturnType,
                overloadReturnType,
                returnDiag.createAddendum(),
                typeVarMap,
                CanAssignFlags.SkipSolveTypeVars
            )
        ) {
            returnDiag.addMessage(
                Localizer.DiagnosticAddendum.functionReturnTypeMismatch().format({
                    sourceType: this._evaluator.printType(overloadReturnType, /* expandTypeAlias */ false),
                    destType: this._evaluator.printType(implementationReturnType, /* expandTypeAlias */ false),
                })
            );
            if (diag) {
                diag.addAddendum(returnDiag);
            }
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
                    this._evaluator.addUnusedCode(statement, { start, length: end - start });

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
                    this._fileInfo.diagnosticRuleSet.reportInvalidStubStatement,
                    DiagnosticRule.reportInvalidStubStatement,
                    Localizer.Diagnostic.invalidStubStatement(),
                    statement
                );
                break;
            }

            case ParseNodeType.StatementList: {
                for (const substatement of statement.statements) {
                    switch (substatement.nodeType) {
                        case ParseNodeType.Assert:
                        case ParseNodeType.AssignmentExpression:
                        case ParseNodeType.AugmentedAssignment:
                        case ParseNodeType.Await:
                        case ParseNodeType.BinaryOperation:
                        case ParseNodeType.Call:
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
                            this._evaluator.addDiagnostic(
                                this._fileInfo.diagnosticRuleSet.reportInvalidStubStatement,
                                DiagnosticRule.reportInvalidStubStatement,
                                Localizer.Diagnostic.invalidStubStatement(),
                                substatement
                            );
                        }
                    }
                }
            }
        }
    }

    private _validateExceptionType(exceptionType: Type, errorNode: ParseNode) {
        const baseExceptionType = this._evaluator.getBuiltInType(errorNode, 'BaseException');
        const derivesFromBaseException = (classType: ClassType) => {
            if (!baseExceptionType || !isInstantiableClass(baseExceptionType)) {
                return true;
            }

            return derivesFromClassRecursive(classType, baseExceptionType, /* ignoreUnknown */ false);
        };

        const diagAddendum = new DiagnosticAddendum();
        let resultingExceptionType: Type | undefined;

        if (isAnyOrUnknown(exceptionType)) {
            resultingExceptionType = exceptionType;
        } else {
            if (isInstantiableClass(exceptionType)) {
                if (!derivesFromBaseException(exceptionType)) {
                    diagAddendum.addMessage(
                        Localizer.Diagnostic.exceptionTypeIncorrect().format({
                            type: this._evaluator.printType(exceptionType, /* expandTypeAlias */ false),
                        })
                    );
                }
                resultingExceptionType = ClassType.cloneAsInstance(exceptionType);
            } else if (isClassInstance(exceptionType)) {
                const iterableType =
                    this._evaluator.getTypeFromIterator(exceptionType, /* isAsync */ false, errorNode) ||
                    UnknownType.create();

                resultingExceptionType = mapSubtypes(iterableType, (subtype) => {
                    if (isAnyOrUnknown(subtype)) {
                        return subtype;
                    }

                    if (isInstantiableClass(subtype)) {
                        if (!derivesFromBaseException(subtype)) {
                            diagAddendum.addMessage(
                                Localizer.Diagnostic.exceptionTypeIncorrect().format({
                                    type: this._evaluator.printType(exceptionType, /* expandTypeAlias */ false),
                                })
                            );
                        }

                        return ClassType.cloneAsInstance(subtype);
                    }

                    diagAddendum.addMessage(
                        Localizer.Diagnostic.exceptionTypeIncorrect().format({
                            type: this._evaluator.printType(exceptionType, /* expandTypeAlias */ false),
                        })
                    );
                    return UnknownType.create();
                });
            }
        }

        if (!diagAddendum.isEmpty()) {
            this._evaluator.addError(
                Localizer.Diagnostic.exceptionTypeNotClass().format({
                    type: this._evaluator.printType(exceptionType, /* expandTypeAlias */ false),
                }),
                errorNode
            );
        }

        return resultingExceptionType || UnknownType.create();
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
                    this._fileInfo.diagnosticRuleSet.reportUnsupportedDunderAll,
                    DiagnosticRule.reportUnsupportedDunderAll,
                    Localizer.Diagnostic.dunderAllSymbolNotPresent().format({ name: node.value }),
                    node
                );
            }
        });
    }

    private _validateSymbolTables() {
        for (const scopedNode of this._scopedNodes) {
            const scope = AnalyzerNodeInfo.getScope(scopedNode);

            if (scope) {
                scope.symbolTable.forEach((symbol, name) => {
                    this._conditionallyReportUnusedSymbol(name, symbol, scope.type);

                    this._reportIncompatibleDeclarations(name, symbol);

                    this._reportMultipleFinalDeclarations(name, symbol, scope.type);

                    this._reportMultipleTypeAliasDeclarations(name, symbol);

                    this._reportInvalidOverload(name, symbol);
                });
            }
        }
    }

    private _reportInvalidOverload(name: string, symbol: Symbol) {
        const typedDecls = symbol.getTypedDeclarations();
        if (typedDecls.length >= 1) {
            const primaryDecl = typedDecls[0];

            if (primaryDecl.type === DeclarationType.Function) {
                const type = this._evaluator.getEffectiveTypeOfSymbol(symbol);
                const functions = isOverloadedFunction(type) ? type.overloads : isFunction(type) ? [type] : [];
                const overloadedFunctions = functions.filter((func) => FunctionType.isOverloaded(func));

                if (overloadedFunctions.length === 1) {
                    // There should never be a single overload.
                    this._evaluator.addDiagnostic(
                        this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                        DiagnosticRule.reportGeneralTypeIssues,
                        Localizer.Diagnostic.singleOverload().format({ name }),
                        primaryDecl.node.name
                    );
                }

                overloadedFunctions.forEach((overload) => {
                    if (
                        overload.details.declaration &&
                        !ParseTreeUtils.isFunctionSuiteEmpty(overload.details.declaration.node)
                    ) {
                        const diag = new DiagnosticAddendum();
                        diag.addMessage(Localizer.DiagnosticAddendum.overloadWithImplementation());
                        this._evaluator.addDiagnostic(
                            this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                            DiagnosticRule.reportGeneralTypeIssues,
                            Localizer.Diagnostic.overloadWithImplementation().format({ name }) + diag.getString(),
                            overload.details.declaration.node.name
                        );
                    }
                });

                // If the file is not a stub and this is the first overload,
                // verify that there is an implementation.
                if (!this._fileInfo.isStubFile && overloadedFunctions.length > 0) {
                    let implementationFunction: FunctionType | undefined;

                    if (
                        isOverloadedFunction(type) &&
                        !FunctionType.isOverloaded(type.overloads[type.overloads.length - 1])
                    ) {
                        implementationFunction = type.overloads[type.overloads.length - 1];
                    } else if (isFunction(type) && !FunctionType.isOverloaded(type)) {
                        implementationFunction = type;
                    }

                    if (!implementationFunction) {
                        let isProtocolMethod = false;
                        const containingClassNode = ParseTreeUtils.getEnclosingClassOrFunction(primaryDecl.node);
                        if (containingClassNode && containingClassNode.nodeType === ParseNodeType.Class) {
                            const classType = this._evaluator.getTypeOfClass(containingClassNode);
                            if (classType && ClassType.isProtocolClass(classType.classType)) {
                                isProtocolMethod = true;
                            }
                        }

                        // If this is a method within a protocol class, don't require that
                        // there is an implementation.
                        if (!isProtocolMethod) {
                            this._evaluator.addDiagnostic(
                                this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                                DiagnosticRule.reportGeneralTypeIssues,
                                Localizer.Diagnostic.overloadWithoutImplementation().format({
                                    name: primaryDecl.node.name.value,
                                }),
                                primaryDecl.node.name
                            );
                        }
                    } else if (isOverloadedFunction(type)) {
                        // Verify that all overload signatures are assignable to implementation signature.
                        type.overloads.forEach((overload, index) => {
                            if (overload === implementationFunction || !FunctionType.isOverloaded(overload)) {
                                return;
                            }

                            const diag = new DiagnosticAddendum();
                            if (!this._isLegalOverloadImplementation(overload, implementationFunction!, diag)) {
                                if (implementationFunction!.details.declaration) {
                                    const diagnostic = this._evaluator.addDiagnostic(
                                        this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                                        DiagnosticRule.reportGeneralTypeIssues,
                                        Localizer.Diagnostic.overloadImplementationMismatch().format({
                                            name,
                                            index: index + 1,
                                        }) + diag.getString(),
                                        implementationFunction!.details.declaration.node.name
                                    );

                                    if (diagnostic && overload.details.declaration) {
                                        diagnostic.addRelatedInfo(
                                            Localizer.DiagnosticAddendum.overloadMethod(),
                                            primaryDecl.path,
                                            primaryDecl.range
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
        if (!isFinalVariable(symbol)) {
            return;
        }

        const decls = symbol.getDeclarations();
        let sawFinal = false;
        let sawAssignment = false;

        decls.forEach((decl) => {
            if (isFinalVariableDeclaration(decl)) {
                if (sawFinal) {
                    this._evaluator.addError(Localizer.Diagnostic.finalRedeclaration().format({ name }), decl.node);
                }
                sawFinal = true;
            }

            if (decl.type === DeclarationType.Variable && decl.inferredTypeSource) {
                if (sawAssignment) {
                    // We check for assignment of Final instance and class variables
                    // the type evaluator because we need to take into account whether
                    // the assignment is within an `__init__` method, so ignore class
                    // scopes here.
                    if (scopeType !== ScopeType.Class) {
                        this._evaluator.addError(Localizer.Diagnostic.finalReassigned().format({ name }), decl.node);
                    }
                }
                sawAssignment = true;
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

                if (symbol.isClassMember() && !symbol.isClassVar()) {
                    const containingClass = ParseTreeUtils.getEnclosingClass(firstDecl.node, /* stopAtFunction */ true);
                    if (containingClass) {
                        const classType = this._evaluator.getTypeOfClass(containingClass);
                        if (
                            classType &&
                            isClass(classType.decoratedType) &&
                            ClassType.isDataClass(classType.decoratedType)
                        ) {
                            isImplicitlyAssigned = true;
                        }
                    }
                }

                if (!isImplicitlyAssigned) {
                    this._evaluator.addError(Localizer.Diagnostic.finalUnassigned().format({ name }), firstDecl.node);
                }
            }
        }
    }

    private _reportMultipleTypeAliasDeclarations(name: string, symbol: Symbol) {
        const decls = symbol.getDeclarations();
        const typeAliasDecl = decls.find((decl) => isExplicitTypeAliasDeclaration(decl));

        // If this is a type alias, there should be only one declaration.
        if (typeAliasDecl && decls.length > 1) {
            decls.forEach((decl) => {
                if (decl !== typeAliasDecl) {
                    this._evaluator.addError(Localizer.Diagnostic.typeAliasRedeclared().format({ name }), decl.node);
                }
            });
        }
    }

    private _reportIncompatibleDeclarations(name: string, symbol: Symbol) {
        // If there's one or more declaration with a declared type,
        // all other declarations should match. The only exception is
        // for functions that have an overload.
        const primaryDecl = getLastTypedDeclaredForSymbol(symbol);

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
                primaryDeclInfo = Localizer.DiagnosticAddendum.seeMethodDeclaration();
            } else {
                primaryDeclInfo = Localizer.DiagnosticAddendum.seeFunctionDeclaration();
            }
        } else if (primaryDecl.type === DeclarationType.Class) {
            primaryDeclInfo = Localizer.DiagnosticAddendum.seeClassDeclaration();
        } else if (primaryDecl.type === DeclarationType.Parameter) {
            primaryDeclInfo = Localizer.DiagnosticAddendum.seeParameterDeclaration();
        } else if (primaryDecl.type === DeclarationType.Variable) {
            primaryDeclInfo = Localizer.DiagnosticAddendum.seeVariableDeclaration();
        } else {
            primaryDeclInfo = Localizer.DiagnosticAddendum.seeDeclaration();
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
                } else if (primaryDecl.type === DeclarationType.Parameter) {
                    if (primaryDecl.node.name) {
                        primaryDeclNode = primaryDecl.node.name;
                    }
                }

                if (primaryDeclNode) {
                    diag.addRelatedInfo(primaryDeclInfo, primaryDecl.path, primaryDecl.range);
                }
            }
        };

        for (const otherDecl of otherDecls) {
            if (otherDecl.type === DeclarationType.Class) {
                const diag = this._evaluator.addDiagnostic(
                    this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                    DiagnosticRule.reportGeneralTypeIssues,
                    Localizer.Diagnostic.obscuredClassDeclaration().format({ name }),
                    otherDecl.node.name
                );
                addPrimaryDeclInfo(diag);
            } else if (otherDecl.type === DeclarationType.Function) {
                const primaryType = this._evaluator.getTypeForDeclaration(primaryDecl);

                // If the return type has not yet been inferred, do so now.
                if (primaryType && isFunction(primaryType)) {
                    this._evaluator.getFunctionInferredReturnType(primaryType);
                }

                let duplicateIsOk = false;
                const otherType = this._evaluator.getTypeForDeclaration(otherDecl);

                const suite1 = ParseTreeUtils.getEnclosingSuite(primaryDecl.node);
                const suite2 = ParseTreeUtils.getEnclosingSuite(otherDecl.node);

                const isInSameStatementList = suite1 === suite2;

                // If the return type has not yet been inferred, do so now.
                if (otherType && isFunction(otherType)) {
                    this._evaluator.getFunctionInferredReturnType(otherType);
                }

                // If both declarations are functions, it's OK if they
                // both have the same signatures.
                if (primaryType && otherType && isTypeSame(primaryType, otherType)) {
                    duplicateIsOk = true;
                }

                if (!duplicateIsOk || isInSameStatementList) {
                    const diag = this._evaluator.addDiagnostic(
                        this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                        DiagnosticRule.reportGeneralTypeIssues,
                        otherDecl.isMethod
                            ? Localizer.Diagnostic.obscuredMethodDeclaration().format({ name })
                            : Localizer.Diagnostic.obscuredFunctionDeclaration().format({ name }),
                        otherDecl.node.name
                    );
                    addPrimaryDeclInfo(diag);
                }
            } else if (otherDecl.type === DeclarationType.Parameter) {
                if (otherDecl.node.name) {
                    const diag = this._evaluator.addDiagnostic(
                        this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                        DiagnosticRule.reportGeneralTypeIssues,
                        Localizer.Diagnostic.obscuredParameterDeclaration().format({ name }),
                        otherDecl.node.name
                    );
                    addPrimaryDeclInfo(diag);
                }
            } else if (otherDecl.type === DeclarationType.Variable) {
                const primaryType = this._evaluator.getTypeForDeclaration(primaryDecl);

                if (otherDecl.typeAnnotationNode) {
                    if (otherDecl.node.nodeType === ParseNodeType.Name) {
                        let duplicateIsOk = false;

                        // It's OK if they both have the same declared type.
                        const otherType = this._evaluator.getTypeForDeclaration(otherDecl);
                        if (primaryType && otherType && isTypeSame(primaryType, otherType)) {
                            duplicateIsOk = true;
                        }

                        if (!duplicateIsOk) {
                            const diag = this._evaluator.addDiagnostic(
                                this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                                DiagnosticRule.reportGeneralTypeIssues,
                                Localizer.Diagnostic.obscuredVariableDeclaration().format({ name }),
                                otherDecl.node
                            );
                            addPrimaryDeclInfo(diag);
                        }
                    }
                } else if (primaryType && !isProperty(primaryType)) {
                    if (primaryDecl.type === DeclarationType.Function || primaryDecl.type === DeclarationType.Class) {
                        const diag = this._evaluator.addDiagnostic(
                            this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                            DiagnosticRule.reportGeneralTypeIssues,
                            Localizer.Diagnostic.obscuredVariableDeclaration().format({ name }),
                            otherDecl.node
                        );
                        addPrimaryDeclInfo(diag);
                    }
                }
            }
        }
    }

    private _conditionallyReportUnusedSymbol(name: string, symbol: Symbol, scopeType: ScopeType) {
        const accessedSymbolMap = this._fileInfo.accessedSymbolMap;
        if (symbol.isIgnoredForProtocolMatch() || accessedSymbolMap.has(symbol.id)) {
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
                        // Aliases in stub files are assumed to be re-exports.
                        if (!this._fileInfo.isStubFile) {
                            nameNode = decl.node.alias;
                        }
                    } else {
                        // Handle multi-part names specially.
                        const nameParts = decl.node.module.nameParts;
                        if (nameParts.length > 0) {
                            const multipartName = nameParts.map((np) => np.value).join('.');
                            const textRange: TextRange = { start: nameParts[0].start, length: nameParts[0].length };
                            TextRange.extend(textRange, nameParts[nameParts.length - 1]);
                            this._fileInfo.diagnosticSink.addUnusedCodeWithTextRange(
                                Localizer.Diagnostic.unaccessedSymbol().format({ name: multipartName }),
                                textRange,
                                { action: Commands.unusedImport }
                            );

                            this._evaluator.addDiagnosticForTextRange(
                                this._fileInfo,
                                this._fileInfo.diagnosticRuleSet.reportUnusedImport,
                                DiagnosticRule.reportUnusedImport,
                                Localizer.Diagnostic.unaccessedImport().format({ name: multipartName }),
                                textRange
                            );
                            return;
                        }
                    }
                } else if (decl.node.nodeType === ParseNodeType.ImportFromAs) {
                    const importFrom = decl.node.parent as ImportFromNode;

                    // If this is a stub file that is using the "from A import B as C" or "from . import C",
                    // don't mark "C" as unaccessed because it's assumed to be re-exported.
                    const isReexport = this._fileInfo.isStubFile && decl.node.alias !== undefined;

                    // If this is a __future__ import, it's OK for the import symbol to be unaccessed.
                    const isFuture =
                        importFrom.module.nameParts.length === 1 &&
                        importFrom.module.nameParts[0].value === '__future__';

                    if (!isReexport && !isFuture) {
                        nameNode = decl.node.alias || decl.node.name;
                    }
                }

                if (nameNode) {
                    message = Localizer.Diagnostic.unaccessedImport().format({ name: nameNode.value });
                }
                break;

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

                    // Don't emit a diagnostic for unused parameters.
                    diagnosticLevel = 'none';
                }

                if (nameNode) {
                    rule = DiagnosticRule.reportUnusedVariable;
                    message = Localizer.Diagnostic.unaccessedVariable().format({ name: nameNode.value });
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
                message = Localizer.Diagnostic.unaccessedClass().format({ name: nameNode.value });
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
                message = Localizer.Diagnostic.unaccessedFunction().format({ name: nameNode.value });
                break;

            default:
                return;
        }

        if (nameNode && rule !== undefined && message) {
            const action = rule === DiagnosticRule.reportUnusedImport ? { action: Commands.unusedImport } : undefined;
            this._fileInfo.diagnosticSink.addUnusedCodeWithTextRange(
                Localizer.Diagnostic.unaccessedSymbol().format({ name: nameNode.value }),
                nameNode,
                action
            );
            this._evaluator.addDiagnostic(diagnosticLevel, rule, message, nameNode);
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

        const arg1Type = this._evaluator.getType(node.arguments[1].valueExpression);
        if (!arg1Type) {
            return;
        }

        let isValidType = true;
        doForEachSubtype(arg1Type, (arg1Subtype) => {
            if (isClassInstance(arg1Subtype) && ClassType.isTupleClass(arg1Subtype) && arg1Subtype.tupleTypeArguments) {
                if (
                    arg1Subtype.tupleTypeArguments.some(
                        (typeArg) => !this._isTypeSupportedTypeForIsInstance(typeArg.type, isInstanceCheck)
                    )
                ) {
                    isValidType = false;
                }
            } else {
                if (!this._isTypeSupportedTypeForIsInstance(arg1Subtype, isInstanceCheck)) {
                    isValidType = false;
                }
            }
        });

        if (!isValidType) {
            const diag = new DiagnosticAddendum();
            diag.addMessage(Localizer.DiagnosticAddendum.typeVarNotAllowed());

            this._evaluator.addDiagnostic(
                this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                DiagnosticRule.reportGeneralTypeIssues,
                isInstanceCheck
                    ? Localizer.Diagnostic.isInstanceInvalidType().format({
                          type: this._evaluator.printType(arg1Type, /* expandTypeAlias */ false),
                      }) + diag.getString()
                    : Localizer.Diagnostic.isSubclassInvalidType().format({
                          type: this._evaluator.printType(arg1Type, /* expandTypeAlias */ false),
                      }) + diag.getString(),
                node.arguments[1]
            );
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

        // According to PEP 544, protocol classes cannot be used as the right-hand
        // argument to isinstance or issubclass unless they are annotated as
        // "runtime checkable".
        if (classTypeList.some((type) => ClassType.isProtocolClass(type) && !ClassType.isRuntimeCheckable(type))) {
            this._evaluator.addError(
                Localizer.Diagnostic.protocolUsedInCall().format({ name: callName }),
                node.arguments[1].valueExpression
            );
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
                // Handle the special case where the variable type is a TypedDict and
                // we're filtering against 'dict'. TypedDict isn't derived from dict,
                // but at runtime, isinstance returns True.
                const filterIsSuperclass =
                    ClassType.isDerivedFrom(varType, filterType) ||
                    (isInstanceCheck &&
                        ClassType.isProtocolClass(filterType) &&
                        this._evaluator.canAssignType(filterType, varType)) ||
                    (ClassType.isBuiltIn(filterType, 'dict') && ClassType.isTypedDictClass(varType));
                const filterIsSubclass =
                    ClassType.isDerivedFrom(filterType, varType) ||
                    (isInstanceCheck &&
                        ClassType.isProtocolClass(varType) &&
                        this._evaluator.canAssignType(varType, filterType));

                // Normally, a class should never be both a subclass and a
                // superclass. However, this can happen if one of the classes
                // derives from an unknown type. In this case, we'll add an
                // unknown type into the filtered type list to avoid any
                // false positives.
                const isClassRelationshipIndeterminate =
                    filterIsSubclass && filterIsSubclass && !ClassType.isSameGenericClass(varType, filterType);

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
        if (!arg1IncludesSubclasses && isTypeSame(filteredType, arg0Type, /* ignorePseudoGeneric */ true)) {
            this._evaluator.addDiagnostic(
                this._fileInfo.diagnosticRuleSet.reportUnnecessaryIsInstance,
                DiagnosticRule.reportUnnecessaryIsInstance,
                isInstanceCheck
                    ? Localizer.Diagnostic.unnecessaryIsInstanceAlways().format({
                          testType: this._evaluator.printType(arg0Type, /* expandTypeAlias */ false),
                          classType: this._evaluator.printType(getTestType(), /* expandTypeAlias */ false),
                      })
                    : Localizer.Diagnostic.unnecessaryIsSubclassAlways().format({
                          testType: this._evaluator.printType(arg0Type, /* expandTypeAlias */ false),
                          classType: this._evaluator.printType(getTestType(), /* expandTypeAlias */ false),
                      }),
                node
            );
        }
    }

    // Determines whether the specified type is allowed as the second argument
    // to an isinstance or issubclass check.
    private _isTypeSupportedTypeForIsInstance(type: Type, isInstanceCheck: boolean) {
        let isSupported = true;

        doForEachSubtype(type, (subtype) => {
            subtype = this._evaluator.makeTopLevelTypeVarsConcrete(subtype);

            switch (subtype.category) {
                case TypeCategory.Any:
                case TypeCategory.Unknown:
                case TypeCategory.Unbound:
                    break;

                case TypeCategory.Class:
                    // If it's a class, make sure that it has not been given explicit
                    // type arguments. This will result in a TypeError exception.
                    if (subtype.isTypeArgumentExplicit && !subtype.includeSubclasses) {
                        isSupported = false;
                    }
                    break;

                case TypeCategory.None:
                    if (!isInstanceCheck) {
                        isSupported = false;
                    } else {
                        isSupported = TypeBase.isInstantiable(subtype);
                    }
                    break;

                case TypeCategory.Function:
                    isSupported = TypeBase.isInstantiable(subtype);
                    break;

                case TypeCategory.Union:
                    isSupported = this._isTypeSupportedTypeForIsInstance(subtype, isInstanceCheck);
                    break;

                default:
                    isSupported = false;
                    break;
            }
        });

        return isSupported;
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

    private _reportDeprecatedUse(node: NameNode) {
        const deprecatedForm = deprecatedAliases.get(node.value) ?? deprecatedSpecialForms.get(node.value);

        if (!deprecatedForm) {
            return;
        }

        const type = this._evaluator.getType(node);

        if (!type) {
            return;
        }

        if (!isInstantiableClass(type) || type.details.fullName !== deprecatedForm.fullName) {
            return;
        }

        if (this._fileInfo.executionEnvironment.pythonVersion >= deprecatedForm.version) {
            this._evaluator.addDeprecated(
                Localizer.Diagnostic.deprecatedType().format({
                    version: versionToString(deprecatedForm.version),
                    replacement: deprecatedForm.replacementText,
                }),
                node
            );
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
                    this._evaluator.addDiagnostic(
                        this._fileInfo.diagnosticRuleSet.reportUnboundVariable,
                        DiagnosticRule.reportUnboundVariable,
                        Localizer.Diagnostic.symbolIsUnbound().format({ name: node.value }),
                        node
                    );
                } else if (isPossiblyUnbound(type)) {
                    this._evaluator.addDiagnostic(
                        this._fileInfo.diagnosticRuleSet.reportUnboundVariable,
                        DiagnosticRule.reportUnboundVariable,
                        Localizer.Diagnostic.symbolIsPossiblyUnbound().format({ name: node.value }),
                        node
                    );
                }
            }
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

        const declarations = this._evaluator.getDeclarationsForNameNode(node);

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
                    this._fileInfo.diagnosticRuleSet.reportPrivateUsage,
                    DiagnosticRule.reportPrivateUsage,
                    Localizer.Diagnostic.protectedUsedOutsideOfClass().format({ name: nameValue }),
                    node
                );
            } else {
                this._evaluator.addDiagnostic(
                    this._fileInfo.diagnosticRuleSet.reportPrivateUsage,
                    DiagnosticRule.reportPrivateUsage,
                    Localizer.Diagnostic.privateUsedOutsideOfClass().format({ name: nameValue }),
                    node
                );
            }
        }
    }

    // Validates that an enum class does not attempt to override another
    // enum class that has already defined values.
    private _validateEnumClassOverride(node: ClassNode, classType: ClassType) {
        classType.details.baseClasses.forEach((baseClass, index) => {
            if (isClass(baseClass) && ClassType.isEnumClass(baseClass)) {
                // Determine whether the base enum class defines an enumerated value.
                let baseEnumDefinesValue = false;

                baseClass.details.fields.forEach((symbol) => {
                    const symbolType = this._evaluator.getEffectiveTypeOfSymbol(symbol);
                    if (isClassInstance(symbolType) && ClassType.isSameGenericClass(symbolType, baseClass)) {
                        baseEnumDefinesValue = true;
                    }
                });

                if (baseEnumDefinesValue) {
                    this._evaluator.addDiagnostic(
                        this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                        DiagnosticRule.reportGeneralTypeIssues,
                        Localizer.Diagnostic.enumClassOverride().format({ name: baseClass.details.name }),
                        node.arguments[index]
                    );
                }
            }
        });
    }

    // Verifies the rules specified in PEP 589 about TypedDict classes.
    // They cannot have statements other than type annotations, doc
    // strings, and "pass" statements or ellipses.
    private _validateTypedDictClassSuite(suiteNode: SuiteNode) {
        const emitBadStatementError = (node: ParseNode) => {
            this._evaluator.addError(Localizer.Diagnostic.typedDictBadVar(), node);
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

    private _validateStrictTypeGuardFunction(node: FunctionNode, functionType: FunctionType, isMethod: boolean) {
        // Is this a strict type guard function?
        if (!functionType.details.declaredReturnType) {
            return;
        }

        if (
            !isClassInstance(functionType.details.declaredReturnType) ||
            !ClassType.isBuiltIn(functionType.details.declaredReturnType, 'StrictTypeGuard') ||
            !functionType.details.declaredReturnType.typeArguments ||
            functionType.details.declaredReturnType.typeArguments.length < 1
        ) {
            return;
        }

        const typeGuardType = functionType.details.declaredReturnType.typeArguments[0];

        // Determine the type of the first parameter.
        const paramIndex = isMethod && !FunctionType.isStaticMethod(functionType) ? 1 : 0;
        if (paramIndex >= functionType.details.parameters.length) {
            return;
        }

        const paramType = FunctionType.getEffectiveParameterType(functionType, paramIndex);

        // Verify that the typeGuardType is a narrower type than the paramType.
        if (!this._evaluator.canAssignType(paramType, typeGuardType)) {
            const returnAnnotation = node.returnTypeAnnotation || node.functionAnnotationComment?.returnTypeAnnotation;
            if (returnAnnotation) {
                this._evaluator.addDiagnostic(
                    this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                    DiagnosticRule.reportGeneralTypeIssues,
                    Localizer.Diagnostic.strictTypeGuardReturnType().format({
                        type: this._evaluator.printType(paramType),
                        returnType: this._evaluator.printType(typeGuardType),
                    }),
                    returnAnnotation
                );
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
                        this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                        DiagnosticRule.reportGeneralTypeIssues,
                        Localizer.Diagnostic.initMustReturnNone(),
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
                        this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                        DiagnosticRule.reportGeneralTypeIssues,
                        Localizer.Diagnostic.initMustReturnNone(),
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
                if (isUnknown(declaredReturnType)) {
                    this._evaluator.addDiagnostic(
                        this._fileInfo.diagnosticRuleSet.reportUnknownVariableType,
                        DiagnosticRule.reportUnknownVariableType,
                        Localizer.Diagnostic.declaredReturnTypeUnknown(),
                        returnAnnotation
                    );
                } else if (isPartlyUnknown(declaredReturnType)) {
                    this._evaluator.addDiagnostic(
                        this._fileInfo.diagnosticRuleSet.reportUnknownVariableType,
                        DiagnosticRule.reportUnknownVariableType,
                        Localizer.Diagnostic.declaredReturnTypePartiallyUnknown().format({
                            returnType: this._evaluator.printType(declaredReturnType, /* expandTypeAlias */ true),
                        }),
                        returnAnnotation
                    );
                }

                const diag = new DiagnosticAddendum();
                if (isTypeVar(declaredReturnType) && declaredReturnType.details.variance === Variance.Contravariant) {
                    diag.addMessage(
                        Localizer.DiagnosticAddendum.typeVarIsContravariant().format({
                            name: TypeVarType.getReadableName(declaredReturnType),
                        })
                    );
                    this._evaluator.addDiagnostic(
                        this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                        DiagnosticRule.reportGeneralTypeIssues,
                        Localizer.Diagnostic.returnTypeContravariant() + diag.getString(),
                        returnAnnotation
                    );
                }
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
                    if (!ParseTreeUtils.isSuiteEmpty(node.suite) && !FunctionType.isOverloaded(functionType)) {
                        this._evaluator.addDiagnostic(
                            this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                            DiagnosticRule.reportGeneralTypeIssues,
                            Localizer.Diagnostic.noReturnReturnsNone(),
                            returnAnnotation
                        );
                    }
                } else if (!FunctionType.isAbstractMethod(functionType)) {
                    // Make sure that the function doesn't implicitly return None if the declared
                    // type doesn't allow it. Skip this check for abstract methods.
                    const diagAddendum = new DiagnosticAddendum();

                    // If the declared type isn't compatible with 'None', flag an error.
                    if (!this._evaluator.canAssignType(declaredReturnType, NoneType.createInstance(), diagAddendum)) {
                        // If the function consists entirely of "...", assume that it's
                        // an abstract method or a protocol method and don't require that
                        // the return type matches. This check can also be skipped for an overload.
                        if (!ParseTreeUtils.isSuiteEmpty(node.suite) && !FunctionType.isOverloaded(functionType)) {
                            this._evaluator.addDiagnostic(
                                this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                                DiagnosticRule.reportGeneralTypeIssues,
                                Localizer.Diagnostic.returnMissing().format({
                                    returnType: this._evaluator.printType(
                                        declaredReturnType,
                                        /* expandTypeAlias */ false
                                    ),
                                }) + diagAddendum.getString(),
                                returnAnnotation
                            );
                        }
                    }
                }
            }
        } else {
            const inferredReturnType = this._evaluator.getFunctionInferredReturnType(functionType);
            if (isUnknown(inferredReturnType)) {
                this._evaluator.addDiagnostic(
                    this._fileInfo.diagnosticRuleSet.reportUnknownParameterType,
                    DiagnosticRule.reportUnknownParameterType,
                    Localizer.Diagnostic.returnTypeUnknown(),
                    node.name
                );
            } else if (isPartlyUnknown(inferredReturnType)) {
                this._evaluator.addDiagnostic(
                    this._fileInfo.diagnosticRuleSet.reportUnknownParameterType,
                    DiagnosticRule.reportUnknownParameterType,
                    Localizer.Diagnostic.returnTypePartiallyUnknown().format({
                        returnType: this._evaluator.printType(inferredReturnType, /* expandTypeAlias */ true),
                    }),
                    node.name
                );
            }
        }
    }

    // Validates that any overridden member variables are not marked
    // as Final in parent classes.
    private _validateFinalMemberOverrides(classType: ClassType) {
        classType.details.fields.forEach((localSymbol, name) => {
            const parentSymbol = lookUpClassMember(classType, name, ClassMemberLookupFlags.SkipOriginalClass);
            if (
                parentSymbol &&
                isInstantiableClass(parentSymbol.classType) &&
                isFinalVariable(parentSymbol.symbol) &&
                !SymbolNameUtils.isPrivateName(name)
            ) {
                const decl = localSymbol.getDeclarations()[0];
                this._evaluator.addError(
                    Localizer.Diagnostic.finalRedeclarationBySubclass().format({
                        name,
                        className: parentSymbol.classType.details.name,
                    }),
                    decl.node
                );
            }
        });
    }

    private _reportDuplicateEnumMembers(classType: ClassType) {
        if (!ClassType.isEnumClass(classType) || ClassType.isBuiltIn(classType)) {
            return;
        }

        classType.details.fields.forEach((symbol, name) => {
            // Enum members don't have type annotations.
            if (symbol.getTypedDeclarations().length > 0) {
                return;
            }

            const decls = symbol.getDeclarations();
            if (decls.length >= 2 && decls[0].type === DeclarationType.Variable) {
                const symbolType = this._evaluator.getEffectiveTypeOfSymbol(symbol);

                // Is this symbol a literal instance of the enum class?
                if (
                    isClassInstance(symbolType) &&
                    ClassType.isSameGenericClass(symbolType, classType) &&
                    symbolType.literalValue !== undefined
                ) {
                    this._evaluator.addError(
                        Localizer.Diagnostic.duplicateEnumMember().format({ name }),
                        decls[1].node
                    );
                }
            }
        });
    }

    // If a non-protocol class explicitly inherits from a protocol class, this method
    // verifies that any class or instance variables declared but not assigned
    // in the protocol class are implemented in the subclass. It also checks that any
    // empty functions declared in the protocol are implemented in the subclass.
    private _validateProtocolCompatibility(classType: ClassType, errorNode: ClassNode) {
        if (ClassType.isProtocolClass(classType)) {
            return;
        }

        const diagAddendum = new DiagnosticAddendum();

        const isSymbolImplemented = (name: string) => {
            return classType.details.mro.some((mroClass) => {
                return isClass(mroClass) && !ClassType.isProtocolClass(mroClass) && mroClass.details.fields.has(name);
            });
        };

        classType.details.baseClasses.forEach((baseClass) => {
            if (!isClass(baseClass) || !ClassType.isProtocolClass(baseClass)) {
                return;
            }

            const protocolSymbols = getProtocolSymbols(baseClass);

            protocolSymbols.forEach((member, name) => {
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
                        if (!isSymbolImplemented(name)) {
                            diagAddendum.addMessage(
                                Localizer.DiagnosticAddendum.missingProtocolMember().format({
                                    name,
                                    classType: member.classType.details.name,
                                })
                            );
                        }
                    }
                } else if (decls[0].type === DeclarationType.Function) {
                    if (ParseTreeUtils.isSuiteEmpty(decls[0].node.suite) && decls[0]) {
                        if (getFileExtension(decls[0].path).toLowerCase() !== '.pyi') {
                            if (!isSymbolImplemented(name)) {
                                diagAddendum.addMessage(
                                    Localizer.DiagnosticAddendum.missingProtocolMember().format({
                                        name,
                                        classType: member.classType.details.name,
                                    })
                                );
                            }
                        }
                    }
                }
            });
        });

        if (!diagAddendum.isEmpty()) {
            this._evaluator.addDiagnostic(
                this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                DiagnosticRule.reportGeneralTypeIssues,
                Localizer.Diagnostic.missingProtocolMembers() + diagAddendum.getString(),
                errorNode.name
            );
        }
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
            ClassMemberLookupFlags.SkipBaseClasses | ClassMemberLookupFlags.DeclaredTypesOnly
        );

        // If there's no __post_init__ method, there's nothing to check.
        if (!postInitMember) {
            return;
        }

        // Collect the list of init-only variables in the order they were declared.
        const initOnlySymbolMap = new Map<string, Symbol>();
        classType.details.fields.forEach((symbol, name) => {
            if (symbol.isInitVar()) {
                initOnlySymbolMap.set(name, symbol);
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
                this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                DiagnosticRule.reportGeneralTypeIssues,
                Localizer.Diagnostic.dataClassPostInitParamCount().format({ expected: initOnlySymbolMap.size }),
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
                const fieldType = this._evaluator.getDeclaredTypeOfSymbol(symbol);
                const paramType = FunctionType.getEffectiveParameterType(
                    postInitType,
                    paramListDetails.params[paramIndex].index
                );
                const canAssignDiag = new DiagnosticAddendum();

                if (fieldType && !this._evaluator.canAssignType(paramType, fieldType, canAssignDiag)) {
                    const diagnostic = this._evaluator.addDiagnostic(
                        this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                        DiagnosticRule.reportGeneralTypeIssues,
                        Localizer.Diagnostic.dataClassPostInitType().format({ fieldName }) + canAssignDiag.getString(),
                        param.typeAnnotation
                    );

                    if (diagnostic) {
                        const fieldDecls = symbol.getTypedDeclarations();
                        if (fieldDecls.length > 0) {
                            diagnostic.addRelatedInfo(
                                Localizer.DiagnosticAddendum.dataClassFieldLocation(),
                                fieldDecls[0].path,
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

        const abstractMethods = this._evaluator.getAbstractMethods(classType);
        if (abstractMethods.length === 0) {
            return;
        }

        const diagAddendum = new DiagnosticAddendum();
        const errorsToDisplay = 2;

        abstractMethods.forEach((abstractMethod, index) => {
            if (index === errorsToDisplay) {
                diagAddendum.addMessage(
                    Localizer.DiagnosticAddendum.memberIsAbstractMore().format({
                        count: abstractMethods.length - errorsToDisplay,
                    })
                );
            } else if (index < errorsToDisplay) {
                if (isInstantiableClass(abstractMethod.classType)) {
                    const className = abstractMethod.classType.details.name;
                    diagAddendum.addMessage(
                        Localizer.DiagnosticAddendum.memberIsAbstract().format({
                            type: className,
                            name: abstractMethod.symbolName,
                        })
                    );
                }
            }
        });

        this._evaluator.addDiagnostic(
            this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
            DiagnosticRule.reportGeneralTypeIssues,
            Localizer.Diagnostic.finalClassIsAbstract().format({
                type: classType.details.name,
            }) + diagAddendum.getString(),
            errorNode.name
        );
    }

    // Reports the case where an instance variable is not declared or initialized
    // within the class body or constructor method.
    private _validateInstanceVariableInitialization(classType: ClassType) {
        // This check can be expensive, so don't perform it if the corresponding
        // rule is disabled.
        if (this._fileInfo.diagnosticRuleSet.reportUninitializedInstanceVariable === 'none') {
            return;
        }

        classType.details.fields.forEach((localSymbol, name) => {
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
                    if (!containingClass || containingClass.nodeType === ParseNodeType.Class) {
                        return true;
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
            const parentSymbol = lookUpClassMember(classType, name, ClassMemberLookupFlags.SkipOriginalClass);
            if (parentSymbol) {
                return;
            }

            // Report the variable as uninitialized only on the first decl.
            this._evaluator.addDiagnostic(
                this._fileInfo.diagnosticRuleSet.reportUninitializedInstanceVariable,
                DiagnosticRule.reportUninitializedInstanceVariable,
                Localizer.Diagnostic.uninitializedInstanceVariable().format({ name: name }),
                decls[0].node
            );
        });
    }

    // Validates that the type variables used in a generic protocol class have
    // the proper variance (invariant, covariant, contravariant). See PEP 544
    // for an explanation for why this is important to enforce.
    private _validateProtocolTypeParamVariance(errorNode: ClassNode, classType: ClassType) {
        const origTypeParams = classType.details.typeParameters.filter((typeParam) => !isParamSpec(typeParam));

        // If this isn't a generic protocol, there's nothing to do here.
        if (origTypeParams.length === 0) {
            return;
        }

        const objectType = this._evaluator.getBuiltInType(errorNode, 'object');
        if (!isInstantiableClass(objectType)) {
            return;
        }

        // Replace all of the type parameters with invariant TypeVars.
        const updatedTypeParams = origTypeParams.map((typeParam) =>
            isVariadicTypeVar(typeParam) ? typeParam : TypeVarType.cloneAsInvariant(typeParam)
        );
        const updatedClassType = ClassType.cloneWithNewTypeParameters(classType, updatedTypeParams);

        const objectObject = ClassType.cloneAsInstance(objectType);
        const dummyTypeObject = ClassType.createInstantiable(
            '__protocolVarianceDummy',
            '',
            '',
            '',
            0,
            0,
            undefined,
            undefined
        );

        updatedTypeParams.forEach((param, paramIndex) => {
            // Skip variadics.
            if (param.details.isVariadic) {
                return;
            }

            // Replace all type arguments with a dummy type except for the
            // TypeVar of interest, which is replaced with an object instance.
            const srcTypeArgs = updatedTypeParams.map((p, i) => {
                if (p.details.isVariadic) {
                    return p;
                }
                return i === paramIndex ? objectObject : dummyTypeObject;
            });

            // Replace all type arguments with a dummy type except for the
            // TypeVar of interest, which is replaced with itself.
            const destTypeArgs = updatedTypeParams.map((p, i) => {
                return i === paramIndex || p.details.isVariadic ? p : dummyTypeObject;
            });

            const srcType = ClassType.cloneForSpecialization(
                updatedClassType,
                srcTypeArgs,
                /* isTypeArgumentExplicit */ true
            );
            const destType = ClassType.cloneForSpecialization(
                updatedClassType,
                destTypeArgs,
                /* isTypeArgumentExplicit */ true
            );

            const isDestSubtypeOfSrc = this._evaluator.canAssignProtocolClassToSelf(srcType, destType);

            let expectedVariance: Variance;
            if (isDestSubtypeOfSrc) {
                expectedVariance = Variance.Covariant;
            } else {
                const isSrcSubtypeOfDest = this._evaluator.canAssignProtocolClassToSelf(destType, srcType);
                if (isSrcSubtypeOfDest) {
                    expectedVariance = Variance.Contravariant;
                } else {
                    expectedVariance = Variance.Invariant;
                }
            }

            if (expectedVariance !== origTypeParams[paramIndex].details.variance) {
                let message: string;
                if (expectedVariance === Variance.Covariant) {
                    message = Localizer.Diagnostic.protocolVarianceCovariant().format({
                        variable: param.details.name,
                        class: classType.details.name,
                    });
                } else if (expectedVariance === Variance.Contravariant) {
                    message = Localizer.Diagnostic.protocolVarianceContravariant().format({
                        variable: param.details.name,
                        class: classType.details.name,
                    });
                } else {
                    message = Localizer.Diagnostic.protocolVarianceInvariant().format({
                        variable: param.details.name,
                        class: classType.details.name,
                    });
                }

                this._evaluator.addDiagnostic(
                    this._fileInfo.diagnosticRuleSet.reportInvalidTypeVarUse,
                    DiagnosticRule.reportInvalidTypeVarUse,
                    message,
                    errorNode.name
                );
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

        classType.details.fields.forEach((symbol, name) => {
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
                                this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                                DiagnosticRule.reportGeneralTypeIssues,
                                Localizer.Diagnostic.slotsClassVarConflict().format({ name }),
                                decl.node
                            );
                        }
                    }
                });
            }
        });
    }

    // Validates that the __init__ and __new__ method signatures are consistent.
    private _validateConstructorConsistency(classType: ClassType) {
        const initMember = lookUpClassMember(
            classType,
            '__init__',
            ClassMemberLookupFlags.SkipObjectBaseClass | ClassMemberLookupFlags.SkipInstanceVariables
        );
        const newMember = lookUpClassMember(
            classType,
            '__new__',
            ClassMemberLookupFlags.SkipObjectBaseClass | ClassMemberLookupFlags.SkipInstanceVariables
        );

        if (!initMember || !newMember || !isClass(initMember.classType) || !isClass(newMember.classType)) {
            return;
        }

        // If both the __new__ and __init__ come from subclasses, don't bother
        // checking for this class.
        if (
            !ClassType.isSameGenericClass(newMember.classType, classType) &&
            !ClassType.isSameGenericClass(initMember.classType, classType)
        ) {
            return;
        }

        // If the class that provides the __new__ method has a custom metaclass with a
        // __call__ method, skip this check.
        const metaclass = newMember.classType.details.effectiveMetaclass;
        if (metaclass && isClass(metaclass) && !ClassType.isBuiltIn(metaclass, 'type')) {
            const callMethod = lookUpClassMember(
                metaclass,
                '__call__',
                ClassMemberLookupFlags.SkipTypeBaseClass | ClassMemberLookupFlags.SkipInstanceVariables
            );
            if (callMethod) {
                return;
            }
        }

        let newMemberType: Type | undefined = this._evaluator.getTypeOfMember(newMember);
        if (!isFunction(newMemberType) && !isOverloadedFunction(newMemberType)) {
            return;
        }
        newMemberType = this._evaluator.bindFunctionToClassOrObject(
            classType,
            newMemberType,
            /* memberClass */ undefined,
            /* errorNode */ undefined,
            /* recursionCount */ undefined,
            /* treatConstructorAsClassMember */ true
        );
        if (!newMemberType) {
            return;
        }

        if (isOverloadedFunction(newMemberType)) {
            // Find the implementation, not the overloaded signatures.
            newMemberType = newMemberType.overloads.find((func) => !FunctionType.isOverloaded(func));

            if (!newMemberType) {
                return;
            }
        }

        let initMemberType: Type | undefined = this._evaluator.getTypeOfMember(initMember);
        if (!isFunction(initMemberType) && !isOverloadedFunction(initMemberType)) {
            return;
        }
        initMemberType = this._evaluator.bindFunctionToClassOrObject(
            ClassType.cloneAsInstance(classType),
            initMemberType
        );

        if (!initMemberType) {
            return;
        }

        if (isOverloadedFunction(initMemberType)) {
            // Find the implementation, not the overloaded signatures.
            initMemberType = initMemberType.overloads.find((func) => !FunctionType.isOverloaded(func));

            if (!initMemberType) {
                return;
            }
        }

        if (!isFunction(initMemberType) || !isFunction(newMemberType)) {
            return;
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
            !this._evaluator.canAssignType(
                newMemberType,
                initMemberType,
                /* diag */ undefined,
                /* typeVarMap */ undefined,
                CanAssignFlags.SkipFunctionReturnTypeCheck
            ) ||
            !this._evaluator.canAssignType(
                initMemberType,
                newMemberType,
                /* diag */ undefined,
                /* typeVarMap */ undefined,
                CanAssignFlags.SkipFunctionReturnTypeCheck
            )
        ) {
            const displayOnInit = ClassType.isSameGenericClass(initMember.classType, classType);
            const initDecl = getLastTypedDeclaredForSymbol(initMember.symbol);
            const newDecl = getLastTypedDeclaredForSymbol(newMember.symbol);

            if (initDecl && newDecl) {
                const mainDecl = displayOnInit ? initDecl : newDecl;
                const mainDeclNode =
                    mainDecl.node.nodeType === ParseNodeType.Function ? mainDecl.node.name : mainDecl.node;

                const diagAddendum = new DiagnosticAddendum();
                const initSignature = this._evaluator.printType(initMemberType);
                const newSignature = this._evaluator.printType(newMemberType);

                diagAddendum.addMessage(
                    Localizer.DiagnosticAddendum.initMethodSignature().format({
                        type: initSignature,
                    })
                );
                diagAddendum.addMessage(
                    Localizer.DiagnosticAddendum.newMethodSignature().format({
                        type: newSignature,
                    })
                );

                const diagnostic = this._evaluator.addDiagnostic(
                    this._fileInfo.diagnosticRuleSet.reportInconsistentConstructor,
                    DiagnosticRule.reportInconsistentConstructor,
                    Localizer.Diagnostic.constructorParametersMismatch().format({
                        classType: this._evaluator.printType(
                            ClassType.cloneAsInstance(displayOnInit ? initMember.classType : newMember.classType)
                        ),
                    }) + diagAddendum.getString(),
                    mainDeclNode
                );

                if (diagnostic) {
                    const secondaryDecl = displayOnInit ? newDecl : initDecl;

                    diagnostic.addRelatedInfo(
                        (displayOnInit
                            ? Localizer.DiagnosticAddendum.newMethodLocation()
                            : Localizer.DiagnosticAddendum.initMethodLocation()
                        ).format({
                            type: this._evaluator.printType(
                                ClassType.cloneAsInstance(displayOnInit ? newMember.classType : initMember.classType)
                            ),
                        }),
                        secondaryDecl.path,
                        secondaryDecl.range
                    );
                }
            }
        }
    }

    // Validates that any methods in multiple base classes are compatible with each other.
    private _validateMultipleInheritanceCompatibility(classType: ClassType, errorNode: ParseNode) {
        // Skip this check if reportIncompatibleMethodOverride is disabled because it's
        // a relatively expensive check.
        if (this._fileInfo.diagnosticRuleSet.reportIncompatibleMethodOverride === 'none') {
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
        const symbolMaps = baseClasses.map((baseClass) => {
            const specializedBaseClass = classType.details.mro.find(
                (c) => isClass(c) && ClassType.isSameGenericClass(c, baseClass)
            );
            if (!specializedBaseClass || !isClass(specializedBaseClass)) {
                return new Map<string, ClassMember>();
            }

            // Retrieve all of the specialized symbols from the base class and its ancestors.
            return getClassFieldsRecursive(specializedBaseClass);
        });

        for (let symbolMapBaseIndex = 1; symbolMapBaseIndex < symbolMaps.length; symbolMapBaseIndex++) {
            const baseSymbolMap = symbolMaps[symbolMapBaseIndex];

            for (const [name, baseClassAndSymbol] of baseSymbolMap) {
                // Special-case dundered methods, which can differ in signature. Also
                // exempt private symbols.
                if (SymbolNameUtils.isDunderName(name) || SymbolNameUtils.isPrivateName(name)) {
                    continue;
                }

                const baseClassType = baseClassAndSymbol.classType;
                if (!isClass(baseClassType)) {
                    continue;
                }

                for (
                    let symbolMapOverrideIndex = 0;
                    symbolMapOverrideIndex < symbolMapBaseIndex;
                    symbolMapOverrideIndex++
                ) {
                    const overrideSymbolMap = symbolMaps[symbolMapOverrideIndex];
                    const overrideClassAndSymbol = overrideSymbolMap.get(name);

                    if (overrideClassAndSymbol) {
                        let baseType = this._evaluator.getEffectiveTypeOfSymbol(baseClassAndSymbol.symbol);
                        if (isClass(baseClassAndSymbol.classType)) {
                            baseType = partiallySpecializeType(baseType, baseClassAndSymbol.classType);
                        }
                        let overrideType = this._evaluator.getEffectiveTypeOfSymbol(overrideClassAndSymbol.symbol);
                        if (isClass(overrideClassAndSymbol.classType)) {
                            overrideType = partiallySpecializeType(overrideType, overrideClassAndSymbol.classType);
                        }

                        if (isFunction(baseType) || isOverloadedFunction(baseType)) {
                            const diagAddendum = new DiagnosticAddendum();
                            let overrideFunction: FunctionType | undefined;

                            if (isFunction(overrideType)) {
                                overrideFunction = overrideType;
                            } else if (isOverloadedFunction(overrideType)) {
                                // Use the last overload.
                                overrideFunction = overrideType.overloads[overrideType.overloads.length - 1];

                                // If the last overload isn't an implementation, skip the check for this symbol.
                                if (FunctionType.isOverloaded(overrideFunction)) {
                                    continue;
                                }
                            }

                            if (overrideFunction) {
                                if (
                                    !this._evaluator.canOverrideMethod(
                                        baseType,
                                        overrideFunction,
                                        diagAddendum,
                                        /* enforceParamNameMatch */ true
                                    )
                                ) {
                                    const decl = overrideFunction.details.declaration;
                                    if (decl && decl.type === DeclarationType.Function) {
                                        const diag = this._evaluator.addDiagnostic(
                                            this._fileInfo.diagnosticRuleSet.reportIncompatibleMethodOverride,
                                            DiagnosticRule.reportIncompatibleMethodOverride,
                                            Localizer.Diagnostic.baseClassMethodTypeIncompatible().format({
                                                classType: classType.details.name,
                                                name,
                                            }) + diagAddendum.getString(),
                                            errorNode
                                        );

                                        const overrideDecl = getLastTypedDeclaredForSymbol(
                                            overrideClassAndSymbol.symbol
                                        );
                                        const baseDecl = getLastTypedDeclaredForSymbol(baseClassAndSymbol.symbol);

                                        if (diag && overrideDecl && baseDecl) {
                                            diag.addRelatedInfo(
                                                Localizer.DiagnosticAddendum.baseClassProvidesType().format({
                                                    baseClass: this._evaluator.printType(
                                                        convertToInstance(baseClasses[symbolMapOverrideIndex])
                                                    ),
                                                    type: this._evaluator.printType(overrideType),
                                                }),
                                                overrideDecl.path,
                                                overrideDecl.range
                                            );

                                            diag.addRelatedInfo(
                                                Localizer.DiagnosticAddendum.baseClassProvidesType().format({
                                                    baseClass: this._evaluator.printType(
                                                        convertToInstance(baseClasses[symbolMapBaseIndex])
                                                    ),
                                                    type: this._evaluator.printType(baseType),
                                                }),
                                                baseDecl.path,
                                                baseDecl.range
                                            );
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Validates that any overridden methods or variables contain the same
    // types as the original method. Also marks the class as abstract if one
    // or more abstract methods are not overridden.
    private _validateBaseClassOverrides(classType: ClassType) {
        classType.details.fields.forEach((symbol, name) => {
            // Private symbols do not need to match in type since their
            // names are mangled, and subclasses can't access the value in
            // the parent class.
            if (SymbolNameUtils.isPrivateName(name)) {
                return;
            }

            // If the symbol has no declaration, and the type is inferred,
            // skip this check.
            if (!symbol.hasTypedDeclarations()) {
                return;
            }

            // Get the symbol type defined in this class.
            const typeOfSymbol = this._evaluator.getEffectiveTypeOfSymbol(symbol);

            // If the type of the override symbol isn't known, stop here.
            if (isAnyOrUnknown(typeOfSymbol)) {
                return;
            }

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

                const baseClassAndSymbol = lookUpClassMember(mroBaseClass, name, ClassMemberLookupFlags.Default);

                if (!baseClassAndSymbol || !isInstantiableClass(baseClassAndSymbol.classType)) {
                    continue;
                }

                // If the base class doesn't provide a type declaration, we won't bother
                // proceeding with additional checks. Type inference is too inaccurate
                // in this case, plus it would be very slow.
                if (!baseClassAndSymbol.symbol.hasTypedDeclarations()) {
                    continue;
                }

                const baseClassSymbolType = partiallySpecializeType(
                    this._evaluator.getEffectiveTypeOfSymbol(baseClassAndSymbol.symbol),
                    baseClassAndSymbol.classType
                );

                if (isFunction(baseClassSymbolType) || isOverloadedFunction(baseClassSymbolType)) {
                    const diagAddendum = new DiagnosticAddendum();
                    let overrideFunction: FunctionType | undefined;

                    if (isFunction(typeOfSymbol)) {
                        overrideFunction = typeOfSymbol;
                    } else if (isOverloadedFunction(typeOfSymbol)) {
                        // Use the last overload.
                        overrideFunction = typeOfSymbol.overloads[typeOfSymbol.overloads.length - 1];
                    }

                    if (overrideFunction) {
                        const exemptMethods = ['__init__', '__new__', '__init_subclass__'];

                        // Don't enforce parameter names for dundered methods. Many of them
                        // are misnamed in typeshed stubs, so this would result in many
                        // false positives.
                        const enforceParamNameMatch = !SymbolNameUtils.isDunderName(name);

                        // Don't check certain magic functions or private symbols.
                        if (!exemptMethods.some((exempt) => exempt === name) && !SymbolNameUtils.isPrivateName(name)) {
                            if (
                                !this._evaluator.canOverrideMethod(
                                    baseClassSymbolType,
                                    overrideFunction,
                                    diagAddendum,
                                    enforceParamNameMatch
                                )
                            ) {
                                const decl =
                                    overrideFunction.details.declaration ?? getLastTypedDeclaredForSymbol(symbol);
                                if (decl) {
                                    const diag = this._evaluator.addDiagnostic(
                                        this._fileInfo.diagnosticRuleSet.reportIncompatibleMethodOverride,
                                        DiagnosticRule.reportIncompatibleMethodOverride,
                                        Localizer.Diagnostic.incompatibleMethodOverride().format({
                                            name,
                                            className: baseClassAndSymbol.classType.details.name,
                                        }) + diagAddendum.getString(),
                                        decl.type === DeclarationType.Function ? decl.node.name : decl.node
                                    );

                                    const origDecl = getLastTypedDeclaredForSymbol(baseClassAndSymbol.symbol);
                                    if (diag && origDecl) {
                                        diag.addRelatedInfo(
                                            Localizer.DiagnosticAddendum.overriddenMethod(),
                                            origDecl.path,
                                            origDecl.range
                                        );
                                    }
                                }
                            }
                        }

                        if (isFunction(baseClassSymbolType)) {
                            // Private names (starting with double underscore) are exempt from this check.
                            if (!SymbolNameUtils.isPrivateName(name) && FunctionType.isFinal(baseClassSymbolType)) {
                                const decl = getLastTypedDeclaredForSymbol(symbol);
                                if (decl && decl.type === DeclarationType.Function) {
                                    const diag = this._evaluator.addError(
                                        Localizer.Diagnostic.finalMethodOverride().format({
                                            name,
                                            className: baseClassAndSymbol.classType.details.name,
                                        }),
                                        decl.node.name
                                    );

                                    const origDecl = getLastTypedDeclaredForSymbol(baseClassAndSymbol.symbol);
                                    if (diag && origDecl) {
                                        diag.addRelatedInfo(
                                            Localizer.DiagnosticAddendum.finalMethod(),
                                            origDecl.path,
                                            origDecl.range
                                        );
                                    }
                                }
                            }
                        }
                    } else if (!isAnyOrUnknown(typeOfSymbol)) {
                        // Special-case overrides of methods in '_TypedDict', since
                        // TypedDict attributes aren't manifest as attributes but rather
                        // as named keys.
                        if (!ClassType.isBuiltIn(baseClassAndSymbol.classType, '_TypedDict')) {
                            const decls = symbol.getDeclarations();
                            if (decls.length > 0) {
                                const lastDecl = decls[decls.length - 1];
                                const diag = this._evaluator.addDiagnostic(
                                    this._fileInfo.diagnosticRuleSet.reportIncompatibleMethodOverride,
                                    DiagnosticRule.reportIncompatibleMethodOverride,
                                    Localizer.Diagnostic.methodOverridden().format({
                                        name,
                                        className: baseClassAndSymbol.classType.details.name,
                                        type: this._evaluator.printType(typeOfSymbol, /* expandTypeAlias */ false),
                                    }),
                                    lastDecl.node
                                );

                                const origDecl = getLastTypedDeclaredForSymbol(baseClassAndSymbol.symbol);
                                if (diag && origDecl) {
                                    diag.addRelatedInfo(
                                        Localizer.DiagnosticAddendum.overriddenMethod(),
                                        origDecl.path,
                                        origDecl.range
                                    );
                                }
                            }
                        }
                    }
                } else if (isProperty(baseClassSymbolType)) {
                    // Handle properties specially.
                    if (!isProperty(typeOfSymbol)) {
                        const decls = symbol.getDeclarations();
                        if (decls.length > 0) {
                            this._evaluator.addDiagnostic(
                                this._fileInfo.diagnosticRuleSet.reportIncompatibleMethodOverride,
                                DiagnosticRule.reportIncompatibleMethodOverride,
                                Localizer.Diagnostic.propertyOverridden().format({
                                    name,
                                    className: baseClassAndSymbol.classType.details.name,
                                }),
                                decls[decls.length - 1].node
                            );
                        }
                    } else {
                        const basePropFields = (baseClassSymbolType as ClassType).details.fields;
                        const subclassPropFields = (typeOfSymbol as ClassType).details.fields;
                        const baseClassType = baseClassAndSymbol.classType;

                        ['fget', 'fset', 'fdel'].forEach((methodName) => {
                            const diagAddendum = new DiagnosticAddendum();
                            const baseClassPropMethod = basePropFields.get(methodName);
                            const subclassPropMethod = subclassPropFields.get(methodName);

                            // Is the method present on the base class but missing in the subclass?
                            if (baseClassPropMethod) {
                                const baseClassMethodType = partiallySpecializeType(
                                    this._evaluator.getEffectiveTypeOfSymbol(baseClassPropMethod),
                                    baseClassType
                                );
                                if (isFunction(baseClassMethodType)) {
                                    if (!subclassPropMethod) {
                                        // The method is missing.
                                        diagAddendum.addMessage(
                                            Localizer.DiagnosticAddendum.propertyMethodMissing().format({
                                                name: methodName,
                                            })
                                        );
                                        const decls = symbol.getDeclarations();
                                        if (decls.length > 0) {
                                            const diag = this._evaluator.addDiagnostic(
                                                this._fileInfo.diagnosticRuleSet.reportIncompatibleMethodOverride,
                                                DiagnosticRule.reportIncompatibleMethodOverride,
                                                Localizer.Diagnostic.propertyOverridden().format({
                                                    name,
                                                    className: baseClassType.details.name,
                                                }) + diagAddendum.getString(),
                                                decls[decls.length - 1].node
                                            );

                                            const origDecl = baseClassMethodType.details.declaration;
                                            if (diag && origDecl) {
                                                diag.addRelatedInfo(
                                                    Localizer.DiagnosticAddendum.overriddenMethod(),
                                                    origDecl.path,
                                                    origDecl.range
                                                );
                                            }
                                        }
                                    } else {
                                        const subclassMethodType = partiallySpecializeType(
                                            this._evaluator.getEffectiveTypeOfSymbol(subclassPropMethod),
                                            classType
                                        );
                                        if (isFunction(subclassMethodType)) {
                                            if (
                                                !this._evaluator.canOverrideMethod(
                                                    baseClassMethodType,
                                                    subclassMethodType,
                                                    diagAddendum.createAddendum()
                                                )
                                            ) {
                                                diagAddendum.addMessage(
                                                    Localizer.DiagnosticAddendum.propertyMethodIncompatible().format({
                                                        name: methodName,
                                                    })
                                                );
                                                const decl = subclassMethodType.details.declaration;
                                                if (decl && decl.type === DeclarationType.Function) {
                                                    const diag = this._evaluator.addDiagnostic(
                                                        this._fileInfo.diagnosticRuleSet
                                                            .reportIncompatibleMethodOverride,
                                                        DiagnosticRule.reportIncompatibleMethodOverride,
                                                        Localizer.Diagnostic.propertyOverridden().format({
                                                            name,
                                                            className: baseClassType.details.name,
                                                        }) + diagAddendum.getString(),
                                                        decl.node.name
                                                    );

                                                    const origDecl = baseClassMethodType.details.declaration;
                                                    if (diag && origDecl) {
                                                        diag.addRelatedInfo(
                                                            Localizer.DiagnosticAddendum.overriddenMethod(),
                                                            origDecl.path,
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
                        const decls = symbol.getDeclarations();
                        if (decls.length > 0) {
                            const lastDecl = decls[decls.length - 1];
                            // Verify that the override type is assignable to (same or narrower than)
                            // the declared type of the base symbol.
                            const diagAddendum = new DiagnosticAddendum();
                            if (!this._evaluator.canAssignType(baseClassSymbolType, typeOfSymbol, diagAddendum)) {
                                const diag = this._evaluator.addDiagnostic(
                                    this._fileInfo.diagnosticRuleSet.reportIncompatibleVariableOverride,
                                    DiagnosticRule.reportIncompatibleVariableOverride,
                                    Localizer.Diagnostic.symbolOverridden().format({
                                        name,
                                        className: baseClassAndSymbol.classType.details.name,
                                    }) + diagAddendum.getString(),
                                    lastDecl.node
                                );

                                const origDecl = getLastTypedDeclaredForSymbol(baseClassAndSymbol.symbol);
                                if (diag && origDecl) {
                                    diag.addRelatedInfo(
                                        Localizer.DiagnosticAddendum.overriddenSymbol(),
                                        origDecl.path,
                                        origDecl.range
                                    );
                                }
                            }

                            // Verify that a class variable isn't overriding an instance
                            // variable or vice versa.
                            const isBaseClassVar = baseClassAndSymbol.symbol.isClassVar();
                            let isClassVar = symbol.isClassVar();

                            if (isBaseClassVar && !isClassVar) {
                                // If the subclass doesn't redeclare the type but simply assigns
                                // it without declaring its type, we won't consider it an instance
                                // variable.
                                if (!symbol.hasTypedDeclarations()) {
                                    isClassVar = true;
                                }

                                // If the subclass is declaring an inner class, we'll consider that
                                // to be a ClassVar.
                                if (
                                    symbol.getTypedDeclarations().every((decl) => decl.type === DeclarationType.Class)
                                ) {
                                    isClassVar = true;
                                }
                            }

                            if (isBaseClassVar !== isClassVar) {
                                const unformattedMessage = symbol.isClassVar()
                                    ? Localizer.Diagnostic.classVarOverridesInstanceVar()
                                    : Localizer.Diagnostic.instanceVarOverridesClassVar();

                                const diag = this._evaluator.addDiagnostic(
                                    this._fileInfo.diagnosticRuleSet.reportIncompatibleVariableOverride,
                                    DiagnosticRule.reportIncompatibleVariableOverride,
                                    unformattedMessage.format({
                                        name,
                                        className: baseClassAndSymbol.classType.details.name,
                                    }),
                                    lastDecl.node
                                );

                                const origDecl = getLastTypedDeclaredForSymbol(baseClassAndSymbol.symbol);
                                if (diag && origDecl) {
                                    diag.addRelatedInfo(
                                        Localizer.DiagnosticAddendum.overriddenSymbol(),
                                        origDecl.path,
                                        origDecl.range
                                    );
                                }
                            }
                        }
                    }
                }
            }
        });
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

        if (node.name && node.name.value === '__new__') {
            // __new__ overrides should have a "cls" parameter.
            if (
                node.parameters.length === 0 ||
                !node.parameters[0].name ||
                !['cls', '_cls', '__cls', '__mcls'].some((name) => node.parameters[0].name!.value === name)
            ) {
                this._evaluator.addDiagnostic(
                    this._fileInfo.diagnosticRuleSet.reportSelfClsParameterName,
                    DiagnosticRule.reportSelfClsParameterName,
                    Localizer.Diagnostic.newClsParam(),
                    node.parameters.length > 0 ? node.parameters[0] : node.name
                );
            }

            if (classType) {
                this._validateClsSelfParameterType(functionType, classType, /* isCls */ true);
            }
        } else if (node.name && node.name.value === '__init_subclass__') {
            // __init_subclass__ overrides should have a "cls" parameter.
            if (node.parameters.length === 0 || !node.parameters[0].name || node.parameters[0].name.value !== 'cls') {
                this._evaluator.addDiagnostic(
                    this._fileInfo.diagnosticRuleSet.reportSelfClsParameterName,
                    DiagnosticRule.reportSelfClsParameterName,
                    Localizer.Diagnostic.initSubclassClsParam(),
                    node.parameters.length > 0 ? node.parameters[0] : node.name
                );
            }

            if (classType) {
                this._validateClsSelfParameterType(functionType, classType, /* isCls */ true);
            }
        } else if (node.name && node.name.value === '__class_getitem__') {
            // __class_getitem__ overrides should have a "cls" parameter.
            if (node.parameters.length === 0 || !node.parameters[0].name || node.parameters[0].name.value !== 'cls') {
                this._evaluator.addDiagnostic(
                    this._fileInfo.diagnosticRuleSet.reportSelfClsParameterName,
                    DiagnosticRule.reportSelfClsParameterName,
                    Localizer.Diagnostic.classGetItemClsParam(),
                    node.parameters.length > 0 ? node.parameters[0] : node.name
                );
            }

            if (classType) {
                this._validateClsSelfParameterType(functionType, classType, /* isCls */ true);
            }
        } else if (FunctionType.isStaticMethod(functionType)) {
            // Static methods should not have "self" or "cls" parameters.
            if (node.parameters.length > 0 && node.parameters[0].name) {
                const paramName = node.parameters[0].name.value;
                if (paramName === 'self' || paramName === 'cls') {
                    this._evaluator.addDiagnostic(
                        this._fileInfo.diagnosticRuleSet.reportSelfClsParameterName,
                        DiagnosticRule.reportSelfClsParameterName,
                        Localizer.Diagnostic.staticClsSelfParam(),
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
                        this._fileInfo.diagnosticRuleSet.reportSelfClsParameterName,
                        DiagnosticRule.reportSelfClsParameterName,
                        Localizer.Diagnostic.classMethodClsParam(),
                        node.parameters.length > 0 ? node.parameters[0] : node.name
                    );
                }
            }

            if (classType) {
                this._validateClsSelfParameterType(functionType, classType, /* isCls */ true);
            }
        } else {
            // The presence of a decorator can change the behavior, so we need
            // to back off from this check if a decorator is present.
            if (node.decorators.length === 0) {
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
                    // Special-case metaclasses, which can use "cls".
                    let isLegalMetaclassName = false;
                    if (paramName === 'cls') {
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
                            this._fileInfo.diagnosticRuleSet.reportSelfClsParameterName,
                            DiagnosticRule.reportSelfClsParameterName,
                            Localizer.Diagnostic.instanceMethodSelfParam(),
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
        let effectiveFlags = ClassMemberLookupFlags.SkipInstanceVariables | ClassMemberLookupFlags.SkipOriginalClass;
        if (ClassType.isFinal(classType)) {
            effectiveFlags |= ClassMemberLookupFlags.SkipObjectBaseClass;
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
                this._fileInfo.diagnosticRuleSet.reportMissingSuperCall,
                DiagnosticRule.reportMissingSuperCall,
                Localizer.Diagnostic.missingSuperCall().format({
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

        // Don't enforce this for an overloaded method because the "self" param
        // annotation can be used as a filter for the overload.
        if (FunctionType.isOverloaded(functionType)) {
            return;
        }

        if (!this._evaluator.canAssignType(paramType, expectedType)) {
            this._evaluator.addDiagnostic(
                this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                DiagnosticRule.reportGeneralTypeIssues,
                Localizer.Diagnostic.clsSelfParamTypeMismatch().format({
                    name: paramInfo.name,
                    classType: this._evaluator.printType(expectedType, /* expandTypeAlias */ false),
                }),
                paramInfo.typeAnnotation
            );
        }
    }

    private _validateYieldType(node: YieldNode | YieldFromNode, yieldType: Type) {
        let declaredReturnType: Type | undefined;
        let declaredYieldType: Type | undefined;
        const enclosingFunctionNode = ParseTreeUtils.getEnclosingFunction(node);

        if (enclosingFunctionNode) {
            const functionTypeResult = this._evaluator.getTypeOfFunction(enclosingFunctionNode);
            if (functionTypeResult) {
                assert(isFunction(functionTypeResult.functionType));
                declaredReturnType = FunctionType.getSpecializedReturnType(functionTypeResult.functionType);
                if (declaredReturnType) {
                    declaredYieldType = getGeneratorYieldType(declaredReturnType, !!enclosingFunctionNode.isAsync);
                }

                if (declaredReturnType && !declaredYieldType && enclosingFunctionNode.returnTypeAnnotation) {
                    this._evaluator.addDiagnostic(
                        this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                        DiagnosticRule.reportGeneralTypeIssues,
                        enclosingFunctionNode.isAsync
                            ? Localizer.Diagnostic.generatorAsyncReturnType()
                            : Localizer.Diagnostic.generatorSyncReturnType(),
                        enclosingFunctionNode.returnTypeAnnotation
                    );
                }
            }
        }

        if (this._evaluator.isNodeReachable(node, /* sourceNode */ undefined)) {
            if (declaredReturnType && isNever(declaredReturnType)) {
                this._evaluator.addDiagnostic(
                    this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                    DiagnosticRule.reportGeneralTypeIssues,
                    Localizer.Diagnostic.noReturnContainsYield(),
                    node
                );
            } else if (declaredYieldType) {
                const diagAddendum = new DiagnosticAddendum();
                if (!this._evaluator.canAssignType(declaredYieldType, yieldType, diagAddendum)) {
                    this._evaluator.addDiagnostic(
                        this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                        DiagnosticRule.reportGeneralTypeIssues,
                        Localizer.Diagnostic.yieldTypeMismatch().format({
                            exprType: this._evaluator.printType(yieldType, /* expandTypeAlias */ false),
                            yieldType: this._evaluator.printType(declaredYieldType, /* expandTypeAlias */ false),
                        }) + diagAddendum.getString(),
                        node.expression || node
                    );
                }
            }
        }
    }

    // Determines whether any of the except statements are unreachable because
    // they are redundant.
    private _reportUnusedExceptStatements(node: TryNode) {
        let sawUnknownOrAny = false;
        const exceptionTypesSoFar: ClassType[] = [];

        node.exceptClauses.forEach((except) => {
            if (sawUnknownOrAny || except.isExceptGroup || !except.typeExpression) {
                return;
            }

            const exceptionType = this._evaluator.getType(except.typeExpression);
            if (!exceptionType || isAnyOrUnknown(exceptionType)) {
                sawUnknownOrAny = true;
                return;
            }

            const typesForThisExcept: ClassType[] = [];

            if (isInstantiableClass(exceptionType)) {
                // If the exception type is a variable whose type could represent
                // subclasses, the actual exception type is statically unknown.
                if (exceptionType.includeSubclasses) {
                    sawUnknownOrAny = true;
                }

                typesForThisExcept.push(exceptionType);
            } else if (isClassInstance(exceptionType)) {
                const iterableType =
                    this._evaluator.getTypeFromIterator(
                        exceptionType,
                        /* isAsync */ false,
                        /* errorNode */ undefined
                    ) || UnknownType.create();

                doForEachSubtype(iterableType, (subtype) => {
                    if (isAnyOrUnknown(subtype)) {
                        sawUnknownOrAny = true;
                    }

                    if (isInstantiableClass(subtype)) {
                        // If the exception type is a variable whose type could represent
                        // subclasses, the actual exception type is statically unknown.
                        if (subtype.includeSubclasses) {
                            sawUnknownOrAny = true;
                        }
                        typesForThisExcept.push(subtype);
                    }
                });
            }

            if (exceptionTypesSoFar.length > 0) {
                const diagAddendum = new DiagnosticAddendum();
                let overriddenExceptionCount = 0;

                typesForThisExcept.forEach((thisExceptType) => {
                    const subtype = exceptionTypesSoFar.find((previousExceptType) => {
                        return derivesFromClassRecursive(thisExceptType, previousExceptType, /* ignoreUnknown */ true);
                    });

                    if (subtype) {
                        diagAddendum.addMessage(
                            Localizer.DiagnosticAddendum.unreachableExcept().format({
                                exceptionType: this._evaluator.printType(convertToInstance(thisExceptType)),
                                parentType: this._evaluator.printType(convertToInstance(subtype)),
                            })
                        );
                        overriddenExceptionCount++;
                    }
                });

                // Were all of the exception types overridden?
                if (typesForThisExcept.length === overriddenExceptionCount) {
                    this._evaluator.addDiagnostic(
                        this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                        DiagnosticRule.reportGeneralTypeIssues,
                        Localizer.Diagnostic.unreachableExcept() + diagAddendum.getString(),
                        except.typeExpression
                    );
                    this._evaluator.addUnusedCode(except, except.exceptSuite);
                }
            }

            exceptionTypesSoFar.push(...typesForThisExcept);
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
                                this._fileInfo.diagnosticRuleSet.reportDuplicateImport,
                                DiagnosticRule.reportDuplicateImport,
                                Localizer.Diagnostic.duplicateImport().format({ importName: importFromAs.name.value }),
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
                            this._fileInfo.diagnosticRuleSet.reportDuplicateImport,
                            DiagnosticRule.reportDuplicateImport,
                            Localizer.Diagnostic.duplicateImport().format({ importName: importStatement.moduleName }),
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
