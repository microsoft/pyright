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
import { maxSubtypesForInferredType, TypeEvaluator } from './typeEvaluatorTypes';
import {
    ClassType,
    combineTypes,
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
    isTypeSame,
    isTypeVar,
    isUnion,
    isUnknown,
    isUnpacked,
    isUnpackedClass,
    isVariadicTypeVar,
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
    isLiteralTypeOrUnion,
    isPartlyUnknown,
    mapSubtypes,
    sortTypes,
    specializeTupleClass,
    specializeWithDefaultTypeArgs,
    transformExpectedType,
    transformPossibleRecursiveTypeAlias,
} from './typeUtils';
import { TypeVarContext, TypeVarSignatureContext } from './typeVarContext';

// As we widen the narrow bound of a type variable, we may end up with
// many subtypes. For performance reasons, we need to cap this at some
// point. This constant determines the cap.
const maxSubtypeCountForTypeVarNarrowBound = 64;

// This debugging switch enables logging of the TypeVarContext before and
// after it is updated by the constraint solver.
const logTypeVarContextUpdates = false;

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
    if (logTypeVarContextUpdates) {
        const indent = ' '.repeat(recursionCount * 2);
        console.log(`${indent}`);
        console.log(`${indent}assignTypeToTypeVar called with`);
        console.log(`${indent}destType: ${evaluator.printType(destType)}`);
        console.log(`${indent}srcType: ${evaluator.printType(srcType)}`);
        console.log(`${indent}flags: ${flags}`);
        console.log(`${indent}scopes: ${(typeVarContext.getSolveForScopes() || []).join(', ')}`);
        console.log(`${indent}pre-call context #${typeVarContext.getId()}: `);
        logTypeVarContext(evaluator, typeVarContext, indent);
    }

    let isTypeVarInScope = true;
    const isInvariant = (flags & AssignTypeFlags.EnforceInvariance) !== 0;
    const isContravariant = (flags & AssignTypeFlags.ReverseTypeVarMatching) !== 0;

    // If the TypeVar doesn't have a scope ID, then it's being used
    // outside of a valid TypeVar scope. This will be reported as a
    // separate error. Just ignore this case to avoid redundant errors.
    if (!destType.scopeId) {
        return true;
    }

    // Handle type[T] as a dest and a special form as a source.
    if (
        TypeBase.isInstantiable(destType) &&
        isInstantiableClass(srcType) &&
        evaluator.isSpecialFormClass(srcType, flags)
    ) {
        return false;
    }

    // Verify that we are solving for the scope associated with this
    // type variable.
    if (!typeVarContext.hasSolveForScope(destType.scopeId)) {
        // Handle Any as a source.
        if (isAnyOrUnknown(srcType) || (isClass(srcType) && ClassType.derivesFromAnyOrUnknown(srcType))) {
            return true;
        }

        // Handle a type[Any] as a source.
        if (isClassInstance(srcType) && ClassType.isBuiltIn(srcType, 'type')) {
            if (
                !srcType.typeArguments ||
                srcType.typeArguments.length < 1 ||
                isAnyOrUnknown(srcType.typeArguments[0])
            ) {
                if (TypeBase.isInstantiable(destType)) {
                    return true;
                }
            }
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
        if (isNever(srcType) && !isInvariant) {
            return true;
        }

        // If we're in "ignore type var scope" mode, don't generate
        // an error in this path.
        if ((flags & AssignTypeFlags.IgnoreTypeVarScope) !== 0) {
            return true;
        }

        isTypeVarInScope = false;

        // Emit an error unless this is a synthesized type variable used
        // for pseudo-generic classes.
        if (!destType.details.isSynthesized || destType.details.isSynthesizedSelf) {
            diag?.addMessage(
                LocAddendum.typeAssignmentMismatch().format(evaluator.printSrcDestTypes(srcType, destType))
            );
            return false;
        }
    }

    // An in-scope placeholder TypeVar can always be assigned to itself,
    // but we won't record this in the typeVarContext.
    if (isTypeSame(destType, srcType) && destType.isInScopePlaceholder) {
        return true;
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

    // Handle the constrained case. This case needs to be handled specially
    // because type narrowing isn't used in this case. For example, if the
    // source type is "Literal[1]" and the constraint list includes the type
    // "float", the resulting type is float.
    if (destType.details.constraints.length > 0) {
        return assignTypeToConstrainedTypeVar(
            evaluator,
            destType,
            srcType,
            diag,
            typeVarContext,
            flags,
            isTypeVarInScope,
            recursionCount
        );
    }

    // Handle the unconstrained (but possibly bound) case.
    const curEntry = typeVarContext.getPrimarySignature().getTypeVar(destType);

    let curWideTypeBound = curEntry?.wideBound;
    if (!curWideTypeBound && !destType.details.isSynthesizedSelf) {
        curWideTypeBound = destType.details.boundType;
    }
    let curNarrowTypeBound = curEntry?.narrowBound;
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
        // narrow type bound, wide type bound or both. Don't overwrite
        // an existing entry.
        if (!curEntry) {
            if (isInvariant) {
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
        if (!curWideTypeBound || isTypeSame(destType, curWideTypeBound)) {
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
                if (!isAnyOrUnknown(curWideTypeBound)) {
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
                        LocAddendum.typeAssignmentMismatch().format(
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
                        LocAddendum.typeAssignmentMismatch().format(
                            evaluator.printSrcDestTypes(curNarrowTypeBound, newWideTypeBound!)
                        )
                    );
                    diag.addAddendum(diagAddendum);
                }
                return false;
            }
        }
    } else {
        if (!curNarrowTypeBound || isTypeSame(destType, curNarrowTypeBound)) {
            // There was previously no narrow bound. We've now established one.
            newNarrowTypeBound = adjSrcType;
        } else if (isTypeSame(curNarrowTypeBound, adjSrcType, {}, recursionCount)) {
            // If this is an invariant context and there is currently no wide type bound
            // established, use the "no literals" version of the narrow type bounds rather
            // than a version that has literals.
            if (!newWideTypeBound && isInvariant && curEntry?.narrowBoundNoLiterals) {
                newNarrowTypeBound = curEntry.narrowBoundNoLiterals;
            }
        } else {
            if (isAnyOrUnknown(adjSrcType) && curEntry?.tupleTypes) {
                // Handle the tuple case specially. If Any or Unknown is assigned
                // during the construction of a tuple, the resulting tuple type must
                // be tuple[Any, ...], which is compatible with any tuple.
                newNarrowTypeBound = adjSrcType;
            } else if (
                evaluator.assignType(
                    curNarrowTypeBound,
                    adjSrcType,
                    diagAddendum,
                    typeVarContext,
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
                        typeVarContext,
                        /* srcTypeVarContext */ undefined,
                        flags & AssignTypeFlags.IgnoreTypeVarScope,
                        recursionCount
                    )
                ) {
                    newNarrowTypeBound = adjSrcType;
                } else {
                    newNarrowTypeBound = applySolvedTypeVars(curNarrowTypeBound, typeVarContext);
                }
            } else if (
                isTypeVar(curNarrowTypeBound) &&
                !isTypeVar(adjSrcType) &&
                evaluator.assignType(
                    evaluator.makeTopLevelTypeVarsConcrete(curNarrowTypeBound),
                    adjSrcType,
                    diagAddendum,
                    typeVarContext,
                    /* srcTypeVarContext */ undefined,
                    flags,
                    recursionCount
                )
            ) {
                // If the existing narrow type bound was a TypeVar that is not
                // part of the current context we can replace it with the new
                // source type.
                newNarrowTypeBound = adjSrcType;
            } else {
                // We need to widen the type.
                if (typeVarContext.isLocked()) {
                    diag?.addMessage(
                        LocAddendum.typeAssignmentMismatch().format(
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
                        typeVarContext,
                        /* srcTypeVarContext */ undefined,
                        flags & AssignTypeFlags.IgnoreTypeVarScope,
                        recursionCount
                    )
                ) {
                    newNarrowTypeBound = adjSrcType;
                } else if (isVariadicTypeVar(destType)) {
                    const widenedType = widenTypeForVariadicTypeVar(evaluator, curNarrowTypeBound, adjSrcType);
                    if (!widenedType) {
                        diag?.addMessage(
                            LocAddendum.typeAssignmentMismatch().format(
                                evaluator.printSrcDestTypes(curNarrowTypeBound, adjSrcType)
                            )
                        );
                        return false;
                    }

                    newNarrowTypeBound = widenedType;
                } else {
                    const objectType = evaluator.getObjectType();

                    // If this is an invariant context and there is currently no wide type bound
                    // established, use the "no literals" version of the narrow type bounds rather
                    // than a version that has literals.
                    if (!newWideTypeBound && isInvariant && curEntry?.narrowBoundNoLiterals) {
                        curNarrowTypeBound = curEntry.narrowBoundNoLiterals;
                    }

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
                let adjWideTypeBound = evaluator.makeTopLevelTypeVarsConcrete(
                    curWideTypeBound,
                    /* makeParamSpecsConcrete */ true
                );

                // Convert any remaining (non-top-level) TypeVars in the wide type
                // bound to in-scope placeholders.
                adjWideTypeBound = transformExpectedType(
                    adjWideTypeBound,
                    /* liveTypeVarScopes */ [],
                    /* usageOffset */ undefined
                );

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
                            LocAddendum.typeAssignmentMismatch().format(
                                evaluator.printSrcDestTypes(newNarrowTypeBound, adjWideTypeBound)
                            )
                        );
                    }
                    return false;
                }
            }
        }
    }

    if (!newWideTypeBound && isInvariant) {
        newWideTypeBound = newNarrowTypeBound;
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
                    LocAddendum.typeBound().format({
                        sourceType: evaluator.printType(updatedType),
                        destType: evaluator.printType(destType.details.boundType),
                        name: TypeVarType.getReadableName(destType),
                    })
                );
            }
            return false;
        }
    }

    // Update the tuple types based on the new type bounds. We need to
    // switch to an unbounded tuple type since the length of the resulting
    // tuple is indeterminate.
    let newTupleTypes = curEntry?.tupleTypes;
    if (newTupleTypes) {
        const updatedType = newNarrowTypeBound ?? newWideTypeBound;
        if (updatedType) {
            newTupleTypes = [{ type: updatedType, isUnbounded: true }];
        }
    }

    if (!typeVarContext.isLocked() && isTypeVarInScope) {
        updateTypeVarType(
            evaluator,
            typeVarContext,
            destType,
            newNarrowTypeBound,
            newWideTypeBound,
            newTupleTypes,
            (flags & (AssignTypeFlags.PopulatingExpectedType | AssignTypeFlags.RetainLiteralsForTypeVar)) !== 0
        );
    }

    if (logTypeVarContextUpdates) {
        const indent = ' '.repeat(recursionCount * 2);
        console.log(`${indent}`);
        console.log(`${indent}post-call context #${typeVarContext.getId()}: `);
        logTypeVarContext(evaluator, typeVarContext, indent);
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
    tupleTypes: TupleTypeArgument[] | undefined = undefined,
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

    typeVarContext.setTypeVarType(destType, narrowTypeBound, narrowTypeBoundNoLiterals, wideTypeBound, tupleTypes);
}

function assignTypeToConstrainedTypeVar(
    evaluator: TypeEvaluator,
    destType: TypeVarType,
    srcType: Type,
    diag: DiagnosticAddendum | undefined,
    typeVarContext: TypeVarContext,
    flags: AssignTypeFlags,
    isTypeVarInScope: boolean,
    recursionCount: number
) {
    let constrainedType: Type | undefined;
    const concreteSrcType = evaluator.makeTopLevelTypeVarsConcrete(srcType);
    const curEntry = typeVarContext.getPrimarySignature().getTypeVar(destType);

    const curWideTypeBound = curEntry?.wideBound;
    const curNarrowTypeBound = curEntry?.narrowBound;
    let forceRetainLiterals = false;

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
            LocAddendum.typeConstrainedTypeVar().format({
                type: evaluator.printType(srcType),
                name: destType.details.name,
            })
        );
        return false;
    } else if (isLiteralTypeOrUnion(constrainedType)) {
        forceRetainLiterals = true;
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
                    LocAddendum.typeConstrainedTypeVar().format({
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
            updateTypeVarType(
                evaluator,
                typeVarContext,
                destType,
                constrainedType,
                curWideTypeBound,
                /* tupleTypes */ undefined,
                forceRetainLiterals
            );
        }
    }

    return true;
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
                    signatureContext.setTypeVarType(destType, convertTypeToParamSpecValue(srcType));
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
                    hasDeclaredType: p.hasDeclaredType,
                    type: FunctionType.getEffectiveParameterType(functionSrcType, index),
                };
                return param;
            });

            const newFunction = FunctionType.createInstance(
                '',
                '',
                '',
                srcType.details.flags | FunctionTypeFlags.ParamSpecValue
            );
            parameters.forEach((param) => {
                FunctionType.addParameter(newFunction, param);
            });
            newFunction.details.typeVarScopeId = srcType.details.typeVarScopeId;
            newFunction.details.constructorTypeVarScopeId = srcType.details.constructorTypeVarScopeId;
            FunctionType.addHigherOrderTypeVarScopeIds(newFunction, srcType.details.higherOrderTypeVarScopeIds);
            newFunction.details.docString = srcType.details.docString;
            newFunction.details.deprecatedMessage = srcType.details.deprecatedMessage;
            newFunction.details.paramSpec = srcType.details.paramSpec;
            newFunction.details.methodClass = srcType.details.methodClass;

            let updateContextWithNewFunction = false;

            const existingType = signatureContext.getParamSpecType(destType);
            if (existingType) {
                // Convert the remaining portion of the signature to a function
                // for comparison purposes.
                const existingFunction = convertParamSpecValueToType(existingType);

                const isNewNarrower = evaluator.assignType(
                    existingFunction,
                    newFunction,
                    /* diag */ undefined,
                    /* destTypeVarContext */ undefined,
                    /* srcTypeVarContext */ undefined,
                    AssignTypeFlags.SkipFunctionReturnTypeCheck,
                    recursionCount
                );

                const isNewWider = evaluator.assignType(
                    newFunction,
                    existingFunction,
                    /* diag */ undefined,
                    /* destTypeVarContext */ undefined,
                    /* srcTypeVarContext */ undefined,
                    AssignTypeFlags.SkipFunctionReturnTypeCheck,
                    recursionCount
                );

                // Should we widen the type?
                if (isNewNarrower && isNewWider) {
                    // The new type is both a supertype and a subtype of the existing type.
                    // That means the two types are the same or one (or both) have the type
                    // "..." (which is the ParamSpec equivalent of "Any"). If only one has
                    // the type "...", we'll prefer the other one. This is analogous to
                    // what we do with regular TypeVars, where we prefer non-Any values.
                    if (!FunctionType.shouldSkipArgsKwargsCompatibilityCheck(newFunction)) {
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
                if (!typeVarContext.isLocked() && typeVarContext.hasSolveForScope(destType.scopeId)) {
                    signatureContext.setTypeVarType(destType, newFunction);
                }
                return;
            }
        } else if (isAnyOrUnknown(srcType)) {
            return;
        }

        diag?.addMessage(
            LocAddendum.typeParamSpec().format({
                type: evaluator.printType(srcType),
                name: destType.details.name,
            })
        );

        isAssignable = false;
    });

    if (logTypeVarContextUpdates) {
        const indent = ' '.repeat(recursionCount * 2);
        console.log(`${indent}`);
        console.log(`${indent}post-call typeVarContext: `);
        logTypeVarContext(evaluator, typeVarContext, indent);
    }

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

                                return {
                                    type: tupleType,
                                    isUnbounded: tupleEntry.isUnbounded,
                                    isOptional: tupleEntry.isOptional,
                                };
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
        if (typeParam.details.isParamSpec) {
            typeVar.details.isParamSpec = true;
        }

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
    const typeArgs = ClassType.getTypeParameters(type).map((typeParam, index) => {
        const typeVar = TypeVarType.createInstance(`__source${index}`);
        typeVar.details.isSynthesized = true;
        typeVar.details.synthesizedIndex = index;
        typeVar.details.isExemptFromBoundCheck = true;
        if (typeParam.details.isParamSpec) {
            typeVar.details.isParamSpec = true;
        }
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
            if (synthTypeVar) {
                if (typeVar.details.isParamSpec && isFunction(synthTypeVar)) {
                    synthTypeVar = convertParamSpecValueToType(synthTypeVar);
                }

                if (isUnion(synthTypeVar)) {
                    let foundSynthTypeVar: TypeVarType | undefined;

                    sortTypes(synthTypeVar.subtypes).forEach((subtype) => {
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
function widenTypeForVariadicTypeVar(evaluator: TypeEvaluator, type1: Type, type2: Type): Type | undefined {
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
        !type1.tupleTypeArguments ||
        !type2.tupleTypeArguments ||
        type1.tupleTypeArguments.length !== type2.tupleTypeArguments.length
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
            isOptional: arg.isOptional,
            type: strippedType,
        };
    });

    if (!strippedLiteral) {
        return type;
    }

    return specializeTupleClass(type, tupleTypeArgs, /* isTypeArgumentExplicit */ true, /* isUnpackedTuple */ true);
}

// This function is used for debugging only. It dumps the current contents of
// the TypeVarContext to the console.
function logTypeVarContext(evaluator: TypeEvaluator, typeVarContext: TypeVarContext, indent: string) {
    const signatureContextCount = typeVarContext.getSignatureContexts().length;
    if (signatureContextCount === 0) {
        console.log(`${indent}  no signatures`);
    } else if (signatureContextCount === 1) {
        logTypeVarSignatureContext(evaluator, typeVarContext.getSignatureContexts()[0], `${indent}  `);
    } else {
        typeVarContext.doForEachSignatureContext((context, signatureIndex) => {
            console.log(`${indent}  signature ${signatureIndex}`);
            logTypeVarSignatureContext(evaluator, context, `${indent}    `);
        });
    }
}

function logTypeVarSignatureContext(evaluator: TypeEvaluator, context: TypeVarSignatureContext, indent: string) {
    let loggedConstraint = false;

    context.getTypeVars().forEach((entry) => {
        const typeVarName = `${indent}${entry.typeVar.details.name}`;
        const narrowBound = entry.narrowBoundNoLiterals ?? entry.narrowBound;
        const wideBound = entry.wideBound;

        // Log the narrow and wide bounds.
        if (narrowBound && wideBound && isTypeSame(narrowBound, wideBound)) {
            console.log(`${typeVarName} = ${evaluator.printType(narrowBound)}`);
            loggedConstraint = true;
        } else {
            if (narrowBound) {
                console.log(`${typeVarName} ≤ ${evaluator.printType(narrowBound)}`);
                loggedConstraint = true;
            }
            if (wideBound) {
                console.log(`${typeVarName} ≥ ${evaluator.printType(wideBound)}`);
                loggedConstraint = true;
            }
        }
    });

    if (!loggedConstraint) {
        console.log(`${indent}no constraints`);
    }
}
