/*
 * typeCompatibility.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * typeCompatibility implementation, using evaluator-owned dependencies and state.
 */

import { appendArray } from '../../common/collectionUtils';
import { assert } from '../../common/debug';
import { DiagnosticAddendum } from '../../common/diagnostic';
import { LocAddendum } from '../../localization/localize';
import { ParamCategory } from '../../parser/parseNodes';
import { ConstraintTracker } from '../constraintTracker';
import { getIntFlagReturnTypeForCallable } from '../enums';
import { getParamListDetails, ParamKind, ParamListDetails, VirtualParamDetails } from '../parameterUtils';
import { assignClassToProtocol } from '../protocols';
import { assignTupleTypeArgs, makeTupleObject } from '../tuples';
import { assignTypedDictToTypedDict, getTypedDictDictEquivalent, getTypedDictMappingEquivalent } from '../typedDicts';
import {
    AssignTypeFlags,
    PrefetchedTypes,
    PrintTypeOptions,
    SolveConstraintsOptions,
    TypeEvaluator,
} from '../typeEvaluatorTypes';
import {
    ClassType,
    combineTypes,
    findSubtype,
    FunctionParam,
    FunctionParamFlags,
    FunctionType,
    FunctionTypeFlags,
    InheritanceChain,
    isAnyOrUnknown,
    isClass,
    isClassInstance,
    isFunction,
    isFunctionOrOverloaded,
    isInstantiableClass,
    isParamSpec,
    isPositionOnlySeparator,
    isTypeSame,
    isTypeVar,
    isTypeVarTuple,
    isUnion,
    isUnknown,
    isUnpacked,
    isUnpackedClass,
    isUnpackedTypeVarTuple,
    TupleTypeArg,
    Type,
    TypeAliasInfo,
    TypeBase,
    TypeCondition,
    TypeVarType,
    UnionType,
    UnknownType,
    Variance,
} from '../types';
import {
    ApplyTypeVarOptions,
    containsAnyOrUnknown,
    containsLiteralType,
    convertToInstance,
    doForEachSubtype,
    getTypeCondition,
    isIncompleteUnknown,
    isLiteralLikeType,
    isLiteralType,
    isNoneInstance,
    isNoneTypeClass,
    isOptionalType,
    isOverlapOnlyByOmission,
    makeTypeVarsBound,
    requiresSpecialization,
    sortTypes,
    specializeForBaseClass,
    specializeWithDefaultTypeArgs,
} from '../typeUtils';

interface Context {
    readonly assignNamedParam: (
        destDetails: ParamListDetails,
        srcDetails: ParamListDetails,
        paramIndex: number,
        diag: DiagnosticAddendum | undefined,
        constraints: ConstraintTracker,
        flags: AssignTypeFlags,
        recursionCount: number
    ) => boolean;
    readonly assignType: TypeEvaluator['assignType'];
    readonly assignTypeArgs: (
        destType: ClassType,
        srcType: ClassType,
        diag: DiagnosticAddendum | undefined,
        constraints: ConstraintTracker | undefined,
        flags: AssignTypeFlags,
        recursionCount: number
    ) => boolean;
    readonly evaluatorInterface: TypeEvaluator;
    readonly getEffectiveReturnType: (type: FunctionType) => Type;
    readonly inferVarianceForClass: (classType: ClassType) => void;
    readonly isParamListOverlapOnlyByOmission: (
        destType: FunctionType,
        srcType: FunctionType,
        destParamDetails: ParamListDetails,
        srcParamDetails: ParamListDetails,
        recursionCount: number
    ) => boolean;
    readonly isTypeSubsumedByOtherType: (
        type: Type,
        otherType: Type,
        allowAnyToSubsume: boolean,
        recursionCount?: number
    ) => boolean;
    readonly makeTopLevelTypeVarsConcrete: (
        type: Type,
        makeParamSpecsConcrete?: boolean,
        conditionFilter?: TypeCondition[]
    ) => Type;
    readonly prefetched: Partial<PrefetchedTypes> | undefined;
    readonly printSrcDestTypes: (
        srcType: Type,
        destType: Type,
        options?: PrintTypeOptions
    ) => { sourceType: string; destType: string };
    readonly printType: TypeEvaluator['printType'];
    readonly solveAndApplyConstraints: (
        type: Type,
        constraints: ConstraintTracker,
        applyOptions?: ApplyTypeVarOptions,
        solveOptions?: SolveConstraintsOptions
    ) => Type;
    readonly stripLiteralValue: (type: Type) => Type;
    readonly typePromotions: Map<string, string[]>;
}

// Checks assignability, accumulating constraints and diagnostics through evaluator callbacks.
export function createTypeCompatibility(context: Context) {
    const {
        assignNamedParam,
        assignType,
        assignTypeArgs,
        evaluatorInterface,
        getEffectiveReturnType,
        inferVarianceForClass,
        isParamListOverlapOnlyByOmission,
        isTypeSubsumedByOtherType,
        makeTopLevelTypeVarsConcrete,
        printSrcDestTypes,
        printType,
        solveAndApplyConstraints,
        stripLiteralValue,
        typePromotions,
    } = context;

    function assignClass(
        destType: ClassType,
        srcType: ClassType,
        diag: DiagnosticAddendum | undefined,
        constraints: ConstraintTracker | undefined,
        flags: AssignTypeFlags,
        recursionCount: number,
        reportErrorsUsingObjType: boolean
    ): boolean {
        // If the source or dest types are partially evaluated (i.e. they are in the
        // process of being constructed), assume they are assignable rather than risk
        // emitting false positives.
        if (ClassType.isHierarchyPartiallyEvaluated(destType) || ClassType.isHierarchyPartiallyEvaluated(srcType)) {
            return true;
        }

        // Handle typed dicts. They also use a form of structural typing for type
        // checking, as defined in PEP 589.
        if (ClassType.isTypedDictClass(srcType)) {
            if (ClassType.isTypedDictClass(destType) && !ClassType.isSameGenericClass(destType, srcType)) {
                if (
                    !assignTypedDictToTypedDict(
                        evaluatorInterface,
                        destType,
                        srcType,
                        diag,
                        constraints,
                        flags,
                        recursionCount
                    )
                ) {
                    return false;
                }

                // If invariance is being enforced, the two TypedDicts must be assignable to each other.
                if ((flags & AssignTypeFlags.Invariant) !== 0) {
                    return assignTypedDictToTypedDict(
                        evaluatorInterface,
                        srcType,
                        destType,
                        /* diag */ undefined,
                        /* constraints */ undefined,
                        flags,
                        recursionCount
                    );
                }

                return true;
            }

            // Handle some special cases where a TypedDict can act like
            // a Mapping[str, T] or a dict[str, T].
            if (ClassType.isBuiltIn(destType, 'Mapping')) {
                const mappingValueType = getTypedDictMappingEquivalent(evaluatorInterface, srcType);

                if (
                    mappingValueType &&
                    context.prefetched?.mappingClass &&
                    isInstantiableClass(context.prefetched.mappingClass) &&
                    context.prefetched?.strClass &&
                    isInstantiableClass(context.prefetched.strClass)
                ) {
                    srcType = ClassType.specialize(context.prefetched.mappingClass, [
                        ClassType.cloneAsInstance(context.prefetched.strClass),
                        mappingValueType,
                    ]);
                }
            } else if (ClassType.isBuiltIn(destType, ['dict', 'MutableMapping'])) {
                const dictValueType = getTypedDictDictEquivalent(evaluatorInterface, srcType, recursionCount);

                if (
                    dictValueType &&
                    context.prefetched?.dictClass &&
                    isInstantiableClass(context.prefetched.dictClass) &&
                    context.prefetched.strClass &&
                    isInstantiableClass(context.prefetched.strClass)
                ) {
                    srcType = ClassType.specialize(context.prefetched.dictClass, [
                        ClassType.cloneAsInstance(context.prefetched.strClass),
                        dictValueType,
                    ]);
                }
            }
        }

        // Handle special-case type promotions.
        if (destType.priv.includePromotions) {
            const promotionList = typePromotions.get(destType.shared.fullName);
            if (
                promotionList &&
                promotionList.some((srcName) =>
                    srcType.shared.mro.some((mroClass) => isClass(mroClass) && srcName === mroClass.shared.fullName)
                )
            ) {
                if ((flags & AssignTypeFlags.Invariant) === 0) {
                    return true;
                }
            }
        }

        // A class value normally remains unspecialized so it can be subscripted.
        // If every type parameter has an explicit default, apply those defaults
        // when comparing it against a type specialization. Classes with defaultless
        // parameters or defaults that resolve directly to Any or Unknown retain
        // their unspecialized behavior, so they don't degrade inference.
        if (
            TypeBase.isInstantiable(srcType) &&
            srcType.props?.typeForm &&
            !srcType.priv.typeArgs &&
            !srcType.priv.includeSubclasses &&
            srcType.shared.typeParams.length > 0 &&
            srcType.shared.typeParams.every((typeParam) => typeParam.shared.isDefaultExplicit)
        ) {
            const specializedSrcType = specializeWithDefaultTypeArgs(srcType);
            const specializedTypeArgs =
                specializedSrcType.priv.typeArgs ??
                specializedSrcType.priv.tupleTypeArgs?.map((tupleTypeArg) => tupleTypeArg.type);
            const hasGradualTypeArg = specializedTypeArgs?.some(
                (typeArg) =>
                    !!containsAnyOrUnknown(typeArg, /* recurse */ false) ||
                    (isFunction(typeArg) && FunctionType.isGradualCallableForm(typeArg)) ||
                    (isUnpackedClass(typeArg) && !!containsAnyOrUnknown(typeArg, /* recurse */ true))
            );
            if (hasGradualTypeArg === false) {
                srcType = specializedSrcType;
            }
        }

        // Is it a structural type (i.e. a protocol)? If so, we need to
        // perform a member-by-member check.
        const inheritanceChain: InheritanceChain = [];
        const isDerivedFrom = ClassType.isDerivedFrom(srcType, destType, inheritanceChain);

        // Use the slow path for protocols if the dest doesn't explicitly
        // derive from the source. We also need to use this path if we're
        // testing to see if the metaclass matches the protocol.
        if (ClassType.isProtocolClass(destType) && !isDerivedFrom) {
            if (
                !assignClassToProtocol(
                    evaluatorInterface,
                    destType,
                    ClassType.cloneAsInstance(srcType),
                    diag?.createAddendum(),
                    constraints,
                    flags,
                    recursionCount
                )
            ) {
                diag?.addMessage(
                    LocAddendum.protocolIncompatible().format({
                        sourceType: printType(convertToInstance(srcType)),
                        destType: printType(convertToInstance(destType)),
                    })
                );
                return false;
            }

            return true;
        }

        if ((flags & AssignTypeFlags.Invariant) === 0 || ClassType.isSameGenericClass(srcType, destType)) {
            if (isDerivedFrom) {
                assert(inheritanceChain.length > 0);

                if (
                    assignClassWithTypeArgs(
                        destType,
                        srcType,
                        inheritanceChain,
                        diag?.createAddendum(),
                        constraints,
                        flags,
                        recursionCount
                    )
                ) {
                    return true;
                }
            }
        }

        // Everything is assignable to an object.
        if (ClassType.isBuiltIn(destType, 'object')) {
            if ((flags & AssignTypeFlags.Invariant) === 0) {
                return true;
            }
        }

        if (diag) {
            const destErrorType = reportErrorsUsingObjType ? ClassType.cloneAsInstance(destType) : destType;
            const srcErrorType = reportErrorsUsingObjType ? ClassType.cloneAsInstance(srcType) : srcType;

            let destErrorTypeText = printType(destErrorType);
            let srcErrorTypeText = printType(srcErrorType);

            // If the text is the same, use the fully-qualified name rather than the short name.
            if (destErrorTypeText === srcErrorTypeText && destType.shared.fullName && srcType.shared.fullName) {
                destErrorTypeText = destType.shared.fullName;
                srcErrorTypeText = srcType.shared.fullName;
            }

            diag?.addMessage(
                LocAddendum.typeIncompatible().format({
                    sourceType: srcErrorTypeText,
                    destType: destErrorTypeText,
                })
            );

            // Tell the user about the disableBytesTypePromotions if that is involved.
            if (ClassType.isBuiltIn(destType, 'bytes')) {
                const promotions = typePromotions.get(destType.shared.fullName);
                if (promotions && promotions.some((name) => name === srcType.shared.fullName)) {
                    diag?.addMessage(LocAddendum.bytesTypePromotions());
                }
            }
        }

        return false;
    }

    function assignClassWithTypeArgs(
        destType: ClassType,
        srcType: ClassType,
        inheritanceChain: InheritanceChain,
        diag: DiagnosticAddendum | undefined,
        constraints: ConstraintTracker | undefined,
        flags: AssignTypeFlags,
        recursionCount: number
    ): boolean {
        let curSrcType = srcType;
        let prevSrcType: ClassType | undefined;

        inferVarianceForClass(destType);

        // If we're enforcing invariance, literal types must match.
        if ((flags & AssignTypeFlags.Invariant) !== 0) {
            const srcIsLiteral = isLiteralLikeType(srcType);
            const destIsLiteral = isLiteralLikeType(destType);

            if (srcIsLiteral !== destIsLiteral) {
                return false;
            }
        }

        for (let ancestorIndex = inheritanceChain.length - 1; ancestorIndex >= 0; ancestorIndex--) {
            const ancestorType = inheritanceChain[ancestorIndex];

            // If we've hit an "unknown", all bets are off, and we need to assume
            // that the type is assignable. If the destType is marked "@final",
            // we should be able to assume that it's not assignable, but we can't do
            // this in the general case because it breaks assumptions with the
            // NotImplemented symbol exported by typeshed's builtins.pyi. Instead,
            // we'll special-case only None.
            if (isUnknown(ancestorType)) {
                return !isNoneTypeClass(destType);
            }

            // If this isn't the first time through the loop, specialize
            // for the next ancestor in the chain.
            if (ancestorIndex < inheritanceChain.length - 1) {
                // If the curSrcType is a NamedTuple and the ancestorType is a tuple,
                // we need to handle this as a special case because the NamedTuple may
                // include typeParams from its parent class.
                let effectiveCurSrcType = curSrcType;
                if (
                    ClassType.isBuiltIn(curSrcType, 'NamedTuple') &&
                    ClassType.isBuiltIn(ancestorType, 'tuple') &&
                    prevSrcType
                ) {
                    effectiveCurSrcType = prevSrcType;
                }

                curSrcType = specializeForBaseClass(effectiveCurSrcType, ancestorType);
            }

            // If there are no type parameters on this class, we're done.
            const ancestorTypeParams = ClassType.getTypeParams(ancestorType);
            if (ancestorTypeParams.length === 0) {
                continue;
            }

            // If the dest type isn't specialized, there are no type args to validate.
            if (!ancestorType.priv.typeArgs) {
                return true;
            }

            prevSrcType = curSrcType;
        }

        // Handle tuple, which supports a variable number of type arguments.
        if (destType.priv.tupleTypeArgs && curSrcType.priv.tupleTypeArgs) {
            return assignTupleTypeArgs(
                evaluatorInterface,
                destType,
                curSrcType,
                diag,
                constraints,
                flags,
                recursionCount
            );
        }

        if (destType.priv.typeArgs) {
            // If the dest type is specialized, make sure the specialized source
            // type arguments are assignable to the dest type arguments.
            return assignTypeArgs(
                destType,
                curSrcType,
                // Don't emit a diag addendum if we're in an invariant context. It's
                // sufficient to simply indicate that the types are not the same
                // in this case. Adding more information is unnecessary and confusing.
                (flags & AssignTypeFlags.Invariant) === 0 ? diag : undefined,
                constraints,
                flags,
                recursionCount
            );
        }

        if (constraints && curSrcType.priv.typeArgs) {
            // Populate the typeVar map with type arguments of the source.
            const srcTypeArgs = curSrcType.priv.typeArgs;
            for (let i = 0; i < destType.shared.typeParams.length; i++) {
                let typeArgType: Type;
                const typeParam = destType.shared.typeParams[i];
                const variance = TypeVarType.getVariance(typeParam);

                if (curSrcType.priv.tupleTypeArgs) {
                    typeArgType = convertToInstance(
                        makeTupleObject(evaluatorInterface, curSrcType.priv.tupleTypeArgs, /* isUnpacked */ true)
                    );
                } else {
                    typeArgType = i < srcTypeArgs.length ? srcTypeArgs[i] : UnknownType.create();
                }

                constraints.setBounds(
                    typeParam,
                    variance !== Variance.Contravariant ? typeArgType : undefined,
                    variance !== Variance.Covariant ? typeArgType : undefined,
                    /* retainLiterals */ true
                );
            }
        }

        return true;
    }

    function assignRecursiveTypeAliasToSelf(
        destAliasInfo: TypeAliasInfo,
        srcAliasInfo: TypeAliasInfo,
        diag?: DiagnosticAddendum,
        constraints?: ConstraintTracker,
        flags = AssignTypeFlags.Default,
        recursionCount = 0
    ) {
        assert(destAliasInfo.typeArgs !== undefined);
        assert(srcAliasInfo.typeArgs !== undefined);

        let isAssignable = true;
        const srcTypeArgs = srcAliasInfo.typeArgs;
        const variances = destAliasInfo.shared.computedVariance;

        destAliasInfo.typeArgs.forEach((destTypeArg, index) => {
            const srcTypeArg = index < srcTypeArgs.length ? srcTypeArgs[index] : UnknownType.create();

            let adjFlags = flags;
            const variance = variances && index < variances.length ? variances[index] : Variance.Covariant;

            if (variance === Variance.Invariant) {
                adjFlags |= AssignTypeFlags.Invariant;
            } else if (variance === Variance.Contravariant) {
                adjFlags ^= AssignTypeFlags.Contravariant;
            }

            if (!assignType(destTypeArg, srcTypeArg, diag, constraints, adjFlags, recursionCount)) {
                isAssignable = false;
            }
        });

        return isAssignable;
    }

    function assignFromUnionType(
        destType: Type,
        srcType: UnionType,
        diag: DiagnosticAddendum | undefined,
        constraints: ConstraintTracker | undefined,
        flags: AssignTypeFlags,
        recursionCount: number
    ): boolean {
        // Start by checking for an exact match. This is needed to handle unions
        // that contain recursive type aliases.
        if (isTypeSame(srcType, destType, {}, recursionCount)) {
            return true;
        }

        if (
            (flags & AssignTypeFlags.OverloadOverlap) !== 0 &&
            srcType.priv.subtypes.some((subtype) => isAnyOrUnknown(subtype))
        ) {
            return false;
        }

        // Sort the subtypes so we have a deterministic order for unions.
        let sortedSrcTypes: Type[] = sortTypes(srcType.priv.subtypes);
        let matchedSomeSubtypes = false;

        // Handle the case where the source and dest are both unions. Try
        // to eliminate as many exact type matches between the src and dest.
        if (isUnion(destType)) {
            // Handle the special case where the dest is a union of Any and
            // a type variable. This occurs, for example, with the return type of
            // the getattr function.
            const nonAnySubtypes = destType.priv.subtypes.filter((t) => !isAnyOrUnknown(t));
            if (nonAnySubtypes.length === 1 && isTypeVar(nonAnySubtypes[0])) {
                assignType(nonAnySubtypes[0], srcType, /* diag */ undefined, constraints, flags, recursionCount);

                // This always succeeds because the destination contains Any.
                return true;
            }

            const remainingDestSubtypes: Type[] = [];
            let remainingSrcSubtypes: Type[] = sortedSrcTypes;
            let canUseFastPath = true;

            // First attempt to match all of the non-generic types in the dest
            // to non-generic types in the source.
            sortTypes(destType.priv.subtypes).forEach((destSubtype) => {
                if (requiresSpecialization(destSubtype)) {
                    remainingDestSubtypes.push(destSubtype);
                } else {
                    const srcTypeIndex = remainingSrcSubtypes.findIndex((srcSubtype) =>
                        isTypeSame(srcSubtype, destSubtype, {}, recursionCount)
                    );

                    if (srcTypeIndex >= 0) {
                        remainingSrcSubtypes.splice(srcTypeIndex, 1);
                        matchedSomeSubtypes = true;
                    } else {
                        remainingDestSubtypes.push(destSubtype);
                    }
                }
            });

            // For all remaining source subtypes, attempt to find a dest subtype
            // whose primary type matches.
            remainingSrcSubtypes.forEach((srcSubtype) => {
                const destTypeIndex = remainingDestSubtypes.findIndex((destSubtype) => {
                    if (isTypeSame(destSubtype, srcSubtype)) {
                        return true;
                    }

                    if (
                        isClass(srcSubtype) &&
                        isClass(destSubtype) &&
                        TypeBase.isInstance(srcSubtype) === TypeBase.isInstance(destSubtype)
                    ) {
                        if (ClassType.isSameGenericClass(srcSubtype, destSubtype)) {
                            return true;
                        }

                        // Are they equivalent TypedDicts?
                        if (ClassType.isTypedDictClass(srcSubtype) && ClassType.isTypedDictClass(destSubtype)) {
                            if (
                                assignType(
                                    srcSubtype,
                                    destSubtype,
                                    /* diag */ undefined,
                                    /* constraints */ undefined,
                                    flags,
                                    recursionCount
                                )
                            ) {
                                return true;
                            }
                        }
                    }

                    if (isFunctionOrOverloaded(srcSubtype) && isFunctionOrOverloaded(destSubtype)) {
                        return true;
                    }

                    return false;
                });

                if (destTypeIndex >= 0) {
                    if (
                        assignType(
                            remainingDestSubtypes[destTypeIndex],
                            srcSubtype,
                            /* diag */ undefined,
                            constraints,
                            flags,
                            recursionCount
                        )
                    ) {
                        // Note that we have matched at least one subtype indicating
                        // there is at least some overlap.
                        matchedSomeSubtypes = true;
                    } else {
                        canUseFastPath = false;
                    }

                    remainingDestSubtypes.splice(destTypeIndex, 1);
                    remainingSrcSubtypes = remainingSrcSubtypes.filter((t) => t !== srcSubtype);
                }
            });

            // If there is are remaining dest subtypes and they're all type variables,
            // attempt to assign the remaining source subtypes to them.
            if (canUseFastPath && (remainingDestSubtypes.length !== 0 || remainingSrcSubtypes.length !== 0)) {
                if ((flags & AssignTypeFlags.Invariant) !== 0) {
                    // If we have no src subtypes remaining but not all dest types have been subsumed
                    // by other dest types, then the types are not compatible if we're enforcing invariance.
                    if (remainingSrcSubtypes.length === 0) {
                        return remainingDestSubtypes.every((destSubtype) =>
                            isTypeSubsumedByOtherType(
                                destSubtype,
                                destType,
                                /* allowAnyToSubsume */ true,
                                recursionCount
                            )
                        );
                    }
                }

                const isContra = (flags & AssignTypeFlags.Contravariant) !== 0;
                const effectiveDestSubtypes = isContra ? remainingSrcSubtypes : remainingDestSubtypes;

                if (effectiveDestSubtypes.length === 0 || effectiveDestSubtypes.some((t) => !isTypeVar(t))) {
                    canUseFastPath = false;

                    // We can avoid checking the source subtypes that have already been checked.
                    sortedSrcTypes = remainingSrcSubtypes;
                } else if (remainingDestSubtypes.length === remainingSrcSubtypes.length) {
                    // If the number of remaining source subtypes is the same as the number
                    // of dest TypeVars, try to assign each source subtype to its own dest TypeVar.
                    const reorderedDestSubtypes = [...remainingDestSubtypes];

                    for (let srcIndex = 0; srcIndex < remainingSrcSubtypes.length; srcIndex++) {
                        let foundMatchForSrc = false;

                        for (let destIndex = 0; destIndex < reorderedDestSubtypes.length; destIndex++) {
                            if (
                                assignType(
                                    reorderedDestSubtypes[destIndex],
                                    remainingSrcSubtypes[srcIndex],
                                    diag?.createAddendum(),
                                    constraints,
                                    flags,
                                    recursionCount
                                )
                            ) {
                                foundMatchForSrc = true;
                                // Move the matched dest TypeVar to the end of the list so the other
                                // dest TypeVars have a better chance of being assigned to.
                                reorderedDestSubtypes.push(...reorderedDestSubtypes.splice(destIndex, 1));
                                break;
                            }
                        }

                        if (!foundMatchForSrc) {
                            canUseFastPath = false;
                            break;
                        }
                    }

                    // We can avoid checking the source subtypes that have already been checked.
                    sortedSrcTypes = remainingSrcSubtypes;
                } else if (remainingSrcSubtypes.length === 0) {
                    if ((flags & AssignTypeFlags.PopulateExpectedType) !== 0) {
                        // If we're populating an expected type, try not to leave
                        // any TypeVars unsolved. Assign the full type to the remaining
                        // dest TypeVars.
                        remainingDestSubtypes.forEach((destSubtype) => {
                            assignType(destSubtype, srcType, /* diag */ undefined, constraints, flags, recursionCount);
                        });
                    }

                    // If we've assigned all of the source subtypes but one or more dest
                    // TypeVars have gone unmatched, treat this as success.
                } else {
                    // Try to assign a union of the remaining source types to
                    // the first destination TypeVar. If this is a contravariant
                    // context, use the full dest type rather than the remaining
                    // dest subtypes to keep the lower bound as wide as possible.
                    if (
                        !assignType(
                            isContra ? destType : remainingDestSubtypes[0],
                            isContra ? remainingSrcSubtypes[0] : combineTypes(remainingSrcSubtypes),
                            diag?.createAddendum(),
                            constraints,
                            flags,
                            recursionCount
                        )
                    ) {
                        canUseFastPath = false;
                    }
                }
            }

            if (canUseFastPath) {
                return true;
            }

            // If we're looking for type overlaps and at least one type was matched,
            // consider it as assignable.
            if ((flags & AssignTypeFlags.PartialOverloadOverlap) !== 0 && matchedSomeSubtypes) {
                return true;
            }
        }

        let isIncompatible = false;

        sortedSrcTypes.forEach((subtype) => {
            if (isIncompatible) {
                return;
            }

            if (!assignType(destType, subtype, /* diag */ undefined, constraints, flags, recursionCount)) {
                // Determine if the current subtype is subsumed by another subtype
                // in the same union. If so, we can ignore this.
                const isSubtypeSubsumed = isTypeSubsumedByOtherType(
                    subtype,
                    srcType,
                    /* allowAnyToSubsume */ false,
                    recursionCount
                );

                // Try again with a concrete version of the subtype.
                if (
                    !isSubtypeSubsumed &&
                    !assignType(destType, subtype, diag?.createAddendum(), constraints, flags, recursionCount)
                ) {
                    isIncompatible = true;
                }
            } else {
                matchedSomeSubtypes = true;
            }
        }, /* sortSubtypes */ true);

        if (isIncompatible) {
            // If we're looking for type overlaps and at least one type was matched,
            // consider it as assignable.
            if ((flags & AssignTypeFlags.PartialOverloadOverlap) !== 0 && matchedSomeSubtypes) {
                return true;
            }

            diag?.addMessage(LocAddendum.typeAssignmentMismatch().format(printSrcDestTypes(srcType, destType)));
            return false;
        }

        return true;
    }

    function assignToUnionType(
        destType: UnionType,
        srcType: Type,
        diag: DiagnosticAddendum | undefined,
        constraints: ConstraintTracker | undefined,
        flags: AssignTypeFlags,
        recursionCount: number
    ): boolean {
        // If we need to enforce invariance, the source needs to be compatible
        // with all subtypes in the dest, unless those subtypes are subclasses
        // of other subtypes.
        if (flags & AssignTypeFlags.Invariant) {
            let isIncompatible = false;

            doForEachSubtype(destType, (subtype, index) => {
                if (
                    !isIncompatible &&
                    !assignType(subtype, srcType, diag?.createAddendum(), constraints, flags, recursionCount)
                ) {
                    // Determine whether this subtype is subsumed by some other
                    // subtype in the union. If so, we can ignore the incompatibility.
                    let skipSubtype = false;
                    if (!isAnyOrUnknown(subtype)) {
                        const adjSubtype = makeTypeVarsBound(subtype, /* scopeIds */ undefined);

                        doForEachSubtype(destType, (otherSubtype, otherIndex) => {
                            if (index !== otherIndex && !skipSubtype) {
                                const adjOtherSubtype = makeTypeVarsBound(otherSubtype, /* scopeIds */ undefined);

                                if (
                                    assignType(
                                        adjOtherSubtype,
                                        adjSubtype,
                                        /* diag */ undefined,
                                        /* constraints */ undefined,
                                        AssignTypeFlags.Default,
                                        recursionCount
                                    )
                                ) {
                                    skipSubtype = true;
                                }
                            }
                        });
                    }
                    if (!skipSubtype) {
                        isIncompatible = true;
                    }
                }
            });

            if (isIncompatible) {
                diag?.addMessage(LocAddendum.typeAssignmentMismatch().format(printSrcDestTypes(srcType, destType)));
                return false;
            }

            return true;
        }

        // For union destinations, we just need to match one of the types.
        const diagAddendum = diag ? new DiagnosticAddendum() : undefined;

        let foundMatch = false;

        // Does the union contain any type variables that need to be solved?
        // If so, we need to use a slower path.
        if (!requiresSpecialization(destType)) {
            for (const subtype of destType.priv.subtypes) {
                if (assignType(subtype, srcType, diagAddendum?.createAddendum(), constraints, flags, recursionCount)) {
                    foundMatch = true;
                    break;
                }
            }
        } else {
            // Run through all subtypes in the union. Don't stop at the first
            // match we find because we may need to match TypeVars in other
            // subtypes. We special-case "None" so we can handle Optional[T]
            // without matching the None to the type var.
            if (isNoneInstance(srcType) && isOptionalType(destType)) {
                foundMatch = true;
            } else {
                let bestConstraints: ConstraintTracker | undefined;
                let bestConstraintsScore: number | undefined;
                let nakedTypeVarMatches = 0;

                // If the srcType is a literal, try to use the fast-path lookup
                // in case the destType is a union with hundreds of literals.
                if (
                    isClassInstance(srcType) &&
                    isLiteralType(srcType) &&
                    UnionType.containsType(
                        destType,
                        srcType,
                        /* options */ undefined,
                        /* exclusionSet */ undefined,
                        recursionCount
                    )
                ) {
                    return true;
                }

                doForEachSubtype(
                    destType,
                    (subtype) => {
                        // Make a temporary clone of the constraints. We don't want to modify
                        // the original constraints until we find the "optimal" typeVar mapping.
                        const constraintsClone = constraints?.clone();
                        if (
                            assignType(
                                subtype,
                                srcType,
                                diagAddendum?.createAddendum(),
                                constraintsClone,
                                flags,
                                recursionCount
                            )
                        ) {
                            foundMatch = true;
                            if (constraintsClone) {
                                // Ask the constraints to compute a "score" for the current
                                // contents of the table.
                                let constraintsScore = constraintsClone.getScore();

                                if (isTypeVar(subtype)) {
                                    if (!constraints?.getMainConstraintSet().getTypeVar(subtype)) {
                                        nakedTypeVarMatches++;

                                        // Handicap the solution slightly so another type var with
                                        // existing constraints will be preferred.
                                        constraintsScore += 0.001;
                                    }
                                }

                                // If the type matches exactly, prefer it over other types.
                                if (isTypeSame(subtype, stripLiteralValue(srcType))) {
                                    constraintsScore = Number.POSITIVE_INFINITY;
                                }

                                if (bestConstraintsScore === undefined || bestConstraintsScore <= constraintsScore) {
                                    // We found a typeVar mapping with a higher score than before.
                                    bestConstraintsScore = constraintsScore;
                                    bestConstraints = constraintsClone;
                                }
                            }
                        }
                    },
                    /* sortSubtypes */ true
                );

                // If we saw more than one "naked" type vars that have no
                // previous constraints recorded, it's dangerous for us to
                // assign a value to any of these type vars at this time.
                // Typically, they will receive some constraints via some
                // later argument assignment.
                if (nakedTypeVarMatches > 1 && (flags & AssignTypeFlags.ArgAssignmentFirstPass) !== 0) {
                    bestConstraints = undefined;
                }

                // If we found a winning type var mapping, copy it back to constraints.
                if (constraints && bestConstraints) {
                    constraints.copyFromClone(bestConstraints);
                }
            }
        }

        // If the source is a constrained TypeVar, see if we can assign all of the
        // constraints to the union.
        if (!foundMatch) {
            if (isTypeVar(srcType) && TypeVarType.hasConstraints(srcType)) {
                foundMatch = assignType(
                    destType,
                    makeTopLevelTypeVarsConcrete(srcType),
                    diagAddendum?.createAddendum(),
                    constraints,
                    flags,
                    recursionCount
                );
            }
        }

        if (!foundMatch) {
            if (diag && diagAddendum) {
                diag.addMessage(LocAddendum.typeAssignmentMismatch().format(printSrcDestTypes(srcType, destType)));
                diag.addAddendum(diagAddendum);
            }
            return false;
        }

        return true;
    }

    function assignConditionalTypeToTypeVar(destType: TypeVarType, srcType: Type, recursionCount: number): boolean {
        // The srcType is assignable only if all of its subtypes are assignable.
        return !findSubtype(srcType, (srcSubtype) => {
            if (isTypeSame(destType, srcSubtype, { ignorePseudoGeneric: true }, recursionCount)) {
                return false;
            }

            if (isIncompleteUnknown(srcSubtype)) {
                return false;
            }

            const destTypeVarName = TypeVarType.getNameWithScope(destType);

            // Determine which conditions on this type apply to this type variable.
            // There might be more than one of them.
            const applicableConditions = (getTypeCondition(srcSubtype) ?? []).filter(
                (constraint) => constraint.typeVar.priv.nameWithScope === destTypeVarName
            );

            // If there are no applicable conditions, it's not assignable.
            if (applicableConditions.length === 0) {
                return true;
            }

            return !applicableConditions.some((condition) => {
                if (condition.typeVar.priv.nameWithScope === TypeVarType.getNameWithScope(destType)) {
                    if (destType.shared.boundType) {
                        assert(
                            condition.constraintIndex === 0,
                            'Expected constraint for bound TypeVar to have index of 0'
                        );

                        return assignType(
                            destType.shared.boundType,
                            srcSubtype,
                            /* diag */ undefined,
                            /* constraints */ undefined,
                            AssignTypeFlags.Default,
                            recursionCount
                        );
                    }

                    if (TypeVarType.hasConstraints(destType)) {
                        assert(
                            condition.constraintIndex < destType.shared.constraints.length,
                            'Constraint for constrained TypeVar is out of bounds'
                        );

                        return assignType(
                            destType.shared.constraints[condition.constraintIndex],
                            srcSubtype,
                            /* diag */ undefined,
                            /* constraints */ undefined,
                            AssignTypeFlags.Default,
                            recursionCount
                        );
                    }

                    // This is a non-bound and non-constrained type variable with a matching condition.
                    return true;
                }

                return false;
            });
        });
    }

    function assignParam(
        destType: Type,
        srcType: Type,
        paramIndex: number | undefined,
        diag: DiagnosticAddendum | undefined,
        constraints: ConstraintTracker,
        flags: AssignTypeFlags,
        recursionCount: number
    ) {
        if (isTypeVarTuple(destType) && !isUnpacked(srcType)) {
            return false;
        }

        let specializedSrcType = srcType;
        let specializedDestType = destType;
        let doSpecializationStep = false;

        if ((flags & AssignTypeFlags.OverloadOverlap) === 0) {
            const isFirstPass = (flags & AssignTypeFlags.ArgAssignmentFirstPass) !== 0;

            if ((flags & AssignTypeFlags.Contravariant) === 0) {
                if (!isFirstPass) {
                    specializedDestType = solveAndApplyConstraints(
                        destType,
                        constraints,
                        /* applyOptions */ undefined,
                        { useLowerBoundOnly: true }
                    );
                }
                doSpecializationStep = requiresSpecialization(specializedDestType);
            } else {
                if (!isFirstPass) {
                    specializedSrcType = solveAndApplyConstraints(srcType, constraints, /* applyOptions */ undefined, {
                        useLowerBoundOnly: true,
                    });
                }
                doSpecializationStep = requiresSpecialization(specializedSrcType);
            }
        }

        // Is an additional specialization step required?
        if (doSpecializationStep) {
            if (
                assignType(
                    specializedSrcType,
                    specializedDestType,
                    /* diag */ undefined,
                    constraints,
                    (flags ^ AssignTypeFlags.Contravariant) | AssignTypeFlags.RetainLiteralsForTypeVar,
                    recursionCount
                )
            ) {
                specializedDestType = solveAndApplyConstraints(destType, constraints);
            }
        }

        if (
            !assignType(
                specializedSrcType,
                specializedDestType,
                diag?.createAddendum(),
                constraints,
                flags,
                recursionCount
            )
        ) {
            if (diag && paramIndex !== undefined) {
                diag.addMessage(
                    LocAddendum.paramAssignment().format({
                        index: paramIndex + 1,
                        sourceType: printType(destType),
                        destType: printType(srcType),
                    })
                );
            }

            return false;
        }

        return true;
    }

    function assignFunction(
        destType: FunctionType,
        srcType: FunctionType,
        diag: DiagnosticAddendum | undefined,
        constraints: ConstraintTracker,
        flags: AssignTypeFlags,
        recursionCount: number
    ): boolean {
        let canAssign = true;
        const checkReturnType = (flags & AssignTypeFlags.SkipReturnTypeCheck) === 0;
        const isContra = (flags & AssignTypeFlags.Contravariant) !== 0;
        flags &= ~AssignTypeFlags.SkipReturnTypeCheck;

        const destParamSpec = FunctionType.getParamSpecFromArgsKwargs(destType);
        if (destParamSpec) {
            destType = FunctionType.cloneRemoveParamSpecArgsKwargs(destType);
        }

        const srcParamSpec = FunctionType.getParamSpecFromArgsKwargs(srcType);
        if (srcParamSpec) {
            srcType = FunctionType.cloneRemoveParamSpecArgsKwargs(srcType);
        }

        const destParamDetails = getParamListDetails(destType, {
            disallowExtraKwargsForTd: (flags & AssignTypeFlags.DisallowExtraKwargsForTd) !== 0,
        });
        const srcParamDetails = getParamListDetails(srcType, {
            disallowExtraKwargsForTd: (flags & AssignTypeFlags.DisallowExtraKwargsForTd) !== 0,
        });

        adjustSourceParamDetailsForDestVariadic(
            isContra ? destParamDetails : srcParamDetails,
            isContra ? srcParamDetails : destParamDetails
        );

        let paramListOmissionResult: boolean | undefined;
        const checkParamListOmission = () => {
            if (paramListOmissionResult === undefined) {
                paramListOmissionResult = isParamListOverlapOnlyByOmission(
                    destType,
                    srcType,
                    destParamDetails,
                    srcParamDetails,
                    recursionCount
                );
            }
            return paramListOmissionResult;
        };

        const targetIncludesParamSpec = isContra ? !!srcParamSpec : !!destParamSpec;

        const destPositionalCount = destParamDetails.firstKeywordOnlyIndex ?? destParamDetails.params.length;
        const srcPositionalCount = srcParamDetails.firstKeywordOnlyIndex ?? srcParamDetails.params.length;
        const positionalsToMatch = Math.min(destPositionalCount, srcPositionalCount);
        const skippedPosParamIndices: number[] = [];

        // Match positional parameters.
        for (let paramIndex = 0; paramIndex < positionalsToMatch; paramIndex++) {
            if (
                paramIndex === 0 &&
                destType.shared.methodClass &&
                (flags & AssignTypeFlags.SkipSelfClsParamCheck) !== 0
            ) {
                if (FunctionType.isInstanceMethod(destType) || FunctionType.isClassMethod(destType)) {
                    continue;
                }
            }

            // Skip over the *args parameter since it's handled separately below.
            if (paramIndex === destParamDetails.argsIndex) {
                if (!isUnpackedTypeVarTuple(destParamDetails.params[destParamDetails.argsIndex].type)) {
                    skippedPosParamIndices.push(paramIndex);
                }
                continue;
            }

            const destParam = destParamDetails.params[paramIndex];
            const srcParam = srcParamDetails.params[paramIndex];

            // Find the original index of this source param. If we synthesized it above (for
            // a variadic parameter), it may not be found.
            const srcParamType = srcParam.type;
            const destParamType = destParam.type;

            const destParamName = destParam.param.name ?? '';
            const srcParamName = srcParam.param.name ?? '';
            if (destParamName) {
                const isDestPositionalOnly =
                    destParam.kind === ParamKind.Positional || destParam.kind === ParamKind.ExpandedArgs;
                if (
                    !isDestPositionalOnly &&
                    destParam.param.category !== ParamCategory.ArgsList &&
                    srcParam.param.category !== ParamCategory.ArgsList
                ) {
                    if (srcParam.kind === ParamKind.Positional || srcParam.kind === ParamKind.ExpandedArgs) {
                        diag?.createAddendum().addMessage(
                            LocAddendum.functionParamPositionOnly().format({
                                name: destParamName,
                            })
                        );
                        canAssign = false;
                    } else if (destParamName !== srcParamName) {
                        diag?.createAddendum().addMessage(
                            LocAddendum.functionParamName().format({
                                srcName: srcParamName,
                                destName: destParamName,
                            })
                        );
                        canAssign = false;
                    }
                }
            }

            if (destParam.defaultType) {
                if (!srcParam.defaultType && paramIndex !== srcParamDetails.argsIndex) {
                    diag?.createAddendum().addMessage(
                        LocAddendum.functionParamDefaultMissing().format({
                            name: srcParamName,
                        })
                    );
                    canAssign = false;
                }

                // If we're performing a partial overload match and both the source
                // and dest parameters provide defaults, assume that there could
                // be a match.
                if ((flags & AssignTypeFlags.PartialOverloadOverlap) !== 0) {
                    if (srcParam.defaultType) {
                        if (
                            isOverlapOnlyByOmission(destParamType, destParam.defaultType, srcParamType) &&
                            checkParamListOmission()
                        ) {
                            canAssign = false;
                        }
                        continue;
                    }
                }
            }

            // Handle the special case of an overloaded __init__ method whose self
            // parameter is annotated.
            if (
                paramIndex === 0 &&
                srcType.shared.name === '__init__' &&
                FunctionType.isInstanceMethod(srcType) &&
                destType.shared.name === '__init__' &&
                FunctionType.isInstanceMethod(destType) &&
                FunctionType.isOverloaded(destType) &&
                FunctionParam.isTypeDeclared(destParam.param)
            ) {
                continue;
            }

            if (isUnpacked(srcParamType)) {
                canAssign = false;
            } else if (
                !assignParam(
                    destParamType,
                    srcParamType,
                    paramIndex,
                    diag?.createAddendum(),
                    constraints,
                    flags,
                    recursionCount
                )
            ) {
                // Handle the special case where the source parameter is a synthesized
                // TypeVar for "self" or "cls".
                if (
                    (flags & AssignTypeFlags.SkipSelfClsTypeCheck) === 0 ||
                    !isTypeVar(srcParamType) ||
                    !srcParamType.shared.isSynthesized
                ) {
                    canAssign = false;
                }
            } else if (
                destParam.kind !== ParamKind.Positional &&
                destParam.kind !== ParamKind.ExpandedArgs &&
                srcParam.kind === ParamKind.Positional &&
                !srcParamDetails.params.some(
                    (p) =>
                        p.kind === ParamKind.Keyword &&
                        p.param.category === ParamCategory.Simple &&
                        p.param.name === destParam.param.name
                )
            ) {
                if (
                    !assignNamedParam(
                        destParamDetails,
                        srcParamDetails,
                        paramIndex,
                        diag,
                        constraints,
                        flags,
                        recursionCount
                    )
                ) {
                    canAssign = false;
                }
            }
        }

        if (
            !FunctionType.isGradualCallableForm(destType) &&
            destParamDetails.firstPositionOrKeywordIndex < srcParamDetails.positionOnlyParamCount &&
            !targetIncludesParamSpec
        ) {
            diag?.createAddendum().addMessage(
                LocAddendum.argsPositionOnly().format({
                    expected: destParamDetails.firstPositionOrKeywordIndex,
                    received: srcParamDetails.positionOnlyParamCount,
                })
            );
            canAssign = false;
        }

        if (destPositionalCount < srcPositionalCount && !targetIncludesParamSpec) {
            // Add any remaining positional parameter indices to the list that
            // need to be validated.
            for (let i = destPositionalCount; i < srcPositionalCount; i++) {
                skippedPosParamIndices.push(i);
            }

            for (const i of skippedPosParamIndices) {
                // If the dest has an *args parameter, make sure it can accept the remaining
                // positional arguments in the source.
                if (destParamDetails.argsIndex !== undefined) {
                    const destArgsType = destParamDetails.params[destParamDetails.argsIndex].type;
                    const srcParamType = srcParamDetails.params[i].type;
                    if (
                        !assignParam(
                            destArgsType,
                            srcParamType,
                            i,
                            diag?.createAddendum(),
                            constraints,
                            flags,
                            recursionCount
                        )
                    ) {
                        canAssign = false;
                    }

                    continue;
                }

                // If The source parameter has a default value, it is OK for the
                // corresponding dest parameter to be missing.
                const srcParam = srcParamDetails.params[i];

                if (srcParam.defaultType) {
                    // Assign default arg value in case it is needed for
                    // populating TypeVar constraints.
                    const paramInfo = srcParamDetails.params[i];
                    const defaultArgType = paramInfo.defaultType ?? paramInfo.defaultType;

                    // Enforce invariance below because the default arg value
                    // is constructed prior to the call, so its type is already
                    // fixed.
                    if (
                        defaultArgType &&
                        !assignType(
                            paramInfo.type,
                            defaultArgType,
                            diag?.createAddendum(),
                            constraints,
                            flags,
                            recursionCount
                        )
                    ) {
                        if ((flags & AssignTypeFlags.PartialOverloadOverlap) === 0) {
                            canAssign = false;
                        }
                    }

                    continue;
                }

                // If the source parameter is also addressable by keyword, it is OK
                // that there is no matching positional parameter in the dest.
                if (srcParam.kind === ParamKind.Standard) {
                    continue;
                }

                // If the source parameter is a variadic, it is OK that there is no
                // matching positional parameter in the dest.
                if (srcParam.param.category === ParamCategory.ArgsList) {
                    continue;
                }

                const nonDefaultSrcParamCount = srcParamDetails.params.filter(
                    (p) => !!p.param.name && !p.defaultType && p.param.category === ParamCategory.Simple
                ).length;

                diag?.createAddendum().addMessage(
                    LocAddendum.functionTooManyParams().format({
                        expected: destPositionalCount,
                        received: nonDefaultSrcParamCount,
                    })
                );
                canAssign = false;
                break;
            }
        } else if (srcPositionalCount < destPositionalCount) {
            if (srcParamDetails.argsIndex !== undefined) {
                // Make sure the remaining dest parameters can be assigned to the source
                // *args parameter type.
                const srcArgsType = srcParamDetails.params[srcParamDetails.argsIndex].type;
                for (let paramIndex = srcPositionalCount; paramIndex < destPositionalCount; paramIndex++) {
                    if (paramIndex === srcParamDetails.argsIndex) {
                        continue;
                    }

                    const destParamType = destParamDetails.params[paramIndex].type;
                    if (isTypeVarTuple(destParamType) && !isTypeVarTuple(srcArgsType)) {
                        diag?.addMessage(LocAddendum.typeVarTupleRequiresKnownLength());
                        canAssign = false;
                    } else {
                        if (
                            !assignParam(
                                destParamType,
                                srcArgsType,
                                paramIndex,
                                diag?.createAddendum(),
                                constraints,
                                flags,
                                recursionCount
                            )
                        ) {
                            canAssign = false;
                        }

                        const destParamKind = destParamDetails.params[paramIndex].kind;
                        if (destParamKind !== ParamKind.Positional && destParamKind !== ParamKind.ExpandedArgs) {
                            if (
                                !assignNamedParam(
                                    destParamDetails,
                                    srcParamDetails,
                                    paramIndex,
                                    diag,
                                    constraints,
                                    flags,
                                    recursionCount
                                )
                            ) {
                                canAssign = false;
                            }
                        }
                    }
                }
            } else if (!srcParamDetails.paramSpec) {
                // If the dest contains a *args, remove it from the positional count
                // because it's OK for zero source args to match it.
                let adjDestPositionalCount = destPositionalCount;
                if (destParamDetails.argsIndex !== undefined && destParamDetails.argsIndex < destPositionalCount) {
                    adjDestPositionalCount--;
                }

                // If we're doing a partial overload overlap check, ignore dest positional
                // params with default values.
                if ((flags & AssignTypeFlags.PartialOverloadOverlap) !== 0) {
                    while (
                        adjDestPositionalCount > 0 &&
                        destParamDetails.params[adjDestPositionalCount - 1].defaultType
                    ) {
                        adjDestPositionalCount--;
                    }
                }

                if (srcPositionalCount < adjDestPositionalCount) {
                    diag?.addMessage(
                        LocAddendum.functionTooFewParams().format({
                            expected: adjDestPositionalCount,
                            received: srcPositionalCount,
                        })
                    );
                    canAssign = false;
                }
            }
        }

        // If both src and dest have an "*args" parameter, make sure
        // their types are compatible.
        if (
            srcParamDetails.argsIndex !== undefined &&
            destParamDetails.argsIndex !== undefined &&
            !FunctionType.isGradualCallableForm(destType)
        ) {
            let destArgsType = destParamDetails.params[destParamDetails.argsIndex].type;
            let srcArgsType = srcParamDetails.params[srcParamDetails.argsIndex].type;

            if (!isUnpacked(destArgsType)) {
                destArgsType = makeTupleObject(
                    evaluatorInterface,
                    [{ type: destArgsType, isUnbounded: true }],
                    /* isUnpacked */ true
                );
            }

            if (!isUnpacked(srcArgsType)) {
                srcArgsType = makeTupleObject(
                    evaluatorInterface,
                    [{ type: srcArgsType, isUnbounded: true }],
                    /* isUnpacked */ true
                );
            }

            if (
                !assignParam(
                    destArgsType,
                    srcArgsType,
                    destParamDetails.params[destParamDetails.argsIndex].index,
                    diag?.createAddendum(),
                    constraints,
                    flags,
                    recursionCount
                )
            ) {
                canAssign = false;
            }
        }

        // If the dest has an "*args" but the source doesn't, report the incompatibility.
        // The converse situation is OK.
        if (
            !FunctionType.isGradualCallableForm(destType) &&
            srcParamDetails.argsIndex === undefined &&
            srcParamSpec === undefined &&
            destParamDetails.argsIndex !== undefined &&
            !destParamDetails.hasUnpackedTypeVarTuple
        ) {
            diag?.createAddendum().addMessage(
                LocAddendum.argsParamMissing().format({
                    paramName: destParamDetails.params[destParamDetails.argsIndex].param.name ?? '',
                })
            );
            canAssign = false;
        }

        // Handle matching of named (keyword) parameters.
        if (!targetIncludesParamSpec) {
            // Build a dictionary of named parameters in the dest.
            const destParamMap = new Map<string, VirtualParamDetails>();

            if (destParamDetails.firstKeywordOnlyIndex !== undefined) {
                destParamDetails.params.forEach((param, index) => {
                    if (index >= destParamDetails.firstKeywordOnlyIndex!) {
                        if (
                            param.param.name &&
                            param.param.category === ParamCategory.Simple &&
                            param.kind !== ParamKind.Positional &&
                            param.kind !== ParamKind.ExpandedArgs
                        ) {
                            destParamMap.set(param.param.name, param);
                        }
                    }
                });
            }

            // If the dest has fewer positional arguments than the source, the remaining
            // positional arguments in the source can be treated as named arguments.
            let srcStartOfNamed =
                srcParamDetails.firstKeywordOnlyIndex !== undefined
                    ? srcParamDetails.firstKeywordOnlyIndex
                    : srcParamDetails.params.length;
            if (destPositionalCount < srcPositionalCount && destParamDetails.argsIndex === undefined) {
                srcStartOfNamed = destPositionalCount;
            }

            if (srcStartOfNamed >= 0) {
                srcParamDetails.params.forEach((srcParamInfo, index) => {
                    if (index < srcStartOfNamed) {
                        return;
                    }

                    if (
                        !srcParamInfo.param.name ||
                        srcParamInfo.param.category !== ParamCategory.Simple ||
                        srcParamInfo.kind === ParamKind.Positional
                    ) {
                        return;
                    }

                    const destParamInfo =
                        destParamMap.get(srcParamInfo.param.name) ??
                        destParamDetails.params.find(
                            (paramInfo) =>
                                paramInfo.param.name === srcParamInfo.param.name &&
                                paramInfo.kind === ParamKind.Standard &&
                                paramInfo.param.category === ParamCategory.Simple
                        );
                    const paramDiag = diag?.createAddendum();
                    const srcParamType = srcParamInfo.type;

                    if (!destParamInfo) {
                        if (destParamDetails.kwargsIndex === undefined && !srcParamInfo.defaultType) {
                            if (paramDiag) {
                                paramDiag.addMessage(
                                    LocAddendum.namedParamMissingInDest().format({
                                        name: srcParamInfo.param.name,
                                    })
                                );
                            }
                            canAssign = false;
                        } else if (destParamDetails.kwargsIndex !== undefined) {
                            // Make sure we can assign the type to the Kwargs.
                            if (
                                !assignParam(
                                    destParamDetails.params[destParamDetails.kwargsIndex].type,
                                    srcParamType,
                                    destParamDetails.params[destParamDetails.kwargsIndex].index,
                                    diag?.createAddendum(),
                                    constraints,
                                    flags,
                                    recursionCount
                                )
                            ) {
                                canAssign = false;
                            }
                        } else if (srcParamInfo.defaultType) {
                            // Assign default arg values in case they are needed for
                            // populating TypeVar constraints.
                            const defaultArgType = srcParamInfo.defaultType ?? srcParamInfo.defaultType;

                            if (
                                defaultArgType &&
                                !assignType(
                                    srcParamInfo.type,
                                    defaultArgType,
                                    diag?.createAddendum(),
                                    constraints,
                                    flags,
                                    recursionCount
                                )
                            ) {
                                if ((flags & AssignTypeFlags.PartialOverloadOverlap) === 0) {
                                    canAssign = false;
                                }
                            }
                        }
                        return;
                    }

                    // A keyword-only source parameter was matched to a positional-or-keyword
                    // dest parameter. The dest parameter can be called positionally, but a
                    // keyword-only source parameter with no default would be left unsatisfied.
                    if (
                        destParamInfo.kind === ParamKind.Standard &&
                        srcParamInfo.kind === ParamKind.Keyword &&
                        !srcParamInfo.defaultType
                    ) {
                        if ((flags & AssignTypeFlags.PartialOverloadOverlap) === 0) {
                            paramDiag?.addMessage(
                                LocAddendum.functionParamDefaultMissing().format({
                                    name: srcParamInfo.param.name,
                                })
                            );
                            canAssign = false;
                            return;
                        }
                    }

                    // If we're performing a partial overload match and both the source
                    // and dest parameters provide defaults, assume that there could
                    // be a match.
                    if (srcParamInfo.defaultType && destParamInfo.defaultType) {
                        if ((flags & AssignTypeFlags.PartialOverloadOverlap) !== 0) {
                            if (
                                isOverlapOnlyByOmission(destParamInfo.type, destParamInfo.defaultType, srcParamType) &&
                                checkParamListOmission()
                            ) {
                                canAssign = false;
                            }
                            destParamMap.delete(srcParamInfo.param.name);
                            return;
                        }
                    }

                    const destParamType = destParamInfo.type;
                    const specializedDestParamType = constraints
                        ? solveAndApplyConstraints(destParamType, constraints)
                        : destParamType;

                    if (
                        !assignParam(
                            destParamInfo.type,
                            srcParamType,
                            /* paramIndex */ undefined,
                            paramDiag?.createAddendum(),
                            constraints,
                            flags,
                            recursionCount
                        )
                    ) {
                        if (paramDiag) {
                            paramDiag.addMessage(
                                LocAddendum.namedParamTypeMismatch().format({
                                    name: srcParamInfo.param.name,
                                    sourceType: printType(specializedDestParamType),
                                    destType: printType(srcParamType),
                                })
                            );
                        }
                        if (
                            destParamInfo.kind !== ParamKind.Standard ||
                            (flags & AssignTypeFlags.PartialOverloadOverlap) === 0
                        ) {
                            canAssign = false;
                        }
                    }

                    if (destParamInfo.defaultType && !srcParamInfo.defaultType) {
                        diag?.createAddendum().addMessage(
                            LocAddendum.functionParamDefaultMissing().format({
                                name: srcParamInfo.param.name,
                            })
                        );
                        canAssign = false;
                    }

                    destParamMap.delete(srcParamInfo.param.name);
                });
            }

            // See if there are any unmatched named parameters.
            destParamMap.forEach((destParamInfo, paramName) => {
                if (srcParamDetails.kwargsIndex !== undefined && destParamInfo.param.name) {
                    // Make sure the src kwargs type is compatible.
                    if (
                        !assignParam(
                            destParamInfo.type,
                            srcParamDetails.params[srcParamDetails.kwargsIndex].type,
                            destParamInfo.index,
                            diag?.createAddendum(),
                            constraints,
                            flags,
                            recursionCount
                        )
                    ) {
                        canAssign = false;
                    }
                    destParamMap.delete(paramName);
                } else {
                    diag?.createAddendum().addMessage(
                        LocAddendum.namedParamMissingInSource().format({ name: paramName })
                    );
                    canAssign = false;
                }
            });

            // If both src and dest have a "**kwargs" parameter, make sure their types are compatible.
            if (srcParamDetails.kwargsIndex !== undefined && destParamDetails.kwargsIndex !== undefined) {
                if (
                    !assignParam(
                        destParamDetails.params[destParamDetails.kwargsIndex].type,
                        srcParamDetails.params[srcParamDetails.kwargsIndex].type,
                        destParamDetails.params[destParamDetails.kwargsIndex].index,
                        diag?.createAddendum(),
                        constraints,
                        flags,
                        recursionCount
                    )
                ) {
                    canAssign = false;
                }
            }

            // If the dest has a "**kwargs" but the source doesn't, report the incompatibility.
            // The converse situation is OK.
            if (
                !FunctionType.isGradualCallableForm(destType) &&
                srcParamDetails.kwargsIndex === undefined &&
                srcParamSpec === undefined &&
                destParamDetails.kwargsIndex !== undefined
            ) {
                diag?.createAddendum().addMessage(
                    LocAddendum.kwargsParamMissing().format({
                        paramName: destParamDetails.params[destParamDetails.kwargsIndex].param.name!,
                    })
                );
                canAssign = false;
            }
        }

        if ((flags & AssignTypeFlags.OverloadOverlap) !== 0) {
            // If we're checking for full overlapping overloads and the source is
            // a gradual form, the dest must also be a gradual form.
            if (FunctionType.isGradualCallableForm(srcType) && !FunctionType.isGradualCallableForm(destType)) {
                canAssign = false;
            }

            // If the src contains a ParamSpec the dest must also.
            if (srcParamSpec && !destParamSpec) {
                canAssign = false;
            }
        }

        // If the source and the dest are using the same ParamSpec, any additional
        // concatenated parameters must match.
        if (targetIncludesParamSpec && srcParamSpec?.priv.nameWithScope === destParamSpec?.priv.nameWithScope) {
            if (srcParamDetails.params.length !== destParamDetails.params.length) {
                canAssign = false;
            }
        }

        // Are we assigning to a function with a ParamSpec?
        if (targetIncludesParamSpec) {
            const effectiveSrcType = isContra ? destType : srcType;
            const effectiveDestType = isContra ? srcType : destType;

            const effectiveSrcParamSpec = isContra ? destParamSpec : srcParamSpec;
            const effectiveDestParamSpec = isContra ? srcParamSpec : destParamSpec;

            if (effectiveDestParamSpec) {
                const requiredMatchParamCount = effectiveDestType.shared.parameters.filter((p, i) => {
                    if (!p.name) {
                        return false;
                    }

                    const paramType = FunctionType.getParamType(effectiveDestType, i);
                    if (p.category === ParamCategory.Simple && isParamSpec(paramType)) {
                        return false;
                    }
                    return true;
                }).length;
                let matchedParamCount = 0;
                const remainingParams: FunctionParam[] = [];

                // If there are parameters in the source that are not matched
                // to parameters in the dest, assume these are concatenated on
                // to the ParamSpec.
                effectiveSrcType.shared.parameters.forEach((p, index) => {
                    if (matchedParamCount < requiredMatchParamCount) {
                        if (p.name) {
                            matchedParamCount++;
                        }

                        // If this is a *args parameter, assume that it provides
                        // the remaining positional parameters, but also assume
                        // that it is not exhausted and can provide additional
                        // parameters.
                        if (p.category !== ParamCategory.ArgsList) {
                            return;
                        }
                    }

                    if (isPositionOnlySeparator(p) && remainingParams.length === 0) {
                        // Don't bother pushing a position-only separator if it
                        // is the first remaining param.
                        return;
                    }

                    remainingParams.push(
                        FunctionParam.create(
                            p.category,
                            FunctionType.getParamType(effectiveSrcType, index),
                            p.flags,
                            p.name,
                            FunctionType.getParamDefaultType(effectiveSrcType, index),
                            p.defaultExpr
                        )
                    );
                });

                // If there are remaining parameters and the source and dest do not contain
                // the same ParamSpec, synthesize a function for the remaining parameters.
                if (
                    remainingParams.length > 0 ||
                    !effectiveSrcParamSpec ||
                    !isTypeSame(effectiveSrcParamSpec, effectiveDestParamSpec, { ignoreTypeFlags: true })
                ) {
                    const effectiveSrcPosCount = isContra ? destPositionalCount : srcPositionalCount;
                    const effectiveDestPosCount = isContra ? srcPositionalCount : destPositionalCount;

                    // If the src and dest both have ParamSpecs but the src has additional positional
                    // parameters that have not been matched to dest positional parameters (probably due
                    // to a Concatenate), don't attempt to assign the remaining parameters to the ParamSpec.
                    if (!effectiveSrcParamSpec || effectiveSrcPosCount >= effectiveDestPosCount) {
                        const remainingFunction = FunctionType.createInstance(
                            '',
                            '',
                            '',
                            effectiveSrcType.shared.flags | FunctionTypeFlags.SynthesizedMethod,
                            effectiveSrcType.shared.docString
                        );
                        remainingFunction.shared.deprecatedMessage = effectiveSrcType.shared.deprecatedMessage;
                        remainingFunction.shared.typeVarScopeId = effectiveSrcType.shared.typeVarScopeId;
                        remainingFunction.priv.constructorTypeVarScopeId =
                            effectiveSrcType.priv.constructorTypeVarScopeId;
                        remainingFunction.shared.methodClass = effectiveSrcType.shared.methodClass;
                        remainingParams.forEach((param) => {
                            FunctionType.addParam(remainingFunction, param);
                        });
                        if (effectiveSrcParamSpec) {
                            FunctionType.addParamSpecVariadics(
                                remainingFunction,
                                convertToInstance(effectiveSrcParamSpec)
                            );
                        }

                        if (
                            !assignType(
                                effectiveDestParamSpec,
                                remainingFunction,
                                /* diag */ undefined,
                                constraints,
                                flags
                            )
                        ) {
                            // If we couldn't assign the function to the ParamSpec, see if we can
                            // assign only the ParamSpec. This is possible if there were no
                            // remaining parameters.
                            if (
                                remainingParams.length > 0 ||
                                !effectiveSrcParamSpec ||
                                !assignType(
                                    convertToInstance(effectiveDestParamSpec),
                                    convertToInstance(effectiveSrcParamSpec),
                                    /* diag */ undefined,
                                    constraints,
                                    flags
                                )
                            ) {
                                canAssign = false;
                            }
                        }
                    }
                }
            }
        }

        // Match the return parameter.
        if (checkReturnType) {
            const destReturnType = getEffectiveReturnType(destType);
            if (!isAnyOrUnknown(destReturnType)) {
                let srcReturnType = solveAndApplyConstraints(getEffectiveReturnType(srcType), constraints);
                // Intrinsic returns can depend on the target callable's narrower parameter domain.
                if (
                    canAssign &&
                    (flags &
                        (AssignTypeFlags.OverloadOverlap |
                            AssignTypeFlags.PartialOverloadOverlap |
                            AssignTypeFlags.Contravariant)) ===
                        0
                ) {
                    const intrinsicReturnType = getIntFlagReturnTypeForCallable(
                        evaluatorInterface,
                        srcType,
                        srcParamDetails,
                        destParamDetails,
                        srcReturnType
                    );
                    if (intrinsicReturnType) {
                        srcReturnType = solveAndApplyConstraints(intrinsicReturnType, constraints);
                    }
                }
                const returnDiag = diag?.createAddendum();

                let isReturnTypeCompatible = false;

                let effectiveFlags = flags;

                // If the source has a declared return type that includes a literal
                // in its annotation, assume that we will want the constraint
                // solver to retain literals.
                if (
                    srcType.shared.declaredReturnType &&
                    containsLiteralType(srcType.shared.declaredReturnType, /* includeTypeArgs */ true)
                ) {
                    effectiveFlags |= AssignTypeFlags.RetainLiteralsForTypeVar;
                }

                if (
                    assignType(
                        destReturnType,
                        srcReturnType,
                        returnDiag?.createAddendum(),
                        constraints,
                        effectiveFlags,
                        recursionCount
                    )
                ) {
                    isReturnTypeCompatible = true;
                } else {
                    // Handle the special case where the return type is a TypeGuard[T]
                    // or TypeIs[T]. This should also act as a bool, since that's its
                    // type at runtime.
                    if (
                        isClassInstance(srcReturnType) &&
                        ClassType.isBuiltIn(srcReturnType, ['TypeGuard', 'TypeIs']) &&
                        context.prefetched?.boolClass &&
                        isInstantiableClass(context.prefetched.boolClass)
                    ) {
                        if (
                            assignType(
                                destReturnType,
                                ClassType.cloneAsInstance(context.prefetched.boolClass),
                                returnDiag?.createAddendum(),
                                constraints,
                                flags,
                                recursionCount
                            )
                        ) {
                            isReturnTypeCompatible = true;
                        }
                    }
                }

                if (!isReturnTypeCompatible) {
                    if (returnDiag) {
                        returnDiag.addMessage(
                            LocAddendum.functionReturnTypeMismatch().format({
                                sourceType: printType(srcReturnType),
                                destType: printType(destReturnType),
                            })
                        );
                    }
                    canAssign = false;
                }
            }
        }

        return canAssign;
    }

    function adjustSourceParamDetailsForDestVariadic(srcDetails: ParamListDetails, destDetails: ParamListDetails) {
        // If there is no *args parameter in the dest, we have nothing to do.
        if (destDetails.argsIndex === undefined) {
            return;
        }

        // If the *args parameter isn't an unpacked TypeVarTuple or tuple,
        // we have nothing to do.
        if (!isUnpacked(destDetails.params[destDetails.argsIndex].type)) {
            return;
        }

        // If the source doesn't have enough positional parameters, we have nothing to do.
        if (srcDetails.params.length < destDetails.argsIndex) {
            return;
        }

        let srcLastToPackIndex = srcDetails.params.findIndex((p, i) => {
            assert(destDetails.argsIndex !== undefined);
            return i >= destDetails.argsIndex && p.kind === ParamKind.Keyword;
        });
        if (srcLastToPackIndex < 0) {
            srcLastToPackIndex = srcDetails.params.length;
        }

        // If both the source and dest have an *args parameter but the dest's is
        // in a later position, then we can't assign the source's *args to the dest.
        // Don't make any adjustment in this case.
        if (srcDetails.argsIndex !== undefined && destDetails.argsIndex > srcDetails.argsIndex) {
            return;
        }

        const destFirstNonPositional = destDetails.firstKeywordOnlyIndex ?? destDetails.params.length;
        const suffixLength = destFirstNonPositional - destDetails.argsIndex - 1;
        const srcPositionalsToPack = srcDetails.params.slice(destDetails.argsIndex, srcLastToPackIndex - suffixLength);
        const srcTupleTypes: TupleTypeArg[] = [];
        srcPositionalsToPack.forEach((entry) => {
            if (entry.param.category === ParamCategory.ArgsList) {
                if (isUnpackedTypeVarTuple(entry.type)) {
                    srcTupleTypes.push({ type: entry.type, isUnbounded: false });
                } else if (isUnpackedClass(entry.type) && entry.type.priv.tupleTypeArgs) {
                    appendArray(srcTupleTypes, entry.type.priv.tupleTypeArgs);
                } else {
                    srcTupleTypes.push({ type: entry.type, isUnbounded: true });
                }
            } else {
                srcTupleTypes.push({ type: entry.type, isUnbounded: false, isOptional: !!entry.defaultType });
            }
        });

        if (srcTupleTypes.length !== 1 || !isTypeVarTuple(srcTupleTypes[0].type)) {
            const srcPositionalsType = makeTupleObject(evaluatorInterface, srcTupleTypes, /* isUnpacked */ true);

            // Snip out the portion of the source positionals that map to the variadic
            // dest parameter and replace it with a single parameter that is typed as a
            // tuple containing the individual types of the replaced parameters.
            srcDetails.params = [
                ...srcDetails.params.slice(0, destDetails.argsIndex),
                {
                    param: FunctionParam.create(
                        ParamCategory.ArgsList,
                        srcPositionalsType,
                        FunctionParamFlags.NameSynthesized | FunctionParamFlags.TypeDeclared,
                        '_arg_combined'
                    ),
                    type: srcPositionalsType,
                    declaredType: srcPositionalsType,
                    index: -1,
                    kind: ParamKind.Positional,
                },
                ...srcDetails.params.slice(
                    destDetails.argsIndex + srcPositionalsToPack.length,
                    srcDetails.params.length
                ),
            ];

            const argsIndex = srcDetails.params.findIndex((param) => param.param.category === ParamCategory.ArgsList);
            srcDetails.argsIndex = argsIndex >= 0 ? argsIndex : undefined;

            const kwargsIndex = srcDetails.params.findIndex(
                (param) => param.param.category === ParamCategory.KwargsDict
            );
            srcDetails.kwargsIndex = kwargsIndex >= 0 ? kwargsIndex : undefined;

            const firstKeywordOnlyIndex = srcDetails.params.findIndex((param) => param.kind === ParamKind.Keyword);
            srcDetails.firstKeywordOnlyIndex = firstKeywordOnlyIndex >= 0 ? firstKeywordOnlyIndex : undefined;

            srcDetails.positionOnlyParamCount = Math.max(
                0,
                srcDetails.params.findIndex(
                    (p) =>
                        p.kind !== ParamKind.Positional || p.param.category !== ParamCategory.Simple || !!p.defaultType
                )
            );
        }
    }

    return {
        assignClass,
        assignRecursiveTypeAliasToSelf,
        assignFromUnionType,
        assignToUnionType,
        assignConditionalTypeToTypeVar,
        assignParam,
        assignFunction,
    };
}
