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
import { Diagnostic, DiagnosticAddendum } from '../common/diagnostic';
import { DiagnosticRule } from '../common/diagnosticRules';
import { TextRangeDiagnosticSink } from '../common/diagnosticSink';
import { convertOffsetsToRange } from '../common/positionUtils';
import StringMap from '../common/stringMap';
import { TextRange } from '../common/textRange';
import { ArgumentCategory, AugmentedAssignmentExpressionNode, BinaryExpressionNode,
    CallExpressionNode, ClassNode, ConstantNode, DecoratorNode, DictionaryNode,
    ExpressionNode, IndexExpressionNode, IndexItemsNode, isExpressionNode, LambdaNode,
    ListComprehensionNode, ListNode, MemberAccessExpressionNode, NameNode, ParameterCategory,
    ParseNode, ParseNodeType, SetNode, SliceExpressionNode, StringListNode,
    TernaryExpressionNode, TupleExpressionNode, UnaryExpressionNode,
    YieldExpressionNode, YieldFromExpressionNode } from '../parser/parseNodes';
import { KeywordType, OperatorType, StringTokenFlags, TokenType } from '../parser/tokenizerTypes';
import { AnalyzerFileInfo } from './analyzerFileInfo';
import * as AnalyzerNodeInfo from './analyzerNodeInfo';
import { Declaration, DeclarationCategory } from './declaration';
import { defaultTypeSourceId } from './inferredType';
import * as ParseTreeUtils from './parseTreeUtils';
import { Scope } from './scope';
import * as ScopeUtils from './scopeUtils';
import { setSymbolPreservingAccess, Symbol, SymbolFlags } from './symbol';
import { ConditionalTypeConstraintResults, TypeConstraint,
    TypeConstraintBuilder } from './typeConstraint';
import { AnyType, ClassType, ClassTypeFlags, combineTypes, FunctionParameter,
    FunctionType, FunctionTypeFlags, isAnyOrUnknown, isNoneOrNever, isPossiblyUnbound,
    isTypeSame, isUnbound, LiteralValue, NeverType, NoneType, ObjectType, OverloadedFunctionType,
    printType, removeAnyFromUnion, removeNoneFromUnion, requiresSpecialization,
    Type, TypeCategory, TypeVarMap, TypeVarType, UnknownType } from './types';
import * as TypeUtils from './typeUtils';

interface TypeResult {
    type: Type;
    typeList?: TypeResult[];
    node: ExpressionNode;
}

interface FunctionArgument {
    valueExpression?: ExpressionNode;
    argumentCategory: ArgumentCategory;
    name?: NameNode;
    type: Type;
}

interface ClassMemberLookup {
    // Type of value.
    type: Type;

    // True if class member, false otherwise.
    isClassMember: boolean;
}

export const enum EvaluatorFlags {
    None = 0,

    // Interpret an ellipsis type annotation to mean "Any".
    ConvertEllipsisToAny = 1,

    // Normally a generic named type is specialized with "Any"
    // types. This flag indicates that specialization shouldn't take
    // place.
    DoNotSpecialize = 2,

    // Allow forward references. Don't report unbound errors.
    AllowForwardReferences = 4,

    // Don't cache the results.
    DoNotCache = 8
}

interface EvaluatorUsage {
    method: 'get' | 'set' | 'del';

    // Used only for set methods
    setType?: Type;
    setErrorNode?: ExpressionNode;

    // Used only for get methods
    expectedType?: Type;
}

export const enum MemberAccessFlags {
    None = 0,

    // By default, both class and instance members are considered.
    // Set this flag to skip the instance members.
    SkipInstanceMembers = 1,

    // By default, members of base classes are also searched.
    // Set this flag to consider only the specified class' members.
    SkipBaseClasses = 2,

    // Do not include the "object" base class in the search.
    SkipObjectBaseClass = 4,

    // By default, if the class has a __getattribute__ or __getattr__
    // magic method, it is assumed to have any member.
    SkipGetAttributeCheck = 8,

    // By default, if the class has a __get__ magic method, this is
    // followed to determine the final type. Properties use this
    // technique.
    SkipGetCheck = 16,

    // This set of flags is appropriate for looking up methods.
    SkipForMethodLookup = SkipInstanceMembers | SkipGetAttributeCheck | SkipGetCheck
}

interface ParamAssignmentInfo {
    argsNeeded: number;
    argsReceived: number;
}

export type ReadTypeFromNodeCacheCallback = (node: ExpressionNode) => Type | undefined;
export type WriteTypeToNodeCacheCallback = (node: ExpressionNode, type: Type) => void;
export type SetSymbolAccessedCallback = (symbol: Symbol) => void;

const arithmeticOperatorMap: { [operator: number]: [string, string, boolean] } = {
    [OperatorType.Add]: ['__add__', '__radd__', true],
    [OperatorType.Subtract]: ['__sub__', '__rsub__', true],
    [OperatorType.Multiply]: ['__mul__', '__rmul__', true],
    [OperatorType.FloorDivide]: ['__floordiv__', '__rfloordiv__', true],
    [OperatorType.Divide]: ['__truediv__', '__rtruediv__', true],
    [OperatorType.Mod]: ['__mod__', '__rmod__', true],
    [OperatorType.Power]: ['__pow__', '__rpow__', true],
    [OperatorType.MatrixMultiply]: ['__matmul__', '', false]
};

const bitwiseOperatorMap: { [operator: number]: [string, string] } = {
    [OperatorType.BitwiseAnd]: ['__and__', '__rand__'],
    [OperatorType.BitwiseOr]: ['__or__', '__ror__'],
    [OperatorType.BitwiseXor]: ['__xor__', '__rxor__'],
    [OperatorType.LeftShift]: ['__lshift__', '__rlshift__'],
    [OperatorType.RightShift]: ['__rshift__', '__rrshift__']
};

const comparisonOperatorMap: { [operator: number]: string } = {
    [OperatorType.Equals]: '__eq__',
    [OperatorType.NotEquals]: '__ne__',
    [OperatorType.LessThan]: '__lt__',
    [OperatorType.LessThanOrEqual]: '__le__',
    [OperatorType.GreaterThan]: '__gt__',
    [OperatorType.GreaterThanOrEqual]: '__ge__'
};

const booleanOperatorMap: { [operator: number]: boolean } = {
    [OperatorType.And]: true,
    [OperatorType.Or]: true,
    [OperatorType.Is]: true,
    [OperatorType.IsNot]: true,
    [OperatorType.In]: true,
    [OperatorType.NotIn]: true
};

export class ExpressionEvaluator {
    private _scope: Scope;
    private readonly _fileInfo: AnalyzerFileInfo;
    private _expressionTypeConstraints: TypeConstraint[] = [];
    private _diagnosticSink?: TextRangeDiagnosticSink;
    private _readTypeFromCache?: ReadTypeFromNodeCacheCallback;
    private _writeTypeToCache?: WriteTypeToNodeCacheCallback;
    private _setSymbolAccessed?: SetSymbolAccessedCallback;
    private _isUnboundCheckSuppressed = false;

    constructor(scope: Scope, fileInfo: AnalyzerFileInfo,
            diagnosticSink?: TextRangeDiagnosticSink,
            readTypeCallback?: ReadTypeFromNodeCacheCallback,
            writeTypeCallback?: WriteTypeToNodeCacheCallback,
            setSymbolAccessedCallback?: SetSymbolAccessedCallback) {
        this._scope = scope;
        this._fileInfo = fileInfo;
        this._diagnosticSink = diagnosticSink;
        this._readTypeFromCache = readTypeCallback;
        this._writeTypeToCache = writeTypeCallback;
        this._setSymbolAccessed = setSymbolAccessedCallback;
    }

    getType(node: ExpressionNode, usage: EvaluatorUsage = { method: 'get' }, flags = EvaluatorFlags.None): Type {
        let type: Type = UnknownType.create();

        if (flags & EvaluatorFlags.AllowForwardReferences) {
            this._suppressUnboundChecks(() => {
                type = this._getTypeFromExpression(node, usage, flags).type;
            });
        } else {
            type = this._getTypeFromExpression(node, usage, flags).type;
        }

        return type;
    }

    getTypeFromDecorator(node: DecoratorNode, functionOrClassType: Type): Type {
        const baseTypeResult = this._getTypeFromExpression(
            node.leftExpression, { method: 'get' }, EvaluatorFlags.DoNotSpecialize);

        let decoratorCall = baseTypeResult;

        // If the decorator has arguments, evaluate that call first.
        if (node.arguments) {
            const argList = node.arguments.map(arg => {
                return {
                    valueExpression: arg.valueExpression,
                    argumentCategory: arg.argumentCategory,
                    name: arg.name,
                    type: this.getType(arg.valueExpression)
                };
            });

            // Evaluate the decorator, but don't specialize the
            // return result.
            decoratorCall = this._getTypeFromCallExpressionWithBaseType(
                node.leftExpression, argList, decoratorCall,
                EvaluatorFlags.None, undefined, false);
        }

        const argList = [{
            argumentCategory: ArgumentCategory.Simple,
            type: functionOrClassType
        }];

        return this._getTypeFromCallExpressionWithBaseType(
            node.leftExpression, argList, decoratorCall, EvaluatorFlags.None,
                undefined, false).type;
    }

    // Gets a member type from an object and if it's a function binds
    // it to the object.
    getTypeFromObjectMember(errorNode: ExpressionNode, objectType: ObjectType, memberName: string,
            usage: EvaluatorUsage, memberAccessFlags = MemberAccessFlags.None): Type | undefined {

        const memberInfo = this._getTypeFromClassMemberName(errorNode,
            objectType.classType, memberName, usage, memberAccessFlags);

        let resultType = memberInfo ? memberInfo.type : undefined;
        if (resultType) {
            if (resultType.category === TypeCategory.Function || resultType.category === TypeCategory.OverloadedFunction) {
                if (memberInfo!.isClassMember) {
                    resultType = TypeUtils.bindFunctionToClassOrObject(objectType, resultType);
                }
            }
        }

        return resultType;
    }

    // Gets a member type from a class and if it's a function binds
    // it to the object.
    getTypeFromClassMember(errorNode: ExpressionNode, classType: ClassType, memberName: string,
            usage: EvaluatorUsage, memberAccessFlags = MemberAccessFlags.None): Type | undefined {

        const memberInfo = this._getTypeFromClassMemberName(errorNode,
            classType, memberName, usage, memberAccessFlags | MemberAccessFlags.SkipInstanceMembers);

        let resultType = memberInfo ? memberInfo.type : undefined;
        if (resultType) {
            if (resultType.category === TypeCategory.Function || resultType.category === TypeCategory.OverloadedFunction) {
                if (memberInfo!.isClassMember) {
                    resultType = TypeUtils.bindFunctionToClassOrObject(classType, resultType);
                }
            }
        }

        return resultType;
    }

    // Applies an "await" operation to the specified type and returns
    // the result. According to PEP 492, await operates on:
    // 1) a generator object
    // 2) an Awaitable (object that provides an __await__ that
    //    returns a generator object)
    // If errorNode is undefined, no errors are reported.
    getTypeFromAwaitable(type: Type, errorNode?: ParseNode): Type {
        return TypeUtils.doForSubtypes(type, subtype => {
            if (isAnyOrUnknown(subtype)) {
                return subtype;
            }

            const generatorReturnType = this._getReturnTypeFromGenerator(subtype);
            if (generatorReturnType) {
                return generatorReturnType;
            }

            if (subtype.category === TypeCategory.Object) {
                const awaitReturnType = this._getSpecializedReturnType(
                    subtype, '__await__');
                if (awaitReturnType) {
                    if (isAnyOrUnknown(awaitReturnType)) {
                        return awaitReturnType;
                    }

                    if (awaitReturnType.category === TypeCategory.Object) {
                        const iterReturnType = this._getSpecializedReturnType(
                            awaitReturnType, '__iter__');

                        if (iterReturnType) {
                            const generatorReturnType = this._getReturnTypeFromGenerator(
                                awaitReturnType);
                            if (generatorReturnType) {
                                return generatorReturnType;
                            }
                        }
                    }
                }
            }

            if (errorNode) {
                this._addError(`'${ printType(subtype) }' is not awaitable`, errorNode);
            }

            return UnknownType.create();
        });
    }

    // Validates that the type is iterable and returns the iterated type.
    // If errorNode is undefined, no errors are reported.
    getTypeFromIterable(type: Type, isAsync: boolean, errorNode: ParseNode | undefined,
            supportGetItem: boolean): Type {

        const iterMethodName = isAsync ? '__aiter__' : '__iter__';
        const nextMethodName = isAsync ? '__anext__' : '__next__';
        const getItemMethodName = supportGetItem ? '__getitem__' : '';

        if (type.category === TypeCategory.Union && type.subtypes.some(t => isNoneOrNever(t))) {
            if (errorNode) {
                this._addDiagnostic(
                    this._fileInfo.diagnosticSettings.reportOptionalIterable,
                    DiagnosticRule.reportOptionalIterable,
                    `Object of type 'None' cannot be used as iterable value`,
                    errorNode);
            }
            type = removeNoneFromUnion(type);
        }

        const getIteratorReturnType = (objType: ObjectType, metaclass: ClassType | undefined,
                diag: DiagnosticAddendum): Type | undefined => {

            const iterReturnType = metaclass ?
                this._getSpecializedReturnTypeForMetaclassMethod(metaclass,
                    objType.classType, iterMethodName) :
                this._getSpecializedReturnType(objType, iterMethodName);
            if (!iterReturnType) {
                // There was no __iter__. See if we can fall back to
                // the __getitem__ method instead.
                if (getItemMethodName) {
                    const getItemReturnType = this._getSpecializedReturnType(
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
                    const nextReturnType = this._getSpecializedReturnType(
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
                        return this.getTypeFromAwaitable(nextReturnType, errorNode);
                    }
                } else {
                    diag.addMessage(`'${ iterMethodName }' method does not return an object`);
                }
            }

            return undefined;
        };

        return TypeUtils.doForSubtypes(type, subtype => {
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
                const metaclassType = TypeUtils.getMetaclass(subtype);
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
                this._addError(`'${ printType(subtype) }' is not iterable` + diag.getString(),
                    errorNode);
            }

            return UnknownType.create();
        });
    }

    // Validates fields for compatibility with a dataclass and synthesizes
    // an appropriate __new__ and __init__ methods.
    synthesizeDataClassMethods(node: ClassNode, classType: ClassType,
            skipSynthesizeInit: boolean) {

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
        TypeUtils.addDefaultFunctionParameters(newType);

        FunctionType.setDeclaredReturnType(newType, ObjectType.create(classType));

        FunctionType.addParameter(initType, {
            category: ParameterCategory.Simple,
            name: 'self',
            type: ObjectType.create(classType)
        });

        // Maintain a list of all dataclass parameters (including
        // those from inherited classes) plus a list of only those
        // parameters added by this class.
        const localDataClassParameters: FunctionParameter[] = [];
        const fullDataClassParameters: FunctionParameter[] = [];
        this._addInheritedDataClassParametersRecursive(classType, fullDataClassParameters);

        node.suite.statements.forEach(statementList => {
            if (statementList.nodeType === ParseNodeType.StatementList) {
                statementList.statements.forEach(statement => {
                    let variableNameNode: NameNode | undefined;
                    let variableType: Type | undefined;
                    let hasDefaultValue = false;

                    if (statement.nodeType === ParseNodeType.Assignment) {
                        if (statement.leftExpression.nodeType === ParseNodeType.Name) {
                            variableNameNode = statement.leftExpression;
                            variableType = TypeUtils.stripLiteralValue(
                                this.getType(statement.rightExpression, { method: 'get' }));
                        } else if (statement.leftExpression.nodeType === ParseNodeType.TypeAnnotation &&
                                statement.leftExpression.valueExpression.nodeType === ParseNodeType.Name) {

                            variableNameNode = statement.leftExpression.valueExpression;
                            variableType = TypeUtils.convertClassToObject(
                                this.getType(statement.leftExpression.typeAnnotation, { method: 'get' },
                                    EvaluatorFlags.ConvertEllipsisToAny));
                        }

                        hasDefaultValue = true;
                    } else if (statement.nodeType === ParseNodeType.TypeAnnotation) {
                        if (statement.valueExpression.nodeType === ParseNodeType.Name) {
                            variableNameNode = statement.valueExpression;
                            variableType = TypeUtils.convertClassToObject(
                                this.getType(statement.typeAnnotation, { method: 'get' },
                                    EvaluatorFlags.ConvertEllipsisToAny));
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
                            this._addError(`Data fields without default value cannot appear after ` +
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

            setSymbolPreservingAccess(ClassType.getFields(classType),
                '__init__', Symbol.createWithType(
                    SymbolFlags.ClassMember, initType, defaultTypeSourceId));
            setSymbolPreservingAccess(ClassType.getFields(classType),
                '__new__', Symbol.createWithType(
                    SymbolFlags.ClassMember, newType, defaultTypeSourceId));
        }
    }

    getTypingType(symbolName: string): Type | undefined {
        const typingImportPath = this._fileInfo.typingModulePath;
        if (!typingImportPath) {
            return undefined;
        }

        const moduleType = this._fileInfo.importMap[typingImportPath];
        if (!(moduleType.category === TypeCategory.Module)) {
            return undefined;
        }

        const symbol = moduleType.fields.get(symbolName);
        if (!symbol) {
            return undefined;
        }

        return TypeUtils.getEffectiveTypeOfSymbol(symbol);
    }

    // Determines whether the specified string literal is part
    // of a Literal['xxx'] statement. If so, we will not treat
    // the string as a normal forward-declared type annotation.
    static isAnnotationLiteralValue(node: StringListNode): boolean {
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

    // Builds a sorted list of dataclass parameters that are inherited by
    // the specified class. These parameters must be unique and in reverse-MRO
    // order.
    private _addInheritedDataClassParametersRecursive(classType: ClassType, params: FunctionParameter[]) {
        // Recursively call for reverse-MRO ordering.
        ClassType.getBaseClasses(classType).forEach(baseClass => {
            if (baseClass.type.category === TypeCategory.Class) {
                this._addInheritedDataClassParametersRecursive(baseClass.type, params);
            }
        });

        ClassType.getBaseClasses(classType).forEach(baseClass => {
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

    private _getReturnTypeFromGenerator(type: Type): Type | undefined {
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

    private _getSpecializedReturnType(objType: ObjectType, memberName: string) {
        const classMember = TypeUtils.lookUpObjectMember(objType, memberName,
            TypeUtils.ClassMemberLookupFlags.SkipInstanceVariables);
        if (!classMember) {
            return undefined;
        }

        if (isAnyOrUnknown(classMember.symbolType)) {
            return classMember.symbolType;
        }

        if (classMember.symbolType.category === TypeCategory.Function) {
            const methodType = TypeUtils.bindFunctionToClassOrObject(objType,
                classMember.symbolType) as FunctionType;
            return FunctionType.getEffectiveReturnType(methodType);
        }

        return undefined;
    }

    // This is similar to _getSpecializedReturnType except that
    // the method lookup occurs on a metaclass rather than
    // the object that derives from it.
    private _getSpecializedReturnTypeForMetaclassMethod(
            metaclass: ClassType, classType: ClassType, memberName: string) {

        const classMember = TypeUtils.lookUpObjectMember(
            ObjectType.create(metaclass), memberName,
            TypeUtils.ClassMemberLookupFlags.SkipInstanceVariables);
        if (!classMember) {
            return undefined;
        }

        if (isAnyOrUnknown(classMember.symbolType)) {
            return classMember.symbolType;
        }

        if (classMember.symbolType.category === TypeCategory.Function) {
            const methodType = TypeUtils.bindFunctionToClassOrObject(
                classType, classMember.symbolType, true) as FunctionType;
            return FunctionType.getEffectiveReturnType(methodType);
        }

        return undefined;
    }

    private _getTypeFromExpression(node: ExpressionNode, usage: EvaluatorUsage = { method: 'get' },
            flags = EvaluatorFlags.None): TypeResult {

        // Is this type already cached?
        if (this._readTypeFromCache) {
            const cachedType = this._readTypeFromCache(node);
            if (cachedType) {
                return { type: cachedType, node };
            }
        }

        let typeResult: TypeResult | undefined;

        if (node.nodeType === ParseNodeType.Name) {
            typeResult = this._getTypeFromName(node, usage, flags);
        } else if (node.nodeType === ParseNodeType.MemberAccess) {
            typeResult = this._getTypeFromMemberAccessExpression(node, usage, flags);
        } else if (node.nodeType === ParseNodeType.Index) {
            typeResult = this._getTypeFromIndexExpression(node, usage);
        } else if (node.nodeType === ParseNodeType.Call) {
            this._reportUsageErrorForReadOnly(node, usage);
            typeResult = this._getTypeFromCallExpression(node, flags);
        } else if (node.nodeType === ParseNodeType.Tuple) {
            typeResult = this._getTypeFromTupleExpression(node, usage);
        } else if (node.nodeType === ParseNodeType.Constant) {
            this._reportUsageErrorForReadOnly(node, usage);
            typeResult = this._getTypeFromConstantExpression(node);
        } else if (node.nodeType === ParseNodeType.StringList) {
            this._reportUsageErrorForReadOnly(node, usage);
            if (node.typeAnnotation && !ExpressionEvaluator.isAnnotationLiteralValue(node)) {
                let typeResult: TypeResult = { node, type: UnknownType.create() };

                // Temporarily suppress checks for unbound variables, since forward
                // references are allowed within string-based annotations.
                this._suppressUnboundChecks(() => {
                    typeResult = this._getTypeFromExpression(node.typeAnnotation!, usage, flags);
                });

                return typeResult;
            }

            const isBytes = (node.strings[0].token.flags & StringTokenFlags.Bytes) !== 0;
            typeResult = { node, type: this._cloneBuiltinTypeWithLiteral(
                isBytes ? 'bytes' : 'str', node.strings.map(s => s.value).join('')) };
        } else if (node.nodeType === ParseNodeType.Number) {
            this._reportUsageErrorForReadOnly(node, usage);
            typeResult = { node, type: this._cloneBuiltinTypeWithLiteral(
                node.token.isInteger ? 'int' : 'float', node.token.value) };
        } else if (node.nodeType === ParseNodeType.Ellipsis) {
            this._reportUsageErrorForReadOnly(node, usage);
            if ((flags & EvaluatorFlags.ConvertEllipsisToAny) !== 0) {
                typeResult = { type: AnyType.create(true), node };
            } else {
                const ellipsisType = ScopeUtils.getBuiltInType(this._scope, 'ellipsis') ||
                    AnyType.create();
                typeResult = { type: ellipsisType, node };
            }
        } else if (node.nodeType === ParseNodeType.UnaryOperation) {
            this._reportUsageErrorForReadOnly(node, usage);
            typeResult = this._getTypeFromUnaryExpression(node);
        } else if (node.nodeType === ParseNodeType.BinaryOperation) {
            this._reportUsageErrorForReadOnly(node, usage);
            typeResult = this._getTypeFromBinaryExpression(node);
        } else if (node.nodeType === ParseNodeType.AugmentedAssignment) {
            this._reportUsageErrorForReadOnly(node, usage);
            typeResult = this._getTypeFromAugmentedExpression(node);
        } else if (node.nodeType === ParseNodeType.List) {
            typeResult = this._getTypeFromListExpression(node, usage);
        } else if (node.nodeType === ParseNodeType.Slice) {
            this._reportUsageErrorForReadOnly(node, usage);
            typeResult = this._getTypeFromSliceExpression(node);
        } else if (node.nodeType === ParseNodeType.Await) {
            typeResult = this._getTypeFromExpression(
                node.expression, { method: 'get' }, flags);
            typeResult = {
                type: this.getTypeFromAwaitable(typeResult.type, node.expression),
                node
            };
        } else if (node.nodeType === ParseNodeType.Ternary) {
            this._reportUsageErrorForReadOnly(node, usage);
            typeResult = this._getTypeFromTernaryExpression(node, flags, usage);
        } else if (node.nodeType === ParseNodeType.ListComprehension) {
            this._reportUsageErrorForReadOnly(node, usage);
            typeResult = this._getTypeFromListComprehensionExpression(node);
        } else if (node.nodeType === ParseNodeType.Dictionary) {
            this._reportUsageErrorForReadOnly(node, usage);
            typeResult = this._getTypeFromDictionaryExpression(node, usage);
        } else if (node.nodeType === ParseNodeType.Lambda) {
            this._reportUsageErrorForReadOnly(node, usage);
            typeResult = this._getTypeFromLambdaExpression(node);
        } else if (node.nodeType === ParseNodeType.Set) {
            this._reportUsageErrorForReadOnly(node, usage);
            typeResult = this._getTypeFromSetExpression(node, usage);
        } else if (node.nodeType === ParseNodeType.Assignment) {
            this._reportUsageErrorForReadOnly(node, usage);

            // Don't validate the type match for the assignment here. Simply
            // return the type result of the RHS.
            typeResult = this._getTypeFromExpression(node.rightExpression);
        } else if (node.nodeType === ParseNodeType.Yield) {
            this._reportUsageErrorForReadOnly(node, usage);
            typeResult = this._getTypeFromYieldExpression(node);
        } else if (node.nodeType === ParseNodeType.YieldFrom) {
            this._reportUsageErrorForReadOnly(node, usage);
            typeResult = this._getTypeFromYieldFromExpression(node);
        } else if (node.nodeType === ParseNodeType.Unpack) {
            const iterType = this._getTypeFromExpression(node.expression, usage).type;
            const type = this.getTypeFromIterable(iterType, false, node, false);
            typeResult = { type, node };
        } else if (node.nodeType === ParseNodeType.TypeAnnotation) {
            typeResult = this._getTypeFromExpression(node.typeAnnotation);
        } else if (node.nodeType === ParseNodeType.Error) {
            // Evaluate the child expression as best we can so the
            // type information is cached for the completion handler.
            this._silenceDiagnostics(() => {
                if (node.child) {
                    this._getTypeFromExpression(node.child);
                }
            });
            typeResult = { type: UnknownType.create(), node };
        }

        if (typeResult) {
            typeResult.type = this._applyTypeConstraint(node, typeResult.type);
        } else {
            // We shouldn't get here. If we do, report an error.
            this._addError(`Unhandled expression type '${ ParseTreeUtils.printExpression(node) }'`, node);
            typeResult = { type: UnknownType.create(), node };
        }

        if (this._writeTypeToCache && (flags & EvaluatorFlags.DoNotCache) === 0) {
            this._writeTypeToCache(node, typeResult.type);
        }

        return typeResult;
    }

    private _suppressUnboundChecks(callback: () => void) {
        const wasSuppressed = this._isUnboundCheckSuppressed;
        this._isUnboundCheckSuppressed = true;

        callback();

        this._isUnboundCheckSuppressed = wasSuppressed;
    }

    private _getTypeFromName(node: NameNode, usage: EvaluatorUsage,
            flags: EvaluatorFlags): TypeResult {

        const name = node.nameToken.value;
        let type: Type | undefined;

        // Look for the scope that contains the value definition and
        // see if it has a declared type.
        const symbolWithScope = this._scope.lookUpSymbolRecursive(name);

        if (symbolWithScope) {
            const symbol = symbolWithScope.symbol;
            type = TypeUtils.getEffectiveTypeOfSymbol(symbol);

            // Determine whether the name is unbound or possibly unbound. We
            // can skip this check in type stub files because they are not
            // "executed" and support forward references.
            if (!symbolWithScope.isBeyondExecutionScope &&
                    !this._isUnboundCheckSuppressed &&
                    !this._fileInfo.isStubFile && symbol.isInitiallyUnbound()) {

                // Apply type constraints to see if the unbound type is eliminated.
                const initialType = TypeUtils.getInitialTypeOfSymbol(symbol);
                const constrainedType = this._applyTypeConstraint(node, initialType);
                if (isUnbound(constrainedType)) {
                    this._addError(`'${ name }' is unbound`, node);
                } else if (isPossiblyUnbound(constrainedType)) {
                    this._addError(`'${ name }' is possibly unbound`, node);
                }
            }

            if (usage.method === 'get') {
                if (this._setSymbolAccessed) {
                    this._setSymbolAccessed(symbol);
                }
            }
        } else {
            // Handle the special case of "reveal_type".
            if (name !== 'reveal_type') {
                this._addError(`'${ name }' is not defined`, node);
            }
            type = UnknownType.create();
        }

        // Should we specialize the class?
        if ((flags & EvaluatorFlags.DoNotSpecialize) === 0) {
            if (type.category === TypeCategory.Class) {
                if (ClassType.getTypeArguments(type) === undefined) {
                    type = this._createSpecializedClassType(type, undefined, node);
                }
            } else if (type.category === TypeCategory.Object) {
                // If this is an object that contains a Type[X], transform it
                // into class X.
                const typeType = this._getClassFromPotentialTypeObject(type);
                if (typeType) {
                    type = typeType;
                }
            }
        }

        return { type, node };
    }

    private _getTypeFromMemberAccessExpression(node: MemberAccessExpressionNode,
            usage: EvaluatorUsage, flags: EvaluatorFlags): TypeResult {

        const baseTypeResult = this._getTypeFromExpression(node.leftExpression);
        const memberType = this._getTypeFromMemberAccessExpressionWithBaseType(
            node, baseTypeResult, usage, flags);

        if (this._writeTypeToCache) {
            // Cache the type information in the member name node as well.
            this._writeTypeToCache(node.memberName, memberType.type);
        }

        return memberType;
    }

    private _getTypeFromMemberAccessExpressionWithBaseType(node: MemberAccessExpressionNode,
                baseTypeResult: TypeResult, usage: EvaluatorUsage,
                flags: EvaluatorFlags): TypeResult {

        const baseType = baseTypeResult.type;
        const memberName = node.memberName.nameToken.value;
        const diag = new DiagnosticAddendum();

        let type: Type | undefined;

        if (isAnyOrUnknown(baseType)) {
            type = baseType;
        } else if (baseType.category === TypeCategory.Class) {
            type = this.getTypeFromClassMember(node.memberName, baseType,
                node.memberName.nameToken.value, usage);

            if (!type) {
                diag.addMessage(`Member '${ memberName }' is unknown`);
            }
        } else if (baseType.category === TypeCategory.Object) {
            const classFromTypeObject = this._getClassFromPotentialTypeObject(baseType);
            if (classFromTypeObject) {
                // Handle the case where the object is a 'Type' object, which
                // represents a class.
                return this._getTypeFromMemberAccessExpressionWithBaseType(node,
                   { type: classFromTypeObject, node: baseTypeResult.node }, usage, flags);
            }

            type = this.getTypeFromObjectMember(node.memberName, baseType,
                node.memberName.nameToken.value, usage, MemberAccessFlags.None);
            if (!type) {
                diag.addMessage(`Member '${ memberName }' is unknown`);
            }
        } else if (baseType.category === TypeCategory.Module) {
            const symbol = baseType.fields.get(memberName);
            if (symbol) {
                if (usage.method === 'get') {
                    if (this._setSymbolAccessed) {
                        this._setSymbolAccessed(symbol);
                    }
                }
                type = TypeUtils.getEffectiveTypeOfSymbol(symbol);
            } else {
                this._addError(`'${ memberName }' is not a known member of module`, node.memberName);
                type = UnknownType.create();
            }
        } else if (baseType.category === TypeCategory.Union) {
            const returnTypes: Type[] = [];
            baseType.subtypes.forEach(typeEntry => {
                if (isNoneOrNever(typeEntry)) {
                    this._addDiagnostic(
                        this._fileInfo.diagnosticSettings.reportOptionalMemberAccess,
                        DiagnosticRule.reportOptionalMemberAccess,
                        `'${ memberName }' is not a known member of 'None'`, node.memberName);
                } else {
                    const typeResult = this._getTypeFromMemberAccessExpressionWithBaseType(node,
                        {
                            type: typeEntry,
                            node
                        },
                        usage,
                        EvaluatorFlags.None);

                    if (typeResult) {
                        returnTypes.push(typeResult.type);
                    }
                }
            });

            if (returnTypes.length > 0) {
                type = combineTypes(returnTypes);
            }
        } else if (baseType.category === TypeCategory.Property) {
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
        } else if (baseType.category === TypeCategory.Function || baseType.category === TypeCategory.OverloadedFunction) {
            // If we're assigning a value to the __defaults__ member of a function,
            // note that the default value processing for that function should be disabled.
            if (baseType.category === TypeCategory.Function && memberName === '__defaults__') {
                if (usage.method === 'set') {
                    FunctionType.setDefaultParameterCheckDisabled(baseType);
                }
            }

            // TODO - not yet sure what to do about members of functions,
            // which have associated dictionaries.
            type = UnknownType.create();
        } else {
            diag.addMessage(`Unsupported type '${ printType(baseType) }'`);
        }

        if (!type) {
            let operationName = 'access';
            if (usage.method === 'set') {
                operationName = 'assign';
            } else if (usage.method === 'del') {
                operationName = 'delete';
            }

            this._addError(
                `Cannot ${ operationName } member '${ memberName }' ` +
                `for type '${ printType(baseType) }'` + diag.getString(),
                node.memberName);
            type = UnknownType.create();
        }

        // Should we specialize the class?
        if ((flags & EvaluatorFlags.DoNotSpecialize) === 0) {
            if (type.category === TypeCategory.Class) {
                type = this._createSpecializedClassType(type, undefined, node);
            }
        }

        return { type, node };
    }

    // If the object type is a 'Type' object, converts it to the corresponding
    // class that it represents and returns that class. Otherwise returns undefined.
    private _getClassFromPotentialTypeObject(potentialTypeObject: ObjectType): Type | undefined {
        const objectClass = potentialTypeObject.classType;
        if (ClassType.isBuiltIn(objectClass, 'Type')) {
            const typeArgs = ClassType.getTypeArguments(objectClass);

            if (typeArgs && typeArgs.length > 0) {
                let firstTypeArg = typeArgs[0];

                // If the type arg is a type var itself, specialize it in
                // case it's bound or constrained.
                if (firstTypeArg.category === TypeCategory.TypeVar) {
                    firstTypeArg = TypeUtils.specializeTypeVarType(firstTypeArg);
                }

                if (firstTypeArg.category === TypeCategory.Object) {
                    return firstTypeArg.classType;
                }
            }

            return AnyType.create();
        }

        return undefined;
    }

    private _getTypeFromClassMemberName(errorNode: ExpressionNode, classType: ClassType, memberName: string,
            usage: EvaluatorUsage, flags: MemberAccessFlags): ClassMemberLookup | undefined {

        // If this is a special type (like "List") that has an alias
        // class (like "list"), switch to the alias, which defines
        // the members.
        const aliasClass = ClassType.getAliasClass(classType);
        if (aliasClass) {
            classType = aliasClass;
        }

        let classLookupFlags = TypeUtils.ClassMemberLookupFlags.Default;
        if (flags & MemberAccessFlags.SkipInstanceMembers) {
            classLookupFlags |= TypeUtils.ClassMemberLookupFlags.SkipInstanceVariables;
        }
        if (flags & MemberAccessFlags.SkipBaseClasses) {
            classLookupFlags |= TypeUtils.ClassMemberLookupFlags.SkipBaseClasses;
        }
        if (flags & MemberAccessFlags.SkipObjectBaseClass) {
            classLookupFlags |= TypeUtils.ClassMemberLookupFlags.SkipObjectBaseClass;
        }
        const memberInfo = TypeUtils.lookUpClassMember(classType, memberName,
            classLookupFlags);

        if (memberInfo) {
            const makeClassMember = (type: Type): ClassMemberLookup => {
                return {
                    type,
                    isClassMember: !memberInfo.isInstanceMember
                };
            };

            let type = memberInfo.symbolType;

            if (usage.method === 'get') {
                // Mark the member accessed if it's not coming from a parent class.
                if (memberInfo.classType === classType && this._setSymbolAccessed) {
                    this._setSymbolAccessed(memberInfo.symbol);
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
                        let propertyReturnType = this._validateCallArguments(
                            errorNode, [selfArg], type.getter, new TypeVarMap(), true);
                        if (!propertyReturnType) {
                            propertyReturnType = UnknownType.create();
                        }

                        return makeClassMember(propertyReturnType);
                    } else if (usage.method === 'set') {
                        let setterFunctionType = type.setter;
                        if (setterFunctionType) {
                            // Strip off the "self" parameter.
                            setterFunctionType = TypeUtils.stripFirstParameter(setterFunctionType);

                            // Validate that we can call the setter with the specified type.
                            assert(usage.setType !== undefined && usage.setErrorNode !== undefined);
                            const argList: FunctionArgument[] = [];
                            argList.push({ argumentCategory: ArgumentCategory.Simple, type: usage.setType! });
                            this._validateFunctionArguments(usage.setErrorNode || errorNode,
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
                    const getMember = TypeUtils.lookUpClassMember(memberClassType, accessMethodName,
                        TypeUtils.ClassMemberLookupFlags.SkipInstanceVariables);
                    if (getMember) {
                        if (getMember.symbolType.category === TypeCategory.Function) {
                            if (usage.method === 'get') {
                                type = FunctionType.getEffectiveReturnType(getMember.symbolType);
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
                let effectiveType = type;

                // If the code is patching a method (defined on the class)
                // with an object-level function, strip the "self" parameter
                // off the original type. This is sometimes done for test
                // purposes to override standard behaviors of specific methods.
                if ((flags & MemberAccessFlags.SkipInstanceMembers) === 0) {
                    if (!memberInfo.isInstanceMember && type.category === TypeCategory.Function) {
                        if (FunctionType.isClassMethod(type) || FunctionType.isInstanceMethod(type)) {
                            effectiveType = TypeUtils.stripFirstParameter(type);
                        }
                    }
                }

                // Verify that the assigned type is compatible.
                const diag = new DiagnosticAddendum();
                if (!TypeUtils.canAssignType(effectiveType, usage.setType!, diag.createAddendum())) {
                    this._addError(
                        `Expression of type '${ printType(usage.setType!) }'` +
                            ` cannot be assigned to member '${ memberName }'` +
                            ` of class '${ printType(classType) }'` +
                            diag.getString(),
                        errorNode);
                }
            }

            return makeClassMember(type);
        }

        if (!(flags & MemberAccessFlags.SkipGetAttributeCheck)) {
            if (usage.method === 'get') {
                // See if the class has a "__getattribute__" or "__getattr__" method.
                // If so, arbitrary members are supported.
                const getAttribType = this.getTypeFromClassMember(errorNode, classType,
                    '__getattribute__', { method: 'get' },
                        MemberAccessFlags.SkipForMethodLookup |
                        MemberAccessFlags.SkipObjectBaseClass);

                if (getAttribType && getAttribType.category === TypeCategory.Function) {
                    return {
                        type: FunctionType.getEffectiveReturnType(getAttribType),
                        isClassMember: false
                    };
                }

                const getAttrType = this.getTypeFromClassMember(errorNode, classType,
                    '__getattr__', { method: 'get' }, MemberAccessFlags.SkipForMethodLookup);
                if (getAttrType && getAttrType.category === TypeCategory.Function) {
                    return {
                        type: FunctionType.getEffectiveReturnType(getAttrType),
                        isClassMember: false
                    };
                }
            } else if (usage.method === 'set') {
                const setAttrType = this.getTypeFromClassMember(errorNode, classType,
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
                const delAttrType = this.getTypeFromClassMember(errorNode, classType,
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

    private _getTypeFromIndexExpression(node: IndexExpressionNode, usage: EvaluatorUsage): TypeResult {
        const baseTypeResult = this._getTypeFromExpression(node.baseExpression,
            { method: 'get' }, EvaluatorFlags.DoNotSpecialize);

        const baseType = baseTypeResult.type;

        // Handle the special case where we're we're specializing a generic
        // union of class types.
        if (baseType.category === TypeCategory.Union) {
            const typeParameters: TypeVarType[] = [];
            let isUnionOfClasses = true;

            baseType.subtypes.forEach(subtype => {
                if (subtype.category === TypeCategory.Class) {
                    TypeUtils.addTypeVarsToListIfUnique(typeParameters,
                        TypeUtils.getTypeVarArgumentsRecursive(subtype));
                } else {
                    isUnionOfClasses = false;
                }
            });

            if (isUnionOfClasses) {
                const typeArgs = this._getTypeArgs(node.items).map(t => t.type);
                const typeVarMap = TypeUtils.buildTypeVarMap(typeParameters, typeArgs);
                const type = TypeUtils.specializeType(baseType, typeVarMap);
                return { type, node };
            }
        }

        const type = TypeUtils.doForSubtypes(baseType, subtype => {
            if (isAnyOrUnknown(subtype)) {
                return subtype;
            } else if (subtype.category === TypeCategory.Class) {
                // Setting the value of an indexed class will always result
                // in an exception.
                if (usage.method === 'set') {
                    this._addError(`Generic class type cannot be assigned`, node.baseExpression);
                } else if (usage.method === 'del') {
                    this._addError(`Generic class type cannot be deleted`, node.baseExpression);
                }

                if (ClassType.isSpecialBuiltIn(subtype, 'Literal')) {
                    // Special-case Literal types.
                    return this._createLiteralType(node);
                } else if (ClassType.isBuiltIn(subtype, 'InitVar')) {
                    // Special-case InitVar, used in data classes.
                    const typeArgs = this._getTypeArgs(node.items);
                    if (typeArgs.length === 1) {
                        return typeArgs[0].type;
                    } else {
                        this._addError(
                            `Expected one type argument for 'InitVar' but got ${ typeArgs.length }`,
                            node.baseExpression);
                        return UnknownType.create();
                    }
                } else if (TypeUtils.isEnumClass(subtype)) {
                    // Special-case Enum types.
                    // TODO - validate that there's only one index entry
                    // that is a str type.
                    return Object(subtype);
                } else {
                    const typeArgs = this._getTypeArgs(node.items);
                    return this._createSpecializedClassType(subtype, typeArgs, node.items);
                }
            } else if (subtype.category === TypeCategory.Object) {
                return this._getTypeFromIndexedObject(node, subtype, usage);
            } else if (isNoneOrNever(subtype)) {
                this._addDiagnostic(
                    this._fileInfo.diagnosticSettings.reportOptionalSubscript,
                    DiagnosticRule.reportOptionalSubscript,
                    `Optional of type 'None' cannot be subscripted`,
                    node.baseExpression);

                return UnknownType.create();
            } else {
                this._addError(
                    `Object of type '${ printType(subtype) }' cannot be subscripted`,
                    node.baseExpression);

                return UnknownType.create();
            }
        });

        // In case we didn't walk the list items above, do so now.
        // If we have, this information will be cached.
        node.items.items.forEach(item => {
            this._getTypeFromExpression(item);
        });

        return { type, node };
    }

    private _getTypeFromIndexedObject(node: IndexExpressionNode,
            baseType: ObjectType, usage: EvaluatorUsage): Type {

        let magicMethodName: string;
        if (usage.method === 'get') {
            magicMethodName = '__getitem__';
        } else if (usage.method === 'set') {
            magicMethodName = '__setitem__';
        } else {
            assert(usage.method === 'del');
            magicMethodName = '__delitem__';
        }

        const itemMethodType = this.getTypeFromObjectMember(node,
            baseType, magicMethodName, { method: 'get' },
                MemberAccessFlags.SkipForMethodLookup);

        if (!itemMethodType) {
            this._addError(
                `Object of type '${ printType(baseType) }' does not define ` +
                    `'${ magicMethodName }'`,
                node.baseExpression);
            return UnknownType.create();
        }

        const indexTypeList = node.items.items.map(item => this.getType(item));

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
            const builtInTupleType = ScopeUtils.getBuiltInType(this._scope, 'Tuple');
            if (builtInTupleType.category === TypeCategory.Class) {
                indexType = TypeUtils.convertClassToObject(
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
                type: AnyType.create()
            });
        }

        const returnType = this._validateCallArguments(node, argList,
            itemMethodType, new TypeVarMap());

        return returnType || UnknownType.create();
    }

    private _getTypeArgs(node: IndexItemsNode): TypeResult[] {
        const typeArgs: TypeResult[] = [];

        node.items.forEach(expr => {
            typeArgs.push(this._getTypeArg(expr));
        });

        return typeArgs;
    }

    private _getTypeArg(node: ExpressionNode): TypeResult {
        let typeResult: TypeResult;

        if (node.nodeType === ParseNodeType.List) {
            typeResult = {
                type: UnknownType.create(),
                typeList: node.entries.map(entry => this._getTypeFromExpression(entry)),
                node
            };
        } else {
            typeResult = this._getTypeFromExpression(node, { method: 'get' },
                EvaluatorFlags.ConvertEllipsisToAny);
        }

        return typeResult;
    }

    private _getTypeFromTupleExpression(node: TupleExpressionNode, usage: EvaluatorUsage): TypeResult {
        const entryTypes = node.expressions.map(expr => this.getType(expr, usage));

        let type: Type = UnknownType.create();
        const builtInTupleType = ScopeUtils.getBuiltInType(this._scope, 'Tuple');

        if (builtInTupleType.category === TypeCategory.Class) {
            type = TypeUtils.convertClassToObject(
                ClassType.cloneForSpecialization(builtInTupleType, entryTypes));
        }

        return { type, node };
    }

    private _getTypeFromCallExpression(node: CallExpressionNode, flags: EvaluatorFlags): TypeResult {
        // Evaluate the left-hand side but don't specialize it yet because we
        // may need to specialize based on the arguments.
        const baseTypeResult = this._getTypeFromExpression(node.leftExpression,
            { method: 'get' }, EvaluatorFlags.DoNotSpecialize);

        // Handle the built-in "super" call specially.
        if (node.leftExpression.nodeType === ParseNodeType.Name && node.leftExpression.nameToken.value === 'super') {
            return {
                type: this._getTypeFromSuperCall(node),
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

            const type = this.getType(node.arguments[0].valueExpression);
            const exprString = ParseTreeUtils.printExpression(node.arguments[0].valueExpression);
            this._addWarning(
                `Type of '${ exprString }' is '${ printType(type) }'`,
                node.arguments[0]);
            return { type: AnyType.create(), node };
        }

        const argList = node.arguments.map(arg => {
            return {
                valueExpression: arg.valueExpression,
                argumentCategory: arg.argumentCategory,
                name: arg.name,
                type: this.getType(arg.valueExpression)
            };
        });

        return this._getTypeFromCallExpressionWithBaseType(
            node, argList, baseTypeResult, flags, node);
    }

    private _getTypeFromSuperCall(node: CallExpressionNode): Type {
        if (node.arguments.length > 2) {
            this._addError(
                `Expecting no more than two arguments to super'`,
                node.arguments[2]);
        }

        // Determine which class the "super" call is applied to. If
        // there is no first argument, then the class is implicit.
        let targetClassType: Type;
        if (node.arguments.length > 0) {
            targetClassType = this._getTypeFromExpression(node.arguments[0].valueExpression).type;

            if (!isAnyOrUnknown(targetClassType) && !(targetClassType.category === TypeCategory.Class)) {
                this._addError(
                    `Expected class type as first argument to super() call but received ` +
                        `'${ printType(targetClassType) }'`,
                    node.arguments[0].valueExpression);
            }
        } else {
            const enclosingClass = ParseTreeUtils.getEnclosingClass(node);
            if (enclosingClass) {
                targetClassType = AnalyzerNodeInfo.getExpressionType(enclosingClass) as ClassType;
            } else {
                this._addError(
                    `Zero-argument form of super call is valid only within a class'`,
                    node.leftExpression);
                targetClassType = UnknownType.create();
            }
        }

        // Determine whether there is a further constraint.
        let constrainedClassType: Type;
        if (node.arguments.length > 1) {
            constrainedClassType = this._getTypeFromExpression(node.arguments[1].valueExpression).type;

            let reportError = false;

            if (isAnyOrUnknown(constrainedClassType)) {
                // Ignore unknown or any types.
            } else if (constrainedClassType.category === TypeCategory.Object) {
                const childClassType = constrainedClassType.classType;
                if (targetClassType.category === TypeCategory.Class) {
                    if (!TypeUtils.derivesFromClassRecursive(childClassType, targetClassType)) {
                        reportError = true;
                    }
                }
            } else if (constrainedClassType.category === TypeCategory.Class) {
                if (targetClassType.category === TypeCategory.Class) {
                    if (!TypeUtils.derivesFromClassRecursive(constrainedClassType, targetClassType)) {
                        reportError = true;
                    }
                }
            } else {
                reportError = true;
            }

            if (reportError) {
                this._addError(
                    `Second argument to super() call must be object or class that derives from '${ printType(targetClassType) }'`,
                    node.arguments[1].valueExpression);
            }
        }

        // Python docs indicate that super() isn't valid for
        // operations other than member accesses.
        const parentNode = node.parent!;
        if (parentNode.nodeType === ParseNodeType.MemberAccess) {
            const memberName = parentNode.memberName.nameToken.value;
            const lookupResults = TypeUtils.lookUpClassMember(
                targetClassType, memberName, TypeUtils.ClassMemberLookupFlags.SkipOriginalClass);
            if (lookupResults && lookupResults.classType.category === TypeCategory.Class) {
                return ObjectType.create(lookupResults.classType);
            }

            // If the lookup failed, try to return the first base class. An error
            // will be reported by the member lookup logic at a later time.
            if (targetClassType.category === TypeCategory.Class) {
                const baseClasses = ClassType.getBaseClasses(targetClassType);
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

    private _getTypeFromCallExpressionWithBaseType(errorNode: ExpressionNode,
            argList: FunctionArgument[], baseTypeResult: TypeResult,
            flags: EvaluatorFlags, cachedExpressionNode?: ExpressionNode,
            specializeReturnType = true): TypeResult {

        let type: Type | undefined;
        const callType = baseTypeResult.type;

        if (callType.category === TypeCategory.Class) {
            if (ClassType.isBuiltIn(callType)) {
                const className = ClassType.getClassName(callType);

                if (className === 'type') {
                    // Handle the 'type' call specially.
                    if (argList.length >= 1) {
                        const argType = argList[0].type;
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
                    type = this._createTypeVarType(errorNode, argList);
                } else if (className === 'NamedTuple') {
                    type = this._createNamedTupleType(errorNode, argList, true,
                        cachedExpressionNode);
                } else if (className === 'Protocol' || className === 'Generic' ||
                        className === 'Callable' || className === 'Type') {
                    this._addError(`'${ className }' cannot be instantiated directly`, errorNode);
                } else if (className === 'Enum' || className === 'IntEnum' ||
                        className === 'Flag' || className === 'IntFlag') {
                    type = this._createEnumType(errorNode, callType, argList,
                        cachedExpressionNode);
                } else if (className === 'auto' && argList.length === 0) {
                    type = ScopeUtils.getBuiltInObject(this._scope, 'int');
                }
            } else if (ClassType.isAbstractClass(callType)) {
                // If the class is abstract, it can't be instantiated.
                const symbolTable = new StringMap<TypeUtils.ClassMember>();
                TypeUtils.getAbstractMethodsRecursive(callType, symbolTable);

                const diagAddendum = new DiagnosticAddendum();
                const symbolTableKeys = symbolTable.getKeys();
                const errorsToDisplay = 2;

                symbolTableKeys.forEach((symbolName, index) => {
                    if (index === errorsToDisplay) {
                        diagAddendum.addMessage(`and ${ symbolTableKeys.length - errorsToDisplay } more...`);
                    } else if (index < errorsToDisplay) {
                        const symbolWithClass = symbolTable.get(symbolName);

                        if (symbolWithClass && symbolWithClass.classType.category === TypeCategory.Class) {
                            const className = ClassType.getClassName(symbolWithClass.classType);
                            diagAddendum.addMessage(`'${ className }.${ symbolName }' is abstract`);
                        }
                    }
                });

                this._addError(
                    `Cannot instantiate abstract class '${ ClassType.getClassName(callType) }'` +
                        diagAddendum.getString(),
                    errorNode);
            }

            // Assume this is a call to the constructor.
            if (!type) {
                type = this._validateConstructorArguments(errorNode, argList, callType);
            }
        } else if (callType.category === TypeCategory.Function) {
            // The stdlib collections/__init__.pyi stub file defines namedtuple
            // as a function rather than a class, so we need to check for it here.
            if (FunctionType.getBuiltInName(callType) === 'namedtuple') {
                this._addDiagnostic(
                    this._fileInfo.diagnosticSettings.reportUntypedNamedTuple,
                    DiagnosticRule.reportUntypedNamedTuple,
                    `'namedtuple' provides no types for tuple entries. Use 'NamedTuple' instead.`,
                    errorNode);
                type = this._createNamedTupleType(errorNode, argList, false,
                    cachedExpressionNode);
            } else if (FunctionType.getBuiltInName(callType) === 'NewType') {
                type = this._validateCallArguments(errorNode, argList, callType,
                    new TypeVarMap(), specializeReturnType);

                // If the call's arguments were validated, replace the
                // type with a new synthesized subclass.
                if (type) {
                    type = this._createNewType(errorNode, argList, cachedExpressionNode);
                }
            } else {
                type = this._validateCallArguments(errorNode, argList, callType,
                    new TypeVarMap(), specializeReturnType);
            }

            if (!type) {
                type = UnknownType.create();
            }
        } else if (callType.category === TypeCategory.OverloadedFunction) {
            // Determine which of the overloads (if any) match.
            const functionType = this._findOverloadedFunctionType(errorNode, argList, callType);

            if (functionType) {
                if (FunctionType.getBuiltInName(functionType) === 'cast' && argList.length === 2) {
                    // Verify that the cast is necessary.
                    const castToType = argList[0].type;
                    const castFromType = argList[1].type;
                    if (castToType.category === TypeCategory.Class && castFromType.category === TypeCategory.Object) {
                        if (isTypeSame(castToType, castFromType.classType)) {
                            this._addDiagnostic(
                                this._fileInfo.diagnosticSettings.reportUnnecessaryCast,
                                DiagnosticRule.reportUnnecessaryCast,
                                `Unnecessary call to cast: type is already ${ printType(castFromType) }`,
                                errorNode);
                        }
                    }
                }

                type = this._validateCallArguments(errorNode, argList, callType,
                    new TypeVarMap(), specializeReturnType);
                if (!type) {
                    type = UnknownType.create();
                }
            } else {
                const exprString = ParseTreeUtils.printExpression(errorNode);
                const diagAddendum = new DiagnosticAddendum();
                const argTypes = argList.map(t => printType(t.type));
                diagAddendum.addMessage(`Argument types: (${ argTypes.join(', ') })`);
                this._addError(
                    `No overloads for '${ exprString }' match parameters` + diagAddendum.getString(),
                    errorNode);
                type = UnknownType.create();
            }
        } else if (callType.category === TypeCategory.Object) {
            // Handle the "Type" object specially.
            const classFromTypeObject = this._getClassFromPotentialTypeObject(callType);
            if (classFromTypeObject) {
                if (isAnyOrUnknown(classFromTypeObject)) {
                    type = classFromTypeObject;
                } else if (classFromTypeObject.category === TypeCategory.Class) {
                    type = this._validateConstructorArguments(errorNode,
                        argList, classFromTypeObject);
                }
            } else {
                const memberType = this.getTypeFromObjectMember(errorNode,
                    callType, '__call__', { method: 'get' }, MemberAccessFlags.SkipForMethodLookup);
                if (memberType) {
                    type = this._validateCallArguments(errorNode, argList, memberType, new TypeVarMap());
                    if (!type) {
                        type = UnknownType.create();
                    }
                }
            }
        } else if (callType.category === TypeCategory.Union) {
            const returnTypes: Type[] = [];
            callType.subtypes.forEach(typeEntry => {
                if (isNoneOrNever(typeEntry)) {
                    this._addDiagnostic(
                        this._fileInfo.diagnosticSettings.reportOptionalCall,
                        DiagnosticRule.reportOptionalCall,
                        `Object of type 'None' cannot be called`,
                        errorNode);
                } else {
                    const typeResult = this._getTypeFromCallExpressionWithBaseType(
                        errorNode,
                        argList,
                        {
                            type: typeEntry,
                            node: baseTypeResult.node
                        },
                        EvaluatorFlags.None, cachedExpressionNode);
                    if (typeResult) {
                        returnTypes.push(typeResult.type);
                    }
                }
            });

            if (returnTypes.length > 0) {
                type = combineTypes(returnTypes);
            }
        } else if (isAnyOrUnknown(callType)) {
            type = callType;
        }

        if (!type) {
            this._addError(
                `'${ ParseTreeUtils.printExpression(errorNode) }' has type ` +
                `'${ printType(callType) }' and is not callable`,
                errorNode);
            type = UnknownType.create();
        }

        // Should we specialize the class?
        if ((flags & EvaluatorFlags.DoNotSpecialize) === 0) {
            if (type.category === TypeCategory.Class) {
                type = this._createSpecializedClassType(type, undefined, errorNode);
            }
        }

        return { type, node: baseTypeResult.node };
    }

    private _findOverloadedFunctionType(errorNode: ExpressionNode, argList: FunctionArgument[],
            callType: OverloadedFunctionType): FunctionType | undefined {

        let validOverload: FunctionType | undefined;

        // Temporarily disable diagnostic output.
        this._silenceDiagnostics(() => {
            for (const overload of callType.overloads) {
                if (this._validateCallArguments(errorNode, argList, overload.type, new TypeVarMap())) {
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
    private _validateConstructorArguments(errorNode: ExpressionNode,
            argList: FunctionArgument[], type: ClassType): Type | undefined {
        let validatedTypes = false;
        let returnType: Type | undefined;
        let reportedErrorsForNewCall = false;

        // Validate __new__
        const constructorMethodInfo = this._getTypeFromClassMemberName(errorNode,
            type, '__new__', { method: 'get' }, MemberAccessFlags.SkipForMethodLookup |
                MemberAccessFlags.SkipObjectBaseClass);
        if (constructorMethodInfo) {
            const constructorMethodType = TypeUtils.bindFunctionToClassOrObject(
                type, constructorMethodInfo.type, true);
            returnType = this._validateCallArguments(errorNode, argList, constructorMethodType,
                new TypeVarMap());
            if (!returnType) {
                reportedErrorsForNewCall = true;
            }
            validatedTypes = true;
        }

        // Validate __init__
        // Don't report errors for __init__ if __new__ already generated errors. They're
        // probably going to be entirely redundant anyway.
        if (!reportedErrorsForNewCall) {
            const initMethodType = this.getTypeFromObjectMember(errorNode,
                ObjectType.create(type), '__init__', { method: 'get' },
                MemberAccessFlags.SkipForMethodLookup | MemberAccessFlags.SkipObjectBaseClass);
            if (initMethodType) {
                const typeVarMap = new TypeVarMap();
                if (this._validateCallArguments(errorNode, argList, initMethodType, typeVarMap)) {
                    let specializedClassType = type;
                    if (!typeVarMap.isEmpty()) {
                        specializedClassType = TypeUtils.specializeType(type, typeVarMap) as ClassType;
                        assert(specializedClassType.category === TypeCategory.Class);
                    }
                    returnType = ObjectType.create(specializedClassType);
                }
                validatedTypes = true;
            }
        }

        if (!validatedTypes && argList.length > 0) {
            this._addError(
                `Expected no arguments to '${ ClassType.getClassName(type) }' constructor`, errorNode);
        } else if (!returnType) {
            // There was no __new__ or __init__, so fall back on the
            // object.__new__ which takes no parameters.
            returnType = ObjectType.create(type);
        }

        // Make the type concrete if it wasn't already specialized.
        if (returnType) {
            returnType = TypeUtils.specializeType(returnType, undefined);
        }

        return returnType;
    }

    // Validates that the arguments can be assigned to the call's parameter
    // list, specializes the call based on arg types, and returns the
    // specialized type of the return value. If it detects an error along
    // the way, it emits a diagnostic and returns undefined.
    private _validateCallArguments(errorNode: ExpressionNode,
            argList: FunctionArgument[], callType: Type, typeVarMap: TypeVarMap,
            specializeReturnType = true): Type | undefined {

        let returnType: Type | undefined;

        if (isAnyOrUnknown(callType)) {
            returnType = callType;
        } else if (callType.category === TypeCategory.Function) {
            returnType = this._validateFunctionArguments(errorNode, argList, callType, typeVarMap);
        } else if (callType.category === TypeCategory.OverloadedFunction) {
            const overloadedFunctionType = this._findOverloadedFunctionType(
                errorNode, argList, callType);
            if (overloadedFunctionType) {
                returnType = this._validateFunctionArguments(errorNode,
                    argList, overloadedFunctionType, typeVarMap);
            } else {
                const exprString = ParseTreeUtils.printExpression(errorNode);
                const diagAddendum = new DiagnosticAddendum();
                const argTypes = argList.map(t => printType(t.type));
                diagAddendum.addMessage(`Argument types: (${ argTypes.join(', ') })`);
                this._addError(
                    `No overloads for '${ exprString }' match parameters` + diagAddendum.getString(),
                    errorNode);
            }
        } else if (callType.category === TypeCategory.Class) {
            if (!ClassType.isSpecialBuiltIn(callType)) {
                returnType = this._validateConstructorArguments(errorNode, argList, callType);
            } else {
                this._addError(
                    `'${ ClassType.getClassName(callType) }' cannot be instantiated`,
                    errorNode);
            }
        } else if (callType.category === TypeCategory.Object) {
            const memberType = this.getTypeFromObjectMember(errorNode,
                callType, '__call__', { method: 'get' },
                    MemberAccessFlags.SkipForMethodLookup);

            if (memberType && memberType.category === TypeCategory.Function) {
                const callMethodType = TypeUtils.stripFirstParameter(memberType);
                returnType = this._validateCallArguments(
                    errorNode, argList, callMethodType, typeVarMap);
            }
        } else if (callType.category === TypeCategory.Union) {
            const returnTypes: Type[] = [];

            for (const type of callType.subtypes) {
                if (isNoneOrNever(type)) {
                    this._addDiagnostic(
                        this._fileInfo.diagnosticSettings.reportOptionalCall,
                        DiagnosticRule.reportOptionalCall,
                        `Object of type 'None' cannot be called`,
                        errorNode);
                } else {
                    const entryReturnType = this._validateCallArguments(
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
            returnType = TypeUtils.specializeType(returnType, undefined);
        }

        return returnType;
    }

    // Tries to assign the call arguments to the function parameter
    // list and reports any mismatches in types or counts. Returns the
    // specialized return type of the call.
    // This logic is based on PEP 3102: https://www.python.org/dev/peps/pep-3102/
    private _validateFunctionArguments(errorNode: ExpressionNode,
            argList: FunctionArgument[], type: FunctionType, typeVarMap: TypeVarMap): Type | undefined {

        let argIndex = 0;
        const typeParams = FunctionType.getParameters(type);

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

        // Map the positional args to parameters.
        let paramIndex = 0;
        while (argIndex < positionalArgCount) {
            if (paramIndex >= positionalParamCount) {
                if (argList[argIndex].argumentCategory !== ArgumentCategory.UnpackedList) {
                    const adjustedCount = positionalParamCount;
                    this._addError(
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
                    const listElementType = this.getTypeFromIterable(argList[argIndex].type, false,
                        argList[argIndex].valueExpression!, false);

                    if (!this._validateArgType(paramType, listElementType,
                            argList[argIndex].valueExpression || errorNode, typeVarMap,
                            typeParams[paramIndex].name)) {
                        reportedArgError = true;
                    }
                }
                break;
            } else if (typeParams[paramIndex].category === ParameterCategory.VarArgList) {
                if (!this._validateArgType(paramType, argList[argIndex].type,
                        argList[argIndex].valueExpression || errorNode, typeVarMap,
                        typeParams[paramIndex].name)) {
                    reportedArgError = true;
                }
                argIndex++;
            } else {
                if (!this._validateArgType(paramType, argList[argIndex].type,
                        argList[argIndex].valueExpression || errorNode, typeVarMap,
                        typeParams[paramIndex].name)) {
                    reportedArgError = true;
                }

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
                                this._addError(
                                    `Parameter '${ paramNameValue }' is already assigned`, paramName);
                                reportedArgError = true;
                            } else {
                                paramMap.get(paramName.nameToken.value)!.argsReceived++;

                                const paramInfoIndex = typeParams.findIndex(
                                    param => param.name === paramNameValue);
                                assert(paramInfoIndex >= 0);
                                const paramType = FunctionType.getEffectiveParameterType(type, paramInfoIndex);
                                if (!this._validateArgType(paramType, argList[argIndex].type,
                                        argList[argIndex].valueExpression || errorNode, typeVarMap,
                                        paramNameValue)) {
                                    reportedArgError = true;
                                }
                            }
                        } else if (varArgDictParam) {
                            if (!this._validateArgType(varArgDictParam.type, argList[argIndex].type,
                                    argList[argIndex].valueExpression || errorNode, typeVarMap,
                                    paramNameValue)) {
                                reportedArgError = true;
                            }
                        } else {
                            this._addError(
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
                    this._addError(
                        `Argument missing for parameter${ unassignedParams.length === 1 ? '' : 's' } ` +
                        unassignedParams.map(p => `'${ p }'`).join(', '), errorNode);
                    reportedArgError = true;
                }
            }
        }

        if (reportedArgError) {
            return undefined;
        }

        return TypeUtils.specializeType(FunctionType.getEffectiveReturnType(type), typeVarMap);
    }

    private _validateArgType(paramType: Type, argType: Type, errorNode: ExpressionNode,
            typeVarMap: TypeVarMap, paramName?: string): boolean {

        const diag = new DiagnosticAddendum();
        if (!TypeUtils.canAssignType(paramType, argType, diag.createAddendum(), typeVarMap)) {
            const optionalParamName = paramName ? `'${ paramName }' ` : '';
            this._addError(
                `Argument of type '${ printType(argType) }'` +
                    ` cannot be assigned to parameter ${ optionalParamName }` +
                    `of type '${ printType(paramType) }'` +
                    diag.getString(),
                errorNode);
            return false;
        }

        return true;
    }

    private _createTypeVarType(errorNode: ExpressionNode, argList: FunctionArgument[]): Type | undefined {
        let typeVarName = '';
        if (argList.length === 0) {
            this._addError('Expected name of type var', errorNode);
            return undefined;
        }

        const firstArg = argList[0];
        if (firstArg.valueExpression && firstArg.valueExpression.nodeType === ParseNodeType.StringList) {
            typeVarName = firstArg.valueExpression.strings.map(s => s.value).join('');
        } else {
            this._addError('Expected name of type var as first parameter',
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
                    this._addError(
                        `Duplicate parameter name '${ paramName }' not allowed`,
                        argList[i].valueExpression || errorNode);
                }

                if (paramName === 'bound') {
                    if (typeVar.constraints.length > 0) {
                        this._addError(
                            `A TypeVar cannot be both bound and constrained`,
                            argList[i].valueExpression || errorNode);
                    } else {
                        if (requiresSpecialization(argList[i].type)) {
                            this._addError(
                                `A TypeVar bound type cannot be generic`,
                                argList[i].valueExpression || errorNode);
                        }
                        typeVar.boundType = TypeUtils.convertClassToObject(argList[i].type);
                    }
                } else if (paramName === 'covariant') {
                    if (argList[i].valueExpression && this._getBooleanValue(argList[i].valueExpression!)) {
                        if (typeVar.isContravariant) {
                            this._addError(
                                `A TypeVar cannot be both covariant and contravariant`,
                                argList[i].valueExpression!);
                        } else {
                            typeVar.isCovariant = true;
                        }
                    }
                } else if (paramName === 'contravariant') {
                    if (argList[i].valueExpression && this._getBooleanValue(argList[i].valueExpression!)) {
                        if (typeVar.isContravariant) {
                            this._addError(
                                `A TypeVar cannot be both covariant and contravariant`,
                                argList[i].valueExpression!);
                        } else {
                            typeVar.isContravariant = true;
                        }
                    }
                } else {
                    this._addError(
                        `'${ paramName }' is unknown parameter to TypeVar`,
                        argList[i].valueExpression || errorNode);
                }

                paramNameMap.set(paramName, paramName);
            } else {
                if (typeVar.boundType) {
                    this._addError(
                        `A TypeVar cannot be both bound and constrained`,
                        argList[i].valueExpression || errorNode);
                } else {
                    if (requiresSpecialization(argList[i].type)) {
                        this._addError(
                            `A TypeVar constraint type cannot be generic`,
                            argList[i].valueExpression || errorNode);
                    }
                    TypeVarType.addConstraint(typeVar, TypeUtils.convertClassToObject(argList[i].type));
                }
            }
        }

        return typeVar;
    }

    private _getBooleanValue(node: ExpressionNode): boolean {
        if (node.nodeType === ParseNodeType.Constant) {
            if (node.token.type === TokenType.Keyword) {
                if (node.token.keywordType === KeywordType.False) {
                    return false;
                } else if (node.token.keywordType === KeywordType.True) {
                    return true;
                }
            }
        }

        this._addError('Expected True or False', node);
        return false;
    }

    // Creates a new custom enum class with named values.
    private _createEnumType(errorNode: ExpressionNode, enumClass: ClassType,
            argList: FunctionArgument[], cachedExpressionNode?: ExpressionNode): ClassType {

        let className = 'enum';
        if (argList.length === 0) {
            this._addError('Expected enum class name as first parameter', errorNode);
        } else {
            const nameArg = argList[0];
            if (nameArg.argumentCategory !== ArgumentCategory.Simple) {
                this._addError('Expected enum class name as first parameter',
                    argList[0].valueExpression || errorNode);
            } else if (nameArg.valueExpression && nameArg.valueExpression.nodeType === ParseNodeType.StringList) {
                className = nameArg.valueExpression.strings.map(s => s.value).join('');
            }
        }

        // This is a hack to make enum classes work correctly. We don't want
        // to create a new ClassType for every analysis pass. Instead, we'll
        // use the cached version and update it after the first pass.
        const cachedCallType = cachedExpressionNode ?
            AnalyzerNodeInfo.getExpressionType(cachedExpressionNode) :
            undefined;

        // Use the cached class type and update it if this isn't the first
        // analysis path. If this is the first pass, allocate a new ClassType.
        let classType = cachedCallType as ClassType;
        if (!classType || classType.category !== TypeCategory.Class) {
            classType = ClassType.create(className, ClassTypeFlags.None, errorNode.id);

            AnalyzerNodeInfo.setExpressionType(errorNode, classType);
            ClassType.addBaseClass(classType, enumClass, false);
        }

        const classFields = ClassType.getFields(classType);
        setSymbolPreservingAccess(classFields, '__class__',
            Symbol.createWithType(SymbolFlags.ClassMember, classType, defaultTypeSourceId));

        if (argList.length < 2) {
            this._addError('Expected enum item string as second parameter', errorNode);
        } else {
            const entriesArg = argList[1];
            if (entriesArg.argumentCategory !== ArgumentCategory.Simple ||
                    !entriesArg.valueExpression ||
                    entriesArg.valueExpression.nodeType !== ParseNodeType.StringList) {

                this._addError('Expected enum item string as second parameter', errorNode);
            } else {
                const entries = entriesArg.valueExpression.strings.map(s => s.value).join('').split(' ');
                entries.forEach(entryName => {
                    entryName = entryName.trim();
                    if (entryName) {
                        const entryType = UnknownType.create();

                        const newSymbol = Symbol.createWithType(
                            SymbolFlags.ClassMember, entryType, defaultTypeSourceId);

                        // We need to associate the declaration with a parse node.
                        // In this case it's just part of a string literal value.
                        // The definition provider won't necessarily take the
                        // user to the exact spot in the string, but it's close enough.
                        const stringNode = entriesArg.valueExpression!;
                        const declaration: Declaration = {
                            category: DeclarationCategory.Variable,
                            node: stringNode,
                            path: this._fileInfo.filePath,
                            declaredType: entryType,
                            range: convertOffsetsToRange(
                                stringNode.start, TextRange.getEnd(stringNode),
                                this._fileInfo.lines)
                        };
                        newSymbol.addDeclaration(declaration);
                        setSymbolPreservingAccess(classFields, entryName, newSymbol);
                    }
                });
            }
        }

        return classType;
    }

    // Implemented the semantics of the NewType call as documented
    // in the Python specification: The static type checker will treat
    // the new type as if it were a subclass of the original type.
    private _createNewType(errorNode: ExpressionNode, argList: FunctionArgument[],
            cachedExpressionNode?: ExpressionNode): ClassType | undefined {

        let className = '_';
        if (argList.length >= 1) {
            const nameArg = argList[0];
            if (nameArg.argumentCategory === ArgumentCategory.Simple) {
                if (nameArg.valueExpression && nameArg.valueExpression.nodeType === ParseNodeType.StringList) {
                    className = nameArg.valueExpression.strings.map(s => s.value).join('');
                }
            }
        }

        if (argList.length >= 2 && argList[1].type.category === TypeCategory.Class) {
            const baseClass = argList[1].type;

            // This is a hack to make named tuples work correctly. We don't want
            // to create a new ClassType for every analysis pass. Instead, we'll
            // use the cached version and update it after the first pass.
            const cachedCallType = cachedExpressionNode ?
                AnalyzerNodeInfo.getExpressionType(cachedExpressionNode) :
                undefined;

            // Use the cached class type and update it if this isn't the first
            // analysis path. If this is the first pass, allocate a new ClassType.
            let classType = cachedCallType as ClassType;
            if (!classType || classType.category !== TypeCategory.Class) {
                classType = ClassType.create(className, ClassTypeFlags.None, errorNode.id);

                AnalyzerNodeInfo.setExpressionType(errorNode, classType);
                ClassType.addBaseClass(classType, baseClass, false);
            } else {
                ClassType.updateBaseClassType(classType, 0, baseClass);
            }

            return classType;
        }

        return undefined;
    }

    // Creates a new custom tuple factory class with named values.
    // Supports both typed and untyped variants.
    private _createNamedTupleType(errorNode: ExpressionNode, argList: FunctionArgument[],
            includesTypes: boolean, cachedExpressionNode?: ExpressionNode): ClassType {

        let className = 'namedtuple';
        if (argList.length === 0) {
            this._addError('Expected named tuple class name as first parameter',
                errorNode);
        } else {
            const nameArg = argList[0];
            if (nameArg.argumentCategory !== ArgumentCategory.Simple) {
                this._addError('Expected named tuple class name as first parameter',
                    argList[0].valueExpression || errorNode);
            } else if (nameArg.valueExpression && nameArg.valueExpression.nodeType === ParseNodeType.StringList) {
                className = nameArg.valueExpression.strings.map(s => s.value).join('');
            }
        }

        // This is a hack to make named tuples work correctly. We don't want
        // to create a new ClassType for every analysis pass. Instead, we'll
        // use the cached version and update it after the first pass.
        const cachedCallType = cachedExpressionNode ?
            AnalyzerNodeInfo.getExpressionType(cachedExpressionNode) :
            undefined;

        // Use the cached class type and update it if this isn't the first
        // analysis path. If this is the first pass, allocate a new ClassType.
        let classType = cachedCallType as ClassType;
        if (!classType || classType.category !== TypeCategory.Class) {
            classType = ClassType.create(className, ClassTypeFlags.None, errorNode.id);

            AnalyzerNodeInfo.setExpressionType(errorNode, classType);
            const builtInNamedTuple = this.getTypingType('NamedTuple') || UnknownType.create();
            ClassType.addBaseClass(classType, builtInNamedTuple, false);
        }

        const classFields = ClassType.getFields(classType);
        setSymbolPreservingAccess(classFields, '__class__',
            Symbol.createWithType(SymbolFlags.ClassMember, classType, defaultTypeSourceId));

        const builtInTupleType = ScopeUtils.getBuiltInType(this._scope, 'Tuple');
        if (builtInTupleType.category === TypeCategory.Class) {
            const constructorType = FunctionType.create(
                FunctionTypeFlags.StaticMethod | FunctionTypeFlags.SynthesizedMethod);
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
                this._addError('Expected named tuple entry list as second parameter', errorNode);
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
                                const newSymbol = Symbol.createWithType(
                                    SymbolFlags.InstanceMember, entryType, defaultTypeSourceId);

                                // We need to associate the declaration with a parse node.
                                // In this case it's just part of a string literal value.
                                // The definition provider won't necessarily take the
                                // user to the exact spot in the string, but it's close enough.
                                const stringNode = entriesArg.valueExpression!;
                                const declaration: Declaration = {
                                    category: DeclarationCategory.Variable,
                                    node: stringNode,
                                    path: this._fileInfo.filePath,
                                    declaredType: entryType,
                                    range: convertOffsetsToRange(
                                        stringNode.start, TextRange.getEnd(stringNode), this._fileInfo.lines)
                                };
                                newSymbol.addDeclaration(declaration);
                                setSymbolPreservingAccess(classFields, entryName, newSymbol);
                            }
                        });
                    } else if (entriesArg.valueExpression && entriesArg.valueExpression.nodeType === ParseNodeType.List) {
                        const entryList = entriesArg.valueExpression;
                        const entryMap: { [name: string]: string } = {};

                        entryList.entries.forEach((entry, index) => {
                            let entryType: Type | undefined;
                            let entryNameNode: ExpressionNode | undefined;
                            let entryName = '';

                            if (includesTypes) {
                                // Handle the variant that includes name/type tuples.
                                if (entry.nodeType === ParseNodeType.Tuple && entry.expressions.length === 2) {
                                    entryNameNode = entry.expressions[0];
                                    const entryTypeInfo = this._getTypeFromExpression(entry.expressions[1]);
                                    if (entryTypeInfo) {
                                        entryType = TypeUtils.convertClassToObject(entryTypeInfo.type);
                                    }
                                } else {
                                    this._addError(
                                        'Expected two-entry tuple specifying entry name and type', entry);
                                }
                            } else {
                                entryNameNode = entry;
                                entryType = UnknownType.create();
                            }

                            if (entryNameNode && entryNameNode.nodeType === ParseNodeType.StringList) {
                                entryName = entryNameNode.strings.map(s => s.value).join('');
                                if (!entryName) {
                                    this._addError(
                                        'Names within a named tuple cannot be empty', entryNameNode);
                                }
                            } else {
                                this._addError(
                                    'Expected string literal for entry name', entryNameNode || entry);
                            }

                            if (!entryName) {
                                entryName = `_${ index.toString() }`;
                            }

                            if (entryMap[entryName]) {
                                this._addError(
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

                            const newSymbol = Symbol.createWithType(
                                SymbolFlags.InstanceMember, entryType, defaultTypeSourceId);
                            if (entryNameNode) {
                                const declaration: Declaration = {
                                    category: DeclarationCategory.Variable,
                                    node: entryNameNode,
                                    path: this._fileInfo.filePath,
                                    declaredType: entryType,
                                    range: convertOffsetsToRange(
                                        entryNameNode.start, TextRange.getEnd(entryNameNode),
                                        this._fileInfo.lines)
                                };
                                newSymbol.addDeclaration(declaration);
                            }
                            setSymbolPreservingAccess(classFields, entryName, newSymbol);
                        });
                    } else {
                        // A dynamic expression was used, so we can't evaluate
                        // the named tuple statically.
                        addGenericGetAttribute = true;
                    }
                }
            }

            if (addGenericGetAttribute) {
                TypeUtils.addDefaultFunctionParameters(constructorType);
            }

            // Always use generic parameters for __init__. The __new__ method
            // will handle property type checking. We may need to disable default
            // parameter processing for __new__ (see setDefaultParameterCheckDisabled),
            // and we don't want to do it for __init__ as well.
            const initType = FunctionType.create(
                FunctionTypeFlags.InstanceMethod | FunctionTypeFlags.SynthesizedMethod);
            FunctionType.addParameter(initType, selfParameter);
            TypeUtils.addDefaultFunctionParameters(initType);

            setSymbolPreservingAccess(classFields, '__new__',
                Symbol.createWithType(SymbolFlags.ClassMember, constructorType, defaultTypeSourceId));
            setSymbolPreservingAccess(classFields, '__init__',
                Symbol.createWithType(SymbolFlags.ClassMember, initType, defaultTypeSourceId));

            const keysItemType = FunctionType.create(FunctionTypeFlags.SynthesizedMethod);
            FunctionType.setDeclaredReturnType(keysItemType, ScopeUtils.getBuiltInObject(this._scope, 'list',
                [ScopeUtils.getBuiltInObject(this._scope, 'str')]));
            setSymbolPreservingAccess(classFields, 'keys',
                Symbol.createWithType(SymbolFlags.InstanceMember, keysItemType, defaultTypeSourceId));
            setSymbolPreservingAccess(classFields, 'items',
                Symbol.createWithType(SymbolFlags.InstanceMember, keysItemType, defaultTypeSourceId));

            const lenType = FunctionType.create(
                FunctionTypeFlags.InstanceMethod | FunctionTypeFlags.SynthesizedMethod);
            FunctionType.setDeclaredReturnType(lenType, ScopeUtils.getBuiltInObject(this._scope, 'int'));
            FunctionType.addParameter(lenType, selfParameter);
            setSymbolPreservingAccess(classFields, '__len__',
                Symbol.createWithType(SymbolFlags.ClassMember, lenType, defaultTypeSourceId));

            if (addGenericGetAttribute) {
                const getAttribType = FunctionType.create(
                    FunctionTypeFlags.InstanceMethod | FunctionTypeFlags.SynthesizedMethod);
                FunctionType.setDeclaredReturnType(getAttribType, AnyType.create());
                FunctionType.addParameter(getAttribType, selfParameter);
                FunctionType.addParameter(getAttribType, {
                    category: ParameterCategory.Simple,
                    name: 'name',
                    type: ScopeUtils.getBuiltInObject(this._scope, 'str')
                });
                setSymbolPreservingAccess(classFields, '__getattribute__',
                    Symbol.createWithType(SymbolFlags.ClassMember, getAttribType, defaultTypeSourceId));
            }
        }

        return classType;
    }

    private _reportUsageErrorForReadOnly(node: ParseNode, usage: EvaluatorUsage) {
        if (usage.method === 'set') {
            this._addError(`Constant value cannot be assigned`, node);
        } else if (usage.method === 'del') {
            this._addError(`Constant value cannot be deleted`, node);
        }
    }

    private _getTypeFromConstantExpression(node: ConstantNode): TypeResult | undefined {
        let type: Type | undefined;

        if (node.token.type === TokenType.Keyword) {
            if (node.token.keywordType === KeywordType.None) {
                type = NoneType.create();
            } else if (node.token.keywordType === KeywordType.True ||
                    node.token.keywordType === KeywordType.False ||
                    node.token.keywordType === KeywordType.Debug) {
                type = ScopeUtils.getBuiltInObject(this._scope, 'bool');

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

    private _getTypeFromUnaryExpression(node: UnaryExpressionNode): TypeResult {
        let exprType = this.getType(node.expression);

        // Map unary operators to magic functions. Note that the bitwise
        // invert has two magic functions that are aliases of each other.
        const unaryOperatorMap: { [operator: number]: string } = {
            [OperatorType.Add]: '__pos__',
            [OperatorType.Subtract]: '__neg__',
            [OperatorType.BitwiseInvert]: '__invert__'
        };

        let type: Type | undefined;

        if (node.operator !== OperatorType.Not) {
            if (TypeUtils.isOptionalType(exprType)) {
                this._addDiagnostic(
                    this._fileInfo.diagnosticSettings.reportOptionalOperand,
                    DiagnosticRule.reportOptionalOperand,
                    `Operator '${ ParseTreeUtils.printOperator(node.operator) }' not ` +
                    `supported for 'None' type`,
                    node.expression);
                exprType = removeNoneFromUnion(exprType);
            }
        }

        // __not__ always returns a boolean.
        if (node.operator === OperatorType.Not) {
            type = ScopeUtils.getBuiltInObject(this._scope, 'bool');
            if (!type) {
                type = UnknownType.create();
            }
        } else {
            if (isAnyOrUnknown(exprType)) {
                type = exprType;
            } else {
                const magicMethodName = unaryOperatorMap[node.operator];
                type = this._getTypeFromMagicMethodReturn(exprType, [],
                    magicMethodName, node);
            }

            if (!type) {
                this._addError(`Operator '${ ParseTreeUtils.printOperator(node.operator) }'` +
                    ` not supported for type '${ printType(exprType) }'`,
                    node);
                type = UnknownType.create();
            }
        }

        return { type, node };
    }

    private _getTypeFromBinaryExpression(node: BinaryExpressionNode): TypeResult {
        let leftType = this.getType(node.leftExpression);

        // Is this an AND operator? If so, we can assume that the
        // rightExpression won't be evaluated at runtime unless the
        // leftExpression evaluates to true.
        let typeConstraints: ConditionalTypeConstraintResults | undefined;
        let useIfConstraint = true;
        if (node.operator === OperatorType.And || node.operator === OperatorType.Or) {
            typeConstraints = this._buildTypeConstraints(node.leftExpression);
            useIfConstraint = node.operator === OperatorType.And;
        }

        let rightType: Type = UnknownType.create();
        this._useExpressionTypeConstraint(typeConstraints, useIfConstraint, () => {
            rightType = this.getType(node.rightExpression);
        });

        // Optional checks apply to all operations except for boolean operations.
        if (booleanOperatorMap[node.operator] === undefined) {
            if (TypeUtils.isOptionalType(leftType)) {
                // Skip the optional error reporting for == and !=, since
                // None is a valid operand for these operators.
                if (node.operator !== OperatorType.Equals && node.operator !== OperatorType.NotEquals) {
                    this._addDiagnostic(
                        this._fileInfo.diagnosticSettings.reportOptionalOperand,
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
            type: this._validateBinaryExpression(node.operator, leftType, rightType, node),
            node
        };
    }

    private _getTypeFromAugmentedExpression(node: AugmentedAssignmentExpressionNode): TypeResult {
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

        const leftType = this.getType(node.leftExpression);
        const rightType = this.getType(node.rightExpression);

        if (!isAnyOrUnknown(leftType) && !isAnyOrUnknown(rightType)) {
            const magicMethodName = operatorMap[node.operator][0];
            type = this._getTypeFromMagicMethodReturn(rightType, [leftType],
                magicMethodName, node);
        }

        // If the LHS class didn't support the magic method for augmented
        // assignment, fall back on the normal binary expression evaluator.
        if (!type) {
            const binaryOperator = operatorMap[node.operator][1];
            type = this._validateBinaryExpression(binaryOperator, leftType, rightType, node);
        }

        return { type, node };
    }

    private _validateBinaryExpression(operator: OperatorType, leftType: Type, rightType: Type,
            errorNode: ExpressionNode): Type {

        let type: Type | undefined;

        if (arithmeticOperatorMap[operator]) {
            if (isAnyOrUnknown(leftType) || isAnyOrUnknown(rightType)) {
                // If either type is "Unknown" (versus Any), propagate the Unknown.
                if (leftType.category === TypeCategory.Unknown || rightType.category === TypeCategory.Unknown) {
                    type = UnknownType.create();
                } else {
                    type = AnyType.create();
                }
            } else {
                const supportsBuiltInTypes = arithmeticOperatorMap[operator][2];

                if (supportsBuiltInTypes) {
                    const simplifiedLeftType = removeAnyFromUnion(leftType);
                    const simplifiedRightType = removeAnyFromUnion(rightType);
                    if (simplifiedLeftType.category === TypeCategory.Object && simplifiedRightType.category === TypeCategory.Object) {
                        const builtInClassTypes = this._getBuiltInClassTypes(['int', 'float', 'complex']);
                        const getTypeMatch = (classType: ClassType): boolean[] => {
                            let foundMatch = false;
                            return builtInClassTypes.map(builtInType => {
                                if (builtInType && ClassType.isSameGenericClass(builtInType, classType)) {
                                    foundMatch = true;
                                }
                                return foundMatch;
                            });
                        };

                        const leftClassMatches = getTypeMatch(simplifiedLeftType.classType);
                        const rightClassMatches = getTypeMatch(simplifiedRightType.classType);

                        if (leftClassMatches[0] && rightClassMatches[0]) {
                            // If they're both int types, the result is an int.
                            type = ObjectType.create(builtInClassTypes[0]!);
                        } else if (leftClassMatches[1] && rightClassMatches[1]) {
                            // If they're both floats or one is a float and one is an int,
                            // the result is a float.
                            type = ObjectType.create(builtInClassTypes[1]!);
                        } else if (leftClassMatches[2] && rightClassMatches[2]) {
                            // If one is complex and the other is complex, float or int,
                            // the result is complex.
                            type = ObjectType.create(builtInClassTypes[2]!);
                        }
                    }
                }
            }

            // Handle the general case.
            if (!type) {
                const magicMethodName = arithmeticOperatorMap[operator][0];
                type = this._getTypeFromMagicMethodReturn(leftType, [rightType],
                    magicMethodName, errorNode);

                if (!type) {
                    const altMagicMethodName = arithmeticOperatorMap[operator][1];
                    type = this._getTypeFromMagicMethodReturn(rightType, [leftType],
                        altMagicMethodName, errorNode);
                }
            }
        } else if (bitwiseOperatorMap[operator]) {
            if (isAnyOrUnknown(leftType) || isAnyOrUnknown(rightType)) {
                // If either type is "Unknown" (versus Any), propagate the Unknown.
                if (leftType.category === TypeCategory.Unknown || rightType.category === TypeCategory.Unknown) {
                    type = UnknownType.create();
                } else {
                    type = AnyType.create();
                }
            } else if (leftType.category === TypeCategory.Object && rightType.category === TypeCategory.Object) {
                const intType = ScopeUtils.getBuiltInType(this._scope, 'int');
                const leftIsInt = intType.category === TypeCategory.Class &&
                    ClassType.isSameGenericClass(leftType.classType, intType);
                const rightIsInt = intType.category === TypeCategory.Class &&
                    ClassType.isSameGenericClass(rightType.classType, intType);

                if (leftIsInt && rightIsInt) {
                    type = ObjectType.create(intType as ClassType);
                }
            }

            // Handle the general case.
            if (!type) {
                const magicMethodName = bitwiseOperatorMap[operator][0];
                type = this._getTypeFromMagicMethodReturn(leftType, [rightType],
                    magicMethodName, errorNode);
            }
        } else if (comparisonOperatorMap[operator]) {
            if (isAnyOrUnknown(leftType) || isAnyOrUnknown(rightType)) {
                // If either type is "Unknown" (versus Any), propagate the Unknown.
                if (leftType.category === TypeCategory.Unknown || rightType.category === TypeCategory.Unknown) {
                    type = UnknownType.create();
                } else {
                    type = AnyType.create();
                }
            } else {
                const magicMethodName = comparisonOperatorMap[operator];

                type = this._getTypeFromMagicMethodReturn(leftType, [rightType],
                    magicMethodName, errorNode);
            }
        } else if (booleanOperatorMap[operator]) {
            if (operator === OperatorType.And) {
                // If the operator is an AND or OR, we need to combine the two types.
                type = combineTypes([
                    TypeUtils.removeTruthinessFromType(leftType), rightType]);
            } else if (operator === OperatorType.Or) {
                type = combineTypes([
                    TypeUtils.removeFalsinessFromType(leftType), rightType]);
            } else {
                // The other boolean operators always return a bool value.
                type = ScopeUtils.getBuiltInObject(this._scope, 'bool');
            }
        }

        if (!type) {
            this._addError(`Operator '${ ParseTreeUtils.printOperator(operator) }' not ` +
                `supported for types '${ printType(leftType) }' and '${ printType(rightType) }'`,
                errorNode);
            type = UnknownType.create();
        }

        return type;
    }

    private _getTypeFromMagicMethodReturn(objType: Type, args: Type[],
            magicMethodName: string, errorNode: ExpressionNode): Type | undefined {

        let magicMethodSupported = true;

        // Create a helper lambda for object subtypes.
        const handleObjectSubtype = (subtype: ObjectType) => {
            const magicMethodType = this.getTypeFromObjectMember(errorNode,
                subtype, magicMethodName,
                { method: 'get' }, MemberAccessFlags.SkipForMethodLookup);

            if (magicMethodType) {
                const functionArgs = args.map(arg => {
                    return {
                        argumentCategory: ArgumentCategory.Simple,
                        type: arg
                    };
                });

                let returnType: Type | undefined;

                this._silenceDiagnostics(() => {
                    returnType = this._validateCallArguments(errorNode,
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

        const returnType = TypeUtils.doForSubtypes(objType, subtype => {
            if (isAnyOrUnknown(subtype)) {
                return subtype;
            }

            if (subtype.category === TypeCategory.Object) {
                return handleObjectSubtype(subtype);
            } else if (isNoneOrNever(subtype)) {
                // NoneType derives from 'object', so do the lookup on 'object'
                // in this case.
                const obj = ScopeUtils.getBuiltInObject(this._scope, 'object');
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

    private _getBuiltInClassTypes(names: string[]): (ClassType | undefined)[] {
        return names.map(name => {
            const classType = ScopeUtils.getBuiltInType(this._scope, name);
            return classType.category === TypeCategory.Class ? classType : undefined;
        });
    }

    private _getTypeFromSetExpression(node: SetNode, usage: EvaluatorUsage): TypeResult {
        const entryTypes: Type[] = [];

        // Infer the set type based on the entries.
        node.entries.forEach(entryNode => {
            if (entryNode.nodeType === ParseNodeType.ListComprehension) {
                const setEntryType = this._getElementTypeFromListComprehensionExpression(entryNode);
                entryTypes.push(setEntryType);
            } else {
                entryTypes.push(this._getTypeFromExpression(entryNode).type);
            }
        });

        // If there is an expected type, see if we can match any parts of it.
        if (usage.expectedType && entryTypes.length > 0) {
            const specificSetType = ScopeUtils.getBuiltInObject(
                this._scope, 'set', [combineTypes(entryTypes)]);
            const remainingExpectedType = TypeUtils.constrainDeclaredTypeBasedOnAssignedType(
                usage.expectedType, specificSetType);

            // Have we eliminated all of the expected subtypes? If not, return
            // the remaining one(s) that match the specific type.
            if (remainingExpectedType.category !== TypeCategory.Never) {
                return { type: remainingExpectedType, node };
            }

            return { type: specificSetType, node };
        }

        const inferredEntryType = entryTypes.length > 0 ?
            combineTypes(entryTypes.map(t => TypeUtils.stripLiteralValue(t))) :
            AnyType.create();

        const type = ScopeUtils.getBuiltInObject(this._scope, 'set', [inferredEntryType]);

        return { type, node };
    }

    private _getTypeFromDictionaryExpression(node: DictionaryNode, usage: EvaluatorUsage): TypeResult {
        let valueType: Type = AnyType.create();
        let keyType: Type = AnyType.create();

        let keyTypes: Type[] = [];
        let valueTypes: Type[] = [];

        // Infer the key and value types if possible.
        node.entries.forEach(entryNode => {
            let addUnknown = true;

            if (entryNode.nodeType === ParseNodeType.DictionaryKeyEntry) {
                keyTypes.push(this.getType(entryNode.keyExpression));
                valueTypes.push(this.getType(entryNode.valueExpression));
                addUnknown = false;

            } else if (entryNode.nodeType === ParseNodeType.DictionaryExpandEntry) {
                const unexpandedType = this.getType(entryNode.expandExpression);
                if (isAnyOrUnknown(unexpandedType)) {
                    addUnknown = false;
                } else {
                    if (unexpandedType.category === TypeCategory.Object) {
                        let classType = unexpandedType.classType;
                        const aliasClass = ClassType.getAliasClass(classType);
                        if (aliasClass) {
                            classType = aliasClass;
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
                const dictEntryType = this._getElementTypeFromListComprehensionExpression(
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
        if (usage.expectedType && keyTypes.length > 0) {
            const specificDictType = ScopeUtils.getBuiltInObject(
                this._scope, 'dict', [combineTypes(keyTypes), combineTypes(valueTypes)]);
            const remainingExpectedType = TypeUtils.constrainDeclaredTypeBasedOnAssignedType(
                usage.expectedType, specificDictType);

            // Have we eliminated all of the expected subtypes? If not, return
            // the remaining one(s) that match the specific type.
            if (remainingExpectedType.category !== TypeCategory.Never) {
                return { type: remainingExpectedType, node };
            }

            return { type: specificDictType, node };
        }

        // Strip any literal values.
        keyTypes = keyTypes.map(t => TypeUtils.stripLiteralValue(t));
        valueTypes = valueTypes.map(t => TypeUtils.stripLiteralValue(t));

        keyType = keyTypes.length > 0 ? combineTypes(keyTypes) : AnyType.create();

        // If the value type differs and we're not using "strict inference mode",
        // we need to back off because we can't properly represent the mappings
        // between different keys and associated value types. If all the values
        // are the same type, we'll assume that all values in this dictionary should
        // be the same.
        if (valueTypes.length > 0) {
            if (this._fileInfo.diagnosticSettings.strictDictionaryInference) {
                valueType = combineTypes(valueTypes);
            } else {
                valueType = TypeUtils.areTypesSame(valueTypes) ? valueTypes[0] : UnknownType.create();
            }
        } else {
            valueType = AnyType.create();
        }

        const type = ScopeUtils.getBuiltInObject(this._scope, 'dict', [keyType, valueType]);

        return { type, node };
    }

    private _getTypeFromListExpression(node: ListNode, usage: EvaluatorUsage): TypeResult {
        let listEntryType: Type = AnyType.create();

        if (node.entries.length === 1 && node.entries[0].nodeType === ParseNodeType.ListComprehension) {
            listEntryType = this._getElementTypeFromListComprehensionExpression(node.entries[0]);
        } else {
            let entryTypes = node.entries.map(entry => this.getType(entry));

            // If there is an expected type, see if we can match any parts of it.
            if (usage.expectedType && entryTypes.length > 0) {
                const specificListType = ScopeUtils.getBuiltInObject(
                    this._scope, 'list', [combineTypes(entryTypes)]);
                const remainingExpectedType = TypeUtils.constrainDeclaredTypeBasedOnAssignedType(
                    usage.expectedType, specificListType);

                // Have we eliminated all of the expected subtypes? If not, return
                // the remaining one(s) that match the specific type.
                if (remainingExpectedType.category !== TypeCategory.Never) {
                    return { type: remainingExpectedType, node };
                }

                return { type: specificListType, node };
            }

            entryTypes = entryTypes.map(t => TypeUtils.stripLiteralValue(t));

            if (entryTypes.length > 0) {
                if (this._fileInfo.diagnosticSettings.strictListInference) {
                    listEntryType = combineTypes(entryTypes);
                } else {
                    // Is the list homogeneous? If so, use stricter rules. Otherwise relax the rules.
                    listEntryType = TypeUtils.areTypesSame(entryTypes) ? entryTypes[0] : UnknownType.create();
                }
            }
        }

        const type = ScopeUtils.getBuiltInObject(this._scope, 'list', [listEntryType]);

        return { type, node };
    }

    private _getTypeFromTernaryExpression(node: TernaryExpressionNode, flags: EvaluatorFlags,
            usage: EvaluatorUsage): TypeResult {

        this._getTypeFromExpression(node.testExpression);

        // Apply the type constraint when evaluating the if and else clauses.
        const typeConstraints = this._buildTypeConstraints(node.testExpression);

        let ifType: TypeResult | undefined;
        this._useExpressionTypeConstraint(typeConstraints, true, () => {
            ifType = this._getTypeFromExpression(node.ifExpression,
                { method: 'get' }, flags);
        });

        let elseType: TypeResult | undefined;
        this._useExpressionTypeConstraint(typeConstraints, false, () => {
            elseType = this._getTypeFromExpression(node.elseExpression,
                { method: 'get' }, flags);
        });

        const type = combineTypes([ifType!.type, elseType!.type]);
        return { type, node };
    }

    private _getTypeFromYieldExpression(node: YieldExpressionNode): TypeResult {
        let sentType: Type | undefined;

        const enclosingFunction = ParseTreeUtils.getEnclosingFunction(node);
        if (enclosingFunction) {
            const functionType = AnalyzerNodeInfo.getExpressionType(enclosingFunction) as FunctionType;
            assert(functionType.category === TypeCategory.Function);
            sentType = TypeUtils.getDeclaredGeneratorSendType(functionType);
        }

        if (!sentType) {
            sentType = UnknownType.create();
        }

        return { type: sentType, node };
    }

    private _getTypeFromYieldFromExpression(node: YieldFromExpressionNode): TypeResult {
        let sentType: Type | undefined;

        const enclosingFunction = ParseTreeUtils.getEnclosingFunction(node);
        if (enclosingFunction) {
            const functionType = AnalyzerNodeInfo.getExpressionType(enclosingFunction) as FunctionType;
            assert(functionType.category === TypeCategory.Function);
            sentType = TypeUtils.getDeclaredGeneratorSendType(functionType);
        }

        if (!sentType) {
            sentType = UnknownType.create();
        }

        return { type: sentType, node };
    }

    private _getTypeFromLambdaExpression(node: LambdaNode): TypeResult {
        // The lambda node is updated by typeAnalyzer. If the type wasn't
        // already cached, we'll return an unknown type.
        let type = AnalyzerNodeInfo.getExpressionType(node);
        if (!type) {
            type = UnknownType.create();
        }

        return { type, node };
    }

    private _getTypeFromListComprehensionExpression(node: ListComprehensionNode): TypeResult {
        const elementType = this._getElementTypeFromListComprehensionExpression(node);

        let type: Type = UnknownType.create();
        const builtInIteratorType = this.getTypingType('Generator');

        if (builtInIteratorType && builtInIteratorType.category === TypeCategory.Class) {
            type = ObjectType.create(ClassType.cloneForSpecialization(builtInIteratorType, [elementType]));
        }

        return { type, node };
    }

    private _assignTypeToNameNode(targetExpr: NameNode, type: Type) {
        const symbol = this._scope.lookUpSymbol(targetExpr.nameToken.value)!;
        assert(symbol !== undefined);
        symbol.setInferredTypeForSource(type, targetExpr.id);

        // Mark the symbol as accessed. These symbols are not persisted
        // between analysis passes, so we never have an opportunity to
        // mark them as accessed.
        symbol.setIsAccessed();

        const typeConstraint = TypeConstraintBuilder.buildTypeConstraintForAssignment(targetExpr, type);
        if (typeConstraint) {
            this._scope.addTypeConstraint(typeConstraint);
        }
    }

    private _assignTypeToExpression(targetExpr: ExpressionNode, type: Type, srcExpr: ExpressionNode): boolean {
        let understoodType = true;

        if (targetExpr.nodeType === ParseNodeType.Name) {
            this._assignTypeToNameNode(targetExpr, type);
        } else if (targetExpr.nodeType === ParseNodeType.Tuple) {
            // Initialize the array of target types, one for each target.
            const targetTypes: Type[][] = new Array(targetExpr.expressions.length);
            for (let i = 0; i < targetExpr.expressions.length; i++) {
                targetTypes[i] = [];
            }

            TypeUtils.doForSubtypes(type, subtype => {
                // Is this subtype a tuple?
                const tupleType = TypeUtils.getSpecializedTupleType(subtype);
                if (tupleType && ClassType.getTypeArguments(tupleType)) {
                    const entryTypes = ClassType.getTypeArguments(tupleType)!;
                    let entryCount = entryTypes.length;
                    const allowsMoreEntries = entryCount > 0 &&
                        TypeUtils.isEllipsisType(entryTypes[entryCount - 1]);
                    if (allowsMoreEntries) {
                        entryCount--;
                    }

                    if (targetExpr.expressions.length === entryCount ||
                            (allowsMoreEntries && targetExpr.expressions.length >= entryCount)) {
                        for (let index = 0; index < targetExpr.expressions.length; index++) {
                            const entryType = index < entryCount ? entryTypes[index] : UnknownType.create();
                            targetTypes[index].push(entryType);
                        }
                    }
                } else {
                    // The assigned expression isn't a tuple, so it had better
                    // be some iterable type.
                    const iterableType = this.getTypeFromIterable(subtype, false, srcExpr, false);
                    for (let index = 0; index < targetExpr.expressions.length; index++) {
                        targetTypes[index].push(iterableType);
                    }
                }

                // We need to return something to satisfy doForSubtypes.
                return undefined;
            });

            // Assign the resulting types to the individual names in the tuple target expression.
            targetExpr.expressions.forEach((expr, index) => {
                const typeList = targetTypes[index];
                const targetType = typeList.length === 0 ? UnknownType.create() : combineTypes(typeList);
                if (!this._assignTypeToExpression(expr, targetType, srcExpr)) {
                    understoodType = false;
                }
            });
        } else {
            // We should theoretically never get here.
            understoodType = false;
        }

        // Cache the type so we don't evaluate it again.
        if (this._writeTypeToCache) {
            this._writeTypeToCache(targetExpr, type);
        }

        return understoodType;
    }

    // Returns the type of one entry returned by the list comprehension,
    // as opposed to the entire list.
    private _getElementTypeFromListComprehensionExpression(node: ListComprehensionNode): Type {
        // Switch to a dedicated scope since list comprehension target
        // variables are private to the list comprehension expression.
        const prevScope = this._scope;
        this._scope = AnalyzerNodeInfo.getScope(node)!;

        // Temporarily re-parent the scope in case the prevScope was
        // a temporary one.
        const prevParent = this._scope.getParent();
        this._scope.setParent(prevScope);

        // There are some variants that we may not understand. If so,
        // we will set this flag and fall back on Unknown.
        let understoodType = true;

        let typeConstraints: ConditionalTypeConstraintResults | undefined;

        // "Execute" the list comprehensions from start to finish.
        for (const comprehension of node.comprehensions) {
            if (comprehension.nodeType === ParseNodeType.ListComprehensionFor) {
                const iterableType = TypeUtils.stripLiteralValue(
                    this.getType(comprehension.iterableExpression));
                const itemType = this.getTypeFromIterable(iterableType, !!comprehension.isAsync,
                    comprehension.iterableExpression, false);

                const targetExpr = comprehension.targetExpression;
                if (!this._assignTypeToExpression(targetExpr, itemType, comprehension.iterableExpression)) {
                    understoodType = false;
                    break;
                }
            } else if (comprehension.nodeType === ParseNodeType.ListComprehensionIf) {
                // Use the if node (if present) to create a type constraint.
                typeConstraints = TypeConstraintBuilder.buildTypeConstraintsForConditional(
                    comprehension.testExpression, expr => TypeUtils.stripLiteralValue(
                        this.getType(expr)));
            }
        }

        let type: Type = UnknownType.create();
        this._useExpressionTypeConstraint(typeConstraints, true, () => {
            if (understoodType) {
                if (node.expression.nodeType === ParseNodeType.DictionaryKeyEntry) {
                    // Create a tuple with the key/value types.
                    const keyType = TypeUtils.stripLiteralValue(
                        this.getType(node.expression.keyExpression));
                    const valueType = TypeUtils.stripLiteralValue(
                        this.getType(node.expression.valueExpression));

                    type = ScopeUtils.getBuiltInObject(
                        this._scope, 'Tuple', [keyType, valueType]);
                } else if (node.expression.nodeType === ParseNodeType.DictionaryExpandEntry) {
                    const unexpandedType = this.getType(node.expression.expandExpression);

                    // TODO - need to implement
                } else if (isExpressionNode(node)) {
                    type = TypeUtils.stripLiteralValue(this.getType(node.expression as ExpressionNode));
                }
            }
        });

        this._scope.setParent(prevParent);
        this._scope = prevScope;

        return type;
    }

    private _getTypeFromSliceExpression(node: SliceExpressionNode): TypeResult {
        const intObject = ScopeUtils.getBuiltInObject(this._scope, 'int');
        const optionalIntObject = combineTypes([intObject, NoneType.create()]);

        const validateIndexType = (indexExpr: ExpressionNode) => {
            const exprType = TypeUtils.stripLiteralValue(this.getType(indexExpr));

            const diag = new DiagnosticAddendum();
            if (!TypeUtils.canAssignType(optionalIntObject, exprType, diag)) {
                this._addError(
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

        const sliceObject = ScopeUtils.getBuiltInObject(this._scope, 'slice');
        return { type: sliceObject, node };
    }

    // Converts the type parameters for a Callable type. It should
    // have zero to two parameters. The first parameter, if present, should be
    // either an ellipsis or a list of parameter types. The second parameter, if
    // present, should specify the return type.
    private _createCallableType(typeArgs?: TypeResult[]): FunctionType {
        const functionType = FunctionType.create(FunctionTypeFlags.None);
        FunctionType.setDeclaredReturnType(functionType, AnyType.create());

        if (typeArgs && typeArgs.length > 0) {
            if (typeArgs[0].typeList) {
                typeArgs[0].typeList.forEach((entry, index) => {
                    if (TypeUtils.isEllipsisType(entry.type)) {
                        this._addError(`'...' not allowed in this context`, entry.node);
                    } else if (entry.type.category === TypeCategory.Module) {
                        this._addError(`Module not allowed in this context`, entry.node);
                    }

                    FunctionType.addParameter(functionType, {
                        category: ParameterCategory.Simple,
                        name: `p${ index.toString() }`,
                        type: TypeUtils.convertClassToObject(entry.type)
                    });
                });
            } else if (TypeUtils.isEllipsisType(typeArgs[0].type)) {
                TypeUtils.addDefaultFunctionParameters(functionType);
            } else {
                this._addError(`Expected parameter type list or '...'`, typeArgs[0].node);
            }
        } else {
            TypeUtils.addDefaultFunctionParameters(functionType);
        }

        if (typeArgs && typeArgs.length > 1) {
            if (TypeUtils.isEllipsisType(typeArgs[1].type)) {
                this._addError(`'...' not allowed in this context`, typeArgs[1].node);
            } else if (typeArgs[1].type.category === TypeCategory.Module) {
                this._addError(`Module not allowed in this context`, typeArgs[1].node);
            }
            FunctionType.setDeclaredReturnType(functionType, TypeUtils.convertClassToObject(typeArgs[1].type));
        } else {
            FunctionType.setDeclaredReturnType(functionType, AnyType.create());
        }

        if (typeArgs && typeArgs.length > 2) {
            this._addError(`Expected only two type arguments to 'Callable'`, typeArgs[2].node);
        }

        return functionType;
    }

    // Creates an Optional[X, Y, Z] type.
    private _createOptionalType(errorNode: ParseNode, typeArgs?: TypeResult[]): Type {
        if (!typeArgs || typeArgs.length !== 1) {
            this._addError(`Expected one type parameter after Optional`, errorNode);
            return UnknownType.create();
        }

        if (TypeUtils.isEllipsisType(typeArgs[0].type)) {
            this._addError(`'...' not allowed in this context`, typeArgs[0].node);
        } else if (typeArgs[0].type.category === TypeCategory.Module) {
            this._addError(`Module not allowed in this context`, typeArgs[0].node);
        }

        return combineTypes([
            TypeUtils.convertClassToObject(typeArgs[0].type),
            NoneType.create()]);
    }

    private _cloneBuiltinTypeWithLiteral(builtInName: string, value: LiteralValue): Type {
        let type = ScopeUtils.getBuiltInObject(this._scope, builtInName);
        if (type.category === TypeCategory.Object) {
            type = ObjectType.cloneWithLiteral(type, value);
        }

        return type;
    }

    // Creates a type that represents a Literal. This is not an officially-supported
    // feature of Python but is instead a mypy extension described here:
    // https://mypy.readthedocs.io/en/latest/literal_types.html
    private _createLiteralType(node: IndexExpressionNode): Type {
        if (node.items.items.length === 0) {
            this._addError(`Expected a type parameter after Literal`, node.baseExpression);
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
                    type = this._cloneBuiltinTypeWithLiteral('bytes', value);
                } else {
                    type = this._cloneBuiltinTypeWithLiteral('str', value);
                }
            } else if (item.nodeType === ParseNodeType.Number) {
                if (item.token.isInteger) {
                    type = this._cloneBuiltinTypeWithLiteral('int', item.token.value);
                }
            } else if (item.nodeType === ParseNodeType.Constant) {
                if (item.token.keywordType === KeywordType.True) {
                    type = this._cloneBuiltinTypeWithLiteral('bool', true);
                } else if (item.token.keywordType === KeywordType.False) {
                    type = this._cloneBuiltinTypeWithLiteral('bool', false);
                }
            }

            if (!type) {
                this._addError(`Type arguments for Literal must be an int, bool, str, or bytes value`,
                    item);
                type = UnknownType.create();
            }

            literalTypes.push(type);
        }

        return TypeUtils.convertClassToObject(combineTypes(literalTypes));
    }

    // Creates a ClassVar type.
    private _createClassVarType(errorNode: ParseNode, typeArgs: TypeResult[] | undefined): Type {
        if (!typeArgs || typeArgs.length === 0) {
            this._addError(`Expected a type parameter after ClassVar`, errorNode);
            return UnknownType.create();
        } else if (typeArgs.length > 1) {
            this._addError(`Expected only one type parameter after ClassVar`, typeArgs[1].node);
            return UnknownType.create();
        }

        const type = typeArgs[0].type;

        if (requiresSpecialization(type)) {
            this._addError(`ClassVar cannot contain generic type variables`,
                typeArgs.length > 0 ? typeArgs[0].node : errorNode);
            return UnknownType.create();
        }

        return TypeUtils.convertClassToObject(type);
    }

    // Creates one of several "special" types that are defined in typing.pyi
    // but not declared in their entirety. This includes the likes of "Tuple",
    // "Dict", etc.
    private _createSpecialType(classType: ClassType, typeArgs: TypeResult[] | undefined,
            paramLimit?: number, allowEllipsis = false): Type {

        if (typeArgs) {
            // Verify that we didn't receive any inappropriate ellipses or modules.
            typeArgs.forEach((typeArg, index) => {
                if (TypeUtils.isEllipsisType(typeArg.type)) {
                    if (!allowEllipsis || index !== typeArgs.length - 1) {
                        this._addError(`'...' not allowed in this context`, typeArgs[index].node);
                    }
                    if (typeArg.type.category === TypeCategory.Module) {
                        this._addError(`Module not allowed in this context`, typeArg.node);
                    }
                }
            });
        }

        let typeArgTypes = typeArgs ? typeArgs.map(
            t => TypeUtils.convertClassToObject(t.type)) : [];

        // Make sure the argument list count is correct.
        if (paramLimit !== undefined) {
            if (typeArgs && typeArgTypes.length > paramLimit) {
                this._addError(
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

        const specializedType = ClassType.cloneForSpecialization(classType, typeArgTypes);

        return specializedType;
    }

    // Unpacks the index expression for a "Union[X, Y, Z]" type annotation.
    private _createUnionType(typeArgs?: TypeResult[]): Type {
        const types: Type[] = [];

        if (typeArgs) {
            for (const typeArg of typeArgs) {
                types.push(typeArg.type);

                // Verify that we didn't receive any inappropriate ellipses.
                if (TypeUtils.isEllipsisType(typeArg.type)) {
                    this._addError(`'...' not allowed in this context`, typeArg.node);
                } else if (typeArg.type.category === TypeCategory.Module) {
                    this._addError(`Module not allowed in this context`, typeArg.node);
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
    private _createGenericType(errorNode: ParseNode, classType: ClassType,
            typeArgs?: TypeResult[]): Type {

        // Make sure there's at least one type arg.
        if (!typeArgs || typeArgs.length === 0) {
            this._addError(
                `'Generic' requires at least one type argument`, errorNode);
        }

        // Make sure that all of the type args are typeVars and are unique.
        const uniqueTypeVars: TypeVarType[] = [];
        if (typeArgs) {
            typeArgs.forEach(typeArg => {
                if (!(typeArg.type.category === TypeCategory.TypeVar)) {
                    this._addError(
                        `Type argument for 'Generic' must be a type variable`, typeArg.node);
                } else {
                    for (const typeVar of uniqueTypeVars) {
                        if (typeVar === typeArg.type) {
                            this._addError(
                                `Type argument for 'Generic' must be unique`, typeArg.node);
                            break;
                        }
                    }

                    uniqueTypeVars.push(typeArg.type);
                }
            });
        }

        return this._createSpecialType(classType, typeArgs);
    }

    private _applyTypeConstraint(node: ExpressionNode, unconstrainedType: Type): Type {
        // Shortcut the process if the type is unknown.
        if (isAnyOrUnknown(unconstrainedType)) {
            return unconstrainedType;
        }

        // Apply constraints from the current scope and its outer scopes.
        let constrainedType = this._applyScopeTypeConstraintRecursive(
            node, unconstrainedType);

        // Apply constraints associated with the expression we're
        // currently walking.
        this._expressionTypeConstraints.forEach(constraint => {
            constrainedType = constraint.applyToType(node, constrainedType);
        });

        return constrainedType;
    }

    private _applyScopeTypeConstraintRecursive(node: ExpressionNode, type: Type,
            scope = this._scope): Type {

        // If we've hit a scope that is independently executable, don't recur any further.
        if (!scope.isIndependentlyExecutable()) {
            // Recursively allow the parent scopes to apply their type constraints.
            const parentScope = scope.getParent();
            if (parentScope) {
                type = this._applyScopeTypeConstraintRecursive(node, type, parentScope);
            }
        }

        // Apply the constraints within the current scope. Stop if one of
        // them indicates that further constraints shouldn't be applied.
        for (const constraint of scope.getTypeConstraints()) {
            type = constraint.applyToType(node, type);
        }

        return type;
    }

    // Specializes the specified (potentially generic) class type using
    // the specified type arguments, reporting errors as appropriate.
    // Returns the specialized type and a boolean indicating whether
    // the type indicates a class type (true) or an object type (false).
    private _createSpecializedClassType(classType: ClassType, typeArgs: TypeResult[] | undefined,
            errorNode: ParseNode): Type {

        // Handle the special-case classes that are not defined
        // in the type stubs.
        if (ClassType.isSpecialBuiltIn(classType)) {
            const className = ClassType.getClassName(classType);

            switch (className) {
                case 'Callable': {
                    return this._createCallableType(typeArgs);
                }

                case 'Optional': {
                    return this._createOptionalType(errorNode, typeArgs);
                }

                case 'Type': {
                    return this._createSpecialType(classType, typeArgs, 1);
                }

                case 'ClassVar': {
                    return this._createClassVarType(errorNode, typeArgs);
                }

                case 'Deque':
                case 'List':
                case 'FrozenSet':
                case 'Set': {
                    return this._createSpecialType(classType, typeArgs, 1);
                }

                case 'ChainMap':
                case 'Dict':
                case 'DefaultDict': {
                    return this._createSpecialType(classType, typeArgs, 2);
                }

                case 'Protocol': {
                    return this._createSpecialType(classType, typeArgs, undefined);
                }

                case 'Tuple': {
                    return this._createSpecialType(classType, typeArgs, undefined, true);
                }

                case 'Union': {
                    return this._createUnionType(typeArgs);
                }

                case 'Generic':
                    return this._createGenericType(errorNode, classType, typeArgs);
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
                this._addError(`Expected no type arguments`,
                    typeArgs[typeParameters.length].node);
            } else {
                this._addError(
                    `Expected at most ${ typeParameters.length } ` +
                        `type ${ typeParameters.length === 1 ? 'argument' : 'arguments' } `,
                    typeArgs[typeParameters.length].node);
            }
            typeArgCount = typeParameters.length;
        }

        if (typeArgs) {
            typeArgs.forEach(typeArg => {
                // Verify that we didn't receive any inappropriate ellipses or modules.
                if (TypeUtils.isEllipsisType(typeArg.type)) {
                    this._addError(`'...' not allowed in this context`, typeArg.node);
                } else if (typeArg.type.category === TypeCategory.Module) {
                    this._addError(`Module not allowed in this context`, typeArg.node);
                }
            });
        }

        // Fill in any missing type arguments with Any.
        const typeArgTypes = typeArgs ? typeArgs.map(
            t => TypeUtils.convertClassToObject(t.type)) : [];
        const typeParams = ClassType.getTypeParameters(classType);
        for (let i = typeArgTypes.length; i < typeParams.length; i++) {
            typeArgTypes.push(TypeUtils.specializeTypeVarType(typeParams[i]));
        }

        typeArgTypes.forEach((typeArgType, index) => {
            if (index < typeArgCount) {
                const diag = new DiagnosticAddendum();
                if (!TypeUtils.canAssignToTypeVar(typeParameters[index], typeArgType, diag)) {
                    this._addError(`Type '${ printType(typeArgType) }' ` +
                            `cannot be assigned to type variable '${ typeParameters[index].name }'` +
                            diag.getString(),
                        typeArgs![index].node);
                }
            }
        });

        const specializedClass = ClassType.cloneForSpecialization(classType, typeArgTypes);

        return specializedClass;
    }

    private _useExpressionTypeConstraint(typeConstraints:
            ConditionalTypeConstraintResults | undefined,
            useIfClause: boolean, callback: () => void) {

        // Push the specified constraints onto the list.
        let itemsToPop = 0;
        if (typeConstraints) {
            const constraintsToUse = useIfClause ?
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
        return TypeConstraintBuilder.buildTypeConstraintsForConditional(node,
            (node: ExpressionNode) => this.getType(node));
    }

    private _silenceDiagnostics(callback: () => void) {
        const oldDiagSink = this._diagnosticSink;
        this._diagnosticSink = undefined;

        callback();

        this._diagnosticSink = oldDiagSink;
    }

    private _addWarning(message: string, range: TextRange) {
        if (this._diagnosticSink) {
            return this._diagnosticSink.addWarningWithTextRange(message, range);
        }

        return undefined;
    }

    private _addError(message: string, range: TextRange) {
        if (this._diagnosticSink) {
            return this._diagnosticSink.addErrorWithTextRange(message, range);
        }

        return undefined;
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
    }
}
