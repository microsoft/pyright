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
import { LocAddendum } from '../localization/localize';
import { ConstraintSet, ConstraintTracker } from './constraintTracker';
import { maxSubtypesForInferredType, TypeEvaluator } from './typeEvaluatorTypes';
import {
    ClassType,
    combineTypes,
    FunctionType,
    isAny,
    isAnyOrUnknown,
    isClass,
    isClassInstance,
    isFunction,
    isInstantiableClass,
    isNever,
    isParamSpec,
    isTypeSame,
    isTypeVar,
    isTypeVarTuple,
    isUnion,
    isUnknown,
    isUnpacked,
    isUnpackedClass,
    ParamSpecType,
    TupleTypeArg,
    Type,
    TypeBase,
    TypeVarKind,
    TypeVarScopeId,
    TypeVarType,
    UnknownType,
    Variance,
} from './types';
import {
    addConditionToType,
    applySolvedTypeVars,
    AssignTypeFlags,
    buildConstraintsFromSpecializedClass,
    convertParamSpecValueToType,
    convertToInstance,
    convertToInstantiable,
    convertTypeToParamSpecValue,
    getTypeCondition,
    getTypeVarScopeId,
    isEffectivelyInstantiable,
    isLiteralTypeOrUnion,
    isPartlyUnknown,
    mapSubtypes,
    sortTypes,
    specializeTupleClass,
    specializeWithDefaultTypeArgs,
    transformExpectedType,
    transformPossibleRecursiveTypeAlias,
} from './typeUtils';

// As we widen the lower bound of a type variable, we may end up with
// many subtypes. For performance reasons, we need to cap this at some
// point. This constant determines the cap.
const maxSubtypeCountForTypeVarLowerBound = 64;

// This debugging switch enables logging of the constraints before and
// after it is updated by the constraint solver.
const logConstraintsUpdates = false;

// Assigns the source type to the dest type var in the type var context. If an existing
// type is already associated with that type var name, it attempts to either widen or
// narrow the type (depending on the value of the isContravariant parameter). The goal is
// to produce the narrowest type that meets all of the requirements. If the type var context
// has been "locked", it simply validates that the srcType is compatible (with no attempt
// to widen or narrow).
export function assignTypeVar(
    evaluator: TypeEvaluator,
    destType: TypeVarType,
    srcType: Type,
    diag: DiagnosticAddendum | undefined,
    constraints: ConstraintTracker | undefined,
    flags = AssignTypeFlags.Default,
    recursionCount = 0
): boolean {
    let isAssignable: boolean;

    if (logConstraintsUpdates) {
        const indent = ' '.repeat(recursionCount * 2);
        console.log(`${indent}`);
        console.log(`${indent}assignTypeVar called with`);
        console.log(`${indent}destType: ${evaluator.printType(destType)}`);
        console.log(`${indent}srcType: ${evaluator.printType(srcType)}`);
        console.log(`${indent}flags: ${flags}`);
        if (constraints) {
            logConstraints(evaluator, constraints, indent);
        }
    }

    // If the TypeVar doesn't have a scope ID, then it's being used
    // outside of a valid TypeVar scope. This will be reported as a
    // separate error. Just ignore this case to avoid redundant errors.
    if (!destType.priv.scopeId) {
        return true;
    }

    if (TypeVarType.isBound(destType) && !TypeVarType.isUnification(destType)) {
        return assignBoundTypeVar(evaluator, destType, srcType, diag, flags);
    }

    // Handle type[T] as a dest and a special form as a source.
    if (
        TypeBase.isInstantiable(destType) &&
        isInstantiableClass(srcType) &&
        evaluator.isSpecialFormClass(srcType, flags)
    ) {
        return false;
    }

    // An TypeVar can always be assigned to itself, but we won't record this in the constraints.
    if (isTypeSame(destType, srcType)) {
        return true;
    }

    if (isParamSpec(destType)) {
        // Handle ParamSpecs specially.
        isAssignable = assignParamSpec(evaluator, destType, srcType, diag, constraints, recursionCount);
    } else {
        if (isTypeVarTuple(destType) && !destType.priv.isVariadicInUnion) {
            const tupleClassType = evaluator.getTupleClassType();
            if (!isUnpacked(srcType) && tupleClassType) {
                // Package up the type into a tuple.
                srcType = convertToInstance(
                    specializeTupleClass(
                        tupleClassType,
                        [{ type: srcType, isUnbounded: false }],
                        /* isTypeArgExplicit */ true,
                        /* isUnpackedTuple */ true
                    )
                );
            }
        }

        // If we're assigning an unpacked TypeVarTuple to a regular TypeVar,
        // we need to treat it as a union of the unpacked TypeVarTuple.
        if (
            isTypeVarTuple(srcType) &&
            srcType.priv.isVariadicUnpacked &&
            !srcType.priv.isVariadicInUnion &&
            !isTypeVarTuple(destType)
        ) {
            srcType = TypeVarType.cloneForUnpacked(srcType, /* isInUnion */ true);
        }

        // Handle the constrained case. This case needs to be handled specially
        // because type narrowing isn't used in this case. For example, if the
        // source type is "Literal[1]" and the constraint list includes the type
        // "float", the resulting type is float.
        if (TypeVarType.hasConstraints(destType)) {
            isAssignable = assignConstrainedTypeVar(
                evaluator,
                destType,
                srcType,
                diag,
                constraints,
                flags,
                recursionCount
            );
        } else {
            isAssignable = assignUnconstrainedTypeVar(
                evaluator,
                destType,
                srcType,
                diag,
                constraints,
                flags,
                recursionCount
            );
        }
    }

    if (logConstraintsUpdates) {
        const indent = ' '.repeat(recursionCount * 2);
        console.log(`${indent}`);
        if (constraints) {
            logConstraints(evaluator, constraints, indent);
        }
    }

    return isAssignable;
}

function assignBoundTypeVar(
    evaluator: TypeEvaluator,
    destType: TypeVarType,
    srcType: Type,
    diag: DiagnosticAddendum | undefined,
    flags: AssignTypeFlags
) {
    // Handle Any as a source.
    if (isAnyOrUnknown(srcType) || (isClass(srcType) && ClassType.derivesFromAnyOrUnknown(srcType))) {
        return true;
    }

    // Is this the equivalent of an "Unknown" for a ParamSpec?
    if (
        isParamSpec(destType) &&
        isFunction(srcType) &&
        FunctionType.isParamSpecValue(srcType) &&
        FunctionType.isGradualCallableForm(srcType)
    ) {
        return true;
    }

    // Never is always assignable in a covariant context.
    const isCovariant = (flags & (AssignTypeFlags.EnforceInvariance | AssignTypeFlags.ReverseTypeVarMatching)) === 0;
    if (isNever(srcType) && isCovariant) {
        return true;
    }

    // Handle a type[Any] as a source.
    if (isClassInstance(srcType) && ClassType.isBuiltIn(srcType, 'type')) {
        if (!srcType.priv.typeArgs || srcType.priv.typeArgs.length < 1 || isAnyOrUnknown(srcType.priv.typeArgs[0])) {
            if (TypeBase.isInstantiable(destType)) {
                return true;
            }
        }
    }

    // Emit an error unless this is a synthesized type variable used
    // for pseudo-generic classes.
    if (!destType.shared.isSynthesized || TypeVarType.isSelf(destType)) {
        diag?.addMessage(LocAddendum.typeAssignmentMismatch().format(evaluator.printSrcDestTypes(srcType, destType)));
    }

    return false;
}

function assignUnconstrainedTypeVar(
    evaluator: TypeEvaluator,
    destType: TypeVarType,
    srcType: Type,
    diag: DiagnosticAddendum | undefined,
    constraints: ConstraintTracker | undefined,
    flags: AssignTypeFlags,
    recursionCount: number
) {
    const isInvariant = (flags & AssignTypeFlags.EnforceInvariance) !== 0;
    const isContravariant = (flags & AssignTypeFlags.ReverseTypeVarMatching) !== 0 && !isInvariant;

    // Handle the unconstrained (but possibly bound) case.
    const curEntry = constraints?.getMainConstraintSet().getTypeVar(destType);

    let curUpperBound = curEntry?.upperBound;
    if (!curUpperBound && !TypeVarType.isSelf(destType)) {
        curUpperBound = destType.shared.boundType;
    }
    let curLowerBound = curEntry?.lowerBound;
    let newLowerBound = curLowerBound;
    let newUpperTypeBound = curUpperBound;
    const diagAddendum = diag ? new DiagnosticAddendum() : undefined;

    let adjSrcType = srcType;

    // If the source is a class that is missing type arguments, fill
    // in missing type arguments with Unknown.
    if ((flags & AssignTypeFlags.AllowUnspecifiedTypeArgs) === 0) {
        if (isClass(adjSrcType) && adjSrcType.priv.includeSubclasses) {
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
                    LocAddendum.typeAssignmentMismatch().format(evaluator.printSrcDestTypes(srcType, destType))
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
            LocAddendum.typeAssignmentMismatch().format(evaluator.printSrcDestTypes(adjSrcType, destType))
        );
        return false;
    }

    if ((flags & AssignTypeFlags.PopulatingExpectedType) !== 0) {
        if ((flags & AssignTypeFlags.SkipPopulateUnknownExpectedType) !== 0 && isUnknown(adjSrcType)) {
            return true;
        }

        // If we're populating the expected type, constrain either the
        // lower type bound, upper type bound or both. Don't overwrite
        // an existing entry.
        if (!curEntry) {
            if (isInvariant) {
                newLowerBound = adjSrcType;
                newUpperTypeBound = adjSrcType;
            } else if (isContravariant) {
                newLowerBound = adjSrcType;
            } else {
                newUpperTypeBound = adjSrcType;
            }
        }
    } else if (isContravariant) {
        // Update the upper bound.
        if (!curUpperBound || isTypeSame(destType, curUpperBound)) {
            newUpperTypeBound = adjSrcType;
        } else if (!isTypeSame(curUpperBound, adjSrcType, {}, recursionCount)) {
            if (
                evaluator.assignType(
                    curUpperBound,
                    evaluator.makeTopLevelTypeVarsConcrete(adjSrcType),
                    diagAddendum,
                    /* destConstraints */ undefined,
                    /* srcConstraints */ undefined,
                    AssignTypeFlags.Default,
                    recursionCount
                )
            ) {
                // The srcType is narrower than the current upper bound, so replace it.
                newUpperTypeBound = adjSrcType;
            } else if (
                !evaluator.assignType(
                    adjSrcType,
                    curUpperBound,
                    diagAddendum,
                    /* destConstraints */ undefined,
                    /* srcConstraints */ undefined,
                    AssignTypeFlags.Default,
                    recursionCount
                )
            ) {
                if (diag && diagAddendum) {
                    diag.addMessage(
                        LocAddendum.typeAssignmentMismatch().format(
                            evaluator.printSrcDestTypes(curUpperBound, adjSrcType)
                        )
                    );
                    diag.addAddendum(diagAddendum);
                }
                return false;
            }
        }

        // Make sure we haven't narrowed it beyond the current lower bound.
        if (curLowerBound) {
            if (
                !evaluator.assignType(
                    newUpperTypeBound!,
                    curLowerBound,
                    /* diag */ undefined,
                    /* destConstraints */ undefined,
                    /* srcConstraints */ undefined,
                    AssignTypeFlags.Default,
                    recursionCount
                )
            ) {
                if (diag && diagAddendum) {
                    diag.addMessage(
                        LocAddendum.typeAssignmentMismatch().format(
                            evaluator.printSrcDestTypes(curLowerBound, newUpperTypeBound!)
                        )
                    );
                    diag.addAddendum(diagAddendum);
                }
                return false;
            }
        }
    } else {
        if (!curLowerBound || isTypeSame(destType, curLowerBound)) {
            // There was previously no lower bound. We've now established one.
            newLowerBound = adjSrcType;
        } else if (isTypeSame(curLowerBound, adjSrcType, {}, recursionCount)) {
            // If this is an invariant context and there is currently no upper bound
            // established, use the "no literals" version of the lower bound rather
            // than a version that has literals.
            if (!newUpperTypeBound && isInvariant && curEntry?.lowerBoundNoLiterals) {
                newLowerBound = curEntry.lowerBoundNoLiterals;
            }
        } else {
            if (
                evaluator.assignType(
                    curLowerBound,
                    adjSrcType,
                    diagAddendum,
                    constraints,
                    /* srcConstraints */ undefined,
                    flags,
                    recursionCount
                )
            ) {
                // No need to widen. Stick with the existing type unless it's unknown
                // or partly unknown, in which case we'll replace it with a known type
                // as long as it doesn't violate the current lower bound.
                if (
                    isPartlyUnknown(curLowerBound) &&
                    !isUnknown(adjSrcType) &&
                    evaluator.assignType(
                        adjSrcType,
                        curLowerBound,
                        /* diag */ undefined,
                        constraints,
                        /* srcConstraints */ undefined,
                        AssignTypeFlags.Default,
                        recursionCount
                    )
                ) {
                    newLowerBound = adjSrcType;
                } else {
                    newLowerBound = curLowerBound;

                    if (constraints) {
                        newLowerBound = applySolvedTypeVars(newLowerBound, constraints);
                    }
                }
            } else if (
                isTypeVar(curLowerBound) &&
                !isTypeVar(adjSrcType) &&
                evaluator.assignType(
                    evaluator.makeTopLevelTypeVarsConcrete(curLowerBound),
                    adjSrcType,
                    diagAddendum,
                    constraints,
                    /* srcConstraints */ undefined,
                    flags,
                    recursionCount
                )
            ) {
                // If the existing lower bound was a TypeVar that is not
                // part of the current context we can replace it with the new
                // source type.
                newLowerBound = adjSrcType;
            } else {
                // We need to widen the type.
                if (constraints?.isLocked()) {
                    diag?.addMessage(
                        LocAddendum.typeAssignmentMismatch().format(
                            evaluator.printSrcDestTypes(adjSrcType, curLowerBound)
                        )
                    );
                    return false;
                }

                if (
                    evaluator.assignType(
                        adjSrcType,
                        curLowerBound,
                        /* diag */ undefined,
                        constraints,
                        /* srcConstraints */ undefined,
                        AssignTypeFlags.Default,
                        recursionCount
                    )
                ) {
                    newLowerBound = adjSrcType;
                } else if (isTypeVarTuple(destType)) {
                    const widenedType = widenTypeForTypeVarTuple(evaluator, curLowerBound, adjSrcType);
                    if (!widenedType) {
                        diag?.addMessage(
                            LocAddendum.typeAssignmentMismatch().format(
                                evaluator.printSrcDestTypes(curLowerBound, adjSrcType)
                            )
                        );
                        return false;
                    }

                    newLowerBound = widenedType;
                } else {
                    const objectType = evaluator.getObjectType();

                    // If this is an invariant context and there is currently no upper bound
                    // established, use the "no literals" version of the lower bound rather
                    // than a version that has literals.
                    if (!newUpperTypeBound && isInvariant && curEntry?.lowerBoundNoLiterals) {
                        curLowerBound = curEntry.lowerBoundNoLiterals;
                    }

                    let curSolvedLowerBound = curLowerBound;

                    if (constraints) {
                        curSolvedLowerBound = applySolvedTypeVars(curLowerBound, constraints);
                    }

                    // In some extreme edge cases, the lower bound can become
                    // a union with so many subtypes that performance grinds to a
                    // halt. We'll detect this case and widen the resulting type
                    // to an 'object' instead of making the union even bigger. This
                    // is still a valid solution to the TypeVar.
                    if (
                        isUnion(curSolvedLowerBound) &&
                        curSolvedLowerBound.priv.subtypes.length > maxSubtypesForInferredType &&
                        TypeVarType.hasBound(destType) &&
                        isClassInstance(objectType)
                    ) {
                        newLowerBound = combineTypes([curSolvedLowerBound, objectType], {
                            maxSubtypeCount: maxSubtypeCountForTypeVarLowerBound,
                        });
                    } else {
                        newLowerBound = combineTypes([curSolvedLowerBound, adjSrcType], {
                            maxSubtypeCount: maxSubtypeCountForTypeVarLowerBound,
                        });
                    }
                }
            }
        }

        // If this is an invariant context, make sure the lower bound
        // isn't too wide.
        if (isInvariant && newLowerBound) {
            if (
                !evaluator.assignType(
                    adjSrcType,
                    newLowerBound,
                    diag?.createAddendum(),
                    /* destConstraints */ undefined,
                    /* srcConstraints */ undefined,
                    AssignTypeFlags.Default,
                    recursionCount
                )
            ) {
                if (diag && diagAddendum) {
                    diag.addMessage(
                        LocAddendum.typeAssignmentMismatch().format(
                            evaluator.printSrcDestTypes(newLowerBound, adjSrcType)
                        )
                    );
                }
                return false;
            }
        }

        // Make sure we don't exceed the upper bound.
        if (curUpperBound && newLowerBound) {
            if (!isTypeSame(curUpperBound, newLowerBound, {}, recursionCount)) {
                let adjUpperBound = evaluator.makeTopLevelTypeVarsConcrete(
                    curUpperBound,
                    /* makeParamSpecsConcrete */ true
                );

                // Convert any remaining (non-top-level) TypeVars in the upper
                // bound to unification vars.
                adjUpperBound = transformExpectedType(
                    adjUpperBound,
                    /* liveTypeVarScopes */ [],
                    /* usageOffset */ undefined
                );

                if (
                    !evaluator.assignType(
                        adjUpperBound,
                        newLowerBound,
                        diag?.createAddendum(),
                        /* destConstraints */ undefined,
                        /* srcConstraints */ undefined,
                        AssignTypeFlags.Default,
                        recursionCount
                    )
                ) {
                    if (diag && diagAddendum) {
                        diag.addMessage(
                            LocAddendum.typeAssignmentMismatch().format(
                                evaluator.printSrcDestTypes(newLowerBound, adjUpperBound)
                            )
                        );
                    }
                    return false;
                }
            }
        }
    }

    if (!newUpperTypeBound && isInvariant) {
        newUpperTypeBound = newLowerBound;
    }

    // If there's a bound type, make sure the source is assignable to it.
    if (destType.shared.boundType) {
        const updatedType = (newLowerBound || newUpperTypeBound)!;

        // If the dest is a Type[T] but the source is not a valid Type,
        // skip the assignType check and the diagnostic addendum, which will
        // be confusing and inaccurate.
        if (TypeBase.isInstantiable(destType) && !isEffectivelyInstantiable(srcType)) {
            return false;
        }

        // In general, bound types cannot be generic, but the "Self" type is an
        // exception. In this case, we need to use the original constraints
        // to solve for the generic type variable(s) in the bound type.
        const effectiveConstraints = TypeVarType.isSelf(destType) ? constraints : undefined;

        if (
            !evaluator.assignType(
                destType.shared.boundType,
                evaluator.makeTopLevelTypeVarsConcrete(updatedType),
                diag?.createAddendum(),
                effectiveConstraints,
                /* srcConstraints */ undefined,
                AssignTypeFlags.Default,
                recursionCount
            )
        ) {
            // Avoid adding a message that will confuse users if the TypeVar was
            // synthesized for internal purposes.
            if (!destType.shared.isSynthesized) {
                diag?.addMessage(
                    LocAddendum.typeBound().format({
                        sourceType: evaluator.printType(updatedType),
                        destType: evaluator.printType(destType.shared.boundType),
                        name: TypeVarType.getReadableName(destType),
                    })
                );
            }
            return false;
        }
    }

    if (constraints && !constraints.isLocked()) {
        updateTypeVarType(
            evaluator,
            constraints,
            destType,
            newLowerBound,
            newUpperTypeBound,
            (flags & (AssignTypeFlags.PopulatingExpectedType | AssignTypeFlags.RetainLiteralsForTypeVar)) !== 0
        );
    }

    return true;
}

// Updates the lower and upper bounds for a type variable. It also calculates the
// lowerBoundNoLiterals, which is a variant of the lower bound that has
// literals stripped. By default, the constraint solver always uses the "no literals"
// type in its solutions unless the version with literals is required to satisfy
// the upper bound.
export function updateTypeVarType(
    evaluator: TypeEvaluator,
    constraints: ConstraintTracker,
    destType: TypeVarType,
    lowerBound: Type | undefined,
    upperBound: Type | undefined,
    forceRetainLiterals = false
) {
    let lowerBoundNoLiterals: Type | undefined;

    if (lowerBound && !forceRetainLiterals) {
        const strippedLiteral = isTypeVarTuple(destType)
            ? stripLiteralValueForUnpackedTuple(evaluator, lowerBound)
            : evaluator.stripLiteralValue(lowerBound);

        // Strip the literals from the lower bound and see if it is still
        // narrower than the upper bound.
        if (strippedLiteral !== lowerBound) {
            if (!upperBound || evaluator.assignType(upperBound, strippedLiteral)) {
                lowerBoundNoLiterals = strippedLiteral;
            }
        }
    }

    constraints.setTypeVarType(destType, lowerBound, lowerBoundNoLiterals, upperBound);
}

function assignConstrainedTypeVar(
    evaluator: TypeEvaluator,
    destType: TypeVarType,
    srcType: Type,
    diag: DiagnosticAddendum | undefined,
    constraints: ConstraintTracker | undefined,
    flags: AssignTypeFlags,
    recursionCount: number
) {
    let constrainedType: Type | undefined;
    const concreteSrcType = evaluator.makeTopLevelTypeVarsConcrete(srcType);
    const curEntry = constraints?.getMainConstraintSet().getTypeVar(destType);

    const curUpperBound = curEntry?.upperBound;
    const curLowerBound = curEntry?.lowerBound;
    let forceRetainLiterals = false;

    if (isTypeVar(srcType)) {
        if (
            evaluator.assignType(
                destType,
                concreteSrcType,
                /* diag */ undefined,
                /* destConstraints */ undefined,
                /* srcConstraints */ undefined,
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
            destType.shared.constraints.forEach((constraint, i) => {
                const adjustedConstraint = TypeBase.isInstantiable(destType)
                    ? convertToInstantiable(constraint)
                    : constraint;
                if (
                    evaluator.assignType(
                        adjustedConstraint,
                        srcSubtype,
                        /* diag */ undefined,
                        /* destConstraints */ undefined,
                        /* srcConstraints */ undefined,
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
                            /* destConstraints */ undefined,
                            /* srcConstraints */ undefined,
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
                if ((flags & AssignTypeFlags.ReverseTypeVarMatching) === 0) {
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
            constrainedType = destType.shared.constraints.find((constraint) => {
                const adjustedConstraint = TypeBase.isInstantiable(destType)
                    ? convertToInstantiable(constraint)
                    : constraint;
                return evaluator.assignType(
                    adjustedConstraint,
                    concreteSrcType,
                    /* diag */ undefined,
                    /* destConstraints */ undefined,
                    /* srcConstraints */ undefined,
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
            LocAddendum.typeConstrainedTypeVar().format({
                type: evaluator.printType(srcType),
                name: destType.shared.name,
            })
        );
        return false;
    } else if (isLiteralTypeOrUnion(constrainedType)) {
        forceRetainLiterals = true;
    }

    if (curLowerBound && !isAnyOrUnknown(curLowerBound)) {
        if (
            !evaluator.assignType(
                curLowerBound,
                constrainedType,
                /* diag */ undefined,
                /* destConstraints */ undefined,
                /* srcConstraints */ undefined,
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
                    curLowerBound,
                    /* diag */ undefined,
                    /* destConstraints */ undefined,
                    /* srcConstraints */ undefined,
                    AssignTypeFlags.Default,
                    recursionCount
                )
            ) {
                if (constraints && !constraints.isLocked()) {
                    updateTypeVarType(evaluator, constraints, destType, constrainedType, curUpperBound);
                }
            } else {
                diag?.addMessage(
                    LocAddendum.typeConstrainedTypeVar().format({
                        type: evaluator.printType(constrainedType),
                        name: evaluator.printType(curLowerBound),
                    })
                );
                return false;
            }
        }
    } else {
        // Assign the type to the type var.
        if (constraints && !constraints.isLocked()) {
            updateTypeVarType(evaluator, constraints, destType, constrainedType, curUpperBound, forceRetainLiterals);
        }
    }

    return true;
}

function assignParamSpec(
    evaluator: TypeEvaluator,
    destType: ParamSpecType,
    srcType: Type,
    diag: DiagnosticAddendum | undefined,
    constraints: ConstraintTracker | undefined,
    recursionCount = 0
) {
    // If there is no constraint tracker, there's nothing to do because
    // param specs have no upper bounds or constraints.
    if (!constraints) {
        return true;
    }

    let isAssignable = true;
    const adjSrcType = isFunction(srcType) ? convertParamSpecValueToType(srcType) : srcType;

    constraints.doForEachConstraintSet((constraintSet) => {
        if (isParamSpec(adjSrcType)) {
            const existingType = constraintSet.getTypeVarType(destType);
            if (existingType) {
                const existingTypeParamSpec = FunctionType.getParamSpecFromArgsKwargs(existingType);
                const existingTypeWithoutArgsKwargs = FunctionType.cloneRemoveParamSpecArgsKwargs(existingType);

                if (existingTypeWithoutArgsKwargs.shared.parameters.length === 0 && existingTypeParamSpec) {
                    // If there's an existing entry that matches, that's fine.
                    if (isTypeSame(existingTypeParamSpec, adjSrcType, {}, recursionCount)) {
                        return;
                    }
                }
            } else {
                if (!constraints.isLocked()) {
                    constraintSet.setTypeVarType(destType, convertTypeToParamSpecValue(adjSrcType));
                }
                return;
            }
        } else if (isFunction(adjSrcType)) {
            const newFunction = adjSrcType;
            let updateContextWithNewFunction = false;

            const existingType = constraintSet.getTypeVarType(destType);
            if (existingType) {
                // Convert the remaining portion of the signature to a function
                // for comparison purposes.
                const existingFunction = convertParamSpecValueToType(existingType);

                const isNewNarrower = evaluator.assignType(
                    existingFunction,
                    newFunction,
                    /* diag */ undefined,
                    /* destConstraints */ undefined,
                    /* srcConstraints */ undefined,
                    AssignTypeFlags.SkipReturnTypeCheck,
                    recursionCount
                );

                const isNewWider = evaluator.assignType(
                    newFunction,
                    existingFunction,
                    /* diag */ undefined,
                    /* destConstraints */ undefined,
                    /* srcConstraints */ undefined,
                    AssignTypeFlags.SkipReturnTypeCheck,
                    recursionCount
                );

                // Should we widen the type?
                if (isNewNarrower && isNewWider) {
                    // The new type is both a supertype and a subtype of the existing type.
                    // That means the two types are the same or one (or both) have the type
                    // "..." (which is the ParamSpec equivalent of "Any"). If only one has
                    // the type "...", we'll prefer the other one. This is analogous to
                    // what we do with regular TypeVars, where we prefer non-Any values.
                    if (!FunctionType.isGradualCallableForm(newFunction)) {
                        updateContextWithNewFunction = true;
                    } else {
                        return;
                    }
                } else if (isNewWider) {
                    updateContextWithNewFunction = true;
                } else if (isNewNarrower) {
                    // The existing function is already narrower than the new function, so
                    // no need to narrow it further.
                    return;
                }
            } else {
                updateContextWithNewFunction = true;
            }

            if (updateContextWithNewFunction) {
                if (!constraints.isLocked()) {
                    constraintSet.setTypeVarType(destType, newFunction);
                }
                return;
            }
        } else if (isAnyOrUnknown(adjSrcType)) {
            return;
        }

        diag?.addMessage(
            LocAddendum.typeParamSpec().format({
                type: evaluator.printType(adjSrcType),
                name: destType.shared.name,
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
export function addConstraintsForExpectedType(
    evaluator: TypeEvaluator,
    type: ClassType,
    expectedType: Type,
    constraints: ConstraintTracker,
    liveTypeVarScopes: TypeVarScopeId[] | undefined,
    usageOffset: number | undefined = undefined
): boolean {
    if (isAny(expectedType)) {
        type.shared.typeParams.forEach((typeParam) => {
            updateTypeVarType(evaluator, constraints, typeParam, expectedType, expectedType);
        });
        return true;
    }

    if (isTypeVar(expectedType) && TypeVarType.isSelf(expectedType) && expectedType.shared.boundType) {
        expectedType = expectedType.shared.boundType;
    }

    if (!isClass(expectedType)) {
        return false;
    }

    // If the expected type is generic (but not specialized), we can't proceed.
    const expectedTypeArgs = expectedType.priv.typeArgs;
    if (!expectedTypeArgs) {
        return evaluator.assignType(
            type,
            expectedType,
            /* diag */ undefined,
            constraints,
            /* srcConstraints */ undefined,
            AssignTypeFlags.PopulatingExpectedType
        );
    }

    evaluator.inferVarianceForClass(type);

    // If the expected type is the same as the target type (commonly the case),
    // we can use a faster method.
    if (ClassType.isSameGenericClass(expectedType, type)) {
        const sameClassConstraints = buildConstraintsFromSpecializedClass(expectedType);
        sameClassConstraints
            .getMainConstraintSet()
            .getTypeVars()
            .forEach((entry) => {
                let typeArgValue = sameClassConstraints.getMainConstraintSet().getTypeVarType(entry.typeVar);

                if (typeArgValue && liveTypeVarScopes) {
                    typeArgValue = transformExpectedType(typeArgValue, liveTypeVarScopes, usageOffset);
                }

                if (typeArgValue) {
                    const variance = TypeVarType.getVariance(entry.typeVar);

                    updateTypeVarType(
                        evaluator,
                        constraints,
                        entry.typeVar,
                        variance === Variance.Covariant ? undefined : typeArgValue,
                        variance === Variance.Contravariant ? undefined : typeArgValue
                    );
                }
            });
        return true;
    }

    // Create a generic version of the expected type.
    const expectedTypeScopeId = getTypeVarScopeId(expectedType);
    const synthExpectedTypeArgs = ClassType.getTypeParams(expectedType).map((typeParam, index) => {
        const typeVar = TypeVarType.createInstance(
            `__dest${index}`,
            isParamSpec(typeParam) ? TypeVarKind.ParamSpec : TypeVarKind.TypeVar
        );
        typeVar.shared.isSynthesized = true;

        // Use invariance here so we set the lower and upper bound on the TypeVar.
        typeVar.shared.declaredVariance = Variance.Invariant;
        typeVar.priv.scopeId = expectedTypeScopeId;
        return typeVar;
    });
    const genericExpectedType = ClassType.specialize(expectedType, synthExpectedTypeArgs);

    // For each type param in the target type, create a placeholder type variable.
    const typeArgs = ClassType.getTypeParams(type).map((typeParam, index) => {
        const typeVar = TypeVarType.createInstance(
            `__source${index}`,
            isParamSpec(typeParam) ? TypeVarKind.ParamSpec : TypeVarKind.TypeVar
        );
        typeVar.shared.isSynthesized = true;
        typeVar.shared.synthesizedIndex = index;
        typeVar.shared.isExemptFromBoundCheck = true;
        return TypeVarType.cloneAsUnificationVar(typeVar);
    });

    const specializedType = ClassType.specialize(type, typeArgs);
    const syntheticConstraints = new ConstraintTracker();
    if (
        evaluator.assignType(
            genericExpectedType,
            specializedType,
            /* diag */ undefined,
            syntheticConstraints,
            /* srcConstraints */ undefined,
            AssignTypeFlags.PopulatingExpectedType
        )
    ) {
        let isResultValid = true;

        synthExpectedTypeArgs.forEach((typeVar, index) => {
            let synthTypeVar = syntheticConstraints.getMainConstraintSet().getTypeVarType(typeVar);
            const otherSubtypes: Type[] = [];

            // If the resulting type is a union, try to find a matching type var and move
            // the remaining subtypes to the "otherSubtypes" array.
            if (synthTypeVar) {
                if (isParamSpec(typeVar) && isFunction(synthTypeVar)) {
                    synthTypeVar = convertParamSpecValueToType(synthTypeVar);
                }

                if (isUnion(synthTypeVar)) {
                    let foundSynthTypeVar: TypeVarType | undefined;

                    sortTypes(synthTypeVar.priv.subtypes).forEach((subtype) => {
                        if (
                            isTypeVar(subtype) &&
                            subtype.shared.isSynthesized &&
                            subtype.shared.synthesizedIndex !== undefined &&
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
            }

            // Is this one of the synthesized type vars we allocated above? If so,
            // the type arg that corresponds to this type var maps back to the target type.
            if (
                synthTypeVar &&
                isTypeVar(synthTypeVar) &&
                synthTypeVar.shared.isSynthesized &&
                synthTypeVar.shared.synthesizedIndex !== undefined
            ) {
                const targetTypeVar = ClassType.getTypeParams(specializedType)[synthTypeVar.shared.synthesizedIndex];
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
                        if (constraints.getMainConstraintSet().getTypeVarType(targetTypeVar)) {
                            isResultValid = false;
                            typeArgValue = UnknownType.create();
                        }

                        updateTypeVarType(
                            evaluator,
                            constraints,
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
function widenTypeForTypeVarTuple(evaluator: TypeEvaluator, type1: Type, type2: Type): Type | undefined {
    // The typing spec indicates that the type should always be "exactly
    // the same type" if a TypeVarTuple is used in multiple locations.
    // This is problematic for a number of reasons, but in the interest
    // of sticking to the spec, we'll enforce that here.

    // If the two types are not unpacked tuples, we can't combine them.
    if (!isUnpackedClass(type1) || !isUnpackedClass(type2)) {
        return undefined;
    }

    // If the two unpacked tuples are not the same length, we can't combine them.
    if (
        !type1.priv.tupleTypeArgs ||
        !type2.priv.tupleTypeArgs ||
        type1.priv.tupleTypeArgs.length !== type2.priv.tupleTypeArgs.length
    ) {
        return undefined;
    }

    const strippedType1 = stripLiteralValueForUnpackedTuple(evaluator, type1);
    const strippedType2 = stripLiteralValueForUnpackedTuple(evaluator, type2);

    if (isTypeSame(strippedType1, strippedType2)) {
        return strippedType1;
    }

    return undefined;
}

// If the provided type is an unpacked tuple, this function strips the
// literals from types of the corresponding elements.
function stripLiteralValueForUnpackedTuple(evaluator: TypeEvaluator, type: Type): Type {
    if (!isUnpackedClass(type) || !type.priv.tupleTypeArgs) {
        return type;
    }

    let strippedLiteral = false;
    const tupleTypeArgs: TupleTypeArg[] = type.priv.tupleTypeArgs.map((arg) => {
        const strippedType = evaluator.stripLiteralValue(arg.type);

        if (strippedType !== arg.type) {
            strippedLiteral = true;
        }

        return {
            isUnbounded: arg.isUnbounded,
            isOptional: arg.isOptional,
            type: strippedType,
        };
    });

    if (!strippedLiteral) {
        return type;
    }

    return specializeTupleClass(type, tupleTypeArgs, /* isTypeArgExplicit */ true, /* isUnpackedTuple */ true);
}

// This function is used for debugging only. It dumps the current contents of
// the constraints to the console.
function logConstraints(evaluator: TypeEvaluator, constraints: ConstraintTracker, indent: string) {
    const constraintSetCount = constraints.getConstraintSets().length;
    if (constraintSetCount === 0) {
        console.log(`${indent}  no signatures`);
    } else if (constraintSetCount === 1) {
        logTypeVarConstraintSet(evaluator, constraints.getConstraintSets()[0], `${indent}  `);
    } else {
        constraints.doForEachConstraintSet((set, index) => {
            console.log(`${indent}  signature ${index}`);
            logTypeVarConstraintSet(evaluator, set, `${indent}    `);
        });
    }
}

function logTypeVarConstraintSet(evaluator: TypeEvaluator, context: ConstraintSet, indent: string) {
    let loggedConstraint = false;

    context.getTypeVars().forEach((entry) => {
        const typeVarName = `${indent}${entry.typeVar.shared.name}`;
        const lowerBound = entry.lowerBoundNoLiterals ?? entry.lowerBound;
        const upperBound = entry.upperBound;

        // Log the lower and upper bounds.
        if (lowerBound && upperBound && isTypeSame(lowerBound, upperBound)) {
            console.log(`${typeVarName} = ${evaluator.printType(lowerBound)}`);
            loggedConstraint = true;
        } else {
            if (lowerBound) {
                console.log(`${typeVarName} ≤ ${evaluator.printType(lowerBound)}`);
                loggedConstraint = true;
            }
            if (upperBound) {
                console.log(`${typeVarName} ≥ ${evaluator.printType(upperBound)}`);
                loggedConstraint = true;
            }
        }
    });

    if (!loggedConstraint) {
        console.log(`${indent}no constraints`);
    }
}
