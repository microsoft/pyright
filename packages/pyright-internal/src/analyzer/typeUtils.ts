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
import { ParamCategory } from '../parser/parseNodes';
import { ConstraintSolution, ConstraintSolutionSet } from './constraintSolution';
import { DeclarationType } from './declaration';
import { Symbol, SymbolFlags, SymbolTable } from './symbol';
import { isEffectivelyClassVar, isTypedDictMemberAccessedThroughIndex } from './symbolUtils';
import {
    AnyType,
    ClassType,
    ClassTypeFlags,
    combineTypes,
    findSubtype,
    FunctionParam,
    FunctionParamFlags,
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
    isOverloaded,
    isParamSpec,
    isPositionOnlySeparator,
    isTypeSame,
    isTypeVar,
    isTypeVarTuple,
    isUnbound,
    isUnion,
    isUnknown,
    isUnpackedClass,
    isUnpackedTypeVar,
    isUnpackedTypeVarTuple,
    maxTypeRecursionCount,
    ModuleType,
    NeverType,
    OverloadedType,
    ParamSpecAccess,
    ParamSpecType,
    PropertyMethodInfo,
    removeFromUnion,
    SignatureWithOffsets,
    SpecializedFunctionTypes,
    TupleTypeArg,
    Type,
    TypeBase,
    TypeCategory,
    TypeCondition,
    TypeFlags,
    TypeSameOptions,
    TypeVarScopeId,
    TypeVarScopeType,
    TypeVarTupleType,
    TypeVarType,
    UnboundType,
    UnionType,
    UnknownType,
    Variance,
} from './types';
import { TypeWalker } from './typeWalker';

export interface ClassMember {
    // Symbol
    symbol: Symbol;

    // Partially-specialized class that contains the class member
    classType: ClassType | UnknownType | AnyType;

    // Unspecialized class that contains the class member
    unspecializedClassType: ClassType | UnknownType | AnyType;

    // True if it is an instance or class member; it can be both a class and
    // an instance member in cases where a class variable is overridden
    // by an instance variable
    isInstanceMember: boolean;
    isClassMember: boolean;

    // True if explicitly declared as "ClassVar" and therefore is
    // a type violation if it is overwritten by an instance variable
    isClassVar: boolean;

    // True if the member is read-only, such as with named tuples
    // or frozen dataclasses.
    isReadOnly: boolean;

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

    // The member access should be treated as if it's within a type
    // expression, and errors should be reported if it doesn't conform
    // with type expression rules.
    TypeExpression = 1 << 11,
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

export interface InferenceContext {
    expectedType: Type;
    isTypeIncomplete?: boolean;
    returnTypeOverride?: Type;
}

export interface RequiresSpecializationOptions {
    // Ignore pseudo-generic classes (those with PseudoGenericClass flag set)
    // when determining whether the type requires specialization?
    ignorePseudoGeneric?: boolean;

    // Ignore Self type?
    ignoreSelf?: boolean;

    // Ignore classes whose isTypeArgExplicit flag is false?
    ignoreImplicitTypeArgs?: boolean;
}

export interface IsInstantiableOptions {
    honorTypeVarBounds?: boolean;
}

export interface SelfSpecializeOptions {
    // Override any existing type arguments? By default,
    // existing type arguments are left as is.
    overrideTypeArgs?: boolean;

    // Specialize with "bound" versions of the type parameters?
    useBoundTypeVars?: boolean;
}

export interface ApplyTypeVarOptions {
    typeClassType?: ClassType;
    replaceUnsolved?: {
        scopeIds: TypeVarScopeId[];
        tupleClassType: ClassType | undefined;
        unsolvedExemptTypeVars?: TypeVarType[];
        useUnknown?: boolean;
        eliminateUnsolvedInUnions?: boolean;
    };
}

export interface AddConditionOptions {
    skipSelfCondition?: boolean;
    skipBoundTypeVars?: boolean;
}

// There are cases where tuple types can be infinitely nested. The
// recursion count limit will eventually be hit, but this will create
// deep types that will effectively hang the analyzer. To prevent this,
// we'll limit the depth of the tuple type arguments. This value is
// large enough that we should never hit it in legitimate circumstances.
const maxTupleTypeArgRecursionDepth = 10;

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

    findSignature(signature: FunctionType | OverloadedType): SignatureWithOffsets | undefined {
        // Use the associated overload type if this is a function associated with an overload.
        let effectiveSignature = signature;
        if (isFunction(signature) && signature.priv.overloaded) {
            effectiveSignature = signature.priv.overloaded;
        }

        return this._trackedSignatures.find((s) => {
            return isTypeSame(effectiveSignature, s.type);
        });
    }

    addSignature(signature: FunctionType | OverloadedType, offset: number) {
        // If this function is part of a broader overload, use the overload instead.
        const effectiveSignature = isFunction(signature) ? signature.priv.overloaded ?? signature : signature;

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
    return isUnknown(type) && type.priv.isIncomplete;
}

// Similar to isTypeSame except that type1 is a TypeVar and type2
// can be either a TypeVar of the same type or a union that includes
// conditional types associated with that bound TypeVar.
export function isTypeVarSame(type1: TypeVarType, type2: Type) {
    if (isTypeSame(type1, type2)) {
        return true;
    }

    // If this isn't a bound TypeVar, return false.
    if (isParamSpec(type1) || isTypeVarTuple(type1) || !TypeVarType.hasBound(type1)) {
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
                !conditions.some((condition) => condition.typeVar.priv.nameWithScope === type1.priv.nameWithScope)
            ) {
                isCompatible = false;
            }
        }
    });

    return isCompatible;
}

export function makeInferenceContext(
    expectedType: undefined,
    isTypeIncomplete?: boolean,
    returnTypeOverride?: Type | undefined
): undefined;
export function makeInferenceContext(
    expectedType: Type,
    isTypeIncomplete?: boolean,
    returnTypeOverride?: Type | undefined
): InferenceContext;
export function makeInferenceContext(
    expectedType?: Type,
    isTypeIncomplete?: boolean,
    returnTypeOverride?: Type | undefined
): InferenceContext | undefined;

export function makeInferenceContext(
    expectedType: Type | undefined,
    isTypeIncomplete?: boolean,
    returnTypeOverride?: Type | undefined
): InferenceContext | undefined {
    if (!expectedType) {
        return undefined;
    }

    return { expectedType, isTypeIncomplete, returnTypeOverride };
}

export interface MapSubtypesOptions {
    // Should subtypes in a union be sorted before iteration?
    sortSubtypes?: boolean;

    // Should unions retain redundant literal types if they
    // are present in the original type?
    skipElideRedundantLiterals?: boolean;

    // Should the type alias be retained as is? This is safe only
    // if the caller has already transformed the associated type
    // alias in a way that is compatible with transforms applied
    // to the type.
    retainTypeAlias?: boolean;
}

// Calls a callback for each subtype and combines the results
// into a final type. It performs no memory allocations if the
// transformed type is the same as the original.
export function mapSubtypes(
    type: Type,
    callback: (type: Type) => Type | undefined,
    options?: MapSubtypesOptions
): Type {
    if (isUnion(type)) {
        const subtypes = options?.sortSubtypes ? sortTypes(type.priv.subtypes) : type.priv.subtypes;

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

                let newType = combineTypes(typesToCombine, {
                    skipElideRedundantLiterals: options?.skipElideRedundantLiterals,
                });

                if (options?.retainTypeAlias) {
                    if (type.props?.typeAliasInfo) {
                        newType = TypeBase.cloneForTypeAlias(newType, type.props.typeAliasInfo);
                    }
                } else {
                    // Do our best to retain type aliases.
                    if (isUnion(newType)) {
                        UnionType.addTypeAliasSource(newType, type);
                    }
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
    type: FunctionType | OverloadedType,
    callback: (type: FunctionType) => FunctionType | undefined
): OverloadedType | FunctionType | undefined {
    if (isFunction(type)) {
        return callback(type);
    }

    const newSignatures: FunctionType[] = [];
    let changeMade = false;

    OverloadedType.getOverloads(type).forEach((overload, index) => {
        const newOverload = callback(overload);
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
    const implementation = OverloadedType.getImplementation(type);
    let newImplementation: Type | undefined = implementation;

    if (implementation && isFunction(implementation)) {
        newImplementation = callback(implementation);

        if (newImplementation) {
            changeMade = true;
        }
    }

    if (!changeMade) {
        return type;
    }

    if (newSignatures.length === 1) {
        return newSignatures[0];
    }

    return OverloadedType.create(newSignatures, newImplementation);
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
        if (isUnknown(subtype) && subtype.priv.isIncomplete) {
            return undefined;
        }

        if (isClass(subtype) && subtype.priv.typeArgs) {
            let typeChanged = false;

            if (subtype.priv.tupleTypeArgs) {
                const updatedTupleTypeArgs: TupleTypeArg[] = subtype.priv.tupleTypeArgs.map((tupleTypeArg) => {
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
                        !!subtype.priv.isTypeArgExplicit,
                        !!subtype.priv.isUnpacked
                    );
                }
            } else {
                const updatedTypeArgs = subtype.priv.typeArgs.map((typeArg) => {
                    const newTypeArg = cleanIncompleteUnknown(typeArg, recursionCount);
                    if (newTypeArg !== typeArg) {
                        typeChanged = true;
                    }
                    return newTypeArg;
                });

                if (typeChanged) {
                    return ClassType.specialize(subtype, updatedTypeArgs, !!subtype.priv.isTypeArgExplicit);
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

            const aParamCount = a.shared.parameters.length;
            const bParamCount = bFunc.shared.parameters.length;
            if (aParamCount !== bParamCount) {
                return bParamCount - aParamCount;
            }

            for (let i = 0; i < aParamCount; i++) {
                const aParam = a.shared.parameters[i];
                const bParam = bFunc.shared.parameters[i];
                if (aParam.category !== bParam.category) {
                    return bParam.category - aParam.category;
                }

                const typeComparison = compareTypes(
                    FunctionType.getParamType(a, i),
                    FunctionType.getParamType(bFunc, i)
                );

                if (typeComparison !== 0) {
                    return typeComparison;
                }
            }

            const returnTypeComparison = compareTypes(
                FunctionType.getEffectiveReturnType(a) ?? UnknownType.create(),
                FunctionType.getEffectiveReturnType(bFunc) ?? UnknownType.create()
            );

            if (returnTypeComparison !== 0) {
                return returnTypeComparison;
            }

            const aName = a.shared.name;
            const bName = bFunc.shared.name;

            if (aName < bName) {
                return -1;
            } else if (aName > bName) {
                return 1;
            }

            return 0;
        }

        case TypeCategory.Overloaded: {
            const bOver = b as OverloadedType;

            const aOverloads = OverloadedType.getOverloads(a);
            const bOverloads = OverloadedType.getOverloads(bOver);
            const aOverloadCount = aOverloads.length;
            const bOverloadCount = bOverloads.length;
            if (aOverloadCount !== bOverloadCount) {
                return bOverloadCount - aOverloadCount;
            }

            for (let i = 0; i < aOverloadCount; i++) {
                const typeComparison = compareTypes(aOverloads[i], bOverloads[i]);
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
                } else if (ClassType.isSameGenericClass(a, bClass)) {
                    // Sort by literal value.
                    const aLiteralValue = a.priv.literalValue;
                    const bLiteralValue = bClass.priv.literalValue;

                    if (
                        (typeof aLiteralValue === 'string' && typeof bLiteralValue === 'string') ||
                        (typeof aLiteralValue === 'number' && typeof bLiteralValue === 'number')
                    ) {
                        if (aLiteralValue < bLiteralValue) {
                            return -1;
                        } else if (aLiteralValue > bLiteralValue) {
                            return 1;
                        }
                    }
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
            if (a.shared.typeParams.length > 0 || isTupleClass(a)) {
                if (bClass.shared.typeParams.length === 0) {
                    return 1;
                }
            } else if (bClass.shared.typeParams.length > 0 || isTupleClass(bClass)) {
                return -1;
            }

            // Sort by class name.
            const aName = a.shared.name;
            const bName = (b as ClassType).shared.name;

            if (aName < bName) {
                return -1;
            } else if (aName > bName) {
                return 1;
            }

            // Sort by type argument count.
            const aTypeArgCount = a.priv.typeArgs ? a.priv.typeArgs.length : 0;
            const bTypeArgCount = bClass.priv.typeArgs ? bClass.priv.typeArgs.length : 0;

            if (aTypeArgCount < bTypeArgCount) {
                return -1;
            } else if (aTypeArgCount > bTypeArgCount) {
                return 1;
            }

            // Sort by type argument.
            for (let i = 0; i < aTypeArgCount; i++) {
                const typeComparison = compareTypes(a.priv.typeArgs![i], bClass.priv.typeArgs![i], recursionCount);
                if (typeComparison !== 0) {
                    return typeComparison;
                }
            }

            return 0;
        }

        case TypeCategory.Module: {
            const aName = a.priv.moduleName;
            const bName = (b as ModuleType).priv.moduleName;
            return aName < bName ? -1 : aName === bName ? 0 : 1;
        }

        case TypeCategory.TypeVar: {
            const aName = a.shared.name;
            const bName = (b as TypeVarType).shared.name;
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
        const subtypes = sortSubtypes ? sortTypes(type.priv.subtypes) : type.priv.subtypes;
        subtypes.forEach((subtype, index) => {
            callback(subtype, index, subtypes);
        });
    } else {
        callback(type, 0, [type]);
    }
}

export function someSubtypes(type: Type, callback: (type: Type) => boolean): boolean {
    if (isUnion(type)) {
        return type.priv.subtypes.some((subtype) => {
            return callback(subtype);
        });
    } else {
        return callback(type);
    }
}

export function allSubtypes(type: Type, callback: (type: Type) => boolean): boolean {
    if (isUnion(type)) {
        return type.priv.subtypes.every((subtype) => {
            callback(subtype);
        });
    } else {
        return callback(type);
    }
}

export function doForEachSignature(
    type: FunctionType | OverloadedType,
    callback: (type: FunctionType, index: number) => void
) {
    if (isFunction(type)) {
        callback(type, 0);
    } else {
        OverloadedType.getOverloads(type).forEach((overload, index) => {
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
    if (isUnknown(type1) && type1.priv.isIncomplete) {
        return type1;
    } else if (isUnknown(type2) && type2.priv.isIncomplete) {
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
    // If all of the subtypes are TypeForm types, we know that they
    // are unionable.
    if (subtypes.every((t) => t.props?.typeForm !== undefined)) {
        return true;
    }

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
            if (ClassType.derivesFromAnyOrUnknown(subtype)) {
                anyOrUnknown = true;
            }
        } else if (isClassInstance(subtype)) {
            if (ClassType.derivesFromAnyOrUnknown(subtype)) {
                anyOrUnknown = true;
            }
        }
    });

    return anyOrUnknown;
}

export function getFullNameOfType(type: Type): string | undefined {
    if (type.props?.typeAliasInfo?.shared.fullName) {
        return type.props.typeAliasInfo.shared.fullName;
    }

    switch (type.category) {
        case TypeCategory.Any:
        case TypeCategory.Unknown:
            return 'typing.Any';

        case TypeCategory.Class:
            return type.shared.fullName;

        case TypeCategory.Function:
            return type.shared.fullName;

        case TypeCategory.Module:
            return type.priv.moduleName;

        case TypeCategory.Overloaded: {
            const overloads = OverloadedType.getOverloads(type);
            if (overloads.length > 0) {
                return overloads[0].shared.fullName;
            }

            const impl = OverloadedType.getImplementation(type);
            if (impl && isFunction(impl)) {
                return impl.shared.fullName;
            }
        }
    }

    return undefined;
}

export function addConditionToType<T extends Type>(
    type: T,
    condition: TypeCondition[] | undefined,
    options?: AddConditionOptions
): T {
    if (!condition) {
        return type;
    }

    if (options?.skipSelfCondition) {
        condition = condition.filter((c) => !TypeVarType.isSelf(c.typeVar));
        if (condition.length === 0) {
            return type;
        }
    }

    if (options?.skipBoundTypeVars) {
        condition = condition.filter((c) => c.typeVar.shared.constraints.length > 0);
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
            return TypeBase.cloneForCondition(type, TypeCondition.combine(type.props?.condition, condition));

        case TypeCategory.Overloaded:
            return OverloadedType.create(
                OverloadedType.getOverloads(type).map((t) => addConditionToType(t, condition))
            ) as T;

        case TypeCategory.Class:
            return TypeBase.cloneForCondition(type, TypeCondition.combine(type.props?.condition, condition));

        case TypeCategory.Union:
            return combineTypes(type.priv.subtypes.map((t) => addConditionToType(t, condition))) as T;
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
        case TypeCategory.Overloaded:
        case TypeCategory.Union:
            return undefined;

        case TypeCategory.Class:
        case TypeCategory.Function:
            return type.props?.condition;
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
            type.props?.typeAliasInfo &&
            type.props.typeAliasInfo.shared.name === typeAliasPlaceholder.shared.recursiveAlias?.name
        );
    }

    return (
        findSubtype(type, (subtype) => isTypeVar(subtype) && subtype.shared === typeAliasPlaceholder.shared) !==
        undefined
    );
}

// Recursively transforms all top-level TypeVars that represent recursive
// type aliases into their actual types.
export function transformPossibleRecursiveTypeAlias(type: Type, recursionCount?: number): Type;
export function transformPossibleRecursiveTypeAlias(type: Type | undefined, recursionCount?: number): Type | undefined;
export function transformPossibleRecursiveTypeAlias(type: Type | undefined, recursionCount = 0): Type | undefined {
    if (recursionCount >= maxTypeRecursionCount) {
        return type;
    }
    recursionCount++;

    if (type) {
        const aliasInfo = type.props?.typeAliasInfo;

        if (isTypeVar(type) && type.shared.recursiveAlias?.name && type.shared.boundType) {
            const unspecializedType = TypeBase.isInstance(type)
                ? convertToInstance(type.shared.boundType)
                : type.shared.boundType;

            if (!aliasInfo?.typeArgs || !type.shared.recursiveAlias.typeParams) {
                return transformPossibleRecursiveTypeAlias(unspecializedType, recursionCount);
            }

            const solution = buildSolution(type.shared.recursiveAlias.typeParams, aliasInfo.typeArgs);
            return transformPossibleRecursiveTypeAlias(
                applySolvedTypeVars(unspecializedType, solution),
                recursionCount
            );
        }

        if (isUnion(type) && type.priv.includesRecursiveTypeAlias) {
            let newType = mapSubtypes(type, (subtype) => transformPossibleRecursiveTypeAlias(subtype, recursionCount));

            if (newType !== type && aliasInfo) {
                // Copy the type alias information if present.
                newType = TypeBase.cloneForTypeAlias(newType, aliasInfo);
            }

            return newType;
        }
    }

    return type;
}

export function getTypeVarScopeId(type: Type): TypeVarScopeId | undefined {
    if (isClass(type)) {
        return type.shared.typeVarScopeId;
    }

    if (isFunction(type)) {
        return type.shared.typeVarScopeId;
    }

    if (isTypeVar(type)) {
        return type.priv.scopeId;
    }

    return undefined;
}

// This is similar to getTypeVarScopeId except that it includes
// the secondary scope IDs for functions.
export function getTypeVarScopeIds(type: Type): TypeVarScopeId[] {
    const scopeIds: TypeVarScopeId[] = [];

    const scopeId = getTypeVarScopeId(type);
    if (scopeId) {
        scopeIds.push(scopeId);
    }

    if (isFunction(type)) {
        if (type.priv.constructorTypeVarScopeId) {
            scopeIds.push(type.priv.constructorTypeVarScopeId);
        }
    }

    return scopeIds;
}

// Specializes the class with "Unknown" type args (or the equivalent for ParamSpecs
// or TypeVarTuples).
export function specializeWithUnknownTypeArgs(type: ClassType, tupleClassType?: ClassType): ClassType {
    if (type.shared.typeParams.length === 0) {
        return type;
    }

    if (isTupleClass(type)) {
        return ClassType.cloneIncludeSubclasses(
            specializeTupleClass(
                type,
                [{ type: UnknownType.create(), isUnbounded: true }],
                /* isTypeArgExplicit */ false
            ),
            !!type.priv.includeSubclasses
        );
    }

    return ClassType.specialize(
        type,
        type.shared.typeParams.map((param) => getUnknownForTypeVar(param, tupleClassType)),
        /* isTypeArgExplicit */ false,
        /* includeSubclasses */ type.priv.includeSubclasses
    );
}

// Returns "Unknown" for simple TypeVars or the equivalent for a ParamSpec.
export function getUnknownForTypeVar(typeVar: TypeVarType, tupleClassType?: ClassType): Type {
    if (isParamSpec(typeVar)) {
        return ParamSpecType.getUnknown();
    }

    if (isTypeVarTuple(typeVar) && tupleClassType) {
        return getUnknownForTypeVarTuple(tupleClassType);
    }

    return UnknownType.create();
}

export function getUnknownForTypeVarTuple(tupleClassType: ClassType): Type {
    assert(isInstantiableClass(tupleClassType) && ClassType.isBuiltIn(tupleClassType, 'tuple'));

    return ClassType.cloneAsInstance(
        specializeTupleClass(
            tupleClassType,
            [{ type: UnknownType.create(), isUnbounded: true }],
            /* isTypeArgExplicit */ true,
            /* isUnpacked */ true
        )
    );
}

// Returns the equivalent of "Callable[..., Unknown]".
export function getUnknownTypeForCallable(): FunctionType {
    const newFunction = FunctionType.createSynthesizedInstance('', FunctionTypeFlags.GradualCallableForm);
    FunctionType.addDefaultParams(newFunction);
    newFunction.shared.declaredReturnType = UnknownType.create();
    return newFunction;
}

// If the class is generic and not already specialized, this function
// "self specializes" the class, filling in its own type parameters
// as type arguments.
export function selfSpecializeClass(type: ClassType, options?: SelfSpecializeOptions): ClassType {
    // We can't use requiresTypeArgs(type) here because it returns false
    // if the type parameters have default values.
    if (type.shared.typeParams.length === 0) {
        return type;
    }

    if (type.priv.typeArgs && !options?.overrideTypeArgs) {
        return type;
    }

    const typeParams = type.shared.typeParams.map((typeParam) => {
        if (isTypeVarTuple(typeParam)) {
            typeParam = TypeVarType.cloneForUnpacked(typeParam);
        }

        return options?.useBoundTypeVars ? TypeVarType.cloneAsBound(typeParam) : typeParam;
    });
    return ClassType.specialize(type, typeParams);
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
    const tupleClass = classType.shared.mro.find((mroClass) => isInstantiableClass(mroClass) && isTupleClass(mroClass));
    if (!tupleClass || !isInstantiableClass(tupleClass)) {
        return undefined;
    }

    if (ClassType.isSameGenericClass(classType, tupleClass)) {
        return classType;
    }

    const solution = buildSolutionFromSpecializedClass(classType);
    return applySolvedTypeVars(tupleClass, solution) as ClassType;
}

export function isLiteralType(type: ClassType): boolean {
    return TypeBase.isInstance(type) && type.priv.literalValue !== undefined;
}

export function isLiteralTypeOrUnion(type: Type, allowNone = false): boolean {
    if (isClassInstance(type)) {
        if (allowNone && isNoneInstance(type)) {
            return true;
        }

        return type.priv.literalValue !== undefined;
    }

    if (isUnion(type)) {
        return !findSubtype(type, (subtype) => {
            if (!isClassInstance(subtype)) {
                return true;
            }

            if (isNoneInstance(subtype)) {
                return !allowNone;
            }

            return subtype.priv.literalValue === undefined;
        });
    }

    return false;
}

export function isLiteralLikeType(type: ClassType): boolean {
    if (type.priv.literalValue !== undefined) {
        return true;
    }

    if (ClassType.isBuiltIn(type, 'LiteralString')) {
        return true;
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
                if (isLiteralLikeType(classType)) {
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
        if (type.priv.literalValue !== undefined && ClassType.isBuiltIn(type)) {
            return type.shared.name;
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

export function stripTypeForm(type: Type): Type {
    if (type.props?.typeForm) {
        return TypeBase.cloneWithTypeForm(type, undefined);
    }

    return type;
}

export function stripTypeFormRecursive(type: Type, recursionCount = 0): Type {
    if (recursionCount > maxTypeRecursionCount) {
        return type;
    }
    recursionCount++;

    if (type.props?.typeForm) {
        type = TypeBase.cloneWithTypeForm(type, undefined);
    }

    return mapSubtypes(type, (subtype) => stripTypeFormRecursive(subtype, recursionCount));
}

export function getUnionSubtypeCount(type: Type): number {
    if (isUnion(type)) {
        return type.priv.subtypes.length;
    }

    return 1;
}

export function isEllipsisType(type: Type): boolean {
    return isAny(type) && type.priv.isEllipsis;
}

export function isProperty(type: Type) {
    return isClassInstance(type) && ClassType.isPropertyClass(type);
}

export function isCallableType(type: Type): boolean {
    if (isFunction(type) || isOverloaded(type) || isAnyOrUnknown(type)) {
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
        return type.priv.subtypes.every((subtype) => isCallableType(subtype));
    }

    return false;
}

export function isDescriptorInstance(type: Type, requireSetter = false): boolean {
    if (isUnion(type)) {
        return type.priv.subtypes.every((subtype) => isMaybeDescriptorInstance(subtype, requireSetter));
    }

    return isMaybeDescriptorInstance(type, requireSetter);
}

export function isMaybeDescriptorInstance(type: Type, requireSetter = false): boolean {
    if (isUnion(type)) {
        return type.priv.subtypes.some((subtype) => isMaybeDescriptorInstance(subtype, requireSetter));
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

export function isTupleGradualForm(type: Type) {
    return (
        isClassInstance(type) &&
        isTupleClass(type) &&
        type.priv.tupleTypeArgs &&
        type.priv.tupleTypeArgs.length === 1 &&
        isAnyOrUnknown(type.priv.tupleTypeArgs[0].type) &&
        type.priv.tupleTypeArgs[0].isUnbounded
    );
}

export function isTupleClass(type: ClassType) {
    return ClassType.isBuiltIn(type, 'tuple');
}

// Indicates whether the type is a tuple class of
// the form tuple[x, ...] where the number of elements
// in the tuple is unknown.
export function isUnboundedTupleClass(type: ClassType) {
    return type.priv.tupleTypeArgs?.some(
        (t) => t.isUnbounded || isUnpackedTypeVarTuple(t.type) || isUnpackedTypeVar(t.type)
    );
}

// Indicates whether the specified index is within range and its type is unambiguous
// in that it doesn't involve any element ranges that are of indeterminate length.
export function isTupleIndexUnambiguous(type: ClassType, index: number) {
    if (!type.priv.tupleTypeArgs) {
        return false;
    }

    const unboundedIndex = type.priv.tupleTypeArgs.findIndex(
        (t) => t.isUnbounded || isUnpackedTypeVarTuple(t.type) || isUnpackedTypeVar(t.type)
    );

    if (index < 0) {
        const lowerIndexLimit = unboundedIndex < 0 ? 0 : unboundedIndex;
        index += type.priv.tupleTypeArgs.length;
        return index >= lowerIndexLimit;
    }

    const upperIndexLimit = unboundedIndex < 0 ? type.priv.tupleTypeArgs.length : unboundedIndex;
    return index < upperIndexLimit;
}

// Partially specializes a type within the context of a specified
// (presumably specialized) class. Optionally specializes the `Self`
// type variables, replacing them with selfClass.
export function partiallySpecializeType(
    type: Type,
    contextClassType: ClassType,
    typeClassType: ClassType | undefined,
    selfClass?: ClassType | TypeVarType
): Type {
    // If the context class is not specialized (or doesn't need specialization),
    // then there's no need to do any more work.
    if (ClassType.isUnspecialized(contextClassType) && !selfClass) {
        return type;
    }

    // Partially specialize the type using the specialized class type vars.
    const solution = buildSolutionFromSpecializedClass(contextClassType);

    if (selfClass) {
        addSolutionForSelfType(solution, contextClassType, selfClass);
    }

    let result = applySolvedTypeVars(type, solution, { typeClassType });

    // If this is a property, we may need to partially specialize the
    // access methods associated with it.
    if (isClass(result)) {
        if (result.priv.fgetInfo || result.priv.fsetInfo || result.priv.fdelInfo) {
            function updatePropertyMethodInfo(methodInfo?: PropertyMethodInfo): PropertyMethodInfo | undefined {
                if (!methodInfo) {
                    return undefined;
                }

                return {
                    methodType: partiallySpecializeType(
                        methodInfo.methodType,
                        contextClassType,
                        typeClassType,
                        selfClass
                    ) as FunctionType,
                    classType: methodInfo.classType,
                };
            }

            result = TypeBase.cloneType(result);
            result.priv.fgetInfo = updatePropertyMethodInfo(result.priv.fgetInfo);
            result.priv.fsetInfo = updatePropertyMethodInfo(result.priv.fsetInfo);
            result.priv.fdelInfo = updatePropertyMethodInfo(result.priv.fdelInfo);
        }
    }

    return result;
}

export function addSolutionForSelfType(
    solution: ConstraintSolution,
    contextClassType: ClassType,
    selfClass: ClassType | TypeVarType
) {
    const synthesizedSelfTypeVar = synthesizeTypeVarForSelfCls(contextClassType, /* isClsParam */ false);
    const selfInstance = convertToInstance(selfClass);

    // We can't call stripLiteralValue here because that method requires the type evaluator.
    // Instead, we'll do a simplified version of it here.
    const selfWithoutLiteral = mapSubtypes(selfInstance, (subtype) => {
        if (isClass(subtype)) {
            if (subtype.priv.literalValue !== undefined) {
                return ClassType.cloneWithLiteral(subtype, /* value */ undefined);
            }
        }

        return subtype;
    });

    solution.setType(synthesizedSelfTypeVar, selfWithoutLiteral);
}

// Looks for duplicate function types within the type and ensures that
// if they are generic, they have unique type variables.
export function ensureSignaturesAreUnique<T extends Type>(
    type: T,
    signatureTracker: UniqueSignatureTracker,
    expressionOffset: number
): T {
    const transformer = new UniqueFunctionSignatureTransformer(signatureTracker, expressionOffset);
    return transformer.apply(type, 0) as T;
}

export function makeFunctionTypeVarsBound(type: FunctionType | OverloadedType): FunctionType | OverloadedType {
    const scopeIds: TypeVarScopeId[] = [];
    doForEachSignature(type, (signature) => {
        const localScopeId = getTypeVarScopeId(signature);
        if (localScopeId) {
            scopeIds.push(localScopeId);
        }
    });

    return makeTypeVarsBound(type, scopeIds);
}

export function makeTypeVarsBound<T extends TypeBase<any>>(type: T, scopeIds: TypeVarScopeId[] | undefined): T;
export function makeTypeVarsBound(type: Type, scopeIds: TypeVarScopeId[] | undefined): Type {
    if (scopeIds && scopeIds.length === 0) {
        return type;
    }

    const transformer = new BoundTypeVarTransform(scopeIds);
    return transformer.apply(type, 0);
}

export function makeTypeVarsFree<T extends TypeBase<any>>(type: T, scopeIds: TypeVarScopeId[]): T;
export function makeTypeVarsFree(type: Type, scopeIds: TypeVarScopeId[]): Type {
    if (scopeIds.length === 0) {
        return type;
    }

    const transformer = new FreeTypeVarTransform(scopeIds);
    return transformer.apply(type, 0);
}

// Specializes a (potentially generic) type by substituting
// type variables from a type var map.
export function applySolvedTypeVars(type: Type, solution: ConstraintSolution, options: ApplyTypeVarOptions = {}): Type {
    // Use a shortcut if constraints is empty and no transform is necessary.
    if (solution.isEmpty() && !options.replaceUnsolved) {
        return type;
    }

    const transformer = new ApplySolvedTypeVarsTransformer(solution, options);
    return transformer.apply(type, 0);
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
    if (typeVar.shared.isDefaultExplicit && requiresSpecialization(typeVar.shared.defaultType)) {
        const validator = new TypeVarDefaultValidator(liveTypeParams, invalidTypeVars);
        validator.apply(typeVar.shared.defaultType, 0);
    }
}

// During bidirectional type inference for constructors, an "expected type"
// is used to prepopulate the type var map. This is problematic when the
// expected type uses TypeVars that are not part of the context of the
// class we are constructing. We'll replace these type variables with
// so-called "unification" type variables.
export function transformExpectedType(
    expectedType: Type,
    liveTypeVarScopes: TypeVarScopeId[],
    usageOffset: number | undefined
): Type {
    const transformer = new UnificationTypeTransformer(liveTypeVarScopes, usageOffset);
    return transformer.apply(expectedType, 0);
}

// Given a protocol class (or abstract class), this function returns
// a set of all the symbols (indexed by symbol name) that are part of
// that protocol and its protocol parent classes. If a same-named symbol
// appears in a parent and a child, the child overrides the parent.
export function getProtocolSymbols(classType: ClassType) {
    const symbolMap = new Map<string, ClassMember>();

    if ((classType.shared.flags & ClassTypeFlags.ProtocolClass) !== 0) {
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

    classType.shared.baseClasses.forEach((baseClass) => {
        if (isClass(baseClass) && (baseClass.shared.flags & classFlags) !== 0) {
            getProtocolSymbolsRecursive(baseClass, symbolMap, classFlags, recursionCount + 1);
        }
    });

    ClassType.getSymbolTable(classType).forEach((symbol, name) => {
        if (!symbol.isIgnoredForProtocolMatch()) {
            symbolMap.set(name, {
                symbol,
                classType,
                unspecializedClassType: classType,
                isInstanceMember: symbol.isInstanceMember(),
                isClassMember: symbol.isClassMember(),
                isClassVar: isEffectivelyClassVar(symbol, /* isDataclass */ false),
                isReadOnly: false,
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

    if (type.priv.tupleTypeArgs) {
        type.priv.tupleTypeArgs.forEach((typeArgInfo) => {
            doForEachSubtype(typeArgInfo.type, (subtype) => {
                const childDepth = getContainerDepth(subtype, recursionCount);
                maxChildDepth = Math.max(childDepth, maxChildDepth);
            });
        });
    } else if (type.priv.typeArgs) {
        type.priv.typeArgs.forEach((typeArg) => {
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
    const metaclass = classType.shared.effectiveMetaclass;

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
                skipMroClass = isClassInstance(classType) ? ClassType.cloneAsInstantiable(classType) : classType;
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
                    const classType = isAnyOrUnknown(mroClass) ? mroClass : UnknownType.create();

                    // The class derives from an unknown type, so all bets are off
                    // when trying to find a member. Return an unknown symbol.
                    const cm: ClassMember = {
                        symbol: Symbol.createWithType(SymbolFlags.None, mroClass),
                        isInstanceMember: false,
                        isClassMember: true,
                        isClassVar: false,
                        classType,
                        unspecializedClassType: classType,
                        isReadOnly: false,
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
                            unspecializedClassType: mroClass,
                            isReadOnly: isMemberReadOnly(specializedMroClass, memberName),
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
                let symbol = memberFields.get(memberName);

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

                        // Handle the special case of a __call__ class member in a partial class.
                        if (
                            memberName === '__call__' &&
                            classType.priv.partialCallType &&
                            ClassType.isSameGenericClass(
                                TypeBase.isInstance(classType) ? ClassType.cloneAsInstantiable(classType) : classType,
                                specializedMroClass
                            )
                        ) {
                            symbol = Symbol.createWithType(SymbolFlags.ClassMember, classType.priv.partialCallType);
                        }

                        const cm: ClassMember = {
                            symbol,
                            isInstanceMember,
                            isClassMember,
                            isClassVar: isEffectivelyClassVar(symbol, isDataclass),
                            classType: specializedMroClass,
                            unspecializedClassType: mroClass,
                            isReadOnly: false,
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
            unspecializedClassType: classType,
            isReadOnly: false,
            isTypeDeclared: false,
            skippedUndeclaredType: false,
        };
        yield cm;
    }

    return undefined;
}

// Checks for whether the member is effectively read only because it
// belongs to a frozen dataclass or a named tuple.
export function isMemberReadOnly(classType: ClassType, name: string): boolean {
    if (ClassType.hasNamedTupleEntry(classType, name)) {
        return true;
    }

    if (ClassType.isDataClassFrozen(classType)) {
        const dcEntries = classType.shared?.dataClassEntries;
        if (dcEntries?.some((entry) => entry.name === name)) {
            return true;
        }
    }

    return false;
}

export function* getClassIterator(classType: Type, flags = ClassIteratorFlags.Default, skipMroClass?: ClassType) {
    if (isClass(classType)) {
        let foundSkipMroClass = skipMroClass === undefined;

        for (const mroClass of classType.shared.mro) {
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
            const specializedMroClass = partiallySpecializeType(mroClass, classType, /* typeClassType */ undefined);

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
        const specializedMroClass = partiallySpecializeType(mroClass, classType, /* typeClassType */ undefined);

        if (isClass(specializedMroClass)) {
            ClassType.getSymbolTable(specializedMroClass).forEach((symbol, name) => {
                if (!symbol.isIgnoredForProtocolMatch() && symbol.hasTypedDeclarations()) {
                    memberMap.set(name, {
                        classType: specializedMroClass,
                        unspecializedClassType: mroClass,
                        symbol,
                        isInstanceMember: symbol.isInstanceMember(),
                        isClassMember: symbol.isClassMember(),
                        isClassVar: isEffectivelyClassVar(symbol, ClassType.isDataClass(specializedMroClass)),
                        isReadOnly: isMemberReadOnly(specializedMroClass, name),
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
        if (typeVarScopeId && type2.priv.scopeId !== typeVarScopeId) {
            continue;
        }

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
export function getTypeVarArgsRecursive(type: Type, recursionCount = 0): TypeVarType[] {
    if (recursionCount > maxTypeRecursionCount) {
        return [];
    }
    recursionCount++;

    const aliasInfo = type.props?.typeAliasInfo;
    if (aliasInfo) {
        const combinedList: TypeVarType[] = [];

        if (aliasInfo.typeArgs) {
            aliasInfo?.typeArgs.forEach((typeArg) => {
                addTypeVarsToListIfUnique(combinedList, getTypeVarArgsRecursive(typeArg, recursionCount));
            });

            return combinedList;
        }

        if (aliasInfo.shared.typeParams) {
            aliasInfo.shared.typeParams.forEach((typeParam) => {
                addTypeVarsToListIfUnique(combinedList, [typeParam]);
            });

            return combinedList;
        }
    }

    if (isTypeVar(type)) {
        // Don't return any recursive type alias placeholders.
        if (type.shared.recursiveAlias) {
            return [];
        }

        // Don't return any bound type variables.
        if (TypeVarType.isBound(type)) {
            return [];
        }

        // Don't return any P.args or P.kwargs types.
        if (isParamSpec(type) && type.priv.paramSpecAccess) {
            return [TypeVarType.cloneForParamSpecAccess(type, /* access */ undefined)];
        }

        return [TypeBase.isInstantiable(type) ? TypeVarType.cloneAsInstance(type) : type];
    }

    if (isClass(type)) {
        const combinedList: TypeVarType[] = [];
        const typeArgs = type.priv.tupleTypeArgs ? type.priv.tupleTypeArgs.map((e) => e.type) : type.priv.typeArgs;
        if (typeArgs) {
            typeArgs.forEach((typeArg) => {
                addTypeVarsToListIfUnique(combinedList, getTypeVarArgsRecursive(typeArg, recursionCount));
            });
        }

        return combinedList;
    }

    if (isUnion(type)) {
        const combinedList: TypeVarType[] = [];
        doForEachSubtype(type, (subtype) => {
            addTypeVarsToListIfUnique(combinedList, getTypeVarArgsRecursive(subtype, recursionCount));
        });
        return combinedList;
    }

    if (isFunction(type)) {
        const combinedList: TypeVarType[] = [];

        for (let i = 0; i < type.shared.parameters.length; i++) {
            addTypeVarsToListIfUnique(
                combinedList,
                getTypeVarArgsRecursive(FunctionType.getParamType(type, i), recursionCount)
            );
        }

        const returnType = FunctionType.getEffectiveReturnType(type);
        if (returnType) {
            addTypeVarsToListIfUnique(combinedList, getTypeVarArgsRecursive(returnType, recursionCount));
        }

        return combinedList;
    }

    return [];
}

// Creates a specialized version of the class, filling in any unspecified
// type arguments with Unknown or default value.
export function specializeWithDefaultTypeArgs(type: ClassType): ClassType {
    if (type.shared.typeParams.length === 0 || type.priv.typeArgs || !type.shared.typeVarScopeId) {
        return type;
    }

    const solution = new ConstraintSolution();

    return applySolvedTypeVars(type, solution, {
        replaceUnsolved: { scopeIds: [type.shared.typeVarScopeId], tupleClassType: undefined },
    }) as ClassType;
}

// Builds a mapping between type parameters and their specialized
// types. For example, if the generic type is Dict[_T1, _T2] and the
// specialized type is Dict[str, int], it returns a map that associates
// _T1 with str and _T2 with int.
export function buildSolutionFromSpecializedClass(classType: ClassType): ConstraintSolution {
    const typeParams = ClassType.getTypeParams(classType);
    let typeArgs: Type[] | undefined;

    if (classType.priv.tupleTypeArgs) {
        typeArgs = [
            convertToInstance(
                specializeTupleClass(
                    classType,
                    classType.priv.tupleTypeArgs,
                    classType.priv.isTypeArgExplicit,
                    /* isUnpacked */ true
                )
            ),
        ];
    } else {
        typeArgs = classType.priv.typeArgs;
    }

    return buildSolution(typeParams, typeArgs);
}

export function buildSolution(typeParams: TypeVarType[], typeArgs: Type[] | undefined): ConstraintSolution {
    const solution = new ConstraintSolution();

    if (!typeArgs) {
        return solution;
    }

    typeParams.forEach((typeParam, index) => {
        if (index < typeArgs.length) {
            solution.setType(typeParam, typeArgs[index]);
        }
    });

    return solution;
}

// Determines the specialized base class type that srcType derives from.
export function specializeForBaseClass(srcType: ClassType, baseClass: ClassType): ClassType {
    const typeParams = ClassType.getTypeParams(baseClass);

    // If there are no type parameters for the specified base class,
    // no specialization is required.
    if (typeParams.length === 0) {
        return baseClass;
    }

    const solution = buildSolutionFromSpecializedClass(srcType);
    const specializedType = applySolvedTypeVars(baseClass, solution);
    assert(isInstantiableClass(specializedType));
    return specializedType as ClassType;
}

export function derivesFromStdlibClass(classType: ClassType, className: string) {
    return classType.shared.mro.some((mroClass) => isClass(mroClass) && ClassType.isBuiltIn(mroClass, className));
}

// If ignoreUnknown is true, an unknown base class is ignored when
// checking for derivation. If ignoreUnknown is false, a return value
// of true is assumed.
export function derivesFromClassRecursive(classType: ClassType, baseClassToFind: ClassType, ignoreUnknown: boolean) {
    if (ClassType.isSameGenericClass(classType, baseClassToFind)) {
        return true;
    }

    for (const baseClass of classType.shared.baseClasses) {
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
    selfType.shared.isSynthesized = true;
    selfType.shared.isSynthesizedSelf = true;
    selfType.priv.scopeId = scopeId;
    selfType.priv.scopeName = '';
    selfType.priv.nameWithScope = TypeVarType.makeNameWithScope(selfType.shared.name, scopeId, selfType.priv.scopeName);

    const boundType = ClassType.specialize(
        classType,
        /* typeArgs */ undefined,
        /* isTypeArgExplicit */ false,
        /* includeSubclasses */ !!classType.priv.includeSubclasses
    );

    selfType.shared.boundType = ClassType.cloneAsInstance(boundType);

    return isClsParam ? TypeVarType.cloneAsInstantiable(selfType) : selfType;
}

// Returns the declared "return" type (the type returned from a return statement)
// if it was declared, or undefined otherwise.
export function getDeclaredGeneratorReturnType(functionType: FunctionType): Type | undefined {
    const returnType = FunctionType.getEffectiveReturnType(functionType);
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
                return subtype.priv.typeArgs && subtype.priv.typeArgs.length >= 1
                    ? subtype.priv.typeArgs[0]
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
        type.shared.mro.some((mroClass) => isClass(mroClass) && ClassType.isBuiltIn(mroClass, 'type'))
    );
}

export function isMetaclassInstance(type: Type): boolean {
    return (
        isClassInstance(type) &&
        type.shared.mro.some((mroClass) => isClass(mroClass) && ClassType.isBuiltIn(mroClass, 'type'))
    );
}

export function isEffectivelyInstantiable(type: Type, options?: IsInstantiableOptions, recursionCount = 0): boolean {
    if (recursionCount > maxTypeRecursionCount) {
        return false;
    }

    recursionCount++;

    if (TypeBase.isInstantiable(type)) {
        return true;
    }

    if (options?.honorTypeVarBounds && isTypeVar(type) && type.shared.boundType) {
        if (isEffectivelyInstantiable(type.shared.boundType, options, recursionCount)) {
            return true;
        }
    }

    // Handle the special case of 'type' (or subclasses thereof),
    // which are instantiable.
    if (isMetaclassInstance(type)) {
        return true;
    }

    if (isUnion(type)) {
        return type.priv.subtypes.every((subtype) => isEffectivelyInstantiable(subtype, options, recursionCount));
    }

    return false;
}

export function convertToInstance(type: ParamSpecType, includeSubclasses?: boolean): ParamSpecType;
export function convertToInstance(type: TypeVarTupleType, includeSubclasses?: boolean): TypeVarTupleType;
export function convertToInstance(type: TypeVarType, includeSubclasses?: boolean): TypeVarType;
export function convertToInstance(type: Type, includeSubclasses?: boolean): Type;
export function convertToInstance(type: Type, includeSubclasses = true): Type {
    // See if we've already performed this conversion and cached it.
    if (type.cached?.instanceType && includeSubclasses) {
        return type.cached.instanceType;
    }

    let result = mapSubtypes(
        type,
        (subtype) => {
            switch (subtype.category) {
                case TypeCategory.Class: {
                    // Handle type[x] as a special case.
                    if (ClassType.isBuiltIn(subtype, 'type')) {
                        if (TypeBase.isInstance(subtype)) {
                            if (!subtype.priv.typeArgs || subtype.priv.typeArgs.length < 1) {
                                return UnknownType.create();
                            } else {
                                return subtype.priv.typeArgs[0];
                            }
                        } else {
                            if (subtype.priv.typeArgs && subtype.priv.typeArgs.length > 0) {
                                if (!isAnyOrUnknown(subtype.priv.typeArgs[0])) {
                                    return convertToInstantiable(subtype.priv.typeArgs[0]);
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
        },
        {
            skipElideRedundantLiterals: true,
        }
    );

    // Copy over any type alias information.
    const aliasInfo = type.props?.typeAliasInfo;
    if (aliasInfo && type !== result) {
        result = TypeBase.cloneForTypeAlias(result, aliasInfo);
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
    classType.shared.mro.forEach((mroClass) => {
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
        const metaclass = classType.shared.effectiveMetaclass;
        if (metaclass && isInstantiableClass(metaclass)) {
            for (const mroClass of metaclass.shared.mro) {
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
    if (moduleType.priv.loaderFields) {
        moduleType.priv.loaderFields.forEach((symbol, name) => {
            symbolTable.set(name, symbol);
        });
    }

    moduleType.priv.fields.forEach((symbol, name) => {
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

        override visitTypeAlias(type: Type) {
            // Don't explore type aliases.
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
                if (FunctionType.isGradualCallableForm(type)) {
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
    const aliasInfo = type.props?.typeAliasInfo;
    if (aliasInfo?.typeArgs) {
        if (aliasInfo.typeArgs.some((typeArg) => isPartlyUnknown(typeArg, recursionCount))) {
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
        if (!type.priv.includeSubclasses) {
            return false;
        }

        if (!ClassType.isPseudoGenericClass(type)) {
            const typeArgs = type.priv.tupleTypeArgs?.map((t) => t.type) || type.priv.typeArgs;
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
    if (isOverloaded(type)) {
        return OverloadedType.getOverloads(type).some((overload) => {
            return isPartlyUnknown(overload, recursionCount);
        });
    }

    if (isFunction(type)) {
        for (let i = 0; i < type.shared.parameters.length; i++) {
            // Ignore parameters such as "*" that have no name.
            if (type.shared.parameters[i].name) {
                const paramType = FunctionType.getParamType(type, i);
                if (isPartlyUnknown(paramType, recursionCount)) {
                    return true;
                }
            }
        }

        if (
            type.shared.declaredReturnType &&
            !FunctionType.isParamSpecValue(type) &&
            isPartlyUnknown(type.shared.declaredReturnType, recursionCount)
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
    if (!classType.priv.typeArgs || classType.priv.typeArgs.length !== 1 || !isUnion(classType.priv.typeArgs[0])) {
        return classType;
    }

    return combineTypes(
        classType.priv.typeArgs[0].priv.subtypes.map((subtype) => {
            return ClassType.specialize(classType, [subtype]);
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
                tupleClass = subtype.shared.mro.find(
                    (mroClass) => isClass(mroClass) && isTupleClass(mroClass) && !isUnboundedTupleClass(mroClass)
                ) as ClassType | undefined;
            }

            if (tupleClass && isClass(tupleClass) && tupleClass.priv.tupleTypeArgs) {
                if (tupleEntries) {
                    if (tupleEntries.length === tupleClass.priv.tupleTypeArgs.length) {
                        tupleClass.priv.tupleTypeArgs.forEach((entry, index) => {
                            tupleEntries![index].push(entry.type);
                        });
                    } else {
                        isValid = false;
                    }
                } else {
                    tupleEntries = tupleClass.priv.tupleTypeArgs.map((entry) => [entry.type]);
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

export function combineTupleTypeArgs(typeArgs: TupleTypeArg[]): Type {
    const typesToCombine: Type[] = [];

    typeArgs.forEach((t) => {
        if (isTypeVar(t.type)) {
            if (isUnpackedTypeVarTuple(t.type)) {
                // Treat the unpacked TypeVarTuple as a union.
                typesToCombine.push(TypeVarType.cloneForUnpacked(t.type, /* isInUnion */ true));
                return;
            }

            if (isUnpackedTypeVar(t.type)) {
                if (
                    t.type.shared.boundType &&
                    isClassInstance(t.type.shared.boundType) &&
                    isTupleClass(t.type.shared.boundType) &&
                    t.type.shared.boundType.priv.tupleTypeArgs
                ) {
                    typesToCombine.push(combineTupleTypeArgs(t.type.shared.boundType.priv.tupleTypeArgs));
                }
                return;
            }
        }

        typesToCombine.push(t.type);
    });

    return combineTypes(typesToCombine);
}

// Tuples require special handling for specialization. This method computes
// the "effective" type argument, which is a union of the variadic type
// arguments.
export function specializeTupleClass(
    classType: ClassType,
    typeArgs: TupleTypeArg[],
    isTypeArgExplicit = true,
    isUnpacked = false
): ClassType {
    const clonedClassType = ClassType.specialize(
        classType,
        [combineTupleTypeArgs(typeArgs)],
        isTypeArgExplicit,
        /* includeSubclasses */ undefined,
        typeArgs
    );

    if (isUnpacked) {
        clonedClassType.priv.isUnpacked = true;
    }

    return clonedClassType;
}

function _expandUnpackedTypeVarTupleUnion(type: Type) {
    if (isClassInstance(type) && isTupleClass(type) && type.priv.tupleTypeArgs && type.priv.isUnpacked) {
        return combineTypes(type.priv.tupleTypeArgs.map((t) => t.type));
    }

    return type;
}

// If this is an unpacked type, returns the type as no longer unpacked.
export function makePacked(type: Type): Type {
    if (isUnpackedClass(type)) {
        return ClassType.cloneForPacked(type);
    }

    if (isUnpackedTypeVarTuple(type) && !type.priv.isInUnion) {
        return TypeVarType.cloneForPacked(type);
    }

    if (isUnpackedTypeVar(type)) {
        return TypeVarType.cloneForPacked(type);
    }

    return type;
}

export function makeUnpacked(type: Type): Type {
    if (isClass(type)) {
        return ClassType.cloneForUnpacked(type);
    }

    if (isTypeVarTuple(type) && !type.priv.isInUnion) {
        return TypeVarType.cloneForUnpacked(type);
    }

    if (isTypeVar(type)) {
        return TypeVarType.cloneForUnpacked(type);
    }

    return type;
}

// If the declared return type for the function is a Generator or AsyncGenerator,
// returns the type arguments for the type.
export function getGeneratorTypeArgs(returnType: Type): Type[] | undefined {
    if (isClassInstance(returnType)) {
        if (ClassType.isBuiltIn(returnType, ['Generator', 'AsyncGenerator'])) {
            return returnType.priv.typeArgs;
        } else if (ClassType.isBuiltIn(returnType, 'AwaitableGenerator')) {
            // AwaitableGenerator has four type arguments, and the first 3
            // correspond to the generator.
            return returnType.priv.typeArgs?.slice(0, 3);
        }
    }

    return undefined;
}

export function requiresTypeArgs(classType: ClassType) {
    if (classType.shared.typeParams.length > 0) {
        const firstTypeParam = classType.shared.typeParams[0];

        // If there are type parameters, type arguments are needed.
        // The exception is if type parameters have been synthesized
        // for classes that have untyped constructors.
        if (firstTypeParam.shared.isSynthesized) {
            return false;
        }

        // If the first type parameter has a default type, then no
        // type arguments are needed.
        if (firstTypeParam.shared.isDefaultExplicit) {
            return false;
        }

        return true;
    }

    // There are a few built-in special classes that require
    // type arguments even though typeParams is empty.
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

        if (specialClasses.some((t) => t === (classType.priv.aliasName || classType.shared.name))) {
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
    if (type.props?.condition) {
        return true;
    }

    switch (type.category) {
        case TypeCategory.Class: {
            if (ClassType.isPseudoGenericClass(type) && options?.ignorePseudoGeneric) {
                return false;
            }

            if (!type.priv.isTypeArgExplicit && options?.ignoreImplicitTypeArgs) {
                return false;
            }

            if (type.priv.tupleTypeArgs) {
                if (
                    type.priv.tupleTypeArgs.some((typeArg) =>
                        requiresSpecialization(typeArg.type, options, recursionCount)
                    )
                ) {
                    return true;
                }
            }

            if (type.priv.typeArgs) {
                return type.priv.typeArgs.some((typeArg) => requiresSpecialization(typeArg, options, recursionCount));
            }

            return ClassType.getTypeParams(type).length > 0;
        }

        case TypeCategory.Function: {
            for (let i = 0; i < type.shared.parameters.length; i++) {
                if (requiresSpecialization(FunctionType.getParamType(type, i), options, recursionCount)) {
                    return true;
                }
            }

            const declaredReturnType =
                type.priv.specializedTypes && type.priv.specializedTypes.returnType
                    ? type.priv.specializedTypes.returnType
                    : type.shared.declaredReturnType;
            if (declaredReturnType) {
                if (requiresSpecialization(declaredReturnType, options, recursionCount)) {
                    return true;
                }
            } else if (type.priv.inferredReturnType) {
                if (requiresSpecialization(type.priv.inferredReturnType, options, recursionCount)) {
                    return true;
                }
            }

            return false;
        }

        case TypeCategory.Overloaded: {
            const overloads = OverloadedType.getOverloads(type);
            if (overloads.some((overload) => requiresSpecialization(overload, options, recursionCount))) {
                return true;
            }

            const impl = OverloadedType.getImplementation(type);
            if (impl) {
                return requiresSpecialization(impl, options, recursionCount);
            }

            return false;
        }

        case TypeCategory.Union: {
            return type.priv.subtypes.some((subtype) => requiresSpecialization(subtype, options, recursionCount));
        }

        case TypeCategory.TypeVar: {
            // Most TypeVar types need to be specialized.
            if (!type.shared.recursiveAlias) {
                if (TypeVarType.isSelf(type) && options?.ignoreSelf) {
                    return false;
                }

                return true;
            }

            // If this is a recursive type alias, it may need to be specialized
            // if it has generic type arguments.
            const aliasInfo = type.props?.typeAliasInfo;
            if (aliasInfo?.typeArgs) {
                return aliasInfo.typeArgs.some((typeArg) => requiresSpecialization(typeArg, options, recursionCount));
            }
        }
    }

    return false;
}

// Converts contravariant to a covariant or vice versa. Leaves
// other variances unchanged.
export function invertVariance(variance: Variance) {
    if (variance === Variance.Contravariant) {
        return Variance.Covariant;
    }

    if (variance === Variance.Covariant) {
        return Variance.Contravariant;
    }

    return variance;
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
export function isVarianceOfTypeArgCompatible(type: Type, typeParamVariance: Variance): boolean {
    if (typeParamVariance === Variance.Unknown || typeParamVariance === Variance.Auto) {
        return true;
    }

    if (isTypeVar(type) && !isParamSpec(type) && !isTypeVarTuple(type)) {
        const typeArgVariance = type.shared.declaredVariance;

        if (typeArgVariance === Variance.Contravariant || typeArgVariance === Variance.Covariant) {
            return typeArgVariance === typeParamVariance;
        }
    } else if (isClassInstance(type)) {
        if (type.shared.typeParams && type.shared.typeParams.length > 0) {
            return type.shared.typeParams.every((typeParam, index) => {
                let typeArgType: Type | undefined;

                if (isParamSpec(typeParam) || isTypeVarTuple(typeParam)) {
                    return true;
                }

                if (type.priv.typeArgs && index < type.priv.typeArgs.length) {
                    typeArgType = type.priv.typeArgs[index];
                }

                const declaredVariance = typeParam.shared.declaredVariance;
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

                return isVarianceOfTypeArgCompatible(typeArgType ?? UnknownType.create(), effectiveVariance);
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
    classType.shared.mro = [];

    const filteredBaseClasses = classType.shared.baseClasses.filter((baseClass, index) => {
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
                    classType.shared.baseClasses.some((innerBaseClass, innerIndex) => {
                        return (
                            innerIndex > index &&
                            isInstantiableClass(innerBaseClass) &&
                            innerBaseClass.priv.typeArgs &&
                            innerBaseClass.priv.isTypeArgExplicit
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
            const solution = buildSolutionFromSpecializedClass(baseClass);
            classListsToMerge.push(
                baseClass.shared.mro.map((mroClass) => {
                    return applySolvedTypeVars(mroClass, solution);
                })
            );
        } else {
            classListsToMerge.push([baseClass]);
        }
    });

    classListsToMerge.push(
        filteredBaseClasses.map((baseClass) => {
            const solution = buildSolutionFromSpecializedClass(classType);
            return applySolvedTypeVars(baseClass, solution);
        })
    );

    // The first class in the MRO is the class itself.
    const solution = buildSolutionFromSpecializedClass(classType);
    let specializedClassType = applySolvedTypeVars(classType, solution);
    if (!isClass(specializedClassType) && !isAnyOrUnknown(specializedClassType)) {
        specializedClassType = UnknownType.create();
    }

    classType.shared.mro.push(specializedClassType);

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
                    let head = classList[0];
                    if (!isClass(head) && !isAnyOrUnknown(head)) {
                        head = UnknownType.create();
                    }
                    classType.shared.mro.push(head);
                    classList.shift();
                    break;
                }

                if (!isInTail(classList[0], classListsToMerge)) {
                    foundValidHead = true;
                    classType.shared.mro.push(classList[0]);
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
                let head = nonEmptyList[0];
                if (!isClass(head) && !isAnyOrUnknown(head)) {
                    head = UnknownType.create();
                }
                classType.shared.mro.push(head);
                nonEmptyList.shift();
            } else {
                classType.shared.mro.push(nonEmptyList[0]);
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
            addIfUnique(type.shared.moduleName);
            break;
        }

        case TypeCategory.Function: {
            addIfUnique(type.shared.moduleName);
            break;
        }

        case TypeCategory.Overloaded: {
            const overloads = OverloadedType.getOverloads(type);
            overloads.forEach((overload) => {
                addDeclaringModuleNamesForType(overload, moduleList, recursionCount);
            });
            const impl = OverloadedType.getImplementation(type);
            if (impl) {
                addDeclaringModuleNamesForType(impl, moduleList, recursionCount);
            }
            break;
        }

        case TypeCategory.Union: {
            doForEachSubtype(type, (subtype) => {
                addDeclaringModuleNamesForType(subtype, moduleList, recursionCount);
            });
            break;
        }

        case TypeCategory.Module: {
            addIfUnique(type.priv.moduleName);
            break;
        }
    }
}

// Converts a function into a FunctionType that represents the function's
// input signature and converts a ParamSpec into a FunctionType with the input
// signature (*args: P.args, **kwargs: P.kwargs).
export function convertTypeToParamSpecValue(type: Type): FunctionType {
    if (isParamSpec(type)) {
        const newFunction = FunctionType.createInstance('', '', '', FunctionTypeFlags.ParamSpecValue);
        FunctionType.addParamSpecVariadics(newFunction, type);
        newFunction.shared.typeVarScopeId = getTypeVarScopeId(type);
        return newFunction;
    }

    if (isFunction(type)) {
        // If it's already a ParamSpecValue, return it as is.
        if (FunctionType.isParamSpecValue(type)) {
            return type;
        }

        const newFunction = FunctionType.createInstance(
            '',
            '',
            '',
            type.shared.flags | FunctionTypeFlags.ParamSpecValue,
            type.shared.docString
        );

        newFunction.shared.deprecatedMessage = type.shared.deprecatedMessage;

        type.shared.parameters.forEach((param, index) => {
            FunctionType.addParam(
                newFunction,
                FunctionParam.create(
                    param.category,
                    FunctionType.getParamType(type, index),
                    param.flags,
                    param.name,
                    FunctionType.getParamDefaultType(type, index),
                    param.defaultExpr
                )
            );
        });

        newFunction.shared.typeVarScopeId = type.shared.typeVarScopeId;
        newFunction.priv.constructorTypeVarScopeId = type.priv.constructorTypeVarScopeId;

        return newFunction;
    }

    return ParamSpecType.getUnknown();
}

// Converts a FunctionType into a ParamSpec if it consists only of
// (* args: P.args, ** kwargs: P.kwargs). Otherwise returns the original type.
export function simplifyFunctionToParamSpec(type: FunctionType): FunctionType | ParamSpecType {
    const paramSpec = FunctionType.getParamSpecFromArgsKwargs(type);
    const withoutParamSpec = FunctionType.cloneRemoveParamSpecArgsKwargs(type);

    let hasParams = withoutParamSpec.shared.parameters.length > 0;

    if (withoutParamSpec.shared.parameters.length === 1) {
        // If the ParamSpec has a position-only separator as its only parameter,
        // treat it as though there are no parameters.
        const onlyParam = withoutParamSpec.shared.parameters[0];
        if (isPositionOnlySeparator(onlyParam)) {
            hasParams = false;
        }
    }

    // Can we simplify it to just a paramSpec?
    if (!hasParams && paramSpec) {
        return paramSpec;
    }

    return type;
}

// Recursively walks a type and calls a callback for each TypeVar, allowing
// it to be replaced with something else.
export class TypeVarTransformer {
    private _pendingTypeVarTransformations = new Set<TypeVarScopeId>();
    private _pendingFunctionTransformations: (FunctionType | OverloadedType)[] = [];

    get pendingTypeVarTransformations() {
        return this._pendingTypeVarTransformations;
    }

    apply(type: Type, recursionCount: number): Type {
        if (recursionCount > maxTypeRecursionCount) {
            return type;
        }
        recursionCount++;

        type = this.transformGenericTypeAlias(type, recursionCount);

        // If the type is conditioned on a type variable, see if the condition
        // still applies.
        if (type.props?.condition) {
            type = this.transformConditionalType(type, recursionCount);
        }

        // Shortcut the operation if possible.
        if (this.canSkipTransform(type)) {
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
            const aliasInfo = type.props?.typeAliasInfo;
            if (type.shared.recursiveAlias) {
                if (!aliasInfo?.typeArgs) {
                    return type;
                }

                let requiresUpdate = false;
                const typeArgs = aliasInfo.typeArgs.map((typeArg) => {
                    const replacementType = this.apply(typeArg, recursionCount);
                    if (replacementType !== typeArg) {
                        requiresUpdate = true;
                    }
                    return replacementType;
                });

                if (requiresUpdate) {
                    return TypeBase.cloneForTypeAlias(type, { ...aliasInfo, typeArgs });
                }

                return type;
            }

            let replacementType: Type = type;

            // Recursively transform the results, but ensure that we don't replace any
            // type variables in the same scope recursively by setting it the scope in the
            // _pendingTypeVarTransformations set.
            if (!this._isTypeVarScopePending(type.priv.scopeId)) {
                let paramSpecAccess: ParamSpecAccess | undefined;

                // If this is a ParamSpec with a ".args" or ".kwargs" access, strip
                // it off for now. We'll add it back later if appropriate.
                if (isParamSpec(type) && type.priv.paramSpecAccess) {
                    paramSpecAccess = type.priv.paramSpecAccess;
                    type = TypeVarType.cloneForParamSpecAccess(type, /* access */ undefined);
                }

                replacementType = this.transformTypeVar(type, recursionCount) ?? type;

                if (isParamSpec(type) && replacementType !== type) {
                    replacementType = simplifyFunctionToParamSpec(convertTypeToParamSpecValue(replacementType));
                }

                // If the original type was a ParamSpec with a ".args" or ".kwargs" access,
                // preserve that information in the transformed type.
                if (paramSpecAccess) {
                    if (isParamSpec(replacementType)) {
                        replacementType = TypeVarType.cloneForParamSpecAccess(replacementType, paramSpecAccess);
                    } else {
                        replacementType = UnknownType.create();
                    }
                }

                // If we're transforming a TypeVarTuple that was in a union,
                // expand the union types.
                if (isTypeVarTuple(type) && type.priv.isInUnion) {
                    replacementType = _expandUnpackedTypeVarTupleUnion(replacementType);
                }

                if (type.priv.scopeId) {
                    this._pendingTypeVarTransformations.add(type.priv.scopeId);
                    replacementType = this.apply(replacementType, recursionCount);
                    this._pendingTypeVarTransformations.delete(type.priv.scopeId);
                }
            }

            return replacementType;
        }

        if (isUnion(type)) {
            const newUnionType = mapSubtypes(
                type,
                (subtype) => {
                    let transformedType: Type = this.apply(subtype, recursionCount);

                    // If we're transforming a TypeVarTuple within a union,
                    // combine the individual types within the TypeVarTuple.
                    if (isTypeVarTuple(subtype) && !isTypeVarTuple(transformedType)) {
                        const subtypesToCombine: Type[] = [];
                        doForEachSubtype(transformedType, (transformedSubtype) => {
                            subtypesToCombine.push(_expandUnpackedTypeVarTupleUnion(transformedSubtype));
                        });

                        transformedType = combineTypes(subtypesToCombine);
                    }

                    if (this.transformUnionSubtype) {
                        return this.transformUnionSubtype(subtype, transformedType, recursionCount);
                    }

                    return transformedType;
                },
                { retainTypeAlias: true }
            );

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

        if (isOverloaded(type)) {
            // Prevent recursion.
            if (this._pendingFunctionTransformations.some((t) => t === type)) {
                return type;
            }

            this._pendingFunctionTransformations.push(type);

            let requiresUpdate = false;

            // Specialize each of the functions in the overload.
            const overloads = OverloadedType.getOverloads(type);
            const newOverloads: FunctionType[] = [];

            overloads.forEach((entry) => {
                const replacementType = this.transformTypeVarsInFunctionType(entry, recursionCount);

                if (isFunction(replacementType)) {
                    newOverloads.push(replacementType);
                } else {
                    appendArray(newOverloads, OverloadedType.getOverloads(replacementType));
                }

                if (replacementType !== entry) {
                    requiresUpdate = true;
                }
            });

            const impl = OverloadedType.getImplementation(type);
            let newImpl: Type | undefined = impl;

            if (impl) {
                newImpl = this.apply(impl, recursionCount);

                if (newImpl !== impl) {
                    requiresUpdate = true;
                }
            }

            this._pendingFunctionTransformations.pop();

            // Construct a new overload with the specialized function types.
            return requiresUpdate ? OverloadedType.create(newOverloads, newImpl) : type;
        }

        return type;
    }

    canSkipTransform(type: Type): boolean {
        return !requiresSpecialization(type);
    }

    transformTypeVar(typeVar: TypeVarType, recursionCount: number): Type | undefined {
        return undefined;
    }

    transformTupleTypeVar(paramSpec: TypeVarType, recursionCount: number): TupleTypeArg[] | undefined {
        return undefined;
    }

    transformUnionSubtype(preTransform: Type, postTransform: Type, recursionCount: number): Type | undefined {
        return postTransform;
    }

    doForEachConstraintSet(callback: () => FunctionType): FunctionType | OverloadedType {
        // By default, simply return the result of the callback. Subclasses
        // can override this method as they see fit.
        return callback();
    }

    transformGenericTypeAlias(type: Type, recursionCount: number) {
        const aliasInfo = type.props?.typeAliasInfo;
        if (!aliasInfo || !aliasInfo.shared.typeParams || !aliasInfo.typeArgs) {
            return type;
        }

        let requiresUpdate = false;
        const newTypeArgs = aliasInfo.typeArgs.map((typeArg) => {
            const updatedType = this.apply(typeArg, recursionCount);
            if (type !== updatedType) {
                requiresUpdate = true;
            }
            return updatedType;
        });

        return requiresUpdate ? TypeBase.cloneForTypeAlias(type, { ...aliasInfo, typeArgs: newTypeArgs }) : type;
    }

    transformConditionalType(type: Type, recursionCount: number): Type {
        // By default, do not perform any transform.
        return type;
    }

    transformTypeVarsInClassType(classType: ClassType, recursionCount: number): Type {
        const typeParams = ClassType.getTypeParams(classType);

        // Handle the common case where the class has no type parameters.
        if (
            typeParams.length === 0 &&
            !ClassType.isSpecialBuiltIn(classType) &&
            !ClassType.isBuiltIn(classType, 'type')
        ) {
            return classType;
        }

        let newTypeArgs: Type[] | undefined;
        let newTupleTypeArgs: TupleTypeArg[] | undefined;
        let specializationNeeded = false;
        let isTypeArgExplicit = true;

        // If type args were previously provided, specialize them.

        // Handle tuples specially.
        if (ClassType.isTupleClass(classType)) {
            if (getContainerDepth(classType) > maxTupleTypeArgRecursionDepth) {
                return classType;
            }

            if (classType.priv.tupleTypeArgs) {
                newTupleTypeArgs = [];

                classType.priv.tupleTypeArgs.forEach((oldTypeArgType) => {
                    const newTypeArgType = this.apply(oldTypeArgType.type, recursionCount);

                    if (newTypeArgType !== oldTypeArgType.type) {
                        specializationNeeded = true;
                    }

                    if (
                        isUnpackedTypeVarTuple(oldTypeArgType.type) &&
                        isClassInstance(newTypeArgType) &&
                        isTupleClass(newTypeArgType) &&
                        newTypeArgType.priv.tupleTypeArgs
                    ) {
                        appendArray(newTupleTypeArgs!, newTypeArgType.priv.tupleTypeArgs);
                    } else if (isUnpackedClass(newTypeArgType) && newTypeArgType.priv.tupleTypeArgs) {
                        appendArray(newTupleTypeArgs!, newTypeArgType.priv.tupleTypeArgs);
                    } else {
                        // Handle the special case where tuple[T, ...] is being specialized
                        // to tuple[Never, ...]. This is equivalent to tuple[()].
                        const isEmptyTuple =
                            oldTypeArgType.isUnbounded &&
                            isTypeVar(oldTypeArgType.type) &&
                            isNever(newTypeArgType) &&
                            classType.priv.tupleTypeArgs!.length === 1;

                        if (!isEmptyTuple) {
                            newTupleTypeArgs!.push({
                                type: newTypeArgType,
                                isUnbounded: oldTypeArgType.isUnbounded,
                                isOptional: oldTypeArgType.isOptional,
                            });
                        }
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
                    isTypeArgExplicit = false;
                }
            }

            // If this is an empty tuple, don't recompute the non-tuple type argument.
            if (newTupleTypeArgs && newTupleTypeArgs.length > 0) {
                // Combine the tuple type args into a single non-tuple type argument.
                newTypeArgs = [combineTupleTypeArgs(newTupleTypeArgs)];
            }
        }

        if (!newTypeArgs) {
            const typeArgs = classType.priv.typeArgs ?? typeParams;

            if (!classType.priv.typeArgs) {
                isTypeArgExplicit = false;
            }

            newTypeArgs = typeArgs.map((oldTypeArgType) => {
                let newTypeArgType = this.apply(oldTypeArgType, recursionCount);
                if (newTypeArgType !== oldTypeArgType) {
                    specializationNeeded = true;

                    // If this was a TypeVarTuple that was part of a union
                    // (e.g. Union[Unpack[Vs]]), expand the subtypes into a union here.
                    if (isTypeVar(oldTypeArgType) && isTypeVarTuple(oldTypeArgType) && oldTypeArgType.priv.isInUnion) {
                        newTypeArgType = _expandUnpackedTypeVarTupleUnion(newTypeArgType);
                    }
                }
                return newTypeArgType;
            });
        }

        // If specialization wasn't needed, don't allocate a new class.
        if (!specializationNeeded) {
            return classType;
        }

        return ClassType.specialize(
            classType,
            newTypeArgs,
            isTypeArgExplicit,
            /* includeSubclasses */ undefined,
            newTupleTypeArgs
        );
    }

    transformTypeVarsInFunctionType(sourceType: FunctionType, recursionCount: number): FunctionType | OverloadedType {
        return this.doForEachConstraintSet(() => {
            let functionType = sourceType;

            const declaredReturnType = FunctionType.getEffectiveReturnType(functionType);
            const specializedReturnType = declaredReturnType
                ? this.apply(declaredReturnType, recursionCount)
                : undefined;
            let typesRequiredSpecialization = declaredReturnType !== specializedReturnType;

            const specializedParams: SpecializedFunctionTypes = {
                parameterTypes: [],
                parameterDefaultTypes: undefined,
                returnType: specializedReturnType,
            };

            const paramSpec = FunctionType.getParamSpecFromArgsKwargs(functionType);

            if (paramSpec) {
                const paramSpecType = this.transformTypeVar(paramSpec, recursionCount);
                if (paramSpecType) {
                    const paramSpecValue = convertTypeToParamSpecValue(paramSpecType);
                    const transformedParamSpec = FunctionType.getParamSpecFromArgsKwargs(paramSpecValue);

                    if (
                        paramSpecValue.shared.parameters.length > 0 ||
                        !transformedParamSpec ||
                        !isTypeSame(paramSpec, transformedParamSpec)
                    ) {
                        functionType = FunctionType.applyParamSpecValue(functionType, paramSpecValue);
                    }
                }
            }

            let variadicParamIndex: number | undefined;
            let variadicTypesToUnpack: TupleTypeArg[] | undefined;
            const specializedDefaultArgs: (Type | undefined)[] = [];

            for (let i = 0; i < functionType.shared.parameters.length; i++) {
                const paramType = FunctionType.getParamType(functionType, i);
                const specializedType = this.apply(paramType, recursionCount);
                specializedParams.parameterTypes.push(specializedType);

                // Do we need to specialize the default argument type for this parameter?
                let defaultArgType = FunctionType.getParamDefaultType(functionType, i);
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
                    isTypeVarTuple(paramType) &&
                    functionType.shared.parameters[i].category === ParamCategory.ArgsList
                ) {
                    variadicParamIndex = i;

                    if (
                        isClassInstance(specializedType) &&
                        isTupleClass(specializedType) &&
                        specializedType.priv.isUnpacked
                    ) {
                        variadicTypesToUnpack = specializedType.priv.tupleTypeArgs;
                    }
                }

                if (paramType !== specializedType) {
                    typesRequiredSpecialization = true;
                }
            }

            let specializedInferredReturnType: Type | undefined;
            if (functionType.priv.inferredReturnType) {
                specializedInferredReturnType = this.apply(functionType.priv.inferredReturnType, recursionCount);
                if (specializedInferredReturnType !== functionType.priv.inferredReturnType) {
                    typesRequiredSpecialization = true;
                }
            }

            // Do we need to update the boundToType?
            if (functionType.priv.boundToType) {
                const newBoundToType = this.apply(functionType.priv.boundToType, recursionCount);
                if (newBoundToType !== functionType.priv.boundToType && isClass(newBoundToType)) {
                    functionType = FunctionType.clone(functionType, /* stripFirstParam */ false, newBoundToType);
                }
            }

            // Do we need to update the strippedFirstParamType?
            if (functionType.priv.strippedFirstParamType) {
                const newStrippedType = this.apply(functionType.priv.strippedFirstParamType, recursionCount);
                if (newStrippedType !== functionType.priv.strippedFirstParamType) {
                    functionType = TypeBase.cloneType(functionType);
                    functionType.priv.strippedFirstParamType = newStrippedType;
                }
            }

            if (!typesRequiredSpecialization) {
                return functionType;
            }

            if (specializedDefaultArgs.some((t) => t !== undefined)) {
                specializedParams.parameterDefaultTypes = specializedDefaultArgs;
            }

            // If there was no unpacked variadic type variable, we're done.
            if (!variadicTypesToUnpack) {
                return FunctionType.specialize(functionType, specializedParams, specializedInferredReturnType);
            }

            // Unpack the tuple and synthesize a new function in the process.
            const newFunctionType = TypeBase.isInstantiable(functionType)
                ? FunctionType.createInstantiable(functionType.shared.flags | FunctionTypeFlags.SynthesizedMethod)
                : FunctionType.createSynthesizedInstance('', functionType.shared.flags);
            let insertKeywordOnlySeparator = false;
            let swallowPositionOnlySeparator = false;

            specializedParams.parameterTypes.forEach((paramType, index) => {
                if (index === variadicParamIndex) {
                    let sawUnboundedEntry = false;

                    // Unpack the tuple into individual parameters.
                    variadicTypesToUnpack!.forEach((unpackedType) => {
                        FunctionType.addParam(
                            newFunctionType,
                            FunctionParam.create(
                                unpackedType.isUnbounded || isTypeVarTuple(unpackedType.type)
                                    ? ParamCategory.ArgsList
                                    : ParamCategory.Simple,
                                unpackedType.type,
                                FunctionParamFlags.NameSynthesized | FunctionParamFlags.TypeDeclared,
                                `__p${newFunctionType.shared.parameters.length}`
                            )
                        );

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
                    const param = functionType.shared.parameters[index];

                    if (isKeywordOnlySeparator(param)) {
                        insertKeywordOnlySeparator = false;
                    } else if (param.category === ParamCategory.KwargsDict) {
                        insertKeywordOnlySeparator = false;
                    }

                    // Insert a keyword-only separator parameter if we previously
                    // unpacked a TypeVarTuple.
                    if (param.category === ParamCategory.Simple && param.name && insertKeywordOnlySeparator) {
                        FunctionType.addKeywordOnlyParamSeparator(newFunctionType);
                        insertKeywordOnlySeparator = false;
                    }

                    if (param.category !== ParamCategory.Simple || param.name || !swallowPositionOnlySeparator) {
                        FunctionType.addParam(
                            newFunctionType,
                            FunctionParam.create(
                                param.category,
                                paramType,
                                param.flags,
                                param.name && FunctionParam.isNameSynthesized(param)
                                    ? `__p${newFunctionType.shared.parameters.length}`
                                    : param.name,
                                FunctionType.getParamDefaultType(functionType, index),
                                param.defaultExpr
                            )
                        );
                    }
                }
            });

            newFunctionType.shared.declaredReturnType = specializedParams.returnType;

            return newFunctionType;
        });
    }

    private _isTypeVarScopePending(typeVarScopeId: TypeVarScopeId | undefined) {
        return !!typeVarScopeId && this._pendingTypeVarTransformations.has(typeVarScopeId);
    }
}

// For a TypeVar with a default type, validates whether the default type is using
// any other TypeVars that are not currently in scope.
class TypeVarDefaultValidator extends TypeVarTransformer {
    constructor(private _liveTypeParams: TypeVarType[], private _invalidTypeVars: Set<string>) {
        super();
    }

    override transformTypeVar(typeVar: TypeVarType) {
        const replacementType = this._liveTypeParams.find((param) => param.shared.name === typeVar.shared.name);
        if (!replacementType || isParamSpec(replacementType) !== isParamSpec(typeVar)) {
            this._invalidTypeVars.add(typeVar.shared.name);
        }

        return UnknownType.create();
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

    override transformTypeVarsInClassType(classType: ClassType, recursionCount: number): Type {
        // Don't transform classes.
        return classType;
    }

    override transformTypeVarsInFunctionType(
        sourceType: FunctionType,
        recursionCount: number
    ): FunctionType | OverloadedType {
        // If this function is not generic, there's no need to check for uniqueness.
        if (sourceType.shared.typeParams.length === 0) {
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
                const solution = new ConstraintSolution();

                // Create new type variables with the same scope but with
                // different (unique) names.
                sourceType.shared.typeParams.forEach((typeParam) => {
                    if (typeParam.priv.scopeType === TypeVarScopeType.Function) {
                        const replacement: Type = TypeVarType.cloneForNewName(
                            typeParam,
                            `${typeParam.shared.name}(${offsetIndex})`
                        );

                        solution.setType(typeParam, replacement);
                    }
                });

                updatedSourceType = applySolvedTypeVars(sourceType, solution);
                assert(isFunction(updatedSourceType) || isOverloaded(updatedSourceType));
            }
        }

        this._signatureTracker.addSignature(sourceType, this._expressionOffset);

        return updatedSourceType;
    }
}

// Replaces the free type vars within a type with their corresponding bound
// type vars if they are in one of the specified scopes. If undefined is
// passed for the scopeIds list, all free type vars are replaced.
class BoundTypeVarTransform extends TypeVarTransformer {
    constructor(private _scopeIds: TypeVarScopeId[] | undefined) {
        super();
    }

    override transformTypeVar(typeVar: TypeVarType): Type | undefined {
        if (this._isTypeVarInScope(typeVar)) {
            return this._replaceTypeVar(typeVar);
        }

        return undefined;
    }

    private _isTypeVarInScope(typeVar: TypeVarType) {
        if (!typeVar.priv.scopeId) {
            return false;
        }

        // If no scopeIds were specified, transform all Type Vars.
        if (!this._scopeIds) {
            return true;
        }

        return this._scopeIds.includes(typeVar.priv.scopeId);
    }

    private _replaceTypeVar(typeVar: TypeVarType): TypeVarType {
        return TypeVarType.cloneAsBound(typeVar);
    }
}

// Replaces the bound type vars within a type with their corresponding
// free type vars.
class FreeTypeVarTransform extends TypeVarTransformer {
    constructor(private _scopeIds: TypeVarScopeId[]) {
        super();
    }

    override transformTypeVar(typeVar: TypeVarType): Type | undefined {
        if (typeVar.priv.freeTypeVar && this._isTypeVarInScope(typeVar.priv.freeTypeVar)) {
            return typeVar.priv.freeTypeVar;
        }

        return undefined;
    }

    private _isTypeVarInScope(typeVar: TypeVarType) {
        if (!typeVar.priv.scopeId) {
            return false;
        }

        return this._scopeIds.includes(typeVar.priv.scopeId);
    }
}

// Specializes a (potentially generic) type by substituting
// type variables from a type var map.
class ApplySolvedTypeVarsTransformer extends TypeVarTransformer {
    private _isSolvingDefaultType = false;
    private _activeConstraintSetIndex: number | undefined;

    constructor(private _solution: ConstraintSolution, private _options: ApplyTypeVarOptions) {
        super();
    }

    override transformTypeVar(typeVar: TypeVarType, recursionCount: number) {
        const solutionSet = this._solution.getSolutionSet(this._activeConstraintSetIndex ?? 0);

        // If we're solving a default type, handle type variables with no scope ID.
        if (this._isSolvingDefaultType && !typeVar.priv.scopeId) {
            const replacement = this._getReplacementForDefaultByName(typeVar, solutionSet);
            if (replacement) {
                return replacement;
            }

            if (typeVar.shared.isDefaultExplicit) {
                return this.apply(typeVar.shared.defaultType, recursionCount);
            }

            return UnknownType.create();
        }

        if (!this._shouldReplaceTypeVar(typeVar)) {
            return undefined;
        }

        let replacement = solutionSet.getType(typeVar);

        if (replacement) {
            // No more processing is needed for ParamSpecs.
            if (isParamSpec(typeVar)) {
                return replacement;
            }

            if (TypeBase.isInstantiable(typeVar)) {
                if (
                    isAnyOrUnknown(replacement) &&
                    this._options.typeClassType &&
                    isInstantiableClass(this._options.typeClassType)
                ) {
                    replacement = ClassType.specialize(ClassType.cloneAsInstance(this._options.typeClassType), [
                        replacement,
                    ]);
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
                        if (!subtype.priv.includeSubclasses) {
                            subtype = ClassType.cloneAsInstance(ClassType.cloneAsInstantiable(subtype));
                        }

                        if (subtype.shared.typeParams && !subtype.priv.typeArgs) {
                            if (this._options.replaceUnsolved) {
                                return this._options.replaceUnsolved.useUnknown
                                    ? specializeWithUnknownTypeArgs(
                                          subtype,
                                          this._options.replaceUnsolved.tupleClassType
                                      )
                                    : specializeWithDefaultTypeArgs(subtype);
                            }
                        }
                    }

                    return subtype;
                });
            }

            if (isTypeVarTuple(replacement) && isTypeVarTuple(typeVar) && typeVar.priv.isUnpacked) {
                return TypeVarType.cloneForUnpacked(replacement, typeVar.priv.isInUnion);
            }

            if (
                !isTypeVarTuple(replacement) &&
                isTypeVar(replacement) &&
                isTypeVar(typeVar) &&
                typeVar.priv.isUnpacked
            ) {
                return TypeVarType.cloneForUnpacked(replacement);
            }

            // If this isn't a TypeVarTuple, combine all of the tuple
            // type args into a common type.
            if (
                !isTypeVarTuple(typeVar) &&
                isClassInstance(replacement) &&
                replacement.priv.tupleTypeArgs &&
                replacement.priv.isUnpacked
            ) {
                replacement = combineTupleTypeArgs(replacement.priv.tupleTypeArgs);
            }

            if (isUnpackedTypeVar(typeVar) && isClass(replacement)) {
                replacement = ClassType.cloneForUnpacked(replacement);
            }

            if (!isTypeVar(replacement) || !TypeVarType.isUnification(replacement) || !this._options.replaceUnsolved) {
                return replacement;
            }
        }

        if (!this._shouldReplaceUnsolvedTypeVar(typeVar)) {
            return undefined;
        }

        // Use the default value if there is one.
        if (typeVar.shared.isDefaultExplicit && !this._options.replaceUnsolved?.useUnknown) {
            return this._solveDefaultType(typeVar, recursionCount);
        }

        return getUnknownForTypeVar(typeVar, this._options.replaceUnsolved?.tupleClassType);
    }

    override transformUnionSubtype(preTransform: Type, postTransform: Type): Type | undefined {
        // If a union contains unsolved TypeVars within scope, eliminate them
        // unless this results in an empty union. This elimination is needed
        // in cases where TypeVars can go unsolved due to unions in parameter
        // annotations, like this:
        //   def test(x: Union[str, T]) -> Union[str, T]
        if (!this._options.replaceUnsolved?.eliminateUnsolvedInUnions) {
            return postTransform;
        }

        const solutionSet = this._solution.getSolutionSet(this._activeConstraintSetIndex ?? 0);

        if (isTypeVar(preTransform)) {
            if (!this._shouldReplaceTypeVar(preTransform) || !this._shouldReplaceUnsolvedTypeVar(preTransform)) {
                return postTransform;
            }

            const typeVarType = solutionSet.getType(preTransform);

            // Did the TypeVar remain unsolved?
            if (typeVarType) {
                if (!isTypeVar(typeVarType) || !TypeVarType.isUnification(typeVarType)) {
                    return postTransform;
                }
            }

            // If the TypeVar was not transformed, then it was unsolved,
            // and we'll eliminate it.
            if (preTransform === postTransform) {
                return undefined;
            }

            // If useDefaultForUnsolved or useUnknownForUnsolved is true, the postTransform type will
            // be Unknown, which we want to eliminate.
            if (this._options.replaceUnsolved && isUnknown(postTransform)) {
                return undefined;
            }
        } else if (preTransform.props?.condition) {
            // If this is a type that is conditioned on a unification TypeVar,
            // see if TypeVar was solved. If not, eliminate the type.
            for (const condition of preTransform.props.condition) {
                if (TypeVarType.isUnification(condition.typeVar) && !solutionSet.getType(condition.typeVar)) {
                    return undefined;
                }
            }
        }

        return postTransform;
    }

    override transformTupleTypeVar(typeVar: TypeVarType): TupleTypeArg[] | undefined {
        if (!this._shouldReplaceTypeVar(typeVar)) {
            const defaultType = typeVar.shared.defaultType;

            if (typeVar.shared.isDefaultExplicit && isClassInstance(defaultType) && defaultType.priv.tupleTypeArgs) {
                return defaultType.priv.tupleTypeArgs;
            }

            return undefined;
        }

        const solutionSet = this._solution.getSolutionSet(this._activeConstraintSetIndex ?? 0);
        const value = solutionSet.getType(typeVar);
        if (value && isClassInstance(value) && value.priv.tupleTypeArgs && isUnpackedClass(value)) {
            return value.priv.tupleTypeArgs;
        }
        return undefined;
    }

    override transformConditionalType(type: Type, recursionCount: number): Type {
        if (!type.props?.condition) {
            return type;
        }

        const solutionSet = this._solution.getSolutionSet(this._activeConstraintSetIndex ?? 0);

        for (const condition of type.props.condition) {
            // This doesn't apply to bound type variables.
            if (!TypeVarType.hasConstraints(condition.typeVar)) {
                continue;
            }

            const conditionTypeVar = condition.typeVar.priv?.freeTypeVar ?? condition.typeVar;
            const replacement = solutionSet.getType(conditionTypeVar);
            if (!replacement || condition.constraintIndex >= conditionTypeVar.shared.constraints.length) {
                continue;
            }

            const value = solutionSet.getType(conditionTypeVar);
            if (!value) {
                continue;
            }

            const constraintType = conditionTypeVar.shared.constraints[condition.constraintIndex];

            // If this violates the constraint, substitute a Never type.
            if (!isTypeSame(constraintType, value)) {
                return NeverType.createNever();
            }
        }
        return type;
    }

    override doForEachConstraintSet(callback: () => FunctionType): FunctionType | OverloadedType {
        const solutionSets = this._solution.getSolutionSets();

        // Handle the common case where there are not multiple signature contexts.
        if (solutionSets.length <= 1) {
            return callback();
        }

        // Handle the case where we're already processing one of the signature contexts
        // and are called recursively. Don't loop over all the signature contexts again.
        if (this._activeConstraintSetIndex !== undefined) {
            return callback();
        }

        // Loop through all of the signature contexts in the type var context
        // to create an overload type.
        const overloadTypes = solutionSets.map((_, index) => {
            this._activeConstraintSetIndex = index;
            return callback();
        });
        this._activeConstraintSetIndex = undefined;

        const filteredOverloads: FunctionType[] = [];
        doForEachSubtype(combineTypes(overloadTypes), (subtype) => {
            assert(isFunction(subtype));
            subtype = FunctionType.cloneWithNewFlags(subtype, subtype.shared.flags | FunctionTypeFlags.Overloaded);
            filteredOverloads.push(subtype);
        });

        if (filteredOverloads.length === 1) {
            return filteredOverloads[0];
        }

        return OverloadedType.create(filteredOverloads);
    }

    // Handle the case where we need the default replacement value for a typeVar
    // that has no scope and therefore doesn't have an assigned scopeID. We'll
    // look it up by name in the solution set. This is a bit hacky because there
    // could be multiple typeVars with the same name, but we'll assume that this
    // won't happen.
    private _getReplacementForDefaultByName(
        typeVar: TypeVarType,
        solutionSet: ConstraintSolutionSet
    ): Type | undefined {
        let replacementValue: Type | undefined;
        const partialScopeId = `${typeVar.shared.name}.`;

        solutionSet.doForEachTypeVar((value, typeVarId) => {
            if (typeVarId.startsWith(partialScopeId)) {
                replacementValue = value;
            }
        });

        return replacementValue;
    }

    private _shouldReplaceTypeVar(typeVar: TypeVarType): boolean {
        if (!typeVar.priv.scopeId || TypeVarType.isBound(typeVar)) {
            return false;
        }

        return true;
    }

    private _shouldReplaceUnsolvedTypeVar(typeVar: TypeVarType): boolean {
        // Never replace nested TypeVars with unknown.
        if (this.pendingTypeVarTransformations.size > 0) {
            return false;
        }

        if (!typeVar.priv.scopeId) {
            return false;
        }

        if (!this._options.replaceUnsolved) {
            return false;
        }

        if (!this._options.replaceUnsolved.scopeIds.includes(typeVar.priv.scopeId)) {
            return false;
        }

        const exemptTypeVars = this._options.replaceUnsolved?.unsolvedExemptTypeVars;
        if (exemptTypeVars) {
            if (exemptTypeVars.some((t) => isTypeSame(t, typeVar, { ignoreTypeFlags: true }))) {
                return false;
            }
        }

        return true;
    }

    private _solveDefaultType(typeVar: TypeVarType, recursionCount: number) {
        const defaultType = typeVar.shared.defaultType;
        const wasSolvingDefaultType = this._isSolvingDefaultType;
        this._isSolvingDefaultType = true;
        const result = this.apply(defaultType, recursionCount);
        this._isSolvingDefaultType = wasSolvingDefaultType;
        return result;
    }
}

class UnificationTypeTransformer extends TypeVarTransformer {
    constructor(private _liveTypeVarScopes: TypeVarScopeId[], private _usageOffset: number | undefined) {
        super();
    }

    override transformTypeVar(typeVar: TypeVarType) {
        if (!this._isTypeVarLive(typeVar)) {
            return TypeVarType.cloneAsUnificationVar(typeVar, this._usageOffset);
        }

        return undefined;
    }

    private _isTypeVarLive(typeVar: TypeVarType) {
        return this._liveTypeVarScopes.some(
            (scopeId) => typeVar.priv.scopeId === scopeId || typeVar.priv.freeTypeVar?.priv.scopeId === scopeId
        );
    }
}
