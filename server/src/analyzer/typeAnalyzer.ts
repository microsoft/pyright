/*
* typeAnalyzer.ts
* Copyright (c) Microsoft Corporation. All rights reserved.
* Author: Eric Traut
*
* A parse tree walker that performs static type checking. It assumes
* that the semanticAnalyzer and typeHintAnalyzer have already run
* and added information to the parse nodes.
*/

import * as assert from 'assert';

import { TextRangeDiagnosticSink } from '../common/diagnosticSink';
import { convertOffsetsToRange } from '../common/positionUtils';
import StringMap from '../common/stringMap';
import { TextRange } from '../common/textRange';
import { ArgumentCategory, AssignmentNode, BinaryExpressionNode, CallExpressionNode,
    ClassNode, ConditionalExpressionNode, ConstantNode, ExceptNode,
    ExpressionNode, ForNode, FunctionNode, IfNode, ImportAsNode, ImportFromNode,
    LambdaNode, ListComprehensionForNode, ListComprehensionNode,
    MemberAccessExpressionNode, ModuleNode, NameNode, ParameterCategory,
    ParseNode, RaiseNode, ReturnNode, StarExpressionNode, TryNode, TupleExpressionNode,
    TypeAnnotationExpressionNode, WithNode, YieldExpressionNode,
    YieldFromExpressionNode } from '../parser/parseNodes';
import { KeywordType, OperatorType } from '../parser/tokenizerTypes';
import { ScopeUtils } from '../scopeUtils';
import { AnalyzerFileInfo } from './analyzerFileInfo';
import { AnalyzerNodeInfo } from './analyzerNodeInfo';
import { EvaluatorFlags, ExpressionEvaluator } from './expressionEvaluator';
import { ExpressionUtils } from './expressionUtils';
import { ImportResult } from './importResult';
import { DefaultTypeSourceId, TypeSourceId } from './inferredType';
import { ParseTreeUtils } from './parseTreeUtils';
import { ParseTreeWalker } from './parseTreeWalker';
import { Scope, ScopeType } from './scope';
import { Declaration, Symbol, SymbolCategory, SymbolTable } from './symbol';
import { TypeConstraint, TypeConstraintBuilder, TypeConstraintResults } from './typeConstraint';
import { AnyType, ClassType, ClassTypeFlags, FunctionType, FunctionTypeFlags, ModuleType,
    NoneType, ObjectType, OverloadedFunctionType, PropertyType, TupleType, Type, TypeCategory,
    TypeVarType, UnboundType, UnionType, UnknownType } from './types';
import { TypeUtils } from './typeUtils';

interface ParamAssignmentInfo {
    argsNeeded: number;
    argsReceived: number;
}

interface EnumClassInfo {
    enumClass: ClassType;
    valueType: Type;
}

export class TypeAnalyzer extends ParseTreeWalker {
    private readonly _moduleNode: ModuleNode;
    private readonly _fileInfo: AnalyzerFileInfo;
    private _currentScope: Scope;

    // Indicates where there was a change in the type analysis
    // the last time analyze() was called. Callers should repeatedly
    // call analyze() until this returns false.
    private _didAnalysisChange: boolean;

    // Analysis verison is incremented each time an analyzer pass
    // is performed. It allows the code to determine when cached
    // type information needs to be regenerated because it was
    // from a previous pass.
    private _analysisVersion = 0;

    // Temporarily suppress the output of diagnostics?
    private _isDiagnosticsSuppressed = false;

    // List of type constraints that are currently in effect
    // when walking a multi-part AND expression (e.g. A and B
    // and C).
    private _expressionTypeConstraints: TypeConstraint[] = [];

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

        return this._didAnalysisChange;
    }

    visitClass(node: ClassNode): boolean {
        this.walkMultiple(node.decorators);

        // We should have already resolved most of the base class
        // parameters in the semantic analyzer, but if these parameters
        // are variables, they may not have been resolved at that time.
        let classType = AnalyzerNodeInfo.getExpressionType(node) as ClassType;
        assert(classType instanceof ClassType);

        node.arguments.forEach((arg, index) => {
            let argType = this._getTypeOfExpression(arg.valueExpression);

            // In some stub files, classes are conditionally defined (e.g. based
            // on platform type). We'll assume that the conditional logic is correct
            // and strip off the "unbound" union.
            if (argType instanceof UnionType) {
                argType = argType.removeUnbound();
            }

            if (!argType.isAny() && argType.category !== TypeCategory.Class) {
                this._addError(`Argument to class must be a base class`, arg);
            }

            if (classType.updateBaseClassType(index, argType)) {
                this._setAnalysisChanged();
            }
        });

        this.walkMultiple(node.arguments);

        // Update the type parameters for the class.
        let typeParameters: TypeVarType[] = [];
        classType.getBaseClasses().forEach(baseClass => {
            TypeUtils.addTypeVarsToListIfUnique(typeParameters,
                TypeUtils.getTypeVarArgumentsRecursive(baseClass.type));
        });
        if (classType.setTypeParameters(typeParameters)) {
            this._setAnalysisChanged();
        }

        this._enterScope(node, () => {
            this.walk(node.suite);
        });

        let declaration: Declaration = {
            category: SymbolCategory.Class,
            node: node.name,
            path: this._fileInfo.filePath,
            range: convertOffsetsToRange(node.name.start, node.name.end, this._fileInfo.lines)
        };
        this._bindNameNodeToType(node.name, classType, declaration);

        return false;
    }

    visitFunction(node: FunctionNode): boolean {
        const isMethod = ParseTreeUtils.isFunctionInClass(node);
        this.walkMultiple(node.decorators);

        const functionType = AnalyzerNodeInfo.getExpressionType(node) as FunctionType;
        assert(functionType instanceof FunctionType);

        if (this._fileInfo.isCollectionsStubFile) {
            // Stash away the name of the function since we need to handle
            // 'namedtuple' specially.
            functionType.setSpecialBuiltInName(node.name.nameToken.value);
        }

        const functionParams = functionType.getParameters();
        node.parameters.forEach((param, index) => {
            let annotatedType: Type | undefined;
            if (param.typeAnnotation) {
                annotatedType = this._getTypeOfAnnotation(param.typeAnnotation.expression);

                // PEP 484 indicates that if a parameter has a default value of 'None'
                // the type checker should assume that the type is optional (i.e. a union
                // of the specified type and 'None').
                // TODO - tighten this up, perhaps using a config flag
                if (param.defaultValue instanceof ConstantNode) {
                    if (param.defaultValue.token.keywordType === KeywordType.None) {
                        annotatedType = TypeUtils.combineTypes(annotatedType, NoneType.create());
                    }
                }

                functionParams[index].type = annotatedType;

                if (param.defaultValue) {
                    // Verify that the default value matches the type annotation.
                    let defaultValueType = this._getTypeOfExpression(param.defaultValue);
                    if (annotatedType && !TypeUtils.canAssignType(annotatedType, defaultValueType)) {
                        this._addError(
                            `Value of type '${ defaultValueType.asString() }' cannot` +
                            ` be assiged to parameter of type '${ annotatedType.asString() }'`,
                            param.defaultValue);
                    }
                }

                this.walk(param.typeAnnotation.expression);
            } else if (index === 0 && param.name) {
                let classNode = this._getEnclosingClass(node);
                if (classNode) {
                    let inferredClassType = AnalyzerNodeInfo.getExpressionType(classNode) as ClassType;
                    if (inferredClassType) {
                        if (param.name.nameToken.value === 'self') {
                            functionParams[index].type = new ObjectType(inferredClassType);
                        } else if (param.name.nameToken.value === 'cls') {
                            functionParams[index].type = inferredClassType;
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
            // Add the parameters to the scope and bind their types.
            functionType.getParameters().forEach(param => {
                if (param.name) {
                    if (param.category === ParameterCategory.Simple) {
                        let declaration: Declaration | undefined;
                        if (param.node) {
                            declaration = {
                                category: SymbolCategory.Parameter,
                                node: param.node,
                                path: this._fileInfo.filePath,
                                range: convertOffsetsToRange(param.node.start, param.node.end, this._fileInfo.lines)
                            };
                        }
                        let typeSourceId = param.node ?
                            AnalyzerNodeInfo.getTypeSourceId(param.node) :
                            DefaultTypeSourceId;
                        this._bindNameToType(param.name, param.type, typeSourceId, declaration);
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
            let classNode = this._getEnclosingClass(node);
            if (classNode) {
                let classType = AnalyzerNodeInfo.getExpressionType(classNode) as ClassType;
                assert(classType !== undefined && classType instanceof ClassType);

                let superType = new FunctionType(FunctionTypeFlags.None);
                superType.addParameter({
                    category: ParameterCategory.VarArgList,
                    name: 'args',
                    type: UnknownType.create(),
                    node: classNode
                });
                superType.addParameter({
                    category: ParameterCategory.VarArgDictionary,
                    name: 'kwargs',
                    type: UnknownType.create(),
                    node: classNode
                });
                if (classType.getBaseClasses().length > 0) {
                    let baseClass = classType.getBaseClasses()[0];
                    if (baseClass instanceof ClassType) {
                        superType.setDeclaredReturnType(new ObjectType(baseClass));
                    } else {
                        superType.setDeclaredReturnType(UnknownType.create());
                    }
                }

                this._bindNameToType('super', superType, DefaultTypeSourceId);
            }

            this.walk(node.suite);
        });

        if (!this._fileInfo.isStubFile) {
            // Add all of the return types that were found within the function.
            let inferredReturnType = functionType.getInferredReturnType();
            if (inferredReturnType.addSources(functionScope.getReturnType())) {
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
                    if (!TypeUtils.canAssignType(declaredReturnType, NoneType.create())) {
                        this._addError(`Function with declared type of ${ declaredReturnType.asString() }` +
                            ` must return value`, node.returnTypeAnnotation.rawExpression);
                    }
                }
            }
        }

        let decoratedType: Type = functionType;

        // Handle overload decorators specially.
        let overloadedType: OverloadedFunctionType | undefined;
        let evaluator = this._getEvaluator();
        [overloadedType] = evaluator.getOverloadedFunctionType(node, functionType);
        if (overloadedType) {
            decoratedType = overloadedType;
        } else {
            // Determine if the function is a property getter or setter.
            if (ParseTreeUtils.isFunctionInClass(node)) {
                let propertyType = evaluator.getPropertyType(node, functionType);
                if (propertyType) {
                    decoratedType = propertyType;
                }
            }
        }

        let declaration: Declaration = {
            category: isMethod ? SymbolCategory.Method : SymbolCategory.Function,
            node: node.name,
            path: this._fileInfo.filePath,
            range: convertOffsetsToRange(node.name.start, node.name.end, this._fileInfo.lines)
        };
        this._bindNameNodeToType(node.name, decoratedType, declaration);
        this._updateExpressionTypeForNode(node.name, functionType);

        return false;
    }

    visitLambda(node: LambdaNode): boolean {
        this._enterScope(node, () => {
            this.walkChildren(node);
        });
        return false;
    }

    visitCall(node: CallExpressionNode): boolean {
        let callType = this._getTypeOfExpression(node.leftExpression);

        if (callType instanceof ClassType && callType.isGeneric()) {
            // TODO - need to infer types. For now, just assume "any" type.
            let specializedType = callType.cloneForSpecialization();
            specializedType.setTypeArguments([]);
            callType = specializedType;
        }

        // TODO - need to handle union type

        if (!this._validateCallArguments(node, callType, this._isCallOnObjectOrClass(node))) {
            this._addError(
                `'${ ParseTreeUtils.printExpression(node.leftExpression) }' has type ` +
                `'${ callType.asString() }' and is not callable`,
                node.leftExpression);
        }
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
        let ifScope: Scope | undefined;
        let elseScope: Scope | undefined;
        let ifIsUnconditional = false;
        let elseIsUnconditional = false;

        // Determine if the if condition is always true or always false. If so,
        // we can treat either the if or the else clause as unconditional.
        let constExprValue = ExpressionUtils.evaluateConstantExpression(
            node.testExpression, this._fileInfo.executionEnvironment);

        this.walk(node.testExpression);

        let typeConstraints = this._buildTypeConstraints(node.testExpression);

        // Push a temporary scope so we can track
        // which variables have been assigned to conditionally.
        ifScope = this._enterTemporaryScope(() => {
            // Add any applicable type constraints.
            if (typeConstraints) {
                typeConstraints.ifConstraints.forEach(constraint => {
                    this._currentScope.addTypeConstraint(constraint);
                });
            }

            this.walk(node.ifSuite);
        }, true, constExprValue === false);

        // Now handle the else statement if it's present. If there
        // are chained "else if" statements, they'll be handled
        // recursively here.
        if (node.elseSuite) {
            elseScope = this._enterTemporaryScope(() => {
                // Add any applicable type constraints.
                if (typeConstraints) {
                    typeConstraints.elseConstraints.forEach(constraint => {
                        this._currentScope.addTypeConstraint(constraint);
                    });
                }

                this.walk(node.elseSuite!);
            }, true, constExprValue === true);
        }

        // Evaluate the expression so the expression type is cached.
        this._getTypeOfExpression(node.testExpression);

        if (constExprValue !== undefined) {
            if (constExprValue) {
                ifIsUnconditional = true;
                elseScope = undefined;
            } else {
                elseIsUnconditional = true;
                ifScope = undefined;
            }
        }

        // Figure out how to combine the scopes.
        if (ifScope && !ifScope.getAlwaysReturnsOrRaises() && elseScope && !elseScope.getAlwaysReturnsOrRaises()) {
            // If both an "if" and an "else" scope exist, combine the names from both scopes.
            ifScope.combineConditionalSymbolTable(elseScope);
            this._mergeToCurrentScope(ifScope);
        } else if (ifScope && !ifScope.getAlwaysReturnsOrRaises()) {
            // If there's only an "if" scope executed, mark all of its contents as conditional.
            if (!elseScope && !ifIsUnconditional) {
                ifScope.markAllSymbolsConditional();
            }
            this._mergeToCurrentScope(ifScope);
        } else if (elseScope && !elseScope.getAlwaysReturnsOrRaises()) {
            // If there's only an "else" scope executed, mark all of its contents as conditional.
            if (!ifScope && !elseIsUnconditional) {
                elseScope.markAllSymbolsConditional();
            }
            this._mergeToCurrentScope(elseScope);
        } else if (ifScope && ifScope.getAlwaysReturnsOrRaises() && elseScope && elseScope.getAlwaysReturnsOrRaises()) {
            // If both an if and else clause are executed but they both return or raise an exception,
            // mark the current scope as always returning or raising an exception.
            if (ifScope.getAlwaysRaises() && elseScope.getAlwaysRaises()) {
                this._currentScope.setAlwaysRaises();
            } else {
                this._currentScope.setAlwaysReturns();
            }
        }

        if (ifScope) {
            this._mergeReturnTypeToCurrentScope(ifScope);
        }

        if (elseScope) {
            this._mergeReturnTypeToCurrentScope(elseScope);
        }

        return false;
    }

    visitWith(node: WithNode): boolean {
        node.withItems.forEach(item => {
            this.walk(item.expression);
        });

        node.withItems.forEach(item => {
            if (item.target) {
                let exprType = this._getTypeOfExpression(item.expression);

                // If the type has an "__enter__" method, it can return
                // a type other than its own type.
                const enterMethodName = node.isAsync ? '__aenter__' : '__enter__';
                let enterTypeMember = TypeUtils.lookUpObjectMember(exprType, enterMethodName);
                if (enterTypeMember) {
                    const memberType = TypeUtils.getEffectiveTypeOfMember(enterTypeMember);
                    if (memberType instanceof FunctionType) {
                        exprType = memberType.getEffectiveReturnType();
                    }
                }

                this._assignTypeToPossibleTuple(item.target, exprType);
            }
        });

        this.walk(node.suite);
        return false;
    }

    visitConditional(node: ConditionalExpressionNode) {
        this.walk(node.leftExpression);

        // Apply the type constraint when evaluating the if and else clauses.
        let typeConstraints = this._buildTypeConstraints(node.leftExpression);

        // Start by evaluating the if statement.
        this._useExpressionTypeConstraint(typeConstraints, true, () => {
            this.walk(node.ifExpression);
        });

        // And now the else statement.
        this._useExpressionTypeConstraint(typeConstraints, false, () => {
            this.walk(node.elseExpression);
        });

        return false;
    }

    visitReturn(node: ReturnNode): boolean {
        let declaredReturnType: Type | undefined;
        let returnType: Type;
        let typeSourceId = DefaultTypeSourceId;

        let enclosingFunctionNode = this._getEnclosingFunction(node);
        if (enclosingFunctionNode) {
            let functionType = AnalyzerNodeInfo.getExpressionType(
                enclosingFunctionNode) as FunctionType;
            if (functionType) {
                assert(functionType instanceof FunctionType);
                declaredReturnType = functionType.getDeclaredReturnType();
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
        if (declaredReturnType) {
            if (!TypeUtils.canAssignType(declaredReturnType, returnType)) {
                this._addError(
                    `Expression of type '${ returnType.asString() }' cannot be assigned ` +
                        `to return type '${ declaredReturnType.asString() }'`,
                    node.returnExpression ? node.returnExpression : node);
            }
        }

        this._currentScope.setAlwaysReturns();
        return true;
    }

    visitYield(node: YieldExpressionNode) {
        let yieldType = this._getTypeOfExpression(node.expression);
        let typeSourceId = AnalyzerNodeInfo.getTypeSourceId(node.expression);
        this._currentScope.getReturnType().addSource(yieldType, typeSourceId);

        return true;
    }

    visitYieldFrom(node: YieldFromExpressionNode) {
        // TODO - determine the right type to use for the iteration.
        let typeSourceId = AnalyzerNodeInfo.getTypeSourceId(node.expression);
        this._currentScope.getReturnType().addSource(
            UnknownType.create(), typeSourceId);

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

            // If more than one type was specified for the exception,
            // handle that here.
            if (exceptionType instanceof TupleType) {
                let tuple = exceptionType;
                let unionType = new UnionType();
                unionType.addTypes(tuple.getEntryTypes().map(t => {
                    return this._validateExceptionType(t, node.typeExpression!);
                }));
                exceptionType = unionType;
            } else {
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
            });
            this._mergeReturnTypeToCurrentScope(exceptScope);
        });

        if (node.elseSuite) {
            this.walk(node.elseSuite);
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
                        // Synthesize a class.
                        let specialClassType = new ClassType(assignedName,
                            ClassTypeFlags.BuiltInClass | ClassTypeFlags.SpecialBuiltIn,
                            DefaultTypeSourceId);

                        let aliasClass = ScopeUtils.getBuiltInType(this._currentScope,
                            assignedName.toLowerCase());
                        if (aliasClass instanceof ClassType) {
                            specialClassType.addBaseClass(aliasClass, false);
                            specialClassType.setAliasClass(aliasClass);
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
        let leftType = this._getTypeOfExpression(node.leftExpression);
        this._validateMemberAccess(leftType, node.memberName);

        this.walk(node.leftExpression);

        // Set the member type for the hover provider.
        this._updateExpressionTypeForNode(node.memberName, this._getTypeOfExpression(node));

        // Don't walk the member name.
        return false;
    }

    visitBinaryOperation(node: BinaryExpressionNode) {
        this.walk(node.leftExpression);

        // Is this an AND operator? If so, we can assume that the
        // rightExpression won't be evaluated at runtime unless the
        // leftExpression evaluates to true.
        let typeConstraints: TypeConstraintResults | undefined;
        if (node.operator === OperatorType.And) {
            typeConstraints = this._buildTypeConstraints(node.leftExpression);
        }

        this._useExpressionTypeConstraint(typeConstraints, true, () => {
            this.walk(node.rightExpression);
        });

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
                });

                let moduleDeclaration: Declaration | undefined;
                if (this._fileInfo.importMap[resolvedPath]) {
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

        if (importInfo && importInfo.importFound && importInfo.resolvedPaths.length > 0) {
            let resolvedPath = importInfo.resolvedPaths[importInfo.resolvedPaths.length - 1];

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
                        if (moduleType) {
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

                const specialTypes = ['Tuple', 'Generic', 'Protocol', 'Callable', 'Type', 'ClassVar',
                    'Final', 'Literal'];
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

    // Determine if this is a call through an object or class, in
    // which case a "self" or "cls" argument needs to be synthesized.
    private _isCallOnObjectOrClass(node: CallExpressionNode): boolean {
        let skipFirstMethodParam = false;
        if (node.leftExpression instanceof MemberAccessExpressionNode) {
            let leftType = this._getTypeOfExpression(
                node.leftExpression.leftExpression);

            // TODO - what should we do about UnionType here?
            if (leftType instanceof ObjectType || leftType instanceof ClassType) {
                skipFirstMethodParam = true;
            }
        }

        return skipFirstMethodParam;
    }

    private _validateCallArguments(node: CallExpressionNode, callType: Type,
            skipFirstMethodParam: boolean): boolean {
        let isCallable = true;

        if (callType instanceof TypeVarType) {
            // TODO - need to remove once we resolve type vars
            return true;
        }

        if (!callType.isAny()) {
            if (callType instanceof FunctionType) {
                this._validateFunctionArguments(node, callType, skipFirstMethodParam);
            } else if (callType instanceof OverloadedFunctionType) {
                if (!this._findOverloadedFunctionType(callType, node, skipFirstMethodParam)) {
                    const exprString = ParseTreeUtils.printExpression(node.leftExpression);
                    this._addError(
                        `No overloads for '${ exprString }' match parameters`,
                        node.leftExpression);
                }
            } else if (callType instanceof ClassType) {
                if (!callType.isSpecialBuiltIn()) {
                    this._validateConstructorArguments(node, callType);
                }
            } else if (callType instanceof ObjectType) {
                isCallable = false;
                const callMethod = TypeUtils.lookUpObjectMember(callType, '__call__');
                if (callMethod) {
                    const callMethodType = TypeUtils.getEffectiveTypeOfMember(callMethod);
                    if (callMethodType instanceof FunctionType) {
                        isCallable = this._validateCallArguments(node, callMethodType, true);
                    }
                }
            } else if (callType instanceof UnionType) {
                for (let type of callType.getTypes()) {
                    if (type instanceof NoneType) {
                        // TODO - for now, assume that optional
                        // types (unions with None) are valid. Tighten
                        // this later.
                    } else if (!this._validateCallArguments(node, type, skipFirstMethodParam)) {
                        isCallable = false;
                        break;
                    }
                }
            } else {
                isCallable = false;
            }
        }

        return isCallable;
    }

    private _findOverloadedFunctionType(callType: OverloadedFunctionType,
            node: CallExpressionNode, skipFirstMethodParam: boolean): FunctionType | undefined {
        let validOverload: FunctionType | undefined;

        // Temporarily suppress diagnostics.
        this._suppressDiagnostics(() => {
            for (let overload of callType.getOverloads()) {
                if (this._validateCallArguments(node, overload.type, skipFirstMethodParam)) {
                    validOverload = overload.type;
                }
            }
        });

        return validOverload;
    }

    private _validateExceptionType(exceptionType: Type, errorNode: ParseNode) {
        if (exceptionType.isAny()) {
            return exceptionType;
        }

        // Convert the class into an object type.
        if (exceptionType instanceof ClassType) {
            return new ObjectType(exceptionType);
        } else if (exceptionType instanceof TupleType) {
            return exceptionType;
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
                return exceptionType;
            }
        }

        this._addError(
            `'${ exceptionType.asString() }' is not valid exception class`,
            errorNode);
        return exceptionType;
    }

    private _bindMemberVariableToType(node: MemberAccessExpressionNode,
            typeOfExpr: Type, isInstanceMember: boolean) {

        let classDef = this._getEnclosingClass(node);
        if (!classDef) {
            return;
        }

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
                        typeOfExpr = TypeUtils.combineTypes(typeOfExpr, TypeUtils.getEffectiveTypeOfMember(memberInfo));
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

        this._mergeReturnTypeToCurrentScope(scopeToMerge);
    }

    private _mergeReturnTypeToCurrentScope(scopeToMerge: Scope) {
        if (this._currentScope.mergeReturnType(scopeToMerge)) {
            if (this._currentScope.getType() !== ScopeType.Temporary) {
                this._setAnalysisChanged();
            }
        }
    }

    private _getModuleTypeForImportPath(importResult: ImportResult | undefined,
            path: string): ModuleType | undefined {
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

    private _getTypeOfExpression(node: ExpressionNode): Type {
        let evaluator = this._getEvaluator();
        return evaluator.getType(node, EvaluatorFlags.None);
    }

    private _updateExpressionTypeForNode(node: ParseNode, exprType: Type) {
        let oldType = AnalyzerNodeInfo.getExpressionType(node);
        AnalyzerNodeInfo.setExpressionTypeVersion(node, this._analysisVersion);

        if (!oldType || !oldType.isSame(exprType)) {
            AnalyzerNodeInfo.setExpressionType(node, exprType);
            this._setAnalysisChanged();
        }
    }

    private _assignTypeToPossibleTuple(target: ExpressionNode, type: Type): void {
        if (target instanceof MemberAccessExpressionNode) {
            let targetNode = target.leftExpression;
            if (targetNode instanceof NameNode) {
                if (targetNode.nameToken.value === 'self') {
                    this._bindMemberVariableToType(target, type, true);
                } else if (targetNode.nameToken.value === 'cls') {
                    this._bindMemberVariableToType(target, type, false);
                }
            }

            // TODO - need to validate type compatibility for assignment
        } else if (target instanceof TupleExpressionNode) {
            let assignedTypes = false;

            if (type instanceof TupleType) {
                const entryTypes = type.getEntryTypes();
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

            if (!TypeUtils.canAssignType(typeHint, type)) {
                this._addError(
                    `Expression of type '${ type.asString() }'` +
                        ` cannot be assigned to type '${ typeHint.asString() }'`,
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

    private _getEnclosingClass(node: ParseNode): ClassNode | undefined {
        let curNode = node.parent;
        while (curNode) {
            if (curNode instanceof ClassNode) {
                return curNode;
            }

            curNode = curNode.parent;
        }

        return undefined;
    }

    private _getEnclosingFunction(node: ParseNode): FunctionNode | undefined {
        let curNode = node.parent;
        while (curNode) {
            if (curNode instanceof FunctionNode) {
                return curNode;
            }
            if (curNode instanceof ClassNode) {
                return undefined;
            }

            curNode = curNode.parent;
        }

        return undefined;
    }

    private _assignTypeForPossibleEnumeration(node: NameNode, typeOfExpr?: Type): boolean {
        let enumClassInfo = this._getEnclosingEnumClassInfo(node);
        if (enumClassInfo) {
            if (typeOfExpr && !TypeUtils.canAssignType(enumClassInfo.valueType, typeOfExpr)) {
                this._addError(
                    `Expression of type '${ typeOfExpr.asString() }' cannot be assigned ` +
                        `to type '${ enumClassInfo.valueType.asString() }'`,
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
        let enclosingClassNode = this._getEnclosingClass(node);
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

    // Tries to assign the call arguments to the function parameter
    // list and reports any mismatches in types or counts.
    // If skipFirstMethodParam is true and the callee is a method,
    // the logic assumes that it can skip the validation of the first
    // parameter because it's a "self" or "cls" parameter.
    // This logic is based on PEP 3102: https://www.python.org/dev/peps/pep-3102/
    private _validateFunctionArguments(node: CallExpressionNode, type: FunctionType,
            skipFirstMethodParam: boolean) {
        let argIndex = 0;
        const typeParams = type.getParameters();

        // If it's a raw function (versus a method call), no need to skip the first parameter.
        const skipFirstParam = skipFirstMethodParam && type.isInstanceMethod();

        // Evaluate all of the argument values and generate errors if appropriate.
        // The expression type will be cached in the node so we don't re-evaluate
        // it below.
        node.arguments.forEach(arg => {
            this._getTypeOfExpression(arg.valueExpression);
        });

        // If the function has decorators, we need to back off because the decorator
        // parameter lists may differ from those of the function.
        // TODO - improve this
        if (type.hasCustomDecorators()) {
            return;
        }

        // The last parameter might be a var arg dictionary. If so, strip it off.
        let hasVarArgDictParam = typeParams.find(
                param => param.category === ParameterCategory.VarArgDictionary) !== undefined;
        let reportedArgError = false;

        // Build a map of parameters by name.
        let paramMap = new StringMap<ParamAssignmentInfo>();
        typeParams.forEach((param, index) => {
            // Skip the first named param if appropriate.
            if (param.name && (index > 0 || !skipFirstParam)) {
                paramMap.set(param.name, {
                    argsNeeded: param.category === ParameterCategory.Simple && !param.hasDefault ? 1 : 0,
                    argsReceived: 0
                });
            }
        });

        // Is there a bare (nameless) "*" parameter? If so, it signifies the end
        // of the positional parameter list.
        let positionalParamCount = typeParams.findIndex(
            param => param.category === ParameterCategory.VarArgList && !param.name);

        // Is there a var-arg (named "*") parameter? If so, it is the last of
        // the positional parameters.
        if (positionalParamCount < 0) {
            positionalParamCount = typeParams.findIndex(
                param => param.category === ParameterCategory.VarArgList);
            if (positionalParamCount >= 0) {
                positionalParamCount++;
            }
        }

        // Is there a keyword var-arg ("**") parameter? If so, it's not included
        // in the list of positional parameters.
        if (positionalParamCount < 0) {
            positionalParamCount = typeParams.findIndex(
                param => param.category === ParameterCategory.VarArgDictionary);
        }

        // If we didn't see any special cases, then all parameters are positional.
        if (positionalParamCount < 0) {
            positionalParamCount = typeParams.length;
        }

        // Determine how many positional args are being passed before
        // we see a named arg.
        let positionalArgCount = node.arguments.findIndex(
            arg => arg.argumentCategory === ArgumentCategory.Dictionary || arg.name !== undefined);
        if (positionalArgCount < 0) {
            positionalArgCount = node.arguments.length;
        }

        // Map the positional args to parameters.
        let paramIndex = skipFirstParam ? 1 : 0;
        while (argIndex < positionalArgCount) {
            if (paramIndex >= positionalParamCount) {
                this._addError(
                    `Expected ${ positionalParamCount } positional argument${ positionalParamCount === 1 ? '' : 's' }`,
                    node.arguments[argIndex]);
                reportedArgError = true;
                break;
            }

            if (typeParams[paramIndex].category === ParameterCategory.VarArgList) {
                // Consume the remaining positional args.
                argIndex = positionalArgCount;
            } else {
                let paramType = typeParams[paramIndex].type;
                this._validateArgType(paramType, node.arguments[argIndex].valueExpression);

                // Note that the parameter has received an argument.
                const paramName = typeParams[paramIndex].name;
                if (paramName) {
                    paramMap.get(paramName)!.argsReceived++;
                }

                argIndex++;
            }

            paramIndex++;
        }

        if (!reportedArgError) {
            let foundDictionaryArg = false;
            let foundListArg = node.arguments.find(arg => arg.argumentCategory === ArgumentCategory.List) !== undefined;

            // Now consume any named parameters.
            while (argIndex < node.arguments.length) {
                if (node.arguments[argIndex].argumentCategory === ArgumentCategory.Dictionary) {
                    foundDictionaryArg = true;
                } else {
                    // Protect against the case where a non-named argument appears after
                    // a named argument. This will have already been reported as a parse
                    // error, but we need to protect against it here.
                    const paramName = node.arguments[argIndex].name;
                    if (paramName) {
                        const paramNameValue = paramName.nameToken.value;
                        const paramEntry = paramMap.get(paramNameValue);
                        if (paramEntry) {
                            if (paramEntry.argsReceived > 0) {
                                this._addError(
                                    `Parameter '${ paramNameValue }' is already assigned`, paramName);
                            } else {
                                paramMap.get(paramName.nameToken.value)!.argsReceived++;

                                let paramInfo = typeParams.find(param => param.name === paramNameValue);
                                assert(paramInfo !== undefined);
                                this._validateArgType(paramInfo!.type, node.arguments[argIndex].valueExpression);
                                this._updateExpressionTypeForNode(paramName, paramInfo!.type);
                            }
                        } else if (!hasVarArgDictParam) {
                            this._addError(
                                `No parameter named '${ paramName.nameToken.value }'`, paramName);
                        }
                    }
                }

                argIndex++;
            }

            // Determine whether there are any parameters that require arguments
            // but have not yet received them. If we received a dictionary argument
            // (i.e. an arg starting with a "**") or a list argument (i.e. an arg
            // starting with a "*"), we will assume that all parameters are matched.
            if (!foundDictionaryArg && !foundListArg) {
                let unassignedParams = paramMap.getKeys().filter(name => {
                    const entry = paramMap.get(name)!;
                    return entry.argsReceived < entry.argsNeeded;
                });

                if (unassignedParams.length > 0) {
                    this._addError(
                        `Argument missing for parameter${ unassignedParams.length === 1 ? '' : 's' } ` +
                        unassignedParams.map(p => `${ p }`).join(', '), node);
                }
            }
        }
    }

    private _validateArgType(paramType: Type, argExpression: ExpressionNode) {
        let argType = this._getTypeOfExpression(argExpression);
        if (!TypeUtils.canAssignType(paramType, argType)) {
            this._addError(
                `Argument of type '${ argType.asString() }'` +
                    ` cannot be assigned to parameter of type '${ paramType.asString() }'`,
                argExpression);
        }
    }

     // Tries to match the arguments of a call to the constructor for a class.
    private _validateConstructorArguments(node: CallExpressionNode, type: ClassType) {
        let validatedTypes = false;
        const initMethodMember = TypeUtils.lookUpClassMember(type, '__init__', false);
        if (initMethodMember) {
            if (initMethodMember.symbol) {
                const initMethodType = TypeUtils.getEffectiveTypeOfMember(initMethodMember);
                this._validateCallArguments(node, initMethodType, true);
            } else {
                // If we received a defined result with no symbol, that
                // means one of the base classes was an "any" type, so
                // we don't know if it has a valid intializer.
            }

            validatedTypes = true;
        }

        if (!validatedTypes) {
            // If there's no init method, check for a constructor.
            const constructorMember = TypeUtils.lookUpClassMember(type, '__new__', false);
            if (constructorMember && constructorMember.symbol) {
                const constructorMethodType = TypeUtils.getEffectiveTypeOfMember(constructorMember);
                this._validateCallArguments(node, constructorMethodType, true);
                validatedTypes = true;
            }
        }

        if (!validatedTypes && node.arguments.length > 0) {
            this._addError(
                `Expected no arguments to '${ type.getClassName() }' constructor`, node);
        }
    }

    private _validateMemberAccess(baseType: Type, memberName: NameNode): boolean {
        // TODO - most of this logic is now redudnant with the expression evaluation
        // logic. The only part that remains is the calls to setDeclaration. Clean
        // this up at some point.
        const memberNameValue = memberName.nameToken.value;

        if (baseType instanceof ObjectType) {
            let classMemberInfo = TypeUtils.lookUpClassMember(
                baseType.getClassType(), memberNameValue);
            if (classMemberInfo) {
                if (classMemberInfo.symbol && classMemberInfo.symbol.declarations) {
                    AnalyzerNodeInfo.setDeclaration(memberName, classMemberInfo.symbol.declarations[0]);
                }
                return true;
            } else {
                // See if the class has a "__getattribute__" or "__getattr__" method.
                // If so, aribrary members are supported.
                let getAttribMember = TypeUtils.lookUpClassMember(
                    baseType.getClassType(), '__getattribute__');
                if (getAttribMember && getAttribMember.class) {
                    const isObjectClass = getAttribMember.class.isBuiltIn() &&
                        getAttribMember.class.getClassName() === 'object';
                    // The built-in 'object' class, from which every class derives,
                    // implements the default __getattribute__ method. We want to ignore
                    // this one. If this method is overridden, we need to assume that
                    // all members can be accessed.
                    if (!isObjectClass) {
                        return true;
                    }
                }

                let getAttrMember = TypeUtils.lookUpClassMember(
                    baseType.getClassType(), '__getattr__');
                if (getAttrMember) {
                    return true;
                }

                // If the class has decorators, there may be additional fields
                // added that we don't know about.
                // TODO - figure out a better approach here.
                if (!baseType.getClassType().hasDecorators()) {
                    this._addError(
                        `'${ memberNameValue }' is not a known member of type '${ baseType.asString() }'`,
                        memberName);
                }
                return false;
            }
        }

        if (baseType instanceof ModuleType) {
            let moduleMemberInfo = baseType.getFields().get(memberNameValue);
            if (!moduleMemberInfo) {
                this._addError(
                    `'${ memberNameValue }' is not a known member of module`,
                    memberName);
                return false;
            }

            if (moduleMemberInfo.declarations) {
                AnalyzerNodeInfo.setDeclaration(memberName, moduleMemberInfo.declarations[0]);
            }
            return true;
        }

        if (baseType instanceof ClassType) {
            let classMemberInfo = TypeUtils.lookUpClassMember(baseType, memberNameValue, false);
            if (!classMemberInfo) {
                // If the class has decorators, there may be additional fields
                // added that we don't know about.
                // TODO - figure out a better approach here.
                if (!baseType.hasDecorators()) {
                    this._addError(
                        `'${ memberNameValue }' is not a known member of '${ baseType.asString() }'`,
                        memberName);
                }
                return false;
            }

            if (classMemberInfo.symbol && classMemberInfo.symbol.declarations) {
                AnalyzerNodeInfo.setDeclaration(memberName, classMemberInfo.symbol.declarations[0]);
            }
            return true;
        }

        if (baseType instanceof UnionType) {
            // TODO - need to add extra logic to determine whether it's safe
            // to simplfy the type at this point in the program.
            let simplifiedType = baseType.removeOptional();
            if (simplifiedType instanceof UnionType) {
                for (let t of simplifiedType.getTypes()) {
                    if (!this._validateMemberAccess(t, memberName)) {
                        return false;
                    }
                }
                return true;
            }

            return this._validateMemberAccess(simplifiedType, memberName);
        }

        if (baseType instanceof UnboundType) {
            this._addError(
                `'${ memberNameValue }' cannot be accessed from unbound variable`, memberName);
            return false;
        }

        if (baseType instanceof PropertyType) {
            // TODO - need to implement this check
            return true;
        }

        if (baseType instanceof FunctionType) {
            // TODO - need to implement this check
            return true;
        }

        if (baseType instanceof TypeVarType) {
            // TODO - need to handle this check
            return true;
        }

        if (!baseType.isAny()) {
            this._addError(
                `'${ memberNameValue }' is not a known member of type ${ baseType.asString() }`, memberName);
            return false;
        }

        return true;
    }

    private _useExpressionTypeConstraint(typeConstraints: TypeConstraintResults | undefined,
            useIfClause: boolean, callback: () => void) {

        // Push the specified constraints onto the list.
        let itemsToPop = 0;
        if (typeConstraints) {
            let constraintsToUse = useIfClause ?
                typeConstraints.ifConstraints : typeConstraints.elseConstraints;
            constraintsToUse.forEach(tc => {
                this._expressionTypeConstraints.push(tc);
                itemsToPop++;
            });
        }

        callback();

        // Clean up after ourself.
        for (let i = 0; i < itemsToPop; i++) {
            this._expressionTypeConstraints.pop();
        }
    }

    private _buildTypeConstraints(node: ExpressionNode) {
        return TypeConstraintBuilder.buildTypeConstraints(node,
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

        this._currentScope = prevScope;

        return newScope!;
    }

    private _suppressDiagnostics(callback: () => void) {
        // Temporarily suppress diagnostics.
        let prevSuppressDiagnostics = this._isDiagnosticsSuppressed;
        this._isDiagnosticsSuppressed = true;

        callback();

        this._isDiagnosticsSuppressed = prevSuppressDiagnostics;
    }

    private _addError(message: string, textRange: TextRange) {
        // Don't emit error if the scope is guaranteed not to be executed.
        if (!this._currentScope.isNotExecuted() && !this._isDiagnosticsSuppressed) {
            this._fileInfo.diagnosticSink.addErrorWithTextRange(message, textRange);
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
        if (this._currentScope.isNotExecuted() && !this._isDiagnosticsSuppressed) {
            diagSink = undefined;
        }

        return new ExpressionEvaluator(this._currentScope,
            this._expressionTypeConstraints, diagSink,
            node => this._readTypeFromNodeCache(node),
            (node, type) => {
                this._updateExpressionTypeForNode(node, type);
            });
    }

    private _setAnalysisChanged() {
        this._didAnalysisChange = true;
    }
}
