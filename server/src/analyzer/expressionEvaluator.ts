/*
* expressionEvaluator.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Class that evaluates the type of expressions (parse trees)
* within particular contexts and reports type errors.
*/

import * as assert from 'assert';

import { DiagnosticLevel } from '../common/configOptions';
import { AddMissingOptionalToParamAction, Diagnostic, DiagnosticAddendum } from '../common/diagnostic';
import { DiagnosticRule } from '../common/diagnosticRules';
import { TextRangeDiagnosticSink } from '../common/diagnosticSink';
import { convertOffsetsToRange } from '../common/positionUtils';
import { PythonVersion } from '../common/pythonVersion';
import StringMap from '../common/stringMap';
import { TextRange } from '../common/textRange';
import { ArgumentCategory, AssignmentNode, AugmentedAssignmentNode, BinaryOperationNode, CallNode,
    ClassNode, ConstantNode, DecoratorNode, DictionaryNode, ExpressionNode, FunctionNode,
    IndexItemsNode, IndexNode, isExpressionNode, LambdaNode, ListComprehensionNode, ListNode,
    MemberAccessNode, NameNode, ParameterCategory, ParameterNode, ParseNode, ParseNodeType, SetNode,
    SliceNode, StringListNode, TernaryNode, TupleNode, UnaryOperationNode, YieldFromNode,
    YieldNode } from '../parser/parseNodes';
import { KeywordType, OperatorType, StringTokenFlags, TokenType } from '../parser/tokenizerTypes';
import { ImportLookup } from './analyzerFileInfo';
import * as AnalyzerNodeInfo from './analyzerNodeInfo';
import { FlowAssignment, FlowAssignmentAlias, FlowCall, FlowCondition, FlowFlags,
    FlowLabel, FlowNode, FlowPostFinally, FlowPreFinallyGate, FlowWildcardImport } from './codeFlow';
import { Declaration, DeclarationType, VariableDeclaration } from './declaration';
import { getInferredTypeOfDeclaration } from './declarationUtils';
import * as ParseTreeUtils from './parseTreeUtils';
import { ScopeType } from './scope';
import * as ScopeUtils from './scopeUtils';
import { evaluateStaticBoolExpression } from './staticExpressions';
import { indeterminateSymbolId, Symbol, SymbolFlags } from './symbol';
import { isConstantName, isPrivateOrProtectedName } from './symbolNameUtils';
import { getDeclaredTypeOfSymbol, getEffectiveTypeOfSymbol,
    getLastTypedDeclaredForSymbol } from './symbolUtils';
import { AnyType, ClassType, ClassTypeFlags, combineTypes, FunctionParameter,
    FunctionType, FunctionTypeFlags, isAnyOrUnknown, isNoneOrNever, isPossiblyUnbound,
    isTypeSame, isUnbound, LiteralValue, ModuleType, NeverType, NoneType, ObjectType,
    OverloadedFunctionEntry, OverloadedFunctionType, PropertyType, removeNoneFromUnion,
    removeUnboundFromUnion, Type, TypeCategory, TypeVarMap, TypeVarType, UnboundType,
    UnknownType } from './types';
import { addDefaultFunctionParameters, addTypeVarsToListIfUnique, applyExpectedTypeForConstructor,
    areTypesSame, bindFunctionToClassOrObject, buildTypeVarMap, canAssignToTypedDict,
    canAssignToTypeVar, canAssignType, canBeFalsy, canBeTruthy, ClassMember,
    ClassMemberLookupFlags, constrainDeclaredTypeBasedOnAssignedType, containsUnknown,
    convertClassToObject, derivesFromClassRecursive, doForSubtypes,
    getAbstractMethodsRecursive, getDeclaredGeneratorSendType, getEffectiveReturnType,
    getMetaclass, getSpecializedTupleType, getTypedDictMembersForClassRecursive,
    getTypeOfMember, getTypeVarArgumentsRecursive, isEllipsisType, isEnumClass,
    isNoReturnType, isOptionalType, lookUpClassMember, lookUpObjectMember,
    printObjectTypeForClass, printType, removeFalsinessFromType, removeTruthinessFromType,
    requiresSpecialization, selfSpecializeClassType, specializeType, specializeTypeVarType,
    stripFirstParameter, stripLiteralValue, transformTypeObjectToClass,
    TypedDictEntry } from './typeUtils';

interface TypeResult {
    type: Type;
    unpackedType?: Type;
    typeList?: TypeResult[];
    node: ExpressionNode;
}

interface FunctionArgument {
    argumentCategory: ArgumentCategory;
    name?: NameNode;
    type?: Type;
    valueExpression?: ExpressionNode;
}

interface ValidateArgTypeParams {
    paramType: Type;
    requiresTypeVarMatching: boolean;
    argument: FunctionArgument;
    errorNode: ExpressionNode;
    paramName?: string;
}

interface ClassMemberLookup {
    // Type of value.
    type: Type;

    // True if class member, false otherwise.
    isClassMember: boolean;
}

type TypeNarrowingCallback = (type: Type) => Type | undefined;

export const enum EvaluatorFlags {
    None = 0,

    // Interpret an ellipsis type annotation to mean "Any".
    ConvertEllipsisToAny = 1,

    // Normally a generic named type is specialized with "Any"
    // types. This flag indicates that specialization shouldn't take
    // place.
    DoNotSpecialize = 2,

    // Allow forward references. Don't report unbound errors.
    AllowForwardReferences = 4
}

interface EvaluatorUsage {
    method: 'get' | 'set' | 'del';

    // Used only for set methods
    setType?: Type;
    setErrorNode?: ExpressionNode;

    // Used only for get methods
    expectedType?: Type;
}

interface AliasMapEntry {
    alias: string;
    module: 'builtins' | 'collections' | 'self';
}

export const enum MemberAccessFlags {
    None = 0,

    // By default, both class and instance members are considered.
    // Set this flag to skip the instance members.
    SkipInstanceMembers = 1 << 0,

    // By default, members of base classes are also searched.
    // Set this flag to consider only the specified class' members.
    SkipBaseClasses = 1 << 1,

    // Do not include the "object" base class in the search.
    SkipObjectBaseClass = 1 << 2,

    // By default, if the class has a __getattribute__ or __getattr__
    // magic method, it is assumed to have any member.
    SkipGetAttributeCheck = 1 << 3,

    // By default, if the class has a __get__ magic method, this is
    // followed to determine the final type. Properties use this
    // technique.
    SkipGetCheck = 1 << 4,

    // This set of flags is appropriate for looking up methods.
    SkipForMethodLookup = SkipInstanceMembers | SkipGetAttributeCheck | SkipGetCheck
}

interface ParamAssignmentInfo {
    argsNeeded: number;
    argsReceived: number;
}

export type SetAnalysisChangedCallback = (reason: string) => void;

type FlowNodeType = Type;

const arithmeticOperatorMap: { [operator: number]: [string, string] } = {
    [OperatorType.Add]: ['__add__', '__radd__'],
    [OperatorType.Subtract]: ['__sub__', '__rsub__'],
    [OperatorType.Multiply]: ['__mul__', '__rmul__'],
    [OperatorType.FloorDivide]: ['__floordiv__', '__rfloordiv__'],
    [OperatorType.Divide]: ['__truediv__', '__rtruediv__'],
    [OperatorType.Mod]: ['__mod__', '__rmod__'],
    [OperatorType.Power]: ['__pow__', '__rpow__'],
    [OperatorType.MatrixMultiply]: ['__matmul__', '']
};

const bitwiseOperatorMap: { [operator: number]: [string, string] } = {
    [OperatorType.BitwiseAnd]: ['__and__', '__rand__'],
    [OperatorType.BitwiseOr]: ['__or__', '__ror__'],
    [OperatorType.BitwiseXor]: ['__xor__', '__rxor__'],
    [OperatorType.LeftShift]: ['__lshift__', '__rlshift__'],
    [OperatorType.RightShift]: ['__rshift__', '__rrshift__']
};

const comparisonOperatorMap: { [operator: number]: [string, string] } = {
    [OperatorType.Equals]: ['__eq__', '__ne__'],
    [OperatorType.NotEquals]: ['__ne__', '__eq__'],
    [OperatorType.LessThan]: ['__lt__', '__gt__'],
    [OperatorType.LessThanOrEqual]: ['__le__', '__ge__'],
    [OperatorType.GreaterThan]: ['__gt__', '__lt__'],
    [OperatorType.GreaterThanOrEqual]: ['__ge__', '__le__']
};

const booleanOperatorMap: { [operator: number]: boolean } = {
    [OperatorType.And]: true,
    [OperatorType.Or]: true,
    [OperatorType.Is]: true,
    [OperatorType.IsNot]: true,
    [OperatorType.In]: true,
    [OperatorType.NotIn]: true
};

export interface ClassTypeResult {
    classType: ClassType;
    decoratedType: Type;
}

export interface FunctionTypeResult {
    functionType: FunctionType;
    decoratedType: Type;
}

export interface ExpressionEvaluator {
    getType: (node: ExpressionNode, usage: EvaluatorUsage, flags: EvaluatorFlags) => Type;
    getTypeOfAnnotation: (node: ExpressionNode) => Type;
    getTypeFromObjectMember: (errorNode: ExpressionNode, objectType: ObjectType, memberName: string,
        usage: EvaluatorUsage, memberAccessFlags: MemberAccessFlags, bindToClass?: ClassType) => Type | undefined;
    getTypeFromAwaitable: (type: Type, errorNode?: ParseNode) => Type;
    getTypeFromIterable: (type: Type, isAsync: boolean, errorNode: ParseNode | undefined, supportGetItem: boolean) => Type;
    getTypeFromDecorator: (node: DecoratorNode, functionOrClassType: Type) => Type;

    getTypeOfAssignmentStatementTarget: (node: AssignmentNode, targetOfInterest?: ExpressionNode) => Type | undefined;
    getTypeOfAugmentedAssignmentTarget: (node: AugmentedAssignmentNode, targetOfInterest?: ExpressionNode) => Type | undefined;
    getTypeOfClass: (node: ClassNode) => ClassTypeResult;
    getTypeOfFunction: (node: FunctionNode) => FunctionTypeResult;

    getTypingType: (node: ParseNode, symbolName: string) => Type | undefined;

    getDeclaredTypeForExpression: (expression: ExpressionNode) => Type | undefined;

    isAnnotationLiteralValue: (node: StringListNode) => boolean;

    isAfterNodeReachable: (node: ParseNode) => boolean;
    isNodeReachable: (node: ParseNode) => boolean;

    transformTypeForPossibleEnumClass: (node: NameNode, typeOfExpr: Type) => Type;

    assignTypeToNameNode: (nameNode: NameNode, type: Type, srcExpression?: ParseNode) => void;
    assignTypeToExpression: (target: ExpressionNode, type: Type, srcExpr?: ExpressionNode,
        targetOfInterest?: ExpressionNode) => Type | undefined;

    updateExpressionTypeForNode: (node: ParseNode, exprType: Type) => void;

    addError: (message: string, range: TextRange) => Diagnostic | undefined;
    addWarning: (message: string, range: TextRange) => Diagnostic | undefined;
    addDiagnostic: (diagLevel: DiagnosticLevel, rule: string, message: string, textRange: TextRange) => Diagnostic | undefined;
}

export function createExpressionEvaluator(diagnosticSink: TextRangeDiagnosticSink,
        analysisVersion: number, setAnalysisChangedCallback: SetAnalysisChangedCallback,
        accessedSymbolMap: Map<number, true>, importLookup: ImportLookup): ExpressionEvaluator {

    let isSpeculativeMode = false;
    const typeFlowRecursionMap = new Map<number, true>();

    function getType(node: ExpressionNode, usage: EvaluatorUsage = { method: 'get' }, flags = EvaluatorFlags.None): Type {
        return getTypeFromExpression(node, usage, flags).type;
    }

    function getTypeNoCache(node: ExpressionNode, usage: EvaluatorUsage = { method: 'get' }, flags = EvaluatorFlags.None): Type {
        let type: Type | undefined;
        useSpeculativeMode(() => {
            type = getTypeFromExpression(node, usage, flags).type;
        });
        return type!;
    }

    function getTypeOfAnnotation(node: ExpressionNode): Type {
        const fileInfo = getFileInfo(node);

        // Special-case the typing.pyi file, which contains some special
        // types that the type analyzer needs to interpret differently.
        if (fileInfo.isTypingStubFile) {
            const specialType = handleTypingStubTypeAnnotation(node);
            if (specialType) {
                updateExpressionTypeForNode(node, specialType);
                return specialType;
            }
        }

        let evaluatorFlags = EvaluatorFlags.ConvertEllipsisToAny;

        const isAnnotationEvaluationPostponed =
            fileInfo.futureImports.get('annotations') !== undefined ||
            fileInfo.isStubFile;

        if (isAnnotationEvaluationPostponed) {
            evaluatorFlags |= EvaluatorFlags.AllowForwardReferences;
        }

        return convertClassToObject(
            getTypeFromExpression(node, { method: 'get' }, evaluatorFlags).type);
    }

    function getTypeFromDecorator(node: DecoratorNode, functionOrClassType: Type): Type {
        const baseTypeResult = getTypeFromExpression(
            node.leftExpression, { method: 'get' }, EvaluatorFlags.DoNotSpecialize);

        let decoratorCall = baseTypeResult;

        // If the decorator has arguments, evaluate that call first.
        if (node.arguments) {
            const argList = node.arguments.map(arg => {
                const functionArg: FunctionArgument = {
                    valueExpression: arg.valueExpression,
                    argumentCategory: arg.argumentCategory,
                    name: arg.name
                };
                return functionArg;
            });

            // Evaluate the decorator, but don't specialize the
            // return result.
            decoratorCall = getTypeFromCallExpressionWithBaseType(
                node.leftExpression, argList, decoratorCall,
                { method: 'get' }, EvaluatorFlags.None, false);
        }

        const argList = [{
            argumentCategory: ArgumentCategory.Simple,
            type: functionOrClassType
        }];

        return getTypeFromCallExpressionWithBaseType(
            node.leftExpression, argList, decoratorCall, { method: 'get' },
                EvaluatorFlags.None, false).type;
    }

    // Gets a member type from an object and if it's a function binds
    // it to the object. If bindToClass is undefined, the binding is done
    // using the objectType parameter. Callers can specify these separately
    // to handle the case where we're fetching the object member from a
    // metaclass but binding to the class.
    function getTypeFromObjectMember(errorNode: ExpressionNode, objectType: ObjectType, memberName: string,
            usage: EvaluatorUsage, memberAccessFlags = MemberAccessFlags.None,
            bindToClass?: ClassType): Type | undefined {

        const memberInfo = getTypeFromClassMemberName(errorNode,
            objectType.classType, memberName, usage, memberAccessFlags);

        let resultType = memberInfo ? memberInfo.type : undefined;
        if (resultType) {
            if (resultType.category === TypeCategory.Function || resultType.category === TypeCategory.OverloadedFunction) {
                if (memberInfo!.isClassMember) {
                    resultType = bindFunctionToClassOrObject(
                        bindToClass || objectType, resultType,
                        importLookup, !!bindToClass);
                }
            }
        }

        return resultType;
    }

    // Gets a member type from a class and if it's a function binds
    // it to the object.
    function getTypeFromClassMember(errorNode: ExpressionNode, classType: ClassType, memberName: string,
            usage: EvaluatorUsage, memberAccessFlags = MemberAccessFlags.None): Type | undefined {

        const memberInfo = getTypeFromClassMemberName(errorNode,
            classType, memberName, usage, memberAccessFlags | MemberAccessFlags.SkipInstanceMembers);

        let resultType = memberInfo ? memberInfo.type : undefined;
        if (resultType) {
            if (resultType.category === TypeCategory.Function || resultType.category === TypeCategory.OverloadedFunction) {
                if (memberInfo!.isClassMember) {
                    resultType = bindFunctionToClassOrObject(classType,
                        resultType, importLookup);
                }
            }
        }

        return resultType;
    }

    // Determines whether the specified expression is a symbol with a declared type
    // (either a simple name or a member variable). If so, the type is returned.
    function getDeclaredTypeForExpression(expression: ExpressionNode): Type | undefined {
        let symbol: Symbol | undefined;
        let classOrObjectBase: ClassType | ObjectType | undefined;

        if (expression.nodeType === ParseNodeType.Name) {
            const symbolWithScope = lookUpSymbolRecursive(
                expression, expression.nameToken.value);
            if (symbolWithScope) {
                symbol = symbolWithScope.symbol;
            }
        } else if (expression.nodeType === ParseNodeType.TypeAnnotation) {
            return getDeclaredTypeForExpression(expression.valueExpression);
        } else if (expression.nodeType === ParseNodeType.MemberAccess) {
            // Get the base type but do so speculative because we're going to call again
            // with a 'set' usage type below, and we don't want to skip that logic.
            const baseType = getTypeNoCache(expression.leftExpression);
            let classMemberInfo: ClassMember | undefined;

            if (baseType.category === TypeCategory.Object) {
                classMemberInfo = lookUpObjectMember(baseType,
                    expression.memberName.nameToken.value, importLookup,
                    ClassMemberLookupFlags.DeclaredTypesOnly);
                classOrObjectBase = baseType;
            } else if (baseType.category === TypeCategory.Class) {
                classMemberInfo = lookUpClassMember(baseType,
                    expression.memberName.nameToken.value, importLookup,
                    ClassMemberLookupFlags.SkipInstanceVariables |
                    ClassMemberLookupFlags.DeclaredTypesOnly);
                classOrObjectBase = baseType;
            }

            if (classMemberInfo) {
                symbol = classMemberInfo.symbol;
            }
        } else if (expression.nodeType === ParseNodeType.Index) {
            const baseType = getDeclaredTypeForExpression(expression.baseExpression);
            if (baseType && baseType.category === TypeCategory.Object) {
                const setItemMember = lookUpClassMember(baseType.classType,
                    '__setitem__', importLookup);
                if (setItemMember) {
                    const setItemType = getTypeOfMember(setItemMember, importLookup);
                    if (setItemType.category === TypeCategory.Function) {
                        const boundFunction = bindFunctionToClassOrObject(baseType,
                            setItemType, importLookup);
                        if (boundFunction.category === TypeCategory.Function) {
                            if (boundFunction.details.parameters.length === 2) {
                                return FunctionType.getEffectiveParameterType(boundFunction, 1);
                            }
                        }
                    }
                }
            }
        }

        if (symbol) {
            let declaredType = getDeclaredTypeOfSymbol(symbol);
            if (declaredType) {
                // If it's a property, we need to get the setter's type.
                if (declaredType.category === TypeCategory.Property) {
                    if (!declaredType.setter ||
                            declaredType.setter.category !== TypeCategory.Function ||
                            declaredType.setter.details.parameters.length < 2) {

                        return undefined;
                    }

                    declaredType = declaredType.setter.details.parameters[1].type;
                }

                if (classOrObjectBase) {
                    declaredType = bindFunctionToClassOrObject(classOrObjectBase,
                        declaredType, importLookup);
                }

                return declaredType;
            }
        }

        return undefined;
    }

    // Applies an "await" operation to the specified type and returns
    // the result. According to PEP 492, await operates on:
    // 1) a generator object
    // 2) an Awaitable (object that provides an __await__ that
    //    returns a generator object)
    // If errorNode is undefined, no errors are reported.
    function getTypeFromAwaitable(type: Type, errorNode?: ParseNode): Type {
        return doForSubtypes(type, subtype => {
            if (isAnyOrUnknown(subtype)) {
                return subtype;
            }

            const generatorReturnType = getReturnTypeFromGenerator(subtype);
            if (generatorReturnType) {
                return generatorReturnType;
            }

            if (subtype.category === TypeCategory.Object) {
                const awaitReturnType = getSpecializedReturnType(
                    subtype, '__await__');
                if (awaitReturnType) {
                    if (isAnyOrUnknown(awaitReturnType)) {
                        return awaitReturnType;
                    }

                    if (awaitReturnType.category === TypeCategory.Object) {
                        const iterReturnType = getSpecializedReturnType(
                            awaitReturnType, '__iter__');

                        if (iterReturnType) {
                            const generatorReturnType = getReturnTypeFromGenerator(
                                awaitReturnType);
                            if (generatorReturnType) {
                                return generatorReturnType;
                            }
                        }
                    }
                }
            }

            if (errorNode) {
                addError(`'${ printType(subtype) }' is not awaitable`, errorNode);
            }

            return UnknownType.create();
        });
    }

    // Validates that the type is iterable and returns the iterated type.
    // If errorNode is undefined, no errors are reported.
    function getTypeFromIterable(type: Type, isAsync: boolean, errorNode: ParseNode | undefined,
            supportGetItem: boolean): Type {

        const iterMethodName = isAsync ? '__aiter__' : '__iter__';
        const nextMethodName = isAsync ? '__anext__' : '__next__';
        const getItemMethodName = supportGetItem ? '__getitem__' : '';

        if (type.category === TypeCategory.Union && type.subtypes.some(t => isNoneOrNever(t))) {
            if (errorNode) {
                addDiagnostic(
                    getFileInfo(errorNode).diagnosticSettings.reportOptionalIterable,
                    DiagnosticRule.reportOptionalIterable,
                    `Object of type 'None' cannot be used as iterable value`,
                    errorNode);
            }
            type = removeNoneFromUnion(type);
        }

        const getIteratorReturnType = (objType: ObjectType, metaclass: ClassType | undefined,
                diag: DiagnosticAddendum): Type | undefined => {

            const iterReturnType = metaclass ?
                getSpecializedReturnTypeForMetaclassMethod(metaclass,
                    objType.classType, iterMethodName) :
                getSpecializedReturnType(objType, iterMethodName);
            if (!iterReturnType) {
                // There was no __iter__. See if we can fall back to
                // the __getitem__ method instead.
                if (getItemMethodName) {
                    const getItemReturnType = getSpecializedReturnType(
                        objType, getItemMethodName);
                    if (getItemReturnType) {
                        return getItemReturnType;
                    }
                }

                diag.addMessage(`'${ iterMethodName }' method not defined`);
            } else {
                if (isAnyOrUnknown(iterReturnType)) {
                    return iterReturnType;
                }

                if (iterReturnType.category === TypeCategory.Object) {
                    const nextReturnType = getSpecializedReturnType(
                        iterReturnType, nextMethodName);

                    if (!nextReturnType) {
                        diag.addMessage(`'${ nextMethodName }' method not defined on type ` +
                            `'${ printType(iterReturnType) }'`);
                    } else {
                        if (!isAsync) {
                            return nextReturnType;
                        }

                        // If it's an async iteration, there's an implicit
                        // 'await' operator applied.
                        return getTypeFromAwaitable(nextReturnType, errorNode);
                    }
                } else {
                    diag.addMessage(`'${ iterMethodName }' method does not return an object`);
                }
            }

            return undefined;
        };

        return doForSubtypes(type, subtype => {
            if (isAnyOrUnknown(subtype)) {
                return subtype;
            }

            const diag = new DiagnosticAddendum();
            if (subtype.category === TypeCategory.Object) {
                const returnType = getIteratorReturnType(subtype, undefined, diag);
                if (returnType) {
                    return returnType;
                }
            } else if (subtype.category === TypeCategory.Class) {
                // Handle the case where the class itself is iterable.
                // This is true for classes that derive from Enum, for example.
                const metaclassType = getMetaclass(subtype);
                if (metaclassType) {
                    if (metaclassType.category === TypeCategory.Class) {
                        const returnType = getIteratorReturnType(
                            ObjectType.create(subtype), metaclassType, diag);
                        if (returnType) {
                            return returnType;
                        }
                    }
                }
            }

            if (errorNode) {
                addError(`'${ printType(subtype) }' is not iterable` + diag.getString(),
                    errorNode);
            }

            return UnknownType.create();
        });
    }

    // Validates fields for compatibility with a dataclass and synthesizes
    // an appropriate __new__ and __init__ methods.
    function synthesizeDataClassMethods(node: ClassNode, classType: ClassType, skipSynthesizeInit: boolean) {
        assert(ClassType.isDataClass(classType));

        const newType = FunctionType.create(
            FunctionTypeFlags.StaticMethod | FunctionTypeFlags.SynthesizedMethod);
        const initType = FunctionType.create(
            FunctionTypeFlags.InstanceMethod | FunctionTypeFlags.SynthesizedMethod);

        FunctionType.addParameter(newType, {
            category: ParameterCategory.Simple,
            name: 'cls',
            type: classType
        });
        addDefaultFunctionParameters(newType);
        FunctionType.setDeclaredReturnType(newType, ObjectType.create(classType));

        FunctionType.addParameter(initType, {
            category: ParameterCategory.Simple,
            name: 'self',
            type: ObjectType.create(classType)
        });
        FunctionType.setDeclaredReturnType(initType, NoneType.create());

        // Maintain a list of all dataclass parameters (including
        // those from inherited classes) plus a list of only those
        // parameters added by this class.
        const localDataClassParameters: FunctionParameter[] = [];
        const fullDataClassParameters: FunctionParameter[] = [];
        addInheritedDataClassParametersRecursive(classType, fullDataClassParameters);

        node.suite.statements.forEach(statementList => {
            if (statementList.nodeType === ParseNodeType.StatementList) {
                statementList.statements.forEach(statement => {
                    let variableNameNode: NameNode | undefined;
                    let variableType: Type | undefined;
                    let hasDefaultValue = false;

                    if (statement.nodeType === ParseNodeType.Assignment) {
                        if (statement.leftExpression.nodeType === ParseNodeType.Name) {
                            variableNameNode = statement.leftExpression;
                            variableType = stripLiteralValue(
                                getTypeFromExpression(statement.rightExpression, { method: 'get' }).type);
                        } else if (statement.leftExpression.nodeType === ParseNodeType.TypeAnnotation &&
                                statement.leftExpression.valueExpression.nodeType === ParseNodeType.Name) {

                            variableNameNode = statement.leftExpression.valueExpression;
                            variableType = convertClassToObject(
                                getTypeFromExpression(statement.leftExpression.typeAnnotation, { method: 'get' },
                                    EvaluatorFlags.ConvertEllipsisToAny).type);
                        }

                        hasDefaultValue = true;
                    } else if (statement.nodeType === ParseNodeType.TypeAnnotation) {
                        if (statement.valueExpression.nodeType === ParseNodeType.Name) {
                            variableNameNode = statement.valueExpression;
                            variableType = convertClassToObject(
                                getTypeFromExpression(statement.typeAnnotation, { method: 'get' },
                                    EvaluatorFlags.ConvertEllipsisToAny).type);
                        }
                    }

                    if (variableNameNode && variableType) {
                        const variableName = variableNameNode.nameToken.value;

                        // Add the new variable to the init function.
                        const paramInfo: FunctionParameter = {
                            category: ParameterCategory.Simple,
                            name: variableName,
                            hasDefault: hasDefaultValue,
                            type: variableType
                        };

                        // Add the new parameter to the local parameter list.
                        let insertIndex = localDataClassParameters.findIndex(p => p.name === variableName);
                        if (insertIndex >= 0) {
                            localDataClassParameters[insertIndex] = paramInfo;
                        } else {
                            localDataClassParameters.push(paramInfo);
                        }

                        // Add the new parameter to the full parameter list.
                        insertIndex = fullDataClassParameters.findIndex(p => p.name === variableName);
                        if (insertIndex >= 0) {
                            fullDataClassParameters[insertIndex] = paramInfo;
                        } else {
                            fullDataClassParameters.push(paramInfo);
                            insertIndex = fullDataClassParameters.length - 1;
                        }

                        // If we've already seen a variable with a default value defined,
                        // all subsequent variables must also have default values.
                        const firstDefaultValueIndex = fullDataClassParameters.findIndex(p => p.hasDefault);
                        if (!hasDefaultValue && firstDefaultValueIndex >= 0 && firstDefaultValueIndex < insertIndex) {
                            addError(`Data fields without default value cannot appear after ` +
                                `data fields with default values`, variableNameNode);
                        }
                    }
                });
            }
        });

        ClassType.updateDataClassParameters(classType, localDataClassParameters);

        if (!skipSynthesizeInit) {
            fullDataClassParameters.forEach(paramInfo => {
                FunctionType.addParameter(initType, paramInfo);
            });

            const symbolTable = ClassType.getFields(classType);
            symbolTable.set('__init__', Symbol.createWithType(
                    SymbolFlags.ClassMember, initType));
            symbolTable.set('__new__', Symbol.createWithType(
                    SymbolFlags.ClassMember, newType));
        }
    }

    function synthesizeTypedDictClassMethods(classType: ClassType) {
        assert(ClassType.isTypedDictClass(classType));

        // Synthesize a __new__ method.
        const newType = FunctionType.create(
            FunctionTypeFlags.StaticMethod | FunctionTypeFlags.SynthesizedMethod);
        FunctionType.addParameter(newType, {
            category: ParameterCategory.Simple,
            name: 'cls',
            type: classType
        });
        addDefaultFunctionParameters(newType);
        FunctionType.setDeclaredReturnType(newType, ObjectType.create(classType));

        // Synthesize an __init__ method.
        const initType = FunctionType.create(
            FunctionTypeFlags.InstanceMethod | FunctionTypeFlags.SynthesizedMethod);
        FunctionType.addParameter(initType, {
            category: ParameterCategory.Simple,
            name: 'self',
            type: ObjectType.create(classType)
        });
        FunctionType.setDeclaredReturnType(initType, NoneType.create());

        // All parameters must be named, so insert an empty "*".
        FunctionType.addParameter(initType, {
            category: ParameterCategory.VarArgList,
            type: AnyType.create()
        });

        const entries = new StringMap<TypedDictEntry>();
        getTypedDictMembersForClassRecursive(classType, entries);
        entries.forEach((entry, name) => {
            FunctionType.addParameter(initType, {
                category: ParameterCategory.Simple,
                name,
                hasDefault: !entry.isRequired,
                type: entry.valueType
            });
        });

        const symbolTable = ClassType.getFields(classType);
        symbolTable.set('__init__', Symbol.createWithType(SymbolFlags.ClassMember, initType));
        symbolTable.set('__new__', Symbol.createWithType(SymbolFlags.ClassMember, newType));
    }

    function getTypingType(node: ParseNode, symbolName: string): Type | undefined {
        const fileInfo = getFileInfo(node);
        const typingImportPath = fileInfo.typingModulePath;
        if (!typingImportPath) {
            return undefined;
        }

        const lookupResult = importLookup(typingImportPath);
        if (!lookupResult) {
            return undefined;
        }

        const symbol = lookupResult.symbolTable.get(symbolName);
        if (!symbol) {
            return undefined;
        }

        return getEffectiveTypeOfSymbol(symbol, importLookup);
    }

    function isNodeReachable(node: ParseNode): boolean {
        const flowNode = AnalyzerNodeInfo.getFlowNode(node);
        if (!flowNode) {
            return true;
        }

        return isFlowNodeReachable(flowNode);
    }

    function isAfterNodeReachable(node: ParseNode): boolean {
        const returnFlowNode = AnalyzerNodeInfo.getAfterFlowNode(node);
        if (!returnFlowNode) {
            return false;
        }

        return isFlowNodeReachable(returnFlowNode);
    }

    // Determines whether the specified string literal is part
    // of a Literal['xxx'] statement. If so, we will not treat
    // the string as a normal forward-declared type annotation.
    function isAnnotationLiteralValue(node: StringListNode): boolean {
        if (node.parent && node.parent.nodeType === ParseNodeType.IndexItems) {
            const indexItemsNode = node.parent;
            if (indexItemsNode.parent && indexItemsNode.parent.nodeType === ParseNodeType.Index) {
                const indexNode = indexItemsNode.parent;
                const baseType = AnalyzerNodeInfo.getExpressionType(indexNode.baseExpression);
                if (baseType && baseType.category === TypeCategory.Class) {
                    if (ClassType.isSpecialBuiltIn(baseType, 'Literal')) {
                        return true;
                    }
                }
            }
        }

        return false;
    }

    function addWarning(message: string, range: TextRange) {
        if (!isSpeculativeMode) {
            return diagnosticSink.addWarningWithTextRange(message, range);
        }

        return undefined;
    }

    function addError(message: string, range: TextRange) {
        if (!isSpeculativeMode) {
            return diagnosticSink.addErrorWithTextRange(message, range);
        }

        return undefined;
    }

    function addDiagnostic(diagLevel: DiagnosticLevel, rule: string, message: string, textRange: TextRange) {
        let diagnostic: Diagnostic | undefined;

        if (diagLevel === 'error') {
            diagnostic = addError(message, textRange);
        } else if (diagLevel === 'warning') {
            diagnostic = addWarning(message, textRange);
        }

        if (diagnostic) {
            diagnostic.setRule(rule);
        }

        return diagnostic;
    }

    function assignTypeToNameNode(nameNode: NameNode, type: Type, srcExpression?: ParseNode) {
        const nameValue = nameNode.nameToken.value;

        const symbolWithScope = lookUpSymbolRecursive(nameNode, nameValue);
        if (!symbolWithScope) {
            assert.fail(`Missing symbol '${ nameValue }'`);
            return;
        }

        const declarations = symbolWithScope.symbol.getDeclarations();
        const declaredType = getDeclaredTypeOfSymbol(symbolWithScope.symbol);

        // We found an existing declared type. Make sure the type is assignable.
        let destType = type;
        if (declaredType && srcExpression) {
            const diagAddendum = new DiagnosticAddendum();
            if (!canAssignType(declaredType, type, diagAddendum, importLookup)) {
                addError(`Expression of type '${ printType(type) }' cannot be ` +
                    `assigned to declared type '${ printType(declaredType) }'` + diagAddendum.getString(),
                    srcExpression || nameNode);
                destType = declaredType;
            } else {
                // Constrain the resulting type to match the declared type.
                destType = constrainDeclaredTypeBasedOnAssignedType(
                    declaredType, type, importLookup);
            }
        } else {
            // If this is a member name (within a class scope) and the member name
            // appears to be a constant, use the strict source type. If it's a member
            // variable that can be overridden by a child class, use the more general
            // version by stripping off the literal.
            const scope = ScopeUtils.getScopeForNode(nameNode);
            if (scope.getType() === ScopeType.Class) {
                const isConstant = isConstantName(nameValue);
                const isPrivate = isPrivateOrProtectedName(nameValue);

                if (!isConstant && (!isPrivate ||
                        getFileInfo(nameNode).diagnosticSettings.reportPrivateUsage === 'none')) {
                    destType = stripLiteralValue(destType);
                }
            }
        }

        const varDecl: Declaration | undefined = declarations.find(
            decl => decl.type === DeclarationType.Variable);
        if (varDecl && varDecl.type === DeclarationType.Variable &&
                varDecl.isConstant && srcExpression) {

            // A constant variable can be assigned only once. If this isn't the
            // first assignment, generate an error.
            if (nameNode !== declarations[0].node) {
                addDiagnostic(
                    getFileInfo(nameNode).diagnosticSettings.reportConstantRedefinition,
                    DiagnosticRule.reportConstantRedefinition,
                    `'${ nameValue }' is constant and cannot be redefined`,
                    nameNode);
            }
        }

        updateExpressionTypeForNode(nameNode, destType);
    }

    function assignTypeToMemberAccessNode(target: MemberAccessNode, type: Type,
            srcExpr?: ExpressionNode) {
        const targetNode = target.leftExpression;

        // Handle member accesses (e.g. self.x or cls.y).
        if (targetNode.nodeType === ParseNodeType.Name) {
            // Determine whether we're writing to a class or instance member.
            const enclosingClassNode = ParseTreeUtils.getEnclosingClass(target);

            if (enclosingClassNode) {
                const classType = AnalyzerNodeInfo.getExpressionType(enclosingClassNode);

                if (classType && classType.category === TypeCategory.Class) {
                    const typeOfLeftExpr = getTypeFromExpression(target.leftExpression).type;
                    if (typeOfLeftExpr.category === TypeCategory.Object) {
                        if (ClassType.isSameGenericClass(typeOfLeftExpr.classType, classType)) {
                            assignTypeToMemberVariable(target, type, true, srcExpr);
                        }
                    } else if (typeOfLeftExpr.category === TypeCategory.Class) {
                        if (ClassType.isSameGenericClass(typeOfLeftExpr, classType)) {
                            assignTypeToMemberVariable(target, type, false, srcExpr);
                        }
                    }
                }
            }
        }
    }

    function assignTypeToMemberVariable(node: MemberAccessNode, srcType: Type,
            isInstanceMember: boolean, srcExprNode?: ExpressionNode) {

        const memberName = node.memberName.nameToken.value;
        const fileInfo = getFileInfo(node);

        const classDef = ParseTreeUtils.getEnclosingClass(node);
        if (!classDef) {
            return;
        }

        let destType = srcType;

        const classType = AnalyzerNodeInfo.getExpressionType(classDef);
        if (classType && classType.category === TypeCategory.Class) {
            let memberInfo = lookUpClassMember(classType, memberName,
                importLookup, isInstanceMember ? ClassMemberLookupFlags.Default :
                    ClassMemberLookupFlags.SkipInstanceVariables);

            const memberFields = ClassType.getFields(classType);
            if (memberInfo) {
                // Are we accessing an existing member on this class, or is
                // it a member on a parent class?
                const isThisClass = memberInfo.classType.category === TypeCategory.Class &&
                        ClassType.isSameGenericClass(classType, memberInfo.classType);

                if (isThisClass && memberInfo.isInstanceMember === isInstanceMember) {
                    const symbol = memberFields.get(memberName)!;
                    assert(symbol !== undefined);

                    const typedDecls = symbol.getDeclarations();

                    // Check for an attempt to overwrite a constant member variable.
                    if (typedDecls.length > 0 && typedDecls[0].type === DeclarationType.Variable &&
                            typedDecls[0].isConstant && srcExprNode) {

                        if (node.memberName !== typedDecls[0].node) {
                            addDiagnostic(
                                fileInfo.diagnosticSettings.reportConstantRedefinition,
                                DiagnosticRule.reportConstantRedefinition,
                                `'${ node.memberName.nameToken.value }' is constant and cannot be redefined`,
                                node.memberName);
                        }
                    }
                } else {
                    // Is the target a property?
                    const declaredType = getDeclaredTypeOfSymbol(memberInfo.symbol);
                    if (declaredType && declaredType.category !== TypeCategory.Property) {
                        // Handle the case where there is a class variable defined with the same
                        // name, but there's also now an instance variable introduced. Combine the
                        // type of the class variable with that of the new instance variable.
                        if (!memberInfo.isInstanceMember && isInstanceMember) {
                            // The class variable is accessed in this case.
                            setSymbolAccessed(memberInfo.symbol);
                            const memberType = getTypeOfMember(memberInfo, importLookup);
                            srcType = combineTypes([srcType, memberType]);
                        }
                    }
                }
            }

            // Look up the member info again, now that we've potentially updated it.
            memberInfo = lookUpClassMember(classType, memberName,
                importLookup, ClassMemberLookupFlags.DeclaredTypesOnly);
            if (memberInfo) {
                const declaredType = getDeclaredTypeOfSymbol(memberInfo.symbol);
                if (declaredType && !isAnyOrUnknown(declaredType)) {
                    if (declaredType.category === TypeCategory.Function) {
                        // Overwriting an existing method.
                        // TODO - not sure what assumption to make here.
                    } else if (declaredType.category === TypeCategory.Property) {
                        // TODO - need to validate property setter type.
                    } else {
                        const diagAddendum = new DiagnosticAddendum();
                        if (canAssignType(declaredType, srcType,
                                diagAddendum, importLookup)) {

                            // Constrain the resulting type to match the declared type.
                            destType = constrainDeclaredTypeBasedOnAssignedType(
                                destType, srcType, importLookup);
                        }
                    }
                }
            } else {
                // There was no declared type, so we need to infer the type.
                if (srcExprNode) {
                    reportPossibleUnknownAssignment(
                        fileInfo.diagnosticSettings.reportUnknownMemberType,
                        DiagnosticRule.reportUnknownMemberType,
                        node.memberName, srcType, srcExprNode);
                }
            }
        }
    }

    function assignTypeToTupleNode(target: TupleNode, type: Type, srcExpr?: ExpressionNode,
            targetOfInterest?: ExpressionNode): Type | undefined {

        let targetOfInterestType: Type | undefined;

        // Initialize the array of target types, one for each target.
        const targetTypes: Type[][] = new Array(target.expressions.length);
        for (let i = 0; i < target.expressions.length; i++) {
            targetTypes[i] = [];
        }

        doForSubtypes(type, subtype => {
            // Is this subtype a tuple?
            const tupleType = getSpecializedTupleType(subtype);
            if (tupleType && ClassType.getTypeArguments(tupleType)) {
                const entryTypes = ClassType.getTypeArguments(tupleType)!;
                let entryCount = entryTypes.length;

                const sourceEndsInEllipsis = entryCount > 0 &&
                    isEllipsisType(entryTypes[entryCount - 1]);
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
                        addError(
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
                        addError(
                            `Tuple size mismatch: expected ${ target.expressions.length }` +
                                ` but got ${ entryCount }`,
                            target);
                    }
                }
            } else {
                // The assigned expression isn't a tuple, so it had better
                // be some iterable type.
                const iterableType = getTypeFromIterable(
                    subtype, false, srcExpr, false);
                for (let index = 0; index < target.expressions.length; index++) {
                    targetTypes[index].push(iterableType);
                }
            }

            // We need to return something to satisfy doForSubtypes.
            return undefined;
        });

        // Assign the resulting types to the individual names in the tuple target expression.
        target.expressions.forEach((expr, index) => {
            const typeList = targetTypes[index];
            const targetType = typeList.length === 0 ? UnknownType.create() : combineTypes(typeList);
            const targetOfInterestTypeForEntry = assignTypeToExpression(expr,
                targetType, srcExpr, targetOfInterest);
            if (targetOfInterestTypeForEntry) {
                targetOfInterestType = targetOfInterestTypeForEntry;
            }
        });

        return targetOfInterestType;
    }

    function assignTypeToExpression(target: ExpressionNode, type: Type, srcExpr?: ExpressionNode,
            targetOfInterest?: ExpressionNode): Type | undefined {

        let typeOfTargetOfInterest: Type | undefined;

        switch (target.nodeType) {
            case ParseNodeType.Name: {
                const name = target.nameToken;
                // Handle '__all__' as a special case in the module scope.
                if (name.value === '__all__' && srcExpr) {
                    const scope = ScopeUtils.getScopeForNode(target);
                    if (scope.getType() === ScopeType.Module) {
                        // It's common for modules to include the expression
                        // __all__ = ['a', 'b', 'c']
                        // We will mark the symbols referenced by these strings as accessed.
                        if (srcExpr.nodeType === ParseNodeType.List) {
                            srcExpr.entries.forEach(entryExpr => {
                                if (entryExpr.nodeType === ParseNodeType.StringList || entryExpr.nodeType === ParseNodeType.String) {
                                    const symbolName = entryExpr.nodeType === ParseNodeType.String ?
                                        entryExpr.value :
                                        entryExpr.strings.map(s => s.value).join('');
                                    const symbolInScope = scope.lookUpSymbolRecursive(symbolName);
                                    if (symbolInScope) {
                                        setSymbolAccessed(symbolInScope.symbol);
                                    }
                                }
                            });
                        }
                    }
                }

                reportPossibleUnknownAssignment(
                    getFileInfo(target).diagnosticSettings.reportUnknownVariableType,
                    DiagnosticRule.reportUnknownVariableType,
                    target, type, srcExpr || target);

                assignTypeToNameNode(target, type, srcExpr);
                if (target === targetOfInterest) {
                    typeOfTargetOfInterest = type;
                }
                break;
            }

            case ParseNodeType.MemberAccess: {
                assignTypeToMemberAccessNode(target, type, srcExpr);
                if (target === targetOfInterest) {
                    typeOfTargetOfInterest = type;
                }
                break;
            }

            case ParseNodeType.Tuple: {
                typeOfTargetOfInterest = assignTypeToTupleNode(target, type, srcExpr,
                    targetOfInterest);
                break;
            }

            case ParseNodeType.TypeAnnotation: {
                const typeHintType = getTypeOfAnnotation(target.typeAnnotation);
                const diagAddendum = new DiagnosticAddendum();
                if (canAssignType(typeHintType, type, diagAddendum, importLookup)) {
                    type = constrainDeclaredTypeBasedOnAssignedType(
                        typeHintType, type, importLookup);
                }

                typeOfTargetOfInterest = assignTypeToExpression(target.valueExpression,
                    type, srcExpr, targetOfInterest);
                break;
            }

            case ParseNodeType.Unpack: {
                if (target.expression.nodeType === ParseNodeType.Name) {
                    if (!isAnyOrUnknown(type)) {
                        // Make a list type from the source.
                        const listType = getBuiltInType(target, 'List');
                        if (listType.category === TypeCategory.Class) {
                            type = ObjectType.create(ClassType.cloneForSpecialization(listType, [type]));
                        } else {
                            type = UnknownType.create();
                        }
                    }
                    assignTypeToNameNode(target.expression, type);
                    if (target.expression === targetOfInterest) {
                        typeOfTargetOfInterest = type;
                    }
                }
                break;
            }

            case ParseNodeType.List: {
                // The assigned expression had better be some iterable type.
                const iteratedType = getTypeFromIterable(
                    type, false, srcExpr, false);

                target.entries.forEach(entry => {
                    const targetOfInterestForListItem = assignTypeToExpression(entry, iteratedType,
                        srcExpr, targetOfInterest);
                    if (targetOfInterestForListItem) {
                        typeOfTargetOfInterest = targetOfInterestForListItem;
                    }
                });
                break;
            }
        }

        // Make sure we can write the type back to the target.
        getTypeFromExpression(target, { method: 'set', setType: type, setErrorNode: srcExpr });

        return typeOfTargetOfInterest;
    }

    function updateExpressionTypeForNode(node: ParseNode, exprType: Type) {
        if (!isSpeculativeMode) {
            const oldWriteVersion = AnalyzerNodeInfo.getExpressionTypeWriteVersion(node);

            // If the type was already cached this pass, don't overwrite the value.
            // This can happen in the case of augmented assignments, which share
            // a source and destination expression.
            if (oldWriteVersion !== analysisVersion) {
                const oldType = AnalyzerNodeInfo.peekExpressionType(node);
                const requiresInvalidation = AnalyzerNodeInfo.setExpressionTypeWriteVersion(
                    node, analysisVersion);

                if (!oldType || !isTypeSame(oldType, exprType)) {
                    if (requiresInvalidation) {

                        // TODO - REMOVE THIS DEBUGGING CODE
                        setAnalysisChangedCallback('Expression type changed');
                        const aaa = oldType && isTypeSame(oldType, exprType);
                    }
                    AnalyzerNodeInfo.setExpressionType(node, exprType);
                }
            }
        }
    }

    function setSymbolAccessed(symbol: Symbol) {
        if (!isSpeculativeMode) {
            accessedSymbolMap.set(symbol.getId(), true);
        }
    }

    // Builds a sorted list of dataclass parameters that are inherited by
    // the specified class. These parameters must be unique and in reverse-MRO
    // order.
    function addInheritedDataClassParametersRecursive(classType: ClassType, params: FunctionParameter[]) {
        // Recursively call for reverse-MRO ordering.
        classType.details.baseClasses.forEach(baseClass => {
            if (baseClass.type.category === TypeCategory.Class) {
                addInheritedDataClassParametersRecursive(baseClass.type, params);
            }
        });

        classType.details.baseClasses.forEach(baseClass => {
            if (baseClass.type.category === TypeCategory.Class) {
                const dataClassParams = ClassType.getDataClassParameters(baseClass.type);

                // Add the parameters to the end of the list, replacing same-named
                // parameters if found.
                dataClassParams.forEach(param => {
                    const existingIndex = params.findIndex(p => p.name === param.name);
                    if (existingIndex >= 0) {
                        params[existingIndex] = param;
                    } else {
                        params.push(param);
                    }
                });
            }
        });
    }

    function getReturnTypeFromGenerator(type: Type): Type | undefined {
        if (isAnyOrUnknown(type)) {
            return type;
        }

        if (type.category === TypeCategory.Object) {
            // Is this a Generator? If so, return the third
            // type argument, which is the await response type.
            const classType = type.classType;
            if (ClassType.isBuiltIn(classType, 'Generator')) {
                const typeArgs = ClassType.getTypeArguments(classType);
                if (typeArgs && typeArgs.length >= 3) {
                    return typeArgs[2];
                }
            }
        }

        return undefined;
    }

    function getSpecializedReturnType(objType: ObjectType, memberName: string) {
        const classMember = lookUpObjectMember(objType, memberName,
            importLookup, ClassMemberLookupFlags.SkipInstanceVariables);
        if (!classMember) {
            return undefined;
        }

        const memberType = getTypeOfMember(classMember, importLookup);
        if (isAnyOrUnknown(memberType)) {
            return memberType;
        }

        if (memberType.category === TypeCategory.Function) {
            const methodType = bindFunctionToClassOrObject(objType,
                memberType, importLookup) as FunctionType;
            return getEffectiveReturnType(methodType);
        }

        return undefined;
    }

    // This is similar to _getSpecializedReturnType except that
    // the method lookup occurs on a metaclass rather than
    // the object that derives from it.
    function getSpecializedReturnTypeForMetaclassMethod(
            metaclass: ClassType, classType: ClassType, memberName: string) {

        const classMember = lookUpObjectMember(
            ObjectType.create(metaclass), memberName, importLookup,
            ClassMemberLookupFlags.SkipInstanceVariables);
        if (!classMember) {
            return undefined;
        }

        const memberType = getTypeOfMember(classMember, importLookup);
        if (isAnyOrUnknown(memberType)) {
            return memberType;
        }

        if (memberType.category === TypeCategory.Function) {
            const methodType = bindFunctionToClassOrObject(
                classType, memberType, importLookup, true) as FunctionType;
            return getEffectiveReturnType(methodType);
        }

        return undefined;
    }

    function getTypeFromExpression(node: ExpressionNode, usage: EvaluatorUsage = { method: 'get' },
            flags = EvaluatorFlags.None): TypeResult {

        // Is this type already cached?
        const cachedType = AnalyzerNodeInfo.peekExpressionType(node, analysisVersion);
        if (cachedType) {
            return { type: cachedType, node };
        }

        let typeResult: TypeResult | undefined;

        switch (node.nodeType) {
            case ParseNodeType.Name: {
                typeResult = getTypeFromName(node, usage, flags);
                break;
            }

            case ParseNodeType.MemberAccess: {
                typeResult = getTypeFromMemberAccessExpression(node, usage, flags);
                break;
            }

            case ParseNodeType.Index: {
                typeResult = getTypeFromIndexExpression(node, usage, flags);
                break;
            }

            case ParseNodeType.Call: {
                reportUsageErrorForReadOnly(node, usage);
                typeResult = getTypeFromCallExpression(node, usage, flags);
                break;
            }

            case ParseNodeType.Tuple: {
                typeResult = getTypeFromTupleExpression(node, usage);
                break;
            }

            case ParseNodeType.Constant: {
                reportUsageErrorForReadOnly(node, usage);
                typeResult = getTypeFromConstantExpression(node);
                break;
            }

            case ParseNodeType.StringList: {
                reportUsageErrorForReadOnly(node, usage);
                if (node.typeAnnotation && !isAnnotationLiteralValue(node)) {
                    return getTypeFromExpression(
                        node.typeAnnotation, usage, flags | EvaluatorFlags.AllowForwardReferences);
                }

                // Evaluate the format string expressions in this context.
                node.strings.forEach(str => {
                    if (str.nodeType === ParseNodeType.FormatString) {
                        str.expressions.forEach(expr => {
                            getTypeFromExpression(expr);
                        });
                    }
                });

                const isBytes = (node.strings[0].token.flags & StringTokenFlags.Bytes) !== 0;
                typeResult = { node, type: cloneBuiltinTypeWithLiteral(node,
                    isBytes ? 'bytes' : 'str', node.strings.map(s => s.value).join('')) };
                break;
            }

            case ParseNodeType.Number: {
                reportUsageErrorForReadOnly(node, usage);
                typeResult = { node, type: cloneBuiltinTypeWithLiteral(node,
                    node.token.isInteger ? 'int' : 'float', node.token.value) };
                break;
            }

            case ParseNodeType.Ellipsis: {
                reportUsageErrorForReadOnly(node, usage);
                if ((flags & EvaluatorFlags.ConvertEllipsisToAny) !== 0) {
                    typeResult = { type: AnyType.create(true), node };
                } else {
                    const ellipsisType = getBuiltInType(node, 'ellipsis') ||
                        AnyType.create();
                    typeResult = { type: ellipsisType, node };
                }
                break;
            }

            case ParseNodeType.UnaryOperation: {
                reportUsageErrorForReadOnly(node, usage);
                typeResult = getTypeFromUnaryOperation(node);
                break;
            }

            case ParseNodeType.BinaryOperation: {
                reportUsageErrorForReadOnly(node, usage);
                typeResult = getTypeFromBinaryExpression(node);
                break;
            }

            case ParseNodeType.AugmentedAssignment: {
                reportUsageErrorForReadOnly(node, usage);
                const type = getTypeFromAugmentedAssignment(node);
                assignTypeToExpression(node.destExpression, type, node.rightExpression);
                typeResult = { type, node };
                break;
            }

            case ParseNodeType.List: {
                typeResult = getTypeFromListExpression(node, usage);
                break;
            }

            case ParseNodeType.Slice: {
                reportUsageErrorForReadOnly(node, usage);
                typeResult = getTypeFromSliceExpression(node);
                break;
            }

            case ParseNodeType.Await: {
                typeResult = getTypeFromExpression(
                    node.expression, { method: 'get' }, flags);
                typeResult = {
                    type: getTypeFromAwaitable(typeResult.type, node.expression),
                    node
                };
                break;
            }

            case ParseNodeType.Ternary: {
                reportUsageErrorForReadOnly(node, usage);
                typeResult = getTypeFromTernaryExpression(node, flags);
                break;
            }

            case ParseNodeType.ListComprehension: {
                reportUsageErrorForReadOnly(node, usage);
                typeResult = getTypeFromListComprehensionExpression(node);
                break;
            }

            case ParseNodeType.Dictionary: {
                reportUsageErrorForReadOnly(node, usage);
                typeResult = getTypeFromDictionaryExpression(node, usage);
                break;
            }

            case ParseNodeType.Lambda: {
                reportUsageErrorForReadOnly(node, usage);
                typeResult = getTypeFromLambdaExpression(node, usage);
                break;
            }

            case ParseNodeType.Set: {
                reportUsageErrorForReadOnly(node, usage);
                typeResult = getTypeFromSetExpression(node, usage);
                break;
            }

            case ParseNodeType.Assignment: {
                reportUsageErrorForReadOnly(node, usage);

                // Don't validate the type match for the assignment here. Simply
                // return the type result of the RHS.
                typeResult = getTypeFromExpression(node.rightExpression);
                break;
            }

            case ParseNodeType.AssignmentExpression: {
                reportUsageErrorForReadOnly(node, usage);

                typeResult = getTypeFromExpression(node.rightExpression);
                assignTypeToExpression(node.name, typeResult.type, node.rightExpression);
                break;
            }

            case ParseNodeType.Yield: {
                reportUsageErrorForReadOnly(node, usage);
                typeResult = getTypeFromYieldExpression(node);
                break;
            }

            case ParseNodeType.YieldFrom: {
                reportUsageErrorForReadOnly(node, usage);
                typeResult = getTypeFromYieldFromExpression(node);
                break;
            }

            case ParseNodeType.Unpack: {
                const iterType = getTypeFromExpression(node.expression, usage).type;
                const type = getTypeFromIterable(iterType, false, node, false);
                typeResult = { type, unpackedType: iterType, node };
                break;
            }

            case ParseNodeType.TypeAnnotation: {
                typeResult = getTypeFromExpression(node.typeAnnotation);
                break;
            }

            case ParseNodeType.Error: {
                // Evaluate the child expression as best we can so the
                // type information is cached for the completion handler.
                useSpeculativeMode(() => {
                    if (node.child) {
                        getTypeFromExpression(node.child);
                    }
                });
                typeResult = { type: UnknownType.create(), node };
                break;
            }
        }

        if (!typeResult) {
            // We shouldn't get here. If we do, report an error.
            addError(`Unhandled expression type '${ ParseTreeUtils.printExpression(node) }'`, node);
            typeResult = { type: UnknownType.create(), node };
        }

        if (usage.method === 'get' || usage.method === 'del') {
            updateExpressionTypeForNode(node, typeResult.type);
        } else if (usage.method === 'set' && usage.setType) {
            updateExpressionTypeForNode(node, usage.setType);
        }

        return typeResult;
    }

    function getTypeFromName(node: NameNode, usage: EvaluatorUsage,
            flags: EvaluatorFlags): TypeResult {

        const name = node.nameToken.value;
        let type: Type | undefined;

        // Look for the scope that contains the value definition and
        // see if it has a declared type.
        const symbolWithScope = lookUpSymbolRecursive(node, name);

        if (symbolWithScope) {
            const symbol = symbolWithScope.symbol;
            type = getEffectiveTypeOfSymbol(symbol, importLookup);
            const isSpecialBuiltIn = type && type.category === TypeCategory.Class &&
                ClassType.isSpecialBuiltIn(type);

            // Should we specialize the class?
            if ((flags & EvaluatorFlags.DoNotSpecialize) === 0) {
                if (type.category === TypeCategory.Class) {
                    if (ClassType.getTypeArguments(type) === undefined) {
                        type = createSpecializedClassType(type, undefined, node);
                    }
                } else if (type.category === TypeCategory.Object) {
                    // If this is an object that contains a Type[X], transform it
                    // into class X.
                    const typeType = getClassFromPotentialTypeObject(type);
                    if (typeType) {
                        type = typeType;
                    }
                }
            }

            if (usage.method === 'get') {
                const isTypeStub = getFileInfo(node).isStubFile;

                let typeAtStart: Type | undefined;

                // For type stubs, we'll never default to Unbound. This is necessary
                // to support certain type aliases, which appear as variable declarations.
                if (symbolWithScope.isBeyondExecutionScope || isTypeStub) {
                    typeAtStart = type;
                } else if (symbol.isInitiallyUnbound()) {
                    typeAtStart = UnboundType.create();
                }

                // Don't try to use code-flow analysis if it was a special built-in
                // type like Type or Callable because these have already been transformed
                // by _createSpecializedClassType.
                let useCodeFlowAnalysis = !isSpecialBuiltIn;

                // Don't use code-flow analysis if forward references are allowed
                // and there is a declared type for the symbol because the code flow
                // order doesn't apply in that case.
                if (flags & EvaluatorFlags.AllowForwardReferences) {
                    if (symbol.hasTypedDeclarations()) {
                        useCodeFlowAnalysis = false;
                    }
                }

                if (isTypeStub) {
                    // Type stubs allow forward references of classes, so
                    // don't use code flow analysis in this case.
                    const decl = getLastTypedDeclaredForSymbol(symbolWithScope.symbol);
                    if (decl && decl.type === DeclarationType.Class) {
                        useCodeFlowAnalysis = false;
                    }
                }

                if (useCodeFlowAnalysis) {
                    // If the type is defined outside of the current scope, use the
                    // original type at the start. Otherwise use an unbound type at
                    // the start.
                    type = getFlowTypeOfReference(node, symbol.getId(), typeAtStart) || type;
                }

                if (isUnbound(type)) {
                    addError(`'${ name }' is unbound`, node);
                } else if (isPossiblyUnbound(type)) {
                    addError(`'${ name }' is possibly unbound`, node);
                }

                setSymbolAccessed(symbol);
            } else if (usage.method === 'del') {
                setSymbolAccessed(symbol);
            }
        } else {
            // Handle the special case of "reveal_type".
            if (name !== 'reveal_type') {
                addError(`'${ name }' is not defined`, node);
            }
            type = UnknownType.create();
        }

        return { type, node };
    }

    function getTypeFromMemberAccessExpression(node: MemberAccessNode,
            usage: EvaluatorUsage, flags: EvaluatorFlags): TypeResult {

        const baseTypeResult = getTypeFromExpression(node.leftExpression);
        const memberType = getTypeFromMemberAccessExpressionWithBaseType(
            node, baseTypeResult, usage, flags);

        if (usage.method === 'get') {
            memberType.type = getFlowTypeOfReference(node, indeterminateSymbolId, memberType.type) ||
                memberType.type;
        }

        // Cache the type information in the member name node as well.
        if (usage.method === 'get' || usage.method === 'del') {
            updateExpressionTypeForNode(node.memberName, memberType.type);
        } else if (usage.method === 'set' && usage.setType) {
            updateExpressionTypeForNode(node.memberName, usage.setType);
        }

        return memberType;
    }

    function getTypeFromMemberAccessExpressionWithBaseType(node: MemberAccessNode,
            baseTypeResult: TypeResult, usage: EvaluatorUsage, flags: EvaluatorFlags): TypeResult {

        const baseType = baseTypeResult.type;
        const memberName = node.memberName.nameToken.value;
        const diag = new DiagnosticAddendum();
        let type: Type | undefined;

        switch (baseType.category) {
            case TypeCategory.Any:
            case TypeCategory.Unknown: {
                type = baseType;
                break;
            }

            case TypeCategory.Class: {
                type = getTypeFromClassMember(node.memberName, baseType,
                    node.memberName.nameToken.value, usage);

                if (!type) {
                    diag.addMessage(`Member '${ memberName }' is unknown`);
                }
                break;
            }

            case TypeCategory.Object: {
                const classFromTypeObject = getClassFromPotentialTypeObject(baseType);
                if (classFromTypeObject) {
                    // Handle the case where the object is a 'Type' object, which
                    // represents a class.
                    return getTypeFromMemberAccessExpressionWithBaseType(node,
                        { type: classFromTypeObject, node: baseTypeResult.node },
                        usage, flags);
                }

                type = getTypeFromObjectMember(node.memberName, baseType,
                    node.memberName.nameToken.value, usage, MemberAccessFlags.None);
                if (!type) {
                    diag.addMessage(`Member '${ memberName }' is unknown`);
                }
                break;
            }

            case TypeCategory.Module: {
                const symbol = ModuleType.getField(baseType, memberName);
                if (symbol) {
                    if (usage.method === 'get') {
                        setSymbolAccessed(symbol);
                    }

                    type = getEffectiveTypeOfSymbol(symbol, importLookup);
                } else {
                    addError(`'${ memberName }' is not a known member of module`, node.memberName);
                    type = UnknownType.create();
                }
                break;
            }

            case TypeCategory.Union: {
                type = doForSubtypes(baseType, subtype => {
                    if (isNoneOrNever(subtype)) {
                        addDiagnostic(
                            getFileInfo(node).diagnosticSettings.reportOptionalMemberAccess,
                            DiagnosticRule.reportOptionalMemberAccess,
                            `'${ memberName }' is not a known member of 'None'`, node.memberName);
                        return undefined;
                    } else if (subtype.category === TypeCategory.Unbound) {
                        // Don't do anything if it's unbound. The error will already
                        // be reported elsewhere.
                        return undefined;
                    } else {
                        const typeResult = getTypeFromMemberAccessExpressionWithBaseType(node,
                            {
                                type: subtype,
                                node
                            },
                            usage,
                            EvaluatorFlags.None);
                        return typeResult.type;
                    }
                });
                break;
            }

            case TypeCategory.Property: {
                if (memberName === 'getter' || memberName === 'setter' || memberName === 'deleter') {
                    // Synthesize a decorator.
                    const decoratorType = FunctionType.create(
                        FunctionTypeFlags.InstanceMethod | FunctionTypeFlags.SynthesizedMethod);
                    FunctionType.addParameter(decoratorType, {
                        category: ParameterCategory.Simple,
                        name: 'fn',
                        type: UnknownType.create()
                    });
                    FunctionType.setDeclaredReturnType(decoratorType, baseType);
                    type = decoratorType;
                } else {
                    diag.addMessage(`Unknown property member`);
                }
                break;
            }

            case TypeCategory.Function:
            case TypeCategory.OverloadedFunction: {
                // If we're assigning a value to the __defaults__ member of a function,
                // note that the default value processing for that function should be disabled.
                if (baseType.category === TypeCategory.Function && memberName === '__defaults__') {
                    if (usage.method === 'set') {
                        baseType.details.flags |= FunctionTypeFlags.DisableDefaultChecks;
                    }
                }

                // TODO - not yet sure what to do about members of functions,
                // which have associated dictionaries.
                type = UnknownType.create();
                break;
            }

            default:
                diag.addMessage(`Unsupported type '${ printType(baseType) }'`);
                break;
        }

        if (!type) {
            let operationName = 'access';
            if (usage.method === 'set') {
                operationName = 'assign';
            } else if (usage.method === 'del') {
                operationName = 'delete';
            }

            addError(
                `Cannot ${ operationName } member '${ memberName }' ` +
                `for type '${ printType(baseType) }'` + diag.getString(),
                node.memberName);
            type = UnknownType.create();
        }

        // Should we specialize the class?
        if ((flags & EvaluatorFlags.DoNotSpecialize) === 0) {
            if (type.category === TypeCategory.Class && !type.typeArguments) {
                type = createSpecializedClassType(type, undefined, node);
            }
        }

        return { type, node };
    }

    // If the object type is a 'Type' object, converts it to the corresponding
    // class that it represents and returns that class. Otherwise returns undefined.
    function getClassFromPotentialTypeObject(potentialTypeObject: ObjectType): Type | undefined {
        const objectClass = potentialTypeObject.classType;
        if (ClassType.isBuiltIn(objectClass, 'Type')) {
            const typeArgs = ClassType.getTypeArguments(objectClass);

            if (typeArgs && typeArgs.length > 0) {
                let firstTypeArg = typeArgs[0];

                // If the type arg is a type var itself, specialize it in
                // case it's bound or constrained.
                if (firstTypeArg.category === TypeCategory.TypeVar) {
                    firstTypeArg = specializeTypeVarType(firstTypeArg);
                }

                if (firstTypeArg.category === TypeCategory.Object) {
                    return firstTypeArg.classType;
                }
            }

            return AnyType.create();
        }

        return undefined;
    }

    function getTypeFromClassMemberName(errorNode: ExpressionNode, classType: ClassType, memberName: string,
            usage: EvaluatorUsage, flags: MemberAccessFlags): ClassMemberLookup | undefined {

        // If this is a special type (like "List") that has an alias
        // class (like "list"), switch to the alias, which defines
        // the members.
        if (classType.details.aliasClass) {
            classType = classType.details.aliasClass;
        }

        let classLookupFlags = ClassMemberLookupFlags.Default;
        if (flags & MemberAccessFlags.SkipInstanceMembers) {
            classLookupFlags |= ClassMemberLookupFlags.SkipInstanceVariables;
        }
        if (flags & MemberAccessFlags.SkipBaseClasses) {
            classLookupFlags |= ClassMemberLookupFlags.SkipBaseClasses;
        }
        if (flags & MemberAccessFlags.SkipObjectBaseClass) {
            classLookupFlags |= ClassMemberLookupFlags.SkipObjectBaseClass;
        }

        // Always look for a member with a declared type first.
        let memberInfo = lookUpClassMember(classType, memberName,
            importLookup,
            classLookupFlags | ClassMemberLookupFlags.DeclaredTypesOnly);

        // If we couldn't find a symbol with a declared type, use
        // an symbol with an inferred type.
        if (!memberInfo) {
            memberInfo = lookUpClassMember(classType, memberName,
                importLookup, classLookupFlags);
        }

        if (memberInfo) {
            const makeClassMember = (type: Type): ClassMemberLookup => {
                return {
                    type,
                    isClassMember: !memberInfo!.isInstanceMember
                };
            };

            let type = getTypeOfMember(memberInfo, importLookup);

            // Don't include variables within typed dict classes.
            if (ClassType.isTypedDictClass(classType)) {
                const typedDecls = memberInfo.symbol.getTypedDeclarations();
                if (typedDecls.length > 0 && typedDecls[0].type === DeclarationType.Variable) {
                    return undefined;
                }
            }

            if (usage.method === 'get') {
                // Mark the member accessed if it's not coming from a parent class.
                if (memberInfo.classType === classType) {
                    setSymbolAccessed(memberInfo.symbol);
                }
            }

            if (!(flags & MemberAccessFlags.SkipGetCheck)) {
                if (type.category === TypeCategory.Property) {
                    if (usage.method === 'get') {
                        // Use the property's getter function to determine
                        // the return type.
                        const selfArg: FunctionArgument = {
                            argumentCategory: ArgumentCategory.Simple,
                            type: ObjectType.create(classType)
                        };
                        let propertyReturnType = validateCallArguments(
                            errorNode, [selfArg], type.getter, new TypeVarMap(), true);
                        if (!propertyReturnType) {
                            propertyReturnType = UnknownType.create();
                        }

                        return makeClassMember(propertyReturnType);
                    } else if (usage.method === 'set') {
                        let setterFunctionType = type.setter;
                        if (setterFunctionType) {
                            // Strip off the "self" parameter.
                            setterFunctionType = stripFirstParameter(setterFunctionType);

                            // Validate that we can call the setter with the specified type.
                            assert(usage.setType !== undefined && usage.setErrorNode !== undefined);
                            const argList: FunctionArgument[] = [];
                            argList.push({ argumentCategory: ArgumentCategory.Simple, type: usage.setType! });
                            validateFunctionArguments(usage.setErrorNode || errorNode,
                                argList, setterFunctionType, new TypeVarMap());

                            // The return type isn't important here.
                            return makeClassMember(NoneType.create());
                        }

                        return undefined;
                    } else {
                        assert(usage.method === 'del');
                        if (type.deleter) {
                            return makeClassMember(NoneType.create());
                        }

                        return undefined;
                    }
                } else if (type.category === TypeCategory.Object) {
                    // See if there's a magic "__get__", "__set__", or "__delete__"
                    // method on the object.
                    let accessMethodName: string;

                    if (usage.method === 'get') {
                        accessMethodName = '__get__';
                    } else if (usage.method === 'set') {
                        accessMethodName = '__set__';
                    } else {
                        accessMethodName = '__del__';
                    }

                    const memberClassType = type.classType;
                    const getMember = lookUpClassMember(memberClassType, accessMethodName,
                        importLookup, ClassMemberLookupFlags.SkipInstanceVariables);
                    if (getMember) {
                        const getMemberType = getTypeOfMember(getMember, importLookup);
                        if (getMemberType.category === TypeCategory.Function) {
                            if (usage.method === 'get') {
                                type = getEffectiveReturnType(getMemberType);
                            } else {
                                // The type isn't important for set or delete usage.
                                // We just need to return some defined type.
                                type = AnyType.create();
                            }
                        }

                        return makeClassMember(type);
                    }
                }
            }

            if (usage.method === 'set') {
                let enforceTargetType = false;

                if (memberInfo.symbol.hasTypedDeclarations()) {
                    // If the member has a declared type, we will enforce it.
                    enforceTargetType = true;
                } else {
                    // If the member has no declared type, we will enforce it
                    // if this assignment isn't within the enclosing class. If
                    // it is within the enclosing class, the assignment is used
                    // to infer the type of the member.
                    if (!memberInfo.symbol.getDeclarations().some(decl => decl.node === errorNode)) {
                        enforceTargetType = true;
                    }
                }

                if (enforceTargetType) {
                    let effectiveType = type;

                    // If the code is patching a method (defined on the class)
                    // with an object-level function, strip the "self" parameter
                    // off the original type. This is sometimes done for test
                    // purposes to override standard behaviors of specific methods.
                    if ((flags & MemberAccessFlags.SkipInstanceMembers) === 0) {
                        if (!memberInfo.isInstanceMember && type.category === TypeCategory.Function) {
                            if (FunctionType.isClassMethod(type) || FunctionType.isInstanceMethod(type)) {
                                effectiveType = stripFirstParameter(type);
                            }
                        }
                    }

                    // Verify that the assigned type is compatible.
                    const diag = new DiagnosticAddendum();
                    if (!canAssignType(effectiveType, usage.setType!,
                            diag.createAddendum(), importLookup)) {

                        addError(
                            `Expression of type '${ printType(usage.setType!) }'` +
                                ` cannot be assigned to member '${ memberName }'` +
                                ` of class '${ printObjectTypeForClass(classType) }'` +
                                diag.getString(),
                            errorNode);
                    }
                }
            }

            return makeClassMember(type);
        }

        if (!(flags & MemberAccessFlags.SkipGetAttributeCheck)) {
            if (usage.method === 'get') {
                // See if the class has a "__getattribute__" or "__getattr__" method.
                // If so, arbitrary members are supported.
                const getAttribType = getTypeFromClassMember(errorNode, classType,
                    '__getattribute__', { method: 'get' },
                        MemberAccessFlags.SkipForMethodLookup |
                        MemberAccessFlags.SkipObjectBaseClass);

                if (getAttribType && getAttribType.category === TypeCategory.Function) {
                    return {
                        type: getEffectiveReturnType(getAttribType),
                        isClassMember: false
                    };
                }

                const getAttrType = getTypeFromClassMember(errorNode, classType,
                    '__getattr__', { method: 'get' }, MemberAccessFlags.SkipForMethodLookup);
                if (getAttrType && getAttrType.category === TypeCategory.Function) {
                    return {
                        type: getEffectiveReturnType(getAttrType),
                        isClassMember: false
                    };
                }
            } else if (usage.method === 'set') {
                const setAttrType = getTypeFromClassMember(errorNode, classType,
                    '__setattr__', { method: 'get' },
                        MemberAccessFlags.SkipForMethodLookup | MemberAccessFlags.SkipObjectBaseClass);
                if (setAttrType) {
                    // The type doesn't matter for a set usage. We just need
                    // to return a defined type.
                    return {
                        type: AnyType.create(),
                        isClassMember: false
                    };
                }
            } else {
                assert(usage.method === 'del');
                const delAttrType = getTypeFromClassMember(errorNode, classType,
                    '__detattr__', { method: 'get' },
                        MemberAccessFlags.SkipForMethodLookup | MemberAccessFlags.SkipObjectBaseClass);
                if (delAttrType) {
                    // The type doesn't matter for a delete usage. We just need
                    // to return a defined type.
                    return {
                        type: AnyType.create(),
                        isClassMember: false
                    };
                }
            }
        }

        return undefined;
    }

    function getTypeFromIndexExpression(node: IndexNode, usage: EvaluatorUsage,
            flags: EvaluatorFlags): TypeResult {

        const baseTypeResult = getTypeFromExpression(node.baseExpression,
            { method: 'get' }, flags | EvaluatorFlags.DoNotSpecialize);

        const baseType = baseTypeResult.type;

        // Handle the special case where we're we're specializing a generic
        // union of class types.
        if (baseType.category === TypeCategory.Union) {
            const typeParameters: TypeVarType[] = [];
            let isUnionOfClasses = true;

            baseType.subtypes.forEach(subtype => {
                if (subtype.category === TypeCategory.Class || subtype.category === TypeCategory.TypeVar) {
                    addTypeVarsToListIfUnique(typeParameters,
                        getTypeVarArgumentsRecursive(subtype));
                } else {
                    isUnionOfClasses = false;
                }
            });

            if (isUnionOfClasses) {
                const typeArgs = getTypeArgs(node.items, flags).map(t => t.type);
                const typeVarMap = buildTypeVarMap(typeParameters, typeArgs);
                const type = specializeType(baseType, typeVarMap);
                return { type, node };
            }
        }

        const type = doForSubtypes(baseType, subtype => {
            if (isAnyOrUnknown(subtype)) {
                return subtype;
            } else if (subtype.category === TypeCategory.Class) {
                // Setting the value of an indexed class will always result
                // in an exception.
                if (usage.method === 'set') {
                    addError(`Generic class type cannot be assigned`, node.baseExpression);
                } else if (usage.method === 'del') {
                    addError(`Generic class type cannot be deleted`, node.baseExpression);
                }

                if (ClassType.isSpecialBuiltIn(subtype, 'Literal')) {
                    // Special-case Literal types.
                    return createLiteralType(node);
                } else if (ClassType.isBuiltIn(subtype, 'InitVar')) {
                    // Special-case InitVar, used in data classes.
                    const typeArgs = getTypeArgs(node.items, flags);
                    if (typeArgs.length === 1) {
                        return typeArgs[0].type;
                    } else {
                        addError(
                            `Expected one type argument for 'InitVar' but got ${ typeArgs.length }`,
                            node.baseExpression);
                        return UnknownType.create();
                    }
                } else if (isEnumClass(subtype)) {
                    // Special-case Enum types.
                    // TODO - validate that there's only one index entry
                    // that is a str type.
                    // TODO - validate that literal strings are referencing
                    // a known enum member.
                    return ObjectType.create(subtype);
                } else {
                    const typeArgs = getTypeArgs(node.items, flags);
                    return createSpecializedClassType(subtype, typeArgs, node.items);
                }
            } else if (subtype.category === TypeCategory.Object) {
                return getTypeFromIndexedObject(node, subtype, usage);
            } else if (isNoneOrNever(subtype)) {
                addDiagnostic(
                    getFileInfo(node).diagnosticSettings.reportOptionalSubscript,
                    DiagnosticRule.reportOptionalSubscript,
                    `Optional of type 'None' cannot be subscripted`,
                    node.baseExpression);

                return UnknownType.create();
            } else {
                if (!isUnbound(subtype)) {
                    addError(
                        `Object of type '${ printType(subtype) }' cannot be subscripted`,
                        node.baseExpression);
                }

                return UnknownType.create();
            }
        });

        // In case we didn't walk the list items above, do so now.
        // If we have, this information will be cached.
        node.items.items.forEach(item => {
            getTypeFromExpression(item);
        });

        return { type, node };
    }

    function getTypeFromIndexedObject(node: IndexNode,
            baseType: ObjectType, usage: EvaluatorUsage): Type {

        // Handle index operations for TypedDict classes specially.
        if (ClassType.isTypedDictClass(baseType.classType)) {
            if (node.items.items.length !== 1) {
                addError('Expected a one index argument', node);
                return UnknownType.create();
            }

            const entries = new StringMap<TypedDictEntry>();
            getTypedDictMembersForClassRecursive(baseType.classType, entries);

            const indexType = getTypeFromExpression(node.items.items[0]).type;
            const diag = new DiagnosticAddendum();
            const resultingType = doForSubtypes(indexType, subtype => {
                if (isAnyOrUnknown(subtype)) {
                    return subtype;
                }

                if (subtype.category === TypeCategory.Object &&
                        ClassType.isBuiltIn(subtype.classType, 'str') &&
                        !!subtype.literalValue) {

                    // Look up the entry in the typed dict to get its type.
                    const entryName = subtype.literalValue as string;
                    const entry = entries.get(entryName);
                    if (!entry) {
                        diag.addMessage(
                            `'${ entryName }' is not a defined key in '${ printType(baseType) }'`);
                        return UnknownType.create();
                    }

                    if (usage.method === 'set') {
                        canAssignType(entry.valueType, usage.setType!, diag, importLookup);
                    } else if (usage.method === 'del' && entry.isRequired) {
                        addError(
                            `'${ entryName }' is a required key and cannot be deleted`, node);
                    }

                    return entry.valueType;
                }

                diag.addMessage(`'${ printType(subtype) }' is not a string literal`);
                return UnknownType.create();
            });

            if (diag.getMessageCount() > 0) {
                let operationName = 'get';
                if (usage.method === 'set') {
                    operationName = 'set';
                } else if (usage.method === 'del') {
                    operationName = 'delete';
                }
                addError(`Could not ${ operationName } item in TypedDict` + diag.getString(),
                    node);
            }

            return resultingType;
        }

        let magicMethodName: string;
        if (usage.method === 'get') {
            magicMethodName = '__getitem__';
        } else if (usage.method === 'set') {
            magicMethodName = '__setitem__';
        } else {
            assert(usage.method === 'del');
            magicMethodName = '__delitem__';
        }

        const itemMethodType = getTypeFromObjectMember(node,
            baseType, magicMethodName, { method: 'get' },
                MemberAccessFlags.SkipForMethodLookup);

        if (!itemMethodType) {
            addError(
                `Object of type '${ printType(baseType) }' does not define ` +
                    `'${ magicMethodName }'`,
                node.baseExpression);
            return UnknownType.create();
        }

        const indexTypeList = node.items.items.map(item => getTypeFromExpression(item).type);

        let indexType: Type;
        if (indexTypeList.length === 1) {
            indexType = indexTypeList[0];

            // Handle the special case where the object is a Tuple and
            // the index is a constant number. In such case, we can determine
            // the exact type by indexing into the tuple type array.
            const baseTypeClass = baseType.classType;

            if (baseTypeClass.category === TypeCategory.Class &&
                    ClassType.isBuiltIn(baseTypeClass, 'Tuple') &&
                    ClassType.getTypeArguments(baseTypeClass)) {

                if (node.items.items[0].nodeType === ParseNodeType.Number) {
                    const numberToken = node.items.items[0].token;
                    const baseClassTypeArgs = ClassType.getTypeArguments(baseTypeClass)!;

                    if (numberToken.isInteger && numberToken.value >= 0 &&
                            numberToken.value < baseClassTypeArgs.length) {

                        return baseClassTypeArgs[numberToken.value];
                    }
                }
            }
        } else {
            // Handle the case where the index expression is a tuple. This
            // isn't used in most cases, but it is supported by the language.
            const builtInTupleType = getBuiltInType(node, 'Tuple');
            if (builtInTupleType.category === TypeCategory.Class) {
                indexType = convertClassToObject(
                    ClassType.cloneForSpecialization(builtInTupleType, indexTypeList));
            } else {
                indexType = UnknownType.create();
            }
        }

        const argList: FunctionArgument[] = [{
            argumentCategory: ArgumentCategory.Simple,
            type: indexType
        }];

        if (usage.method === 'set') {
            argList.push({
                argumentCategory: ArgumentCategory.Simple,
                type: usage.setType || AnyType.create()
            });
        }

        const returnType = validateCallArguments(node, argList,
            itemMethodType, new TypeVarMap());

        return returnType || UnknownType.create();
    }

    function getTypeArgs(node: IndexItemsNode, flags: EvaluatorFlags): TypeResult[] {
        const typeArgs: TypeResult[] = [];

        node.items.forEach(expr => {
            typeArgs.push(getTypeArg(expr, flags));
        });

        return typeArgs;
    }

    function getTypeArg(node: ExpressionNode, flags: EvaluatorFlags): TypeResult {
        let typeResult: TypeResult;

        if (node.nodeType === ParseNodeType.List) {
            typeResult = {
                type: UnknownType.create(),
                typeList: node.entries.map(entry => getTypeFromExpression(
                    entry, { method: 'get' }, flags)),
                node
            };
        } else {
            typeResult = getTypeFromExpression(node, { method: 'get' },
                flags | EvaluatorFlags.ConvertEllipsisToAny);
        }

        return typeResult;
    }

    function getTypeFromTupleExpression(node: TupleNode, usage: EvaluatorUsage): TypeResult {
        // Build an array of expected types.
        const expectedTypes: Type[] = [];
        if (usage.expectedType && usage.expectedType.category === TypeCategory.Object) {
            const tupleClass = usage.expectedType.classType;

            if (ClassType.isBuiltIn(tupleClass, 'Tuple') && tupleClass.typeArguments) {
                // Is this a homogeneous tuple of indeterminate length? If so,
                // match the number of expected types to the number of entries
                // in the tuple expression.
                if (tupleClass.typeArguments.length === 2 && isEllipsisType(tupleClass.typeArguments[1])) {
                    for (let i = 0; i < node.expressions.length; i++) {
                        expectedTypes.push(tupleClass.typeArguments[0]);
                    }
                } else {
                    tupleClass.typeArguments.forEach(typeArg => {
                        expectedTypes.push(typeArg);
                    });
                }
            }
        }

        const entryTypeResults = node.expressions.map(
            (expr, index) => getTypeFromExpression(expr,
                { method: usage.method, expectedType: index < expectedTypes.length ? expectedTypes[index] : undefined}));

        let type: Type = UnknownType.create();
        const builtInTupleType = getBuiltInType(node, 'Tuple');

        if (builtInTupleType.category === TypeCategory.Class) {
            let tupleTypes: Type[] = [];
            for (const typeResult of entryTypeResults) {
                if (typeResult.unpackedType) {
                    // Is this an unpacked tuple? If so, we can append the individual
                    // unpacked entries onto the new tuple. If it's not an upacked tuple
                    // but some other iterator (e.g. a List), we won't know the number of
                    // items, so we'll need to leave the Tuple open-ended.
                    if (typeResult.unpackedType.category === TypeCategory.Object &&
                            ClassType.isBuiltIn(typeResult.unpackedType.classType, 'Tuple')) {

                        const typeArgs = ClassType.getTypeArguments(typeResult.unpackedType.classType);

                        // If the Tuple wasn't specialized or has a "..." type parameter, we can't
                        // make any determination about its contents.
                        if (!typeArgs || typeArgs.some(t => t.category === TypeCategory.Any && t.isEllipsis)) {
                            tupleTypes = [AnyType.create(false), AnyType.create(true)];
                            break;
                        }

                        for (const typeArg of typeArgs) {
                            tupleTypes.push(typeArg);
                        }
                    } else {
                        tupleTypes = [AnyType.create(false), AnyType.create(true)];
                        break;
                    }
                } else {
                    tupleTypes.push(typeResult.type);
                }
            }

            type = convertClassToObject(
                ClassType.cloneForSpecialization(builtInTupleType, tupleTypes));
        }

        return { type, node };
    }

    function getTypeFromCallExpression(node: CallNode, usage: EvaluatorUsage,
            flags: EvaluatorFlags): TypeResult {

        const baseTypeResult = getTypeFromExpression(node.leftExpression,
            { method: 'get' }, EvaluatorFlags.DoNotSpecialize);

        // Handle the built-in "super" call specially.
        if (node.leftExpression.nodeType === ParseNodeType.Name && node.leftExpression.nameToken.value === 'super') {
            return {
                type: getTypeFromSuperCall(node),
                node
            };
        }

        // Handle the special-case "reveal_type" call.
        if (isAnyOrUnknown(baseTypeResult.type) &&
                node.leftExpression.nodeType === ParseNodeType.Name &&
                node.leftExpression.nameToken.value === 'reveal_type' &&
                node.arguments.length === 1 &&
                node.arguments[0].argumentCategory === ArgumentCategory.Simple &&
                node.arguments[0].name === undefined) {

            const type = getTypeFromExpression(node.arguments[0].valueExpression).type;
            const exprString = ParseTreeUtils.printExpression(node.arguments[0].valueExpression);
            addWarning(
                `Type of '${ exprString }' is '${ printType(type) }'`,
                node.arguments[0]);
            return { type: AnyType.create(), node };
        }

        const argList = node.arguments.map(arg => {
            const functionArg: FunctionArgument = {
                valueExpression: arg.valueExpression,
                argumentCategory: arg.argumentCategory,
                name: arg.name
            };
            return functionArg;
        });

        return getTypeFromCallExpressionWithBaseType(
            node, argList, baseTypeResult, usage, flags);
    }

    function getTypeFromSuperCall(node: CallNode): Type {
        if (node.arguments.length > 2) {
            addError(
                `Expecting no more than two arguments to super'`,
                node.arguments[2]);
        }

        // Determine which class the "super" call is applied to. If
        // there is no first argument, then the class is implicit.
        let targetClassType: Type;
        if (node.arguments.length > 0) {
            targetClassType = getTypeFromExpression(node.arguments[0].valueExpression).type;

            if (!isAnyOrUnknown(targetClassType) && !(targetClassType.category === TypeCategory.Class)) {
                addError(
                    `Expected class type as first argument to super() call but received ` +
                        `'${ printType(targetClassType) }'`,
                    node.arguments[0].valueExpression);
            }
        } else {
            const enclosingClass = ParseTreeUtils.getEnclosingClass(node);
            if (enclosingClass) {
                targetClassType = AnalyzerNodeInfo.getExpressionType(enclosingClass) as ClassType;
            } else {
                addError(
                    `Zero-argument form of super call is valid only within a class'`,
                    node.leftExpression);
                targetClassType = UnknownType.create();
            }
        }

        // Determine whether there is a further constraint.
        let constrainedClassType: Type;
        if (node.arguments.length > 1) {
            constrainedClassType = getTypeFromExpression(node.arguments[1].valueExpression).type;

            let reportError = false;

            if (isAnyOrUnknown(constrainedClassType)) {
                // Ignore unknown or any types.
            } else if (constrainedClassType.category === TypeCategory.Object) {
                const childClassType = constrainedClassType.classType;
                if (targetClassType.category === TypeCategory.Class) {
                    if (!derivesFromClassRecursive(childClassType, targetClassType)) {
                        reportError = true;
                    }
                }
            } else if (constrainedClassType.category === TypeCategory.Class) {
                if (targetClassType.category === TypeCategory.Class) {
                    if (!derivesFromClassRecursive(constrainedClassType, targetClassType)) {
                        reportError = true;
                    }
                }
            } else {
                reportError = true;
            }

            if (reportError) {
                addError(
                    `Second argument to super() call must be object or class that derives from '${ printType(targetClassType) }'`,
                    node.arguments[1].valueExpression);
            }
        }

        // Python docs indicate that super() isn't valid for
        // operations other than member accesses.
        const parentNode = node.parent!;
        if (parentNode.nodeType === ParseNodeType.MemberAccess) {
            const memberName = parentNode.memberName.nameToken.value;
            const lookupResults = lookUpClassMember(
                targetClassType, memberName, importLookup,
                ClassMemberLookupFlags.SkipOriginalClass);
            if (lookupResults && lookupResults.classType.category === TypeCategory.Class) {
                return ObjectType.create(lookupResults.classType);
            }

            // If the lookup failed, try to return the first base class. An error
            // will be reported by the member lookup logic at a later time.
            if (targetClassType.category === TypeCategory.Class) {
                const baseClasses = targetClassType.details.baseClasses;
                if (baseClasses.length > 0 && !baseClasses[0].isMetaclass) {
                    const baseClassType = baseClasses[0].type;
                    if (baseClassType.category === TypeCategory.Class) {
                        return ObjectType.create(baseClassType);
                    }
                }
            }
        }

        return UnknownType.create();
    }

    function getTypeFromCallExpressionWithBaseType(errorNode: ExpressionNode,
            argList: FunctionArgument[], baseTypeResult: TypeResult, usage: EvaluatorUsage,
            flags: EvaluatorFlags, specializeReturnType = true): TypeResult {

        let type: Type | undefined;
        let callType = baseTypeResult.type;

        if (callType.category === TypeCategory.TypeVar) {
            callType = specializeType(callType, undefined);
        }

        switch (callType.category) {
            case TypeCategory.Class: {
                if (ClassType.isBuiltIn(callType)) {
                    const className = callType.details.name;

                    if (className === 'type') {
                        // Handle the 'type' call specially.
                        if (argList.length >= 1) {
                            const argType = getTypeForArgument(argList[0]);
                            if (argType.category === TypeCategory.Object) {
                                type = argType.classType;
                            }
                        }

                        // If the parameter to type() is not statically known,
                        // fall back to unknown.
                        if (!type) {
                            type = UnknownType.create();
                        }
                    } else if (className === 'TypeVar') {
                        type = createTypeVarType(errorNode, argList);
                    } else if (className === 'NamedTuple') {
                        type = createNamedTupleType(errorNode, argList, true);
                    } else if (className === 'Protocol' || className === 'Generic' ||
                            className === 'Callable' || className === 'Type') {
                        addError(`'${ className }' cannot be instantiated directly`, errorNode);
                    } else if (className === 'Enum' || className === 'IntEnum' ||
                            className === 'Flag' || className === 'IntFlag') {
                        type = createEnumType(errorNode, callType, argList);
                    } else if (className === 'TypedDict') {
                        type = createTypedDictType(errorNode, callType, argList);
                    } else if (className === 'auto' && argList.length === 0) {
                        type = getBuiltInObject(errorNode, 'int');
                    }
                } else if (ClassType.isAbstractClass(callType)) {
                    // If the class is abstract, it can't be instantiated.
                    const symbolTable = new StringMap<ClassMember>();
                    getAbstractMethodsRecursive(callType, importLookup, symbolTable);

                    const diagAddendum = new DiagnosticAddendum();
                    const symbolTableKeys = symbolTable.getKeys();
                    const errorsToDisplay = 2;

                    symbolTableKeys.forEach((symbolName, index) => {
                        if (index === errorsToDisplay) {
                            diagAddendum.addMessage(`and ${ symbolTableKeys.length - errorsToDisplay } more...`);
                        } else if (index < errorsToDisplay) {
                            const symbolWithClass = symbolTable.get(symbolName);

                            if (symbolWithClass && symbolWithClass.classType.category === TypeCategory.Class) {
                                const className = symbolWithClass.classType.details.name;
                                diagAddendum.addMessage(`'${ className }.${ symbolName }' is abstract`);
                            }
                        }
                    });

                    addError(
                        `Cannot instantiate abstract class '${ callType.details.name }'` +
                            diagAddendum.getString(),
                        errorNode);
                }

                // Assume this is a call to the constructor.
                if (!type) {
                    type = validateConstructorArguments(errorNode, argList, callType,
                        usage.expectedType);
                }
                break;
            }

            case TypeCategory.Function: {
                // The stdlib collections/__init__.pyi stub file defines namedtuple
                // as a function rather than a class, so we need to check for it here.
                if (callType.details.builtInName === 'namedtuple') {
                    addDiagnostic(
                        getFileInfo(errorNode).diagnosticSettings.reportUntypedNamedTuple,
                        DiagnosticRule.reportUntypedNamedTuple,
                        `'namedtuple' provides no types for tuple entries. Use 'NamedTuple' instead.`,
                        errorNode);
                    type = createNamedTupleType(errorNode, argList, false);
                } else if (callType.details.builtInName === 'NewType') {
                    type = validateCallArguments(errorNode, argList, callType,
                        new TypeVarMap(), specializeReturnType);

                    // If the call's arguments were validated, replace the
                    // type with a new synthesized subclass.
                    if (type) {
                        type = createNewType(errorNode, argList);
                    }
                } else {
                    type = validateCallArguments(errorNode, argList, callType,
                        new TypeVarMap(), specializeReturnType);

                    if (callType.details.builtInName === '__import__') {
                        // For the special __import__ type, we'll override the return type to be "Any".
                        // This is required because we don't know what module was imported, and we don't
                        // want to fail type checks when accessing members of the resulting module type.
                        type = AnyType.create();
                    }
                }

                if (!type) {
                    type = UnknownType.create();
                }
                break;
            }

            case TypeCategory.OverloadedFunction: {
                // Determine which of the overloads (if any) match.
                const functionType = findOverloadedFunctionType(errorNode, argList, callType);

                if (functionType) {
                    if (functionType.details.builtInName === 'cast' && argList.length === 2) {
                        // Verify that the cast is necessary.
                        const castToType = getTypeForArgument(argList[0]);
                        const castFromType = getTypeForArgument(argList[1]);
                        if (castToType.category === TypeCategory.Class && castFromType.category === TypeCategory.Object) {
                            if (isTypeSame(castToType, castFromType.classType)) {
                                addDiagnostic(
                                    getFileInfo(errorNode).diagnosticSettings.reportUnnecessaryCast,
                                    DiagnosticRule.reportUnnecessaryCast,
                                    `Unnecessary call to cast: type is already ${ printType(castFromType) }`,
                                    errorNode);
                            }
                        }
                    }

                    type = validateCallArguments(errorNode, argList, callType,
                        new TypeVarMap(), specializeReturnType);
                    if (!type) {
                        type = UnknownType.create();
                    }
                } else {
                    const exprString = ParseTreeUtils.printExpression(errorNode);
                    const diagAddendum = new DiagnosticAddendum();
                    const argTypes = argList.map(t => printType(getTypeForArgument(t)));
                    diagAddendum.addMessage(`Argument types: (${ argTypes.join(', ') })`);
                    addError(
                        `No overloads for '${ exprString }' match parameters` + diagAddendum.getString(),
                        errorNode);
                    type = UnknownType.create();
                }
                break;
            }

            case TypeCategory.Object: {
                // Handle the "Type" object specially.
                const classFromTypeObject = getClassFromPotentialTypeObject(callType);
                if (classFromTypeObject) {
                    if (isAnyOrUnknown(classFromTypeObject)) {
                        type = classFromTypeObject;
                    } else if (classFromTypeObject.category === TypeCategory.Class) {
                        type = validateConstructorArguments(errorNode,
                            argList, classFromTypeObject, usage.expectedType);
                    }
                } else {
                    const memberType = getTypeFromObjectMember(errorNode,
                        callType, '__call__', { method: 'get' }, MemberAccessFlags.SkipForMethodLookup);
                    if (memberType) {
                        type = validateCallArguments(errorNode, argList, memberType, new TypeVarMap());
                        if (!type) {
                            type = UnknownType.create();
                        }
                    }
                }
                break;
            }

            case TypeCategory.Union: {
                const returnTypes: Type[] = [];
                callType.subtypes.forEach(typeEntry => {
                    if (isNoneOrNever(typeEntry)) {
                        addDiagnostic(
                            getFileInfo(errorNode).diagnosticSettings.reportOptionalCall,
                            DiagnosticRule.reportOptionalCall,
                            `Object of type 'None' cannot be called`,
                            errorNode);
                    } else {
                        const typeResult = getTypeFromCallExpressionWithBaseType(
                            errorNode,
                            argList,
                            {
                                type: typeEntry,
                                node: baseTypeResult.node
                            },
                            usage, flags);
                        if (typeResult) {
                            returnTypes.push(typeResult.type);
                        }
                    }
                });

                if (returnTypes.length > 0) {
                    type = combineTypes(returnTypes);
                }
                break;
            }

            case TypeCategory.Any:
            case TypeCategory.Unknown: {
                // Mark the arguments accessed.
                argList.forEach(arg => getTypeForArgument(arg));
                type = callType;
                break;
            }
        }

        if (!type) {
            addError(
                `'${ ParseTreeUtils.printExpression(errorNode) }' has type ` +
                `'${ printType(callType) }' and is not callable`,
                errorNode);
            type = UnknownType.create();
        }

        // Should we specialize the class?
        if ((flags & EvaluatorFlags.DoNotSpecialize) === 0) {
            if (type.category === TypeCategory.Class) {
                type = createSpecializedClassType(type, undefined, errorNode);
            }
        }

        return { type, node: baseTypeResult.node };
    }

    function findOverloadedFunctionType(errorNode: ExpressionNode, argList: FunctionArgument[],
            callType: OverloadedFunctionType): FunctionType | undefined {

        let validOverload: FunctionType | undefined;

        // Temporarily disable diagnostic output.
        useSpeculativeMode(() => {
            for (const overload of callType.overloads) {
                if (validateCallArguments(errorNode, argList, overload.type, new TypeVarMap())) {
                    validOverload = overload.type;
                    break;
                }
            }
        });

        return validOverload;
    }

    // Tries to match the arguments of a call to the constructor for a class.
    // If successful, it returns the resulting (specialized) object type that
    // is allocated by the constructor. If unsuccessful, it records diagnostic
    // information and returns undefined.
    function validateConstructorArguments(errorNode: ExpressionNode,
            argList: FunctionArgument[], type: ClassType, expectedType?: Type): Type | undefined {

        let validatedTypes = false;
        let returnType: Type | undefined;
        let reportedErrorsForInitCall = false;

        // Validate __init__
        // We validate __init__ before __new__ because the former typically has
        // more specific type annotations, and we want to evaluate the arguments
        // in the context of these types. The __new__ method often uses generic
        // vargs and kwargs.
        const initMethodType = getTypeFromObjectMember(errorNode,
            ObjectType.create(type), '__init__', { method: 'get' },
            MemberAccessFlags.SkipForMethodLookup | MemberAccessFlags.SkipObjectBaseClass);
        if (initMethodType) {
            const typeVarMap = new TypeVarMap();
            if (validateCallArguments(errorNode, argList, initMethodType, typeVarMap)) {
                let specializedClassType = type;
                if (expectedType) {
                    applyExpectedTypeForConstructor(type, expectedType, typeVarMap);
                }
                if (!typeVarMap.isEmpty()) {
                    specializedClassType = specializeType(type, typeVarMap) as ClassType;
                }
                returnType = ObjectType.create(specializedClassType);
            } else {
                reportedErrorsForInitCall = true;
            }
            validatedTypes = true;
        }

        // Validate __new__
        // Don't report errors for __new__ if __init__ already generated errors. They're
        // probably going to be entirely redundant anyway.
        if (!reportedErrorsForInitCall) {
            const constructorMethodInfo = getTypeFromClassMemberName(errorNode,
                type, '__new__', { method: 'get' }, MemberAccessFlags.SkipForMethodLookup |
                    MemberAccessFlags.SkipObjectBaseClass);
            if (constructorMethodInfo) {
                const constructorMethodType = bindFunctionToClassOrObject(
                    type, constructorMethodInfo.type, importLookup, true);
                const typeVarMap = new TypeVarMap();
                validateCallArguments(errorNode, argList, constructorMethodType, typeVarMap);
                if (!returnType) {
                    let specializedClassType = type;
                    if (expectedType) {
                        applyExpectedTypeForConstructor(type, expectedType, typeVarMap);
                    }
                    if (!typeVarMap.isEmpty()) {
                        specializedClassType = specializeType(type, typeVarMap) as ClassType;
                    }
                    returnType = ObjectType.create(specializedClassType);
                }
                validatedTypes = true;
            }
        }

        if (!validatedTypes && argList.length > 0) {
            addError(
                `Expected no arguments to '${ type.details.name }' constructor`, errorNode);
        } else if (!returnType) {
            // There was no __new__ or __init__, so fall back on the
            // object.__new__ which takes no parameters.
            let specializedClassType = type;
            const typeVarMap = new TypeVarMap();
            if (expectedType) {
                applyExpectedTypeForConstructor(type, expectedType, typeVarMap);
            }
            if (!typeVarMap.isEmpty()) {
                specializedClassType = specializeType(type, typeVarMap) as ClassType;
            }
            returnType = ObjectType.create(specializedClassType);
        }

        // Make the type concrete if it wasn't already specialized.
        if (returnType) {
            returnType = specializeType(returnType, undefined);
        }

        return returnType;
    }

    // Validates that the arguments can be assigned to the call's parameter
    // list, specializes the call based on arg types, and returns the
    // specialized type of the return value. If it detects an error along
    // the way, it emits a diagnostic and returns undefined.
    function validateCallArguments(errorNode: ExpressionNode,
            argList: FunctionArgument[], callType: Type, typeVarMap: TypeVarMap,
            specializeReturnType = true): Type | undefined {

        let returnType: Type | undefined;

        if (isAnyOrUnknown(callType)) {
            // Touch all of the args so they're marked accessed.
            argList.forEach(arg => getTypeForArgument(arg));
            returnType = callType;
        } else if (callType.category === TypeCategory.Function) {
            returnType = validateFunctionArguments(errorNode, argList, callType, typeVarMap);
        } else if (callType.category === TypeCategory.OverloadedFunction) {
            const overloadedFunctionType = findOverloadedFunctionType(
                errorNode, argList, callType);
            if (overloadedFunctionType) {
                returnType = validateFunctionArguments(errorNode,
                    argList, overloadedFunctionType, typeVarMap);
            } else {
                const exprString = ParseTreeUtils.printExpression(errorNode);
                const diagAddendum = new DiagnosticAddendum();
                const argTypes = argList.map(t => printType(getTypeForArgument(t)));
                diagAddendum.addMessage(`Argument types: (${ argTypes.join(', ') })`);
                addError(
                    `No overloads for '${ exprString }' match parameters` + diagAddendum.getString(),
                    errorNode);
            }
        } else if (callType.category === TypeCategory.Class) {
            if (!ClassType.isSpecialBuiltIn(callType)) {
                returnType = validateConstructorArguments(errorNode, argList, callType);
            } else {
                addError(
                    `'${ callType.details.name }' cannot be instantiated`,
                    errorNode);
            }
        } else if (callType.category === TypeCategory.Object) {
            const memberType = getTypeFromObjectMember(errorNode,
                callType, '__call__', { method: 'get' },
                    MemberAccessFlags.SkipForMethodLookup);

            if (memberType && memberType.category === TypeCategory.Function) {
                const callMethodType = stripFirstParameter(memberType);
                returnType = validateCallArguments(
                    errorNode, argList, callMethodType, typeVarMap);
            }
        } else if (callType.category === TypeCategory.Union) {
            const returnTypes: Type[] = [];

            for (const type of callType.subtypes) {
                if (isNoneOrNever(type)) {
                    addDiagnostic(
                        getFileInfo(errorNode).diagnosticSettings.reportOptionalCall,
                        DiagnosticRule.reportOptionalCall,
                        `Object of type 'None' cannot be called`,
                        errorNode);
                } else {
                    const entryReturnType = validateCallArguments(
                        errorNode, argList, type, typeVarMap);
                    if (entryReturnType) {
                        returnTypes.push(entryReturnType);
                    }
                }
            }

            if (returnTypes.length > 0) {
                returnType = combineTypes(returnTypes);
            }
        }

        // Make the type concrete if it wasn't already specialized.
        if (returnType && specializeReturnType) {
            returnType = specializeType(returnType, undefined);
        }

        return returnType;
    }

    // Tries to assign the call arguments to the function parameter
    // list and reports any mismatches in types or counts. Returns the
    // specialized return type of the call.
    // This logic is based on PEP 3102: https://www.python.org/dev/peps/pep-3102/
    function validateFunctionArguments(errorNode: ExpressionNode,
            argList: FunctionArgument[], type: FunctionType, typeVarMap: TypeVarMap): Type | undefined {

        let argIndex = 0;
        const typeParams = type.details.parameters;

        // The last parameter might be a var arg dictionary. If so, strip it off.
        const varArgDictParam = typeParams.find(
                param => param.category === ParameterCategory.VarArgDictionary);
        let reportedArgError = false;

        // Build a map of parameters by name.
        const paramMap = new StringMap<ParamAssignmentInfo>();
        typeParams.forEach(param => {
            if (param.name) {
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

        // Is there a positional-only "/" parameter? If so, it separates the
        // positional-only from positional or keyword parameters.
        const positionalOnlyIndex = typeParams.findIndex(
            param => param.category === ParameterCategory.Simple && !param.name);

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
        let positionalArgCount = argList.findIndex(
            arg => arg.argumentCategory === ArgumentCategory.UnpackedDictionary ||
                arg.name !== undefined);
        if (positionalArgCount < 0) {
            positionalArgCount = argList.length;
        }

        // If there weren't enough positional arguments to populate all of
        // the positional-only parameters, force the named parameters
        // into positional-only slots so we can report errors for them.
        if (positionalOnlyIndex >= 0 && positionalArgCount < positionalOnlyIndex) {
            positionalArgCount = Math.min(positionalOnlyIndex, argList.length);
        }

        const validateArgTypeParams: ValidateArgTypeParams[] = [];

        // Map the positional args to parameters.
        let paramIndex = 0;
        while (argIndex < positionalArgCount) {
            if (paramIndex === positionalOnlyIndex) {
                paramIndex++;
                continue;
            }

            if (argIndex < positionalOnlyIndex && argList[argIndex].name) {
                addError(`Expected positional argument`, argList[argIndex].name!);
            }

            if (paramIndex >= positionalParamCount) {
                if (argList[argIndex].argumentCategory !== ArgumentCategory.UnpackedList) {
                    const adjustedCount = positionalParamCount;
                    addError(
                        `Expected ${ adjustedCount } positional ` +
                        `${ adjustedCount === 1 ? 'argument' : 'arguments' }`,
                        argList[argIndex].valueExpression || errorNode);
                    reportedArgError = true;
                }
                break;
            }

            const paramType = FunctionType.getEffectiveParameterType(type, paramIndex);
            if (argList[argIndex].argumentCategory === ArgumentCategory.UnpackedList) {
                // Assume the unpacked list fills the remaining positional args.
                if (argList[argIndex].valueExpression) {
                    const listElementType = getTypeFromIterable(
                        getTypeForArgument(argList[argIndex]), false,
                        argList[argIndex].valueExpression!, false);
                    const funcArg: FunctionArgument = {
                        argumentCategory: ArgumentCategory.Simple,
                        type: listElementType
                    };

                    validateArgTypeParams.push({
                        paramType,
                        requiresTypeVarMatching: requiresSpecialization(paramType),
                        argument: funcArg,
                        errorNode: argList[argIndex].valueExpression || errorNode
                    });
                }
                break;
            } else if (typeParams[paramIndex].category === ParameterCategory.VarArgList) {
                validateArgTypeParams.push({
                    paramType,
                    requiresTypeVarMatching: requiresSpecialization(paramType),
                    argument: argList[argIndex],
                    errorNode: argList[argIndex].valueExpression || errorNode,
                    paramName: typeParams[paramIndex].name
                });
                argIndex++;
            } else {
                validateArgTypeParams.push({
                    paramType,
                    requiresTypeVarMatching: requiresSpecialization(paramType),
                    argument: argList[argIndex],
                    errorNode: argList[argIndex].valueExpression || errorNode,
                    paramName: typeParams[paramIndex].name
                });

                // Note that the parameter has received an argument.
                const paramName = typeParams[paramIndex].name;
                if (paramName) {
                    paramMap.get(paramName)!.argsReceived++;
                }

                argIndex++;
                paramIndex++;
            }
        }

        if (!reportedArgError) {
            let foundUnpackedDictionaryArg = false;
            const foundUnpackedListArg = argList.find(
                arg => arg.argumentCategory === ArgumentCategory.UnpackedList) !== undefined;

            // Now consume any named parameters.
            while (argIndex < argList.length) {
                if (argList[argIndex].argumentCategory === ArgumentCategory.UnpackedDictionary) {
                    // Mark the arg as accessed.
                    getTypeForArgument(argList[argIndex]);
                    foundUnpackedDictionaryArg = true;
                } else {
                    // Protect against the case where a non-named argument appears after
                    // a named argument. This will have already been reported as a parse
                    // error, but we need to protect against it here.
                    const paramName = argList[argIndex].name;
                    if (paramName) {
                        const paramNameValue = paramName.nameToken.value;
                        const paramEntry = paramMap.get(paramNameValue);
                        if (paramEntry) {
                            if (paramEntry.argsReceived > 0) {
                                addError(
                                    `Parameter '${ paramNameValue }' is already assigned`, paramName);
                                reportedArgError = true;
                            } else {
                                paramMap.get(paramName.nameToken.value)!.argsReceived++;

                                const paramInfoIndex = typeParams.findIndex(
                                    param => param.name === paramNameValue);
                                assert(paramInfoIndex >= 0);
                                const paramType = FunctionType.getEffectiveParameterType(type, paramInfoIndex);

                                validateArgTypeParams.push({
                                    paramType,
                                    requiresTypeVarMatching: requiresSpecialization(paramType),
                                    argument: argList[argIndex],
                                    errorNode: argList[argIndex].valueExpression || errorNode,
                                    paramName: paramNameValue
                                });
                            }
                        } else if (varArgDictParam) {
                            validateArgTypeParams.push({
                                paramType: varArgDictParam.type,
                                requiresTypeVarMatching: requiresSpecialization(varArgDictParam.type),
                                argument: argList[argIndex],
                                errorNode: argList[argIndex].valueExpression || errorNode,
                                paramName: paramNameValue
                            });
                        } else {
                            addError(
                                `No parameter named '${ paramName.nameToken.value }'`, paramName);
                            reportedArgError = true;
                        }
                    }
                }

                argIndex++;
            }

            // Determine whether there are any parameters that require arguments
            // but have not yet received them. If we received a dictionary argument
            // (i.e. an arg starting with a "**") or a list argument (i.e. an arg
            // starting with a "*"), we will assume that all parameters are matched.
            if (!foundUnpackedDictionaryArg && !foundUnpackedListArg &&
                    !FunctionType.isDefaultParameterCheckDisabled(type)) {

                const unassignedParams = paramMap.getKeys().filter(name => {
                    const entry = paramMap.get(name)!;
                    return entry.argsReceived < entry.argsNeeded;
                });

                if (unassignedParams.length > 0) {
                    addError(
                        `Argument missing for parameter${ unassignedParams.length === 1 ? '' : 's' } ` +
                        unassignedParams.map(p => `'${ p }'`).join(', '), errorNode);
                    reportedArgError = true;
                }
            }
        }

        // Run through all args and validate them against their matched parameter.
        // We'll do two passes. The first one will match any type arguments. The second
        // will perform the actual validation.
        if (validateArgTypeParams.some(arg => arg.requiresTypeVarMatching)) {
            useSpeculativeMode(() => {
                validateArgTypeParams.forEach(argParam => {
                    if (argParam.requiresTypeVarMatching) {
                        validateArgType(argParam, typeVarMap, false);
                    }
                });
            });
        }

        validateArgTypeParams.forEach(argParam => {
            if (!validateArgType(argParam, typeVarMap, true)) {
                reportedArgError = true;
            }
        });

        // Run through all the args that were not validated and evaluate their types
        // to ensure that we haven't missed any (due to arg/param mismatches). This will
        // ensure that referenced symbols are not reported as unaccessed.
        if (!isSpeculativeMode) {
            argList.forEach(arg => {
                if (arg.valueExpression) {
                    if (!validateArgTypeParams.some(validatedArg => validatedArg.argument === arg)) {
                        getTypeFromExpression(arg.valueExpression);
                    }
                }
            });
        }

        if (reportedArgError) {
            return undefined;
        }

        return specializeType(getEffectiveReturnType(type), typeVarMap);
    }

    function validateArgType(argParam: ValidateArgTypeParams, typeVarMap: TypeVarMap,
            makeConcrete: boolean): boolean {

        let argType: Type | undefined;

        if (argParam.argument.valueExpression) {
            const expectedType = specializeType(argParam.paramType, typeVarMap, makeConcrete);
            const exprType = getTypeFromExpression(argParam.argument.valueExpression,
                { method: 'get', expectedType });
            argType = exprType.type;
        } else {
            argType = getTypeForArgument(argParam.argument);
        }

        const diag = new DiagnosticAddendum();
        if (!canAssignType(argParam.paramType, argType, diag.createAddendum(), importLookup, typeVarMap)) {
            const optionalParamName = argParam.paramName ? `'${ argParam.paramName }' ` : '';
            addError(
                `Argument of type '${ printType(argType) }'` +
                    ` cannot be assigned to parameter ${ optionalParamName }` +
                    `of type '${ printType(argParam.paramType) }'` +
                    diag.getString(),
                argParam.errorNode);
            return false;
        }

        return true;
    }

    function createTypeVarType(errorNode: ExpressionNode, argList: FunctionArgument[]): Type | undefined {
        let typeVarName = '';
        if (argList.length === 0) {
            addError('Expected name of type var', errorNode);
            return undefined;
        }

        const firstArg = argList[0];
        if (firstArg.valueExpression && firstArg.valueExpression.nodeType === ParseNodeType.StringList) {
            typeVarName = firstArg.valueExpression.strings.map(s => s.value).join('');
        } else {
            addError('Expected name of type var as first parameter',
                firstArg.valueExpression || errorNode);
        }

        const typeVar = TypeVarType.create(typeVarName);

        // Parse the remaining parameters.
        for (let i = 1; i < argList.length; i++) {
            const paramNameNode = argList[i].name;
            const paramName = paramNameNode ? paramNameNode.nameToken.value : undefined;
            const paramNameMap = new StringMap<string>();

            if (paramName) {
                if (paramNameMap.get(paramName)) {
                    addError(
                        `Duplicate parameter name '${ paramName }' not allowed`,
                        argList[i].valueExpression || errorNode);
                }

                if (paramName === 'bound') {
                    if (typeVar.constraints.length > 0) {
                        addError(
                            `A TypeVar cannot be both bound and constrained`,
                            argList[i].valueExpression || errorNode);
                    } else {
                        if (requiresSpecialization(getTypeForArgument(argList[i]))) {
                            addError(
                                `A TypeVar bound type cannot be generic`,
                                argList[i].valueExpression || errorNode);
                        }
                        typeVar.boundType = convertClassToObject(
                            getTypeForArgument(argList[i]));
                    }
                } else if (paramName === 'covariant') {
                    if (argList[i].valueExpression && getBooleanValue(argList[i].valueExpression!)) {
                        if (typeVar.isContravariant) {
                            addError(
                                `A TypeVar cannot be both covariant and contravariant`,
                                argList[i].valueExpression!);
                        } else {
                            typeVar.isCovariant = true;
                        }
                    }
                } else if (paramName === 'contravariant') {
                    if (argList[i].valueExpression && getBooleanValue(argList[i].valueExpression!)) {
                        if (typeVar.isContravariant) {
                            addError(
                                `A TypeVar cannot be both covariant and contravariant`,
                                argList[i].valueExpression!);
                        } else {
                            typeVar.isContravariant = true;
                        }
                    }
                } else {
                    addError(
                        `'${ paramName }' is unknown parameter to TypeVar`,
                        argList[i].valueExpression || errorNode);
                }

                paramNameMap.set(paramName, paramName);
            } else {
                if (typeVar.boundType) {
                    addError(
                        `A TypeVar cannot be both bound and constrained`,
                        argList[i].valueExpression || errorNode);
                } else {
                    if (requiresSpecialization(getTypeForArgument(argList[i]))) {
                        addError(
                            `A TypeVar constraint type cannot be generic`,
                            argList[i].valueExpression || errorNode);
                    }
                    TypeVarType.addConstraint(typeVar, convertClassToObject(
                        getTypeForArgument(argList[i])));
                }
            }
        }

        return typeVar;
    }

    function getBooleanValue(node: ExpressionNode): boolean {
        if (node.nodeType === ParseNodeType.Constant) {
            if (node.token.type === TokenType.Keyword) {
                if (node.token.keywordType === KeywordType.False) {
                    return false;
                } else if (node.token.keywordType === KeywordType.True) {
                    return true;
                }
            }
        }

        addError('Expected True or False', node);
        return false;
    }

    // Creates a new custom enum class with named values.
    function createEnumType(errorNode: ExpressionNode, enumClass: ClassType,
            argList: FunctionArgument[]): ClassType {

        let className = 'enum';
        if (argList.length === 0) {
            addError('Expected enum class name as first parameter', errorNode);
        } else {
            const nameArg = argList[0];
            if (nameArg.argumentCategory !== ArgumentCategory.Simple) {
                addError('Expected enum class name as first parameter',
                    argList[0].valueExpression || errorNode);
            } else if (nameArg.valueExpression && nameArg.valueExpression.nodeType === ParseNodeType.StringList) {
                className = nameArg.valueExpression.strings.map(s => s.value).join('');
            }
        }

        const classType = ClassType.create(className, ClassTypeFlags.None, errorNode.id);
        ClassType.addBaseClass(classType, enumClass, false);

        const classFields = ClassType.getFields(classType);
        classFields.set('__class__', Symbol.createWithType(SymbolFlags.ClassMember, classType));

        if (argList.length < 2) {
            addError('Expected enum item string as second parameter', errorNode);
        } else {
            const entriesArg = argList[1];
            if (entriesArg.argumentCategory !== ArgumentCategory.Simple ||
                    !entriesArg.valueExpression ||
                    entriesArg.valueExpression.nodeType !== ParseNodeType.StringList) {

                addError('Expected enum item string as second parameter', errorNode);
            } else {
                const entries = entriesArg.valueExpression.strings.map(s => s.value).join('').split(' ');
                entries.forEach(entryName => {
                    entryName = entryName.trim();
                    if (entryName) {
                        const entryType = UnknownType.create();
                        const newSymbol = Symbol.createWithType(SymbolFlags.ClassMember, entryType);

                        // We need to associate the declaration with a parse node.
                        // In this case it's just part of a string literal value.
                        // The definition provider won't necessarily take the
                        // user to the exact spot in the string, but it's close enough.
                        const stringNode = entriesArg.valueExpression!;
                        assert(stringNode.nodeType === ParseNodeType.StringList);
                        const declaration: VariableDeclaration = {
                            type: DeclarationType.Variable,
                            node: stringNode as StringListNode,
                            path: getFileInfo(errorNode).filePath,
                            range: convertOffsetsToRange(
                                stringNode.start, TextRange.getEnd(stringNode),
                                getFileInfo(errorNode).lines)
                        };
                        newSymbol.addDeclaration(declaration);
                        classFields.set(entryName, newSymbol);
                    }
                });
            }
        }

        return classType;
    }

    // Implemented the semantics of the NewType call as documented
    // in the Python specification: The static type checker will treat
    // the new type as if it were a subclass of the original type.
    function createNewType(errorNode: ExpressionNode, argList: FunctionArgument[]): ClassType | undefined {
        let className = '_';
        if (argList.length >= 1) {
            const nameArg = argList[0];
            if (nameArg.argumentCategory === ArgumentCategory.Simple) {
                if (nameArg.valueExpression && nameArg.valueExpression.nodeType === ParseNodeType.StringList) {
                    className = nameArg.valueExpression.strings.map(s => s.value).join('');
                }
            }
        }

        if (argList.length >= 2) {
            const baseClass = getTypeForArgument(argList[1]);

            if (baseClass.category === TypeCategory.Class) {
                const classType = ClassType.create(className, ClassTypeFlags.None, errorNode.id);
                ClassType.addBaseClass(classType, baseClass, false);
                return classType;
            }
        }

        return undefined;
    }

    // Creates a new custom TypedDict factory class.
    // Supports both typed and untyped variants.
    function createTypedDictType(errorNode: ExpressionNode, typedDictClass: ClassType,
            argList: FunctionArgument[]): ClassType {

        let className = 'TypedDict';
        if (argList.length === 0) {
            addError('Expected TypedDict class name as first parameter', errorNode);
        } else {
            const nameArg = argList[0];
            if (nameArg.argumentCategory !== ArgumentCategory.Simple ||
                    !nameArg.valueExpression ||
                    nameArg.valueExpression.nodeType !== ParseNodeType.StringList) {
                addError('Expected TypedDict class name as first parameter',
                    argList[0].valueExpression || errorNode);
            } else {
                className = nameArg.valueExpression.strings.map(s => s.value).join('');
            }
        }

        const classType = ClassType.create(className, ClassTypeFlags.TypedDictClass, errorNode.id);
        ClassType.addBaseClass(classType, typedDictClass, false);

        if (argList.length >= 3) {
            if (!argList[2].name ||
                    argList[2].name.nameToken.value !== 'total' ||
                    !argList[2].valueExpression ||
                    argList[2].valueExpression.nodeType !== ParseNodeType.Constant ||
                    !(argList[2].valueExpression.token.keywordType === KeywordType.False ||
                        argList[2].valueExpression.token.keywordType === KeywordType.True)) {

                addError(`Expected 'total' parameter to have a value of 'True' or 'False'`,
                    argList[2].valueExpression || errorNode);
            } else if (argList[2].valueExpression.token.keywordType === KeywordType.False) {
                classType.details.flags |= ClassTypeFlags.CanOmitDictValues;
            }
        }

        if (argList.length > 3) {
            addError('Extra TypedDict arguments not supported', argList[3].valueExpression || errorNode);
        }

        const classFields = ClassType.getFields(classType);
        classFields.set('__class__', Symbol.createWithType(SymbolFlags.ClassMember, classType));

        if (argList.length < 2) {
            addError('Expected dict as second parameter', errorNode);
        } else {
            const entriesArg = argList[1];
            if (entriesArg.argumentCategory !== ArgumentCategory.Simple ||
                    !entriesArg.valueExpression ||
                    entriesArg.valueExpression.nodeType !== ParseNodeType.Dictionary) {
                addError('Expected dict as second parameter', errorNode);
            } else {
                const entryDict = entriesArg.valueExpression;
                const entryMap = new StringMap<boolean>();

                entryDict.entries.forEach(entry => {
                    if (entry.nodeType !== ParseNodeType.DictionaryKeyEntry) {
                        addError('Expected simple dictionary entry', entry);
                        return;
                    }

                    let entryType: Type | undefined;
                    const entryTypeInfo = getTypeFromExpression(entry.valueExpression);
                    if (entryTypeInfo) {
                        entryType = convertClassToObject(entryTypeInfo.type);
                    } else {
                        entryType = UnknownType.create();
                    }

                    if (entry.keyExpression.nodeType !== ParseNodeType.StringList) {
                        addError('Expected string literal for entry name', entry.keyExpression);
                        return;
                    }

                    const entryName = entry.keyExpression.strings.map(s => s.value).join('');
                    if (!entryName) {
                        addError(
                            'Names within a TypedDict cannot be empty', entry.keyExpression);
                        return;
                    }

                    if (entryMap.get(entryName)) {
                        addError(
                            'Names within a named tuple must be unique', entry.keyExpression);
                        return;
                    }

                    // Record names in a map to detect duplicates.
                    entryMap.set(entryName, true);

                    const newSymbol = new Symbol(SymbolFlags.InstanceMember);
                    const declaration: VariableDeclaration = {
                        type: DeclarationType.Variable,
                        node: entry.keyExpression,
                        path: getFileInfo(errorNode).filePath,
                        typeAnnotationNode: entry.valueExpression,
                        range: convertOffsetsToRange(
                            entry.keyExpression.start, TextRange.getEnd(entry.keyExpression),
                            getFileInfo(errorNode).lines)
                    };
                    newSymbol.addDeclaration(declaration);

                    classFields.set(entryName, newSymbol);
                });
            }
        }

        synthesizeTypedDictClassMethods(classType);

        return classType;
    }

    // Creates a new custom tuple factory class with named values.
    // Supports both typed and untyped variants.
    function createNamedTupleType(errorNode: ExpressionNode, argList: FunctionArgument[],
            includesTypes: boolean): ClassType {

        let className = 'namedtuple';
        if (argList.length === 0) {
            addError('Expected named tuple class name as first parameter',
                errorNode);
        } else {
            const nameArg = argList[0];
            if (nameArg.argumentCategory !== ArgumentCategory.Simple) {
                addError('Expected named tuple class name as first parameter',
                    argList[0].valueExpression || errorNode);
            } else if (nameArg.valueExpression && nameArg.valueExpression.nodeType === ParseNodeType.StringList) {
                className = nameArg.valueExpression.strings.map(s => s.value).join('');
            }
        }

        const classType = ClassType.create(className, ClassTypeFlags.None, errorNode.id);
        const builtInNamedTuple = getTypingType(errorNode, 'NamedTuple') || UnknownType.create();
        ClassType.addBaseClass(classType, builtInNamedTuple, false);

        const classFields = ClassType.getFields(classType);
        classFields.set('__class__', Symbol.createWithType(SymbolFlags.ClassMember, classType));

        const builtInTupleType = getBuiltInType(errorNode, 'Tuple');
        if (builtInTupleType.category === TypeCategory.Class) {
            const constructorType = FunctionType.create(
                FunctionTypeFlags.StaticMethod | FunctionTypeFlags.ConstructorMethod |
                FunctionTypeFlags.SynthesizedMethod);
            FunctionType.setDeclaredReturnType(constructorType, ObjectType.create(classType));
            FunctionType.addParameter(constructorType, {
                category: ParameterCategory.Simple,
                name: 'cls',
                type: classType
            });

            const selfParameter: FunctionParameter = {
                category: ParameterCategory.Simple,
                name: 'self',
                type: ObjectType.create(classType)
            };

            let addGenericGetAttribute = false;

            if (argList.length < 2) {
                addError('Expected named tuple entry list as second parameter', errorNode);
                addGenericGetAttribute = true;
            } else {
                const entriesArg = argList[1];
                if (entriesArg.argumentCategory !== ArgumentCategory.Simple) {
                    addGenericGetAttribute = true;
                } else {
                    if (!includesTypes && entriesArg.valueExpression &&
                            entriesArg.valueExpression.nodeType === ParseNodeType.StringList) {

                        const entries = entriesArg.valueExpression.strings.map(s => s.value).join('').split(' ');
                        entries.forEach(entryName => {
                            entryName = entryName.trim();
                            if (entryName) {
                                const entryType = UnknownType.create();
                                const paramInfo: FunctionParameter = {
                                    category: ParameterCategory.Simple,
                                    name: entryName,
                                    type: entryType
                                };

                                FunctionType.addParameter(constructorType, paramInfo);
                                const newSymbol = Symbol.createWithType(SymbolFlags.InstanceMember, entryType);

                                // We need to associate the declaration with a parse node.
                                // In this case it's just part of a string literal value.
                                // The definition provider won't necessarily take the
                                // user to the exact spot in the string, but it's close enough.
                                const stringNode = entriesArg.valueExpression!;
                                const declaration: VariableDeclaration = {
                                    type: DeclarationType.Variable,
                                    node: stringNode as StringListNode,
                                    path: getFileInfo(errorNode).filePath,
                                    range: convertOffsetsToRange(
                                        stringNode.start, TextRange.getEnd(stringNode),
                                            getFileInfo(errorNode).lines)
                                };
                                newSymbol.addDeclaration(declaration);
                                classFields.set(entryName, newSymbol);
                            }
                        });
                    } else if (entriesArg.valueExpression && entriesArg.valueExpression.nodeType === ParseNodeType.List) {
                        const entryList = entriesArg.valueExpression;
                        const entryMap: { [name: string]: string } = {};

                        entryList.entries.forEach((entry, index) => {
                            let entryTypeNode: ExpressionNode | undefined;
                            let entryType: Type | undefined;
                            let entryNameNode: ExpressionNode | undefined;
                            let entryName = '';

                            if (includesTypes) {
                                // Handle the variant that includes name/type tuples.
                                if (entry.nodeType === ParseNodeType.Tuple && entry.expressions.length === 2) {
                                    entryNameNode = entry.expressions[0];
                                    entryTypeNode = entry.expressions[1];
                                    const entryTypeInfo = getTypeFromExpression(entryTypeNode);
                                    if (entryTypeInfo) {
                                        entryType = convertClassToObject(entryTypeInfo.type);
                                    }
                                } else {
                                    addError(
                                        'Expected two-entry tuple specifying entry name and type', entry);
                                }
                            } else {
                                entryNameNode = entry;
                                entryType = UnknownType.create();
                            }

                            if (entryNameNode && entryNameNode.nodeType === ParseNodeType.StringList) {
                                entryName = entryNameNode.strings.map(s => s.value).join('');
                                if (!entryName) {
                                    addError(
                                        'Names within a named tuple cannot be empty', entryNameNode);
                                }
                            } else {
                                addError(
                                    'Expected string literal for entry name', entryNameNode || entry);
                            }

                            if (!entryName) {
                                entryName = `_${ index.toString() }`;
                            }

                            if (entryMap[entryName]) {
                                addError(
                                    'Names within a named tuple must be unique', entryNameNode || entry);
                            }

                            // Record names in a map to detect duplicates.
                            entryMap[entryName] = entryName;

                            if (!entryType) {
                                entryType = UnknownType.create();
                            }

                            const paramInfo: FunctionParameter = {
                                category: ParameterCategory.Simple,
                                name: entryName,
                                type: entryType
                            };

                            FunctionType.addParameter(constructorType, paramInfo);

                            const newSymbol = Symbol.createWithType(SymbolFlags.InstanceMember, entryType);
                            if (entryNameNode && entryNameNode.nodeType === ParseNodeType.StringList) {
                                const declaration: VariableDeclaration = {
                                    type: DeclarationType.Variable,
                                    node: entryNameNode,
                                    path: getFileInfo(errorNode).filePath,
                                    typeAnnotationNode: entryTypeNode,
                                    range: convertOffsetsToRange(
                                        entryNameNode.start, TextRange.getEnd(entryNameNode),
                                        getFileInfo(errorNode).lines)
                                };
                                newSymbol.addDeclaration(declaration);
                            }
                            classFields.set(entryName, newSymbol);
                        });
                    } else {
                        // A dynamic expression was used, so we can't evaluate
                        // the named tuple statically.
                        addGenericGetAttribute = true;
                    }
                }
            }

            if (addGenericGetAttribute) {
                addDefaultFunctionParameters(constructorType);
            }

            // Always use generic parameters for __init__. The __new__ method
            // will handle property type checking. We may need to disable default
            // parameter processing for __new__ (see setDefaultParameterCheckDisabled),
            // and we don't want to do it for __init__ as well.
            const initType = FunctionType.create(
                FunctionTypeFlags.InstanceMethod | FunctionTypeFlags.SynthesizedMethod);
            FunctionType.addParameter(initType, selfParameter);
            addDefaultFunctionParameters(initType);
            FunctionType.setDeclaredReturnType(initType, NoneType.create());

            classFields.set('__new__', Symbol.createWithType(SymbolFlags.ClassMember, constructorType));
            classFields.set('__init__', Symbol.createWithType(SymbolFlags.ClassMember, initType));

            const keysItemType = FunctionType.create(FunctionTypeFlags.SynthesizedMethod);
            FunctionType.setDeclaredReturnType(keysItemType, getBuiltInObject(errorNode, 'list',
                [getBuiltInObject(errorNode, 'str')]));
            classFields.set('keys', Symbol.createWithType(SymbolFlags.InstanceMember, keysItemType));
            classFields.set('items', Symbol.createWithType(SymbolFlags.InstanceMember, keysItemType));

            const lenType = FunctionType.create(
                FunctionTypeFlags.InstanceMethod | FunctionTypeFlags.SynthesizedMethod);
            FunctionType.setDeclaredReturnType(lenType, getBuiltInObject(errorNode, 'int'));
            FunctionType.addParameter(lenType, selfParameter);
            classFields.set('__len__', Symbol.createWithType(SymbolFlags.ClassMember, lenType));

            if (addGenericGetAttribute) {
                const getAttribType = FunctionType.create(
                    FunctionTypeFlags.InstanceMethod | FunctionTypeFlags.SynthesizedMethod);
                FunctionType.setDeclaredReturnType(getAttribType, AnyType.create());
                FunctionType.addParameter(getAttribType, selfParameter);
                FunctionType.addParameter(getAttribType, {
                    category: ParameterCategory.Simple,
                    name: 'name',
                    type: getBuiltInObject(errorNode, 'str')
                });
                classFields.set('__getattribute__', Symbol.createWithType(SymbolFlags.ClassMember, getAttribType));
            }
        }

        return classType;
    }

    function reportUsageErrorForReadOnly(node: ParseNode, usage: EvaluatorUsage) {
        if (usage.method === 'set') {
            addError(`Constant value cannot be assigned`, node);
        } else if (usage.method === 'del') {
            addError(`Constant value cannot be deleted`, node);
        }
    }

    function getTypeFromConstantExpression(node: ConstantNode): TypeResult | undefined {
        let type: Type | undefined;

        if (node.token.type === TokenType.Keyword) {
            if (node.token.keywordType === KeywordType.None) {
                type = NoneType.create();
            } else if (node.token.keywordType === KeywordType.True ||
                    node.token.keywordType === KeywordType.False ||
                    node.token.keywordType === KeywordType.Debug) {
                type = getBuiltInObject(node, 'bool');

                // For True and False, we can create truthy and falsy
                // versions of 'bool'.
                if (type && type.category === TypeCategory.Object) {
                    if (node.token.keywordType === KeywordType.True) {
                        type = ObjectType.cloneWithLiteral(type, true);
                    } else if (node.token.keywordType === KeywordType.False) {
                        type = ObjectType.cloneWithLiteral(type, false);
                    }
                }
            }
        }

        if (!type) {
            return undefined;
        }

        return { type, node };
    }

    function getTypeFromUnaryOperation(node: UnaryOperationNode): TypeResult {
        let exprType = getTypeFromExpression(node.expression).type;

        // Map unary operators to magic functions. Note that the bitwise
        // invert has two magic functions that are aliases of each other.
        const unaryOperatorMap: { [operator: number]: string } = {
            [OperatorType.Add]: '__pos__',
            [OperatorType.Subtract]: '__neg__',
            [OperatorType.BitwiseInvert]: '__invert__'
        };

        let type: Type | undefined;

        if (node.operator !== OperatorType.Not) {
            if (isOptionalType(exprType)) {
                addDiagnostic(
                    getFileInfo(node).diagnosticSettings.reportOptionalOperand,
                    DiagnosticRule.reportOptionalOperand,
                    `Operator '${ ParseTreeUtils.printOperator(node.operator) }' not ` +
                    `supported for 'None' type`,
                    node.expression);
                exprType = removeNoneFromUnion(exprType);
            }
        }

        // __not__ always returns a boolean.
        if (node.operator === OperatorType.Not) {
            type = getBuiltInObject(node, 'bool');
            if (!type) {
                type = UnknownType.create();
            }
        } else {
            if (isAnyOrUnknown(exprType)) {
                type = exprType;
            } else {
                const magicMethodName = unaryOperatorMap[node.operator];
                type = getTypeFromMagicMethodReturn(exprType, [],
                    magicMethodName, node);
            }

            if (!type) {
                addError(`Operator '${ ParseTreeUtils.printOperator(node.operator) }'` +
                    ` not supported for type '${ printType(exprType) }'`,
                    node);
                type = UnknownType.create();
            }
        }

        return { type, node };
    }

    function getTypeFromBinaryExpression(node: BinaryOperationNode): TypeResult {
        let leftExpression = node.leftExpression;

        // If this is a comparison and the left expression is also a comparison,
        // we need to change the behavior to accommodate python's "chained
        // comparisons" feature.
        if (comparisonOperatorMap[node.operator]) {
            if (node.leftExpression.nodeType === ParseNodeType.BinaryOperation &&
                    comparisonOperatorMap[node.leftExpression.operator]) {

                leftExpression = node.leftExpression.rightExpression;
            }
        }

        let leftType = getTypeFromExpression(leftExpression).type;
        let rightType = getTypeFromExpression(node.rightExpression).type;

        // Optional checks apply to all operations except for boolean operations.
        if (booleanOperatorMap[node.operator] === undefined) {
            if (isOptionalType(leftType)) {
                // Skip the optional error reporting for == and !=, since
                // None is a valid operand for these operators.
                if (node.operator !== OperatorType.Equals && node.operator !== OperatorType.NotEquals) {
                    addDiagnostic(
                        getFileInfo(node).diagnosticSettings.reportOptionalOperand,
                        DiagnosticRule.reportOptionalOperand,
                        `Operator '${ ParseTreeUtils.printOperator(node.operator) }' not ` +
                        `supported for 'None' type`,
                        node.leftExpression);
                }
                leftType = removeNoneFromUnion(leftType);
            }

            // None is a valid operand for == and != even if the type stub says otherwise.
            if (node.operator === OperatorType.Equals || node.operator === OperatorType.NotEquals) {
                rightType = removeNoneFromUnion(rightType);
            }
        }

        return {
            type: validateBinaryOperation(node.operator, leftType, rightType, node),
            node
        };
    }

    function getTypeFromAugmentedAssignment(node: AugmentedAssignmentNode): Type {
        const operatorMap: { [operator: number]: [string, OperatorType] } = {
            [OperatorType.AddEqual]: ['__iadd__', OperatorType.Add],
            [OperatorType.SubtractEqual]: ['__isub__', OperatorType.Subtract],
            [OperatorType.MultiplyEqual]: ['__imul__', OperatorType.Multiply],
            [OperatorType.FloorDivideEqual]: ['__ifloordiv__', OperatorType.FloorDivide],
            [OperatorType.DivideEqual]: ['__itruediv__', OperatorType.Divide],
            [OperatorType.ModEqual]: ['__imod__', OperatorType.Mod],
            [OperatorType.PowerEqual]: ['__ipow__', OperatorType.Power],
            [OperatorType.MatrixMultiplyEqual]: ['__imatmul__', OperatorType.MatrixMultiply],
            [OperatorType.BitwiseAndEqual]: ['__iand__', OperatorType.BitwiseAnd],
            [OperatorType.BitwiseOrEqual]: ['__ior__', OperatorType.BitwiseOr],
            [OperatorType.BitwiseXorEqual]: ['__ixor__', OperatorType.BitwiseXor],
            [OperatorType.LeftShiftEqual]: ['__ilshift__', OperatorType.LeftShift],
            [OperatorType.RightShiftEqual]: ['__irshift__', OperatorType.RightShift]
        };

        let type: Type | undefined;

        // Don't write to the cache when we evaluate the left-hand side.
        // We'll write the result as part of the "set" method.
        let leftType: Type | undefined;
        useSpeculativeMode(() => {
            leftType = getTypeFromExpression(node.leftExpression).type;
        });
        const rightType = getTypeFromExpression(node.rightExpression).type;

        type = doForSubtypes(leftType!, leftSubtype => {
            return doForSubtypes(rightType, rightSubtype => {
                if (isAnyOrUnknown(leftSubtype) || isAnyOrUnknown(rightSubtype)) {
                    // If either type is "Unknown" (versus Any), propagate the Unknown.
                    if (leftSubtype.category === TypeCategory.Unknown ||
                            rightSubtype.category === TypeCategory.Unknown) {

                        return UnknownType.create();
                    } else {
                        return AnyType.create();
                    }
                }

                const magicMethodName = operatorMap[node.operator][0];
                return getTypeFromMagicMethodReturn(leftSubtype, [rightSubtype],
                    magicMethodName, node);
            });
        });

        // If the LHS class didn't support the magic method for augmented
        // assignment, fall back on the normal binary expression evaluator.
        if (!type || type.category === TypeCategory.Never) {
            const binaryOperator = operatorMap[node.operator][1];
            type = validateBinaryOperation(binaryOperator, leftType!, rightType, node);
        }

        return type;
    }

    function validateBinaryOperation(operator: OperatorType, leftType: Type, rightType: Type,
            errorNode: ExpressionNode): Type {

        let type: Type | undefined;

        if (arithmeticOperatorMap[operator]) {
            type = doForSubtypes(leftType, leftSubtype => {
                return doForSubtypes(rightType, rightSubtype => {
                    if (isAnyOrUnknown(leftSubtype) || isAnyOrUnknown(rightSubtype)) {
                        // If either type is "Unknown" (versus Any), propagate the Unknown.
                        if (leftSubtype.category === TypeCategory.Unknown ||
                                rightSubtype.category === TypeCategory.Unknown) {

                            return UnknownType.create();
                        } else {
                            return AnyType.create();
                        }
                    }

                    const magicMethodName = arithmeticOperatorMap[operator][0];
                    const resultType = getTypeFromMagicMethodReturn(leftSubtype, [rightSubtype],
                        magicMethodName, errorNode);
                    if (resultType) {
                        return resultType;
                    }

                    const altMagicMethodName = arithmeticOperatorMap[operator][1];
                    return getTypeFromMagicMethodReturn(rightSubtype, [leftSubtype],
                        altMagicMethodName, errorNode);
                });
            });
        } else if (bitwiseOperatorMap[operator]) {
            type = doForSubtypes(leftType, leftSubtype => {
                return doForSubtypes(rightType, rightSubtype => {
                    if (isAnyOrUnknown(leftSubtype) || isAnyOrUnknown(rightSubtype)) {
                        // If either type is "Unknown" (versus Any), propagate the Unknown.
                        if (leftSubtype.category === TypeCategory.Unknown ||
                                rightSubtype.category === TypeCategory.Unknown) {

                            return UnknownType.create();
                        } else {
                            return AnyType.create();
                        }
                    }

                    // Handle the general case.
                    const magicMethodName = bitwiseOperatorMap[operator][0];
                    return getTypeFromMagicMethodReturn(leftSubtype, [rightSubtype],
                        magicMethodName, errorNode);
                });
            });
        } else if (comparisonOperatorMap[operator]) {
            type = doForSubtypes(leftType, leftSubtype => {
                return doForSubtypes(rightType, rightSubtype => {
                    if (isAnyOrUnknown(leftSubtype) || isAnyOrUnknown(rightSubtype)) {
                        // If either type is "Unknown" (versus Any), propagate the Unknown.
                        if (leftSubtype.category === TypeCategory.Unknown ||
                                rightSubtype.category === TypeCategory.Unknown) {

                            return UnknownType.create();
                        } else {
                            return AnyType.create();
                        }
                    }

                    const magicMethodName = comparisonOperatorMap[operator][0];
                    const resultType = getTypeFromMagicMethodReturn(leftSubtype, [rightSubtype],
                        magicMethodName, errorNode);
                    if (resultType) {
                        return resultType;
                    }

                    const altMagicMethodName = comparisonOperatorMap[operator][1];
                    return getTypeFromMagicMethodReturn(rightSubtype, [leftSubtype],
                        altMagicMethodName, errorNode);
                });
            });
        } else if (booleanOperatorMap[operator]) {
            // If it's an AND or OR, we need to handle short-circuiting by
            // eliminating any known-truthy or known-falsy types.
            if (operator === OperatorType.And) {
                leftType = removeTruthinessFromType(leftType, importLookup);
            } else if (operator === OperatorType.Or) {
                leftType = removeFalsinessFromType(leftType);
            }

            type = doForSubtypes(leftType, leftSubtype => {
                return doForSubtypes(rightType, rightSubtype => {
                    // If the operator is an AND or OR, we need to combine the two types.
                    if (operator === OperatorType.And || operator === OperatorType.Or) {
                        return combineTypes([leftSubtype, rightSubtype]);
                    }
                    // The other boolean operators always return a bool value.
                    return getBuiltInObject(errorNode, 'bool');
                });
            });
        }

        if (!type || type.category === TypeCategory.Never) {
            addError(`Operator '${ ParseTreeUtils.printOperator(operator) }' not ` +
                `supported for types '${ printType(leftType) }' and '${ printType(rightType) }'`,
                errorNode);
            type = UnknownType.create();
        }

        return type;
    }

    function getTypeFromMagicMethodReturn(objType: Type, args: Type[],
            magicMethodName: string, errorNode: ExpressionNode): Type | undefined {

        let magicMethodSupported = true;

        // Create a helper lambda for object subtypes.
        const handleObjectSubtype = (subtype: ObjectType, bindToClassType?: ClassType) => {
            const magicMethodType = getTypeFromObjectMember(errorNode,
                subtype, magicMethodName,
                { method: 'get' }, MemberAccessFlags.SkipForMethodLookup,
                bindToClassType);

            if (magicMethodType) {
                const functionArgs = args.map(arg => {
                    return {
                        argumentCategory: ArgumentCategory.Simple,
                        type: arg
                    };
                });

                let returnType: Type | undefined;

                useSpeculativeMode(() => {
                    returnType = validateCallArguments(errorNode,
                            functionArgs, magicMethodType, new TypeVarMap());
                });

                if (!returnType) {
                    magicMethodSupported = false;
                }

                return returnType;
            }

            magicMethodSupported = false;
            return undefined;
        };

        const returnType = doForSubtypes(objType, subtype => {
            if (isAnyOrUnknown(subtype)) {
                return subtype;
            }

            if (subtype.category === TypeCategory.Object) {
                return handleObjectSubtype(subtype);
            } else if (subtype.category === TypeCategory.Class) {
                // See if the class has a metaclass that handles the operation.
                const metaclass = getMetaclass(subtype);
                if (metaclass && metaclass.category === TypeCategory.Class) {
                    return handleObjectSubtype(ObjectType.create(metaclass), subtype);
                }
            } else if (isNoneOrNever(subtype)) {
                // NoneType derives from 'object', so do the lookup on 'object'
                // in this case.
                const obj = getBuiltInObject(errorNode, 'object');
                if (obj.category === TypeCategory.Object) {
                    return handleObjectSubtype(obj);
                }
            }

            magicMethodSupported = false;
            return undefined;
        });

        if (!magicMethodSupported) {
            return undefined;
        }

        return returnType;
    }

    function specializeExpectedType(expectedType: Type, srcType: Type) {
        // The expected type might be generic, so we need to specialize it.
        const typeVarMap = new TypeVarMap();
        const diag = new DiagnosticAddendum();
        canAssignType(expectedType, srcType, diag, importLookup, typeVarMap);
        return specializeType(expectedType, typeVarMap);
    }

    function getTypeFromSetExpression(node: SetNode, usage: EvaluatorUsage): TypeResult {
        const entryTypes: Type[] = [];

        // Infer the set type based on the entries.
        node.entries.forEach(entryNode => {
            if (entryNode.nodeType === ParseNodeType.ListComprehension) {
                const setEntryType = getElementTypeFromListComprehensionExpression(entryNode);
                entryTypes.push(setEntryType);
            } else {
                entryTypes.push(getTypeFromExpression(entryNode).type);
            }
        });

        // If there is an expected type, see if we can match any parts of it.
        if (usage.expectedType && entryTypes.length > 0) {
            const specificSetType = getBuiltInObject(node, 'set', [combineTypes(entryTypes)]);
            const remainingExpectedType = constrainDeclaredTypeBasedOnAssignedType(
                usage.expectedType, specificSetType, importLookup);

            // Have we eliminated all of the expected subtypes? If not, return
            // the remaining one(s) that match the specific type.
            if (remainingExpectedType.category !== TypeCategory.Never) {
                const specializedType = specializeExpectedType(remainingExpectedType, specificSetType);
                return { type: specializedType, node };
            }

            return { type: specificSetType, node };
        }

        const inferredEntryType = entryTypes.length > 0 ?
            combineTypes(entryTypes.map(t => stripLiteralValue(t))) :
            AnyType.create();

        const type = getBuiltInObject(node, 'set', [inferredEntryType]);

        return { type, node };
    }

    function getTypeFromDictionaryExpression(node: DictionaryNode, usage: EvaluatorUsage): TypeResult {
        let keyType: Type = AnyType.create();
        let valueType: Type = AnyType.create();

        let keyTypes: Type[] = [];
        let valueTypes: Type[] = [];

        let expectedKeyType: Type | undefined;
        let expectedValueType: Type | undefined;

        if (usage.expectedType && usage.expectedType.category === TypeCategory.Object) {
            const expectedClass = usage.expectedType.classType;
            if (ClassType.isBuiltIn(expectedClass, 'Dict') || ClassType.isBuiltIn(expectedClass, 'dict')) {
                if (expectedClass.typeArguments && expectedClass.typeArguments.length === 2) {
                    expectedKeyType = expectedClass.typeArguments[0];
                    expectedValueType = expectedClass.typeArguments[1];
                }
            }
        }

        // Infer the key and value types if possible.
        node.entries.forEach(entryNode => {
            let addUnknown = true;

            if (entryNode.nodeType === ParseNodeType.DictionaryKeyEntry) {
                keyTypes.push(getTypeFromExpression(entryNode.keyExpression,
                    { method: 'get', expectedType: expectedKeyType }).type);
                valueTypes.push(getTypeFromExpression(entryNode.valueExpression,
                    { method: 'get', expectedType: expectedValueType }).type);
                addUnknown = false;

            } else if (entryNode.nodeType === ParseNodeType.DictionaryExpandEntry) {
                const unexpandedType = getTypeFromExpression(entryNode.expandExpression).type;
                if (isAnyOrUnknown(unexpandedType)) {
                    addUnknown = false;
                } else {
                    if (unexpandedType.category === TypeCategory.Object) {
                        let classType = unexpandedType.classType;
                        if (classType.details.aliasClass) {
                            classType = classType.details.aliasClass;
                        }

                        if (ClassType.isBuiltIn(classType, 'dict')) {
                            const typeArgs = ClassType.getTypeArguments(classType);
                            if (typeArgs && typeArgs.length >= 2) {
                                keyTypes.push(typeArgs[0]);
                                valueTypes.push(typeArgs[1]);
                                addUnknown = false;
                            }
                        }
                    }
                }
            } else if (entryNode.nodeType === ParseNodeType.ListComprehension) {
                const dictEntryType = getElementTypeFromListComprehensionExpression(
                    node.entries[0] as ListComprehensionNode);

                // The result should be a Tuple
                if (dictEntryType.category === TypeCategory.Object) {
                    const classType = dictEntryType.classType;
                    if (ClassType.isBuiltIn(classType, 'Tuple')) {
                        const typeArgs = ClassType.getTypeArguments(classType);
                        if (typeArgs && typeArgs.length === 2) {
                            keyTypes.push(typeArgs[0]);
                            valueTypes.push(typeArgs[1]);
                            addUnknown = false;
                        }
                    }
                }
            }

            if (addUnknown) {
                keyTypes.push(UnknownType.create());
                valueTypes.push(UnknownType.create());
            }
        });

        // If there is an expected type, see if we can match any parts of it.
        if (usage.expectedType) {
            const filteredTypedDict = doForSubtypes(usage.expectedType, subtype => {
                if (subtype.category !== TypeCategory.Object) {
                    return undefined;
                }

                if (!ClassType.isTypedDictClass(subtype.classType)) {
                    return undefined;
                }

                if (canAssignToTypedDict(subtype.classType, importLookup, keyTypes, valueTypes)) {
                    return subtype;
                }

                return undefined;
            });

            if (filteredTypedDict.category !== TypeCategory.Never) {
                return { type: filteredTypedDict, node };
            }

            if (keyTypes.length > 0) {
                const specificDictType = getBuiltInObject(node, 'dict',
                    [combineTypes(keyTypes), combineTypes(valueTypes)]);
                const remainingExpectedType = constrainDeclaredTypeBasedOnAssignedType(
                    usage.expectedType, specificDictType, importLookup);

                // Have we eliminated all of the expected subtypes? If not, return
                // the remaining one(s) that match the specific type.
                if (remainingExpectedType.category !== TypeCategory.Never) {
                    const specializedType = specializeExpectedType(
                        remainingExpectedType, specificDictType);
                    return { type: specializedType, node };
                }

                return { type: specificDictType, node };
            }
        }

        // Strip any literal values.
        keyTypes = keyTypes.map(t => stripLiteralValue(t));
        valueTypes = valueTypes.map(t => stripLiteralValue(t));

        keyType = keyTypes.length > 0 ? combineTypes(keyTypes) : AnyType.create();

        // If the value type differs and we're not using "strict inference mode",
        // we need to back off because we can't properly represent the mappings
        // between different keys and associated value types. If all the values
        // are the same type, we'll assume that all values in this dictionary should
        // be the same.
        if (valueTypes.length > 0) {
            if (getFileInfo(node).diagnosticSettings.strictDictionaryInference) {
                valueType = combineTypes(valueTypes);
            } else {
                valueType = areTypesSame(valueTypes) ? valueTypes[0] : UnknownType.create();
            }
        } else {
            valueType = AnyType.create();
        }

        const type = getBuiltInObject(node, 'dict', [keyType, valueType]);

        return { type, node };
    }

    function getTypeFromListExpression(node: ListNode, usage: EvaluatorUsage): TypeResult {
        let listEntryType: Type = AnyType.create();

        if (node.entries.length === 1 && node.entries[0].nodeType === ParseNodeType.ListComprehension) {
            listEntryType = getElementTypeFromListComprehensionExpression(node.entries[0]);
        } else {
            let entryTypes = node.entries.map(entry => getTypeFromExpression(entry).type);

            // If there is an expected type, see if we can match any parts of it.
            if (usage.expectedType && entryTypes.length > 0) {
                const specificListType = getBuiltInObject(node, 'list', [combineTypes(entryTypes)]);
                const remainingExpectedType = constrainDeclaredTypeBasedOnAssignedType(
                    usage.expectedType, specificListType, importLookup);

                // Have we eliminated all of the expected subtypes? If not, return
                // the remaining one(s) that match the specific type.
                if (remainingExpectedType.category !== TypeCategory.Never) {
                    const specializedType = specializeExpectedType(remainingExpectedType, specificListType);
                    return { type: specializedType, node };
                }

                return { type: specificListType, node };
            }

            entryTypes = entryTypes.map(t => stripLiteralValue(t));

            if (entryTypes.length > 0) {
                if (getFileInfo(node).diagnosticSettings.strictListInference) {
                    listEntryType = combineTypes(entryTypes);
                } else {
                    // Is the list homogeneous? If so, use stricter rules. Otherwise relax the rules.
                    listEntryType = areTypesSame(entryTypes) ? entryTypes[0] : UnknownType.create();
                }
            }
        }

        const type = getBuiltInObject(node, 'list', [listEntryType]);

        return { type, node };
    }

    function getTypeFromTernaryExpression(node: TernaryNode, flags: EvaluatorFlags): TypeResult {
        getTypeFromExpression(node.testExpression);

        const ifType = getTypeFromExpression(node.ifExpression,
                { method: 'get' }, flags);

        const elseType = getTypeFromExpression(node.elseExpression,
                { method: 'get' }, flags);

        const type = combineTypes([ifType.type, elseType.type]);
        return { type, node };
    }

    function getTypeFromYieldExpression(node: YieldNode): TypeResult {
        let sentType: Type | undefined;

        const enclosingFunction = ParseTreeUtils.getEnclosingFunction(node);
        if (enclosingFunction) {
            const functionType = AnalyzerNodeInfo.getExpressionType(enclosingFunction) as FunctionType;
            assert(functionType.category === TypeCategory.Function);
            sentType = getDeclaredGeneratorSendType(functionType);
        }

        if (!sentType) {
            sentType = UnknownType.create();
        }

        return { type: sentType, node };
    }

    function getTypeFromYieldFromExpression(node: YieldFromNode): TypeResult {
        let sentType: Type | undefined;

        const enclosingFunction = ParseTreeUtils.getEnclosingFunction(node);
        if (enclosingFunction) {
            const functionType = AnalyzerNodeInfo.getExpressionType(enclosingFunction) as FunctionType;
            assert(functionType.category === TypeCategory.Function);
            sentType = getDeclaredGeneratorSendType(functionType);
        }

        if (!sentType) {
            sentType = UnknownType.create();
        }

        return { type: sentType, node };
    }

    function getTypeFromLambdaExpression(node: LambdaNode, usage: EvaluatorUsage): TypeResult {
        const functionType = FunctionType.create(FunctionTypeFlags.None);

        let expectedFunctionType: FunctionType | undefined;
        if (usage.expectedType) {
            if (usage.expectedType.category === TypeCategory.Function) {
                expectedFunctionType = usage.expectedType;
            } else if (usage.expectedType.category === TypeCategory.Union) {
                // It's not clear what we should do with a union type. For now,
                // simply use the first function in the union.
                expectedFunctionType = usage.expectedType.subtypes.find(
                    t => t.category === TypeCategory.Function) as FunctionType;
            }
        }

        node.parameters.forEach((param, index) => {
            let paramType: Type = UnknownType.create();
            if (expectedFunctionType && index < expectedFunctionType.details.parameters.length) {
                paramType = FunctionType.getEffectiveParameterType(expectedFunctionType, index);
            }

            if (param.name) {
                assignTypeToExpression(param.name, paramType);
            }

            const functionParam: FunctionParameter = {
                category: param.category,
                name: param.name ? param.name.nameToken.value : undefined,
                hasDefault: !!param.defaultValue,
                type: paramType
            };
            FunctionType.addParameter(functionType, functionParam);
        });

        getType(node.expression);
        functionType.details.inferredReturnTypeNode = node.expression;

        return { type: functionType, node };
    }

    function getTypeFromListComprehensionExpression(node: ListComprehensionNode): TypeResult {
        const elementType = getElementTypeFromListComprehensionExpression(node);

        let type: Type = UnknownType.create();
        const builtInIteratorType = getTypingType(node, 'Generator');

        if (builtInIteratorType && builtInIteratorType.category === TypeCategory.Class) {
            type = ObjectType.create(ClassType.cloneForSpecialization(builtInIteratorType, [elementType]));
        }

        return { type, node };
    }

    function reportPossibleUnknownAssignment(diagLevel: DiagnosticLevel, rule: string,
            target: NameNode, type: Type, srcExpr: ExpressionNode) {

        // Don't bother if the feature is disabled.
        if (diagLevel === 'none') {
            return;
        }

        const nameValue = target.nameToken.value;
        const simplifiedType = removeUnboundFromUnion(type);
        if (simplifiedType.category === TypeCategory.Unknown) {
            addDiagnostic(diagLevel, rule,
                `Inferred type of '${ nameValue }' is unknown`, srcExpr);
        } else if (containsUnknown(simplifiedType)) {
            // Sometimes variables contain an "unbound" type if they're
            // assigned only within conditional statements. Remove this
            // to avoid confusion.
            addDiagnostic(diagLevel, rule,
                `Inferred type of '${ nameValue }', '${ printType(simplifiedType) }', ` +
                `is partially unknown`, srcExpr);
        }
    }

    // Returns the type of one entry returned by the list comprehension,
    // as opposed to the entire list.
    function getElementTypeFromListComprehensionExpression(node: ListComprehensionNode): Type {
        // "Execute" the list comprehensions from start to finish.
        for (const comprehension of node.comprehensions) {
            if (comprehension.nodeType === ParseNodeType.ListComprehensionFor) {
                const iterableType = stripLiteralValue(
                    getTypeFromExpression(comprehension.iterableExpression).type);
                const itemType = getTypeFromIterable(iterableType, !!comprehension.isAsync,
                    comprehension.iterableExpression, false);

                const targetExpr = comprehension.targetExpression;
                assignTypeToExpression(targetExpr, itemType, comprehension.iterableExpression);
            } else {
                assert(comprehension.nodeType === ParseNodeType.ListComprehensionIf);
                // Evaluate the test expression
                getTypeFromExpression(comprehension.testExpression);
            }
        }

        let type: Type = UnknownType.create();
        if (node.expression.nodeType === ParseNodeType.DictionaryKeyEntry) {
            // Create a tuple with the key/value types.
            const keyType = stripLiteralValue(
                getTypeFromExpression(node.expression.keyExpression).type);
            const valueType = stripLiteralValue(
                getTypeFromExpression(node.expression.valueExpression).type);

            type = getBuiltInObject(node, 'Tuple', [keyType, valueType]);
        } else if (node.expression.nodeType === ParseNodeType.DictionaryExpandEntry) {
            const unexpandedType = getTypeFromExpression(node.expression.expandExpression);

            // TODO - need to implement
        } else if (isExpressionNode(node)) {
            type = stripLiteralValue(
                getTypeFromExpression(node.expression as ExpressionNode).type);
        }

        return type;
    }

    function getTypeFromSliceExpression(node: SliceNode): TypeResult {
        const intObject = getBuiltInObject(node, 'int');
        const optionalIntObject = combineTypes([intObject, NoneType.create()]);

        const validateIndexType = (indexExpr: ExpressionNode) => {
            const exprType = stripLiteralValue(getTypeFromExpression(indexExpr).type);

            const diag = new DiagnosticAddendum();
            if (!canAssignType(optionalIntObject, exprType, diag, importLookup)) {
                addError(
                    `Index for slice operation must be an int value or None` + diag.getString(),
                    indexExpr);
            }
        };

        // Validate the index values.
        if (node.startValue) {
            validateIndexType(node.startValue);
        }

        if (node.endValue) {
            validateIndexType(node.endValue);
        }

        if (node.stepValue) {
            validateIndexType(node.stepValue);
        }

        const sliceObject = getBuiltInObject(node, 'slice');
        return { type: sliceObject, node };
    }

    // Converts the type parameters for a Callable type. It should
    // have zero to two parameters. The first parameter, if present, should be
    // either an ellipsis or a list of parameter types. The second parameter, if
    // present, should specify the return type.
    function createCallableType(typeArgs?: TypeResult[]): FunctionType {
        const functionType = FunctionType.create(FunctionTypeFlags.None);
        FunctionType.setDeclaredReturnType(functionType, AnyType.create());

        if (typeArgs && typeArgs.length > 0) {
            if (typeArgs[0].typeList) {
                typeArgs[0].typeList.forEach((entry, index) => {
                    if (isEllipsisType(entry.type)) {
                        addError(`'...' not allowed in this context`, entry.node);
                    } else if (entry.type.category === TypeCategory.Module) {
                        addError(`Module not allowed in this context`, entry.node);
                    }

                    FunctionType.addParameter(functionType, {
                        category: ParameterCategory.Simple,
                        name: `p${ index.toString() }`,
                        type: convertClassToObject(entry.type)
                    });
                });
            } else if (isEllipsisType(typeArgs[0].type)) {
                addDefaultFunctionParameters(functionType);
            } else {
                addError(`Expected parameter type list or '...'`, typeArgs[0].node);
            }
        } else {
            addDefaultFunctionParameters(functionType);
        }

        if (typeArgs && typeArgs.length > 1) {
            if (isEllipsisType(typeArgs[1].type)) {
                addError(`'...' not allowed in this context`, typeArgs[1].node);
            } else if (typeArgs[1].type.category === TypeCategory.Module) {
                addError(`Module not allowed in this context`, typeArgs[1].node);
            }
            FunctionType.setDeclaredReturnType(functionType, convertClassToObject(typeArgs[1].type));
        } else {
            FunctionType.setDeclaredReturnType(functionType, AnyType.create());
        }

        if (typeArgs && typeArgs.length > 2) {
            addError(`Expected only two type arguments to 'Callable'`, typeArgs[2].node);
        }

        return functionType;
    }

    // Creates an Optional[X, Y, Z] type.
    function createOptionalType(errorNode: ParseNode, typeArgs?: TypeResult[]): Type {
        if (!typeArgs || typeArgs.length !== 1) {
            addError(`Expected one type parameter after Optional`, errorNode);
            return UnknownType.create();
        }

        if (isEllipsisType(typeArgs[0].type)) {
            addError(`'...' not allowed in this context`, typeArgs[0].node);
        } else if (typeArgs[0].type.category === TypeCategory.Module) {
            addError(`Module not allowed in this context`, typeArgs[0].node);
        }

        return combineTypes([
            convertClassToObject(typeArgs[0].type),
            NoneType.create()]);
    }

    function cloneBuiltinTypeWithLiteral(node: ParseNode, builtInName: string, value: LiteralValue): Type {
        let type = getBuiltInObject(node, builtInName);
        if (type.category === TypeCategory.Object) {
            type = ObjectType.cloneWithLiteral(type, value);
        }

        return type;
    }

    // Creates a type that represents a Literal. This is not an officially-supported
    // feature of Python but is instead a mypy extension described here:
    // https://mypy.readthedocs.io/en/latest/literal_types.html
    function createLiteralType(node: IndexNode): Type {
        if (node.items.items.length === 0) {
            addError(`Expected a type parameter after Literal`, node.baseExpression);
            return UnknownType.create();
        }

        // As per the specification, we support int, bool, str, and bytes literals.
        const literalTypes: Type[] = [];

        for (const item of node.items.items) {
            let type: Type | undefined;

            if (item.nodeType === ParseNodeType.StringList) {
                const isBytes = (item.strings[0].token.flags & StringTokenFlags.Bytes) !== 0;
                const value = item.strings.map(s => s.value).join('');
                if (isBytes) {
                    type = cloneBuiltinTypeWithLiteral(node, 'bytes', value);
                } else {
                    type = cloneBuiltinTypeWithLiteral(node, 'str', value);
                }
            } else if (item.nodeType === ParseNodeType.Number) {
                if (item.token.isInteger) {
                    type = cloneBuiltinTypeWithLiteral(node, 'int', item.token.value);
                }
            } else if (item.nodeType === ParseNodeType.Constant) {
                if (item.token.keywordType === KeywordType.True) {
                    type = cloneBuiltinTypeWithLiteral(node, 'bool', true);
                } else if (item.token.keywordType === KeywordType.False) {
                    type = cloneBuiltinTypeWithLiteral(node, 'bool', false);
                }
            }

            if (!type) {
                addError(`Type arguments for Literal must be an int, bool, str, or bytes value`,
                    item);
                type = UnknownType.create();
            }

            literalTypes.push(type);
        }

        return convertClassToObject(combineTypes(literalTypes));
    }

    // Creates a ClassVar type.
    function createClassVarType(errorNode: ParseNode, typeArgs: TypeResult[] | undefined): Type {
        if (!typeArgs || typeArgs.length === 0) {
            addError(`Expected a type parameter after ClassVar`, errorNode);
            return UnknownType.create();
        } else if (typeArgs.length > 1) {
            addError(`Expected only one type parameter after ClassVar`, typeArgs[1].node);
            return UnknownType.create();
        }

        let type = typeArgs[0].type;

        if (requiresSpecialization(type)) {
            // A ClassVar should not allow generic types, but the typeshed
            // stubs use this in a few cases. For now, just specialize
            // it in a general way.
            type = specializeType(type, undefined);
        }

        return convertClassToObject(type);
    }

    // Creates one of several "special" types that are defined in typing.pyi
    // but not declared in their entirety. This includes the likes of "Tuple",
    // "Dict", etc.
    function createSpecialType(classType: ClassType, typeArgs: TypeResult[] | undefined,
            paramLimit?: number, allowEllipsis = false): Type {

        if (typeArgs) {
            // Verify that we didn't receive any inappropriate ellipses or modules.
            typeArgs.forEach((typeArg, index) => {
                if (isEllipsisType(typeArg.type)) {
                    if (!allowEllipsis) {
                        addError(`'...' not allowed in this context`, typeArgs[index].node);
                    } else if (typeArgs.length !== 2 || index !== 1) {
                        addError(`'...' allowed only as the second of two arguments`, typeArgs[index].node);
                    }
                    if (typeArg.type.category === TypeCategory.Module) {
                        addError(`Module not allowed in this context`, typeArg.node);
                    }
                }
            });
        }

        let typeArgTypes = typeArgs ? typeArgs.map(
            t => convertClassToObject(t.type)) : [];

        // Make sure the argument list count is correct.
        if (paramLimit !== undefined) {
            if (typeArgs && typeArgTypes.length > paramLimit) {
                addError(
                    `Expected at most ${ paramLimit } type ` +
                    `${ paramLimit === 1 ? 'argument' : 'arguments' }`,
                    typeArgs[paramLimit].node);
                typeArgTypes = typeArgTypes.slice(0, paramLimit);
            } else if (typeArgTypes.length < paramLimit) {
                // Fill up the remainder of the slots with unknown types.
                while (typeArgTypes.length < paramLimit) {
                    typeArgTypes.push(UnknownType.create());
                }
            }
        }

        // If no type args are provided and ellipses are allowed,
        // default to [Any, ...]. For example, Tuple is equivalent
        // to Tuple[Any, ...].
        if (!typeArgs && allowEllipsis) {
            typeArgTypes.push(AnyType.create(false));
            typeArgTypes.push(AnyType.create(true));
        }

        const specializedType = ClassType.cloneForSpecialization(classType, typeArgTypes);

        return specializedType;
    }

    // Unpacks the index expression for a "Union[X, Y, Z]" type annotation.
    function createUnionType(typeArgs?: TypeResult[]): Type {
        const types: Type[] = [];

        if (typeArgs) {
            for (const typeArg of typeArgs) {
                types.push(typeArg.type);

                // Verify that we didn't receive any inappropriate ellipses.
                if (isEllipsisType(typeArg.type)) {
                    addError(`'...' not allowed in this context`, typeArg.node);
                } else if (typeArg.type.category === TypeCategory.Module) {
                    addError(`Module not allowed in this context`, typeArg.node);
                }
            }
        }

        if (types.length > 0) {
            return combineTypes(types);
        }

        return NeverType.create();
    }

    // Creates a type that represents "Generic[T1, T2, ...]", used in the
    // definition of a generic class.
    function createGenericType(errorNode: ParseNode, classType: ClassType, typeArgs?: TypeResult[]): Type {
        // Make sure there's at least one type arg.
        if (!typeArgs || typeArgs.length === 0) {
            addError(
                `'Generic' requires at least one type argument`, errorNode);
        }

        // Make sure that all of the type args are typeVars and are unique.
        const uniqueTypeVars: TypeVarType[] = [];
        if (typeArgs) {
            typeArgs.forEach(typeArg => {
                if (!(typeArg.type.category === TypeCategory.TypeVar)) {
                    addError(
                        `Type argument for 'Generic' must be a type variable`, typeArg.node);
                } else {
                    for (const typeVar of uniqueTypeVars) {
                        if (typeVar === typeArg.type) {
                            addError(
                                `Type argument for 'Generic' must be unique`, typeArg.node);
                            break;
                        }
                    }

                    uniqueTypeVars.push(typeArg.type);
                }
            });
        }

        return createSpecialType(classType, typeArgs);
    }

    function transformTypeForPossibleEnumClass(node: NameNode, typeOfExpr: Type): Type {
        // If the node is within a class that derives from the metaclass
        // "EnumMeta", we need to treat assignments differently.
        const enclosingClassNode = ParseTreeUtils.getEnclosingClass(node, true);
        if (enclosingClassNode) {
            const enumClass = AnalyzerNodeInfo.getExpressionType(enclosingClassNode) as ClassType;
            assert(enumClass.category === TypeCategory.Class);

            // Handle several built-in classes specially. We don't
            // want to interpret their class variables as enumerations.
            if (getFileInfo(node).isStubFile) {
                const className = enumClass.details.name;
                const builtInEnumClasses = ['Enum', 'IntEnum', 'Flag', 'IntFlag'];
                if (builtInEnumClasses.find(c => c === className)) {
                    return typeOfExpr;
                }
            }

            if (isEnumClass(enumClass)) {
                return ObjectType.create(enumClass);
            }
        }

        return typeOfExpr;
    }

    function createSpecialBuiltInClass(node: ParseNode, assignedName: string,
            aliasMapEntry: AliasMapEntry): ClassType {

        const specialClassType = ClassType.create(assignedName,
            ClassTypeFlags.BuiltInClass | ClassTypeFlags.SpecialBuiltIn,
            node.id);

        const baseClassName = aliasMapEntry.alias ? aliasMapEntry.alias : 'object';

        let aliasClass: Type | undefined;
        if (aliasMapEntry.module === 'builtins') {
            aliasClass = getBuiltInType(node, baseClassName);
        } else if (aliasMapEntry.module === 'collections') {
            // The typing.pyi file imports collections.
            const fileInfo = getFileInfo(node);
            if (fileInfo.collectionsModulePath) {
                const lookupResult = importLookup(fileInfo.collectionsModulePath);
                if (lookupResult) {
                    const symbol = lookupResult.symbolTable.get(baseClassName);
                    if (symbol) {
                        aliasClass = getEffectiveTypeOfSymbol(symbol, importLookup);
                    }
                }
            }
        } else if (aliasMapEntry.module === 'self') {
            const symbolWithScope = lookUpSymbolRecursive(node, baseClassName);
            if (symbolWithScope) {
                aliasClass = getEffectiveTypeOfSymbol(
                    symbolWithScope.symbol, importLookup);
            }
        }

        if (aliasClass && aliasClass.category === TypeCategory.Class &&
                specialClassType.category === TypeCategory.Class) {

            ClassType.addBaseClass(specialClassType, aliasClass, false);

            if (aliasMapEntry.alias) {
                specialClassType.details.aliasClass = aliasClass;
            }
        } else {
            ClassType.addBaseClass(specialClassType, UnknownType.create(), false);
        }

        return specialClassType;
    }

    // Handles some special-case type annotations that are found
    // within the typings.pyi file.
    function handleTypingStubTypeAnnotation(node: ExpressionNode): ClassType | undefined {
        if (!node.parent || node.parent.nodeType !== ParseNodeType.TypeAnnotation) {
            return undefined;
        }

        if (node.parent.valueExpression.nodeType !== ParseNodeType.Name) {
            return undefined;
        }

        const nameNode = node.parent.valueExpression;
        const assignedName = nameNode.nameToken.value;

        const specialTypes: { [name: string]: AliasMapEntry } = {
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
            return createSpecialBuiltInClass(node, assignedName, aliasMapEntry);
        }

        return undefined;
    }

    // Handles some special-case assignment statements that are found
    // within the typings.pyi file.
    function handleTypingStubAssignment(node: AssignmentNode): Type | undefined {
        if (node.leftExpression.nodeType !== ParseNodeType.Name) {
            return undefined;
        }

        const nameNode = node.leftExpression;
        const assignedName = nameNode.nameToken.value;

        if (assignedName === 'Any') {
            return AnyType.create();
        }

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
            'ChainMap': { alias: 'ChainMap', module: 'collections' }
        };

        const aliasMapEntry = specialTypes[assignedName];
        if (aliasMapEntry) {
            return createSpecialBuiltInClass(node, assignedName, aliasMapEntry);
        }

        return undefined;
    }

    function getTypeOfAssignmentStatementTarget(node: AssignmentNode,
                targetOfInterest?: ExpressionNode): Type | undefined {

        // Is this type already cached?
        let rightHandType = AnalyzerNodeInfo.peekExpressionType(node.rightExpression, analysisVersion);

        // If there was a cached value and no target of interest or the entire
        // LHS is the target of interest, there's no need to do additional work.
        if (rightHandType && (!targetOfInterest || targetOfInterest === node.leftExpression)) {
            return rightHandType;
        }

        if (!rightHandType) {
            const fileInfo = getFileInfo(node);

            // Special-case the typing.pyi file, which contains some special
            // types that the type analyzer needs to interpret differently.
            if (fileInfo.isTypingStubFile) {
                rightHandType = handleTypingStubAssignment(node);
                if (rightHandType) {
                    updateExpressionTypeForNode(node.rightExpression, rightHandType);
                }
            }

            if (!rightHandType) {
                // Determine whether there is a declared type.
                const declaredType = getDeclaredTypeForExpression(node.leftExpression);

                // Evaluate the type of the right-hand side.
                // An assignment of ellipsis means "Any" within a type stub file.
                let srcType = getType(node.rightExpression, { method: 'get', expectedType: declaredType },
                    fileInfo.isStubFile ? EvaluatorFlags.ConvertEllipsisToAny : undefined);

                // Determine if the RHS is a constant boolean expression.
                // If so, assign it a literal type.
                const constExprValue = evaluateStaticBoolExpression(
                    node.rightExpression, fileInfo.executionEnvironment);
                if (constExprValue !== undefined) {
                    const boolType = getBuiltInObject(node, 'bool');
                    if (boolType.category === TypeCategory.Object) {
                        srcType = ObjectType.cloneWithLiteral(boolType, constExprValue);
                    }
                }

                // If there was a declared type, make sure the RHS value is compatible.
                if (declaredType) {
                    const diagAddendum = new DiagnosticAddendum();
                    if (canAssignType(declaredType, srcType, diagAddendum, importLookup)) {
                        // Constrain the resulting type to match the declared type.
                        srcType = constrainDeclaredTypeBasedOnAssignedType(
                            declaredType, srcType, importLookup);
                    }
                }

                // If this is an enum, transform the type as required.
                rightHandType = srcType;
                if (node.leftExpression.nodeType === ParseNodeType.Name && !node.typeAnnotationComment) {
                    rightHandType = transformTypeForPossibleEnumClass(
                        node.leftExpression, rightHandType);
                }
            }
        }

        if (!rightHandType) {
            return undefined;
        }

        return assignTypeToExpression(node.leftExpression, rightHandType,
            node.rightExpression, targetOfInterest);
    }

    function getTypeOfAugmentedAssignmentTarget(node: AugmentedAssignmentNode,
                targetOfInterest?: ExpressionNode): Type | undefined {

        // Is this type already cached?
        let destType = AnalyzerNodeInfo.peekExpressionType(node.destExpression, analysisVersion);

        // If there was a cached value and no target of interest or the entire
        // LHS is the target of interest, there's no need to do additional work.
        if (destType && (!targetOfInterest || targetOfInterest === node.destExpression)) {
            return destType;
        }

        destType = getTypeFromAugmentedAssignment(node);
        return assignTypeToExpression(node.destExpression, destType,
            node.rightExpression, targetOfInterest);
    }

    function getTypeOfClass(node: ClassNode): ClassTypeResult {
        // Is this type already cached?
        let classType = AnalyzerNodeInfo.peekExpressionType(node, analysisVersion) as ClassType;
        let decoratedType = AnalyzerNodeInfo.peekExpressionType(node.name, analysisVersion);

        if (classType && decoratedType) {
            return { classType, decoratedType };
        }

        // The type wasn't cached, so we need to create a new one.
        const scope = ScopeUtils.getScopeForNode(node);
        const fileInfo = getFileInfo(node);

        let classFlags = ClassTypeFlags.None;
        if (scope.getType() === ScopeType.Builtin || fileInfo.isTypingStubFile || fileInfo.isBuiltInStubFile) {
            classFlags |= ClassTypeFlags.BuiltInClass;
        }

        classType = ClassType.create(node.name.nameToken.value, classFlags,
            node.id, ParseTreeUtils.getDocString(node.suite.statements));

        // Pre-cache the class type that we just created. This is needed to handle
        // a few circularities within the stdlib type stubs like the datetime class,
        // which uses itself as a type parameter for one of its base classes.
        const oldCachedClassType = AnalyzerNodeInfo.peekExpressionType(node);
        const oldCachedDecoratedClassType = AnalyzerNodeInfo.peekExpressionType(node.name);
        AnalyzerNodeInfo.setExpressionType(node, classType);
        AnalyzerNodeInfo.setExpressionType(node.name, classType);

        // Keep a list of unique type parameters that are used in the
        // base class arguments.
        const typeParameters: TypeVarType[] = [];

        let sawMetaclass = false;
        let nonMetaclassBaseClassCount = 0;
        node.arguments.forEach(arg => {
            // Ignore keyword parameters other than metaclass or total.
            if (!arg.name || arg.name.nameToken.value === 'metaclass') {
                let argType = getType(arg.valueExpression);
                const isMetaclass = !!arg.name;

                if (isMetaclass) {
                    if (sawMetaclass) {
                        addError(`Only one metaclass can be provided`, arg);
                    }
                    sawMetaclass = true;
                }

                // In some stub files, classes are conditionally defined (e.g. based
                // on platform type). We'll assume that the conditional logic is correct
                // and strip off the "unbound" union.
                if (argType.category === TypeCategory.Union) {
                    argType = removeUnboundFromUnion(argType);
                }

                if (!isAnyOrUnknown(argType)) {
                    // Handle "Type[X]" object.
                    argType = transformTypeObjectToClass(argType);
                    if (argType.category !== TypeCategory.Class) {
                        addError(`Argument to class must be a base class`, arg);
                        argType = UnknownType.create();
                    } else {
                        if (ClassType.isBuiltIn(argType, 'Protocol')) {
                            if (!fileInfo.isStubFile && fileInfo.executionEnvironment.pythonVersion < PythonVersion.V37) {
                                addError(`Use of 'Protocol' requires Python 3.7 or newer`, arg.valueExpression);
                            }
                        }

                        // If the class directly derives from NamedTuple (in Python 3.6 or
                        // newer), it's considered a dataclass.
                        if (fileInfo.executionEnvironment.pythonVersion >= PythonVersion.V36) {
                            if (ClassType.isBuiltIn(argType, 'NamedTuple')) {
                                classType.details.flags |= ClassTypeFlags.DataClass;
                            }
                        }

                        // If the class directly derives from TypedDict or from a class that is
                        // a TypedDict, it is considered a TypedDict.
                        if (ClassType.isBuiltIn(argType, 'TypedDict') || ClassType.isTypedDictClass(argType)) {
                            classType.details.flags |= ClassTypeFlags.TypedDictClass;
                        } else if (ClassType.isTypedDictClass(classType) && !ClassType.isTypedDictClass(argType)) {
                            // TypedDict classes must derive only from other
                            // TypedDict classes.
                            addError(`All base classes for TypedDict classes must ` +
                                'als be TypedDict classes', arg);
                        }

                        // Validate that the class isn't deriving from itself, creating a
                        // circular dependency.
                        if (derivesFromClassRecursive(argType, classType)) {
                            addError(`Class cannot derive from itself`, arg);
                            argType = UnknownType.create();
                        }
                    }
                }

                if (argType.category === TypeCategory.Unknown ||
                        argType.category === TypeCategory.Union && argType.subtypes.some(t => t.category === TypeCategory.Unknown)) {

                    addDiagnostic(
                        fileInfo.diagnosticSettings.reportUntypedBaseClass,
                        DiagnosticRule.reportUntypedBaseClass,
                        `Base class type is unknown, obscuring type of derived class`,
                        arg);
                }

                ClassType.addBaseClass(classType, argType, isMetaclass);

                // TODO - validate that we are not adding type parameters that
                // are unique type vars but have conflicting names.
                addTypeVarsToListIfUnique(typeParameters,
                    getTypeVarArgumentsRecursive(argType));

                if (!isMetaclass) {
                    nonMetaclassBaseClassCount++;
                }
            } else if (arg.name.nameToken.value === 'total') {
                // The "total" parameter name applies only for TypedDict classes.
                if (ClassType.isTypedDictClass(classType)) {
                    // PEP 589 specifies that the parameter must be either True or False.
                    const constArgValue = evaluateStaticBoolExpression(
                            arg.valueExpression, fileInfo.executionEnvironment);
                    if (constArgValue === undefined) {
                        addError('Value for total parameter must be True or False', arg.valueExpression);
                    } else if (!constArgValue) {
                        classType.details.flags |= ClassTypeFlags.CanOmitDictValues;
                    }
                }
            }
        });

        if (nonMetaclassBaseClassCount === 0) {
            // Make sure we don't have 'object' derive from itself. Infinite
            // recursion will result.
            if (!ClassType.isBuiltIn(classType, 'object')) {
                ClassType.addBaseClass(classType, getBuiltInType(node, 'object'), false);
            }
        }

        classType.details.typeParameters = typeParameters;

        // The scope for this class becomes the "fields" for the corresponding type.
        const innerScope = ScopeUtils.getScopeForNode(node.suite);
        classType.details.fields = innerScope.getSymbolTable();

        if (ClassType.isTypedDictClass(classType)) {
            synthesizeTypedDictClassMethods(classType);
        }

        if (ClassType.isDataClass(classType)) {
            let skipSynthesizedInit = ClassType.isSkipSynthesizedInit(classType);
            if (!skipSynthesizedInit) {
                // See if there's already a non-synthesized __init__ method.
                // We shouldn't override it.
                const initSymbol = lookUpClassMember(classType, '__init__',
                    importLookup, ClassMemberLookupFlags.SkipBaseClasses);
                if (initSymbol) {
                    const initSymbolType = getTypeOfMember(initSymbol, importLookup);
                    if (initSymbolType.category === TypeCategory.Function) {
                        if (!FunctionType.isSynthesizedMethod(initSymbolType)) {
                            skipSynthesizedInit = true;
                        }
                    } else {
                        skipSynthesizedInit = true;
                    }
                }
            }

            synthesizeDataClassMethods(node, classType, skipSynthesizedInit);
        }

        // Restore the old cached values.
        if (oldCachedClassType) {
            AnalyzerNodeInfo.setExpressionType(node, oldCachedClassType);
        }
        if (oldCachedDecoratedClassType) {
            AnalyzerNodeInfo.setExpressionType(node.name, oldCachedDecoratedClassType);
        }

        updateExpressionTypeForNode(node, classType);

        // Now determine the decorated type of the class.
        decoratedType = classType;
        let foundUnknown = false;

        for (let i = node.decorators.length - 1; i >= 0; i--) {
            const decorator = node.decorators[i];

            decoratedType = applyClassDecorator(decoratedType,
                classType, decorator);
            if (decoratedType.category === TypeCategory.Unknown) {
                // Report this error only on the first unknown type.
                if (!foundUnknown) {
                    addDiagnostic(
                        fileInfo.diagnosticSettings.reportUntypedClassDecorator,
                        DiagnosticRule.reportUntypedClassDecorator,
                        `Untyped class declarator obscures type of class`,
                        node.decorators[i].leftExpression);

                    foundUnknown = true;
                }
            }
        }

        updateExpressionTypeForNode(node.name, decoratedType);
        return { classType, decoratedType };
    }

    function applyClassDecorator(inputClassType: Type, originalClassType: ClassType,
            decoratorNode: DecoratorNode): Type {

        const decoratorType = getType(decoratorNode.leftExpression);

        // Is this a @dataclass?
        if (decoratorType.category === TypeCategory.OverloadedFunction) {
            const overloads = decoratorType.overloads;
            if (overloads.length > 0 && overloads[0].type.details.builtInName === 'dataclass') {
                // Determine whether we should skip synthesizing the init method.
                let skipSynthesizeInit = false;

                if (decoratorNode.arguments) {
                    decoratorNode.arguments.forEach(arg => {
                        if (arg.name && arg.name.nameToken.value === 'init') {
                            if (arg.valueExpression) {
                                const fileInfo = getFileInfo(decoratorNode);
                                const value = evaluateStaticBoolExpression(
                                    arg.valueExpression, fileInfo.executionEnvironment);
                                if (!value) {
                                    skipSynthesizeInit = true;
                                }
                            }
                        }
                    });
                }

                originalClassType.details.flags |= ClassTypeFlags.DataClass;
                if (skipSynthesizeInit) {
                    originalClassType.details.flags |= ClassTypeFlags.SkipSynthesizedInit;
                }
                return inputClassType;
            }
        }

        return getTypeFromDecorator(decoratorNode, inputClassType);
    }

    function getTypeOfFunction(node: FunctionNode): FunctionTypeResult {
        // Is this type already cached?
        let functionType = AnalyzerNodeInfo.peekExpressionType(node, analysisVersion) as FunctionType;
        let decoratedType = AnalyzerNodeInfo.peekExpressionType(node.name, analysisVersion);

        if (functionType && decoratedType) {
            return { functionType, decoratedType };
        }

        // There was no cached type, so create a new one.
        const fileInfo = getFileInfo(node);

        // Retrieve the containing class node if the function is a method.
        const containingClassNode = ParseTreeUtils.getEnclosingClass(node, true);
        const containingClassType = containingClassNode ?
            AnalyzerNodeInfo.getExpressionType(containingClassNode) as ClassType : undefined;
        const functionDecl = AnalyzerNodeInfo.getFunctionDeclaration(node)!;

        // The "__new__" magic method is not an instance method.
        // It acts as a static method instead.
        let functionFlags = FunctionTypeFlags.None;
        if (node.name.nameToken.value === '__new__') {
            functionFlags |= FunctionTypeFlags.StaticMethod;
            functionFlags |= FunctionTypeFlags.ConstructorMethod;
            functionFlags &= ~FunctionTypeFlags.InstanceMethod;
        }

        if (functionDecl.yieldExpressions) {
            functionFlags |= FunctionTypeFlags.Generator;
        }

        functionType = FunctionType.create(functionFlags,
            ParseTreeUtils.getDocString(node.suite.statements));
        functionType.details.inferredReturnTypeNode = node.suite;

        if (fileInfo.isBuiltInStubFile || fileInfo.isTypingStubFile) {
            // Stash away the name of the function since we need to handle
            // 'namedtuple', 'abstractmethod', 'dataclass' and 'NewType'
            // specially.
            functionType.details.builtInName = node.name.nameToken.value;
        }

        let asyncType = functionType;
        if (node.isAsync) {
            asyncType = createAwaitableFunction(node, functionType);
        }

        // Apply all of the decorators in reverse order.
        decoratedType = asyncType;
        let foundUnknown = false;
        for (let i = node.decorators.length - 1; i >= 0; i--) {
            const decorator = node.decorators[i];

            decoratedType = applyFunctionDecorator(decoratedType, functionType, decorator);
            if (decoratedType.category === TypeCategory.Unknown) {
                // Report this error only on the first unknown type.
                if (!foundUnknown) {
                    addDiagnostic(
                        fileInfo.diagnosticSettings.reportUntypedFunctionDecorator,
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
                functionType.details.flags |= FunctionTypeFlags.InstanceMethod;

                // If there's a separate async version, mark it as an instance
                // method as well.
                if (functionType !== asyncType) {
                    asyncType.details.flags |= FunctionTypeFlags.InstanceMethod;
                }
            }
        }

        node.parameters.forEach((param: ParameterNode, index) => {
            let paramType: Type | undefined;
            let annotatedType: Type | undefined;
            let concreteAnnotatedType: Type | undefined;
            let isNoneWithoutOptional = false;

            if (param.typeAnnotation) {
                annotatedType = getTypeOfAnnotation(param.typeAnnotation);

                // PEP 484 indicates that if a parameter has a default value of 'None'
                // the type checker should assume that the type is optional (i.e. a union
                // of the specified type and 'None').
                if (param.defaultValue && param.defaultValue.nodeType === ParseNodeType.Constant) {
                    if (param.defaultValue.token.keywordType === KeywordType.None) {
                        isNoneWithoutOptional = true;

                        if (!fileInfo.diagnosticSettings.strictParameterNoneValue) {
                            annotatedType = combineTypes([annotatedType, NoneType.create()]);
                        }
                    }
                }

                concreteAnnotatedType = specializeType(annotatedType, undefined);
            }

            let defaultValueType: Type | undefined;
            if (param.defaultValue) {
                defaultValueType = getType(param.defaultValue, { method: 'get', expectedType: annotatedType },
                    EvaluatorFlags.ConvertEllipsisToAny);
            }

            if (param.typeAnnotation && annotatedType) {
                // If there was both a type annotation and a default value, verify
                // that the default value matches the annotation.
                if (param.defaultValue && defaultValueType && concreteAnnotatedType) {
                    const diagAddendum = new DiagnosticAddendum();

                    if (!canAssignType(concreteAnnotatedType, defaultValueType,
                            diagAddendum, importLookup)) {

                        const diag = addError(
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

                paramType = annotatedType;
            } else if (index === 0 && (
                    FunctionType.isInstanceMethod(functionType) ||
                    FunctionType.isClassMethod(functionType) ||
                    FunctionType.isConstructorMethod(functionType))) {

                // Specify type of "self" or "cls" parameter for instance or class methods
                // if the type is not explicitly provided.
                if (containingClassType) {
                    // Don't specialize the "self" for protocol classes because type
                    // comparisons will fail during structural typing analysis.
                    if (containingClassType && !ClassType.isProtocol(containingClassType)) {
                        if (FunctionType.isInstanceMethod(functionType)) {
                            const specializedClassType = selfSpecializeClassType(containingClassType);
                            paramType = ObjectType.create(specializedClassType);
                        } else if (FunctionType.isClassMethod(functionType) ||
                                FunctionType.isConstructorMethod(functionType)) {

                            // For class methods, the cls parameter is allowed to skip the
                            // abstract class test because the caller is possibly passing
                            // in a non-abstract subclass.
                            paramType = selfSpecializeClassType(containingClassType, true);
                        }
                    }
                }
            } else {
                // There is no annotation, and we can't infer the type.
                if (param.name) {
                    addDiagnostic(
                        fileInfo.diagnosticSettings.reportUnknownParameterType,
                        DiagnosticRule.reportUnknownParameterType,
                        `Type of '${ param.name.nameToken.value }' is unknown`,
                        param.name);
                }
            }

            const functionParam: FunctionParameter = {
                category: param.category,
                name: param.name ? param.name.nameToken.value : undefined,
                hasDefault: !!param.defaultValue,
                type: paramType || UnknownType.create()
            };

            FunctionType.addParameter(functionType, functionParam);

            if (param.name) {
                const specializedParamType = specializeType(functionParam.type, undefined);

                // If the type contains type variables, specialize them now
                // so we convert them to a concrete type (or unknown if there
                // is no bound or constraint).
                const variadicParamType = transformVariadicParamType(node,
                    param.category, specializedParamType);
                updateExpressionTypeForNode(param.name, variadicParamType);
            }
        });

        // If there was a defined return type, analyze that first so when we
        // walk the contents of the function, return statements can be
        // validated against this type.
        if (node.returnTypeAnnotation) {
            const returnType = getTypeOfAnnotation(node.returnTypeAnnotation);
            FunctionType.setDeclaredReturnType(functionType, returnType);
        }

        updateExpressionTypeForNode(node, functionType);

        // If there was no decorator, see if there are any overloads provided
        // by previous function declarations.
        if (decoratedType === functionType) {
            const overloadedType = addOverloadsToFunctionType(node, decoratedType);
            updateExpressionTypeForNode(node.name, overloadedType);
        } else {
            updateExpressionTypeForNode(node.name, decoratedType);
        }

        return { functionType, decoratedType };
    }

    // Transforms the parameter type based on its category. If it's a simple parameter,
    // no transform is applied. If it's a var-arg or keyword-arg parameter, the type
    // is wrapped in a List or Dict.
    function transformVariadicParamType(node: ParseNode, paramCategory: ParameterCategory, type: Type): Type {
        switch (paramCategory) {
            case ParameterCategory.Simple: {
                return type;
            }

            case ParameterCategory.VarArgList: {
                const listType = getBuiltInType(node, 'List');

                if (listType.category === TypeCategory.Class) {
                    return ObjectType.create(ClassType.cloneForSpecialization(listType, [type]));
                }

                return UnknownType.create();
            }

            case ParameterCategory.VarArgDictionary: {
                const dictType = getBuiltInType(node, 'Dict');
                const strType = getBuiltInObject(node, 'str');

                if (dictType.category === TypeCategory.Class && strType.category === TypeCategory.Object) {
                    return ObjectType.create(ClassType.cloneForSpecialization(dictType, [strType, type]));
                }

                return UnknownType.create();
            }
        }
    }

    // Transforms the input function type into an output type based on the
    // decorator function described by the decoratorNode.
    function applyFunctionDecorator(inputFunctionType: Type,
            originalFunctionType: FunctionType, decoratorNode: DecoratorNode): Type {

        const decoratorType = getType(decoratorNode.leftExpression);

        // Special-case the "overload" because it has no definition.
        if (decoratorType.category === TypeCategory.Class &&
                ClassType.isSpecialBuiltIn(decoratorType, 'overload')) {

            if (inputFunctionType.category === TypeCategory.Function) {
                inputFunctionType.details.flags |= FunctionTypeFlags.Overloaded;
                return inputFunctionType;
            }
        }

        const returnType = getTypeFromDecorator(decoratorNode, inputFunctionType);

        // Check for some built-in decorator types with known semantics.
        if (decoratorType.category === TypeCategory.Function) {
            if (decoratorType.details.builtInName === 'abstractmethod') {
                originalFunctionType.details.flags |= FunctionTypeFlags.AbstractMethod;
                return inputFunctionType;
            }

            // Handle property setters and deleters.
            if (decoratorNode.leftExpression.nodeType === ParseNodeType.MemberAccess) {
                const baseType = getType(decoratorNode.leftExpression.leftExpression);
                if (baseType.category === TypeCategory.Property) {
                    const memberName = decoratorNode.leftExpression.memberName.nameToken.value;
                    if (memberName === 'setter') {
                        return PropertyType.cloneWithSetter(baseType, originalFunctionType);
                    } else if (memberName === 'deleter') {
                        return PropertyType.cloneWithDeleter(baseType, originalFunctionType);
                    }
                }
            }

        } else if (decoratorType.category === TypeCategory.Class) {
            if (ClassType.isBuiltIn(decoratorType)) {
                switch (decoratorType.details.name) {
                    case 'staticmethod': {
                        originalFunctionType.details.flags |= FunctionTypeFlags.StaticMethod;
                        return inputFunctionType;
                    }

                    case 'classmethod': {
                        originalFunctionType.details.flags |= FunctionTypeFlags.ClassMethod;
                        return inputFunctionType;
                    }

                    case 'property':
                    case 'abstractproperty': {
                        if (inputFunctionType.category === TypeCategory.Function) {
                            return PropertyType.create(inputFunctionType);
                        }
                    }
                }
            }
        }

        return returnType;
    }

    // Given a function node and the function type associated with it, this
    // method search for prior function nodes that are marked as @overload
    // and creates an OverloadedFunctionType that includes this function and
    // all previous ones.
    function addOverloadsToFunctionType(node: FunctionNode, type: FunctionType): Type {
        const functionDecl = AnalyzerNodeInfo.getFunctionDeclaration(node)!;
        const symbolWithScope = lookUpSymbolRecursive(node, node.name.nameToken.value);
        if (symbolWithScope) {
            const decls = symbolWithScope.symbol.getDeclarations();

            // Find this function's declaration.
            let declIndex = decls.findIndex(decl => decl === functionDecl);
            if (declIndex > 0) {
                const overloadedTypes: OverloadedFunctionEntry[] = [{ type, typeSourceId: decls[declIndex].node.id }];
                while (declIndex > 0) {
                    const declType = AnalyzerNodeInfo.getExpressionType(decls[declIndex - 1].node);
                    if (!declType || declType.category !== TypeCategory.Function || !FunctionType.isOverloaded(declType)) {
                        break;
                    }

                    overloadedTypes.unshift({ type: declType, typeSourceId: decls[declIndex - 1].node.id });
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

    function createAwaitableFunction(node: FunctionNode, functionType: FunctionType): FunctionType {
        const returnType = getEffectiveReturnType(functionType);

        let awaitableReturnType: Type | undefined;

        if (returnType.category === TypeCategory.Object) {
            const classType = returnType.classType;
            if (ClassType.isBuiltIn(classType)) {
                if (classType.details.name === 'Generator') {
                    // If the return type is a Generator, change it to an AsyncGenerator.
                    const asyncGeneratorType = getTypingType(node, 'AsyncGenerator');
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

                } else if (classType.details.name === 'AsyncGenerator') {
                    // If it's already an AsyncGenerator, leave it as is.
                    awaitableReturnType = returnType;
                }
            }
        }

        if (!awaitableReturnType) {
            const awaitableType = getTypingType(node, 'Awaitable');
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

    function getTypeOfAssignmentTarget(target: ExpressionNode): Type | undefined {
        let assignmentNode: ParseNode | undefined = target;
        while (assignmentNode) {
            switch (assignmentNode.nodeType) {
                case ParseNodeType.Assignment: {
                    // TODO - need to implement
                    return undefined;
                    // return getTypeOfAssignmentStatementTarget(assignmentNode, target);
                }

                case ParseNodeType.AssignmentExpression: {
                    // TODO - need to implement
                    return undefined;
                    // assert(target === assignmentNode.name);
                    // return getType(assignmentNode);
                }

                case ParseNodeType.AugmentedAssignment: {
                    // TODO - need to implement
                    return undefined;
                    // return getTypeOfAugmentedAssignmentTarget(assignmentNode, target);
                }

                case ParseNodeType.Class: {
                    // TODO - need to implement
                    return undefined;
                }

                case ParseNodeType.Parameter: {
                    // TODO - need to implement
                    return undefined;
                }

                case ParseNodeType.Function: {
                    // TODO - need to implement
                    return undefined;
                }

                case ParseNodeType.For: {
                    // TODO - need to implement
                    return undefined;
                }

                case ParseNodeType.Except: {
                    // TODO - need to implement
                    return undefined;
                }

                case ParseNodeType.WithItem: {
                    // TODO - need to implement
                    return undefined;
                }

                case ParseNodeType.ListComprehensionFor: {
                    // TODO - need to implement
                    return undefined;
                }

                case ParseNodeType.ImportAs: {
                    // TODO - need to implement
                    return undefined;
                }

                case ParseNodeType.ImportFrom: {
                    // TODO - need to implement
                    return undefined;
                }
            }

            assignmentNode = assignmentNode.parent;
        }

        assert.fail('Unexpected assignment target');
        return undefined;
    }

    function getFlowTypeOfReference(reference: NameNode | MemberAccessNode,
            targetSymbolId: number, initialType: Type | undefined): Type | undefined {

        const flowNode = AnalyzerNodeInfo.getFlowNode(reference);
        const flowNodeTypeCache = new Map<number, FlowNodeType | undefined>();

        function preventFlowNodeRecursion(flowNodeId: number, callback: () => void) {
            typeFlowRecursionMap.set(flowNodeId, true);
            callback();
            typeFlowRecursionMap.delete(flowNodeId);
        }

        // Caches the type of the flow node in our local cache, keyed by the flow node ID.
        function setCacheEntry(flowNode: FlowNode, type?: Type): FlowNodeType | undefined {
            flowNodeTypeCache.set(flowNode.id, type);
            return type;
        }

        function evaluateAssignmentFlowNode(flowNode: FlowAssignment): FlowNodeType | undefined {
            let cachedType = AnalyzerNodeInfo.getExpressionType(flowNode.node);
            if (!cachedType) {
                // There is no cached type for this expression, so we need to
                // evaluate it.
                cachedType = getTypeOfAssignmentTarget(flowNode.node);
            }
            return setCacheEntry(flowNode, cachedType);
        }

        // If this flow has no knowledge of the target expression, it returns undefined.
        // If the start flow node for this scope is reachable, the typeAtStart value is
        // returned.
        function getTypeFromFlowNode(flowNode: FlowNode, reference: NameNode | MemberAccessNode,
                targetSymbolId: number, initialType: Type | undefined): FlowNodeType | undefined {

            let curFlowNode = flowNode;

            while (true) {
                // Have we already been here? If so, use the cached value.
                const cachedEntry = flowNodeTypeCache.get(curFlowNode.id);
                if (cachedEntry) {
                    return cachedEntry;
                }

                // Avoid infinite recursion.
                if (typeFlowRecursionMap.has(curFlowNode.id)) {
                    return undefined;
                }

                if (curFlowNode.flags & FlowFlags.Unreachable) {
                    // We can get here if there are nodes in a compound logical expression
                    // (e.g. "False and x") that are never executed but are evaluated.
                    // The type doesn't matter in this case.
                    return setCacheEntry(curFlowNode, undefined);
                }

                if (curFlowNode.flags & FlowFlags.Start) {
                    return setCacheEntry(curFlowNode, initialType);
                }

                if (curFlowNode.flags & FlowFlags.Assignment) {
                    const assignmentFlowNode = curFlowNode as FlowAssignment;
                    if (reference.nodeType === ParseNodeType.Name || reference.nodeType === ParseNodeType.MemberAccess) {
                        // Are we targeting the same symbol? We need to do this extra check because the same
                        // symbol name might refer to different symbols in different scopes (e.g. a list
                        // comprehension introduces a new scope).
                        if (targetSymbolId === assignmentFlowNode.targetSymbolId) {
                            if (ParseTreeUtils.isMatchingExpression(reference, assignmentFlowNode.node)) {
                                // Is this a special "unbind" assignment? If so,
                                // we can handle it immediately without any further evaluation.
                                if (curFlowNode.flags & FlowFlags.Unbind) {
                                    return setCacheEntry(curFlowNode, UnboundType.create());
                                }

                                return evaluateAssignmentFlowNode(assignmentFlowNode);
                            }
                        }
                    }

                    curFlowNode = assignmentFlowNode.antecedent;
                    continue;
                }

                if (curFlowNode.flags & FlowFlags.AssignmentAlias) {
                    const aliasFlowNode = curFlowNode as FlowAssignmentAlias;

                    // If the target symbol ID matches, replace with its alias
                    // and continue to traverse the code flow graph.
                    if (targetSymbolId === aliasFlowNode.targetSymbolId) {
                        targetSymbolId = aliasFlowNode.aliasSymbolId;
                    }
                    curFlowNode = aliasFlowNode.antecedent;
                    continue;
                }

                if (curFlowNode.flags & (FlowFlags.BranchLabel | FlowFlags.LoopLabel)) {
                    const labelNode = curFlowNode as FlowLabel;
                    const typesToCombine: Type[] = [];
                    preventFlowNodeRecursion(curFlowNode.id, () => {
                        labelNode.antecedents.map(antecedent => {
                            const flowType = getTypeFromFlowNode(antecedent, reference,
                                targetSymbolId, initialType);
                            if (flowType) {
                                typesToCombine.push(flowType);
                            }
                        });
                    });
                    if (typesToCombine.length === 0) {
                        return setCacheEntry(curFlowNode, undefined);
                    }
                    return setCacheEntry(curFlowNode, combineTypes(typesToCombine));
                }

                if (curFlowNode.flags & FlowFlags.WildcardImport) {
                    const wildcardImportFlowNode = curFlowNode as FlowWildcardImport;
                    if (reference.nodeType === ParseNodeType.Name) {
                        const nameValue = reference.nameToken.value;
                        if (wildcardImportFlowNode.names.some(name => name === nameValue)) {
                            const type = getTypeFromWildcardImport(wildcardImportFlowNode, nameValue);
                            return setCacheEntry(curFlowNode, type);
                        }
                    }

                    curFlowNode = wildcardImportFlowNode.antecedent;
                    continue;
                }

                if (curFlowNode.flags & (FlowFlags.TrueCondition | FlowFlags.FalseCondition)) {
                    const conditionalFlowNode = curFlowNode as FlowCondition;
                    const typeNarrowingCallback = getTypeNarrowingCallback(reference, conditionalFlowNode);
                    if (typeNarrowingCallback) {
                        let flowType: FlowNodeType | undefined;
                        preventFlowNodeRecursion(curFlowNode.id, () => {
                            flowType = getTypeFromFlowNode(conditionalFlowNode.antecedent,
                                reference, targetSymbolId, initialType);
                        });
                        return setCacheEntry(curFlowNode, flowType ? typeNarrowingCallback(flowType) : undefined);
                    }

                    curFlowNode = conditionalFlowNode.antecedent;
                    continue;
                }

                if (curFlowNode.flags & FlowFlags.Call) {
                    const callFlowNode = curFlowNode as FlowCall;

                    // If this function returns a "NoReturn" type, that means
                    // it always raises an exception or otherwise doesn't return,
                    // so we can assume that the code before this is unreachable.
                    const returnType = AnalyzerNodeInfo.getExpressionType(callFlowNode.node);
                    if (returnType && isNoReturnType(returnType)) {
                        return setCacheEntry(curFlowNode, undefined);
                    }

                    curFlowNode = callFlowNode.antecedent;
                    continue;
                }

                if (curFlowNode.flags & FlowFlags.PreFinallyGate) {
                    const preFinallyFlowNode = curFlowNode as FlowPreFinallyGate;
                    if (preFinallyFlowNode.isGateClosed) {
                        return undefined;
                    }
                    curFlowNode = preFinallyFlowNode.antecedent;
                    continue;
                }

                if (curFlowNode.flags & FlowFlags.PostFinally) {
                    const postFinallyFlowNode = curFlowNode as FlowPostFinally;
                    const wasGateClosed = postFinallyFlowNode.preFinallyGate.isGateClosed;
                    postFinallyFlowNode.preFinallyGate.isGateClosed = true;
                    const flowType = getTypeFromFlowNode(postFinallyFlowNode.antecedent,
                        reference, targetSymbolId, initialType);
                    postFinallyFlowNode.preFinallyGate.isGateClosed = wasGateClosed;
                    return flowType;
                }

                // We shouldn't get here.
                assert.fail('Unexpected flow node flags');
                return setCacheEntry(curFlowNode, undefined);
            }
        }

        return getTypeFromFlowNode(flowNode!, reference, targetSymbolId, initialType);
    }

    function getTypeFromWildcardImport(flowNode: FlowWildcardImport, name: string): Type {
        const importInfo = AnalyzerNodeInfo.getImportInfo(flowNode.node.module);
        assert(importInfo && importInfo.isImportFound);
        assert(flowNode.node.isWildcardImport);

        const symbolWithScope = lookUpSymbolRecursive(flowNode.node, name);
        assert(symbolWithScope);
        const decls = symbolWithScope!.symbol.getDeclarations();
        const wildcardDecl = decls.find(decl => decl.node === flowNode.node);
        assert(wildcardDecl);
        return getInferredTypeOfDeclaration(wildcardDecl!, importLookup) || UnknownType.create();
    }

    function isFlowNodeReachable(flowNode: FlowNode): boolean {
        const visitedFlowNodeMap = new Map<number, true>();

        function isFlowNodeReachableRecursive(flowNode: FlowNode): boolean {
            let curFlowNode = flowNode;

            while (true) {
                // If we've already visited this node, we can assume
                // it wasn't reachable.
                if (visitedFlowNodeMap.has(curFlowNode.id)) {
                    return false;
                }

                // Note that we've been here before.
                visitedFlowNodeMap.set(curFlowNode.id, true);

                if (curFlowNode.flags & FlowFlags.Unreachable) {
                    return false;
                }

                if (curFlowNode.flags & FlowFlags.Start) {
                    return true;
                }

                if (curFlowNode.flags & FlowFlags.Assignment) {
                    const assignmentFlowNode = curFlowNode as FlowAssignment;
                    curFlowNode = assignmentFlowNode.antecedent;
                    continue;
                }

                if (curFlowNode.flags & FlowFlags.AssignmentAlias) {
                    const aliasFlowNode = curFlowNode as FlowAssignmentAlias;
                    curFlowNode = aliasFlowNode.antecedent;
                    continue;
                }

                if (curFlowNode.flags & (FlowFlags.BranchLabel | FlowFlags.LoopLabel)) {
                    const labelNode = curFlowNode as FlowLabel;
                    for (const antecedent of labelNode.antecedents) {
                        if (isFlowNodeReachableRecursive(antecedent)) {
                            return true;
                        }
                    }
                    return false;
                }

                if (curFlowNode.flags & FlowFlags.WildcardImport) {
                    const wildcardImportFlowNode = curFlowNode as FlowWildcardImport;
                    curFlowNode = wildcardImportFlowNode.antecedent;
                    continue;
                }

                if (curFlowNode.flags & (FlowFlags.TrueCondition | FlowFlags.FalseCondition)) {
                    const conditionalFlowNode = curFlowNode as FlowCondition;
                    curFlowNode = conditionalFlowNode.antecedent;
                    continue;
                }

                if (curFlowNode.flags & FlowFlags.Call) {
                    const callFlowNode = curFlowNode as FlowCall;

                    // If this function returns a "NoReturn" type, that means
                    // it always raises an exception or otherwise doesn't return,
                    // so we can assume that the code before this is unreachable.
                    const returnType = AnalyzerNodeInfo.getExpressionType(callFlowNode.node);
                    if (returnType && isNoReturnType(returnType)) {
                        return false;
                    }

                    curFlowNode = callFlowNode.antecedent;
                    continue;
                }

                if (curFlowNode.flags & FlowFlags.PreFinallyGate) {
                    const preFinallyFlowNode = curFlowNode as FlowPreFinallyGate;
                    if (preFinallyFlowNode.isGateClosed) {
                        return false;
                    }
                    curFlowNode = preFinallyFlowNode.antecedent;
                    continue;
                }

                if (curFlowNode.flags & FlowFlags.PostFinally) {
                    const postFinallyFlowNode = curFlowNode as FlowPostFinally;
                    const wasGateClosed = postFinallyFlowNode.preFinallyGate.isGateClosed;
                    postFinallyFlowNode.preFinallyGate.isGateClosed = true;
                    const isReachable = isFlowNodeReachableRecursive(postFinallyFlowNode.antecedent);
                    postFinallyFlowNode.preFinallyGate.isGateClosed = wasGateClosed;
                    return isReachable;
                }

                // We shouldn't get here.
                assert.fail('Unexpected flow node flags');
                return false;
            }
        }

        return isFlowNodeReachableRecursive(flowNode);
    }

    // Given a reference expression and a flow node, returns a callback that
    // can be used to narrow the type described by the target expression.
    // If the specified flow node is not associated with the target expression,
    // it returns undefined.
    function getTypeNarrowingCallback(reference: ExpressionNode, flowNode: FlowCondition): TypeNarrowingCallback | undefined {
        const testExpression = flowNode.expression;
        const isPositiveTest = !!(flowNode.flags & FlowFlags.TrueCondition);

        if (testExpression.nodeType === ParseNodeType.BinaryOperation) {
            if (testExpression.operator === OperatorType.Is || testExpression.operator === OperatorType.IsNot) {
                // Invert the "isPositiveTest" value if this is an "is not" operation.
                const adjIsPositiveTest = testExpression.operator === OperatorType.Is ?
                    isPositiveTest : !isPositiveTest;

                // Look for "X is None" or "X is not None". These are commonly-used
                // patterns used in control flow.
                if (testExpression.rightExpression.nodeType === ParseNodeType.Constant &&
                        testExpression.rightExpression.token.keywordType === KeywordType.None) {

                    if (ParseTreeUtils.isMatchingExpression(reference, testExpression.leftExpression)) {
                        // Narrow the type by filtering on "None".
                        return (type: Type) => {
                            if (type.category === TypeCategory.Union) {
                                const remainingTypes = type.subtypes.filter(t => {
                                    if (isAnyOrUnknown(t)) {
                                        // We need to assume that "Any" is always both None and not None,
                                        // so it matches regardless of whether the test is positive or negative.
                                        return true;
                                    }

                                    // See if it's a match for None.
                                    return isNoneOrNever(t) === adjIsPositiveTest;
                                });

                                return combineTypes(remainingTypes);
                            } else if (isNoneOrNever(type)) {
                                if (!adjIsPositiveTest) {
                                    // Use a "Never" type (which is a special form
                                    // of None) to indicate that the condition will
                                    // always evaluate to false.
                                    return NeverType.create();
                                }
                            }

                            return type;
                        };
                    }
                }

                // Look for "type(X) is Y" or "type(X) is not Y".
                if (testExpression.leftExpression.nodeType === ParseNodeType.Call) {
                    const callType = getTypeFromExpression(testExpression.leftExpression.leftExpression).type;
                    if (callType.category === TypeCategory.Class &&
                            ClassType.isBuiltIn(callType, 'type') &&
                            testExpression.leftExpression.arguments.length === 1 &&
                            testExpression.leftExpression.arguments[0].argumentCategory === ArgumentCategory.Simple) {

                        const arg0Expr = testExpression.leftExpression.arguments[0].valueExpression;
                        if (ParseTreeUtils.isMatchingExpression(reference, arg0Expr)) {
                            const classType = getTypeFromExpression(testExpression.rightExpression).type;
                            if (classType.category === TypeCategory.Class) {
                                return (type: Type) => {
                                    // Narrow the type based on whether the type matches the specified type.
                                    return doForSubtypes(type, subtype => {
                                        if (subtype.category === TypeCategory.Object) {
                                            const matches = ClassType.isSameGenericClass(subtype.classType, classType);
                                            if (adjIsPositiveTest) {
                                                return matches ? subtype : undefined;
                                            } else {
                                                return matches ? undefined : subtype;
                                            }
                                        } else if (isNoneOrNever(subtype)) {
                                            return adjIsPositiveTest ? undefined : subtype;
                                        }

                                        return subtype;
                                    });
                                };
                            }
                        }
                    }
                }
            }
        }

        if (testExpression.nodeType === ParseNodeType.Call) {
            // Look for "isinstance(X, Y)" or "issubclass(X, Y)".
            if (testExpression.leftExpression.nodeType === ParseNodeType.Name &&
                    (testExpression.leftExpression.nameToken.value === 'isinstance' ||
                        testExpression.leftExpression.nameToken.value === 'issubclass') &&
                    testExpression.arguments.length === 2) {

                // Make sure the first parameter is a supported expression type
                // and the second parameter is a valid class type or a tuple
                // of valid class types.
                const isInstanceCheck = testExpression.leftExpression.nameToken.value === 'isinstance';
                const arg0Expr = testExpression.arguments[0].valueExpression;
                const arg1Expr = testExpression.arguments[1].valueExpression;
                if (ParseTreeUtils.isMatchingExpression(reference, arg0Expr)) {
                    const arg1Type = getTypeFromExpression(arg1Expr).type;
                    const classTypeList = getIsInstanceClassTypes(arg1Type);
                    if (classTypeList) {
                        return (type: Type) => {
                            return narrowTypeForIsInstance(type, classTypeList, isInstanceCheck, isPositiveTest);
                        };
                    }
                }
            }
        }

        if (ParseTreeUtils.isMatchingExpression(reference, testExpression)) {
            return (type: Type) => {
                // Narrow the type based on whether the subtype can be true or false.
                return doForSubtypes(type, subtype => {
                    if (isPositiveTest) {
                        if (canBeTruthy(subtype)) {
                            return subtype;
                        }
                    } else {
                        if (canBeFalsy(subtype, importLookup)) {
                            return subtype;
                        }
                    }
                    return undefined;
                });
            };
        }

        return undefined;
    }

    // The "isinstance" and "issubclass" calls support two forms - a simple form
    // that accepts a single class, and a more complex form that accepts a tuple
    // of classes. This method determines which form and returns a list of classes
    // or undefined.
    function getIsInstanceClassTypes(argType: Type): ClassType[] | undefined {
        if (argType.category === TypeCategory.Class) {
            return [argType];
        }

        if (argType.category === TypeCategory.Object) {
            const objClass = argType.classType;
            if (ClassType.isBuiltIn(objClass, 'Tuple') && ClassType.getTypeArguments(objClass)) {
                let foundNonClassType = false;
                const classTypeList: ClassType[] = [];
                ClassType.getTypeArguments(objClass)!.forEach(typeArg => {
                    if (typeArg.category === TypeCategory.Class) {
                        classTypeList.push(typeArg);
                    } else {
                        foundNonClassType = true;
                    }
                });

                if (!foundNonClassType) {
                    return classTypeList;
                }
            }
        }

        return undefined;
    }

    // Attempts to narrow a type (make it more constrained) based on a
    // call to isinstance or issubclass. For example, if the original
    // type of expression "x" is "Mammal" and the test expression is
    // "isinstance(x, Cow)", (assuming "Cow" is a subclass of "Mammal"),
    // we can conclude that x must be constrained to "Cow".
    function narrowTypeForIsInstance(type: Type, classTypeList: ClassType[],
            isInstanceCheck: boolean, isPositiveTest: boolean): Type {

        const effectiveType = doForSubtypes(type, subtype => {
            return transformTypeObjectToClass(subtype);
        });

        // Filters the varType by the parameters of the isinstance
        // and returns the list of types the varType could be after
        // applying the filter.
        const filterType = (varType: ClassType): (ObjectType[] | ClassType[]) => {
            const filteredTypes: ClassType[] = [];

            let foundSuperclass = false;
            for (const filterType of classTypeList) {
                const filterIsSuperclass = ClassType.isDerivedFrom(varType, filterType);
                const filterIsSubclass = ClassType.isDerivedFrom(filterType, varType);

                if (filterIsSuperclass) {
                    foundSuperclass = true;
                }

                if (isPositiveTest) {
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
            }

            // In the negative case, if one or more of the filters
            // always match the type (i.e. they are an exact match or
            // a superclass of the type), then there's nothing left after
            // the filter is applied. If we didn't find any superclass
            // match, then the original variable type survives the filter.
            if (!isPositiveTest && !foundSuperclass) {
                filteredTypes.push(varType);
            }

            if (!isInstanceCheck) {
                return filteredTypes;
            }

            return filteredTypes.map(t => ObjectType.create(t));
        };

        const finalizeFilteredTypeList = (types: Type[]): Type => {
            return combineTypes(types);
        };

        if (isInstanceCheck && effectiveType.category === TypeCategory.Object) {
            const filteredType = filterType(effectiveType.classType);
            return finalizeFilteredTypeList(filteredType);
        } else if (!isInstanceCheck && effectiveType.category === TypeCategory.Class) {
            const filteredType = filterType(effectiveType);
            return finalizeFilteredTypeList(filteredType);
        } else if (effectiveType.category === TypeCategory.Union) {
            let remainingTypes: Type[] = [];

            effectiveType.subtypes.forEach(t => {
                if (isAnyOrUnknown(t)) {
                    // Any types always remain for both positive and negative
                    // checks because we can't say anything about them.
                    remainingTypes.push(t);
                } else if (isInstanceCheck && t.category === TypeCategory.Object) {
                    remainingTypes = remainingTypes.concat(filterType(t.classType));
                } else if (!isInstanceCheck && t.category === TypeCategory.Class) {
                    remainingTypes = remainingTypes.concat(filterType(t));
                } else {
                    // All other types are never instances of a class.
                    if (!isPositiveTest) {
                        remainingTypes.push(t);
                    }
                }
            });

            return finalizeFilteredTypeList(remainingTypes);
        }

        // Return the original type.
        return type;
    }

    // Specializes the specified (potentially generic) class type using
    // the specified type arguments, reporting errors as appropriate.
    // Returns the specialized type and a boolean indicating whether
    // the type indicates a class type (true) or an object type (false).
    function createSpecializedClassType(classType: ClassType, typeArgs: TypeResult[] | undefined,
            errorNode: ParseNode): Type {

        // Handle the special-case classes that are not defined
        // in the type stubs.
        if (ClassType.isSpecialBuiltIn(classType)) {
            switch (classType.details.name) {
                case 'Callable': {
                    return createCallableType(typeArgs);
                }

                case 'Optional': {
                    return createOptionalType(errorNode, typeArgs);
                }

                case 'Type': {
                    return createSpecialType(classType, typeArgs, 1);
                }

                case 'ClassVar': {
                    return createClassVarType(errorNode, typeArgs);
                }

                case 'Deque':
                case 'List':
                case 'FrozenSet':
                case 'Set': {
                    return createSpecialType(classType, typeArgs, 1);
                }

                case 'ChainMap':
                case 'Dict':
                case 'DefaultDict': {
                    return createSpecialType(classType, typeArgs, 2);
                }

                case 'Protocol': {
                    return createSpecialType(classType, typeArgs, undefined);
                }

                case 'Tuple': {
                    return createSpecialType(classType, typeArgs, undefined, true);
                }

                case 'Union': {
                    return createUnionType(typeArgs);
                }

                case 'Generic':
                    return createGenericType(errorNode, classType, typeArgs);
            }
        }

        let typeArgCount = typeArgs ? typeArgs.length : 0;

        // Make sure the argument list count is correct.
        const typeParameters = ClassType.getTypeParameters(classType);

        // If there are no type parameters or args, the class is already specialized.
        // No need to do any more work.
        if (typeParameters.length === 0 && typeArgCount === 0) {
            return classType;
        }

        if (typeArgs && typeArgCount > typeParameters.length) {
            if (typeParameters.length === 0) {
                addError(`Expected no type arguments`,
                    typeArgs[typeParameters.length].node);
            } else {
                addError(
                    `Expected at most ${ typeParameters.length } ` +
                        `type ${ typeParameters.length === 1 ? 'argument' : 'arguments' } `,
                    typeArgs[typeParameters.length].node);
            }
            typeArgCount = typeParameters.length;
        }

        if (typeArgs) {
            typeArgs.forEach(typeArg => {
                // Verify that we didn't receive any inappropriate ellipses or modules.
                if (isEllipsisType(typeArg.type)) {
                    addError(`'...' not allowed in this context`, typeArg.node);
                } else if (typeArg.type.category === TypeCategory.Module) {
                    addError(`Module not allowed in this context`, typeArg.node);
                }
            });
        }

        // Fill in any missing type arguments with Any.
        const typeArgTypes = typeArgs ? typeArgs.map(
            t => convertClassToObject(t.type)) : [];
        const typeParams = ClassType.getTypeParameters(classType);
        for (let i = typeArgTypes.length; i < typeParams.length; i++) {
            typeArgTypes.push(specializeTypeVarType(typeParams[i]));
        }

        typeArgTypes.forEach((typeArgType, index) => {
            if (index < typeArgCount) {
                const diag = new DiagnosticAddendum();
                if (!canAssignToTypeVar(typeParameters[index], typeArgType, diag, importLookup)) {
                    addError(`Type '${ printType(typeArgType) }' ` +
                            `cannot be assigned to type variable '${ typeParameters[index].name }'` +
                            diag.getString(),
                        typeArgs![index].node);
                }
            }
        });

        const specializedClass = ClassType.cloneForSpecialization(classType, typeArgTypes);

        return specializedClass;
    }

    function getTypeForArgument(arg: FunctionArgument): Type {
        if (arg.type) {
            return arg.type;
        }

        // If there was no defined type provided, there should always
        // be a value expression from which we can retrieve the type.
        return getTypeFromExpression(arg.valueExpression!, { method: 'get' }).type;
    }

    function getBuiltInType(node: ParseNode, name: string): Type {
        const scope = ScopeUtils.getScopeForNode(node);
        return ScopeUtils.getBuiltInType(scope, name, importLookup);
    }

    function getBuiltInObject(node: ParseNode, name: string, typeArguments?: Type[]) {
        const scope = ScopeUtils.getScopeForNode(node);
        return ScopeUtils.getBuiltInObject(scope, name, importLookup, typeArguments);
    }

    function lookUpSymbolRecursive(node: ParseNode, name: string) {
        const scope = ScopeUtils.getScopeForNode(node);
        return scope.lookUpSymbolRecursive(name);
    }

    // Disables recording of errors and warnings and disables
    // any caching of types, under the assumption that we're
    // performing speculative evaluations.
    function useSpeculativeMode(callback: () => void) {
        const prevSpeculativeMode = isSpeculativeMode;
        isSpeculativeMode = true;

        callback();

        isSpeculativeMode = prevSpeculativeMode;
    }

    function getFileInfo(node: ParseNode) {
        const moduleNode = ParseTreeUtils.getEnclosingModule(node);
        return AnalyzerNodeInfo.getFileInfo(moduleNode)!;
    }

    return {
        getType,
        getTypeOfAnnotation,
        getTypeFromObjectMember,
        getTypeFromAwaitable,
        getTypeFromIterable,
        getTypeFromDecorator,
        getTypeOfAssignmentStatementTarget,
        getTypeOfAugmentedAssignmentTarget,
        getTypeOfClass,
        getTypeOfFunction,
        getTypingType,
        getDeclaredTypeForExpression,
        isAnnotationLiteralValue,
        isAfterNodeReachable,
        isNodeReachable,
        transformTypeForPossibleEnumClass,
        assignTypeToNameNode,
        assignTypeToExpression,
        updateExpressionTypeForNode,
        addError,
        addWarning,
        addDiagnostic
    };
}
