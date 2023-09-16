/*
 * constraintSolver.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Code that solves a TypeVar, TypeVarTuple or ParamSpec based on
 * all of the provided constraints.
 *
 */

import { DiagnosticAddendum } from '../common/diagnostic';
import { Localizer } from '../localization/localize';
import { maxSubtypesForInferredType, TypeEvaluator } from './typeEvaluatorTypes';
import {
    AnyType,
    ClassType,
    combineTypes,
    FunctionParameter,
    FunctionType,
    isAny,
    isAnyOrUnknown,
    isClass,
    isClassInstance,
    isFunction,
    isInstantiableClass,
    isNever,
    isTypeSame,
    isTypeVar,
    isUnion,
    isUnknown,
    isUnpacked,
    isUnpackedClass,
    isVariadicTypeVar,
    NoneType,
    TupleTypeArgument,
    Type,
    TypeBase,
    TypeVarScopeId,
    TypeVarType,
    UnknownType,
    Variance,
} from './types';
import {
    addConditionToType,
    applySolvedTypeVars,
    AssignTypeFlags,
    buildTypeVarContextFromSpecializedClass,
    convertParamSpecValueToType,
    convertToInstance,
    convertToInstantiable,
    convertTypeToParamSpecValue,
    getTypeCondition,
    getTypeVarScopeId,
    isEffectivelyInstantiable,
    isPartlyUnknown,
    mapSubtypes,
    specializeTupleClass,
    specializeWithDefaultTypeArgs,
    transformExpectedType,
    transformPossibleRecursiveTypeAlias,
} from './typeUtils';
import { TypeVarContext } from './typeVarContext';

// As we widen the narrow bound of a type variable, we may end up with
// many subtypes. For performance reasons, we need to cap this at some
// point. This constant determines the cap.
const maxSubtypeCountForTypeVarNarrowBound = 64;

// Assigns the source type to the dest type var in the type var context. If an existing
// type is already associated with that type var name, it attempts to either widen or
// narrow the type (depending on the value of the isContravariant parameter). The goal is
// to produce the narrowest type that meets all of the requirements. If the type var context
// has been "locked", it simply validates that the srcType is compatible (with no attempt
// to widen or narrow).
export function assignTypeToTypeVar(
    evaluator: TypeEvaluator,
    destType: TypeVarType,
    srcType: Type,
    diag: DiagnosticAddendum | undefined,
    typeVarContext: TypeVarContext,
    flags = AssignTypeFlags.Default,
    recursionCount = 0
): boolean {
    let isTypeVarInScope = true;
    const isContravariant = (flags & AssignTypeFlags.ReverseTypeVarMatching) !== 0;

    // If the TypeVar doesn't have a scope ID, then it's being used
    // outside of a valid TypeVar scope. This will be reported as a
    // separate error. Just ignore this case to avoid redundant errors.
    if (!destType.scopeId) {
        return true;
    }

    // Verify that we are solving for the scope associated with this
    // type variable.
    if (!typeVarContext.hasSolveForScope(destType.scopeId)) {
        if (isAnyOrUnknown(srcType) || (isClass(srcType) && ClassType.derivesFromAnyOrUnknown(srcType))) {
            return true;
        }

        // Is this the equivalent of an "Unknown" for a ParamSpec?
        if (
            destType.details.isParamSpec &&
            isFunction(srcType) &&
            FunctionType.isParamSpecValue(srcType) &&
            FunctionType.shouldSkipArgsKwargsCompatibilityCheck(srcType)
        ) {
            return true;
        }

        // Never or NoReturn is always assignable to all type variables unless
        // we're enforcing invariance.
        if (isNever(srcType) && (flags & AssignTypeFlags.EnforceInvariance) === 0) {
            return true;
        }

        // If we're in "ignore type var scope" mode, don't generate
        // an error in this path.
        if ((flags & AssignTypeFlags.IgnoreTypeVarScope) !== 0) {
            return true;
        }

        isTypeVarInScope = false;
        if (!destType.details.isSynthesized) {
            diag?.addMessage(
                Localizer.DiagnosticAddendum.typeAssignmentMismatch().format(
                    evaluator.printSrcDestTypes(srcType, destType)
                )
            );
            return false;
        }
    }

    if ((flags & AssignTypeFlags.SkipSolveTypeVars) !== 0) {
        return evaluator.assignType(
            evaluator.makeTopLevelTypeVarsConcrete(destType),
            evaluator.makeTopLevelTypeVarsConcrete(srcType),
            diag,
            /* destTypeVarContext */ undefined,
            /* srcTypeVarContext */ undefined,
            flags,
            recursionCount
        );
    }

    if (destType.details.isParamSpec) {
        return assignTypeToParamSpec(evaluator, destType, srcType, diag, typeVarContext, recursionCount);
    }

    if (destType.details.isVariadic && !destType.isVariadicInUnion) {
        if (!isUnpacked(srcType)) {
            const tupleClassType = evaluator.getTupleClassType();
            if (tupleClassType && isInstantiableClass(tupleClassType)) {
                // Package up the type into a tuple.
                srcType = convertToInstance(
                    specializeTupleClass(
                        tupleClassType,
                        [{ type: srcType, isUnbounded: false }],
                        /* isTypeArgumentExplicit */ true,
                        /* isUnpackedTuple */ true
                    )
                );
            } else {
                srcType = UnknownType.create();
            }
        }
    }

    // If we're assigning an unpacked TypeVarTuple to a regular TypeVar,
    // we need to treat it as a union of the unpacked TypeVarTuple.
    if (
        isTypeVar(srcType) &&
        srcType.details.isVariadic &&
        srcType.isVariadicUnpacked &&
        !srcType.isVariadicInUnion &&
        !destType.details.isVariadic
    ) {
        srcType = TypeVarType.cloneForUnpacked(srcType, /* isInUnion */ true);
    }

    // If we're attempting to assign `type` to Type[T], transform `type` into `Type[Any]`.
    if (
        TypeBase.isInstantiable(destType) &&
        isClassInstance(srcType) &&
        ClassType.isBuiltIn(srcType, 'type') &&
        !srcType.typeArguments
    ) {
        srcType = AnyType.create();
    }

    const curEntry = typeVarContext.getPrimarySignature().getTypeVar(destType);
    const curNarrowTypeBound = curEntry?.narrowBound;

    let curWideTypeBound = curEntry?.wideBound;
    if (!curWideTypeBound && !destType.details.isSynthesizedSelf) {
        curWideTypeBound = destType.details.boundType;
    }

    // Handle the constrained case. This case needs to be handled specially
    // because type narrowing isn't used in this case. For example, if the
    // source type is "Literal[1]" and the constraint list includes the type
    // "float", the resulting type is float.
    if (destType.details.constraints.length > 0) {
        let constrainedType: Type | undefined;
        const concreteSrcType = evaluator.makeTopLevelTypeVarsConcrete(srcType);

        if (isTypeVar(srcType)) {
            if (
                evaluator.assignType(
                    destType,
                    concreteSrcType,
                    /* diag */ undefined,
                    new TypeVarContext(destType.scopeId),
                    /* srcTypeVarContext */ undefined,
                    AssignTypeFlags.Default,
                    recursionCount
                )
            ) {
                constrainedType = srcType;

                // If the source and dest are both instantiables (type[T]), then
                // we need to convert to an instance (T).
                if (TypeBase.isInstantiable(srcType)) {
                    constrainedType = convertToInstance(srcType, /* includeSubclasses */ false);
                }
            }
        } else {
            let isCompatible = true;

            // Subtypes that are not conditionally dependent on the dest type var
            // must all map to the same constraint. For example, Union[str, bytes]
            // cannot be assigned to AnyStr.
            let unconditionalConstraintIndex: number | undefined;

            // Find the narrowest constrained type that is compatible.
            constrainedType = mapSubtypes(concreteSrcType, (srcSubtype) => {
                let constrainedSubtype: Type | undefined;

                if (isAnyOrUnknown(srcSubtype)) {
                    return srcSubtype;
                }

                let constraintIndexUsed: number | undefined;
                destType.details.constraints.forEach((constraint, i) => {
                    const adjustedConstraint = TypeBase.isInstantiable(destType)
                        ? convertToInstantiable(constraint)
                        : constraint;
                    if (
                        evaluator.assignType(
                            adjustedConstraint,
                            srcSubtype,
                            /* diag */ undefined,
                            /* destTypeVarContext */ undefined,
                            /* srcTypeVarContext */ undefined,
                            AssignTypeFlags.Default,
                            recursionCount
                        )
                    ) {
                        if (
                            !constrainedSubtype ||
                            evaluator.assignType(
                                TypeBase.isInstantiable(destType)
                                    ? convertToInstantiable(constrainedSubtype)
                                    : constrainedSubtype,
                                adjustedConstraint,
                                /* diag */ undefined,
                                /* destTypeVarContext */ undefined,
                                /* srcTypeVarContext */ undefined,
                                AssignTypeFlags.Default,
                                recursionCount
                            )
                        ) {
                            constrainedSubtype = addConditionToType(constraint, getTypeCondition(srcSubtype));
                            constraintIndexUsed = i;
                        }
                    }
                });

                if (!constrainedSubtype) {
                    // We found a source subtype that is not compatible with the dest.
                    // This is OK if we're handling the contravariant case because only
                    // one subtype needs to be assignable in that case.
                    if (!isContravariant) {
                        isCompatible = false;
                    }
                }

                // If this subtype isn't conditional, make sure it maps to the same
                // constraint index as previous unconditional subtypes.
                if (constraintIndexUsed !== undefined && !getTypeCondition(srcSubtype)) {
                    if (
                        unconditionalConstraintIndex !== undefined &&
                        unconditionalConstraintIndex !== constraintIndexUsed
                    ) {
                        isCompatible = false;
                    }

                    unconditionalConstraintIndex = constraintIndexUsed;
                }

                return constrainedSubtype;
            });

            if (isNever(constrainedType) || !isCompatible) {
                constrainedType = undefined;
            }

            // If the type is a union, see if the entire union is assignable to one
            // of the constraints.
            if (!constrainedType && isUnion(concreteSrcType)) {
                constrainedType = destType.details.constraints.find((constraint) => {
                    const adjustedConstraint = TypeBase.isInstantiable(destType)
                        ? convertToInstantiable(constraint)
                        : constraint;
                    return evaluator.assignType(
                        adjustedConstraint,
                        concreteSrcType,
                        /* diag */ undefined,
                        /* destTypeVarContext */ undefined,
                        /* srcTypeVarContext */ undefined,
                        AssignTypeFlags.Default,
                        recursionCount
                    );
                });
            }
        }

        // If there was no constrained type that was assignable
        // or there were multiple types that were assignable and they
        // are not conditional, it's an error.
        if (!constrainedType) {
            diag?.addMessage(
                Localizer.DiagnosticAddendum.typeConstrainedTypeVar().format({
                    type: evaluator.printType(srcType),
                    name: destType.details.name,
                })
            );
            return false;
        }

        if (curNarrowTypeBound && !isAnyOrUnknown(curNarrowTypeBound)) {
            if (
                !evaluator.assignType(
                    curNarrowTypeBound,
                    constrainedType,
                    /* diag */ undefined,
                    /* destTypeVarContext */ undefined,
                    /* srcTypeVarContext */ undefined,
                    AssignTypeFlags.Default,
                    recursionCount
                )
            ) {
                // Handle the case where one of the constrained types is a wider
                // version of another constrained type that was previously assigned
                // to the type variable.
                if (
                    evaluator.assignType(
                        constrainedType,
                        curNarrowTypeBound,
                        /* diag */ undefined,
                        /* destTypeVarContext */ undefined,
                        /* srcTypeVarContext */ undefined,
                        AssignTypeFlags.Default,
                        recursionCount
                    )
                ) {
                    if (!typeVarContext.isLocked() && isTypeVarInScope) {
                        updateTypeVarType(evaluator, typeVarContext, destType, constrainedType, curWideTypeBound);
                    }
                } else {
                    diag?.addMessage(
                        Localizer.DiagnosticAddendum.typeConstrainedTypeVar().format({
                            type: evaluator.printType(constrainedType),
                            name: evaluator.printType(curNarrowTypeBound),
                        })
                    );
                    return false;
                }
            }
        } else {
            // Assign the type to the type var.
            if (!typeVarContext.isLocked() && isTypeVarInScope) {
                updateTypeVarType(evaluator, typeVarContext, destType, constrainedType, curWideTypeBound);
            }
        }

        return true;
    }

    // Handle the unconstrained (but possibly bound) case.
    let newNarrowTypeBound = curNarrowTypeBound;
    let newWideTypeBound = curWideTypeBound;
    const diagAddendum = diag ? new DiagnosticAddendum() : undefined;

    let adjSrcType = srcType;

    // If the source is a class that is missing type arguments, fill
    // in missing type arguments with Unknown.
    if ((flags & AssignTypeFlags.AllowUnspecifiedTypeArguments) === 0) {
        if (isClass(adjSrcType) && adjSrcType.includeSubclasses) {
            adjSrcType = specializeWithDefaultTypeArgs(adjSrcType);
        }
    }

    if (TypeBase.isInstantiable(destType)) {
        if (isEffectivelyInstantiable(adjSrcType)) {
            adjSrcType = convertToInstance(adjSrcType, /* includeSubclasses */ false);
        } else {
            // Handle the case of a TypeVar that has a bound of `type`.
            const concreteAdjSrcType = evaluator.makeTopLevelTypeVarsConcrete(adjSrcType);

            if (isEffectivelyInstantiable(concreteAdjSrcType)) {
                adjSrcType = convertToInstance(concreteAdjSrcType);
            } else {
                diag?.addMessage(
                    Localizer.DiagnosticAddendum.typeAssignmentMismatch().format(
                        evaluator.printSrcDestTypes(srcType, destType)
                    )
                );
                return false;
            }
        }
    } else if (
        isTypeVar(srcType) &&
        TypeBase.isInstantiable(srcType) &&
        isTypeSame(convertToInstance(srcType), destType)
    ) {
        diag?.addMessage(
            Localizer.DiagnosticAddendum.typeAssignmentMismatch().format(
                evaluator.printSrcDestTypes(adjSrcType, destType)
            )
        );
        return false;
    }

    if ((flags & AssignTypeFlags.PopulatingExpectedType) !== 0) {
        // If we're populating the expected type and the srcType is
        // Unknown, ignore it.
        if (isUnknown(adjSrcType)) {
            return true;
        }

        // If we're populating the expected type, constrain either the
        // narrow type bound, wide type bound or both. Don't overwrite
        // an existing entry.
        if (!curEntry) {
            if ((flags & AssignTypeFlags.EnforceInvariance) !== 0) {
                newNarrowTypeBound = adjSrcType;
                newWideTypeBound = adjSrcType;
            } else if (isContravariant) {
                newNarrowTypeBound = adjSrcType;
            } else {
                newWideTypeBound = adjSrcType;
            }
        }
    } else if (isContravariant) {
        // Update the wide type bound.
        if (!curWideTypeBound) {
            newWideTypeBound = adjSrcType;
        } else if (!isTypeSame(curWideTypeBound, adjSrcType, {}, recursionCount)) {
            if (
                evaluator.assignType(
                    curWideTypeBound,
                    evaluator.makeTopLevelTypeVarsConcrete(adjSrcType),
                    diagAddendum,
                    /* destTypeVarContext */ undefined,
                    /* srcTypeVarContext */ undefined,
                    flags & AssignTypeFlags.IgnoreTypeVarScope,
                    recursionCount
                )
            ) {
                // The srcType is narrower than the current wideTypeBound, so replace it.
                // If it's Any, don't replace it because Any is the narrowest type already.
                if (!isAny(curWideTypeBound)) {
                    newWideTypeBound = adjSrcType;
                }
            } else if (
                !evaluator.assignType(
                    adjSrcType,
                    curWideTypeBound,
                    diagAddendum,
                    /* destTypeVarContext */ undefined,
                    /* srcTypeVarContext */ undefined,
                    flags & AssignTypeFlags.IgnoreTypeVarScope,
                    recursionCount
                )
            ) {
                if (diag && diagAddendum) {
                    diag.addMessage(
                        Localizer.DiagnosticAddendum.typeAssignmentMismatch().format(
                            evaluator.printSrcDestTypes(curWideTypeBound, adjSrcType)
                        )
                    );
                    diag.addAddendum(diagAddendum);
                }
                return false;
            }
        }

        // Make sure we haven't narrowed it beyond the current narrow bound.
        if (curNarrowTypeBound) {
            if (
                !evaluator.assignType(
                    newWideTypeBound!,
                    curNarrowTypeBound,
                    /* diag */ undefined,
                    /* destTypeVarContext */ undefined,
                    /* srcTypeVarContext */ undefined,
                    flags & AssignTypeFlags.IgnoreTypeVarScope,
                    recursionCount
                )
            ) {
                if (diag && diagAddendum) {
                    diag.addMessage(
                        Localizer.DiagnosticAddendum.typeAssignmentMismatch().format(
                            evaluator.printSrcDestTypes(curNarrowTypeBound, newWideTypeBound!)
                        )
                    );
                    diag.addAddendum(diagAddendum);
                }
                return false;
            }
        }
    } else {
        if (!curNarrowTypeBound) {
            // There was previously no narrow bound. We've now established one.
            newNarrowTypeBound = adjSrcType;
        } else if (!isTypeSame(curNarrowTypeBound, adjSrcType, {}, recursionCount)) {
            if (
                evaluator.assignType(
                    curNarrowTypeBound,
                    adjSrcType,
                    diagAddendum,
                    /* destTypeVarContext */ undefined,
                    /* srcTypeVarContext */ undefined,
                    flags,
                    recursionCount
                )
            ) {
                // No need to widen. Stick with the existing type unless it's unknown
                // or partly unknown, in which case we'll replace it with a known type
                // as long as it doesn't violate the current narrow bound.
                if (
                    isPartlyUnknown(curNarrowTypeBound) &&
                    !isUnknown(adjSrcType) &&
                    evaluator.assignType(
                        adjSrcType,
                        curNarrowTypeBound,
                        /* diag */ undefined,
                        /* destTypeVarContext */ undefined,
                        /* srcTypeVarContext */ undefined,
                        flags & AssignTypeFlags.IgnoreTypeVarScope,
                        recursionCount
                    )
                ) {
                    newNarrowTypeBound = adjSrcType;
                } else {
                    newNarrowTypeBound = applySolvedTypeVars(curNarrowTypeBound, typeVarContext);
                }
            } else {
                // We need to widen the type.
                if (typeVarContext.isLocked()) {
                    diag?.addMessage(
                        Localizer.DiagnosticAddendum.typeAssignmentMismatch().format(
                            evaluator.printSrcDestTypes(adjSrcType, curNarrowTypeBound)
                        )
                    );
                    return false;
                }

                if (
                    evaluator.assignType(
                        adjSrcType,
                        curNarrowTypeBound,
                        /* diag */ undefined,
                        /* destTypeVarContext */ undefined,
                        /* srcTypeVarContext */ undefined,
                        flags & AssignTypeFlags.IgnoreTypeVarScope,
                        recursionCount
                    )
                ) {
                    newNarrowTypeBound = adjSrcType;
                } else if (isVariadicTypeVar(destType)) {
                    const widenedType = widenTypeForVariadicTypeVar(curNarrowTypeBound, adjSrcType);
                    if (!widenedType) {
                        diag?.addMessage(
                            Localizer.DiagnosticAddendum.typeAssignmentMismatch().format(
                                evaluator.printSrcDestTypes(curNarrowTypeBound, adjSrcType)
                            )
                        );
                        return false;
                    }

                    newNarrowTypeBound = widenedType;
                } else {
                    const objectType = evaluator.getObjectType();
                    const curSolvedNarrowTypeBound = applySolvedTypeVars(curNarrowTypeBound, typeVarContext);

                    // In some extreme edge cases, the narrow type bound can become
                    // a union with so many subtypes that performance grinds to a
                    // halt. We'll detect this case and widen the resulting type
                    // to an 'object' instead of making the union even bigger. This
                    // is still a valid solution to the TypeVar.
                    if (
                        isUnion(curSolvedNarrowTypeBound) &&
                        curSolvedNarrowTypeBound.subtypes.length > maxSubtypesForInferredType &&
                        (destType as TypeVarType).details.boundType !== undefined &&
                        objectType &&
                        isClassInstance(objectType)
                    ) {
                        newNarrowTypeBound = combineTypes(
                            [curSolvedNarrowTypeBound, objectType],
                            maxSubtypeCountForTypeVarNarrowBound
                        );
                    } else {
                        newNarrowTypeBound = combineTypes(
                            [curSolvedNarrowTypeBound, adjSrcType],
                            maxSubtypeCountForTypeVarNarrowBound
                        );
                    }
                }
            }
        }

        // Make sure we don't exceed the wide type bound.
        if (curWideTypeBound && newNarrowTypeBound) {
            if (!isTypeSame(curWideTypeBound, newNarrowTypeBound, {}, recursionCount)) {
                let makeConcrete = true;

                // Handle the case where the wide type is type T and the narrow type
                // is type T | <some other type>. In this case, it violates the
                // wide type bound.
                if (isTypeVar(curWideTypeBound)) {
                    if (isTypeSame(newNarrowTypeBound, curWideTypeBound)) {
                        makeConcrete = false;
                    } else if (
                        isUnion(newNarrowTypeBound) &&
                        newNarrowTypeBound.subtypes.some((subtype) => isTypeSame(subtype, curWideTypeBound!))
                    ) {
                        makeConcrete = false;
                    }
                }

                const adjWideTypeBound = makeConcrete
                    ? evaluator.makeTopLevelTypeVarsConcrete(curWideTypeBound, /* makeParamSpecsConcrete */ true)
                    : curWideTypeBound;

                if (
                    !evaluator.assignType(
                        adjWideTypeBound,
                        newNarrowTypeBound,
                        diag?.createAddendum(),
                        /* destTypeVarContext */ undefined,
                        /* srcTypeVarContext */ undefined,
                        AssignTypeFlags.IgnoreTypeVarScope,
                        recursionCount
                    )
                ) {
                    if (diag && diagAddendum) {
                        diag.addMessage(
                            Localizer.DiagnosticAddendum.typeAssignmentMismatch().format(
                                evaluator.printSrcDestTypes(newNarrowTypeBound, adjWideTypeBound)
                            )
                        );
                    }
                    return false;
                }
            }
        }
    }

    // If there's a bound type, make sure the source is assignable to it.
    if (destType.details.boundType) {
        const updatedType = (newNarrowTypeBound || newWideTypeBound)!;

        // If the dest is a Type[T] but the source is not a valid Type,
        // skip the assignType check and the diagnostic addendum, which will
        // be confusing and inaccurate.
        if (TypeBase.isInstantiable(destType) && !TypeBase.isInstantiable(srcType)) {
            return false;
        }

        // In general, bound types cannot be generic, but the "Self" type is an
        // exception. In this case, we need to use the original TypeVarContext
        // to solve for the generic type variable(s) in the bound type.
        const effectiveTypeVarContext = destType.details.isSynthesizedSelf
            ? typeVarContext
            : new TypeVarContext(destType.scopeId);

        if (
            !evaluator.assignType(
                destType.details.boundType,
                evaluator.makeTopLevelTypeVarsConcrete(updatedType),
                diag?.createAddendum(),
                effectiveTypeVarContext,
                /* srcTypeVarContext */ undefined,
                flags & AssignTypeFlags.IgnoreTypeVarScope,
                recursionCount
            )
        ) {
            // Avoid adding a message that will confuse users if the TypeVar was
            // synthesized for internal purposes.
            if (!destType.details.isSynthesized) {
                diag?.addMessage(
                    Localizer.DiagnosticAddendum.typeBound().format({
                        sourceType: evaluator.printType(updatedType),
                        destType: evaluator.printType(destType.details.boundType),
                        name: TypeVarType.getReadableName(destType),
                    })
                );
            }
            return false;
        }
    }

    if (!typeVarContext.isLocked() && isTypeVarInScope) {
        updateTypeVarType(
            evaluator,
            typeVarContext,
            destType,
            newNarrowTypeBound,
            newWideTypeBound,
            (flags & (AssignTypeFlags.PopulatingExpectedType | AssignTypeFlags.RetainLiteralsForTypeVar)) !== 0
        );
    }

    return true;
}

// Updates the narrow and wide type bounds for a type variable. It also calculates the
// narrowTypeBoundNoLiterals, which is a variant of the narrow type bound that has
// literals stripped. By default, the constraint solver always uses the "no literals"
// type in its solutions unless the version with literals is required to satisfy
// the wide type bound.
export function updateTypeVarType(
    evaluator: TypeEvaluator,
    typeVarContext: TypeVarContext,
    destType: TypeVarType,
    narrowTypeBound: Type | undefined,
    wideTypeBound: Type | undefined,
    forceRetainLiterals = false
) {
    let narrowTypeBoundNoLiterals: Type | undefined;

    if (narrowTypeBound && !forceRetainLiterals) {
        const strippedLiteral = isVariadicTypeVar(destType)
            ? stripLiteralValueForUnpackedTuple(evaluator, narrowTypeBound)
            : evaluator.stripLiteralValue(narrowTypeBound);

        // Strip the literals from the narrow type bound and see if it is still
        // narrower than the wide bound.
        if (strippedLiteral !== narrowTypeBound) {
            if (!wideTypeBound || evaluator.assignType(wideTypeBound, strippedLiteral)) {
                narrowTypeBoundNoLiterals = strippedLiteral;
            }
        }
    }

    typeVarContext.setTypeVarType(destType, narrowTypeBound, narrowTypeBoundNoLiterals, wideTypeBound);
}

function assignTypeToParamSpec(
    evaluator: TypeEvaluator,
    destType: TypeVarType,
    srcType: Type,
    diag: DiagnosticAddendum | undefined,
    typeVarContext: TypeVarContext,
    recursionCount = 0
) {
    let isAssignable = true;

    typeVarContext.doForEachSignature((signatureContext) => {
        if (isTypeVar(srcType) && srcType.details.isParamSpec) {
            const existingType = signatureContext.getParamSpecType(destType);
            if (existingType) {
                if (existingType.details.parameters.length === 0 && existingType.details.paramSpec) {
                    // If there's an existing entry that matches, that's fine.
                    if (isTypeSame(existingType.details.paramSpec, srcType, {}, recursionCount)) {
                        return;
                    }
                }
            } else {
                if (!typeVarContext.isLocked() && typeVarContext.hasSolveForScope(destType.scopeId)) {
                    typeVarContext.setTypeVarType(destType, convertTypeToParamSpecValue(srcType));
                }
                return;
            }
        } else if (isFunction(srcType)) {
            const functionSrcType = srcType;
            const parameters = srcType.details.parameters.map((p, index) => {
                const param: FunctionParameter = {
                    category: p.category,
                    name: p.name,
                    isNameSynthesized: p.isNameSynthesized,
                    hasDefault: !!p.hasDefault,
                    defaultValueExpression: p.defaultValueExpression,
                    type: FunctionType.getEffectiveParameterType(functionSrcType, index),
                };
                return param;
            });

            const existingType = signatureContext.getParamSpecType(destType);
            if (existingType) {
                if (
                    isTypeSame(
                        existingType.details.paramSpec ?? NoneType.createInstance(),
                        srcType.details.paramSpec ?? NoneType.createInstance()
                    )
                ) {
                    // Convert the remaining portion of the signature to a function
                    // for comparison purposes.
                    const existingFunction = convertParamSpecValueToType(existingType, /* omitParamSpec */ true);
                    const assignedFunction = FunctionType.createInstance('', '', '', srcType.details.flags);
                    parameters.forEach((param) => {
                        FunctionType.addParameter(assignedFunction, param);
                    });
                    assignedFunction.details.typeVarScopeId = srcType.details.typeVarScopeId;

                    if (
                        evaluator.assignType(
                            existingFunction,
                            assignedFunction,
                            /* diag */ undefined,
                            /* destTypeVarContext */ undefined,
                            /* srcTypeVarContext */ undefined,
                            AssignTypeFlags.SkipFunctionReturnTypeCheck,
                            recursionCount
                        )
                    ) {
                        return;
                    }
                }
            } else {
                if (!typeVarContext.isLocked() && typeVarContext.hasSolveForScope(destType.scopeId)) {
                    const newFunction = FunctionType.createInstance('', '', '', srcType.details.flags);
                    parameters.forEach((param) => {
                        FunctionType.addParameter(newFunction, param);
                    });
                    newFunction.details.typeVarScopeId = srcType.details.typeVarScopeId;
                    newFunction.details.constructorTypeVarScopeId = srcType.details.constructorTypeVarScopeId;
                    newFunction.details.paramSpecTypeVarScopeId = srcType.details.paramSpecTypeVarScopeId;
                    newFunction.details.docString = srcType.details.docString;
                    newFunction.details.deprecatedMessage = srcType.details.deprecatedMessage;
                    newFunction.details.paramSpec = srcType.details.paramSpec;
                    typeVarContext.setTypeVarType(destType, newFunction);
                }
                return;
            }
        } else if (isAnyOrUnknown(srcType)) {
            return;
        }

        diag?.addMessage(
            Localizer.DiagnosticAddendum.typeParamSpec().format({
                type: evaluator.printType(srcType),
                name: destType.details.name,
            })
        );

        isAssignable = false;
    });

    return isAssignable;
}

// In cases where the expected type is a specialized base class of the
// source type, we need to determine which type arguments in the derived
// class will make it compatible with the specialized base class. This method
// performs this reverse mapping of type arguments and populates the type var
// map for the target type. If the type is not assignable to the expected type,
// it returns false.
export function populateTypeVarContextBasedOnExpectedType(
    evaluator: TypeEvaluator,
    type: ClassType,
    expectedType: Type,
    typeVarContext: TypeVarContext,
    liveTypeVarScopes: TypeVarScopeId[] | undefined,
    usageOffset: number | undefined = undefined
): boolean {
    if (isAny(expectedType)) {
        type.details.typeParameters.forEach((typeParam) => {
            updateTypeVarType(evaluator, typeVarContext, typeParam, expectedType, expectedType);
        });
        return true;
    }

    if (isTypeVar(expectedType) && expectedType.details.isSynthesizedSelf && expectedType.details.boundType) {
        expectedType = expectedType.details.boundType;
    }

    if (!isClass(expectedType)) {
        return false;
    }

    // If the expected type is generic (but not specialized), we can't proceed.
    const expectedTypeArgs = expectedType.typeArguments;
    if (!expectedTypeArgs) {
        return evaluator.assignType(
            type,
            expectedType,
            /* diag */ undefined,
            typeVarContext,
            /* srcTypeVarContext */ undefined,
            AssignTypeFlags.PopulatingExpectedType
        );
    }

    evaluator.inferTypeParameterVarianceForClass(type);

    // If the expected type is the same as the target type (commonly the case),
    // we can use a faster method.
    if (ClassType.isSameGenericClass(expectedType, type)) {
        const sameClassTypeVarContext = buildTypeVarContextFromSpecializedClass(expectedType);
        sameClassTypeVarContext
            .getPrimarySignature()
            .getTypeVars()
            .forEach((entry) => {
                let typeArgValue = sameClassTypeVarContext.getPrimarySignature().getTypeVarType(entry.typeVar);

                if (typeArgValue && liveTypeVarScopes) {
                    typeArgValue = transformExpectedType(typeArgValue, liveTypeVarScopes, usageOffset);
                }

                if (typeArgValue) {
                    const variance = TypeVarType.getVariance(entry.typeVar);

                    updateTypeVarType(
                        evaluator,
                        typeVarContext,
                        entry.typeVar,
                        variance === Variance.Covariant ? undefined : typeArgValue,
                        variance === Variance.Contravariant ? undefined : typeArgValue
                    );

                    if (entry.tupleTypes) {
                        typeVarContext.setTupleTypeVar(
                            entry.typeVar,
                            entry.tupleTypes.map((tupleEntry) => {
                                let tupleType = tupleEntry.type;

                                if (liveTypeVarScopes) {
                                    tupleType = transformExpectedType(tupleEntry.type, liveTypeVarScopes, usageOffset);
                                }

                                return { type: tupleType, isUnbounded: tupleEntry.isUnbounded };
                            })
                        );
                    }
                }
            });
        return true;
    }

    // Create a generic version of the expected type.
    const expectedTypeScopeId = getTypeVarScopeId(expectedType);
    const synthExpectedTypeArgs = ClassType.getTypeParameters(expectedType).map((typeParam, index) => {
        const typeVar = TypeVarType.createInstance(`__dest${index}`);
        typeVar.details.isSynthesized = true;

        // Use invariance here so we set the narrow and wide values on the TypeVar.
        typeVar.details.declaredVariance = Variance.Invariant;
        typeVar.scopeId = expectedTypeScopeId;
        return typeVar;
    });
    const genericExpectedType = ClassType.cloneForSpecialization(
        expectedType,
        synthExpectedTypeArgs,
        /* isTypeArgumentExplicit */ true
    );

    // For each type param in the target type, create a placeholder type variable.
    const typeArgs = ClassType.getTypeParameters(type).map((_, index) => {
        const typeVar = TypeVarType.createInstance(`__source${index}`);
        typeVar.details.isSynthesized = true;
        typeVar.details.synthesizedIndex = index;
        typeVar.details.isExemptFromBoundCheck = true;
        return TypeVarType.cloneAsInScopePlaceholder(typeVar);
    });

    const specializedType = ClassType.cloneForSpecialization(type, typeArgs, /* isTypeArgumentExplicit */ true);
    const syntheticTypeVarContext = new TypeVarContext(expectedTypeScopeId);
    if (
        evaluator.assignType(
            genericExpectedType,
            specializedType,
            /* diag */ undefined,
            syntheticTypeVarContext,
            /* srcTypeVarContext */ undefined,
            AssignTypeFlags.PopulatingExpectedType
        )
    ) {
        let isResultValid = true;

        synthExpectedTypeArgs.forEach((typeVar, index) => {
            let synthTypeVar = syntheticTypeVarContext.getPrimarySignature().getTypeVarType(typeVar);
            const otherSubtypes: Type[] = [];

            // If the resulting type is a union, try to find a matching type var and move
            // the remaining subtypes to the "otherSubtypes" array.
            if (synthTypeVar && isUnion(synthTypeVar)) {
                let foundSynthTypeVar: TypeVarType | undefined;

                synthTypeVar.subtypes.forEach((subtype) => {
                    if (
                        isTypeVar(subtype) &&
                        subtype.details.isSynthesized &&
                        subtype.details.synthesizedIndex !== undefined &&
                        !foundSynthTypeVar
                    ) {
                        foundSynthTypeVar = subtype;
                    } else {
                        otherSubtypes.push(subtype);
                    }
                });

                if (foundSynthTypeVar) {
                    synthTypeVar = foundSynthTypeVar;
                }
            }

            // Is this one of the synthesized type vars we allocated above? If so,
            // the type arg that corresponds to this type var maps back to the target type.
            if (
                synthTypeVar &&
                isTypeVar(synthTypeVar) &&
                synthTypeVar.details.isSynthesized &&
                synthTypeVar.details.synthesizedIndex !== undefined
            ) {
                const targetTypeVar =
                    ClassType.getTypeParameters(specializedType)[synthTypeVar.details.synthesizedIndex];
                if (index < expectedTypeArgs.length) {
                    let typeArgValue: Type | undefined = transformPossibleRecursiveTypeAlias(expectedTypeArgs[index]);

                    if (otherSubtypes.length > 0) {
                        typeArgValue = combineTypes([typeArgValue, ...otherSubtypes]);
                    }

                    if (liveTypeVarScopes) {
                        typeArgValue = transformExpectedType(typeArgValue, liveTypeVarScopes, usageOffset);
                    }

                    if (typeArgValue) {
                        const variance = TypeVarType.getVariance(typeVar);

                        // If this type variable already has a type, don't overwrite it. This can
                        // happen if a single type variable in the derived class is used multiple times
                        // in the specialized base class type (e.g. Mapping[T, T]).
                        if (typeVarContext.getPrimarySignature().getTypeVarType(targetTypeVar)) {
                            isResultValid = false;
                            typeArgValue = UnknownType.create();
                        }

                        updateTypeVarType(
                            evaluator,
                            typeVarContext,
                            targetTypeVar,
                            variance === Variance.Covariant ? undefined : typeArgValue,
                            variance === Variance.Contravariant ? undefined : typeArgValue
                        );
                    } else {
                        isResultValid = false;
                    }
                }
            }
        });

        return isResultValid;
    }

    return false;
}

// For normal TypeVars, the constraint solver can widen a type by combining
// two otherwise incompatible types into a union. For TypeVarTuples, we need
// to do the equivalent operation for unpacked tuples.
function widenTypeForVariadicTypeVar(type1: Type, type2: Type): Type | undefined {
    // If the two types are not unpacked tuples, we can't combine them.
    if (!isUnpackedClass(type1) || !isUnpackedClass(type2)) {
        return undefined;
    }

    // If the two unpacked tuples are not the same length, we can't combine them.
    if (
        !type1.tupleTypeArguments ||
        !type2.tupleTypeArguments ||
        type1.tupleTypeArguments.length !== type2.tupleTypeArguments.length
    ) {
        return undefined;
    }

    let canCombine = true;

    const tupleTypeArgs: TupleTypeArgument[] = type1.tupleTypeArguments.map((arg1, index) => {
        const arg2 = type2.tupleTypeArguments![index];

        // If an entry is unbound in length and the corresponding entry in the
        // other tuple is not (or vice versa), we can't combine them.
        if (arg1.isUnbounded !== arg2.isUnbounded) {
            canCombine = false;
        }

        return {
            isUnbounded: arg1.isUnbounded,
            type: combineTypes([arg1.type, arg2.type]),
        };
    });

    if (!canCombine) {
        return undefined;
    }

    return specializeTupleClass(type1, tupleTypeArgs, /* isTypeArgumentExplicit */ true, /* isUnpackedTuple */ true);
}

// If the provided type is an unpacked tuple, this function strips the
// literals from types of the corresponding elements.
function stripLiteralValueForUnpackedTuple(evaluator: TypeEvaluator, type: Type): Type {
    if (!isUnpackedClass(type) || !type.tupleTypeArguments) {
        return type;
    }

    let strippedLiteral = false;
    const tupleTypeArgs: TupleTypeArgument[] = type.tupleTypeArguments.map((arg) => {
        const strippedType = evaluator.stripLiteralValue(arg.type);

        if (strippedType !== arg.type) {
            strippedLiteral = true;
        }

        return {
            isUnbounded: arg.isUnbounded,
            type: strippedType,
        };
    });

    if (!strippedLiteral) {
        return type;
    }

    return specializeTupleClass(type, tupleTypeArgs, /* isTypeArgumentExplicit */ true, /* isUnpackedTuple */ true);
}
