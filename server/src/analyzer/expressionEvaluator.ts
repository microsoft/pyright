/*
* expressionEvaluator.ts
* Copyright (c) Microsoft Corporation. All rights reserved.
* Author: Eric Traut
*
* Class that evaluates the type of expressions (parse trees)
* within particular contexts and reports type errors.
*/

import { TextRangeDiagnosticSink } from '../common/diagnosticSink';
import StringMap from '../common/stringMap';
import { TextRange } from '../common/textRange';
import { ArgumentCategory, AssignmentNode, AwaitExpressionNode, BinaryExpressionNode,
    CallExpressionNode, ConditionalExpressionNode, ConstantNode, DictionaryNode,
    EllipsisNode, ExpressionNode, FunctionNode, IndexExpressionNode, LambdaNode,
    ListComprehensionNode, ListNode, MemberAccessExpressionNode, NameNode,
    NumberNode, ParameterCategory, SetNode, SliceExpressionNode, StringNode,
    TupleExpressionNode, UnaryExpressionNode, YieldExpressionNode } from '../parser/parseNodes';
import { KeywordToken, KeywordType, QuoteTypeFlags, TokenType } from '../parser/tokenizerTypes';
import { ScopeUtils } from '../scopeUtils';
import { AnalyzerNodeInfo } from './analyzerNodeInfo';
import { DefaultTypeSourceId } from './inferredType';
import { ParseTreeUtils } from './parseTreeUtils';
import { Scope, ScopeType } from './scope';
import { Symbol, SymbolCategory } from './symbol';
import { TypeConstraint } from './typeConstraint';
import { AnyType, ClassType, ClassTypeFlags, FunctionParameter, FunctionType, FunctionTypeFlags,
    ModuleType, NoneType, ObjectType, OverloadedFunctionType, PropertyType, TupleType, Type,
    TypeVarType, UnionType, UnknownType } from './types';
import { TypeUtils } from './typeUtils';

interface TypeResult {
    type: Type;
    typeList?: TypeResult[];
    isClassOrObjectMember?: boolean;
    node: ExpressionNode;
}

export enum EvaluatorFlags {
    None = 0,

    // Interpret a class type as a instance of that class. This
    // is the normal mode used for type annotations.
    ConvertClassToObject = 1
}

export type ReadTypeFromNodeCacheCallback = (node: ExpressionNode) => Type | undefined;
export type WriteTypeToNodeCacheCallback = (node: ExpressionNode, type: Type) => void;

export class ExpressionEvaluator {
    private _scope: Scope;
    private _expressionTypeConstraints: TypeConstraint[];
    private _diagnosticSink?: TextRangeDiagnosticSink;
    private _readTypeFromCache?: ReadTypeFromNodeCacheCallback;
    private _writeTypeToCache?: WriteTypeToNodeCacheCallback;

    constructor(scope: Scope, expressionTypeConstraints: TypeConstraint[],
            diagnosticSink?: TextRangeDiagnosticSink, readTypeCallback?: ReadTypeFromNodeCacheCallback,
            writeTypeCallback?: WriteTypeToNodeCacheCallback) {
        this._scope = scope;
        this._expressionTypeConstraints = expressionTypeConstraints;
        this._diagnosticSink = diagnosticSink;
        this._readTypeFromCache = readTypeCallback;
        this._writeTypeToCache = writeTypeCallback;
    }

    getType(node: ExpressionNode, flags: EvaluatorFlags): Type {
        let typeResult = this._getTypeFromExpression(node, flags);
        return typeResult.type;
    }

    // Specializes the specified (potentially generic) class type using
    // the specified type arguments, reporting errors as appropriate.
    // Returns the specialized type and a boolean indicating whether
    // the type indiciates a class type (true) or an object type (false).
    specializeClassType(classType: ClassType, typeArgNode: ExpressionNode,
            flags: EvaluatorFlags): Type {
        let typeArgs = this._getTypeArgs(typeArgNode);

        // Handle the special-case classes that are not defined
        // in the type stubs.
        if (classType.isSpecialBuiltIn()) {
            const className = classType.getClassName();

            switch (className) {
                case 'Callable': {
                    return this._createCallableType(typeArgs);
                }

                case 'Optional': {
                    return this._createOptional(typeArgNode, typeArgs);
                }

                case 'Type': {
                    return this._createTypeType(typeArgNode, typeArgs);
                }

                case 'ClassVar':
                case 'Deque':
                case 'List':
                case 'FrozenSet':
                case 'Set': {
                    return this._createSpecialType(classType, typeArgs, flags, 1);
                }

                case 'ChainMap':
                case 'Dict':
                case 'DefaultDict': {
                    return this._createSpecialType(classType, typeArgs, flags, 2);
                }

                case 'Protocol':
                case 'Tuple': {
                    return this._createSpecialType(classType, typeArgs, flags);
                }

                case 'Union': {
                    return this._createUnionType(typeArgs);
                }

                case 'Generic':
                    if (flags & EvaluatorFlags.ConvertClassToObject) {
                        this._addError(`Generic allowed only as base class`, typeArgNode);
                    }
                    return this._createGenericType(typeArgNode, classType, typeArgs);
            }
        }

        if (classType === ScopeUtils.getBuiltInType(this._scope, 'type')) {
            // The built-in 'type' class isn't defined as a generic class.
            // It needs to be special-cased here.
            return this._createTypeType(typeArgNode, typeArgs);
        }

        let specializedType = this._createSpecializedClassType(classType, typeArgs);
        return this._convertClassToObject(specializedType, flags);
    }

    // Determines if the function node is a property accessor (getter, setter, deleter).
    getPropertyType(node: FunctionNode, type: FunctionType): PropertyType | undefined {
        if (ParseTreeUtils.functionHasDecorator(node, 'property')) {
            return new PropertyType(type);
        }

        const setterOrDeleterDecorator = node.decorators.find(decorator => {
            return decorator.callName instanceof MemberAccessExpressionNode &&
                decorator.callName.leftExpression instanceof NameNode &&
                (decorator.callName.memberName.nameToken.value === 'setter' ||
                    decorator.callName.memberName.nameToken.value === 'deleter') &&
                decorator.arguments.length === 0;
        });

        if (setterOrDeleterDecorator) {
            let memberAccessNode = setterOrDeleterDecorator.callName as MemberAccessExpressionNode;
            const propertyName = (memberAccessNode.leftExpression as NameNode).nameToken.value;
            const isSetter = memberAccessNode.memberName.nameToken.value === 'setter';

            let curValue = this._scope.lookUpSymbol(propertyName);

            if (curValue && curValue.currentType instanceof PropertyType) {
                // TODO - check for duplicates.
                // TODO - check for type consistency.
                if (isSetter) {
                    curValue.currentType.setSetter(type);
                } else {
                    curValue.currentType.setDeleter(type);
                }
                return curValue.currentType;
            }
        }

        return undefined;
    }

    getOverloadedFunctionType(node: FunctionNode, type: FunctionType):
            [OverloadedFunctionType | undefined, boolean] {

        let warnIfDuplicate = true;
        let decoratedType: OverloadedFunctionType | undefined;
        let typeSourceId = AnalyzerNodeInfo.getTypeSourceId(node);

        // TODO - make sure this overload decorator is the built-in one.
        if (ParseTreeUtils.functionHasDecorator(node, 'overload')) {
            let existingSymbol = this._scope.lookUpSymbol(node.name.nameToken.value);
            if (existingSymbol && existingSymbol.currentType instanceof OverloadedFunctionType) {
                existingSymbol.currentType.addOverload(typeSourceId, type);
                decoratedType = existingSymbol.currentType;
                warnIfDuplicate = false;
            } else {
                let newOverloadType = new OverloadedFunctionType();
                newOverloadType.addOverload(typeSourceId, type);
                decoratedType = newOverloadType;
            }
        }

        return [decoratedType, warnIfDuplicate];
    }

    private _getTypeFromExpression(node: ExpressionNode, flags: EvaluatorFlags): TypeResult {
        if (this._readTypeFromCache) {
            let cachedType = this._readTypeFromCache(node);
            if (cachedType) {
                return { type: cachedType, node };
            }
        }

        let typeResult: TypeResult | undefined;

        if (node instanceof NameNode) {
            typeResult = this._getTypeFromName(node, flags);
        } else if (node instanceof MemberAccessExpressionNode) {
            typeResult = this._getTypeFromMemberAccessExpression(node, flags);
        } else if (node instanceof IndexExpressionNode) {
            typeResult = this._getTypeFromIndexExpression(node, flags);
        } else if (node instanceof CallExpressionNode) {
            typeResult = this._getTypeFromCallExpression(node, flags);
        } else if (node instanceof TupleExpressionNode) {
            typeResult = this._getTypeFromTupleExpression(node, flags);
        } else if (node instanceof ConstantNode) {
            typeResult = this._getTypeFromConstantExpression(node);
        } else if (node instanceof StringNode) {
            let isBytes = (node.tokens[0].quoteTypeFlags & QuoteTypeFlags.Byte) !== 0;
            typeResult = this._getBuiltInTypeFromLiteralExpression(node,
                isBytes ? 'byte' : 'str');
        } else if (node instanceof NumberNode) {
            typeResult = this._getBuiltInTypeFromLiteralExpression(node,
                node.token.isInteger ? 'int' : 'float');
        } else if (node instanceof EllipsisNode) {
            typeResult = { type: AnyType.create(), node };
        } else if (node instanceof UnaryExpressionNode) {
            // TODO - need to implement
            this._getTypeFromExpression(node.expression, flags);
            typeResult = { type: UnknownType.create(), node };
        } else if (node instanceof BinaryExpressionNode) {
            // TODO - need to implement
            this._getTypeFromExpression(node.leftExpression, flags);
            this._getTypeFromExpression(node.rightExpression, flags);
            typeResult = { type: UnknownType.create(), node };
        } else if (node instanceof ListNode) {
            typeResult = this._getTypeFromListExpression(node);
        } else if (node instanceof SliceExpressionNode) {
            typeResult = this._getTypeFromSliceExpression(node, flags);
        } else if (node instanceof AwaitExpressionNode) {
            // TODO - need to implement
            typeResult = this._getTypeFromExpression(node.expression, flags);
        } else if (node instanceof ConditionalExpressionNode) {
            // TODO - need to implement
            this._getTypeFromExpression(node.ifExpression, EvaluatorFlags.None);

            let leftType = this._getTypeFromExpression(node.leftExpression, flags);
            let rightType = this._getTypeFromExpression(node.elseExpression, flags);
            let type = TypeUtils.combineTypes(leftType.type, rightType.type);
            typeResult = { type, node };
        } else if (node instanceof ListComprehensionNode) {
            // TODO - need to implement
            // TODO - infer list type
            // this._getTypeFromExpression(node.baseExpression, EvaluatorFlags.None);
            let type = ScopeUtils.getBuiltInObject(this._scope, 'list', []);
            typeResult = { type, node };
        } else if (node instanceof DictionaryNode) {
            // TODO - need to implement
            // TODO - infer dict type
            let type = ScopeUtils.getBuiltInObject(this._scope, 'dict', []);
            typeResult = { type, node };
        } else if (node instanceof LambdaNode) {
            // TODO - need to implement
            let type = AnalyzerNodeInfo.getExpressionType(node) || UnknownType.create();
            typeResult = { type, node };
        } else if (node instanceof SetNode) {
            node.entries.forEach(expr => {
                this._getTypeFromExpression(expr, EvaluatorFlags.None);
            });
            // TODO - need to implement
            // TODO - infer set type
            let type = ScopeUtils.getBuiltInObject(this._scope, 'set', []);
            typeResult = { type, node };
        } else if (node instanceof AssignmentNode) {
            // TODO - need to implement
            this._getTypeFromExpression(node.rightExpression, EvaluatorFlags.None);
            typeResult = this._getTypeFromExpression(node.leftExpression, EvaluatorFlags.None);
        } else if (node instanceof YieldExpressionNode) {
            // TODO - need to implement
            this._getTypeFromExpression(node.expression, EvaluatorFlags.None);
            // TODO - need to handle futures
            let type = UnknownType.create();
            typeResult = { type, node };
        }

        if (typeResult) {
            typeResult.type = this._applyTypeConstraint(node, typeResult.type);
        } else {
            this._addError(`Unknown type expression '${ ParseTreeUtils.printExpression(node) }'`, node);
            typeResult = { type: UnknownType.create(), node };
        }

        if (this._writeTypeToCache) {
            this._writeTypeToCache(node, typeResult.type);
        }

        return typeResult;
    }

    private _getTypeFromName(node: NameNode, flags: EvaluatorFlags): TypeResult | undefined {
        const name = node.nameToken.value;
        let type: Type | undefined;

        // Look for the scope that contains the value definition and
        // see if it has a declared type.
        let scope: Scope | undefined = this._scope;
        let beyondLocalScope = false;
        while (scope) {
            let symbol = scope.lookUpSymbol(name);
            if (symbol) {
                let declaration = symbol.declarations ? symbol.declarations[0] : undefined;

                // Was there a defined type hint?
                if (declaration && declaration.declaredType) {
                    type = declaration.declaredType;
                    break;
                }

                // If this is a non-variable type (e.g. a class, function, method), we
                // can assume that it's not going to be modified outside the local scope.
                if (declaration && declaration.category !== SymbolCategory.Variable) {
                    type = symbol.currentType;
                    break;
                }

                // If we haven't already gone beyond the local scope, we can
                // trust the current type. If we've moved beyond the local
                // scope to some other outer scope (e.g. the global scope), we
                // cannot trust the current type.
                if (beyondLocalScope) {
                    type = symbol.inferredType.getType();
                } else {
                    type = symbol.currentType;
                }
                break;
            }

            if (scope.getType() !== ScopeType.Temporary) {
                beyondLocalScope = true;
            }
            scope = scope.getParent();
        }

        if (!type) {
            return undefined;
        }

        type = this._convertClassToObject(type, flags);

        return { type, node };
    }

    private _getTypeFromMemberAccessExpression(node: MemberAccessExpressionNode,
            flags: EvaluatorFlags): TypeResult {

        const baseTypeResult = this._getTypeFromExpression(node.leftExpression, EvaluatorFlags.None);
        return this._getTypeFromMemberAccessExpressionWithBaseType(node, baseTypeResult, flags);
    }

    private _getTypeFromMemberAccessExpressionWithBaseType(node: MemberAccessExpressionNode,
                baseTypeResult: TypeResult, flags: EvaluatorFlags): TypeResult {

        const baseType = baseTypeResult.type;
        const memberName = node.memberName.nameToken.value;
        const getTypeFromClass = (classType: ClassType, includeInstanceMembers: boolean) => {
            let type: Type | undefined;

            let memberInfo = TypeUtils.lookUpClassMember(classType, memberName, includeInstanceMembers);
            if (memberInfo) {
                type = TypeUtils.getEffectiveTypeOfMember(memberInfo);
                if (type instanceof PropertyType) {
                    type = type.getEffectiveReturnType();
                }

                return type;
            }

            // See if the class has a "__getattribute__" or "__getattr__" method.
            // If so, aribrary members are supported.
            let getAttribMember = TypeUtils.lookUpClassMember(classType, '__getattribute__');
            if (getAttribMember && getAttribMember.class) {
                const isObjectClass = getAttribMember.class.isBuiltIn() &&
                    getAttribMember.class.getClassName() === 'object';
                // The built-in 'object' class, from which every class derives,
                // implements the default __getattribute__ method. We want to ignore
                // this one. If this method is overridden, we need to assume that
                // all members can be accessed.
                if (!isObjectClass) {
                    const getAttribType = TypeUtils.getEffectiveTypeOfMember(getAttribMember);
                    if (getAttribType instanceof FunctionType) {
                        return getAttribType.getEffectiveReturnType();
                    }
                }
            }

            let getAttrMember = TypeUtils.lookUpClassMember(classType, '__getattr__');
            if (getAttrMember) {
                const getAttrType = TypeUtils.getEffectiveTypeOfMember(getAttrMember);
                if (getAttrType instanceof FunctionType) {
                    return getAttrType.getEffectiveReturnType();
                }
            }

            // If the class has decorators, there may be additional fields
            // added that we don't know about.
            // TODO - figure out a better approach here.
            if (!classType.hasDecorators()) {
                this._addError(
                    `'${ memberName }' is not a known member of type '${ baseType.asString() }'`,
                    node.memberName);
            }
            return UnknownType.create();
        };

        let type: Type | undefined;
        let isClassOrObjectMember = false;

        if (baseType.isAny()) {
            type = baseType;

            // Assume that the base type is a class or object.
            isClassOrObjectMember = true;
        } else if (baseType instanceof ClassType) {
            type = getTypeFromClass(baseType, false);
            isClassOrObjectMember = true;
        } else if (baseType instanceof ObjectType) {
            type = getTypeFromClass(baseType.getClassType(), true);
            isClassOrObjectMember = true;
        } else if (baseType instanceof ModuleType) {
            let memberInfo = baseType.getFields().get(memberName);
            if (memberInfo) {
                type = memberInfo.currentType;
            } else {
                this._addError(`'${ memberName }' is not a known member of module`, node.memberName);
                type = UnknownType.create();
            }
        } else if (baseType instanceof UnionType) {
            let returnTypes: Type[] = [];
            baseType.getTypes().forEach(typeEntry => {
                if (typeEntry instanceof NoneType) {
                    // TODO - ignore None for now.
                } else {
                    let typeResult = this._getTypeFromMemberAccessExpressionWithBaseType(node,
                        { type: typeEntry, isClassOrObjectMember: baseTypeResult.isClassOrObjectMember, node },
                        EvaluatorFlags.None);
                    if (typeResult) {
                        returnTypes.push(typeResult.type);
                    }
                }
            });

            if (returnTypes.length > 0) {
                type = TypeUtils.combineTypesArray(returnTypes);
            }
        } else if (baseType instanceof PropertyType) {
            // TODO - need to come up with new strategy for properties
            type = UnknownType.create();
        }

        if (!type) {
            this._addError(
                `'${ memberName }' is not a known member of '${ baseType.asString() }'`,
                node.memberName);
            type = UnknownType.create();
        }

        type = this._convertClassToObject(type, flags);

        return { type, node, isClassOrObjectMember };
    }

    private _getTypeFromIndexExpression(node: IndexExpressionNode, flags: EvaluatorFlags): TypeResult {
        let type: Type | undefined;
        const baseTypeResult = this._getTypeFromExpression(node.baseExpression, EvaluatorFlags.None);
        const baseType = baseTypeResult.type;
        const typeArgs = this._getTypeArgs(node.indexExpression);

        this._validateTypeArgs(typeArgs);

        if (baseType instanceof ClassType) {
            type = this.specializeClassType(baseType, node.indexExpression, flags);
        } else if (baseType instanceof UnionType) {
            // TODO - need to implement
        } else if (baseType instanceof FunctionType) {
            // TODO - need to implement
        } else if (!baseType.isAny()) {
            if ((flags & EvaluatorFlags.ConvertClassToObject) !== 0) {
                this._addError(
                    `'Unsupported type expression: indexed (${ baseType.asString() })`,
                    node.baseExpression);
            }
        }

        if (!type) {
            type = UnknownType.create();
        }

        return { type, node };
    }

    private _validateTypeArgs(typeArgs: TypeResult[]) {
        // Make sure type args are reachable according to scoping rules.
        // TODO - need to implement
    }

    private _getTypeArgs(node: ExpressionNode): TypeResult[] {
        let typeArgs: TypeResult[] = [];

        if (node instanceof TupleExpressionNode) {
            node.expressions.forEach(expr => {
                typeArgs.push(this._getTypeArg(expr));
            });
        } else {
            typeArgs.push(this._getTypeArg(node));
        }

        return typeArgs;
    }

    private _getTypeArg(node: ExpressionNode): TypeResult {
        let typeResult: TypeResult;

        if (node instanceof ListNode) {
            typeResult = {
                type: UnknownType.create(),
                typeList: node.entries.map(entry => {
                    return this._getTypeFromExpression(entry, EvaluatorFlags.ConvertClassToObject);
                }),
                node
            };
        } else {
            typeResult = this._getTypeFromExpression(node, EvaluatorFlags.ConvertClassToObject);
        }

        return typeResult;
    }

    private _getTypeFromTupleExpression(node: TupleExpressionNode, flags: EvaluatorFlags): TypeResult {
        let tupleType = new TupleType(ScopeUtils.getBuiltInType(this._scope, 'tuple') as ClassType);

        node.expressions.forEach(expr => {
            let entryTypeResult = this._getTypeFromExpression(expr, flags);
            tupleType.addEntryType(entryTypeResult.type || UnknownType.create());
        });

        return {
            type: tupleType,
            node
        };
    }

    private _getTypeFromCallExpression(node: CallExpressionNode, flags: EvaluatorFlags): TypeResult {
        const baseTypeResult = this._getTypeFromExpression(node.leftExpression, EvaluatorFlags.None);

        return this._getTypeFromCallExpressionWithBaseType(node, baseTypeResult, flags);
    }

    private _getTypeFromCallExpressionWithBaseType(node: CallExpressionNode, baseTypeResult: TypeResult,
            flags: EvaluatorFlags): TypeResult {

        let type: Type | undefined;
        const callType = baseTypeResult.type;

        if (callType instanceof ClassType) {
            if (callType.isBuiltIn()) {
                const className = callType.getClassName();

                if (className === 'type') {
                    // Handle the 'type' call specially.
                    if (node.arguments.length >= 1) {
                        let argType = this._getTypeFromExpression(
                            node.arguments[0].valueExpression, EvaluatorFlags.None);
                        if (argType instanceof ObjectType) {
                            type = argType.getClassType();
                        }
                    }

                    // If the parameter to type() is not statically known,
                    // fall back to unknown.
                    if (!type) {
                        type = UnknownType.create();
                    }
                } else if (className === 'TypeVar') {
                    type = this.createTypeVarType(node);
                } else if (className === 'NamedTuple') {
                    type = this.createNamedTupleType(node, true);
                    flags &= ~EvaluatorFlags.ConvertClassToObject;
                }
            }

            // Assume this is a call to the constructor.
            if (!type) {
                type = new ObjectType(callType);
            }
        } else if (callType instanceof FunctionType) {
            // The stdlib collections/__init__.pyi stub file defines namedtuple
            // as a function rather than a class, so we need to check for it here.
            if (callType.getSpecialBuiltInName() === 'namedtuple') {
                type = this.createNamedTupleType(node, false);
                flags &= ~EvaluatorFlags.ConvertClassToObject;
            } else {
                type = callType.getEffectiveReturnType();
            }
        } else if (callType instanceof OverloadedFunctionType) {
            // Determine which of the overloads (if any) match.
            // let skipFirstMethodParam = !!baseTypeResult.isClassOrObjectMember;

            // TODO - need to figure out what to do here.
            // let functionType = this._findOverloadedFunctionType(
            //     callType, node, skipFirstMethodParam);
            // if (functionType) {
            //     type = functionType.getEffectiveReturnType();
            // }
            type = UnknownType.create();
        } else if (callType instanceof ObjectType) {
            const callMember = TypeUtils.lookUpObjectMember(callType, '__call__');
            if (callMember) {
                const callMethodType = TypeUtils.getEffectiveTypeOfMember(callMember);
                if (callMethodType instanceof FunctionType) {
                    type = callMethodType.getEffectiveReturnType();
                }
            }
        } else if (callType instanceof UnionType) {
            let returnTypes: Type[] = [];
            callType.getTypes().forEach(typeEntry => {
                if (typeEntry instanceof NoneType) {
                    // TODO - ignore None for now.
                } else {
                    let typeResult = this._getTypeFromCallExpressionWithBaseType(node,
                        { type: typeEntry, isClassOrObjectMember: baseTypeResult.isClassOrObjectMember, node },
                        EvaluatorFlags.None);
                    if (typeResult) {
                        returnTypes.push(typeResult.type);
                    }
                }
            });

            if (returnTypes.length > 0) {
                type = TypeUtils.combineTypesArray(returnTypes);
            }
        } else if (callType.isAny()) {
            type = UnknownType.create();
        }

        if (type === undefined) {
            this._addError(`'Unsupported type expression: call`, node);
            type = UnknownType.create();
        }

        type = this._convertClassToObject(type, flags);

        return { type, node };
    }

    createTypeVarType(node: CallExpressionNode): Type | undefined {
        let typeVarName = '';
        if (node.arguments.length === 0) {
            this._addError('Expected name of type var', node);
            return undefined;
        }

        let firstArg = node.arguments[0];
        if (firstArg.valueExpression instanceof StringNode) {
            typeVarName = firstArg.valueExpression.getValue();
        } else {
            this._addError('Expected name of type var as first parameter',
                firstArg.valueExpression);
        }

        let typeVar = new TypeVarType(typeVarName);

        // Parse the remaining parameters.
        for (let i = 1; i < node.arguments.length; i++) {
            const paramNameNode = node.arguments[i].name;
            const paramName = paramNameNode ? paramNameNode.nameToken.value : undefined;
            let paramNameMap = new StringMap<string>();

            if (paramName) {
                if (paramNameMap.get(paramName)) {
                    this._addError(
                        `Duplicate parameter name '${ paramName }' not allowed`,
                        node.arguments[i]);
                }

                if (paramName === 'bound') {
                    typeVar.setBoundType(this.getType(
                        node.arguments[i].valueExpression, EvaluatorFlags.ConvertClassToObject));
                } else if (paramName === 'covariant') {
                    if (this._getBooleanValue(node.arguments[i].valueExpression)) {
                        if (typeVar.isContravariant()) {
                            this._addError(
                                `A TypeVar cannot be both covariant and contravariant`,
                                node.arguments[i]);
                        } else {
                            typeVar.setIsCovariant();
                        }
                    }
                } else if (paramName === 'contravariant') {
                    if (this._getBooleanValue(node.arguments[i].valueExpression)) {
                        if (typeVar.isContravariant()) {
                            this._addError(
                                `A TypeVar cannot be both covariant and contravariant`,
                                node.arguments[i]);
                        } else {
                            typeVar.setIsContravariant();
                        }
                    }
                } else {
                    this._addError(
                        `'${ paramName }' is unknown parameter to TypeVar`,
                        node.arguments[i]);
                }

                paramNameMap.set(paramName, paramName);
            } else {
                typeVar.addConstraint(this.getType(
                    node.arguments[i].valueExpression, EvaluatorFlags.ConvertClassToObject));
            }
        }

        return typeVar;
    }

    private _getBooleanValue(node: ExpressionNode): boolean {
        if (node instanceof ConstantNode) {
            if (node.token instanceof KeywordToken) {
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

    // Creates a new custom tuple factory class with named values.
    // Supports both typed and untyped variants.
    createNamedTupleType(node: CallExpressionNode, includesTypes: boolean): ClassType {
        let className = 'namedtuple';
        if (node.arguments.length === 0) {
            this._addError('Expected named tuple class name as firat parameter',
                node.leftExpression);
        } else {
            const nameArg = node.arguments[0];
            if (nameArg.argumentCategory !== ArgumentCategory.Simple) {
                this._addError('Expected named tuple class name as firat parameter',
                    node.arguments[0].valueExpression);
            } else if (nameArg.valueExpression instanceof StringNode) {
                className = nameArg.valueExpression.getValue();
            }
        }

        let classType = new ClassType(className, ClassTypeFlags.None,
            AnalyzerNodeInfo.getTypeSourceId(node));
        classType.addBaseClass(ScopeUtils.getBuiltInType(this._scope, 'NamedTuple'), false);
        const classFields = classType.getClassFields();
        classFields.set('__class__', new Symbol(classType, DefaultTypeSourceId));
        const instanceFields = classType.getInstanceFields();

        let tupleType = new TupleType(ScopeUtils.getBuiltInType(this._scope, 'tuple') as ClassType);
        let constructorType = new FunctionType(FunctionTypeFlags.ClassMethod);
        constructorType.setDeclaredReturnType(tupleType);
        constructorType.addParameter({
            category: ParameterCategory.Simple,
            name: 'cls',
            type: classType
        });

        let initType = new FunctionType(FunctionTypeFlags.InstanceMethod);
        const selfParameter: FunctionParameter = {
            category: ParameterCategory.Simple,
            name: 'self',
            type: new ObjectType(classType)
        };
        initType.setDeclaredReturnType(NoneType.create());
        initType.addParameter(selfParameter);

        let addGenericGetAttribute = false;

        if (node.arguments.length < 2) {
            this._addError('Expected named tuple entry list as second parameter',
                node.leftExpression);
            addGenericGetAttribute = true;
        } else {
            const entriesArg = node.arguments[1];
            if (entriesArg.argumentCategory !== ArgumentCategory.Simple) {
                addGenericGetAttribute = true;
            } else {
                if (!includesTypes && entriesArg.valueExpression instanceof StringNode) {
                    let entries = entriesArg.valueExpression.getValue().split(' ');
                    entries.forEach(entryName => {
                        entryName = entryName.trim();
                        if (entryName) {
                            let entryType = UnknownType.create();
                            tupleType.addEntryType(entryType);
                            const paramInfo: FunctionParameter = {
                                category: ParameterCategory.Simple,
                                name: entryName,
                                type: entryType
                            };

                            constructorType.addParameter(paramInfo);
                            initType.addParameter(paramInfo);

                            instanceFields.set(entryName, new Symbol(entryType, DefaultTypeSourceId));
                        }
                    });
                } else if (entriesArg.valueExpression instanceof ListNode) {
                    const entryList = entriesArg.valueExpression;
                    let entryMap: { [name: string]: string } = {};

                    entryList.entries.forEach((entry, index) => {
                        let entryType: Type | undefined;
                        let entryNameNode: ExpressionNode | undefined;
                        let entryName = '';

                        if (includesTypes) {
                            // Handle the variant that includes name/type tuples.
                            if (entry instanceof TupleExpressionNode && entry.expressions.length === 2) {
                                entryNameNode = entry.expressions[0];
                                let entryTypeInfo = this._getTypeFromExpression(entry.expressions[1],
                                    EvaluatorFlags.ConvertClassToObject);
                                if (entryTypeInfo) {
                                    entryType = entryTypeInfo.type;
                                }
                            } else {
                                this._addError(
                                    'Expected two-entry tuple specifying entry name and type', entry);
                            }
                        } else {
                            entryNameNode = entry;
                            entryType = UnknownType.create();
                        }

                        if (entryNameNode instanceof StringNode) {
                            entryName = entryNameNode.getValue();
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

                        tupleType.addEntryType(entryType);
                        const paramInfo: FunctionParameter = {
                            category: ParameterCategory.Simple,
                            name: entryName,
                            type: entryType
                        };

                        constructorType.addParameter(paramInfo);
                        initType.addParameter(paramInfo);

                        instanceFields.set(entryName, new Symbol(entryType, DefaultTypeSourceId));
                    });
                } else {
                    // A dynamic expression was used, so we can't evaluate
                    // the named tuple statically.
                    addGenericGetAttribute = true;
                }
            }
        }

        classFields.set('__new__', new Symbol(constructorType, DefaultTypeSourceId));
        classFields.set('__init__', new Symbol(initType, DefaultTypeSourceId));

        let keysItemType = new FunctionType(FunctionTypeFlags.None);
        keysItemType.setDeclaredReturnType(ScopeUtils.getBuiltInObject(this._scope, 'list',
            [ScopeUtils.getBuiltInObject(this._scope, 'str')]));
        classFields.set('keys', new Symbol(keysItemType, DefaultTypeSourceId));
        classFields.set('items', new Symbol(keysItemType, DefaultTypeSourceId));

        let lenType = new FunctionType(FunctionTypeFlags.InstanceMethod);
        lenType.setDeclaredReturnType(ScopeUtils.getBuiltInObject(this._scope, 'int'));
        lenType.addParameter(selfParameter);
        classFields.set('__len__', new Symbol(lenType, DefaultTypeSourceId));

        if (addGenericGetAttribute) {
            let getAttribType = new FunctionType(FunctionTypeFlags.InstanceMethod);
            getAttribType.setDeclaredReturnType(AnyType.create());
            getAttribType.addParameter(selfParameter);
            getAttribType.addParameter({
                category: ParameterCategory.Simple,
                name: 'name',
                type: ScopeUtils.getBuiltInObject(this._scope, 'str')
            });
            classFields.set('__getattribute__', new Symbol(getAttribType, DefaultTypeSourceId));
        }

        return classType;
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
            }
        }

        if (!type) {
            return undefined;
        }

        return { type, node };
    }

    private _getBuiltInTypeFromLiteralExpression(node: ExpressionNode,
            typeName: string): TypeResult | undefined {

        let type = ScopeUtils.getBuiltInObject(this._scope, typeName);

        if (!type) {
            return undefined;
        }

        return { type, node };
    }

    private _getTypeFromListExpression(node: ListNode): TypeResult | undefined {
        let listTypes: TypeResult[] = [];
        node.entries.forEach(expr => {
            listTypes.push(this._getTypeFromExpression(expr, EvaluatorFlags.None));
        });

        let type = ScopeUtils.getBuiltInType(this._scope, 'list') as ClassType;
        type = type.cloneForSpecialization();

        // TODO - infer list type from listTypes
        type.setTypeArguments([]);

        // List literals are always objects, not classes.
        let convertedType = this._convertClassToObject(type, EvaluatorFlags.ConvertClassToObject);

        return { type: convertedType, node };
    }

    private _getTypeFromSliceExpression(node: SliceExpressionNode, flags: EvaluatorFlags): TypeResult | undefined {
        // TODO - need to implement
        if (node.startValue) {
            this._getTypeFromExpression(node.startValue, EvaluatorFlags.None);
        }
        if (node.endValue) {
            this._getTypeFromExpression(node.endValue, EvaluatorFlags.None);
        }
        if (node.stepValue) {
            this._getTypeFromExpression(node.stepValue, EvaluatorFlags.None);
        }

        let type = ScopeUtils.getBuiltInType(this._scope, 'set') as ClassType;
        type = type.cloneForSpecialization();

        // TODO - infer set type
        type.setTypeArguments([]);

        let convertedType = this._convertClassToObject(type, flags);

        return { type: convertedType, node };
    }

    // Converts the type parameters for a Callable type. It should
    // have zero to two parameters. The first parameter, if present, should be
    // either an ellipsis or a list of parameter types. The second parameter, if
    // present, should specify the return type.
    private _createCallableType(typeArgs: TypeResult[]): FunctionType {
        let functionType = new FunctionType(FunctionTypeFlags.None);
        functionType.setDeclaredReturnType(AnyType.create());

        if (typeArgs.length > 0) {
            if (typeArgs[0].typeList) {
                typeArgs[0].typeList.forEach((entry, index) => {
                    functionType.addParameter({
                        category: ParameterCategory.Simple,
                        name: `p${ index.toString() }`,
                        type: entry.type
                    });
                });
            } else if (typeArgs[0].type instanceof AnyType) {
                TypeUtils.addDefaultFunctionParameters(functionType);
            } else {
                this._addError(`Expected parameter type list or '...'`, typeArgs[0].node);
            }
        }

        if (typeArgs.length > 1) {
            functionType.setDeclaredReturnType(typeArgs[1].type);
        }

        if (typeArgs.length > 2) {
            this._addError(`Expected only two type arguments to 'Callable'`, typeArgs[2].node);
        }

        return functionType;
    }

    // Creates an Optional type annotation.
    private _createOptional(errorNode: ExpressionNode, typeArgs: TypeResult[]): Type {
        if (typeArgs.length !== 1) {
            this._addError(`Expected one type parameter after Optional`, errorNode);
            return UnknownType.create();
        }

        return TypeUtils.combineTypes(typeArgs[0].type, NoneType.create());
    }

    // Creates a Type type annotation.
    private _createTypeType(errorNode: ExpressionNode, typeArgs: TypeResult[]): Type {
        if (typeArgs.length !== 1) {
            this._addError(`Expected one type parameter after Type`, errorNode);
            return UnknownType.create();
        }

        let type = typeArgs[0].type;
        if (type instanceof ObjectType) {
            return type.getClassType();
        } else if (type instanceof TypeVarType) {
            // TODO - need to find a way to encode "type of" typeVar
            return type;
        } else if (!type.isAny()) {
            this._addError('Expected type argument after Type', errorNode);
        }

        return UnknownType.create();
    }

    private _createSpecialType(classType: ClassType, typeArgs: TypeResult[],
            flags: EvaluatorFlags, paramLimit?: number): Type {

        let typeArgCount = typeArgs.length;

        // Make sure the argument list count is correct.
        if (paramLimit !== undefined && typeArgCount > paramLimit) {
            this._addError(
                `Expected at most ${ paramLimit } type arguments`, typeArgs[paramLimit].node);
            typeArgCount = paramLimit;
        }

        let specializedType = classType.cloneForSpecialization();
        specializedType.setTypeArguments(typeArgs.map(t => t.type));

        return this._convertClassToObject(specializedType, flags);
    }

    // Unpacks the index expression for a Union type annotation.
    private _createUnionType(typeArgs: TypeResult[]): Type {
        let types: Type[] = [];

        for (let typeArg of typeArgs) {
            if (typeArg.type) {
                types.push(typeArg.type);
            }
        }

        return TypeUtils.combineTypesArray(types);
    }

    private _createGenericType(errorNode: ExpressionNode, classType: ClassType,
            typeArgs: TypeResult[]): Type {

        // Make sure there's at least one type arg.
        if (typeArgs.length === 0) {
            this._addError(
                `'Generic' requires at least one type argument`, errorNode);
        }

        // Make sure that all of the type args are typeVars and are unique.
        let uniqueTypeVars: TypeVarType[] = [];
        typeArgs.forEach(typeArg => {
            if (!(typeArg.type instanceof TypeVarType)) {
                this._addError(
                    `Type argument for 'Generic' must be a type variable`, typeArg.node);
            } else {
                for (let typeVar of uniqueTypeVars) {
                    if (typeVar === typeArg.type) {
                        this._addError(
                            `Type argument for 'Generic' must be unique`, typeArg.node);
                        break;
                    }
                }

                uniqueTypeVars.push(typeArg.type);
            }
        });

        return this._createSpecialType(classType, typeArgs, EvaluatorFlags.None);
    }

    private _createSpecializedClassType(classType: ClassType, typeArgs: TypeResult[]): Type {
        let typeArgCount = typeArgs.length;

        // Make sure the argument list count is correct.
        let typeParameters = classType.getTypeParameters();
        if (typeArgCount > typeParameters.length) {
            if (typeParameters.length === 0) {
                this._addError(`Expected no type arguments`,
                    typeArgs[typeParameters.length].node);
            } else {
                this._addError(
                    `Expected at most ${ typeParameters.length } type arguments`,
                    typeArgs[typeParameters.length].node);
            }
            typeArgCount = typeParameters.length;
        }

        let specializedClass = classType.cloneForSpecialization();

        // TODO - need to verify constraints of arguments
        specializedClass.setTypeArguments(typeArgs.map(t => t.type));

        return specializedClass;
    }

    private _applyTypeConstraint(node: ExpressionNode, unconstrainedType: Type): Type {
        // Shortcut the process if the type is unknown.
        if (unconstrainedType.isAny()) {
            return unconstrainedType;
        }

        // Apply constraints associated with the expression we're
        // currently walking.
        let constrainedType = unconstrainedType;
        this._expressionTypeConstraints.forEach(constraint => {
            constrainedType = constraint.applyToType(node, constrainedType);
        });

        // Apply constraints from the current scope and its outer scopes.
        return this._applyScopeTypeConstraintRecursive(node, constrainedType);
    }

    private _applyScopeTypeConstraintRecursive(node: ExpressionNode, type: Type,
            scope = this._scope): Type {
        // If we've hit a permanent scope, don't recurse any further.
        if (scope.getType() !== ScopeType.Temporary) {
            return type;
        }

        // Recursively allow the parent scopes to apply their type constraints.
        const parentScope = scope.getParent();
        if (parentScope) {
            type = this._applyScopeTypeConstraintRecursive(node, type, parentScope);
        }

        // Apply the constraints within the current scope.
        scope.getTypeConstraints().forEach(constraint => {
            type = constraint.applyToType(node, type);
        });

        return type;
    }

    private _convertClassToObject(type: Type, flags: EvaluatorFlags): Type {
        if (flags & EvaluatorFlags.ConvertClassToObject) {
            if (type instanceof ClassType) {
                type = new ObjectType(type);
            }
        }

        return type;
    }

    private _addError(message: string, range: TextRange) {
        if (this._diagnosticSink) {
            this._diagnosticSink.addErrorWithTextRange(message, range);
        }
    }
}
