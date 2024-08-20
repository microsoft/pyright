/*
 * refinementSolver.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Constraint solver for refinement types.
 */

import { assert } from '../common/debug';
import { DiagnosticAddendum } from '../common/diagnostic';
import { LocAddendum } from '../localization/localize';
import { ConstraintSolutionSet } from './constraintSolution';
import { ConstraintSet, ConstraintTracker } from './constraintTracker';
import { printRefinementExpr } from './refinementPrinter';
import {
    RefinementExpr,
    RefinementNodeType,
    RefinementNumberNode,
    RefinementTupleEntry,
    RefinementVarId,
    RefinementVarNode,
    TypeRefinement,
} from './refinementTypes';
import {
    applySolvedRefinementVars,
    createWildcardRefinementValue,
    evaluateRefinementCondition,
    evaluateRefinementExpression,
    getFreeRefinementVars,
    isRefinementExprEquivalent,
    isRefinementLiteral,
    isRefinementTuple,
    isRefinementVar,
    isRefinementWildcard,
    RefinementTypeDiag,
} from './refinementTypeUtils';
import { ClassType, isAnyOrUnknown, isClass, isClassInstance } from './types';
import { getBuiltInRefinementClassId } from './typeUtils';

export interface AssignRefinementsOptions {
    checkOverloadOverlap?: boolean;
}

// Attempts to assign a srcType with a refinement type to a destType
// with a refinement type.
export function assignRefinements(
    destType: ClassType,
    srcType: ClassType,
    diag: DiagnosticAddendum | undefined,
    constraints: ConstraintTracker | undefined,
    options?: AssignRefinementsOptions
): boolean {
    let assignmentOk = true;

    // Apply refinements by class.
    const destRefs = destType.priv.refinements ?? [];
    const srcRefs = srcType.priv.refinements ?? [];

    const synthesizedRefinement = synthesizeRefinementTypeFromLiteral(srcType);
    if (synthesizedRefinement) {
        srcRefs.push(synthesizedRefinement);
    }

    for (const destRef of destRefs) {
        let srcClassMatch = false;

        for (const srcRef of srcRefs) {
            if (destRef.classDetails.classId !== srcRef.classDetails.classId) {
                continue;
            }

            srcClassMatch = true;

            if (!assignRefinement(destRef, srcRef, diag, constraints, options)) {
                assignmentOk = false;
            }
        }

        if (srcRefs.length === 0 && options?.checkOverloadOverlap) {
            assignmentOk = false;
        }

        // If no source refinements matched the dest refinement class,
        // the assignment validity is based on whether it's enforced.
        if (!srcClassMatch && destRef.isEnforced) {
            assignmentOk = false;
        }
    }

    return assignmentOk;
}

export function solveRefinementVarRecursive(
    constraintSet: ConstraintSet,
    solutionSet: ConstraintSolutionSet,
    varId: RefinementVarId
): RefinementExpr | undefined {
    // If this refinement variable already has a solution, don't attempt to re-solve it.
    if (solutionSet.hasRefinementVarType(varId)) {
        return solutionSet.getRefinementVarType(varId);
    }

    const value = constraintSet.getRefinementVarType(varId);
    if (!value) {
        return undefined;
    }

    // Protect against infinite recursion by setting the initial value to
    // undefined. We'll replace this later with a real value.
    solutionSet.setRefinementVarType(varId, /* value */ undefined);

    // Determine which free variables are referenced by this expression. We need
    // to ensure that they are solved first.
    const freeVars = getFreeRefinementVars(value);
    for (const freeVar of freeVars) {
        solveRefinementVarRecursive(constraintSet, solutionSet, freeVar.id);
    }

    // Now evaluate the expression.
    const solvedValue = applySolvedRefinementVars(value, solutionSet.getRefinementVarMap());
    const simplifiedValue = evaluateRefinementExpression(solvedValue);

    solutionSet.setRefinementVarType(varId, simplifiedValue);

    return simplifiedValue;
}

export function assignRefinement(
    destRefinement: TypeRefinement,
    srcRefinement: TypeRefinement,
    diag: DiagnosticAddendum | undefined,
    constraints: ConstraintTracker | undefined,
    options?: AssignRefinementsOptions
): boolean {
    assert(destRefinement.classDetails.classId === srcRefinement.classDetails.classId);

    const destValue = destRefinement.value;
    const srcValue = srcRefinement.value;

    // Determine if there are any conditions provided by the caller (for
    // function call evaluation) or local conditions (for assignments).
    let conditions: RefinementExpr[] | undefined;
    if (!conditions && destRefinement.condition) {
        conditions = [destRefinement.condition];
    }

    // If we have conditions to verify but have not been provided a
    // constraint tracker, create a temporary one.
    if (conditions && !constraints) {
        constraints = new ConstraintTracker();
    }

    // Handle tuples specially.
    if (
        destRefinement.classDetails.domain === 'IntTupleRefinement' &&
        destValue.nodeType === RefinementNodeType.Tuple &&
        srcValue.nodeType === RefinementNodeType.Tuple
    ) {
        const srcEntries = [...srcValue.entries];

        // If the dest and source tuple shapes match, we can skip any reshaping efforts.
        if (
            destValue.entries.length !== srcValue.entries.length ||
            destValue.entries.some((entry, i) => entry.isUnpacked !== srcValue.entries[i].isUnpacked)
        ) {
            if (!adjustSourceTupleShape(destValue.entries, srcEntries)) {
                const msg =
                    destRefinement.classDetails.classId === getBuiltInRefinementClassId('Shape')
                        ? LocAddendum.refinementShapeMismatch()
                        : LocAddendum.refinementTupleMismatch();

                diag?.addMessage(
                    msg.format({
                        expected: printRefinementExpr(destValue),
                        received: printRefinementExpr(srcValue),
                    })
                );

                return false;
            }
        }

        // At this point, the dest and src tuples should have the same shape
        // (i.e. same length and with the same entries unpacked or not).
        assert(destValue.entries.length === srcEntries.length);

        for (let i = 0; i < destValue.entries.length; i++) {
            const destEntry = destValue.entries[i];
            const srcEntry = srcEntries[i];

            assert(destEntry.isUnpacked === srcEntry.isUnpacked);

            if (!assignRefinementValue(destEntry.value, srcEntry.value, diag, constraints, options)) {
                return false;
            }
        }
    } else {
        if (!assignRefinementValue(destValue, srcValue, diag, constraints, options)) {
            return false;
        }
    }

    if (conditions && !validateRefinementConditions(conditions, diag, constraints)) {
        return false;
    }

    return true;
}

export function validateRefinementConditions(
    conditions: RefinementExpr[],
    diag: DiagnosticAddendum | undefined,
    constraints: ConstraintTracker | undefined
): boolean {
    let solvedConditions = [...conditions];

    if (constraints) {
        const solutionSet = new ConstraintSolutionSet();
        const constraintSet = constraints.getMainConstraintSet();

        // Solve the refinement variables.
        constraintSet.doForEachRefinementVar((name) => {
            solveRefinementVarRecursive(constraintSet, solutionSet, name);
        });

        solvedConditions = conditions.map((condition) =>
            applySolvedRefinementVars(condition, solutionSet.getRefinementVarMap())
        );
    }

    for (let i = 0; i < solvedConditions.length; i++) {
        const errors: RefinementTypeDiag[] = [];

        if (!evaluateRefinementCondition(solvedConditions[i], { refinements: { errors } })) {
            diag?.addMessage(
                LocAddendum.refinementConditionNotSatisfied().format({
                    condition: printRefinementExpr(solvedConditions[i]),
                })
            );

            errors.forEach((error) => {
                diag?.addAddendum(error.diag);
            });
            return false;
        }
    }

    return true;
}

export function synthesizeRefinementTypeFromLiteral(classType: ClassType): TypeRefinement | undefined {
    if (!isClass(classType)) {
        return undefined;
    }

    if (ClassType.isBuiltIn(classType, 'tuple')) {
        const typeArgs = classType.priv.tupleTypeArgs;
        if (!typeArgs) {
            return undefined;
        }

        let foundInt = false;
        if (
            !typeArgs.every((typeArg) => {
                if (isClassInstance(typeArg.type) && ClassType.isBuiltIn(typeArg.type, 'int')) {
                    foundInt = true;
                    return true;
                }
                return isAnyOrUnknown(typeArg.type);
            }) ||
            !foundInt
        ) {
            return undefined;
        }

        const entries: RefinementTupleEntry[] = typeArgs.map((typeArg) => {
            if (isClassInstance(typeArg.type) && typeArg.type.priv.literalValue !== undefined && !typeArg.isUnbounded) {
                const value = typeArg.type.priv.literalValue;
                assert(typeof value === 'number' || typeof value === 'bigint');
                const entry: RefinementNumberNode = { nodeType: RefinementNodeType.Number, value: value };
                return { value: entry, isUnpacked: false };
            }

            return { value: createWildcardRefinementValue(), isUnpacked: typeArg.isUnbounded };
        });

        return {
            classDetails: {
                domain: 'IntTupleRefinement',
                className: 'IntTupleValue',
                classId: getBuiltInRefinementClassId('IntTupleValue'),
            },
            value: {
                nodeType: RefinementNodeType.Tuple,
                entries,
            },
            isEnforced: false,
        };
    }

    if (classType.priv.literalValue === undefined) {
        return undefined;
    }

    if (ClassType.isBuiltIn(classType, 'int')) {
        assert(typeof classType.priv.literalValue === 'number' || typeof classType.priv.literalValue === 'bigint');

        return {
            classDetails: {
                domain: 'IntRefinement',
                className: 'IntValue',
                classId: getBuiltInRefinementClassId('IntValue'),
            },
            value: {
                nodeType: RefinementNodeType.Number,
                value: classType.priv.literalValue,
            },
            isEnforced: true,
        };
    }

    if (ClassType.isBuiltIn(classType, 'str')) {
        assert(typeof classType.priv.literalValue === 'string');

        return {
            classDetails: {
                domain: 'StrRefinement',
                className: 'StrValue',
                classId: getBuiltInRefinementClassId('StrValue'),
            },
            value: {
                nodeType: RefinementNodeType.String,
                value: classType.priv.literalValue,
            },
            isEnforced: true,
        };
    }

    if (ClassType.isBuiltIn(classType, 'bytes')) {
        assert(typeof classType.priv.literalValue === 'string');

        return {
            classDetails: {
                domain: 'BytesRefinement',
                className: 'BytesValue',
                classId: getBuiltInRefinementClassId('BytesValue'),
            },
            value: {
                nodeType: RefinementNodeType.Bytes,
                value: classType.priv.literalValue,
            },
            isEnforced: true,
        };
    }

    if (ClassType.isBuiltIn(classType, 'bool')) {
        assert(typeof classType.priv.literalValue === 'boolean');

        return {
            classDetails: {
                domain: 'BoolRefinement',
                className: 'BoolValue',
                classId: getBuiltInRefinementClassId('BoolValue'),
            },
            value: {
                nodeType: RefinementNodeType.Boolean,
                value: classType.priv.literalValue,
            },
            isEnforced: true,
        };
    }

    return undefined;
}

// Adjusts the srcEntries to match the shape of the destEntries if possible.
// It assumes the caller has already confirmed that the dest and src shapes
// don't already match. The shape includes both the number of entries and
// whether each of those entries is unpacked.
function adjustSourceTupleShape(destEntries: RefinementTupleEntry[], srcEntries: RefinementTupleEntry[]): boolean {
    const destUnpackCount = destEntries.filter((entry) => entry.isUnpacked).length;
    const srcUnpackCount = srcEntries.filter((entry) => entry.isUnpacked).length;
    const srcUnpackIndex = srcEntries.findIndex((entry) => entry.isUnpacked);

    if (destUnpackCount > 1) {
        // If there's more than one unpacked entry in the dest, there
        // is no unambiguous way to adjust the source, so don't attempt.
        return false;
    }

    if (destUnpackCount === 1) {
        // If the dest has a single unpacked entry, we may be able to adjust
        // the source shape to match it.

        const srcEntriesToPack = srcEntries.length - destEntries.length + 1;
        if (srcEntriesToPack < 0) {
            return false;
        }
        const destUnpackIndex = destEntries.findIndex((entry) => entry.isUnpacked);
        const removedEntries = srcEntries.splice(destUnpackIndex, srcEntriesToPack);

        // If any of the remaining source entries are unpacked, we can't
        // make the shapes match.
        if (srcEntries.some((entry) => entry.isUnpacked)) {
            return false;
        }

        // Add a new unpacked tuple entry.
        srcEntries.splice(destUnpackIndex, 0, {
            value: { nodeType: RefinementNodeType.Tuple, entries: removedEntries },
            isUnpacked: true,
        });

        return true;
    }

    // If the dest has no unpacked entries, the source cannot have any
    // unpacked entries unless it has an unpacked wildcard.
    if (srcUnpackCount > 1) {
        return false;
    }

    if (srcUnpackIndex < 0 || srcEntries[srcUnpackIndex].value.nodeType !== RefinementNodeType.Wildcard) {
        return false;
    }

    // Remove the unpacked wildcard entry to make the shapes match.
    srcEntries.splice(srcUnpackIndex, 1);

    if (srcEntries.length > destEntries.length) {
        return false;
    }

    // Insert wildcard entries to match the dest shape.
    while (srcEntries.length < destEntries.length) {
        srcEntries.splice(srcUnpackIndex, 0, {
            value: createWildcardRefinementValue(),
            isUnpacked: false,
        });
    }

    return true;
}

function assignRefinementValue(
    destExpr: RefinementExpr,
    srcExpr: RefinementExpr,
    diag: DiagnosticAddendum | undefined,
    constraints: ConstraintTracker | undefined,
    options?: AssignRefinementsOptions
): boolean {
    // Handle assignment to or from wildcard.
    if (isRefinementWildcard(destExpr) || isRefinementWildcard(srcExpr)) {
        return true;
    }

    if (isRefinementExprEquivalent(srcExpr, destExpr)) {
        return true;
    }

    // Handle assignments to literals.
    if (isRefinementLiteral(destExpr) && isRefinementLiteral(srcExpr)) {
        if (destExpr.value !== srcExpr.value) {
            diag?.addMessage(
                LocAddendum.refinementLiteralAssignment().format({
                    expected: printRefinementExpr(destExpr),
                    received: printRefinementExpr(srcExpr),
                })
            );
            return false;
        }

        return true;
    }

    if (isRefinementVar(destExpr)) {
        if (assignToRefinementVar(destExpr, srcExpr, diag, constraints)) {
            return true;
        }
    }

    if (isRefinementExprEquivalent(destExpr, srcExpr)) {
        return true;
    }

    if (isRefinementTuple(destExpr) && isRefinementTuple(srcExpr)) {
        if (destExpr.entries.length === srcExpr.entries.length) {
            if (
                destExpr.entries.every((destEntry, i) => {
                    const srcEntry = srcExpr.entries[i];
                    return (
                        destEntry.isUnpacked === srcEntry.isUnpacked &&
                        assignRefinementValue(destEntry.value, srcEntry.value, diag, constraints)
                    );
                })
            ) {
                return true;
            }
        }
    }

    // See if we can simplify the source or the dest expression and try again.
    const simplifiedDest = evaluateRefinementExpression(destExpr);
    const simplifiedSrc = evaluateRefinementExpression(srcExpr);
    if (
        !TypeRefinement.isRefinementExprSame(simplifiedDest, destExpr) ||
        !TypeRefinement.isRefinementExprSame(simplifiedSrc, srcExpr)
    ) {
        return assignRefinementValue(simplifiedDest, simplifiedSrc, diag, constraints);
    }

    return false;
}

function assignToRefinementVar(
    destExpr: RefinementVarNode,
    srcExpr: RefinementExpr,
    diag: DiagnosticAddendum | undefined,
    constraints: ConstraintTracker | undefined
): boolean {
    // If the dest is a bound variable, it cannot receive any value other
    // than a wildcard and itself.
    if (destExpr.var.isBound) {
        if (isRefinementWildcard(srcExpr)) {
            return true;
        }

        if (isRefinementExprEquivalent(srcExpr, destExpr)) {
            return true;
        }

        diag?.addMessage(
            LocAddendum.refinementValMismatch().format({
                expected: printRefinementExpr({ nodeType: RefinementNodeType.Var, var: destExpr.var }),
                received: printRefinementExpr(srcExpr),
            })
        );
        return false;
    }

    // If there is no constraint tracker, we have nothing more to do.
    if (!constraints) {
        return true;
    }

    const constraintSet = constraints.getMainConstraintSet();
    const curValue = constraintSet.getRefinementVarType(destExpr.var.id);

    // If there is a current value, the new value must be the same or more specific.
    if (curValue) {
        if (!assignRefinementValue(curValue, srcExpr, /* diag */ undefined, /* constraints */ undefined)) {
            diag?.addMessage(
                LocAddendum.refinementValMismatch().format({
                    expected: printRefinementExpr(curValue),
                    received: printRefinementExpr(srcExpr),
                })
            );
            return false;
        }
    }

    // Assign the new value.
    constraintSet.setRefinementVarType(destExpr.var.id, srcExpr);
    return true;
}
