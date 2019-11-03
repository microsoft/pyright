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
import { AddMissingOptionalToParamAction, DiagnosticAddendum } from '../common/diagnostic';
import { DiagnosticRule } from '../common/diagnosticRules';
import { PythonVersion } from '../common/pythonVersion';
import { TextRange } from '../common/textRange';
import { AssertNode, AssignmentExpressionNode, AssignmentNode, AugmentedAssignmentExpressionNode,
    BinaryExpressionNode, CallExpressionNode, ClassNode, DecoratorNode,
    DelNode, ErrorExpressionNode, ExceptNode, ExpressionNode, FormatStringNode, ForNode,
    FunctionNode, IfNode, ImportAsNode, ImportFromNode, IndexExpressionNode, LambdaNode,
    ListComprehensionNode, MemberAccessExpressionNode, ModuleNode, NameNode, ParameterCategory,
    ParameterNode, ParseNode, ParseNodeType, RaiseNode, ReturnNode, SliceExpressionNode,
    StringListNode, SuiteNode, TernaryExpressionNode, TupleExpressionNode,
    TypeAnnotationExpressionNode, UnaryExpressionNode, UnpackExpressionNode, WhileNode,
    WithNode, YieldExpressionNode, YieldFromExpressionNode } from '../parser/parseNodes';
import { KeywordType } from '../parser/tokenizerTypes';
import { AnalyzerFileInfo } from './analyzerFileInfo';
import * as AnalyzerNodeInfo from './analyzerNodeInfo';
import { FlowFlags } from './codeFlow';
import { DeclarationType, ModuleLoaderActions } from './declaration';
import * as DeclarationUtils from './declarationUtils';
import { createExpressionEvaluator, EvaluatorFlags, ExpressionEvaluator, MemberAccessFlags } from './expressionEvaluator';
import * as ParseTreeUtils from './parseTreeUtils';
import { ParseTreeWalker } from './parseTreeWalker';
import { Scope, ScopeType } from './scope';
import * as ScopeUtils from './scopeUtils';
import * as StaticExpressions from './staticExpressions';
import { Symbol, SymbolFlags, SymbolTable } from './symbol';
import * as SymbolNameUtils from './symbolNameUtils';
import { AnyType, ClassType, combineTypes, FunctionType, isAnyOrUnknown, isNoneOrNever,
    isTypeSame, ModuleType, NoneType, ObjectType, OverloadedFunctionEntry, OverloadedFunctionType,
    printType, PropertyType, removeNoneFromUnion, removeUnboundFromUnion,
    Type, TypeCategory, TypeVarType, UnboundType, UnknownType  } from './types';
import * as TypeUtils from './typeUtils';

interface AliasMapEntry {
    alias: string;
    module: 'builtins' | 'collections' | 'self';
}

// At some point, we'll cut off the analysis passes and assume
// we're making no forward progress. This should happen only
// on the case of bugs in the analyzer.
// The number is somewhat arbitrary. It needs to be at least
// 21 or so to handle all of the import cycles in the stdlib
// files.
const _maxAnalysisPassCount = 25;

export class TypeAnalyzer extends ParseTreeWalker {
    private readonly _moduleNode: ModuleNode;
    private readonly _fileInfo: AnalyzerFileInfo;
    private readonly _evaluator: ExpressionEvaluator;
    private _currentScope: Scope;

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

    constructor(node: ModuleNode, analysisVersion: number) {
        super();

        this._moduleNode = node;
        this._fileInfo = AnalyzerNodeInfo.getFileInfo(node)!;
        this._currentScope = AnalyzerNodeInfo.getScope(node)!;
        this._didAnalysisChange = false;
        this._analysisVersion = analysisVersion;
        this._evaluator = createExpressionEvaluator(
            this._fileInfo.diagnosticSink,
            this._analysisVersion,
            reason => {
                this._setAnalysisChanged(reason);
            });
    }

    analyze() {
        this._didAnalysisChange = false;

        this.walkMultiple(this._moduleNode.statements);

        // Apply the export filter to symbols in this scope's
        // symbol table if an export filter exists.
        this._currentScope.applyExportFilter();

        // If we've already analyzed the file the max number of times,
        // just give up and admit defeat. This should happen only in
        // the case of analyzer bugs.
        if (this.isAtMaxAnalysisPassCount()) {
            return false;
        }

        return this._didAnalysisChange;
    }

    walk(node: ParseNode) {
        if (!this._isCodeUnreachable(node)) {
            super.walk(node);
        }
    }

    isAtMaxAnalysisPassCount() {
        return this._analysisVersion >= _maxAnalysisPassCount;
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
            // Ignore keyword parameters other than metaclass or total.
            if (!arg.name || arg.name.nameToken.value === 'metaclass') {
                let argType = this._getTypeOfExpression(arg.valueExpression);

                // In some stub files, classes are conditionally defined (e.g. based
                // on platform type). We'll assume that the conditional logic is correct
                // and strip off the "unbound" union.
                if (argType.category === TypeCategory.Union) {
                    argType = removeUnboundFromUnion(argType);
                }

                if (!isAnyOrUnknown(argType)) {
                    if (argType.category !== TypeCategory.Class) {
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
                            this._evaluator.addError(`Argument to class must be a base class`, arg);
                            argType = UnknownType.create();
                        }
                    }
                }

                if (argType.category === TypeCategory.Class) {
                    if (ClassType.isBuiltIn(argType, 'Protocol')) {
                        if (!this._fileInfo.isStubFile && this._fileInfo.executionEnvironment.pythonVersion < PythonVersion.V37) {
                            this._evaluator.addError(`Use of 'Protocol' requires Python 3.7 or newer`, arg.valueExpression);
                        }
                    }

                    // If the class directly derives from NamedTuple (in Python 3.6 or
                    // newer), it's considered a dataclass.
                    if (this._fileInfo.executionEnvironment.pythonVersion >= PythonVersion.V36) {
                        if (ClassType.isBuiltIn(argType, 'NamedTuple')) {
                            ClassType.setIsDataClass(classType, false);
                        }
                    }

                    // If the class directly derives from TypedDict or from a class that is
                    // a TypedDict, it is considered a TypedDict.
                    if (ClassType.isBuiltIn(argType, 'TypedDict') || ClassType.isTypedDictClass(argType)) {
                        ClassType.setIsTypedDict(classType);
                    } else if (ClassType.isTypedDictClass(classType) && !ClassType.isTypedDictClass(argType)) {
                        // TypedDict classes must derive only from other
                        // TypedDict classes.
                        this._evaluator.addError(`All base classes for TypedDict classes must ` +
                            'als be TypedDict classes', arg);
                    }

                    // Validate that the class isn't deriving from itself, creating a
                    // circular dependency.
                    if (TypeUtils.derivesFromClassRecursive(argType, classType)) {
                        this._evaluator.addError(`Class cannot derive from itself`, arg);
                        argType = UnknownType.create();
                    }
                }

                if (argType.category === TypeCategory.Unknown ||
                        argType.category === TypeCategory.Union && argType.subtypes.some(t => t.category === TypeCategory.Unknown)) {

                    this._evaluator.addDiagnostic(
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
            } else if (arg.name.nameToken.value === 'total') {
                // The "total" parameter name applies only for TypedDict classes.
                if (ClassType.isTypedDictClass(classType)) {
                    // PEP 589 specifies that the parameter must be either True or False.
                    const constArgValue = StaticExpressions.evaluateStaticBoolExpression(
                            arg.valueExpression, this._fileInfo.executionEnvironment);
                    if (constArgValue === undefined) {
                        this._evaluator.addError('Value for total parameter must be True or False', arg.valueExpression);
                    } else if (!constArgValue) {
                        ClassType.setCanOmitDictValues(classType);
                    }
                }
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
                    this._evaluator.addDiagnostic(
                        this._fileInfo.diagnosticSettings.reportUntypedClassDecorator,
                        DiagnosticRule.reportUntypedClassDecorator,
                        `Untyped class declarator obscures type of class`,
                        node.decorators[i].leftExpression);

                    foundUnknown = true;
                }
            }
        }

        if (ClassType.isDataClass(classType)) {
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

            this._evaluator.synthesizeDataClassMethods(node, classType, skipSynthesizedInit);
        }

        if (ClassType.isTypedDictClass(classType)) {
            this._evaluator.synthesizeTypedDictClassMethods(classType);
        }

        this._evaluator.assignTypeToNameNode(node.name, decoratedType);
        this._validateClassMethods(classType);

        this.walkMultiple(node.decorators);
        this.walkMultiple(node.arguments);

        this._conditionallyReportUnusedName(node.name, true,
            this._fileInfo.diagnosticSettings.reportUnusedClass,
            DiagnosticRule.reportUnusedClass,
            `Class '${ node.name.nameToken.value }' is not accessed`);

        if (ClassType.isTypedDictClass(classType)) {
            this._validateTypedDictClassSuite(node.suite);
        }

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
            asyncType = this._createAwaitableFunction(node, functionType);
        }

        // Apply all of the decorators in reverse order.
        let decoratedType: Type = asyncType;
        let foundUnknown = false;
        for (let i = node.decorators.length - 1; i >= 0; i--) {
            const decorator = node.decorators[i];

            decoratedType = this._applyFunctionDecorator(decoratedType, functionType, decorator);
            if (decoratedType.category === TypeCategory.Unknown) {
                // Report this error only on the first unknown type.
                if (!foundUnknown) {
                    this._evaluator.addDiagnostic(
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
            let concreteAnnotatedType: Type | undefined;
            let defaultValueType: Type | undefined;
            let isNoneWithoutOptional = false;

            if (param.typeAnnotation) {
                annotatedType = this._evaluator.getTypeOfAnnotation(param.typeAnnotation);

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

                concreteAnnotatedType = TypeUtils.specializeType(annotatedType, undefined);
            }

            if (param.defaultValue) {
                defaultValueType = this._getTypeOfExpression(param.defaultValue,
                    EvaluatorFlags.ConvertEllipsisToAny, annotatedType);

                this.walk(param.defaultValue);
            }

            if (param.typeAnnotation && annotatedType) {
                // If there was both a type annotation and a default value, verify
                // that the default value matches the annotation.
                if (param.defaultValue && defaultValueType && concreteAnnotatedType) {
                    const diagAddendum = new DiagnosticAddendum();

                    if (!TypeUtils.canAssignType(concreteAnnotatedType, defaultValueType, diagAddendum, undefined)) {
                        const diag = this._evaluator.addError(
                            `Value of type '${ printType(defaultValueType) }' cannot` +
                                ` be assigned to parameter of type '${ printType(annotatedType) }'` +
                                diagAddendum.getString(),
                            param.defaultValue);

                        if (isNoneWithoutOptional) {
                            const addOptionalAction: AddMissingOptionalToParamAction = {
                                action: 'pyright.addoptionalforparam',
                                offsetOfTypeNode: param.typeAnnotation.start + 1
                            };
                            if (diag) {
                                diag.addAction(addOptionalAction);
                            }
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
                    this._evaluator.addDiagnostic(
                        this._fileInfo.diagnosticSettings.reportUnknownParameterType,
                        DiagnosticRule.reportUnknownParameterType,
                        `Type of '${ param.name.nameToken.value }' is unknown`,
                        param.name);
                }
            }
        });

        if (node.returnTypeAnnotation) {
            const returnType = this._evaluator.getTypeOfAnnotation(node.returnTypeAnnotation);
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
            if (inferredReturnType.category === TypeCategory.Unknown) {
                this._evaluator.addDiagnostic(
                    this._fileInfo.diagnosticSettings.reportUnknownParameterType,
                    DiagnosticRule.reportUnknownParameterType,
                    `Inferred return type is unknown`, node.name);
            } else if (TypeUtils.containsUnknown(inferredReturnType)) {
                this._evaluator.addDiagnostic(
                    this._fileInfo.diagnosticSettings.reportUnknownParameterType,
                    DiagnosticRule.reportUnknownParameterType,
                    `Return type '${ printType(inferredReturnType) }' is partially unknown`,
                    node.name);
            }
        }

        this._enterScope(node, () => {
            const parameters = FunctionType.getParameters(functionType);
            assert(parameters.length === node.parameters.length);

            // Add the parameters to the scope and bind their types.
            parameters.forEach((param, index) => {
                const paramNode = node.parameters[index];
                if (paramNode.name) {
                    const specializedParamType = TypeUtils.specializeType(param.type, undefined);

                    assert(paramNode !== undefined && paramNode.name !== undefined);

                    // If the type contains type variables, specialize them now
                    // so we convert them to a concrete type (or unknown if there
                    // is no bound or constraint).
                    const variadicParamType = this._getVariadicParamType(param.category, specializedParamType);
                    this._addTypeSourceToNameNode(paramNode.name, variadicParamType);
                    this._evaluator.updateExpressionTypeForNode(paramNode.name, variadicParamType);

                    // Cache the type for the hover provider. Don't walk
                    // the default value because it needs to be evaluated
                    // outside of this scope.
                    this.walk(paramNode.name);
                }
            });

            this.walk(node.suite);

            // Validate that the function returns the declared type.
            this._validateFunctionReturn(node, functionType);
        });

        // If there was no decorator, see if there are any overloads provided
        // by previous function declarations.
        if (decoratedType === functionType) {
            const overloadedType = this._addOverloadsToFunctionType(node, decoratedType);
            this._evaluator.assignTypeToNameNode(node.name, overloadedType);
        } else {
            this._evaluator.assignTypeToNameNode(node.name, decoratedType);
        }

        if (containingClassNode) {
            this._validateMethod(node, functionType);
        }

        this.walkMultiple(node.decorators);

        this._conditionallyReportUnusedName(node.name, true,
            this._fileInfo.diagnosticSettings.reportUnusedFunction,
            DiagnosticRule.reportUnusedFunction,
            `Function '${ node.name.nameToken.value }' is not accessed`);

        return false;
    }

    visitLambda(node: LambdaNode): boolean {
        this._getTypeOfExpression(node);

        this._enterScope(node, () => {
            // Walk the children.
            this.walkMultiple([...node.parameters, node.expression]);

            node.parameters.forEach(param => {
                if (param.name) {
                    const paramType = this._getTypeOfExpression(param.name);
                    if (paramType.category === TypeCategory.Unknown) {
                        this._evaluator.addDiagnostic(
                            this._fileInfo.diagnosticSettings.reportUnknownLambdaType,
                            DiagnosticRule.reportUnknownLambdaType,
                            `Type of '${ param.name.nameToken.value }' is unknown`,
                            param.name);
                    } else if (TypeUtils.containsUnknown(paramType)) {
                        this._evaluator.addDiagnostic(
                            this._fileInfo.diagnosticSettings.reportUnknownLambdaType,
                            DiagnosticRule.reportUnknownLambdaType,
                            `Type of '${ param.name.nameToken.value }', ` +
                            `'${ printType(paramType) }', is partially unknown`,
                            param.name);
                    }
                }
            });

            const returnType = this._getTypeOfExpression(node.expression);
            if (returnType.category === TypeCategory.Unknown) {
                this._evaluator.addDiagnostic(
                    this._fileInfo.diagnosticSettings.reportUnknownLambdaType,
                    DiagnosticRule.reportUnknownLambdaType,
                    `Type of lambda expression is unknown`, node.expression);
            } else if (TypeUtils.containsUnknown(returnType)) {
                this._evaluator.addDiagnostic(
                    this._fileInfo.diagnosticSettings.reportUnknownLambdaType,
                    DiagnosticRule.reportUnknownLambdaType,
                    `Type of lambda expression, '${ printType(returnType) }', is partially unknown`,
                    node.expression);
            }
        });

        return false;
    }

    visitCall(node: CallExpressionNode): boolean {
        this._getTypeOfExpression(node);

        this._validateIsInstanceCallNecessary(node);

        if (ParseTreeUtils.isWithinDefaultParamInitializer(node) && !this._fileInfo.isStubFile) {
            this._evaluator.addDiagnostic(
                this._fileInfo.diagnosticSettings.reportCallInDefaultInitializer,
                DiagnosticRule.reportCallInDefaultInitializer,
                `Function calls within default value initializer are not permitted`,
                node);
        }

        return true;
    }

    visitFor(node: ForNode): boolean {
        const iteratorType = this._getTypeOfExpression(node.iterableExpression);
        const iteratedType = this._evaluator.getTypeFromIterable(
            iteratorType, !!node.isAsync, node.iterableExpression, !node.isAsync);

        this._evaluator.assignTypeToExpression(node.targetExpression, iteratedType, node.targetExpression);
        return true;
    }

    visitListComprehension(node: ListComprehensionNode): boolean {
        this._getTypeOfExpression(node);
        return true;
    }

    visitIf(node: IfNode): boolean {
        this._getTypeOfExpression(node.testExpression);
        return true;
    }

    visitWhile(node: WhileNode): boolean {
        this._getTypeOfExpression(node.testExpression);
        return true;
    }

    visitWith(node: WithNode): boolean {
        node.withItems.forEach(item => {
            let exprType = this._getTypeOfExpression(item.expression);

            if (TypeUtils.isOptionalType(exprType)) {
                this._evaluator.addDiagnostic(
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
                    const memberType = this._evaluator.getTypeFromObjectMember(item.expression,
                        subtype, enterMethodName, { method: 'get' }, MemberAccessFlags.None);

                    if (memberType) {
                        let memberReturnType: Type;
                        if (memberType.category === TypeCategory.Function) {
                            memberReturnType = FunctionType.getEffectiveReturnType(memberType);
                        } else {
                            memberReturnType = UnknownType.create();
                        }

                        // For "async while", an implicit "await" is performed.
                        if (node.isAsync) {
                            memberReturnType = this._evaluator.getTypeFromAwaitable(
                                memberReturnType, item);
                        }

                        return memberReturnType;
                    }
                }

                this._evaluator.addError(`Type ${ printType(subtype) } cannot be used ` +
                    `with 'with' because it does not implement '${ enterMethodName }'`,
                    item.expression);
                return UnknownType.create();
            });

            if (item.target) {
                this._evaluator.assignTypeToExpression(item.target, scopedType, item.target);
            }
        });

        return true;
    }

    visitReturn(node: ReturnNode): boolean {
        let returnType: Type;

        const enclosingFunctionNode = ParseTreeUtils.getEnclosingFunction(node);
        const declaredReturnType = enclosingFunctionNode ?
            DeclarationUtils.getFunctionDeclaredReturnType(enclosingFunctionNode) :
            undefined;

        if (node.returnExpression) {
            returnType = this._getTypeOfExpression(node.returnExpression,
                EvaluatorFlags.None, declaredReturnType);
        } else {
            // There is no return expression, so "None" is assumed.
            returnType = NoneType.create();
        }

        if (this._isNodeReachable(node) && enclosingFunctionNode) {
            const functionScope = AnalyzerNodeInfo.getScope(enclosingFunctionNode)!;
            if (functionScope.getReturnType().addSource(returnType, node.id)) {
                this._setAnalysisChanged('Return type changed');
            }

            if (declaredReturnType) {
                if (TypeUtils.isNoReturnType(declaredReturnType)) {
                    this._evaluator.addError(
                        `Function with declared return type 'NoReturn' cannot include a return statement`,
                        node);
                } else {
                    const diagAddendum = new DiagnosticAddendum();

                    // Specialize the return type in case it contains references to type variables.
                    // These will be replaced with the corresponding constraint or bound types.
                    const specializedDeclaredType = TypeUtils.specializeType(declaredReturnType, undefined);
                    if (!TypeUtils.canAssignType(specializedDeclaredType, returnType, diagAddendum)) {
                        this._evaluator.addError(
                            `Expression of type '${ printType(returnType) }' cannot be assigned ` +
                                `to return type '${ printType(specializedDeclaredType) }'` +
                                diagAddendum.getString(),
                            node.returnExpression ? node.returnExpression : node);
                    }
                }
            }
        }

        return true;
    }

    visitYield(node: YieldExpressionNode) {
        const yieldType = node.expression ?
            this._getTypeOfExpression(node.expression) : NoneType.create();

        // Wrap the yield type in an Iterator.
        let adjYieldType = yieldType;
        const iteratorType = ScopeUtils.getBuiltInType(this._currentScope, 'Iterator');
        if (iteratorType.category === TypeCategory.Class) {
            adjYieldType = ObjectType.create(ClassType.cloneForSpecialization(iteratorType, [yieldType]));
        } else {
            adjYieldType = UnknownType.create();
        }

        this._validateYieldType(node, yieldType, adjYieldType);

        return true;
    }

    visitYieldFrom(node: YieldFromExpressionNode) {
        const yieldType = this._getTypeOfExpression(node.expression);
        this._validateYieldType(node, yieldType, yieldType);

        return true;
    }

    visitRaise(node: RaiseNode): boolean {
        const baseExceptionType = ScopeUtils.getBuiltInType(
            this._currentScope, 'BaseException') as ClassType;

        if (node.typeExpression) {
            this._evaluator.markExpressionAccessed(node.typeExpression);

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
                    this._evaluator.addError(`Expected exception class or object` + diagAddendum.getString(), node.typeExpression);
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
                    this._evaluator.addError(`Expected exception object or None` + diagAddendum.getString(), node.valueExpression);
                }
            }
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

                this._addTypeSourceToNameNode(node.name, exceptionType);
                this._evaluator.updateExpressionTypeForNode(node.name, exceptionType);
            }
        }

        if (node.name) {
            // The named target is explicitly unbound when leaving this scope.
            // Use the type source ID of the except node to avoid conflict with
            // the node.name type source.
            this._evaluator.addTypeSourceToName(node, node.name.nameToken.value,
                UnboundType.create(), node.id);
        }

        return true;
    }

    visitAssert(node: AssertNode) {
        if (node.exceptionExpression) {
            this._getTypeOfExpression(node.exceptionExpression);
        }

        this._getTypeOfExpression(node.testExpression);
        return true;
    }

    visitAssignment(node: AssignmentNode): boolean {
        // Special-case the typing.pyi file, which contains some special
        // types that the type analyzer needs to interpret differently.
        if (this._handleTypingStubAssignment(node)) {
            return false;
        }

        // Determine whether there is a declared type.
        const declaredType = this._evaluator.getDeclaredTypeForExpression(node.leftExpression);

        // Evaluate the type of the right-hand side.
        // An assignment of ellipsis means "Any" within a type stub file.
        let srcType = this._getTypeOfExpression(node.rightExpression,
            this._fileInfo.isStubFile ? EvaluatorFlags.ConvertEllipsisToAny : undefined,
            declaredType);

        // Determine if the RHS is a constant boolean expression.
        // If so, assign it a literal type.
        const constExprValue = StaticExpressions.evaluateStaticBoolExpression(
            node.rightExpression, this._fileInfo.executionEnvironment);
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

        if (node.typeAnnotationComment) {
            // Evaluate the annotated type.
            const declaredType = this._evaluator.getTypeOfAnnotation(node.typeAnnotationComment);
            this._validateDeclaredTypeMatches(node.leftExpression, declaredType,
                node.typeAnnotationComment);
        }

        // Class and global variables should always be marked as accessed.
        if (ParseTreeUtils.getEnclosingClassOrModule(node, true)) {
            this._evaluator.markExpressionAccessed(node.leftExpression);
        }

        this._evaluator.assignTypeToExpression(node.leftExpression, effectiveType, node.rightExpression);
        return true;
    }

    visitAssignmentExpression(node: AssignmentExpressionNode): boolean {
        const type = this._getTypeOfExpression(node);

        // Validate that the type can be written back to the LHS.
        this._evaluator.assignTypeToExpression(node.name, type, node.rightExpression);
        return true;
    }

    visitAugmentedAssignment(node: AugmentedAssignmentExpressionNode): boolean {
        // Augmented assignments are technically not expressions but statements
        // in Python, but we'll model them as expressions and rely on the expression
        // evaluator to validate them.
        const type = this._getTypeOfExpression(node);

        // Validate that the type can be written back to the dest.
        this._evaluator.assignTypeToExpression(node.destExpression, type, node.rightExpression);
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
            if (this._evaluator.isAnnotationLiteralValue(node)) {
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
            if (declarations.length > 0 && declarations[0].type === DeclarationType.Variable) {
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
            this._evaluator.markExpressionAccessed(expr);
            this._evaluateExpressionForDeletion(expr);

            if (expr.nodeType === ParseNodeType.Name) {
                const symbolWithScope = this._currentScope.lookUpSymbolRecursive(expr.nameToken.value);
                if (symbolWithScope) {
                    if (symbolWithScope.symbol.hasDeclarations()) {
                        const declType = symbolWithScope.symbol.getDeclarations()[0].type;
                        if (declType === DeclarationType.Function || declType === DeclarationType.Method) {
                            this._evaluator.addError('Del should not be applied to function', expr);
                        } else if (declType === DeclarationType.Class) {
                            this._evaluator.addError('Del should not be applied to class', expr);
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
        if (node.module.nameParts.length === 0) {
            return false;
        }

        let symbolNameNode: NameNode;
        if (node.alias) {
            // The symbol name is defined by the alias.
            symbolNameNode = node.alias;
        } else {
            // There was no alias, so we need to use the first element of
            // the name parts as the symbol.
            symbolNameNode = node.module.nameParts[0];
        }

        // Look up the symbol to find the alias declaration.
        let symbolType: Type | undefined;
        let symbol: Symbol | undefined;
        [symbol, symbolType] = this._getAliasedSymbolTypeForName(symbolNameNode.nameToken.value);
        if (!symbolType) {
            symbolType = UnknownType.create();
        }

        // Is there a cached module type associated with this node? If so, use
        // it instead of the type we just created. This will preserve the
        // symbol accessed flags.
        const cachedModuleType = AnalyzerNodeInfo.getExpressionType(node) as ModuleType;
        if (cachedModuleType && cachedModuleType.category === TypeCategory.Module && symbolType) {
            if (isTypeSame(symbolType, cachedModuleType)) {
                symbolType = cachedModuleType;
            }
        }

        // Cache the module type for subsequent passes.
        AnalyzerNodeInfo.setExpressionType(node, symbolType);

        this._evaluator.assignTypeToNameNode(symbolNameNode, symbolType);

        if (node.alias) {
            this._conditionallyReportUnusedName(symbolNameNode, false,
                this._fileInfo.diagnosticSettings.reportUnusedImport,
                DiagnosticRule.reportUnusedImport,
                `Import '${ node.alias.nameToken.value }' is not accessed`);
        } else {
            if (symbol && !symbol.isAccessed()) {
                const nameParts = node.module.nameParts;
                if (nameParts.length > 0) {
                    const multipartName = nameParts.map(np => np.nameToken.value).join('.');
                    const textRange: TextRange = { start: nameParts[0].start, length: nameParts[0].length };
                    TextRange.extend(textRange, nameParts[nameParts.length - 1]);
                    this._fileInfo.diagnosticSink.addUnusedCodeWithTextRange(
                        `'${ multipartName }' is not accessed`, textRange);

                    this._evaluator.addDiagnostic(this._fileInfo.diagnosticSettings.reportUnusedImport,
                        DiagnosticRule.reportUnusedImport,
                        `Import '${ multipartName }' is not accessed`, textRange);
                }
            }
        }

        return false;
    }

    visitImportFrom(node: ImportFromNode): boolean {
        const importInfo = AnalyzerNodeInfo.getImportInfo(node.module);
        let symbol: Symbol | undefined;
        let symbolType: Type | undefined;

        if (importInfo && importInfo.isImportFound) {
            const resolvedPath = importInfo.resolvedPaths.length > 0 ?
                importInfo.resolvedPaths[importInfo.resolvedPaths.length - 1] : '';

            if (node.isWildcardImport) {
                if (resolvedPath) {
                    // Import the fields in the current scope.
                    const lookupInfo = this._fileInfo.importLookup(resolvedPath);
                    if (lookupInfo) {
                        lookupInfo.symbolTable.forEach((importedSymbol, name) => {
                            if (!importedSymbol.isIgnoredForProtocolMatch()) {
                                [symbol, symbolType] = this._getAliasedSymbolTypeForName(name);
                                if (symbol) {
                                    this._evaluator.addTypeSourceToName(node, name,
                                        symbolType || UnknownType.create(), node.id);
                                }
                            }
                        });
                    }

                    importInfo.implicitImports.forEach(implicitImport => {
                        [symbol, symbolType] = this._getAliasedSymbolTypeForName(implicitImport.name);
                        if (symbol) {
                            this._evaluator.addTypeSourceToName(node, implicitImport.name,
                                symbolType || UnknownType.create(), node.id);
                        }
                    });
                }
            } else {
                node.imports.forEach(importAs => {
                    const aliasNode = importAs.alias || importAs.name;
                    [symbol, symbolType] = this._getAliasedSymbolTypeForName(aliasNode.nameToken.value);
                    if (!symbolType) {
                        this._evaluator.addError(
                            `'${ importAs.name.nameToken.value }' is unknown import symbol`,
                            importAs.name
                        );
                        symbolType = UnknownType.create();
                    }

                    this._evaluator.addTypeSourceToName(node, aliasNode.nameToken.value,
                        symbolType, node.id);
                    this._evaluator.assignTypeToNameNode(aliasNode, symbolType);
                });
            }
        }

        if (!node.isWildcardImport) {
            node.imports.forEach(importAs => {
                const aliasNode = importAs.alias || importAs.name;
                // Python files generated by protoc ("_pb2.py" files) contain
                // unused imports. Don't report these because they're in generated
                // files that shouldn't be edited.
                if ((!importInfo || importInfo.importName !== '__future__') &&
                        !this._fileInfo.filePath.endsWith('_pb2.py')) {

                    this._conditionallyReportUnusedName(aliasNode, false,
                        this._fileInfo.diagnosticSettings.reportUnusedImport,
                        DiagnosticRule.reportUnusedImport,
                        `Import '${ aliasNode.nameToken.value }' is not accessed`);
                }
            });
        }

        return false;
    }

    visitTypeAnnotation(node: TypeAnnotationExpressionNode): boolean {
        // Evaluate the annotated type.
        let declaredType = this._evaluator.getTypeOfAnnotation(node.typeAnnotation);

        // If this is within an enum, transform the type.
        if (node.valueExpression && node.valueExpression.nodeType === ParseNodeType.Name) {
            declaredType = this._transformTypeForPossibleEnumClass(
                node.valueExpression, declaredType);
        }

        // If this annotation isn't part of an assignment operation,
        // update the type on the name node for the hover provider.
        // If it's part of an assignment operation, the assignment
        // operation will set the type.
        if (node.parent && node.parent.nodeType !== ParseNodeType.Assignment) {
            this._evaluator.updateExpressionTypeForNode(node.valueExpression, declaredType);
        }

        this._validateDeclaredTypeMatches(node.valueExpression, declaredType,
            node.typeAnnotation);

        // Class and global variables should always be marked as accessed.
        if (ParseTreeUtils.getEnclosingClassOrModule(node, true)) {
            this._evaluator.markExpressionAccessed(node.valueExpression);
        }

        return true;
    }

    visitError(node: ErrorExpressionNode) {
        // Get the type of the child so it's available to
        // the completion provider.
        if (node.child) {
            this._getTypeOfExpression(node.child);
        }

        // Don't explore further.
        return false;
    }

    private _getAliasedSymbolTypeForName(name: string): [Symbol | undefined, Type | undefined] {
        const symbolWithScope = this._currentScope.lookUpSymbolRecursive(name);
        if (!symbolWithScope) {
            return [undefined, undefined];
        }

        const aliasDecl = symbolWithScope.symbol.getDeclarations().find(
            decl => decl.type === DeclarationType.Alias);

        let symbolType: Type | undefined;
        if (aliasDecl && aliasDecl.type === DeclarationType.Alias) {
            if (aliasDecl.symbolName && aliasDecl.path) {
                const lookupResults = this._fileInfo.importLookup(aliasDecl.path);
                if (lookupResults) {
                    const symbol = lookupResults.symbolTable.get(aliasDecl.symbolName);
                    if (symbol) {
                        symbolType = TypeUtils.getEffectiveTypeOfSymbol(symbol);
                    }
                }
            }

            // If there was no symbol in the target module with the
            // imported symbol name, see if there's a submodule that
            // contains that name.
            if (!symbolType) {
                // Build a module type that corresponds to the declaration and
                // its associated loader actions.
                const moduleType = ModuleType.create();
                if (aliasDecl.symbolName) {
                    if (aliasDecl.submoduleFallback) {
                        symbolType = this._applyLoaderActionsToModuleType(
                            moduleType, aliasDecl.symbolName && aliasDecl.submoduleFallback ?
                                aliasDecl.submoduleFallback : aliasDecl);
                    }
                } else {
                    symbolType = this._applyLoaderActionsToModuleType(moduleType, aliasDecl);
                }
            }
        }

        return [symbolWithScope ? symbolWithScope.symbol : undefined, symbolType];
    }

    private _applyLoaderActionsToModuleType(moduleType: ModuleType, loaderActions: ModuleLoaderActions): Type {
        if (loaderActions.path) {
            const lookupResults = this._fileInfo.importLookup(loaderActions.path);
            if (lookupResults) {
                moduleType.fields = lookupResults.symbolTable;
                moduleType.docString = lookupResults.docString;
            } else {
                return UnknownType.create();
            }
        }

        if (loaderActions.implicitImports) {
            loaderActions.implicitImports.forEach((implicitImport, name) => {
                // Recursively apply loader actions.
                const importedModuleType = ModuleType.create();
                const symbolType = this._applyLoaderActionsToModuleType(importedModuleType, implicitImport);

                const importedModuleSymbol = Symbol.createWithType(SymbolFlags.None, symbolType);
                moduleType.loaderFields.set(name, importedModuleSymbol);
            });
        }

        return moduleType;
    }

    // Validates that a call to isinstance or issubclass are necessary. This is a
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
                (node.leftExpression.nameToken.value !== 'isinstance' &&
                    node.leftExpression.nameToken.value !== 'issubclass') ||
                node.arguments.length !== 2) {
            return;
        }

        const callName = node.leftExpression.nameToken.value;
        const isInstanceCheck = callName === 'isinstance';
        const arg0Type = TypeUtils.doForSubtypes(
            this._getTypeOfExpression(node.arguments[0].valueExpression),
                subtype => {

            return TypeUtils.transformTypeObjectToClass(subtype);
        });

        if (isAnyOrUnknown(arg0Type)) {
            return;
        }

        const arg1Type = this._getTypeOfExpression(node.arguments[1].valueExpression);

        const classTypeList: ClassType[] = [];
        if (arg1Type.category === TypeCategory.Class) {
            classTypeList.push(arg1Type);
        } else if (arg1Type.category === TypeCategory.Object) {
            // The isinstance and issubclass call supports a variation where the second
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

        const filterType = (varType: ClassType): (ObjectType[] | ClassType[]) => {
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

            if (!isInstanceCheck) {
                return filteredTypes;
            }

            return filteredTypes.map(t => ObjectType.create(t));
        };

        let filteredType: Type;
        if (isInstanceCheck && arg0Type.category === TypeCategory.Object) {
            const remainingTypes = filterType(arg0Type.classType);
            filteredType = finalizeFilteredTypeList(remainingTypes);
        } else if (!isInstanceCheck && arg0Type.category === TypeCategory.Class) {
            const remainingTypes = filterType(arg0Type);
            filteredType = finalizeFilteredTypeList(remainingTypes);
        } else if (arg0Type.category === TypeCategory.Union) {
            let remainingTypes: Type[] = [];
            let foundAnyType = false;

            arg0Type.subtypes.forEach(t => {
                if (isAnyOrUnknown(t)) {
                    foundAnyType = true;
                }

                if (isInstanceCheck && t.category === TypeCategory.Object) {
                    remainingTypes = remainingTypes.concat(filterType(t.classType));
                } else if (!isInstanceCheck && t.category === TypeCategory.Class) {
                    remainingTypes = remainingTypes.concat(filterType(t));
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

        const callType = isInstanceCheck ? 'instance' : 'subclass';
        if (filteredType.category === TypeCategory.Never) {
            this._evaluator.addDiagnostic(
                this._fileInfo.diagnosticSettings.reportUnnecessaryIsInstance,
                DiagnosticRule.reportUnnecessaryIsInstance,
                `Unnecessary ${ callName } call: '${ printType(arg0Type) }' ` +
                    `is never ${ callType } of '${ printType(getTestType()) }'`,
                node);
        } else if (isTypeSame(filteredType, arg0Type)) {
            this._evaluator.addDiagnostic(
                this._fileInfo.diagnosticSettings.reportUnnecessaryIsInstance,
                DiagnosticRule.reportUnnecessaryIsInstance,
                `Unnecessary ${ callName } call: '${ printType(arg0Type) }' ` +
                    `is always ${ callType } of '${ printType(getTestType()) }'`,
                node);
        }
    }

    // Handles some special-case assignment statements that are found
    // within the typings.pyi file.
    private _handleTypingStubAssignment(node: AssignmentNode): boolean {
        if (!this._fileInfo.isTypingStubFile) {
            return false;
        }

        let nameNode: NameNode | undefined;
        if (node.leftExpression.nodeType === ParseNodeType.Name) {
            nameNode = node.leftExpression;
        } else if (node.leftExpression.nodeType === ParseNodeType.TypeAnnotation &&
            node.leftExpression.valueExpression.nodeType === ParseNodeType.Name) {
            nameNode = node.leftExpression.valueExpression;
        }

        if (nameNode) {
            const assignedName = nameNode.nameToken.value;
            let specialType: Type | undefined;

            if (assignedName === 'Any') {
                specialType = AnyType.create();
            } else {
                const specialTypes: { [name: string]: AliasMapEntry } = {
                    'overload': { alias: '', module: 'builtins' },
                    'TypeVar': { alias: '', module: 'builtins' },
                    '_promote': { alias: '', module: 'builtins' },
                    'no_type_check': { alias: '', module: 'builtins' },
                    'NoReturn': { alias: '', module: 'builtins' },
                    'Union': { alias: '', module: 'builtins' },
                    'Optional': { alias: '', module: 'builtins' },
                    'List': { alias: 'list', module: 'builtins' },
                    'Dict': { alias: 'dict', module: 'builtins' },
                    'DefaultDict': { alias: 'defaultdict', module: 'collections' },
                    'Set': { alias: 'set', module: 'builtins' },
                    'FrozenSet': { alias: 'frozenset', module: 'builtins' },
                    'Deque': { alias: 'deque', module: 'collections' },
                    'ChainMap': { alias: 'ChainMap', module: 'collections' },
                    'Tuple': { alias: 'tuple', module: 'builtins' },
                    'Generic': { alias: '', module: 'builtins' },
                    'Protocol': { alias: '', module: 'builtins' },
                    'Callable': { alias: '', module: 'builtins' },
                    'Type': { alias: 'type', module: 'builtins' },
                    'ClassVar': { alias: '', module: 'builtins' },
                    'Final': { alias: '', module: 'builtins' },
                    'Literal': { alias: '', module: 'builtins' },
                    'TypedDict': { alias: '_TypedDict', module: 'self' }
                };

                const aliasMapEntry = specialTypes[assignedName];
                if (aliasMapEntry) {
                    // The binder should have already synthesized the class.
                    const specialClassType = AnalyzerNodeInfo.getExpressionType(nameNode)!;
                    assert(specialClassType !== undefined && specialClassType.category === TypeCategory.Class);
                    specialType = specialClassType;

                    const baseClassName = aliasMapEntry.alias ? aliasMapEntry.alias : 'object';

                    let aliasClass: Type | undefined;
                    if (aliasMapEntry.module === 'builtins') {
                        aliasClass = ScopeUtils.getBuiltInType(this._currentScope, baseClassName);
                    } else if (aliasMapEntry.module === 'collections') {
                        // The typing.pyi file imports collections.
                        const collectionsSymbolTable = this._findCollectionsImportSymbolTable();
                        if (collectionsSymbolTable) {
                            const symbol = collectionsSymbolTable.get(baseClassName);
                            if (symbol) {
                                aliasClass = TypeUtils.getEffectiveTypeOfSymbol(symbol);
                            }
                        }
                    } else if (specialTypes[assignedName].module === 'self') {
                        const symbolWithScope = this._currentScope.lookUpSymbolRecursive(baseClassName);
                        if (symbolWithScope) {
                            aliasClass = TypeUtils.getEffectiveTypeOfSymbol(symbolWithScope.symbol);
                        }
                    }

                    if (aliasClass && aliasClass.category === TypeCategory.Class &&
                            specialClassType.category === TypeCategory.Class) {

                        if (ClassType.updateBaseClassType(specialClassType, 0, aliasClass)) {
                            this._setAnalysisChanged('Base class update for special type');
                        }

                        if (aliasMapEntry.alias) {
                            ClassType.setAliasClass(specialClassType, aliasClass);
                        }
                    }
                }
            }

            if (specialType) {
                this._evaluator.assignTypeToNameNode(nameNode, specialType);
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
            this._evaluator.addDiagnostic(diagLevel, rule, message, node);
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

        let primaryDeclaration = declarations && declarations.length > 0 ?
            declarations[0] : undefined;
        if (!primaryDeclaration || primaryDeclaration.node === node) {
            return;
        }

        primaryDeclaration = DeclarationUtils.resolveAliasDeclaration(primaryDeclaration,
            this._fileInfo.importLookup);
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
                this._evaluator.addDiagnostic(
                    this._fileInfo.diagnosticSettings.reportPrivateUsage,
                    DiagnosticRule.reportPrivateUsage,
                    `'${ nameValue }' is protected and used outside of a derived class`,
                    node);
            } else {
                const scopeName = classOrModuleNode.nodeType === ParseNodeType.Class ?
                    'class' : 'module';

                this._evaluator.addDiagnostic(
                    this._fileInfo.diagnosticSettings.reportPrivateUsage,
                    DiagnosticRule.reportPrivateUsage,
                    `'${ nameValue }' is private and used outside of the ${ scopeName } in which it is declared`,
                    node);
            }
        }
    }

    // Verifies the rules specified in PEP 589 about TypedDict classes.
    // They cannot have statements other than type annotations, doc
    // strings, and "pass" statements or ellipses.
    private _validateTypedDictClassSuite(suiteNode: SuiteNode) {
        const emitBadStatementError = (node: ParseNode) => {
            this._evaluator.addError(`TypedDict classes can contain only type annotations`,
                node);
        };

        suiteNode.statements.forEach(statement => {
            if (!this._isCodeUnreachable(statement)) {
                if (statement.nodeType === ParseNodeType.StatementList) {
                    for (const substatement of statement.statements) {
                        if (substatement.nodeType !== ParseNodeType.TypeAnnotation &&
                                substatement.nodeType !== ParseNodeType.Ellipsis &&
                                substatement.nodeType !== ParseNodeType.StringList &&
                                substatement.nodeType !== ParseNodeType.Pass) {

                            emitBadStatementError(substatement);
                        }
                    }
                } else {
                    emitBadStatementError(statement);
                }
            }
        });
    }

    private _isCodeUnreachable(node: ParseNode): boolean {
        let curNode: ParseNode | undefined = node;

        // Walk up the parse tree until we find a node with
        // an associated flow node.
        while (curNode) {
            const flowNode = AnalyzerNodeInfo.getFlowNode(curNode);
            if (flowNode) {
                return !!(flowNode.flags & FlowFlags.Unreachable);
            }
            curNode = curNode.parent;
        }

        return false;
    }

    private _createAwaitableFunction(node: FunctionNode, functionType: FunctionType): FunctionType {
        const returnType = FunctionType.getEffectiveReturnType(functionType);

        let awaitableReturnType: Type | undefined;

        if (returnType.category === TypeCategory.Object) {
            const classType = returnType.classType;
            if (ClassType.isBuiltIn(classType)) {
                if (ClassType.getClassName(classType) === 'Generator') {
                    // If the return type is a Generator, change it to an AsyncGenerator.
                    const asyncGeneratorType = this._evaluator.getTypingType(node, 'AsyncGenerator');
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
            const awaitableType = this._evaluator.getTypingType(node, 'Awaitable');
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

    private _validateFunctionReturn(node: FunctionNode, functionType: FunctionType) {
        // Stub files are allowed not to return an actual value,
        // so skip this if it's a stub file.
        if (this._fileInfo.isStubFile) {
            return;
        }

        const declaredReturnType = FunctionType.isGenerator(functionType) ?
            TypeUtils.getDeclaredGeneratorReturnType(functionType) :
            FunctionType.getDeclaredReturnType(functionType);

        const inferredReturnType = FunctionType.getInferredReturnType(functionType);
        const inferredYieldType = FunctionType.getInferredYieldType(functionType);

        // If there was no return type declared, infer the return type.
        if (!declaredReturnType) {
            if (inferredReturnType.addSources(this._currentScope.getReturnType())) {
                this._setAnalysisChanged('Function return inferred type changed');
            }
        }

        // Inferred yield types need to be wrapped in a Generator to
        // produce the final result.
        const generatorType = this._evaluator.getTypingType(node, 'Generator');
        if (generatorType && generatorType.category === TypeCategory.Class) {
            inferredYieldType.setGenericClassWrapper(generatorType);
        }

        if (inferredYieldType.addSources(this._currentScope.getYieldType())) {
            this._setAnalysisChanged('Function yield type changed');
        }

        const functionNeverReturns = !this._evaluator.isAfterNodeReachable(node);
        const implicitlyReturnsNone = this._evaluator.isAfterNodeReachable(node.suite);

        // If the function always raises and never returns, add
        // the "NoReturn" type. Skip this for abstract methods which
        // often are implemented with "raise NotImplementedError()".
        if (functionNeverReturns && !FunctionType.isAbstractMethod(functionType)) {
            const noReturnType = this._evaluator.getTypingType(node, 'NoReturn') as ClassType;
            if (noReturnType && inferredReturnType.addSource(ObjectType.create(noReturnType), node.id)) {
                this._setAnalysisChanged('Function inferred NoReturn changed');
            }
        } else {
            // Add the "None" type if the function doesn't always return.
            if (implicitlyReturnsNone) {
                if (inferredReturnType.addSource(NoneType.create(), node.id)) {
                    this._setAnalysisChanged('Function inferred None changed');
                }

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
                                this._evaluator.addError(`Function with declared type of '${ printType(declaredReturnType) }'` +
                                        ` must return value` + diagAddendum.getString(),
                                    node.returnTypeAnnotation);
                            }
                        }
                    }
                }
            } else {
                if (inferredReturnType.removeSource(node.id)) {
                    this._setAnalysisChanged('Function inferred return type changed');
                }
            }
        }

        if (node.returnTypeAnnotation) {
            const declaredReturnType = FunctionType.getDeclaredReturnType(functionType);
            if (declaredReturnType && TypeUtils.isNoReturnType(declaredReturnType)) {
                if (!functionNeverReturns && implicitlyReturnsNone) {
                    // If the function consists entirely of "...", assume that it's
                    // an abstract method or a protocol method and don't require that
                    // the return type matches.
                    if (!ParseTreeUtils.isSuiteEmpty(node.suite)) {
                        this._evaluator.addError(`Function with declared type of 'NoReturn' cannot return 'None'`,
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
                                this._evaluator.addDiagnostic(
                                    this._fileInfo.diagnosticSettings.reportIncompatibleMethodOverride,
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
                                const value = StaticExpressions.evaluateStaticBoolExpression(
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

        return this._evaluator.getTypeFromDecorator(decoratorNode, inputClassType);
    }

    // Transforms the input function type into an output type based on the
    // decorator function described by the decoratorNode.
    private _applyFunctionDecorator(inputFunctionType: Type, originalFunctionType: FunctionType,
            decoratorNode: DecoratorNode): Type {

        const decoratorType = this._getTypeOfExpression(decoratorNode.leftExpression);

        // Special-case the "overload" because it has no definition.
        if (decoratorType.category === TypeCategory.Class && ClassType.getClassName(decoratorType) === 'overload') {
            if (inputFunctionType.category === TypeCategory.Function) {
                FunctionType.setIsOverloaded(inputFunctionType);
                return inputFunctionType;
            }
        }

        const returnType = this._evaluator.getTypeFromDecorator(decoratorNode, inputFunctionType);

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

                    case 'property':
                    case 'abstractproperty': {
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
                this._evaluator.addError(
                    `The __new__ override should take a 'cls' parameter`,
                    node.parameters.length > 0 ? node.parameters[0] : node.name);
            }
        } else if (node.name && node.name.nameToken.value === '__init_subclass__') {
            // __init_subclass__ overrides should have a "cls" parameter.
            if (node.parameters.length === 0 || !node.parameters[0].name ||
                    node.parameters[0].name.nameToken.value !== 'cls') {
                this._evaluator.addError(
                    `The __init_subclass__ override should take a 'cls' parameter`,
                    node.parameters.length > 0 ? node.parameters[0] : node.name);
            }
        } else if (FunctionType.isStaticMethod(functionType)) {
            // Static methods should not have "self" or "cls" parameters.
            if (node.parameters.length > 0 && node.parameters[0].name) {
                const paramName = node.parameters[0].name.nameToken.value;
                if (paramName === 'self' || paramName === 'cls') {
                    this._evaluator.addError(
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
                    this._evaluator.addError(
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
                        this._evaluator.addError(
                            `Instance methods should take a 'self' parameter`,
                            node.parameters.length > 0 ? node.parameters[0] : node.name);
                    }
                }
            }
        }
    }

    private _findCollectionsImportSymbolTable(): SymbolTable | undefined {
        if (this._fileInfo.collectionsModulePath) {
            const lookupResult = this._fileInfo.importLookup(this._fileInfo.collectionsModulePath);
            if (lookupResult) {
                return lookupResult.symbolTable;
            }
        }

        return undefined;
    }

    private _validateYieldType(node: YieldExpressionNode | YieldFromExpressionNode,
            rawYieldType: Type, adjustedYieldType: Type) {

        let declaredYieldType: Type | undefined;
        const enclosingFunctionNode = ParseTreeUtils.getEnclosingFunction(node);

        if (enclosingFunctionNode) {
            const functionScope = AnalyzerNodeInfo.getScope(enclosingFunctionNode)!;
            if (functionScope.getYieldType().addSource(rawYieldType, node.id)) {
                this._setAnalysisChanged('Yield type changed');
            }

            const functionType = AnalyzerNodeInfo.getExpressionType(
                enclosingFunctionNode) as FunctionType;
            if (functionType) {
                assert(functionType.category === TypeCategory.Function);
                const iteratorType = ScopeUtils.getBuiltInType(this._currentScope, 'Iterator');
                declaredYieldType = TypeUtils.getDeclaredGeneratorYieldType(functionType, iteratorType);
            }
        }

        if (this._isNodeReachable(node)) {
            if (declaredYieldType) {
                if (TypeUtils.isNoReturnType(declaredYieldType)) {
                    this._evaluator.addError(
                        `Function with declared return type 'NoReturn' cannot include a yield statement`,
                        node);
                } else {
                    const diagAddendum = new DiagnosticAddendum();
                    if (!TypeUtils.canAssignType(declaredYieldType, adjustedYieldType, diagAddendum)) {
                        this._evaluator.addError(
                            `Expression of type '${ printType(adjustedYieldType) }' cannot be assigned ` +
                                `to yield type '${ printType(declaredYieldType) }'` + diagAddendum.getString(),
                            node.expression || node);
                    }
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
            const iterableType = this._evaluator.getTypeFromIterable(
                exceptionType, false, errorNode, false);

            resultingExceptionType = TypeUtils.doForSubtypes(iterableType, subtype => {
                if (isAnyOrUnknown(subtype)) {
                    return subtype;
                }

                const transformedSubtype = TypeUtils.transformTypeObjectToClass(subtype);
                if (transformedSubtype.category === TypeCategory.Class) {
                    if (!derivesFromBaseException(transformedSubtype)) {
                        isValidExceptionType = false;
                        diagAddendum.addMessage(
                            `'${ printType(exceptionType) }' does not derive from BaseException`);
                    }

                    return ObjectType.create(transformedSubtype);
                }

                isValidExceptionType = false;
                diagAddendum.addMessage(
                    `'${ printType(exceptionType) }' does not derive from BaseException`);
                return UnknownType.create();
            });
        }

        if (!isValidExceptionType) {
            this._evaluator.addError(
                `'${ printType(exceptionType) }' is not valid exception class` +
                    diagAddendum.getString(),
                errorNode);
        }

        return resultingExceptionType || UnknownType.create();
    }

    private _isNodeReachable(node: ParseNode): boolean {
        return this._evaluator.isNodeReachable(node);
    }

    private _getTypeOfExpression(node: ExpressionNode, flags = EvaluatorFlags.None, expectedType?: Type): Type {
        return this._evaluator.getType(node, { method: 'get', expectedType }, flags);
    }

    private _evaluateExpressionForDeletion(node: ExpressionNode): Type {
        return this._evaluator.getType(node, { method: 'del' }, EvaluatorFlags.None);
    }

    // Validates that a new type declaration doesn't conflict with an
    // existing type declaration.
    private _validateDeclaredTypeMatches(node: ExpressionNode, type: Type,
            errorNode: ExpressionNode) {

        const declaredType = this._evaluator.getDeclaredTypeForExpression(node);
        if (declaredType) {
            if (!isTypeSame(declaredType, type)) {
                this._evaluator.addError(`Declared type '${ printType(type) }' is not compatible ` +
                    `with declared type '${ printType(declaredType) }'`,
                    errorNode);
            }
        }
    }

    // Given a function node and the function type associated with it, this
    // method search for prior function nodes that are marked as @overload
    // and creates an OverloadedFunctionType that includes this function and
    // all previous ones.
    private _addOverloadsToFunctionType(node: FunctionNode, type: FunctionType): Type {
        const symbolWithScope = this._currentScope.lookUpSymbolRecursive(node.name.nameToken.value);
        if (symbolWithScope) {
            const decls = symbolWithScope.symbol.getDeclarations();

            // Find this function's declaration.
            let declIndex = decls.findIndex(decl => {
                return (decl.type === DeclarationType.Function || decl.type === DeclarationType.Method) && decl.node === node;
            });
            if (declIndex > 0) {
                const overloadedTypes: OverloadedFunctionEntry[] = [{ type, typeSourceId: decls[declIndex].node!.id }];
                while (declIndex > 0) {
                    const declType = AnalyzerNodeInfo.getExpressionType(decls[declIndex - 1].node!);
                    if (!declType || declType.category !== TypeCategory.Function || !FunctionType.isOverloaded(declType)) {
                        break;
                    }

                    overloadedTypes.unshift({ type: declType, typeSourceId: decls[declIndex - 1].node!.id });
                    declIndex--;
                }

                if (overloadedTypes.length > 1) {
                    // Create a new overloaded type that copies the contents of the previous
                    // one and adds a new function.
                    const newOverload = OverloadedFunctionType.create();
                    newOverload.overloads = overloadedTypes;
                    return newOverload;
                }
            }
        }

        return type;
    }

    private _addTypeSourceToNameNode(node: NameNode, type: Type) {
        this._evaluator.addTypeSourceToName(node, node.nameToken.value, type, node.id);
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

    private _enterScope(node: ParseNode, callback: () => void) {
        const prevScope = this._currentScope;
        const newScope = AnalyzerNodeInfo.getScope(node)!;
        assert(newScope !== undefined);

        this._currentScope = newScope;

        callback();

        this._currentScope = prevScope;
    }

    private _addUnusedName(nameNode: NameNode) {
        return this._fileInfo.diagnosticSink.addUnusedCodeWithTextRange(
            `'${ nameNode.nameToken.value }' is not accessed`, nameNode);
    }

    private _setAnalysisChanged(reason: string) {
        this._didAnalysisChange = true;
        this._lastAnalysisChangeReason = reason;
    }
}
