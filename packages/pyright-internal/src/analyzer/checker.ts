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
import { ScopeType } from './scope';
import { getScopeForNode } from './scopeUtils';
import { evaluateStaticBoolExpression } from './staticExpressions';
import { Symbol } from './symbol';
import * as SymbolNameUtils from './symbolNameUtils';
import { getLastTypedDeclaredForSymbol, isFinalVariable } from './symbolUtils';
import { TypeEvaluator } from './typeEvaluatorTypes';
import {
    AnyType,
    ClassType,
    combineTypes,
    FunctionType,
    isAnyOrUnknown,
    isClass,
    isClassInstance,
    isFunction,
    isInstantiableClass,
    isModule,
    isNever,
    isNone,
    isOverloadedFunction,
    isParamSpec,
    isTypeSame,
    isTypeVar,
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
    ClassMemberLookupFlags,
    convertToInstance,
    derivesFromAnyOrUnknown,
    derivesFromClassRecursive,
    doForEachSubtype,
    getDeclaredGeneratorReturnType,
    getGeneratorTypeArgs,
    getTypeVarScopeId,
    isEllipsisType,
    isLiteralType,
    isLiteralTypeOrUnion,
    isNoReturnType,
    isOpenEndedTupleClass,
    isPartlyUnknown,
    isProperty,
    isTupleClass,
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

export class Checker extends ParseTreeWalker {
    private readonly _moduleNode: ModuleNode;
    private readonly _fileInfo: AnalyzerFileInfo;
    private readonly _evaluator: TypeEvaluator;

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

            this._validateFinalMemberOverrides(classTypeResult.classType);

            this._validateInstanceVariableInitialization(classTypeResult.classType);

            this._validateFinalClassNotAbstract(classTypeResult.classType, node);

            if (ClassType.isTypedDictClass(classTypeResult.classType)) {
                this._validateTypedDictClassSuite(node.suite);
            }
        }

        this._scopedNodes.push(node);

        return false;
    }

    override visitFunction(node: FunctionNode): boolean {
        const functionTypeResult = this._evaluator.getTypeOfFunction(node);
        const containingClassNode = ParseTreeUtils.getEnclosingClass(node, true);

        if (functionTypeResult) {
            // Track whether we have seen a *args: P.args parameter. Named
            // parameters after this need to be flagged as an error.
            let sawParamSpecArgs = false;

            // Report any unknown parameter types.
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

                // Allow unknown param types if the param is named '_'.
                if (param.name && param.name.value !== '_') {
                    if (index < functionTypeResult.functionType.details.parameters.length) {
                        const paramType = functionTypeResult.functionType.details.parameters[index].type;

                        if (
                            isUnknown(paramType) ||
                            (isTypeVar(paramType) &&
                                paramType.details.isSynthesized &&
                                !paramType.details.isSynthesizedSelfCls)
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
            const paramSpecParams = node.parameters.filter((param, index) => {
                const paramInfo = functionTypeResult.functionType.details.parameters[index];
                if (paramInfo.typeAnnotation && isTypeVar(paramInfo.type) && isParamSpec(paramInfo.type)) {
                    if (paramInfo.category !== ParameterCategory.Simple) {
                        const paramAnnotation =
                            paramInfo.typeAnnotation.nodeType === ParseNodeType.StringList
                                ? paramInfo.typeAnnotation.typeAnnotation
                                : paramInfo.typeAnnotation;
                        if (paramAnnotation?.nodeType === ParseNodeType.MemberAccess) {
                            return true;
                        }
                    }
                }

                return false;
            });

            if (paramSpecParams.length === 1) {
                this._evaluator.addError(
                    Localizer.Diagnostic.paramSpecArgsKwargsUsage(),
                    paramSpecParams[0].typeAnnotation || paramSpecParams[0].typeAnnotationComment!
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
                if (annotationNode) {
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

        if (this._evaluator.isNodeReachable(node) && enclosingFunctionNode) {
            if (declaredReturnType) {
                if (isNoReturnType(declaredReturnType)) {
                    this._evaluator.addDiagnostic(
                        this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                        DiagnosticRule.reportGeneralTypeIssues,
                        Localizer.Diagnostic.noReturnContainsReturn(),
                        node
                    );
                } else {
                    const diagAddendum = new DiagnosticAddendum();

                    if (
                        !this._evaluator.canAssignType(
                            declaredReturnType,
                            returnType,
                            diagAddendum,
                            /* typeVarMap */ undefined,
                            CanAssignFlags.AllowBoolTypeGuard
                        )
                    ) {
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
        let yieldType =
            this._evaluator.getTypeFromIterable(yieldFromType, /* isAsync */ false, node) || UnknownType.create();

        // Does the iterator return a Generator? If so, get the yield type from it.
        // If the iterator doesn't return a Generator, use the iterator return type
        // directly.
        const generatorTypeArgs = getGeneratorTypeArgs(yieldType);
        if (generatorTypeArgs) {
            yieldType = generatorTypeArgs.length >= 1 ? generatorTypeArgs[0] : UnknownType.create();
        } else {
            yieldType =
                this._evaluator.getTypeFromIterator(yieldFromType, /* isAsync */ false, node) || UnknownType.create();
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

                    if (!isAnyOrUnknown(subtype) && !isNone(subtype)) {
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
                    if (!isOpenEndedTupleClass(type)) {
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
        if (baseType && isClassInstance(baseType) && baseType.tupleTypeArguments && !isOpenEndedTupleClass(baseType)) {
            const tupleLength = baseType.tupleTypeArguments.length;

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
                    isLiteralType(subscriptType)
                ) {
                    const subscriptValue = subscriptType.literalValue as number;

                    if (
                        (subscriptValue >= 0 && subscriptValue >= tupleLength) ||
                        (subscriptValue < 0 && subscriptValue + tupleLength < 0)
                    ) {
                        this._evaluator.addDiagnostic(
                            this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                            DiagnosticRule.reportGeneralTypeIssues,
                            Localizer.Diagnostic.tupleIndexOutOfRange().format({
                                length: tupleLength,
                                index: subscriptValue,
                            }),
                            node
                        );
                    }
                }
            }
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

        if (node.strings.length > 1) {
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
        node.nameList.forEach((name) => {
            this._evaluator.getType(name);
        });
        return true;
    }

    override visitNonlocal(node: NonlocalNode): boolean {
        node.nameList.forEach((name) => {
            this._evaluator.getType(name);
        });
        return true;
    }

    override visitName(node: NameNode) {
        // Determine if we should log information about private usage.
        this._conditionallyReportPrivateUsage(node);
        return true;
    }

    override visitDel(node: DelNode) {
        node.expressions.forEach((expr) => {
            this._evaluator.verifyDeleteExpression(expr);
        });

        return true;
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
        return true;
    }

    override visitCase(node: CaseNode): boolean {
        if (node.guardExpression) {
            this._evaluator.getType(node.guardExpression);
        }

        this._evaluator.evaluateTypesForStatement(node.pattern);
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
                    if (this._evaluator.canAssignType(rightType, leftSubtype, new DiagnosticAddendum())) {
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

        if (isNone(leftType) || isNone(rightType)) {
            return !isTypeSame(leftType, rightType);
        }

        if (isInstantiableClass(leftType)) {
            if (isInstantiableClass(rightType)) {
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
                    this._evaluator.canAssignType(genericLeftType, genericRightType, new DiagnosticAddendum()) ||
                    this._evaluator.canAssignType(genericRightType, genericLeftType, new DiagnosticAddendum())
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
                    this._evaluator.canAssignType(genericLeftType, genericRightType, new DiagnosticAddendum()) ||
                    this._evaluator.canAssignType(genericRightType, genericLeftType, new DiagnosticAddendum())
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
        return !isNone(type) && !isNoReturnType(type) && !isNever(type) && !isAnyOrUnknown(type);
    }

    // Verifies that each local type variable is used more than once.
    private _validateFunctionTypeVarUsage(node: FunctionNode) {
        // Skip this check entirely if it's disabled.
        if (this._fileInfo.diagnosticRuleSet.reportInvalidTypeVarUse === 'none') {
            return;
        }

        const localTypeVarUsage = new Map<string, LocalTypeVarInfo>();

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
                        (nameType.details.boundType !== undefined && subscriptIndex !== undefined) ||
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
                        new DiagnosticAddendum(),
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
            new DiagnosticAddendum(),
            /* typeVarMap */ undefined,
            CanAssignFlags.SkipSolveTypeVars |
                CanAssignFlags.SkipFunctionReturnTypeCheck |
                CanAssignFlags.DisallowAssignFromAny
        );
    }

    private _isLegalOverloadImplementation(
        overload: FunctionType,
        implementation: FunctionType,
        diag: DiagnosticAddendum
    ): boolean {
        const typeVarMap = new TypeVarMap(getTypeVarScopeId(implementation));

        // First check the parameters to see if they are assignable.
        let isLegal = this._evaluator.canAssignType(
            overload,
            implementation,
            diag,
            typeVarMap,
            CanAssignFlags.SkipFunctionReturnTypeCheck | CanAssignFlags.ReverseTypeVarMatching
        );

        // Now check the return types.
        const overloadReturnType =
            overload.details.declaredReturnType || this._evaluator.getFunctionInferredReturnType(overload);
        const implementationReturnType = applySolvedTypeVars(
            implementation.details.declaredReturnType || this._evaluator.getFunctionInferredReturnType(implementation),
            typeVarMap
        );

        const returnDiag = new DiagnosticAddendum();
        if (
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
            diag.addAddendum(returnDiag);
            isLegal = false;
        }

        return isLegal;
    }

    private _walkStatementsAndReportUnreachable(statements: StatementNode[]) {
        let reportedUnreachable = false;

        for (const statement of statements) {
            // No need to report unreachable more than once since the first time
            // covers all remaining statements in the statement list.
            if (!reportedUnreachable) {
                if (!this._evaluator.isNodeReachable(statement)) {
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
                this._evaluator.addError(Localizer.Diagnostic.finalUnassigned().format({ name }), firstDecl.node);
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

                // We need to handle properties in a careful manner because of
                // the way that setters and deleters are often defined using multiple
                // methods with the same name.
                if (
                    primaryDeclTypeInfo &&
                    isClassInstance(primaryDeclTypeInfo.decoratedType) &&
                    ClassType.isPropertyClass(primaryDeclTypeInfo.decoratedType) &&
                    isClassInstance(funcTypeInfo.decoratedType) &&
                    ClassType.isPropertyClass(funcTypeInfo.decoratedType)
                ) {
                    return (
                        funcTypeInfo.decoratedType.details.typeSourceId !==
                        primaryDeclTypeInfo!.decoratedType.details.typeSourceId
                    );
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
                const diag = this._evaluator.addDiagnostic(
                    this._fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                    DiagnosticRule.reportGeneralTypeIssues,
                    otherDecl.isMethod
                        ? Localizer.Diagnostic.obscuredMethodDeclaration().format({ name })
                        : Localizer.Diagnostic.obscuredFunctionDeclaration().format({ name }),
                    otherDecl.node.name
                );
                addPrimaryDeclInfo(diag);
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

                        // If both declarations are variables, it's OK if they
                        // both have the same declared type.
                        if (primaryDecl.type === DeclarationType.Variable) {
                            const otherType = this._evaluator.getTypeForDeclaration(otherDecl);
                            if (primaryType && otherType && isTypeSame(primaryType, otherType)) {
                                duplicateIsOk = true;
                            }
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
                        (typeArg) => !this._isTypeSupportedTypeForIsInstance(typeArg, isInstanceCheck)
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
        doForEachSubtype(arg1Type, (arg1Subtype) => {
            if (isClass(arg1Subtype)) {
                if (TypeBase.isInstantiable(arg1Subtype)) {
                    classTypeList.push(arg1Subtype);
                    if (
                        ClassType.isBuiltIn(arg1Subtype) &&
                        nonstandardClassTypes.some((name) => name === arg1Subtype.details.name)
                    ) {
                        isValidType = false;
                    }
                } else {
                    // The isinstance and issubclass call supports a variation where the second
                    // parameter is a tuple of classes.
                    if (isTupleClass(arg1Subtype) && arg1Subtype.tupleTypeArguments) {
                        arg1Subtype.tupleTypeArguments.forEach((typeArg) => {
                            if (isInstantiableClass(typeArg)) {
                                classTypeList.push(typeArg);
                            } else {
                                isValidType = false;
                            }
                        });
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
                        this._evaluator.canAssignType(filterType, varType, new DiagnosticAddendum())) ||
                    (ClassType.isBuiltIn(filterType, 'dict') && ClassType.isTypedDictClass(varType));
                const filterIsSubclass =
                    ClassType.isDerivedFrom(filterType, varType) ||
                    (isInstanceCheck &&
                        ClassType.isProtocolClass(varType) &&
                        this._evaluator.canAssignType(varType, filterType, new DiagnosticAddendum()));

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

        if (isTypeSame(filteredType, arg0Type, /* ignorePseudoGeneric */ true)) {
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

        if (primaryDeclaration.node === node) {
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

    private _validateDunderSignatures(node: FunctionNode, functionType: FunctionType, isMethod: boolean) {
        const functionName = functionType.details.name;

        // Is this an '__init__' method? Verify that it returns None.
        if (isMethod && functionName === '__init__') {
            const returnAnnotation = node.returnTypeAnnotation || node.functionAnnotationComment?.returnTypeAnnotation;
            const declaredReturnType = functionType.details.declaredReturnType;

            if (returnAnnotation && declaredReturnType) {
                if (!isNone(declaredReturnType) && !isNoReturnType(declaredReturnType)) {
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
                    !isNoReturnType(inferredReturnType) &&
                    !isNone(inferredReturnType) &&
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
                if (isNoReturnType(declaredReturnType)) {
                    // If the function consists entirely of "...", assume that it's
                    // an abstract method or a protocol method and don't require that
                    // the return type matches.
                    if (!ParseTreeUtils.isSuiteEmpty(node.suite)) {
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
                        // the return type matches.
                        if (!ParseTreeUtils.isSuiteEmpty(node.suite)) {
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
        const origTypeParams = classType.details.typeParameters;

        // If this isn't a generic protocol, there's nothing to do here.
        if (origTypeParams.length === 0) {
            return;
        }

        const objectType = this._evaluator.getBuiltInType(errorNode, 'object');
        if (!isInstantiableClass(objectType)) {
            return;
        }

        // Replace all of the type parameters with invariant TypeVars.
        const updatedTypeParams = origTypeParams
            .filter((typeParam) => !isParamSpec(typeParam) && !isVariadicTypeVar(typeParam))
            .map((typeParam) => TypeVarType.cloneAsInvariant(typeParam));
        const updatedClassType = ClassType.cloneWithNewTypeParameters(classType, updatedTypeParams);

        const objectObject = ClassType.cloneAsInstance(objectType);

        updatedTypeParams.forEach((param, paramIndex) => {
            // Replace all type arguments with Any except for the
            // TypeVar of interest, which is replaced with an object instance.
            const srcTypeArgs = updatedTypeParams.map((_, i) => {
                return i === paramIndex ? objectObject : AnyType.create();
            });

            // Replace all type arguments with Any except for the
            // TypeVar of interest, which is replaced with itself.
            const destTypeArgs = updatedTypeParams.map((p, i) => {
                return i === paramIndex ? p : AnyType.create();
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
                                const decl = overrideFunction.details.declaration;
                                if (decl && decl.type === DeclarationType.Function) {
                                    const diag = this._evaluator.addDiagnostic(
                                        this._fileInfo.diagnosticRuleSet.reportIncompatibleMethodOverride,
                                        DiagnosticRule.reportIncompatibleMethodOverride,
                                        Localizer.Diagnostic.incompatibleMethodOverride().format({
                                            name,
                                            className: baseClassAndSymbol.classType.details.name,
                                        }) + diagAddendum.getString(),
                                        decl.node.name
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

                            // If the subclass doesn't redeclare the type but simply assigns
                            // it without declaring its type, we won't consider it an instance
                            // variable.
                            if (isBaseClassVar && !isClassVar) {
                                if (!symbol.hasTypedDeclarations()) {
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
        const diag = new DiagnosticAddendum();

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

        if (!this._evaluator.canAssignType(paramType, expectedType, diag)) {
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
                    declaredYieldType = this._evaluator.getTypeFromIterator(
                        declaredReturnType,
                        !!enclosingFunctionNode.isAsync,
                        /* errorNode */ undefined
                    );
                }

                if (declaredYieldType && !declaredYieldType && enclosingFunctionNode.returnTypeAnnotation) {
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

        if (this._evaluator.isNodeReachable(node)) {
            if (declaredReturnType && isNoReturnType(declaredReturnType)) {
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
