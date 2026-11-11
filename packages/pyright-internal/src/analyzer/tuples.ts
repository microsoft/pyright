/*
 * tuples.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Provides special-case logic for type analysis of tuples.
 */

import { DiagnosticAddendum } from '../common/diagnostic';
import { DiagnosticRule } from '../common/diagnosticRules';
import { LocAddendum, LocMessage } from '../localization/localize';
import { ExpressionNode, ParseNodeType, SliceNode, TupleNode } from '../parser/parseNodes';
import { AnalyzerNodeInfoAccessor } from './analyzerNodeInfo';
import { addConstraintsForExpectedType } from './constraintSolver';
import { ConstraintTracker } from './constraintTracker';
import { getTypeVarScopesForNode } from './parseTreeUtils';
import { AssignTypeFlags, EvalFlags, maxInferredContainerDepth, TypeEvaluator, TypeResult } from './typeEvaluatorTypes';
import {
    AnyType,
    ClassType,
    combineTypes,
    getInferredTupleLiteralBase,
    getTupleLiteralTypeComplexity,
    isAny,
    isAnyOrUnknown,
    isClassInstance,
    isInstantiableClass,
    isTypeSame,
    isTypeVar,
    isTypeVarTuple,
    isUnion,
    isUnpackedTypeVar,
    isUnpackedTypeVarTuple,
    maxSubtypesForInferredType,
    retainInferredTupleLiterals,
    TupleTypeArg,
    Type,
    TypeVarType,
    UnknownType,
} from './types';
import {
    convertToInstance,
    doForEachSubtype,
    expandUnpackedTypeVarsInTupleArgs,
    getContainerDepth,
    InferenceContext,
    isLiteralType,
    isNoneInstance,
    isTupleClass,
    isTupleGradualForm,
    makeInferenceContext,
    specializeTupleClass,
    transformPossibleRecursiveTypeAlias,
} from './typeUtils';

// If a tuple expression with no declared type contains a large number
// of elements, it can cause performance issues. This value limits the
// number of elements that will be included in the tuple type before
// we default to tuple[Unknown, ...].
const maxInferredTupleEntryCount = 256;

export function makeTupleObject(
    evaluator: Pick<TypeEvaluator, 'getTupleClassType'>,
    typeArgs: TupleTypeArg[],
    isUnpacked = false
) {
    const tupleClass = evaluator.getTupleClassType();
    if (tupleClass && isInstantiableClass(tupleClass)) {
        return convertToInstance(specializeTupleClass(tupleClass, typeArgs, /* isTypeArgExplicit */ true, isUnpacked));
    }

    return UnknownType.create();
}

export function getTypeOfTuple(
    evaluator: TypeEvaluator,
    node: TupleNode,
    flags: EvalFlags,
    inferenceContext: InferenceContext | undefined,
    nodeInfo: AnalyzerNodeInfoAccessor
): TypeResult {
    if ((flags & EvalFlags.TypeExpression) !== 0 && node.parent?.nodeType !== ParseNodeType.Argument) {
        // This is allowed inside of an index trailer, specifically
        // to support Tuple[()], which is the documented way to annotate
        // a zero-length tuple.
        const diag = new DiagnosticAddendum();
        diag.addMessage(LocAddendum.useTupleInstead());
        evaluator.addDiagnostic(
            DiagnosticRule.reportInvalidTypeForm,
            LocMessage.tupleInAnnotation() + diag.getString(),
            node
        );

        return { type: UnknownType.create() };
    }

    if ((flags & EvalFlags.InstantiableType) !== 0 && node.d.items.length === 0 && !inferenceContext) {
        return { type: makeTupleObject(evaluator, []), isEmptyTupleShorthand: true };
    }

    flags &= ~(EvalFlags.TypeExpression | EvalFlags.StrLiteralAsType | EvalFlags.InstantiableType);

    // If the expected type is a union, recursively call for each of the subtypes
    // to find one that matches.
    let expectedType = inferenceContext?.expectedType;
    let expectedTypeContainsAny = inferenceContext && isAny(inferenceContext.expectedType);

    if (inferenceContext && isUnion(inferenceContext.expectedType)) {
        let matchingSubtype: Type | undefined;

        doForEachSubtype(
            inferenceContext.expectedType,
            (subtype) => {
                if (isAny(subtype)) {
                    expectedTypeContainsAny = true;
                }

                if (!matchingSubtype) {
                    const subtypeResult = evaluator.useSpeculativeMode(node, () => {
                        return getTypeOfTupleWithContext(
                            evaluator,
                            node,
                            flags,
                            makeInferenceContext(subtype),
                            nodeInfo
                        );
                    });

                    if (subtypeResult && evaluator.assignType(subtype, subtypeResult.type)) {
                        matchingSubtype = subtype;
                    }
                }
            },
            /* sortSubtypes */ true
        );

        expectedType = matchingSubtype;
    }

    let expectedTypeDiagAddendum: DiagnosticAddendum | undefined;
    if (expectedType) {
        const result = getTypeOfTupleWithContext(evaluator, node, flags, makeInferenceContext(expectedType), nodeInfo);

        if (result && !result.typeErrors) {
            return result;
        }

        expectedTypeDiagAddendum = result?.expectedTypeDiagAddendum;
    }

    const typeResult = getTypeOfTupleInferred(evaluator, node, flags);

    // If there was an expected type of Any, replace the resulting type
    // with Any rather than return a type with unknowns.
    if (expectedTypeContainsAny) {
        typeResult.type = AnyType.create();
    }

    return { ...typeResult, expectedTypeDiagAddendum };
}

export function getTypeOfTupleWithContext(
    evaluator: TypeEvaluator,
    node: TupleNode,
    flags: EvalFlags,
    inferenceContext: InferenceContext,
    nodeInfo: AnalyzerNodeInfoAccessor
): TypeResult | undefined {
    inferenceContext.expectedType = transformPossibleRecursiveTypeAlias(inferenceContext.expectedType);
    if (!isClassInstance(inferenceContext.expectedType)) {
        return undefined;
    }

    const tupleClass = evaluator.getTupleClassType();
    if (!tupleClass || !isInstantiableClass(tupleClass)) {
        return undefined;
    }

    // Build an array of expected types.
    let expectedTypes: Type[] = [];

    if (isTupleClass(inferenceContext.expectedType) && inferenceContext.expectedType.priv.tupleTypeArgs) {
        expectedTypes = inferenceContext.expectedType.priv.tupleTypeArgs.map((t) =>
            transformPossibleRecursiveTypeAlias(t.type)
        );
        const unboundedIndex = inferenceContext.expectedType.priv.tupleTypeArgs.findIndex((t) => t.isUnbounded);
        if (unboundedIndex >= 0) {
            if (expectedTypes.length > node.d.items.length) {
                expectedTypes.splice(unboundedIndex, 1);
            } else {
                while (expectedTypes.length < node.d.items.length) {
                    expectedTypes.splice(unboundedIndex, 0, expectedTypes[unboundedIndex]);
                }
            }
        }
    } else {
        const tupleConstraints = new ConstraintTracker();
        if (
            !addConstraintsForExpectedType(
                evaluator,
                ClassType.cloneAsInstance(tupleClass),
                inferenceContext.expectedType,
                tupleConstraints,
                getTypeVarScopesForNode(node, nodeInfo),
                node.start
            )
        ) {
            return undefined;
        }

        const specializedTuple = evaluator.solveAndApplyConstraints(tupleClass, tupleConstraints) as ClassType;
        if (!specializedTuple.priv.typeArgs || specializedTuple.priv.typeArgs.length !== 1) {
            return undefined;
        }

        const homogenousType = transformPossibleRecursiveTypeAlias(specializedTuple.priv.typeArgs[0]);
        for (let i = 0; i < node.d.items.length; i++) {
            expectedTypes.push(homogenousType);
        }
    }

    const entryTypeResults = node.d.items.map((expr, index) =>
        evaluator.getTypeOfExpression(
            expr,
            flags | EvalFlags.StripTupleLiterals,
            makeInferenceContext(
                index < expectedTypes.length ? expectedTypes[index] : undefined,
                inferenceContext.isTypeIncomplete
            )
        )
    );
    const isIncomplete = entryTypeResults.some((result) => result.isIncomplete);

    // Copy any expected type diag addenda for precision error reporting.
    let expectedTypeDiagAddendum: DiagnosticAddendum | undefined;
    if (entryTypeResults.some((result) => result.expectedTypeDiagAddendum)) {
        expectedTypeDiagAddendum = new DiagnosticAddendum();
        entryTypeResults.forEach((result) => {
            if (result.expectedTypeDiagAddendum) {
                expectedTypeDiagAddendum!.addAddendum(result.expectedTypeDiagAddendum);
            }
        });
    }

    // If the tuple contains a very large number of entries, it's probably
    // generated code. If we encounter type errors, don't bother building
    // the full tuple type.
    let type: Type;
    if (node.d.items.length > maxInferredTupleEntryCount && entryTypeResults.some((result) => result.typeErrors)) {
        type = makeTupleObject(evaluator, [{ type: UnknownType.create(), isUnbounded: true }]);
    } else {
        type = makeTupleObject(
            evaluator,
            evaluator.buildTupleTypesList(entryTypeResults, /* stripLiterals */ false, /* convertModule */ false)
        );
    }

    return { type, expectedTypeDiagAddendum, isIncomplete };
}

export function getTypeOfTupleInferred(evaluator: TypeEvaluator, node: TupleNode, flags: EvalFlags): TypeResult {
    const stripLiterals = (flags & EvalFlags.StripTupleLiterals) !== 0;
    const entryTypeResults = node.d.items.map((expr) =>
        evaluator.getTypeOfExpression(
            expr,
            !stripLiterals &&
                node.d.items.length <= maxSubtypesForInferredType &&
                ((expr.nodeType === ParseNodeType.Tuple &&
                    !expr.d.items.some((item) => item.nodeType === ParseNodeType.Unpack)) ||
                    expr.nodeType === ParseNodeType.Name ||
                    expr.nodeType === ParseNodeType.MemberAccess ||
                    expr.nodeType === ParseNodeType.Index)
                ? flags
                : flags | EvalFlags.StripTupleLiterals
        )
    );
    const isIncomplete = entryTypeResults.some((result) => result.isIncomplete);

    // If the tuple contains a very large number of entries, it's probably
    // generated code. Rather than taking the time to evaluate every entry,
    // simply return an unknown type in this case.
    if (node.d.items.length > maxInferredTupleEntryCount) {
        return { type: makeTupleObject(evaluator, [{ type: UnknownType.create(), isUnbounded: true }]) };
    }

    let typeArgs = evaluator.buildTupleTypesList(entryTypeResults, stripLiterals, /* convertModule */ true);
    if (!stripLiterals && node.parent?.nodeType === ParseNodeType.Tuple) {
        const baseTypeArgs = evaluator.buildTupleTypesList(
            entryTypeResults.map((result) => ({ ...result, type: getInferredTupleLiteralBase(result.type) })),
            /* stripLiterals */ true,
            /* convertModule */ true
        );
        const complexity = getTupleLiteralTypeComplexity(typeArgs.map((arg) => arg.type));
        typeArgs =
            complexity && complexity.size < maxSubtypesForInferredType
                ? typeArgs.map((arg, index) => ({
                      ...arg,
                      type: retainInferredTupleLiterals(arg.type, baseTypeArgs[index].type),
                  }))
                : baseTypeArgs;
    }
    const type = makeTupleObject(evaluator, typeArgs);

    if (isIncomplete) {
        if (getContainerDepth(type) > maxInferredContainerDepth) {
            return { type: UnknownType.create() };
        }
    }

    return { type, isIncomplete };
}

// Assigns the source type arguments to the dest type arguments. It assumed
// the the caller has already verified that both the dest and source are
// tuple classes.
export function assignTupleTypeArgs(
    evaluator: TypeEvaluator,
    destType: ClassType,
    srcType: ClassType,
    diag: DiagnosticAddendum | undefined,
    constraints: ConstraintTracker | undefined,
    flags: AssignTypeFlags,
    recursionCount: number
) {
    const destTypeArgs = [...(destType.priv.tupleTypeArgs ?? [])];
    const srcTypeArgs = [...(srcType.priv.tupleTypeArgs ?? [])];

    if (adjustTupleTypeArgs(evaluator, destTypeArgs, srcTypeArgs, flags)) {
        // Establish the pack before matching callbacks that reference it. Otherwise,
        // nested generic callbacks can introduce self-expanding pack constraints.
        const variadicIndex = ((flags & AssignTypeFlags.Contravariant) !== 0 ? srcTypeArgs : destTypeArgs).findIndex(
            (arg, index) =>
                isUnpackedTypeVarTuple(arg.type) &&
                !TypeVarType.isBound(arg.type) &&
                !isTupleGradualForm(srcTypeArgs[index].type)
        );

        for (let index = -1; index < srcTypeArgs.length; index++) {
            const argIndex = index < 0 ? variadicIndex : index;
            if (argIndex < 0 || (index >= 0 && index === variadicIndex)) {
                continue;
            }

            const entryDiag = diag?.createAddendum();
            const destArgType = destTypeArgs[argIndex].type;
            const srcArgType = srcTypeArgs[argIndex].type;

            // Handle the special case where the dest is a TypeVarTuple
            // and the source is a `*tuple[Any, ...]`. This is allowed.
            if (
                isTypeVarTuple(destArgType) &&
                destArgType.priv.isUnpacked &&
                !destArgType.priv.isInUnion &&
                isTupleGradualForm(srcArgType)
            ) {
                return true;
            }

            // A bound unpacked TypeVar also accepts a `*tuple[Any, ...]`
            // source.
            if (
                isUnpackedTypeVar(destArgType) &&
                TypeVarType.isBound(destArgType) &&
                !TypeVarType.isUnification(destArgType) &&
                isTupleGradualForm(srcArgType)
            ) {
                continue;
            }

            if (
                !evaluator.assignType(
                    destArgType,
                    srcArgType,
                    entryDiag?.createAddendum(),
                    constraints,
                    flags,
                    recursionCount
                )
            ) {
                if (entryDiag) {
                    entryDiag.addMessage(
                        LocAddendum.tupleEntryTypeMismatch().format({
                            entry: argIndex + 1,
                        })
                    );
                }
                return false;
            }
        }
    } else {
        const isDestIndeterminate = destTypeArgs.some((t) => t.isUnbounded || isTypeVarTuple(t.type));

        if (srcTypeArgs.some((t) => t.isUnbounded || isTypeVarTuple(t.type))) {
            if (isDestIndeterminate) {
                diag?.addMessage(
                    LocAddendum.tupleSizeIndeterminateSrcDest().format({
                        expected: destTypeArgs.length - 1,
                    })
                );
            } else {
                diag?.addMessage(
                    LocAddendum.tupleSizeIndeterminateSrc().format({
                        expected: destTypeArgs.length,
                    })
                );
            }
        } else {
            if (isDestIndeterminate) {
                diag?.addMessage(
                    LocAddendum.tupleSizeMismatchIndeterminateDest().format({
                        expected: destTypeArgs.length - 1,
                        received: srcTypeArgs.length,
                    })
                );
            } else {
                diag?.addMessage(
                    LocAddendum.tupleSizeMismatch().format({
                        expected: destTypeArgs.length,
                        received: srcTypeArgs.length,
                    })
                );
            }
        }

        return false;
    }

    return true;
}

// Adjusts the source and/or dest type arguments list to attempt to match
// the length of the src type arguments list if the dest or source contain
// entries with indeterminate length or unpacked TypeVarTuple entries.
// It returns true if the source is potentially compatible with the dest
// type, false otherwise.
export function adjustTupleTypeArgs(
    evaluator: TypeEvaluator,
    destTypeArgs: TupleTypeArg[],
    srcTypeArgs: TupleTypeArg[],
    flags: AssignTypeFlags
): boolean {
    // A bound unpacked TypeVar in the dest whose upper bound is an empty
    // tuple contributes no entries, so remove it unless the source contains
    // the same TypeVar.
    const emptyBoundIndex = destTypeArgs.findIndex(
        (t) =>
            isUnpackedTypeVar(t.type) &&
            TypeVarType.isBound(t.type) &&
            !TypeVarType.isUnification(t.type) &&
            !!t.type.shared.boundType &&
            isClassInstance(t.type.shared.boundType) &&
            isTupleClass(t.type.shared.boundType) &&
            t.type.shared.boundType.priv.tupleTypeArgs?.length === 0
    );

    if (emptyBoundIndex >= 0 && !srcTypeArgs.some((t) => isTypeSame(t.type, destTypeArgs[emptyBoundIndex].type))) {
        destTypeArgs.splice(emptyBoundIndex, 1);
    }

    const destUnboundedOrVariadicIndex = destTypeArgs.findIndex(
        (t) => t.isUnbounded || isUnpackedTypeVarTuple(t.type) || isUnpackedTypeVar(t.type)
    );

    // An unpacked TypeVar in the source stands for any tuple that matches its
    // upper bound. Unless it falls within the source entries captured by a
    // variadic element in the dest, replace it with the entries of its bound.
    // Skip this for invariance, since the TypeVar may be a narrower tuple
    // than its bound.
    if ((flags & (AssignTypeFlags.Contravariant | AssignTypeFlags.Invariant)) === 0) {
        const srcTypeVarIndex = srcTypeArgs.findIndex((t) => isUnpackedTypeVar(t.type));
        const capturedByDestVariadic =
            srcTypeVarIndex >= 0 &&
            destUnboundedOrVariadicIndex >= 0 &&
            !destTypeArgs[destUnboundedOrVariadicIndex].isUnbounded &&
            srcTypeVarIndex >= destUnboundedOrVariadicIndex &&
            srcTypeVarIndex <= destUnboundedOrVariadicIndex + srcTypeArgs.length - destTypeArgs.length;

        if (!capturedByDestVariadic) {
            srcTypeArgs.splice(0, srcTypeArgs.length, ...expandUnpackedTypeVarsInTupleArgs(srcTypeArgs));
        }
    }

    let srcUnboundedIndex = srcTypeArgs.findIndex((t) => t.isUnbounded);
    const srcVariadicIndex = srcTypeArgs.findIndex((t) => isUnpackedTypeVarTuple(t.type) || isUnpackedTypeVar(t.type));

    if (srcUnboundedIndex >= 0) {
        if (isAnyOrUnknown(srcTypeArgs[srcUnboundedIndex].type)) {
            // If the source contains an unbounded Any, expand it to match the dest length.
            const typeToReplicate = srcTypeArgs.length > 0 ? srcTypeArgs[srcUnboundedIndex].type : AnyType.create();

            while (srcTypeArgs.length < destTypeArgs.length) {
                srcTypeArgs.splice(srcUnboundedIndex, 0, { type: typeToReplicate, isUnbounded: true });
            }

            if (srcTypeArgs.length > destTypeArgs.length) {
                srcTypeArgs.splice(srcUnboundedIndex, 1);

                // Invalidate the stale index after removal.
                srcUnboundedIndex = -1;
            }
        } else if (destUnboundedOrVariadicIndex < 0) {
            // If the source contains an unbounded type but the dest does not, it's incompatible.
            return false;
        }
    }

    // If the dest contains an unbounded Any, expand it to match the source length.
    if (
        destUnboundedOrVariadicIndex >= 0 &&
        destTypeArgs[destUnboundedOrVariadicIndex].isUnbounded &&
        isAnyOrUnknown(destTypeArgs[destUnboundedOrVariadicIndex].type)
    ) {
        while (destTypeArgs.length < srcTypeArgs.length) {
            destTypeArgs.splice(destUnboundedOrVariadicIndex, 0, destTypeArgs[destUnboundedOrVariadicIndex]);
        }
    }

    // Remove any optional parameters from the end of the two lists until the lengths match.
    while (srcTypeArgs.length > destTypeArgs.length && srcTypeArgs[srcTypeArgs.length - 1].isOptional) {
        srcTypeArgs.splice(srcTypeArgs.length - 1, 1);
    }

    while (destTypeArgs.length > srcTypeArgs.length && destTypeArgs[destTypeArgs.length - 1].isOptional) {
        destTypeArgs.splice(destTypeArgs.length - 1, 1);
    }

    const srcArgsToCapture = srcTypeArgs.length - destTypeArgs.length + 1;
    let skipAdjustSrc = false;

    // If we're doing reverse type mappings and the source contains a TypeVarTuple,
    // we need to adjust the dest so the reverse type mapping assignment
    // can be performed.
    if ((flags & AssignTypeFlags.Contravariant) !== 0) {
        const destArgsToCapture = destTypeArgs.length - srcTypeArgs.length + 1;

        if (srcVariadicIndex >= 0 && destArgsToCapture >= 0) {
            // If the only removed arg from the dest type args is itself a variadic,
            // don't bother adjusting it.
            const skipAdjustment = destArgsToCapture === 1 && isTypeVarTuple(destTypeArgs[srcVariadicIndex].type);
            const tupleClass = evaluator.getTupleClassType();

            if (!skipAdjustment && tupleClass && isInstantiableClass(tupleClass)) {
                const removedArgs = destTypeArgs.splice(srcVariadicIndex, destArgsToCapture);

                // Package up the remaining type arguments into a tuple object.
                const variadicTuple = ClassType.cloneAsInstance(
                    specializeTupleClass(
                        tupleClass,
                        removedArgs.map((typeArg) => {
                            return {
                                type: typeArg.type,
                                isUnbounded: typeArg.isUnbounded,
                                isOptional: typeArg.isOptional,
                            };
                        }),
                        /* isTypeArgExplicit */ true,
                        /* isUnpacked */ true
                    )
                );

                destTypeArgs.splice(srcVariadicIndex, 0, {
                    type: variadicTuple,
                    isUnbounded: false,
                });
            }

            skipAdjustSrc = true;
        }
    } else {
        if (destUnboundedOrVariadicIndex >= 0 && srcArgsToCapture >= 0) {
            // If the dest contains a variadic element, determine which source
            // args map to this element and package them up into an unpacked tuple.
            const destVariadicType = destTypeArgs[destUnboundedOrVariadicIndex].type;
            if (isTypeVarTuple(destVariadicType) || isUnpackedTypeVar(destVariadicType)) {
                const tupleClass = evaluator.getTupleClassType();

                if (tupleClass && isInstantiableClass(tupleClass)) {
                    const removedArgs = srcTypeArgs.splice(destUnboundedOrVariadicIndex, srcArgsToCapture);

                    let variadicTuple: Type;

                    // If we're left with a single unpacked variadic type var, there's no
                    // need to wrap it in a nested tuple.
                    if (
                        removedArgs.length === 1 &&
                        (isUnpackedTypeVarTuple(removedArgs[0].type) || isUnpackedTypeVar(removedArgs[0].type))
                    ) {
                        variadicTuple = removedArgs[0].type;
                    } else {
                        // Package up the remaining type arguments into a tuple object.
                        variadicTuple = ClassType.cloneAsInstance(
                            specializeTupleClass(
                                tupleClass,
                                removedArgs.map((typeArg) => {
                                    return {
                                        type: typeArg.type,
                                        isUnbounded: typeArg.isUnbounded,
                                        isOptional: typeArg.isOptional,
                                    };
                                }),
                                /* isTypeArgExplicit */ true,
                                /* isUnpacked */ true
                            )
                        );
                    }

                    srcTypeArgs.splice(destUnboundedOrVariadicIndex, 0, {
                        type: variadicTuple,
                        isUnbounded: false,
                    });
                }

                skipAdjustSrc = true;
            }
        }
    }

    if (!skipAdjustSrc && destUnboundedOrVariadicIndex >= 0 && srcArgsToCapture >= 0) {
        // If possible, package up the source entries that correspond to
        // the dest unbounded tuple. This isn't possible if the source contains
        // an unbounded tuple outside of this range.
        if (
            srcUnboundedIndex < 0 ||
            (srcUnboundedIndex >= destUnboundedOrVariadicIndex &&
                srcUnboundedIndex < destUnboundedOrVariadicIndex + srcArgsToCapture)
        ) {
            const removedArgTypes = srcTypeArgs.splice(destUnboundedOrVariadicIndex, srcArgsToCapture).map((t) => {
                if (isTypeVar(t.type) && isUnpackedTypeVarTuple(t.type)) {
                    return TypeVarType.cloneForUnpacked(t.type, /* isInUnion */ true);
                }
                return t.type;
            });

            srcTypeArgs.splice(destUnboundedOrVariadicIndex, 0, {
                type: removedArgTypes.length > 0 ? combineTypes(removedArgTypes) : AnyType.create(),
                isUnbounded: false,
            });
        }
    }

    return destTypeArgs.length === srcTypeArgs.length;
}

// Given a tuple type and a slice expression, determines the resulting
// type if it can be determined. If not, it returns undefined.
export function getSlicedTupleType(
    evaluator: TypeEvaluator,
    tupleType: ClassType,
    sliceNode: SliceNode
): Type | undefined {
    const tupleTypeArgs = tupleType.priv.tupleTypeArgs;
    if (!tupleTypeArgs) {
        return undefined;
    }

    const startValues = getTupleSliceParam(evaluator, sliceNode.d.startValue);
    const endValues = getTupleSliceParam(evaluator, sliceNode.d.endValue);
    const stepValues = getTupleSliceParam(evaluator, sliceNode.d.stepValue);

    if (
        !startValues ||
        !endValues ||
        !stepValues ||
        startValues.length * endValues.length * stepValues.length > maxSubtypesForInferredType
    ) {
        return undefined;
    }

    const isVariadicTupleTypeArg = (typeArg: TupleTypeArg) =>
        typeArg.isUnbounded || isTypeVarTuple(typeArg.type) || isUnpackedTypeVar(typeArg.type);

    // Returns the indices a slice selects from the expanded entries, as
    // computed by slice.indices.
    function getSliceIndices(start: number | null, end: number | null, step: number | null): number[] {
        const length = expandedTypeArgs.length;
        const stepSize = step ?? 1;
        const lower = stepSize < 0 ? -1 : 0;
        const upper = stepSize < 0 ? length - 1 : length;

        const getBound = (value: number | null, defaultValue: number) => {
            if (value === null) {
                return defaultValue;
            }

            return value < 0 ? Math.max(value + length, lower) : Math.min(value, upper);
        };

        const startIndex = getBound(start, stepSize < 0 ? upper : lower);
        const endIndex = getBound(end, stepSize < 0 ? lower : upper);

        const sliceIndices: number[] = [];
        for (let index = startIndex; stepSize > 0 ? index < endIndex : index > endIndex; index += stepSize) {
            sliceIndices.push(index);
        }

        return sliceIndices;
    }

    // A slice bound of a tuple with a variadic entry is known only if it
    // lies on the side of the variadic entry it is counted from.
    const getVariadicSliceIndex = (value: number | null, defaultValue: number) => {
        if (value === null) {
            return defaultValue;
        }

        if (value < 0) {
            const index = value + expandedTypeArgs.length;
            return index <= variadicIndex ? undefined : index;
        }

        return value > variadicIndex ? undefined : value;
    };

    // An unpacked TypeVar whose bound is a fixed-length tuple stands for
    // the entries of its bound.
    const expandedTypeArgs: TupleTypeArg[] = [];
    const expandedTypeArgOrigins: number[] = [];
    tupleTypeArgs.forEach((typeArg, index) => {
        let entries = expandUnpackedTypeVarsInTupleArgs([typeArg]);
        if (entries.some((entry) => isVariadicTupleTypeArg(entry))) {
            entries = [typeArg];
        }

        entries.forEach((entry) => {
            expandedTypeArgs.push(entry);
            expandedTypeArgOrigins.push(index);
        });
    });

    const variadicIndex = expandedTypeArgs.findIndex((typeArg) => isVariadicTupleTypeArg(typeArg));

    const getSlicedTypeArgs = (start: number | null, end: number | null, step: number | null) => {
        if (step === 0) {
            return undefined;
        }

        let indices: number[];

        if (variadicIndex < 0) {
            indices = getSliceIndices(start, end, step);
        } else {
            if (step !== null && step !== 1) {
                return undefined;
            }

            const startIndex = getVariadicSliceIndex(start, 0);
            const endIndex = getVariadicSliceIndex(end, expandedTypeArgs.length);

            if (startIndex === undefined || endIndex === undefined) {
                return undefined;
            }

            indices = getSliceIndices(startIndex, endIndex, /* step */ null);
        }

        // Keep an unpacked TypeVar when the slice keeps all of its entries in order.
        const slicedTypeArgs: TupleTypeArg[] = [];
        indices.forEach((index) => {
            const origin = expandedTypeArgOrigins[index];
            const originTypeArg = tupleTypeArgs[origin];

            if (originTypeArg !== expandedTypeArgs[index] && (step === null || step === 1)) {
                const firstIndex = expandedTypeArgOrigins.indexOf(origin);
                const lastIndex = expandedTypeArgOrigins.lastIndexOf(origin);

                if (indices[0] <= firstIndex && lastIndex <= indices[indices.length - 1]) {
                    if (index === firstIndex) {
                        slicedTypeArgs.push(originTypeArg);
                    }
                    return;
                }
            }

            slicedTypeArgs.push(expandedTypeArgs[index]);
        });

        return slicedTypeArgs;
    };

    const slicedTypes: Type[] = [];

    for (const start of startValues) {
        for (const end of endValues) {
            for (const step of stepValues) {
                const slicedTypeArgs = getSlicedTypeArgs(start, end, step);
                if (!slicedTypeArgs) {
                    return undefined;
                }

                slicedTypes.push(ClassType.cloneAsInstance(specializeTupleClass(tupleType, slicedTypeArgs)));
            }
        }
    }

    return combineTypes(slicedTypes);
}

// If the type is a fixed-length tuple instance and one or more of the element types
// is a union, this function expands the tuple into a union of tuples where each
// element is a union of the corresponding element types. This is done for all
// element combinations until the total number of tuples exceeds maxExpansion,
// at which point the function returns the original tuple type.
export function expandTuple(tupleType: ClassType, maxExpansion: number): Type[] | undefined {
    if (
        !isTupleClass(tupleType) ||
        !tupleType.priv.tupleTypeArgs ||
        tupleType.priv.tupleTypeArgs.some((typeArg) => typeArg.isUnbounded || isTypeVarTuple(typeArg.type))
    ) {
        return undefined;
    }

    let typesToCombine: ClassType[] = [tupleType];
    let index = 0;

    while (index < tupleType.priv.tupleTypeArgs.length) {
        const elemType = tupleType.priv.tupleTypeArgs[index].type;
        if (isUnion(elemType)) {
            const newTypesToCombine: ClassType[] = [];

            for (const typeToCombine of typesToCombine) {
                doForEachSubtype(elemType, (subtype) => {
                    const newTypeArgs = [...typeToCombine.priv.tupleTypeArgs!];
                    newTypeArgs[index] = { type: subtype, isUnbounded: false };
                    newTypesToCombine.push(ClassType.cloneAsInstance(specializeTupleClass(typeToCombine, newTypeArgs)));
                });
            }
            typesToCombine = newTypesToCombine;
        }

        if (typesToCombine.length > maxExpansion) {
            return undefined;
        }

        index++;
    }

    return typesToCombine.length === 1 ? undefined : typesToCombine;
}

// Returns the possible values of a slice argument, with null for an
// omitted or None argument, or undefined if any value isn't known.
function getTupleSliceParam(
    evaluator: TypeEvaluator,
    expression: ExpressionNode | undefined
): (number | null)[] | undefined {
    if (!expression) {
        return [null];
    }

    const values: (number | null)[] = [];
    let isKnown = true;

    doForEachSubtype(evaluator.getTypeOfExpression(expression).type, (subtype) => {
        if (isNoneInstance(subtype)) {
            values.push(null);
        } else if (!isClassInstance(subtype) || !isLiteralType(subtype)) {
            isKnown = false;
        } else if (ClassType.isBuiltIn(subtype, 'int') && typeof subtype.priv.literalValue === 'number') {
            values.push(subtype.priv.literalValue);
        } else if (ClassType.isBuiltIn(subtype, 'bool') && typeof subtype.priv.literalValue === 'boolean') {
            values.push(subtype.priv.literalValue ? 1 : 0);
        } else {
            isKnown = false;
        }
    });

    return isKnown && values.length > 0 ? values : undefined;
}
