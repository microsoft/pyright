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

import { TextRangeDiagnosticSink } from '../common/diagnosticSink';
import StringMap from '../common/stringMap';
import { TextRange } from '../common/textRange';
import { ArgumentCategory, AssignmentNode, AwaitExpressionNode, BinaryExpressionNode,
    CallExpressionNode, ConditionalExpressionNode, ConstantNode, DictionaryNode,
    EllipsisNode, ExpressionNode, FunctionNode, IndexExpressionNode, LambdaNode,
    ListComprehensionNode, ListNode, MemberAccessExpressionNode, NameNode,
    NumberNode, ParameterCategory, SetNode, SliceExpressionNode, StringNode,
    TupleExpressionNode, UnaryExpressionNode, YieldExpressionNode } from '../parser/parseNodes';
import { KeywordToken, KeywordType, OperatorType, QuoteTypeFlags, TokenType } from '../parser/tokenizerTypes';
import { ScopeUtils } from '../scopeUtils';
import { AnalyzerNodeInfo } from './analyzerNodeInfo';
import { DefaultTypeSourceId } from './inferredType';
import { ParseTreeUtils } from './parseTreeUtils';
import { Scope, ScopeType } from './scope';
import { Symbol, SymbolCategory } from './symbol';
import { TypeConstraint, TypeConstraintBuilder, TypeConstraintResults } from './typeConstraint';
import { AnyType, ClassType, ClassTypeFlags, FunctionParameter, FunctionType, FunctionTypeFlags,
    ModuleType, NoneType, ObjectType, OverloadedFunctionType, PropertyType,
    TupleType, Type, TypeVarMap, TypeVarType, UnionType, UnknownType } from './types';
import { TypeUtils } from './typeUtils';

interface TypeResult {
    type: Type;
    typeList?: TypeResult[];
    node: ExpressionNode;
}

export enum EvaluatorFlags {
    None = 0,

    // Interpret a class type as a instance of that class. This
    // is the normal mode used for type annotations.
    ConvertClassToObject = 1,

    // Should types like 'Callable' be converted to their internal
    // representations even if they have no explicit specialization?
    ConvertSpecialTypes = 2
}

export enum MemberAccessFlags {
    None = 0,

    // By default, both class and instance members are considered.
    // Set this flag to skip the instance members.
    SkipInstanceMembers = 1,

    // By default, members of base classes are also searched.
    // Set this flag to consider only the specified class' members.
    SkipBaseClasses = 2,

    // By default, if the class has a __getattribute__ or __getattr__
    // magic method, it is assumed to have any member.
    SkipGetAttributeCheck = 4
}

interface ParamAssignmentInfo {
    argsNeeded: number;
    argsReceived: number;
}

export type ReadTypeFromNodeCacheCallback = (node: ExpressionNode) => Type | undefined;
export type WriteTypeToNodeCacheCallback = (node: ExpressionNode, type: Type) => void;

export class ExpressionEvaluator {
    private _scope: Scope;
    private _expressionTypeConstraints: TypeConstraint[] = [];
    private _diagnosticSink?: TextRangeDiagnosticSink;
    private _readTypeFromCache?: ReadTypeFromNodeCacheCallback;
    private _writeTypeToCache?: WriteTypeToNodeCacheCallback;

    constructor(scope: Scope, diagnosticSink?: TextRangeDiagnosticSink,
            readTypeCallback?: ReadTypeFromNodeCacheCallback,
            writeTypeCallback?: WriteTypeToNodeCacheCallback) {
        this._scope = scope;
        this._diagnosticSink = diagnosticSink;
        this._readTypeFromCache = readTypeCallback;
        this._writeTypeToCache = writeTypeCallback;
    }

    getType(node: ExpressionNode, flags: EvaluatorFlags): Type {
        let typeResult = this._getTypeFromExpression(node, flags | EvaluatorFlags.ConvertSpecialTypes);
        return typeResult.type;
    }

    // Gets a member type from an object and if it's a function binds
    // it to the object.
    getTypeFromObjectMember(memberName: string, objectType: ObjectType): Type | undefined {
        const memberType = this._getTypeFromClassMemberName(
            memberName, objectType.getClassType(), MemberAccessFlags.None);

        let resultType = memberType;
        if (memberType instanceof FunctionType || memberType instanceof OverloadedFunctionType) {
            resultType = this._bindFunctionToClassOrObject(objectType, memberType);
        }

        return resultType;
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

            // Cache the type information in the member name node as well.
            if (this._writeTypeToCache) {
                this._writeTypeToCache(node.memberName, typeResult.type);
            }
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
            this._getTypeFromExpression(node.leftExpression, flags);

            // Is this an AND operator? If so, we can assume that the
            // rightExpression won't be evaluated at runtime unless the
            // leftExpression evaluates to true.
            let typeConstraints: TypeConstraintResults | undefined;
            if (node.operator === OperatorType.And) {
                typeConstraints = this._buildTypeConstraints(node.leftExpression);
            }

            this._useExpressionTypeConstraint(typeConstraints, true, () => {
                this._getTypeFromExpression(node.rightExpression, flags);
            });

            // TODO - need to implement
            typeResult = { type: UnknownType.create(), node };
        } else if (node instanceof ListNode) {
            typeResult = this._getTypeFromListExpression(node);
        } else if (node instanceof SliceExpressionNode) {
            typeResult = this._getTypeFromSliceExpression(node, flags);
        } else if (node instanceof AwaitExpressionNode) {
            // TODO - need to implement
            typeResult = this._getTypeFromExpression(node.expression, flags);
            typeResult = { type: UnknownType.create(), node };
        } else if (node instanceof ConditionalExpressionNode) {
            // TODO - need to implement
            this._getTypeFromExpression(node.testExpression, EvaluatorFlags.None);

            // Apply the type constraint when evaluating the if and else clauses.
            let typeConstraints = this._buildTypeConstraints(node.testExpression);

            let ifType: TypeResult | undefined;
            this._useExpressionTypeConstraint(typeConstraints, true, () => {
                ifType = this._getTypeFromExpression(node.ifExpression, flags);
            });

            let elseType: TypeResult | undefined;
            this._useExpressionTypeConstraint(typeConstraints, false, () => {
                elseType = this._getTypeFromExpression(node.elseExpression, flags);
            });

            let type = TypeUtils.combineTypes(ifType!.type, elseType!.type);
            typeResult = { type, node };
        } else if (node instanceof ListComprehensionNode) {
            // TODO - need to implement
            // TODO - infer list type
            // this._getTypeFromExpression(node.baseExpression, EvaluatorFlags.None);
            let type = ScopeUtils.getBuiltInObject(this._scope, 'list', [UnknownType.create()]);
            typeResult = { type, node };
        } else if (node instanceof DictionaryNode) {
            // TODO - need to implement
            // TODO - infer dict type
            let type = ScopeUtils.getBuiltInObject(this._scope, 'dict', [UnknownType.create(), UnknownType.create()]);
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
            let type = ScopeUtils.getBuiltInObject(this._scope, 'set', [UnknownType.create()]);
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

    private _getTypeFromName(node: NameNode, flags: EvaluatorFlags): TypeResult {
        const name = node.nameToken.value;
        let type: Type | undefined;

        // Look for the scope that contains the value definition and
        // see if it has a declared type.
        const symbolWithScope = this._scope.lookUpSymbolRecursive(name);

        if (symbolWithScope) {
            const symbol = symbolWithScope.symbol;

            let declaration = symbol.declarations ? symbol.declarations[0] : undefined;

            if (declaration && declaration.declaredType) {
                // Was there a defined type hint?
                type = declaration.declaredType;
            } else if (declaration && declaration.category !== SymbolCategory.Variable) {
                // If this is a non-variable type (e.g. a class, function, method), we
                // can assume that it's not going to be modified outside the local scope.
                type = symbol.currentType;
            } else if (symbolWithScope.isBeyondLocalScope) {
                // If we haven't already gone beyond the local scope, we can
                // trust the current type. If we've moved beyond the local
                // scope to some other outer scope (e.g. the global scope), we
                // cannot trust the current type.
                type = symbol.inferredType.getType();
            } else {
                type = symbol.currentType;
            }
        }

        if (!type) {
            this._addError(`'${ name }' is not a known symbol`, node);
            type = UnknownType.create();
        }

        // If we're not converting to an object, convert classes like
        // "Callable" into their internal representation.
        if ((flags & EvaluatorFlags.ConvertSpecialTypes) !== 0) {
            if (type instanceof ClassType && type.isSpecialBuiltIn()) {
                type = this._createSpecializeClassType(type, [], node, flags);
            }
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

        let type: Type | undefined;

        if (baseType.isAny()) {
            type = baseType;
        } else if (baseType instanceof ClassType) {
            type = this._validateTypeFromClassMemberAccess(node.memberName,
                baseType, MemberAccessFlags.SkipInstanceMembers);
            type = this._bindFunctionToClassOrObject(baseType, type);
        } else if (baseType instanceof ObjectType) {
            type = this._validateTypeFromClassMemberAccess(
                node.memberName, baseType.getClassType(), MemberAccessFlags.None);
            type = this._bindFunctionToClassOrObject(baseType, type);
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
                        {
                            type: typeEntry,
                            node
                        },
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
        } else if (baseType instanceof FunctionType || baseType instanceof OverloadedFunctionType) {
            // TODO - not yet sure what to do about members of functions,
            // which have associated dictionaries.
            type = UnknownType.create();
        }

        if (!type) {
            this._addError(
                `'${ memberName }' is not a known member of '${ baseType.asString() }'`,
                node.memberName);
            type = UnknownType.create();
        }

        type = this._convertClassToObject(type, flags);

        return { type, node };
    }

    // If the memberType is an instance or class method, creates a new
    // version of the function that has the "self" or "cls" parameter bound
    // to it.
    private _bindFunctionToClassOrObject(baseType: ClassType | ObjectType | undefined,
            memberType: Type): Type {

        if (memberType instanceof FunctionType) {
            // If the caller specified no base type, always strip the
            // first parameter. This is used in cases like constructors.
            if (!baseType) {
                return TypeUtils.stripFirstParameter(memberType);
            } else if (memberType.isInstanceMethod()) {
                if (baseType instanceof ObjectType) {
                    return this._partiallySpecializeFunctionForBoundClassOrObject(
                        baseType, memberType);
                }
            } else if (memberType.isClassMethod()) {
                if (baseType instanceof ClassType) {
                    return this._partiallySpecializeFunctionForBoundClassOrObject(
                        baseType, memberType);
                } else {
                    return this._partiallySpecializeFunctionForBoundClassOrObject(
                        baseType.getClassType(), memberType);
                }
            }
        } else if (memberType instanceof OverloadedFunctionType) {
            let newOverloadType = new OverloadedFunctionType();
            memberType.getOverloads().forEach(overload => {
                newOverloadType.addOverload(overload.typeSourceId,
                    this._bindFunctionToClassOrObject(baseType, overload.type) as FunctionType);
            });

            return newOverloadType;
        }

        return memberType;
    }

    private _partiallySpecializeFunctionForBoundClassOrObject(baseType: ClassType | ObjectType,
            memberType: FunctionType): Type {

        let classType = baseType instanceof ClassType ? baseType : baseType.getClassType();
        let typeVarMap = TypeUtils.buildTypeVarMapFromSpecializedClass(classType);

        if (memberType.getParameterCount() > 0) {
            let firstParam = memberType.getParameters()[0];
            TypeUtils.canAssignType(firstParam.type, baseType, typeVarMap);
        }

        const specializedFunction = TypeUtils.specializeType(
            memberType, typeVarMap) as FunctionType;
        return TypeUtils.stripFirstParameter(specializedFunction);
   }

    // A wrapper around _getTypeFromClassMemberName that reports
    // errors if the member name is not found.
    private _validateTypeFromClassMemberAccess(memberNameNode: NameNode,
            classType: ClassType, flags: MemberAccessFlags) {

        const memberName = memberNameNode.nameToken.value;
        let type = this._getTypeFromClassMemberName(memberName, classType, flags);

        if (type) {
            return type;
        }

        // If the class has decorators, there may be additional fields
        // added that we don't know about.
        // TODO - figure out a better approach here.
        if (!classType.hasDecorators()) {
            this._addError(
                `'${ memberName }' is not a known member of '${ classType.getObjectName() }'`,
                memberNameNode);
        }

        return UnknownType.create();
    }

    private _getTypeFromClassMemberName(memberName: string, classType: ClassType,
            flags: MemberAccessFlags): Type | undefined {

        // Build a map of type parameters and the type arguments associated with them.
        let typeArgMap = TypeUtils.buildTypeVarMapFromSpecializedClass(classType);

        let memberInfo = TypeUtils.lookUpClassMember(classType, memberName,
            !(flags & MemberAccessFlags.SkipInstanceMembers),
            !(flags & MemberAccessFlags.SkipBaseClasses));
        if (memberInfo) {
            let type = TypeUtils.getEffectiveTypeOfMember(memberInfo);
            if (type instanceof PropertyType) {
                type = type.getEffectiveReturnType();
            }

            return TypeUtils.specializeType(type, typeArgMap);
        }

        if (!(flags & MemberAccessFlags.SkipGetAttributeCheck)) {
            // See if the class has a "__getattribute__" or "__getattr__" method.
            // If so, arbitrary members are supported.
            let getAttribMember = TypeUtils.lookUpClassMember(classType, '__getattribute__', false);
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
                        return TypeUtils.specializeType(
                            getAttribType.getEffectiveReturnType(), typeArgMap);
                    }
                }
            }

            let getAttrMember = TypeUtils.lookUpClassMember(classType, '__getattr__', false);
            if (getAttrMember) {
                const getAttrType = TypeUtils.getEffectiveTypeOfMember(getAttrMember);
                if (getAttrType instanceof FunctionType) {
                    return TypeUtils.specializeType(
                        getAttrType.getEffectiveReturnType(), typeArgMap);
                }
            }
        }

        return undefined;
    }

    private _getTypeFromIndexExpression(node: IndexExpressionNode, flags: EvaluatorFlags): TypeResult {
        let type: Type | undefined;
        const baseTypeResult = this._getTypeFromExpression(node.baseExpression, EvaluatorFlags.None);
        const baseType = baseTypeResult.type;
        const typeArgs = this._getTypeArgs(node.indexExpression);

        if (baseType.isAny()) {
            type = baseType;
        } else if (baseType instanceof ClassType) {
            let typeArgs = this._getTypeArgs(node.indexExpression);
            type = this._createSpecializeClassType(baseType, typeArgs,
                node.indexExpression, flags);
        } else if (baseType instanceof UnionType) {
            // TODO - need to implement
            type = UnknownType.create();
        } else if (baseType instanceof FunctionType) {
            // TODO - need to implement
            type = UnknownType.create();
        } else if (baseType instanceof ObjectType) {
            // TODO - need to implement
            type = UnknownType.create();
        } else if (baseType instanceof TupleType) {
            // TODO - need to implement
            type = UnknownType.create();
        }

        if (!type) {
            this._addError(
                `'Unsupported expression type: indexed ${ baseType.asString() }`,
                node.baseExpression);

            type = UnknownType.create();
        }

        return { type, node };
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
                    return this._getTypeFromExpression(entry,
                        EvaluatorFlags.ConvertClassToObject | EvaluatorFlags.ConvertSpecialTypes);
                }),
                node
            };
        } else {
            typeResult = this._getTypeFromExpression(node,
                EvaluatorFlags.ConvertClassToObject | EvaluatorFlags.ConvertSpecialTypes);
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

    private _getTypeFromCallExpression(node: CallExpressionNode,
            flags: EvaluatorFlags): TypeResult {

        const baseTypeResult = this._getTypeFromExpression(
            node.leftExpression, EvaluatorFlags.None);

        return this._getTypeFromCallExpressionWithBaseType(
            node, baseTypeResult, flags);
    }

    private _getTypeFromCallExpressionWithBaseType(node: CallExpressionNode,
            baseTypeResult: TypeResult, flags: EvaluatorFlags): TypeResult {

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
                    type = this._createTypeVarType(node);
                } else if (className === 'NamedTuple') {
                    type = this._createNamedTupleType(node, true);
                    flags &= ~EvaluatorFlags.ConvertClassToObject;
                }
            }

            // Assume this is a call to the constructor.
            if (!type) {
                type = this._validateConstructorArguments(node, callType);
            }
        } else if (callType instanceof FunctionType) {
            // The stdlib collections/__init__.pyi stub file defines namedtuple
            // as a function rather than a class, so we need to check for it here.
            if (callType.getBuiltInName() === 'namedtuple') {
                type = this._createNamedTupleType(node, false);
                flags &= ~EvaluatorFlags.ConvertClassToObject;
            } else {
                type = this._validateCallArguments(node, callType);
            }
        } else if (callType instanceof OverloadedFunctionType) {
            // Determine which of the overloads (if any) match.
            let functionType = this._findOverloadedFunctionType(callType, node);

            if (functionType) {
                type = functionType.getEffectiveReturnType();
            } else {
                const exprString = ParseTreeUtils.printExpression(node.leftExpression);
                this._addError(
                    `No overloads for '${ exprString }' match parameters`,
                    node.leftExpression);
            }

            type = UnknownType.create();
        } else if (callType instanceof ObjectType) {
            let memberType = this._getTypeFromClassMemberName(
                '__call__', callType.getClassType(), MemberAccessFlags.SkipGetAttributeCheck);
            if (memberType && memberType instanceof FunctionType) {
                const callMethodType = TypeUtils.stripFirstParameter(memberType);
                this._validateCallArguments(node, callMethodType);
                type = memberType.getEffectiveReturnType();
            }
        } else if (callType instanceof UnionType) {
            let returnTypes: Type[] = [];
            callType.getTypes().forEach(typeEntry => {
                if (typeEntry instanceof NoneType) {
                    // TODO - ignore None for now.
                } else {
                    let typeResult = this._getTypeFromCallExpressionWithBaseType(node,
                        {
                            type: typeEntry,
                            node
                        },
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
            this._addError(
                `'${ ParseTreeUtils.printExpression(node.leftExpression) }' has type ` +
                `'${ callType.asString() }' and is not callable`,
                node.leftExpression);
            type = UnknownType.create();
        }

        type = this._convertClassToObject(type, flags);

        return { type, node };
    }

    private _findOverloadedFunctionType(callType: OverloadedFunctionType,
            node: CallExpressionNode): FunctionType | undefined {
        let validOverload: FunctionType | undefined;

        // Temporarily disable diagnostic output.
        this._silenceDiagnostics(() => {
            for (let overload of callType.getOverloads()) {
                if (this._validateCallArguments(node, overload.type)) {
                    validOverload = overload.type;
                }
            }
        });

        return validOverload;
    }

     // Tries to match the arguments of a call to the constructor for a class.
    private _validateConstructorArguments(node: CallExpressionNode, type: ClassType): Type {
        let validatedTypes = false;
        let returnType: Type | undefined;

        // See if there's a "__new__" defined within the class (but not its base classes).
        let constructorMethodType = this._getTypeFromClassMemberName('__new__', type,
            MemberAccessFlags.SkipGetAttributeCheck | MemberAccessFlags.SkipInstanceMembers |
                MemberAccessFlags.SkipBaseClasses);
        if (constructorMethodType) {
            constructorMethodType = this._bindFunctionToClassOrObject(
                type, constructorMethodType);
            returnType = this._validateCallArguments(node, constructorMethodType);
            if (returnType instanceof UnknownType) {
                returnType = new ObjectType(type);
            }
            validatedTypes = true;
        }

        if (!validatedTypes) {
            // If we didn't find a "__new__", look recursively for an "__init__" in base classes.
            let memberAccessFlags = MemberAccessFlags.SkipGetAttributeCheck |
                MemberAccessFlags.SkipInstanceMembers;
            let initMethodType = this._getTypeFromClassMemberName(
                '__init__', type, memberAccessFlags);
            if (initMethodType) {
                initMethodType = this._bindFunctionToClassOrObject(
                    new ObjectType(type), initMethodType);
                this._validateCallArguments(node, initMethodType);
                validatedTypes = true;
            }
        }

        if (!validatedTypes && node.arguments.length > 0) {
            this._addError(
                `Expected no arguments to '${ type.getClassName() }' constructor`, node);
        }

        if (!returnType) {
            returnType = new ObjectType(type);
        }

        // Make the type concrete if it wasn't already specialized.
        returnType = TypeUtils.specializeType(returnType, undefined);

        return returnType;
    }

    private _validateCallArguments(node: CallExpressionNode, callType: Type): Type | undefined {
        let returnType: Type | undefined;

        if (callType.isAny()) {
            returnType = UnknownType.create();
        } else if (callType instanceof FunctionType) {
            returnType = this._validateFunctionArguments(node, callType);
        } else if (callType instanceof OverloadedFunctionType) {
            const overloadedFunctionType = this._findOverloadedFunctionType(callType, node);
            if (overloadedFunctionType) {
                returnType = overloadedFunctionType.getEffectiveReturnType();
            }
        } else if (callType instanceof ClassType) {
            if (!callType.isSpecialBuiltIn()) {
                returnType = this._validateConstructorArguments(node, callType);
            } else {
                this._addError(
                    `'${ callType.getClassName() }' cannot be instantiated`,
                    node.leftExpression);
                returnType = UnknownType.create();
            }
        } else if (callType instanceof ObjectType) {
            let memberType = this._getTypeFromClassMemberName(
                '__call__', callType.getClassType(),
                    MemberAccessFlags.SkipGetAttributeCheck |
                    MemberAccessFlags.SkipInstanceMembers);

            if (memberType && memberType instanceof FunctionType) {
                const callMethodType = TypeUtils.stripFirstParameter(memberType);
                returnType = this._validateCallArguments(node, callMethodType);
            }
        } else if (callType instanceof UnionType) {
            let returnTypes: Type[] = [];

            for (let type of callType.getTypes()) {
                if (type instanceof NoneType) {
                    // TODO - for now, assume that optional
                    // types (unions with None) are valid. Tighten
                    // this later.
                } else {
                    let entryReturnType = this._validateCallArguments(node, type);
                    if (entryReturnType) {
                        returnTypes.push(entryReturnType);
                    }
                }
            }

            if (returnTypes.length > 0) {
                returnType = TypeUtils.combineTypesArray(returnTypes);
            }
        }

        // Make the type concrete if it wasn't already specialized.
        if (returnType) {
            returnType = TypeUtils.specializeType(returnType, undefined);
        }

        return returnType;
    }

    // Tries to assign the call arguments to the function parameter
    // list and reports any mismatches in types or counts. Returns the
    // specialized return type of the call.
    // This logic is based on PEP 3102: https://www.python.org/dev/peps/pep-3102/
    private _validateFunctionArguments(node: CallExpressionNode, type: FunctionType): Type {
        let argIndex = 0;
        const typeParams = type.getParameters();

        // Evaluate all of the argument values and generate errors if appropriate.
        // The expression type will be cached in the node so we don't re-evaluate
        // it below.
        node.arguments.forEach(arg => {
            this.getType(arg.valueExpression, EvaluatorFlags.None);
        });

        // The last parameter might be a var arg dictionary. If so, strip it off.
        let hasVarArgDictParam = typeParams.find(
                param => param.category === ParameterCategory.VarArgDictionary) !== undefined;
        let reportedArgError = false;

        // Build a map of parameters by name.
        let paramMap = new StringMap<ParamAssignmentInfo>();
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
        let positionalArgCount = node.arguments.findIndex(
            arg => arg.argumentCategory === ArgumentCategory.Dictionary || arg.name !== undefined);
        if (positionalArgCount < 0) {
            positionalArgCount = node.arguments.length;
        }

        // Create a type variable map that records the matched type arguments
        // as we match arguments to parameters.
        const typeVarMap = new TypeVarMap();

        // Map the positional args to parameters.
        let paramIndex = 0;
        while (argIndex < positionalArgCount) {
            if (paramIndex >= positionalParamCount) {
                let adjustedCount = positionalParamCount;
                this._addError(
                    `Expected ${ adjustedCount } positional argument${ adjustedCount === 1 ? '' : 's' }`,
                    node.arguments[argIndex]);
                reportedArgError = true;
                break;
            }

            if (typeParams[paramIndex].category === ParameterCategory.VarArgList) {
                // Consume the remaining positional args.
                argIndex = positionalArgCount;
            } else {
                let paramType = type.getEffectiveParameterType(paramIndex);
                this._validateArgType(paramType, node.arguments[argIndex].valueExpression,
                    typeVarMap);

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
            let foundListArg = node.arguments.find(
                arg => arg.argumentCategory === ArgumentCategory.List) !== undefined;

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

                                let paramInfoIndex = typeParams.findIndex(
                                    param => param.name === paramNameValue);
                                assert(paramInfoIndex >= 0);
                                const paramType = type.getEffectiveParameterType(paramInfoIndex);
                                this._validateArgType(paramType, node.arguments[argIndex].valueExpression,
                                    typeVarMap);
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

        return TypeUtils.specializeType(type.getEffectiveReturnType(), typeVarMap);
    }

    private _validateArgType(paramType: Type, argExpression: ExpressionNode, typeVarMap: TypeVarMap) {
        let argType = this.getType(argExpression, EvaluatorFlags.None);
        if (!TypeUtils.canAssignType(paramType, argType, typeVarMap)) {
            this._addError(
                `Argument of type '${ argType.asString() }'` +
                    ` cannot be assigned to parameter of type '${ paramType.asString() }'`,
                argExpression);
        }
    }

    private _createTypeVarType(node: CallExpressionNode): Type | undefined {
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
                    if (typeVar.getConstraints().length > 0) {
                        this._addError(
                            `A TypeVar cannot be bounded and constrained`,
                            node.arguments[i]);
                    } else {
                        typeVar.setBoundType(this.getType(
                            node.arguments[i].valueExpression, EvaluatorFlags.ConvertClassToObject));
                    }
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
                if (typeVar.getBoundType()) {
                    this._addError(
                        `A TypeVar cannot be bounded and constrained`,
                        node.arguments[i]);
                } else {
                    typeVar.addConstraint(this.getType(
                        node.arguments[i].valueExpression, EvaluatorFlags.ConvertClassToObject));
                }
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
    private _createNamedTupleType(node: CallExpressionNode, includesTypes: boolean): ClassType {
        let className = 'namedtuple';
        if (node.arguments.length === 0) {
            this._addError('Expected named tuple class name as first parameter',
                node.leftExpression);
        } else {
            const nameArg = node.arguments[0];
            if (nameArg.argumentCategory !== ArgumentCategory.Simple) {
                this._addError('Expected named tuple class name as first parameter',
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
        constructorType.setDeclaredReturnType(new ObjectType(classType));
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

        if (addGenericGetAttribute) {
            TypeUtils.addDefaultFunctionParameters(constructorType);
            TypeUtils.addDefaultFunctionParameters(initType);
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

        let type = ScopeUtils.getBuiltInType(this._scope, 'list');

        let convertedType: Type;
        if (type instanceof ClassType) {
            // TODO - infer list type from listTypes
            type = type.cloneForSpecialization([UnknownType.create()]);

            // List literals are always objects, not classes.
            convertedType = this._convertClassToObject(type, EvaluatorFlags.ConvertClassToObject);
        } else {
            convertedType = UnknownType.create();
        }

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
        let convertedType: Type;
        if (type instanceof ClassType) {
            // TODO - infer set type
            type = type.cloneForSpecialization([UnknownType.create()]);

            convertedType = this._convertClassToObject(type, flags);
        } else {
            convertedType = UnknownType.create();
        }

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
        } else {
            TypeUtils.addDefaultFunctionParameters(functionType);
        }

        if (typeArgs.length > 1) {
            functionType.setDeclaredReturnType(typeArgs[1].type);
        } else {
            functionType.setDeclaredReturnType(AnyType.create());
        }

        if (typeArgs.length > 2) {
            this._addError(`Expected only two type arguments to 'Callable'`, typeArgs[2].node);
        }

        return functionType;
    }

    // Creates an Optional type annotation.
    private _createOptionalType(errorNode: ExpressionNode, typeArgs: TypeResult[]): Type {
        if (typeArgs.length !== 1) {
            this._addError(`Expected one type parameter after Optional`, errorNode);
            return UnknownType.create();
        }

        return TypeUtils.combineTypes(typeArgs[0].type, NoneType.create());
    }

    private _createClassVarType(typeArgs: TypeResult[], flags: EvaluatorFlags): Type {
        if (typeArgs.length > 1) {
            this._addError(`Expected only one type parameter after ClassVar`, typeArgs[1].node);
        }

        let type = (typeArgs.length === 0) ? AnyType.create() : typeArgs[0].type;
        return this._convertClassToObject(type, flags);
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

        let specializedType = classType.cloneForSpecialization(typeArgs.map(t => t.type));

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

        if (types.length > 0) {
            return TypeUtils.combineTypesArray(types);
        }

        return NoneType.create();
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

        // Fill in any missing type arguments with unknown.
        let typeArgTypes = typeArgs.map(t => t.type);
        while (typeArgTypes.length < classType.getTypeParameters().length) {
            typeArgTypes.push(UnknownType.create());
        }

        // TODO - need to verify constraints of arguments
        let specializedClass = classType.cloneForSpecialization(typeArgTypes);

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

    // Specializes the specified (potentially generic) class type using
    // the specified type arguments, reporting errors as appropriate.
    // Returns the specialized type and a boolean indicating whether
    // the type indicates a class type (true) or an object type (false).
    private _createSpecializeClassType(classType: ClassType, typeArgs: TypeResult[],
            errorNode: ExpressionNode, flags: EvaluatorFlags): Type {

        // Handle the special-case classes that are not defined
        // in the type stubs.
        if (classType.isSpecialBuiltIn()) {
            const className = classType.getClassName();

            switch (className) {
                case 'Callable': {
                    return this._createCallableType(typeArgs);
                }

                case 'Optional': {
                    return this._createOptionalType(errorNode, typeArgs);
                }

                case 'Type': {
                    return this._createSpecialType(classType, typeArgs, flags, 1);
                }

                case 'ClassVar': {
                    // TODO - need to handle class vars. For now, we treat them
                    // like any other type.
                    return this._createClassVarType(typeArgs, flags);
                }

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
                        this._addError(`Generic allowed only as base class`, errorNode);
                    }
                    return this._createGenericType(errorNode, classType, typeArgs);
            }
        }

        let specializedType = this._createSpecializedClassType(classType, typeArgs);
        return this._convertClassToObject(specializedType, flags);
    }

    private _convertClassToObject(type: Type, flags: EvaluatorFlags): Type {
        if (flags & EvaluatorFlags.ConvertClassToObject) {
            if (type instanceof ClassType) {
                type = new ObjectType(type);
            }
        }

        return type;
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
            (node: ExpressionNode) => this.getType(node, EvaluatorFlags.None));
    }

    private _silenceDiagnostics(callback: () => void) {
        let oldDiagSink = this._diagnosticSink;
        this._diagnosticSink = undefined;

        callback();

        this._diagnosticSink = oldDiagSink;
    }

    private _addError(message: string, range: TextRange) {
        if (this._diagnosticSink) {
            this._diagnosticSink.addErrorWithTextRange(message, range);
        }
    }
}
