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
import { addConstraintsForExpectedType } from './constraintSolver';
import { ConstraintTracker } from './constraintTracker';
import { getTypeVarScopesForNode } from './parseTreeUtils';
import { AssignTypeFlags, EvalFlags, maxInferredContainerDepth, TypeEvaluator, TypeResult } from './typeEvaluatorTypes';
import {
    AnyType,
    ClassType,
    combineTypes,
    isAny,
    isAnyOrUnknown,
    isClassInstance,
    isInstantiableClass,
    isTypeVar,
    isTypeVarTuple,
    isUnion,
    isUnpackedTypeVar,
    isUnpackedTypeVarTuple,
    TupleTypeArg,
    Type,
    TypeVarType,
    UnknownType,
} from './types';
import {
    convertToInstance,
    doForEachSubtype,
    getContainerDepth,
    InferenceContext,
    isLiteralType,
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

export function makeTupleObject(evaluator: TypeEvaluator, typeArgs: TupleTypeArg[], isUnpacked = false) {
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
    inferenceContext?: InferenceContext | undefined
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
                        return getTypeOfTupleWithContext(evaluator, node, flags, makeInferenceContext(subtype));
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
        const result = getTypeOfTupleWithContext(evaluator, node, flags, makeInferenceContext(expectedType));

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
    inferenceContext: InferenceContext
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
                getTypeVarScopesForNode(node),
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
    const entryTypeResults = node.d.items.map((expr) =>
        evaluator.getTypeOfExpression(expr, flags | EvalFlags.StripTupleLiterals)
    );
    const isIncomplete = entryTypeResults.some((result) => result.isIncomplete);

    // If the tuple contains a very large number of entries, it's probably
    // generated code. Rather than taking the time to evaluate every entry,
    // simply return an unknown type in this case.
    if (node.d.items.length > maxInferredTupleEntryCount) {
        return { type: makeTupleObject(evaluator, [{ type: UnknownType.create(), isUnbounded: true }]) };
    }

    const type = makeTupleObject(
        evaluator,
        evaluator.buildTupleTypesList(
            entryTypeResults,
            (flags & EvalFlags.StripTupleLiterals) !== 0,
            /* convertModule */ true
        )
    );

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
        for (let argIndex = 0; argIndex < srcTypeArgs.length; argIndex++) {
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
    const destUnboundedOrVariadicIndex = destTypeArgs.findIndex(
        (t) => t.isUnbounded || isUnpackedTypeVarTuple(t.type) || isUnpackedTypeVar(t.type)
    );
    const srcUnboundedIndex = srcTypeArgs.findIndex((t) => t.isUnbounded);
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
            if (isTypeVarTuple(destTypeArgs[destUnboundedOrVariadicIndex].type)) {
                const tupleClass = evaluator.getTupleClassType();

                if (tupleClass && isInstantiableClass(tupleClass)) {
                    const removedArgs = srcTypeArgs.splice(destUnboundedOrVariadicIndex, srcArgsToCapture);

                    let variadicTuple: Type;

                    // If we're left with a single unpacked variadic type var, there's no
                    // need to wrap it in a nested tuple.
                    if (removedArgs.length === 1 && isUnpackedTypeVarTuple(removedArgs[0].type)) {
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
    // We don't handle step values.
    if (sliceNode.d.stepValue || !tupleType.priv.tupleTypeArgs) {
        return undefined;
    }

    const tupleTypeArgs = tupleType.priv.tupleTypeArgs;
    const startValue = getTupleSliceParam(evaluator, sliceNode.d.startValue, 0, tupleTypeArgs);
    const endValue = getTupleSliceParam(evaluator, sliceNode.d.endValue, tupleTypeArgs.length, tupleTypeArgs);

    if (startValue === undefined || endValue === undefined || endValue < startValue) {
        return undefined;
    }

    const slicedTypeArgs = tupleTypeArgs.slice(startValue, endValue);
    return ClassType.cloneAsInstance(specializeTupleClass(tupleType, slicedTypeArgs));
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

function getTupleSliceParam(
    evaluator: TypeEvaluator,
    expression: ExpressionNode | undefined,
    defaultValue: number,
    tupleTypeArgs: TupleTypeArg[]
): number | undefined {
    let value = defaultValue;

    if (expression) {
        const valType = evaluator.getTypeOfExpression(expression).type;
        if (!isClassInstance(valType) || !ClassType.isBuiltIn(valType, 'int') || !isLiteralType(valType)) {
            return undefined;
        }

        value = valType.priv.literalValue as number;
        const unboundedIndex = tupleTypeArgs.findIndex(
            (typeArg) => typeArg.isUnbounded || isTypeVarTuple(typeArg.type)
        );

        if (value < 0) {
            value = tupleTypeArgs.length + value;
            if (unboundedIndex >= 0 && value <= unboundedIndex) {
                return undefined;
            } else if (value < 0) {
                return 0;
            }
        } else {
            if (unboundedIndex >= 0 && value > unboundedIndex) {
                return undefined;
            } else if (value > tupleTypeArgs.length) {
                return tupleTypeArgs.length;
            }
        }
    }

    return value;
}
