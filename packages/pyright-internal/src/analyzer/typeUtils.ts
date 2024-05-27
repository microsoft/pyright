/*
 * typeUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Functions that operate on Type objects.
 */

import { appendArray } from '../common/collectionUtils';
import { assert } from '../common/debug';
import { ParameterCategory } from '../parser/parseNodes';
import { DeclarationType } from './declaration';
import { Symbol, SymbolFlags, SymbolTable } from './symbol';
import { isEffectivelyClassVar, isTypedDictMemberAccessedThroughIndex } from './symbolUtils';
import {
    AnyType,
    ClassType,
    ClassTypeFlags,
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
    isKeywordOnlySeparator,
    isNever,
    isOverloadedFunction,
    isParamSpec,
    isPositionOnlySeparator,
    isTypeSame,
    isTypeVar,
    isUnbound,
    isUnion,
    isUnknown,
    isUnpackedVariadicTypeVar,
    isVariadicTypeVar,
    maxTypeRecursionCount,
    ModuleType,
    NeverType,
    OverloadedFunctionType,
    PropertyMethodInfo,
    removeFromUnion,
    SignatureWithOffsets,
    SpecializedFunctionTypes,
    TupleTypeArgument,
    Type,
    TypeBase,
    TypeCategory,
    TypeCondition,
    TypeFlags,
    TypeSameOptions,
    TypeVarScopeId,
    TypeVarScopeType,
    TypeVarType,
    UnboundType,
    UnionType,
    UnknownType,
    Variance,
} from './types';
import { TypeVarContext, TypeVarSignatureContext } from './typeVarContext';
import { TypeWalker } from './typeWalker';

export interface ClassMember {
    // Symbol
    symbol: Symbol;

    // Partially-specialized class that contains the class member
    classType: ClassType | UnknownType | AnyType;

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

export const enum MemberAccessFlags {
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

    // By default, both class and instance variables are searched.
    // If this flag is set, the instance variables are skipped.
    SkipInstanceMembers = 1 << 4,

    // By default, both class and instance variables are searched.
    // If this flag is set, the class variables are skipped.
    SkipClassMembers = 1 << 5,

    // By default, the first symbol is returned even if it has only
    // an inferred type associated with it. If this flag is set,
    // the search looks only for symbols with declared types.
    DeclaredTypesOnly = 1 << 6,

    // Consider writes to symbols flagged as ClassVars as an error.
    DisallowClassVarWrites = 1 << 7,

    // Normally __new__ is treated as a static method, but when
    // it is invoked implicitly through a constructor call, it
    // acts like a class method instead.
    TreatConstructorAsClassMethod = 1 << 8,

    // If an attribute cannot be found when looking for instance
    // members, normally an attribute access override method
    // (__getattr__, etc.) may provide the missing attribute type.
    // This disables this check.
    SkipAttributeAccessOverride = 1 << 9,

    // Report an error if a symbol is an instance variable whose
    // type is parameterized by a class TypeVar.
    DisallowGenericInstanceVariableAccess = 1 << 10,
}

export const enum ClassIteratorFlags {
    Default = 0,

    // By default, base classes are searched as well as the
    // original (derived) class. If this flag is set, no recursion
    // is performed.
    SkipBaseClasses = 1 << 0,

    // Skip the 'object' base class in particular.
    SkipObjectBaseClass = 1 << 1,

    // Skip the 'type' base class in particular.
    SkipTypeBaseClass = 1 << 2,
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

    // We're comparing type compatibility of two distinct recursive types.
    // This has the potential of recursing infinitely. This flag allows us
    // to detect the recursion after the first level of checking.
    SkipRecursiveTypeCheck = 1 << 2,

    // Normally type vars are treated as variables that need to
    // be "solved". If this flag is set, they are treated as types
    // that must match. It is used for overload consistency checking.
    SkipSolveTypeVars = 1 << 3,

    // If the dest is not Any but the src is Any, treat it
    // as incompatible. Also, treat all source TypeVars as their
    // concrete counterparts. This option is used for validating
    // whether overload signatures overlap.
    OverloadOverlapCheck = 1 << 4,

    // When used in conjunction with OverloadOverlapCheck, look
    // for partial overlaps. For example, `int | list` overlaps
    // partially with `int | str`.
    PartialOverloadOverlapCheck = 1 << 5,

    // For function types, skip the return type check.
    SkipFunctionReturnTypeCheck = 1 << 6,

    // Allow bool values to be assigned to TypeGuard[x] types.
    AllowBoolTypeGuard = 1 << 7,

    // In most cases, literals are stripped when assigning to a
    // type variable. This overrides the standard behavior.
    RetainLiteralsForTypeVar = 1 << 8,

    // When validating the type of a self or cls parameter, allow
    // a type mismatch. This is used in overload consistency validation
    // because overloads can provide explicit type annotations for self
    // or cls.
    SkipSelfClsTypeCheck = 1 << 9,

    // If an assignment is made to a TypeVar that is out of scope,
    // do not generate an error. This is used for populating the
    // typeVarContext when handling contravariant parameters in a callable.
    IgnoreTypeVarScope = 1 << 10,

    // We're initially populating the typeVarContext with an expected type,
    // so TypeVars should match the specified type exactly rather than
    // employing narrowing or widening, and don't strip literals.
    PopulatingExpectedType = 1 << 11,

    // Used with PopulatingExpectedType, this flag indicates that a TypeVar
    // constraint that is Unknown should be ignored.
    SkipPopulateUnknownExpectedType = 1 << 12,

    // Normally, when a class type is assigned to a TypeVar and that class
    // hasn't previously been specialized, it will be specialized with
    // default type arguments (typically "Unknown"). This flag skips
    // this step.
    AllowUnspecifiedTypeArguments = 1 << 13,

    // PEP 544 says that if the dest type is a type[Proto] class,
    // the source must be a "concrete" (non-protocol) class. This
    // flag skips this check.
    IgnoreProtocolAssignmentCheck = 1 << 14,

    // Normally all special form classes are incompatible with type[T],
    // but a few of them are allowed in the context of an isinstance
    // or issubclass call.
    AllowIsinstanceSpecialForms = 1 << 15,

    // When comparing two methods, skip the type check for the "self" or "cls"
    // parameters. This is used for variance inference and validation.
    IgnoreSelfClsParamCompatibility = 1 << 16,
}

export interface ApplyTypeVarOptions {
    unknownIfNotFound?: boolean;
    useUnknownOverDefault?: boolean;
    unknownExemptTypeVars?: TypeVarType[];
    useNarrowBoundOnly?: boolean;
    eliminateUnsolvedInUnions?: boolean;
    typeClassType?: Type;
    applyInScopePlaceholders?: boolean;
}

export interface InferenceContext {
    expectedType: Type;
    isTypeIncomplete?: boolean;
}

export interface RequiresSpecializationOptions {
    // Ignore pseudo-generic classes (those with PseudoGenericClass flag set)
    // when determining whether the type requires specialization?
    ignorePseudoGeneric?: boolean;

    // Ignore Self type?
    ignoreSelf?: boolean;

    // Ignore classes whose isTypeArgumentExplicit flag is false?
    ignoreImplicitTypeArgs?: boolean;
}

// Tracks whether a function signature has been seen before within
// an expression. For example, in the expression "foo(foo, foo)", the
// signature for "foo" will be seen three times at three different
// file offsets. If the signature is generic, we need to create unique
// type variables for each instance because they are independent of
// each other.
export class UniqueSignatureTracker {
    private _trackedSignatures: SignatureWithOffsets[];

    constructor() {
        this._trackedSignatures = [];
    }

    getTrackedSignatures() {
        return this._trackedSignatures;
    }

    addTrackedSignatures(signatures: SignatureWithOffsets[]) {
        signatures.forEach((s) => {
            s.expressionOffsets.forEach((offset) => {
                this.addSignature(s.type, offset);
            });
        });
    }

    findSignature(signature: FunctionType | OverloadedFunctionType): SignatureWithOffsets | undefined {
        // Use the associated overload type if this is a function associated with an overload.
        let effectiveSignature = signature;
        if (isFunction(signature) && signature.overloaded) {
            effectiveSignature = signature.overloaded;
        }

        return this._trackedSignatures.find((s) => {
            return isTypeSame(effectiveSignature, s.type);
        });
    }

    addSignature(signature: FunctionType | OverloadedFunctionType, offset: number) {
        // If this function is part of a broader overload, use the overload instead.
        const effectiveSignature = isFunction(signature) ? signature.overloaded ?? signature : signature;

        const existingSignature = this.findSignature(effectiveSignature);
        if (existingSignature) {
            if (!existingSignature.expressionOffsets.some((o) => o === offset)) {
                existingSignature.expressionOffsets.push(offset);
            }
        } else {
            this._trackedSignatures.push({ type: effectiveSignature, expressionOffsets: [offset] });
        }
    }
}

export function isOptionalType(type: Type): boolean {
    if (isUnion(type)) {
        return findSubtype(type, (subtype) => isNoneInstance(subtype)) !== undefined;
    }

    return false;
}

export function isNoneInstance(type: Type): boolean {
    return isClassInstance(type) && ClassType.isBuiltIn(type, 'NoneType');
}

export function isNoneTypeClass(type: Type): boolean {
    return isInstantiableClass(type) && ClassType.isBuiltIn(type, 'NoneType');
}

// If the type is a union, remove an "None" type from the union,
// returning only the known types.
export function removeNoneFromUnion(type: Type): Type {
    return removeFromUnion(type, (t: Type) => isNoneInstance(t));
}

export function isIncompleteUnknown(type: Type): boolean {
    return isUnknown(type) && type.isIncomplete;
}

// Similar to isTypeSame except that type1 is a TypeVar and type2
// can be either a TypeVar of the same type or a union that includes
// conditional types associated with that bound TypeVar.
export function isTypeVarSame(type1: TypeVarType, type2: Type) {
    if (isTypeSame(type1, type2)) {
        return true;
    }

    // If this isn't a bound TypeVar, return false.
    if (type1.details.isParamSpec || type1.details.isVariadic || !type1.details.boundType) {
        return false;
    }

    // If the second type isn't a union, return false.
    if (!isUnion(type2)) {
        return false;
    }

    let isCompatible = true;
    doForEachSubtype(type2, (subtype) => {
        if (!isCompatible) {
            return;
        }

        if (!isTypeSame(type1, subtype)) {
            const conditions = getTypeCondition(subtype);

            if (
                !conditions ||
                !conditions.some((condition) => condition.typeVar.nameWithScope === type1.nameWithScope)
            ) {
                isCompatible = false;
            }
        }
    });

    return isCompatible;
}

// The `deprecated` type has been defined as a function, an overloaded function,
// and a class in various versions of typeshed. This function checks for all of
// these variants to determine whether the type is the built-in `deprecated` type.
export function isBuiltInDeprecatedType(type: Type) {
    if (isFunction(type)) {
        return type.details.builtInName === 'deprecated';
    }

    if (isOverloadedFunction(type)) {
        return type.overloads.length > 0 && type.overloads[0].details.builtInName === 'deprecated';
    }

    if (isInstantiableClass(type)) {
        return ClassType.isBuiltIn(type, 'deprecated');
    }

    return false;
}

export function makeInferenceContext(expectedType: undefined, isTypeIncomplete?: boolean): undefined;
export function makeInferenceContext(expectedType: Type, isTypeIncomplete?: boolean): InferenceContext;
export function makeInferenceContext(expectedType?: Type, isTypeIncomplete?: boolean): InferenceContext | undefined;

export function makeInferenceContext(
    expectedType: Type | undefined,
    isTypeIncomplete?: boolean
): InferenceContext | undefined {
    if (!expectedType) {
        return undefined;
    }

    return { expectedType, isTypeIncomplete };
}

// Calls a callback for each subtype and combines the results
// into a final type. It performs no memory allocations if the
// transformed type is the same as the original.
export function mapSubtypes(type: Type, callback: (type: Type) => Type | undefined, sortSubtypes = false): Type {
    if (isUnion(type)) {
        const subtypes = sortSubtypes ? sortTypes(type.subtypes) : type.subtypes;

        for (let i = 0; i < subtypes.length; i++) {
            const subtype = subtypes[i];
            const transformedType = callback(subtype);

            // Avoid doing any memory allocations until a change is detected.
            if (subtype !== transformedType) {
                const typesToCombine: Type[] = subtypes.slice(0, i);

                // Create a helper lambda that accumulates transformed subtypes.
                const accumulateSubtype = (newSubtype: Type | undefined) => {
                    if (newSubtype) {
                        typesToCombine.push(addConditionToType(newSubtype, getTypeCondition(type)));
                    }
                };

                accumulateSubtype(transformedType);

                for (i++; i < subtypes.length; i++) {
                    accumulateSubtype(callback(subtypes[i]));
                }

                const newType = combineTypes(typesToCombine);

                // Do our best to retain type aliases.
                if (newType.category === TypeCategory.Union) {
                    UnionType.addTypeAliasSource(newType, type);
                }

                return newType;
            }
        }

        return type;
    }

    const transformedSubtype = callback(type);
    if (!transformedSubtype) {
        return NeverType.createNever();
    }
    return transformedSubtype;
}

// Iterates over each signature in a function or overload, allowing the
// caller to replace one or more signatures with new ones.
export function mapSignatures(
    type: FunctionType | OverloadedFunctionType,
    callback: (type: FunctionType, index: number) => FunctionType | undefined
): OverloadedFunctionType | FunctionType | undefined {
    if (isFunction(type)) {
        return callback(type, 0);
    }

    const newSignatures: FunctionType[] = [];
    let changeMade = false;

    OverloadedFunctionType.getOverloads(type).forEach((overload, index) => {
        const newOverload = callback(overload, index);
        if (newOverload !== overload) {
            changeMade = true;
        }

        if (newOverload) {
            newSignatures.push(newOverload);
        }
    });

    if (newSignatures.length === 0) {
        return undefined;
    }

    // Add the unmodified implementation if it's present.
    const implementation = OverloadedFunctionType.getImplementation(type);
    if (implementation) {
        newSignatures.push(implementation);
    }

    if (!changeMade) {
        return type;
    }

    if (newSignatures.length === 1) {
        return newSignatures[0];
    }

    return OverloadedFunctionType.create(newSignatures);
}

// The code flow engine uses a special form of the UnknownType (with the
// isIncomplete flag set) to distinguish between an unknown that was generated
// in a loop because it was temporarily incomplete versus an unknown that is
// permanently incomplete. Once an unknown appears within a loop, it is often
// propagated to other types during code flow analysis. We want to remove these
// incomplete unknowns if we find that they are union'ed with other types.
export function cleanIncompleteUnknown(type: Type, recursionCount = 0): Type {
    if (recursionCount >= maxTypeRecursionCount) {
        return type;
    }
    recursionCount++;

    const result = mapSubtypes(type, (subtype) => {
        // If it's an incomplete unknown, eliminate it.
        if (isUnknown(subtype) && subtype.isIncomplete) {
            return undefined;
        }

        if (isClass(subtype) && subtype.typeArguments) {
            let typeChanged = false;

            if (subtype.tupleTypeArguments) {
                const updatedTupleTypeArgs: TupleTypeArgument[] = subtype.tupleTypeArguments.map((tupleTypeArg) => {
                    const newTypeArg = cleanIncompleteUnknown(tupleTypeArg.type, recursionCount);
                    if (newTypeArg !== tupleTypeArg.type) {
                        typeChanged = true;
                    }
                    return {
                        type: newTypeArg,
                        isUnbounded: tupleTypeArg.isUnbounded,
                        isOptional: tupleTypeArg.isOptional,
                    };
                });

                if (typeChanged) {
                    return specializeTupleClass(
                        subtype,
                        updatedTupleTypeArgs,
                        !!subtype.isTypeArgumentExplicit,
                        !!subtype.isUnpacked
                    );
                }
            } else {
                const updatedTypeArgs = subtype.typeArguments.map((typeArg) => {
                    const newTypeArg = cleanIncompleteUnknown(typeArg, recursionCount);
                    if (newTypeArg !== typeArg) {
                        typeChanged = true;
                    }
                    return newTypeArg;
                });

                if (typeChanged) {
                    return ClassType.cloneForSpecialization(subtype, updatedTypeArgs, !!subtype.isTypeArgumentExplicit);
                }
            }
        }

        // TODO - this doesn't currently handle function types.

        return subtype;
    });

    // If we eliminated everything, don't return a Never.
    return isNever(result) ? type : result;
}

// Sorts types into a deterministic order.
export function sortTypes(types: Type[]): Type[] {
    return types.slice(0).sort((a, b) => {
        return compareTypes(a, b);
    });
}

function compareTypes(a: Type, b: Type, recursionCount = 0): number {
    if (recursionCount > maxTypeRecursionCount) {
        return 0;
    }
    recursionCount++;

    if (a.category !== b.category) {
        return b.category - a.category;
    }

    switch (a.category) {
        case TypeCategory.Unbound:
        case TypeCategory.Unknown:
        case TypeCategory.Any:
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

                const typeComparison = compareTypes(
                    FunctionType.getEffectiveParameterType(a, i),
                    FunctionType.getEffectiveParameterType(bFunc, i)
                );

                if (typeComparison !== 0) {
                    return typeComparison;
                }
            }

            const returnTypeComparison = compareTypes(
                FunctionType.getSpecializedReturnType(a) ?? UnknownType.create(),
                FunctionType.getSpecializedReturnType(bFunc) ?? UnknownType.create()
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

            // Always sort NoneType at the end.
            if (ClassType.isBuiltIn(a, 'NoneType')) {
                return 1;
            } else if (ClassType.isBuiltIn(bClass, 'NoneType')) {
                return -1;
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

            if (aName < bName) {
                return -1;
            } else if (aName > bName) {
                return 1;
            }

            // Sort by type argument count.
            const aTypeArgCount = a.typeArguments ? a.typeArguments.length : 0;
            const bTypeArgCount = bClass.typeArguments ? bClass.typeArguments.length : 0;

            if (aTypeArgCount < bTypeArgCount) {
                return -1;
            } else if (aTypeArgCount > bTypeArgCount) {
                return 1;
            }

            // Sort by type argument.
            for (let i = 0; i < aTypeArgCount; i++) {
                const typeComparison = compareTypes(a.typeArguments![i], bClass.typeArguments![i], recursionCount);
                if (typeComparison !== 0) {
                    return typeComparison;
                }
            }

            return 0;
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

export function someSubtypes(type: Type, callback: (type: Type) => boolean): boolean {
    if (isUnion(type)) {
        return type.subtypes.some((subtype) => {
            return callback(subtype);
        });
    } else {
        return callback(type);
    }
}

export function allSubtypes(type: Type, callback: (type: Type) => boolean): boolean {
    if (isUnion(type)) {
        return type.subtypes.every((subtype) => {
            callback(subtype);
        });
    } else {
        return callback(type);
    }
}

export function doForEachSignature(
    type: FunctionType | OverloadedFunctionType,
    callback: (type: FunctionType, index: number) => void
) {
    if (isFunction(type)) {
        callback(type, 0);
    } else {
        OverloadedFunctionType.getOverloads(type).forEach((overload, index) => {
            callback(overload, index);
        });
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

export function addConditionToType(
    type: Type,
    condition: TypeCondition[] | undefined,
    skipSelfCondition = false
): Type {
    if (!condition) {
        return type;
    }

    if (skipSelfCondition) {
        condition = condition.filter((c) => !c.typeVar.details.isSynthesizedSelf);
        if (condition.length === 0) {
            return type;
        }
    }

    switch (type.category) {
        case TypeCategory.Unbound:
        case TypeCategory.Unknown:
        case TypeCategory.Any:
        case TypeCategory.Never:
        case TypeCategory.Module:
        case TypeCategory.TypeVar:
            return type;

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

        case TypeCategory.Class:
        case TypeCategory.Function:
            return type.condition;
    }
}

// Indicates whether the specified type is a recursive type alias
// placeholder that has not yet been resolved.
export function isTypeAliasPlaceholder(type: Type): boolean {
    return isTypeVar(type) && TypeVarType.isTypeAliasPlaceholder(type);
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

        if (isUnion(type) && type.includesRecursiveTypeAlias) {
            let newType = mapSubtypes(type, (subtype) => transformPossibleRecursiveTypeAlias(subtype));

            if (newType !== type && type.typeAliasInfo) {
                // Copy the type alias information if present.
                newType = TypeBase.cloneForTypeAlias(
                    newType,
                    type.typeAliasInfo.name,
                    type.typeAliasInfo.fullName,
                    type.typeAliasInfo.moduleName,
                    type.typeAliasInfo.fileUri,
                    type.typeAliasInfo.typeVarScopeId,
                    type.typeAliasInfo.isPep695Syntax,
                    type.typeAliasInfo.typeParameters,
                    type.typeAliasInfo.typeArguments
                );
            }

            return newType;
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

// This is similar to getTypeVarScopeId except that it includes
// the secondary scope IDs for functions.
export function getTypeVarScopeIds(type: Type): TypeVarScopeId[] | undefined {
    const scopeIds: TypeVarScopeId[] = [];

    const scopeId = getTypeVarScopeId(type);
    if (scopeId) {
        scopeIds.push(scopeId);
    }

    if (isFunction(type)) {
        if (type.details.constructorTypeVarScopeId) {
            scopeIds.push(type.details.constructorTypeVarScopeId);
        }

        if (type.details.higherOrderTypeVarScopeIds) {
            scopeIds.push(...type.details.higherOrderTypeVarScopeIds);
        }
    }

    return scopeIds;
}

// If the class type is generic and does not already have type arguments
// specified, specialize it with default type arguments (Unknown or the
// default type if provided).
export function specializeWithDefaultTypeArgs(type: ClassType): ClassType {
    if (type.details.typeParameters.length === 0 || type.typeArguments) {
        return type;
    }

    return ClassType.cloneForSpecialization(
        type,
        type.details.typeParameters.map((param) => param.details.defaultType),
        /* isTypeArgumentExplicit */ false,
        /* includeSubclasses */ type.includeSubclasses
    );
}

// Specializes the class with "Unknown" type args (or the equivalent for ParamSpecs
// or TypeVarTuples).
export function specializeWithUnknownTypeArgs(type: ClassType): ClassType {
    if (type.details.typeParameters.length === 0) {
        return type;
    }

    if (isTupleClass(type)) {
        return ClassType.cloneIncludeSubclasses(
            specializeTupleClass(
                type,
                [{ type: UnknownType.create(), isUnbounded: true }],
                /* isTypeArgumentExplicit */ false
            ),
            !!type.includeSubclasses
        );
    }

    return ClassType.cloneForSpecialization(
        type,
        type.details.typeParameters.map((param) => getUnknownTypeForTypeVar(param)),
        /* isTypeArgumentExplicit */ false,
        /* includeSubclasses */ type.includeSubclasses
    );
}

// Returns "Unknown" for simple TypeVars or the equivalent for a ParamSpec.
export function getUnknownTypeForTypeVar(typeVar: TypeVarType): Type {
    if (typeVar.details.isParamSpec) {
        return getUnknownTypeForParamSpec();
    }

    return UnknownType.create();
}

// Returns the "Unknown" equivalent for a ParamSpec.
export function getUnknownTypeForParamSpec(): FunctionType {
    const newFunction = FunctionType.createInstance(
        '',
        '',
        '',
        FunctionTypeFlags.ParamSpecValue | FunctionTypeFlags.SkipArgsKwargsCompatibilityCheck
    );
    FunctionType.addDefaultParameters(newFunction);
    return newFunction;
}

// Returns the equivalent of "Callable[..., Unknown]".
export function getUnknownTypeForCallable(): FunctionType {
    const newFunction = FunctionType.createSynthesizedInstance('', FunctionTypeFlags.SkipArgsKwargsCompatibilityCheck);
    FunctionType.addDefaultParameters(newFunction);
    newFunction.details.declaredReturnType = UnknownType.create();
    return newFunction;
}

// If the class is generic and not already specialized, this function
// "self specializes" the class, filling in its own type parameters
// as type arguments.
export function selfSpecializeClass(type: ClassType): ClassType {
    if (type.details.typeParameters.length === 0 || type.typeArguments) {
        return type;
    }

    return ClassType.cloneForSpecialization(type, type.details.typeParameters, /* isTypeArgumentExplicit */ true);
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

export function isLiteralTypeOrUnion(type: Type, allowNone = false): boolean {
    if (isClassInstance(type)) {
        if (allowNone && isNoneInstance(type)) {
            return true;
        }

        return type.literalValue !== undefined;
    }

    if (isUnion(type)) {
        return !findSubtype(type, (subtype) => {
            if (!isClassInstance(subtype)) {
                return true;
            }

            if (isNoneInstance(subtype)) {
                return !allowNone;
            }

            return subtype.literalValue === undefined;
        });
    }

    return false;
}

export function containsLiteralType(type: Type, includeTypeArgs = false): boolean {
    class ContainsLiteralTypeWalker extends TypeWalker {
        foundLiteral = false;

        constructor(private _includeTypeArgs: boolean) {
            super();
        }

        override visitClass(classType: ClassType): void {
            if (isClassInstance(classType)) {
                if (isLiteralType(classType) || ClassType.isBuiltIn(classType, 'LiteralString')) {
                    this.foundLiteral = true;
                    this.cancelWalk();
                }
            }

            if (this._includeTypeArgs) {
                super.visitClass(classType);
            }
        }
    }

    const walker = new ContainsLiteralTypeWalker(includeTypeArgs);
    walker.walk(type);
    return walker.foundLiteral;
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

export function isCallableType(type: Type): boolean {
    if (isFunction(type) || isOverloadedFunction(type) || isAnyOrUnknown(type)) {
        return true;
    }

    if (isEffectivelyInstantiable(type)) {
        return true;
    }

    if (isClass(type)) {
        if (TypeBase.isInstantiable(type)) {
            return true;
        }

        const callMember = lookUpObjectMember(type, '__call__', MemberAccessFlags.SkipInstanceMembers);
        return !!callMember;
    }

    if (isUnion(type)) {
        return type.subtypes.every((subtype) => isCallableType(subtype));
    }

    return false;
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

    if (!ClassType.getSymbolTable(type).has('__get__')) {
        return false;
    }

    if (requireSetter && !ClassType.getSymbolTable(type).has('__set__')) {
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
    return (
        type.tupleTypeArguments &&
        type.tupleTypeArguments.some((t) => t.isUnbounded || isUnpackedVariadicTypeVar(t.type))
    );
}

// Indicates whether the specified index is within range and its type is unambiguous
// in that it doesn't involve any element ranges that are of indeterminate length.
export function isTupleIndexUnambiguous(type: ClassType, index: number) {
    if (!type.tupleTypeArguments) {
        return false;
    }

    if (index < 0) {
        if (isUnboundedTupleClass(type) || type.tupleTypeArguments.length + index < 0) {
            return false;
        }
    }

    let unambiguousIndexLimit = type.tupleTypeArguments.findIndex(
        (t) => t.isUnbounded || isUnpackedVariadicTypeVar(t.type)
    );
    if (unambiguousIndexLimit < 0) {
        unambiguousIndexLimit = type.tupleTypeArguments.length;
    }

    return index < unambiguousIndexLimit;
}

// Partially specializes a type within the context of a specified
// (presumably specialized) class. Optionally specializes the `Self`
// type variables, replacing them with selfClass.
export function partiallySpecializeType(
    type: Type,
    contextClassType: ClassType,
    selfClass?: ClassType | TypeVarType,
    typeClassType?: Type
): Type {
    // If the context class is not specialized (or doesn't need specialization),
    // then there's no need to do any more work.
    if (ClassType.isUnspecialized(contextClassType) && !selfClass) {
        return type;
    }

    // Partially specialize the type using the specialized class type vars.
    const typeVarContext = buildTypeVarContextFromSpecializedClass(contextClassType);

    if (selfClass) {
        populateTypeVarContextForSelfType(typeVarContext, contextClassType, selfClass);
    }

    let result = applySolvedTypeVars(type, typeVarContext, { typeClassType });

    // If this is a property, we may need to partially specialize the
    // access methods associated with it.
    if (isClass(result)) {
        if (result.fgetInfo || result.fsetInfo || result.fdelInfo) {
            function updatePropertyMethodInfo(methodInfo?: PropertyMethodInfo): PropertyMethodInfo | undefined {
                if (!methodInfo) {
                    return undefined;
                }

                return {
                    methodType: partiallySpecializeType(
                        methodInfo.methodType,
                        contextClassType,
                        selfClass,
                        typeClassType
                    ) as FunctionType,
                    classType: methodInfo.classType,
                };
            }

            result = TypeBase.cloneType(result);
            result.fgetInfo = updatePropertyMethodInfo(result.fgetInfo);
            result.fsetInfo = updatePropertyMethodInfo(result.fsetInfo);
            result.fdelInfo = updatePropertyMethodInfo(result.fdelInfo);
        }
    }

    return result;
}

export function populateTypeVarContextForSelfType(
    typeVarContext: TypeVarContext,
    contextClassType: ClassType,
    selfClass: ClassType | TypeVarType
) {
    const synthesizedSelfTypeVar = synthesizeTypeVarForSelfCls(contextClassType, /* isClsParam */ false);
    const selfInstance = convertToInstance(selfClass);

    // We can't call stripLiteralValue here because that method requires the type evaluator.
    // Instead, we'll do a simplified version of it here.
    const selfWithoutLiteral = mapSubtypes(selfInstance, (subtype) => {
        if (isClass(subtype)) {
            if (subtype.literalValue !== undefined) {
                return ClassType.cloneWithLiteral(subtype, /* value */ undefined);
            }
        }

        return subtype;
    });

    if (!isTypeSame(synthesizedSelfTypeVar, selfWithoutLiteral)) {
        typeVarContext.setTypeVarType(synthesizedSelfTypeVar, selfInstance, selfWithoutLiteral);
    }
}

// Looks for duplicate function types within the type and ensures that
// if they are generic, they have unique type variables.
export function ensureFunctionSignaturesAreUnique(
    type: Type,
    signatureTracker: UniqueSignatureTracker,
    expressionOffset: number
): Type {
    const transformer = new UniqueFunctionSignatureTransformer(signatureTracker, expressionOffset);
    return transformer.apply(type, 0);
}

// Specializes a (potentially generic) type by substituting
// type variables from a type var map.
export function applySolvedTypeVars(
    type: Type,
    typeVarContext: TypeVarContext,
    options: ApplyTypeVarOptions = {}
): Type {
    // Use a shortcut if the typeVarContext is empty and no transform is necessary.
    if (
        typeVarContext.isEmpty() &&
        !options.unknownIfNotFound &&
        !options.eliminateUnsolvedInUnions &&
        !options.applyInScopePlaceholders
    ) {
        return type;
    }

    if (options.applyInScopePlaceholders) {
        applyInScopePlaceholders(typeVarContext);
    }

    const transformer = new ApplySolvedTypeVarsTransformer(typeVarContext, options);
    return transformer.apply(type, 0);
}

// Applies solved TypeVars from one context to this context.
export function applySourceContextTypeVars(destContext: TypeVarContext, srcContext: TypeVarContext) {
    if (srcContext.isEmpty()) {
        return;
    }

    destContext.doForEachSignatureContext((destSignature) => {
        applySourceContextTypeVarsToSignature(destSignature, srcContext);
    });
}

export function applySourceContextTypeVarsToSignature(
    destSignature: TypeVarSignatureContext,
    srcContext: TypeVarContext
) {
    destSignature.getTypeVars().forEach((entry) => {
        const newNarrowTypeBound = entry.narrowBound ? applySolvedTypeVars(entry.narrowBound, srcContext) : undefined;
        const newNarrowTypeBoundNoLiterals = entry.narrowBoundNoLiterals
            ? applySolvedTypeVars(entry.narrowBoundNoLiterals, srcContext)
            : undefined;
        const newWideTypeBound = entry.wideBound ? applySolvedTypeVars(entry.wideBound, srcContext) : undefined;

        destSignature.setTypeVarType(entry.typeVar, newNarrowTypeBound, newNarrowTypeBoundNoLiterals, newWideTypeBound);

        if (entry.tupleTypes) {
            destSignature.setTupleTypeVar(
                entry.typeVar,
                entry.tupleTypes.map((arg) => {
                    return {
                        type: applySolvedTypeVars(arg.type, srcContext),
                        isUnbounded: arg.isUnbounded,
                        isOptional: arg.isOptional,
                    };
                })
            );
        }
    });
}

// If the TypeVarContext contains any type variables whose types depend on
// in-scope placeholders used for bidirectional type inference, replace those
// with the solved type associated with those in-scope placeholders.
export function applyInScopePlaceholders(typeVarContext: TypeVarContext) {
    typeVarContext.doForEachSignatureContext((signature) => {
        signature.getTypeVars().forEach((entry) => {
            const typeVar = entry.typeVar;
            if (!typeVar.isInScopePlaceholder) {
                const newNarrowTypeBound = entry.narrowBound
                    ? applyInScopePlaceholdersToType(entry.narrowBound, signature)
                    : undefined;
                const newNarrowTypeBoundNoLiterals = entry.narrowBoundNoLiterals
                    ? applyInScopePlaceholdersToType(entry.narrowBoundNoLiterals, signature)
                    : undefined;
                const newWideTypeBound = entry.wideBound
                    ? applyInScopePlaceholdersToType(entry.wideBound, signature)
                    : undefined;

                signature.setTypeVarType(
                    entry.typeVar,
                    newNarrowTypeBound,
                    newNarrowTypeBoundNoLiterals,
                    newWideTypeBound
                );

                if (entry.tupleTypes) {
                    signature.setTupleTypeVar(
                        entry.typeVar,
                        entry.tupleTypes.map((arg) => {
                            return {
                                type: applyInScopePlaceholdersToType(arg.type, signature),
                                isUnbounded: arg.isUnbounded,
                                isOptional: arg.isOptional,
                            };
                        })
                    );
                }
            }
        });
    });
}

// Validates that a default type associated with a TypeVar does not refer to
// other TypeVars or ParamSpecs that are out of scope.
export function validateTypeVarDefault(
    typeVar: TypeVarType,
    liveTypeParams: TypeVarType[],
    invalidTypeVars: Set<string>
) {
    // If there is no default type or the default type is concrete, there's
    // no need to do any more work here.
    if (typeVar.details.isDefaultExplicit && requiresSpecialization(typeVar.details.defaultType)) {
        const validator = new TypeVarDefaultValidator(liveTypeParams, invalidTypeVars);
        validator.apply(typeVar.details.defaultType, 0);
    }
}

export function replaceTypeVarsWithAny(type: Type): Type {
    const transformer = new TypeVarAnyReplacer();
    return transformer.apply(type, 0);
}

// During bidirectional type inference for constructors, an "expected type"
// is used to prepopulate the type var map. This is problematic when the
// expected type uses TypeVars that are not part of the context of the
// class we are constructing. We'll replace these type variables with dummy
// type variables.
export function transformExpectedType(
    expectedType: Type,
    liveTypeVarScopes: TypeVarScopeId[],
    usageOffset: number | undefined
): Type {
    const transformer = new ExpectedTypeTransformer(liveTypeVarScopes, usageOffset);
    return transformer.apply(expectedType, 0);
}

// Given a protocol class (or abstract class), this function returns
// a set of all the symbols (indexed by symbol name) that are part of
// that protocol and its protocol parent classes. If a same-named symbol
// appears in a parent and a child, the child overrides the parent.
export function getProtocolSymbols(classType: ClassType) {
    const symbolMap = new Map<string, ClassMember>();

    if ((classType.details.flags & ClassTypeFlags.ProtocolClass) !== 0) {
        getProtocolSymbolsRecursive(classType, symbolMap, ClassTypeFlags.ProtocolClass);
    }

    return symbolMap;
}

export function getProtocolSymbolsRecursive(
    classType: ClassType,
    symbolMap: Map<string, ClassMember>,
    classFlags = ClassTypeFlags.ProtocolClass,
    recursionCount = 0
) {
    if (recursionCount > maxTypeRecursionCount) {
        return;
    }

    classType.details.baseClasses.forEach((baseClass) => {
        if (isClass(baseClass) && (baseClass.details.flags & classFlags) !== 0) {
            getProtocolSymbolsRecursive(baseClass, symbolMap, classFlags, recursionCount + 1);
        }
    });

    ClassType.getSymbolTable(classType).forEach((symbol, name) => {
        if (!symbol.isIgnoredForProtocolMatch()) {
            symbolMap.set(name, {
                symbol,
                classType,
                isInstanceMember: symbol.isInstanceMember(),
                isClassMember: symbol.isClassMember(),
                isClassVar: isEffectivelyClassVar(symbol, /* isDataclass */ false),
                isTypeDeclared: symbol.hasTypedDeclarations(),
                skippedUndeclaredType: false,
            });
        }
    });
}

// Determines the maximum depth of a tuple, list, set or dictionary.
// For example, if the type is tuple[tuple[tuple[int]]], its depth would be 3.
export function getContainerDepth(type: Type, recursionCount = 0) {
    if (recursionCount > maxTypeRecursionCount) {
        return 1;
    }

    recursionCount++;

    if (!isClassInstance(type)) {
        return 0;
    }

    let maxChildDepth = 0;

    if (type.tupleTypeArguments) {
        type.tupleTypeArguments.forEach((typeArgInfo) => {
            doForEachSubtype(typeArgInfo.type, (subtype) => {
                const childDepth = getContainerDepth(subtype, recursionCount);
                maxChildDepth = Math.max(childDepth, maxChildDepth);
            });
        });
    } else if (type.typeArguments) {
        type.typeArguments.forEach((typeArg) => {
            doForEachSubtype(typeArg, (subtype) => {
                const childDepth = getContainerDepth(subtype, recursionCount);
                maxChildDepth = Math.max(childDepth, maxChildDepth);
            });
        });
    } else {
        return 0;
    }

    return 1 + maxChildDepth;
}

export function lookUpObjectMember(
    objectType: ClassType,
    memberName: string,
    flags = MemberAccessFlags.Default,
    skipMroClass?: ClassType | undefined
): ClassMember | undefined {
    if (isClassInstance(objectType)) {
        return lookUpClassMember(objectType, memberName, flags, skipMroClass);
    }

    return undefined;
}

// Looks up a member in a class using the multiple-inheritance rules
// defined by Python.
export function lookUpClassMember(
    classType: ClassType,
    memberName: string,
    flags = MemberAccessFlags.Default,
    skipMroClass?: ClassType | undefined
): ClassMember | undefined {
    // Look in the metaclass first.
    const metaclass = classType.details.effectiveMetaclass;

    // Skip the "type" class as an optimization because it is known to not
    // define any instance variables, and it's by far the most common metaclass.
    if (metaclass && isClass(metaclass) && !ClassType.isBuiltIn(metaclass, 'type')) {
        const metaMemberItr = getClassMemberIterator(metaclass, memberName, MemberAccessFlags.SkipClassMembers);
        const metaMember = metaMemberItr.next()?.value;

        // If the metaclass defines the member and we didn't hit an Unknown
        // class in the metaclass MRO, use the metaclass member.
        if (metaMember && !isAnyOrUnknown(metaMember.classType)) {
            // Set the isClassMember to true because it's a class member from the
            // perspective of the classType.
            metaMember.isClassMember = true;
            return metaMember;
        }
    }

    const memberItr = getClassMemberIterator(classType, memberName, flags, skipMroClass);

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
// If skipMroClass is defined, all MRO classes up to and including that class
// are skipped.
export function* getClassMemberIterator(
    classType: ClassType | AnyType | UnknownType,
    memberName: string,
    flags = MemberAccessFlags.Default,
    skipMroClass?: ClassType | undefined
) {
    const declaredTypesOnly = (flags & MemberAccessFlags.DeclaredTypesOnly) !== 0;
    let skippedUndeclaredType = false;

    if (isClass(classType)) {
        let classFlags = ClassIteratorFlags.Default;
        if (flags & MemberAccessFlags.SkipOriginalClass) {
            if (isClass(classType)) {
                skipMroClass = classType;
            }
        }
        if (flags & MemberAccessFlags.SkipBaseClasses) {
            classFlags = classFlags | ClassIteratorFlags.SkipBaseClasses;
        }
        if (flags & MemberAccessFlags.SkipObjectBaseClass) {
            classFlags = classFlags | ClassIteratorFlags.SkipObjectBaseClass;
        }
        if (flags & MemberAccessFlags.SkipTypeBaseClass) {
            classFlags = classFlags | ClassIteratorFlags.SkipTypeBaseClass;
        }

        const classItr = getClassIterator(classType, classFlags, skipMroClass);

        for (const [mroClass, specializedMroClass] of classItr) {
            if (!isInstantiableClass(mroClass)) {
                if (!declaredTypesOnly) {
                    // The class derives from an unknown type, so all bets are off
                    // when trying to find a member. Return an unknown symbol.
                    const cm: ClassMember = {
                        symbol: Symbol.createWithType(SymbolFlags.None, mroClass),
                        isInstanceMember: false,
                        isClassMember: true,
                        isClassVar: false,
                        classType: isAnyOrUnknown(mroClass) ? mroClass : UnknownType.create(),
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

            const memberFields = ClassType.getSymbolTable(specializedMroClass);

            // Look at instance members first if requested.
            if ((flags & MemberAccessFlags.SkipInstanceMembers) === 0) {
                const symbol = memberFields.get(memberName);
                if (symbol && symbol.isInstanceMember()) {
                    const hasDeclaredType = symbol.hasTypedDeclarations();
                    if (!declaredTypesOnly || hasDeclaredType) {
                        const cm: ClassMember = {
                            symbol,
                            isInstanceMember: true,
                            isClassMember: symbol.isClassMember(),
                            isClassVar: isEffectivelyClassVar(symbol, ClassType.isDataClass(specializedMroClass)),
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
            if ((flags & MemberAccessFlags.SkipClassMembers) === 0) {
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
                        if (hasDeclaredType && (isDataclass || isTypedDict)) {
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
                            isClassVar: isEffectivelyClassVar(symbol, isDataclass),
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
        }
    } else if (isAnyOrUnknown(classType)) {
        // The class derives from an unknown type, so all bets are off
        // when trying to find a member. Return an Any or Unknown symbol.
        const cm: ClassMember = {
            symbol: Symbol.createWithType(SymbolFlags.None, classType),
            isInstanceMember: false,
            isClassMember: true,
            isClassVar: false,
            classType,
            isTypeDeclared: false,
            skippedUndeclaredType: false,
        };
        yield cm;
    }

    return undefined;
}

export function* getClassIterator(classType: Type, flags = ClassIteratorFlags.Default, skipMroClass?: ClassType) {
    if (isClass(classType)) {
        let foundSkipMroClass = skipMroClass === undefined;

        for (const mroClass of classType.details.mro) {
            // Are we still searching for the skipMroClass?
            if (!foundSkipMroClass && skipMroClass) {
                if (!isClass(mroClass)) {
                    foundSkipMroClass = true;
                } else if (ClassType.isSameGenericClass(mroClass, skipMroClass)) {
                    foundSkipMroClass = true;
                    continue;
                } else {
                    continue;
                }
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
            ClassType.getSymbolTable(specializedMroClass).forEach((symbol, name) => {
                if (!symbol.isIgnoredForProtocolMatch() && symbol.hasTypedDeclarations()) {
                    memberMap.set(name, {
                        classType: specializedMroClass,
                        symbol,
                        isInstanceMember: symbol.isInstanceMember(),
                        isClassMember: symbol.isClassMember(),
                        isClassVar: isEffectivelyClassVar(symbol, ClassType.isDataClass(specializedMroClass)),
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
export function addTypeVarsToListIfUnique(list1: TypeVarType[], list2: TypeVarType[], typeVarScopeId?: TypeVarScopeId) {
    for (const type2 of list2) {
        if (typeVarScopeId && type2.scopeId !== typeVarScopeId) {
            continue;
        }

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
        const combinedList: TypeVarType[] = [];
        const typeArgs = type.tupleTypeArguments ? type.tupleTypeArguments.map((e) => e.type) : type.typeArguments;
        if (typeArgs) {
            typeArgs.forEach((typeArg) => {
                addTypeVarsToListIfUnique(combinedList, getTypeVarArgumentsRecursive(typeArg, recursionCount));
            });
        }

        return combinedList;
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
        typeVarContext.setTypeVarType(typeParam, applySolvedTypeVars(typeParam.details.defaultType, typeVarContext));
    });

    return applySolvedTypeVars(type, typeVarContext) as ClassType;
}

// Recursively finds all of the type arguments and sets them
// to the specified srcType.
export function setTypeArgumentsRecursive(
    destType: Type,
    srcType: UnknownType | AnyType,
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
            }

            if (destType.details.paramSpec) {
                // Fill in an empty signature for a ParamSpec.
                if (!typeVarContext.getPrimarySignature().getTypeVar(destType.details.paramSpec)) {
                    typeVarContext.setTypeVarType(destType.details.paramSpec, getUnknownTypeForParamSpec());
                }
            }
            break;

        case TypeCategory.OverloadedFunction:
            destType.overloads.forEach((subtype) => {
                setTypeArgumentsRecursive(subtype, srcType, typeVarContext, recursionCount);
            });
            break;

        case TypeCategory.TypeVar:
            if (!typeVarContext.getPrimarySignature().getTypeVar(destType)) {
                typeVarContext.setTypeVarType(destType, srcType);
            }
            break;
    }
}

// Builds a mapping between type parameters and their specialized
// types. For example, if the generic type is Dict[_T1, _T2] and the
// specialized type is Dict[str, int], it returns a map that associates
// _T1 with str and _T2 with int.
export function buildTypeVarContextFromSpecializedClass(classType: ClassType): TypeVarContext {
    const typeParameters = ClassType.getTypeParameters(classType);

    const typeVarContext = buildTypeVarContext(typeParameters, classType.typeArguments, getTypeVarScopeId(classType));
    if (ClassType.isTupleClass(classType) && classType.tupleTypeArguments && typeParameters.length >= 1) {
        typeVarContext.setTupleTypeVar(typeParameters[0], classType.tupleTypeArguments);
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
            if (typeParam.details.isParamSpec) {
                if (index < typeArgs.length) {
                    typeArgType = typeArgs[index];
                    if (isFunction(typeArgType) && FunctionType.isParamSpecValue(typeArgType)) {
                        const parameters: FunctionParameter[] = [];
                        const typeArgFunctionType = typeArgType;
                        typeArgType.details.parameters.forEach((param, paramIndex) => {
                            parameters.push({
                                category: param.category,
                                name: param.name,
                                hasDefault: !!param.hasDefault,
                                defaultValueExpression: param.defaultValueExpression,
                                isNameSynthesized: param.isNameSynthesized,
                                type: FunctionType.getEffectiveParameterType(typeArgFunctionType, paramIndex),
                            });
                        });
                        typeVarContext.setTypeVarType(typeParam, convertTypeToParamSpecValue(typeArgType));
                    } else if (isParamSpec(typeArgType) || isAnyOrUnknown(typeArgType)) {
                        typeVarContext.setTypeVarType(typeParam, convertTypeToParamSpecValue(typeArgType));
                    }
                }
            } else {
                if (index >= typeArgs.length) {
                    typeArgType = AnyType.create();
                } else {
                    typeArgType = typeArgs[index];
                }

                typeVarContext.setTypeVarType(
                    typeParam,
                    typeArgType,
                    /* narrowBoundNoLiterals */ undefined,
                    typeArgType
                );
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

export function derivesFromStdlibClass(classType: ClassType, className: string) {
    return classType.details.mro.some((mroClass) => isClass(mroClass) && ClassType.isBuiltIn(mroClass, className));
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
        /* includeSubclasses */ !!classType.includeSubclasses
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

export function isInstantiableMetaclass(type: Type): boolean {
    return (
        isInstantiableClass(type) &&
        type.details.mro.some((mroClass) => isClass(mroClass) && ClassType.isBuiltIn(mroClass, 'type'))
    );
}

export function isMetaclassInstance(type: Type): boolean {
    return (
        isClassInstance(type) &&
        type.details.mro.some((mroClass) => isClass(mroClass) && ClassType.isBuiltIn(mroClass, 'type'))
    );
}

export function isEffectivelyInstantiable(type: Type): boolean {
    if (TypeBase.isInstantiable(type)) {
        return true;
    }

    // Handle the special case of 'type' (or subclasses thereof),
    // which are instantiable.
    if (isMetaclassInstance(type)) {
        return true;
    }

    if (isUnion(type)) {
        return type.subtypes.every((subtype) => isEffectivelyInstantiable(subtype));
    }

    return false;
}

export function convertToInstance(type: ClassType, includeSubclasses?: boolean): ClassType;
export function convertToInstance(type: TypeVarType, includeSubclasses?: boolean): TypeVarType;
export function convertToInstance(type: Type, includeSubclasses?: boolean): Type;
export function convertToInstance(type: Type, includeSubclasses = true): Type {
    // See if we've already performed this conversion and cached it.
    if (type.cached?.instanceType && includeSubclasses) {
        return type.cached.instanceType;
    }

    let result = mapSubtypes(type, (subtype) => {
        switch (subtype.category) {
            case TypeCategory.Class: {
                // Handle type[x] as a special case.
                if (ClassType.isBuiltIn(subtype, 'type')) {
                    if (TypeBase.isInstance(subtype)) {
                        if (!subtype.typeArguments || subtype.typeArguments.length < 1) {
                            return UnknownType.create();
                        } else {
                            return subtype.typeArguments[0];
                        }
                    } else {
                        if (subtype.typeArguments && subtype.typeArguments.length > 0) {
                            if (!isAnyOrUnknown(subtype.typeArguments[0])) {
                                return convertToInstantiable(subtype.typeArguments[0]);
                            }
                        }
                    }
                }

                return ClassType.cloneAsInstance(subtype, includeSubclasses);
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

            case TypeCategory.Any: {
                return AnyType.convertToInstance(subtype);
            }

            case TypeCategory.Unknown: {
                return UnknownType.convertToInstance(subtype);
            }

            case TypeCategory.Never: {
                return NeverType.convertToInstance(subtype);
            }

            case TypeCategory.Unbound: {
                return UnboundType.convertToInstance(subtype);
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
            type.typeAliasInfo.moduleName,
            type.typeAliasInfo.fileUri,
            type.typeAliasInfo.typeVarScopeId,
            type.typeAliasInfo.isPep695Syntax,
            type.typeAliasInfo.typeParameters,
            type.typeAliasInfo.typeArguments
        );
    }

    if (type !== result && includeSubclasses) {
        // Cache the converted value for next time.
        if (!type.cached) {
            type.cached = {};
        }
        type.cached.instanceType = result;
    }

    return result;
}

export function convertToInstantiable(type: Type, includeSubclasses = true): Type {
    // See if we've already performed this conversion and cached it.
    if (type.cached?.instantiableType) {
        return type.cached.instantiableType;
    }

    const result = mapSubtypes(type, (subtype) => {
        switch (subtype.category) {
            case TypeCategory.Class: {
                return ClassType.cloneAsInstantiable(subtype, includeSubclasses);
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

    if (type !== result) {
        // Cache the converted value for next time.
        if (!type.cached) {
            type.cached = {};
        }
        type.cached.instantiableType = result;
    }

    return result;
}

export function getMembersForClass(classType: ClassType, symbolTable: SymbolTable, includeInstanceVars: boolean) {
    classType.details.mro.forEach((mroClass) => {
        if (isInstantiableClass(mroClass)) {
            // Add any new member variables from this class.
            const isClassTypedDict = ClassType.isTypedDictClass(mroClass);
            ClassType.getSymbolTable(mroClass).forEach((symbol, name) => {
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
                    ClassType.getSymbolTable(mroClass).forEach((symbol, name) => {
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

// Determines if the type contains an Any recursively.
export function containsAnyRecursive(type: Type, includeUnknown = true): boolean {
    class AnyWalker extends TypeWalker {
        foundAny = false;

        constructor(private _includeUnknown: boolean) {
            super();
        }

        override visitAny(type: AnyType) {
            this.foundAny = true;
            this.cancelWalk();
        }

        override visitUnknown(type: UnknownType): void {
            if (this._includeUnknown) {
                this.foundAny = true;
                this.cancelWalk();
            }
        }
    }

    const walker = new AnyWalker(includeUnknown);
    walker.walk(type);
    return walker.foundAny;
}

// Determines if the type contains an Any or Unknown type. If so,
// it returns the Any or Unknown type. Unknowns are preferred over
// Any if both are present. If recurse is true, it will recurse
// through type arguments and parameters.
export function containsAnyOrUnknown(type: Type, recurse: boolean): AnyType | UnknownType | undefined {
    class AnyOrUnknownWalker extends TypeWalker {
        anyOrUnknownType: AnyType | UnknownType | undefined;

        constructor(private _recurse: boolean) {
            super();
        }

        override visitUnknown(type: UnknownType) {
            this.anyOrUnknownType = this.anyOrUnknownType ? preserveUnknown(this.anyOrUnknownType, type) : type;
        }

        override visitAny(type: AnyType) {
            this.anyOrUnknownType = this.anyOrUnknownType ? preserveUnknown(this.anyOrUnknownType, type) : type;
        }

        override visitClass(type: ClassType) {
            if (this._recurse) {
                super.visitClass(type);
            }
        }

        override visitFunction(type: FunctionType) {
            if (this._recurse) {
                // A function with a "..." type is effectively an "Any".
                if (FunctionType.shouldSkipArgsKwargsCompatibilityCheck(type)) {
                    this.anyOrUnknownType = this.anyOrUnknownType
                        ? preserveUnknown(this.anyOrUnknownType, AnyType.create())
                        : AnyType.create();
                }

                super.visitFunction(type);
            }
        }
    }

    const walker = new AnyOrUnknownWalker(recurse);
    walker.walk(type);
    return walker.anyOrUnknownType;
}

// Determines if any part of the type contains "Unknown", including any type arguments.
// This function does not use the TypeWalker because it is called very frequently,
// and allocating a memory walker object for every call significantly increases
// peak memory usage.
export function isPartlyUnknown(type: Type, recursionCount = 0): boolean {
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
        if (type.typeAliasInfo.typeArguments.some((typeArg) => isPartlyUnknown(typeArg, recursionCount))) {
            return true;
        }
    }

    // See if a union contains an unknown type.
    if (isUnion(type)) {
        return findSubtype(type, (subtype) => isPartlyUnknown(subtype, recursionCount)) !== undefined;
    }

    // See if an object or class has an unknown type argument.
    if (isClass(type)) {
        // If this is a reference to the class itself, as opposed to a reference
        // to a type that represents the class and its subclasses, don't flag
        // the type as partially unknown.
        if (!type.includeSubclasses) {
            return false;
        }

        if (!ClassType.isPseudoGenericClass(type)) {
            const typeArgs = type.tupleTypeArguments?.map((t) => t.type) || type.typeArguments;
            if (typeArgs) {
                for (const argType of typeArgs) {
                    if (isPartlyUnknown(argType, recursionCount)) {
                        return true;
                    }
                }
            }
        }

        return false;
    }

    // See if a function has an unknown type.
    if (isOverloadedFunction(type)) {
        return OverloadedFunctionType.getOverloads(type).some((overload) => {
            return isPartlyUnknown(overload, recursionCount);
        });
    }

    if (isFunction(type)) {
        for (let i = 0; i < type.details.parameters.length; i++) {
            // Ignore parameters such as "*" that have no name.
            if (type.details.parameters[i].name) {
                const paramType = FunctionType.getEffectiveParameterType(type, i);
                if (isPartlyUnknown(paramType, recursionCount)) {
                    return true;
                }
            }
        }

        if (
            type.details.declaredReturnType &&
            !FunctionType.isParamSpecValue(type) &&
            isPartlyUnknown(type.details.declaredReturnType, recursionCount)
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
    const combinedTupleType = combineTypes(
        typeArgs.map((t) => {
            if (isTypeVar(t.type) && isUnpackedVariadicTypeVar(t.type)) {
                // Treat the unpacked TypeVarTuple as a union.
                return TypeVarType.cloneForUnpacked(t.type, /* isInUnion */ true);
            }

            return t.type;
        })
    );

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
        argsParam.category !== ParameterCategory.ArgsList ||
        kwargsParam.category !== ParameterCategory.KwargsDict ||
        !isParamSpec(argsParam.type) ||
        !isParamSpec(kwargsParam.type) ||
        !isTypeSame(argsParam.type, kwargsParam.type)
    ) {
        return type;
    }

    return FunctionType.cloneRemoveParamSpecVariadics(
        type,
        TypeVarType.cloneForParamSpecAccess(argsParam.type, /* access */ undefined)
    );
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
            // AwaitableGenerator has four type arguments, and the first 3
            // correspond to the generator.
            return returnType.typeArguments?.slice(0, 3);
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
        if (firstTypeParam.details.isDefaultExplicit) {
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
            'TypeIs',
        ];

        if (specialClasses.some((t) => t === (classType.aliasName || classType.details.name))) {
            return true;
        }
    }

    return false;
}

export function requiresSpecialization(
    type: Type,
    options?: RequiresSpecializationOptions,
    recursionCount = 0
): boolean {
    if (recursionCount > maxTypeRecursionCount) {
        return false;
    }
    recursionCount++;

    // Is the answer cached?
    const canUseCache = !options?.ignorePseudoGeneric && !options?.ignoreSelf;
    if (canUseCache && type.cached?.requiresSpecialization !== undefined) {
        return type.cached.requiresSpecialization;
    }

    const result = _requiresSpecialization(type, options, recursionCount);

    if (canUseCache) {
        if (type.cached === undefined) {
            type.cached = {};
        }
        type.cached.requiresSpecialization = result;
    }

    return result;
}

function _requiresSpecialization(type: Type, options?: RequiresSpecializationOptions, recursionCount = 0): boolean {
    // If the type is conditioned on a TypeVar, it may need to be specialized.
    if (type.condition) {
        return true;
    }

    switch (type.category) {
        case TypeCategory.Class: {
            if (ClassType.isPseudoGenericClass(type) && options?.ignorePseudoGeneric) {
                return false;
            }

            if (!type.isTypeArgumentExplicit && options?.ignoreImplicitTypeArgs) {
                return false;
            }

            if (type.typeArguments) {
                return type.typeArguments.some((typeArg) => requiresSpecialization(typeArg, options, recursionCount));
            }

            return ClassType.getTypeParameters(type).length > 0;
        }

        case TypeCategory.Function: {
            if (type.details.paramSpec) {
                return true;
            }

            for (let i = 0; i < type.details.parameters.length; i++) {
                if (requiresSpecialization(FunctionType.getEffectiveParameterType(type, i), options, recursionCount)) {
                    return true;
                }
            }

            const declaredReturnType =
                type.specializedTypes && type.specializedTypes.returnType
                    ? type.specializedTypes.returnType
                    : type.details.declaredReturnType;
            if (declaredReturnType) {
                if (requiresSpecialization(declaredReturnType, options, recursionCount)) {
                    return true;
                }
            } else if (type.inferredReturnType) {
                if (requiresSpecialization(type.inferredReturnType, options, recursionCount)) {
                    return true;
                }
            }

            return false;
        }

        case TypeCategory.OverloadedFunction: {
            return type.overloads.some((overload) => requiresSpecialization(overload, options, recursionCount));
        }

        case TypeCategory.Union: {
            return type.subtypes.some((subtype) => requiresSpecialization(subtype, options, recursionCount));
        }

        case TypeCategory.TypeVar: {
            // Most TypeVar types need to be specialized.
            if (!type.details.recursiveTypeAliasName) {
                if (type.details.isSynthesizedSelf && options?.ignoreSelf) {
                    return false;
                }

                return true;
            }

            // If this is a recursive type alias, it may need to be specialized
            // if it has generic type arguments.
            if (type.typeAliasInfo?.typeArguments) {
                return type.typeAliasInfo.typeArguments.some((typeArg) =>
                    requiresSpecialization(typeArg, options, recursionCount)
                );
            }
        }
    }

    return false;
}

// Combines two variances to produce a resulting variance.
export function combineVariances(variance1: Variance, variance2: Variance) {
    if (variance1 === Variance.Unknown) {
        return variance2;
    }

    if (
        variance2 === Variance.Invariant ||
        (variance2 === Variance.Covariant && variance1 === Variance.Contravariant) ||
        (variance2 === Variance.Contravariant && variance1 === Variance.Covariant)
    ) {
        return Variance.Invariant;
    }

    return variance1;
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

                const declaredVariance = typeParam.details.declaredVariance;
                if (declaredVariance === Variance.Auto) {
                    return true;
                }

                let effectiveVariance = Variance.Invariant;
                if (declaredVariance === Variance.Covariant) {
                    // If the declared variance is covariant, the effective variance
                    // is simply copied from the type param variance.
                    effectiveVariance = typeParamVariance;
                } else if (declaredVariance === Variance.Contravariant) {
                    // If the declared variance is contravariant, it flips the
                    // effective variance from contravariant to covariant or vice versa.
                    if (typeParamVariance === Variance.Covariant) {
                        effectiveVariance = Variance.Contravariant;
                    } else if (typeParamVariance === Variance.Contravariant) {
                        effectiveVariance = Variance.Covariant;
                    }
                }

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
                // If the class is a Protocol or TypedDict, the generic is ignored for
                // the purposes of computing the MRO.
                if (ClassType.isProtocolClass(classType) || ClassType.isTypedDictClass(classType)) {
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
            const typeVarContext = buildTypeVarContextFromSpecializedClass(baseClass);
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
            const typeVarContext = buildTypeVarContextFromSpecializedClass(classType);
            return applySolvedTypeVars(baseClass, typeVarContext);
        })
    );

    // The first class in the MRO is the class itself.
    const typeVarContext = buildTypeVarContextFromSpecializedClass(classType);
    classType.details.mro.push(applySolvedTypeVars(classType, typeVarContext));

    // Helper function that returns true if the specified searchClass
    // is found in the "tail" (i.e. in elements 1 through n) of any
    // of the class lists.
    function isInTail(searchClass: ClassType, classLists: Type[][]) {
        return classLists.some((classList) => {
            return (
                classList.findIndex(
                    (value) => isInstantiableClass(value) && ClassType.isSameGenericClass(value, searchClass)
                ) > 0
            );
        });
    }

    // Helper function that filters the class lists to remove any duplicate
    // entries of the specified class. This is used once the class has been
    // added to the MRO.
    function filterClass(classToFilter: ClassType, classLists: Type[][]) {
        for (let i = 0; i < classLists.length; i++) {
            classLists[i] = classLists[i].filter((value) => {
                return !isInstantiableClass(value) || !ClassType.isSameGenericClass(value, classToFilter);
            });
        }
    }

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

export function convertTypeToParamSpecValue(type: Type): FunctionType {
    if (isParamSpec(type)) {
        const newFunction = FunctionType.createInstance('', '', '', FunctionTypeFlags.ParamSpecValue);
        newFunction.details.paramSpec = type;
        newFunction.details.typeVarScopeId = getTypeVarScopeId(type);
        return newFunction;
    }

    if (isFunction(type)) {
        const newFunction = FunctionType.createInstance(
            '',
            '',
            '',
            type.details.flags | FunctionTypeFlags.ParamSpecValue,
            type.details.docString
        );

        newFunction.details.deprecatedMessage = type.details.deprecatedMessage;

        type.details.parameters.forEach((param, index) => {
            FunctionType.addParameter(newFunction, {
                category: param.category,
                name: param.name,
                hasDefault: param.hasDefault,
                defaultValueExpression: param.defaultValueExpression,
                isNameSynthesized: param.isNameSynthesized,
                type: FunctionType.getEffectiveParameterType(type, index),
            });
        });

        if (type.details.higherOrderTypeVarScopeIds) {
            newFunction.details.higherOrderTypeVarScopeIds = [...type.details.higherOrderTypeVarScopeIds];
            newFunction.details.typeVarScopeId = newFunction.details.higherOrderTypeVarScopeIds.pop();
        }

        newFunction.details.paramSpec = type.details.paramSpec;
        return newFunction;
    }

    return getUnknownTypeForParamSpec();
}

export function convertParamSpecValueToType(paramSpecValue: FunctionType, omitParamSpec = false): Type {
    let hasParameters = paramSpecValue.details.parameters.length > 0;

    if (paramSpecValue.details.parameters.length === 1) {
        // If the ParamSpec has a position-only separator as its only parameter,
        // treat it as though there are no parameters.
        const onlyParam = paramSpecValue.details.parameters[0];
        if (isPositionOnlySeparator(onlyParam)) {
            hasParameters = false;
        }
    }

    if (hasParameters || !paramSpecValue.details.paramSpec || omitParamSpec) {
        // Create a function type from the param spec entries.
        const functionType = FunctionType.createInstance(
            '',
            '',
            '',
            FunctionTypeFlags.ParamSpecValue | paramSpecValue.details.flags
        );

        FunctionType.addHigherOrderTypeVarScopeIds(functionType, paramSpecValue.details.typeVarScopeId);

        paramSpecValue.details.parameters.forEach((entry) => {
            FunctionType.addParameter(functionType, {
                category: entry.category,
                name: entry.name,
                hasDefault: entry.hasDefault,
                defaultValueExpression: entry.defaultValueExpression,
                isNameSynthesized: entry.isNameSynthesized,
                hasDeclaredType: true,
                type: entry.type,
            });
        });

        if (!omitParamSpec) {
            functionType.details.paramSpec = paramSpecValue.details.paramSpec;
        }
        functionType.details.docString = paramSpecValue.details.docString;
        functionType.details.deprecatedMessage = paramSpecValue.details.deprecatedMessage;

        return functionType;
    }

    return paramSpecValue.details.paramSpec;
}

// Recursively walks a type and calls a callback for each TypeVar, allowing
// it to be replaced with something else.
class TypeVarTransformer {
    private _isTransformingTypeArg = false;
    private _pendingTypeVarTransformations = new Set<TypeVarScopeId>();
    private _pendingFunctionTransformations: (FunctionType | OverloadedFunctionType)[] = [];

    apply(type: Type, recursionCount: number): Type {
        if (recursionCount > maxTypeRecursionCount) {
            return type;
        }
        recursionCount++;

        type = this.transformGenericTypeAlias(type, recursionCount);

        // If the type is conditioned on a type variable, see if the condition
        // still applies.
        if (type.condition) {
            type = this.transformConditionalType(type, recursionCount);
        }

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
                        type.typeAliasInfo.moduleName,
                        type.typeAliasInfo.fileUri,
                        type.typeAliasInfo.typeVarScopeId,
                        type.typeAliasInfo.isPep695Syntax,
                        type.typeAliasInfo.typeParameters,
                        typeArgs
                    );
                }

                return type;
            }

            let replacementType: Type = type;

            // Recursively transform the results, but ensure that we don't replace any
            // type variables in the same scope recursively by setting it the scope in the
            // _pendingTypeVarTransformations set.
            if (!this._isTypeVarScopePending(type.scopeId)) {
                if (type.details.isParamSpec) {
                    let paramSpecWithoutAccess = type;

                    if (type.paramSpecAccess) {
                        paramSpecWithoutAccess = TypeVarType.cloneForParamSpecAccess(type, /* access */ undefined);
                    }

                    const paramSpecValue = this.transformParamSpec(paramSpecWithoutAccess, recursionCount);
                    if (paramSpecValue) {
                        const paramSpecType = convertParamSpecValueToType(paramSpecValue);

                        if (type.paramSpecAccess) {
                            if (isParamSpec(paramSpecType)) {
                                replacementType = TypeVarType.cloneForParamSpecAccess(
                                    paramSpecType,
                                    type.paramSpecAccess
                                );
                            } else {
                                replacementType = UnknownType.create();
                            }
                        } else {
                            replacementType = paramSpecType;
                        }
                    }
                } else {
                    replacementType = this.transformTypeVar(type, recursionCount) ?? type;

                    if (!this._isTransformingTypeArg) {
                        if (type.scopeId) {
                            this._pendingTypeVarTransformations.add(type.scopeId);
                        }
                        replacementType = this.apply(replacementType, recursionCount);
                        if (type.scopeId) {
                            this._pendingTypeVarTransformations.delete(type.scopeId);
                        }
                    }

                    // If we're transforming a variadic type variable that was in a union,
                    // expand the union types.
                    if (isVariadicTypeVar(type) && type.isVariadicInUnion) {
                        replacementType = _expandVariadicUnpackedUnion(replacementType);
                    }
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
                    return this.transformUnionSubtype(subtype, transformedType, recursionCount);
                }

                return transformedType;
            });

            return !isNever(newUnionType) ? newUnionType : UnknownType.create();
        }

        if (isClass(type)) {
            return this.transformTypeVarsInClassType(type, recursionCount);
        }

        if (isFunction(type)) {
            // Prevent recursion.
            if (this._pendingFunctionTransformations.some((t) => t === type)) {
                return type;
            }

            this._pendingFunctionTransformations.push(type);
            const result = this.transformTypeVarsInFunctionType(type, recursionCount);
            this._pendingFunctionTransformations.pop();

            return result;
        }

        if (isOverloadedFunction(type)) {
            // Prevent recursion.
            if (this._pendingFunctionTransformations.some((t) => t === type)) {
                return type;
            }

            this._pendingFunctionTransformations.push(type);

            let requiresUpdate = false;

            // Specialize each of the functions in the overload.
            const newOverloads: FunctionType[] = [];
            type.overloads.forEach((entry) => {
                const replacementType = this.transformTypeVarsInFunctionType(entry, recursionCount);

                if (isFunction(replacementType)) {
                    newOverloads.push(replacementType);
                } else {
                    appendArray(newOverloads, replacementType.overloads);
                }

                if (replacementType !== entry) {
                    requiresUpdate = true;
                }
            });

            this._pendingFunctionTransformations.pop();

            // Construct a new overload with the specialized function types.
            return requiresUpdate ? OverloadedFunctionType.create(newOverloads) : type;
        }

        return type;
    }

    transformTypeVar(typeVar: TypeVarType, recursionCount: number): Type | undefined {
        return undefined;
    }

    transformTupleTypeVar(paramSpec: TypeVarType, recursionCount: number): TupleTypeArgument[] | undefined {
        return undefined;
    }

    transformParamSpec(paramSpec: TypeVarType, recursionCount: number): FunctionType | undefined {
        return undefined;
    }

    transformUnionSubtype(preTransform: Type, postTransform: Type, recursionCount: number): Type | undefined {
        return postTransform;
    }

    doForEachSignatureContext(callback: () => FunctionType): FunctionType | OverloadedFunctionType {
        // By default, simply return the result of the callback. Subclasses
        // can override this method as they see fit.
        return callback();
    }

    transformGenericTypeAlias(type: Type, recursionCount: number) {
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
                  type.typeAliasInfo.moduleName,
                  type.typeAliasInfo.fileUri,
                  type.typeAliasInfo.typeVarScopeId,
                  type.typeAliasInfo.isPep695Syntax,
                  type.typeAliasInfo.typeParameters,
                  newTypeArgs
              )
            : type;
    }

    transformConditionalType(type: Type, recursionCount: number): Type {
        // By default, do not perform any transform.
        return type;
    }

    transformTypeVarsInClassType(classType: ClassType, recursionCount: number): ClassType {
        const typeParams = ClassType.getTypeParameters(classType);

        // Handle the common case where the class has no type parameters.
        if (
            typeParams.length === 0 &&
            !ClassType.isSpecialBuiltIn(classType) &&
            !ClassType.isBuiltIn(classType, 'type')
        ) {
            return classType;
        }

        let newTypeArgs: Type[] | undefined;
        let newTupleTypeArgs: TupleTypeArgument[] | undefined;
        let specializationNeeded = false;

        const transformParamSpec = (paramSpec: TypeVarType) => {
            const paramSpecValue = this.transformParamSpec(paramSpec, recursionCount);
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

        // Handle tuples specially.
        if (ClassType.isTupleClass(classType)) {
            if (classType.tupleTypeArguments) {
                newTupleTypeArgs = [];
                classType.tupleTypeArguments.forEach((oldTypeArgType) => {
                    const newTypeArgType = this.apply(oldTypeArgType.type, recursionCount);

                    if (newTypeArgType !== oldTypeArgType.type) {
                        specializationNeeded = true;
                    }

                    if (
                        isUnpackedVariadicTypeVar(oldTypeArgType.type) &&
                        isClassInstance(newTypeArgType) &&
                        isTupleClass(newTypeArgType) &&
                        newTypeArgType.tupleTypeArguments
                    ) {
                        appendArray(newTupleTypeArgs!, newTypeArgType.tupleTypeArguments);
                    } else {
                        newTupleTypeArgs!.push({
                            type: newTypeArgType,
                            isUnbounded: oldTypeArgType.isUnbounded,
                            isOptional: oldTypeArgType.isOptional,
                        });
                    }
                });
            } else if (typeParams.length > 0) {
                newTupleTypeArgs = this.transformTupleTypeVar(typeParams[0], recursionCount);
                if (newTupleTypeArgs) {
                    specializationNeeded = true;
                } else {
                    const newTypeArgType = this.apply(typeParams[0], recursionCount);
                    newTupleTypeArgs = [{ type: newTypeArgType, isUnbounded: true }];
                    specializationNeeded = true;
                }
            }

            // If this is an empty tuple, don't recompute the non-tuple type argument.
            if (newTupleTypeArgs && newTupleTypeArgs.length > 0) {
                // Combine the tuple type args into a single non-tuple type argument.
                newTypeArgs = [
                    combineTypes(
                        newTupleTypeArgs.map((t) => {
                            if (isTypeVar(t.type) && isUnpackedVariadicTypeVar(t.type)) {
                                // Treat the unpacked TypeVarTuple as a union.
                                return TypeVarType.cloneForUnpacked(t.type, /* isInUnion */ true);
                            }

                            return t.type;
                        })
                    ),
                ];
            }
        }

        if (!newTypeArgs) {
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
                newTypeArgs = [];

                typeParams.forEach((typeParam) => {
                    let replacementType: Type = typeParam;

                    if (typeParam.details.isParamSpec) {
                        replacementType = transformParamSpec(typeParam);
                        if (replacementType !== typeParam) {
                            specializationNeeded = true;
                        }
                    } else {
                        if (!this._isTypeVarScopePending(typeParam.scopeId)) {
                            const transformedType = this.transformTypeVar(typeParam, recursionCount);
                            replacementType = transformedType ?? typeParam;

                            if (replacementType !== typeParam) {
                                specializationNeeded = true;
                            } else if (transformedType !== undefined && !classType.typeArguments) {
                                specializationNeeded = true;
                            }
                        }
                    }

                    newTypeArgs!.push(replacementType);
                });
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
            newTupleTypeArgs
        );
    }

    transformTypeVarsInFunctionType(
        sourceType: FunctionType,
        recursionCount: number
    ): FunctionType | OverloadedFunctionType {
        return this.doForEachSignatureContext(() => {
            let functionType = sourceType;

            // Handle functions with a parameter specification in a special manner.
            if (functionType.details.paramSpec) {
                const paramSpec = this.transformParamSpec(functionType.details.paramSpec, recursionCount);
                if (paramSpec) {
                    functionType = FunctionType.cloneForParamSpec(functionType, paramSpec);
                }
            }

            const declaredReturnType = FunctionType.getSpecializedReturnType(functionType);
            const specializedReturnType = declaredReturnType
                ? this.apply(declaredReturnType, recursionCount)
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
                    argsParam.category === ParameterCategory.ArgsList &&
                    kwargsParam.category === ParameterCategory.KwargsDict &&
                    isParamSpec(argsParamType) &&
                    isParamSpec(kwargsParamType) &&
                    isTypeSame(argsParamType, kwargsParamType)
                ) {
                    const paramSpecType = this.transformParamSpec(argsParamType, recursionCount);
                    if (paramSpecType) {
                        if (
                            paramSpecType.details.parameters.length > 0 ||
                            paramSpecType.details.paramSpec === undefined ||
                            !isTypeSame(argsParamType, paramSpecType.details.paramSpec)
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
                    functionType.details.parameters[i].category === ParameterCategory.ArgsList
                ) {
                    variadicParamIndex = i;

                    if (
                        isClassInstance(specializedType) &&
                        isTupleClass(specializedType) &&
                        specializedType.isUnpacked
                    ) {
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
            const newFunctionType = TypeBase.isInstantiable(functionType)
                ? FunctionType.createInstantiable(functionType.details.flags | FunctionTypeFlags.SynthesizedMethod)
                : FunctionType.createSynthesizedInstance('', functionType.details.flags);
            let insertKeywordOnlySeparator = false;
            let swallowPositionOnlySeparator = false;

            specializedParameters.parameterTypes.forEach((paramType, index) => {
                if (index === variadicParamIndex) {
                    let sawUnboundedEntry = false;

                    // Unpack the tuple into individual parameters.
                    variadicTypesToUnpack!.forEach((unpackedType) => {
                        FunctionType.addParameter(newFunctionType, {
                            category:
                                unpackedType.isUnbounded || isVariadicTypeVar(unpackedType.type)
                                    ? ParameterCategory.ArgsList
                                    : ParameterCategory.Simple,
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

                    if (isKeywordOnlySeparator(param)) {
                        insertKeywordOnlySeparator = false;
                    } else if (param.category === ParameterCategory.KwargsDict) {
                        insertKeywordOnlySeparator = false;
                    }

                    // Insert a keyword-only separator parameter if we previously
                    // unpacked a variadic TypeVar.
                    if (param.category === ParameterCategory.Simple && param.name && insertKeywordOnlySeparator) {
                        FunctionType.addKeywordOnlyParameterSeparator(newFunctionType);
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
        });
    }

    private _isTypeVarScopePending(typeVarScopeId: TypeVarScopeId | undefined) {
        return !!typeVarScopeId && this._pendingTypeVarTransformations.has(typeVarScopeId);
    }
}

// Converts all type variables to Any.
class TypeVarAnyReplacer extends TypeVarTransformer {
    constructor() {
        super();
    }

    override transformTypeVar(typeVar: TypeVarType) {
        return AnyType.create();
    }

    override transformParamSpec(paramSpec: TypeVarType) {
        return getUnknownTypeForParamSpec();
    }
}

// For a TypeVar with a default type, validates whether the default type is using
// any other TypeVars that are not currently in scope.
class TypeVarDefaultValidator extends TypeVarTransformer {
    constructor(private _liveTypeParams: TypeVarType[], private _invalidTypeVars: Set<string>) {
        super();
    }

    override transformTypeVar(typeVar: TypeVarType) {
        const replacementType = this._liveTypeParams.find((param) => param.details.name === typeVar.details.name);
        if (!replacementType || isParamSpec(replacementType)) {
            this._invalidTypeVars.add(typeVar.details.name);
        }

        return UnknownType.create();
    }

    override transformParamSpec(paramSpec: TypeVarType) {
        const replacementType = this._liveTypeParams.find((param) => param.details.name === paramSpec.details.name);
        if (!replacementType || !isParamSpec(replacementType)) {
            this._invalidTypeVars.add(paramSpec.details.name);
        }

        return undefined;
    }
}

class UniqueFunctionSignatureTransformer extends TypeVarTransformer {
    constructor(private _signatureTracker: UniqueSignatureTracker, private _expressionOffset: number) {
        super();
    }

    override transformGenericTypeAlias(type: Type, recursionCount: number): Type {
        // Don't transform type aliases.
        return type;
    }

    override transformTypeVarsInClassType(classType: ClassType, recursionCount: number): ClassType {
        // Don't transform classes.
        return classType;
    }

    override transformTypeVarsInFunctionType(
        sourceType: FunctionType,
        recursionCount: number
    ): FunctionType | OverloadedFunctionType {
        if (sourceType.trackedSignatures) {
            this._signatureTracker.addTrackedSignatures(sourceType.trackedSignatures);
        }

        // If this function is not generic, there's no need to check for uniqueness.
        if (sourceType.details.typeParameters.length === 0) {
            return super.transformTypeVarsInFunctionType(sourceType, recursionCount);
        }

        let updatedSourceType: Type = sourceType;
        const existingSignature = this._signatureTracker.findSignature(sourceType);
        if (existingSignature) {
            let offsetIndex = existingSignature.expressionOffsets.findIndex(
                (offset) => offset === this._expressionOffset
            );
            if (offsetIndex < 0) {
                offsetIndex = existingSignature.expressionOffsets.length;
            }

            if (offsetIndex > 0) {
                const typeVarContext = new TypeVarContext(getTypeVarScopeIds(sourceType));

                // Create new type variables with the same scope but with
                // different (unique) names.
                sourceType.details.typeParameters.forEach((typeParam) => {
                    if (typeParam.scopeType === TypeVarScopeType.Function) {
                        let replacement: Type = TypeVarType.cloneForNewName(
                            typeParam,
                            `${typeParam.details.name}(${offsetIndex})`
                        );

                        if (replacement.details.isParamSpec) {
                            replacement = convertTypeToParamSpecValue(replacement);
                        }

                        typeVarContext.setTypeVarType(typeParam, replacement);
                    }
                });

                updatedSourceType = applySolvedTypeVars(sourceType, typeVarContext);
                assert(isFunction(updatedSourceType) || isOverloadedFunction(updatedSourceType));
            }
        }

        this._signatureTracker.addSignature(sourceType, this._expressionOffset);

        return updatedSourceType;
    }
}

// Specializes a (potentially generic) type by substituting
// type variables from a type var map.
class ApplySolvedTypeVarsTransformer extends TypeVarTransformer {
    private _isSolvingDefaultType = false;
    private _activeTypeVarSignatureContextIndex: number | undefined;

    constructor(private _typeVarContext: TypeVarContext, private _options: ApplyTypeVarOptions) {
        super();
    }

    override transformTypeVar(typeVar: TypeVarType, recursionCount: number) {
        const signatureContext = this._typeVarContext.getSignatureContext(
            this._activeTypeVarSignatureContextIndex ?? 0
        );

        // If the type variable is unrelated to the scopes we're solving,
        // don't transform that type variable.
        if (typeVar.scopeId && this._typeVarContext.hasSolveForScope(typeVar.scopeId)) {
            let replacement = signatureContext.getTypeVarType(typeVar, !!this._options.useNarrowBoundOnly);

            // If there was no narrow bound but there is a wide bound that
            // contains literals or a TypeVar, we'll use the wide bound even if
            // "useNarrowBoundOnly" is specified.
            if (!replacement && this._options.useNarrowBoundOnly) {
                const wideType = signatureContext.getTypeVarType(typeVar);
                if (wideType) {
                    if (isTypeVar(wideType) || containsLiteralType(wideType, /* includeTypeArgs */ true)) {
                        replacement = wideType;
                    }
                }
            }

            if (replacement) {
                if (TypeBase.isInstantiable(typeVar)) {
                    if (
                        isAnyOrUnknown(replacement) &&
                        this._options.typeClassType &&
                        isInstantiableClass(this._options.typeClassType)
                    ) {
                        replacement = ClassType.cloneForSpecialization(
                            ClassType.cloneAsInstance(this._options.typeClassType),
                            [replacement],
                            /* isTypeArgumentExplicit */ true
                        );
                    } else {
                        replacement = convertToInstantiable(replacement, /* includeSubclasses */ false);
                    }
                } else {
                    // If the TypeVar is not instantiable (i.e. not a type[T]), then
                    // it represents an instance of a type. If the replacement includes
                    // a generic class that has not been specialized, specialize it
                    // now with default type arguments.
                    replacement = mapSubtypes(replacement, (subtype) => {
                        if (isClassInstance(subtype)) {
                            // If the includeSubclasses wasn't set, force it to be set by
                            // converting to/from an instantiable.
                            if (!subtype.includeSubclasses) {
                                subtype = ClassType.cloneAsInstance(ClassType.cloneAsInstantiable(subtype));
                            }

                            if (this._options.unknownIfNotFound) {
                                return this._options.useUnknownOverDefault
                                    ? specializeWithUnknownTypeArgs(subtype)
                                    : specializeWithDefaultTypeArgs(subtype);
                            }
                        }

                        return subtype;
                    });
                }

                if (isTypeVar(replacement) && typeVar.isVariadicUnpacked && replacement.details.isVariadic) {
                    return TypeVarType.cloneForUnpacked(replacement, typeVar.isVariadicInUnion);
                }

                if (!isTypeVar(replacement) || !replacement.isInScopePlaceholder || !this._options.unknownIfNotFound) {
                    return replacement;
                }
            }

            // If this typeVar is in scope for what we're solving but the type
            // var map doesn't contain any entry for it, replace with the
            // default or Unknown.
            let useDefaultOrUnknown = false;
            if (this._options.unknownIfNotFound) {
                const exemptTypeVars = this._options.unknownExemptTypeVars ?? [];
                const typeVarInstance = TypeBase.isInstance(typeVar) ? typeVar : TypeVarType.cloneAsInstance(typeVar);
                if (!exemptTypeVars.some((t) => isTypeSame(t, typeVarInstance))) {
                    useDefaultOrUnknown = true;
                }
            } else if (this._options.applyInScopePlaceholders && typeVar.isInScopePlaceholder) {
                useDefaultOrUnknown = true;
            }

            if (useDefaultOrUnknown) {
                // Use the default value if there is one.
                if (typeVar.details.isDefaultExplicit && !this._options.useUnknownOverDefault) {
                    return this._solveDefaultType(typeVar.details.defaultType, recursionCount);
                }

                return UnknownType.create();
            }
        }

        // If we're solving a default type, handle type variables with no scope ID.
        if (this._isSolvingDefaultType && !typeVar.scopeId) {
            const replacementEntry = signatureContext
                .getTypeVars()
                .find((entry) => entry.typeVar.details.name === typeVar.details.name);

            if (replacementEntry) {
                return signatureContext.getTypeVarType(replacementEntry.typeVar);
            }

            if (typeVar.details.isDefaultExplicit) {
                return this.apply(typeVar.details.defaultType, recursionCount);
            }

            return UnknownType.create();
        }

        return undefined;
    }

    override transformUnionSubtype(preTransform: Type, postTransform: Type): Type | undefined {
        // If a union contains unsolved TypeVars within scope, eliminate them
        // unless this results in an empty union. This elimination is needed
        // in cases where TypeVars can go unsolved due to unions in parameter
        // annotations, like this:
        //   def test(x: Union[str, T]) -> Union[str, T]
        if (this._options.eliminateUnsolvedInUnions) {
            if (
                isTypeVar(preTransform) &&
                preTransform.scopeId !== undefined &&
                this._typeVarContext.hasSolveForScope(preTransform.scopeId)
            ) {
                const signatureContext = this._typeVarContext.getSignatureContext(
                    this._activeTypeVarSignatureContextIndex ?? 0
                );

                const typeVarType = signatureContext.getTypeVarType(preTransform);

                // Did the TypeVar remain unsolved?
                if (!typeVarType || (isTypeVar(typeVarType) && typeVarType.isInScopePlaceholder)) {
                    // If the TypeVar was not transformed, then it was unsolved,
                    // and we'll eliminate it.
                    if (preTransform === postTransform) {
                        return undefined;
                    }

                    // If unknownIfNotFound is true, the postTransform type will
                    // be Unknown, which we want to eliminate.
                    if (isUnknown(postTransform) && this._options.unknownIfNotFound) {
                        return undefined;
                    }
                }
            }
        }

        return postTransform;
    }

    override transformTupleTypeVar(typeVar: TypeVarType): TupleTypeArgument[] | undefined {
        if (!typeVar.scopeId || !this._typeVarContext.hasSolveForScope(typeVar.scopeId)) {
            const defaultType = typeVar.details.defaultType;

            if (typeVar.details.isDefaultExplicit && isClassInstance(defaultType) && defaultType.tupleTypeArguments) {
                return defaultType.tupleTypeArguments;
            }

            return undefined;
        }

        const signatureContext = this._typeVarContext.getSignatureContext(
            this._activeTypeVarSignatureContextIndex ?? 0
        );
        return signatureContext.getTupleTypeVar(typeVar);
    }

    override transformParamSpec(paramSpec: TypeVarType, recursionCount: number): FunctionType | undefined {
        const signatureContext = this._typeVarContext.getSignatureContext(
            this._activeTypeVarSignatureContextIndex ?? 0
        );

        // If we're solving a default type, handle param specs with no scope ID.
        if (this._isSolvingDefaultType && !paramSpec.scopeId) {
            const replacementEntry = signatureContext
                .getTypeVars()
                .find((entry) => entry.typeVar.details.name === paramSpec.details.name);

            if (replacementEntry) {
                return signatureContext.getParamSpecType(replacementEntry.typeVar);
            }

            if (paramSpec.details.isDefaultExplicit) {
                return convertTypeToParamSpecValue(this.apply(paramSpec.details.defaultType, recursionCount));
            }

            return getUnknownTypeForParamSpec();
        }

        if (!paramSpec.scopeId || !this._typeVarContext.hasSolveForScope(paramSpec.scopeId)) {
            return undefined;
        }

        const transformedParamSpec = signatureContext.getParamSpecType(paramSpec);
        if (transformedParamSpec) {
            return transformedParamSpec;
        }

        let useDefaultOrUnknown = false;
        if (this._options.unknownIfNotFound) {
            const exemptTypeVars = this._options.unknownExemptTypeVars ?? [];
            if (!exemptTypeVars.some((t) => isTypeSame(t, paramSpec, { ignoreTypeFlags: true }))) {
                useDefaultOrUnknown = true;
            }
        } else if (this._options.applyInScopePlaceholders && paramSpec.isInScopePlaceholder) {
            useDefaultOrUnknown = true;
        }

        if (useDefaultOrUnknown) {
            // Use the default value if there is one.
            if (paramSpec.details.isDefaultExplicit && !this._options.useUnknownOverDefault) {
                return convertTypeToParamSpecValue(
                    this._solveDefaultType(paramSpec.details.defaultType, recursionCount)
                );
            }

            // Convert to the ParamSpec equivalent of "Unknown".
            return getUnknownTypeForParamSpec();
        }

        return undefined;
    }

    override transformConditionalType(type: Type, recursionCount: number): Type {
        if (!type.condition) {
            return type;
        }

        const signatureContext = this._typeVarContext.getSignatureContext(
            this._activeTypeVarSignatureContextIndex ?? 0
        );

        for (const condition of type.condition) {
            // This doesn't apply to bound type variables.
            if (condition.typeVar.details.constraints.length === 0) {
                continue;
            }

            const typeVarEntry = signatureContext.getTypeVar(condition.typeVar);
            if (!typeVarEntry || condition.constraintIndex >= typeVarEntry.typeVar.details.constraints.length) {
                continue;
            }

            const value = signatureContext.getTypeVarType(typeVarEntry.typeVar);
            if (!value) {
                continue;
            }

            const constraintType = typeVarEntry.typeVar.details.constraints[condition.constraintIndex];

            // If this violates the constraint, substitute a Never type.
            if (!isTypeSame(constraintType, value)) {
                return NeverType.createNever();
            }
        }
        return type;
    }

    override doForEachSignatureContext(callback: () => FunctionType): FunctionType | OverloadedFunctionType {
        const signatureContexts = this._typeVarContext.getSignatureContexts();

        // Handle the common case where there are not multiple signature contexts.
        if (signatureContexts.length <= 1) {
            return callback();
        }

        // Loop through all of the signature contexts in the type var context
        // to create an overload type.
        const overloadTypes = signatureContexts.map((_, index) => {
            this._activeTypeVarSignatureContextIndex = index;
            return callback();
        });
        this._activeTypeVarSignatureContextIndex = undefined;

        const filteredOverloads: FunctionType[] = [];
        doForEachSubtype(combineTypes(overloadTypes), (subtype) => {
            assert(isFunction(subtype));
            subtype = FunctionType.cloneWithNewFlags(subtype, subtype.details.flags | FunctionTypeFlags.Overloaded);
            filteredOverloads.push(subtype);
        });

        if (filteredOverloads.length === 1) {
            return filteredOverloads[0];
        }

        return OverloadedFunctionType.create(filteredOverloads);
    }

    private _solveDefaultType(defaultType: Type, recursionCount: number) {
        const wasSolvingDefaultType = this._isSolvingDefaultType;
        this._isSolvingDefaultType = true;
        const result = this.apply(defaultType, recursionCount);
        this._isSolvingDefaultType = wasSolvingDefaultType;
        return result;
    }
}

class ExpectedTypeTransformer extends TypeVarTransformer {
    constructor(private _liveTypeVarScopes: TypeVarScopeId[], private _usageOffset: number | undefined) {
        super();
    }

    override transformTypeVar(typeVar: TypeVarType) {
        if (!this._isTypeVarLive(typeVar)) {
            return TypeVarType.cloneAsInScopePlaceholder(typeVar, this._usageOffset);
        }

        return typeVar;
    }

    override transformParamSpec(paramSpec: TypeVarType): FunctionType | undefined {
        if (!this._isTypeVarLive(paramSpec)) {
            return convertTypeToParamSpecValue(TypeVarType.cloneAsInScopePlaceholder(paramSpec, this._usageOffset));
        }

        return undefined;
    }

    private _isTypeVarLive(typeVar: TypeVarType) {
        return this._liveTypeVarScopes.some((scopeId) => typeVar.scopeId === scopeId);
    }
}

class InScopePlaceholderTransformer extends TypeVarTransformer {
    constructor(private _signatureContext: TypeVarSignatureContext) {
        super();
    }

    override transformTypeVar(typeVar: TypeVarType) {
        if (typeVar.isInScopePlaceholder) {
            return this._signatureContext.getTypeVarType(typeVar) ?? typeVar;
        }

        return typeVar;
    }

    override transformParamSpec(paramSpec: TypeVarType): FunctionType | undefined {
        if (paramSpec.isInScopePlaceholder) {
            return this._signatureContext.getParamSpecType(paramSpec);
        }

        return undefined;
    }
}

function applyInScopePlaceholdersToType(type: Type, signatureContext: TypeVarSignatureContext): Type {
    // Handle the common case where there are no in-scope placeholders.
    // No more work is required in this case.
    if (!signatureContext.getTypeVars().some((entry) => entry.typeVar.isInScopePlaceholder)) {
        return type;
    }

    const transformer = new InScopePlaceholderTransformer(signatureContext);
    return transformer.apply(type, 0);
}
