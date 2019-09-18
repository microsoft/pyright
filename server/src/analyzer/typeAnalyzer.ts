/*
* typeAnalyzer.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* A parse tree walker that performs static type checking. It assumes
* that the binder has already run and added information to
* the parse nodes.
*/

import * as assert from 'assert';

import { DiagnosticLevel } from '../common/configOptions';
import { AddMissingOptionalToParamAction, Diagnostic,
    DiagnosticAddendum } from '../common/diagnostic';
import { DiagnosticRule } from '../common/diagnosticRules';
import { convertOffsetsToRange } from '../common/positionUtils';
import { PythonVersion } from '../common/pythonVersion';
import { TextRange } from '../common/textRange';
import { AssertNode, AssignmentNode, AugmentedAssignmentExpressionNode, BinaryExpressionNode,
    BreakNode, CallExpressionNode, ClassNode, ContinueNode, DecoratorNode, DelNode,
    ErrorExpressionNode, ExceptNode, ExpressionNode, FormatStringNode, ForNode, FunctionNode,
    IfNode, ImportAsNode, ImportFromNode, IndexExpressionNode, LambdaNode, ListComprehensionNode,
    MemberAccessExpressionNode, ModuleNode, NameNode, ParameterCategory, ParameterNode, ParseNode,
    ParseNodeType, RaiseNode, ReturnNode, SliceExpressionNode, StringListNode, SuiteNode,
    TernaryExpressionNode, TryNode, TupleExpressionNode, TypeAnnotationExpressionNode,
    UnaryExpressionNode, UnpackExpressionNode, WhileNode, WithNode, YieldExpressionNode,
    YieldFromExpressionNode  } from '../parser/parseNodes';
import { KeywordType } from '../parser/tokenizerTypes';
import { AnalyzerFileInfo } from './analyzerFileInfo';
import * as AnalyzerNodeInfo from './analyzerNodeInfo';
import { Declaration, DeclarationCategory } from './declaration';
import * as DeclarationUtils from './declarationUtils';
import { EvaluatorFlags, ExpressionEvaluator } from './expressionEvaluator';
import { ImportResult, ImportType } from './importResult';
import { defaultTypeSourceId, TypeSourceId } from './inferredType';
import * as ParseTreeUtils from './parseTreeUtils';
import { ParseTreeWalker } from './parseTreeWalker';
import { Scope, ScopeType } from './scope';
import * as ScopeUtils from './scopeUtils';
import * as StaticExpressions from './staticExpressions';
import { setSymbolPreservingAccess, Symbol, SymbolFlags, SymbolTable } from './symbol';
import * as SymbolNameUtils from './symbolNameUtils';
import { ConditionalTypeConstraintResults, TypeConstraintBuilder } from './typeConstraint';
import { AnyType, ClassType, ClassTypeFlags, combineTypes, FunctionParameter, FunctionType,
    FunctionTypeFlags, isAnyOrUnknown, isNoneOrNever, isTypeSame, ModuleType, NoneType,
    ObjectType, OverloadedFunctionType, printType, PropertyType, removeNoneFromUnion,
    removeUnboundFromUnion, removeUnknownFromUnion, Type, TypeCategory, TypeVarType, UnboundType,
    UnknownType  } from './types';
import * as TypeUtils from './typeUtils';

interface AliasMapEntry {
    alias: string;
    module: 'builtins' | 'collections';
}

// At some point, we'll cut off the analysis passes and assume
// we're making no forward progress. This should happen only
// on the case of bugs in the analyzer.
// The number is somewhat arbitrary. It needs to be at least
// 21 or so to handle all of the import cycles in the stdlib
// files.
const _maxAnalysisPassCount = 25;

// There are rare circumstances where we can get into a "beating
// pattern" where one variable is assigned to another in one pass
// and the second assigned to the first in the second pass and
// they both contain an "unknown" in their union. In this case,
// we will never converge. Look for this particular case after
// several analysis passes.
const _checkForBeatingUnknownPassCount = 16;

export class TypeAnalyzer extends ParseTreeWalker {
    private readonly _moduleNode: ModuleNode;
    private readonly _fileInfo: AnalyzerFileInfo;
    private _currentScope: Scope;
    private _defaultValueInitializerExpression = false;

    // Indicates where there was a change in the type analysis
    // the last time analyze() was called. Callers should repeatedly
    // call analyze() until this returns false.
    private _didAnalysisChange: boolean;

    // The last reason the analysis needed to change. Useful for
    // determining how to reduce the number of analysis passes.
    private _lastAnalysisChangeReason: string;

    // Analysis version is incremented each time an analyzer pass
    // is performed. It allows the code to determine when cached
    // type information needs to be regenerated because it was
    // from a previous pass.
    private _analysisVersion = 0;

    constructor(node: ModuleNode, fileInfo: AnalyzerFileInfo, analysisVersion: number) {
        super();

        this._moduleNode = node;
        this._fileInfo = fileInfo;
        this._currentScope = AnalyzerNodeInfo.getScope(node)!;
        this._didAnalysisChange = false;
        this._analysisVersion = analysisVersion;
    }

    analyze() {
        this._didAnalysisChange = false;

        this.walk(this._moduleNode);

        // Clear out any type constraints that were collected
        // during the processing of the scope.
        this._currentScope.clearTypeConstraints();

        // Apply the export filter to symbols in this scope's
        // symbol table if an export filter exists.
        this._currentScope.applyExportFilter();

        // If we've already analyzed the file the max number of times,
        // just give up and admit defeat. This should happen only in
        // the case of analyzer bugs.
        if (this._analysisVersion >= _maxAnalysisPassCount) {
            this._fileInfo.console.log(
                `Hit max analysis pass count for ${ this._fileInfo.filePath }`);
            return false;
        }

        return this._didAnalysisChange;
    }

    getLastReanalysisReason() {
        return this._lastAnalysisChangeReason;
    }

    visitClass(node: ClassNode): boolean {
        // We should have already resolved most of the base class
        // parameters in the binder, but if these parameters
        // are variables, they may not have been resolved at that time.
        const classType = AnalyzerNodeInfo.getExpressionType(node) as ClassType;
        assert(classType.category === TypeCategory.Class);

        // Keep a list of unique type parameters that are used in the
        // base class arguments.
        const typeParameters: TypeVarType[] = [];

        node.arguments.forEach((arg, index) => {
            // Ignore keyword parameters other than metaclass.
            if (!arg.name || arg.name.nameToken.value === 'metaclass') {
                let argType = this._getTypeOfExpression(arg.valueExpression);

                // In some stub files, classes are conditionally defined (e.g. based
                // on platform type). We'll assume that the conditional logic is correct
                // and strip off the "unbound" union.
                if (argType.category === TypeCategory.Union) {
                    argType = removeUnboundFromUnion(argType);
                }

                if (!isAnyOrUnknown(argType)) {
                    if (!(argType.category === TypeCategory.Class)) {
                        let reportBaseClassError = true;

                        // See if this is a "Type[X]" object.
                        if (argType.category === TypeCategory.Object) {
                            const classType = argType.classType;
                            if (ClassType.isBuiltIn(classType, 'Type')) {
                                const typeArgs = ClassType.getTypeArguments(classType);
                                if (typeArgs && typeArgs.length >= 0) {
                                    argType = typeArgs[0];
                                    if (argType.category === TypeCategory.Object) {
                                        argType = argType.classType;
                                        reportBaseClassError = false;
                                    }
                                }
                            }
                        }

                        if (reportBaseClassError) {
                            this._addError(`Argument to class must be a base class`, arg);
                            argType = UnknownType.create();
                        }
                    }
                }

                if (argType.category === TypeCategory.Class) {
                    if (ClassType.isBuiltIn(argType, 'Protocol')) {
                        if (!this._fileInfo.isStubFile && this._fileInfo.executionEnvironment.pythonVersion < PythonVersion.V37) {
                            this._addError(`Use of 'Protocol' requires Python 3.7 or newer`, arg.valueExpression);
                        }
                    }

                    // If the class directly derives from NamedTuple (in Python 3.6 or
                    // newer), it's considered a dataclass.
                    if (this._fileInfo.executionEnvironment.pythonVersion >= PythonVersion.V36) {
                        if (ClassType.isBuiltIn(argType, 'NamedTuple')) {
                            ClassType.setIsDataClass(classType, false);
                        }
                    }

                    // Validate that the class isn't deriving from itself, creating a
                    // circular dependency.
                    if (TypeUtils.derivesFromClassRecursive(argType, classType)) {
                        this._addError(`Class cannot derive from itself`, arg);
                        argType = UnknownType.create();
                    }
                }

                if (argType.category === TypeCategory.Unknown ||
                        argType.category === TypeCategory.Union && argType.subtypes.some(t => t.category === TypeCategory.Unknown)) {

                    this._addDiagnostic(
                        this._fileInfo.diagnosticSettings.reportUntypedBaseClass,
                        DiagnosticRule.reportUntypedBaseClass,
                        `Base class type is unknown, obscuring type of derived class`,
                        arg);
                }

                if (ClassType.updateBaseClassType(classType, index, argType)) {
                    this._setAnalysisChanged('Base class changed');
                }

                // TODO - validate that we are not adding type parameters that
                // are unique type vars but have conflicting names.
                TypeUtils.addTypeVarsToListIfUnique(typeParameters,
                    TypeUtils.getTypeVarArgumentsRecursive(argType));
            }
        });

        // Update the type parameters for the class.
        if (ClassType.setTypeParameters(classType, typeParameters)) {
            this._setAnalysisChanged('Class type parameters changed');
        }

        this._enterScope(node, () => {
            this.walk(node.suite);
        });

        let decoratedType: Type = classType;
        let foundUnknown = false;

        for (let i = node.decorators.length - 1; i >= 0; i--) {
            const decorator = node.decorators[i];

            decoratedType = this._applyClassDecorator(decoratedType,
                classType, decorator);
            if (decoratedType.category === TypeCategory.Unknown) {
                // Report this error only on the first unknown type.
                if (!foundUnknown) {
                    this._addDiagnostic(
                        this._fileInfo.diagnosticSettings.reportUntypedClassDecorator,
                        DiagnosticRule.reportUntypedClassDecorator,
                        `Untyped class declarator obscures type of class`,
                        node.decorators[i].leftExpression);

                    foundUnknown = true;
                }
            }
        }

        if (ClassType.isDataClass(classType)) {
            const evaluator = this._createEvaluator();

            let skipSynthesizedInit = ClassType.isSkipSynthesizedInit(classType);
            if (!skipSynthesizedInit) {
                // See if there's already a non-synthesized __init__ method.
                // We shouldn't override it.
                const initSymbol = TypeUtils.lookUpClassMember(classType, '__init__',
                    TypeUtils.ClassMemberLookupFlags.SkipBaseClasses);
                if (initSymbol) {
                    if (initSymbol.symbolType.category === TypeCategory.Function) {
                        if (!FunctionType.isSynthesizedMethod(initSymbol.symbolType)) {
                            skipSynthesizedInit = true;
                        }
                    } else {
                        skipSynthesizedInit = true;
                    }
                }
            }

            evaluator.synthesizeDataClassMethods(node, classType, skipSynthesizedInit);
        }

        const declaration: Declaration = {
            category: DeclarationCategory.Class,
            node: node.name,
            declaredType: decoratedType,
            path: this._fileInfo.filePath,
            range: convertOffsetsToRange(node.name.start,
                TextRange.getEnd(node.name), this._fileInfo.lines)
        };

        this._assignTypeToNameNode(node.name, decoratedType, declaration);

        this._validateClassMethods(classType);
        this._updateExpressionTypeForNode(node.name, classType);

        this.walkMultiple(node.decorators);
        this.walkMultiple(node.arguments);

        this._conditionallyReportUnusedName(node.name, true,
            this._fileInfo.diagnosticSettings.reportUnusedClass,
            DiagnosticRule.reportUnusedClass,
            `Class '${ node.name.nameToken.value }' is not accessed`);

        return false;
    }

    visitFunction(node: FunctionNode): boolean {
        // Retrieve the containing class node if the function is a method.
        const containingClassNode = ParseTreeUtils.getEnclosingClass(node, true);
        const containingClassType = containingClassNode ?
            AnalyzerNodeInfo.getExpressionType(containingClassNode) as ClassType : undefined;

        const functionType = AnalyzerNodeInfo.getExpressionType(node) as FunctionType;
        assert(functionType.category === TypeCategory.Function);

        if (this._fileInfo.isBuiltInStubFile || this._fileInfo.isTypingStubFile) {
            // Stash away the name of the function since we need to handle
            // 'namedtuple', 'abstractmethod', 'dataclass' and 'NewType'
            // specially.
            FunctionType.setBuiltInName(functionType, node.name.nameToken.value);
        }

        let asyncType = functionType;
        if (node.isAsync) {
            asyncType = this._createAwaitableFunction(functionType);
        }

        // Apply all of the decorators in reverse order.
        let decoratedType: Type = asyncType;
        let foundUnknown = false;
        for (let i = node.decorators.length - 1; i >= 0; i--) {
            const decorator = node.decorators[i];

            decoratedType = this._applyFunctionDecorator(decoratedType,
                functionType, decorator, node);
            if (decoratedType.category === TypeCategory.Unknown) {
                // Report this error only on the first unknown type.
                if (!foundUnknown) {
                    this._addDiagnostic(
                        this._fileInfo.diagnosticSettings.reportUntypedFunctionDecorator,
                        DiagnosticRule.reportUntypedFunctionDecorator,
                        `Untyped function declarator obscures type of function`,
                        node.decorators[i].leftExpression);

                    foundUnknown = true;
                }
            }
        }

        // Mark the class as abstract if it contains at least one abstract method.
        if (FunctionType.isAbstractMethod(functionType) && containingClassType) {
            ClassType.setIsAbstractClass(containingClassType);
        }

        if (containingClassNode) {
            if (!FunctionType.isClassMethod(functionType) && !FunctionType.isStaticMethod(functionType)) {
                // Mark the function as an instance method.
                FunctionType.setIsInstanceMethod(functionType);

                // If there's a separate async version, mark it as an instance
                // method as well.
                if (functionType !== asyncType) {
                    FunctionType.setIsInstanceMethod(asyncType);
                }
            }
        }

        node.parameters.forEach((param: ParameterNode, index) => {
            let annotatedType: Type | undefined;
            let defaultValueType: Type | undefined;

            if (param.defaultValue) {
                defaultValueType = this._getTypeOfExpression(param.defaultValue,
                    EvaluatorFlags.ConvertEllipsisToAny);

                this._defaultValueInitializerExpression = true;
                this.walk(param.defaultValue);
                this._defaultValueInitializerExpression = false;
            }

            if (param.typeAnnotation) {
                annotatedType = this._getTypeOfAnnotation(param.typeAnnotation);
                let isNoneWithoutOptional = false;

                // PEP 484 indicates that if a parameter has a default value of 'None'
                // the type checker should assume that the type is optional (i.e. a union
                // of the specified type and 'None').
                if (param.defaultValue && param.defaultValue.nodeType === ParseNodeType.Constant) {
                    if (param.defaultValue.token.keywordType === KeywordType.None) {
                        isNoneWithoutOptional = true;

                        if (!this._fileInfo.diagnosticSettings.strictParameterNoneValue) {
                            annotatedType = combineTypes(
                                [annotatedType, NoneType.create()]);
                        }
                    }
                }

                // If there was both a type annotation and a default value, verify
                // that the default value matches the annotation.
                if (param.defaultValue && defaultValueType) {
                    const concreteAnnotatedType = TypeUtils.specializeType(annotatedType, undefined);
                    const diagAddendum = new DiagnosticAddendum();

                    if (!TypeUtils.canAssignType(concreteAnnotatedType, defaultValueType, diagAddendum, undefined)) {
                        const diag = this._addError(
                            `Value of type '${ printType(defaultValueType) }' cannot` +
                                ` be assigned to parameter of type '${ printType(annotatedType) }'` +
                                diagAddendum.getString(),
                            param.defaultValue);

                        if (isNoneWithoutOptional) {
                            const addOptionalAction: AddMissingOptionalToParamAction = {
                                action: 'pyright.addoptionalforparam',
                                offsetOfTypeNode: param.typeAnnotation.start + 1
                            };
                            diag.addAction(addOptionalAction);
                        }
                    }
                }

                if (FunctionType.setParameterType(functionType, index, annotatedType)) {
                    this._setAnalysisChanged('Function parameter type annotation changed');
                }

                this.walk(param.typeAnnotation);
            } else if (index === 0 && (
                    FunctionType.isInstanceMethod(functionType) ||
                    FunctionType.isClassMethod(functionType) ||
                    FunctionType.isConstructorMethod(functionType))) {

                // Specify type of "self" or "cls" parameter for instance or class methods
                // if the type is not explicitly provided.
                if (containingClassType) {
                    const paramType = FunctionType.getParameters(functionType)[0].type;

                    if (paramType.category === TypeCategory.Unknown) {
                        // Don't specialize the "self" for protocol classes because type
                        // comparisons will fail during structural typing analysis.
                        if (containingClassType && !ClassType.isProtocol(containingClassType)) {
                            if (FunctionType.isInstanceMethod(functionType)) {
                                const specializedClassType = TypeUtils.selfSpecializeClassType(
                                    containingClassType);
                                if (FunctionType.setParameterType(functionType, index, ObjectType.create(specializedClassType))) {
                                    this._setAnalysisChanged('Specialized self changed');
                                }
                            } else if (FunctionType.isClassMethod(functionType) ||
                                    FunctionType.isConstructorMethod(functionType)) {

                                // For class methods, the cls parameter is allowed to skip the
                                // abstract class test because the caller is possibly passing
                                // in a non-abstract subclass.
                                const specializedClassType = TypeUtils.selfSpecializeClassType(
                                    containingClassType, true);
                                if (FunctionType.setParameterType(functionType, index, specializedClassType)) {
                                    this._setAnalysisChanged('Specialized cls changed');
                                }
                            }
                        }
                    }
                }
            } else {
                // There is no annotation, and we can't infer the type.
                if (param.name) {
                    this._addDiagnostic(this._fileInfo.diagnosticSettings.reportUnknownParameterType,
                        DiagnosticRule.reportUnknownParameterType,
                        `Type of '${ param.name.nameToken.value }' is unknown`,
                        param.name);
                }
            }
        });

        if (node.returnTypeAnnotation) {
            const returnType = this._getTypeOfAnnotation(node.returnTypeAnnotation);
            if (FunctionType.setDeclaredReturnType(functionType, returnType)) {
                this._setAnalysisChanged('Function return type annotation changed');
            }

            this.walk(node.returnTypeAnnotation);
        } else {
            let inferredReturnType: Type = UnknownType.create();

            if (this._fileInfo.isStubFile) {
                // If a return type annotation is missing in a stub file, assume
                // it's an "unknown" type. In normal source files, we can infer the
                // type from the implementation.
                FunctionType.setDeclaredReturnType(functionType, inferredReturnType);
            } else {
                inferredReturnType = FunctionType.getInferredReturnType(functionType).getType();
            }

            // Include Any in this check. If "Any" really is desired, it should
            // be made explicit through a type annotation.
            if (isAnyOrUnknown(inferredReturnType)) {
                this._addDiagnostic(this._fileInfo.diagnosticSettings.reportUnknownParameterType,
                    DiagnosticRule.reportUnknownParameterType,
                    `Inferred return type is unknown`, node.name);
            } else if (TypeUtils.containsUnknown(inferredReturnType)) {
                this._addDiagnostic(this._fileInfo.diagnosticSettings.reportUnknownParameterType,
                    DiagnosticRule.reportUnknownParameterType,
                    `Return type '${ printType(inferredReturnType) }' is partially unknown`,
                    node.name);
            }
        }

        const functionScope = this._enterScope(node, () => {
            const parameters = FunctionType.getParameters(functionType);
            assert(parameters.length === node.parameters.length);

            // Add the parameters to the scope and bind their types.
            parameters.forEach((param, index) => {
                const paramNode = node.parameters[index];
                if (paramNode.name) {
                    const specializedParamType = TypeUtils.specializeType(param.type, undefined);

                    let declaration: Declaration | undefined;
                    declaration = {
                        category: DeclarationCategory.Parameter,
                        node: paramNode,
                        path: this._fileInfo.filePath,
                        range: convertOffsetsToRange(paramNode.start, TextRange.getEnd(paramNode),
                            this._fileInfo.lines),
                        declaredType: specializedParamType
                    };
                    assert(paramNode !== undefined && paramNode.name !== undefined);

                    // If the type contains type variables, specialize them now
                    // so we convert them to a concrete type (or unknown if there
                    // is no bound or constraint).
                    const variadicParamType = this._getVariadicParamType(param.category, specializedParamType);
                    this._addTypeSourceToNameNode(paramNode.name, variadicParamType, declaration);
                    this._updateExpressionTypeForNode(paramNode.name, variadicParamType);

                    // Cache the type for the hover provider. Don't walk
                    // the default value because it needs to be evaluated
                    // outside of this scope.
                    this.walk(paramNode.name);
                }
            });

            this.walk(node.suite);
        });

        // Validate that the function returns the declared type.
        this._validateFunctionReturn(node, functionType, functionScope);
        const declarationCategory = containingClassNode ?
            DeclarationCategory.Method : DeclarationCategory.Function;

        const declaration: Declaration = {
            category: declarationCategory,
            node: node.name,
            path: this._fileInfo.filePath,
            range: convertOffsetsToRange(node.name.start, TextRange.getEnd(node.name),
                this._fileInfo.lines),
            declaredType: decoratedType
        };
        this._assignTypeToNameNode(node.name, decoratedType, declaration);

        if (containingClassNode) {
            this._validateMethod(node, functionType);
        }

        this._updateExpressionTypeForNode(node.name, functionType);

        this.walkMultiple(node.decorators);

        this._conditionallyReportUnusedName(node.name, true,
            this._fileInfo.diagnosticSettings.reportUnusedFunction,
            DiagnosticRule.reportUnusedFunction,
            `Function '${ node.name.nameToken.value }' is not accessed`);

        return false;
    }

    visitLambda(node: LambdaNode): boolean {
        const functionType = FunctionType.create(FunctionTypeFlags.None);

        this._enterScope(node, () => {
            node.parameters.forEach(param => {
                if (param.name) {
                    let declaration: Declaration | undefined;
                    declaration = {
                        category: DeclarationCategory.Parameter,
                        node: param,
                        path: this._fileInfo.filePath,
                        range: convertOffsetsToRange(param.start, TextRange.getEnd(param),
                            this._fileInfo.lines)
                    };
                    const paramType = UnknownType.create();
                    this._addTypeSourceToNameNode(param.name, paramType, declaration);

                    // Cache the type for the hover provider.
                    this._getTypeOfExpression(param.name);
                }

                const functionParam: FunctionParameter = {
                    category: param.category,
                    name: param.name ? param.name.nameToken.value : undefined,
                    hasDefault: !!param.defaultValue,
                    type: UnknownType.create()
                };
                FunctionType.addParameter(functionType, functionParam);
            });

            // Infer the return type.
            const returnType = this._getTypeOfExpression(node.expression);
            FunctionType.getInferredReturnType(functionType).addSource(
                returnType, node.expression.id);

            // Walk the children.
            this.walkMultiple([...node.parameters, node.expression]);
        });

        // Cache the function type.
        this._updateExpressionTypeForNode(node, functionType);

        return false;
    }

    visitCall(node: CallExpressionNode): boolean {
        // Calculate and cache the expression and report
        // any validation errors.
        const returnValue = this._getTypeOfExpression(node);

        // If the call indicates that it never returns, mark the
        // scope as raising an exception.
        if (TypeUtils.isNoReturnType(returnValue)) {
            this._currentScope.setAlwaysRaises();
        }

        this._validateIsInstanceCallNecessary(node);

        if (this._defaultValueInitializerExpression && !this._fileInfo.isStubFile) {
            this._addDiagnostic(
                this._fileInfo.diagnosticSettings.reportCallInDefaultInitializer,
                DiagnosticRule.reportCallInDefaultInitializer,
                `Function calls within default value initializer are not permitted`,
                node);
        }

        return true;
    }

    visitFor(node: ForNode): boolean {
        this.walk(node.iterableExpression);

        const iteratorType = this._getTypeOfExpression(node.iterableExpression);
        const evaluator = this._createEvaluator();
        const iteratedType = evaluator.getTypeFromIterable(
            iteratorType, !!node.isAsync, node.iterableExpression, !node.isAsync);

        const loopScope = this._enterTemporaryScope(() => {
            this._assignTypeToExpression(node.targetExpression, iteratedType, node.targetExpression);
            this.walk(node.targetExpression);
            this.walk(node.forSuite);
        }, true, node);

        const elseScope = this._enterTemporaryScope(() => {
            if (node.elseSuite) {
                this.walk(node.elseSuite);
            }
        }, true);

        if (loopScope.getAlwaysReturnsOrRaises() && elseScope.getAlwaysReturnsOrRaises()) {
            // If both loop and else clauses are executed but they both return or
            // raise an exception, mark the current scope as always returning or
            // raising an exception.
            if (loopScope.getAlwaysRaises() && elseScope.getAlwaysRaises()) {
                this._currentScope.setAlwaysRaises();
            } else {
                this._currentScope.setAlwaysReturns();
            }
        } else if (loopScope.getAlwaysReturnsOrRaises()) {
            elseScope.setUnconditional();
            this._mergeToCurrentScope(elseScope);
        } else if (elseScope.getAlwaysReturnsOrRaises()) {
            loopScope.setUnconditional();
            this._mergeToCurrentScope(loopScope);
        } else if (!loopScope.getAlwaysReturnsOrRaises() && !elseScope.getAlwaysReturnsOrRaises()) {
            const scopeToMerge = Scope.combineConditionalScopes([loopScope, elseScope]);
            this._mergeToCurrentScope(scopeToMerge);
        }

        return false;
    }

    visitListComprehension(node: ListComprehensionNode): boolean {
        // We need to "execute" the comprehension clauses first, even
        // though they appear afterward in the syntax. We'll do so
        // within a temporary scope so we can throw away the target
        // when complete.
        this._enterScope(node, () => {
            node.comprehensions.forEach(comprehension => {
                if (comprehension.nodeType === ParseNodeType.ListComprehensionFor) {
                    this.walk(comprehension.iterableExpression);

                    const iteratorType = this._getTypeOfExpression(comprehension.iterableExpression);
                    const evaluator = this._createEvaluator();

                    // Pass undefined for the error node so we don't report
                    // errors. We assume here that the expression has already
                    // been evaluated and errors reported, and we don't want
                    // them to be reported twice.
                    const iteratedType = evaluator.getTypeFromIterable(
                        iteratorType, !!comprehension.isAsync, undefined, false);

                    this._assignTypeToExpression(comprehension.targetExpression,
                        iteratedType, comprehension.iterableExpression);
                    this.walk(comprehension.targetExpression);
                } else {
                    this.walk(comprehension.testExpression);
                }
            });

            this.walk(node.expression);
        });

        return false;
    }

    visitIf(node: IfNode): boolean {
        this._handleIfWhileCommon(node.testExpression, node.ifSuite,
            node.elseSuite, false);
        return false;
    }

    visitWhile(node: WhileNode): boolean {
        this._handleIfWhileCommon(node.testExpression, node.whileSuite,
            node.elseSuite, true);
        return false;
    }

    visitWith(node: WithNode): boolean {
        node.withItems.forEach(item => {
            this.walk(item.expression);
        });

        node.withItems.forEach(item => {
            let exprType = this._getTypeOfExpression(item.expression);

            if (TypeUtils.isOptionalType(exprType)) {
                this._addDiagnostic(
                    this._fileInfo.diagnosticSettings.reportOptionalContextManager,
                    DiagnosticRule.reportOptionalContextManager,
                    `Object of type 'None' cannot be used with 'with'`,
                    item.expression);
                exprType = removeNoneFromUnion(exprType);
            }

            const enterMethodName = node.isAsync ? '__aenter__' : '__enter__';

            const scopedType = TypeUtils.doForSubtypes(exprType, subtype => {
                if (isAnyOrUnknown(subtype)) {
                    return subtype;
                }

                if (subtype.category === TypeCategory.Object) {
                    const evaluator = this._createEvaluator();
                    const memberType = evaluator.getTypeFromObjectMember(item.expression,
                        subtype, enterMethodName, { method: 'get' });

                    if (memberType) {
                        let memberReturnType: Type;
                        if (memberType.category === TypeCategory.Function) {
                            memberReturnType = FunctionType.getEffectiveReturnType(memberType);
                        } else {
                            memberReturnType = UnknownType.create();
                        }

                        // For "async while", an implicit "await" is performed.
                        if (node.isAsync) {
                            memberReturnType = evaluator.getTypeFromAwaitable(
                                memberReturnType, item);
                        }

                        return memberReturnType;
                    }
                }

                this._addError(`Type ${ printType(subtype) } cannot be used ` +
                    `with 'with' because it does not implement '${ enterMethodName }'`,
                    item.expression);
                return UnknownType.create();
            });

            if (item.target) {
                this._assignTypeToExpression(item.target, scopedType, item.target);
                this.walk(item.target);
            }
        });

        this.walk(node.suite);
        return false;
    }

    visitReturn(node: ReturnNode): boolean {
        let declaredReturnType: Type | undefined;
        let returnType: Type;

        const enclosingFunctionNode = ParseTreeUtils.getEnclosingFunction(node);
        if (enclosingFunctionNode) {
            const functionType = AnalyzerNodeInfo.getExpressionType(
                enclosingFunctionNode) as FunctionType;

            if (functionType) {
                assert(functionType.category === TypeCategory.Function);

                if (FunctionType.isGenerator(functionType)) {
                    declaredReturnType = TypeUtils.getDeclaredGeneratorReturnType(functionType);
                } else {
                    declaredReturnType = FunctionType.getDeclaredReturnType(functionType);
                }

                // Ignore this check for abstract methods, which often
                // don't actually return any value.
                if (FunctionType.isAbstractMethod(functionType)) {
                    declaredReturnType = undefined;
                }
            }
        }

        if (node.returnExpression) {
            returnType = this._getTypeOfExpression(node.returnExpression);
        } else {
            // There is no return expression, so "None" is assumed.
            returnType = NoneType.create();
        }

        const typeSourceId = node.id;
        this._currentScope.getReturnType().addSource(returnType, typeSourceId);

        if (declaredReturnType) {
            if (TypeUtils.isNoReturnType(declaredReturnType)) {
                this._addError(
                    `Function with declared return type 'NoReturn' cannot include a return statement`,
                    node);
            } else if (!this._currentScope.getAlwaysReturnsOrRaises()) {
                const diagAddendum = new DiagnosticAddendum();

                // Specialize the return type in case it contains references to type variables.
                // These will be replaced with the corresponding constraint or bound types.
                const specializedDeclaredType = TypeUtils.specializeType(declaredReturnType, undefined);
                if (!TypeUtils.canAssignType(specializedDeclaredType, returnType, diagAddendum)) {
                    this._addError(
                        `Expression of type '${ printType(returnType) }' cannot be assigned ` +
                            `to return type '${ printType(specializedDeclaredType) }'` +
                            diagAddendum.getString(),
                        node.returnExpression ? node.returnExpression : node);
                }
            }
        }

        if (!this._currentScope.getAlwaysRaises()) {
            this._currentScope.setAlwaysReturns();
        }

        return true;
    }

    visitYield(node: YieldExpressionNode) {
        let yieldType = this._getTypeOfExpression(node.expression);
        const typeSourceId = node.expression.id;
        this._currentScope.getYieldType().addSource(yieldType, typeSourceId);

        // Wrap the yield type in an Iterator.
        const iteratorType = ScopeUtils.getBuiltInType(this._currentScope, 'Iterator');
        if (iteratorType.category === TypeCategory.Class) {
            yieldType = ObjectType.create(ClassType.cloneForSpecialization(iteratorType, [yieldType]));
        } else {
            yieldType = UnknownType.create();
        }

        this._validateYieldType(node, yieldType);

        return true;
    }

    visitYieldFrom(node: YieldFromExpressionNode) {
        const yieldType = this._getTypeOfExpression(node.expression);
        const typeSourceId = node.expression.id;
        this._currentScope.getYieldType().addSource(yieldType, typeSourceId);

        this._validateYieldType(node, yieldType);

        return true;
    }

    visitContinue(node: ContinueNode): boolean {
        if (!this._currentScope.getAlwaysRaises()) {
            this._currentScope.snapshotTypeConstraintsForContinue();

            // For purposes of analysis, treat a continue as if it's a return.
            this._currentScope.setAlwaysReturns();
        }
        return true;
    }

    visitBreak(node: BreakNode): boolean {
        this._currentScope.snapshotTypeConstraintsForBreak();
        this._currentScope.setMayBreak();
        this._currentScope.setAlwaysBreaks();
        return true;
    }

    visitRaise(node: RaiseNode): boolean {
        const baseExceptionType = ScopeUtils.getBuiltInType(
            this._currentScope, 'BaseException') as ClassType;

        if (node.typeExpression) {
            this._markExpressionAccessed(node.typeExpression);

            const exceptionType = this._getTypeOfExpression(node.typeExpression);

            // Validate that the argument of "raise" is an exception object or class.
            if (baseExceptionType && baseExceptionType.category === TypeCategory.Class) {
                const diagAddendum = new DiagnosticAddendum();

                TypeUtils.doForSubtypes(exceptionType, subtype => {
                    if (!isAnyOrUnknown(subtype)) {
                        if (subtype.category === TypeCategory.Class) {
                            if (!TypeUtils.derivesFromClassRecursive(subtype, baseExceptionType)) {
                                diagAddendum.addMessage(`'${ printType(subtype) }' does not derive from BaseException`);
                            }
                        } else if (subtype.category === TypeCategory.Object) {
                            if (!TypeUtils.derivesFromClassRecursive(subtype.classType, baseExceptionType)) {
                                diagAddendum.addMessage(`'${ printType(subtype) }' does not derive from BaseException`);
                            }
                        } else {
                            diagAddendum.addMessage(`'${ printType(subtype) }' does not derive from BaseException`);
                        }
                    }

                    return subtype;
                });

                if (diagAddendum.getMessageCount() > 0) {
                    this._addError(`Expected exception class or object` + diagAddendum.getString(), node.typeExpression);
                }
            }
        }

        if (node.valueExpression) {
            const exceptionType = this._getTypeOfExpression(node.valueExpression);

            // Validate that the argument of "raise" is an exception object or None.
            if (baseExceptionType && baseExceptionType.category === TypeCategory.Class) {
                const diagAddendum = new DiagnosticAddendum();

                TypeUtils.doForSubtypes(exceptionType, subtype => {
                    if (!isAnyOrUnknown(subtype) && !isNoneOrNever(subtype)) {
                        if (subtype.category === TypeCategory.Object) {
                            if (!TypeUtils.derivesFromClassRecursive(subtype.classType, baseExceptionType)) {
                                diagAddendum.addMessage(`'${ printType(subtype) }' does not derive from BaseException`);
                            }
                        } else {
                            diagAddendum.addMessage(`'${ printType(subtype) }' does not derive from BaseException`);
                        }
                    }

                    return subtype;
                });

                if (diagAddendum.getMessageCount() > 0) {
                    this._addError(`Expected exception object or None` + diagAddendum.getString(), node.valueExpression);
                }
            }
        }

        if (!this._currentScope.getAlwaysReturns()) {
            this._currentScope.setAlwaysRaises();
        }
        return true;
    }

    visitExcept(node: ExceptNode): boolean {
        let exceptionType: Type;
        if (node.typeExpression) {
            exceptionType = this._getTypeOfExpression(node.typeExpression);

            if (node.name) {
                exceptionType = TypeUtils.doForSubtypes(exceptionType, subType => {
                    // If more than one type was specified for the exception, we'll receive
                    // a specialized tuple object here.
                    const tupleType = TypeUtils.getSpecializedTupleType(subType);
                    if (tupleType && ClassType.getTypeArguments(tupleType)) {
                        const entryTypes = ClassType.getTypeArguments(tupleType)!.map(t => {
                            return this._validateExceptionType(t, node.typeExpression!);
                        });
                        return combineTypes(entryTypes);
                    }

                    return this._validateExceptionType(
                        subType, node.typeExpression!);
                });

                const declaration: Declaration = {
                    category: DeclarationCategory.Variable,
                    node: node.name,
                    path: this._fileInfo.filePath,
                    range: convertOffsetsToRange(node.name.start, TextRange.getEnd(node.name),
                        this._fileInfo.lines)
                };
                this._addTypeSourceToNameNode(node.name, exceptionType, declaration);
                this._updateExpressionTypeForNode(node.name, exceptionType);
            }
        }

        this.walk(node.exceptSuite);

        if (node.name) {
            if (!this._currentScope.getAlwaysReturnsOrRaises()) {
                // The named target is explicitly unbound when leaving this scope.
                // Use the type source ID of the except node to avoid conflict with
                // the node.name type source.
                const unboundType = UnboundType.create();
                this._addTypeSourceToName(node.name.nameToken.value, unboundType, node.id);
                this._addAssignmentTypeConstraint(node.name, unboundType);
            }
        }

        return false;
    }

    visitTry(node: TryNode): boolean {
        const conditionalScopesToMerge: Scope[] = [];

        const tryScope = this._enterTemporaryScope(() => {
            this.walk(node.trySuite);
        });

        let allPathsRaise = tryScope.getAlwaysRaises();
        let allPathsRaiseOrReturn = tryScope.getAlwaysReturnsOrRaises();

        // Clear the "always raises", "always returns" and "always breaks" flags
        // for the try block because it may raise an exception before hitting
        // these statements and cause code execution to resume within an except
        // clause.
        tryScope.clearAlwaysRaises();
        tryScope.clearAlwaysReturns();
        tryScope.clearBreaks();

        // Unconditionally merge the try scope into its parent.
        this._mergeToCurrentScope(tryScope);

        // Analyze the else scope. This is effectively a continuation of
        // the try scope, except that it's conditionally executed (only
        // if there are no exceptions raised in the try scope).
        const elseScope = this._enterTemporaryScope(() => {
            if (node.elseSuite) {
                this.walk(node.elseSuite);
            }
        });

        // Consider the try/else path, which is executed if there are no exceptions
        // raised during execution. Does this path contain any unconditional raise
        // or return statements?
        if (elseScope.getAlwaysRaises()) {
            allPathsRaise = true;
        }
        if (elseScope.getAlwaysReturnsOrRaises()) {
            allPathsRaiseOrReturn = true;
        }
        conditionalScopesToMerge.push(elseScope);

        // Now analyze the exception scopes.
        node.exceptClauses.forEach(exceptNode => {
            const exceptScope = this._enterTemporaryScope(() => {
                this.walk(exceptNode);
            });

            conditionalScopesToMerge.push(exceptScope);

            if (!exceptScope.getAlwaysRaises()) {
                allPathsRaise = false;
            }

            if (!exceptScope.getAlwaysReturnsOrRaises()) {
                allPathsRaiseOrReturn = false;
            }
        });

        if (conditionalScopesToMerge.length > 1) {
            // Mark the multiple scopes as conditional and merge them.
            for (const scope of conditionalScopesToMerge) {
                scope.setConditional();
            }
            this._mergeToCurrentScope(Scope.combineConditionalScopes(conditionalScopesToMerge));
        } else if (conditionalScopesToMerge.length === 1) {
            // We have only one scope that's contributing, so no need
            // to mark it as conditional.
            this._mergeToCurrentScope(conditionalScopesToMerge[0]);
        }

        if (allPathsRaise) {
            this._currentScope.setAlwaysRaises();
        } else if (allPathsRaiseOrReturn) {
            this._currentScope.setAlwaysReturns();
        }

        if (node.finallySuite) {
            this.walk(node.finallySuite);
        }

        return false;
    }

    visitAssignment(node: AssignmentNode): boolean {
        // Special-case the typing.pyi file, which contains some special
        // types that the type analyzer needs to interpret differently.
        if (this._handleTypingStubAssignment(node)) {
            return false;
        }

        // If a type declaration comment was provided, associate the type
        // declaration with the symbol.
        if (node.typeAnnotationComment) {
            const annotatedType = this._getTypeOfAnnotation(node.typeAnnotationComment);
            this._declareTypeForExpression(node.leftExpression, annotatedType,
                node.typeAnnotationComment, node.rightExpression);
        }

        // Determine whether there is a declared type.
        const declaredType = this._getDeclaredTypeForExpression(node.leftExpression);

        // Evaluate the type of the right-hand side.
        // An assignment of ellipsis means "Any" within a type stub file.
        let srcType = this._getTypeOfExpression(node.rightExpression,
            this._fileInfo.isStubFile ? EvaluatorFlags.ConvertEllipsisToAny : undefined,
            declaredType);

        // Determine if the RHS is a constant boolean expression.
        // If so, assign it a literal type.
        const constExprValue = StaticExpressions.evaluateStaticExpression(node.rightExpression,
            this._fileInfo.executionEnvironment);
        if (constExprValue !== undefined) {
            const boolType = ScopeUtils.getBuiltInObject(this._currentScope, 'bool');
            if (boolType.category === TypeCategory.Object) {
                srcType = ObjectType.cloneWithLiteral(boolType, constExprValue);
            }
        }

        // If there was a declared type, make sure the RHS value is compatible.
        if (declaredType) {
            const diagAddendum = new DiagnosticAddendum();
            if (TypeUtils.canAssignType(declaredType, srcType, diagAddendum)) {
                // Constrain the resulting type to match the declared type.
                srcType = TypeUtils.constrainDeclaredTypeBasedOnAssignedType(
                    declaredType, srcType);
            }
        }

        // If this is an enum, transform the type as required.
        let effectiveType = srcType;
        if (node.leftExpression.nodeType === ParseNodeType.Name && !node.typeAnnotationComment) {
            effectiveType = this._transformTypeForPossibleEnumClass(
                node.leftExpression, effectiveType);
        }

        // Class and global variables should always be marked as accessed.
        if (ParseTreeUtils.getEnclosingClassOrModule(node, true)) {
            this._markExpressionAccessed(node.leftExpression);
        }

        this._assignTypeToExpression(node.leftExpression, effectiveType, node.rightExpression);

        return true;
    }

    visitAssert(node: AssertNode) {
        let assertTestExpression = node.testExpression;

        // Did the caller pass an optional assert message as a second parameter?
        // If so, strip it off and include only the test.
        if (node.testExpression.nodeType === ParseNodeType.Tuple) {
            assertTestExpression = node.testExpression.expressions[0];
        }

        const typeConstraints = this._buildConditionalTypeConstraints(assertTestExpression);

        // Assume that the assert constrains types.
        if (typeConstraints) {
            typeConstraints.ifConstraints.forEach(constraint => {
                this._currentScope.addTypeConstraint(constraint);
            });
        }

        return true;
    }

    visitAugmentedAssignment(node: AugmentedAssignmentExpressionNode): boolean {
        // Augmented assignments are technically not expressions but statements
        // in Python, but we'll model them as expressions and rely on the expression
        // evaluator to validate them.
        const type = this._getTypeOfExpression(node);

        // Validate that the type can be written back to the LHS.
        this._assignTypeToExpression(node.leftExpression, type, node.rightExpression);
        return true;
    }

    visitIndex(node: IndexExpressionNode): boolean {
        this._getTypeOfExpression(node);
        return true;
    }

    visitBinaryOperation(node: BinaryExpressionNode): boolean {
        this._getTypeOfExpression(node);
        return true;
    }

    visitSlice(node: SliceExpressionNode): boolean {
        this._getTypeOfExpression(node);
        return true;
    }

    visitUnpack(node: UnpackExpressionNode): boolean {
        this._getTypeOfExpression(node);
        return true;
    }

    visitTuple(node: TupleExpressionNode): boolean {
        this._getTypeOfExpression(node);
        return true;
    }

    visitUnaryOperation(node: UnaryExpressionNode): boolean {
        this._getTypeOfExpression(node);
        return true;
    }

    visitTernary(node: TernaryExpressionNode): boolean {
        this._getTypeOfExpression(node);
        return true;
    }

    visitStringList(node: StringListNode): boolean {
        if (node.typeAnnotation) {
            // Should we ignore this type annotation?
            if (ExpressionEvaluator.isAnnotationLiteralValue(node)) {
                return false;
            }

            this._getTypeOfExpression(node.typeAnnotation,
                EvaluatorFlags.AllowForwardReferences);
        }

        return true;
    }

    visitFormatString(node: FormatStringNode): boolean {
        node.expressions.forEach(formatExpr => {
            this._getTypeOfExpression(formatExpr,
                EvaluatorFlags.AllowForwardReferences);
        });

        return true;
    }

    visitName(node: NameNode) {
        const nameValue = node.nameToken.value;
        const symbolInScope = this._currentScope.lookUpSymbolRecursive(nameValue);

        // Determine if we should log information about private usage.
        this._conditionallyReportPrivateUsage(node);

        let unaccessedDiagLevel: DiagnosticLevel = 'none';
        if (symbolInScope) {
            const declarations = symbolInScope.symbol.getDeclarations();

            // Determine if we should log information about an unused name.
            if (declarations.length > 0 && declarations[0].category === DeclarationCategory.Variable) {
                unaccessedDiagLevel = this._fileInfo.diagnosticSettings.reportUnusedVariable;
            }
        }

        this._conditionallyReportUnusedName(node, false, unaccessedDiagLevel,
            DiagnosticRule.reportUnusedVariable,
            `Variable '${ node.nameToken.value }' is not accessed`);

        return true;
    }

    visitDel(node: DelNode) {
        node.expressions.forEach(expr => {
            this._markExpressionAccessed(expr);
            this._evaluateExpressionForDeletion(expr);

            if (expr.nodeType === ParseNodeType.Name) {
                const symbolWithScope = this._currentScope.lookUpSymbolRecursive(expr.nameToken.value);
                if (symbolWithScope) {
                    if (symbolWithScope.symbol.hasDeclarations()) {
                        const category = symbolWithScope.symbol.getDeclarations()[0].category;
                        if (category === DeclarationCategory.Function || category === DeclarationCategory.Method) {
                            this._addError('Del should not be applied to function', expr);
                        } else if (category === DeclarationCategory.Class) {
                            this._addError('Del should not be applied to class', expr);
                        }
                    }
                }

                this._addTypeSourceToNameNode(expr, UnboundType.create());
            }
        });

        return true;
    }

    visitMemberAccess(node: MemberAccessExpressionNode) {
        this._getTypeOfExpression(node);

        this._getTypeOfExpression(node.leftExpression);
        this._conditionallyReportPrivateUsage(node.memberName);

        // Walk the leftExpression but not the memberName.
        this.walk(node.leftExpression);

        return false;
    }

    visitImportAs(node: ImportAsNode): boolean {
        const importInfo = AnalyzerNodeInfo.getImportInfo(node.module);
        assert(importInfo !== undefined);

        if (importInfo && importInfo.isImportFound && importInfo.resolvedPaths.length > 0) {
            const resolvedPath = importInfo.resolvedPaths[importInfo.resolvedPaths.length - 1];
            const moduleType = this._getModuleTypeForImportPath(importInfo, resolvedPath);

            if (moduleType) {
                // Import the implicit imports in the module's namespace.
                importInfo.implicitImports.forEach(implicitImport => {
                    const implicitModuleType = this._getModuleTypeForImportPath(
                        importInfo, implicitImport.path);
                    if (implicitModuleType) {
                        const moduleFields = moduleType.fields;
                        const importedModule = this._fileInfo.importMap[implicitImport.path];

                        if (importedModule) {
                            const declaration: Declaration = {
                                category: DeclarationCategory.Module,
                                path: implicitImport.path,
                                range: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 }}
                            };

                            const newSymbol = Symbol.createWithType(
                                SymbolFlags.ClassMember, implicitModuleType, defaultTypeSourceId);
                            newSymbol.addDeclaration(declaration);
                            if (!moduleFields.get(implicitImport.name)) {
                                setSymbolPreservingAccess(moduleFields, implicitImport.name, newSymbol);
                            }
                        }
                    }
                });

                let moduleDeclaration: Declaration | undefined;
                if (this._fileInfo.importMap[resolvedPath]) {
                    moduleDeclaration = {
                        category: DeclarationCategory.Module,
                        path: resolvedPath,
                        range: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } }
                    };
                }

                if (node.alias) {
                    this._assignTypeToNameNode(node.alias, moduleType, moduleDeclaration);
                    this._updateExpressionTypeForNode(node.alias, moduleType);

                    this._conditionallyReportUnusedName(node.alias, false,
                        this._fileInfo.diagnosticSettings.reportUnusedImport,
                        DiagnosticRule.reportUnusedImport,
                        `Import '${ node.alias.nameToken.value }' is not accessed`);
                } else {
                    this._bindMultiPartModuleNameToType(node.module.nameParts,
                        moduleType, moduleDeclaration);
                }
            } else {
                // We were unable to resolve the import. Bind the names (or alias)
                // to an unknown type.
                const symbolType = UnknownType.create();
                const nameNode = node.module.nameParts.length > 0 ? node.module.nameParts[0] : undefined;
                const aliasNode = node.alias || nameNode;

                if (node.alias && nameNode) {
                    this._updateExpressionTypeForNode(nameNode, symbolType);
                }

                if (aliasNode) {
                    this._assignTypeToNameNode(aliasNode, symbolType);
                    this._updateExpressionTypeForNode(aliasNode, symbolType);

                    this._conditionallyReportUnusedName(aliasNode, false,
                        this._fileInfo.diagnosticSettings.reportUnusedImport,
                        DiagnosticRule.reportUnusedImport,
                        `Import '${ aliasNode.nameToken.value }' is not accessed`);
                }
            }
        }

        return false;
    }

    visitImportFrom(node: ImportFromNode): boolean {
        const importInfo = AnalyzerNodeInfo.getImportInfo(node.module);

        if (importInfo && importInfo.isImportFound) {
            const resolvedPath = importInfo.resolvedPaths.length > 0 ?
                importInfo.resolvedPaths[importInfo.resolvedPaths.length - 1] : '';

            // Empty list implies "import *"
            if (node.isWildcardImport) {
                const moduleType = this._getModuleTypeForImportPath(importInfo, resolvedPath);
                if (moduleType) {
                    // Import the fields in the current permanent scope.
                    const moduleFields = moduleType.fields;
                    moduleFields.forEach((boundValue, fieldName) => {
                        this._addSymbolToPermanentScope(fieldName);
                        this._addTypeSourceToName(fieldName, TypeUtils.getEffectiveTypeOfSymbol(boundValue),
                            node.id, boundValue.hasDeclarations() ? boundValue.getDeclarations()[0] : undefined);
                    });

                    // Import the fields in the current permanent scope.
                    importInfo.implicitImports.forEach(implicitImport => {
                        const moduleType = this._getModuleTypeForImportPath(importInfo, resolvedPath);
                        if (moduleType) {
                            this._addSymbolToPermanentScope(implicitImport.name);
                            this._addTypeSourceToName(implicitImport.name, moduleType, node.id);
                        }
                    });
                }
            } else {
                node.imports.forEach(importAs => {
                    const name = importAs.name.nameToken.value;
                    const aliasNode = importAs.alias || importAs.name;
                    let symbolType: Type | undefined;
                    let declaration: Declaration | undefined;

                    // Is the name referring to an implicit import?
                    const implicitImport = importInfo.implicitImports.find(impImport => impImport.name === name);
                    if (implicitImport) {
                        const moduleType = this._getModuleTypeForImportPath(importInfo, implicitImport.path);
                        if (moduleType && this._fileInfo.importMap[implicitImport.path]) {
                            symbolType = moduleType;
                            declaration = {
                                category: DeclarationCategory.Module,
                                path: implicitImport.path,
                                range: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } }
                            };
                        }
                    } else {
                        const moduleType = this._getModuleTypeForImportPath(importInfo, resolvedPath);
                        if (moduleType) {
                            const moduleFields = moduleType.fields;
                            const symbol = moduleFields.get(name);

                            // For imports of the form "from . import X", the symbol
                            // will have no declarations.
                            if (symbol && symbol.hasDeclarations()) {
                                symbolType = TypeUtils.getEffectiveTypeOfSymbol(symbol);
                                declaration = symbol.getDeclarations()[0];
                            } else {
                                this._addError(
                                    `'${ importAs.name.nameToken.value }' is unknown import symbol`,
                                    importAs.name
                                );
                            }
                        }
                    }

                    if (!symbolType) {
                        symbolType = UnknownType.create();
                    }

                    this._updateExpressionTypeForNode(importAs.name, symbolType);
                    if (importAs.alias) {
                        this._updateExpressionTypeForNode(importAs.alias, symbolType);
                    }

                    if (declaration && declaration.declaredType) {
                        // Create a shallow copy of the declaration that
                        // does not include the declaredType because the symbol
                        // in this namespace is not necessarily constrained to
                        // this type.
                        declaration = Object.assign({}, declaration);
                        declaration.declaredType = undefined;
                    }

                    this._assignTypeToNameNode(aliasNode, symbolType, declaration);

                    // Python files generated by protoc ("_pb2.py" files) contain
                    // unused imports. Don't report these because they're in generated
                    // files that shouldn't be edited.
                    if (importInfo.importName !== '__future__' &&
                            !this._fileInfo.filePath.endsWith('_pb2.py')) {

                        this._conditionallyReportUnusedName(aliasNode, false,
                            this._fileInfo.diagnosticSettings.reportUnusedImport,
                            DiagnosticRule.reportUnusedImport,
                            `Import '${ aliasNode.nameToken.value }' is not accessed`);
                    }
                });
            }
        } else {
            // We were unable to resolve the import. Bind the names (or aliases)
            // to an unknown type.
            if (!node.isWildcardImport) {
                node.imports.forEach(importAs => {
                    const aliasNode = importAs.alias || importAs.name;
                    const symbolType = UnknownType.create();

                    this._updateExpressionTypeForNode(importAs.name, symbolType);
                    if (importAs.alias) {
                        this._updateExpressionTypeForNode(importAs.name, symbolType);
                    }

                    this._assignTypeToNameNode(aliasNode, symbolType);
                    this._conditionallyReportUnusedName(aliasNode, false,
                        this._fileInfo.diagnosticSettings.reportUnusedImport,
                        DiagnosticRule.reportUnusedImport,
                        `Import '${ aliasNode.nameToken.value }' is not accessed`);
                });
            }
        }

        return false;
    }

    visitTypeAnnotation(node: TypeAnnotationExpressionNode): boolean {
        let declaredType = this._getTypeOfAnnotation(node.typeAnnotation);

        // If this is within an enum, transform the type.
        if (node.valueExpression && node.valueExpression.nodeType === ParseNodeType.Name) {
            declaredType = this._transformTypeForPossibleEnumClass(
                node.valueExpression, declaredType);
        }

        // Class and global variables should always be marked as accessed.
        if (ParseTreeUtils.getEnclosingClassOrModule(node, true)) {
            this._markExpressionAccessed(node.valueExpression);
        }

        this._declareTypeForExpression(node.valueExpression, declaredType,
            node.typeAnnotation);

        if (this._fileInfo.isStubFile) {
            this._assignTypeToExpression(node.valueExpression, declaredType,
                node.typeAnnotation);
        }

        return true;
    }

    visitError(node: ErrorExpressionNode) {
        this._getTypeOfExpression(node);

        // Don't explore further.
        return false;
    }

    visitSuite(node: SuiteNode): boolean {
        // Manually walk the statements in the suite so we can flag
        // the point where an unconditional return or raise occurs.
        let reportedUnreachableCode = false;

        node.statements.forEach((statement, index) => {
            this.walk(statement);

            if (this._currentScope.getAlwaysRaises() ||
                    this._currentScope.getAlwaysReturns() ||
                    this._currentScope.getAlwaysBreaks()) {

                if (!reportedUnreachableCode) {
                    if (index < node.statements.length - 1) {
                        // Create a text range that covers the next statement through
                        // the end of the suite.
                        const start = node.statements[index + 1].start;
                        const lastStatement = node.statements[node.statements.length - 1];
                        const end = TextRange.getEnd(lastStatement);
                        this._addUnusedCode({ start, length: end - start });
                    }

                    // Note that we already reported this so we don't do it again.
                    reportedUnreachableCode = true;
                }
            }
        });

        return false;
    }

    // Validates that a call to isinstance is necessary. This is a
    // common source of programming errors.
    private _validateIsInstanceCallNecessary(node: CallExpressionNode) {
        if (this._fileInfo.diagnosticSettings.reportUnnecessaryIsInstance === 'none') {
            return;
        }

        // If this call is within an assert statement, we'll ignore it.
        let curNode: ParseNode | undefined = node;
        while (curNode) {
            if (curNode.nodeType === ParseNodeType.Assert) {
                return;
            }
            curNode = curNode.parent;
        }

        if (node.leftExpression.nodeType !== ParseNodeType.Name ||
                node.leftExpression.nameToken.value !== 'isinstance' ||
                node.arguments.length !== 2) {
            return;
        }

        const arg0Type = this._getTypeOfExpression(node.arguments[0].valueExpression);
        if (isAnyOrUnknown(arg0Type)) {
            return;
        }

        const arg1Type = this._getTypeOfExpression(node.arguments[1].valueExpression);

        const classTypeList: ClassType[] = [];
        if (arg1Type.category === TypeCategory.Class) {
            classTypeList.push(arg1Type);
        } else if (arg1Type.category === TypeCategory.Object) {
            // The isinstance call supports a variation where the second
            // parameter is a tuple of classes.
            const objClass = arg1Type.classType;
            if (ClassType.isBuiltIn(objClass, 'Tuple') && ClassType.getTypeArguments(objClass)) {
                ClassType.getTypeArguments(objClass)!.forEach(typeArg => {
                    if (typeArg.category === TypeCategory.Class) {
                        classTypeList.push(typeArg);
                    } else {
                        return;
                    }
                });
            }
        } else {
            return;
        }

        const finalizeFilteredTypeList = (types: Type[]): Type => {
            return combineTypes(types);
        };

        const filterType = (varType: ClassType): ObjectType[] => {
            const filteredTypes: ClassType[] = [];

            for (const filterType of classTypeList) {
                const filterIsSuperclass = ClassType.isDerivedFrom(varType, filterType);
                const filterIsSubclass = ClassType.isDerivedFrom(filterType, varType);

                if (filterIsSuperclass) {
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

            return filteredTypes.map(t => ObjectType.create(t));
        };

        let filteredType: Type;
        if (arg0Type.category === TypeCategory.Object) {
            const remainingTypes = filterType(arg0Type.classType);
            filteredType = finalizeFilteredTypeList(remainingTypes);
        } else if (arg0Type.category === TypeCategory.Union) {
            let remainingTypes: Type[] = [];
            let foundAnyType = false;

            arg0Type.subtypes.forEach(t => {
                if (isAnyOrUnknown(t)) {
                    foundAnyType = true;
                }

                if (t.category === TypeCategory.Object) {
                    remainingTypes = remainingTypes.concat(
                        filterType(t.classType));
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
            const objTypeList = classTypeList.map(t => ObjectType.create(t));
            return combineTypes(objTypeList);
        };

        if (filteredType.category === TypeCategory.Never) {
            this._addDiagnostic(
                this._fileInfo.diagnosticSettings.reportUnnecessaryIsInstance,
                DiagnosticRule.reportUnnecessaryIsInstance,
                `Unnecessary isinstance call: '${ printType(arg0Type) }' ` +
                    `is never instance of '${ printType(getTestType()) }'`,
                node);
        } else if (isTypeSame(filteredType, arg0Type)) {
            this._addDiagnostic(
                this._fileInfo.diagnosticSettings.reportUnnecessaryIsInstance,
                DiagnosticRule.reportUnnecessaryIsInstance,
                `Unnecessary isinstance call: '${ printType(arg0Type) }' ` +
                    `is always instance of '${ printType(getTestType()) }'`,
                node);
        }
    }

    // Handles some special-case assignment statements that are found
    // within the typings.pyi file.
    private _handleTypingStubAssignment(node: AssignmentNode): boolean {
        if (!this._fileInfo.isTypingStubFile) {
            return false;
        }

        if (node.leftExpression.nodeType === ParseNodeType.Name) {
            const assignedName = node.leftExpression.nameToken.value;
            let specialType: Type | undefined;

            if (assignedName === 'Any') {
                specialType = AnyType.create();
            } else {
                const specialTypes = ['overload', 'TypeVar', '_promote', 'no_type_check',
                    'NoReturn', 'Union', 'Optional', 'List', 'Dict', 'DefaultDict',
                    'Set', 'FrozenSet', 'Deque', 'ChainMap'];
                if (specialTypes.find(t => t === assignedName)) {
                    const aliasMap: { [name: string]: AliasMapEntry } = {
                        'List': { alias: 'list', module: 'builtins' },
                        'Dict': { alias: 'dict', module: 'builtins' },
                        'DefaultDict': { alias: 'defaultdict', module: 'collections' },
                        'Set': { alias: 'set', module: 'builtins' },
                        'FrozenSet': { alias: 'frozenset', module: 'builtins' },
                        'Deque': { alias: 'deque', module: 'collections' },
                        'ChainMap': { alias: 'ChainMap', module: 'collections' }
                    };

                    // Synthesize a class.
                    const specialClassType = ClassType.create(assignedName,
                        ClassTypeFlags.BuiltInClass | ClassTypeFlags.SpecialBuiltIn,
                        defaultTypeSourceId);

                    // See if we need to locate an alias class to bind it to.
                    const aliasMapEntry = aliasMap[assignedName];
                    if (aliasMapEntry) {
                        let aliasClass: Type | undefined;
                        const aliasName = aliasMapEntry.alias;

                        if (aliasMapEntry.module === 'builtins') {
                            aliasClass = ScopeUtils.getBuiltInType(this._currentScope, aliasName);
                        } else if (aliasMapEntry.module === 'collections') {
                            // The typing.pyi file imports collections.
                            const collectionsSymbolTable = this._findCollectionsImportSymbolTable();
                            if (collectionsSymbolTable) {
                                const symbol = collectionsSymbolTable.get(aliasName);
                                if (symbol) {
                                    aliasClass = TypeUtils.getEffectiveTypeOfSymbol(symbol);
                                }
                            }
                        }

                        if (aliasClass && aliasClass.category === TypeCategory.Class) {
                            ClassType.addBaseClass(specialClassType, aliasClass, false);
                            ClassType.setAliasClass(specialClassType, aliasClass);
                            specialType = specialClassType;
                        } else {
                            // The alias class has not yet been created. Use an unknown
                            // type and hope that in the next analysis pass we'll get
                            // the real type.
                            specialType = UnknownType.create();
                        }
                    } else {
                        specialType = specialClassType;
                    }
                }
            }

            if (specialType) {
                const declaration: Declaration = {
                    category: DeclarationCategory.Class,
                    node: node.leftExpression,
                    path: this._fileInfo.filePath,
                    range: convertOffsetsToRange(node.leftExpression.start,
                        TextRange.getEnd(node.leftExpression), this._fileInfo.lines)
                };
                this._assignTypeToNameNode(node.leftExpression, specialType, declaration);
                this._updateExpressionTypeForNode(node.leftExpression, specialType);
                return true;
            }
        } else if (node.leftExpression.nodeType === ParseNodeType.TypeAnnotation &&
                node.leftExpression.valueExpression.nodeType === ParseNodeType.Name) {

            const nameNode = node.leftExpression.valueExpression;
            const assignedName = nameNode.nameToken.value;
            let specialType: Type | undefined;

            const specialTypes = ['Tuple', 'Generic', 'Protocol', 'Callable',
                'Type', 'ClassVar', 'Final', 'Literal'];
            if (specialTypes.find(t => t === assignedName)) {
                // Synthesize a class.
                const specialClassType = ClassType.create(assignedName,
                    ClassTypeFlags.BuiltInClass | ClassTypeFlags.SpecialBuiltIn,
                    node.id);

                const aliasClass = ScopeUtils.getBuiltInType(this._currentScope,
                    assignedName.toLowerCase());
                if (aliasClass.category === TypeCategory.Class) {
                    ClassType.setAliasClass(specialClassType, aliasClass);

                    const specializedBaseClass = TypeUtils.specializeType(aliasClass, undefined);
                    ClassType.addBaseClass(specialClassType, specializedBaseClass, false);
                    specialType = specialClassType;
                } else {
                    // The other classes derive from 'object'.
                    const objBaseClass = ScopeUtils.getBuiltInType(this._currentScope, 'object');
                    if (objBaseClass.category === TypeCategory.Class) {
                        ClassType.addBaseClass(specialClassType, objBaseClass, false);
                        specialType = specialClassType;
                    } else {
                        // The base class has not yet been created. Use an unknown
                        // type and hope that in the next analysis pass we'll get
                        // the real type.
                        specialType = UnknownType.create();
                    }
                }
            }

            if (specialType) {
                const declaration: Declaration = {
                    category: DeclarationCategory.Class,
                    node: nameNode,
                    path: this._fileInfo.filePath,
                    range: convertOffsetsToRange(nameNode.start,
                        TextRange.getEnd(nameNode), this._fileInfo.lines)
                };
                this._assignTypeToNameNode(nameNode, specialType, declaration);
                this._updateExpressionTypeForNode(nameNode, specialType);
                return true;
            }
        }

        return false;
    }

    // Transforms the parameter type based on its category. If it's a simple parameter,
    // no transform is applied. If it's a var-arg or keyword-arg parameter, the type
    // is wrapped in a List or Dict.
    private _getVariadicParamType(paramCategory: ParameterCategory, type: Type): Type {
        if (paramCategory === ParameterCategory.VarArgList) {
            const listType = ScopeUtils.getBuiltInType(this._currentScope, 'List');
            if (listType.category === TypeCategory.Class) {
                type = ObjectType.create(ClassType.cloneForSpecialization(listType, [type]));
            } else {
                type = UnknownType.create();
            }
        } else if (paramCategory === ParameterCategory.VarArgDictionary) {
            const dictType = ScopeUtils.getBuiltInType(this._currentScope, 'Dict');
            const strType = ScopeUtils.getBuiltInObject(this._currentScope, 'str');
            if (dictType.category === TypeCategory.Class && strType.category === TypeCategory.Object) {
                type = ObjectType.create(ClassType.cloneForSpecialization(dictType, [strType, type]));
            } else {
                type = UnknownType.create();
            }
        }

        return type;
    }

    private _reportPossibleUnknownAssignment(diagLevel: DiagnosticLevel, rule: string,
            target: NameNode, type: Type, srcExpr: ExpressionNode) {

        // Don't bother if the feature is disabled.
        if (diagLevel === 'none') {
            return;
        }

        const nameValue = target.nameToken.value;
        const simplifiedType = removeUnboundFromUnion(type);
        if (simplifiedType.category === TypeCategory.Unknown) {
            this._addDiagnostic(diagLevel,
                rule,
                `Inferred type of '${ nameValue }' is unknown`, srcExpr);
        } else if (TypeUtils.containsUnknown(simplifiedType)) {
            // Sometimes variables contain an "unbound" type if they're
            // assigned only within conditional statements. Remove this
            // to avoid confusion.
            this._addDiagnostic(diagLevel,
                rule,
                `Inferred type of '${ nameValue }', '${ printType(simplifiedType) }', ` +
                `is partially unknown`, srcExpr);
        }
    }

    // Determines whether the specified expression is a symbol with a declared type
    // (either a simple name or a member variable). If so, the type is returned.
    private _getDeclaredTypeForExpression(expression: ExpressionNode): Type | undefined {
        let symbol: Symbol | undefined;
        let classOrObjectBase: ClassType | ObjectType | undefined;

        if (expression.nodeType === ParseNodeType.Name) {
            const symbolWithScope = this._currentScope.lookUpSymbolRecursive(expression.nameToken.value);
            if (symbolWithScope) {
                symbol = symbolWithScope.symbol;
            }
        } else if (expression.nodeType === ParseNodeType.TypeAnnotation) {
            return this._getDeclaredTypeForExpression(expression.valueExpression);
        } else if (expression.nodeType === ParseNodeType.MemberAccess) {
            // Get the base type but don't cache the results because we're going to call again
            // with a 'set' usage type below, and we don't want to skip that logic.
            const baseType = this._getTypeOfExpression(expression.leftExpression, EvaluatorFlags.DoNotCache);
            let classMemberInfo: TypeUtils.ClassMember | undefined;

            if (baseType.category === TypeCategory.Object) {
                classMemberInfo = TypeUtils.lookUpObjectMember(baseType, expression.memberName.nameToken.value);
                classOrObjectBase = baseType;
            } else if (baseType.category === TypeCategory.Class) {
                classMemberInfo = TypeUtils.lookUpClassMember(baseType, expression.memberName.nameToken.value);
                classOrObjectBase = baseType;
            }

            if (classMemberInfo) {
                symbol = classMemberInfo.symbol;
            }
        }

        if (symbol) {
            let declaredType = TypeUtils.getDeclaredTypeOfSymbol(symbol);
            if (declaredType) {
                if (classOrObjectBase) {
                    declaredType = TypeUtils.bindFunctionToClassOrObject(classOrObjectBase,
                        declaredType);
                }

                return declaredType;
            }
        }

        return undefined;
    }

    // Assigns a declared type (as opposed to an inferred type) to an expression
    // (e.g. a local variable, class variable, instance variable, etc.).
    private _declareTypeForExpression(target: ExpressionNode, declaredType: Type,
            typeAnnotationNode: ExpressionNode, srcExprNode?: ExpressionNode) {

        let declarationHandled = false;

        if (target.nodeType === ParseNodeType.Name) {
            const name = target.nameToken;
            const declaration: Declaration = {
                category: DeclarationCategory.Variable,
                node: target,
                isConstant: SymbolNameUtils.isConstantName(name.value),
                path: this._fileInfo.filePath,
                declaredType,
                range: convertOffsetsToRange(name.start, TextRange.getEnd(name), this._fileInfo.lines)
            };

            const symbolWithScope = this._currentScope.lookUpSymbolRecursive(name.value);
            if (symbolWithScope && symbolWithScope.symbol) {
                this._addDeclarationToSymbol(symbolWithScope.symbol, declaration, typeAnnotationNode);
            }
            declarationHandled = true;
        } else if (target.nodeType === ParseNodeType.MemberAccess) {
            const targetNode = target.leftExpression;

            // Handle member accesses (e.g. self.x or cls.y).
            if (targetNode && targetNode.nodeType === ParseNodeType.Name) {

                // Determine whether we're writing to a class or instance member.
                const enclosingClassNode = ParseTreeUtils.getEnclosingClass(target);
                if (enclosingClassNode) {
                    const classType = AnalyzerNodeInfo.getExpressionType(enclosingClassNode);

                    if (classType && classType.category === TypeCategory.Class) {
                        const typeOfLeftExpr = this._getTypeOfExpression(target.leftExpression);
                        if (typeOfLeftExpr.category === TypeCategory.Object) {
                            if (ClassType.isSameGenericClass(typeOfLeftExpr.classType, classType)) {
                                this._assignTypeToMemberVariable(target, declaredType, true,
                                    typeAnnotationNode, srcExprNode);
                                declarationHandled = true;
                            }
                        } else if (typeOfLeftExpr.category === TypeCategory.Class) {
                            if (ClassType.isSameGenericClass(typeOfLeftExpr, classType)) {
                                this._assignTypeToMemberVariable(target, declaredType, false,
                                    typeAnnotationNode, srcExprNode);
                                declarationHandled = true;
                            }
                        }
                    }
                }
            }
        }

        if (!declarationHandled) {
            this._addError(
                `Type annotation not supported for this type of expression`,
                typeAnnotationNode);
        }
    }

    private _addDeclarationToSymbol(symbol: Symbol, declaration: Declaration, errorNode: ExpressionNode) {
        // Are we adding a new declaration with a declared type?
        const prevDeclarations = symbol.getDeclarations();
        if (prevDeclarations.length > 0 && declaration.declaredType) {
            const declWithDefinedType = prevDeclarations.find(decl => !!decl.declaredType);

            if (declWithDefinedType && declaration.node !== declWithDefinedType.node && declWithDefinedType.declaredType) {
                // If we're adding a declaration, make sure it's the same type as an existing declaration.
                if (!isTypeSame(declaration.declaredType, declWithDefinedType.declaredType)) {
                    this._addError(`Declared type '${ printType(declaration.declaredType) }' is not compatible ` +
                        `with previous declared type '${ printType(declWithDefinedType.declaredType) }'`,
                        errorNode);
                }
            }
        }

        symbol.addDeclaration(declaration);
    }

    private _isSymbolPrivate(nameValue: string, scopeType: ScopeType) {
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

    private _conditionallyReportUnusedName(node: NameNode, reportPrivateOnly: boolean,
            diagLevel: DiagnosticLevel, rule: string, message: string) {

        const nameValue = node.nameToken.value;

        // A name of "_" means "I know this symbol isn't used", so
        // don't report it as unused.
        if (nameValue === '_') {
            return;
        }

        if (SymbolNameUtils.isDunderName(nameValue)) {
            return;
        }

        if (this._fileInfo.isStubFile) {
            return;
        }

        const symbolInScope = this._currentScope.lookUpSymbolRecursive(nameValue);
        if (symbolInScope && !symbolInScope.symbol.isAccessed()) {
            if (reportPrivateOnly) {
                if (!this._isSymbolPrivate(nameValue, symbolInScope.scope.getType())) {
                    return;
                }
            }

            this._addUnusedName(node);
            this._addDiagnostic(diagLevel, rule, message, node);
        }
    }

    private _conditionallyReportPrivateUsage(node: NameNode) {
        if (this._fileInfo.diagnosticSettings.reportPrivateUsage === 'none') {
            return;
        }

        // Ignore privates in type stubs.
        if (this._fileInfo.isStubFile) {
            return;
        }

        const nameValue = node.nameToken.value;
        const isPrivateName = SymbolNameUtils.isPrivateName(nameValue);
        const isProtectedName = SymbolNameUtils.isProtectedName(nameValue);

        // If it's not a protected or private name, don't bother with
        // any further checks.
        if (!isPrivateName && !isProtectedName) {
            return;
        }

        const declarations = DeclarationUtils.getDeclarationsForNameNode(node);

        const primaryDeclaration = declarations && declarations.length > 0 ?
            declarations[0] : undefined;
        if (!primaryDeclaration || primaryDeclaration.node === node) {
            return;
        }

        let classOrModuleNode: ClassNode | ModuleNode | undefined;
        if (primaryDeclaration.node) {
            classOrModuleNode = ParseTreeUtils.getEnclosingClassOrModule(
            primaryDeclaration.node);
        }

        // If this is the name of a class, find the module or class that contains it rather
        // than constraining the use of the class name within the class itself.
        if (primaryDeclaration.node &&
                primaryDeclaration.node.parent &&
                primaryDeclaration.node.parent === classOrModuleNode &&
                classOrModuleNode.nodeType === ParseNodeType.Class) {

            classOrModuleNode = ParseTreeUtils.getEnclosingClassOrModule(classOrModuleNode);
        }

        // If it's a class member, check whether it's a legal protected access.
        let isProtectedAccess = false;
        if (classOrModuleNode && classOrModuleNode.nodeType === ParseNodeType.Class) {
            if (isProtectedName) {
                const declarationClassType = AnalyzerNodeInfo.getExpressionType(classOrModuleNode);
                if (declarationClassType && declarationClassType.category === TypeCategory.Class) {
                    // Note that the access is to a protected class member.
                    isProtectedAccess = true;

                    const enclosingClassNode = ParseTreeUtils.getEnclosingClass(node);
                    if (enclosingClassNode) {
                        isProtectedAccess = true;
                        const enclosingClassType = AnalyzerNodeInfo.getExpressionType(enclosingClassNode);

                        // If the referencing class is a subclass of the declaring class, it's
                        // allowed to access a protected name.
                        if (enclosingClassType && enclosingClassType.category === TypeCategory.Class) {
                            if (TypeUtils.derivesFromClassRecursive(enclosingClassType, declarationClassType)) {
                                return;
                            }
                        }
                    }
                }
            }
        }

        if (classOrModuleNode && !ParseTreeUtils.isNodeContainedWithin(node, classOrModuleNode)) {
            if (isProtectedAccess) {
                this._addDiagnostic(this._fileInfo.diagnosticSettings.reportPrivateUsage,
                    DiagnosticRule.reportPrivateUsage,
                    `'${ nameValue }' is protected and used outside of a derived class`,
                    node);
            } else {
                const scopeName = classOrModuleNode.nodeType === ParseNodeType.Class ?
                    'class' : 'module';

                this._addDiagnostic(this._fileInfo.diagnosticSettings.reportPrivateUsage,
                    DiagnosticRule.reportPrivateUsage,
                    `'${ nameValue }' is private and used outside of the ${ scopeName } in which it is declared`,
                    node);
            }
        }
    }

    private _createAwaitableFunction(functionType: FunctionType): FunctionType {
        const returnType = FunctionType.getEffectiveReturnType(functionType);

        let awaitableReturnType: Type | undefined;
        const evaluator = this._createEvaluator();

        if (returnType.category === TypeCategory.Object) {
            const classType = returnType.classType;
            if (ClassType.isBuiltIn(classType)) {
                if (ClassType.getClassName(classType) === 'Generator') {
                    // If the return type is a Generator, change it to an AsyncGenerator.
                    const asyncGeneratorType = evaluator.getTypingType('AsyncGenerator');
                    if (asyncGeneratorType && asyncGeneratorType.category === TypeCategory.Class) {
                        const typeArgs: Type[] = [];
                        const generatorTypeArgs = ClassType.getTypeArguments(classType);
                        if (generatorTypeArgs && generatorTypeArgs.length > 0) {
                            typeArgs.push(generatorTypeArgs[0]);
                        }
                        if (generatorTypeArgs && generatorTypeArgs.length > 1) {
                            typeArgs.push(generatorTypeArgs[1]);
                        }
                        awaitableReturnType = ObjectType.create(
                            ClassType.cloneForSpecialization(asyncGeneratorType, typeArgs));
                    }

                } else if (ClassType.getClassName(classType) === 'AsyncGenerator') {
                    // If it's already an AsyncGenerator, leave it as is.
                    awaitableReturnType = returnType;
                }
            }
        }

        if (!awaitableReturnType) {
            const awaitableType = evaluator.getTypingType('Awaitable');
            if (awaitableType && awaitableType.category === TypeCategory.Class) {
                awaitableReturnType = ObjectType.create(
                    ClassType.cloneForSpecialization(awaitableType, [returnType]));
            } else {
                awaitableReturnType = UnknownType.create();
            }
        }

        // Clone the original function and replace its return type with an
        // Awaitable[<returnType>].
        const awaitableFunctionType = FunctionType.clone(functionType);
        FunctionType.setDeclaredReturnType(awaitableFunctionType, awaitableReturnType);

        return awaitableFunctionType;
    }

    private _validateFunctionReturn(node: FunctionNode, functionType: FunctionType,
            functionScope: Scope) {

        // Stub files are allowed not to return an actual value,
        // so skip this if it's a stub file.
        if (this._fileInfo.isStubFile) {
            return;
        }

        // Add all of the return and yield types that were found within the function.
        const inferredReturnType = FunctionType.getInferredReturnType(functionType);
        if (inferredReturnType.addSources(functionScope.getReturnType())) {
            this._setAnalysisChanged('Function return inferred type changed');
        }

        const inferredYieldType = FunctionType.getInferredYieldType(functionType);

        // Inferred yield types need to be wrapped in a Generator to
        // produce the final result.
        const evaluator = this._createEvaluator();
        const generatorType = evaluator.getTypingType('Generator');
        if (generatorType && generatorType.category === TypeCategory.Class) {
            inferredYieldType.setGenericClassWrapper(generatorType);
        }

        if (inferredYieldType.addSources(functionScope.getYieldType())) {
            this._setAnalysisChanged('Function yield type changed');
        }

        // Add the "None" type if the function doesn't always return.
        if (!functionScope.getAlwaysReturnsOrRaises()) {
            if (inferredReturnType.addSource(NoneType.create(), node.id)) {
                this._setAnalysisChanged('Function inferred None changed');
            }

            const declaredReturnType = FunctionType.isGenerator(functionType) ?
                TypeUtils.getDeclaredGeneratorReturnType(functionType) :
                FunctionType.getDeclaredReturnType(functionType);

            if (declaredReturnType && node.returnTypeAnnotation) {
                // Skip this check for abstract methods and functions that are declared NoReturn.
                if (!FunctionType.isAbstractMethod(functionType) && !TypeUtils.isNoReturnType(declaredReturnType)) {
                    const diagAddendum = new DiagnosticAddendum();

                    // If the declared type isn't compatible with 'None', flag an error.
                    if (!TypeUtils.canAssignType(declaredReturnType, NoneType.create(), diagAddendum)) {
                        // If the function consists entirely of "...", assume that it's
                        // an abstract method or a protocol method and don't require that
                        // the return type matches.
                        if (!ParseTreeUtils.isSuiteEmpty(node.suite)) {
                            this._addError(`Function with declared type of '${ printType(declaredReturnType) }'` +
                                    ` must return value` + diagAddendum.getString(),
                                node.returnTypeAnnotation);
                        }
                    }
                }
            }
        } else if (functionScope.getAlwaysRaises() &&
                functionScope.getReturnType().getSources().length === 0 &&
                !FunctionType.isAbstractMethod(functionType)) {

            // If the function always raises and never returns, add
            // the "NoReturn" type. Skip this for abstract methods which
            // often are implemented with "raise NotImplementedError()".
            const noReturnType = evaluator.getTypingType('NoReturn') as ClassType;
            if (noReturnType && inferredReturnType.addSource(ObjectType.create(noReturnType), node.id)) {
                this._setAnalysisChanged('Function inferred NoReturn changed');
            }
        } else {
            if (inferredReturnType.removeSource(node.id)) {
                this._setAnalysisChanged('Function inferred return type changed');
            }
        }

        if (node.returnTypeAnnotation) {
            const declaredReturnType = FunctionType.getDeclaredReturnType(functionType);
            if (declaredReturnType && TypeUtils.isNoReturnType(declaredReturnType)) {
                if (!functionScope.getAlwaysRaises()) {
                    // If the function consists entirely of "...", assume that it's
                    // an abstract method or a protocol method and don't require that
                    // the return type matches.
                    if (!ParseTreeUtils.isSuiteEmpty(node.suite)) {
                        this._addError(`Function with declared type of 'NoReturn' cannot return 'None'`,
                            node.returnTypeAnnotation);
                    }
                }
            }
        }
    }

    // Validates that any overridden methods contain the same signatures
    // as the original method. Also marks the class as abstract if one or
    // more abstract methods are not overridden.
    private _validateClassMethods(classType: ClassType) {
        if (TypeUtils.doesClassHaveAbstractMethods(classType)) {
            ClassType.setIsAbstractClass(classType);
        }

        // Skip the overridden method check for stub files. Many of the built-in
        // typeshed stub files trigger this diagnostic.
        if (!this._fileInfo.isStubFile) {
            // Skip this check (which is somewhat expensive) if it is disabled.
            if (this._fileInfo.diagnosticSettings.reportIncompatibleMethodOverride !== 'none') {

                this._validateOveriddenMethods(classType);
            }
        }
    }

    private _validateOveriddenMethods(classType: ClassType) {
        ClassType.getFields(classType).forEach((symbol, name) => {
            // Don't check magic functions.
            if (symbol.isClassMember() && !SymbolNameUtils.isDunderName(name)) {
                const typeOfSymbol = TypeUtils.getEffectiveTypeOfSymbol(symbol);
                if (typeOfSymbol.category === TypeCategory.Function) {
                    const baseClassAndSymbol = TypeUtils.getSymbolFromBaseClasses(classType, name);
                    if (baseClassAndSymbol) {
                        const typeOfBaseClassMethod = TypeUtils.getEffectiveTypeOfSymbol(baseClassAndSymbol.symbol);
                        const diagAddendum = new DiagnosticAddendum();
                        if (!TypeUtils.canOverrideMethod(typeOfBaseClassMethod, typeOfSymbol, diagAddendum)) {
                            const declarations = symbol.getDeclarations();
                            const errorNode = declarations[0].node;
                            if (errorNode) {
                                this._addDiagnostic(this._fileInfo.diagnosticSettings.reportIncompatibleMethodOverride,
                                    DiagnosticRule.reportIncompatibleMethodOverride,
                                    `Method '${ name }' overrides class '${ ClassType.getClassName(baseClassAndSymbol.class) }' ` +
                                        `in an incompatible manner` + diagAddendum.getString(), errorNode);
                            }
                        }
                    }
                }
            }
        });
    }

    private _applyClassDecorator(inputClassType: Type, originalClassType: ClassType,
            decoratorNode: DecoratorNode): Type {

        const decoratorType = this._getTypeOfExpression(decoratorNode.leftExpression);

        // Is this a @dataclass?
        if (decoratorType.category === TypeCategory.OverloadedFunction) {
            const overloads = decoratorType.overloads;
            if (overloads.length > 0 && FunctionType.getBuiltInName(overloads[0].type) === 'dataclass') {
                // Determine whether we should skip synthesizing the init method.
                let skipSynthesizeInit = false;

                if (decoratorNode.arguments) {
                    decoratorNode.arguments.forEach(arg => {
                        if (arg.name && arg.name.nameToken.value === 'init') {
                            if (arg.valueExpression) {
                                const value = StaticExpressions.evaluateStaticExpression(
                                    arg.valueExpression, this._fileInfo.executionEnvironment);
                                if (!value) {
                                    skipSynthesizeInit = true;
                                }
                            }
                        }
                    });
                }

                ClassType.setIsDataClass(originalClassType, skipSynthesizeInit);
                return inputClassType;
            }
        }

        const evaluator = this._createEvaluator();
        return evaluator.getTypeFromDecorator(decoratorNode, inputClassType);
    }

    // Transforms the input function type into an output type based on the
    // decorator function described by the decoratorNode.
    private _applyFunctionDecorator(inputFunctionType: Type, originalFunctionType: FunctionType,
            decoratorNode: DecoratorNode, node: FunctionNode): Type {

        const decoratorType = this._getTypeOfExpression(decoratorNode.leftExpression);

        // Special-case the "overload" because it has no definition.
        if (decoratorType.category === TypeCategory.Class && ClassType.getClassName(decoratorType) === 'overload') {
            const permanentScope = ScopeUtils.getPermanentScope(this._currentScope);
            const existingSymbol = permanentScope.lookUpSymbol(node.name.nameToken.value);
            const typeSourceId = node.id;
            if (inputFunctionType.category === TypeCategory.Function) {
                if (existingSymbol) {
                    const symbolType = TypeUtils.getEffectiveTypeOfSymbol(existingSymbol);
                    if (symbolType.category === TypeCategory.OverloadedFunction) {
                        OverloadedFunctionType.addOverload(symbolType, typeSourceId, inputFunctionType);
                        return symbolType;
                    }
                }

                const newOverloadType = OverloadedFunctionType.create();
                OverloadedFunctionType.addOverload(newOverloadType, typeSourceId, inputFunctionType);
                return newOverloadType;
            }
        }

        const evaluator = this._createEvaluator();
        const returnType = evaluator.getTypeFromDecorator(decoratorNode, inputFunctionType);

        // Check for some built-in decorator types with known semantics.
        if (decoratorType.category === TypeCategory.Function) {
            if (FunctionType.getBuiltInName(decoratorType) === 'abstractmethod') {
                FunctionType.setIsAbstractMethod(originalFunctionType);
                return inputFunctionType;
            }

            // Handle property setters and deleters.
            if (decoratorNode.leftExpression.nodeType === ParseNodeType.MemberAccess) {
                const baseType = this._getTypeOfExpression(decoratorNode.leftExpression.leftExpression);
                if (baseType.category === TypeCategory.Property) {
                    const memberName = decoratorNode.leftExpression.memberName.nameToken.value;
                    if (memberName === 'setter') {
                        baseType.setter = originalFunctionType;
                        return baseType;
                    } else if (memberName === 'deleter') {
                        baseType.deleter = originalFunctionType;
                        return baseType;
                    }
                }
            }

        } else if (decoratorType.category === TypeCategory.Class) {
            if (ClassType.isBuiltIn(decoratorType)) {
                switch (ClassType.getClassName(decoratorType)) {
                    case 'staticmethod': {
                        FunctionType.setIsStaticMethod(originalFunctionType);
                        return inputFunctionType;
                    }

                    case 'classmethod': {
                        FunctionType.setIsClassMethod(originalFunctionType);
                        return inputFunctionType;
                    }

                    case 'property': {
                        if (inputFunctionType.category === TypeCategory.Function) {
                            // Allocate a property only during the first analysis pass.
                            // Otherwise the analysis won't converge if there are setters
                            // and deleters applied to the property.
                            const oldPropertyType = AnalyzerNodeInfo.getExpressionType(decoratorNode);
                            if (oldPropertyType) {
                                return oldPropertyType;
                            }
                            const newProperty = PropertyType.create(inputFunctionType);
                            AnalyzerNodeInfo.setExpressionType(decoratorNode, newProperty);
                            return newProperty;
                        }

                        break;
                    }
                }
            }
        }

        return returnType;
    }

    // Performs checks on a function that is located within a class
    // and has been determined not to be a property accessor.
    private _validateMethod(node: FunctionNode, functionType: FunctionType) {
        if (node.name && node.name.nameToken.value === '__new__') {
            // __new__ overrides should have a "cls" parameter.
            if (node.parameters.length === 0 || !node.parameters[0].name ||
                    (node.parameters[0].name.nameToken.value !== 'cls' &&
                    node.parameters[0].name.nameToken.value !== 'mcs')) {
                this._addError(
                    `The __new__ override should take a 'cls' parameter`,
                    node.parameters.length > 0 ? node.parameters[0] : node.name);
            }
        } else if (node.name && node.name.nameToken.value === '__init_subclass__') {
            // __init_subclass__ overrides should have a "cls" parameter.
            if (node.parameters.length === 0 || !node.parameters[0].name ||
                    node.parameters[0].name.nameToken.value !== 'cls') {
                this._addError(
                    `The __init_subclass__ override should take a 'cls' parameter`,
                    node.parameters.length > 0 ? node.parameters[0] : node.name);
            }
        } else if (FunctionType.isStaticMethod(functionType)) {
            // Static methods should not have "self" or "cls" parameters.
            if (node.parameters.length > 0 && node.parameters[0].name) {
                const paramName = node.parameters[0].name.nameToken.value;
                if (paramName === 'self' || paramName === 'cls') {
                    this._addError(
                        `Static methods should not take a 'self' or 'cls' parameter`,
                        node.parameters[0].name);
                }
            }
        } else if (FunctionType.isClassMethod(functionType)) {
            let paramName = '';
            if (node.parameters.length > 0 && node.parameters[0].name) {
                paramName = node.parameters[0].name.nameToken.value;
            }
            // Class methods should have a "cls" parameter. We'll exempt parameter
                // names that start with an underscore since those are used in a few
                // cases in the stdlib pyi files.
            if (paramName !== 'cls') {
                if (!this._fileInfo.isStubFile || (!paramName.startsWith('_') && paramName !== 'metacls')) {
                    this._addError(
                        `Class methods should take a 'cls' parameter`,
                        node.parameters.length > 0 ? node.parameters[0] : node.name);
                }
            }
        } else {
            // The presence of a decorator can change the behavior, so we need
            // to back off from this check if a decorator is present.
            if (node.decorators.length === 0) {
                let paramName = '';
                let firstParamIsSimple = true;
                if (node.parameters.length > 0) {
                    if (node.parameters[0].name) {
                        paramName = node.parameters[0].name.nameToken.value;
                    }

                    if (node.parameters[0].category !== ParameterCategory.Simple) {
                        firstParamIsSimple = false;
                    }
                }

                // Instance methods should have a "self" parameter. We'll exempt parameter
                // names that start with an underscore since those are used in a few
                // cases in the stdlib pyi files.
                if (firstParamIsSimple && paramName !== 'self' && !paramName.startsWith('_')) {
                    // Special-case the ABCMeta.register method in abc.pyi.
                    const isRegisterMethod = this._fileInfo.isStubFile &&
                        paramName === 'cls' &&
                        node.name.nameToken.value === 'register';

                    if (!isRegisterMethod) {
                        this._addError(
                            `Instance methods should take a 'self' parameter`,
                            node.parameters.length > 0 ? node.parameters[0] : node.name);
                    }
                }
            }
        }
    }

    private _handleIfWhileCommon(testExpression: ExpressionNode, ifWhileSuite: SuiteNode,
            elseSuite: SuiteNode | IfNode | undefined, isWhile: boolean) {

        // Determine if the if condition is always true or always false. If so,
        // we can treat either the if or the else clause as unconditional.
        let constExprValue = StaticExpressions.evaluateStaticExpression(
            testExpression, this._fileInfo.executionEnvironment);

        let typeConstraints: ConditionalTypeConstraintResults | undefined;

        // Push a temporary scope so we can track
        // which variables have been assigned to conditionally.
        const ifScope = this._enterTemporaryScope(() => {
            // Get and cache the expression type before walking it. This will apply
            // any type constraints along the way. Note that we do this within the
            // temporary if/while scope because in the while case, the expression type
            // might change from one pass to the next as we analyze the loop.
            const exprType = this._getTypeOfExpression(testExpression);

            // Build the type constraints for the test expression.
            typeConstraints = this._buildConditionalTypeConstraints(testExpression);

            // Handle the case where the expression evaluates to a known
            // true, false or None value.
            if (exprType.category === TypeCategory.Object) {
                const exprClass = exprType.classType;
                if (ClassType.isBuiltIn(exprClass, 'bool')) {
                    const literalValue = exprType.literalValue;
                    if (typeof literalValue === 'boolean') {
                        constExprValue = literalValue;
                    }
                }
            } else if (isNoneOrNever(exprType)) {
                constExprValue = false;
            }

            this.walk(testExpression);

            // Add any applicable type constraints.
            if (typeConstraints) {
                typeConstraints.ifConstraints.forEach(constraint => {
                    this._currentScope.addTypeConstraint(constraint);
                });
            }

            if (constExprValue !== false) {
                this.walk(ifWhileSuite);
            }
        }, constExprValue === undefined, isWhile ? ifWhileSuite : undefined);

        // Now handle the else statement. If there are chained "elif"
        // statements, they'll be handled recursively here.
        const elseScope = this._enterTemporaryScope(() => {
            // Add any applicable type constraints.
            if (typeConstraints) {
                typeConstraints.elseConstraints.forEach(constraint => {
                    this._currentScope.addTypeConstraint(constraint);
                });
            }

            if (elseSuite && constExprValue !== true) {
                this.walk(elseSuite);
            }
        }, constExprValue === undefined);

        let isIfUnconditional = false;
        let isElseUnconditional = false;
        if (constExprValue !== undefined) {
            if (constExprValue) {
                isIfUnconditional = true;
                ifScope.setUnconditional();
                if (elseSuite) {
                    this._addUnusedCode(elseSuite);
                }
            } else {
                isElseUnconditional = true;
                elseScope.setUnconditional();
                this._addUnusedCode(ifWhileSuite);
            }
        }

        const ifContributions = !ifScope.getAlwaysReturnsOrRaises() &&
            !isElseUnconditional ? ifScope : undefined;
        const elseContributions = !elseScope.getAlwaysReturnsOrRaises() &&
            !isIfUnconditional ? elseScope : undefined;

        // Figure out how to combine the scopes.
        if (ifContributions && elseContributions) {
            // If both an "if" and an "else" scope exist, combine the names from both scopes.
            const combinedScope = Scope.combineConditionalScopes(
                [ifContributions, elseContributions]);
            this._mergeToCurrentScope(combinedScope);
        } else if (ifContributions) {
            // If there's only an "if" scope executed, merge its contents.
            ifContributions.setUnconditional();
            this._mergeToCurrentScope(ifContributions);
        } else if (elseContributions) {
            // If there's only an "else" scope executed, merge its contents.
            elseContributions.setUnconditional();
            this._mergeToCurrentScope(elseContributions);
        } else {
            // If both an if and else clause are executed but they both return or
            // raise an exception, mark the current scope as always returning or
            // raising an exception.
            if (ifScope.getAlwaysRaises() && elseScope.getAlwaysRaises()) {
                this._currentScope.setAlwaysRaises();
            } else {
                this._currentScope.setAlwaysReturns();
            }
        }

        if (isIfUnconditional && isWhile && !ifScope.getMayBreak()) {
            // If this is an infinite loop, mark it as always raising
            // So we don't assume that we'll fall through and possibly
            // return None at the end of the function.
            this._currentScope.setAlwaysRaises();
        }

        // Even if the if or else scopes didn't contribute symbols to the
        // current scope, they can contribute return types.
        if (!isElseUnconditional) {
            this._mergeReturnAndYieldTypeToCurrentScope(ifScope);
        }

        if (!isIfUnconditional) {
            this._mergeReturnAndYieldTypeToCurrentScope(elseScope);
        }
    }

    private _findCollectionsImportSymbolTable(): SymbolTable | undefined {
        const collectionResults = Object.keys(this._fileInfo.importMap).find(path => {
            return path.endsWith('collections/__init__.pyi');
        });

        if (collectionResults) {
            const moduleType = this._fileInfo.importMap[collectionResults];
            return moduleType.fields;
        }

        return undefined;
    }

    private _validateYieldType(node: YieldExpressionNode | YieldFromExpressionNode, yieldType: Type) {
        let declaredYieldType: Type | undefined;
        const enclosingFunctionNode = ParseTreeUtils.getEnclosingFunction(node);

        if (enclosingFunctionNode) {
            const functionType = AnalyzerNodeInfo.getExpressionType(
                enclosingFunctionNode) as FunctionType;
            if (functionType) {
                assert(functionType.category === TypeCategory.Function);
                const iteratorType = ScopeUtils.getBuiltInType(this._currentScope, 'Iterator');
                declaredYieldType = TypeUtils.getDeclaredGeneratorYieldType(functionType, iteratorType);
            }
        }

        if (declaredYieldType) {
            if (TypeUtils.isNoReturnType(declaredYieldType)) {
                this._addError(
                    `Function with declared return type 'NoReturn' cannot include a yield statement`,
                    node);
            } else {
                const diagAddendum = new DiagnosticAddendum();
                if (!TypeUtils.canAssignType(declaredYieldType, yieldType, diagAddendum)) {
                    this._addError(
                        `Expression of type '${ printType(yieldType) }' cannot be assigned ` +
                            `to yield type '${ printType(declaredYieldType) }'` + diagAddendum.getString(),
                        node.expression);
                }
            }
        }
    }

    private _validateExceptionType(exceptionType: Type, errorNode: ParseNode) {
        const baseExceptionType = ScopeUtils.getBuiltInType(
            this._currentScope, 'BaseException');

        const derivesFromBaseException = (classType: ClassType) => {
            if (!baseExceptionType || !(baseExceptionType.category === TypeCategory.Class)) {
                return true;
            }

            return TypeUtils.derivesFromClassRecursive(classType, baseExceptionType);
        };

        const diagAddendum = new DiagnosticAddendum();
        let isValidExceptionType = true;
        let resultingExceptionType: Type | undefined;

        if (isAnyOrUnknown(exceptionType)) {
            resultingExceptionType = exceptionType;
        } else if (exceptionType.category === TypeCategory.Class) {
            if (!derivesFromBaseException(exceptionType)) {
                isValidExceptionType = false;
                diagAddendum.addMessage(
                    `'${ printType(exceptionType) }' does not derive from BaseException`);
            }
            resultingExceptionType = ObjectType.create(exceptionType);
        } else if (exceptionType.category === TypeCategory.Object) {
            const evaluator = this._createEvaluator();
            const iterableType = evaluator.getTypeFromIterable(exceptionType, false, errorNode, false);

            resultingExceptionType = TypeUtils.doForSubtypes(iterableType, subtype => {
                if (isAnyOrUnknown(subtype)) {
                    return subtype;
                } else if (subtype.category === TypeCategory.Class) {
                    if (!derivesFromBaseException(subtype)) {
                        isValidExceptionType = false;
                        diagAddendum.addMessage(
                            `'${ printType(exceptionType) }' does not derive from BaseException`);
                    }

                    return ObjectType.create(subtype);
                } else {
                    isValidExceptionType = false;
                    diagAddendum.addMessage(
                        `'${ printType(exceptionType) }' does not derive from BaseException`);
                    return UnknownType.create();
                }
            });
        }

        if (!isValidExceptionType) {
            this._addError(
                `'${ printType(exceptionType) }' is not valid exception class` +
                    diagAddendum.getString(),
                errorNode);
        }

        return resultingExceptionType || UnknownType.create();
    }

    private _addAssignmentTypeConstraint(node: ExpressionNode, assignmentType: Type) {
        // Don't propagate an "unbound" type to the target.
        const typeWithoutUnbound = removeUnboundFromUnion(assignmentType);
        const typeConstraint = TypeConstraintBuilder.buildTypeConstraintForAssignment(
            node, typeWithoutUnbound);

        if (typeConstraint) {
            this._currentScope.addTypeConstraint(typeConstraint);
        }
    }

    // Associates a member variable with a specified type.
    // If typeAnnotationNode is provided, it assumes that the
    // specified type is declared (rather than inferred).
    private _assignTypeToMemberVariable(node: MemberAccessExpressionNode, srcType: Type,
            isInstanceMember: boolean, typeAnnotationNode?: ExpressionNode,
            srcExprNode?: ExpressionNode) {

        const memberName = node.memberName.nameToken.value;
        const isConstant = SymbolNameUtils.isConstantName(memberName);
        const isPrivate = SymbolNameUtils.isPrivateOrProtectedName(memberName);

        // If the member name appears to be a constant, use the strict
        // source type. If it's a member variable that can be overridden
        // by a child class, use the more general version by stripping
        // off the literal.
        if (!isConstant && !isPrivate) {
            srcType = TypeUtils.stripLiteralValue(srcType);
        }

        const classDef = ParseTreeUtils.getEnclosingClass(node);
        if (!classDef) {
            return;
        }

        let destType = srcType;
        let addTypeConstraintForAssignment = true;

        const classType = AnalyzerNodeInfo.getExpressionType(classDef);
        if (classType && classType.category === TypeCategory.Class) {
            let memberInfo = TypeUtils.lookUpClassMember(classType, memberName,
                isInstanceMember ? TypeUtils.ClassMemberLookupFlags.Default :
                    TypeUtils.ClassMemberLookupFlags.SkipInstanceVariables);

            // A local helper function that creates a new declaration.
            const createDeclaration = () => {
                const declaration: Declaration = {
                    category: srcType.category === TypeCategory.Function ?
                        DeclarationCategory.Method : DeclarationCategory.Variable,
                    node: node.memberName,
                    isConstant,
                    path: this._fileInfo.filePath,
                    range: convertOffsetsToRange(node.memberName.start,
                        node.memberName.start + node.memberName.length,
                        this._fileInfo.lines)
                };

                if (typeAnnotationNode) {
                    declaration.declaredType = srcType;
                }

                return declaration;
            };

            const memberFields = ClassType.getFields(classType);
            let addNewMemberToLocalClass = false;
            let inheritedDeclaration: Declaration | undefined;
            if (memberInfo) {
                if (memberInfo.classType.category === TypeCategory.Class &&
                        ClassType.isSameGenericClass(classType, memberInfo.classType) &&
                        memberInfo.isInstanceMember === isInstanceMember) {

                    const symbol = memberFields.get(memberName);
                    assert(symbol !== undefined);

                    // If the type annotation node is provided, use it to generate a source ID.
                    // If an expression contains both a type annotation and an assignment, we want
                    // to generate two sources because the types may different, and the analysis
                    // won't converge if we use the same source ID for both.
                    const sourceId = (typeAnnotationNode || node.memberName).id;
                    if (symbol!.setInferredTypeForSource(srcType, sourceId)) {
                        this._setAnalysisChanged('Class member inferred type changed');
                    }

                    if (srcExprNode) {
                        this._reportPossibleUnknownAssignment(
                            this._fileInfo.diagnosticSettings.reportUnknownMemberType,
                            DiagnosticRule.reportUnknownMemberType,
                            node.memberName, srcType, srcExprNode);
                    }

                    this._addDeclarationToSymbol(symbol!, createDeclaration(), typeAnnotationNode || node);
                    const primaryDecls = TypeUtils.getPrimaryDeclarationsForSymbol(symbol!)!;

                    // Check for an attempt to overwrite a constant member variable.
                    const primaryDecl = primaryDecls ? primaryDecls[0] : undefined;
                    if (primaryDecl && primaryDecl.isConstant && srcExprNode) {
                        if (node.memberName !== primaryDecl.node) {
                            this._addDiagnostic(this._fileInfo.diagnosticSettings.reportConstantRedefinition,
                                DiagnosticRule.reportConstantRedefinition,
                                `'${ node.memberName.nameToken.value }' is constant and cannot be redefined`,
                                node.memberName);
                        }
                    }
                } else {
                    // Is the target a property?
                    const prevDeclarations = memberInfo.symbol.getDeclarations();
                    if (prevDeclarations.length > 0 && prevDeclarations[0].declaredType &&
                            prevDeclarations[0].declaredType.category === TypeCategory.Property) {

                        // Don't add a type constraint because a property getter and
                        // setter are not guaranteed to use the same type.
                        addTypeConstraintForAssignment = false;

                    } else {
                        // Handle the case where there is a class variable defined with the same
                        // name, but there's also now an instance variable introduced. Combine the
                        // type of the class variable with that of the new instance variable.
                        if (!memberInfo.isInstanceMember && isInstanceMember) {
                            if (prevDeclarations.length > 0) {
                                inheritedDeclaration = prevDeclarations.find(decl => !!decl.declaredType);
                            }

                            // The class variable is accessed in this case.
                            this._setSymbolAccessed(memberInfo.symbol);
                            srcType = combineTypes([srcType, memberInfo.symbolType]);
                        }

                        addNewMemberToLocalClass = true;
                    }
                }
            } else {
                // The member name hasn't been seen previously, so add it to the local class.
                addNewMemberToLocalClass = true;
            }

            if (addNewMemberToLocalClass) {
                // Is there an existing symbol in the local class? Perhaps it's a class
                // member but we're adding an instance member. In that case, we'll reuse
                // the existing symbol and simply update its flags and add new
                // declarations to it.
                const existingSymbol = memberFields.get(memberName);
                if (existingSymbol) {
                    if (inheritedDeclaration) {
                        existingSymbol.addDeclaration(inheritedDeclaration);
                    }

                    existingSymbol.addDeclaration(createDeclaration());

                    if (isInstanceMember) {
                        existingSymbol.setIsInstanceMember();
                    } else {
                        existingSymbol.setIsClassMember();
                    }
                } else {
                    const newSymbol = Symbol.createWithType(
                        isInstanceMember ? SymbolFlags.InstanceMember : SymbolFlags.ClassMember,
                        srcType, node.memberName.id);

                    // If this is an instance variable that has a corresponding class variable
                    // with a defined type, it should inherit that declaration (and declared type).
                    if (inheritedDeclaration) {
                        newSymbol.addDeclaration(inheritedDeclaration);
                    }

                    newSymbol.addDeclaration(createDeclaration());
                    setSymbolPreservingAccess(memberFields, memberName, newSymbol);
                }

                this._setAnalysisChanged('Class member added');

                if (srcExprNode) {
                    this._reportPossibleUnknownAssignment(
                        this._fileInfo.diagnosticSettings.reportUnknownMemberType,
                        DiagnosticRule.reportUnknownMemberType,
                        node.memberName, srcType, srcExprNode);
                }
            }

            // Look up the member info again, now that we've potentially added a declared type.
            memberInfo = TypeUtils.lookUpClassMember(classType, memberName,
                TypeUtils.ClassMemberLookupFlags.DeclaredTypesOnly);
            if (memberInfo) {
                const declaredType = TypeUtils.getDeclaredTypeOfSymbol(memberInfo.symbol);
                if (declaredType && !isAnyOrUnknown(declaredType)) {
                    if (declaredType.category === TypeCategory.Function) {
                        // Overwriting an existing method.
                        // TODO - not sure what assumption to make here.
                    } else if (declaredType.category === TypeCategory.Property) {
                        // TODO - need to validate property setter type.
                    } else {
                        const diagAddendum = new DiagnosticAddendum();
                        if (TypeUtils.canAssignType(declaredType, srcType, diagAddendum)) {
                            // Constrain the resulting type to match the declared type.
                            destType = TypeUtils.constrainDeclaredTypeBasedOnAssignedType(destType, srcType);
                        }
                    }
                }
            }
        }

        if (addTypeConstraintForAssignment) {
            this._addAssignmentTypeConstraint(node, destType);
        }
    }

    private _mergeToCurrentScope(scopeToMerge: Scope) {
        this._currentScope.mergeScope(scopeToMerge);
        this._mergeReturnAndYieldTypeToCurrentScope(scopeToMerge);
    }

    private _mergeReturnAndYieldTypeToCurrentScope(scopeToMerge: Scope) {
        if (this._currentScope.mergeReturnType(scopeToMerge)) {
            if (this._currentScope.getType() !== ScopeType.Temporary) {
                this._setAnalysisChanged('Return type changed for scope');
            }
        }

        if (this._currentScope.mergeYieldType(scopeToMerge)) {
            if (this._currentScope.getType() !== ScopeType.Temporary) {
                this._setAnalysisChanged('Yield type changed for scope');
            }
        }

        if (!scopeToMerge.isConditional) {
            if (scopeToMerge.getAlwaysRaises()) {
                this._currentScope.setAlwaysRaises();
            }

            if (scopeToMerge.getAlwaysReturns()) {
                this._currentScope.setAlwaysReturns();
            }
        }
    }

    private _getModuleTypeForImportPath(importResult: ImportResult | undefined,
            path: string): ModuleType | undefined {

        // If the import resolved to a third-party module that has no type stub,
        // we will return an unknown type.
        if (importResult && importResult.importType === ImportType.ThirdParty && !importResult.isStubFile) {
            return undefined;
        }

        if (this._fileInfo.importMap[path]) {
            const moduleType = this._fileInfo.importMap[path];
            if (moduleType) {
                return moduleType;
            }
        } else if (importResult) {
            // There was no module even though the import was resolved. This
            // happens in the case of namespace packages, where an __init__.py
            // is not necessarily present. We'll synthesize a module type in
            // this case.
            const symbolTable = new SymbolTable();
            const moduleType = ModuleType.create(symbolTable);

            // Add the implicit imports.
            importResult.implicitImports.forEach(implicitImport => {
                const implicitModuleType = this._getModuleTypeForImportPath(
                    undefined, implicitImport.path);
                if (implicitModuleType) {
                    setSymbolPreservingAccess(symbolTable, implicitImport.name,
                        Symbol.createWithType(
                            SymbolFlags.ClassMember, implicitModuleType, defaultTypeSourceId));
                }
            });

            return moduleType;
        }

        return undefined;
    }

    private _postponeAnnotationEvaluation() {
        return this._fileInfo.futureImports.get('annotations') !== undefined ||
            this._fileInfo.isStubFile;
    }

    private _getTypeOfAnnotation(node: ExpressionNode): Type {
        const evaluator = this._createEvaluator();
        let evaluatorFlags = EvaluatorFlags.ConvertEllipsisToAny;
        if (this._postponeAnnotationEvaluation()) {
            evaluatorFlags |= EvaluatorFlags.AllowForwardReferences;
        }

        return TypeUtils.convertClassToObject(
            evaluator.getType(node, { method: 'get' }, evaluatorFlags));
    }

    private _getTypeOfExpression(node: ExpressionNode, flags?: EvaluatorFlags, expectedType?: Type): Type {
        const evaluator = this._createEvaluator();

        // If the caller didn't specify the flags, use the defaults.
        if (flags === undefined) {
            flags = EvaluatorFlags.None;
        }
        return evaluator.getType(node, { method: 'get', expectedType }, flags);
    }

    private _evaluateExpressionForAssignment(node: ExpressionNode, type: Type, errorNode: ExpressionNode) {
        const evaluator = this._createEvaluator();
        evaluator.getType(node, { method: 'set', setType: type, setErrorNode: errorNode }, EvaluatorFlags.None);
    }

    private _evaluateExpressionForDeletion(node: ExpressionNode): Type {
        const evaluator = this._createEvaluator();
        return evaluator.getType(node, { method: 'del' }, EvaluatorFlags.None);
    }

    private _readExpressionTypeFromNodeCache(node: ExpressionNode): Type | undefined {
        const cachedVersion = AnalyzerNodeInfo.getExpressionTypeWriteVersion(node);

        if (cachedVersion === this._analysisVersion) {
            const cachedType = AnalyzerNodeInfo.getExpressionType(node);
            assert(cachedType !== undefined);
            AnalyzerNodeInfo.setExpressionTypeReadVersion(node, this._analysisVersion);
            return cachedType;
        }

        return undefined;
    }

    private _updateExpressionTypeForNode(node: ExpressionNode, exprType: Type) {
        const oldType = AnalyzerNodeInfo.getExpressionType(node);
        AnalyzerNodeInfo.setExpressionTypeWriteVersion(node, this._analysisVersion);
        const prevReadVersion = AnalyzerNodeInfo.getExpressionTypeReadVersion(node);

        // Any time this method is called, we're effectively writing to the cache
        // and reading the value immediately, so we need to update the read version
        // as well.
        AnalyzerNodeInfo.setExpressionTypeReadVersion(node, this._analysisVersion);

        if (!oldType || !isTypeSame(oldType, exprType)) {
            let replaceType = true;

            // In rare cases, we can run into a situation where an "unknown"
            // is passed back and forth between two variables, preventing
            // us from ever converging. Detect this rare condition here.
            if (this._analysisVersion > _checkForBeatingUnknownPassCount) {
                if (oldType && exprType.category === TypeCategory.Union) {
                    const simplifiedExprType = removeUnknownFromUnion(exprType);
                    if (isTypeSame(oldType, simplifiedExprType)) {
                        replaceType = false;
                    }
                }
            }

            if (replaceType) {
                // If someone has already accessed this expression cache entry during
                // this pass, we need to perform another pass.
                if (prevReadVersion === this._analysisVersion) {
                    this._setAnalysisChanged('Expression type changed');
                }
                AnalyzerNodeInfo.setExpressionType(node, exprType);
            }
        }
    }

    private _markExpressionAccessed(target: ExpressionNode) {
        if (target.nodeType === ParseNodeType.Name) {
            const nameValue = target.nameToken.value;
            const symbolWithScope = this._currentScope.lookUpSymbolRecursive(nameValue);

            if (symbolWithScope) {
                this._setSymbolAccessed(symbolWithScope.symbol);
            }
        }
    }

    private _assignTypeToExpression(target: ExpressionNode, srcType: Type, srcExpr: ExpressionNode): void {
        if (target.nodeType === ParseNodeType.Name) {
            const name = target.nameToken;
            const declaration: Declaration = {
                category: DeclarationCategory.Variable,
                node: target,
                isConstant: SymbolNameUtils.isConstantName(name.value),
                path: this._fileInfo.filePath,
                range: convertOffsetsToRange(name.start, TextRange.getEnd(name),
                    this._fileInfo.lines)
            };

            // Handle '__all__' as a special case in the module scope.
            if (name.value === '__all__' && this._currentScope.getType() === ScopeType.Module) {
                // It's common for modules to include the expression
                // __all__ = ['a', 'b', 'c']
                // We will mark the symbols referenced by these strings as accessed.
                if (srcExpr.nodeType === ParseNodeType.List) {
                    srcExpr.entries.forEach(entryExpr => {
                        if (entryExpr.nodeType === ParseNodeType.StringList || entryExpr.nodeType === ParseNodeType.String) {
                            const symbolName = entryExpr.nodeType === ParseNodeType.String ?
                                entryExpr.value :
                                entryExpr.strings.map(s => s.value).join('');
                            const symbolInScope = this._currentScope.lookUpSymbolRecursive(symbolName);
                            if (symbolInScope) {
                                this._setSymbolAccessed(symbolInScope.symbol);
                            }
                        }
                    });
                }
            }

            this._reportPossibleUnknownAssignment(
                this._fileInfo.diagnosticSettings.reportUnknownVariableType,
                DiagnosticRule.reportUnknownVariableType,
                target, srcType, srcExpr);

            this._assignTypeToNameNode(target, srcType, declaration, srcExpr);
        } else if (target.nodeType === ParseNodeType.MemberAccess) {
            const targetNode = target.leftExpression;

            // Handle member accesses (e.g. self.x or cls.y).
            if (targetNode.nodeType === ParseNodeType.Name) {
                // Determine whether we're writing to a class or instance member.
                const enclosingClassNode = ParseTreeUtils.getEnclosingClass(target);

                if (enclosingClassNode) {
                    const classType = AnalyzerNodeInfo.getExpressionType(enclosingClassNode);

                    if (classType && classType.category === TypeCategory.Class) {
                        const typeOfLeftExpr = this._getTypeOfExpression(target.leftExpression);
                        if (typeOfLeftExpr.category === TypeCategory.Object) {
                            if (ClassType.isSameGenericClass(typeOfLeftExpr.classType, classType)) {
                                this._assignTypeToMemberVariable(target, srcType, true,
                                    undefined, srcExpr);
                            }
                        } else if (typeOfLeftExpr.category === TypeCategory.Class) {
                            if (ClassType.isSameGenericClass(typeOfLeftExpr, classType)) {
                                this._assignTypeToMemberVariable(target, srcType, false,
                                    undefined, srcExpr);
                            }
                        }
                    }
                }
            }
        } else if (target.nodeType === ParseNodeType.Tuple) {
            // Initialize the array of target types, one for each target.
            const targetTypes: Type[][] = new Array(target.expressions.length);
            for (let i = 0; i < target.expressions.length; i++) {
                targetTypes[i] = [];
            }

            TypeUtils.doForSubtypes(srcType, subtype => {
                // Is this subtype a tuple?
                const tupleType = TypeUtils.getSpecializedTupleType(subtype);
                if (tupleType && ClassType.getTypeArguments(tupleType)) {
                    const entryTypes = ClassType.getTypeArguments(tupleType)!;
                    let entryCount = entryTypes.length;

                    const sourceEndsInEllipsis = entryCount > 0 &&
                        TypeUtils.isEllipsisType(entryTypes[entryCount - 1]);
                    if (sourceEndsInEllipsis) {
                        entryCount--;
                    }

                    const targetEndsWithUnpackOperator = target.expressions.length > 0 &&
                        target.expressions[target.expressions.length - 1].nodeType === ParseNodeType.Unpack;

                    if (targetEndsWithUnpackOperator) {
                        if (entryCount >= target.expressions.length) {
                            for (let index = 0; index < target.expressions.length - 1; index++) {
                                const entryType = index < entryCount ? entryTypes[index] : UnknownType.create();
                                targetTypes[index].push(entryType);
                            }

                            const remainingTypes: Type[] = [];
                            for (let index = target.expressions.length - 1; index < entryCount; index++) {
                                const entryType = entryTypes[index];
                                remainingTypes.push(entryType);
                            }

                            targetTypes[target.expressions.length - 1].push(combineTypes(remainingTypes));
                        } else {
                            this._addError(
                                `Tuple size mismatch: expected at least ${ target.expressions.length } entries` +
                                    ` but got ${ entryCount }`,
                                target);
                        }
                    } else {
                        if (target.expressions.length === entryCount ||
                                (sourceEndsInEllipsis && target.expressions.length >= entryCount)) {

                            for (let index = 0; index < target.expressions.length; index++) {
                                const entryType = index < entryCount ? entryTypes[index] : UnknownType.create();
                                targetTypes[index].push(entryType);
                            }
                        } else {
                            this._addError(
                                `Tuple size mismatch: expected ${ target.expressions.length }` +
                                    ` but got ${ entryCount }`,
                                target);
                        }
                    }
                } else {
                    // The assigned expression isn't a tuple, so it had better
                    // be some iterable type.
                    const evaluator = this._createEvaluator();
                    const iterableType = evaluator.getTypeFromIterable(subtype, false, srcExpr, false);
                    for (let index = 0; index < target.expressions.length; index++) {
                        targetTypes[index].push(iterableType);
                    }
                }

                // We need to return something to satisfy doForSubtypes.
                return undefined;
            });

            target.expressions.forEach((expr, index) => {
                const typeList = targetTypes[index];
                const targetType = typeList.length === 0 ? UnknownType.create() : combineTypes(typeList);
                this._assignTypeToExpression(expr, targetType, srcExpr);
            });
        } else if (target.nodeType === ParseNodeType.TypeAnnotation) {
            const typeHintType = this._getTypeOfAnnotation(target.typeAnnotation);
            const diagAddendum = new DiagnosticAddendum();
            if (TypeUtils.canAssignType(typeHintType, srcType, diagAddendum)) {
                srcType = TypeUtils.constrainDeclaredTypeBasedOnAssignedType(typeHintType, srcType);
            }

            this._assignTypeToExpression(target.valueExpression, srcType, srcExpr);
        } else if (target.nodeType === ParseNodeType.Unpack) {
            if (target.expression.nodeType === ParseNodeType.Name) {
                const name = target.expression.nameToken;
                const declaration: Declaration = {
                    category: DeclarationCategory.Variable,
                    node: target.expression,
                    isConstant: SymbolNameUtils.isConstantName(name.value),
                    path: this._fileInfo.filePath,
                    range: convertOffsetsToRange(name.start, TextRange.getEnd(name),
                        this._fileInfo.lines)
                };

                if (!isAnyOrUnknown(srcType)) {
                    // Make a list type from the source.
                    const listType = ScopeUtils.getBuiltInType(this._currentScope, 'List');
                    if (listType.category === TypeCategory.Class) {
                        srcType = ObjectType.create(ClassType.cloneForSpecialization(listType, [srcType]));
                    } else {
                        srcType = UnknownType.create();
                    }
                }
                this._assignTypeToNameNode(target.expression, srcType, declaration, srcExpr);
            }
        } else if (target.nodeType === ParseNodeType.List) {
            target.entries.forEach(entry => {
                this._assignTypeToExpression(entry, UnknownType.create(), srcExpr);
            });
        }

        // Report any errors with assigning to this type.
        this._evaluateExpressionForAssignment(target, srcType, srcExpr);
    }

    private _bindMultiPartModuleNameToType(nameParts: NameNode[], type: ModuleType,
            declaration?: Declaration): void {

        // The target symbol table will change as we progress through
        // the multi-part name. Start with the current scope's symbol
        // table, which should include the first part of the name.
        const permanentScope = ScopeUtils.getPermanentScope(this._currentScope);
        let targetSymbolTable = permanentScope.getSymbolTable();
        const symbol = Symbol.createWithType(
            SymbolFlags.ClassMember, type, defaultTypeSourceId);
        if (declaration) {
            symbol.addDeclaration(declaration);
        }

        for (let i = 0; i < nameParts.length; i++) {
            const name = nameParts[i].nameToken.value;
            const targetSymbol = targetSymbolTable.get(name);
            let symbolType = targetSymbol ?
                TypeUtils.getEffectiveTypeOfSymbol(targetSymbol) : undefined;

            if (symbolType && symbolType.category === TypeCategory.Module) {
                const moduleFields = symbolType.fields;

                // Are we replacing a partial module?
                if (i === nameParts.length - 1 && symbolType.isPartialModule) {
                    // Combine the names in the existing partial module into
                    // the new module's symbol table.
                    moduleFields.getKeys().forEach(name => {
                        setSymbolPreservingAccess(type.fields, name, moduleFields.get(name)!);
                    });

                    if (!targetSymbolTable.get(name)) {
                        setSymbolPreservingAccess(targetSymbolTable, name, symbol);
                    }

                    symbolType = type;
                }

                targetSymbolTable = moduleFields;
            } else if (i === nameParts.length - 1) {
                setSymbolPreservingAccess(targetSymbolTable, name, symbol);
                symbolType = type;
            } else {
                // Build a "partial module" to contain the references
                // to the next part of the name.
                const newPartialModule = ModuleType.create(new SymbolTable());
                newPartialModule.isPartialModule = true;
                setSymbolPreservingAccess(targetSymbolTable, name,
                    Symbol.createWithType(SymbolFlags.None, newPartialModule, defaultTypeSourceId));
                targetSymbolTable = newPartialModule.fields;
                symbolType = newPartialModule;
            }

            if (i === 0) {
                // Assign the first part of the multi-part name to the current scope.
                this._assignTypeToNameNode(nameParts[0], symbolType);
            }

            // If this is the last element, determine if it's accessed.
            if (i === nameParts.length - 1) {
                // Is this module ever accessed?
                if (targetSymbol && !targetSymbol.isAccessed()) {
                    const multipartName = nameParts.map(np => np.nameToken.value).join('.');
                    const textRange = { start: nameParts[0].start, length: nameParts[0].length };
                    if (nameParts.length > 1) {
                        TextRange.extend(textRange, nameParts[nameParts.length - 1]);
                    }
                    this._fileInfo.diagnosticSink.addUnusedCodeWithTextRange(
                        `'${ multipartName }' is not accessed`, textRange);

                    this._addDiagnostic(this._fileInfo.diagnosticSettings.reportUnusedImport,
                        DiagnosticRule.reportUnusedImport,
                        `Import '${ multipartName }' is not accessed`, textRange);
                }
            }
        }
    }

    private _assignTypeToNameNode(nameNode: NameNode, srcType: Type, declaration?: Declaration,
            srcExpressionNode?: ParseNode) {

        const nameValue = nameNode.nameToken.value;

        // If this is a member name (within a class scope) and the member name
        // appears to be a constant, use the strict source type. If it's a member
        // variable that can be overridden by a child class, use the more general
        // version by stripping off the literal.
        if (ScopeUtils.getPermanentScope(this._currentScope).getType() === ScopeType.Class) {
            const isConstant = SymbolNameUtils.isConstantName(nameValue);
            const isPrivate = SymbolNameUtils.isPrivateOrProtectedName(nameValue);
            if (!isConstant && !isPrivate) {
                srcType = TypeUtils.stripLiteralValue(srcType);
            }
        }

        // Determine if there's a declared type for this symbol.
        let declaredType: Type | undefined = declaration ? declaration.declaredType : undefined;
        let primaryDecl: Declaration | undefined;

        const symbolWithScope = this._currentScope.lookUpSymbolRecursive(nameValue);
        if (symbolWithScope) {
            const primaryDecls = TypeUtils.getPrimaryDeclarationsForSymbol(symbolWithScope.symbol);
            if (primaryDecls) {
                declaredType = primaryDecls[0].declaredType;
                primaryDecl = primaryDecls[0];
            }
        } else {
            // We should never get here.
            assert.fail(`Missing symbol '${ nameValue }'`);
        }

        // We found an existing declared type. Make sure the newly-bound type is assignable.
        let destType = srcType;
        if (declaredType && srcExpressionNode) {
            const diagAddendum = new DiagnosticAddendum();
            if (!TypeUtils.canAssignType(declaredType, srcType, diagAddendum)) {
                this._addError(`Expression of type '${ printType(srcType) }' cannot be ` +
                    `assigned to declared type '${ printType(declaredType) }'` + diagAddendum.getString(),
                    srcExpressionNode || nameNode);
                destType = declaredType;
            } else {
                // Constrain the resulting type to match the declared type.
                destType = TypeUtils.constrainDeclaredTypeBasedOnAssignedType(declaredType, srcType);
            }
        }

        if (primaryDecl && primaryDecl.isConstant && srcExpressionNode) {
            if (nameNode !== primaryDecl.node) {
                this._addDiagnostic(this._fileInfo.diagnosticSettings.reportConstantRedefinition,
                    DiagnosticRule.reportConstantRedefinition,
                    `'${ nameValue }' is constant and cannot be redefined`,
                    nameNode);
            }
        }

        this._addTypeSourceToNameNode(nameNode, destType, declaration);
    }

    private _addTypeSourceToNameNode(node: NameNode, type: Type, declaration?: Declaration) {
        this._addTypeSourceToName(node.nameToken.value, type, node.id, declaration);
        this._addAssignmentTypeConstraint(node, type);
    }

    // Finds the nearest permanent scope (as opposed to temporary scope) and
    // adds a new symbol with the specified name if it doesn't already exist.
    private _addSymbolToPermanentScope(name: string) {
        const permanentScope = ScopeUtils.getPermanentScope(this._currentScope);
        assert(permanentScope.getType() !== ScopeType.Temporary);

        let symbol = permanentScope.lookUpSymbol(name);
        if (!symbol) {
            symbol = permanentScope.addSymbol(name, SymbolFlags.ClassMember);
        }

        // Variables that are defined within a module or a class
        // are considered public by default. Don't flag them
        // "not access" unless the name indicates that it's private.
        const scopeType = permanentScope.getType();
        if (scopeType === ScopeType.Class || scopeType === ScopeType.Module) {
            if (!this._isSymbolPrivate(name, scopeType)) {
                this._setSymbolAccessed(symbol);
            }
        }
    }

    private _addTypeSourceToName(name: string, type: Type, typeSourceId: TypeSourceId,
            declaration?: Declaration) {

        const symbolWithScope = this._currentScope.lookUpSymbolRecursive(name);
        if (symbolWithScope) {
            if (!symbolWithScope.isOutsideCallerModule) {
                if (symbolWithScope.symbol.setInferredTypeForSource(type, typeSourceId)) {
                    if (symbolWithScope.scope.getType() !== ScopeType.Temporary) {
                        this._setAnalysisChanged('Inferred type of name changed');
                    }
                }

                // Add the declaration if provided.
                if (declaration) {
                    symbolWithScope.symbol.addDeclaration(declaration);
                }
            }
        } else {
            // We should never get here!
            assert.fail(`Missing symbol '${ name }'`);
        }
    }

    private _transformTypeForPossibleEnumClass(node: NameNode, typeOfExpr: Type): Type {
        const enumClass = this._getEnclosingEnumClassInfo(node);

        if (enumClass) {
            // The type of each enumerated item is an instance of the enum class.
            return ObjectType.create(enumClass);
        }

        return typeOfExpr;
    }

    // If the node is within a class that derives from the metaclass
    // "EnumMeta", we need to treat assignments differently.
    private _getEnclosingEnumClassInfo(node: ParseNode): ClassType | undefined {
        const enclosingClassNode = ParseTreeUtils.getEnclosingClass(node, true);
        if (enclosingClassNode) {
            const enumClass = AnalyzerNodeInfo.getExpressionType(enclosingClassNode) as ClassType;
            assert(enumClass.category === TypeCategory.Class);

            // Handle several built-in classes specially. We don't
            // want to interpret their class variables as enumerations.
            if (this._fileInfo.isStubFile) {
                const className = ClassType.getClassName(enumClass);
                const builtInEnumClasses = ['Enum', 'IntEnum', 'Flag', 'IntFlag'];
                if (builtInEnumClasses.find(c => c === className)) {
                    return undefined;
                }
            }

            if (TypeUtils.isEnumClass(enumClass)) {
                return enumClass;
            }
        }

        return undefined;
    }

    private _buildConditionalTypeConstraints(node: ExpressionNode) {
        return TypeConstraintBuilder.buildTypeConstraintsForConditional(node,
            (node: ExpressionNode) => this._getTypeOfExpression(node));
    }

    // Create a temporary scope that can track values of modified variables
    // within that scope.
    // If loopNode is specified, the scope is also persisted to that node
    // so the analyzer to take into account type information that is gathered
    // lower in the loop body.
    private _enterTemporaryScope(callback: () => void, isConditional = false,
            loopNode?: ParseNode) {

        let tempScope: Scope | undefined;

        if (loopNode) {
            // Was the scope persisted during the last analysis pass?
            tempScope = AnalyzerNodeInfo.getScope(loopNode);

            if (tempScope) {
                tempScope.setParent(this._currentScope);
                tempScope.clearAlwaysRaises();
                tempScope.clearAlwaysReturns();
                tempScope.clearBreaks();
            } else {
                tempScope = new Scope(ScopeType.Temporary, this._currentScope);

                // Mark the new scope as looping so we track any breaks within the scope.
                tempScope.setIsLooping();
                AnalyzerNodeInfo.setScope(loopNode, tempScope);
            }

            // If we previously analyzed this loop, determine whether we should
            // keep the existing type constraints or start from scratch.
            if (this._didAnalysisChange) {
                // The analysis changed prior to getting to the loop. We need
                // to reset the type constraints in the loop to prevent an
                // "Unknown" value from persisting in the loop.
                tempScope.clearTypeConstraints();
            } else {
                // Capture the type constraints that represent all of the ways
                // we continued within the loop during the previous analysis pass.
                // Mark these as conditional and use them for the initial
                // (top-of-loop) type constraints.
                const continueTypeConstraints = tempScope.combineContinueTypeConstraints();
                tempScope.clearTypeConstraints();
                tempScope.setTypeConstraints(continueTypeConstraints);
            }
        } else {
            tempScope = new Scope(ScopeType.Temporary, this._currentScope);
        }

        const prevScope = this._currentScope;
        if (isConditional) {
            tempScope.setConditional();
        }

        this._currentScope = tempScope;
        callback();

        if (loopNode) {
            // The bottom of the loop is an implicit conditional break
            // if the test at the top of the loop is conditional.
            if (isConditional) {
                tempScope.snapshotTypeConstraintsForBreak();
            }

            // The bottom of the loop is always an implicit continue.
            tempScope.snapshotTypeConstraintsForContinue();

            // Replace the current type constraints with a combination of
            // the "break" constraints for the loop. This is what will be
            // "seen" by the parent scope.
            const breakTypeConstraints = tempScope.combineBreakTypeConstraints();
            tempScope.setTypeConstraints(breakTypeConstraints);
        }

        this._currentScope = prevScope;

        // Unset the parent to allow any other temporary scopes in the
        // chain to be deallocated.
        tempScope.setParent(undefined);

        return tempScope;
    }

    private _enterScope(node: ParseNode, callback: () => void): Scope {
        const prevScope = this._currentScope;
        const newScope = AnalyzerNodeInfo.getScope(node);
        assert(newScope !== undefined);

        // Clear the defaultValueInitializerExpression because we want
        // to allow calls within lambdas that are used to initialize
        // parameters.
        const wasDefaultValueInitializer = this._defaultValueInitializerExpression;
        this._defaultValueInitializerExpression = false;

        let prevParent: Scope | undefined;
        if (!newScope!.isIndependentlyExecutable()) {
            // Temporary re-parent the scope in case it is contained
            // within a temporary scope.
            prevParent = newScope!.getParent();
            newScope!.setParent(this._currentScope);
        }

        this._currentScope = newScope!;

        // Clear the raises/returns flags in case this wasn't our
        // first time analyzing this scope.
        this._currentScope.clearAlwaysRaises();
        this._currentScope.clearAlwaysReturns();
        this._currentScope.clearBreaks();

        callback();

        // Clear out any type constraints that were collected
        // during the processing of the scope.
        this._currentScope.clearTypeConstraints();

        this._currentScope = prevScope;
        if (prevParent) {
            newScope!.setParent(prevParent);
        }

        this._defaultValueInitializerExpression = wasDefaultValueInitializer;

        return newScope!;
    }

    private _addWarning(message: string, range: TextRange) {
        return this._fileInfo.diagnosticSink.addWarningWithTextRange(message, range);
    }

    private _addError(message: string, textRange: TextRange) {
        return this._fileInfo.diagnosticSink.addErrorWithTextRange(message, textRange);
    }

    private _addUnusedCode(textRange: TextRange) {
        return this._fileInfo.diagnosticSink.addUnusedCodeWithTextRange('Code is unreachable', textRange);
    }

    private _addUnusedName(nameNode: NameNode) {
        return this._fileInfo.diagnosticSink.addUnusedCodeWithTextRange(
            `'${ nameNode.nameToken.value }' is not accessed`, nameNode);
    }

    private _addDiagnostic(diagLevel: DiagnosticLevel, rule: string, message: string, textRange: TextRange) {
        let diagnostic: Diagnostic | undefined;

        if (diagLevel === 'error') {
            diagnostic = this._addError(message, textRange);
        } else if (diagLevel === 'warning') {
            diagnostic = this._addWarning(message, textRange);
        }

        if (diagnostic) {
            diagnostic.setRule(rule);
        }

        return diagnostic;
    }

    private _createEvaluator() {
        return new ExpressionEvaluator(this._currentScope,
            this._fileInfo, this._fileInfo.diagnosticSink, node => this._readExpressionTypeFromNodeCache(node),
            (node, type) => {
                this._updateExpressionTypeForNode(node, type);
            },
            symbol => {
                this._setSymbolAccessed(symbol);
            });
    }

    private _setSymbolAccessed(symbol: Symbol) {
        if (!symbol.isAccessed()) {
            this._setAnalysisChanged('Symbol accessed flag set');
            symbol.setIsAccessed();
        }
    }

    private _setAnalysisChanged(reason: string) {
        this._didAnalysisChange = true;
        this._lastAnalysisChangeReason = reason;
    }
}
