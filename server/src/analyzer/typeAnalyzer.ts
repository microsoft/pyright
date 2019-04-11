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
import { TextRangeDiagnosticSink } from '../common/diagnosticSink';
import { convertOffsetsToRange } from '../common/positionUtils';
import { PythonVersion } from '../common/pythonVersion';
import { TextRange } from '../common/textRange';
import { AssignmentNode, AugmentedAssignmentExpressionNode, BinaryExpressionNode,
    CallExpressionNode, ClassNode, ConstantNode, DecoratorNode, ExceptNode, ExpressionNode,
    ForNode, FunctionNode, IfNode, ImportAsNode, ImportFromNode,
    IndexExpressionNode, LambdaNode, ListComprehensionForNode, ListComprehensionNode,
    MemberAccessExpressionNode, ModuleNode, NameNode, ParameterCategory, ParseNode,
    RaiseNode, ReturnNode, SliceExpressionNode, StarExpressionNode, SuiteNode,
    TernaryExpressionNode, TryNode, TupleExpressionNode, TypeAnnotationExpressionNode,
    UnaryExpressionNode, WhileNode, WithNode, YieldExpressionNode,
    YieldFromExpressionNode } from '../parser/parseNodes';
import { KeywordType } from '../parser/tokenizerTypes';
import { ScopeUtils } from '../scopeUtils';
import { AnalyzerFileInfo } from './analyzerFileInfo';
import { AnalyzerNodeInfo } from './analyzerNodeInfo';
import { EvaluatorFlags, ExpressionEvaluator } from './expressionEvaluator';
import { ExpressionUtils } from './expressionUtils';
import { ImportResult, ImportType } from './importResult';
import { DefaultTypeSourceId, TypeSourceId } from './inferredType';
import { ParseTreeUtils } from './parseTreeUtils';
import { ParseTreeWalker } from './parseTreeWalker';
import { Scope, ScopeType } from './scope';
import { Declaration, Symbol, SymbolCategory, SymbolTable } from './symbol';
import { TypeConstraintBuilder } from './typeConstraint';
import { AnyType, ClassType, ClassTypeFlags, FunctionParameter, FunctionType,
    FunctionTypeFlags, ModuleType, NoneType, ObjectType, OverloadedFunctionType,
    PropertyType, Type, TypeCategory, TypeVarType, UnionType,
    UnknownType } from './types';
import { TypeUtils } from './typeUtils';

interface EnumClassInfo {
    enumClass: ClassType;
    valueType: Type;
}

interface AliasMapEntry {
    alias: string;
    module: 'builtins' | 'collections';
}

// At some point, we'll cut off the analysis passes and assume
// we're making no forward progress. This should happen only
// on the case of bugs in the analyzer.
const MaxAnalysisPassCount = 100;

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
            category: SymbolCategory.Module,
            node: this._moduleNode,
            path: this._fileInfo.filePath,
            range: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } }
        };

        AnalyzerNodeInfo.setDeclaration(this._moduleNode, declaration);

        this.walk(this._moduleNode);

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
            let argType = this._getTypeOfExpression(arg.valueExpression);

            // In some stub files, classes are conditionally defined (e.g. based
            // on platform type). We'll assume that the conditional logic is correct
            // and strip off the "unbound" union.
            if (argType instanceof UnionType) {
                argType = argType.removeUnbound();
            }

            if (!argType.isAny() && argType.category !== TypeCategory.Class &&
                    argType.category !== TypeCategory.Tuple) {

                this._addError(`Argument to class must be a base class`, arg);
                argType = UnknownType.create();
            }

            if (argType instanceof ClassType) {
                // If the class directly derives from NamedTuple (in Python 3.6 or
                // newer), it's considered a dataclass.
                if (this._fileInfo.executionEnvironment.pythonVersion >= PythonVersion.V36) {
                    if (argType.isBuiltIn() && argType.getClassName() === 'NamedTuple') {
                        classType.setIsDataClass();
                    }
                }

                // Validate that the class isn't deriving from itself, creating a
                // circular dependency.
                if (TypeUtils.derivesFromClassRecursive(argType, classType)) {
                    this._addError(`Class cannot derive from itself`, arg);
                    argType = UnknownType.create();
                }
            }

            if (classType.updateBaseClassType(index, argType)) {
                this._setAnalysisChanged();
            }

            // TODO - validate that we are not adding type parameters that
            // are unique type vars but have conflicting names.
            TypeUtils.addTypeVarsToListIfUnique(typeParameters,
                TypeUtils.getTypeVarArgumentsRecursive(argType));
        });

        // Update the type parameters for the class.
        if (classType.setTypeParameters(typeParameters)) {
            this._setAnalysisChanged();
        }

        this._enterScope(node, () => {
            this.walk(node.suite);
        });

        node.decorators.forEach(decoratorNode => {
            const decoratorType = this._getTypeOfExpression(decoratorNode.leftExpression, false);

            // Is this a @dataclass?
            if (decoratorType instanceof OverloadedFunctionType) {
                const overloads = decoratorType.getOverloads();
                if (overloads.length > 0 && overloads[0].type.getBuiltInName() === 'dataclass') {
                    classType.setIsDataClass();
                }
            }
        });

        if (classType.isDataClass()) {
            let evaluator = this._getEvaluator();
            evaluator.synthesizeDataClassMethods(node, classType);
        }

        let declaration: Declaration = {
            category: SymbolCategory.Class,
            node: node.name,
            path: this._fileInfo.filePath,
            range: convertOffsetsToRange(node.name.start, node.name.end, this._fileInfo.lines)
        };

        this._bindNameNodeToType(node.name, classType, declaration);

        this._validateClassMethods(classType);

        this.walkMultiple(node.decorators);
        this.walkMultiple(node.arguments);
        return false;
    }

    visitFunction(node: FunctionNode): boolean {
        // Retrieve the containing class node if the function is a method.
        const containingClassNode = ParseTreeUtils.getContainingClassNode(node);
        const containingClassType = containingClassNode ?
            AnalyzerNodeInfo.getExpressionType(containingClassNode) as ClassType : undefined;

        const functionType = AnalyzerNodeInfo.getExpressionType(node) as FunctionType;
        assert(functionType instanceof FunctionType);

        if (this._fileInfo.isCollectionsStubFile ||
                this._fileInfo.isAbcStubFile ||
                this._fileInfo.isDataClassesStubFile) {

            // Stash away the name of the function since we need to handle
            // 'namedtuple', 'abstractmethod' and 'dataclass' specially.
            functionType.setBuiltInName(node.name.nameToken.value);
        }

        node.parameters.forEach((param, index) => {
            let annotatedType: Type | undefined;
            if (param.typeAnnotation) {
                annotatedType = this._getTypeOfAnnotation(param.typeAnnotation.expression);

                // PEP 484 indicates that if a parameter has a default value of 'None'
                // the type checker should assume that the type is optional (i.e. a union
                // of the specified type and 'None').
                // TODO - tighten this up, perhaps using a config setting
                if (param.defaultValue instanceof ConstantNode) {
                    if (param.defaultValue.token.keywordType === KeywordType.None) {
                        annotatedType = TypeUtils.combineTypes(
                            [annotatedType, NoneType.create()]);
                    }
                }

                if (functionType.setParameterType(index, annotatedType)) {
                    this._setAnalysisChanged();
                }

                if (param.defaultValue) {
                    // Verify that the default value matches the type annotation.
                    let defaultValueType = this._getTypeOfExpression(param.defaultValue);
                    if (annotatedType) {
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

                    this.walk(param.defaultValue);
                }

                this.walk(param.typeAnnotation.expression);
            } else if (index === 0 && (functionType.isInstanceMethod() || functionType.isClassMethod())) {
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
                            } else if (functionType.isClassMethod()) {
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
            }
        });

        if (node.returnTypeAnnotation) {
            const returnType = this._getTypeOfAnnotation(node.returnTypeAnnotation.expression);
            if (functionType.setDeclaredReturnType(returnType)) {
                this._setAnalysisChanged();
            }

            this.walk(node.returnTypeAnnotation.expression);
        } else if (this._fileInfo.isStubFile) {
            // If a return type annotation is missing in a stub file, assume
            // it's an "any" type. In normal source files, we can infer the
            // type from the implementation.
            functionType.setDeclaredReturnType(AnyType.create());
        }

        let functionScope = this._enterScope(node, () => {
            const parameters = functionType.getParameters();
            assert(parameters.length === node.parameters.length);

            // Add the parameters to the scope and bind their types.
            parameters.forEach((param, index) => {
                const paramNode = node.parameters[index];
                if (param.name) {
                    if (param.category === ParameterCategory.Simple) {
                        let declaration: Declaration | undefined;
                        declaration = {
                            category: SymbolCategory.Parameter,
                            node: paramNode,
                            path: this._fileInfo.filePath,
                            range: convertOffsetsToRange(paramNode.start, paramNode.end, this._fileInfo.lines)
                        };
                        let typeSourceId = paramNode ?
                            AnalyzerNodeInfo.getTypeSourceId(paramNode) :
                            DefaultTypeSourceId;

                        // If the type contains type variables, specialize them now
                        // so we conver them to a concrete type (or unknown if there
                        // are is no bound or contraints).
                        const specializedParamType = TypeUtils.specializeType(param.type, undefined);
                        this._bindNameToType(param.name, specializedParamType, typeSourceId, declaration);
                    }
                }
            });

            node.parameters.forEach(param => {
                if (param.name) {
                    // Cache the type for the hover provider.
                    this._getTypeOfExpression(param.name);

                    // Set the declaration on the node for the definition language service.
                    const symbol = this._currentScope.lookUpSymbol(param.name.nameToken.value);
                    if (symbol && symbol.declarations) {
                        AnalyzerNodeInfo.setDeclaration(param.name, symbol.declarations[0]);
                    }
                }
            });

            // If this function is part of a class, add an implied "super" method.
            // TODO - this code assumes the zero-parameter version of super. Another
            // approach will be needed to handle the multi-parameter version which
            // can even be used outside of a class definition.
            let classNode = ParseTreeUtils.getEnclosingClass(node);
            if (classNode) {
                let classType = AnalyzerNodeInfo.getExpressionType(classNode) as ClassType;
                assert(classType !== undefined && classType instanceof ClassType);

                let superType = new FunctionType(FunctionTypeFlags.None);
                superType.addParameter({
                    category: ParameterCategory.VarArgList,
                    name: 'args',
                    type: UnknownType.create()
                });
                superType.addParameter({
                    category: ParameterCategory.VarArgDictionary,
                    name: 'kwargs',
                    type: UnknownType.create()
                });

                if (classType.getBaseClasses().length > 0) {
                    let baseClass = classType.getBaseClasses()[0];
                    if (baseClass.type instanceof ClassType) {
                        superType.setDeclaredReturnType(new ObjectType(baseClass.type));
                    } else {
                        superType.setDeclaredReturnType(UnknownType.create());
                    }
                }

                this._bindNameToType('super', superType, DefaultTypeSourceId);
            }

            this.walk(node.suite);
        });

        if (!this._fileInfo.isStubFile) {
            // Add all of the return and yield types that were found within the function.
            let inferredReturnType = functionType.getInferredReturnType();
            if (inferredReturnType.addSources(functionScope.getReturnType())) {
                this._setAnalysisChanged();
            }

            let inferredYieldType = functionType.getInferredYieldType();
            if (inferredYieldType.addSources(functionScope.getYieldType())) {
                this._setAnalysisChanged();
            }

            // Add the "None" type if the function doesn't always return.
            if (!functionScope.getAlwaysReturnsOrRaises()) {
                if (inferredReturnType.addSource(NoneType.create(), DefaultTypeSourceId)) {
                    this._setAnalysisChanged();
                }

                // If the declared type isn't compatible with 'None', flag an error.
                const declaredReturnType = functionType.getDeclaredReturnType();
                if (declaredReturnType && node.returnTypeAnnotation) {
                    // TODO - for now, ignore this check for generators.
                    if (functionType.getInferredYieldType().getSourceCount() === 0) {

                        // Skip this check for abstract methods.
                        if (!functionType.isAbstractMethod()) {
                            const diagAddendum = new DiagnosticAddendum();
                            if (!TypeUtils.canAssignType(declaredReturnType, NoneType.create(), diagAddendum)) {
                                this._addError(`Function with declared type of ${ declaredReturnType.asString() }` +
                                        ` must return value` + diagAddendum.getString(),
                                    node.returnTypeAnnotation.rawExpression);
                            }
                        }
                    }
                }
            }
        }

        let decoratedType: Type = functionType;

        // TODO - properly handle generator and coroutine types.
        if (node.isAsync || functionScope.getYieldType().getSourceCount() > 0) {
            decoratedType = UnknownType.create();
        }

        // Apply all of the decorators in reverse order.
        let foundUnknown = decoratedType instanceof UnknownType;
        for (let i = node.decorators.length - 1; i >= 0; i--) {
            const decorator = node.decorators[i];

            decoratedType = this._applyDecorator(decoratedType, functionType, decorator, node);
            if (decoratedType instanceof UnknownType) {
                // Report this error only on the first unknown type.
                if (!foundUnknown) {
                    this._addDiagnostic(
                        this._fileInfo.configOptions.reportUntypedFunctionDecorator,
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

        let declaration: Declaration = {
            category: containingClassNode ? SymbolCategory.Method : SymbolCategory.Function,
            node: node.name,
            path: this._fileInfo.filePath,
            range: convertOffsetsToRange(node.name.start, node.name.end, this._fileInfo.lines),
            declaredType: decoratedType
        };
        this._bindNameNodeToType(node.name, decoratedType, declaration);

        if (containingClassNode) {
            if (!functionType.isClassMethod() && !functionType.isStaticMethod()) {
                functionType.setIsInstanceMethod();
            }
            this._validateMethod(node, functionType);
        }

        this._updateExpressionTypeForNode(node.name, functionType);

        this.walkMultiple(node.decorators);
        return false;
    }

    visitLambda(node: LambdaNode): boolean {
        const functionType = new FunctionType(FunctionTypeFlags.None);

        this._enterScope(node, () => {
            node.parameters.forEach(param => {
                if (param.name) {
                    // Cache the type for the hover provider.
                    this._getTypeOfExpression(param.name);

                    // Set the declaration on the node for the definition language service.
                    const symbol = this._currentScope.lookUpSymbol(param.name.nameToken.value);
                    if (symbol && symbol.declarations) {
                        AnalyzerNodeInfo.setDeclaration(param.name, symbol.declarations[0]);
                    }

                    if (param.category === ParameterCategory.Simple) {
                        let declaration: Declaration | undefined;
                        declaration = {
                            category: SymbolCategory.Parameter,
                            node: param,
                            path: this._fileInfo.filePath,
                            range: convertOffsetsToRange(param.start, param.end, this._fileInfo.lines)
                        };
                        const paramType = UnknownType.create();
                        this._bindNameNodeToType(param.name, paramType, declaration);
                    }
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

        // Add a declaration for the hover provider.
        let declaration: Declaration = {
            category: SymbolCategory.Lambda,
            node,
            path: this._fileInfo.filePath,
            range: convertOffsetsToRange(node.start, node.end, this._fileInfo.lines)
        };
        AnalyzerNodeInfo.setDeclaration(node, declaration);

        return false;
    }

    visitCall(node: CallExpressionNode): boolean {
        // Calculate and cache the expression and report
        // any validation errors.
        this._getTypeOfExpression(node);
        return true;
    }

    visitFor(node: ForNode): boolean {
        this.walk(node.sequenceExpression);

        let exprType = this._getTypeOfExpression(node.sequenceExpression);
        if (exprType.category === TypeCategory.Unbound) {
            exprType = UnknownType.create();
        } else {
            // TODO - need to figure out correct type of iterated items.
            exprType = UnknownType.create();
        }

        this._assignTypeToPossibleTuple(node.targetExpression, exprType);

        this.walk(node.targetExpression);
        this.walk(node.forSuite);

        if (node.elseSuite) {
            this.walk(node.elseSuite);
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
                    this.walk(compr.sequenceExpression);

                    // TODO - need to figure out right type for target expression.
                    // let exprType = this._getTypeOfExpression(compr.sequenceExpression);
                    let exprType = UnknownType.create();

                    this._assignTypeToPossibleTuple(compr.targetExpression, exprType);
                    this.walk(compr.targetExpression);
                } else {
                    this.walk(compr.testExpression);
                }
            });

            this.walk(node.baseExpression);
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
            if (item.target) {
                let exprType = this._getTypeOfExpression(item.expression);

                if (exprType instanceof ObjectType) {
                    // If the type has an "__enter__" method, it can return
                    // a type other than its own type.
                    const enterMethodName = node.isAsync ? '__aenter__' : '__enter__';
                    let evaluator = this._getEvaluator();
                    let memberType = evaluator.getTypeFromObjectMember(enterMethodName, exprType);

                    if (memberType) {
                        if (memberType instanceof FunctionType) {
                            exprType = memberType.getEffectiveReturnType();
                        } else if (memberType.isAny()) {
                            exprType = memberType;
                        }
                    }
                }

                this._assignTypeToPossibleTuple(item.target, exprType);
                this.walk(item.target);
            }
        });

        this.walk(node.suite);
        return false;
    }

    visitReturn(node: ReturnNode): boolean {
        let declaredReturnType: Type | undefined;
        let returnType: Type;
        let typeSourceId = DefaultTypeSourceId;

        let enclosingFunctionNode = ParseTreeUtils.getEnclosingFunction(node);
        if (enclosingFunctionNode) {
            let functionType = AnalyzerNodeInfo.getExpressionType(
                enclosingFunctionNode) as FunctionType;

            if (functionType) {
                assert(functionType instanceof FunctionType);

                // TODO - for now, ignore this check for generators.
                if (functionType.getInferredYieldType().getSourceCount() === 0) {
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
            typeSourceId = AnalyzerNodeInfo.getTypeSourceId(node);
        } else {
            // There is no return expression, so "None" is assumed.
            returnType = NoneType.create();
        }

        this._currentScope.getReturnType().addSource(returnType, typeSourceId);

        if (declaredReturnType && !this._currentScope.getAlwaysReturnsOrRaises()) {
            const diagAddendum = new DiagnosticAddendum();

            // Specialize the return type in case it contains references to type variables.
            // These will be replaced with the corresponding constraint or bound types.
            const specializedDeclaredType = TypeUtils.specializeType(declaredReturnType, undefined);
            if (!TypeUtils.canAssignType(specializedDeclaredType, returnType, diagAddendum)) {
                this._addError(
                    `Expression of type '${ returnType.asString() }' cannot be assigned ` +
                        `to return type '${ specializedDeclaredType.asString() }'` + diagAddendum.getString(),
                    node.returnExpression ? node.returnExpression : node);
            }
        }

        this._currentScope.setAlwaysReturns();
        return true;
    }

    visitYield(node: YieldExpressionNode) {
        let yieldType = this._getTypeOfExpression(node.expression);
        let typeSourceId = AnalyzerNodeInfo.getTypeSourceId(node.expression);
        this._currentScope.getYieldType().addSource(yieldType, typeSourceId);

        this._validateYieldType(node.expression, yieldType);

        return true;
    }

    visitYieldFrom(node: YieldFromExpressionNode) {
        // TODO - determine the right type to use for the iteration.
        let yieldType = UnknownType.create();
        let typeSourceId = AnalyzerNodeInfo.getTypeSourceId(node.expression);
        this._currentScope.getYieldType().addSource(yieldType, typeSourceId);

        this._validateYieldType(node.expression, yieldType);

        return true;
    }

    visitRaise(node: RaiseNode): boolean {
        if (this._currentScope.getNestedTryDepth() === 0) {
            this._currentScope.setAlwaysRaises();
        }
        return true;
    }

    visitExcept(node: ExceptNode): boolean {
        if (node.typeExpression) {
            this.walk(node.typeExpression);
        }

        if (node.typeExpression && node.name) {
            this._currentScope.addUnboundSymbol(node.name.nameToken.value);
            let exceptionType = this._getTypeOfExpression(node.typeExpression);

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
                category: SymbolCategory.Variable,
                node: node.name,
                path: this._fileInfo.filePath,
                range: convertOffsetsToRange(node.name.start, node.name.end, this._fileInfo.lines)
            };
            this._bindNameNodeToType(node.name, exceptionType, declaration);
            this._updateExpressionTypeForNode(node.name, exceptionType);
        }

        this.walk(node.exceptSuite);

        return false;
    }

    visitTry(node: TryNode): boolean {
        this._currentScope.incrementNestedTryDepth();
        this.walk(node.trySuite);
        this._currentScope.decrementNestedTryDepth();

        // Wrap the except clauses in a conditional scope
        // so we can throw away any names that are bound
        // in this scope.
        node.exceptClauses.forEach(exceptNode => {
            let exceptScope = this._enterTemporaryScope(() => {
                this.walk(exceptNode);
            }, true);
            exceptScope.markAllSymbolsConditional();
            this._mergeToCurrentScope(exceptScope);
        });

        if (node.elseSuite) {
            let elseScope = this._enterTemporaryScope(() => {
                this.walk(node.elseSuite!);
            }, true);
            elseScope.markAllSymbolsConditional();
            this._mergeToCurrentScope(elseScope);
        }

        if (node.finallySuite) {
            this.walk(node.finallySuite);
        }

        return false;
    }

    visitAssignment(node: AssignmentNode): boolean {
        // Special-case the typing.pyi file, which contains some special
        // types that the type analyzer needs to interpret differently.
        if (this._fileInfo.isTypingStubFile) {
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
                        let specialClassType = new ClassType(assignedName,
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
                                        aliasClass = symbolInfo.currentType;
                                    }
                                }
                            }

                            if (aliasClass instanceof ClassType) {
                                specialClassType.addBaseClass(aliasClass, false);
                                specialClassType.setAliasClass(aliasClass);
                            }
                        }

                        specialType = specialClassType;
                    }
                }

                if (specialType) {
                    let declaration: Declaration = {
                        category: SymbolCategory.Class,
                        node: node.leftExpression,
                        path: this._fileInfo.filePath,
                        range: convertOffsetsToRange(node.leftExpression.start,
                            node.leftExpression.end, this._fileInfo.lines)
                    };
                    this._bindNameNodeToType(node.leftExpression, specialType, declaration);
                    this._updateExpressionTypeForNode(node.leftExpression, specialType);
                    return false;
                }
            }
        }

        let typeOfExpr = this._getTypeOfExpression(node.rightExpression);

        if (!(node.leftExpression instanceof NameNode) ||
                !this._assignTypeForPossibleEnumeration(node.leftExpression, typeOfExpr)) {
            this._assignTypeToPossibleTuple(node.leftExpression, typeOfExpr);
        }

        this.walk(node.rightExpression);
        this.walk(node.leftExpression);
        return false;
    }

    visitAugmentedAssignment(node: AugmentedAssignmentExpressionNode): boolean {
        let leftType = this._getTypeOfExpression(node.leftExpression);
        let rightType = this._getTypeOfExpression(node.rightExpression);

        // TODO - need to verify types
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

    visitStar(node: StarExpressionNode): boolean {
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

    visitName(node: NameNode) {
        let symbolInScope = this._currentScope.lookUpSymbolRecursive(node.nameToken.value);

        if (symbolInScope && symbolInScope.symbol.declarations) {
            // For now, always assume it's the first declaration
            // that applies here. This is correct in all cases except for
            // possibly properties (getters/setters/deleters) and functions
            // (@overload).
            AnalyzerNodeInfo.setDeclaration(node, symbolInScope.symbol.declarations[0]);
        }

        // Call _getTypeOfExpression so the type is cached in the
        // node, allowing it to be accessed for hover and definition
        // information.
        this._getTypeOfExpression(node);
        return true;
    }

    visitMemberAccess(node: MemberAccessExpressionNode) {
        this._getTypeOfExpression(node);

        this._setDefinitionForMemberName(
            this._getTypeOfExpression(node.leftExpression), node.memberName);

        // Walk the leftExpression but not the memberName.
        this.walk(node.leftExpression);
        return false;
    }

    visitImportAs(node: ImportAsNode): boolean {
        let importInfo = AnalyzerNodeInfo.getImportInfo(node.module);
        assert(importInfo !== undefined);

        if (importInfo && importInfo.importFound && importInfo.resolvedPaths.length > 0) {
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
                                category: SymbolCategory.Module,
                                node: importedModule.parseTree,
                                path: implicitImport.path,
                                range: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 }}
                            };

                            let newSymbol = new Symbol(implicitModuleType, DefaultTypeSourceId);
                            newSymbol.declarations = [declaration];
                            moduleFields.set(implicitImport.name, newSymbol);
                        }
                    }
                });

                let moduleDeclaration: Declaration | undefined;
                if (this._fileInfo.importMap[resolvedPath] &&
                        this._fileInfo.importMap[resolvedPath].parseTree) {

                    moduleDeclaration = AnalyzerNodeInfo.getDeclaration(
                        this._fileInfo.importMap[resolvedPath].parseTree);
                }

                if (node.alias) {
                    this._bindNameNodeToType(node.alias, moduleType, moduleDeclaration);
                    this._updateExpressionTypeForNode(node.alias, moduleType);
                } else {
                    this._bindMultiPartModuleNameToType(node.module.nameParts,
                        moduleType, moduleDeclaration);
                }
            }
        }

        return false;
    }

    visitImportFrom(node: ImportFromNode): boolean {
        let importInfo = AnalyzerNodeInfo.getImportInfo(node.module);

        if (importInfo && importInfo.importFound) {
            let resolvedPath = importInfo.resolvedPaths.length > 0 ?
                importInfo.resolvedPaths[importInfo.resolvedPaths.length - 1] : '';

            // Empty list implies "import *"
            if (node.imports.length === 0) {
                let moduleType = this._getModuleTypeForImportPath(importInfo, resolvedPath);
                if (moduleType) {
                    // Import the fields in the module's namespace.
                    const moduleFields = moduleType.getFields();
                    moduleFields.forEach((boundValue, fieldName) => {
                        this._bindNameToType(fieldName, boundValue.inferredType.getType(),
                            DefaultTypeSourceId,
                            boundValue.declarations ? boundValue.declarations[0] : undefined);
                    });

                    // Import the implicit imports in the module's namespace.
                    importInfo.implicitImports.forEach(implicitImport => {
                        let moduleType = this._getModuleTypeForImportPath(importInfo, resolvedPath);
                        if (moduleType) {
                            this._bindNameToType(implicitImport.name, moduleType, DefaultTypeSourceId);
                        }
                    });
                }
            } else {
                node.imports.forEach(importAs => {
                    const name = importAs.name.nameToken.value;
                    let symbolType: Type | undefined;
                    const aliasNode = importAs.alias || importAs.name;
                    let declaration: Declaration | undefined;

                    // Is the name referring to an implicit import?
                    let implicitImport = importInfo!.implicitImports.find(impImport => impImport.name === name);
                    if (implicitImport) {
                        let moduleType = this._getModuleTypeForImportPath(importInfo, implicitImport.path);
                        if (moduleType &&
                                this._fileInfo.importMap[implicitImport.path] &&
                                this._fileInfo.importMap[implicitImport.path].parseTree) {

                            symbolType = moduleType;
                            declaration = AnalyzerNodeInfo.getDeclaration(
                                this._fileInfo.importMap[implicitImport.path].parseTree);
                        }
                    } else {
                        let moduleType = this._getModuleTypeForImportPath(importInfo, resolvedPath);
                        if (moduleType) {
                            const moduleFields = moduleType.getFields();
                            const symbol = moduleFields.get(name);
                            if (symbol) {
                                symbolType = symbol.currentType;
                                if (symbol.declarations) {
                                    declaration = symbol.declarations[0];
                                }
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
                        this._updateExpressionTypeForNode(importAs.name, symbolType);
                    }

                    if (declaration) {
                        AnalyzerNodeInfo.setDeclaration(importAs.name, declaration);
                        if (importAs.alias) {
                            AnalyzerNodeInfo.setDeclaration(importAs.name, declaration);
                        }
                    }

                    this._bindNameNodeToType(aliasNode, symbolType, declaration);
                });
            }
        } else {
            // We were unable to resolve the import. Bind the names (or aliases)
            // to an unknown type.
            if (node.imports.length !== 0) {
                node.imports.forEach(importAs => {
                    const aliasNode = importAs.alias || importAs.name;
                    let symbolType = UnknownType.create();

                    this._updateExpressionTypeForNode(importAs.name, symbolType);
                    if (importAs.alias) {
                        this._updateExpressionTypeForNode(importAs.name, symbolType);
                    }

                    this._bindNameNodeToType(aliasNode, symbolType);
                });
            }
        }

        return false;
    }

    visitTypeAnnotation(node: TypeAnnotationExpressionNode): boolean {
        // Special-case the typing.pyi file, which contains some special
        // types that the type analyzer needs to interpret differently.
        if (this._fileInfo.isTypingStubFile) {
            // Special-case the typing file.
            if (node.valueExpression instanceof NameNode) {
                const assignedName = node.valueExpression.nameToken.value;
                let specialType: Type | undefined;

                const specialTypes = ['Tuple', 'Generic', 'Protocol', 'Callable',
                    'Type', 'ClassVar', 'Final', 'Literal'];
                if (specialTypes.find(t => t === assignedName)) {
                    // Synthesize a class.
                    let specialClassType = new ClassType(assignedName,
                        ClassTypeFlags.BuiltInClass | ClassTypeFlags.SpecialBuiltIn,
                        AnalyzerNodeInfo.getTypeSourceId(node));

                    let aliasClass = ScopeUtils.getBuiltInType(this._currentScope,
                        assignedName.toLowerCase());
                    if (aliasClass instanceof ClassType) {
                        specialClassType.addBaseClass(aliasClass, false);
                        specialClassType.setAliasClass(aliasClass);
                    }

                    specialType = specialClassType;
                }

                if (specialType) {
                    let declaration: Declaration = {
                        category: SymbolCategory.Class,
                        node: node.valueExpression,
                        path: this._fileInfo.filePath,
                        range: convertOffsetsToRange(node.valueExpression.start,
                            node.valueExpression.end, this._fileInfo.lines)
                    };
                    this._bindNameNodeToType(node.valueExpression, specialType, declaration);
                    this._updateExpressionTypeForNode(node.valueExpression, specialType);
                    return false;
                }
            }
        }

        let typeHint = this._getTypeOfAnnotation(node.typeAnnotation.expression);
        if (typeHint) {
            if (!(node.valueExpression instanceof NameNode) ||
                    !this._assignTypeForPossibleEnumeration(node.valueExpression, typeHint)) {
                this._assignTypeToPossibleTuple(node.valueExpression, typeHint);
            }
        }

        this.walk(node.valueExpression);

        // Walk the type expression to fill in the type information
        // for the hover provider.
        this.walk(node.typeAnnotation.expression);

        return false;
    }

    // Validates that any overridden methods contain the same signatures
    // as the original method. Also marks the class as abstract if one or
    // more abstract methods are not overridden.
    private _validateClassMethods(classType: ClassType) {
        if (TypeUtils.doesClassHaveAbstractMethods(classType)) {
            classType.setIsAbstractClass();
        }
    }

    // Transforms the input function type into an output type based on the
    // decorator function described by the decoratorNode.
    private _applyDecorator(inputFunctionType: Type, originalFunctionType: FunctionType,
            decoratorNode: DecoratorNode, node: FunctionNode): Type {

        const decoratorType = this._getTypeOfExpression(
            decoratorNode.leftExpression, false);

        if (decoratorType.isAny()) {
            return decoratorType;
        }

        // Special-case the "overload" because it has no definition.
        if (decoratorType instanceof ClassType && decoratorType.getClassName() === 'overload') {
            let existingSymbol = this._currentScope.lookUpSymbol(node.name.nameToken.value);
            let typeSourceId = AnalyzerNodeInfo.getTypeSourceId(node);
            if (inputFunctionType instanceof FunctionType) {
                if (existingSymbol && existingSymbol.currentType instanceof OverloadedFunctionType) {
                    existingSymbol.currentType.addOverload(typeSourceId, inputFunctionType);
                    return existingSymbol.currentType;
                } else {
                    let newOverloadType = new OverloadedFunctionType();
                    newOverloadType.addOverload(typeSourceId, inputFunctionType);
                    return newOverloadType;
                }
            }
        }

        let evaluator = this._getEvaluator();
        let returnType = evaluator.getTypeFromDecorator(decoratorNode, inputFunctionType);

        // Check for some built-in decorator types with known semantics.
        if (decoratorType instanceof FunctionType) {
            if (decoratorType.getBuiltInName() === 'abstractmethod') {
                originalFunctionType.setIsAbstractMethod();
                return inputFunctionType;
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
                            return new PropertyType(inputFunctionType);
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
                    node.parameters[0].name.nameToken.value !== 'cls') {
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

        let ifScope: Scope | undefined;
        let elseScope: Scope | undefined;
        let ifIsUnconditional = false;
        let elseIsUnconditional = false;

        // Determine if the if condition is always true or always false. If so,
        // we can treat either the if or the else clause as unconditional.
        let constExprValue = ExpressionUtils.evaluateConstantExpression(
            testExpression, this._fileInfo.executionEnvironment);

        // Get and cache the expression type before walking it. This will apply
        // any type constraints along the way.
        this._getTypeOfExpression(testExpression);
        this.walk(testExpression);

        let typeConstraints = this._buildConditionalTypeConstraints(
            testExpression);

        // Push a temporary scope so we can track
        // which variables have been assigned to conditionally.
        ifScope = this._enterTemporaryScope(() => {
            // Add any applicable type constraints.
            if (typeConstraints) {
                typeConstraints.ifConstraints.forEach(constraint => {
                    this._currentScope.addTypeConstraint(constraint);
                });
            }

            this.walk(ifWhileSuite);
        }, true, constExprValue === false);

        // Now handle the else statement if it's present. If there
        // are chained "else if" statements, they'll be handled
        // recursively here.
        if (elseSuite) {
            elseScope = this._enterTemporaryScope(() => {
                // Add any applicable type constraints.
                if (typeConstraints) {
                    typeConstraints.elseConstraints.forEach(constraint => {
                        this._currentScope.addTypeConstraint(constraint);
                    });
                }

                this.walk(elseSuite);
            }, true, constExprValue === true);
        }

        // Evaluate the expression so the expression type is cached.
        this._getTypeOfExpression(testExpression);

        if (constExprValue !== undefined) {
            if (constExprValue) {
                ifIsUnconditional = true;
                elseScope = undefined;
            } else {
                elseIsUnconditional = true;
                ifScope = undefined;
            }
        }

        let ifContributions = ifScope && !ifScope.getAlwaysReturnsOrRaises() ? ifScope : undefined;
        let elseContributions = elseScope && !elseScope.getAlwaysReturnsOrRaises() ? elseScope : undefined;

        // Figure out how to combine the scopes.
        if (ifContributions && elseContributions) {
            // If both an "if" and an "else" scope exist, combine the names from both scopes.
            ifContributions.combineConditionalSymbolTable(elseContributions);
            this._mergeToCurrentScope(ifContributions);
        } else if (ifContributions) {
            // If there's only an "if" scope executed, mark all of its contents as conditional.
            if (!elseScope && !ifIsUnconditional) {
                ifContributions.markAllSymbolsConditional();
            }
            this._mergeToCurrentScope(ifContributions);
        } else if (elseContributions) {
            // If there's only an "else" scope executed, mark all of its contents as conditional.
            if (!ifScope && !elseIsUnconditional) {
                elseContributions.markAllSymbolsConditional();
            }
            this._mergeToCurrentScope(elseContributions);
        } else if (ifScope && elseScope) {
            // If both an if and else clause are executed but they both return or
            // raise an exception, mark the current scope as always returning or
            // raising an exception.
            if (ifScope.getAlwaysRaises() && elseScope.getAlwaysRaises()) {
                this._currentScope.setAlwaysRaises();
            } else {
                this._currentScope.setAlwaysReturns();
            }
        }

        if (ifScope && isWhile && ifIsUnconditional) {
            // If this is an infinite loop, mark it as always raising
            // So we don't assume that we'll fall through and possibly
            // return None at the end of the function.
            this._currentScope.setAlwaysRaises();
        }

        if (typeConstraints) {
            // If the if statement always returns, the else type constraints
            // are in effect after the if/else is complete.
            if (ifScope && ifScope.getAlwaysReturnsOrRaises()) {
                this._currentScope.addTypeConstraints(typeConstraints.elseConstraints);
            }

            if (elseScope && elseScope.getAlwaysReturnsOrRaises()) {
                this._currentScope.addTypeConstraints(typeConstraints.ifConstraints);
            }
        }

        if (ifScope) {
            this._mergeReturnAndYieldTypeToCurrentScope(ifScope);
        }

        if (elseScope) {
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

    private _validateYieldType(node: ParseNode, yieldType: Type) {
        let declaredYieldType: Type | undefined;
        let enclosingFunctionNode = ParseTreeUtils.getEnclosingFunction(node);
        if (enclosingFunctionNode) {
            let functionType = AnalyzerNodeInfo.getExpressionType(
                enclosingFunctionNode) as FunctionType;
            if (functionType) {
                assert(functionType instanceof FunctionType);
                declaredYieldType = functionType.getDeclaredYieldType();
            }
        }

        if (declaredYieldType) {
            const diagAddendum = new DiagnosticAddendum();
            if (!TypeUtils.canAssignType(declaredYieldType, yieldType, diagAddendum)) {
                this._addError(
                    `Expression of type '${ yieldType.asString() }' cannot be assigned ` +
                        `to yield type '${ declaredYieldType.asString() }'` + diagAddendum.getString(),
                    node);
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
        const typeConstraint = TypeConstraintBuilder.buildTypeConstraintForAssignment(
            node, assignmentType);
        if (typeConstraint) {
            this._currentScope.addTypeConstraint(typeConstraint);
        }
    }

    private _bindMemberVariableToType(node: MemberAccessExpressionNode,
            typeOfExpr: Type, isInstanceMember: boolean) {

        let classDef = ParseTreeUtils.getEnclosingClass(node);
        if (!classDef) {
            return;
        }

        this._addAssignmentTypeConstraint(node, typeOfExpr);

        let classType = AnalyzerNodeInfo.getExpressionType(classDef);
        if (classType && classType instanceof ClassType) {
            let memberName = node.memberName.nameToken.value;
            let memberInfo = TypeUtils.lookUpClassMember(classType, memberName);

            let createDeclaration = () => {
                let declaration: Declaration = {
                    category: typeOfExpr instanceof FunctionType ?
                        SymbolCategory.Method : SymbolCategory.Variable,
                    node: node.memberName,
                    path: this._fileInfo.filePath,
                    range: convertOffsetsToRange(node.memberName.start, node.memberName.end, this._fileInfo.lines)
                };
                return declaration;
            };

            const memberFields = isInstanceMember ? classType.getInstanceFields() : classType.getClassFields();

            let addNewMemberToLocalClass = false;
            if (memberInfo) {
                if (memberInfo.class === classType && memberInfo.isInstanceMember === isInstanceMember) {
                    const symbol = memberFields.get(memberName)!;
                    assert(symbol !== undefined);
                    if (symbol.setCurrentType(typeOfExpr, AnalyzerNodeInfo.getTypeSourceId(node.memberName))) {
                        this._setAnalysisChanged();
                    }

                    // If there is no declaration yet, assign one now.
                    let declaration = createDeclaration();
                    symbol.addDeclaration(declaration);
                    AnalyzerNodeInfo.setDeclaration(node.memberName, symbol.declarations![0]);
                } else {
                    // Handle the case where there is a class variable defined with the same
                    // name, but there's also now an instance variable introduced. Combine the
                    // type of the class variable with that of the new instance variable.
                    if (memberInfo.symbol && !memberInfo.isInstanceMember && isInstanceMember) {
                        typeOfExpr = TypeUtils.combineTypes(
                            [typeOfExpr, TypeUtils.getEffectiveTypeOfMember(memberInfo)]);
                    }
                    addNewMemberToLocalClass = true;
                }
            } else {
                // The member name hasn't been seen previously, so add it to the local class.
                addNewMemberToLocalClass = true;
            }

            if (addNewMemberToLocalClass) {
                let newSymbol = new Symbol(typeOfExpr, AnalyzerNodeInfo.getTypeSourceId(node.memberName));
                newSymbol.addDeclaration(createDeclaration());
                memberFields.set(memberName, newSymbol);
                this._setAnalysisChanged();

                AnalyzerNodeInfo.setDeclaration(node.memberName, newSymbol.declarations![0]);
            }
        }
    }

    private _mergeToCurrentScope(scopeToMerge: Scope) {
        if (this._currentScope.mergeSymbolTable(scopeToMerge)) {
            this._setAnalysisChanged();
        }

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
            let moduleNode = this._fileInfo.importMap[path].parseTree;
            if (moduleNode) {
                let moduleType = AnalyzerNodeInfo.getExpressionType(moduleNode) as ModuleType;
                if (moduleType) {
                    return moduleType;
                }
            }
        } else if (importResult) {
            // There was no module even though the import was resolved. This
            // happens in the case of namespace packages, where an __init__.py
            // is not necessarily present. We'll synthesize a module type in
            // this case.
            let symbolTable = new SymbolTable();
            let moduleType = new ModuleType(symbolTable);

            // Add the implicit imports.
            importResult.implicitImports.forEach(implicitImport => {
                let implicitModuleType = this._getModuleTypeForImportPath(
                    undefined, implicitImport.path);
                if (implicitModuleType) {
                    symbolTable.set(implicitImport.name, new Symbol(implicitModuleType, DefaultTypeSourceId));
                }
            });

            return moduleType;
        }

        return undefined;
    }

    private _getTypeOfAnnotation(node: ExpressionNode): Type {
        let evaluator = this._getEvaluator();
        return evaluator.getType(node, EvaluatorFlags.ConvertClassToObject);
    }

    private _getTypeOfExpression(node: ExpressionNode, specialize = true): Type {
        let evaluator = this._getEvaluator();
        return evaluator.getType(node, specialize ? EvaluatorFlags.None : EvaluatorFlags.DoNotSpecialize);
    }

    private _updateExpressionTypeForNode(node: ExpressionNode, exprType: Type) {
        let oldType = AnalyzerNodeInfo.getExpressionType(node);
        AnalyzerNodeInfo.setExpressionTypeVersion(node, this._analysisVersion);

        if (!oldType || !oldType.isSame(exprType)) {
            let replaceType = true;

            // In rare cases, we can run into a situation where an "unknown"
            // is passed back and forth between two variables, preventing
            // us from ever converging. Detect this rare condition here.
            if (this._analysisVersion > CheckForBeatingUnknownPassCount) {
                if (oldType && exprType instanceof UnionType) {
                    let simplifiedExprType = exprType.removeUnknown();
                    if (oldType.isSame(simplifiedExprType)) {
                        replaceType = false;
                    }
                }
            }

            if (replaceType) {
                AnalyzerNodeInfo.setExpressionType(node, exprType);

                this._setAnalysisChanged();
            }
        }
    }

    private _assignTypeToPossibleTuple(target: ExpressionNode, type: Type): void {
        if (target instanceof MemberAccessExpressionNode) {
            let targetNode = target.leftExpression;

            // Handle member accesses (e.g. self.x or cls.y).
            if (targetNode instanceof NameNode) {
                // TODO - we shouldn't rely on these names, which are just conventions.
                if (targetNode.nameToken.value === 'self') {
                    this._bindMemberVariableToType(target, type, true);
                } else if (targetNode.nameToken.value === 'cls') {
                    this._bindMemberVariableToType(target, type, false);
                }
            }

            // TODO - need to validate type compatibility for assignment
        } else if (target instanceof TupleExpressionNode) {
            let assignedTypes = false;

            const tupleType = TypeUtils.getSpecializedTupleType(type);
            if (tupleType && tupleType.getTypeArguments()) {
                const entryTypes = tupleType.getTypeArguments()!;
                if (entryTypes.length !== target.expressions.length) {
                    this._addError(
                        `Tuple size mismatch: expected ${ target.expressions.length }` +
                            ` but got ${ entryTypes.length }`,
                        target);
                } else {
                    target.expressions.forEach((expr, index) => {
                        // TODO - need to perform better type compatibility checking here
                        this._assignTypeToPossibleTuple(expr, entryTypes[index]);
                    });
                    assignedTypes = true;
                }
            }

            if (!assignedTypes) {
                // TODO - need to perform better type compatibility checking here
                target.expressions.forEach(expr => {
                    this._assignTypeToPossibleTuple(expr, UnknownType.create());
                });
            }
        } else if (target instanceof TypeAnnotationExpressionNode) {
            let typeHint = this._getTypeOfAnnotation(target.typeAnnotation.expression);

            const diagAddendum = new DiagnosticAddendum();
            if (!TypeUtils.canAssignType(typeHint, type, diagAddendum)) {
                this._addError(
                    `Expression of type '${ type.asString() }'` +
                        ` cannot be assigned to type '${ typeHint.asString() }'` +
                        diagAddendum.getString(),
                    target.typeAnnotation.expression);
            }

            this._assignTypeToPossibleTuple(target.valueExpression, typeHint);
        } else if (target instanceof StarExpressionNode) {
            if (target.expression instanceof NameNode) {
                let name = target.expression.nameToken;
                let declaration: Declaration = {
                    category: SymbolCategory.Variable,
                    node: target.expression,
                    path: this._fileInfo.filePath,
                    range: convertOffsetsToRange(name.start, name.end, this._fileInfo.lines)
                };
                // TODO - need to figure out right type
                this._bindNameNodeToType(target.expression, type, declaration);
            }
        } else if (target instanceof NameNode) {
            let name = target.nameToken;
            let declaration: Declaration = {
                category: SymbolCategory.Variable,
                node: target,
                path: this._fileInfo.filePath,
                range: convertOffsetsToRange(name.start, name.end, this._fileInfo.lines)
            };
            this._bindNameNodeToType(target, type, declaration);
            this._addAssignmentTypeConstraint(target, type);
        } else {
            this._addAssignmentTypeConstraint(target, type);
        }
    }

    private _bindMultiPartModuleNameToType(nameParts: NameNode[], type: ModuleType,
            declaration?: Declaration): void {
        let targetSymbolTable = this._currentScope.getSymbolTable();
        let symbol = new Symbol(type, DefaultTypeSourceId);
        if (declaration) {
            symbol.addDeclaration(declaration);
        }

        for (let i = 0; i < nameParts.length; i++) {
            let name = nameParts[i].nameToken.value;

            const targetSymbol = targetSymbolTable.get(name);
            if (targetSymbol && targetSymbol.currentType instanceof ModuleType) {
                let moduleType = targetSymbol.currentType;
                const moduleFields = moduleType.getFields();

                // Are we replacing a partial module?
                if (i === nameParts.length - 1 && moduleType.isPartialModule) {
                    // Combine the names in the existing partial module into
                    // the new module's symbol table.
                    moduleFields.getKeys().forEach(name => {
                        type.getFields().set(name, moduleFields.get(name)!);
                    });
                    targetSymbolTable.set(name, symbol);
                }

                targetSymbolTable = moduleFields;
            } else if (i === nameParts.length - 1) {
                targetSymbolTable.set(name, symbol);
                if (declaration) {
                    AnalyzerNodeInfo.setDeclaration(nameParts[i], declaration);
                }
            } else {
                // Build a "partial module" to contain the references
                // to the next part of the name.
                let newPartialModule = new ModuleType(new SymbolTable());
                newPartialModule.setIsPartialModule();
                targetSymbolTable.set(name, new Symbol(newPartialModule, DefaultTypeSourceId));
                targetSymbolTable = newPartialModule.getFields();
            }
        }
    }

    private _bindNameNodeToType(nameNode: NameNode, type: Type, declaration?: Declaration) {
        const name = nameNode.nameToken.value;
        this._bindNameToType(name, type, AnalyzerNodeInfo.getTypeSourceId(nameNode), declaration);

        // Set the declaration on itself so hovering over the definition will
        // provide hover information.
        let symbolDeclaration = declaration;
        if (!symbolDeclaration) {
            // If the caller didn't specify a declaration, look it up.
            const symbolWithScope = this._currentScope.lookUpSymbolRecursive(nameNode.nameToken.value);
            if (symbolWithScope && symbolWithScope.symbol && symbolWithScope.symbol.declarations) {
                symbolDeclaration = symbolWithScope.symbol.declarations[0];
            }
        }
        if (symbolDeclaration) {
            AnalyzerNodeInfo.setDeclaration(nameNode, symbolDeclaration);
        }
    }

    private _bindNameToType(name: string, type: Type, typeSourceId: TypeSourceId,
            declaration?: Declaration) {
        // If this is a temporary scope, it may not yet have the name
        // added. We'll add it here because bindName expects it
        // to be present already.
        if (!this._currentScope.lookUpSymbol(name)) {
            this._currentScope.addUnboundSymbol(name);
        }

        this._currentScope.setSymbolCurrentType(name, type, typeSourceId);
        if (declaration) {
            this._currentScope.addSymbolDeclaration(name, declaration);
        }
    }

    private _assignTypeForPossibleEnumeration(node: NameNode, typeOfExpr?: Type): boolean {
        let enumClassInfo = this._getEnclosingEnumClassInfo(node);
        if (enumClassInfo) {
            const diagAddendum = new DiagnosticAddendum();
            if (typeOfExpr && !TypeUtils.canAssignType(enumClassInfo.valueType, typeOfExpr, diagAddendum)) {
                this._addError(
                    `Expression of type '${ typeOfExpr.asString() }' cannot be assigned ` +
                        `to type '${ enumClassInfo.valueType.asString() }'` + diagAddendum.getString(),
                    node);
            } else {
                // The type of each enumerated item is an instance of the enum class.
                let enumObj = new ObjectType(enumClassInfo.enumClass);
                this._assignTypeToPossibleTuple(node, enumObj);
            }

            return true;
        }

        return false;
    }

    // If the node is within a class that derives from the metaclass
    // "EnumMeta", we need to treat assignments differently.
    private _getEnclosingEnumClassInfo(node: ParseNode): EnumClassInfo | undefined {
        let enclosingClassNode = ParseTreeUtils.getEnclosingClass(node);
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

            let metaclass = TypeUtils.getMetaclass(enumClass);
            if (metaclass && metaclass instanceof ClassType && metaclass.getClassName() === 'EnumMeta') {
                let valueMember = TypeUtils.lookUpClassMember(enumClass, 'value', false);
                let valueType: Type;
                if (valueMember) {
                    valueType = TypeUtils.getEffectiveTypeOfMember(valueMember);
                } else {
                    valueType = UnknownType.create();
                }

                return {
                    enumClass: enumClass,
                    valueType
                };
            }
        }

        return undefined;
    }

    private _setDefinitionForMemberName(baseType: Type, memberName: NameNode): void {
        const memberNameValue = memberName.nameToken.value;

        if (baseType instanceof ObjectType) {
            let classMemberInfo = TypeUtils.lookUpClassMember(
                baseType.getClassType(), memberNameValue);
            if (classMemberInfo) {
                if (classMemberInfo.symbol && classMemberInfo.symbol.declarations) {
                    AnalyzerNodeInfo.setDeclaration(memberName, classMemberInfo.symbol.declarations[0]);
                }
            }
        } else if (baseType instanceof ModuleType) {
            let moduleMemberInfo = baseType.getFields().get(memberNameValue);
            if (moduleMemberInfo && moduleMemberInfo.declarations) {
                AnalyzerNodeInfo.setDeclaration(memberName, moduleMemberInfo.declarations[0]);
            }
        } else if (baseType instanceof ClassType) {
            let classMemberInfo = TypeUtils.lookUpClassMember(baseType, memberNameValue, false);
            if (classMemberInfo && classMemberInfo.symbol && classMemberInfo.symbol.declarations) {
                AnalyzerNodeInfo.setDeclaration(memberName, classMemberInfo.symbol.declarations[0]);
            }
        } else if (baseType instanceof UnionType) {
            for (let t of baseType.getTypes()) {
                this._setDefinitionForMemberName(t, memberName);
            }
        }
    }

    private _buildConditionalTypeConstraints(node: ExpressionNode) {
        return TypeConstraintBuilder.buildTypeConstraintsForConditional(node,
            (node: ExpressionNode) => this._getTypeOfExpression(node));
    }

    private _enterTemporaryScope(callback: () => void, isConditional ? : boolean,
            isNotExecuted ? : boolean) {
        let prevScope = this._currentScope;
        let newScope = new Scope(ScopeType.Temporary, prevScope);
        if (isConditional) {
            newScope.setConditional();
        }
        if (this._currentScope.isNotExecuted() || isNotExecuted) {
            newScope.setIsNotExecuted();
        }
        this._currentScope = newScope;

        callback();

        this._currentScope = prevScope;
        return newScope;
    }

    private _enterScope(node: ParseNode, callback: () => void): Scope {
        let prevScope = this._currentScope;
        let newScope = AnalyzerNodeInfo.getScope(node);
        assert(newScope !== undefined);
        this._currentScope = newScope!;

        // Enter a new temporary scope so we don't pollute the
        // namespace of the permanent scope. For example, if code
        // within a function assigns a value to a globally-bound
        // variable, we want to track the type of that variable
        // within this scope and then combine it back to the
        // global scope at the end, not add it to the function's
        // permanent scope.
        const tempScope = this._enterTemporaryScope(() => {
            callback();
        });
        this._mergeToCurrentScope(tempScope);

        // Clear out any type constraints that were collected
        // during the processing of the scope.
        this._currentScope.clearTypeConstraints();

        this._currentScope = prevScope;

        return newScope!;
    }

    private _addWarning(message: string, range: TextRange) {
        if (!this._currentScope.isNotExecuted()) {
            this._fileInfo.diagnosticSink.addWarningWithTextRange(message, range);
        }
    }

    private _addError(message: string, textRange: TextRange) {
        // Don't emit error if the scope is guaranteed not to be executed.
        if (!this._currentScope.isNotExecuted()) {
            this._fileInfo.diagnosticSink.addErrorWithTextRange(message, textRange);
        }
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

    private _getEvaluator() {
        let diagSink: TextRangeDiagnosticSink | undefined = this._fileInfo.diagnosticSink;

        // If the current scope isn't executed, create a dummy sink
        // for any errors that are reported.
        if (this._currentScope.isNotExecuted()) {
            diagSink = undefined;
        }

        return new ExpressionEvaluator(this._currentScope,
            this._fileInfo.configOptions,
            this._fileInfo.executionEnvironment,
            diagSink, node => this._readTypeFromNodeCache(node),
            (node, type) => {
                this._updateExpressionTypeForNode(node, type);
            });
    }

    private _setAnalysisChanged() {
        this._didAnalysisChange = true;
    }
}
