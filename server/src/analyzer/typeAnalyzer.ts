/*
* typeAnalyzer.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* A parse tree walker that performs static type checking. It assumes
* that the semanticAnalyzer has already run and added information to
* the parse nodes.
*/

import * as assert from 'assert';

import { DiagnosticLevel } from '../common/configOptions';
import { DiagnosticAddendum } from '../common/diagnostic';
import { convertOffsetsToRange } from '../common/positionUtils';
import { PythonVersion } from '../common/pythonVersion';
import { TextRange } from '../common/textRange';
import { AssertNode, AssignmentNode, AugmentedAssignmentExpressionNode,
    BinaryExpressionNode, BreakNode, CallExpressionNode, ClassNode, ConstantNode,
    ContinueNode, DecoratorNode, DelNode, ErrorExpressionNode, ExceptNode, ExpressionNode,
    FormatStringNode, ForNode, FunctionNode, IfNode, ImportAsNode,
    ImportFromNode, IndexExpressionNode, LambdaNode, ListComprehensionForNode,
    ListComprehensionNode, ListNode, MemberAccessExpressionNode, ModuleNode, NameNode,
    ParameterCategory, ParseNode, RaiseNode, ReturnNode, SliceExpressionNode,
    StringListNode, StringNode, SuiteNode, TernaryExpressionNode, TryNode,
    TupleExpressionNode, TypeAnnotationExpressionNode, UnaryExpressionNode,
    UnpackExpressionNode, WhileNode, WithNode, YieldExpressionNode, YieldFromExpressionNode } from '../parser/parseNodes';
import { KeywordType } from '../parser/tokenizerTypes';
import { ScopeUtils } from '../scopeUtils';
import { AnalyzerFileInfo } from './analyzerFileInfo';
import { AnalyzerNodeInfo } from './analyzerNodeInfo';
import { Declaration, DeclarationCategory } from './declaration';
import { EvaluatorFlags, ExpressionEvaluator } from './expressionEvaluator';
import { ExpressionUtils } from './expressionUtils';
import { ImportResult, ImportType } from './importResult';
import { DefaultTypeSourceId, TypeSourceId } from './inferredType';
import { ParseTreeUtils } from './parseTreeUtils';
import { ParseTreeWalker } from './parseTreeWalker';
import { Scope, ScopeType } from './scope';
import { Symbol, SymbolTable } from './symbol';
import { SymbolUtils } from './symbolUtils';
import { TypeConstraintBuilder } from './typeConstraint';
import { TypeConstraintUtils } from './typeConstraintUtils';
import { AnyType, ClassType, ClassTypeFlags, FunctionParameter, FunctionType,
    FunctionTypeFlags, ModuleType, NeverType, NoneType,
    ObjectType, OverloadedFunctionType, PropertyType, Type,
    TypeVarType, UnboundType, UnionType, UnknownType } from './types';
import { ClassMemberLookupFlags, TypeUtils } from './typeUtils';

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
const MaxAnalysisPassCount = 25;

// There are rare circumstances where we can get into a "beating
// pattern" where one variable is assigned to another in one pass
// and the second assigned to the first in the second pass and
// they both contain an "unknown" in their union. In this case,
// we will never converge. Look for this particular case after
// several analysis passes.
const CheckForBeatingUnknownPassCount = 16;

export class TypeAnalyzer extends ParseTreeWalker {
    private readonly _moduleNode: ModuleNode;
    private readonly _fileInfo: AnalyzerFileInfo;
    private _currentScope: Scope;
    private _defaultValueInitializerExpression = false;

    // Indicates where there was a change in the type analysis
    // the last time analyze() was called. Callers should repeatedly
    // call analyze() until this returns false.
    private _didAnalysisChange: boolean;

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

        let declaration: Declaration = {
            category: DeclarationCategory.Module,
            node: this._moduleNode,
            path: this._fileInfo.filePath,
            range: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } }
        };

        AnalyzerNodeInfo.setDeclarations(this._moduleNode, [declaration]);

        this.walk(this._moduleNode);

        // Clear out any type constraints that were collected
        // during the processing of the scope.
        this._currentScope.clearTypeConstraints();

        // If we've already analyzed the file the max number of times,
        // just give up and admit defeat. This should happen only in
        // the case of analyzer bugs.
        if (this._analysisVersion >= MaxAnalysisPassCount) {
            this._fileInfo.console.log(
                `Hit max analysis pass count for ${ this._fileInfo.filePath }`);
            return false;
        }

        return this._didAnalysisChange;
    }

    visitClass(node: ClassNode): boolean {
        // We should have already resolved most of the base class
        // parameters in the semantic analyzer, but if these parameters
        // are variables, they may not have been resolved at that time.
        let classType = AnalyzerNodeInfo.getExpressionType(node) as ClassType;
        assert(classType instanceof ClassType);

        // Keep a list of unique type parameters that are used in the
        // base class arguments.
        let typeParameters: TypeVarType[] = [];

        node.arguments.forEach((arg, index) => {
            // Ignore keyword parameters other than metaclass.
            if (!arg.name || arg.name.nameToken.value === 'metaclass') {
                let argType = this._getTypeOfExpression(arg.valueExpression);

                // In some stub files, classes are conditionally defined (e.g. based
                // on platform type). We'll assume that the conditional logic is correct
                // and strip off the "unbound" union.
                if (argType instanceof UnionType) {
                    argType = TypeUtils.removeUnboundFromUnion(argType);
                }

                if (!argType.isAny()) {
                    if (!(argType instanceof ClassType)) {
                        let reportBaseClassError = true;

                        // See if this is a "Type[X]" object.
                        if (argType instanceof ObjectType) {
                            const classType = argType.getClassType();
                            if (classType.isBuiltIn() && classType.getClassName() === 'Type') {
                                const typeArgs = classType.getTypeArguments();
                                if (typeArgs && typeArgs.length >= 0) {
                                    argType = typeArgs[0];
                                    if (argType instanceof ObjectType) {
                                        argType = argType.getClassType();
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

                if (argType instanceof ClassType) {
                    if (argType.isBuiltIn() && argType.getClassName() === 'Protocol') {
                        if (!this._fileInfo.isStubFile && this._fileInfo.executionEnvironment.pythonVersion < PythonVersion.V37) {
                            this._addError(`Use of 'Protocol' requires Python 3.7 or newer`, arg.valueExpression);
                        }
                    }

                    // If the class directly derives from NamedTuple (in Python 3.6 or
                    // newer), it's considered a dataclass.
                    if (this._fileInfo.executionEnvironment.pythonVersion >= PythonVersion.V36) {
                        if (argType.isBuiltIn() && argType.getClassName() === 'NamedTuple') {
                            classType.setIsDataClass(false);
                        }
                    }

                    // Validate that the class isn't deriving from itself, creating a
                    // circular dependency.
                    if (TypeUtils.derivesFromClassRecursive(argType, classType)) {
                        this._addError(`Class cannot derive from itself`, arg);
                        argType = UnknownType.create();
                    }
                }

                if (argType instanceof UnknownType ||
                        argType instanceof UnionType && argType.getTypes().some(t => t instanceof UnknownType)) {

                    this._addDiagnostic(
                        this._fileInfo.diagnosticSettings.reportUntypedBaseClass,
                        `Base class type is unknown, obscuring type of derived class`,
                        arg);
                }

                if (classType.updateBaseClassType(index, argType)) {
                    this._setAnalysisChanged();
                }

                // TODO - validate that we are not adding type parameters that
                // are unique type vars but have conflicting names.
                TypeUtils.addTypeVarsToListIfUnique(typeParameters,
                    TypeUtils.getTypeVarArgumentsRecursive(argType));
            }
        });

        // Update the type parameters for the class.
        if (classType.setTypeParameters(typeParameters)) {
            this._setAnalysisChanged();
        }

        this._enterScope(node, () => {
            this.walk(node.suite);
        });

        let decoratedType: Type = classType;
        let foundUnknown = decoratedType instanceof UnknownType;

        for (let i = node.decorators.length - 1; i >= 0; i--) {
            const decorator = node.decorators[i];

            decoratedType = this._applyClassDecorator(decoratedType,
                classType, decorator);
            if (decoratedType instanceof UnknownType) {
                // Report this error only on the first unknown type.
                if (!foundUnknown) {
                    this._addDiagnostic(
                        this._fileInfo.diagnosticSettings.reportUntypedClassDecorator,
                        `Untyped class declarator obscures type of class`,
                        node.decorators[i].leftExpression);

                    foundUnknown = true;
                }
            }
        }

        if (classType.isDataClass()) {
            const evaluator = this._createEvaluator();

            let skipSynthesizedInit = classType.isSkipSynthesizedInit();
            if (!skipSynthesizedInit) {
                // See if there's already a non-synthesized __init__ method.
                // We shouldn't override it.
                const initSymbol = TypeUtils.lookUpClassMember(classType, '__init__',
                    ClassMemberLookupFlags.SkipBaseClasses);
                if (initSymbol) {
                    if (initSymbol.symbolType instanceof FunctionType) {
                        if (!initSymbol.symbolType.isSynthesizedMethod()) {
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
            range: convertOffsetsToRange(node.name.start, node.name.end, this._fileInfo.lines)
        };

        this._assignTypeToNameNode(node.name, decoratedType, declaration);

        this._validateClassMethods(classType);
        this._updateExpressionTypeForNode(node.name, classType);

        this.walkMultiple(node.decorators);
        this.walkMultiple(node.arguments);

        this._conditionallyReportUnusedName(node.name, true,
            this._fileInfo.diagnosticSettings.reportUnusedClass,
            `Class '${ node.name.nameToken.value }' is not accessed`);

        return false;
    }

    visitFunction(node: FunctionNode): boolean {
        // Retrieve the containing class node if the function is a method.
        const containingClassNode = ParseTreeUtils.getEnclosingClass(node, true);
        const containingClassType = containingClassNode ?
            AnalyzerNodeInfo.getExpressionType(containingClassNode) as ClassType : undefined;

        const functionType = AnalyzerNodeInfo.getExpressionType(node) as FunctionType;
        assert(functionType instanceof FunctionType);

        if (this._fileInfo.isBuiltInStubFile || this._fileInfo.isTypingStubFile) {
            // Stash away the name of the function since we need to handle
            // 'namedtuple', 'abstractmethod', 'dataclass' and 'NewType'
            // specially.
            functionType.setBuiltInName(node.name.nameToken.value);
        }

        let asyncType = functionType;
        if (node.isAsync) {
            asyncType = this._createAwaitableFunction(functionType);
        }

        // Apply all of the decorators in reverse order.
        let decoratedType: Type = asyncType;
        let foundUnknown = decoratedType instanceof UnknownType;
        for (let i = node.decorators.length - 1; i >= 0; i--) {
            const decorator = node.decorators[i];

            decoratedType = this._applyFunctionDecorator(decoratedType,
                functionType, decorator, node);
            if (decoratedType instanceof UnknownType) {
                // Report this error only on the first unknown type.
                if (!foundUnknown) {
                    this._addDiagnostic(
                        this._fileInfo.diagnosticSettings.reportUntypedFunctionDecorator,
                        `Untyped function declarator obscures type of function`,
                        node.decorators[i].leftExpression);

                    foundUnknown = true;
                }
            }
        }

        // Mark the class as abstract if it contains at least one abstract method.
        if (functionType.isAbstractMethod() && containingClassType) {
            containingClassType.setIsAbstractClass();
        }

        if (containingClassNode) {
            if (!functionType.isClassMethod() && !functionType.isStaticMethod()) {
                // Mark the function as an instance method.
                functionType.setIsInstanceMethod();

                // If there's a separate async version, mark it as an instance
                // method as well.
                if (functionType !== asyncType) {
                    asyncType.setIsInstanceMethod();
                }
            }
        }

        node.parameters.forEach((param, index) => {
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

                // PEP 484 indicates that if a parameter has a default value of 'None'
                // the type checker should assume that the type is optional (i.e. a union
                // of the specified type and 'None').
                if (!this._fileInfo.diagnosticSettings.strictParameterNoneValue) {
                    if (param.defaultValue instanceof ConstantNode) {
                        if (param.defaultValue.token.keywordType === KeywordType.None) {
                            annotatedType = TypeUtils.combineTypes(
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
                        this._addError(
                            `Value of type '${ defaultValueType.asString() }' cannot` +
                                ` be assiged to parameter of type '${ annotatedType.asString() }'` +
                                diagAddendum.getString(),
                            param.defaultValue);
                    }
                }

                if (functionType.setParameterType(index, annotatedType)) {
                    this._setAnalysisChanged();
                }

                this.walk(param.typeAnnotation);
            } else if (index === 0 && (
                    functionType.isInstanceMethod() ||
                    functionType.isClassMethod() ||
                    functionType.isConstructorMethod())) {

                // Specify type of "self" or "cls" parameter for instance or class methods
                // if the type is not explicitly provided.
                if (containingClassType) {
                    const paramType = functionType.getParameters()[0].type;

                    if (paramType instanceof UnknownType) {
                        // Don't specialize the "self" for protocol classes because type
                        // comparisons will fail during structural typing analysis.
                        if (containingClassType && !containingClassType.isProtocol()) {
                            if (functionType.isInstanceMethod()) {
                                const specializedClassType = TypeUtils.selfSpecializeClassType(
                                    containingClassType);
                                if (functionType.setParameterType(index, new ObjectType(specializedClassType))) {
                                    this._setAnalysisChanged();
                                }
                            } else if (functionType.isClassMethod() || functionType.isConstructorMethod()) {
                                // For class methods, the cls parameter is allowed to skip the
                                // abstract class test because the caller is possibly passing
                                // in a non-abstract subclass.
                                const specializedClassType = TypeUtils.selfSpecializeClassType(
                                    containingClassType, true);
                                if (functionType.setParameterType(index, specializedClassType)) {
                                    this._setAnalysisChanged();
                                }
                            }
                        }
                    }
                }
            } else {
                // There is no annotation, and we can't infer the type.
                if (param.name) {
                    this._addDiagnostic(this._fileInfo.diagnosticSettings.reportUnknownParameterType,
                        `Type of '${ param.name.nameToken.value }' is unknown`,
                        param.name);
                }
            }
        });

        if (node.returnTypeAnnotation) {
            const returnType = this._getTypeOfAnnotation(node.returnTypeAnnotation);
            if (functionType.setDeclaredReturnType(returnType)) {
                this._setAnalysisChanged();
            }

            this.walk(node.returnTypeAnnotation);
        } else {
            let inferredReturnType: Type = UnknownType.create();

            if (this._fileInfo.isStubFile) {
                // If a return type annotation is missing in a stub file, assume
                // it's an "unknown" type. In normal source files, we can infer the
                // type from the implementation.
                functionType.setDeclaredReturnType(inferredReturnType);
            } else {
                inferredReturnType = functionType.getInferredReturnType().getType();
            }

            // Include Any in this check. If "Any" really is desired, it should
            // be made explicit through a type annotation.
            if (inferredReturnType.isAny()) {
                this._addDiagnostic(this._fileInfo.diagnosticSettings.reportUnknownParameterType,
                    `Inferred return type is unknown`, node.name);
            } else if (TypeUtils.containsUnknown(inferredReturnType)) {
                this._addDiagnostic(this._fileInfo.diagnosticSettings.reportUnknownParameterType,
                    `Return type '${ inferredReturnType.asString() }' is partially unknown`,
                    node.name);
            }
        }

        const functionScope = this._enterScope(node, () => {
            const parameters = functionType.getParameters();
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
                        range: convertOffsetsToRange(paramNode.start, paramNode.end, this._fileInfo.lines),
                        declaredType: specializedParamType
                    };
                    assert(paramNode !== undefined && paramNode.name !== undefined);

                    // If the type contains type variables, specialize them now
                    // so we convert them to a concrete type (or unknown if there
                    // is no bound or contraint).
                    const variadicParamType = this._getVariadicParamType(param.category, specializedParamType);
                    this._addTypeSourceToNameNode(paramNode.name, variadicParamType, declaration);

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

        const declaration: Declaration = {
            category: containingClassNode ? DeclarationCategory.Method : DeclarationCategory.Function,
            node: node.name,
            path: this._fileInfo.filePath,
            range: convertOffsetsToRange(node.name.start, node.name.end, this._fileInfo.lines),
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
            `Function '${ node.name.nameToken.value }' is not accessed`);

        return false;
    }

    visitLambda(node: LambdaNode): boolean {
        const functionType = new FunctionType(FunctionTypeFlags.None);

        this._enterScope(node, () => {
            node.parameters.forEach(param => {
                if (param.name) {
                    // Set the declaration on the node for the definition provider.
                    const symbol = this._currentScope.lookUpSymbol(param.name.nameToken.value);
                    if (symbol && symbol.hasDeclarations()) {
                        AnalyzerNodeInfo.setDeclarations(param.name, symbol.getDeclarations());
                    }

                    let declaration: Declaration | undefined;
                    declaration = {
                        category: DeclarationCategory.Parameter,
                        node: param,
                        path: this._fileInfo.filePath,
                        range: convertOffsetsToRange(param.start, param.end, this._fileInfo.lines)
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
                functionType.addParameter(functionParam);
            });

            // Infer the return type.
            const returnType = this._getTypeOfExpression(node.expression);
            functionType.getInferredReturnType().addSource(
                returnType, AnalyzerNodeInfo.getTypeSourceId(node.expression));

            this.walkChildren(node.expression);
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
        this._enterTemporaryScope(() => {
            node.comprehensions.forEach(compr => {
                if (compr instanceof ListComprehensionForNode) {
                    this.walk(compr.iterableExpression);

                    const iteratorType = this._getTypeOfExpression(compr.iterableExpression);
                    const evaluator = this._createEvaluator();

                    // Pass undefined for the error node so we don't report
                    // errors. We assume here that the expression has already
                    // been evaluated and errors reported, and we don't want
                    // them to be reported twice.
                    const iteratedType = evaluator.getTypeFromIterable(
                        iteratorType, !!compr.isAsync, undefined, false);

                    this._addNamedTargetToCurrentScope(compr.targetExpression);
                    this._assignTypeToExpression(compr.targetExpression, iteratedType, compr.iterableExpression);
                    this.walk(compr.targetExpression);
                } else {
                    this.walk(compr.testExpression);
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
                    `Object of type 'None' cannot be used with 'with'`,
                    item.expression);
                exprType = TypeUtils.removeNoneFromUnion(exprType);
            }

            const enterMethodName = node.isAsync ? '__aenter__' : '__enter__';

            const scopedType = TypeUtils.doForSubtypes(exprType, subtype => {
                if (subtype.isAny()) {
                    return subtype;
                }

                if (subtype instanceof ObjectType) {
                    let evaluator = this._createEvaluator();
                    let memberType = evaluator.getTypeFromObjectMember(item.expression,
                        subtype, enterMethodName, { method: 'get' });

                    if (memberType) {
                        let memberReturnType: Type;
                        if (memberType instanceof FunctionType) {
                            memberReturnType = memberType.getEffectiveReturnType();
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

                this._addError(`Type ${ subtype.asString() } cannot be used ` +
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

        let enclosingFunctionNode = ParseTreeUtils.getEnclosingFunction(node);
        if (enclosingFunctionNode) {
            let functionType = AnalyzerNodeInfo.getExpressionType(
                enclosingFunctionNode) as FunctionType;

            if (functionType) {
                assert(functionType instanceof FunctionType);

                if (functionType.isGenerator()) {
                    declaredReturnType = TypeUtils.getDeclaredGeneratorReturnType(functionType);
                } else {
                    declaredReturnType = functionType.getDeclaredReturnType();
                }

                // Ignore this check for abstract methods, which often
                // don't actually return any value.
                if (functionType.isAbstractMethod()) {
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

        let typeSourceId = AnalyzerNodeInfo.getTypeSourceId(node);
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
                        `Expression of type '${ returnType.asString() }' cannot be assigned ` +
                            `to return type '${ specializedDeclaredType.asString() }'` +
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
        const typeSourceId = AnalyzerNodeInfo.getTypeSourceId(node.expression);
        this._currentScope.getYieldType().addSource(yieldType, typeSourceId);

        // Wrap the yield type in an Iterator.
        const iteratorType = ScopeUtils.getBuiltInType(this._currentScope, 'Iterator');
        if (iteratorType instanceof ClassType) {
            yieldType = new ObjectType(iteratorType.cloneForSpecialization([yieldType]));
        } else {
            yieldType = UnknownType.create();
        }

        this._validateYieldType(node, yieldType);

        return true;
    }

    visitYieldFrom(node: YieldFromExpressionNode) {
        let yieldType = this._getTypeOfExpression(node.expression);
        let typeSourceId = AnalyzerNodeInfo.getTypeSourceId(node.expression);
        this._currentScope.getYieldType().addSource(yieldType, typeSourceId);

        this._validateYieldType(node, yieldType);

        return true;
    }

    visitContinue(node: ContinueNode): boolean {
        // For purposes of analysis, treat a continue as if it's a return.
        if (!this._currentScope.getAlwaysRaises()) {
            this._currentScope.setAlwaysReturns();
        }
        return true;
    }

    visitBreak(node: BreakNode): boolean {
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
            if (baseExceptionType && baseExceptionType instanceof ClassType) {
                const diagAddendum = new DiagnosticAddendum();

                TypeUtils.doForSubtypes(exceptionType, subtype => {
                    if (!subtype.isAny()) {
                        if (subtype instanceof ClassType) {
                            if (!TypeUtils.derivesFromClassRecursive(subtype, baseExceptionType)) {
                                diagAddendum.addMessage(`'${ subtype.asString() }' does not derive from BaseException`);
                            }
                        } else if (subtype instanceof ObjectType) {
                            if (!TypeUtils.derivesFromClassRecursive(subtype.getClassType(), baseExceptionType)) {
                                diagAddendum.addMessage(`'${ subtype.asString() }' does not derive from BaseException`);
                            }
                        } else {
                            diagAddendum.addMessage(`'${ subtype.asString() }' does not derive from BaseException`);
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
            if (baseExceptionType && baseExceptionType instanceof ClassType) {
                const diagAddendum = new DiagnosticAddendum();

                TypeUtils.doForSubtypes(exceptionType, subtype => {
                    if (!subtype.isAny() && !(subtype instanceof NoneType)) {
                        if (subtype instanceof ObjectType) {
                            if (!TypeUtils.derivesFromClassRecursive(subtype.getClassType(), baseExceptionType)) {
                                diagAddendum.addMessage(`'${ subtype.asString() }' does not derive from BaseException`);
                            }
                        } else {
                            diagAddendum.addMessage(`'${ subtype.asString() }' does not derive from BaseException`);
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
                // If more than one type was specified for the exception, we'll receive
                // a specialized tuple object here.
                const tupleType = TypeUtils.getSpecializedTupleType(exceptionType);
                if (tupleType && tupleType.getTypeArguments()) {
                    const entryTypes = tupleType.getTypeArguments()!.map(t => {
                        return this._validateExceptionType(t, node.typeExpression!);
                    });
                    exceptionType = TypeUtils.combineTypes(entryTypes);
                } else if (exceptionType instanceof ClassType) {
                    exceptionType = this._validateExceptionType(
                        exceptionType, node.typeExpression);
                }

                let declaration: Declaration = {
                    category: DeclarationCategory.Variable,
                    node: node.name,
                    path: this._fileInfo.filePath,
                    range: convertOffsetsToRange(node.name.start, node.name.end, this._fileInfo.lines)
                };
                this._addNamedTargetToCurrentScope(node.name);
                this._assignTypeToNameNode(node.name, exceptionType, declaration);
                this._updateExpressionTypeForNode(node.name, exceptionType);
            }
        }

        return true;
    }

    visitTry(node: TryNode): boolean {
        let conditionalScopesToMerge: Scope[] = [];

        const tryScope = this._enterTemporaryScope(() => {
            this.walk(node.trySuite);
        });

        let allPathsRaise = tryScope.getAlwaysRaises();
        let allPathsRaiseOrReturn = tryScope.getAlwaysReturnsOrRaises();

        // Clear the "always raises" and "always returns" flags for the try block
        // because it may raise an exception before hitting these statements
        // and cause code execution to resume within an except clause.
        tryScope.clearAlwaysRaises();
        tryScope.clearAlwaysReturns();

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

        // Evaluate the type of the right-hand side.
        // An assignment of ellipsis means "Any" within a type stub file.
        let srcType = this._getTypeOfExpression(node.rightExpression,
            this._fileInfo.isStubFile ? EvaluatorFlags.ConvertEllipsisToAny : undefined);

        // Determine if the RHS is a constant boolean expression.
        // If so, assign it a literal type.
        const constExprValue = ExpressionUtils.evaluateConstantExpression(node.rightExpression,
            this._fileInfo.executionEnvironment);
        if (constExprValue !== undefined) {
            const boolType = ScopeUtils.getBuiltInObject(this._currentScope, 'bool');
            if (boolType instanceof ObjectType) {
                srcType = boolType.cloneWithLiteral(constExprValue);
            }
        }

        // If a type declaration was provided, note it here.
        if (node.typeAnnotationComment) {
            const typeHintType = this._getTypeOfAnnotation(node.typeAnnotationComment);
            this._declareTypeForExpression(node.leftExpression, typeHintType,
                node.typeAnnotationComment, node.rightExpression);

            const diagAddendum = new DiagnosticAddendum();
            if (TypeUtils.canAssignType(typeHintType, srcType, diagAddendum)) {
                // Constrain the resulting type to match the declared type.
                srcType = TypeUtils.constrainDeclaredTypeBasedOnAssignedType(typeHintType, srcType);
            }
        }

        // If this is an enum, transform the type as required.
        let effectiveType = srcType;
        if (node.leftExpression instanceof NameNode && !node.typeAnnotationComment) {
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
        if (node.testExpression instanceof TupleExpressionNode) {
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
            if (AnalyzerNodeInfo.getIgnoreTypeAnnotation(node)) {
                return false;
            }

            this._getTypeOfExpression(node.typeAnnotation,
                EvaluatorFlags.AllowForwardReferences);
        }

        return true;
    }

    visitFormatString(node: FormatStringNode): boolean {
        node.expressions.forEach(formatExpr => {
            this._getTypeOfExpression(formatExpr.expression,
                EvaluatorFlags.AllowForwardReferences);
        });

        return true;
    }

    visitName(node: NameNode) {
        const nameValue = node.nameToken.value;
        const symbolInScope = this._currentScope.lookUpSymbolRecursive(nameValue);
        let declarations: Declaration[] | undefined;

        // If there's no declaration assigned to this name node, assign one
        // for the hover provider.
        declarations = AnalyzerNodeInfo.getDeclarations(node);
        if (!declarations) {
            if (symbolInScope && symbolInScope.symbol.hasDeclarations()) {
                declarations = TypeUtils.getPrimaryDeclarationsForSymbol(symbolInScope.symbol)!;
                AnalyzerNodeInfo.setDeclarations(node, declarations);
            }
        }

        // Determine if we should log information about private usage.
        this._conditionallyReportPrivateUsage(node);

        let unaccessedDiagLevel: DiagnosticLevel = 'none';
        if (symbolInScope && declarations) {
            // Determine if we should log information about an unused name.
            if (declarations[0].category === DeclarationCategory.Variable) {
                unaccessedDiagLevel = this._fileInfo.diagnosticSettings.reportUnusedVariable;
            }
        }

        this._conditionallyReportUnusedName(node, false, unaccessedDiagLevel,
            `Variable '${ node.nameToken.value }' is not accessed`);

        return true;
    }

    visitDel(node: DelNode) {
        node.expressions.forEach(expr => {
            this._markExpressionAccessed(expr);
            this._evaluateExpressionForDeletion(expr);

            if (expr instanceof NameNode) {
                let symbolWithScope = this._currentScope.lookUpSymbolRecursive(expr.nameToken.value);
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

        const leftExprType = this._getTypeOfExpression(node.leftExpression);
        this._setDefinitionForMemberName(leftExprType, node.memberName);
        this._conditionallyReportPrivateUsage(node.memberName);

        // Walk the leftExpression but not the memberName.
        this.walk(node.leftExpression);

        return false;
    }

    visitImportAs(node: ImportAsNode): boolean {
        let importInfo = AnalyzerNodeInfo.getImportInfo(node.module);
        assert(importInfo !== undefined);

        if (importInfo && importInfo.isImportFound && importInfo.resolvedPaths.length > 0) {
            let resolvedPath = importInfo.resolvedPaths[importInfo.resolvedPaths.length - 1];
            let moduleType = this._getModuleTypeForImportPath(importInfo, resolvedPath);

            if (moduleType) {
                // Import the implicit imports in the module's namespace.
                importInfo.implicitImports.forEach(implicitImport => {
                    let implicitModuleType = this._getModuleTypeForImportPath(
                        importInfo, implicitImport.path);
                    if (implicitModuleType) {
                        const moduleFields = moduleType!.getFields();
                        let importedModule = this._fileInfo.importMap[implicitImport.path];

                        if (importedModule) {
                            let declaration: Declaration = {
                                category: DeclarationCategory.Module,
                                node: importedModule.parseTree,
                                path: implicitImport.path,
                                range: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 }}
                            };

                            let newSymbol = Symbol.createWithType(implicitModuleType, DefaultTypeSourceId);
                            newSymbol.addDeclaration(declaration);
                            if (!moduleFields.get(implicitImport.name)) {
                                moduleFields.set(implicitImport.name, newSymbol);
                            }
                        }
                    }
                });

                let moduleDeclaration: Declaration | undefined;
                if (this._fileInfo.importMap[resolvedPath] &&
                        this._fileInfo.importMap[resolvedPath].parseTree) {

                    const moduleDeclarations = AnalyzerNodeInfo.getDeclarations(
                        this._fileInfo.importMap[resolvedPath].parseTree);
                    if (moduleDeclarations && moduleDeclarations.length > 0) {
                        moduleDeclaration = moduleDeclarations[0];
                    }
                }

                if (node.alias) {
                    this._assignTypeToNameNode(node.alias, moduleType, moduleDeclaration);
                    this._updateExpressionTypeForNode(node.alias, moduleType);

                    this._conditionallyReportUnusedName(node.alias, false,
                        this._fileInfo.diagnosticSettings.reportUnusedImport,
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
                    const moduleFields = moduleType.getFields();
                    moduleFields.forEach((boundValue, fieldName) => {
                        this._addSymbolToPermanentScope(fieldName);
                        this._addTypeSourceToName(fieldName, TypeUtils.getEffectiveTypeOfSymbol(boundValue),
                            AnalyzerNodeInfo.getTypeSourceId(node),
                            boundValue.hasDeclarations() ? boundValue.getDeclarations()[0] : undefined);
                    });

                    // Import the fields in the current permanent scope.
                    importInfo.implicitImports.forEach(implicitImport => {
                        let moduleType = this._getModuleTypeForImportPath(importInfo, resolvedPath);
                        if (moduleType) {
                            this._addSymbolToPermanentScope(implicitImport.name);
                            this._addTypeSourceToName(implicitImport.name, moduleType,
                                AnalyzerNodeInfo.getTypeSourceId(node));
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
                        if (moduleType &&
                                this._fileInfo.importMap[implicitImport.path] &&
                                this._fileInfo.importMap[implicitImport.path].parseTree) {

                            symbolType = moduleType;
                            const declarations = AnalyzerNodeInfo.getDeclarations(
                                this._fileInfo.importMap[implicitImport.path].parseTree);
                            if (declarations && declarations.length > 0) {
                                declaration = declarations[0];
                            }
                        }
                    } else {
                        const moduleType = this._getModuleTypeForImportPath(importInfo, resolvedPath);
                        if (moduleType) {
                            const moduleFields = moduleType.getFields();
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

                    if (declaration && importAs.alias) {
                        // If there was an alias, add the declaration the original
                        // name node as well.
                        AnalyzerNodeInfo.setDeclarations(importAs.name, [declaration]);
                    }

                    // Python files generated by protoc ("_pb2.py" files) contain
                    // unused imports. Don't report these because they're in generated
                    // files that shouldn't be edited.
                    if (importInfo.importName !== '__future__' &&
                            !this._fileInfo.filePath.endsWith('_pb2.py')) {

                        this._conditionallyReportUnusedName(aliasNode, false,
                            this._fileInfo.diagnosticSettings.reportUnusedImport,
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
                        `Import '${ aliasNode.nameToken.value }' is not accessed`);
                });
            }
        }

        return false;
    }

    visitTypeAnnotation(node: TypeAnnotationExpressionNode): boolean {
        let typeHintType = this._getTypeOfAnnotation(node.typeAnnotation);

        // If this is within an enum, transform the type.
        if (node.valueExpression instanceof NameNode) {
            typeHintType = this._transformTypeForPossibleEnumClass(
                node.valueExpression, typeHintType);
        }

        // Class and global variables should always be marked as accessed.
        if (ParseTreeUtils.getEnclosingClassOrModule(node, true)) {
            this._markExpressionAccessed(node.valueExpression);
        }

        this._declareTypeForExpression(node.valueExpression, typeHintType,
            node.typeAnnotation);

        if (this._fileInfo.isStubFile) {
            this._assignTypeToExpression(node.valueExpression, typeHintType,
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
                        const end = node.statements[node.statements.length - 1].end;
                        this._addUnusedCode(new TextRange(start, end - start));
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

        if (!(node.leftExpression instanceof NameNode) ||
                node.leftExpression.nameToken.value !== 'isinstance' ||
                node.arguments.length !== 2) {
            return;
        }

        const arg0Type = this._getTypeOfExpression(node.arguments[0].valueExpression);
        if (arg0Type.isAny()) {
            return;
        }

        const arg1Type = this._getTypeOfExpression(node.arguments[1].valueExpression);

        const classTypeList: ClassType[] = [];
        if (arg1Type instanceof ClassType) {
            classTypeList.push(arg1Type);
        } else if (arg1Type instanceof ObjectType) {
            // The isinstance call supports a variation where the second
            // parameter is a tuple of classes.
            const objClass = arg1Type.getClassType();
            if (objClass.isBuiltIn() && objClass.getClassName() === 'Tuple' && objClass.getTypeArguments()) {
                objClass.getTypeArguments()!.forEach(typeArg => {
                    if (typeArg instanceof ClassType) {
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
            return TypeUtils.combineTypes(types);
        };

        const filterType = (varType: ClassType): ObjectType[] => {
            let filteredTypes: ClassType[] = [];

            for (let filterType of classTypeList) {
                const filterIsSuperclass = varType.isDerivedFrom(filterType);
                const filterIsSubclass = filterType.isDerivedFrom(varType);

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

            return filteredTypes.map(t => new ObjectType(t));
        };

        let filteredType: Type;
        if (arg0Type instanceof ObjectType) {
            let remainingTypes = filterType(arg0Type.getClassType());
            filteredType = finalizeFilteredTypeList(remainingTypes);
        } else if (arg0Type instanceof UnionType) {
            let remainingTypes: Type[] = [];
            let foundAnyType = false;

            arg0Type.getTypes().forEach(t => {
                if (t.isAny()) {
                    foundAnyType = true;
                }

                if (t instanceof ObjectType) {
                    remainingTypes = remainingTypes.concat(
                        filterType(t.getClassType()));
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
            const objTypeList = classTypeList.map(t => new ObjectType(t));
            return TypeUtils.combineTypes(objTypeList);
        };

        if (filteredType instanceof NeverType) {
            this._addDiagnostic(
                this._fileInfo.diagnosticSettings.reportUnnecessaryIsInstance,
                `Unnecessary isinstance call: '${ arg0Type.asString() }' ` +
                    `is never instance of '${ getTestType().asString() }'`,
                node);
        } else if (filteredType.isSame(arg0Type)) {
            this._addDiagnostic(
                this._fileInfo.diagnosticSettings.reportUnnecessaryIsInstance,
                `Unnecessary isinstance call: '${ arg0Type.asString() }' ` +
                    `is always instance of '${ getTestType().asString() }'`,
                node);
        }
    }

    // Handles some special-case assignment statements that are found
    // within the typings.pyi file.
    private _handleTypingStubAssignment(node: AssignmentNode): boolean {
        if (!this._fileInfo.isTypingStubFile) {
            return false;
        }

        if (node.leftExpression instanceof NameNode) {
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
                    const specialClassType = new ClassType(assignedName,
                        ClassTypeFlags.BuiltInClass | ClassTypeFlags.SpecialBuiltIn,
                        DefaultTypeSourceId);

                    // See if we need to locate an alias class to bind it to.
                    const aliasMapEntry = aliasMap[assignedName];
                    if (aliasMapEntry) {
                        let aliasClass: Type | undefined;
                        const aliasName = aliasMapEntry.alias;

                        if (aliasMapEntry.module === 'builtins') {
                            aliasClass = ScopeUtils.getBuiltInType(this._currentScope, aliasName);
                        } else if (aliasMapEntry.module === 'collections') {
                            // The typing.pyi file imports collections.
                            let collectionsScope = this._findCollectionsImportScope();
                            if (collectionsScope) {
                                const symbolInfo = collectionsScope.lookUpSymbol(aliasName);
                                if (symbolInfo) {
                                    aliasClass = TypeUtils.getEffectiveTypeOfSymbol(symbolInfo);
                                }
                            }
                        }

                        if (aliasClass instanceof ClassType) {
                            specialClassType.addBaseClass(aliasClass, false);
                            specialClassType.setAliasClass(aliasClass);
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
                let declaration: Declaration = {
                    category: DeclarationCategory.Class,
                    node: node.leftExpression,
                    path: this._fileInfo.filePath,
                    range: convertOffsetsToRange(node.leftExpression.start,
                        node.leftExpression.end, this._fileInfo.lines)
                };
                this._assignTypeToNameNode(node.leftExpression, specialType, declaration);
                this._updateExpressionTypeForNode(node.leftExpression, specialType);
                return true;
            }
        } else if (node.leftExpression instanceof TypeAnnotationExpressionNode &&
                node.leftExpression.valueExpression instanceof NameNode) {

            const nameNode = node.leftExpression.valueExpression;
            const assignedName = nameNode.nameToken.value;
            let specialType: Type | undefined;

            const specialTypes = ['Tuple', 'Generic', 'Protocol', 'Callable',
                'Type', 'ClassVar', 'Final', 'Literal'];
            if (specialTypes.find(t => t === assignedName)) {
                // Synthesize a class.
                const specialClassType = new ClassType(assignedName,
                    ClassTypeFlags.BuiltInClass | ClassTypeFlags.SpecialBuiltIn,
                    AnalyzerNodeInfo.getTypeSourceId(node));

                const aliasClass = ScopeUtils.getBuiltInType(this._currentScope,
                    assignedName.toLowerCase());
                if (aliasClass instanceof ClassType) {
                    specialClassType.setAliasClass(aliasClass);

                    const specializedBaseClass = TypeUtils.specializeType(aliasClass, undefined);
                    specialClassType.addBaseClass(specializedBaseClass, false);
                    specialType = specialClassType;
                } else {
                    // The other classes derive from 'object'.
                    const objBaseClass = ScopeUtils.getBuiltInType(this._currentScope, 'object');
                    if (objBaseClass instanceof ClassType) {
                        specialClassType.addBaseClass(objBaseClass, false);
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
                let declaration: Declaration = {
                    category: DeclarationCategory.Class,
                    node: nameNode,
                    path: this._fileInfo.filePath,
                    range: convertOffsetsToRange(nameNode.start,
                        nameNode.end, this._fileInfo.lines)
                };
                this._assignTypeToNameNode(nameNode, specialType, declaration);
                this._updateExpressionTypeForNode(nameNode, specialType);
                return true;
            }
        }

        return false;
    }

    // Transforms the parameter type based on its category. If it's a simple parameter,
    // no transform is applied. If it's a var-arg or keword-arg parameter, the type
    // is wrapped in a List or Dict.
    private _getVariadicParamType(paramCategory: ParameterCategory, type: Type): Type {
        if (paramCategory === ParameterCategory.VarArgList) {
            const listType = ScopeUtils.getBuiltInType(this._currentScope, 'List');
            if (listType instanceof ClassType) {
                type = new ObjectType(listType.cloneForSpecialization([type]));
            } else {
                type = UnknownType.create();
            }
        } else if (paramCategory === ParameterCategory.VarArgDictionary) {
            const dictType = ScopeUtils.getBuiltInType(this._currentScope, 'Dict');
            const strType = ScopeUtils.getBuiltInObject(this._currentScope, 'str');
            if (dictType instanceof ClassType && strType instanceof ObjectType) {
                type = new ObjectType(dictType.cloneForSpecialization([strType, type]));
            } else {
                type = UnknownType.create();
            }
        }

        return type;
    }

    private _reportPossibleUnknownAssignment(diagLevel: DiagnosticLevel, target: NameNode,
            type: Type, srcExpr: ExpressionNode) {

        // Don't bother if the feature is disabled.
        if (diagLevel === 'none') {
            return;
        }

        const nameValue = target.nameToken.value;
        const simplifiedType = TypeUtils.removeUnboundFromUnion(type);
        if (simplifiedType instanceof UnknownType) {
            this._addDiagnostic(diagLevel,
                `Inferred type of '${ nameValue }' is unknown`, srcExpr);
        } else if (TypeUtils.containsUnknown(simplifiedType)) {
            // Sometimes variables contain an "unbound" type if they're
            // assigned only within conditional statements. Remove this
            // to avoid confusion.
            this._addDiagnostic(diagLevel,
                `Inferred type of '${ nameValue }', '${ simplifiedType.asString() }', ` +
                `is partially unknown`, srcExpr);
        }
    }

    // Assigns a declared type (as opposed to an inferred type) to an expression
    // (e.g. a local variable, class variable, instance variable, etc.).
    private _declareTypeForExpression(target: ExpressionNode, declaredType: Type,
            typeAnnotationNode: ExpressionNode, srcExprNode?: ExpressionNode) {

        let declarationHandled = false;

        if (target instanceof NameNode) {
            const name = target.nameToken;
            const declaration: Declaration = {
                category: DeclarationCategory.Variable,
                node: target,
                isConstant: SymbolUtils.isConstantName(name.value),
                path: this._fileInfo.filePath,
                declaredType,
                range: convertOffsetsToRange(name.start, name.end, this._fileInfo.lines)
            };

            const symbolWithScope = this._currentScope.lookUpSymbolRecursive(name.value);
            if (symbolWithScope && symbolWithScope.symbol) {
                this._addDeclarationToSymbol(symbolWithScope.symbol, declaration, typeAnnotationNode);
            }
            AnalyzerNodeInfo.setDeclarations(target, [declaration]);
            declarationHandled = true;
        } else if (target instanceof MemberAccessExpressionNode) {
            let targetNode = target.leftExpression;

            // Handle member accesses (e.g. self.x or cls.y).
            if (targetNode instanceof NameNode) {

                // Determine whether we're writing to a class or instance member.
                const enclosingClassNode = ParseTreeUtils.getEnclosingClass(target);
                if (enclosingClassNode) {
                    const classType = AnalyzerNodeInfo.getExpressionType(enclosingClassNode);

                    if (classType && classType instanceof ClassType) {
                        const typeOfLeftExpr = this._getTypeOfExpression(target.leftExpression);
                        if (typeOfLeftExpr instanceof ObjectType) {
                            if (typeOfLeftExpr.getClassType().isSameGenericClass(classType)) {
                                this._assignTypeToMemberVariable(target, declaredType, true,
                                    typeAnnotationNode, srcExprNode);
                                declarationHandled = true;
                            }
                        } else if (typeOfLeftExpr instanceof ClassType) {
                            if (typeOfLeftExpr.isSameGenericClass(classType)) {
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

            if (declWithDefinedType && declaration.node !== declWithDefinedType.node) {
                // If we're adding a declaration, make sure it's the same type as an existing declaration.
                if (!declaration.declaredType.isSame(declWithDefinedType.declaredType!)) {
                    this._addError(`Declared type '${ declaration.declaredType.asString() }' is not compatible ` +
                        `with previous declared type '${ declWithDefinedType.declaredType!.asString() }'`,
                        errorNode);
                }
            }
        }

        symbol.addDeclaration(declaration);
    }

    private _isSymbolPrivate(nameValue: string, scopeType: ScopeType) {
        // See if the symbol is private.
        if (SymbolUtils.isPrivateName(nameValue)) {
            return true;
        }

        if (SymbolUtils.isProtectedName(nameValue)) {
            // Protected names outside of a class scope are considered private.
            const isClassScope = scopeType === ScopeType.Class;
            return !isClassScope;
        }

        return false;
    }

    private _conditionallyReportUnusedName(node: NameNode, reportPrivateOnly: boolean,
            diagLevel: DiagnosticLevel, message: string) {

        const nameValue = node.nameToken.value;

        // A name of "_" means "I know this symbol isn't used", so
        // don't report it as unused.
        if (nameValue === '_') {
            return;
        }

        if (SymbolUtils.isDunderName(nameValue)) {
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
            this._addDiagnostic(diagLevel, message, node);
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
        const isPrivateName = SymbolUtils.isPrivateName(nameValue);
        const isProtectedName = SymbolUtils.isProtectedName(nameValue);

        // If it's not a protected or private name, don't bother with
        // any further checks.
        if (!isPrivateName && !isProtectedName) {
            return;
        }

        const declarations = AnalyzerNodeInfo.getDeclarations(node);
        const primaryDeclaration = declarations && declarations.length > 0 ?
            declarations[0] : undefined;
        if (!primaryDeclaration || primaryDeclaration.node === node) {
            return;
        }

        let classOrModuleNode = ParseTreeUtils.getEnclosingClassOrModule(
            primaryDeclaration.node);

        // If this is the name of a class, find the module or class that contains it rather
        // than constraining the use of the class name within the class itself.
        if (primaryDeclaration.node.parent &&
                primaryDeclaration.node.parent === classOrModuleNode &&
                classOrModuleNode instanceof ClassNode) {

            classOrModuleNode = ParseTreeUtils.getEnclosingClassOrModule(classOrModuleNode);
        }

        // If it's a class member, check whether it's a legal protected access.
        let isProtectedAccess = false;
        if (classOrModuleNode instanceof ClassNode) {
            if (isProtectedName) {
                const declarationClassType = AnalyzerNodeInfo.getExpressionType(classOrModuleNode);
                if (declarationClassType && declarationClassType instanceof ClassType) {
                    // Note that the access is to a protected class member.
                    isProtectedAccess = true;

                    const enclosingClassNode = ParseTreeUtils.getEnclosingClass(node);
                    if (enclosingClassNode) {
                        isProtectedAccess = true;
                        const enclosingClassType = AnalyzerNodeInfo.getExpressionType(enclosingClassNode);

                        // If the referencing class is a subclass of the declaring class, it's
                        // allowed to access a protected name.
                        if (enclosingClassType && enclosingClassType instanceof ClassType) {
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
                    `'${ nameValue }' is protected and used outside of a derived class`,
                    node);
            } else {
                const scopeName = classOrModuleNode instanceof ClassNode ?
                    'class' : 'module';

                this._addDiagnostic(this._fileInfo.diagnosticSettings.reportPrivateUsage,
                    `'${ nameValue }' is private and used outside of the ${ scopeName } in which it is declared`,
                    node);
            }
        }
    }

    private _createAwaitableFunction(functionType: FunctionType): FunctionType {
        const returnType = functionType.getEffectiveReturnType();

        let awaitableReturnType: Type | undefined;
        const evaluator = this._createEvaluator();

        if (returnType instanceof ObjectType) {
            const classType = returnType.getClassType();
            if (classType.isBuiltIn()) {
                if (classType.getClassName() === 'Generator') {
                    // If the return type is a Generator, change it to an AsyncGenerator.
                    const asyncGeneratorType = evaluator.getTypingType('AsyncGenerator');
                    if (asyncGeneratorType instanceof ClassType) {
                        const typeArgs: Type[] = [];
                        const generatorTypeArgs = classType.getTypeArguments();
                        if (generatorTypeArgs && generatorTypeArgs.length > 0) {
                            typeArgs.push(generatorTypeArgs[0]);
                        }
                        if (generatorTypeArgs && generatorTypeArgs.length > 1) {
                            typeArgs.push(generatorTypeArgs[1]);
                        }
                        awaitableReturnType = new ObjectType(asyncGeneratorType.cloneForSpecialization(typeArgs));
                    }

                } else if (classType.getClassName() === 'AsyncGenerator') {
                    // If it's already an AsyncGenerator, leave it as is.
                    awaitableReturnType = returnType;
                }
            }
        }

        if (!awaitableReturnType) {
            const awaitableType = evaluator.getTypingType('Awaitable');
            if (awaitableType instanceof ClassType) {
                awaitableReturnType = new ObjectType(awaitableType.cloneForSpecialization(
                    [returnType]));
            } else {
                awaitableReturnType = UnknownType.create();
            }
        }

        // Clone the original function and replace its return type with an
        // Awaitable[<returnType>].
        const awaitableFunctionType = functionType.clone();
        awaitableFunctionType.setDeclaredReturnType(awaitableReturnType);

        return awaitableFunctionType;
    }

    private _validateFunctionReturn(node: FunctionNode, functionType: FunctionType,
            functionScope: Scope) {

        // Stub files are allowed to not return an actual value,
        // so skip this if it's a stub file.
        if (this._fileInfo.isStubFile) {
            return;
        }

        // Add all of the return and yield types that were found within the function.
        let inferredReturnType = functionType.getInferredReturnType();
        if (inferredReturnType.addSources(functionScope.getReturnType())) {
            this._setAnalysisChanged();
        }

        let inferredYieldType = functionType.getInferredYieldType();

        // Inferred yield types need to be wrapped in a Generator to
        // produce the final result.
        const evaluator = this._createEvaluator();
        const generatorType = evaluator.getTypingType('Generator');
        if (generatorType instanceof ClassType) {
            inferredYieldType.setGenericClassWrapper(generatorType);
        }

        if (inferredYieldType.addSources(functionScope.getYieldType())) {
            this._setAnalysisChanged();
        }

        // Add the "None" type if the function doesn't always return.
        if (!functionScope.getAlwaysReturnsOrRaises()) {
            if (inferredReturnType.addSource(NoneType.create(),
                    AnalyzerNodeInfo.getTypeSourceId(node))) {

                this._setAnalysisChanged();
            }

            let declaredReturnType = functionType.isGenerator() ?
                TypeUtils.getDeclaredGeneratorReturnType(functionType) :
                functionType.getDeclaredReturnType();

            if (declaredReturnType && node.returnTypeAnnotation) {
                // Skip this check for abstract methods and functions that are declared NoReturn.
                if (!functionType.isAbstractMethod() && !TypeUtils.isNoReturnType(declaredReturnType)) {
                    const diagAddendum = new DiagnosticAddendum();

                    // If the declared type isn't compatible with 'None', flag an error.
                    if (!TypeUtils.canAssignType(declaredReturnType, NoneType.create(), diagAddendum)) {
                        this._addError(`Function with declared type of '${ declaredReturnType.asString() }'` +
                                ` must return value` + diagAddendum.getString(),
                            node.returnTypeAnnotation);
                    }
                }
            }
        } else if (functionScope.getAlwaysRaises() &&
                functionScope.getReturnType().getSources().length === 0 &&
                !functionType.isAbstractMethod()) {

            // If the function always raises and never returns, add
            // the "NoReturn" type. Skip this for abstract methods which
            // often are implemented with "raise NotImplementedError()".
            const noReturnType = evaluator.getTypingType('NoReturn') as ClassType;
            if (noReturnType && inferredReturnType.addSource(new ObjectType(noReturnType),
                    AnalyzerNodeInfo.getTypeSourceId(node))) {

                this._setAnalysisChanged();
            }
        } else {
            if (inferredReturnType.removeSource(AnalyzerNodeInfo.getTypeSourceId(node))) {
                this._setAnalysisChanged();
            }
        }

        if (node.returnTypeAnnotation) {
            const declaredReturnType = functionType.getDeclaredReturnType();
            if (declaredReturnType && TypeUtils.isNoReturnType(declaredReturnType)) {
                if (!functionScope.getAlwaysRaises()) {
                    this._addError(`Function with declared type of 'NoReturn' cannot return 'None'`,
                        node.returnTypeAnnotation);
                }
            }
        }
    }

    // Validates that any overridden methods contain the same signatures
    // as the original method. Also marks the class as abstract if one or
    // more abstract methods are not overridden.
    private _validateClassMethods(classType: ClassType) {
        if (TypeUtils.doesClassHaveAbstractMethods(classType)) {
            classType.setIsAbstractClass();
        }

        // Skip the overridden method check for stub files. Many of the built-in
        // typeshed stub files trigger this diagnostic.
        if (!this._fileInfo.isStubFile) {
            // Skip this check (which is somewhat expensive) if it is disabled.
            if (this._fileInfo.diagnosticSettings.reportIncompatibleMethodOverride !== 'none') {

                this._validateOveriddenMathods(classType);
            }
        }
    }

    private _validateOveriddenMathods(classType: ClassType) {
        classType.getClassFields().forEach((symbol, name) => {
            // Don't check magic functions.
            if (!SymbolUtils.isDunderName(name)) {
                const typeOfSymbol = TypeUtils.getEffectiveTypeOfSymbol(symbol);
                if (typeOfSymbol instanceof FunctionType) {
                    const baseClassAndSymbol = TypeUtils.getSymbolFromBaseClasses(classType, name);
                    if (baseClassAndSymbol) {
                        const typeOfBaseClassMethod = TypeUtils.getEffectiveTypeOfSymbol(baseClassAndSymbol.symbol);
                        let diagAddendum = new DiagnosticAddendum();
                        if (!TypeUtils.canOverrideMethod(typeOfBaseClassMethod, typeOfSymbol, diagAddendum)) {
                            const declarations = symbol.getDeclarations();
                            const errorNode = declarations[0].node;
                            this._addDiagnostic(this._fileInfo.diagnosticSettings.reportIncompatibleMethodOverride,
                                `Method '${ name }' overrides class '${ baseClassAndSymbol.class.getClassName() }' ` +
                                    `in an incompatible manner` + diagAddendum.getString(), errorNode);
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
        if (decoratorType instanceof OverloadedFunctionType) {
            const overloads = decoratorType.getOverloads();
            if (overloads.length > 0 && overloads[0].type.getBuiltInName() === 'dataclass') {
                // Determine whether we should skip synthesizing the init method.
                let skipSynthesizeInit = false;

                if (decoratorNode.arguments) {
                    decoratorNode.arguments.forEach(arg => {
                        if (arg.name && arg.name.nameToken.value === 'init') {
                            if (arg.valueExpression) {
                                const value = ExpressionUtils.evaluateConstantExpression(
                                    arg.valueExpression, this._fileInfo.executionEnvironment);
                                if (!value) {
                                    skipSynthesizeInit = true;
                                }
                            }
                        }
                    });
                }

                originalClassType.setIsDataClass(skipSynthesizeInit);
            }

            return inputClassType;
        }

        let evaluator = this._createEvaluator();
        return evaluator.getTypeFromDecorator(decoratorNode, inputClassType);
    }

    // Transforms the input function type into an output type based on the
    // decorator function described by the decoratorNode.
    private _applyFunctionDecorator(inputFunctionType: Type, originalFunctionType: FunctionType,
            decoratorNode: DecoratorNode, node: FunctionNode): Type {

        const decoratorType = this._getTypeOfExpression(decoratorNode.leftExpression);

        // Special-case the "overload" because it has no definition.
        if (decoratorType instanceof ClassType && decoratorType.getClassName() === 'overload') {
            const permanentScope = ScopeUtils.getPermanentScope(this._currentScope);
            let existingSymbol = permanentScope.lookUpSymbol(node.name.nameToken.value);
            let typeSourceId = AnalyzerNodeInfo.getTypeSourceId(node);
            if (inputFunctionType instanceof FunctionType) {
                if (existingSymbol) {
                    const symbolType = TypeUtils.getEffectiveTypeOfSymbol(existingSymbol);
                    if (symbolType instanceof OverloadedFunctionType) {
                        symbolType.addOverload(typeSourceId, inputFunctionType);
                        return symbolType;
                    }
                }

                let newOverloadType = new OverloadedFunctionType();
                newOverloadType.addOverload(typeSourceId, inputFunctionType);
                return newOverloadType;
            }
        }

        let evaluator = this._createEvaluator();
        let returnType = evaluator.getTypeFromDecorator(decoratorNode, inputFunctionType);

        // Check for some built-in decorator types with known semantics.
        if (decoratorType instanceof FunctionType) {
            if (decoratorType.getBuiltInName() === 'abstractmethod') {
                originalFunctionType.setIsAbstractMethod();
                return inputFunctionType;
            }

            // Handle property setters and deleters.
            if (decoratorNode.leftExpression instanceof MemberAccessExpressionNode) {
                const baseType = this._getTypeOfExpression(decoratorNode.leftExpression.leftExpression);
                if (baseType instanceof PropertyType) {
                    const memberName = decoratorNode.leftExpression.memberName.nameToken.value;
                    if (memberName === 'setter') {
                        baseType.setSetter(originalFunctionType);
                        return baseType;
                    } else if (memberName === 'deleter') {
                        baseType.setDeleter(originalFunctionType);
                        return baseType;
                    }
                }
            }

        } else if (decoratorType instanceof ClassType) {
            if (decoratorType.isBuiltIn()) {
                switch (decoratorType.getClassName()) {
                    case 'staticmethod': {
                        originalFunctionType.setIsStaticMethod();
                        return inputFunctionType;
                    }

                    case 'classmethod': {
                        originalFunctionType.setIsClassMethod();
                        return inputFunctionType;
                    }

                    case 'property': {
                        if (inputFunctionType instanceof FunctionType) {
                            // Allocate a property only during the first analysis pass.
                            // Otherwise the analysis won't converge if there are setters
                            // and deleters applied to the property.
                            const oldPropertyType = AnalyzerNodeInfo.getExpressionType(decoratorNode);
                            if (oldPropertyType) {
                                return oldPropertyType;
                            }
                            const newProperty = new PropertyType(inputFunctionType);
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
        } else if (functionType.isStaticMethod()) {
            // Static methods should not have "self" or "cls" parameters.
            if (node.parameters.length > 0 && node.parameters[0].name) {
                let paramName = node.parameters[0].name.nameToken.value;
                if (paramName === 'self' || paramName === 'cls') {
                    this._addError(
                        `Static methods should not take a 'self' or 'cls' parameter`,
                        node.parameters[0].name);
                }
            }
        } else if (functionType.isClassMethod()) {
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
        let constExprValue = ExpressionUtils.evaluateConstantExpression(
            testExpression, this._fileInfo.executionEnvironment);

        // Get and cache the expression type before walking it. This will apply
        // any type constraints along the way.
        const exprType = this._getTypeOfExpression(testExpression);

        // Handle the case where the expression evaluates to a known
        // true, false or None value.
        if (exprType instanceof ObjectType) {
            const exprClass = exprType.getClassType();
            if (exprClass.isBuiltIn() && exprClass.getClassName() === 'bool') {
                const literalValue = exprType.getLiteralValue();
                if (typeof literalValue === 'boolean') {
                    constExprValue = literalValue;
                }
            }
        } else if (exprType instanceof NoneType) {
            constExprValue = false;
        }

        this.walk(testExpression);

        let typeConstraints = this._buildConditionalTypeConstraints(testExpression);

        // Push a temporary scope so we can track
        // which variables have been assigned to conditionally.
        const ifScope = this._enterTemporaryScope(() => {
            // Add any applicable type constraints.
            if (typeConstraints) {
                typeConstraints.ifConstraints.forEach(constraint => {
                    this._currentScope.addTypeConstraint(constraint);
                });
            }

            if (constExprValue !== false) {
                this.walk(ifWhileSuite);
            }
        }, true, isWhile ? ifWhileSuite : undefined);

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
        }, true);

        // Evaluate the expression so the expression type is cached.
        this._getTypeOfExpression(testExpression);

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

    private _findCollectionsImportScope() {
        let collectionResults = Object.keys(this._fileInfo.importMap).find(path => {
            return path.endsWith('collections/__init__.pyi');
        });

        if (collectionResults) {
            const moduleNode = this._fileInfo.importMap[collectionResults].parseTree;
            return AnalyzerNodeInfo.getScope(moduleNode);
        }

        return undefined;
    }

    private _validateYieldType(node: YieldExpressionNode | YieldFromExpressionNode, yieldType: Type) {
        let declaredYieldType: Type | undefined;
        const enclosingFunctionNode = ParseTreeUtils.getEnclosingFunction(node);

        if (enclosingFunctionNode) {
            let functionType = AnalyzerNodeInfo.getExpressionType(
                enclosingFunctionNode) as FunctionType;
            if (functionType) {
                assert(functionType instanceof FunctionType);
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
                        `Expression of type '${ yieldType.asString() }' cannot be assigned ` +
                            `to yield type '${ declaredYieldType.asString() }'` + diagAddendum.getString(),
                        node.expression);
                }
            }
        }
    }

    private _validateExceptionType(exceptionType: Type, errorNode: ParseNode) {
        if (exceptionType.isAny()) {
            return exceptionType;
        }

        if (exceptionType instanceof ClassType) {
            const baseExceptionType = ScopeUtils.getBuiltInType(
                this._currentScope, 'BaseException');
            if (!baseExceptionType || !(baseExceptionType instanceof ClassType)) {
                return new ObjectType(exceptionType);
            }

            if (!TypeUtils.derivesFromClassRecursive(exceptionType, baseExceptionType)) {
                this._addError(
                    `'${ exceptionType.asString() }' does not derive from ` +
                    `'${ baseExceptionType.asString() }'`,
                    errorNode);
            }

            return new ObjectType(exceptionType);
        } else if (exceptionType instanceof ObjectType) {
            // TODO - we need to determine whether the type is an iterable
            // collection of classes. For now, just see if it derives
            // from one of the built-in iterable types.
            const classType = exceptionType.getClassType();
            const validTypes = ['list', 'tuple', 'set'];
            const isValid = validTypes.find(t => {
                const builtInType = ScopeUtils.getBuiltInType(this._currentScope, t);
                if (!builtInType || !(builtInType instanceof ClassType)) {
                    return false;
                }
                return classType.isDerivedFrom(builtInType);
            }) !== undefined;
            if (isValid) {
                return UnknownType.create();
            }
        }

        this._addError(
            `'${ exceptionType.asString() }' is not valid exception class`,
            errorNode);
        return exceptionType;
    }

    private _addAssignmentTypeConstraint(node: ExpressionNode, assignmentType: Type) {
        // Don't propagate an "unbound" type to the target.
        const typeWithoutUnbound = TypeUtils.removeUnboundFromUnion(assignmentType);
        const typeConstraint = TypeConstraintBuilder.buildTypeConstraintForAssignment(
            node, typeWithoutUnbound);

        if (typeConstraint) {
            this._currentScope.addTypeConstraint(typeConstraint);
        }
    }

    // Associates a member variable with a specified type.
    // If typeAnnotationNode is provided, assumes that the specified
    // type is declared (rather than inferred).
    private _assignTypeToMemberVariable(node: MemberAccessExpressionNode, srcType: Type,
            isInstanceMember: boolean, typeAnnotationNode?: ExpressionNode,
            srcExprNode?: ExpressionNode) {

        const memberName = node.memberName.nameToken.value;
        const isConstant = SymbolUtils.isConstantName(memberName);

        // If the member name appears to be a constant, use the strict
        // source type. If it appears to be a variable, strip off any
        // literal to allow other values to be assigned to it later.
        if (!isConstant || this._fileInfo.diagnosticSettings.reportConstantRedefinition === 'none') {
            srcType = TypeUtils.stripLiteralValue(srcType);
        }

        const classDef = ParseTreeUtils.getEnclosingClass(node);
        if (!classDef) {
            return;
        }

        let destType = srcType;
        let addTypeConstraintForAssignment = true;

        let classType = AnalyzerNodeInfo.getExpressionType(classDef);
        if (classType && classType instanceof ClassType) {
            let memberInfo = TypeUtils.lookUpClassMember(classType, memberName,
                isInstanceMember ? ClassMemberLookupFlags.Default : ClassMemberLookupFlags.SkipInstanceVariables);

            // A local helper function that creates a new declaration.
            let createDeclaration = () => {
                const declaration: Declaration = {
                    category: srcType instanceof FunctionType ?
                        DeclarationCategory.Method : DeclarationCategory.Variable,
                    node: node.memberName,
                    isConstant,
                    path: this._fileInfo.filePath,
                    range: convertOffsetsToRange(node.memberName.start, node.memberName.end, this._fileInfo.lines)
                };

                if (typeAnnotationNode) {
                    declaration.declaredType = srcType;
                }

                return declaration;
            };

            const memberFields = isInstanceMember ? classType.getInstanceFields() : classType.getClassFields();

            let addNewMemberToLocalClass = false;
            let inheritedDeclaration: Declaration | undefined;
            if (memberInfo) {
                if (memberInfo.classType instanceof ClassType &&
                        classType.isSameGenericClass(memberInfo.classType) &&
                        memberInfo.isInstanceMember === isInstanceMember) {

                    const symbol = memberFields.get(memberName)!;
                    assert(symbol !== undefined);

                    // If the type annotation node is provided, use it to generate a source ID.
                    // If an expression contains both a type annotation and an assigment, we want
                    // to generate two sources because the types may different, and the analysis
                    // won't converge if we use the same source ID for both.
                    const sourceId = AnalyzerNodeInfo.getTypeSourceId(typeAnnotationNode || node.memberName);
                    if (symbol.setInferredTypeForSource(srcType, sourceId)) {
                        this._setAnalysisChanged();
                    }

                    if (srcExprNode) {
                        this._reportPossibleUnknownAssignment(
                            this._fileInfo.diagnosticSettings.reportUnknownMemberType,
                            node.memberName, srcType, srcExprNode);
                    }

                    this._addDeclarationToSymbol(symbol, createDeclaration(), typeAnnotationNode || node);
                    const primaryDecls = TypeUtils.getPrimaryDeclarationsForSymbol(symbol)!;
                    AnalyzerNodeInfo.setDeclarations(node.memberName, primaryDecls);

                    // Check for an attempt to overwrite a constant member variable.
                    const primaryDecl = primaryDecls ? primaryDecls[0] : undefined;
                    if (primaryDecl && primaryDecl.isConstant && srcExprNode) {
                        if (node.memberName !== primaryDecl.node) {
                            this._addDiagnostic(this._fileInfo.diagnosticSettings.reportConstantRedefinition,
                                `'${ node.memberName.nameToken.value }' is constant and cannot be redefined`,
                                node.memberName);
                        }
                    }
                } else {
                    // Is the target a property?
                    const prevDeclarations = memberInfo.symbol.getDeclarations();
                    if (prevDeclarations.length > 0 && prevDeclarations[0].declaredType &&
                            prevDeclarations[0].declaredType instanceof PropertyType) {

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
                            memberInfo.symbol.setIsAcccessed();
                            srcType = TypeUtils.combineTypes([srcType, memberInfo.symbolType]);
                        }

                        addNewMemberToLocalClass = true;
                    }
                }
            } else {
                // The member name hasn't been seen previously, so add it to the local class.
                addNewMemberToLocalClass = true;
            }

            if (addNewMemberToLocalClass) {
                let newSymbol = Symbol.createWithType(srcType, AnalyzerNodeInfo.getTypeSourceId(node.memberName));

                // If this is an instance variable that has a corresponding class varible
                // with a defined type, it should inherit that declaration (and declared type).
                if (inheritedDeclaration) {
                    newSymbol.addDeclaration(inheritedDeclaration);
                }

                newSymbol.addDeclaration(createDeclaration());
                memberFields.set(memberName, newSymbol);
                this._setAnalysisChanged();

                if (srcExprNode) {
                    this._reportPossibleUnknownAssignment(
                        this._fileInfo.diagnosticSettings.reportUnknownMemberType,
                        node.memberName, srcType, srcExprNode);
                }

                AnalyzerNodeInfo.setDeclarations(node.memberName,
                    TypeUtils.getPrimaryDeclarationsForSymbol(newSymbol)!);
            }

            // Look up the member info again, now that we've potentially added a declared type.
            memberInfo = TypeUtils.lookUpClassMember(classType, memberName,
                ClassMemberLookupFlags.DeclaredTypesOnly);
            if (memberInfo) {
                const declaredType = TypeUtils.getDeclaredTypeOfSymbol(memberInfo.symbol);
                if (declaredType && !declaredType.isAny()) {
                    if (declaredType instanceof FunctionType) {
                        // Overwriting an existing method.
                        // TODO - not sure what assumption to make here.
                    } else if (declaredType instanceof PropertyType) {
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
                this._setAnalysisChanged();
            }
        }

        if (this._currentScope.mergeYieldType(scopeToMerge)) {
            if (this._currentScope.getType() !== ScopeType.Temporary) {
                this._setAnalysisChanged();
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
            const moduleNode = this._fileInfo.importMap[path].parseTree;
            if (moduleNode) {
                const moduleType = AnalyzerNodeInfo.getExpressionType(moduleNode) as ModuleType;
                if (moduleType) {
                    return moduleType;
                }
            }
        } else if (importResult) {
            // There was no module even though the import was resolved. This
            // happens in the case of namespace packages, where an __init__.py
            // is not necessarily present. We'll synthesize a module type in
            // this case.
            const symbolTable = new SymbolTable();
            const moduleType = new ModuleType(symbolTable);

            // Add the implicit imports.
            importResult.implicitImports.forEach(implicitImport => {
                const implicitModuleType = this._getModuleTypeForImportPath(
                    undefined, implicitImport.path);
                if (implicitModuleType) {
                    symbolTable.set(implicitImport.name, Symbol.createWithType(
                        implicitModuleType, DefaultTypeSourceId));
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

    private _getTypeOfExpression(node: ExpressionNode, flags?: EvaluatorFlags): Type {
        const evaluator = this._createEvaluator();

        // If the caller didn't specify the flags, use the defaults.
        if (flags === undefined) {
            flags = EvaluatorFlags.None;
        }
        return evaluator.getType(node, { method: 'get' }, flags);
    }

    private _evaluateExpressionForAssignment(node: ExpressionNode, type: Type, errorNode: ExpressionNode) {
        let evaluator = this._createEvaluator();
        evaluator.getType(node, { method: 'set', setType: type, setErrorNode: errorNode }, EvaluatorFlags.None);
    }

    private _evaluateExpressionForDeletion(node: ExpressionNode): Type {
        const evaluator = this._createEvaluator();
        return evaluator.getType(node, { method: 'del' }, EvaluatorFlags.None);
    }

    private _updateExpressionTypeForNode(node: ExpressionNode, exprType: Type) {
        const oldType = AnalyzerNodeInfo.getExpressionType(node);
        AnalyzerNodeInfo.setExpressionTypeVersion(node, this._analysisVersion);

        if (!oldType || !oldType.isSame(exprType)) {
            let replaceType = true;

            // In rare cases, we can run into a situation where an "unknown"
            // is passed back and forth between two variables, preventing
            // us from ever converging. Detect this rare condition here.
            if (this._analysisVersion > CheckForBeatingUnknownPassCount) {
                if (oldType && exprType instanceof UnionType) {
                    const simplifiedExprType = TypeUtils.removeUnknownFromUnion(exprType);
                    if (oldType.isSame(simplifiedExprType)) {
                        replaceType = false;
                    }
                }
            }

            if (replaceType) {
                this._setAnalysisChanged();
                AnalyzerNodeInfo.setExpressionType(node, exprType);
            }
        }
    }

    private _markExpressionAccessed(target: ExpressionNode) {
        if (target instanceof NameNode) {
            const nameValue = target.nameToken.value;
            const symbolWithScope = this._currentScope.lookUpSymbolRecursive(nameValue);

            if (symbolWithScope) {
                symbolWithScope.symbol.setIsAcccessed();
            }
        }
    }

    private _assignTypeToExpression(target: ExpressionNode, srcType: Type, srcExpr: ExpressionNode): void {
        if (target instanceof NameNode) {
            const name = target.nameToken;
            const declaration: Declaration = {
                category: DeclarationCategory.Variable,
                node: target,
                isConstant: SymbolUtils.isConstantName(name.value),
                path: this._fileInfo.filePath,
                range: convertOffsetsToRange(name.start, name.end, this._fileInfo.lines)
            };

            // Handle '__all__' as a special case in the module scope.
            if (name.value === '__all__' && this._currentScope.getType() === ScopeType.Module) {
                // It's common for modules to include the expression
                // __all__ = ['a', 'b', 'c']
                // We will mark the symbols referenced by these strings as accessed.
                if (srcExpr instanceof ListNode) {
                    srcExpr.entries.forEach(entryExpr => {
                        if (entryExpr instanceof StringListNode || entryExpr instanceof StringNode) {
                            const symbolName = entryExpr.getValue();
                            const symbolInScope = this._currentScope.lookUpSymbolRecursive(symbolName);
                            if (symbolInScope) {
                                symbolInScope.symbol.setIsAcccessed();
                            }
                        }
                    });
                }
            }

            this._reportPossibleUnknownAssignment(
                this._fileInfo.diagnosticSettings.reportUnknownVariableType,
                target, srcType, srcExpr);

            this._assignTypeToNameNode(target, srcType, declaration, srcExpr);
        } else if (target instanceof MemberAccessExpressionNode) {
            let targetNode = target.leftExpression;

            // Handle member accesses (e.g. self.x or cls.y).
            if (targetNode instanceof NameNode) {
                // Determine whether we're writing to a class or instance member.
                const enclosingClassNode = ParseTreeUtils.getEnclosingClass(target);

                if (enclosingClassNode) {
                    const classType = AnalyzerNodeInfo.getExpressionType(enclosingClassNode);

                    if (classType && classType instanceof ClassType) {
                        const typeOfLeftExpr = this._getTypeOfExpression(target.leftExpression);
                        if (typeOfLeftExpr instanceof ObjectType) {
                            if (typeOfLeftExpr.getClassType().isSameGenericClass(classType)) {
                                this._assignTypeToMemberVariable(target, srcType, true,
                                    undefined, srcExpr);
                            }
                        } else if (typeOfLeftExpr instanceof ClassType) {
                            if (typeOfLeftExpr.isSameGenericClass(classType)) {
                                this._assignTypeToMemberVariable(target, srcType, false,
                                    undefined, srcExpr);
                            }
                        }
                    }
                }
            }
        } else if (target instanceof TupleExpressionNode) {
            // Initialize the array of target types, one for each target.
            const targetTypes: Type[][] = new Array(target.expressions.length);
            for (let i = 0; i < target.expressions.length; i++) {
                targetTypes[i] = [];
            }

            TypeUtils.doForSubtypes(srcType, subtype => {
                // Is this subtype a tuple?
                const tupleType = TypeUtils.getSpecializedTupleType(subtype);
                if (tupleType && tupleType.getTypeArguments()) {
                    const entryTypes = tupleType.getTypeArguments()!;
                    let entryCount = entryTypes.length;

                    const sourceEndsInEllipsis = entryCount > 0 &&
                        TypeUtils.isEllipsisType(entryTypes[entryCount - 1]);
                    if (sourceEndsInEllipsis) {
                        entryCount--;
                    }

                    const targetEndsWithUnpackOperator = target.expressions.length > 0 &&
                        target.expressions[target.expressions.length - 1] instanceof UnpackExpressionNode;

                    if (targetEndsWithUnpackOperator) {
                        if (entryCount >= target.expressions.length) {
                            for (let index = 0; index < target.expressions.length - 1; index++) {
                                const entryType = index < entryCount ? entryTypes[index] : UnknownType.create();
                                targetTypes[index].push(entryType);
                            }

                            let remainingTypes: Type[] = [];
                            for (let index = target.expressions.length - 1; index < entryCount; index++) {
                                const entryType = entryTypes[index];
                                remainingTypes.push(entryType);
                            }

                            targetTypes[target.expressions.length - 1].push(TypeUtils.combineTypes(remainingTypes));
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
                const targetType = typeList.length === 0 ? UnknownType.create() : TypeUtils.combineTypes(typeList);
                this._assignTypeToExpression(expr, targetType, srcExpr);
            });
        } else if (target instanceof TypeAnnotationExpressionNode) {
            const typeHintType = this._getTypeOfAnnotation(target.typeAnnotation);
            const diagAddendum = new DiagnosticAddendum();
            if (TypeUtils.canAssignType(typeHintType, srcType, diagAddendum)) {
                srcType = TypeUtils.constrainDeclaredTypeBasedOnAssignedType(typeHintType, srcType);
            }

            this._assignTypeToExpression(target.valueExpression, srcType, srcExpr);
        } else if (target instanceof UnpackExpressionNode) {
            if (target.expression instanceof NameNode) {
                const name = target.expression.nameToken;
                const declaration: Declaration = {
                    category: DeclarationCategory.Variable,
                    node: target.expression,
                    isConstant: SymbolUtils.isConstantName(name.value),
                    path: this._fileInfo.filePath,
                    range: convertOffsetsToRange(name.start, name.end, this._fileInfo.lines)
                };

                if (!srcType.isAny()) {
                    // Make a list type from the source.
                    const listType = ScopeUtils.getBuiltInType(this._currentScope, 'List');
                    if (listType instanceof ClassType) {
                        srcType = new ObjectType(listType.cloneForSpecialization([srcType]));
                    } else {
                        srcType = UnknownType.create();
                    }
                }
                this._assignTypeToNameNode(target.expression, srcType, declaration, srcExpr);
            }
        } else if (target instanceof ListNode) {
            target.entries.forEach(entry => {
                this._assignTypeToExpression(entry, UnknownType.create(), srcExpr);
            });
        }

        // Report any errors with assigning to this type.
        this._evaluateExpressionForAssignment(target, srcType, srcExpr);
    }

    private _addNamedTargetToCurrentScope(node: ExpressionNode) {
        if (node instanceof NameNode) {
            const symbol = this._currentScope.addSymbol(node.nameToken.value, true);

            // Mark the symbol as accessed. These symbols are not persisted
            // between analysis passes, so we never have an opportunity to
            // mark them as accessed.
            symbol.setIsAcccessed();
        } else if (node instanceof TypeAnnotationExpressionNode) {
            this._addNamedTargetToCurrentScope(node.valueExpression);
        } else if (node instanceof TupleExpressionNode) {
            node.expressions.forEach(expr => {
                this._addNamedTargetToCurrentScope(expr);
            });
        } else if (node instanceof ListNode) {
            node.entries.forEach(expr => {
                this._addNamedTargetToCurrentScope(expr);
            });
        }
    }

    private _bindMultiPartModuleNameToType(nameParts: NameNode[], type: ModuleType,
            declaration?: Declaration): void {

        // The target symbol table will change as we progress through
        // the multi-part name. Start with the current scope's symbol
        // table, which should include the first part of the name.
        let targetSymbolTable = this._currentScope.getSymbolTable();
        let symbol = Symbol.createWithType(type, DefaultTypeSourceId);
        if (declaration) {
            symbol.addDeclaration(declaration);
        }

        for (let i = 0; i < nameParts.length; i++) {
            const name = nameParts[i].nameToken.value;
            const targetSymbol = targetSymbolTable.get(name);
            let symbolType = targetSymbol ?
                TypeUtils.getEffectiveTypeOfSymbol(targetSymbol) : undefined;

            if (symbolType instanceof ModuleType) {
                const moduleFields = symbolType.getFields();

                // Are we replacing a partial module?
                if (i === nameParts.length - 1 && symbolType.isPartialModule) {
                    // Combine the names in the existing partial module into
                    // the new module's symbol table.
                    moduleFields.getKeys().forEach(name => {
                        type.getFields().set(name, moduleFields.get(name)!);
                    });

                    if (!targetSymbolTable.get(name)) {
                        targetSymbolTable.set(name, symbol);
                    }

                    symbolType = type;
                }

                targetSymbolTable = moduleFields;
            } else if (i === nameParts.length - 1) {
                targetSymbolTable.set(name, symbol);
                symbolType = type;
            } else {
                // Build a "partial module" to contain the references
                // to the next part of the name.
                const newPartialModule = new ModuleType(new SymbolTable());
                newPartialModule.setIsPartialModule();
                targetSymbolTable.set(name, Symbol.createWithType(newPartialModule, DefaultTypeSourceId));
                targetSymbolTable = newPartialModule.getFields();
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
                    const textRange = new TextRange(nameParts[0].start, nameParts[0].length);
                    if (nameParts.length > 1) {
                        textRange.extend(nameParts[nameParts.length - 1]);
                    }
                    this._fileInfo.diagnosticSink.addUnusedCodeWithTextRange(
                        `'${ multipartName }' is not accessed`, textRange);

                    this._addDiagnostic(this._fileInfo.diagnosticSettings.reportUnusedImport,
                        `Import '${ multipartName }' is not accessed`, textRange);
                }
            }
        }
    }

    private _assignTypeToNameNode(nameNode: NameNode, srcType: Type, declaration?: Declaration,
            srcExpressionNode?: ParseNode) {

        const nameValue = nameNode.nameToken.value;

        // Determine if there's a declared type for this symbol.
        let declaredType: Type | undefined = declaration ? declaration.declaredType : undefined;
        let primaryDecl: Declaration | undefined;

        const symbolWithScope = this._currentScope.lookUpSymbolRecursive(nameValue);
        if (symbolWithScope) {
            const primaryDecls = TypeUtils.getPrimaryDeclarationsForSymbol(symbolWithScope.symbol);
            if (primaryDecls) {
                declaredType = primaryDecls[0].declaredType!;
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
                this._addError(`Expression of type '${ srcType.asString() }' cannot be ` +
                    `assigned to declared type '${ declaredType.asString() }'` + diagAddendum.getString(),
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
                    `'${ nameValue }' is constant and cannot be redefined`,
                    nameNode);
            }
        }

        this._addTypeSourceToNameNode(nameNode, destType, declaration);

        if (declaration) {
            AnalyzerNodeInfo.setDeclarations(nameNode, [declaration]);
        }
    }

    private _addTypeSourceToNameNode(node: NameNode, type: Type, declaration?: Declaration) {
        this._addTypeSourceToName(node.nameToken.value, type,
            AnalyzerNodeInfo.getTypeSourceId(node), declaration);

        this._addAssignmentTypeConstraint(node, type);
    }

    // Finds the nearest permanent scope (as opposed to temporary scope) and
    // adds a new symbol with the specified name if it doesn't already exist.
    private _addSymbolToPermanentScope(name: string) {
        const permanentScope = ScopeUtils.getPermanentScope(this._currentScope);
        assert(permanentScope.getType() !== ScopeType.Temporary);

        let symbol = permanentScope.lookUpSymbol(name);
        if (!symbol) {
            symbol = permanentScope.addSymbol(name, false);
        }

        // Variables that are defined within a module or a class
        // are considered public by default. Don't flag them
        // "not access" unless the name indicates that it's private.
        const scopeType = permanentScope.getType();
        if (scopeType === ScopeType.Class || scopeType === ScopeType.Module) {
            if (!this._isSymbolPrivate(name, scopeType)) {
                symbol.setIsAcccessed();
            }
        }
    }

    private _addTypeSourceToName(name: string, type: Type, typeSourceId: TypeSourceId,
            declaration?: Declaration) {

        const symbolWithScope = this._currentScope.lookUpSymbolRecursive(name);
        if (symbolWithScope) {
            if (symbolWithScope.symbol.setInferredTypeForSource(type, typeSourceId)) {
                if (symbolWithScope.scope.getType() !== ScopeType.Temporary) {
                    this._setAnalysisChanged();
                }
            }

            // Add the declaration if provided.
            if (declaration) {
                symbolWithScope.symbol.addDeclaration(declaration);
            }
        } else {
            // We should never get here!
            assert.fail(`Missing symbol '${ name }'`);
        }
    }

    private _transformTypeForPossibleEnumClass(node: NameNode, typeOfExpr: Type): Type {
        let enumClass = this._getEnclosingEnumClassInfo(node);

        if (enumClass) {
            // The type of each enumerated item is an instance of the enum class.
            return new ObjectType(enumClass);
        }

        return typeOfExpr;
    }

    // If the node is within a class that derives from the metaclass
    // "EnumMeta", we need to treat assignments differently.
    private _getEnclosingEnumClassInfo(node: ParseNode): ClassType | undefined {
        let enclosingClassNode = ParseTreeUtils.getEnclosingClass(node, true);
        if (enclosingClassNode) {
            const enumClass = AnalyzerNodeInfo.getExpressionType(enclosingClassNode) as ClassType;
            assert(enumClass instanceof ClassType);

            // Handle several built-in classes specially. We don't
            // want to interpret their class variables as enumerations.
            if (this._fileInfo.isStubFile) {
                const className = enumClass.getClassName();
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

    private _setDefinitionForMemberName(baseType: Type, memberName: NameNode): void {
        const declarations = this._getDeclarationsForMemberName(baseType, memberName);
        if (declarations.length > 0) {
            AnalyzerNodeInfo.setDeclarations(memberName, declarations);
        }
    }

    private _getDeclarationsForMemberName(baseType: Type, memberName: NameNode): Declaration[] {
        const memberNameValue = memberName.nameToken.value;
        let declarations: Declaration[] = [];

        if (baseType instanceof ObjectType) {
            let classMemberInfo = TypeUtils.lookUpClassMember(
                baseType.getClassType(), memberNameValue);
            if (classMemberInfo) {
                if (classMemberInfo.symbol.hasDeclarations()) {
                    declarations = TypeUtils.getPrimaryDeclarationsForSymbol(classMemberInfo.symbol)!;
                }
            }
        } else if (baseType instanceof ModuleType) {
            let moduleMemberInfo = baseType.getFields().get(memberNameValue);
            if (moduleMemberInfo) {
                if (moduleMemberInfo.hasDeclarations()) {
                    declarations = TypeUtils.getPrimaryDeclarationsForSymbol(moduleMemberInfo)!;
                }
            }
        } else if (baseType instanceof ClassType) {
            let classMemberInfo = TypeUtils.lookUpClassMember(baseType, memberNameValue,
                ClassMemberLookupFlags.SkipInstanceVariables);
            if (classMemberInfo) {
                if (classMemberInfo.symbol.hasDeclarations()) {
                    declarations = TypeUtils.getPrimaryDeclarationsForSymbol(classMemberInfo.symbol)!;
                }
            }
        } else if (baseType instanceof UnionType) {
            for (let t of baseType.getTypes()) {
                declarations = declarations.concat(
                    this._getDeclarationsForMemberName(t, memberName));
            }
        }

        return declarations;
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
    private _enterTemporaryScope(callback: () => void, isConditional?: boolean,
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
                const typeConstraints = tempScope.getTypeConstraints();

                // Dedupe the previous type constraints and make them conditional
                // so the incoming types are combined conditionally with the end-of-loop
                // types.
                const conditionalTCs = TypeConstraintUtils.dedupeTypeConstraints(typeConstraints, true);

                // Add the deduped conditionals back to the loop scope.
                tempScope.clearTypeConstraints();
                tempScope.addTypeConstraints(conditionalTCs);
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
        this._currentScope = prevScope;

        // Unset the parent to allow any other temporary scopes in the
        // chain to be deallocated.
        tempScope.setParent(undefined);

        return tempScope;
    }

    private _enterScope(node: ParseNode, callback: () => void): Scope {
        let prevScope = this._currentScope;
        let newScope = AnalyzerNodeInfo.getScope(node);
        assert(newScope !== undefined);

        let prevParent: Scope | undefined;
        if (!newScope!.isIndependentlyExecutable()) {
            // Temporary reparent the scope in case it is contained
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

        return newScope!;
    }

    private _addWarning(message: string, range: TextRange) {
        this._fileInfo.diagnosticSink.addWarningWithTextRange(message, range);
    }

    private _addError(message: string, textRange: TextRange) {
        this._fileInfo.diagnosticSink.addErrorWithTextRange(message, textRange);
    }

    private _addUnusedCode(textRange: TextRange) {
        this._fileInfo.diagnosticSink.addUnusedCodeWithTextRange('Code is unreachable', textRange);
    }

    private _addUnusedName(nameNode: NameNode) {
        this._fileInfo.diagnosticSink.addUnusedCodeWithTextRange(
            `'${ nameNode.nameToken.value }' is not accessed`, nameNode);
    }

    private _addDiagnostic(diagLevel: DiagnosticLevel, message: string, textRange: TextRange) {
        if (diagLevel === 'error') {
            this._addError(message, textRange);
        } else if (diagLevel === 'warning') {
            this._addWarning(message, textRange);
        }
    }

    private _readTypeFromNodeCache(node: ExpressionNode): Type | undefined {
        let cachedVersion = AnalyzerNodeInfo.getExpressionTypeVersion(node);
        if (cachedVersion === this._analysisVersion) {
            let cachedType = AnalyzerNodeInfo.getExpressionType(node);
            assert(cachedType !== undefined);
            return cachedType!;
        }

        return undefined;
    }

    private _createEvaluator() {
        return new ExpressionEvaluator(this._currentScope,
            this._fileInfo, this._fileInfo.diagnosticSink, node => this._readTypeFromNodeCache(node),
            (node, type) => {
                this._updateExpressionTypeForNode(node, type);
            });
    }

    private _setAnalysisChanged() {
        this._didAnalysisChange = true;
    }
}
