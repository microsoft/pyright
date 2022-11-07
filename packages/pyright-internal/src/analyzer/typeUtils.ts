/*
 * typeUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Collection of functions that operate on Type objects.
 */

import { appendArray } from '../common/collectionUtils';
import { assert } from '../common/debug';
import { ParameterCategory } from '../parser/parseNodes';
import { DeclarationType } from './declaration';
import { Symbol, SymbolFlags, SymbolTable } from './symbol';
import { isDunderName } from './symbolNameUtils';
import { isTypedDictMemberAccessedThroughIndex } from './symbolUtils';
import {
    AnyType,
    ClassType,
    combineTypes,
    findSubtype,
    FunctionParameter,
    FunctionType,
    FunctionTypeFlags,
    isAny,
    isAnyOrUnknown,
    isClass,
    isClassInstance,
    isFunction,
    isInstantiableClass,
    isNever,
    isNoneInstance,
    isOverloadedFunction,
    isParamSpec,
    isTypeSame,
    isTypeVar,
    isUnbound,
    isUnion,
    isUnknown,
    isUnpackedClass,
    isVariadicTypeVar,
    maxTypeRecursionCount,
    ModuleType,
    NeverType,
    NoneType,
    OverloadedFunctionType,
    ParamSpecEntry,
    ParamSpecValue,
    SpecializedFunctionTypes,
    TupleTypeArgument,
    Type,
    TypeBase,
    TypeCategory,
    TypeCondition,
    TypeFlags,
    TypeSameOptions,
    TypeVarScopeId,
    TypeVarType,
    UnionType,
    UnknownType,
    Variance,
    WildcardTypeVarScopeId,
} from './types';
import { TypeVarContext } from './typeVarContext';

export interface ClassMember {
    // Symbol
    symbol: Symbol;

    // Partially-specialized class that contains the class member
    classType: ClassType | UnknownType;

    // True if it is an instance or class member; it can be both a class and
    // an instance member in cases where a class variable is overridden
    // by an instance variable
    isInstanceMember: boolean;
    isClassMember: boolean;

    // True if explicitly declared as "ClassVar" and therefore is
    // a type violation if it is overwritten by an instance variable
    isClassVar: boolean;

    // True if member has declared type, false if inferred
    isTypeDeclared: boolean;

    // True if member lookup skipped an undeclared (inferred) type
    // in a subclass before finding a declared type in a base class
    skippedUndeclaredType: boolean;
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

    // Skip the 'type' base class in particular.
    SkipTypeBaseClass = 1 << 5,
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

    // Skip the 'type' base class in particular.
    SkipTypeBaseClass = 1 << 3,
}

export const enum AssignTypeFlags {
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
    // as incompatible. Also, treat all source TypeVars as their
    // concrete counterparts. This option is used for validating
    // whether overload signatures overlap.
    OverloadOverlapCheck = 1 << 4,

    // For function types, skip the return type check.
    SkipFunctionReturnTypeCheck = 1 << 5,

    // Allow bool values to be assigned to TypeGuard[x] types.
    AllowBoolTypeGuard = 1 << 6,

    // In most cases, literals are stripped when assigning to a
    // type variable. This overrides the standard behavior.
    RetainLiteralsForTypeVar = 1 << 7,

    // When validating the type of a self or cls parameter, allow
    // a type mismatch. This is used in overload consistency validation
    // because overloads can provide explicit type annotations for self
    // or cls.
    SkipSelfClsTypeCheck = 1 << 8,

    // If an assignment is made to a TypeVar that is out of scope,
    // do not generate an error. This is used for populating the
    // typeVarContext when handling contravariant parameters in a callable.
    IgnoreTypeVarScope = 1 << 9,

    // We're initially populating the typeVarContext with an expected type,
    // so TypeVars should match the specified type exactly rather than
    // employing narrowing or widening, and don't strip literals.
    PopulatingExpectedType = 1 << 10,

    // We're comparing type compatibility of two distinct recursive types.
    // This has the potential of recursing infinitely. This flag allows us
    // to detect the recursion after the first level of checking.
    SkipRecursiveTypeCheck = 1 << 11,
}

export enum ParameterSource {
    PositionOnly,
    PositionOrKeyword,
    KeywordOnly,
}

export interface VirtualParameterDetails {
    param: FunctionParameter;
    type: Type;
    defaultArgType?: Type | undefined;
    index: number;
    source: ParameterSource;
}

export interface ParameterListDetails {
    // Virtual parameter list that refers to original parameters
    params: VirtualParameterDetails[];

    // Counts of virtual parameters
    positionOnlyParamCount: number;
    positionParamCount: number;

    // Indexes into virtual parameter list
    kwargsIndex?: number;
    argsIndex?: number;
    firstKeywordOnlyIndex?: number;
    firstPositionOrKeywordIndex: number;

    // Other information
    hasUnpackedVariadicTypeVar: boolean;
    hasUnpackedTypedDict: boolean;
}

// Examines the input parameters within a function signature and creates a
// "virtual list" of parameters, stripping out any markers and expanding
// any *args with unpacked tuples.
export function getParameterListDetails(type: FunctionType): ParameterListDetails {
    const result: ParameterListDetails = {
        firstPositionOrKeywordIndex: 0,
        positionParamCount: 0,
        positionOnlyParamCount: 0,
        params: [],
        hasUnpackedVariadicTypeVar: false,
        hasUnpackedTypedDict: false,
    };

    let positionOnlyIndex = type.details.parameters.findIndex(
        (p) => p.category === ParameterCategory.Simple && !p.name
    );

    // Handle the old (pre Python 3.8) way of specifying positional-only
    // parameters by naming them with "__".
    if (positionOnlyIndex < 0) {
        for (let i = 0; i < type.details.parameters.length; i++) {
            const p = type.details.parameters[i];
            if (p.category !== ParameterCategory.Simple) {
                break;
            }

            if (!p.name) {
                break;
            }

            if (isDunderName(p.name) || !p.name.startsWith('__')) {
                break;
            }

            positionOnlyIndex = i + 1;
        }
    }

    if (positionOnlyIndex >= 0) {
        result.firstPositionOrKeywordIndex = positionOnlyIndex;
    }

    for (let i = 0; i < positionOnlyIndex; i++) {
        if (type.details.parameters[i].hasDefault) {
            break;
        }

        result.positionOnlyParamCount++;
    }

    let sawKeywordOnlySeparator = false;

    const addVirtualParameter = (
        param: FunctionParameter,
        index: number,
        typeOverride?: Type,
        defaultArgTypeOverride?: Type
    ) => {
        if (param.name) {
            let source: ParameterSource;
            if (param.category === ParameterCategory.VarArgList) {
                source = ParameterSource.PositionOnly;
            } else if (sawKeywordOnlySeparator) {
                source = ParameterSource.KeywordOnly;
            } else if (positionOnlyIndex >= 0 && index < positionOnlyIndex) {
                source = ParameterSource.PositionOnly;
            } else {
                source = ParameterSource.PositionOrKeyword;
            }

            result.params.push({
                param,
                index,
                type: typeOverride ?? FunctionType.getEffectiveParameterType(type, index),
                defaultArgType: defaultArgTypeOverride,
                source,
            });
        }
    };

    type.details.parameters.forEach((param, index) => {
        if (param.category === ParameterCategory.VarArgList) {
            // If this is an unpacked tuple, expand the entries.
            const paramType = FunctionType.getEffectiveParameterType(type, index);
            if (param.name && isUnpackedClass(paramType) && paramType.tupleTypeArguments) {
                const addToPositionalOnly = index < result.positionOnlyParamCount;

                paramType.tupleTypeArguments.forEach((tupleArg, tupleIndex) => {
                    const category =
                        isVariadicTypeVar(tupleArg.type) || tupleArg.isUnbounded
                            ? ParameterCategory.VarArgList
                            : ParameterCategory.Simple;

                    if (category === ParameterCategory.VarArgList) {
                        result.argsIndex = result.params.length;
                    }

                    if (isVariadicTypeVar(param.type)) {
                        result.hasUnpackedVariadicTypeVar = true;
                    }

                    addVirtualParameter(
                        {
                            category,
                            name: `${param.name}[${tupleIndex.toString()}]`,
                            isNameSynthesized: true,
                            type: tupleArg.type,
                            hasDeclaredType: true,
                        },
                        tupleIndex,
                        tupleArg.type
                    );

                    if (tupleIndex > 0 && addToPositionalOnly) {
                        result.positionOnlyParamCount++;
                    }
                });

                // Normally, a VarArgList parameter (either named or as an unnamed separator)
                // would signify the start of keyword-only parameters. However, we can construct
                // callable signatures that defy this rule by using Callable and TypeVarTuples
                // or unpacked tuples.
                if (!sawKeywordOnlySeparator && (positionOnlyIndex < 0 || index >= positionOnlyIndex)) {
                    result.firstKeywordOnlyIndex = result.params.length;
                    sawKeywordOnlySeparator = true;
                }
            } else {
                if (param.name && result.argsIndex === undefined) {
                    result.argsIndex = result.params.length;

                    if (isVariadicTypeVar(param.type)) {
                        result.hasUnpackedVariadicTypeVar = true;
                    }
                }

                // Normally, a VarArgList parameter (either named or as an unnamed separator)
                // would signify the start of keyword-only parameters. However, we can construct
                // callable signatures that defy this rule by using Callable and TypeVarTuples
                // or unpacked tuples.
                if (!sawKeywordOnlySeparator && (positionOnlyIndex < 0 || index >= positionOnlyIndex)) {
                    result.firstKeywordOnlyIndex = result.params.length;
                    if (param.name) {
                        result.firstKeywordOnlyIndex++;
                    }
                    sawKeywordOnlySeparator = true;
                }

                addVirtualParameter(param, index);
            }
        } else if (param.category === ParameterCategory.VarArgDictionary) {
            sawKeywordOnlySeparator = true;

            const paramType = FunctionType.getEffectiveParameterType(type, index);

            // Is this an unpacked TypedDict? If so, expand the entries.
            if (isClassInstance(paramType) && isUnpackedClass(paramType) && paramType.details.typedDictEntries) {
                if (result.firstKeywordOnlyIndex === undefined) {
                    result.firstKeywordOnlyIndex = result.params.length;
                }

                const typedDictType = paramType;
                paramType.details.typedDictEntries.forEach((entry, name) => {
                    const specializedParamType = partiallySpecializeType(entry.valueType, typedDictType);

                    addVirtualParameter(
                        {
                            category: ParameterCategory.Simple,
                            name,
                            type: specializedParamType,
                            hasDeclaredType: true,
                            hasDefault: !entry.isRequired,
                        },
                        index,
                        specializedParamType
                    );
                });

                result.hasUnpackedTypedDict = true;
            } else if (param.name) {
                if (result.kwargsIndex === undefined) {
                    result.kwargsIndex = result.params.length;
                }

                if (result.firstKeywordOnlyIndex === undefined) {
                    result.firstKeywordOnlyIndex = result.params.length;
                }

                addVirtualParameter(param, index);
            }
        } else if (param.category === ParameterCategory.Simple) {
            if (param.name && !sawKeywordOnlySeparator) {
                result.positionParamCount++;
            }

            addVirtualParameter(
                param,
                index,
                /* typeOverride */ undefined,
                type.specializedTypes?.parameterDefaultArgs
                    ? type.specializedTypes?.parameterDefaultArgs[index]
                    : undefined
            );
        }
    });

    return result;
}

export function isOptionalType(type: Type): boolean {
    if (isUnion(type)) {
        return findSubtype(type, (subtype) => isNoneInstance(subtype)) !== undefined;
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

        if (!typeChanged) {
            return type;
        }

        const newType = combineTypes(newSubtypes);

        // Do our best to retain type aliases.
        if (newType.category === TypeCategory.Union) {
            UnionType.addTypeAliasSource(newType, type);
        }
        return newType;
    }

    const transformedSubtype = callback(type);
    if (!transformedSubtype) {
        return NeverType.createNever();
    }
    return transformedSubtype;
}

// Sorts types into a deterministic order.
export function sortTypes(types: Type[]): Type[] {
    return types.slice(0).sort((a, b) => {
        return compareTypes(a, b);
    });
}

function compareTypes(a: Type, b: Type): number {
    if (a.category !== b.category) {
        return b.category - a.category;
    }

    switch (a.category) {
        case TypeCategory.Unbound:
        case TypeCategory.Unknown:
        case TypeCategory.Any:
        case TypeCategory.None:
        case TypeCategory.Never:
        case TypeCategory.Union: {
            return 0;
        }

        case TypeCategory.Function: {
            const bFunc = b as FunctionType;

            const aParamCount = a.details.parameters.length;
            const bParamCount = bFunc.details.parameters.length;
            if (aParamCount !== bParamCount) {
                return bParamCount - aParamCount;
            }

            for (let i = 0; i < aParamCount; i++) {
                const aParam = a.details.parameters[i];
                const bParam = bFunc.details.parameters[i];
                if (aParam.category !== bParam.category) {
                    return bParam.category - aParam.category;
                }

                const typeComparison = compareTypes(aParam.type, bParam.type);
                if (typeComparison !== 0) {
                    return typeComparison;
                }
            }

            const returnTypeComparison = compareTypes(
                a.details.declaredReturnType ?? UnknownType.create(),
                bFunc.details.declaredReturnType ?? UnknownType.create()
            );

            if (returnTypeComparison !== 0) {
                return returnTypeComparison;
            }

            const aName = a.details.name;
            const bName = bFunc.details.name;

            if (aName < bName) {
                return -1;
            } else if (aName > bName) {
                return 1;
            }

            return 0;
        }

        case TypeCategory.OverloadedFunction: {
            const bOver = b as OverloadedFunctionType;

            const aOverloadCount = a.overloads.length;
            const bOverloadCount = bOver.overloads.length;
            if (aOverloadCount !== bOverloadCount) {
                return bOverloadCount - aOverloadCount;
            }

            for (let i = 0; i < aOverloadCount; i++) {
                const typeComparison = compareTypes(a.overloads[i], bOver.overloads[i]);
                if (typeComparison !== 0) {
                    return typeComparison;
                }
            }

            return 0;
        }

        case TypeCategory.Class: {
            const bClass = b as ClassType;

            // Sort instances before instantiables.
            if (isClassInstance(a) && isInstantiableClass(bClass)) {
                return -1;
            } else if (isInstantiableClass(a) && isClassInstance(bClass)) {
                return 1;
            }

            // Sort literals before non-literals.
            if (isLiteralType(a)) {
                if (!isLiteralType(bClass)) {
                    return -1;
                }
            } else if (isLiteralType(bClass)) {
                return 1;
            }

            // Sort non-generics before generics.
            if (a.details.typeParameters.length > 0 || isTupleClass(a)) {
                if (bClass.details.typeParameters.length === 0) {
                    return 1;
                }
            } else if (bClass.details.typeParameters.length > 0 || isTupleClass(bClass)) {
                return -1;
            }

            // Sort by class name.
            const aName = a.details.name;
            const bName = (b as ClassType).details.name;
            return aName < bName ? -1 : aName === bName ? 0 : 1;
        }

        case TypeCategory.Module: {
            const aName = a.moduleName;
            const bName = (b as ModuleType).moduleName;
            return aName < bName ? -1 : aName === bName ? 0 : 1;
        }

        case TypeCategory.TypeVar: {
            const aName = a.details.name;
            const bName = (b as TypeVarType).details.name;
            return aName < bName ? -1 : aName === bName ? 0 : 1;
        }
    }

    return 1;
}

export function doForEachSubtype(
    type: Type,
    callback: (type: Type, index: number, allSubtypes: Type[]) => void,
    sortSubtypes = false
): void {
    if (isUnion(type)) {
        const subtypes = sortSubtypes ? sortTypes(type.subtypes) : type.subtypes;
        subtypes.forEach((subtype, index) => {
            callback(subtype, index, subtypes);
        });
    } else {
        callback(type, 0, [type]);
    }
}

// Determines if all of the types in the array are the same.
export function areTypesSame(types: Type[], options: TypeSameOptions): boolean {
    if (types.length < 2) {
        return true;
    }

    for (let i = 1; i < types.length; i++) {
        if (!isTypeSame(types[0], types[i], options)) {
            return false;
        }
    }

    return true;
}

// If either type is "Unknown" (versus Any), propagate the Unknown. Preserve
// the incomplete flag on the unknown if present. The caller should verify that
// one or the other type is Unknown or Any.
export function preserveUnknown(type1: Type, type2: Type): AnyType | UnknownType {
    if (isUnknown(type1) && type1.isIncomplete) {
        return type1;
    } else if (isUnknown(type2) && type2.isIncomplete) {
        return type2;
    } else if (isUnknown(type1) || isUnknown(type2)) {
        return UnknownType.create();
    } else {
        return AnyType.create();
    }
}

// Determines whether the specified type is a type that can be
// combined with other types for a union.
export function isUnionableType(subtypes: Type[]): boolean {
    let typeFlags = TypeFlags.Instance | TypeFlags.Instantiable;

    for (const subtype of subtypes) {
        typeFlags &= subtype.flags;
    }

    // All subtypes need to be instantiable. Some types (like Any
    // and None) are both instances and instantiable. It's OK to
    // include some of these, but at least one subtype needs to
    // be definitively instantiable (not an instance).
    return (typeFlags & TypeFlags.Instantiable) !== 0 && (typeFlags & TypeFlags.Instance) === 0;
}

export function derivesFromAnyOrUnknown(type: Type): boolean {
    let anyOrUnknown = false;

    doForEachSubtype(type, (subtype) => {
        if (isAnyOrUnknown(type)) {
            anyOrUnknown = true;
        } else if (isInstantiableClass(subtype)) {
            if (ClassType.hasUnknownBaseClass(subtype)) {
                anyOrUnknown = true;
            }
        } else if (isClassInstance(subtype)) {
            if (ClassType.hasUnknownBaseClass(subtype)) {
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

        case TypeCategory.Function:
            return type.details.fullName;

        case TypeCategory.Module:
            return type.moduleName;

        case TypeCategory.OverloadedFunction:
            return type.overloads[0].details.fullName;
    }

    return undefined;
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
        case TypeCategory.Function:
            return TypeBase.cloneForCondition(type, TypeCondition.combine(type.condition, condition));

        case TypeCategory.OverloadedFunction:
            return OverloadedFunctionType.create(
                type.overloads.map((t) => addConditionToType(t, condition) as FunctionType)
            );

        case TypeCategory.Class:
            return TypeBase.cloneForCondition(type, TypeCondition.combine(type.condition, condition));

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
    }
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
        if (type === typeAliasPlaceholder) {
            return true;
        }

        // Handle the specific case where the type alias directly refers to itself.
        // In this case, the type will be unbound because it could not be resolved.
        return (
            isUnbound(type) &&
            type.typeAliasInfo &&
            type.typeAliasInfo.name === typeAliasPlaceholder.details.recursiveTypeAliasName
        );
    }

    return (
        findSubtype(type, (subtype) => isTypeVar(subtype) && subtype.details === typeAliasPlaceholder.details) !==
        undefined
    );
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

            const typeVarContext = buildTypeVarContext(
                type.details.recursiveTypeParameters,
                type.typeAliasInfo.typeArguments,
                getTypeVarScopeId(type)
            );
            return applySolvedTypeVars(unspecializedType, typeVarContext);
        }
    }

    return type;
}

export function getTypeVarScopeId(type: Type): TypeVarScopeId | undefined {
    if (isClass(type)) {
        return type.details.typeVarScopeId;
    }

    if (isFunction(type)) {
        return type.details.typeVarScopeId;
    }

    if (isTypeVar(type)) {
        return type.scopeId;
    }

    return undefined;
}

// Determines whether the type derives from tuple. If so, it returns
// the specialized tuple type.
export function getSpecializedTupleType(type: Type): ClassType | undefined {
    let classType: ClassType | undefined;

    if (isInstantiableClass(type)) {
        classType = type;
    } else if (isClassInstance(type)) {
        classType = ClassType.cloneAsInstantiable(type);
    }

    if (!classType) {
        return undefined;
    }

    // See if this class derives from Tuple or tuple. If it does, we'll assume that it
    // hasn't been overridden in a way that changes the behavior of the tuple class.
    const tupleClass = classType.details.mro.find(
        (mroClass) => isInstantiableClass(mroClass) && isTupleClass(mroClass)
    );
    if (!tupleClass || !isInstantiableClass(tupleClass)) {
        return undefined;
    }

    if (ClassType.isSameGenericClass(classType, tupleClass)) {
        return classType;
    }

    const typeVarContext = buildTypeVarContextFromSpecializedClass(classType);
    return applySolvedTypeVars(tupleClass, typeVarContext) as ClassType;
}

export function isLiteralType(type: ClassType): boolean {
    return TypeBase.isInstance(type) && type.literalValue !== undefined;
}

export function isLiteralTypeOrUnion(type: Type): boolean {
    if (isClassInstance(type)) {
        return type.literalValue !== undefined;
    }

    if (isUnion(type)) {
        return !findSubtype(type, (subtype) => !isClassInstance(subtype) || subtype.literalValue === undefined);
    }

    return false;
}

export function containsType(
    type: Type,
    predicate: (t: Type) => boolean,
    includeTypeArgs = false,
    recursionCount = 0
): boolean {
    if (recursionCount > maxTypeRecursionCount) {
        return false;
    }
    recursionCount++;

    if (predicate(type)) {
        return true;
    }

    if (includeTypeArgs && isClass(type)) {
        const typeArgs = type.tupleTypeArguments?.map((t) => t.type) || type.typeArguments;
        if (typeArgs) {
            return typeArgs.some((typeArg) => containsType(typeArg, predicate, includeTypeArgs, recursionCount));
        }
    }

    if (isUnion(type)) {
        return type.subtypes.some((subtype) => containsType(subtype, predicate, includeTypeArgs, recursionCount));
    }

    if (isOverloadedFunction(type)) {
        return type.overloads.some((overload) => containsType(overload, predicate, includeTypeArgs, recursionCount));
    }

    if (isFunction(type)) {
        const returnType = FunctionType.getSpecializedReturnType(type);
        if (returnType && containsType(returnType, predicate, includeTypeArgs, recursionCount)) {
            return true;
        }

        for (let i = 0; i < type.details.parameters.length; i++) {
            const paramType = FunctionType.getEffectiveParameterType(type, i);
            if (containsType(paramType, predicate, includeTypeArgs, recursionCount)) {
                return true;
            }
        }
    }

    return false;
}

export function containsLiteralType(type: Type, includeTypeArgs = false, recursionCount = 0): boolean {
    return containsType(
        type,
        (t) => {
            if (!isClassInstance(t)) {
                return false;
            }

            return isLiteralType(t) || ClassType.isBuiltIn(t, 'LiteralString');
        },
        includeTypeArgs,
        recursionCount
    );
}

// If all of the subtypes are literals with the same built-in class (e.g.
// all 'int' or all 'str'), this function returns the name of that type. If
// some of the subtypes are not literals or the literal classes don't match,
// it returns undefined.
export function getLiteralTypeClassName(type: Type): string | undefined {
    if (isClassInstance(type)) {
        if (type.literalValue !== undefined && ClassType.isBuiltIn(type)) {
            return type.details.name;
        }
        return undefined;
    }

    if (isUnion(type)) {
        let className: string | undefined;
        let foundMismatch = false;

        doForEachSubtype(type, (subtype) => {
            const subtypeLiteralTypeName = getLiteralTypeClassName(subtype);
            if (!subtypeLiteralTypeName) {
                foundMismatch = true;
            } else if (!className) {
                className = subtypeLiteralTypeName;
            }
        });

        return foundMismatch ? undefined : className;
    }

    return undefined;
}

export function getUnionSubtypeCount(type: Type): number {
    if (isUnion(type)) {
        return type.subtypes.length;
    }

    return 1;
}

export function isEllipsisType(type: Type): boolean {
    return isAny(type) && type.isEllipsis;
}

export function isProperty(type: Type) {
    return isClassInstance(type) && ClassType.isPropertyClass(type);
}

export function isDescriptorInstance(type: Type, requireSetter = false): boolean {
    if (isUnion(type)) {
        return type.subtypes.every((subtype) => isMaybeDescriptorInstance(subtype, requireSetter));
    }

    return isMaybeDescriptorInstance(type, requireSetter);
}

export function isMaybeDescriptorInstance(type: Type, requireSetter = false): boolean {
    if (isUnion(type)) {
        return type.subtypes.some((subtype) => isMaybeDescriptorInstance(subtype, requireSetter));
    }

    if (!isClassInstance(type)) {
        return false;
    }

    if (!type.details.fields.has('__get__')) {
        return false;
    }

    if (requireSetter && !type.details.fields.has('__set__')) {
        return false;
    }

    return true;
}

export function isTupleClass(type: ClassType) {
    return ClassType.isBuiltIn(type, 'tuple');
}

// Indicates whether the type is a tuple class of
// the form tuple[x, ...] where the number of elements
// in the tuple is unknown.
export function isUnboundedTupleClass(type: ClassType) {
    return type.tupleTypeArguments && type.tupleTypeArguments.some((t) => t.isUnbounded);
}

// Partially specializes a type within the context of a specified
// (presumably specialized) class. Optionally specializes the `Self`
// type variables, replacing them with selfClass.
export function partiallySpecializeType(
    type: Type,
    contextClassType: ClassType,
    selfClass?: ClassType,
    typeClassType?: Type
): Type {
    // If the context class is not specialized (or doesn't need specialization),
    // then there's no need to do any more work.
    if (ClassType.isUnspecialized(contextClassType)) {
        return type;
    }

    // Partially specialize the type using the specialized class type vars.
    const typeVarContext = buildTypeVarContextFromSpecializedClass(contextClassType, /* makeConcrete */ undefined);

    if (selfClass) {
        populateTypeVarContextForSelfType(typeVarContext, contextClassType, selfClass);
    }

    return applySolvedTypeVars(
        type,
        typeVarContext,
        /* unknownIfNotFound */ undefined,
        /* useNarrowBoundOnly */ undefined,
        /* eliminateUnsolvedInUnions */ undefined,
        typeClassType
    );
}

export function populateTypeVarContextForSelfType(
    typeVarContext: TypeVarContext,
    contextClassType: ClassType,
    selfClass: ClassType
) {
    const synthesizedSelfTypeVar = synthesizeTypeVarForSelfCls(contextClassType, /* isClsParam */ false);
    typeVarContext.setTypeVarType(synthesizedSelfTypeVar, convertToInstance(selfClass));
}

// Specializes a (potentially generic) type by substituting
// type variables from a type var map.
export function applySolvedTypeVars(
    type: Type,
    typeVarContext: TypeVarContext,
    unknownIfNotFound = false,
    useNarrowBoundOnly = false,
    eliminateUnsolvedInUnions = false,
    typeClassType?: Type
): Type {
    // Use a shortcut if the typeVarContext is empty and no transform is necessary.
    if (typeVarContext.isEmpty() && !unknownIfNotFound && !eliminateUnsolvedInUnions) {
        return type;
    }

    const transformer = new ApplySolvedTypeVarsTransformer(
        typeVarContext,
        unknownIfNotFound,
        useNarrowBoundOnly,
        eliminateUnsolvedInUnions,
        typeClassType
    );
    return transformer.apply(type);
}

// During bidirectional type inference for constructors, an "executed type"
// is used to prepopulate the type var map. This is problematic when the
// expected type uses TypeVars that are not part of the context of the
// class we are constructing. We'll replace these type variables with dummy
// type variables that are scoped to the appropriate context.
export function transformExpectedTypeForConstructor(
    expectedType: Type,
    liveTypeVarScopes: TypeVarScopeId[]
): Type | undefined {
    const isTypeVarLive = (typeVar: TypeVarType) => liveTypeVarScopes.some((scopeId) => typeVar.scopeId === scopeId);

    // Handle "naked TypeVars" (i.e. the expectedType is a TypeVar itself)
    // specially. Return undefined to indicate that it's an out-of-scope
    // TypeVar.
    if (isTypeVar(expectedType)) {
        if (isTypeVarLive(expectedType)) {
            return expectedType;
        }

        return undefined;
    }

    const transformer = new ExpectedConstructorTypeTransformer(liveTypeVarScopes);
    return transformer.apply(expectedType);
}

// Given a protocol class, this function returns a set of all the
// symbols (indexed by symbol name) that are part of that protocol
// and its protocol parent classes. If a same-named symbol appears
// in a parent and a child, the child overrides the parent.
export function getProtocolSymbols(classType: ClassType) {
    const symbolMap = new Map<string, ClassMember>();

    if (ClassType.isProtocolClass(classType)) {
        getProtocolSymbolsRecursive(classType, symbolMap);
    }

    return symbolMap;
}

function getProtocolSymbolsRecursive(classType: ClassType, symbolMap: Map<string, ClassMember>, recursionCount = 0) {
    if (recursionCount > maxTypeRecursionCount) {
        return;
    }

    classType.details.baseClasses.forEach((baseClass) => {
        if (isClass(baseClass) && ClassType.isProtocolClass(baseClass)) {
            getProtocolSymbolsRecursive(baseClass, symbolMap, recursionCount + 1);
        }
    });

    classType.details.fields.forEach((symbol, name) => {
        if (!symbol.isIgnoredForProtocolMatch()) {
            symbolMap.set(name, {
                symbol,
                classType,
                isInstanceMember: symbol.isInstanceMember(),
                isClassMember: symbol.isClassMember(),
                isClassVar: symbol.isClassVar(),
                isTypeDeclared: symbol.hasTypedDeclarations(),
                skippedUndeclaredType: false,
            });
        }
    });
}

export function lookUpObjectMember(
    objectType: Type,
    memberName: string,
    flags = ClassMemberLookupFlags.Default
): ClassMember | undefined {
    if (isClassInstance(objectType)) {
        return lookUpClassMember(objectType, memberName, flags);
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
    let skippedUndeclaredType = false;

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
        if (flags & ClassMemberLookupFlags.SkipTypeBaseClass) {
            classFlags = classFlags | ClassIteratorFlags.SkipTypeBaseClass;
        }

        const classItr = getClassIterator(classType, classFlags);

        for (const [mroClass, specializedMroClass] of classItr) {
            if (!isInstantiableClass(mroClass)) {
                if (!declaredTypesOnly) {
                    // The class derives from an unknown type, so all bets are off
                    // when trying to find a member. Return an unknown symbol.
                    const cm: ClassMember = {
                        symbol: Symbol.createWithType(SymbolFlags.None, UnknownType.create()),
                        isInstanceMember: false,
                        isClassMember: true,
                        isClassVar: false,
                        classType: UnknownType.create(),
                        isTypeDeclared: false,
                        skippedUndeclaredType: false,
                    };
                    yield cm;
                }
                continue;
            }

            if (!isInstantiableClass(specializedMroClass)) {
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
                            isClassMember: symbol.isClassMember(),
                            isClassVar: symbol.isClassVar(),
                            classType: specializedMroClass,
                            isTypeDeclared: hasDeclaredType,
                            skippedUndeclaredType,
                        };
                        yield cm;
                    } else {
                        skippedUndeclaredType = true;
                    }
                }
            }

            // Next look at class members.
            const symbol = memberFields.get(memberName);
            if (symbol && symbol.isClassMember()) {
                const hasDeclaredType = symbol.hasTypedDeclarations();
                if (!declaredTypesOnly || hasDeclaredType) {
                    let isInstanceMember = symbol.isInstanceMember();
                    let isClassMember = true;

                    // For data classes and typed dicts, variables that are declared
                    // within the class are treated as instance variables. This distinction
                    // is important in cases where a variable is a callable type because
                    // we don't want to bind it to the instance like we would for a
                    // class member.
                    const isDataclass = ClassType.isDataClass(specializedMroClass);
                    const isTypedDict = ClassType.isTypedDictClass(specializedMroClass);
                    if (isDataclass || isTypedDict) {
                        const decls = symbol.getDeclarations();
                        if (decls.length > 0 && decls[0].type === DeclarationType.Variable) {
                            isInstanceMember = true;
                            isClassMember = isDataclass;
                        }
                    }

                    const cm: ClassMember = {
                        symbol,
                        isInstanceMember,
                        isClassMember,
                        isClassVar: symbol.isClassVar(),
                        classType: specializedMroClass,
                        isTypeDeclared: hasDeclaredType,
                        skippedUndeclaredType,
                    };
                    yield cm;
                } else {
                    skippedUndeclaredType = true;
                }
            }
        }
    } else if (isAnyOrUnknown(classType)) {
        // The class derives from an unknown type, so all bets are off
        // when trying to find a member. Return an unknown symbol.
        const cm: ClassMember = {
            symbol: Symbol.createWithType(SymbolFlags.None, UnknownType.create()),
            isInstanceMember: false,
            isClassMember: true,
            isClassVar: false,
            classType: UnknownType.create(),
            isTypeDeclared: false,
            skippedUndeclaredType: false,
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
                if (isInstantiableClass(specializedMroClass)) {
                    if (ClassType.isBuiltIn(specializedMroClass, 'object')) {
                        break;
                    }
                }
            }

            // Should we ignore members on the 'type' base class?
            if (flags & ClassIteratorFlags.SkipTypeBaseClass) {
                if (isInstantiableClass(specializedMroClass)) {
                    if (ClassType.isBuiltIn(specializedMroClass, 'type')) {
                        break;
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

export function getClassFieldsRecursive(classType: ClassType): Map<string, ClassMember> {
    const memberMap = new Map<string, ClassMember>();

    // Evaluate the types of members from the end of the MRO to the beginning.
    ClassType.getReverseMro(classType).forEach((mroClass) => {
        const specializedMroClass = partiallySpecializeType(mroClass, classType);

        if (isClass(specializedMroClass)) {
            specializedMroClass.details.fields.forEach((symbol, name) => {
                if (!symbol.isIgnoredForProtocolMatch() && symbol.hasTypedDeclarations()) {
                    memberMap.set(name, {
                        classType: specializedMroClass,
                        symbol,
                        isInstanceMember: symbol.isInstanceMember(),
                        isClassMember: symbol.isClassMember(),
                        isClassVar: symbol.isClassVar(),
                        isTypeDeclared: true,
                        skippedUndeclaredType: false,
                    });
                }
            });
        } else {
            // If this ancestor class is unknown, throw away all symbols
            // found so far because they could be overridden by the unknown class.
            memberMap.clear();
        }
    });

    return memberMap;
}

// Combines two lists of type var types, maintaining the combined order
// but removing any duplicates.
export function addTypeVarsToListIfUnique(list1: TypeVarType[], list2: TypeVarType[]) {
    for (const type2 of list2) {
        if (!list1.find((type1) => isTypeSame(convertToInstance(type1), convertToInstance(type2)))) {
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
    recursionCount++;

    const getTypeVarsFromClass = (classType: ClassType) => {
        const combinedList: TypeVarType[] = [];
        if (classType.typeArguments) {
            classType.typeArguments.forEach((typeArg) => {
                addTypeVarsToListIfUnique(combinedList, getTypeVarArgumentsRecursive(typeArg, recursionCount));
            });
        }

        return combinedList;
    };

    if (type.typeAliasInfo?.typeArguments) {
        const combinedList: TypeVarType[] = [];

        type.typeAliasInfo?.typeArguments.forEach((typeArg) => {
            addTypeVarsToListIfUnique(combinedList, getTypeVarArgumentsRecursive(typeArg, recursionCount));
        });

        return combinedList;
    }

    if (isTypeVar(type)) {
        // Don't return any recursive type alias placeholders.
        if (type.details.recursiveTypeAliasName) {
            return [];
        }

        // Don't return any P.args or P.kwargs types.
        if (isParamSpec(type) && type.paramSpecAccess) {
            return [];
        }

        return [TypeBase.isInstantiable(type) ? TypeVarType.cloneAsInstance(type) : type];
    }

    if (isClass(type)) {
        return getTypeVarsFromClass(type);
    }

    if (isUnion(type)) {
        const combinedList: TypeVarType[] = [];
        doForEachSubtype(type, (subtype) => {
            addTypeVarsToListIfUnique(combinedList, getTypeVarArgumentsRecursive(subtype, recursionCount));
        });
        return combinedList;
    }

    if (isFunction(type)) {
        const combinedList: TypeVarType[] = [];

        for (let i = 0; i < type.details.parameters.length; i++) {
            addTypeVarsToListIfUnique(
                combinedList,
                getTypeVarArgumentsRecursive(FunctionType.getEffectiveParameterType(type, i), recursionCount)
            );
        }

        if (type.details.paramSpec) {
            addTypeVarsToListIfUnique(combinedList, [type.details.paramSpec]);
        }

        const returnType = FunctionType.getSpecializedReturnType(type);
        if (returnType) {
            addTypeVarsToListIfUnique(combinedList, getTypeVarArgumentsRecursive(returnType, recursionCount));
        }

        return combinedList;
    }

    return [];
}

// Creates a specialized version of the class, filling in any unspecified
// type arguments with Unknown.
export function specializeClassType(type: ClassType): ClassType {
    const typeVarContext = new TypeVarContext(getTypeVarScopeId(type));
    const typeParams = ClassType.getTypeParameters(type);

    typeParams.forEach((typeParam) => {
        typeVarContext.setTypeVarType(typeParam, UnknownType.create());
    });

    return applySolvedTypeVars(type, typeVarContext) as ClassType;
}

// Recursively finds all of the type arguments and sets them
// to the specified srcType.
export function setTypeArgumentsRecursive(
    destType: Type,
    srcType: Type,
    typeVarContext: TypeVarContext,
    recursionCount = 0
) {
    if (recursionCount > maxTypeRecursionCount) {
        return;
    }
    recursionCount++;

    if (typeVarContext.isLocked()) {
        return;
    }

    switch (destType.category) {
        case TypeCategory.Union:
            doForEachSubtype(destType, (subtype) => {
                setTypeArgumentsRecursive(subtype, srcType, typeVarContext, recursionCount);
            });
            break;

        case TypeCategory.Class:
            if (destType.typeArguments) {
                destType.typeArguments.forEach((typeArg) => {
                    setTypeArgumentsRecursive(typeArg, srcType, typeVarContext, recursionCount);
                });
            }
            if (destType.tupleTypeArguments) {
                destType.tupleTypeArguments.forEach((typeArg) => {
                    setTypeArgumentsRecursive(typeArg.type, srcType, typeVarContext, recursionCount);
                });
            }
            break;

        case TypeCategory.Function:
            if (destType.specializedTypes) {
                destType.specializedTypes.parameterTypes.forEach((paramType) => {
                    setTypeArgumentsRecursive(paramType, srcType, typeVarContext, recursionCount);
                });
                if (destType.specializedTypes.returnType) {
                    setTypeArgumentsRecursive(
                        destType.specializedTypes.returnType,
                        srcType,
                        typeVarContext,
                        recursionCount
                    );
                }
            } else {
                destType.details.parameters.forEach((param) => {
                    setTypeArgumentsRecursive(param.type, srcType, typeVarContext, recursionCount);
                });
                if (destType.details.declaredReturnType) {
                    setTypeArgumentsRecursive(
                        destType.details.declaredReturnType,
                        srcType,
                        typeVarContext,
                        recursionCount
                    );
                }

                if (destType.details.paramSpec) {
                    // Fill in an empty signature for a ParamSpec if the source is Any or Unknown.
                    if (!typeVarContext.hasTypeVar(destType.details.paramSpec) && isAnyOrUnknown(srcType)) {
                        typeVarContext.setParamSpec(destType.details.paramSpec, {
                            flags: FunctionTypeFlags.None,
                            parameters: FunctionType.getDefaultParameters(),
                            typeVarScopeId: undefined,
                            docString: undefined,
                            paramSpec: undefined,
                        });
                    }
                }
            }
            break;

        case TypeCategory.OverloadedFunction:
            destType.overloads.forEach((subtype) => {
                setTypeArgumentsRecursive(subtype, srcType, typeVarContext, recursionCount);
            });
            break;

        case TypeCategory.TypeVar:
            if (!typeVarContext.hasTypeVar(destType)) {
                typeVarContext.setTypeVarType(destType, srcType);
            }
            break;
    }
}

// Builds a mapping between type parameters and their specialized
// types. For example, if the generic type is Dict[_T1, _T2] and the
// specialized type is Dict[str, int], it returns a map that associates
// _T1 with str and _T2 with int.
export function buildTypeVarContextFromSpecializedClass(classType: ClassType, makeConcrete = true): TypeVarContext {
    const typeParameters = ClassType.getTypeParameters(classType);
    let typeArguments = classType.typeArguments;

    // If there are no type arguments, we can either use the type variables
    // from the type parameters (keeping the type arguments generic) or
    // fill in concrete types.
    if (!typeArguments && !makeConcrete) {
        typeArguments = typeParameters;
    }

    const typeVarContext = buildTypeVarContext(typeParameters, typeArguments, getTypeVarScopeId(classType));
    if (ClassType.isTupleClass(classType) && classType.tupleTypeArguments && typeParameters.length >= 1) {
        typeVarContext.setVariadicTypeVar(typeParameters[0], classType.tupleTypeArguments);
    }

    return typeVarContext;
}

export function buildTypeVarContext(
    typeParameters: TypeVarType[],
    typeArgs: Type[] | undefined,
    typeVarScopeId: TypeVarScopeId | undefined
): TypeVarContext {
    const typeVarContext = new TypeVarContext(typeVarScopeId);
    typeParameters.forEach((typeParam, index) => {
        let typeArgType: Type;

        if (typeArgs) {
            if (isParamSpec(typeParam)) {
                if (index < typeArgs.length) {
                    typeArgType = typeArgs[index];
                    if (isFunction(typeArgType) && FunctionType.isParamSpecValue(typeArgType)) {
                        const paramSpecEntries: ParamSpecEntry[] = [];
                        const typeArgFunctionType = typeArgType;
                        typeArgType.details.parameters.forEach((param, paramIndex) => {
                            paramSpecEntries.push({
                                category: param.category,
                                name: param.name,
                                hasDefault: !!param.hasDefault,
                                isNameSynthesized: param.isNameSynthesized,
                                type: FunctionType.getEffectiveParameterType(typeArgFunctionType, paramIndex),
                            });
                        });
                        typeVarContext.setParamSpec(typeParam, {
                            parameters: paramSpecEntries,
                            typeVarScopeId: typeArgType.details.typeVarScopeId,
                            flags: typeArgType.details.flags,
                            docString: typeArgType.details.docString,
                            paramSpec: typeArgType.details.paramSpec,
                        });
                    } else if (isParamSpec(typeArgType)) {
                        typeVarContext.setParamSpec(typeParam, {
                            flags: FunctionTypeFlags.None,
                            parameters: [],
                            typeVarScopeId: undefined,
                            docString: undefined,
                            paramSpec: typeArgType,
                        });
                    } else if (isAnyOrUnknown(typeArgType)) {
                        // Fill in an empty signature if the arg type is Any or Unknown.
                        typeVarContext.setParamSpec(typeParam, {
                            flags: FunctionTypeFlags.SkipArgsKwargsCompatibilityCheck,
                            parameters: FunctionType.getDefaultParameters(),
                            typeVarScopeId: undefined,
                            docString: undefined,
                            paramSpec: undefined,
                        });
                    }
                }
            } else {
                if (index >= typeArgs.length) {
                    typeArgType = AnyType.create();
                } else {
                    typeArgType = typeArgs[index];
                }

                typeVarContext.setTypeVarType(typeParam, typeArgType, typeArgType, /* retainLiteral */ true);
            }
        }
    });

    return typeVarContext;
}

// Determines the specialized base class type that srcType derives from.
export function specializeForBaseClass(srcType: ClassType, baseClass: ClassType): ClassType {
    const typeParams = ClassType.getTypeParameters(baseClass);

    // If there are no type parameters for the specified base class,
    // no specialization is required.
    if (typeParams.length === 0) {
        return baseClass;
    }

    const typeVarContext = buildTypeVarContextFromSpecializedClass(srcType);
    const specializedType = applySolvedTypeVars(baseClass, typeVarContext);
    assert(isInstantiableClass(specializedType));
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
        if (isInstantiableClass(baseClass)) {
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

export function synthesizeTypeVarForSelfCls(classType: ClassType, isClsParam: boolean): TypeVarType {
    const selfType = TypeVarType.createInstance(`__type_of_self__`);
    const scopeId = getTypeVarScopeId(classType) ?? '';
    selfType.details.isSynthesized = true;
    selfType.details.isSynthesizedSelf = true;
    selfType.nameWithScope = TypeVarType.makeNameWithScope(selfType.details.name, scopeId);
    selfType.scopeId = scopeId;

    const boundType = ClassType.cloneForSpecialization(
        classType,
        ClassType.getTypeParameters(classType),
        /* isTypeArgumentExplicit */ false,
        /* includeSubclasses */ true
    );

    selfType.details.boundType = ClassType.cloneAsInstance(boundType);

    return isClsParam ? TypeVarType.cloneAsInstantiable(selfType) : selfType;
}

// Returns the declared "return" type (the type returned from a return statement)
// if it was declared, or undefined otherwise.
export function getDeclaredGeneratorReturnType(functionType: FunctionType): Type | undefined {
    const returnType = FunctionType.getSpecializedReturnType(functionType);
    if (returnType) {
        const generatorTypeArgs = getGeneratorTypeArgs(returnType);

        if (generatorTypeArgs) {
            // The send type is the third type arg.
            return generatorTypeArgs.length >= 3 ? generatorTypeArgs[2] : UnknownType.create();
        }
    }

    return undefined;
}

// If the declared return type is a Generator, Iterable, Iterator or the async
// counterparts, returns the yield type. If the type is invalid for a generator,
// returns undefined.
export function getGeneratorYieldType(declaredReturnType: Type, isAsync: boolean): Type | undefined {
    let isLegalGeneratorType = true;

    const yieldType = mapSubtypes(declaredReturnType, (subtype) => {
        if (isAnyOrUnknown(subtype)) {
            return subtype;
        }

        if (isClassInstance(subtype)) {
            const expectedClasses = [
                ['AsyncIterable', 'Iterable'],
                ['AsyncIterator', 'Iterator'],
                ['AsyncGenerator', 'Generator'],
                ['', 'AwaitableGenerator'],
            ];

            if (expectedClasses.some((classes) => ClassType.isBuiltIn(subtype, isAsync ? classes[0] : classes[1]))) {
                return subtype.typeArguments && subtype.typeArguments.length >= 1
                    ? subtype.typeArguments[0]
                    : UnknownType.create();
            }
        }

        isLegalGeneratorType = false;
        return undefined;
    });

    return isLegalGeneratorType ? yieldType : undefined;
}

export function isEffectivelyInstantiable(type: Type): boolean {
    if (TypeBase.isInstantiable(type)) {
        return true;
    }

    // Handle the special case of 'type', which is instantiable.
    if (isClassInstance(type) && ClassType.isBuiltIn(type, 'type')) {
        return true;
    }

    if (isUnion(type)) {
        return type.subtypes.every((subtype) => isEffectivelyInstantiable(subtype));
    }

    return false;
}

export function convertToInstance(type: Type, includeSubclasses = true): Type {
    let result = mapSubtypes(type, (subtype) => {
        switch (subtype.category) {
            case TypeCategory.Class: {
                // Handle Type[x] as a special case.
                if (ClassType.isBuiltIn(subtype, 'Type')) {
                    if (!subtype.typeArguments || subtype.typeArguments.length < 1) {
                        return UnknownType.create();
                    } else {
                        return convertToInstantiable(subtype.typeArguments[0]);
                    }
                }

                return ClassType.cloneAsInstance(subtype, includeSubclasses);
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
            case TypeCategory.Class: {
                return ClassType.cloneAsInstantiable(subtype);
            }

            case TypeCategory.None: {
                return NoneType.createType();
            }

            case TypeCategory.Function: {
                return FunctionType.cloneAsInstantiable(subtype);
            }

            case TypeCategory.TypeVar: {
                return TypeVarType.cloneAsInstantiable(subtype);
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
    classType.details.mro.forEach((mroClass) => {
        if (isInstantiableClass(mroClass)) {
            // Add any new member variables from this class.
            const isClassTypedDict = ClassType.isTypedDictClass(mroClass);
            mroClass.details.fields.forEach((symbol, name) => {
                if (symbol.isClassMember() || (includeInstanceVars && symbol.isInstanceMember())) {
                    if (!isClassTypedDict || !isTypedDictMemberAccessedThroughIndex(symbol)) {
                        if (!symbol.isInitVar()) {
                            const existingSymbol = symbolTable.get(name);

                            if (!existingSymbol) {
                                symbolTable.set(name, symbol);
                            } else if (!existingSymbol.hasTypedDeclarations() && symbol.hasTypedDeclarations()) {
                                // If the existing symbol is unannotated but a parent class
                                // has an annotation for the symbol, use the parent type instead.
                                symbolTable.set(name, symbol);
                            }
                        }
                    }
                }
            });
        }
    });

    // Add members of the metaclass as well.
    if (!includeInstanceVars) {
        const metaclass = classType.details.effectiveMetaclass;
        if (metaclass && isInstantiableClass(metaclass)) {
            for (const mroClass of metaclass.details.mro) {
                if (isInstantiableClass(mroClass)) {
                    mroClass.details.fields.forEach((symbol, name) => {
                        const existingSymbol = symbolTable.get(name);

                        if (!existingSymbol) {
                            symbolTable.set(name, symbol);
                        } else if (!existingSymbol.hasTypedDeclarations() && symbol.hasTypedDeclarations()) {
                            // If the existing symbol is unannotated but a parent class
                            // has an annotation for the symbol, use the parent type instead.
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
    recursionCount++;

    if (isUnknown(type)) {
        return true;
    }

    // If this is a generic type alias, see if any of its type arguments
    // are either unspecified or are partially known.
    if (type.typeAliasInfo?.typeArguments) {
        if (
            type.typeAliasInfo.typeArguments.some((typeArg) =>
                isPartlyUnknown(typeArg, allowUnknownTypeArgsForClasses, recursionCount)
            )
        ) {
            return true;
        }
    }

    // See if a union contains an unknown type.
    if (isUnion(type)) {
        return (
            findSubtype(type, (subtype) => isPartlyUnknown(subtype, allowUnknownTypeArgsForClasses, recursionCount)) !==
            undefined
        );
    }

    // See if an object or class has an unknown type argument.
    if (isClass(type)) {
        if (TypeBase.isInstance(type)) {
            allowUnknownTypeArgsForClasses = false;
        }

        if (!allowUnknownTypeArgsForClasses && !ClassType.isPseudoGenericClass(type)) {
            const typeArgs = type.tupleTypeArguments?.map((t) => t.type) || type.typeArguments;
            if (typeArgs) {
                for (const argType of typeArgs) {
                    if (isPartlyUnknown(argType, allowUnknownTypeArgsForClasses, recursionCount)) {
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
            return isPartlyUnknown(overload, false, recursionCount);
        });
    }

    if (isFunction(type)) {
        for (let i = 0; i < type.details.parameters.length; i++) {
            // Ignore parameters such as "*" that have no name.
            if (type.details.parameters[i].name) {
                const paramType = FunctionType.getEffectiveParameterType(type, i);
                if (isPartlyUnknown(paramType, /* allowUnknownTypeArgsForClasses */ false, recursionCount)) {
                    return true;
                }
            }
        }

        if (
            type.details.declaredReturnType &&
            !FunctionType.isParamSpecValue(type) &&
            isPartlyUnknown(type.details.declaredReturnType, /* allowUnknownTypeArgsForClasses */ false, recursionCount)
        ) {
            return true;
        }

        return false;
    }

    return false;
}

// If the specified type is a generic class with a single type argument
// that is a union, it "explodes" the class into a union of classes with
// each element of the union - e.g. Foo[A | B] becomes Foo[A] | Foo[B].
export function explodeGenericClass(classType: ClassType) {
    if (!classType.typeArguments || classType.typeArguments.length !== 1 || !isUnion(classType.typeArguments[0])) {
        return classType;
    }

    return combineTypes(
        classType.typeArguments[0].subtypes.map((subtype) => {
            return ClassType.cloneForSpecialization(classType, [subtype], /* isTypeArgumentExplicit */ true);
        })
    );
}

// If the type is a union of same-sized tuples, these are combined into
// a single tuple with that size. Otherwise, returns undefined.
export function combineSameSizedTuples(type: Type, tupleType: Type | undefined): Type {
    if (!tupleType || !isInstantiableClass(tupleType) || isUnboundedTupleClass(tupleType)) {
        return type;
    }

    let tupleEntries: Type[][] | undefined;
    let isValid = true;

    doForEachSubtype(type, (subtype) => {
        if (isClassInstance(subtype)) {
            let tupleClass: ClassType | undefined;
            if (isClass(subtype) && isTupleClass(subtype) && !isUnboundedTupleClass(subtype)) {
                tupleClass = subtype;
            }

            if (!tupleClass) {
                // Look in the mro list to see if this subtype derives from a
                // tuple with a known size. This includes named tuples.
                tupleClass = subtype.details.mro.find(
                    (mroClass) => isClass(mroClass) && isTupleClass(mroClass) && !isUnboundedTupleClass(mroClass)
                ) as ClassType | undefined;
            }

            if (tupleClass && isClass(tupleClass) && tupleClass.tupleTypeArguments) {
                if (tupleEntries) {
                    if (tupleEntries.length === tupleClass.tupleTypeArguments.length) {
                        tupleClass.tupleTypeArguments.forEach((entry, index) => {
                            tupleEntries![index].push(entry.type);
                        });
                    } else {
                        isValid = false;
                    }
                } else {
                    tupleEntries = tupleClass.tupleTypeArguments.map((entry) => [entry.type]);
                }
            } else {
                isValid = false;
            }
        } else {
            isValid = false;
        }
    });

    if (!isValid || !tupleEntries) {
        return type;
    }

    return convertToInstance(
        specializeTupleClass(
            tupleType,
            tupleEntries.map((entry) => {
                return { type: combineTypes(entry), isUnbounded: false };
            })
        )
    );
}

// Tuples require special handling for specialization. This method computes
// the "effective" type argument, which is a union of the variadic type
// arguments.
export function specializeTupleClass(
    classType: ClassType,
    typeArgs: TupleTypeArgument[],
    isTypeArgumentExplicit = true,
    isUnpackedTuple = false
): ClassType {
    let combinedTupleType = combineTypes(typeArgs.map((t) => t.type));

    // An empty tuple has an effective type of Any.
    if (isNever(combinedTupleType)) {
        combinedTupleType = AnyType.create();
    }

    const clonedClassType = ClassType.cloneForSpecialization(
        classType,
        [combinedTupleType],
        isTypeArgumentExplicit,
        /* includeSubclasses */ undefined,
        typeArgs
    );

    if (isUnpackedTuple) {
        clonedClassType.isUnpacked = true;
    }

    return clonedClassType;
}

// If the type is a function or overloaded function that has a paramSpec
// associated with it and P.args and P.kwargs at the end of the signature,
// it removes these parameters from the function.
export function removeParamSpecVariadicsFromSignature(type: FunctionType | OverloadedFunctionType) {
    if (isFunction(type)) {
        return removeParamSpecVariadicsFromFunction(type);
    }

    const newOverloads: FunctionType[] = [];
    let newTypeNeeded = false;

    for (const overload of type.overloads) {
        const newOverload = removeParamSpecVariadicsFromFunction(overload);
        newOverloads.push(newOverload);
        if (newOverload !== overload) {
            newTypeNeeded = true;
        }
    }

    return newTypeNeeded ? OverloadedFunctionType.create(newOverloads) : type;
}

export function removeParamSpecVariadicsFromFunction(type: FunctionType): FunctionType {
    const paramCount = type.details.parameters.length;
    if (paramCount < 2) {
        return type;
    }

    const argsParam = type.details.parameters[paramCount - 2];
    const kwargsParam = type.details.parameters[paramCount - 1];

    if (
        argsParam.category !== ParameterCategory.VarArgList ||
        kwargsParam.category !== ParameterCategory.VarArgDictionary ||
        !isParamSpec(argsParam.type) ||
        !isParamSpec(kwargsParam.type) ||
        !isTypeSame(argsParam.type, kwargsParam.type)
    ) {
        return type;
    }

    return FunctionType.cloneRemoveParamSpecVariadics(type, argsParam.type);
}

function _expandVariadicUnpackedUnion(type: Type) {
    if (isClassInstance(type) && isTupleClass(type) && type.tupleTypeArguments && type.isUnpacked) {
        return combineTypes(type.tupleTypeArguments.map((t) => t.type));
    }

    return type;
}

// If the declared return type for the function is a Generator or AsyncGenerator,
// returns the type arguments for the type.
export function getGeneratorTypeArgs(returnType: Type): Type[] | undefined {
    if (isClassInstance(returnType)) {
        if (ClassType.isBuiltIn(returnType, ['Generator', 'AsyncGenerator'])) {
            return returnType.typeArguments;
        } else if (ClassType.isBuiltIn(returnType, 'AwaitableGenerator')) {
            // AwaitableGenerator has four type arguments, and the last 3
            // correspond to the generator.
            return returnType.typeArguments?.slice(1);
        }
    }

    return undefined;
}

export function requiresTypeArguments(classType: ClassType) {
    if (classType.details.typeParameters.length > 0) {
        const firstTypeParam = classType.details.typeParameters[0];

        // If there are type parameters, type arguments are needed.
        // The exception is if type parameters have been synthesized
        // for classes that have untyped constructors.
        if (firstTypeParam.details.isSynthesized) {
            return false;
        }

        // If the first type parameter has a default type, then no
        // type arguments are needed.
        if (firstTypeParam.details.defaultType) {
            return false;
        }

        return true;
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
            'Literal',
            'Annotated',
            'TypeGuard',
            'StrictTypeGuard',
        ];

        if (specialClasses.some((t) => t === (classType.aliasName || classType.details.name))) {
            return true;
        }
    }

    return false;
}

export function requiresSpecialization(
    type: Type,
    ignorePseudoGeneric = false,
    ignoreSelf = false,
    recursionCount = 0
): boolean {
    if (recursionCount > maxTypeRecursionCount) {
        return false;
    }
    recursionCount++;

    switch (type.category) {
        case TypeCategory.Class: {
            if (ClassType.isPseudoGenericClass(type) && ignorePseudoGeneric) {
                return false;
            }

            if (type.typeArguments) {
                return (
                    type.typeArguments.find((typeArg) =>
                        requiresSpecialization(typeArg, ignorePseudoGeneric, ignoreSelf, recursionCount)
                    ) !== undefined
                );
            }

            return ClassType.getTypeParameters(type).length > 0;
        }

        case TypeCategory.Function: {
            if (type.details.paramSpec) {
                return true;
            }

            for (let i = 0; i < type.details.parameters.length; i++) {
                if (
                    requiresSpecialization(
                        FunctionType.getEffectiveParameterType(type, i),
                        ignorePseudoGeneric,
                        ignoreSelf,
                        recursionCount
                    )
                ) {
                    return true;
                }
            }

            const declaredReturnType =
                type.specializedTypes && type.specializedTypes.returnType
                    ? type.specializedTypes.returnType
                    : type.details.declaredReturnType;
            if (declaredReturnType) {
                if (requiresSpecialization(declaredReturnType, ignorePseudoGeneric, ignoreSelf, recursionCount)) {
                    return true;
                }
            } else if (type.inferredReturnType) {
                if (requiresSpecialization(type.inferredReturnType, ignorePseudoGeneric, ignoreSelf, recursionCount)) {
                    return true;
                }
            }

            return false;
        }

        case TypeCategory.OverloadedFunction: {
            return (
                type.overloads.find((overload) =>
                    requiresSpecialization(overload, ignorePseudoGeneric, ignoreSelf, recursionCount)
                ) !== undefined
            );
        }

        case TypeCategory.Union: {
            return (
                findSubtype(type, (subtype) =>
                    requiresSpecialization(subtype, ignorePseudoGeneric, ignoreSelf, recursionCount)
                ) !== undefined
            );
        }

        case TypeCategory.TypeVar: {
            // Most TypeVar types need to be specialized.
            if (!type.details.recursiveTypeAliasName) {
                if (type.details.isSynthesizedSelf && ignoreSelf) {
                    return false;
                }

                return true;
            }

            // If this is a recursive type alias, it may need to be specialized
            // if it has generic type arguments.
            if (type.typeAliasInfo?.typeArguments) {
                return type.typeAliasInfo.typeArguments.some((typeArg) =>
                    requiresSpecialization(typeArg, ignorePseudoGeneric, ignoreSelf, recursionCount)
                );
            }
        }
    }

    return false;
}

// Determines if the variance of the type argument for a generic class is compatible
// With the declared variance of the corresponding type parameter.
export function isVarianceOfTypeArgumentCompatible(type: Type, typeParamVariance: Variance): boolean {
    if (typeParamVariance === Variance.Unknown || typeParamVariance === Variance.Auto) {
        return true;
    }

    if (isTypeVar(type) && !type.details.isParamSpec && !type.details.isVariadic) {
        const typeArgVariance = type.details.declaredVariance;

        if (typeArgVariance === Variance.Contravariant || typeArgVariance === Variance.Covariant) {
            return typeArgVariance === typeParamVariance;
        }
    } else if (isClassInstance(type)) {
        if (type.details.typeParameters && type.details.typeParameters.length > 0) {
            return type.details.typeParameters.every((typeParam, index) => {
                let typeArgType: Type | undefined;

                if (typeParam.details.isParamSpec || typeParam.details.isVariadic) {
                    return true;
                }

                if (type.typeArguments && index < type.typeArguments.length) {
                    typeArgType = type.typeArguments[index];
                }

                const effectiveVariance =
                    typeParam.details.declaredVariance === Variance.Invariant ? Variance.Invariant : typeParamVariance;

                return isVarianceOfTypeArgumentCompatible(typeArgType ?? UnknownType.create(), effectiveVariance);
            });
        }
    }

    return true;
}

// Computes the method resolution ordering for a class whose base classes
// have already been filled in. The algorithm for computing MRO is described
// here: https://www.python.org/download/releases/2.3/mro/. It returns true
// if an MRO was possible, false otherwise.
export function computeMroLinearization(classType: ClassType): boolean {
    let isMroFound = true;

    // Clear out any existing MRO information.
    classType.details.mro = [];

    const filteredBaseClasses = classType.details.baseClasses.filter((baseClass, index) => {
        if (isInstantiableClass(baseClass)) {
            // Generic has some special-case logic (see description of __mro_entries__
            // in PEP 560) that we need to account for here.
            if (ClassType.isBuiltIn(baseClass, 'Generic')) {
                // If the class is a Protocol, the generic is ignored for the purposes
                // of computing the MRO.
                if (ClassType.isProtocolClass(classType)) {
                    return false;
                }

                // If the class contains any specialized generic classes after
                // the Generic base, the Generic base is ignored for purposes
                // of computing the MRO.
                if (
                    classType.details.baseClasses.some((innerBaseClass, innerIndex) => {
                        return (
                            innerIndex > index &&
                            isInstantiableClass(innerBaseClass) &&
                            innerBaseClass.typeArguments &&
                            innerBaseClass.isTypeArgumentExplicit
                        );
                    })
                ) {
                    return false;
                }
            }
        }

        return true;
    });

    // Construct the list of class lists that need to be merged.
    const classListsToMerge: Type[][] = [];

    filteredBaseClasses.forEach((baseClass) => {
        if (isInstantiableClass(baseClass)) {
            const typeVarContext = buildTypeVarContextFromSpecializedClass(baseClass, /* makeConcrete */ false);
            classListsToMerge.push(
                baseClass.details.mro.map((mroClass) => {
                    return applySolvedTypeVars(mroClass, typeVarContext);
                })
            );
        } else {
            classListsToMerge.push([baseClass]);
        }
    });

    classListsToMerge.push(
        filteredBaseClasses.map((baseClass) => {
            const typeVarContext = buildTypeVarContextFromSpecializedClass(classType, /* makeConcrete */ false);
            return applySolvedTypeVars(baseClass, typeVarContext);
        })
    );

    // The first class in the MRO is the class itself.
    const typeVarContext = buildTypeVarContextFromSpecializedClass(classType, /* makeConcrete */ false);
    classType.details.mro.push(applySolvedTypeVars(classType, typeVarContext));

    // Helper function that returns true if the specified searchClass
    // is found in the "tail" (i.e. in elements 1 through n) of any
    // of the class lists.
    const isInTail = (searchClass: ClassType, classLists: Type[][]) => {
        return classLists.some((classList) => {
            return (
                classList.findIndex(
                    (value) => isInstantiableClass(value) && ClassType.isSameGenericClass(value, searchClass)
                ) > 0
            );
        });
    };

    const filterClass = (classToFilter: ClassType, classLists: Type[][]) => {
        for (let i = 0; i < classLists.length; i++) {
            classLists[i] = classLists[i].filter(
                (value) => !isInstantiableClass(value) || !ClassType.isSameGenericClass(value, classToFilter)
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

                if (!isInstantiableClass(classList[0])) {
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
            if (!isInstantiableClass(nonEmptyList[0])) {
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
    recursionCount++;

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

        case TypeCategory.Function: {
            addIfUnique(type.details.moduleName);
            break;
        }

        case TypeCategory.OverloadedFunction: {
            type.overloads.forEach((overload) => {
                addDeclaringModuleNamesForType(overload, moduleList, recursionCount);
            });
            break;
        }

        case TypeCategory.Union: {
            doForEachSubtype(type, (subtype) => {
                addDeclaringModuleNamesForType(subtype, moduleList, recursionCount);
            });
            break;
        }

        case TypeCategory.Module: {
            addIfUnique(type.moduleName);
            break;
        }
    }
}

export function convertParamSpecValueToType(paramSpecEntry: ParamSpecValue, omitParamSpec = false): Type {
    let hasParameters = paramSpecEntry.parameters.length > 0;

    if (paramSpecEntry.parameters.length === 1) {
        // If the ParamSpec has a position-only separator as its only parameter,
        // treat it as though there are no parameters.
        const onlyParam = paramSpecEntry.parameters[0];
        if (onlyParam.category === ParameterCategory.Simple && !onlyParam.name) {
            hasParameters = false;
        }
    }

    if (hasParameters || !paramSpecEntry.paramSpec || omitParamSpec) {
        // Create a function type from the param spec entries.
        const functionType = FunctionType.createInstance(
            '',
            '',
            '',
            FunctionTypeFlags.ParamSpecValue | paramSpecEntry.flags
        );

        paramSpecEntry.parameters.forEach((entry) => {
            FunctionType.addParameter(functionType, {
                category: entry.category,
                name: entry.name,
                hasDefault: entry.hasDefault,
                isNameSynthesized: entry.isNameSynthesized,
                hasDeclaredType: true,
                type: entry.type,
            });
        });

        if (!omitParamSpec) {
            functionType.details.paramSpec = paramSpecEntry.paramSpec;
        }
        functionType.details.docString = paramSpecEntry.docString;

        return functionType;
    }

    return paramSpecEntry.paramSpec;
}

// Recursively walks a type and calls a callback for each TypeVar, allowing
// it to be replaced with something else.
class TypeVarTransformer {
    private _isTransformingTypeArg = false;
    private _pendingTypeVarTransformations = new Set<string>();

    apply(type: Type, recursionCount = 0): Type {
        if (recursionCount > maxTypeRecursionCount) {
            return type;
        }
        recursionCount++;

        type = this._transformGenericTypeAlias(type, recursionCount);

        // Shortcut the operation if possible.
        if (!requiresSpecialization(type)) {
            return type;
        }

        if (isAnyOrUnknown(type)) {
            return type;
        }

        if (isNoneInstance(type)) {
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
                    const replacementType = this.apply(typeArg, recursionCount);
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
            // same type variable recursively by setting it in the
            // _pendingTypeVarTransformations set.
            const typeVarName = TypeVarType.getNameWithScope(type);
            if (!this._pendingTypeVarTransformations.has(typeVarName)) {
                replacementType = this.transformTypeVar(type) ?? type;

                if (!this._isTransformingTypeArg) {
                    this._pendingTypeVarTransformations.add(typeVarName);
                    replacementType = this.apply(replacementType, recursionCount);
                    this._pendingTypeVarTransformations.delete(typeVarName);
                }

                // If we're transforming a variadic type variable that was in a union,
                // expand the union types.
                if (isVariadicTypeVar(type) && type.isVariadicInUnion) {
                    replacementType = _expandVariadicUnpackedUnion(replacementType);
                }
            }

            return replacementType;
        }

        if (isUnion(type)) {
            const newUnionType = mapSubtypes(type, (subtype) => {
                let transformedType: Type = this.apply(subtype, recursionCount);

                // If we're transforming a variadic type variable within a union,
                // combine the individual types within the variadic type variable.
                if (isVariadicTypeVar(subtype) && !isVariadicTypeVar(transformedType)) {
                    const subtypesToCombine: Type[] = [];
                    doForEachSubtype(transformedType, (transformedSubtype) => {
                        subtypesToCombine.push(_expandVariadicUnpackedUnion(transformedSubtype));
                    });

                    transformedType = combineTypes(subtypesToCombine);
                }

                if (this.transformUnionSubtype) {
                    return this.transformUnionSubtype(subtype, transformedType);
                }

                return transformedType;
            });

            return !isNever(newUnionType) ? newUnionType : UnknownType.create();
        }

        if (isClass(type)) {
            return this._transformTypeVarsInClassType(type, recursionCount);
        }

        if (isFunction(type)) {
            return this._transformTypeVarsInFunctionType(type, recursionCount);
        }

        if (isOverloadedFunction(type)) {
            let requiresUpdate = false;

            // Specialize each of the functions in the overload.
            const newOverloads: FunctionType[] = [];
            type.overloads.forEach((entry) => {
                const replacementType = this._transformTypeVarsInFunctionType(entry, recursionCount);
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

    transformTypeVar(typeVar: TypeVarType): Type | undefined {
        return typeVar;
    }

    transformVariadicTypeVar(paramSpec: TypeVarType): TupleTypeArgument[] | undefined {
        return undefined;
    }

    transformParamSpec(paramSpec: TypeVarType): ParamSpecValue | undefined {
        return undefined;
    }

    transformUnionSubtype(preTransform: Type, postTransform: Type): Type | undefined {
        return postTransform;
    }

    private _transformGenericTypeAlias(type: Type, recursionCount: number) {
        if (!type.typeAliasInfo || !type.typeAliasInfo.typeParameters || !type.typeAliasInfo.typeArguments) {
            return type;
        }

        let requiresUpdate = false;
        const newTypeArgs = type.typeAliasInfo.typeArguments.map((typeArg) => {
            const updatedType = this.apply(typeArg, recursionCount);
            if (type !== updatedType) {
                requiresUpdate = true;
            }
            return updatedType;
        });

        return requiresUpdate
            ? TypeBase.cloneForTypeAlias(
                  type,
                  type.typeAliasInfo.name,
                  type.typeAliasInfo.fullName,
                  type.typeAliasInfo.typeVarScopeId,
                  type.typeAliasInfo.typeParameters,
                  newTypeArgs
              )
            : type;
    }

    private _transformTypeVarsInClassType(classType: ClassType, recursionCount: number): ClassType {
        // Handle the common case where the class has no type parameters.
        if (ClassType.getTypeParameters(classType).length === 0 && !ClassType.isSpecialBuiltIn(classType)) {
            return classType;
        }

        let newTypeArgs: Type[] = [];
        let newVariadicTypeArgs: TupleTypeArgument[] | undefined;
        let specializationNeeded = false;
        const typeParams = ClassType.getTypeParameters(classType);

        const transformParamSpec = (paramSpec: TypeVarType) => {
            const paramSpecValue = this.transformParamSpec(paramSpec);
            if (paramSpecValue) {
                specializationNeeded = true;
                return convertParamSpecValueToType(paramSpecValue);
            } else {
                return paramSpec;
            }
        };

        const wasTransformingTypeArg = this._isTransformingTypeArg;
        this._isTransformingTypeArg = true;

        // If type args were previously provided, specialize them.
        if (classType.typeArguments) {
            newTypeArgs = classType.typeArguments.map((oldTypeArgType) => {
                if (isTypeVar(oldTypeArgType) && oldTypeArgType.details.isParamSpec) {
                    return transformParamSpec(oldTypeArgType);
                }

                let newTypeArgType = this.apply(oldTypeArgType, recursionCount);
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
                    if (!this._pendingTypeVarTransformations.has(typeParamName)) {
                        const transformedType = this.transformTypeVar(typeParam);
                        replacementType = transformedType ?? typeParam;

                        if (replacementType !== typeParam) {
                            specializationNeeded = true;
                        } else if (transformedType !== undefined && !classType.typeArguments) {
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
                    const newTypeArgType = this.apply(oldTypeArgType.type, recursionCount);

                    if (newTypeArgType !== oldTypeArgType.type) {
                        specializationNeeded = true;
                    }

                    if (
                        isVariadicTypeVar(oldTypeArgType.type) &&
                        isClassInstance(newTypeArgType) &&
                        isTupleClass(newTypeArgType) &&
                        newTypeArgType.tupleTypeArguments
                    ) {
                        appendArray(newVariadicTypeArgs!, newTypeArgType.tupleTypeArguments);
                    } else {
                        newVariadicTypeArgs!.push({ type: newTypeArgType, isUnbounded: oldTypeArgType.isUnbounded });
                    }
                });
            } else if (typeParams.length > 0) {
                newVariadicTypeArgs = this.transformVariadicTypeVar(typeParams[0]);
                if (newVariadicTypeArgs) {
                    specializationNeeded = true;
                }
            }
        }

        this._isTransformingTypeArg = wasTransformingTypeArg;

        // If specialization wasn't needed, don't allocate a new class.
        if (!specializationNeeded) {
            return classType;
        }

        return ClassType.cloneForSpecialization(
            classType,
            newTypeArgs,
            /* isTypeArgumentExplicit */ true,
            /* includeSubclasses */ undefined,
            newVariadicTypeArgs
        );
    }

    private _transformTypeVarsInFunctionType(sourceType: FunctionType, recursionCount: number): FunctionType {
        let functionType = sourceType;

        // Handle functions with a parameter specification in a special manner.
        if (functionType.details.paramSpec) {
            const paramSpec = this.transformParamSpec(functionType.details.paramSpec);
            if (paramSpec) {
                functionType = FunctionType.cloneForParamSpec(functionType, paramSpec);
            }
        }

        const declaredReturnType = FunctionType.getSpecializedReturnType(functionType);
        const specializedReturnType = declaredReturnType ? this.apply(declaredReturnType, recursionCount) : undefined;
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
                const paramSpecType = this.transformParamSpec(argsParamType);
                if (paramSpecType) {
                    if (
                        paramSpecType.parameters.length > 0 ||
                        paramSpecType.paramSpec === undefined ||
                        !isTypeSame(argsParamType, paramSpecType.paramSpec)
                    ) {
                        functionType = FunctionType.cloneForParamSpecApplication(functionType, paramSpecType);
                    }
                }
            }
        }

        let variadicParamIndex: number | undefined;
        let variadicTypesToUnpack: TupleTypeArgument[] | undefined;
        const specializedDefaultArgs: (Type | undefined)[] = [];

        const wasTransformingTypeArg = this._isTransformingTypeArg;
        this._isTransformingTypeArg = true;

        for (let i = 0; i < functionType.details.parameters.length; i++) {
            const paramType = FunctionType.getEffectiveParameterType(functionType, i);
            const specializedType = this.apply(paramType, recursionCount);
            specializedParameters.parameterTypes.push(specializedType);

            // Do we need to specialize the default argument type for this parameter?
            let defaultArgType = FunctionType.getEffectiveParameterDefaultArgType(functionType, i);
            if (defaultArgType) {
                const specializedArgType = this.apply(defaultArgType, recursionCount);
                if (specializedArgType !== defaultArgType) {
                    defaultArgType = specializedArgType;
                    typesRequiredSpecialization = true;
                }
            }
            specializedDefaultArgs.push(defaultArgType);

            if (
                variadicParamIndex === undefined &&
                isVariadicTypeVar(paramType) &&
                functionType.details.parameters[i].category === ParameterCategory.VarArgList
            ) {
                variadicParamIndex = i;

                if (isClassInstance(specializedType) && isTupleClass(specializedType) && specializedType.isUnpacked) {
                    variadicTypesToUnpack = specializedType.tupleTypeArguments;
                }
            }

            if (paramType !== specializedType) {
                typesRequiredSpecialization = true;
            }
        }

        let specializedInferredReturnType: Type | undefined;
        if (functionType.inferredReturnType) {
            specializedInferredReturnType = this.apply(functionType.inferredReturnType, recursionCount);
            if (specializedInferredReturnType !== functionType.inferredReturnType) {
                typesRequiredSpecialization = true;
            }
        }

        this._isTransformingTypeArg = wasTransformingTypeArg;

        if (!typesRequiredSpecialization) {
            return functionType;
        }

        if (specializedDefaultArgs.some((t) => t !== undefined)) {
            specializedParameters.parameterDefaultArgs = specializedDefaultArgs;
        }

        // If there was no unpacked variadic type variable, we're done.
        if (!variadicTypesToUnpack) {
            return FunctionType.cloneForSpecialization(
                functionType,
                specializedParameters,
                specializedInferredReturnType
            );
        }

        // Unpack the tuple and synthesize a new function in the process.
        const newFunctionType = FunctionType.createSynthesizedInstance('', functionType.details.flags);
        let insertKeywordOnlySeparator = false;
        let swallowPositionOnlySeparator = false;

        specializedParameters.parameterTypes.forEach((paramType, index) => {
            if (index === variadicParamIndex) {
                let sawUnboundedEntry = false;

                // Unpack the tuple into individual parameters.
                variadicTypesToUnpack!.forEach((unpackedType) => {
                    FunctionType.addParameter(newFunctionType, {
                        category: unpackedType.isUnbounded ? ParameterCategory.VarArgList : ParameterCategory.Simple,
                        name: `__p${newFunctionType.details.parameters.length}`,
                        isNameSynthesized: true,
                        type: unpackedType.type,
                        hasDeclaredType: true,
                    });

                    if (unpackedType.isUnbounded) {
                        sawUnboundedEntry = true;
                    }
                });

                if (sawUnboundedEntry) {
                    swallowPositionOnlySeparator = true;
                } else {
                    insertKeywordOnlySeparator = true;
                }
            } else {
                const param = { ...functionType.details.parameters[index] };

                if (param.category === ParameterCategory.VarArgList && !param.name) {
                    insertKeywordOnlySeparator = false;
                } else if (param.category === ParameterCategory.VarArgDictionary) {
                    insertKeywordOnlySeparator = false;
                }

                // Insert a keyword-only separator parameter if we previously
                // unpacked a variadic TypeVar.
                if (param.category === ParameterCategory.Simple && param.name && insertKeywordOnlySeparator) {
                    FunctionType.addParameter(newFunctionType, {
                        category: ParameterCategory.VarArgList,
                        type: UnknownType.create(),
                    });
                    insertKeywordOnlySeparator = false;
                }

                param.type = paramType;
                if (param.name && param.isNameSynthesized) {
                    param.name = `__p${newFunctionType.details.parameters.length}`;
                }

                if (param.category !== ParameterCategory.Simple || param.name || !swallowPositionOnlySeparator) {
                    FunctionType.addParameter(newFunctionType, param);
                }
            }
        });

        newFunctionType.details.declaredReturnType = specializedParameters.returnType;

        return newFunctionType;
    }
}

// Specializes a (potentially generic) type by substituting
// type variables from a type var map.
class ApplySolvedTypeVarsTransformer extends TypeVarTransformer {
    constructor(
        private _typeVarContext: TypeVarContext,
        private _unknownIfNotFound = false,
        private _useNarrowBoundOnly = false,
        private _eliminateUnsolvedInUnions = false,
        private _typeClassType?: Type
    ) {
        super();
    }

    override transformTypeVar(typeVar: TypeVarType) {
        // If the type variable is unrelated to the scopes we're solving,
        // don't transform that type variable.
        if (typeVar.scopeId && this._typeVarContext.hasSolveForScope(typeVar.scopeId)) {
            let replacement = this._typeVarContext.getTypeVarType(typeVar, this._useNarrowBoundOnly);

            // If there was no narrow bound but there is a wide bound that
            // contains literals, we'll use the wide bound even if "useNarrowBoundOnly"
            // is specified.
            if (!replacement && this._useNarrowBoundOnly) {
                const wideType = this._typeVarContext.getTypeVarType(typeVar);
                if (wideType) {
                    if (containsLiteralType(wideType, /* includeTypeArgs */ true)) {
                        replacement = wideType;
                    }
                }
            }

            if (replacement) {
                if (TypeBase.isInstantiable(typeVar)) {
                    if (
                        isAnyOrUnknown(replacement) &&
                        this._typeClassType &&
                        isInstantiableClass(this._typeClassType)
                    ) {
                        replacement = ClassType.cloneForSpecialization(
                            ClassType.cloneAsInstance(this._typeClassType),
                            [replacement],
                            /* isTypeArgumentExplicit */ true
                        );
                    } else {
                        replacement = convertToInstantiable(replacement);
                    }
                }
                return replacement;
            }

            // If this typeVar is in scope for what we're solving but the type
            // var map doesn't contain any entry for it, replace with the
            // default or Unknown.
            if (this._unknownIfNotFound && !this._typeVarContext.hasSolveForScope(WildcardTypeVarScopeId)) {
                if (typeVar.details.defaultType) {
                    return typeVar.details.defaultType;
                }

                return UnknownType.create();
            }
        }

        return undefined;
    }

    override transformUnionSubtype(preTransform: Type, postTransform: Type): Type | undefined {
        // If a union contains unsolved TypeVars within scope, eliminate them
        // unless this results in an empty union. This elimination is needed
        // in cases where TypeVars can go unsolved due to unions in parameter
        // annotations, like this:
        //   def test(x: Union[str, T]) -> Union[str, T]
        if (this._eliminateUnsolvedInUnions) {
            if (
                isTypeVar(preTransform) &&
                preTransform.scopeId !== undefined &&
                this._typeVarContext.hasSolveForScope(preTransform.scopeId)
            ) {
                // If the TypeVar was not transformed, then it was unsolved,
                // and we'll eliminate it.
                if (preTransform === postTransform) {
                    return undefined;
                }

                // If _unknownIfNotFound is true, the postTransform type will
                // be Unknown, which we want to eliminate.
                if (isUnknown(postTransform) && this._unknownIfNotFound) {
                    return undefined;
                }
            }
        }

        return postTransform;
    }

    override transformVariadicTypeVar(typeVar: TypeVarType): TupleTypeArgument[] | undefined {
        if (!typeVar.scopeId || !this._typeVarContext.hasSolveForScope(typeVar.scopeId)) {
            if (
                typeVar.details.defaultType &&
                isClassInstance(typeVar.details.defaultType) &&
                typeVar.details.defaultType.tupleTypeArguments
            ) {
                return typeVar.details.defaultType.tupleTypeArguments;
            }

            return undefined;
        }

        return this._typeVarContext.getVariadicTypeVar(typeVar);
    }

    override transformParamSpec(paramSpec: TypeVarType) {
        if (!paramSpec.scopeId || !this._typeVarContext.hasSolveForScope(paramSpec.scopeId)) {
            return undefined;
        }

        const transformedParamSpec = this._typeVarContext.getParamSpec(paramSpec);
        if (transformedParamSpec) {
            return transformedParamSpec;
        }

        if (this._unknownIfNotFound && !this._typeVarContext.hasSolveForScope(WildcardTypeVarScopeId)) {
            // Use the default value if there is one.
            if (paramSpec.details.defaultType && isFunction(paramSpec.details.defaultType)) {
                const funcType = paramSpec.details.defaultType;

                return {
                    flags: funcType.details.flags,
                    parameters: funcType.details.parameters,
                    typeVarScopeId: funcType.details.typeVarScopeId,
                    docString: funcType.details.docString,
                    paramSpec: funcType.details.paramSpec,
                };
            }

            // Convert to the ParamSpec equivalent of "Unknown".
            const paramSpecValue: ParamSpecValue = {
                flags: FunctionTypeFlags.SkipArgsKwargsCompatibilityCheck,
                parameters: FunctionType.getDefaultParameters(/* useUnknown */ true),
                typeVarScopeId: undefined,
                docString: undefined,
                paramSpec: undefined,
            };

            return paramSpecValue;
        }

        return undefined;
    }
}

class ExpectedConstructorTypeTransformer extends TypeVarTransformer {
    constructor(private _liveTypeVarScopes: TypeVarScopeId[]) {
        super();
    }

    private _isTypeVarLive(typeVar: TypeVarType) {
        return this._liveTypeVarScopes.some((scopeId) => typeVar.scopeId === scopeId);
    }

    override transformTypeVar(typeVar: TypeVarType) {
        // If the type variable is unrelated to the scopes we're solving,
        // don't transform that type variable.
        if (this._isTypeVarLive(typeVar)) {
            return typeVar;
        }

        return AnyType.create();
    }
}
