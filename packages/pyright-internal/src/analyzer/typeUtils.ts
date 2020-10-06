/*
 * typeUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Collection of functions that operate on Type objects.
 */

import { isClassOrTypeElement } from 'typescript';

import { PythonVersion } from '../common/pythonVersion';
import { ParameterCategory } from '../parser/parseNodes';
import { DeclarationType } from './declaration';
import { Symbol, SymbolFlags, SymbolTable } from './symbol';
import { isTypedDictMemberAccessedThroughIndex } from './symbolUtils';
import {
    AnyType,
    ClassType,
    combineTypes,
    EnumLiteral,
    FunctionType,
    isAnyOrUnknown,
    isClass,
    isNone,
    isObject,
    isTypeSame,
    isTypeVar,
    isUnknown,
    maxTypeRecursionCount,
    ModuleType,
    NeverType,
    NoneType,
    ObjectType,
    OverloadedFunctionType,
    SpecializedFunctionTypes,
    Type,
    TypeBase,
    TypeCategory,
    TypeVarType,
    UnknownType,
} from './types';
import { TypeVarMap } from './typeVarMap';

export interface ClassMember {
    // Symbol
    symbol: Symbol;

    // Partially-specialized class that contains the class member
    classType: Type;

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

export const enum CanAssignFlags {
    Default = 0,

    // Require invariance with respect to class matching? Normally
    // subclasses are allowed.
    EnforceInvariance = 1 << 0,

    // The caller has swapped the source and dest types because
    // the types are contravariant. Perform type var matching
    // on dest type vars rather than source type var.
    ReverseTypeVarMatching = 1 << 1,

    // Normally type vars are treated as variables that need to
    // be "solved". If this flag is set, they are treated as types
    // that must match exactly.
    MatchTypeVarsExactly = 1 << 2,

    // If the dest is not Any but the src is Any, treat it
    // as incompatible.
    DisallowAssignFromAny = 1 << 3,

    // For function types, skip the return type check.
    SkipFunctionReturnTypeCheck = 1 << 4,

    // Normally type vars are specialized during type comparisons.
    // With this flag, a type var must match a type var exactly.
    DoNotSpecializeTypeVars = 1 << 5,
}

const singleTickRegEx = /'/g;
const tripleTickRegEx = /'''/g;

export function isOptionalType(type: Type): boolean {
    if (type.category === TypeCategory.Union) {
        return type.subtypes.some((t) => isNone(t));
    }

    return false;
}

// Calls a callback for each subtype and combines the results
// into a final type.
export function doForSubtypes(type: Type, callback: (type: Type) => Type | undefined): Type {
    if (type.category === TypeCategory.Union) {
        const newTypes: Type[] = [];

        type.subtypes.forEach((typeEntry) => {
            const transformedType = callback(typeEntry);
            if (transformedType) {
                newTypes.push(transformedType);
            }
        });

        return combineTypes(newTypes);
    }

    return callback(type) || NeverType.create();
}

// Determines if all of the types in the array are the same.
export function areTypesSame(types: Type[]): boolean {
    if (types.length < 2) {
        return true;
    }

    for (let i = 1; i < types.length; i++) {
        if (!isTypeSame(types[0], types[i])) {
            return false;
        }
    }

    return true;
}

export function derivesFromAnyOrUnknown(type: Type): boolean {
    let anyOrUnknown = false;

    doForSubtypes(type, (subtype) => {
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

        return undefined;
    });

    return anyOrUnknown;
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

    if (type.category === TypeCategory.Union) {
        return doForSubtypes(type, (subtype) => {
            return stripLiteralValue(subtype);
        });
    }

    return type;
}

export function enumerateLiteralsForType(type: ObjectType): ObjectType[] | undefined {
    if (ClassType.isBuiltIn(type.classType, 'bool')) {
        // Booleans have only two types: True and False.
        return [
            ObjectType.create(ClassType.cloneWithLiteral(type.classType, true)),
            ObjectType.create(ClassType.cloneWithLiteral(type.classType, false)),
        ];
    }

    if (ClassType.isEnumClass(type.classType)) {
        // Enumerate all of the values in this enumeration.
        const enumList: ObjectType[] = [];
        const fields = type.classType.details.fields;
        fields.forEach((symbol, name) => {
            if (!symbol.isIgnoredForProtocolMatch() && !symbol.isInstanceMember()) {
                enumList.push(
                    ObjectType.create(
                        ClassType.cloneWithLiteral(type.classType, new EnumLiteral(type.classType.details.name, name))
                    )
                );
            }
        });

        return enumList;
    }

    return undefined;
}

export function stripLiteralTypeArgsValue(type: Type, recursionCount = 0): Type {
    if (recursionCount > maxTypeRecursionCount) {
        return type;
    }

    if (isClass(type)) {
        if (type.typeArguments) {
            const strippedTypeArgs = type.typeArguments.map((t) =>
                stripLiteralTypeArgsValue(stripLiteralValue(t), recursionCount + 1)
            );
            return ClassType.cloneForSpecialization(
                type,
                strippedTypeArgs,
                !!type.isTypeArgumentExplicit,
                type.skipAbstractClassTest
            );
        }

        return type;
    }

    if (isObject(type)) {
        if (type.classType.typeArguments) {
            type = ObjectType.create(stripLiteralTypeArgsValue(type.classType, recursionCount + 1) as ClassType);
        }

        return type;
    }

    if (type.category === TypeCategory.Union) {
        let typeChanged = false;
        const transformedUnion = doForSubtypes(type, (subtype) => {
            const transformedType = stripLiteralTypeArgsValue(subtype, recursionCount + 1);
            if (transformedType !== subtype) {
                typeChanged = true;
            }
            return transformedType;
        });

        return typeChanged ? transformedUnion : type;
    }

    if (type.category === TypeCategory.Function) {
        if (type.specializedTypes) {
            const strippedSpecializedTypes: SpecializedFunctionTypes = {
                parameterTypes: type.specializedTypes.parameterTypes.map((t) =>
                    stripLiteralTypeArgsValue(stripLiteralValue(t), recursionCount + 1)
                ),
                returnType: type.specializedTypes.returnType
                    ? stripLiteralTypeArgsValue(stripLiteralValue(type.specializedTypes.returnType), recursionCount + 1)
                    : undefined,
            };
            type = FunctionType.cloneForSpecialization(type, strippedSpecializedTypes, type.inferredReturnType);
        }

        return type;
    }

    if (type.category === TypeCategory.OverloadedFunction) {
        const strippedOverload = OverloadedFunctionType.create();
        let typeChanged = false;
        strippedOverload.overloads = type.overloads.map((t) => {
            const transformedOverload = stripLiteralTypeArgsValue(t, recursionCount + 1) as FunctionType;
            if (transformedOverload !== t) {
                typeChanged = true;
            }
            return transformedOverload;
        });
        return typeChanged ? strippedOverload : type;
    }

    return type;
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

    // If it's a generic Type, we can't get the class.
    if (!classType.typeArguments || classType.typeArguments.length < 1) {
        return type;
    }

    const typeArg = classType.typeArguments[0];
    if (!isObject(typeArg)) {
        return type;
    }

    return typeArg.classType;
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
            type.category === TypeCategory.Unbound &&
            type.typeAliasInfo &&
            type.typeAliasInfo.aliasName === typeAliasPlaceholder.details.recursiveTypeAliasName
        );
    }

    for (const subtype of type.subtypes) {
        if (isTypeSame(typeAliasPlaceholder, subtype)) {
            return true;
        }
    }

    return false;
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

            const typeVarMap = buildTypeVarMap(type.details.recursiveTypeParameters, type.typeAliasInfo.typeArguments);
            return specializeType(unspecializedType, typeVarMap);
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
            return type.subtypes.some((t) => canBeFalsy(t, recursionLevel + 1));
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
            if (isTupleClass(type.classType) && type.classType.typeArguments) {
                if (type.classType.typeArguments.length === 0) {
                    return true;
                }

                const lastTypeArg = type.classType.typeArguments[type.classType.typeArguments.length - 1];
                if (isEllipsisType(lastTypeArg)) {
                    return true;
                }

                return false;
            }

            const lenMethod = lookUpObjectMember(type, '__len__');
            if (lenMethod) {
                return true;
            }

            const boolMethod = lookUpObjectMember(type, '__bool__');
            if (boolMethod) {
                return true;
            }

            // Check for Literal[False].
            if (ClassType.isBuiltIn(type.classType, 'bool')) {
                if (type.classType.literalValue === false) {
                    return true;
                }
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
            return type.subtypes.some((t) => canBeTruthy(t, recursionLevel + 1));
        }

        case TypeCategory.Unbound:
        case TypeCategory.None: {
            return false;
        }

        case TypeCategory.Object: {
            // Check for Tuple[()] (an empty tuple).
            if (isTupleClass(type.classType)) {
                if (type.classType.typeArguments && type.classType.typeArguments.length === 0) {
                    return false;
                }
            }

            // Check for Literal[False].
            if (ClassType.isBuiltIn(type.classType, 'bool')) {
                if (type.classType.literalValue === false) {
                    return false;
                }
            }

            return true;
        }
    }
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
    return specializeType(tupleClass, typeVarMap) as ClassType;
}

export function isLiteralType(type: Type, allowLiteralUnions = true): boolean {
    if (isObject(type)) {
        return type.classType.literalValue !== undefined;
    }

    if (allowLiteralUnions && type.category === TypeCategory.Union) {
        return !type.subtypes.some((t) => !isObject(t) || t.classType.literalValue === undefined);
    }

    return false;
}

export function isEllipsisType(type: Type): boolean {
    // Ellipses are translated into both a special form of "Any" or
    // a distinct class depending on the context.
    if (type.category === TypeCategory.Any && type.isEllipsis) {
        return true;
    }

    return isClass(type) && ClassType.isBuiltIn(type, 'ellipsis');
}

export function isNoReturnType(type: Type): boolean {
    if (isObject(type)) {
        const classType = type.classType;
        if (ClassType.isBuiltIn(classType, 'NoReturn')) {
            return true;
        }
    }
    return false;
}

export function isParamSpecType(type: Type): boolean {
    if (!isTypeVar(type)) {
        return false;
    }

    return type.details.isParamSpec;
}

export function isProperty(type: Type): type is ObjectType {
    return isObject(type) && ClassType.isPropertyClass(type.classType);
}

export function isTupleClass(type: ClassType) {
    return ClassType.isBuiltIn(type) && (type.details.name === 'Tuple' || type.details.name === 'tuple');
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
    return specializeType(type, typeVarMap, /* makeConcrete */ false);
}

// Replaces all of the top-level TypeVars (as opposed to TypeVars
// used as type arguments in other types) with their concrete form.
export function makeTypeVarsConcrete(type: Type): Type {
    return doForSubtypes(type, (subtype) => {
        if (isTypeVar(subtype)) {
            if (subtype.details.boundType) {
                return subtype.details.boundType;
            }

            // If this is a recursive type alias placeholder
            // that hasn't yet been resolved, return it as is.
            if (subtype.details.recursiveTypeAliasName) {
                return subtype;
            }

            // Normally, we would use UnknownType here, but we need
            // to use Any because unknown types will generate diagnostics
            // in strictly-typed files that cannot be suppressed in
            // any reasonable manner.
            return AnyType.create();
        }

        return subtype;
    });
}

// Specializes a (potentially generic) type by substituting
// type variables with specified types. If typeVarMap is not
// provided or makeConcrete is true, type variables are replaced
// with a concrete type derived from the type variable if there
// is no corresponding definition in the typeVarMap.
export function specializeType(
    type: Type,
    typeVarMap: TypeVarMap | undefined,
    makeConcrete = false,
    recursionLevel = 0
): Type {
    if (recursionLevel > maxTypeRecursionCount) {
        return type;
    }

    // Shortcut the operation if possible.
    if (!requiresSpecialization(type)) {
        return type;
    }

    // Shortcut if there are no type variables defined.
    if (typeVarMap && !makeConcrete && typeVarMap.typeVarCount() === 0) {
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

            const typeArgs = type.typeAliasInfo.typeArguments.map((typeArg) =>
                specializeType(typeArg, typeVarMap, /* makeConcrete */ false, recursionLevel + 1)
            );

            return TypeBase.cloneForTypeAlias(
                type,
                type.typeAliasInfo.aliasName,
                type.typeAliasInfo.typeParameters,
                typeArgs
            );
        }

        if (typeVarMap) {
            const replacementType = typeVarMap.getTypeVar(type);
            if (replacementType) {
                // If we're replacing a TypeVar with another type and the
                // original is not an instance, convert the replacement so it's also
                // not an instance. This happens in the case where a type alias refers
                // to a union that includes a TypeVar.
                if (TypeBase.isInstantiable(type) && !TypeBase.isInstantiable(replacementType)) {
                    return convertToInstantiable(replacementType);
                }
                return replacementType;
            }
        } else {
            if (type.details.boundType) {
                return specializeType(type.details.boundType, undefined, /* makeConcrete */ false, recursionLevel + 1);
            }

            return makeConcrete ? UnknownType.create() : type;
        }

        return type;
    }

    if (type.category === TypeCategory.Union) {
        const subtypes: Type[] = [];
        type.subtypes.forEach((typeEntry) => {
            subtypes.push(specializeType(typeEntry, typeVarMap, makeConcrete, recursionLevel + 1));
        });

        return combineTypes(subtypes);
    }

    if (isObject(type)) {
        const classType = _specializeClassType(type.classType, typeVarMap, makeConcrete, recursionLevel + 1);

        // Handle the "Type" special class.
        if (ClassType.isBuiltIn(classType, 'Type')) {
            const typeArgs = classType.typeArguments;
            if (typeArgs && typeArgs.length >= 1) {
                const firstTypeArg = typeArgs[0];
                if (isObject(firstTypeArg)) {
                    return specializeType(firstTypeArg.classType, typeVarMap, makeConcrete, recursionLevel + 1);
                } else if (isTypeVar(firstTypeArg)) {
                    if (typeVarMap) {
                        const replacementType = typeVarMap.getTypeVar(firstTypeArg);
                        if (replacementType && isObject(replacementType)) {
                            return replacementType.classType;
                        }
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
        return _specializeClassType(type, typeVarMap, makeConcrete, recursionLevel + 1);
    }

    if (type.category === TypeCategory.Function) {
        return _specializeFunctionType(type, typeVarMap, makeConcrete, recursionLevel + 1);
    }

    if (type.category === TypeCategory.OverloadedFunction) {
        return _specializeOverloadedFunctionType(type, typeVarMap, makeConcrete, recursionLevel + 1);
    }

    return type;
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
// defined by Python. For more details, see this note on method resolution
// order: https://www.python.org/download/releases/2.3/mro/.
// As it traverses the inheritance tree, it applies partial specialization
// to the the base class and member. For example, if ClassA inherits from
// ClassB[str] which inherits from Dict[_T1, int], a search for '__iter__'
// would return a class type of Dict[str, int] and a symbolType of
// (self) -> Iterator[str].
export function lookUpClassMember(
    classType: Type,
    memberName: string,
    flags = ClassMemberLookupFlags.Default
): ClassMember | undefined {
    const declaredTypesOnly = (flags & ClassMemberLookupFlags.DeclaredTypesOnly) !== 0;

    if (isClass(classType)) {
        let foundUnknownBaseClass = false;

        for (const mroClass of classType.details.mro) {
            if (!isClass(mroClass)) {
                foundUnknownBaseClass = true;
                continue;
            }

            // If mroClass is an ancestor of classType, partially specialize
            // it in the context of classType.
            const specializedMroClass = partiallySpecializeType(mroClass, classType);
            if (!isClass(specializedMroClass)) {
                continue;
            }

            // Should we ignore members on the 'object' base class?
            if (flags & ClassMemberLookupFlags.SkipObjectBaseClass) {
                if (ClassType.isBuiltIn(specializedMroClass, 'object')) {
                    continue;
                }
            }

            if (
                (flags & ClassMemberLookupFlags.SkipOriginalClass) === 0 ||
                specializedMroClass.details !== classType.details
            ) {
                const memberFields = specializedMroClass.details.fields;

                // Look at instance members first if requested.
                if ((flags & ClassMemberLookupFlags.SkipInstanceVariables) === 0) {
                    const symbol = memberFields.get(memberName);
                    if (symbol && symbol.isInstanceMember()) {
                        const hasDeclaredType = symbol.hasTypedDeclarations();
                        if (!declaredTypesOnly || hasDeclaredType) {
                            return {
                                symbol,
                                isInstanceMember: true,
                                classType: specializedMroClass,
                                isTypeDeclared: hasDeclaredType,
                            };
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
                        if (
                            ClassType.isDataClass(specializedMroClass) ||
                            ClassType.isTypedDictClass(specializedMroClass)
                        ) {
                            const decls = symbol.getDeclarations();
                            if (decls.length > 0 && decls[0].type === DeclarationType.Variable) {
                                isInstanceMember = true;
                            }
                        }

                        return {
                            symbol,
                            isInstanceMember,
                            classType: specializedMroClass,
                            isTypeDeclared: hasDeclaredType,
                        };
                    }
                }
            }

            if ((flags & ClassMemberLookupFlags.SkipBaseClasses) !== 0) {
                break;
            }
        }

        if (foundUnknownBaseClass && !declaredTypesOnly) {
            // The class derives from an unknown type, so all bets are off
            // when trying to find a member. Return an unknown symbol.
            return {
                symbol: Symbol.createWithType(SymbolFlags.None, UnknownType.create()),
                isInstanceMember: false,
                classType: UnknownType.create(),
                isTypeDeclared: false,
            };
        }
    } else if (isAnyOrUnknown(classType)) {
        // The class derives from an unknown type, so all bets are off
        // when trying to find a member. Return an unknown symbol.
        return {
            symbol: Symbol.createWithType(SymbolFlags.None, UnknownType.create()),
            isInstanceMember: false,
            classType: UnknownType.create(),
            isTypeDeclared: false,
        };
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

    if (isTypeVar(type)) {
        // Don't return any recursive type alias placeholders.
        if (type.details.recursiveTypeAliasName) {
            return [];
        }
        return [type];
    } else if (isClass(type)) {
        return getTypeVarsFromClass(type);
    } else if (isObject(type)) {
        return getTypeVarsFromClass(type.classType);
    } else if (type.category === TypeCategory.Union) {
        const combinedList: TypeVarType[] = [];
        for (const subtype of type.subtypes) {
            addTypeVarsToListIfUnique(combinedList, getTypeVarArgumentsRecursive(subtype, recursionCount + 1));
        }
        return combinedList;
    } else if (type.category === TypeCategory.Function) {
        const combinedList: TypeVarType[] = [];

        type.details.parameters.forEach((param) => {
            addTypeVarsToListIfUnique(combinedList, getTypeVarArgumentsRecursive(param.type, recursionCount + 1));
        });

        if (type.details.declaredReturnType) {
            addTypeVarsToListIfUnique(
                combinedList,
                getTypeVarArgumentsRecursive(type.details.declaredReturnType, recursionCount + 1)
            );
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

// Removes the first parameter of the function and returns a new function.
export function stripFirstParameter(type: FunctionType): FunctionType {
    if (type.details.parameters.length > 0 && type.details.parameters[0].category === ParameterCategory.Simple) {
        return FunctionType.clone(type, true);
    }
    return type;
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
            destType.subtypes.forEach((subtype) => {
                setTypeArgumentsRecursive(subtype, srcType, typeVarMap, recursionCount + 1);
            });
            break;

        case TypeCategory.Class:
            if (destType.typeArguments) {
                destType.typeArguments.forEach((typeArg) => {
                    setTypeArgumentsRecursive(typeArg, srcType, typeVarMap, recursionCount + 1);
                });
            }
            if (destType.effectiveTypeArguments) {
                destType.effectiveTypeArguments.forEach((typeArg) => {
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
                typeVarMap.setTypeVar(destType, srcType, typeVarMap.isNarrowable(destType));
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

    return buildTypeVarMap(typeParameters, typeArguments);
}

export function buildTypeVarMap(typeParameters: TypeVarType[], typeArgs: Type[] | undefined): TypeVarMap {
    const typeVarMap = new TypeVarMap();
    typeParameters.forEach((typeParam, index) => {
        let typeArgType: Type;

        if (typeArgs) {
            if (index >= typeArgs.length) {
                typeArgType = AnyType.create();
            } else {
                typeArgType = typeArgs[index];
            }
        } else {
            typeArgType = getConcreteTypeFromTypeVar(typeParam);
        }

        typeVarMap.setTypeVar(typeParam, typeArgType, false);
    });

    return typeVarMap;
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
    return doForSubtypes(type, (subtype) => {
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
    return doForSubtypes(type, (subtype) => {
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
export function getDeclaredGeneratorYieldType(functionType: FunctionType, iteratorType: Type): Type | undefined {
    const returnType = FunctionType.getSpecializedReturnType(functionType);
    if (returnType) {
        const generatorTypeArgs = _getGeneratorReturnTypeArgs(returnType);

        if (generatorTypeArgs && generatorTypeArgs.length >= 1 && isClass(iteratorType)) {
            // The yield type is the first type arg. Wrap it in an iterator.
            return ObjectType.create(
                ClassType.cloneForSpecialization(
                    iteratorType,
                    [generatorTypeArgs[0]],
                    /* isTypeArgumentExplicit */ false
                )
            );
        }

        // If the return type isn't a Generator, assume that it's the
        // full return type.
        return returnType;
    }

    return undefined;
}

// Returns the declared "send" type (the type returned from the yield
// statement) if it was declared, or undefined otherwise.
export function getDeclaredGeneratorSendType(functionType: FunctionType): Type | undefined {
    const returnType = FunctionType.getSpecializedReturnType(functionType);
    if (returnType) {
        const generatorTypeArgs = _getGeneratorReturnTypeArgs(returnType);

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
        const generatorTypeArgs = _getGeneratorReturnTypeArgs(returnType);

        if (generatorTypeArgs && generatorTypeArgs.length >= 3) {
            // The send type is the third type arg.
            return generatorTypeArgs[2];
        }

        return UnknownType.create();
    }

    return undefined;
}

export function convertToInstance(type: Type): Type {
    let result = doForSubtypes(type, (subtype) => {
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
            type.typeAliasInfo.aliasName,
            type.typeAliasInfo.typeParameters,
            type.typeAliasInfo.typeArguments
        );
    }

    return result;
}

export function convertToInstantiable(type: Type): Type {
    let result = doForSubtypes(type, (subtype) => {
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
            type.typeAliasInfo.aliasName,
            type.typeAliasInfo.typeParameters,
            type.typeAliasInfo.typeArguments
        );
    }

    return result;
}

export function getMembersForClass(classType: ClassType, symbolTable: SymbolTable, includeInstanceVars: boolean) {
    for (let i = classType.details.mro.length - 1; i >= 0; i--) {
        const mroClass = classType.details.mro[i];

        if (isClass(mroClass)) {
            // Add any new member variables from this class.
            const isClassTypedDict = ClassType.isTypedDictClass(mroClass);
            mroClass.details.fields.forEach((symbol, name) => {
                if (symbol.isClassMember() || (includeInstanceVars && symbol.isInstanceMember())) {
                    if (!isClassTypedDict || !isTypedDictMemberAccessedThroughIndex(symbol)) {
                        if (!symbolTable.get(name)) {
                            symbolTable.set(name, symbol);
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

export function isPartlyUnknown(type: Type, allowUnknownTypeArgsForClasses = false, recursionCount = 0): boolean {
    if (recursionCount > maxTypeRecursionCount) {
        return false;
    }

    if (isUnknown(type)) {
        return true;
    }

    // See if a union contains an unknown type.
    if (type.category === TypeCategory.Union) {
        for (const subtype of type.subtypes) {
            if (isPartlyUnknown(subtype, allowUnknownTypeArgsForClasses, recursionCount + 1)) {
                return true;
            }
        }

        return false;
    }

    // See if an object or class has an unknown type argument.
    if (isObject(type)) {
        return isPartlyUnknown(type.classType, false, recursionCount + 1);
    }

    if (isClass(type)) {
        if (type.typeArguments && !allowUnknownTypeArgsForClasses && !ClassType.isPseudoGenericClass(type)) {
            for (const argType of type.typeArguments) {
                if (isPartlyUnknown(argType, allowUnknownTypeArgsForClasses, recursionCount + 1)) {
                    return true;
                }
            }
        }

        return false;
    }

    // See if a function has an unknown type.
    if (type.category === TypeCategory.OverloadedFunction) {
        return type.overloads.some((overload) => {
            return isPartlyUnknown(overload, false, recursionCount + 1);
        });
    }

    if (type.category === TypeCategory.Function) {
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

function _specializeClassType(
    classType: ClassType,
    typeVarMap: TypeVarMap | undefined,
    makeConcrete: boolean,
    recursionLevel: number
): ClassType {
    // Handle the common case where the class has no type parameters.
    if (ClassType.getTypeParameters(classType).length === 0 && !ClassType.isSpecialBuiltIn(classType)) {
        return classType;
    }

    let newTypeArgs: Type[] = [];
    let newEffectiveTypeArgs: Type[] | undefined;
    let specializationNeeded = false;

    // If type args were previously provided, specialize them.
    if (classType.typeArguments) {
        newTypeArgs = classType.typeArguments.map((oldTypeArgType) => {
            const newTypeArgType = specializeType(oldTypeArgType, typeVarMap, makeConcrete, recursionLevel + 1);
            if (newTypeArgType !== oldTypeArgType) {
                specializationNeeded = true;
            }
            return newTypeArgType;
        });

        if (classType.effectiveTypeArguments) {
            newEffectiveTypeArgs = classType.effectiveTypeArguments.map((oldTypeArgType) => {
                const newTypeArgType = specializeType(oldTypeArgType, typeVarMap, makeConcrete, recursionLevel + 1);
                if (newTypeArgType !== oldTypeArgType) {
                    specializationNeeded = true;
                }
                return newTypeArgType;
            });
        }
    } else {
        ClassType.getTypeParameters(classType).forEach((typeParam) => {
            let typeArgType: Type;

            if (typeVarMap && typeVarMap.hasTypeVar(typeParam)) {
                // If the type var map already contains this type var, use
                // the existing type.
                typeArgType = typeVarMap.getTypeVar(typeParam)!;
                specializationNeeded = true;
            } else {
                // If the type var map wasn't provided or doesn't contain this
                // type var, specialize the type var.
                typeArgType = makeConcrete
                    ? getConcreteTypeFromTypeVar(
                          typeParam,
                          /* convertConstraintsToUnion */ undefined,
                          recursionLevel + 1
                      )
                    : typeParam;
                if (typeArgType !== typeParam) {
                    specializationNeeded = true;
                }
            }

            newTypeArgs.push(typeArgType);
        });
    }

    // If specialization wasn't needed, don't allocate a new class.
    if (!specializationNeeded) {
        return classType;
    }

    return ClassType.cloneForSpecialization(
        classType,
        newTypeArgs,
        /* isTypeArgumentExplicit */ false,
        /* skipAbstractClassTest */ undefined,
        newEffectiveTypeArgs
    );
}

// Converts a type var type into the most specific type
// that fits the specified constraints.
export function getConcreteTypeFromTypeVar(
    type: TypeVarType,
    convertConstraintsToUnion = false,
    recursionLevel = 0
): Type {
    if (type.details.boundType) {
        // If this is a recursive type alias placeholder, don't continue
        // to specialize it because it will expand it out until we hit the
        // recursion limit.
        if (type.details.recursiveTypeAliasName) {
            return type.details.boundType;
        }

        return specializeType(type.details.boundType, undefined, /* makeConcrete */ false, recursionLevel + 1);
    }

    // Note that we can't use constraints for specialization because
    // the union of constraints is not the same as individual constraints.
    if (convertConstraintsToUnion && type.details.constraints.length > 0) {
        return combineTypes(type.details.constraints);
    }

    // In all other cases, treat as unknown.
    return UnknownType.create();
}

function _specializeOverloadedFunctionType(
    type: OverloadedFunctionType,
    typeVarMap: TypeVarMap | undefined,
    makeConcrete: boolean,
    recursionLevel: number
): OverloadedFunctionType {
    // Specialize each of the functions in the overload.
    const overloads = type.overloads.map((entry) =>
        _specializeFunctionType(entry, typeVarMap, makeConcrete, recursionLevel)
    );

    // Construct a new overload with the specialized function types.
    const newOverloadType = OverloadedFunctionType.create();
    overloads.forEach((overload) => {
        OverloadedFunctionType.addOverload(newOverloadType, overload);
    });

    return newOverloadType;
}

function _specializeFunctionType(
    sourceType: FunctionType,
    typeVarMap: TypeVarMap | undefined,
    makeConcrete: boolean,
    recursionLevel: number
): FunctionType {
    let functionType = sourceType;

    // Handle functions with a parameter specification in a special manner.
    if (functionType.details.paramSpec) {
        let paramSpec = typeVarMap?.getParamSpec(functionType.details.paramSpec);
        if (!paramSpec && makeConcrete) {
            paramSpec = [
                { name: 'args', type: AnyType.create() },
                { name: 'kwargs', type: AnyType.create() },
            ];
        }
        if (paramSpec) {
            functionType = FunctionType.cloneForParamSpec(functionType, paramSpec);
        }
    }

    const declaredReturnType =
        functionType.specializedTypes && functionType.specializedTypes.returnType
            ? functionType.specializedTypes.returnType
            : functionType.details.declaredReturnType;
    const specializedReturnType = declaredReturnType
        ? specializeType(declaredReturnType, typeVarMap, makeConcrete, recursionLevel + 1)
        : undefined;
    let typesRequiredSpecialization = declaredReturnType !== specializedReturnType;

    const specializedParameters: SpecializedFunctionTypes = {
        parameterTypes: [],
        returnType: specializedReturnType,
    };

    for (let i = 0; i < functionType.details.parameters.length; i++) {
        const paramType = FunctionType.getEffectiveParameterType(functionType, i);
        const specializedType = specializeType(paramType, typeVarMap, makeConcrete, recursionLevel + 1);
        specializedParameters.parameterTypes.push(specializedType);

        if (paramType !== specializedType) {
            typesRequiredSpecialization = true;
        }
    }

    if (!typesRequiredSpecialization) {
        return functionType;
    }

    let specializedInferredReturnType: Type | undefined;
    if (functionType.inferredReturnType) {
        specializedInferredReturnType = specializeType(
            functionType.inferredReturnType,
            typeVarMap,
            makeConcrete,
            recursionLevel + 1
        );
    }

    return FunctionType.cloneForSpecialization(functionType, specializedParameters, specializedInferredReturnType);
}

// If the declared return type for the function is a Generator, AsyncGenerator,
// Iterator, or AsyncIterator, returns the type arguments for the type.
function _getGeneratorReturnTypeArgs(returnType: Type): Type[] | undefined {
    if (isObject(returnType)) {
        const classType = returnType.classType;
        if (ClassType.isBuiltIn(classType)) {
            const className = classType.details.name;
            if (className === 'Generator' || className === 'AsyncGenerator') {
                return classType.typeArguments;
            }

            if (className === 'Iterator' || className === 'AsyncIterator' || className === 'AsyncIterable') {
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
    if (ClassType.isBuiltIn(classType)) {
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
        if (specialClasses.some((t) => t === classType.details.name)) {
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
            return type.subtypes.find((type) => requiresSpecialization(type, recursionCount + 1)) !== undefined;
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
                    return specializeType(mroClass, typeVarMap);
                })
            );
        } else {
            classListsToMerge.push([baseClass]);
        }
    });

    classListsToMerge.push(
        baseClassesToInclude.map((baseClass) => {
            const typeVarMap = buildTypeVarMapFromSpecializedClass(classType, /* makeConcrete */ false);
            return specializeType(baseClass, typeVarMap);
        })
    );

    // The first class in the MRO is the class itself.
    const typeVarMap = buildTypeVarMapFromSpecializedClass(classType, /* makeConcrete */ false);
    classType.details.mro.push(specializeType(classType, typeVarMap));

    // Helper function that returns true if the specified searchClass
    // is found in the "tail" (i.e. in elements 1 through n) of any
    // of the class lists.
    const isInTail = (searchClass: ClassType, classLists: Type[][]) => {
        return classLists.some((classList) => {
            return (
                classList.findIndex(
                    (value) => isClass(value) && ClassType.isSameGenericClass(value, searchClass, false)
                ) > 0
            );
        });
    };

    const filterClass = (classToFilter: ClassType, classLists: Type[][]) => {
        for (let i = 0; i < classLists.length; i++) {
            classLists[i] = classLists[i].filter(
                (value) => !isClass(value) || !ClassType.isSameGenericClass(value, classToFilter, false)
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

export function printLiteralValue(type: ClassType): string {
    const literalValue = type.literalValue;
    if (literalValue === undefined) {
        return '';
    }

    let literalStr: string;
    if (typeof literalValue === 'string') {
        const prefix = type.details.name === 'bytes' ? 'b' : '';
        literalStr = literalValue.toString();
        if (literalStr.indexOf('\n') >= 0) {
            literalStr = `${prefix}'''${literalStr.replace(tripleTickRegEx, "\\'\\'\\'")}'''`;
        } else {
            literalStr = `${prefix}'${literalStr.replace(singleTickRegEx, "\\'")}'`;
        }
    } else if (typeof literalValue === 'boolean') {
        literalStr = literalValue ? 'True' : 'False';
    } else if (literalValue instanceof EnumLiteral) {
        literalStr = `${literalValue.className}.${literalValue.itemName}`;
    } else {
        literalStr = literalValue.toString();
    }

    return literalStr;
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
            type.subtypes.forEach((subtype) => {
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
