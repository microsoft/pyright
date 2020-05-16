/*
 * typeUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Collection of functions that operate on Type objects.
 */

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
    isNoneOrNever,
    isTypeSame,
    maxTypeRecursionCount,
    ModuleType,
    NeverType,
    ObjectType,
    OverloadedFunctionType,
    SpecializedFunctionTypes,
    Type,
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
}

export interface TypedDictEntry {
    valueType: Type;
    isRequired: boolean;
    isProvided: boolean;
}

export function isOptionalType(type: Type): boolean {
    if (type.category === TypeCategory.Union) {
        return type.subtypes.some((t) => isNoneOrNever(t));
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

export function stripLiteralValue(type: Type): Type {
    if (type.category === TypeCategory.Object) {
        if (type.literalValue !== undefined) {
            type = ObjectType.create(type.classType);
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
        return [ObjectType.cloneWithLiteral(type, true), ObjectType.cloneWithLiteral(type, false)];
    }

    if (ClassType.isEnumClass(type.classType)) {
        // Enumerate all of the values in this enumeration.
        const enumList: ObjectType[] = [];
        const fields = type.classType.details.fields;
        fields.forEach((symbol, name) => {
            if (!symbol.isIgnoredForProtocolMatch() && !symbol.isInstanceMember()) {
                enumList.push(ObjectType.cloneWithLiteral(type, new EnumLiteral(type.classType.details.name, name)));
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

    if (type.category === TypeCategory.Class) {
        if (type.typeArguments) {
            const strippedTypeArgs = type.typeArguments.map((t) =>
                stripLiteralTypeArgsValue(stripLiteralValue(t), recursionCount + 1)
            );
            return ClassType.cloneForSpecialization(type, strippedTypeArgs, type.skipAbstractClassTest);
        }
    }

    if (type.category === TypeCategory.Object) {
        if (type.classType.typeArguments) {
            type = ObjectType.create(stripLiteralTypeArgsValue(type.classType, recursionCount + 1) as ClassType);
        }

        return type;
    }

    if (type.category === TypeCategory.Union) {
        return doForSubtypes(type, (subtype) => {
            return stripLiteralTypeArgsValue(subtype, recursionCount + 1);
        });
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
            type = FunctionType.cloneForSpecialization(type, strippedSpecializedTypes);
        }

        return type;
    }

    if (type.category === TypeCategory.OverloadedFunction) {
        const strippedOverload = OverloadedFunctionType.create();
        strippedOverload.overloads = type.overloads.map(
            (t) => stripLiteralTypeArgsValue(t, recursionCount + 1) as FunctionType
        );
        return strippedOverload;
    }

    return type;
}

// If the type is a concrete class X described by the object Type[X],
// returns X. Otherwise returns the original type.
export function transformTypeObjectToClass(type: Type): Type {
    if (type.category !== TypeCategory.Object) {
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
    if (typeArg.category !== TypeCategory.Object) {
        return type;
    }

    return typeArg.classType;
}

// None is always falsy. All other types are generally truthy
// unless they are objects that support the __bool__ or __len__
// methods.
export function canBeFalsy(type: Type): boolean {
    if (type.category === TypeCategory.None) {
        return true;
    }

    if (type.category === TypeCategory.Object) {
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
            if (type.literalValue === false) {
                return true;
            }
        }
    }

    return false;
}

export function canBeTruthy(type: Type): boolean {
    if (isNoneOrNever(type)) {
        return false;
    }

    if (type.category === TypeCategory.Object) {
        // Check for Tuple[()] (an empty tuple).
        if (ClassType.isBuiltIn(type.classType, 'Tuple')) {
            if (type.classType.typeArguments && type.classType.typeArguments.length === 0) {
                return false;
            }
        }

        // Check for Literal[False].
        if (ClassType.isBuiltIn(type.classType, 'bool')) {
            if (type.literalValue === false) {
                return false;
            }
        }
    }

    return true;
}

// Determines whether the type is a Tuple class or object.
export function getSpecializedTupleType(type: Type): ClassType | undefined {
    let classType: ClassType | undefined;

    if (type.category === TypeCategory.Class) {
        classType = type;
    } else if (type.category === TypeCategory.Object) {
        classType = type.classType;
    }

    if (classType && ClassType.isBuiltIn(classType, 'Tuple')) {
        return classType;
    }

    return undefined;
}

export function isEllipsisType(type: Type): boolean {
    // Ellipses are translated into both a special form of "Any" or
    // a distinct class depending on the context.
    if (type.category === TypeCategory.Any && type.isEllipsis) {
        return true;
    }

    return type.category === TypeCategory.Class && ClassType.isBuiltIn(type, 'ellipsis');
}

export function isNoReturnType(type: Type): boolean {
    if (type.category === TypeCategory.Object) {
        const classType = type.classType;
        if (ClassType.isBuiltIn(classType, 'NoReturn')) {
            return true;
        }
    }
    return false;
}

export function isParameterSpecificationType(type: Type): boolean {
    if (type.category !== TypeCategory.TypeVar) {
        return false;
    }

    return type.isParameterSpec;
}

export function isProperty(type: Type): boolean {
    return type.category === TypeCategory.Object && ClassType.isPropertyClass(type.classType);
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
    return specializeType(type, typeVarMap, false);
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
    // Prevent infinite recursion in case a type refers to itself.
    if (recursionLevel > 100) {
        return AnyType.create();
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

    if (isNoneOrNever(type)) {
        return type;
    }

    if (type.category === TypeCategory.TypeVar) {
        if (typeVarMap) {
            const replacementType = typeVarMap.getTypeVar(type.name);
            if (replacementType) {
                return replacementType;
            }
        }

        if (!typeVarMap || makeConcrete) {
            return getConcreteTypeFromTypeVar(type, recursionLevel + 1);
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

    if (type.category === TypeCategory.Object) {
        const classType = _specializeClassType(type.classType, typeVarMap, makeConcrete, recursionLevel + 1);

        // Handle the "Type" special class.
        if (ClassType.isBuiltIn(classType, 'Type')) {
            const typeArgs = classType.typeArguments;
            if (typeArgs && typeArgs.length >= 1) {
                const firstTypeArg = typeArgs[0];
                if (firstTypeArg.category === TypeCategory.Object) {
                    return specializeType(firstTypeArg.classType, typeVarMap, makeConcrete, recursionLevel + 1);
                } else if (firstTypeArg.category === TypeCategory.TypeVar) {
                    if (typeVarMap) {
                        const replacementType = typeVarMap.getTypeVar(firstTypeArg.name);
                        if (replacementType && replacementType.category === TypeCategory.Object) {
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

    if (type.category === TypeCategory.Class) {
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
    if (objectType.category === TypeCategory.Object) {
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

    if (classType.category === TypeCategory.Class) {
        let foundUnknownBaseClass = false;

        for (const mroClass of classType.details.mro) {
            if (mroClass.category !== TypeCategory.Class) {
                foundUnknownBaseClass = true;
                continue;
            }

            // If mroClass is an ancestor of classType, partially specialize
            // it in the context of classType.
            const specializedMroClass = partiallySpecializeType(mroClass, classType);
            if (specializedMroClass.category !== TypeCategory.Class) {
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

                // Look in the instance members first if requested.
                if ((flags & ClassMemberLookupFlags.SkipInstanceVariables) === 0) {
                    const symbol = memberFields.get(memberName);
                    if (symbol && symbol.isInstanceMember()) {
                        if (!declaredTypesOnly || symbol.hasTypedDeclarations()) {
                            return {
                                symbol,
                                isInstanceMember: true,
                                classType: specializedMroClass,
                            };
                        }
                    }
                }

                // Next look in the class members.
                const symbol = memberFields.get(memberName);
                if (symbol && symbol.isClassMember()) {
                    if (!declaredTypesOnly || symbol.hasTypedDeclarations()) {
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
            };
        }
    } else if (isAnyOrUnknown(classType)) {
        // The class derives from an unknown type, so all bets are off
        // when trying to find a member. Return an unknown symbol.
        return {
            symbol: Symbol.createWithType(SymbolFlags.None, UnknownType.create()),
            isInstanceMember: false,
            classType: UnknownType.create(),
        };
    }

    return undefined;
}

export function getMetaclass(type: ClassType, recursionCount = 0): ClassType | UnknownType | undefined {
    if (recursionCount > maxTypeRecursionCount) {
        return undefined;
    }

    if (type.details.metaClass) {
        if (type.details.metaClass.category === TypeCategory.Class) {
            return type.details.metaClass;
        } else {
            return UnknownType.create();
        }
    }

    for (const base of type.details.baseClasses) {
        if (base.category === TypeCategory.Class) {
            const metaclass = getMetaclass(base, recursionCount + 1);
            if (metaclass) {
                return metaclass;
            }
        }
    }

    return undefined;
}

// Combines two lists of type var types, maintaining the combined order
// but removing any duplicates.
export function addTypeVarsToListIfUnique(list1: TypeVarType[], list2: TypeVarType[]) {
    for (const type2 of list2) {
        if (!list1.find((type1) => type1 === type2)) {
            list1.push(type2);
        }
    }
}

// Walks the type recursively (in a depth-first manner), finds all
// type variables that are referenced, and returns an ordered list
// of unique type variables. For example, if the type is
// Union[List[Dict[_T1, _T2]], _T1, _T3], the result would be
// [_T1, _T2, _T3].
export function getTypeVarArgumentsRecursive(type: Type): TypeVarType[] {
    const getTypeVarsFromClass = (classType: ClassType) => {
        const combinedList: TypeVarType[] = [];
        if (classType.typeArguments) {
            classType.typeArguments.forEach((typeArg) => {
                addTypeVarsToListIfUnique(combinedList, getTypeVarArgumentsRecursive(typeArg));
            });
        }

        return combinedList;
    };

    if (type.category === TypeCategory.TypeVar) {
        return [type];
    } else if (type.category === TypeCategory.Class) {
        return getTypeVarsFromClass(type);
    } else if (type.category === TypeCategory.Object) {
        return getTypeVarsFromClass(type.classType);
    } else if (type.category === TypeCategory.Union) {
        const combinedList: TypeVarType[] = [];
        for (const subtype of type.subtypes) {
            addTypeVarsToListIfUnique(combinedList, getTypeVarArgumentsRecursive(subtype));
        }
        return combinedList;
    } else if (type.category === TypeCategory.Function) {
        const combinedList: TypeVarType[] = [];

        type.details.parameters.forEach((param) => {
            addTypeVarsToListIfUnique(combinedList, getTypeVarArgumentsRecursive(param.type));
        });

        if (type.details.declaredReturnType) {
            addTypeVarsToListIfUnique(combinedList, getTypeVarArgumentsRecursive(type.details.declaredReturnType));
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
    return ClassType.cloneForSpecialization(type, typeArgs, setSkipAbstractClassTest);
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
            if (!typeVarMap.hasTypeVar(destType.name)) {
                typeVarMap.setTypeVar(destType.name, srcType, typeVarMap.isNarrowable(destType.name));
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

    // Handle the special case where the source is a Tuple with heterogenous
    // type arguments. In this case, we'll create a union out of the heterogeneous
    // types.
    if (ClassType.isBuiltIn(classType, 'Tuple') && classType.typeArguments) {
        if (classType.typeArguments.length > 1) {
            const lastTypeArg = classType.typeArguments[classType.typeArguments.length - 1];
            if (!isEllipsisType(lastTypeArg)) {
                typeArguments = [combineTypes(classType.typeArguments)];
            }
        }
    }

    return buildTypeVarMap(typeParameters, typeArguments);
}

export function buildTypeVarMap(typeParameters: TypeVarType[], typeArgs: Type[] | undefined): TypeVarMap {
    const typeVarMap = new TypeVarMap();
    typeParameters.forEach((typeParam, index) => {
        const typeVarName = typeParam.name;
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

        typeVarMap.setTypeVar(typeVarName, typeArgType, false);
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
        if (baseClass.category === TypeCategory.Class) {
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
        if (subtype.category === TypeCategory.Object) {
            if (subtype.literalValue !== undefined) {
                // If the object is already definitely truthy, it's fine to
                // include, otherwise it should be removed.
                return subtype.literalValue ? subtype : undefined;
            }

            // If the object is a bool, make it "true", since
            // "false" is a falsy value.
            if (ClassType.isBuiltIn(subtype.classType, 'bool')) {
                return ObjectType.cloneWithLiteral(subtype, true);
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
        if (subtype.category === TypeCategory.Object) {
            if (subtype.literalValue !== undefined) {
                // If the object is already definitely falsy, it's fine to
                // include, otherwise it should be removed.
                return !subtype.literalValue ? subtype : undefined;
            }

            // If the object is a bool, make it "false", since
            // "true" is a truthy value.
            if (ClassType.isBuiltIn(subtype.classType, 'bool')) {
                return ObjectType.cloneWithLiteral(subtype, false);
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

        if (generatorTypeArgs && generatorTypeArgs.length >= 1 && iteratorType.category === TypeCategory.Class) {
            // The yield type is the first type arg. Wrap it in an iterator.
            return ObjectType.create(ClassType.cloneForSpecialization(iteratorType, [generatorTypeArgs[0]]));
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

export function convertClassToObject(type: Type): Type {
    return doForSubtypes(type, (subtype) => {
        if (subtype.category === TypeCategory.Class) {
            return ObjectType.create(subtype);
        }

        return subtype;
    });
}

export function getMembersForClass(classType: ClassType, symbolTable: SymbolTable, includeInstanceVars: boolean) {
    for (let i = classType.details.mro.length - 1; i >= 0; i--) {
        const mroClass = classType.details.mro[i];

        if (mroClass.category === TypeCategory.Class) {
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

export function containsUnknown(type: Type, allowUnknownTypeArgsForClasses = false, recursionCount = 0): boolean {
    if (recursionCount > maxTypeRecursionCount) {
        return false;
    }

    if (type.category === TypeCategory.Unknown) {
        return true;
    }

    // See if a union contains an unknown type.
    if (type.category === TypeCategory.Union) {
        for (const subtype of type.subtypes) {
            if (containsUnknown(subtype, allowUnknownTypeArgsForClasses, recursionCount + 1)) {
                return true;
            }
        }

        return false;
    }

    // See if an object or class has an unknown type argument.
    if (type.category === TypeCategory.Object) {
        return containsUnknown(type.classType, false, recursionCount + 1);
    }

    if (type.category === TypeCategory.Class) {
        if (type.typeArguments && !allowUnknownTypeArgsForClasses && !ClassType.isPseudoGenericClass(type)) {
            for (const argType of type.typeArguments) {
                if (containsUnknown(argType, allowUnknownTypeArgsForClasses, recursionCount + 1)) {
                    return true;
                }
            }
        }

        return false;
    }

    // See if a function has an unknown type.
    if (type.category === TypeCategory.OverloadedFunction) {
        return type.overloads.some((overload) => {
            return containsUnknown(overload, false, recursionCount + 1);
        });
    }

    if (type.category === TypeCategory.Function) {
        for (let i = 0; i < type.details.parameters.length; i++) {
            // Ignore parameters such as "*" that have no name.
            if (type.details.parameters[i].name) {
                const paramType = FunctionType.getEffectiveParameterType(type, i);
                if (containsUnknown(paramType, false, recursionCount + 1)) {
                    return true;
                }
            }
        }

        if (type.details.declaredReturnType && containsUnknown(type.details.declaredReturnType)) {
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
    if (ClassType.getTypeParameters(classType).length === 0) {
        return classType;
    }

    let newTypeArgs: Type[] = [];
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
    } else {
        ClassType.getTypeParameters(classType).forEach((typeParam) => {
            let typeArgType: Type;

            if (typeVarMap && typeVarMap.getTypeVar(typeParam.name)) {
                // If the type var map already contains this type var, use
                // the existing type.
                typeArgType = typeVarMap.getTypeVar(typeParam.name)!;
                specializationNeeded = true;
            } else {
                // If the type var map wasn't provided or doesn't contain this
                // type var, specialize the type var.
                typeArgType = makeConcrete ? getConcreteTypeFromTypeVar(typeParam) : typeParam;
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

    return ClassType.cloneForSpecialization(classType, newTypeArgs);
}

// Converts a type var type into the most specific type
// that fits the specified constraints.
export function getConcreteTypeFromTypeVar(type: TypeVarType, recursionLevel = 0): Type {
    if (type.boundType) {
        return specializeType(type.boundType, undefined, false, recursionLevel + 1);
    }

    // Note that we can't use constraints for specialization because
    // the union of constraints is not the same as individual constraints.

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
    if (functionType.details.parameterSpecification) {
        const paramSpec = typeVarMap?.getParameterSpecification(functionType.details.parameterSpecification.name);
        functionType = FunctionType.cloneForParameterSpecification(functionType, paramSpec);
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

    return FunctionType.cloneForSpecialization(functionType, specializedParameters);
}

// If the declared return type for the function is a Generator, AsyncGenerator,
// Iterator, or AsyncIterator, returns the type arguments for the type.
function _getGeneratorReturnTypeArgs(returnType: Type): Type[] | undefined {
    if (returnType.category === TypeCategory.Object) {
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
            return true;
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

    classType.details.baseClasses.forEach((baseClass) => {
        if (baseClass.category === TypeCategory.Class) {
            const typeVarMap = buildTypeVarMapFromSpecializedClass(baseClass, false);
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
        classType.details.baseClasses.map((baseClass) => {
            const typeVarMap = buildTypeVarMapFromSpecializedClass(classType, false);
            return specializeType(baseClass, typeVarMap);
        })
    );

    // The first class in the MRO is the class itself.
    const typeVarMap = buildTypeVarMapFromSpecializedClass(classType, false);
    classType.details.mro.push(specializeType(classType, typeVarMap));

    // Helper function that returns true if the specified searchClass
    // is found in the "tail" (i.e. in elements 1 through n) of any
    // of the class lists.
    const isInTail = (searchClass: ClassType, classLists: Type[][]) => {
        return classLists.some((classList) => {
            return (
                classList.findIndex(
                    (value) =>
                        value.category === TypeCategory.Class && ClassType.isSameGenericClass(value, searchClass, false)
                ) > 0
            );
        });
    };

    const filterClass = (classToFilter: ClassType, classLists: Type[][]) => {
        for (let i = 0; i < classLists.length; i++) {
            classLists[i] = classLists[i].filter(
                (value) =>
                    value.category !== TypeCategory.Class || !ClassType.isSameGenericClass(value, classToFilter, false)
            );
        }
    };

    while (true) {
        let foundValidHead = false;
        let nonEmptyList: Type[] | undefined = undefined;

        for (const classList of classListsToMerge) {
            if (classList.length > 0) {
                if (nonEmptyList === undefined) {
                    nonEmptyList = classList;
                }

                if (classList[0].category !== TypeCategory.Class) {
                    foundValidHead = true;
                    classType.details.mro.push(classList[0]);
                    classList.shift();
                    continue;
                } else if (!isInTail(classList[0], classListsToMerge)) {
                    foundValidHead = true;
                    classType.details.mro.push(classList[0]);
                    filterClass(classList[0], classListsToMerge);
                    continue;
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
            if (nonEmptyList[0].category !== TypeCategory.Class) {
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

export function printLiteralValue(type: ObjectType): string {
    const literalValue = type.literalValue;
    if (literalValue === undefined) {
        return '';
    }

    let literalStr: string;
    if (typeof literalValue === 'string') {
        const prefix = type.classType.details.name === 'bytes' ? 'b' : '';
        literalStr = `${prefix}'${literalValue.toString()}'`;
    } else if (typeof literalValue === 'boolean') {
        literalStr = literalValue ? 'True' : 'False';
    } else if (literalValue instanceof EnumLiteral) {
        literalStr = `${literalValue.className}.${literalValue.itemName}`;
    } else {
        literalStr = literalValue.toString();
    }

    return literalStr;
}

export function printLiteralType(type: ObjectType): string {
    const literalStr = printLiteralValue(type);
    if (!literalStr) {
        return '';
    }

    return `Literal[${literalStr}]`;
}
