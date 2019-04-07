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

import { ConfigOptions, DiagnosticLevel } from '../common/configOptions';
import { DiagnosticAddendum } from '../common/diagnostic';
import { TextRangeDiagnosticSink } from '../common/diagnosticSink';
import StringMap from '../common/stringMap';
import { TextRange } from '../common/textRange';
import { ArgumentCategory, AssignmentNode, AwaitExpressionNode,
    BinaryExpressionNode, CallExpressionNode, ConstantNode, DecoratorNode,
    DictionaryNode, EllipsisNode, ExpressionNode, IndexExpressionNode,
    LambdaNode, ListComprehensionNode, ListNode, MemberAccessExpressionNode,
    NameNode, NumberNode, ParameterCategory, SetNode, SliceExpressionNode,
    StringNode, TernaryExpressionNode, TupleExpressionNode, UnaryExpressionNode,
    YieldExpressionNode } from '../parser/parseNodes';
import { KeywordToken, KeywordType, OperatorType, QuoteTypeFlags,
    TokenType } from '../parser/tokenizerTypes';
import { ScopeUtils } from '../scopeUtils';
import { AnalyzerNodeInfo } from './analyzerNodeInfo';
import { DefaultTypeSourceId } from './inferredType';
import { ParseTreeUtils } from './parseTreeUtils';
import { Scope, ScopeType } from './scope';
import { Symbol, SymbolCategory } from './symbol';
import { ConditionalTypeConstraintResults, TypeConstraint,
    TypeConstraintBuilder } from './typeConstraint';
import { AnyType, ClassType, ClassTypeFlags, FunctionParameter, FunctionType,
    FunctionTypeFlags, ModuleType, NoneType, ObjectType, OverloadedFunctionType,
    PropertyType, TupleType, Type, TypeVarMap, TypeVarType, UnionType,
    UnknownType } from './types';
import { TypeUtils } from './typeUtils';

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

export enum EvaluatorFlags {
    None = 0,

    // Interpret a class type as a instance of that class. This
    // is the normal mode used for type annotations.
    ConvertClassToObject = 1,

    // Normally a generic named type is specialized with "Any"
    // types. This flag indicates that specialization shouldn't take
    // place.
    DoNotSpecialize = 2
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
    SkipGetAttributeCheck = 4,

    // By default, if the class has a __get__ magic method, this is
    // followed to determine the final type. Properties use this
    // technique.
    SkipGetCheck = 8
}

interface ParamAssignmentInfo {
    argsNeeded: number;
    argsReceived: number;
}

export type ReadTypeFromNodeCacheCallback = (node: ExpressionNode) => Type | undefined;
export type WriteTypeToNodeCacheCallback = (node: ExpressionNode, type: Type) => void;

export class ExpressionEvaluator {
    private _scope: Scope;
    private _configOptions: ConfigOptions;
    private _expressionTypeConstraints: TypeConstraint[] = [];
    private _diagnosticSink?: TextRangeDiagnosticSink;
    private _readTypeFromCache?: ReadTypeFromNodeCacheCallback;
    private _writeTypeToCache?: WriteTypeToNodeCacheCallback;

    constructor(scope: Scope, configOptions: ConfigOptions,
            diagnosticSink?: TextRangeDiagnosticSink,
            readTypeCallback?: ReadTypeFromNodeCacheCallback,
            writeTypeCallback?: WriteTypeToNodeCacheCallback) {
        this._scope = scope;
        this._configOptions = configOptions;
        this._diagnosticSink = diagnosticSink;
        this._readTypeFromCache = readTypeCallback;
        this._writeTypeToCache = writeTypeCallback;
    }

    getType(node: ExpressionNode, flags: EvaluatorFlags): Type {
        let typeResult = this._getTypeFromExpression(node, flags);
        return typeResult.type;
    }

    getTypeFromDecorator(node: DecoratorNode, functionType: Type): Type {
        const baseTypeResult = this._getTypeFromExpression(
            node.leftExpression, EvaluatorFlags.DoNotSpecialize);

        let decoratorCall = baseTypeResult;

        // If the decorator has arguments, evaluate that call first.
        if (node.arguments) {
            const argList = node.arguments.map(arg => {
                return {
                    valueExpression: arg.valueExpression,
                    argumentCategory: arg.argumentCategory,
                    name: arg.name,
                    type: this._getTypeFromExpression(arg.valueExpression,
                        EvaluatorFlags.None).type
                };
            });

            decoratorCall = this._getTypeFromCallExpressionWithBaseType(
                node.leftExpression, argList, decoratorCall, EvaluatorFlags.None);
        }

        const argList = [{
            argumentCategory: ArgumentCategory.Simple,
            type: functionType
        }];

        return this._getTypeFromCallExpressionWithBaseType(
            node.leftExpression, argList, decoratorCall, EvaluatorFlags.None).type;
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

    private _getTypeFromExpression(node: ExpressionNode, flags: EvaluatorFlags): TypeResult {
        // Is this type already cached?
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
            typeResult = { type: AnyType.create(true), node };
        } else if (node instanceof UnaryExpressionNode) {
            typeResult = this._getTypeFromUnaryExpression(node, flags);
        } else if (node instanceof BinaryExpressionNode) {
            typeResult = this._getTypeFromBinaryExpression(node, flags);
        } else if (node instanceof ListNode) {
            typeResult = this._getTypeFromListExpression(node);
        } else if (node instanceof SliceExpressionNode) {
            typeResult = this._getTypeFromSliceExpression(node, flags);
        } else if (node instanceof AwaitExpressionNode) {
            // TODO - need to implement
            typeResult = this._getTypeFromExpression(node.expression, flags);
            typeResult = { type: UnknownType.create(), node };
        } else if (node instanceof TernaryExpressionNode) {
            typeResult = this._getTypeFromTernaryExpression(node, flags);
        } else if (node instanceof ListComprehensionNode) {
            // TODO - infer list type
            // this._getTypeFromExpression(node.baseExpression, EvaluatorFlags.None);
            let type = ScopeUtils.getBuiltInObject(this._scope, 'list', [UnknownType.create()]);
            typeResult = { type, node };
        } else if (node instanceof DictionaryNode) {
            // TODO - infer dict type
            let type = ScopeUtils.getBuiltInObject(this._scope, 'dict',
                [UnknownType.create(), UnknownType.create()]);
            typeResult = { type, node };
        } else if (node instanceof LambdaNode) {
            typeResult = this._getTypeFromLambdaExpression(node);
        } else if (node instanceof SetNode) {
            node.entries.forEach(expr => {
                this._getTypeFromExpression(expr, EvaluatorFlags.None);
            });
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
            // We shouldn't get here. If we do, report an error.
            this._addError(`Unhandled expression type '${ ParseTreeUtils.printExpression(node) }'`, node);
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
            this._addError(`'${ name }' is not defined`, node);
            type = UnknownType.create();
        }

        // Should we specialize the class?
        if ((flags & EvaluatorFlags.DoNotSpecialize) === 0) {
            if (type instanceof ClassType) {
                type = this._createSpecializeClassType(type, undefined, node, flags);
            }
        }

        type = this._convertClassToObjectConditional(type, flags);

        return { type, node };
    }

    private _getTypeFromMemberAccessExpression(node: MemberAccessExpressionNode,
            flags: EvaluatorFlags): TypeResult {

        const baseTypeResult = this._getTypeFromExpression(node.leftExpression, EvaluatorFlags.None);
        const memberType = this._getTypeFromMemberAccessExpressionWithBaseType(node, baseTypeResult, flags);

        if (this._writeTypeToCache) {
            // Cache the type information in the member name node as well.
            this._writeTypeToCache(node.memberName, memberType.type);
        }

        return memberType;
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
        } else if (baseType instanceof TupleType) {
            type = this._validateTypeFromClassMemberAccess(
                node.memberName, baseType.getBaseClass(), MemberAccessFlags.None);
            type = this._bindFunctionToClassOrObject(new ObjectType(baseType.getBaseClass()), type);
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
                    this._addDiagnostic(
                        this._configOptions.reportOptionalMemberAccess,
                        `'${ memberName }' is not a known member of 'None'`, node.memberName);
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
                type = TypeUtils.combineTypes(returnTypes);
            }
        } else if (baseType instanceof PropertyType) {
            if (memberName === 'getter' || memberName === 'setter' || memberName === 'deleter') {
                // Synthesize a decorator.
                const decoratorType = new FunctionType(FunctionTypeFlags.InstanceMethod);
                decoratorType.addParameter({
                    category: ParameterCategory.Simple,
                    name: 'fn',
                    type: UnknownType.create()
                });
                decoratorType.setDeclaredReturnType(baseType);
                type = decoratorType;
            }
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

        // Should we specialize the class?
        if ((flags & EvaluatorFlags.DoNotSpecialize) === 0) {
            if (type instanceof ClassType) {
                type = this._createSpecializeClassType(type, undefined, node, flags);
            }
        }

        type = this._convertClassToObjectConditional(type, flags);

        return { type, node };
    }

    // If the memberType is an instance or class method, creates a new
    // version of the function that has the "self" or "cls" parameter bound
    // to it. If treatAsClassMember is true, the function is treated like a
    // class member even if it's not marked as such. That's needed to
    // special-case the __new__ magic method when it's invoked as a
    // constructor (as opposed to by name).
    private _bindFunctionToClassOrObject(baseType: ClassType | ObjectType | undefined,
            memberType: Type, treatAsClassMember = false): Type {

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
            } else if (memberType.isClassMethod() || treatAsClassMember) {
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
                    this._bindFunctionToClassOrObject(baseType, overload.type,
                        treatAsClassMember) as FunctionType);
            });

            return newOverloadType;
        }

        return memberType;
    }

    private _partiallySpecializeFunctionForBoundClassOrObject(baseType: ClassType | ObjectType,
            memberType: FunctionType): Type {

        let classType = baseType instanceof ClassType ? baseType : baseType.getClassType();

        // If the class has already been specialized (fully or partially), use its
        // existing type arg mappings. If it hasn't, use a fresh type arg map.
        let typeVarMap = classType.getTypeArguments() ?
            TypeUtils.buildTypeVarMapFromSpecializedClass(classType) :
            new TypeVarMap();

        if (memberType.getParameterCount() > 0) {
            let firstParam = memberType.getParameters()[0];

            // Fill out the typeVarMap.
            TypeUtils.canAssignType(firstParam.type, baseType, new DiagnosticAddendum(), typeVarMap);
        }

        const specializedFunction = TypeUtils.specializeType(
            memberType, typeVarMap) as FunctionType;
        return TypeUtils.stripFirstParameter(specializedFunction);
   }

    // A wrapper around _getTypeFromClassMemberName that reports
    // errors if the member name is not found.
    private _validateTypeFromClassMemberAccess(memberNameNode: NameNode,
            classType: ClassType, flags: MemberAccessFlags) {

        // If this is a special type (like "List") that has an alias
        // class (like "list"), switch to the alias, which defines
        // the members.
        const aliasClass = classType.getAliasClass();
        if (aliasClass) {
            classType = aliasClass;
        }

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

        const conditionallySpecialize = (type: Type, classType: ClassType) => {
            if (classType.getTypeArguments()) {
                const typeVarMap = TypeUtils.buildTypeVarMapFromSpecializedClass(classType);
                return TypeUtils.specializeType(type, typeVarMap);
            }
            return type;
        };

        let memberInfo = TypeUtils.lookUpClassMember(classType, memberName,
            !(flags & MemberAccessFlags.SkipInstanceMembers),
            !(flags & MemberAccessFlags.SkipBaseClasses));
        if (memberInfo) {
            let type = TypeUtils.getEffectiveTypeOfMember(memberInfo);

            if (!(flags & MemberAccessFlags.SkipGetCheck)) {
                if (type instanceof PropertyType) {
                    type = conditionallySpecialize(type.getEffectiveReturnType(), classType);
                } else if (type instanceof ObjectType) {
                    // See if there's a magic "__get__" method on the object.
                    const memberClassType = type.getClassType();
                    let getMember = TypeUtils.lookUpClassMember(memberClassType, '__get__', false);
                    if (getMember) {
                        const getType = TypeUtils.getEffectiveTypeOfMember(getMember);
                        if (getType instanceof FunctionType) {
                            type = conditionallySpecialize(getType.getEffectiveReturnType(), memberClassType);
                        }
                    }
                }
            }

            return conditionallySpecialize(type, classType);
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
                        return conditionallySpecialize(getAttribType.getEffectiveReturnType(), classType);
                    }
                }
            }

            let getAttrMember = TypeUtils.lookUpClassMember(classType, '__getattr__', false);
            if (getAttrMember) {
                const getAttrType = TypeUtils.getEffectiveTypeOfMember(getAttrMember);
                if (getAttrType instanceof FunctionType) {
                    return conditionallySpecialize(getAttrType.getEffectiveReturnType(), classType);
                }
            }
        }

        return undefined;
    }

    private _getTypeFromIndexExpression(node: IndexExpressionNode,
            flags: EvaluatorFlags): TypeResult {

        const baseTypeResult = this._getTypeFromExpression(node.baseExpression,
            EvaluatorFlags.DoNotSpecialize);

        const type = TypeUtils.doForSubtypes(baseTypeResult.type, subtype => {
            if (subtype.isAny()) {
                return subtype;
            } else if (subtype instanceof ClassType) {
                let typeArgs = this._getTypeArgs(node.indexExpression);
                return this._createSpecializeClassType(subtype, typeArgs,
                    node.indexExpression, flags);
            } else if (subtype instanceof FunctionType) {
                // TODO - need to implement
                return UnknownType.create();
            } else if (subtype instanceof ObjectType) {
                // TODO - need to implement
                return UnknownType.create();
            } else if (subtype instanceof TupleType) {
                // TODO - need to implement
                return UnknownType.create();
            } else if (subtype instanceof NoneType) {
                this._addDiagnostic(
                    this._configOptions.reportOptionalSubscript,
                    `Optional of type 'None' cannot be subscripted`,
                    node.baseExpression);

                return UnknownType.create();
            } else {
                this._addError(
                    `Object of type '${ subtype.asString() }' cannot be subscripted`,
                    node.baseExpression);

                return UnknownType.create();
            }
        });

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
                        EvaluatorFlags.ConvertClassToObject);
                }),
                node
            };
        } else {
            typeResult = this._getTypeFromExpression(node,
                EvaluatorFlags.ConvertClassToObject);
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

        const argList = node.arguments.map(arg => {
            return {
                valueExpression: arg.valueExpression,
                argumentCategory: arg.argumentCategory,
                name: arg.name,
                type: this._getTypeFromExpression(arg.valueExpression,
                    EvaluatorFlags.None).type
            };
        });

        return this._getTypeFromCallExpressionWithBaseType(
            node.leftExpression, argList, baseTypeResult, flags);
    }

    private _getTypeFromCallExpressionWithBaseType(errorNode: ExpressionNode,
            argList: FunctionArgument[], baseTypeResult: TypeResult,
            flags: EvaluatorFlags): TypeResult {

        let type: Type | undefined;
        const callType = baseTypeResult.type;

        if (callType instanceof ClassType) {
            if (callType.isBuiltIn()) {
                const className = callType.getClassName();

                if (className === 'type') {
                    // Handle the 'type' call specially.
                    if (argList.length >= 1) {
                        let argType = argList[0].type;
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
                    type = this._createTypeVarType(errorNode, argList);
                } else if (className === 'NamedTuple') {
                    type = this._createNamedTupleType(errorNode, argList, true);
                    flags &= ~EvaluatorFlags.ConvertClassToObject;
                }
            }

            // Assume this is a call to the constructor.
            if (!type) {
                type = this._validateConstructorArguments(errorNode, argList, callType);
            }
        } else if (callType instanceof FunctionType) {
            // The stdlib collections/__init__.pyi stub file defines namedtuple
            // as a function rather than a class, so we need to check for it here.
            if (callType.getBuiltInName() === 'namedtuple') {
                type = this._createNamedTupleType(errorNode, argList, false);
                flags &= ~EvaluatorFlags.ConvertClassToObject;
            } else {
                type = this._validateCallArguments(errorNode, argList, callType, new TypeVarMap());
                if (!type) {
                    type = UnknownType.create();
                }
            }
        } else if (callType instanceof OverloadedFunctionType) {
            // Determine which of the overloads (if any) match.
            let functionType = this._findOverloadedFunctionType(errorNode, argList, callType);

            if (functionType) {
                type = this._validateCallArguments(errorNode, argList, callType, new TypeVarMap());
                if (!type) {
                    type = UnknownType.create();
                }
            } else {
                const exprString = ParseTreeUtils.printExpression(errorNode);
                this._addError(
                    `No overloads for '${ exprString }' match parameters`,
                    errorNode);
                type = UnknownType.create();
            }
        } else if (callType instanceof ObjectType) {
            const classType = callType.getClassType();

            // Handle the "Type" object specially.
            if (classType.isBuiltIn() && classType.getClassName() === 'Type') {
                const typeArgs = classType.getTypeArguments();
                if (typeArgs && typeArgs.length >= 1 && typeArgs[0] instanceof ObjectType) {
                    const objType = typeArgs[0] as ObjectType;
                    type = this._validateConstructorArguments(errorNode,
                        argList, objType.getClassType());
                }
            } else {
                let memberType = this._getTypeFromClassMemberName(
                    '__call__', classType, MemberAccessFlags.SkipGetAttributeCheck);
                if (memberType && memberType instanceof FunctionType) {
                    const callMethodType = this._partiallySpecializeFunctionForBoundClassOrObject(
                        callType, memberType);
                    type = this._validateCallArguments(errorNode, argList, callMethodType, new TypeVarMap());
                    if (!type) {
                        type = UnknownType.create();
                    }
                }
            }
        } else if (callType instanceof UnionType) {
            let returnTypes: Type[] = [];
            callType.getTypes().forEach(typeEntry => {
                if (typeEntry instanceof NoneType) {
                    this._addDiagnostic(
                        this._configOptions.reportOptionalCall,
                        `Object of type 'None' cannot be called`,
                        errorNode);
                } else {
                    let typeResult = this._getTypeFromCallExpressionWithBaseType(
                        errorNode,
                        argList,
                        {
                            type: typeEntry,
                            node: baseTypeResult.node
                        },
                        EvaluatorFlags.None);
                    if (typeResult) {
                        returnTypes.push(typeResult.type);
                    }
                }
            });

            if (returnTypes.length > 0) {
                type = TypeUtils.combineTypes(returnTypes);
            }
        } else if (callType.isAny()) {
            type = UnknownType.create();
        }

        if (!type) {
            this._addError(
                `'${ ParseTreeUtils.printExpression(errorNode) }' has type ` +
                `'${ callType.asString() }' and is not callable`,
                errorNode);
            type = UnknownType.create();
        }

        // Should we specialize the class?
        if ((flags & EvaluatorFlags.DoNotSpecialize) === 0) {
            if (type instanceof ClassType) {
                type = this._createSpecializeClassType(type, undefined, errorNode, flags);
            }
        }

        type = this._convertClassToObjectConditional(type, flags);

        return { type, node: baseTypeResult.node };
    }

    private _findOverloadedFunctionType(errorNode: ExpressionNode, argList: FunctionArgument[],
            callType: OverloadedFunctionType): FunctionType | undefined {

        let validOverload: FunctionType | undefined;

        // Temporarily disable diagnostic output.
        this._silenceDiagnostics(() => {
            for (let overload of callType.getOverloads()) {
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

        // See if there's a "__new__" defined within the class (but not its base classes).
        let constructorMethodType = this._getTypeFromClassMemberName('__new__', type,
            MemberAccessFlags.SkipGetAttributeCheck | MemberAccessFlags.SkipInstanceMembers |
                MemberAccessFlags.SkipBaseClasses);
        if (constructorMethodType) {
            constructorMethodType = this._bindFunctionToClassOrObject(
                type, constructorMethodType, true);
            returnType = this._validateCallArguments(errorNode, argList, constructorMethodType,
                new TypeVarMap());
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
                let typeVarMap = new TypeVarMap();
                if (this._validateCallArguments(errorNode, argList, initMethodType, typeVarMap)) {
                    let specializedClassType = type;
                    if (!typeVarMap.isEmpty()) {
                        specializedClassType = TypeUtils.specializeType(type, typeVarMap) as ClassType;
                        assert(specializedClassType instanceof ClassType);
                    }
                    returnType = new ObjectType(specializedClassType);
                }
                validatedTypes = true;
            }
        }

        if (!validatedTypes && argList.length > 0) {
            this._addError(
                `Expected no arguments to '${ type.getClassName() }' constructor`, errorNode);
        } else if (!returnType) {
            // There was no __new__ or __init__, so fall back on the
            // object.__new__ which takes no parameters.
            returnType = new ObjectType(type);
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
            argList: FunctionArgument[], callType: Type, typeVarMap: TypeVarMap): Type | undefined {

        let returnType: Type | undefined;

        if (callType.isAny()) {
            returnType = UnknownType.create();
        } else if (callType instanceof FunctionType) {
            returnType = this._validateFunctionArguments(errorNode, argList, callType, typeVarMap);
        } else if (callType instanceof OverloadedFunctionType) {
            const overloadedFunctionType = this._findOverloadedFunctionType(
                errorNode, argList, callType);
            if (overloadedFunctionType) {
                returnType = this._validateFunctionArguments(errorNode,
                    argList, overloadedFunctionType, typeVarMap);
            }
        } else if (callType instanceof ClassType) {
            if (!callType.isSpecialBuiltIn()) {
                returnType = this._validateConstructorArguments(errorNode, argList, callType);
            } else {
                this._addError(
                    `'${ callType.getClassName() }' cannot be instantiated`,
                    errorNode);
            }
        } else if (callType instanceof ObjectType) {
            let memberType = this._getTypeFromClassMemberName(
                '__call__', callType.getClassType(),
                    MemberAccessFlags.SkipGetAttributeCheck |
                    MemberAccessFlags.SkipInstanceMembers);

            if (memberType && memberType instanceof FunctionType) {
                const callMethodType = TypeUtils.stripFirstParameter(memberType);
                returnType = this._validateCallArguments(
                    errorNode, argList, callMethodType, typeVarMap);
            }
        } else if (callType instanceof UnionType) {
            let returnTypes: Type[] = [];

            for (let type of callType.getTypes()) {
                if (type instanceof NoneType) {
                    this._addDiagnostic(
                        this._configOptions.reportOptionalCall,
                        `Object of type 'None' cannot be called`,
                        errorNode);
                } else {
                    let entryReturnType = this._validateCallArguments(
                        errorNode, argList, type, typeVarMap);
                    if (entryReturnType) {
                        returnTypes.push(entryReturnType);
                    }
                }
            }

            if (returnTypes.length > 0) {
                returnType = TypeUtils.combineTypes(returnTypes);
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
    private _validateFunctionArguments(errorNode: ExpressionNode,
            argList: FunctionArgument[], type: FunctionType, typeVarMap: TypeVarMap): Type | undefined {

        let argIndex = 0;
        const typeParams = type.getParameters();

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
        let positionalArgCount = argList.findIndex(
            arg => arg.argumentCategory === ArgumentCategory.Dictionary || arg.name !== undefined);
        if (positionalArgCount < 0) {
            positionalArgCount = argList.length;
        }

        // Map the positional args to parameters.
        let paramIndex = 0;
        while (argIndex < positionalArgCount) {
            if (paramIndex >= positionalParamCount) {
                let adjustedCount = positionalParamCount;
                this._addError(
                    `Expected ${ adjustedCount } positional argument${ adjustedCount === 1 ? '' : 's' }`,
                    argList[argIndex].valueExpression || errorNode);
                reportedArgError = true;
                break;
            }

            if (typeParams[paramIndex].category === ParameterCategory.VarArgList) {
                // Consume the remaining positional args.
                argIndex = positionalArgCount;
            } else {
                let paramType = type.getEffectiveParameterType(paramIndex);
                if (!this._validateArgType(paramType, argList[argIndex].type,
                        argList[argIndex].valueExpression || errorNode, typeVarMap)) {
                    reportedArgError = true;
                }

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
            let foundListArg = argList.find(
                arg => arg.argumentCategory === ArgumentCategory.List) !== undefined;

            // Now consume any named parameters.
            while (argIndex < argList.length) {
                if (argList[argIndex].argumentCategory === ArgumentCategory.Dictionary) {
                    foundDictionaryArg = true;
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

                                let paramInfoIndex = typeParams.findIndex(
                                    param => param.name === paramNameValue);
                                assert(paramInfoIndex >= 0);
                                const paramType = type.getEffectiveParameterType(paramInfoIndex);
                                if (!this._validateArgType(paramType, argList[argIndex].type,
                                        argList[argIndex].valueExpression || errorNode, typeVarMap)) {
                                    reportedArgError = true;
                                }
                            }
                        } else if (!hasVarArgDictParam) {
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
            if (!foundDictionaryArg && !foundListArg) {
                let unassignedParams = paramMap.getKeys().filter(name => {
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

        return TypeUtils.specializeType(type.getEffectiveReturnType(), typeVarMap);
    }

    private _validateArgType(paramType: Type, argType: Type, errorNode: ExpressionNode,
            typeVarMap: TypeVarMap): boolean {

        const diag = new DiagnosticAddendum();
        if (!TypeUtils.canAssignType(paramType, argType, diag.createAddendum(), typeVarMap)) {
            this._addError(
                `Argument of type '${ argType.asString() }'` +
                    ` cannot be assigned to parameter of type '${ paramType.asString() }'` +
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

        let firstArg = argList[0];
        if (firstArg.valueExpression instanceof StringNode) {
            typeVarName = firstArg.valueExpression.getValue();
        } else {
            this._addError('Expected name of type var as first parameter',
                firstArg.valueExpression || errorNode);
        }

        let typeVar = new TypeVarType(typeVarName);

        // Parse the remaining parameters.
        for (let i = 1; i < argList.length; i++) {
            const paramNameNode = argList[i].name;
            const paramName = paramNameNode ? paramNameNode.nameToken.value : undefined;
            let paramNameMap = new StringMap<string>();

            if (paramName) {
                if (paramNameMap.get(paramName)) {
                    this._addError(
                        `Duplicate parameter name '${ paramName }' not allowed`,
                        argList[i].valueExpression || errorNode);
                }

                if (paramName === 'bound') {
                    if (typeVar.getConstraints().length > 0) {
                        this._addError(
                            `A TypeVar cannot be bounded and constrained`,
                            argList[i].valueExpression || errorNode);
                    } else {
                        typeVar.setBoundType(this._convertClassToObject(argList[i].type));
                    }
                } else if (paramName === 'covariant') {
                    if (argList[i].valueExpression && this._getBooleanValue(argList[i].valueExpression!)) {
                        if (typeVar.isContravariant()) {
                            this._addError(
                                `A TypeVar cannot be both covariant and contravariant`,
                                argList[i].valueExpression!);
                        } else {
                            typeVar.setIsCovariant();
                        }
                    }
                } else if (paramName === 'contravariant') {
                    if (argList[i].valueExpression && this._getBooleanValue(argList[i].valueExpression!)) {
                        if (typeVar.isContravariant()) {
                            this._addError(
                                `A TypeVar cannot be both covariant and contravariant`,
                                argList[i].valueExpression!);
                        } else {
                            typeVar.setIsContravariant();
                        }
                    }
                } else {
                    this._addError(
                        `'${ paramName }' is unknown parameter to TypeVar`,
                        argList[i].valueExpression || errorNode);
                }

                paramNameMap.set(paramName, paramName);
            } else {
                if (typeVar.getBoundType()) {
                    this._addError(
                        `A TypeVar cannot be bounded and constrained`,
                        argList[i].valueExpression || errorNode);
                } else {
                    typeVar.addConstraint(this._convertClassToObject(argList[i].type));
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
    private _createNamedTupleType(errorNode: ExpressionNode, argList: FunctionArgument[],
            includesTypes: boolean): ClassType {

        let className = 'namedtuple';
        if (argList.length === 0) {
            this._addError('Expected named tuple class name as first parameter',
                errorNode);
        } else {
            const nameArg = argList[0];
            if (nameArg.argumentCategory !== ArgumentCategory.Simple) {
                this._addError('Expected named tuple class name as first parameter',
                    argList[0].valueExpression || errorNode);
            } else if (nameArg.valueExpression instanceof StringNode) {
                className = nameArg.valueExpression.getValue();
            }
        }

        let classType = new ClassType(className, ClassTypeFlags.None,
            AnalyzerNodeInfo.getTypeSourceId(errorNode));
        classType.addBaseClass(ScopeUtils.getBuiltInType(this._scope, 'NamedTuple'), false);
        const classFields = classType.getClassFields();
        classFields.set('__class__', new Symbol(classType, DefaultTypeSourceId));
        const instanceFields = classType.getInstanceFields();

        let builtInTupleType = ScopeUtils.getBuiltInType(this._scope, 'tuple');
        if (builtInTupleType instanceof ClassType) {
            let tupleType = new TupleType(builtInTupleType);
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

            if (argList.length < 2) {
                this._addError('Expected named tuple entry list as second parameter',
                    errorNode);
                addGenericGetAttribute = true;
            } else {
                const entriesArg = argList[1];
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
                                        EvaluatorFlags.None);
                                    if (entryTypeInfo) {
                                        entryType = this._convertClassToObject(entryTypeInfo.type);
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

                // For True and False, we can create truthy and falsy
                // versions of 'bool'.
                if (type instanceof ObjectType) {
                    if (node.token.keywordType === KeywordType.True) {
                        type = type.cloneAsTruthy();
                    } else if (node.token.keywordType === KeywordType.False) {
                        type = type.cloneAsFalsy();
                    }
                }
            }
        }

        if (!type) {
            return undefined;
        }

        return { type, node };
    }

    private _getTypeFromUnaryExpression(node: UnaryExpressionNode, flags: EvaluatorFlags): TypeResult {
        let exprType = this._getTypeFromExpression(node.expression, flags).type;

        // Map unary operators to magic functions. Note that the bitwise
        // invert has two magic functions that are aliases of each other.
        const unaryOperatorMap: { [operator: number]: [string, string] } = {
            [OperatorType.Add]: ['__pos__', ''],
            [OperatorType.Subtract]: ['__neg__', ''],
            [OperatorType.Not]: ['__not__', ''],
            [OperatorType.BitwiseInvert]: ['__inv__', '__invert__']
        };

        let type: Type;
        if (exprType.isAny()) {
            type = exprType;
        } else if (exprType instanceof ObjectType) {
            if (node.operator === OperatorType.Not) {
                // The "not" operator always returns a boolean.
                type = ScopeUtils.getBuiltInObject(this._scope, 'bool');
            } else if (node.operator === OperatorType.BitwiseInvert) {
                const intObjType = ScopeUtils.getBuiltInObject(this._scope, 'int');

                if (intObjType.isSame(exprType)) {
                    type = intObjType;
                } else {
                    // TODO - need to handle generic case.
                    type = UnknownType.create();
                }
            } else if (node.operator === OperatorType.Add || node.operator === OperatorType.Subtract) {
                const intType = ScopeUtils.getBuiltInObject(this._scope, 'int');
                const floatType = ScopeUtils.getBuiltInObject(this._scope, 'float');
                const complexType = ScopeUtils.getBuiltInObject(this._scope, 'complex');

                if (intType.isSame(exprType)) {
                    type = intType;
                } else if (floatType.isSame(exprType)) {
                    type = floatType;
                } else if (complexType.isSame(exprType)) {
                    type = complexType;
                } else {
                    // TODO - need to handle generic case.
                    type = UnknownType.create();
                }
            } else {
                // We should never get here.
                this._addError('Unexpected unary operator', node);
                type = UnknownType.create();
            }
        } else {
            // TODO - need to handle additional types.
            type = UnknownType.create();
        }

        return { type, node };
    }

    private _getTypeFromBinaryExpression(node: BinaryExpressionNode, flags: EvaluatorFlags): TypeResult {
        let leftType = this._getTypeFromExpression(node.leftExpression, flags).type;
        let rightType = this._getTypeFromExpression(node.rightExpression, flags).type;

        // Is this an AND operator? If so, we can assume that the
        // rightExpression won't be evaluated at runtime unless the
        // leftExpression evaluates to true.
        let typeConstraints: ConditionalTypeConstraintResults | undefined;
        if (node.operator === OperatorType.And) {
            typeConstraints = this._buildTypeConstraints(node.leftExpression);
        }

        this._useExpressionTypeConstraint(typeConstraints, true, () => {
            this._getTypeFromExpression(node.rightExpression, flags);
        });

        const arithmeticOperatorMap: { [operator: number]: [string, string, boolean] } = {
            [OperatorType.Add]: ['__add__', '__radd__', true],
            [OperatorType.Subtract]: ['__sub__', '__rsub__', true],
            [OperatorType.Multiply]: ['__mul__', '__rmul__', true],
            [OperatorType.FloorDivide]: ['__floordiv__', '__rfloordiv__', true],
            [OperatorType.Divide]: ['__truediv__', '__rtruediv__', true],
            [OperatorType.Mod]: ['__mod__', '__rmod__', true],
            [OperatorType.Power]: ['__power__', '__rpower__', true],
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

        let type: Type;

        if (arithmeticOperatorMap[node.operator]) {
            if (leftType.isAny() || rightType.isAny()) {
                type = UnknownType.create();
            } else if (leftType instanceof ObjectType && rightType instanceof ObjectType) {
                const builtInClassTypes = this._getBuiltInClassTypes(['int', 'float', 'complex']);
                const getTypeMatch = (classType: ClassType): boolean[] => {
                    let foundMatch = false;
                    return builtInClassTypes.map(builtInType => {
                        if (builtInType && builtInType.isSameGenericClass(classType)) {
                            foundMatch = true;
                        }
                        return foundMatch;
                    });
                };

                const leftClassMatches = getTypeMatch(leftType.getClassType());
                const rightClassMatches = getTypeMatch(rightType.getClassType());
                const supportsBuiltInTypes = arithmeticOperatorMap[node.operator][2];

                if (supportsBuiltInTypes && leftClassMatches[0] && rightClassMatches[0]) {
                    // If they're both int types, the result is an int.
                    type = new ObjectType(builtInClassTypes[0]!);
                } else if (supportsBuiltInTypes && leftClassMatches[1] && rightClassMatches[1]) {
                    // If they're both floats or one is a float and one is an int,
                    // the result is a float.
                    type = new ObjectType(builtInClassTypes[1]!);
                } else if (supportsBuiltInTypes && leftClassMatches[2] && rightClassMatches[2]) {
                    // If one is complex and the other is complex, float or int,
                    // the result is complex.
                    type = new ObjectType(builtInClassTypes[2]!);
                } else {
                    // In all other cases, we need to look at the magic methods
                    // on the two types.
                    // TODO - handle the general case
                    type = UnknownType.create();
                }
            } else {
                // TODO - need to handle other types
                type = UnknownType.create();
            }
        } else if (bitwiseOperatorMap[node.operator]) {
            if (leftType.isAny() || rightType.isAny()) {
                type = UnknownType.create();
            } else if (leftType instanceof ObjectType && rightType instanceof ObjectType) {
                const intType = ScopeUtils.getBuiltInType(this._scope, 'int');
                const leftIsInt = intType instanceof ClassType &&
                    leftType.getClassType().isSameGenericClass(intType);
                const rightIsInt = intType instanceof ClassType &&
                    rightType.getClassType().isSameGenericClass(intType);

                if (leftIsInt && rightIsInt) {
                    type = new ObjectType(intType as ClassType);
                } else {
                    // In all other cases, we need to look at the magic methods
                    // on the two types.
                    // TODO - handle the general case
                    type = UnknownType.create();
                }
            } else {
                // TODO - need to handle other types
                type = UnknownType.create();
            }
        } else if (comparisonOperatorMap[node.operator]) {
            type = ScopeUtils.getBuiltInObject(this._scope, 'bool');
        } else if (booleanOperatorMap[node.operator]) {
            if (node.operator === OperatorType.And) {
                // If the operator is an AND or OR, we need to combine the two types.
                type = TypeUtils.combineTypes([
                    TypeUtils.removeTruthinessFromType(leftType), rightType]);
            } else if (node.operator === OperatorType.Or) {
                type = TypeUtils.combineTypes([
                    TypeUtils.removeFalsinessFromType(leftType), rightType]);
            } else {
                // The other boolean operators always return a bool value.
                // TODO - validate inputs for "is", "is not", "in" and "not in" operators.
                type = ScopeUtils.getBuiltInObject(this._scope, 'bool');
            }
        } else {
            // We should never get here.
            this._addError('Unexpected binary operator', node);
            type = UnknownType.create();
        }

        return { type, node };
    }

    private _getBuiltInClassTypes(names: string[]): (ClassType | undefined)[] {
        return names.map(name => {
            let classType = ScopeUtils.getBuiltInType(this._scope, name);
            return classType instanceof ClassType ? classType : undefined;
        });
    }

    private _getBuiltInTypeFromLiteralExpression(node: ExpressionNode,
            typeName: string): TypeResult | undefined {

        let type = ScopeUtils.getBuiltInObject(this._scope, typeName);

        if (!type) {
            return undefined;
        }

        return { type, node };
    }

    private _getTypeFromListExpression(node: ListNode): TypeResult {
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
            convertedType = this._convertClassToObject(type);
        } else {
            convertedType = UnknownType.create();
        }

        return { type: convertedType, node };
    }

    private _getTypeFromTernaryExpression(node: TernaryExpressionNode, flags: EvaluatorFlags): TypeResult {
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

        let type = TypeUtils.combineTypes([ifType!.type, elseType!.type]);
        return { type, node };
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

    private _getTypeFromSliceExpression(node: SliceExpressionNode, flags: EvaluatorFlags): TypeResult {
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

            convertedType = this._convertClassToObject(type);
        } else {
            convertedType = UnknownType.create();
        }

        return { type: convertedType, node };
    }

    // Converts the type parameters for a Callable type. It should
    // have zero to two parameters. The first parameter, if present, should be
    // either an ellipsis or a list of parameter types. The second parameter, if
    // present, should specify the return type.
    private _createCallableType(typeArgs?: TypeResult[]): FunctionType {
        let functionType = new FunctionType(FunctionTypeFlags.None);
        functionType.setDeclaredReturnType(AnyType.create());

        if (typeArgs && typeArgs.length > 0) {
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

        if (typeArgs && typeArgs.length > 1) {
            functionType.setDeclaredReturnType(typeArgs[1].type);
        } else {
            functionType.setDeclaredReturnType(AnyType.create());
        }

        if (typeArgs && typeArgs.length > 2) {
            this._addError(`Expected only two type arguments to 'Callable'`, typeArgs[2].node);
        }

        return functionType;
    }

    // Converts the type parameters for a Tuple type. It should have zero
    // or more parameters, and the last one can be an ellipsis.
    private _createTupleType(typeArgs?: TypeResult[]): TupleType {
        let typeArgTypes = typeArgs ? typeArgs.map(t => t.type) : [];

        if (!typeArgs) {
            // PEP 484 indicates that "Tuple" is equivalent
            // to "Tuple[Any, ...]".
            typeArgTypes.push(AnyType.create(false));
            typeArgTypes.push(AnyType.create(true));
        }

        let tupleType = new TupleType(ScopeUtils.getBuiltInType(this._scope, 'tuple') as ClassType);

        if (typeArgTypes.length > 0) {
            const lastType = typeArgTypes[typeArgTypes.length - 1];
            if (lastType instanceof AnyType && lastType.isEllipsis()) {
                tupleType.setAllowMoreEntries();
                typeArgTypes.pop();
            }
        }

        for (let typeArgType of typeArgTypes) {
            tupleType.addEntryType(typeArgType);
        }

        return tupleType;
    }

    // Creates an Optional[X, Y, Z] type.
    private _createOptionalType(errorNode: ExpressionNode, typeArgs?: TypeResult[]): Type {
        if (!typeArgs || typeArgs.length !== 1) {
            this._addError(`Expected one type parameter after Optional`, errorNode);
            return UnknownType.create();
        }

        return TypeUtils.combineTypes([typeArgs[0].type, NoneType.create()]);
    }

    // Creates a ClassVar type.
    private _createClassVarType(typeArgs: TypeResult[] | undefined): Type {
        if (typeArgs && typeArgs.length > 1) {
            this._addError(`Expected only one type parameter after ClassVar`, typeArgs[1].node);
        }

        let type = (!typeArgs || typeArgs.length === 0) ? AnyType.create() : typeArgs[0].type;
        return this._convertClassToObject(type);
}

    // Creates one of several "special" types that are defined in typing.pyi
    // but not declared in their entirety. This includes the likes of "Type",
    // "Callable", etc.
    private _createSpecialType(classType: ClassType, typeArgs: TypeResult[] | undefined,
            flags: EvaluatorFlags, paramLimit?: number): Type {

        let typeArgTypes = typeArgs ? typeArgs.map(t => t.type) : [];
        const typeArgCount = typeArgTypes.length;

        // Make sure the argument list count is correct.
        if (paramLimit !== undefined) {
            if (typeArgs && typeArgCount > paramLimit) {
                this._addError(
                    `Expected at most ${ paramLimit } type arguments`, typeArgs[paramLimit].node);
                typeArgTypes = typeArgTypes.slice(0, paramLimit);
            } else if (typeArgCount < paramLimit) {
                // Fill up the remainder of the slots with unknown types.
                while (typeArgTypes.length < paramLimit) {
                    typeArgTypes.push(UnknownType.create());
                }
            }
        }

        let specializedType = classType.cloneForSpecialization(typeArgTypes);

        return this._convertClassToObjectConditional(specializedType, flags);
    }

    // Unpacks the index expression for a "Union[X, Y, Z]" type annotation.
    private _createUnionType(typeArgs?: TypeResult[]): Type {
        let types: Type[] = [];

        if (typeArgs) {
            for (let typeArg of typeArgs) {
                if (typeArg.type) {
                    types.push(typeArg.type);
                }
            }
        }

        if (types.length > 0) {
            return TypeUtils.combineTypes(types);
        }

        return NoneType.create();
    }

    // Creates a type that represents "Generic[T1, T2, ...]", used in the
    // definition of a generic class.
    private _createGenericType(errorNode: ExpressionNode, classType: ClassType,
            typeArgs?: TypeResult[]): Type {

        // Make sure there's at least one type arg.
        if (!typeArgs || typeArgs.length === 0) {
            this._addError(
                `'Generic' requires at least one type argument`, errorNode);
        }

        // Make sure that all of the type args are typeVars and are unique.
        let uniqueTypeVars: TypeVarType[] = [];
        if (typeArgs) {
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
        }

        return this._createSpecialType(classType, typeArgs, EvaluatorFlags.None);
    }

    private _createSpecializedClassType(classType: ClassType, typeArgs?: TypeResult[]): Type {
        let typeArgCount = typeArgs ? typeArgs.length : 0;

        // Make sure the argument list count is correct.
        let typeParameters = classType.getTypeParameters();

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
                    `Expected at most ${ typeParameters.length } type arguments`,
                    typeArgs[typeParameters.length].node);
            }
            typeArgCount = typeParameters.length;
        }

        // Fill in any missing type arguments with Any.
        let typeArgTypes = typeArgs ? typeArgs.map(t => t.type) : [];
        while (typeArgTypes.length < classType.getTypeParameters().length) {
            typeArgTypes.push(AnyType.create());
        }

        typeArgTypes.forEach((typeArgType, index) => {
            if (index < typeArgCount) {
                const diag = new DiagnosticAddendum();
                if (!TypeUtils.canAssignToTypeVar(typeParameters[index], typeArgType, diag)) {
                    this._addError(`Type '${ typeArgType.asString() }' ` +
                            `cannot be assigned to type variable '${ typeParameters[index].getName() }'` +
                            diag.getString(),
                        typeArgs![index].node);
                }
            }
        });

        let specializedClass = classType.cloneForSpecialization(typeArgTypes);

        return specializedClass;
    }

    private _applyTypeConstraint(node: ExpressionNode, unconstrainedType: Type): Type {
        // Shortcut the process if the type is unknown.
        if (unconstrainedType.isAny()) {
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
        // If we've hit a permanent scope, don't recurse any further.
        if (scope.getType() !== ScopeType.Temporary) {
            return type;
        }

        // Determine if any of the local constraints is blocking constraints
        // from parent scopes from being applied.
        let blockParentConstraints = false;
        for (let constraint of scope.getTypeConstraints()) {
            if (constraint.blockSubsequentContraints(node)) {
                blockParentConstraints = true;
                break;
            }
        }

        if (!blockParentConstraints) {
            // Recursively allow the parent scopes to apply their type constraints.
            const parentScope = scope.getParent();
            if (parentScope) {
                type = this._applyScopeTypeConstraintRecursive(node, type, parentScope);
            }
        }

        // Apply the constraints within the current scope. Stop if one of
        // them indicates that further constraints shouldn't be applied.
        for (let constraint of scope.getTypeConstraints()) {
            type = constraint.applyToType(node, type);

            if (constraint.blockSubsequentContraints(node)) {
                break;
            }
        }

        return type;
    }

    // Specializes the specified (potentially generic) class type using
    // the specified type arguments, reporting errors as appropriate.
    // Returns the specialized type and a boolean indicating whether
    // the type indicates a class type (true) or an object type (false).
    private _createSpecializeClassType(classType: ClassType, typeArgs: TypeResult[] | undefined,
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
                    return this._createClassVarType(typeArgs);
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

                case 'Protocol': {
                    return this._createSpecialType(classType, typeArgs, flags);
                }

                case 'Tuple': {
                    return this._createTupleType(typeArgs);
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
        return this._convertClassToObjectConditional(specializedType, flags);
    }

    private _convertClassToObjectConditional(type: Type, flags: EvaluatorFlags): Type {
        if (flags & EvaluatorFlags.ConvertClassToObject) {
           return this._convertClassToObject(type);
        }

        return type;
    }

    private _convertClassToObject(type: Type): Type {
        if (type instanceof ClassType) {
            type = new ObjectType(type);
        } else if (type instanceof UnionType) {
            return TypeUtils.doForSubtypes(type,
                subtype => this._convertClassToObject(subtype));
        }

        return type;
    }

    private _useExpressionTypeConstraint(typeConstraints:
            ConditionalTypeConstraintResults | undefined,
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
        return TypeConstraintBuilder.buildTypeConstraintsForConditional(node,
            (node: ExpressionNode) => this.getType(node, EvaluatorFlags.None));
    }

    private _silenceDiagnostics(callback: () => void) {
        let oldDiagSink = this._diagnosticSink;
        this._diagnosticSink = undefined;

        callback();

        this._diagnosticSink = oldDiagSink;
    }

    private _addWarning(message: string, range: TextRange) {
        if (this._diagnosticSink) {
            this._diagnosticSink.addWarningWithTextRange(message, range);
        }
    }

    private _addError(message: string, range: TextRange) {
        if (this._diagnosticSink) {
            this._diagnosticSink.addErrorWithTextRange(message, range);
        }
    }

    private _addDiagnostic(diagLevel: DiagnosticLevel, message: string, textRange: TextRange) {
        if (diagLevel === 'error') {
            this._addError(message, textRange);
        } else if (diagLevel === 'warning') {
            this._addWarning(message, textRange);
        }
    }
}
