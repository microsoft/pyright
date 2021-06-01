/*
 * typeUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Collection of functions that operate on Type objects.
 */

import { assert } from 'console';

import { ParameterCategory } from '../parser/parseNodes';
import { DeclarationType } from './declaration';
import { Symbol, SymbolFlags, SymbolTable } from './symbol';
import { isTypedDictMemberAccessedThroughIndex } from './symbolUtils';
import {
    AnyType,
    ClassType,
    combineTypes,
    findSubtype,
    FunctionType,
    FunctionTypeFlags,
    isAny,
    isAnyOrUnknown,
    isClass,
    isFunction,
    isNever,
    isNone,
    isObject,
    isOverloadedFunction,
    isParamSpec,
    isTypeSame,
    isTypeVar,
    isUnbound,
    isUnion,
    isUnknown,
    isVariadicTypeVar,
    maxTypeRecursionCount,
    ModuleType,
    NeverType,
    NoneType,
    ObjectType,
    OverloadedFunctionType,
    ParamSpecEntry,
    ParamSpecValue,
    removeFromUnion,
    SpecializedFunctionTypes,
    Type,
    TypeBase,
    TypeCategory,
    TypeCondition,
    TypeVarScopeId,
    TypeVarType,
    UnknownType,
} from './types';
import { TypeVarMap } from './typeVarMap';

export interface ClassMember {
    // Symbol
    symbol: Symbol;

    // Partially-specialized class that contains the class member
    classType: ClassType | UnknownType;

    // True if instance member, false if class member
    isInstanceMember: boolean;

    // True if member has declared type, false if inferred
    isTypeDeclared: boolean;
}

export const enum ClassMemberLookupFlags {
    Default = 0,

    // By default, the original (derived) class is searched along
    // with its base classes. If this flag is set, the original
    // class is skipped and only the base classes are searched.
    SkipOriginalClass = 1 << 0,

    // By default, base classes are searched as well as the
    // original (derived) class. If this flag is set, no recursion
    // is performed.
    SkipBaseClasses = 1 << 1,

    // Skip the 'object' base class in particular.
    SkipObjectBaseClass = 1 << 2,

    // By default, both class and instance variables are searched.
    // If this flag is set, the instance variables are skipped.
    SkipInstanceVariables = 1 << 3,

    // By default, the first symbol is returned even if it has only
    // an inferred type associated with it. If this flag is set,
    // the search looks only for symbols with declared types.
    DeclaredTypesOnly = 1 << 4,
}

export const enum ClassIteratorFlags {
    Default = 0,

    // By default, the original (derived) class is searched along
    // with its base classes. If this flag is set, the original
    // class is skipped and only the base classes are searched.
    SkipOriginalClass = 1 << 0,

    // By default, base classes are searched as well as the
    // original (derived) class. If this flag is set, no recursion
    // is performed.
    SkipBaseClasses = 1 << 1,

    // Skip the 'object' base class in particular.
    SkipObjectBaseClass = 1 << 2,
}

export const enum CanAssignFlags {
    Default = 0,

    // Require invariance with respect to class matching? Normally
    // subclasses are allowed.
    EnforceInvariance = 1 << 0,

    // The caller has swapped the source and dest types because
    // the types are contravariant. Perform type var matching
    // on dest type vars rather than source type var.
    ReverseTypeVarMatching = 1 << 1,

    // Normally invariant and contravariant TypeVars cannot be
    // narrowed. This overrides the standard behavior.
    AllowTypeVarNarrowing = 1 << 2,

    // Normally type vars are treated as variables that need to
    // be "solved". If this flag is set, they are treated as types
    // that must match. It is used for overload consistency checking.
    SkipSolveTypeVars = 1 << 3,

    // If the dest is not Any but the src is Any, treat it
    // as incompatible.
    DisallowAssignFromAny = 1 << 4,

    // For function types, skip the return type check.
    SkipFunctionReturnTypeCheck = 1 << 5,

    // Allow bool values to be assigned to TypeGuard[x] types.
    AllowBoolTypeGuard = 1 << 6,

    // In most cases, literals are stripped when assigning to a
    // type variable. This overrides the standard behavior.
    RetainLiteralsForTypeVar = 1 << 7,
}

interface TypeVarTransformer {
    transformTypeVar: (typeVar: TypeVarType) => Type;
    transformVariadicTypeVar: (paramSpec: TypeVarType) => Type[] | undefined;
    transformParamSpec: (paramSpec: TypeVarType) => ParamSpecValue | undefined;
}

let synthesizedTypeVarIndexForExpectedType = 1;

export function isOptionalType(type: Type): boolean {
    if (isUnion(type)) {
        return findSubtype(type, (subtype) => isNone(subtype)) !== undefined;
    }

    return false;
}

// Calls a callback for each subtype and combines the results
// into a final type.
export function mapSubtypes(type: Type, callback: (type: Type) => Type | undefined): Type {
    if (isUnion(type)) {
        const newSubtypes: Type[] = [];
        let typeChanged = false;

        type.subtypes.forEach((subtype) => {
            const transformedType = callback(subtype);
            if (transformedType) {
                if (transformedType !== subtype) {
                    newSubtypes.push(addConditionToType(transformedType, getTypeCondition(type)));
                    typeChanged = true;
                } else {
                    newSubtypes.push(subtype);
                }
            } else {
                typeChanged = true;
            }
        });

        return typeChanged ? combineTypes(newSubtypes) : type;
    }

    const transformedSubtype = callback(type);
    if (!transformedSubtype) {
        return NeverType.create();
    }
    return transformedSubtype;
}

export function doForEachSubtype(type: Type, callback: (type: Type, index: number) => void): void {
    if (isUnion(type)) {
        type.subtypes.forEach((subtype, index) => {
            callback(subtype, index);
        });
    } else {
        callback(type, 0);
    }
}

// Determines if all of the types in the array are the same.
export function areTypesSame(types: Type[], ignorePseudoGeneric: boolean): boolean {
    if (types.length < 2) {
        return true;
    }

    for (let i = 1; i < types.length; i++) {
        if (!isTypeSame(types[0], types[i], ignorePseudoGeneric)) {
            return false;
        }
    }

    return true;
}

export function derivesFromAnyOrUnknown(type: Type): boolean {
    let anyOrUnknown = false;

    doForEachSubtype(type, (subtype) => {
        if (isAnyOrUnknown(type)) {
            anyOrUnknown = true;
        } else if (isClass(subtype)) {
            if (ClassType.hasUnknownBaseClass(subtype)) {
                anyOrUnknown = true;
            }
        } else if (isObject(subtype)) {
            if (ClassType.hasUnknownBaseClass(subtype.classType)) {
                anyOrUnknown = true;
            }
        }
    });

    return anyOrUnknown;
}

export function getFullNameOfType(type: Type): string | undefined {
    if (type.typeAliasInfo?.fullName) {
        return type.typeAliasInfo.fullName;
    }

    switch (type.category) {
        case TypeCategory.Any:
        case TypeCategory.Unknown:
            return 'typing.Any';

        case TypeCategory.None:
            return 'builtins.None';

        case TypeCategory.Class:
            return type.details.fullName;

        case TypeCategory.Object:
            return type.classType.details.fullName;

        case TypeCategory.Function:
            return type.details.fullName;

        case TypeCategory.Module:
            return type.moduleName;

        case TypeCategory.OverloadedFunction:
            return type.overloads[0].details.fullName;
    }

    return undefined;
}

export function stripLiteralValue(type: Type): Type {
    if (isObject(type)) {
        if (type.classType.literalValue !== undefined) {
            type = ObjectType.create(ClassType.cloneWithLiteral(type.classType, undefined));
        }

        return type;
    }

    if (isClass(type)) {
        if (type.literalValue !== undefined) {
            type = ClassType.cloneWithLiteral(type, undefined);
        }

        return type;
    }

    if (isUnion(type)) {
        return mapSubtypes(type, (subtype) => {
            return stripLiteralValue(subtype);
        });
    }

    return type;
}

export function addConditionToType(type: Type, condition: TypeCondition[] | undefined): Type {
    if (!condition) {
        return type;
    }

    switch (type.category) {
        case TypeCategory.Unbound:
        case TypeCategory.Unknown:
        case TypeCategory.Any:
        case TypeCategory.Never:
        case TypeCategory.Module:
        case TypeCategory.TypeVar:
            return type;

        case TypeCategory.None:
        case TypeCategory.Class:
        case TypeCategory.Function:
            return TypeBase.cloneForCondition(type, TypeCondition.combine(type.condition, condition));

        case TypeCategory.OverloadedFunction:
            return OverloadedFunctionType.create(
                type.overloads.map((t) => addConditionToType(t, condition) as FunctionType)
            );

        case TypeCategory.Object:
            return ObjectType.create(addConditionToType(type.classType, condition) as ClassType);

        case TypeCategory.Union:
            return combineTypes(type.subtypes.map((t) => addConditionToType(t, condition)));
    }
}

export function getTypeCondition(type: Type): TypeCondition[] | undefined {
    switch (type.category) {
        case TypeCategory.Unbound:
        case TypeCategory.Unknown:
        case TypeCategory.Any:
        case TypeCategory.Never:
        case TypeCategory.Module:
        case TypeCategory.TypeVar:
        case TypeCategory.OverloadedFunction:
        case TypeCategory.Union:
            return undefined;

        case TypeCategory.None:
        case TypeCategory.Class:
        case TypeCategory.Function:
            return type.condition;

        case TypeCategory.Object:
            return getTypeCondition(type.classType);
    }
}

// If the type is a concrete class X described by the object Type[X],
// returns X. Otherwise returns the original type.
export function transformTypeObjectToClass(type: Type): Type {
    if (!isObject(type)) {
        return type;
    }

    const classType = type.classType;
    if (!ClassType.isBuiltIn(classType, 'Type')) {
        return type;
    }

    if (!classType.typeArguments || classType.typeArguments.length < 1) {
        return UnknownType.create();
    }

    return convertToInstantiable(classType.typeArguments[0]);
}

// Indicates whether the specified type is a recursive type alias
// placeholder that has not yet been resolved.
export function isTypeAliasPlaceholder(type: Type): type is TypeVarType {
    if (!isTypeVar(type)) {
        return false;
    }

    return !!type.details.recursiveTypeAliasName && !type.details.boundType;
}

// Determines whether the type alias placeholder is used directly
// within the specified type. It's OK if it's used indirectly as
// a type argument.
export function isTypeAliasRecursive(typeAliasPlaceholder: TypeVarType, type: Type) {
    if (type.category !== TypeCategory.Union) {
        // Handle the specific case where the type alias directly refers to itself.
        // In this case, the type will be unbound because it could not be resolved.
        return (
            isUnbound(type) &&
            type.typeAliasInfo &&
            type.typeAliasInfo.name === typeAliasPlaceholder.details.recursiveTypeAliasName
        );
    }

    return findSubtype(type, (subtype) => isTypeSame(typeAliasPlaceholder, subtype)) !== undefined;
}

export function transformPossibleRecursiveTypeAlias(type: Type): Type;
export function transformPossibleRecursiveTypeAlias(type: Type | undefined): Type | undefined;
export function transformPossibleRecursiveTypeAlias(type: Type | undefined): Type | undefined {
    if (type) {
        if (isTypeVar(type) && type.details.recursiveTypeAliasName && type.details.boundType) {
            const unspecializedType = TypeBase.isInstance(type)
                ? convertToInstance(type.details.boundType)
                : type.details.boundType;

            if (!type.typeAliasInfo?.typeArguments || !type.details.recursiveTypeParameters) {
                return unspecializedType;
            }

            const typeVarMap = buildTypeVarMap(
                type.details.recursiveTypeParameters,
                type.typeAliasInfo.typeArguments,
                getTypeVarScopeId(type)
            );
            return applySolvedTypeVars(unspecializedType, typeVarMap);
        }
    }

    return type;
}

// None is always falsy. All other types are generally truthy
// unless they are objects that support the __bool__ or __len__
// methods.
export function canBeFalsy(type: Type, recursionLevel = 0): boolean {
    if (recursionLevel > maxTypeRecursionCount) {
        return true;
    }

    switch (type.category) {
        case TypeCategory.Unbound:
        case TypeCategory.Unknown:
        case TypeCategory.Any:
        case TypeCategory.Never:
        case TypeCategory.None: {
            return true;
        }

        case TypeCategory.Union: {
            return findSubtype(type, (subtype) => canBeFalsy(subtype, recursionLevel + 1)) !== undefined;
        }

        case TypeCategory.Function:
        case TypeCategory.OverloadedFunction:
        case TypeCategory.Class:
        case TypeCategory.Module:
        case TypeCategory.TypeVar: {
            return false;
        }

        case TypeCategory.Object: {
            // Handle tuples specially.
            if (isTupleClass(type.classType) && type.classType.tupleTypeArguments) {
                return isOpenEndedTupleClass(type.classType) || type.classType.tupleTypeArguments.length === 0;
            }

            // Check for Literal[False] and Literal[True].
            if (ClassType.isBuiltIn(type.classType, 'bool') && type.classType.literalValue !== undefined) {
                return type.classType.literalValue === false;
            }

            const lenMethod = lookUpObjectMember(type, '__len__');
            if (lenMethod) {
                return true;
            }

            const boolMethod = lookUpObjectMember(type, '__bool__');
            if (boolMethod) {
                return true;
            }

            return false;
        }
    }
}

export function canBeTruthy(type: Type, recursionLevel = 0): boolean {
    if (recursionLevel > maxTypeRecursionCount) {
        return true;
    }

    switch (type.category) {
        case TypeCategory.Unknown:
        case TypeCategory.Function:
        case TypeCategory.OverloadedFunction:
        case TypeCategory.Class:
        case TypeCategory.Module:
        case TypeCategory.TypeVar:
        case TypeCategory.Never:
        case TypeCategory.Any: {
            return true;
        }

        case TypeCategory.Union: {
            return findSubtype(type, (subtype) => canBeTruthy(subtype, recursionLevel + 1)) !== undefined;
        }

        case TypeCategory.Unbound:
        case TypeCategory.None: {
            return false;
        }

        case TypeCategory.Object: {
            // Check for Tuple[()] (an empty tuple).
            if (isTupleClass(type.classType)) {
                if (type.classType.tupleTypeArguments && type.classType.tupleTypeArguments.length === 0) {
                    return false;
                }
            }

            // Check for Literal[False], Literal[0], Literal[""].
            if (
                type.classType.literalValue === false ||
                type.classType.literalValue === 0 ||
                type.classType.literalValue === ''
            ) {
                return false;
            }

            return true;
        }
    }
}

export function getTypeVarScopeId(type: Type): TypeVarScopeId | undefined {
    if (isClass(type)) {
        return type.details.typeVarScopeId;
    }

    if (isObject(type)) {
        return type.classType.details.typeVarScopeId;
    }

    if (isFunction(type)) {
        return type.details.typeVarScopeId;
    }

    if (isTypeVar(type)) {
        return type.scopeId;
    }

    return undefined;
}

// Determines whether the type is a Tuple class or object.
export function getSpecializedTupleType(type: Type): ClassType | undefined {
    let classType: ClassType | undefined;

    if (isClass(type)) {
        classType = type;
    } else if (isObject(type)) {
        classType = type.classType;
    }

    if (!classType) {
        return undefined;
    }

    // See if this class derives from Tuple or tuple. If it does, we'll assume that it
    // hasn't been overridden in a way that changes the behavior of the tuple class.
    const tupleClass = classType.details.mro.find((mroClass) => isClass(mroClass) && isTupleClass(mroClass));
    if (!tupleClass || !isClass(tupleClass)) {
        return undefined;
    }

    if (ClassType.isSameGenericClass(classType, tupleClass)) {
        return classType;
    }

    const typeVarMap = buildTypeVarMapFromSpecializedClass(classType);
    return applySolvedTypeVars(tupleClass, typeVarMap) as ClassType;
}

export function isLiteralType(type: ObjectType): boolean {
    return type.classType.literalValue !== undefined;
}

export function isLiteralTypeOrUnion(type: Type): boolean {
    if (isObject(type)) {
        return type.classType.literalValue !== undefined;
    }

    if (isUnion(type)) {
        return !findSubtype(type, (subtype) => !isObject(subtype) || subtype.classType.literalValue === undefined);
    }

    return false;
}

export function containsLiteralType(type: Type): boolean {
    if (isObject(type) && isLiteralType(type)) {
        return true;
    }

    if (isUnion(type)) {
        return type.subtypes.some((subtype) => isObject(subtype) && isLiteralType(subtype));
    }

    return false;
}

export function isEllipsisType(type: Type): boolean {
    return isAny(type) && type.isEllipsis;
}

export function isNoReturnType(type: Type): boolean {
    return isObject(type) && ClassType.isBuiltIn(type.classType, 'NoReturn');
}

export function removeNoReturnFromUnion(type: Type): Type {
    return removeFromUnion(type, (subtype) => isNoReturnType(subtype));
}

export function isProperty(type: Type): type is ObjectType {
    return isObject(type) && ClassType.isPropertyClass(type.classType);
}

export function isTupleClass(type: ClassType) {
    return ClassType.isBuiltIn(type, 'tuple');
}

// Indicates whether the type is a tuple class of
// the form tuple[x, ...] where the number of elements
// in the tuple is unknown.
export function isOpenEndedTupleClass(type: ClassType) {
    return (
        type.tupleTypeArguments && type.tupleTypeArguments.length === 2 && isEllipsisType(type.tupleTypeArguments[1])
    );
}

// Partially specializes a type within the context of a specified
// (presumably specialized) class.
export function partiallySpecializeType(type: Type, contextClassType: ClassType): Type {
    // If the context class is not specialized (or doesn't need specialization),
    // then there's no need to do any more work.
    if (ClassType.isGeneric(contextClassType)) {
        return type;
    }

    // Partially specialize the type using the specialized class type vars.
    const typeVarMap = buildTypeVarMapFromSpecializedClass(contextClassType);
    return applySolvedTypeVars(type, typeVarMap);
}

// Specializes a (potentially generic) type by substituting
// type variables from a type var map.
export function applySolvedTypeVars(
    type: Type,
    typeVarMap: TypeVarMap,
    unknownIfNotFound = false,
    useNarrowBoundOnly = false
): Type {
    if (typeVarMap.isEmpty() && !unknownIfNotFound) {
        return type;
    }

    return _transformTypeVars(type, {
        transformTypeVar: (typeVar: TypeVarType) => {
            // If the type variable is unrelated to the scopes we're solving,
            // don't transform that type variable.
            if (typeVar.scopeId && typeVarMap.hasSolveForScope(typeVar.scopeId)) {
                const replacement = typeVarMap.getTypeVarType(typeVar, useNarrowBoundOnly);
                if (replacement) {
                    return replacement;
                }

                // If this typeVar is in scope for what we're solving but the type
                // var map doesn't contain any entry for it, replace with Unknown.
                if (unknownIfNotFound) {
                    return UnknownType.create();
                }
            }

            return typeVar;
        },
        transformVariadicTypeVar: (typeVar: TypeVarType) => {
            if (!typeVar.scopeId || !typeVarMap.hasSolveForScope(typeVar.scopeId)) {
                return undefined;
            }

            return typeVarMap.getVariadicTypeVar(typeVar);
        },
        transformParamSpec: (paramSpec: TypeVarType) => {
            if (!paramSpec.scopeId || !typeVarMap.hasSolveForScope(paramSpec.scopeId)) {
                return undefined;
            }

            return typeVarMap.getParamSpec(paramSpec);
        },
    });
}

// During bidirectional type inference for constructors, an "executed type"
// is used to prepopulate the type var map. This is problematic when the
// expected type uses TypeVars that are not part of the context of the
// class we are constructor. We'll replace these type variables with dummy
// type variables that are scoped to the appropriate context.
export function transformExpectedTypeForConstructor(
    expectedType: Type,
    typeVarMap: TypeVarMap,
    liveTypeVarScopes: TypeVarScopeId[]
): Type | undefined {
    const isTypeVarLive = (typeVar: TypeVarType) => liveTypeVarScopes.some((scopeId) => typeVar.scopeId === scopeId);

    const createDummyTypeVar = (prevTypeVar: TypeVarType) => {
        // If we previously synthesized this dummy type var, just return it.
        if (prevTypeVar.details.isSynthesized && prevTypeVar.details.name.startsWith(dummyTypeVarPrefix)) {
            return prevTypeVar;
        }

        const isInstance = TypeBase.isInstance(prevTypeVar);
        let newTypeVar = TypeVarType.createInstance(`__expected_type_${synthesizedTypeVarIndexForExpectedType}`);
        newTypeVar.details.isSynthesized = true;
        newTypeVar.scopeId = dummyScopeId;
        newTypeVar.nameWithScope = TypeVarType.makeNameWithScope(newTypeVar.details.name, dummyScopeId);
        if (!isInstance) {
            newTypeVar = convertToInstantiable(newTypeVar) as TypeVarType;
        }

        // If the original TypeVar was bound or constrained, make the replacement as well.
        newTypeVar.details.boundType = prevTypeVar.details.boundType;
        newTypeVar.details.constraints = prevTypeVar.details.constraints;

        // Also copy the variance.
        newTypeVar.details.variance = prevTypeVar.details.variance;

        synthesizedTypeVarIndexForExpectedType++;
        return newTypeVar;
    };

    // Handle "naked TypeVars" (i.e. the expectedType is a TypeVar itself)
    // specially. Return undefined to indicate that it's an out-of-scope
    // TypeVar.
    if (isTypeVar(expectedType)) {
        if (isTypeVarLive(expectedType)) {
            return expectedType;
        }

        return undefined;
    }

    const dummyScopeId = '__expected_type_scope_id';
    const dummyTypeVarPrefix = '__expected_type_';
    typeVarMap.addSolveForScope(dummyScopeId);

    return _transformTypeVars(expectedType, {
        transformTypeVar: (typeVar: TypeVarType) => {
            // If the type variable is unrelated to the scopes we're solving,
            // don't transform that type variable.
            if (isTypeVarLive(typeVar)) {
                return typeVar;
            }

            return createDummyTypeVar(typeVar);
        },
        transformVariadicTypeVar: (typeVar: TypeVarType) => {
            return undefined;
        },
        transformParamSpec: (paramSpec: TypeVarType) => {
            return undefined;
        },
    });
}

export function lookUpObjectMember(
    objectType: Type,
    memberName: string,
    flags = ClassMemberLookupFlags.Default
): ClassMember | undefined {
    if (isObject(objectType)) {
        return lookUpClassMember(objectType.classType, memberName, flags);
    }

    return undefined;
}

// Looks up a member in a class using the multiple-inheritance rules
// defined by Python.
export function lookUpClassMember(
    classType: Type,
    memberName: string,
    flags = ClassMemberLookupFlags.Default
): ClassMember | undefined {
    const memberItr = getClassMemberIterator(classType, memberName, flags);

    return memberItr.next()?.value;
}

// Iterates members in a class matching memberName using the multiple-inheritance rules.
// For more details, see this note on method resolution
// order: https://www.python.org/download/releases/2.3/mro/.
// As it traverses the inheritance tree, it applies partial specialization
// to the the base class and member. For example, if ClassA inherits from
// ClassB[str] which inherits from Dict[_T1, int], a search for '__iter__'
// would return a class type of Dict[str, int] and a symbolType of
// (self) -> Iterator[str].
export function* getClassMemberIterator(classType: Type, memberName: string, flags = ClassMemberLookupFlags.Default) {
    const declaredTypesOnly = (flags & ClassMemberLookupFlags.DeclaredTypesOnly) !== 0;

    if (isClass(classType)) {
        let classFlags = ClassIteratorFlags.Default;
        if (flags & ClassMemberLookupFlags.SkipOriginalClass) {
            classFlags = classFlags | ClassIteratorFlags.SkipOriginalClass;
        }
        if (flags & ClassMemberLookupFlags.SkipBaseClasses) {
            classFlags = classFlags | ClassIteratorFlags.SkipBaseClasses;
        }
        if (flags & ClassMemberLookupFlags.SkipObjectBaseClass) {
            classFlags = classFlags | ClassIteratorFlags.SkipObjectBaseClass;
        }

        const classItr = getClassIterator(classType, classFlags);

        for (const [mroClass, specializedMroClass] of classItr) {
            if (!isClass(mroClass)) {
                if (!declaredTypesOnly) {
                    // The class derives from an unknown type, so all bets are off
                    // when trying to find a member. Return an unknown symbol.
                    const cm: ClassMember = {
                        symbol: Symbol.createWithType(SymbolFlags.None, UnknownType.create()),
                        isInstanceMember: false,
                        classType: UnknownType.create(),
                        isTypeDeclared: false,
                    };
                    yield cm;
                }
                continue;
            }

            if (!isClass(specializedMroClass)) {
                continue;
            }

            const memberFields = specializedMroClass.details.fields;

            // Look at instance members first if requested.
            if ((flags & ClassMemberLookupFlags.SkipInstanceVariables) === 0) {
                const symbol = memberFields.get(memberName);
                if (symbol && symbol.isInstanceMember()) {
                    const hasDeclaredType = symbol.hasTypedDeclarations();
                    if (!declaredTypesOnly || hasDeclaredType) {
                        const cm: ClassMember = {
                            symbol,
                            isInstanceMember: true,
                            classType: specializedMroClass,
                            isTypeDeclared: hasDeclaredType,
                        };
                        yield cm;
                    }
                }
            }

            // Next look at class members.
            const symbol = memberFields.get(memberName);
            if (symbol && symbol.isClassMember()) {
                const hasDeclaredType = symbol.hasTypedDeclarations();
                if (!declaredTypesOnly || hasDeclaredType) {
                    let isInstanceMember = false;

                    // For data classes and typed dicts, variables that are declared
                    // within the class are treated as instance variables. This distinction
                    // is important in cases where a variable is a callable type because
                    // we don't want to bind it to the instance like we would for a
                    // class member.
                    if (ClassType.isDataClass(specializedMroClass) || ClassType.isTypedDictClass(specializedMroClass)) {
                        const decls = symbol.getDeclarations();
                        if (decls.length > 0 && decls[0].type === DeclarationType.Variable) {
                            isInstanceMember = true;
                        }
                    }

                    const cm: ClassMember = {
                        symbol,
                        isInstanceMember,
                        classType: specializedMroClass,
                        isTypeDeclared: hasDeclaredType,
                    };
                    yield cm;
                }
            }
        }
    } else if (isAnyOrUnknown(classType)) {
        // The class derives from an unknown type, so all bets are off
        // when trying to find a member. Return an unknown symbol.
        const cm: ClassMember = {
            symbol: Symbol.createWithType(SymbolFlags.None, UnknownType.create()),
            isInstanceMember: false,
            classType: UnknownType.create(),
            isTypeDeclared: false,
        };
        yield cm;
    }

    return undefined;
}

export function* getClassIterator(classType: Type, flags = ClassIteratorFlags.Default) {
    if (isClass(classType)) {
        let skipMroEntry = (flags & ClassIteratorFlags.SkipOriginalClass) !== 0;

        for (const mroClass of classType.details.mro) {
            if (skipMroEntry) {
                skipMroEntry = false;
                continue;
            }

            // If mroClass is an ancestor of classType, partially specialize
            // it in the context of classType.
            const specializedMroClass = partiallySpecializeType(mroClass, classType);

            // Should we ignore members on the 'object' base class?
            if (flags & ClassIteratorFlags.SkipObjectBaseClass) {
                if (isClass(specializedMroClass)) {
                    if (ClassType.isBuiltIn(specializedMroClass, 'object')) {
                        continue;
                    }
                }
            }

            yield [mroClass, specializedMroClass];

            if ((flags & ClassIteratorFlags.SkipBaseClasses) !== 0) {
                break;
            }
        }
    }

    return undefined;
}

// Combines two lists of type var types, maintaining the combined order
// but removing any duplicates.
export function addTypeVarsToListIfUnique(list1: TypeVarType[], list2: TypeVarType[]) {
    for (const type2 of list2) {
        if (!list1.find((type1) => isTypeSame(type1, type2))) {
            list1.push(type2);
        }
    }
}

// Walks the type recursively (in a depth-first manner), finds all
// type variables that are referenced, and returns an ordered list
// of unique type variables. For example, if the type is
// Union[List[Dict[_T1, _T2]], _T1, _T3], the result would be
// [_T1, _T2, _T3].
export function getTypeVarArgumentsRecursive(type: Type, recursionCount = 0): TypeVarType[] {
    if (recursionCount > maxTypeRecursionCount) {
        return [];
    }

    const getTypeVarsFromClass = (classType: ClassType) => {
        const combinedList: TypeVarType[] = [];
        if (classType.typeArguments) {
            classType.typeArguments.forEach((typeArg) => {
                addTypeVarsToListIfUnique(combinedList, getTypeVarArgumentsRecursive(typeArg, recursionCount + 1));
            });
        }

        return combinedList;
    };

    if (type.typeAliasInfo?.typeArguments) {
        const combinedList: TypeVarType[] = [];

        type.typeAliasInfo?.typeArguments.forEach((typeArg) => {
            addTypeVarsToListIfUnique(combinedList, getTypeVarArgumentsRecursive(typeArg, recursionCount + 1));
        });

        return combinedList;
    } else if (isTypeVar(type)) {
        // Don't return any recursive type alias placeholders.
        if (type.details.recursiveTypeAliasName) {
            return [];
        }
        return [type];
    } else if (isClass(type)) {
        return getTypeVarsFromClass(type);
    } else if (isObject(type)) {
        return getTypeVarsFromClass(type.classType);
    } else if (isUnion(type)) {
        const combinedList: TypeVarType[] = [];
        doForEachSubtype(type, (subtype) => {
            addTypeVarsToListIfUnique(combinedList, getTypeVarArgumentsRecursive(subtype, recursionCount + 1));
        });
        return combinedList;
    } else if (isFunction(type)) {
        const combinedList: TypeVarType[] = [];

        for (let i = 0; i < type.details.parameters.length; i++) {
            addTypeVarsToListIfUnique(
                combinedList,
                getTypeVarArgumentsRecursive(FunctionType.getEffectiveParameterType(type, i), recursionCount + 1)
            );
        }

        if (type.details.paramSpec) {
            addTypeVarsToListIfUnique(combinedList, [type.details.paramSpec]);
        }

        const returnType = FunctionType.getSpecializedReturnType(type);
        if (returnType) {
            addTypeVarsToListIfUnique(combinedList, getTypeVarArgumentsRecursive(returnType, recursionCount + 1));
        }

        return combinedList;
    }

    return [];
}

// If the class is generic, the type is cloned, and its own
// type parameters are used as type arguments. This is useful
// for typing "self" or "cls" within a class's implementation.
export function selfSpecializeClassType(type: ClassType, setSkipAbstractClassTest = false): ClassType {
    if (!ClassType.isGeneric(type) && !setSkipAbstractClassTest) {
        return type;
    }

    const typeArgs = ClassType.getTypeParameters(type);
    return ClassType.cloneForSpecialization(
        type,
        typeArgs,
        /* isTypeArgumentExplicit */ false,
        setSkipAbstractClassTest
    );
}

// Creates a specialized version of the class, filling in any unspecified
// type arguments with Unknown.
export function specializeClassType(type: ClassType): ClassType {
    const typeVarMap = new TypeVarMap(getTypeVarScopeId(type));
    const typeParams = ClassType.getTypeParameters(type);
    typeParams.forEach((typeParam) => {
        typeVarMap.setTypeVarType(typeParam, UnknownType.create());
    });

    return applySolvedTypeVars(type, typeVarMap) as ClassType;
}

// Recursively finds all of the type arguments and sets them
// to the specified srcType.
export function setTypeArgumentsRecursive(destType: Type, srcType: Type, typeVarMap: TypeVarMap, recursionCount = 0) {
    if (recursionCount > maxTypeRecursionCount) {
        return;
    }

    if (typeVarMap.isLocked()) {
        return;
    }

    switch (destType.category) {
        case TypeCategory.Union:
            doForEachSubtype(destType, (subtype) => {
                setTypeArgumentsRecursive(subtype, srcType, typeVarMap, recursionCount + 1);
            });
            break;

        case TypeCategory.Class:
            if (destType.typeArguments) {
                destType.typeArguments.forEach((typeArg) => {
                    setTypeArgumentsRecursive(typeArg, srcType, typeVarMap, recursionCount + 1);
                });
            }
            if (destType.tupleTypeArguments) {
                destType.tupleTypeArguments.forEach((typeArg) => {
                    setTypeArgumentsRecursive(typeArg, srcType, typeVarMap, recursionCount + 1);
                });
            }
            break;

        case TypeCategory.Object:
            setTypeArgumentsRecursive(destType.classType, srcType, typeVarMap, recursionCount + 1);
            break;

        case TypeCategory.Function:
            if (destType.specializedTypes) {
                destType.specializedTypes.parameterTypes.forEach((paramType) => {
                    setTypeArgumentsRecursive(paramType, srcType, typeVarMap, recursionCount + 1);
                });
                if (destType.specializedTypes.returnType) {
                    setTypeArgumentsRecursive(
                        destType.specializedTypes.returnType,
                        srcType,
                        typeVarMap,
                        recursionCount + 1
                    );
                }
            } else {
                destType.details.parameters.forEach((param) => {
                    setTypeArgumentsRecursive(param.type, srcType, typeVarMap, recursionCount + 1);
                });
                if (destType.details.declaredReturnType) {
                    setTypeArgumentsRecursive(
                        destType.details.declaredReturnType,
                        srcType,
                        typeVarMap,
                        recursionCount + 1
                    );
                }
            }
            break;

        case TypeCategory.OverloadedFunction:
            destType.overloads.forEach((subtype) => {
                setTypeArgumentsRecursive(subtype, srcType, typeVarMap, recursionCount + 1);
            });
            break;

        case TypeCategory.TypeVar:
            if (!typeVarMap.hasTypeVar(destType)) {
                typeVarMap.setTypeVarType(destType, srcType);
            }
            break;
    }
}

// Builds a mapping between type parameters and their specialized
// types. For example, if the generic type is Dict[_T1, _T2] and the
// specialized type is Dict[str, int], it returns a map that associates
// _T1 with str and _T2 with int.
export function buildTypeVarMapFromSpecializedClass(classType: ClassType, makeConcrete = true): TypeVarMap {
    const typeParameters = ClassType.getTypeParameters(classType);
    let typeArguments = classType.typeArguments;

    // If there are no type arguments, we can either use the type variables
    // from the type parameters (keeping the type arguments generic) or
    // fill in concrete types.
    if (!typeArguments && !makeConcrete) {
        typeArguments = typeParameters;
    }

    const typeVarMap = buildTypeVarMap(typeParameters, typeArguments, getTypeVarScopeId(classType));
    if (ClassType.isTupleClass(classType) && classType.tupleTypeArguments && typeParameters.length >= 1) {
        typeVarMap.setVariadicTypeVar(typeParameters[0], classType.tupleTypeArguments);
    }

    return typeVarMap;
}

export function buildTypeVarMap(
    typeParameters: TypeVarType[],
    typeArgs: Type[] | undefined,
    typeVarScopeId: TypeVarScopeId | undefined
): TypeVarMap {
    const typeVarMap = new TypeVarMap(typeVarScopeId);
    typeParameters.forEach((typeParam, index) => {
        let typeArgType: Type;

        if (typeArgs) {
            if (isParamSpec(typeParam)) {
                if (index < typeArgs.length) {
                    typeArgType = typeArgs[index];
                    if (isFunction(typeArgType) && FunctionType.isParamSpecValue(typeArgType)) {
                        const paramSpecEntries: ParamSpecEntry[] = [];
                        typeArgType.details.parameters.forEach((param) => {
                            paramSpecEntries.push({
                                category: param.category,
                                name: param.name,
                                hasDefault: !!param.hasDefault,
                                type: param.type,
                            });
                        });
                        typeVarMap.setParamSpec(typeParam, { parameters: paramSpecEntries });
                    } else if (isParamSpec(typeArgType)) {
                        typeVarMap.setParamSpec(typeParam, { paramSpec: typeArgType });
                    }
                }
            } else {
                if (index >= typeArgs.length) {
                    typeArgType = AnyType.create();
                } else {
                    typeArgType = typeArgs[index];
                }

                typeVarMap.setTypeVarType(typeParam, typeArgType, /* wideBound */ undefined, /* retainLiteral */ true);
            }
        }
    });

    return typeVarMap;
}

// Determines the specialized base class type that srcType derives from.
export function specializeForBaseClass(srcType: ClassType, baseClass: ClassType): ClassType {
    const typeParams = ClassType.getTypeParameters(baseClass);

    // If there are no type parameters for the specified base class,
    // no specialization is required.
    if (typeParams.length === 0) {
        return baseClass;
    }

    const typeVarMap = buildTypeVarMapFromSpecializedClass(srcType);
    const specializedType = applySolvedTypeVars(baseClass, typeVarMap);
    assert(isClass(specializedType));
    return specializedType as ClassType;
}

// If ignoreUnknown is true, an unknown base class is ignored when
// checking for derivation. If ignoreUnknown is false, a return value
// of true is assumed.
export function derivesFromClassRecursive(classType: ClassType, baseClassToFind: ClassType, ignoreUnknown: boolean) {
    if (ClassType.isSameGenericClass(classType, baseClassToFind)) {
        return true;
    }

    for (const baseClass of classType.details.baseClasses) {
        if (isClass(baseClass)) {
            if (derivesFromClassRecursive(baseClass, baseClassToFind, ignoreUnknown)) {
                return true;
            }
        } else if (!ignoreUnknown && isAnyOrUnknown(baseClass)) {
            // If the base class is unknown, we have to make a conservative assumption.
            return true;
        }
    }

    return false;
}

// Filters a type such that that no part of it is definitely
// falsy. For example, if a type is a union of None
// and an "int", this method would strip off the "None"
// and return only the "int".
export function removeFalsinessFromType(type: Type): Type {
    return mapSubtypes(type, (subtype) => {
        if (isObject(subtype)) {
            if (subtype.classType.literalValue !== undefined) {
                // If the object is already definitely truthy, it's fine to
                // include, otherwise it should be removed.
                return subtype.classType.literalValue ? subtype : undefined;
            }

            // If the object is a bool, make it "true", since
            // "false" is a falsy value.
            if (ClassType.isBuiltIn(subtype.classType, 'bool')) {
                return ObjectType.create(ClassType.cloneWithLiteral(subtype.classType, true));
            }
        }

        // If it's possible for the type to be truthy, include it.
        if (canBeTruthy(subtype)) {
            return subtype;
        }

        return undefined;
    });
}

// Filters a type such that that no part of it is definitely
// truthy. For example, if a type is a union of None
// and a custom class "Foo" that has no __len__ or __nonzero__
// method, this method would strip off the "Foo"
// and return only the "None".
export function removeTruthinessFromType(type: Type): Type {
    return mapSubtypes(type, (subtype) => {
        if (isObject(subtype)) {
            if (subtype.classType.literalValue !== undefined) {
                // If the object is already definitely falsy, it's fine to
                // include, otherwise it should be removed.
                return !subtype.classType.literalValue ? subtype : undefined;
            }

            // If the object is a bool, make it "false", since
            // "true" is a truthy value.
            if (ClassType.isBuiltIn(subtype.classType, 'bool')) {
                return ObjectType.create(ClassType.cloneWithLiteral(subtype.classType, false));
            }
        }

        // If it's possible for the type to be falsy, include it.
        if (canBeFalsy(subtype)) {
            return subtype;
        }

        return undefined;
    });
}

// Returns the declared yield type if provided, or undefined otherwise.
export function getDeclaredGeneratorYieldType(functionType: FunctionType): Type | undefined {
    const returnType = FunctionType.getSpecializedReturnType(functionType);
    if (returnType) {
        const generatorTypeArgs = getGeneratorTypeArgs(returnType);

        if (generatorTypeArgs && generatorTypeArgs.length >= 1) {
            return generatorTypeArgs[0];
        }
    }

    return undefined;
}

// Returns the declared "send" type (the type returned from the yield
// statement) if it was declared, or undefined otherwise.
export function getDeclaredGeneratorSendType(functionType: FunctionType): Type | undefined {
    const returnType = FunctionType.getSpecializedReturnType(functionType);
    if (returnType) {
        const generatorTypeArgs = getGeneratorTypeArgs(returnType);

        if (generatorTypeArgs && generatorTypeArgs.length >= 2) {
            // The send type is the second type arg.
            return generatorTypeArgs[1];
        }

        return UnknownType.create();
    }

    return undefined;
}

// Returns the declared "return" type (the type returned from a return statement)
// if it was declared, or undefined otherwise.
export function getDeclaredGeneratorReturnType(functionType: FunctionType): Type | undefined {
    const returnType = FunctionType.getSpecializedReturnType(functionType);
    if (returnType) {
        const generatorTypeArgs = getGeneratorTypeArgs(returnType);

        if (generatorTypeArgs && generatorTypeArgs.length >= 3) {
            // The send type is the third type arg.
            return generatorTypeArgs[2];
        }

        return UnknownType.create();
    }

    return undefined;
}

export function convertToInstance(type: Type): Type {
    let result = mapSubtypes(type, (subtype) => {
        subtype = transformTypeObjectToClass(subtype);

        switch (subtype.category) {
            case TypeCategory.Class: {
                return ObjectType.create(subtype);
            }

            case TypeCategory.None: {
                return NoneType.createInstance();
            }

            case TypeCategory.Function: {
                if (TypeBase.isInstantiable(subtype)) {
                    return FunctionType.cloneAsInstance(subtype);
                }
                break;
            }

            case TypeCategory.TypeVar: {
                if (TypeBase.isInstantiable(subtype)) {
                    return TypeVarType.cloneAsInstance(subtype);
                }
                break;
            }
        }

        return subtype;
    });

    // Copy over any type alias information.
    if (type.typeAliasInfo && type !== result) {
        result = TypeBase.cloneForTypeAlias(
            result,
            type.typeAliasInfo.name,
            type.typeAliasInfo.fullName,
            type.typeAliasInfo.typeVarScopeId,
            type.typeAliasInfo.typeParameters,
            type.typeAliasInfo.typeArguments
        );
    }

    return result;
}

export function convertToInstantiable(type: Type): Type {
    let result = mapSubtypes(type, (subtype) => {
        switch (subtype.category) {
            case TypeCategory.Object: {
                return subtype.classType;
            }

            case TypeCategory.None: {
                return NoneType.createType();
            }

            case TypeCategory.Function: {
                if (TypeBase.isInstance(subtype)) {
                    return FunctionType.cloneAsInstantiable(subtype);
                }
                break;
            }

            case TypeCategory.TypeVar: {
                if (TypeBase.isInstance(subtype)) {
                    return TypeVarType.cloneAsInstantiable(subtype);
                }
                break;
            }
        }

        return subtype;
    });

    // Copy over any type alias information.
    if (type.typeAliasInfo && type !== result) {
        result = TypeBase.cloneForTypeAlias(
            result,
            type.typeAliasInfo.name,
            type.typeAliasInfo.fullName,
            type.typeAliasInfo.typeVarScopeId,
            type.typeAliasInfo.typeParameters,
            type.typeAliasInfo.typeArguments
        );
    }

    return result;
}

export function getMembersForClass(classType: ClassType, symbolTable: SymbolTable, includeInstanceVars: boolean) {
    for (let i = 0; i < classType.details.mro.length; i++) {
        const mroClass = classType.details.mro[i];

        if (isClass(mroClass)) {
            // Add any new member variables from this class.
            const isClassTypedDict = ClassType.isTypedDictClass(mroClass);
            mroClass.details.fields.forEach((symbol, name) => {
                if (symbol.isClassMember() || (includeInstanceVars && symbol.isInstanceMember())) {
                    if (!symbol.isExclusiveClassMember() || !includeInstanceVars) {
                        if (!isClassTypedDict || !isTypedDictMemberAccessedThroughIndex(symbol)) {
                            if (!symbolTable.get(name)) {
                                symbolTable.set(name, symbol);
                            }
                        }
                    }
                }
            });
        }
    }

    // Add members of the metaclass as well.
    if (!includeInstanceVars) {
        const metaclass = classType.details.effectiveMetaclass;
        if (metaclass && isClass(metaclass)) {
            for (const mroClass of metaclass.details.mro) {
                if (isClass(mroClass)) {
                    mroClass.details.fields.forEach((symbol, name) => {
                        if (!symbolTable.get(name)) {
                            symbolTable.set(name, symbol);
                        }
                    });
                } else {
                    break;
                }
            }
        }
    }
}

export function getMembersForModule(moduleType: ModuleType, symbolTable: SymbolTable) {
    // Start with the loader fields. If there are any symbols of the
    // same name defined within the module, they will overwrite the
    // loader fields.
    if (moduleType.loaderFields) {
        moduleType.loaderFields.forEach((symbol, name) => {
            symbolTable.set(name, symbol);
        });
    }

    moduleType.fields.forEach((symbol, name) => {
        symbolTable.set(name, symbol);
    });
}

// Determines if the type is an Unknown or a union that contains an Unknown.
// It does not look at type arguments.
export function containsUnknown(type: Type) {
    let foundUnknown = false;

    doForEachSubtype(type, (subtype) => {
        if (isUnknown(subtype)) {
            foundUnknown = true;
        }
    });

    return foundUnknown;
}

// Determines if any part of the type contains "Unknown", including any type arguments.
export function isPartlyUnknown(type: Type, allowUnknownTypeArgsForClasses = false, recursionCount = 0): boolean {
    if (recursionCount > maxTypeRecursionCount) {
        return false;
    }

    if (isUnknown(type)) {
        return true;
    }

    // See if a union contains an unknown type.
    if (isUnion(type)) {
        return (
            findSubtype(type, (subtype) =>
                isPartlyUnknown(subtype, allowUnknownTypeArgsForClasses, recursionCount + 1)
            ) !== undefined
        );
    }

    // See if an object or class has an unknown type argument.
    if (isObject(type)) {
        return isPartlyUnknown(type.classType, false, recursionCount + 1);
    }

    if (isClass(type)) {
        if (!allowUnknownTypeArgsForClasses && !ClassType.isPseudoGenericClass(type)) {
            const typeArgs = type.tupleTypeArguments || type.typeArguments;
            if (typeArgs) {
                for (const argType of typeArgs) {
                    if (isPartlyUnknown(argType, allowUnknownTypeArgsForClasses, recursionCount + 1)) {
                        return true;
                    }
                }
            }
        }

        return false;
    }

    // See if a function has an unknown type.
    if (isOverloadedFunction(type)) {
        return type.overloads.some((overload) => {
            return isPartlyUnknown(overload, false, recursionCount + 1);
        });
    }

    if (isFunction(type)) {
        for (let i = 0; i < type.details.parameters.length; i++) {
            // Ignore parameters such as "*" that have no name.
            if (type.details.parameters[i].name) {
                const paramType = FunctionType.getEffectiveParameterType(type, i);
                if (isPartlyUnknown(paramType, false, recursionCount + 1)) {
                    return true;
                }
            }
        }

        if (
            type.details.declaredReturnType &&
            isPartlyUnknown(type.details.declaredReturnType, false, recursionCount + 1)
        ) {
            return true;
        }

        return false;
    }

    return false;
}

// If the type is a union of same-sized tuples, these are combined into
// a single tuple with that size. Otherwise, returns undefined.
export function combineSameSizedTuples(type: Type, tupleType: Type | undefined) {
    if (!tupleType || !isClass(tupleType)) {
        return undefined;
    }

    let tupleEntries: Type[][] | undefined;
    let isValid = true;

    doForEachSubtype(type, (subtype) => {
        if (
            isObject(subtype) &&
            isTupleClass(subtype.classType) &&
            !isOpenEndedTupleClass(subtype.classType) &&
            subtype.classType.tupleTypeArguments
        ) {
            if (tupleEntries) {
                if (tupleEntries.length === subtype.classType.tupleTypeArguments.length) {
                    subtype.classType.tupleTypeArguments.forEach((entry, index) => {
                        tupleEntries![index].push(entry);
                    });
                } else {
                    isValid = false;
                }
            } else {
                tupleEntries = subtype.classType.tupleTypeArguments.map((entry) => [entry]);
            }
        } else {
            isValid = false;
        }
    });

    if (!isValid || !tupleEntries) {
        return undefined;
    }

    return convertToInstance(
        specializeTupleClass(
            tupleType,
            tupleEntries.map((entry) => combineTypes(entry))
        )
    );
}

// Tuples require special handling for specialization. This method computes
// the "effective" type argument, which is a union of the variadic type
// arguments. If stripLiterals is true, literal values are stripped when
// computing the effective type args.
export function specializeTupleClass(
    classType: ClassType,
    typeArgs: Type[],
    isTypeArgumentExplicit = true,
    stripLiterals = true,
    isForUnpackedVariadicTypeVar = false
): ClassType {
    let combinedTupleType: Type = AnyType.create(/* isEllipsis */ false);
    if (typeArgs.length === 2 && isEllipsisType(typeArgs[1])) {
        combinedTupleType = typeArgs[0];
    } else {
        combinedTupleType = combineTypes(typeArgs);
    }

    if (stripLiterals) {
        combinedTupleType = stripLiteralValue(combinedTupleType);
    }

    // An empty tuple has an effective type of Any.
    if (isNever(combinedTupleType)) {
        combinedTupleType = AnyType.create();
    }

    const clonedClassType = ClassType.cloneForSpecialization(
        classType,
        [combinedTupleType],
        isTypeArgumentExplicit,
        /* skipAbstractClassTest */ undefined,
        typeArgs
    );

    if (isForUnpackedVariadicTypeVar) {
        clonedClassType.isTupleForUnpackedVariadicTypeVar = true;
    }

    return clonedClassType;
}

// Recursively walks a type and calls a callback for each TypeVar, allowing
// it to be replaced with something else.
export function _transformTypeVars(
    type: Type,
    callbacks: TypeVarTransformer,
    recursionMap = new Map<string, TypeVarType>(),
    recursionLevel = 0
): Type {
    if (recursionLevel > maxTypeRecursionCount) {
        return type;
    }

    // Shortcut the operation if possible.
    if (!requiresSpecialization(type)) {
        return type;
    }

    if (isAnyOrUnknown(type)) {
        return type;
    }

    if (isNone(type)) {
        return type;
    }

    if (isTypeVar(type)) {
        // Handle recursive type aliases specially. In particular,
        // we need to specialize type arguments for generic recursive
        // type aliases.
        if (type.details.recursiveTypeAliasName) {
            if (!type.typeAliasInfo?.typeArguments) {
                return type;
            }

            let requiresUpdate = false;
            const typeArgs = type.typeAliasInfo.typeArguments.map((typeArg) => {
                const replacementType = _transformTypeVars(typeArg, callbacks, recursionMap, recursionLevel + 1);
                if (replacementType !== typeArg) {
                    requiresUpdate = true;
                }
                return replacementType;
            });

            if (requiresUpdate) {
                return TypeBase.cloneForTypeAlias(
                    type,
                    type.typeAliasInfo.name,
                    type.typeAliasInfo.fullName,
                    type.typeAliasInfo.typeVarScopeId,
                    type.typeAliasInfo.typeParameters,
                    typeArgs
                );
            }

            return type;
        }

        let replacementType: Type = type;

        // Recursively transform the results, but ensure that we don't replace the
        // same type variable recursively by setting it in the recursionMap.
        const typeVarName = TypeVarType.getNameWithScope(type);
        if (!recursionMap.has(typeVarName)) {
            replacementType = callbacks.transformTypeVar(type);

            // If we're replacing a TypeVar with another type and the
            // original is not an instance, convert the replacement so it's also
            // not an instance. This happens in the case where a type alias refers
            // to a union that includes a TypeVar.
            if (TypeBase.isInstantiable(type) && !TypeBase.isInstantiable(replacementType)) {
                replacementType = convertToInstantiable(replacementType);
            }

            recursionMap.set(typeVarName, type);
            replacementType = _transformTypeVars(replacementType, callbacks, recursionMap, recursionLevel + 1);

            // If we're transforming a variadic type variable that was in a union,
            // expand the union types.
            if (isVariadicTypeVar(type) && type.isVariadicInUnion) {
                replacementType = _expandVariadicUnpackedUnion(replacementType);
            }

            recursionMap.delete(typeVarName);
        }

        return replacementType;
    }

    if (isUnion(type)) {
        return mapSubtypes(type, (subtype) => {
            let transformedType = _transformTypeVars(subtype, callbacks, recursionMap, recursionLevel + 1);

            // If we're transforming a variadic type variable within a union,
            // combine the individual types within the variadic type variable.
            if (isVariadicTypeVar(subtype) && !isVariadicTypeVar(transformedType)) {
                const subtypesToCombine: Type[] = [];
                doForEachSubtype(transformedType, (transformedSubtype) => {
                    subtypesToCombine.push(_expandVariadicUnpackedUnion(transformedSubtype));
                });

                transformedType = combineTypes(subtypesToCombine);
            }

            return transformedType;
        });
    }

    if (isObject(type)) {
        const classType = _transformTypeVarsInClassType(type.classType, callbacks, recursionMap, recursionLevel + 1);

        // Handle the "Type" special class.
        if (ClassType.isBuiltIn(classType, 'Type')) {
            const typeArgs = classType.typeArguments;
            if (typeArgs && typeArgs.length >= 1) {
                if (isObject(typeArgs[0])) {
                    return _transformTypeVars(typeArgs[0].classType, callbacks, recursionMap, recursionLevel + 1);
                } else if (isTypeVar(typeArgs[0])) {
                    const replacementType = callbacks.transformTypeVar(typeArgs[0]);
                    if (replacementType && isObject(replacementType)) {
                        return replacementType.classType;
                    }
                }
            }
        }

        // Don't allocate a new ObjectType class if the class
        // didn't need to be specialized.
        if (classType === type.classType) {
            return type;
        }
        return ObjectType.create(classType);
    }

    if (isClass(type)) {
        return _transformTypeVarsInClassType(type, callbacks, recursionMap, recursionLevel + 1);
    }

    if (isFunction(type)) {
        return _transformTypeVarsInFunctionType(type, callbacks, recursionMap, recursionLevel + 1);
    }

    if (isOverloadedFunction(type)) {
        let requiresUpdate = false;

        // Specialize each of the functions in the overload.
        const newOverloads: FunctionType[] = [];
        type.overloads.forEach((entry) => {
            const replacementType = _transformTypeVarsInFunctionType(entry, callbacks, recursionMap, recursionLevel);
            newOverloads.push(replacementType);
            if (replacementType !== entry) {
                requiresUpdate = true;
            }
        });

        // Construct a new overload with the specialized function types.
        return requiresUpdate ? OverloadedFunctionType.create(newOverloads) : type;
    }

    return type;
}

function _transformTypeVarsInClassType(
    classType: ClassType,
    callbacks: TypeVarTransformer,
    recursionMap: Map<string, TypeVarType>,
    recursionLevel: number
): ClassType {
    // Handle the common case where the class has no type parameters.
    if (ClassType.getTypeParameters(classType).length === 0 && !ClassType.isSpecialBuiltIn(classType)) {
        return classType;
    }

    let newTypeArgs: Type[] = [];
    let newVariadicTypeArgs: Type[] | undefined;
    let specializationNeeded = false;
    const typeParams = ClassType.getTypeParameters(classType);

    const transformParamSpec = (paramSpec: TypeVarType) => {
        const paramSpecEntries = callbacks.transformParamSpec(paramSpec);
        if (paramSpecEntries) {
            if (paramSpecEntries.parameters) {
                // Create a function type from the param spec entries.
                const functionType = FunctionType.createInstance('', '', '', FunctionTypeFlags.ParamSpecValue);

                paramSpecEntries.parameters.forEach((entry) => {
                    FunctionType.addParameter(functionType, {
                        category: entry.category,
                        name: entry.name,
                        hasDefault: entry.hasDefault,
                        hasDeclaredType: true,
                        type: entry.type,
                    });
                });

                return functionType;
            }

            if (paramSpecEntries.paramSpec) {
                return paramSpecEntries.paramSpec;
            }
        }

        return paramSpec;
    };

    // If type args were previously provided, specialize them.
    if (classType.typeArguments) {
        newTypeArgs = classType.typeArguments.map((oldTypeArgType) => {
            if (isTypeVar(oldTypeArgType) && oldTypeArgType.details.isParamSpec) {
                return transformParamSpec(oldTypeArgType);
            }

            let newTypeArgType = _transformTypeVars(oldTypeArgType, callbacks, recursionMap, recursionLevel + 1);
            if (newTypeArgType !== oldTypeArgType) {
                specializationNeeded = true;

                // If this was a variadic type variable that was part of a union
                // (e.g. Union[Unpack[Vs]]), expand the subtypes into a union here.
                if (
                    isTypeVar(oldTypeArgType) &&
                    isVariadicTypeVar(oldTypeArgType) &&
                    oldTypeArgType.isVariadicInUnion
                ) {
                    newTypeArgType = _expandVariadicUnpackedUnion(newTypeArgType);
                }
            }
            return newTypeArgType;
        });
    } else {
        typeParams.forEach((typeParam) => {
            let replacementType: Type = typeParam;

            if (typeParam.details.isParamSpec) {
                replacementType = transformParamSpec(typeParam);
                if (replacementType !== typeParam) {
                    specializationNeeded = true;
                }
            } else {
                const typeParamName = TypeVarType.getNameWithScope(typeParam);
                if (!recursionMap.has(typeParamName)) {
                    replacementType = callbacks.transformTypeVar(typeParam);
                    if (replacementType !== typeParam) {
                        recursionMap.set(typeParamName, typeParam);
                        replacementType = _transformTypeVars(
                            replacementType,
                            callbacks,
                            recursionMap,
                            recursionLevel + 1
                        );
                        recursionMap.delete(typeParamName);
                        specializationNeeded = true;
                    }
                }
            }

            newTypeArgs.push(replacementType);
        });
    }

    if (ClassType.isTupleClass(classType)) {
        if (classType.tupleTypeArguments) {
            newVariadicTypeArgs = [];
            classType.tupleTypeArguments.forEach((oldTypeArgType) => {
                const newTypeArgType = _transformTypeVars(oldTypeArgType, callbacks, recursionMap, recursionLevel + 1);
                if (newTypeArgType !== oldTypeArgType) {
                    specializationNeeded = true;
                }

                if (
                    isVariadicTypeVar(oldTypeArgType) &&
                    isObject(newTypeArgType) &&
                    isTupleClass(newTypeArgType.classType) &&
                    newTypeArgType.classType.tupleTypeArguments
                ) {
                    newVariadicTypeArgs!.push(...newTypeArgType.classType.tupleTypeArguments);
                } else {
                    newVariadicTypeArgs!.push(newTypeArgType);
                }
            });
        } else if (typeParams.length > 0) {
            newVariadicTypeArgs = callbacks.transformVariadicTypeVar(typeParams[0]);
            if (newVariadicTypeArgs) {
                specializationNeeded = true;
            }
        }
    }

    // If specialization wasn't needed, don't allocate a new class.
    if (!specializationNeeded) {
        return classType;
    }

    return ClassType.cloneForSpecialization(
        classType,
        newTypeArgs,
        /* isTypeArgumentExplicit */ true,
        /* skipAbstractClassTest */ undefined,
        newVariadicTypeArgs
    );
}

function _transformTypeVarsInFunctionType(
    sourceType: FunctionType,
    callbacks: TypeVarTransformer,
    recursionMap: Map<string, TypeVarType>,
    recursionLevel: number
): FunctionType {
    let functionType = sourceType;

    // Handle functions with a parameter specification in a special manner.
    if (functionType.details.paramSpec) {
        const paramSpec = callbacks.transformParamSpec(functionType.details.paramSpec);
        if (paramSpec) {
            functionType = FunctionType.cloneForParamSpec(functionType, paramSpec);
        }
    }

    const declaredReturnType =
        functionType.specializedTypes && functionType.specializedTypes.returnType
            ? functionType.specializedTypes.returnType
            : functionType.details.declaredReturnType;
    const specializedReturnType = declaredReturnType
        ? _transformTypeVars(declaredReturnType, callbacks, recursionMap, recursionLevel + 1)
        : undefined;
    let typesRequiredSpecialization = declaredReturnType !== specializedReturnType;

    const specializedParameters: SpecializedFunctionTypes = {
        parameterTypes: [],
        returnType: specializedReturnType,
    };

    // Does this function end with *args: P.args, **args: P.kwargs? If so, we'll
    // modify the function and replace these parameters with the signature captured
    // by the ParamSpec.
    if (functionType.details.parameters.length >= 2) {
        const argsParam = functionType.details.parameters[functionType.details.parameters.length - 2];
        const kwargsParam = functionType.details.parameters[functionType.details.parameters.length - 1];
        const argsParamType = FunctionType.getEffectiveParameterType(
            functionType,
            functionType.details.parameters.length - 2
        );
        const kwargsParamType = FunctionType.getEffectiveParameterType(
            functionType,
            functionType.details.parameters.length - 1
        );

        if (
            argsParam.category === ParameterCategory.VarArgList &&
            kwargsParam.category === ParameterCategory.VarArgDictionary &&
            isParamSpec(argsParamType) &&
            isParamSpec(kwargsParamType) &&
            isTypeSame(argsParamType, kwargsParamType)
        ) {
            const paramSpecType = callbacks.transformParamSpec(argsParamType);
            if (paramSpecType) {
                functionType = FunctionType.cloneForParamSpecApplication(functionType, paramSpecType);
            }
        }
    }

    let variadicParamIndex: number | undefined;
    let variadicTypesToUnpack: Type[] | undefined;

    for (let i = 0; i < functionType.details.parameters.length; i++) {
        const paramType = FunctionType.getEffectiveParameterType(functionType, i);
        const specializedType = _transformTypeVars(paramType, callbacks, recursionMap, recursionLevel + 1);
        specializedParameters.parameterTypes.push(specializedType);
        if (
            variadicParamIndex === undefined &&
            isVariadicTypeVar(paramType) &&
            functionType.details.parameters[i].category === ParameterCategory.Simple
        ) {
            variadicParamIndex = i;

            if (
                isObject(specializedType) &&
                isTupleClass(specializedType.classType) &&
                specializedType.classType.isTupleForUnpackedVariadicTypeVar
            ) {
                variadicTypesToUnpack = specializedType.classType.tupleTypeArguments;
            }
        }

        if (paramType !== specializedType) {
            typesRequiredSpecialization = true;
        }
    }

    if (!typesRequiredSpecialization) {
        return functionType;
    }

    let specializedInferredReturnType: Type | undefined;
    if (functionType.inferredReturnType) {
        specializedInferredReturnType = _transformTypeVars(
            functionType.inferredReturnType,
            callbacks,
            recursionMap,
            recursionLevel + 1
        );
    }

    // If there was no unpacked variadic type variable, we're done.
    if (!variadicTypesToUnpack) {
        return FunctionType.cloneForSpecialization(functionType, specializedParameters, specializedInferredReturnType);
    }

    // Unpack the tuple and synthesize a new function in the process.
    const newFunctionType = FunctionType.createInstance('', '', '', FunctionTypeFlags.SynthesizedMethod);
    specializedParameters.parameterTypes.forEach((paramType, index) => {
        if (index === variadicParamIndex) {
            // Unpack the tuple into individual parameters.
            variadicTypesToUnpack!.forEach((unpackedType) => {
                FunctionType.addParameter(newFunctionType, {
                    category: ParameterCategory.Simple,
                    name: `_p${newFunctionType.details.parameters.length}`,
                    isNameSynthesized: true,
                    type: unpackedType,
                    hasDeclaredType: true,
                });
            });
        } else {
            const param = { ...functionType.details.parameters[index] };
            param.type = paramType;
            if (param.name && param.isNameSynthesized) {
                param.name = `_p${newFunctionType.details.parameters.length}`;
            }

            FunctionType.addParameter(newFunctionType, param);
        }
    });

    newFunctionType.details.declaredReturnType = FunctionType.getSpecializedReturnType(functionType);

    return newFunctionType;
}

function _expandVariadicUnpackedUnion(type: Type) {
    if (
        isObject(type) &&
        isTupleClass(type.classType) &&
        type.classType.tupleTypeArguments &&
        type.classType.isTupleForUnpackedVariadicTypeVar
    ) {
        return combineTypes(type.classType.tupleTypeArguments);
    }

    return type;
}

// If the declared return type for the function is a Generator or AsyncGenerator,
// returns the type arguments for the type.
export function getGeneratorTypeArgs(returnType: Type): Type[] | undefined {
    if (isObject(returnType)) {
        const classType = returnType.classType;
        if (ClassType.isBuiltIn(classType)) {
            const className = classType.details.name;
            if (className === 'Generator' || className === 'AsyncGenerator') {
                return classType.typeArguments;
            }
        }
    }

    return undefined;
}

export function requiresTypeArguments(classType: ClassType) {
    if (classType.details.typeParameters.length > 0) {
        // If there are type parameters, type arguments are needed.
        // The exception is if type parameters have been synthesized
        // for classes that have untyped constructors.
        return !classType.details.typeParameters[0].details.isSynthesized;
    }

    // There are a few built-in special classes that require
    // type arguments even though typeParameters is empty.
    if (ClassType.isSpecialBuiltIn(classType)) {
        const specialClasses = [
            'Tuple',
            'Callable',
            'Generic',
            'Type',
            'Optional',
            'Union',
            'Final',
            'Literal',
            'Annotated',
            'TypeGuard',
        ];
        if (specialClasses.some((t) => t === (classType.aliasName || classType.details.name))) {
            return true;
        }
    }

    return false;
}

export function requiresSpecialization(type: Type, recursionCount = 0): boolean {
    switch (type.category) {
        case TypeCategory.Class: {
            if (type.typeArguments) {
                if (recursionCount > maxTypeRecursionCount) {
                    return false;
                }

                return (
                    type.typeArguments.find((typeArg) => requiresSpecialization(typeArg, recursionCount + 1)) !==
                    undefined
                );
            }

            // If there are any type parameters, we need to specialize
            // since there are no corresponding type arguments.
            return ClassType.getTypeParameters(type).length > 0;
        }

        case TypeCategory.Object: {
            if (recursionCount > maxTypeRecursionCount) {
                return false;
            }

            return requiresSpecialization(type.classType, recursionCount + 1);
        }

        case TypeCategory.Function: {
            if (recursionCount > maxTypeRecursionCount) {
                return false;
            }

            if (type.details.paramSpec) {
                return true;
            }

            for (let i = 0; i < type.details.parameters.length; i++) {
                if (requiresSpecialization(FunctionType.getEffectiveParameterType(type, i), recursionCount + 1)) {
                    return true;
                }
            }

            const declaredReturnType =
                type.specializedTypes && type.specializedTypes.returnType
                    ? type.specializedTypes.returnType
                    : type.details.declaredReturnType;
            if (declaredReturnType) {
                if (requiresSpecialization(declaredReturnType, recursionCount + 1)) {
                    return true;
                }
            } else if (type.inferredReturnType) {
                if (requiresSpecialization(type.inferredReturnType, recursionCount + 1)) {
                    return true;
                }
            }

            return false;
        }

        case TypeCategory.OverloadedFunction: {
            return (
                type.overloads.find((overload) => requiresSpecialization(overload, recursionCount + 1)) !== undefined
            );
        }

        case TypeCategory.Union: {
            return findSubtype(type, (subtype) => requiresSpecialization(subtype, recursionCount + 1)) !== undefined;
        }

        case TypeCategory.TypeVar: {
            // Most TypeVar types need to be specialized.
            if (!type.details.recursiveTypeAliasName) {
                return true;
            }

            // If this is a recursive type alias, it may need to be specialized
            // if it has generic type arguments.
            if (type.typeAliasInfo?.typeArguments) {
                return type.typeAliasInfo.typeArguments.some((typeArg) =>
                    requiresSpecialization(typeArg, recursionCount + 1)
                );
            }
        }
    }

    return false;
}

// Computes the method resolution ordering for a class whose base classes
// have already been filled in. The algorithm for computing MRO is described
// here: https://www.python.org/download/releases/2.3/mro/. It returns true
// if an MRO was possible, false otherwise.
export function computeMroLinearization(classType: ClassType): boolean {
    let isMroFound = true;

    // Construct the list of class lists that need to be merged.
    const classListsToMerge: Type[][] = [];

    // Remove any Generic class. It appears not to participate in MRO calculations.
    const baseClassesToInclude = classType.details.baseClasses.filter(
        (baseClass) => !isClass(baseClass) || !ClassType.isBuiltIn(baseClass, 'Generic')
    );

    baseClassesToInclude.forEach((baseClass) => {
        if (isClass(baseClass)) {
            const typeVarMap = buildTypeVarMapFromSpecializedClass(baseClass, /* makeConcrete */ false);
            classListsToMerge.push(
                baseClass.details.mro.map((mroClass) => {
                    return applySolvedTypeVars(mroClass, typeVarMap);
                })
            );
        } else {
            classListsToMerge.push([baseClass]);
        }
    });

    classListsToMerge.push(
        baseClassesToInclude.map((baseClass) => {
            const typeVarMap = buildTypeVarMapFromSpecializedClass(classType, /* makeConcrete */ false);
            return applySolvedTypeVars(baseClass, typeVarMap);
        })
    );

    // The first class in the MRO is the class itself.
    const typeVarMap = buildTypeVarMapFromSpecializedClass(classType, /* makeConcrete */ false);
    classType.details.mro.push(applySolvedTypeVars(classType, typeVarMap));

    // Helper function that returns true if the specified searchClass
    // is found in the "tail" (i.e. in elements 1 through n) of any
    // of the class lists.
    const isInTail = (searchClass: ClassType, classLists: Type[][]) => {
        return classLists.some((classList) => {
            return (
                classList.findIndex((value) => isClass(value) && ClassType.isSameGenericClass(value, searchClass)) > 0
            );
        });
    };

    const filterClass = (classToFilter: ClassType, classLists: Type[][]) => {
        for (let i = 0; i < classLists.length; i++) {
            classLists[i] = classLists[i].filter(
                (value) => !isClass(value) || !ClassType.isSameGenericClass(value, classToFilter)
            );
        }
    };

    while (true) {
        let foundValidHead = false;
        let nonEmptyList: Type[] | undefined = undefined;

        for (let i = 0; i < classListsToMerge.length; i++) {
            const classList = classListsToMerge[i];

            if (classList.length > 0) {
                if (nonEmptyList === undefined) {
                    nonEmptyList = classList;
                }

                if (!isClass(classList[0])) {
                    foundValidHead = true;
                    classType.details.mro.push(classList[0]);
                    classList.shift();
                    break;
                } else if (!isInTail(classList[0], classListsToMerge)) {
                    foundValidHead = true;
                    classType.details.mro.push(classList[0]);
                    filterClass(classList[0], classListsToMerge);
                    break;
                }
            }
        }

        // If all lists are empty, we are done.
        if (!nonEmptyList) {
            break;
        }

        // We made it all the way through the list of class lists without
        // finding a valid head, but there is at least one list that's not
        // yet empty. This means there's no valid MRO order.
        if (!foundValidHead) {
            isMroFound = false;

            // Handle the situation by pull the head off the first empty list.
            // This allows us to make forward progress.
            if (!isClass(nonEmptyList[0])) {
                classType.details.mro.push(nonEmptyList[0]);
                nonEmptyList.shift();
            } else {
                classType.details.mro.push(nonEmptyList[0]);
                filterClass(nonEmptyList[0], classListsToMerge);
            }
        }
    }

    return isMroFound;
}

// Returns zero or more unique module names that point to the place(s)
// where the type is declared. Unions, for example, can result in more
// than one result. Type arguments are not included.
export function getDeclaringModulesForType(type: Type): string[] {
    const moduleList: string[] = [];
    addDeclaringModuleNamesForType(type, moduleList);
    return moduleList;
}

function addDeclaringModuleNamesForType(type: Type, moduleList: string[], recursionCount = 0) {
    if (recursionCount > maxTypeRecursionCount) {
        return;
    }

    const addIfUnique = (moduleName: string) => {
        if (moduleName && !moduleList.some((n) => n === moduleName)) {
            moduleList.push(moduleName);
        }
    };

    switch (type.category) {
        case TypeCategory.Class: {
            addIfUnique(type.details.moduleName);
            break;
        }

        case TypeCategory.Object: {
            addIfUnique(type.classType.details.moduleName);
            break;
        }

        case TypeCategory.Function: {
            addIfUnique(type.details.moduleName);
            break;
        }

        case TypeCategory.OverloadedFunction: {
            type.overloads.forEach((overload) => {
                addDeclaringModuleNamesForType(overload, moduleList, recursionCount + 1);
            });
            break;
        }

        case TypeCategory.Union: {
            doForEachSubtype(type, (subtype) => {
                addDeclaringModuleNamesForType(subtype, moduleList, recursionCount + 1);
            });
            break;
        }

        case TypeCategory.Module: {
            addIfUnique(type.moduleName);
            break;
        }
    }
}
