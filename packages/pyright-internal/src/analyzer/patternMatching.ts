/*
 * patternMatching.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Type evaluation logic for evaluating and narrowing types
 * related to "match" and "case" statements as documented in
 * PEP 634.
 */

import { appendArray } from '../common/collectionUtils';
import { assert } from '../common/debug';
import { DiagnosticAddendum } from '../common/diagnostic';
import { DiagnosticRule } from '../common/diagnosticRules';
import { LocAddendum, LocMessage } from '../localization/localize';
import {
    ArgCategory,
    ExpressionNode,
    ParseNode,
    ParseNodeType,
    PatternAsNode,
    PatternAtomNode,
    PatternClassArgumentNode,
    PatternClassNode,
    PatternLiteralNode,
    PatternMappingNode,
    PatternSequenceNode,
    PatternValueNode,
} from '../parser/parseNodes';
import { CodeFlowReferenceExpressionNode } from './codeFlowTypes';
import { addConstraintsForExpectedType } from './constraintSolver';
import { ConstraintTracker } from './constraintTracker';
import { getTypeVarScopesForNode, isMatchingExpression } from './parseTreeUtils';
import { getTypedDictMembersForClass } from './typedDicts';
import { EvalFlags, TypeEvaluator, TypeResult } from './typeEvaluatorTypes';
import {
    enumerateLiteralsForType,
    narrowTypeForDiscriminatedDictEntryComparison,
    narrowTypeForDiscriminatedLiteralFieldComparison,
    narrowTypeForDiscriminatedTupleComparison,
} from './typeGuards';
import {
    AnyType,
    ClassType,
    FunctionType,
    FunctionTypeFlags,
    NeverType,
    Type,
    TypeBase,
    TypedDictEntry,
    UnknownType,
    combineTypes,
    isAnyOrUnknown,
    isClass,
    isClassInstance,
    isInstantiableClass,
    isNever,
    isSameWithoutLiteralValue,
    isTypeSame,
    isTypeVarTuple,
    isUnknown,
    isUnpackedTypeVar,
    isUnpackedTypeVarTuple,
} from './types';
import {
    addConditionToType,
    containsAnyOrUnknown,
    convertToInstance,
    doForEachSubtype,
    getTypeCondition,
    getTypeVarScopeIds,
    getUnknownTypeForCallable,
    isLiteralType,
    isLiteralTypeOrUnion,
    isMetaclassInstance,
    isNoneInstance,
    isPartlyUnknown,
    isTupleClass,
    isUnboundedTupleClass,
    lookUpClassMember,
    mapSubtypes,
    partiallySpecializeType,
    preserveUnknown,
    specializeTupleClass,
    specializeWithUnknownTypeArgs,
    transformPossibleRecursiveTypeAlias,
} from './typeUtils';

// PEP 634 indicates that several built-in classes are handled differently
// when used with class pattern matching.
const classPatternSpecialCases = [
    'builtins.bool',
    'builtins.bytearray',
    'builtins.bytes',
    'builtins.dict',
    'builtins.float',
    'builtins.frozenset',
    'builtins.int',
    'builtins.list',
    'builtins.set',
    'builtins.str',
    'builtins.tuple',
];

// There are cases where sequence pattern matching of tuples with
// large unions can blow up and cause hangs. This constant limits
// the total number of subtypes that can be generated during type
// narrowing for sequence patterns before the narrowed type is
// converted to Any. This is tuned empirically to provide a reasonable
// performance cutoff.
const maxSequencePatternTupleExpansionSubtypes = 128;

interface SequencePatternInfo {
    subtype: Type;
    isDefiniteNoMatch: boolean;
    isPotentialNoMatch?: boolean;
    entryTypes: Type[];
    isIndeterminateLength?: boolean;
    isTuple?: boolean;
    isUnboundedTuple?: boolean;
}

interface MappingPatternInfo {
    subtype: Type;
    isDefinitelyMapping: boolean;
    isDefinitelyNotMapping: boolean;
    typedDict?: ClassType;
    dictTypeArgs?: {
        key: Type;
        value: Type;
    };
}

type PatternSubtypeNarrowingCallback = (type: Type) => TypeResult | undefined;

export function narrowTypeBasedOnPattern(
    evaluator: TypeEvaluator,
    type: Type,
    pattern: PatternAtomNode,
    isPositiveTest: boolean
): Type {
    switch (pattern.nodeType) {
        case ParseNodeType.PatternSequence: {
            return narrowTypeBasedOnSequencePattern(evaluator, type, pattern, isPositiveTest);
        }

        case ParseNodeType.PatternLiteral: {
            return narrowTypeBasedOnLiteralPattern(evaluator, type, pattern, isPositiveTest);
        }

        case ParseNodeType.PatternClass: {
            return narrowTypeBasedOnClassPattern(evaluator, type, pattern, isPositiveTest);
        }

        case ParseNodeType.PatternAs: {
            return narrowTypeBasedOnAsPattern(evaluator, type, pattern, isPositiveTest);
        }

        case ParseNodeType.PatternMapping: {
            return narrowTypeBasedOnMappingPattern(evaluator, type, pattern, isPositiveTest);
        }

        case ParseNodeType.PatternValue: {
            return narrowTypeBasedOnValuePattern(evaluator, type, pattern, isPositiveTest);
        }

        case ParseNodeType.PatternCapture: {
            // A capture captures everything, so nothing remains in the negative case.
            return isPositiveTest ? type : NeverType.createNever();
        }

        case ParseNodeType.Error: {
            return type;
        }
    }
}

// Determines whether this pattern (or part of the pattern) in
// this case statement will never be matched.
export function checkForUnusedPattern(evaluator: TypeEvaluator, pattern: PatternAtomNode, subjectType: Type): void {
    if (isNever(subjectType)) {
        reportUnnecessaryPattern(evaluator, pattern, subjectType);
    } else if (pattern.nodeType === ParseNodeType.PatternAs && pattern.d.orPatterns.length > 1) {
        // Check each of the or patterns separately.
        pattern.d.orPatterns.forEach((orPattern) => {
            const subjectTypeMatch = narrowTypeBasedOnPattern(
                evaluator,
                subjectType,
                orPattern,
                /* isPositiveTest */ true
            );

            if (isNever(subjectTypeMatch)) {
                reportUnnecessaryPattern(evaluator, orPattern, subjectType);
            }

            subjectType = narrowTypeBasedOnPattern(evaluator, subjectType, orPattern, /* isPositiveTest */ false);
        });
    } else {
        const subjectTypeMatch = narrowTypeBasedOnPattern(evaluator, subjectType, pattern, /* isPositiveTest */ true);

        if (isNever(subjectTypeMatch)) {
            reportUnnecessaryPattern(evaluator, pattern, subjectType);
        }
    }
}

function narrowTypeBasedOnSequencePattern(
    evaluator: TypeEvaluator,
    type: Type,
    pattern: PatternSequenceNode,
    isPositiveTest: boolean
): Type {
    let usingTupleExpansion = false;
    type = transformPossibleRecursiveTypeAlias(type);
    let sequenceInfo = getSequencePatternInfo(evaluator, pattern, type);

    // Further narrow based on pattern entry types.
    sequenceInfo = sequenceInfo.filter((entry) => {
        if (entry.isDefiniteNoMatch) {
            if (isPositiveTest) {
                return false;
            } else {
                return true;
            }
        }

        let isPlausibleMatch = true;
        let isDefiniteMatch = true;
        const narrowedEntryTypes: Type[] = [];
        const unnarrowedEntryTypes: Type[] = [];
        let canNarrowTuple = entry.isTuple;

        // Don't attempt to narrow tuples in the negative case if the subject
        // contains indeterminate-length entries or the tuple is of indeterminate
        // length.
        if (!isPositiveTest) {
            if (entry.isIndeterminateLength || entry.isUnboundedTuple) {
                canNarrowTuple = false;
            }

            if (isClassInstance(entry.subtype) && entry.subtype.priv.tupleTypeArgs) {
                const unboundedIndex = entry.subtype.priv.tupleTypeArgs.findIndex((typeArg) => typeArg.isUnbounded);

                if (unboundedIndex >= 0) {
                    // If the pattern includes a "star" entry that aligns exactly with
                    // the corresponding unbounded entry in the tuple, we can narrow
                    // the tuple type.
                    if (pattern.d.starEntryIndex === undefined || pattern.d.starEntryIndex !== unboundedIndex) {
                        canNarrowTuple = false;
                    }
                }
            }
        }

        // If the subject has an indeterminate length but the pattern does not accept
        // an arbitrary number of entries or accepts at least one non-star entry,
        // we can't prove that it's a definite match.
        if (entry.isIndeterminateLength) {
            if (pattern.d.entries.length !== 1 || pattern.d.starEntryIndex !== 0) {
                isDefiniteMatch = false;
            }
        }

        const negativeNarrowedDims: number[] = [];
        pattern.d.entries.forEach((sequenceEntry, index) => {
            const entryType = getTypeOfPatternSequenceEntry(
                evaluator,
                pattern,
                entry,
                index,
                pattern.d.entries.length,
                pattern.d.starEntryIndex,
                /* unpackStarEntry */ true
            );

            unnarrowedEntryTypes.push(entryType);
            const narrowedEntryType = narrowTypeBasedOnPattern(evaluator, entryType, sequenceEntry, isPositiveTest);

            if (isPositiveTest) {
                if (index === pattern.d.starEntryIndex) {
                    if (
                        isClassInstance(narrowedEntryType) &&
                        narrowedEntryType.priv.tupleTypeArgs &&
                        !isUnboundedTupleClass(narrowedEntryType) &&
                        narrowedEntryType.priv.tupleTypeArgs
                    ) {
                        appendArray(
                            narrowedEntryTypes,
                            narrowedEntryType.priv.tupleTypeArgs.map((t) => t.type)
                        );
                    } else {
                        narrowedEntryTypes.push(narrowedEntryType);
                        canNarrowTuple = false;
                    }
                } else {
                    narrowedEntryTypes.push(narrowedEntryType);

                    if (isNever(narrowedEntryType)) {
                        isPlausibleMatch = false;
                    }
                }
            } else {
                if (entry.isPotentialNoMatch) {
                    isDefiniteMatch = false;
                }

                if (!isNever(narrowedEntryType)) {
                    isDefiniteMatch = false;

                    // Record which entries were narrowed in the negative case
                    // by storing their indexes. If more than one is narrowed,
                    // we need to perform tuple expansion to represent the
                    // resulting narrowed type.
                    negativeNarrowedDims.push(index);
                    narrowedEntryTypes.push(narrowedEntryType);
                } else {
                    narrowedEntryTypes.push(entryType);
                }

                if (index === pattern.d.starEntryIndex) {
                    canNarrowTuple = false;
                }
            }
        });

        if (pattern.d.entries.length === 0) {
            // If the pattern is an empty sequence, use the entry types.
            if (entry.entryTypes.length > 0) {
                narrowedEntryTypes.push(combineTypes(entry.entryTypes));
            }

            if (entry.isPotentialNoMatch) {
                isDefiniteMatch = false;
            }
        }

        if (!isPositiveTest) {
            // If the positive case is a definite match, the negative case can
            // eliminate this subtype entirely.
            if (isDefiniteMatch) {
                return false;
            }

            // Can we narrow a tuple?
            if (canNarrowTuple && negativeNarrowedDims.length > 0) {
                const tupleClassType = evaluator.getBuiltInType(pattern, 'tuple');
                if (tupleClassType && isInstantiableClass(tupleClassType)) {
                    // Expand the tuple in the dimensions that were narrowed.
                    // Start with the fully-narrowed set of entries.
                    const expandedEntryTypes = [];

                    for (const dim of negativeNarrowedDims) {
                        const newEntryTypes = [...unnarrowedEntryTypes];
                        newEntryTypes[dim] = narrowedEntryTypes[dim];
                        expandedEntryTypes.push(newEntryTypes);
                    }

                    entry.subtype = combineTypes(
                        expandedEntryTypes.map((entryTypes) => {
                            return ClassType.cloneAsInstance(
                                specializeTupleClass(
                                    tupleClassType,
                                    entryTypes.map((t) => {
                                        return { type: t, isUnbounded: false };
                                    })
                                )
                            );
                        })
                    );

                    // Note that we're using tuple expansion in case we
                    // need to limit the number of subtypes generated.
                    usingTupleExpansion = true;
                }
            }

            return true;
        }

        if (isPlausibleMatch) {
            // If this is a tuple, we can narrow it to a specific tuple type.
            // Other sequences cannot be narrowed because we don't know if they
            // are immutable (covariant).
            if (canNarrowTuple) {
                const tupleClassType = evaluator.getBuiltInType(pattern, 'tuple');
                if (tupleClassType && isInstantiableClass(tupleClassType)) {
                    entry.subtype = ClassType.cloneAsInstance(
                        specializeTupleClass(
                            tupleClassType,
                            narrowedEntryTypes.map((t) => {
                                return { type: t, isUnbounded: false };
                            })
                        )
                    );
                }
            }

            // If this is a supertype of Sequence, we can narrow it to a Sequence type.
            if (entry.isPotentialNoMatch && !entry.isTuple) {
                const sequenceType = evaluator.getTypingType(pattern, 'Sequence');
                if (sequenceType && isInstantiableClass(sequenceType)) {
                    let typeArgType = evaluator.stripLiteralValue(combineTypes(narrowedEntryTypes));

                    // If the type is a union that contains Any or Unknown, remove the other types
                    // before wrapping it in a Sequence.
                    typeArgType = containsAnyOrUnknown(typeArgType, /* recurse */ false) ?? typeArgType;

                    entry.subtype = ClassType.cloneAsInstance(ClassType.specialize(sequenceType, [typeArgType]));
                }
            }
        }

        return isPlausibleMatch;
    });

    return combineTypes(
        sequenceInfo.map((entry) => entry.subtype),
        { maxSubtypeCount: usingTupleExpansion ? maxSequencePatternTupleExpansionSubtypes : undefined }
    );
}

function narrowTypeBasedOnAsPattern(
    evaluator: TypeEvaluator,
    type: Type,
    pattern: PatternAsNode,
    isPositiveTest: boolean
): Type {
    let remainingType = type;

    if (!isPositiveTest) {
        pattern.d.orPatterns.forEach((subpattern) => {
            remainingType = narrowTypeBasedOnPattern(evaluator, remainingType, subpattern, /* isPositiveTest */ false);
        });
        return remainingType;
    }

    const narrowedTypes = pattern.d.orPatterns.map((subpattern) => {
        const narrowedSubtype = narrowTypeBasedOnPattern(
            evaluator,
            remainingType,
            subpattern,
            /* isPositiveTest */ true
        );
        remainingType = narrowTypeBasedOnPattern(evaluator, remainingType, subpattern, /* isPositiveTest */ false);
        return narrowedSubtype;
    });
    return combineTypes(narrowedTypes);
}

function narrowTypeBasedOnMappingPattern(
    evaluator: TypeEvaluator,
    type: Type,
    pattern: PatternMappingNode,
    isPositiveTest: boolean
): Type {
    type = transformPossibleRecursiveTypeAlias(type);

    if (!isPositiveTest) {
        // Handle the case where the pattern consists only of a "**x" entry.
        if (
            pattern.d.entries.length === 1 &&
            pattern.d.entries[0].nodeType === ParseNodeType.PatternMappingExpandEntry
        ) {
            const mappingInfo = getMappingPatternInfo(evaluator, type, pattern);
            return combineTypes(mappingInfo.filter((m) => !m.isDefinitelyMapping).map((m) => m.subtype));
        }

        if (pattern.d.entries.length !== 1 || pattern.d.entries[0].nodeType !== ParseNodeType.PatternMappingKeyEntry) {
            return type;
        }

        // Handle the case where the type is a union that includes a TypedDict with
        // a field discriminated by a literal.
        const keyPattern = pattern.d.entries[0].d.keyPattern;
        const valuePattern = pattern.d.entries[0].d.valuePattern;
        if (
            keyPattern.nodeType !== ParseNodeType.PatternLiteral ||
            valuePattern.nodeType !== ParseNodeType.PatternAs ||
            !valuePattern.d.orPatterns.every((orPattern) => orPattern.nodeType === ParseNodeType.PatternLiteral)
        ) {
            return type;
        }

        const keyType = evaluator.getTypeOfExpression(keyPattern.d.expr).type;

        // The key type must be a str literal.
        if (
            !isClassInstance(keyType) ||
            !ClassType.isBuiltIn(keyType, 'str') ||
            keyType.priv.literalValue === undefined
        ) {
            return type;
        }
        const keyValue = keyType.priv.literalValue as string;

        const valueTypes = valuePattern.d.orPatterns.map(
            (orPattern) => evaluator.getTypeOfExpression((orPattern as PatternLiteralNode).d.expr).type
        );

        return mapSubtypes(type, (subtype) => {
            if (isClassInstance(subtype) && ClassType.isTypedDictClass(subtype)) {
                const typedDictMembers = getTypedDictMembersForClass(evaluator, subtype, /* allowNarrowed */ true);
                const member = typedDictMembers.knownItems.get(keyValue);

                if (member && (member.isRequired || member.isProvided) && isClassInstance(member.valueType)) {
                    const memberValueType = member.valueType;

                    // If there's at least one literal value pattern that matches
                    // the literal type of the member, we can eliminate this type.
                    if (
                        valueTypes.some(
                            (valueType) =>
                                isClassInstance(valueType) &&
                                ClassType.isSameGenericClass(valueType, memberValueType) &&
                                valueType.priv.literalValue === memberValueType.priv.literalValue
                        )
                    ) {
                        return undefined;
                    }
                }
            }

            return subtype;
        });
    }

    let mappingInfo = getMappingPatternInfo(evaluator, type, pattern);

    // Further narrow based on pattern entry types.
    mappingInfo = mappingInfo.filter((mappingSubtypeInfo) => {
        if (mappingSubtypeInfo.isDefinitelyNotMapping) {
            return false;
        }

        let isPlausibleMatch = true;

        pattern.d.entries.forEach((mappingEntry) => {
            if (mappingSubtypeInfo.typedDict) {
                if (mappingEntry.nodeType === ParseNodeType.PatternMappingKeyEntry) {
                    const narrowedKeyType = narrowTypeBasedOnPattern(
                        evaluator,
                        evaluator.getBuiltInObject(pattern, 'str'),
                        mappingEntry.d.keyPattern,
                        isPositiveTest
                    );

                    if (isNever(narrowedKeyType)) {
                        isPlausibleMatch = false;
                    }

                    const valueType = mapSubtypes(narrowedKeyType, (keySubtype) => {
                        if (isAnyOrUnknown(keySubtype)) {
                            return keySubtype;
                        }

                        if (isClassInstance(keySubtype) && ClassType.isBuiltIn(keySubtype, 'str')) {
                            if (!isLiteralType(keySubtype)) {
                                return UnknownType.create();
                            }

                            const tdEntries = getTypedDictMembersForClass(evaluator, mappingSubtypeInfo.typedDict!);
                            const valueEntry = tdEntries.knownItems.get(keySubtype.priv.literalValue as string);
                            if (valueEntry) {
                                const narrowedValueType = narrowTypeBasedOnPattern(
                                    evaluator,
                                    valueEntry.valueType,
                                    mappingEntry.d.valuePattern,
                                    /* isPositiveTest */ true
                                );
                                if (!isNever(narrowedValueType)) {
                                    // If this is a "NotRequired" entry that has not yet been demonstrated
                                    // to be present, we can mark it as "provided" at this point.
                                    if (
                                        !valueEntry.isRequired &&
                                        !valueEntry.isProvided &&
                                        isTypeSame(mappingSubtypeInfo.subtype, mappingSubtypeInfo.typedDict!)
                                    ) {
                                        const newNarrowedEntriesMap = new Map<string, TypedDictEntry>(
                                            mappingSubtypeInfo.typedDict!.priv.typedDictNarrowedEntries ?? []
                                        );
                                        newNarrowedEntriesMap.set(keySubtype.priv.literalValue as string, {
                                            valueType: valueEntry.valueType,
                                            isReadOnly: valueEntry.isReadOnly,
                                            isRequired: false,
                                            isProvided: true,
                                        });

                                        // Clone the TypedDict object with the new entries.
                                        mappingSubtypeInfo.subtype = ClassType.cloneAsInstance(
                                            ClassType.cloneForNarrowedTypedDictEntries(
                                                ClassType.cloneAsInstantiable(mappingSubtypeInfo.typedDict!),
                                                newNarrowedEntriesMap
                                            )
                                        );
                                        mappingSubtypeInfo.typedDict = mappingSubtypeInfo.subtype;
                                    }

                                    return narrowedValueType;
                                }
                            }
                        }

                        return undefined;
                    });

                    if (isNever(valueType)) {
                        isPlausibleMatch = false;
                    }
                }
            } else if (mappingSubtypeInfo.dictTypeArgs) {
                if (mappingEntry.nodeType === ParseNodeType.PatternMappingKeyEntry) {
                    const narrowedKeyType = narrowTypeBasedOnPattern(
                        evaluator,
                        mappingSubtypeInfo.dictTypeArgs.key,
                        mappingEntry.d.keyPattern,
                        isPositiveTest
                    );
                    const narrowedValueType = narrowTypeBasedOnPattern(
                        evaluator,
                        mappingSubtypeInfo.dictTypeArgs.value,
                        mappingEntry.d.valuePattern,
                        isPositiveTest
                    );
                    if (isNever(narrowedKeyType) || isNever(narrowedValueType)) {
                        isPlausibleMatch = false;
                    }
                }
            }
        });

        return isPlausibleMatch;
    });

    return combineTypes(mappingInfo.map((entry) => entry.subtype));
}

// Looks up the "__match_args__" class member to determine the names of
// the attributes used for class pattern matching.
function getPositionalMatchArgNames(evaluator: TypeEvaluator, type: ClassType): string[] {
    const matchArgsMemberInfo = lookUpClassMember(type, '__match_args__');
    if (matchArgsMemberInfo) {
        const matchArgsType = evaluator.getTypeOfMember(matchArgsMemberInfo);
        if (
            isClassInstance(matchArgsType) &&
            isTupleClass(matchArgsType) &&
            !isUnboundedTupleClass(matchArgsType) &&
            matchArgsType.priv.tupleTypeArgs
        ) {
            const tupleArgs = matchArgsType.priv.tupleTypeArgs;

            // Are all the args string literals?
            if (
                tupleArgs.every(
                    (arg) =>
                        isClassInstance(arg.type) && ClassType.isBuiltIn(arg.type, 'str') && isLiteralType(arg.type)
                )
            ) {
                return tupleArgs.map((arg) => (arg.type as ClassType).priv.literalValue as string);
            }
        }
    }

    return [];
}

function narrowTypeBasedOnLiteralPattern(
    evaluator: TypeEvaluator,
    type: Type,
    pattern: PatternLiteralNode,
    isPositiveTest: boolean
): Type {
    const literalType = evaluator.getTypeOfExpression(pattern.d.expr).type;

    if (!isPositiveTest) {
        return evaluator.mapSubtypesExpandTypeVars(type, /* options */ undefined, (expandedSubtype) => {
            if (
                isClassInstance(literalType) &&
                isLiteralType(literalType) &&
                isClassInstance(expandedSubtype) &&
                isLiteralType(expandedSubtype) &&
                evaluator.assignType(literalType, expandedSubtype)
            ) {
                return undefined;
            }

            if (isNoneInstance(expandedSubtype) && isNoneInstance(literalType)) {
                return undefined;
            }

            // Narrow a non-literal bool based on a literal bool pattern.
            if (
                isClassInstance(expandedSubtype) &&
                ClassType.isBuiltIn(expandedSubtype, 'bool') &&
                expandedSubtype.priv.literalValue === undefined &&
                isClassInstance(literalType) &&
                ClassType.isBuiltIn(literalType, 'bool') &&
                literalType.priv.literalValue !== undefined
            ) {
                return ClassType.cloneWithLiteral(literalType, !(literalType.priv.literalValue as boolean));
            }

            return expandedSubtype;
        });
    }

    return evaluator.mapSubtypesExpandTypeVars(type, /* options */ undefined, (expandedSubtype, unexpandedSubtype) => {
        if (evaluator.assignType(expandedSubtype, literalType)) {
            return literalType;
        }

        // See if the subtype is a subclass of the literal's class. For example,
        // if it's a literal str, see if the subtype is subclass of str.
        if (
            isClassInstance(literalType) &&
            isLiteralType(literalType) &&
            isClassInstance(expandedSubtype) &&
            !isLiteralType(expandedSubtype)
        ) {
            if (evaluator.assignType(ClassType.cloneWithLiteral(literalType, /* value */ undefined), expandedSubtype)) {
                return expandedSubtype;
            }
        }
        return undefined;
    });
}

function narrowTypeBasedOnClassPattern(
    evaluator: TypeEvaluator,
    type: Type,
    pattern: PatternClassNode,
    isPositiveTest: boolean
): Type {
    let exprType = evaluator.getTypeOfExpression(pattern.d.className, EvalFlags.CallBaseDefaults).type;

    // If this is a class (but not a type alias that refers to a class),
    // specialize it with Unknown type arguments.
    if (isClass(exprType) && !exprType.props?.typeAliasInfo) {
        exprType = ClassType.cloneRemoveTypePromotions(exprType);
        exprType = specializeWithUnknownTypeArgs(exprType, evaluator.getTupleClassType());
    }

    // Are there any positional arguments? If so, try to get the mappings for
    // these arguments by fetching the __match_args__ symbol from the class.
    let positionalArgNames: string[] = [];
    if (pattern.d.args.some((arg) => !arg.d.name) && isInstantiableClass(exprType)) {
        positionalArgNames = getPositionalMatchArgNames(evaluator, exprType);
    }

    if (!isPositiveTest) {
        // Don't attempt to narrow if the class type is a more complex type (e.g. a TypeVar or union).
        if (!isInstantiableClass(exprType)) {
            return type;
        }

        let classType = exprType;

        if (classType.shared.typeParams.length > 0) {
            classType = ClassType.specialize(classType, /* typeArgs */ undefined);
        }

        const classInstance = ClassType.cloneAsInstance(classType);
        const isPatternMetaclass = isMetaclassInstance(classInstance);

        return evaluator.mapSubtypesExpandTypeVars(
            type,
            {
                expandCallback: (type) => evaluator.expandPromotionTypes(pattern, type),
            },
            (subjectSubtypeExpanded, subjectSubtypeUnexpanded) => {
                // Handle the case where the class pattern references type() or a subtype thereof
                // and the subject type is an instantiable class itself.
                if (isPatternMetaclass && isInstantiableClass(subjectSubtypeExpanded)) {
                    const metaclass = subjectSubtypeExpanded.shared.effectiveMetaclass ?? UnknownType.create();
                    if (isInstantiableClass(classType) && evaluator.assignType(classType, metaclass)) {
                        return undefined;
                    }

                    return subjectSubtypeExpanded;
                }

                // Handle Callable specially.
                if (
                    !isAnyOrUnknown(subjectSubtypeExpanded) &&
                    isInstantiableClass(classType) &&
                    ClassType.isBuiltIn(classType, 'Callable')
                ) {
                    if (evaluator.assignType(getUnknownTypeForCallable(), subjectSubtypeExpanded)) {
                        return undefined;
                    }
                }

                if (!isNoneInstance(subjectSubtypeExpanded) && !isClassInstance(subjectSubtypeExpanded)) {
                    return subjectSubtypeUnexpanded;
                }

                // Handle NoneType specially.
                if (
                    isNoneInstance(subjectSubtypeExpanded) &&
                    isInstantiableClass(classType) &&
                    ClassType.isBuiltIn(classType, 'NoneType')
                ) {
                    return undefined;
                }

                if (!evaluator.assignType(classInstance, subjectSubtypeExpanded)) {
                    return subjectSubtypeExpanded;
                }

                if (pattern.d.args.length === 0) {
                    if (isClass(classInstance) && isClass(subjectSubtypeExpanded)) {
                        // We know that this match will always succeed, so we can
                        // eliminate this subtype.
                        return undefined;
                    }

                    return subjectSubtypeExpanded;
                }

                // We might be able to narrow further based on arguments, but only
                // if the types match exactly, the subject subtype is a final class (and
                // therefore cannot be subclassed), or the pattern class is a protocol
                // class.
                if (!evaluator.assignType(subjectSubtypeExpanded, classInstance)) {
                    if (
                        isClass(subjectSubtypeExpanded) &&
                        !ClassType.isFinal(subjectSubtypeExpanded) &&
                        !ClassType.isProtocolClass(classInstance)
                    ) {
                        return subjectSubtypeExpanded;
                    }
                }

                for (let index = 0; index < pattern.d.args.length; index++) {
                    const narrowedArgType = narrowTypeOfClassPatternArg(
                        evaluator,
                        pattern.d.args[index],
                        index,
                        positionalArgNames,
                        subjectSubtypeExpanded,
                        isPositiveTest
                    );

                    if (!isNever(narrowedArgType)) {
                        return subjectSubtypeUnexpanded;
                    }
                }

                // We've completely eliminated the type based on the arguments.
                return undefined;
            }
        );
    }

    if (!TypeBase.isInstantiable(exprType) && !isNever(exprType)) {
        evaluator.addDiagnostic(
            DiagnosticRule.reportGeneralTypeIssues,
            LocAddendum.typeNotClass().format({ type: evaluator.printType(exprType) }),
            pattern.d.className
        );

        return isPositiveTest ? UnknownType.create() : type;
    } else if (isInstantiableClass(exprType)) {
        if (ClassType.isProtocolClass(exprType) && !ClassType.isRuntimeCheckable(exprType)) {
            evaluator.addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocAddendum.protocolRequiresRuntimeCheckable(),
                pattern.d.className
            );

            return isPositiveTest ? UnknownType.create() : type;
        } else if (ClassType.isTypedDictClass(exprType)) {
            evaluator.addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.typedDictInClassPattern(),
                pattern.d.className
            );

            return isPositiveTest ? UnknownType.create() : type;
        }
    }

    return evaluator.mapSubtypesExpandTypeVars(
        exprType,
        /* options */ undefined,
        (expandedSubtype, unexpandedSubtype) => {
            if (isAnyOrUnknown(expandedSubtype)) {
                return unexpandedSubtype;
            }

            if (isInstantiableClass(expandedSubtype)) {
                const expandedSubtypeInstance = convertToInstance(expandedSubtype);
                const isPatternMetaclass = isMetaclassInstance(expandedSubtypeInstance);

                return evaluator.mapSubtypesExpandTypeVars(type, /* options */ undefined, (subjectSubtypeExpanded) => {
                    if (isAnyOrUnknown(subjectSubtypeExpanded)) {
                        if (isInstantiableClass(expandedSubtype) && ClassType.isBuiltIn(expandedSubtype, 'Callable')) {
                            // Convert to an unknown callable type.
                            const unknownCallable = FunctionType.createSynthesizedInstance(
                                '',
                                FunctionTypeFlags.GradualCallableForm
                            );
                            FunctionType.addDefaultParams(
                                unknownCallable,
                                /* useUnknown */ isUnknown(subjectSubtypeExpanded)
                            );
                            unknownCallable.shared.declaredReturnType = subjectSubtypeExpanded;
                            return unknownCallable;
                        }

                        return convertToInstance(unexpandedSubtype);
                    }

                    // Handle the case where the class pattern references type() or a subtype thereof
                    // and the subject type is a class itself.
                    if (isPatternMetaclass && isInstantiableClass(subjectSubtypeExpanded)) {
                        const metaclass = subjectSubtypeExpanded.shared.effectiveMetaclass ?? UnknownType.create();
                        if (
                            evaluator.assignType(expandedSubtype, metaclass) ||
                            evaluator.assignType(metaclass, expandedSubtype)
                        ) {
                            return subjectSubtypeExpanded;
                        }

                        return undefined;
                    }

                    // Handle NoneType specially.
                    if (
                        isNoneInstance(subjectSubtypeExpanded) &&
                        isInstantiableClass(expandedSubtype) &&
                        ClassType.isBuiltIn(expandedSubtype, 'NoneType')
                    ) {
                        return subjectSubtypeExpanded;
                    }

                    // Handle Callable specially.
                    if (isInstantiableClass(expandedSubtype) && ClassType.isBuiltIn(expandedSubtype, 'Callable')) {
                        const callableType = getUnknownTypeForCallable();

                        if (evaluator.assignType(callableType, subjectSubtypeExpanded)) {
                            return subjectSubtypeExpanded;
                        }

                        const subjObjType = convertToInstance(subjectSubtypeExpanded);
                        if (evaluator.assignType(subjObjType, callableType)) {
                            return callableType;
                        }

                        return undefined;
                    }

                    if (isClassInstance(subjectSubtypeExpanded)) {
                        let resultType: Type;

                        if (evaluator.assignType(ClassType.cloneAsInstance(expandedSubtype), subjectSubtypeExpanded)) {
                            resultType = subjectSubtypeExpanded;
                        } else if (
                            evaluator.assignType(subjectSubtypeExpanded, ClassType.cloneAsInstance(expandedSubtype))
                        ) {
                            resultType = addConditionToType(
                                convertToInstance(unexpandedSubtype),
                                getTypeCondition(subjectSubtypeExpanded)
                            );

                            // Try to retain the type arguments for the pattern class type.
                            if (isInstantiableClass(unexpandedSubtype) && isClassInstance(subjectSubtypeExpanded)) {
                                if (
                                    ClassType.isSpecialBuiltIn(unexpandedSubtype) ||
                                    unexpandedSubtype.shared.typeParams.length > 0
                                ) {
                                    const constraints = new ConstraintTracker();
                                    const unspecializedMatchType = ClassType.specialize(
                                        unexpandedSubtype,
                                        /* typeArgs */ undefined
                                    );

                                    const matchTypeInstance = ClassType.cloneAsInstance(unspecializedMatchType);
                                    if (
                                        addConstraintsForExpectedType(
                                            evaluator,
                                            matchTypeInstance,
                                            subjectSubtypeExpanded,
                                            constraints,
                                            /* liveTypeVarScopes */ undefined,
                                            /* usageOffset */ undefined
                                        )
                                    ) {
                                        resultType = evaluator.solveAndApplyConstraints(
                                            matchTypeInstance,
                                            constraints,
                                            {
                                                replaceUnsolved: {
                                                    scopeIds: getTypeVarScopeIds(unexpandedSubtype),
                                                    tupleClassType: evaluator.getTupleClassType(),
                                                },
                                            }
                                        ) as ClassType;
                                    }
                                }
                            }
                        } else {
                            return undefined;
                        }

                        // Are there any positional arguments? If so, try to get the mappings for
                        // these arguments by fetching the __match_args__ symbol from the class.
                        let positionalArgNames: string[] = [];
                        if (pattern.d.args.some((arg) => !arg.d.name)) {
                            positionalArgNames = getPositionalMatchArgNames(evaluator, expandedSubtype);
                        }

                        let isMatchValid = true;
                        pattern.d.args.forEach((arg, index) => {
                            // Narrow the arg pattern. It's possible that the actual type of the object
                            // being matched is a subtype of the resultType, so it might contain additional
                            // attributes that we don't know about.
                            const narrowedArgType = narrowTypeOfClassPatternArg(
                                evaluator,
                                arg,
                                index,
                                positionalArgNames,
                                resultType,
                                isPositiveTest
                            );

                            if (isNever(narrowedArgType)) {
                                isMatchValid = false;
                            }
                        });

                        if (isMatchValid) {
                            return resultType;
                        }
                    }

                    return undefined;
                });
            }

            return undefined;
        }
    );
}

// Some built-in classes are treated as special cases for the class pattern
// if a positional argument is used.
function isClassSpecialCaseForClassPattern(classType: ClassType) {
    if (classPatternSpecialCases.some((className) => classType.shared.fullName === className)) {
        return true;
    }

    // If the class supplies its own `__match_args__`, it's not a special case.
    const matchArgsMemberInfo = lookUpClassMember(classType, '__match_args__');
    if (matchArgsMemberInfo) {
        return false;
    }

    // If the class derives from a built-in class, it is considered a special case.
    for (const mroClass of classType.shared.mro) {
        if (isClass(mroClass) && classPatternSpecialCases.some((className) => mroClass.shared.fullName === className)) {
            return true;
        }
    }

    return false;
}

// Narrows the pattern provided for a class pattern argument.
function narrowTypeOfClassPatternArg(
    evaluator: TypeEvaluator,
    arg: PatternClassArgumentNode,
    argIndex: number,
    positionalArgNames: string[],
    matchType: Type,
    isPositiveTest: boolean
) {
    let argName: string | undefined;

    if (arg.d.name) {
        argName = arg.d.name.d.value;
    } else if (argIndex < positionalArgNames.length) {
        argName = positionalArgNames[argIndex];
    }

    if (isAnyOrUnknown(matchType)) {
        return matchType;
    }

    if (!isClass(matchType)) {
        return UnknownType.create();
    }

    // According to PEP 634, some built-in types use themselves as the subject
    // for the first positional argument to a class pattern. Although the PEP does
    // state so explicitly, this is true of subclasses of these built-in classes
    // if the subclass doesn't define its own __match_args__.
    let useSelfForPattern = false;
    let selfForPatternType = matchType;

    if (!arg.d.name && isClass(matchType) && argIndex === 0) {
        if (isClassSpecialCaseForClassPattern(matchType)) {
            useSelfForPattern = true;
        } else if (positionalArgNames.length === 0) {
            matchType.shared.mro.forEach((mroClass) => {
                if (isClass(mroClass) && isClassSpecialCaseForClassPattern(mroClass)) {
                    selfForPatternType = mroClass;
                    useSelfForPattern = true;
                }
            });
        }
    }

    let argType: Type | undefined;

    if (useSelfForPattern) {
        argType = ClassType.cloneAsInstance(selfForPatternType);
    } else {
        if (argName) {
            argType = evaluator.useSpeculativeMode(arg, () =>
                // We need to apply a rather ugly cast here because PatternClassArgumentNode is
                // not technically an ExpressionNode, but it is OK to use it in this context.
                evaluator.getTypeOfBoundMember(
                    arg as any as ExpressionNode,
                    ClassType.cloneAsInstance(matchType),
                    argName!
                )
            )?.type;
        }

        if (!argType) {
            if (!isPositiveTest) {
                return matchType;
            }

            // If the class type in question is "final", we know that no additional
            // attributes can be added by subtypes, so it's safe to eliminate this
            // type entirely.
            if (ClassType.isFinal(matchType)) {
                return NeverType.createNever();
            }

            argType = UnknownType.create();
        }
    }

    return narrowTypeBasedOnPattern(evaluator, argType, arg.d.pattern, isPositiveTest);
}

function narrowTypeBasedOnValuePattern(
    evaluator: TypeEvaluator,
    subjectType: Type,
    pattern: PatternValueNode,
    isPositiveTest: boolean
): Type {
    const valueType = evaluator.getTypeOfExpression(pattern.d.expr).type;
    const narrowedSubtypes: Type[] = [];

    evaluator.mapSubtypesExpandTypeVars(
        valueType,
        /* options */ undefined,
        (valueSubtypeExpanded, valueSubtypeUnexpanded) => {
            narrowedSubtypes.push(
                evaluator.mapSubtypesExpandTypeVars(
                    subjectType,
                    { conditionFilter: getTypeCondition(valueSubtypeExpanded) },
                    (subjectSubtypeExpanded) => {
                        // If this is a negative test, see if it's an enum value.
                        if (!isPositiveTest) {
                            if (
                                isClassInstance(subjectSubtypeExpanded) &&
                                isClassInstance(valueSubtypeExpanded) &&
                                isSameWithoutLiteralValue(subjectSubtypeExpanded, valueSubtypeExpanded)
                            ) {
                                if (!isLiteralType(subjectSubtypeExpanded) && isLiteralType(valueSubtypeExpanded)) {
                                    const expandedLiterals = enumerateLiteralsForType(
                                        evaluator,
                                        subjectSubtypeExpanded
                                    );
                                    if (expandedLiterals) {
                                        return combineTypes(
                                            expandedLiterals.filter(
                                                (enumType) =>
                                                    !ClassType.isLiteralValueSame(valueSubtypeExpanded, enumType)
                                            )
                                        );
                                    }
                                }

                                if (
                                    isLiteralType(subjectSubtypeExpanded) &&
                                    ClassType.isLiteralValueSame(valueSubtypeExpanded, subjectSubtypeExpanded)
                                ) {
                                    return undefined;
                                }
                            }

                            return subjectSubtypeExpanded;
                        }

                        if (isNever(valueSubtypeExpanded) || isNever(subjectSubtypeExpanded)) {
                            return NeverType.createNever();
                        }

                        if (isAnyOrUnknown(valueSubtypeExpanded) || isAnyOrUnknown(subjectSubtypeExpanded)) {
                            // If either type is "Unknown" (versus Any), propagate the Unknown.
                            return isUnknown(valueSubtypeExpanded) || isUnknown(subjectSubtypeExpanded)
                                ? preserveUnknown(valueSubtypeExpanded, subjectSubtypeExpanded)
                                : AnyType.create();
                        }

                        // If both types are literals, we can compare the literal values directly.
                        if (
                            isClassInstance(subjectSubtypeExpanded) &&
                            isLiteralType(subjectSubtypeExpanded) &&
                            isClassInstance(valueSubtypeExpanded) &&
                            isLiteralType(valueSubtypeExpanded)
                        ) {
                            return isSameWithoutLiteralValue(subjectSubtypeExpanded, valueSubtypeExpanded) &&
                                ClassType.isLiteralValueSame(valueSubtypeExpanded, subjectSubtypeExpanded)
                                ? valueSubtypeUnexpanded
                                : undefined;
                        }

                        // Determine if assignment is supported for this combination of
                        // value subtype and matching subtype.
                        const returnType = evaluator.useSpeculativeMode(pattern.d.expr, () =>
                            evaluator.getTypeOfMagicMethodCall(
                                valueSubtypeExpanded,
                                '__eq__',
                                [{ type: subjectSubtypeExpanded }],
                                pattern.d.expr,
                                /* expectedType */ undefined
                            )
                        );

                        return returnType ? valueSubtypeUnexpanded : undefined;
                    }
                )
            );

            return undefined;
        }
    );

    return combineTypes(narrowedSubtypes);
}

// Returns information about all subtypes that match the definition of a "mapping" as
// specified in PEP 634.
function getMappingPatternInfo(evaluator: TypeEvaluator, type: Type, node: PatternAtomNode): MappingPatternInfo[] {
    const mappingInfo: MappingPatternInfo[] = [];

    doForEachSubtype(type, (subtype) => {
        const concreteSubtype = evaluator.makeTopLevelTypeVarsConcrete(subtype);

        if (isAnyOrUnknown(concreteSubtype)) {
            mappingInfo.push({
                subtype,
                isDefinitelyMapping: false,
                isDefinitelyNotMapping: false,
                dictTypeArgs: {
                    key: concreteSubtype,
                    value: concreteSubtype,
                },
            });
            return;
        }

        if (isClassInstance(concreteSubtype)) {
            // Is it a TypedDict?
            if (ClassType.isTypedDictClass(concreteSubtype)) {
                mappingInfo.push({
                    subtype,
                    isDefinitelyMapping: true,
                    isDefinitelyNotMapping: false,
                    typedDict: concreteSubtype,
                });
                return;
            }

            const mappingType = evaluator.getTypingType(node, 'Mapping');
            if (!mappingType || !isInstantiableClass(mappingType)) {
                return;
            }
            const mappingObject = ClassType.cloneAsInstance(mappingType);

            // Is it a subtype of Mapping?
            const constraints = new ConstraintTracker();
            if (evaluator.assignType(mappingObject, subtype, /* diag */ undefined, constraints)) {
                const specializedMapping = evaluator.solveAndApplyConstraints(mappingObject, constraints) as ClassType;

                if (specializedMapping.priv.typeArgs && specializedMapping.priv.typeArgs.length >= 2) {
                    mappingInfo.push({
                        subtype,
                        isDefinitelyMapping: true,
                        isDefinitelyNotMapping: false,
                        dictTypeArgs: {
                            key: specializedMapping.priv.typeArgs[0],
                            value: specializedMapping.priv.typeArgs[1],
                        },
                    });
                }

                return;
            }

            // Is it a superclass of Mapping?
            if (evaluator.assignType(subtype, mappingObject)) {
                mappingInfo.push({
                    subtype,
                    isDefinitelyMapping: false,
                    isDefinitelyNotMapping: false,
                    dictTypeArgs: {
                        key: UnknownType.create(),
                        value: UnknownType.create(),
                    },
                });
                return;
            }

            mappingInfo.push({
                subtype,
                isDefinitelyMapping: false,
                isDefinitelyNotMapping: true,
            });
        }
    });

    return mappingInfo;
}

// Returns information about all subtypes that match the definition of a "sequence" as
// specified in PEP 634. For types that are not sequences or sequences that are not of
// sufficient length, it sets definiteNoMatch to true.
function getSequencePatternInfo(
    evaluator: TypeEvaluator,
    pattern: PatternSequenceNode,
    type: Type
): SequencePatternInfo[] {
    const patternEntryCount = pattern.d.entries.length;
    const patternStarEntryIndex = pattern.d.starEntryIndex;
    const sequenceInfo: SequencePatternInfo[] = [];

    doForEachSubtype(type, (subtype) => {
        const concreteSubtype = evaluator.makeTopLevelTypeVarsConcrete(subtype);
        let mroClassToSpecialize: ClassType | undefined;

        if (isClassInstance(concreteSubtype)) {
            for (const mroClass of concreteSubtype.shared.mro) {
                if (!isInstantiableClass(mroClass)) {
                    break;
                }

                // Strings, bytes, and bytearray are explicitly excluded.
                if (
                    ClassType.isBuiltIn(mroClass, 'str') ||
                    ClassType.isBuiltIn(mroClass, 'bytes') ||
                    ClassType.isBuiltIn(mroClass, 'bytearray')
                ) {
                    // This is definitely not a match.
                    sequenceInfo.push({
                        subtype,
                        entryTypes: [],
                        isIndeterminateLength: true,
                        isDefiniteNoMatch: true,
                    });
                    return;
                }

                if (ClassType.isBuiltIn(mroClass, 'Sequence')) {
                    mroClassToSpecialize = mroClass;
                    break;
                }

                if (isTupleClass(mroClass)) {
                    mroClassToSpecialize = mroClass;
                    break;
                }
            }

            if (mroClassToSpecialize) {
                const specializedSequence = partiallySpecializeType(
                    mroClassToSpecialize,
                    concreteSubtype,
                    evaluator.getTypeClassType()
                ) as ClassType;

                if (isTupleClass(specializedSequence)) {
                    const typeArgs = specializedSequence.priv.tupleTypeArgs ?? [
                        { type: UnknownType.create(), isUnbounded: true },
                    ];

                    const tupleIndeterminateIndex = typeArgs.findIndex(
                        (t) => t.isUnbounded || isUnpackedTypeVarTuple(t.type) || isUnpackedTypeVar(t.type)
                    );

                    let tupleDeterminateEntryCount = typeArgs.length;

                    // If the tuple contains an indeterminate entry, expand or remove that
                    // entry to match the length of the pattern if possible.
                    if (tupleIndeterminateIndex >= 0) {
                        tupleDeterminateEntryCount--;

                        while (typeArgs.length < patternEntryCount) {
                            typeArgs.splice(tupleIndeterminateIndex, 0, typeArgs[tupleIndeterminateIndex]);
                        }

                        if (typeArgs.length > patternEntryCount && patternStarEntryIndex === undefined) {
                            typeArgs.splice(tupleIndeterminateIndex, 1);
                        }
                    }

                    // If the pattern contains a star entry and there are too many entries
                    // in the tuple, we can collapse some of them into the star entry.
                    if (
                        patternStarEntryIndex !== undefined &&
                        typeArgs.length >= 2 &&
                        typeArgs.length > patternEntryCount
                    ) {
                        const entriesToCombine = typeArgs.length - patternEntryCount + 1;
                        const removedEntries = typeArgs.splice(patternStarEntryIndex, entriesToCombine);
                        typeArgs.splice(patternStarEntryIndex, 0, {
                            type: combineTypes(removedEntries.map((t) => t.type)),
                            isUnbounded: removedEntries.every(
                                (t) => t.isUnbounded || isUnpackedTypeVarTuple(t.type) || isUnpackedTypeVar(t.type)
                            ),
                        });
                    }

                    if (typeArgs.length === patternEntryCount) {
                        let isDefiniteNoMatch = false;
                        let isPotentialNoMatch = tupleIndeterminateIndex >= 0;

                        // If the pattern includes a "star entry" and the tuple includes an
                        // indeterminate-length entry that aligns to the star entry, we can
                        // assume it will always match.
                        if (
                            patternStarEntryIndex !== undefined &&
                            tupleIndeterminateIndex >= 0 &&
                            pattern.d.entries.length - 1 === tupleDeterminateEntryCount &&
                            patternStarEntryIndex === tupleIndeterminateIndex
                        ) {
                            isPotentialNoMatch = false;
                        }

                        for (let i = 0; i < patternEntryCount; i++) {
                            const subPattern = pattern.d.entries[i];
                            const typeArg = typeArgs[i].type;
                            const narrowedType = narrowTypeBasedOnPattern(
                                evaluator,
                                typeArg,
                                subPattern,
                                /* isPositiveTest */ true
                            );

                            if (isNever(narrowedType)) {
                                isDefiniteNoMatch = true;
                            }
                        }

                        sequenceInfo.push({
                            subtype,
                            entryTypes: isDefiniteNoMatch ? [] : typeArgs.map((t) => t.type),
                            isIndeterminateLength: false,
                            isTuple: true,
                            isUnboundedTuple: tupleIndeterminateIndex >= 0,
                            isDefiniteNoMatch,
                            isPotentialNoMatch,
                        });
                        return;
                    }

                    // If the pattern contains a star entry and the pattern associated with
                    // the star entry is unbounded, we can remove it completely under the
                    // assumption that the star pattern will capture nothing.
                    if (patternStarEntryIndex !== undefined) {
                        let tryMatchStarSequence = false;

                        if (typeArgs.length === patternEntryCount - 1) {
                            tryMatchStarSequence = true;
                            typeArgs.splice(patternStarEntryIndex, 0, {
                                type: AnyType.create(),
                                isUnbounded: true,
                            });
                        } else if (
                            typeArgs.length === patternEntryCount &&
                            typeArgs[patternStarEntryIndex].isUnbounded
                        ) {
                            tryMatchStarSequence = true;
                        }

                        if (tryMatchStarSequence) {
                            let isDefiniteNoMatch = false;

                            for (let i = 0; i < patternEntryCount; i++) {
                                if (i === patternStarEntryIndex) {
                                    continue;
                                }

                                const subPattern = pattern.d.entries[i];
                                const typeArg = typeArgs[i].type;
                                const narrowedType = narrowTypeBasedOnPattern(
                                    evaluator,
                                    typeArg,
                                    subPattern,
                                    /* isPositiveTest */ true
                                );

                                if (isNever(narrowedType)) {
                                    isDefiniteNoMatch = true;
                                }
                            }

                            sequenceInfo.push({
                                subtype,
                                entryTypes: isDefiniteNoMatch ? [] : typeArgs.map((t) => t.type),
                                isIndeterminateLength: false,
                                isTuple: true,
                                isUnboundedTuple: tupleIndeterminateIndex >= 0,
                                isDefiniteNoMatch,
                            });
                            return;
                        }
                    }
                } else {
                    sequenceInfo.push({
                        subtype,
                        entryTypes: [
                            specializedSequence.priv.typeArgs && specializedSequence.priv.typeArgs.length > 0
                                ? specializedSequence.priv.typeArgs[0]
                                : UnknownType.create(),
                        ],
                        isIndeterminateLength: true,
                        isDefiniteNoMatch: false,
                    });
                    return;
                }
            }
        }

        if (!mroClassToSpecialize) {
            const sequenceType = evaluator.getTypingType(pattern, 'Sequence');

            if (sequenceType && isInstantiableClass(sequenceType)) {
                const sequenceObject = ClassType.cloneAsInstance(sequenceType);

                // Is it a subtype of Sequence?
                const constraints = new ConstraintTracker();
                if (evaluator.assignType(sequenceObject, subtype, /* diag */ undefined, constraints)) {
                    const specializedSequence = evaluator.solveAndApplyConstraints(
                        sequenceObject,
                        constraints
                    ) as ClassType;

                    if (specializedSequence.priv.typeArgs && specializedSequence.priv.typeArgs.length > 0) {
                        sequenceInfo.push({
                            subtype,
                            entryTypes: [specializedSequence.priv.typeArgs[0]],
                            isIndeterminateLength: true,
                            isDefiniteNoMatch: false,
                            isPotentialNoMatch: false,
                        });
                        return;
                    }
                }

                // If it wasn't a subtype of Sequence, see if it's a supertype.
                const sequenceConstraints = new ConstraintTracker();
                if (
                    addConstraintsForExpectedType(
                        evaluator,
                        ClassType.cloneAsInstance(sequenceType),
                        subtype,
                        sequenceConstraints,
                        getTypeVarScopesForNode(pattern),
                        pattern.start
                    )
                ) {
                    const specializedSequence = evaluator.solveAndApplyConstraints(
                        ClassType.cloneAsInstantiable(sequenceType),
                        sequenceConstraints
                    ) as ClassType;

                    if (specializedSequence.priv.typeArgs && specializedSequence.priv.typeArgs.length > 0) {
                        sequenceInfo.push({
                            subtype,
                            entryTypes: [specializedSequence.priv.typeArgs[0]],
                            isIndeterminateLength: true,
                            isDefiniteNoMatch: false,
                            isPotentialNoMatch: true,
                        });
                        return;
                    }
                }

                if (
                    evaluator.assignType(
                        subtype,
                        ClassType.specialize(ClassType.cloneAsInstance(sequenceType), [UnknownType.create()])
                    )
                ) {
                    sequenceInfo.push({
                        subtype,
                        entryTypes: [UnknownType.create()],
                        isIndeterminateLength: true,
                        isDefiniteNoMatch: false,
                        isPotentialNoMatch: true,
                    });
                    return;
                }
            }
        }

        // Push an entry that indicates that this is definitely not a match.
        sequenceInfo.push({
            subtype,
            entryTypes: [],
            isIndeterminateLength: true,
            isDefiniteNoMatch: true,
        });
    });

    return sequenceInfo;
}

function getTypeOfPatternSequenceEntry(
    evaluator: TypeEvaluator,
    node: ParseNode,
    sequenceInfo: SequencePatternInfo,
    entryIndex: number,
    entryCount: number,
    starEntryIndex: number | undefined,
    unpackStarEntry: boolean
): Type {
    if (sequenceInfo.isIndeterminateLength) {
        let entryType = sequenceInfo.entryTypes[0];

        if (!unpackStarEntry && entryIndex === starEntryIndex && !isNever(entryType)) {
            entryType = wrapTypeInList(evaluator, node, entryType);
        }

        return entryType;
    }

    if (starEntryIndex === undefined || entryIndex < starEntryIndex) {
        return sequenceInfo.entryTypes[entryIndex];
    }

    if (entryIndex === starEntryIndex) {
        // Create a list out of the entries that map to the star entry.
        // Note that we strip literal types here.
        const starEntryTypes = sequenceInfo.entryTypes
            .slice(starEntryIndex, starEntryIndex + sequenceInfo.entryTypes.length - entryCount + 1)
            .map((type) => {
                // If this is a TypeVarTuple, there's not much we can say about
                // its type other than it's "Unknown". We could evaluate it as an
                // "object", but that will cause problems given that this type will
                // be wrapped in a "list" below, and lists are invariant.
                if (isTypeVarTuple(type) && !type.priv.isInUnion) {
                    return UnknownType.create();
                }

                return evaluator.stripLiteralValue(type);
            });

        let entryType = combineTypes(starEntryTypes);

        if (!unpackStarEntry) {
            entryType = wrapTypeInList(evaluator, node, entryType);
        }

        return entryType;
    }

    // The entry index is past the index of the star entry, so we need
    // to index from the end of the sequence rather than the start.
    const itemIndex = sequenceInfo.entryTypes.length - (entryCount - entryIndex);
    assert(itemIndex >= 0 && itemIndex < sequenceInfo.entryTypes.length);

    return sequenceInfo.entryTypes[itemIndex];
}

// Recursively assigns the specified type to the pattern and any capture
// nodes within it. It returns the narrowed type, as dictated by the pattern.
export function assignTypeToPatternTargets(
    evaluator: TypeEvaluator,
    type: Type,
    isTypeIncomplete: boolean,
    pattern: PatternAtomNode
): Type {
    // Further narrow the type based on this pattern.
    const narrowedType = narrowTypeBasedOnPattern(evaluator, type, pattern, /* positiveTest */ true);

    switch (pattern.nodeType) {
        case ParseNodeType.PatternSequence: {
            const sequenceInfo = getSequencePatternInfo(evaluator, pattern, narrowedType).filter(
                (seqInfo) => !seqInfo.isDefiniteNoMatch
            );

            pattern.d.entries.forEach((entry, index) => {
                const entryType = combineTypes(
                    sequenceInfo.map((info) =>
                        getTypeOfPatternSequenceEntry(
                            evaluator,
                            pattern,
                            info,
                            index,
                            pattern.d.entries.length,
                            pattern.d.starEntryIndex,
                            /* unpackStarEntry */ false
                        )
                    )
                );

                assignTypeToPatternTargets(evaluator, entryType, isTypeIncomplete, entry);
            });
            break;
        }

        case ParseNodeType.PatternAs: {
            if (pattern.d.target) {
                evaluator.assignTypeToExpression(
                    pattern.d.target,
                    { type: narrowedType, isIncomplete: isTypeIncomplete },
                    pattern.d.target
                );
            }

            let runningNarrowedType = narrowedType;
            pattern.d.orPatterns.forEach((orPattern) => {
                assignTypeToPatternTargets(evaluator, runningNarrowedType, isTypeIncomplete, orPattern);

                // OR patterns are evaluated left to right, so we can narrow
                // the type as we go.
                runningNarrowedType = narrowTypeBasedOnPattern(
                    evaluator,
                    runningNarrowedType,
                    orPattern,
                    /* positiveTest */ false
                );
            });
            break;
        }

        case ParseNodeType.PatternCapture: {
            if (pattern.d.isWildcard) {
                if (!isTypeIncomplete) {
                    if (isUnknown(narrowedType)) {
                        evaluator.addDiagnostic(
                            DiagnosticRule.reportUnknownVariableType,
                            LocMessage.wildcardPatternTypeUnknown(),
                            pattern.d.target
                        );
                    } else if (isPartlyUnknown(narrowedType)) {
                        const diagAddendum = new DiagnosticAddendum();
                        diagAddendum.addMessage(
                            LocAddendum.typeOfSymbol().format({
                                name: '_',
                                type: evaluator.printType(narrowedType, { expandTypeAlias: true }),
                            })
                        );
                        evaluator.addDiagnostic(
                            DiagnosticRule.reportUnknownVariableType,
                            LocMessage.wildcardPatternTypePartiallyUnknown() + diagAddendum.getString(),
                            pattern.d.target
                        );
                    }
                }
            } else {
                evaluator.assignTypeToExpression(
                    pattern.d.target,
                    { type: narrowedType, isIncomplete: isTypeIncomplete },
                    pattern.d.target
                );
            }
            break;
        }

        case ParseNodeType.PatternMapping: {
            const mappingInfo = getMappingPatternInfo(evaluator, narrowedType, pattern);

            pattern.d.entries.forEach((mappingEntry) => {
                const keyTypes: Type[] = [];
                const valueTypes: Type[] = [];

                mappingInfo.forEach((mappingSubtypeInfo) => {
                    if (mappingSubtypeInfo.typedDict) {
                        if (mappingEntry.nodeType === ParseNodeType.PatternMappingKeyEntry) {
                            const keyType = narrowTypeBasedOnPattern(
                                evaluator,
                                evaluator.getBuiltInObject(pattern, 'str'),
                                mappingEntry.d.keyPattern,
                                /* isPositiveTest */ true
                            );
                            keyTypes.push(keyType);

                            doForEachSubtype(keyType, (keySubtype) => {
                                if (
                                    isClassInstance(keySubtype) &&
                                    ClassType.isBuiltIn(keySubtype, 'str') &&
                                    isLiteralType(keySubtype)
                                ) {
                                    const tdEntries = getTypedDictMembersForClass(
                                        evaluator,
                                        mappingSubtypeInfo.typedDict!
                                    );
                                    const valueInfo = tdEntries.knownItems.get(keySubtype.priv.literalValue as string);
                                    valueTypes.push(valueInfo ? valueInfo.valueType : UnknownType.create());
                                } else {
                                    valueTypes.push(UnknownType.create());
                                }
                            });
                        } else if (mappingEntry.nodeType === ParseNodeType.PatternMappingExpandEntry) {
                            keyTypes.push(evaluator.getBuiltInObject(pattern, 'str'));
                            valueTypes.push(evaluator.getObjectType());
                        }
                    } else if (mappingSubtypeInfo.dictTypeArgs) {
                        if (mappingEntry.nodeType === ParseNodeType.PatternMappingKeyEntry) {
                            const keyType = narrowTypeBasedOnPattern(
                                evaluator,
                                mappingSubtypeInfo.dictTypeArgs.key,
                                mappingEntry.d.keyPattern,
                                /* isPositiveTest */ true
                            );
                            keyTypes.push(keyType);
                            valueTypes.push(
                                narrowTypeBasedOnPattern(
                                    evaluator,
                                    mappingSubtypeInfo.dictTypeArgs.value,
                                    mappingEntry.d.valuePattern,
                                    /* isPositiveTest */ true
                                )
                            );
                        } else if (mappingEntry.nodeType === ParseNodeType.PatternMappingExpandEntry) {
                            keyTypes.push(mappingSubtypeInfo.dictTypeArgs.key);
                            valueTypes.push(mappingSubtypeInfo.dictTypeArgs.value);
                        }
                    }
                });

                const keyType = combineTypes(keyTypes);
                const valueType = combineTypes(valueTypes);

                if (mappingEntry.nodeType === ParseNodeType.PatternMappingKeyEntry) {
                    assignTypeToPatternTargets(evaluator, keyType, isTypeIncomplete, mappingEntry.d.keyPattern);
                    assignTypeToPatternTargets(evaluator, valueType, isTypeIncomplete, mappingEntry.d.valuePattern);
                } else if (mappingEntry.nodeType === ParseNodeType.PatternMappingExpandEntry) {
                    const dictClass = evaluator.getBuiltInType(pattern, 'dict');
                    const strType = evaluator.getBuiltInObject(pattern, 'str');
                    const dictType =
                        dictClass && isInstantiableClass(dictClass) && isClassInstance(strType)
                            ? ClassType.cloneAsInstance(ClassType.specialize(dictClass, [keyType, valueType]))
                            : UnknownType.create();
                    evaluator.assignTypeToExpression(
                        mappingEntry.d.target,
                        { type: dictType, isIncomplete: isTypeIncomplete },
                        mappingEntry.d.target
                    );
                }
            });
            break;
        }

        case ParseNodeType.PatternClass: {
            const argTypes: Type[][] = pattern.d.args.map((arg) => []);

            evaluator.mapSubtypesExpandTypeVars(narrowedType, /* options */ undefined, (expandedSubtype) => {
                if (isClassInstance(expandedSubtype)) {
                    doForEachSubtype(narrowedType, (subjectSubtype) => {
                        const concreteSubtype = evaluator.makeTopLevelTypeVarsConcrete(subjectSubtype);

                        if (isAnyOrUnknown(concreteSubtype)) {
                            pattern.d.args.forEach((arg, index) => {
                                argTypes[index].push(concreteSubtype);
                            });
                        } else if (isClassInstance(concreteSubtype)) {
                            // Are there any positional arguments? If so, try to get the mappings for
                            // these arguments by fetching the __match_args__ symbol from the class.
                            let positionalArgNames: string[] = [];
                            if (pattern.d.args.some((arg) => !arg.d.name)) {
                                positionalArgNames = getPositionalMatchArgNames(
                                    evaluator,
                                    ClassType.cloneAsInstantiable(expandedSubtype)
                                );
                            }

                            pattern.d.args.forEach((arg, index) => {
                                const narrowedArgType = narrowTypeOfClassPatternArg(
                                    evaluator,
                                    arg,
                                    index,
                                    positionalArgNames,
                                    ClassType.cloneAsInstantiable(expandedSubtype),
                                    /* isPositiveTest */ true
                                );
                                argTypes[index].push(narrowedArgType);
                            });
                        }
                    });
                } else {
                    pattern.d.args.forEach((arg, index) => {
                        argTypes[index].push(UnknownType.create());
                    });
                }

                return undefined;
            });

            pattern.d.args.forEach((arg, index) => {
                assignTypeToPatternTargets(evaluator, combineTypes(argTypes[index]), isTypeIncomplete, arg.d.pattern);
            });
            break;
        }

        case ParseNodeType.PatternLiteral:
        case ParseNodeType.PatternValue:
        case ParseNodeType.Error: {
            // Nothing to do here.
            break;
        }
    }

    return narrowedType;
}

function wrapTypeInList(evaluator: TypeEvaluator, node: ParseNode, type: Type): Type {
    if (isNever(type)) {
        return type;
    }

    const listObjectType = convertToInstance(evaluator.getBuiltInObject(node, 'list'));
    if (listObjectType && isClassInstance(listObjectType)) {
        // If the type is a union that contains an Any or Unknown, eliminate the other
        // types before wrapping it in a list.
        type = containsAnyOrUnknown(type, /* recurse */ false) ?? type;

        return ClassType.specialize(listObjectType, [type]);
    }

    return UnknownType.create();
}

export function validateClassPattern(evaluator: TypeEvaluator, pattern: PatternClassNode) {
    let exprType = evaluator.getTypeOfExpression(pattern.d.className, EvalFlags.CallBaseDefaults).type;

    // If the expression is a type alias or other special form, treat it
    // as the special form rather than the class.
    if (exprType.props?.specialForm) {
        exprType = exprType.props.specialForm;
    }

    if (isAnyOrUnknown(exprType)) {
        return;
    }

    // Check for certain uses of type aliases that generate runtime exceptions.
    if (
        exprType.props?.typeAliasInfo &&
        isInstantiableClass(exprType) &&
        exprType.priv.typeArgs &&
        exprType.priv.isTypeArgExplicit
    ) {
        evaluator.addDiagnostic(
            DiagnosticRule.reportGeneralTypeIssues,
            LocMessage.classPatternTypeAlias().format({ type: evaluator.printType(exprType) }),
            pattern.d.className
        );
    } else if (!isInstantiableClass(exprType)) {
        if (!isNever(exprType)) {
            evaluator.addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocAddendum.typeNotClass().format({ type: evaluator.printType(exprType) }),
                pattern.d.className
            );
        }
    } else {
        const isBuiltIn = isClassSpecialCaseForClassPattern(exprType);

        // If it's a special-case builtin class, only positional arguments are allowed.
        if (isBuiltIn) {
            if (pattern.d.args.length === 1 && pattern.d.args[0].d.name) {
                evaluator.addDiagnostic(
                    DiagnosticRule.reportGeneralTypeIssues,
                    LocMessage.classPatternBuiltInArgPositional(),
                    pattern.d.args[0].d.name
                );
            }
        }

        // Emits an error if the supplied number of positional patterns is less than
        // expected for the given subject type.
        let positionalPatternCount = pattern.d.args.findIndex((arg) => arg.d.name !== undefined);
        if (positionalPatternCount < 0) {
            positionalPatternCount = pattern.d.args.length;
        }

        let expectedPatternCount = 1;
        if (!isBuiltIn) {
            let positionalArgNames: string[] = [];
            if (pattern.d.args.some((arg) => !arg.d.name)) {
                positionalArgNames = getPositionalMatchArgNames(evaluator, exprType);
            }

            expectedPatternCount = positionalArgNames.length;
        }

        if (positionalPatternCount > expectedPatternCount) {
            evaluator.addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.classPatternPositionalArgCount().format({
                    type: exprType.shared.name,
                    expected: expectedPatternCount,
                    received: positionalPatternCount,
                }),
                pattern.d.args[expectedPatternCount]
            );
        }
    }
}

// Determines whether the reference expression has a relationship to the subject expression
// in such a way that the type of the reference expression can be narrowed based
// on the narrowed type of the subject expression.
export function getPatternSubtypeNarrowingCallback(
    evaluator: TypeEvaluator,
    reference: CodeFlowReferenceExpressionNode,
    subjectExpression: ExpressionNode
): PatternSubtypeNarrowingCallback | undefined {
    // Look for a subject expression of the form <reference>[<literal>] where
    // <literal> is either a str (for TypedDict discrimination) or an int
    // (for tuple discrimination).
    if (
        subjectExpression.nodeType === ParseNodeType.Index &&
        subjectExpression.d.items.length === 1 &&
        !subjectExpression.d.trailingComma &&
        subjectExpression.d.items[0].d.argCategory === ArgCategory.Simple &&
        isMatchingExpression(reference, subjectExpression.d.leftExpr)
    ) {
        const indexTypeResult = evaluator.getTypeOfExpression(subjectExpression.d.items[0].d.valueExpr);
        const indexType = indexTypeResult.type;

        if (isClassInstance(indexType) && isLiteralType(indexType)) {
            if (ClassType.isBuiltIn(indexType, ['int', 'str'])) {
                const unnarrowedReferenceTypeResult = evaluator.getTypeOfExpression(
                    subjectExpression.d.leftExpr,
                    EvalFlags.CallBaseDefaults
                );
                const unnarrowedReferenceType = unnarrowedReferenceTypeResult.type;

                return (narrowedSubjectType: Type) => {
                    let canNarrow = true;
                    const typesToCombine: Type[] = [];

                    doForEachSubtype(narrowedSubjectType, (subtype) => {
                        subtype = evaluator.makeTopLevelTypeVarsConcrete(subtype);

                        if (isClassInstance(subtype) && subtype.priv.literalValue !== undefined) {
                            if (ClassType.isBuiltIn(indexType, 'str')) {
                                typesToCombine.push(
                                    narrowTypeForDiscriminatedDictEntryComparison(
                                        evaluator,
                                        unnarrowedReferenceType,
                                        indexType,
                                        subtype,
                                        /* isPositiveTest */ true
                                    )
                                );
                            } else {
                                typesToCombine.push(
                                    narrowTypeForDiscriminatedTupleComparison(
                                        evaluator,
                                        unnarrowedReferenceType,
                                        indexType,
                                        subtype,
                                        /* isPositiveTest */ true
                                    )
                                );
                            }
                        } else if (!isNever(subtype)) {
                            // We don't know how to narrow in this case.
                            canNarrow = false;
                        }
                    });

                    if (!canNarrow) {
                        return undefined;
                    }

                    return {
                        type: combineTypes(typesToCombine),
                        isIncomplete: indexTypeResult.isIncomplete || unnarrowedReferenceTypeResult.isIncomplete,
                    };
                };
            }
        }
    }

    // Look for a subject expression that contains the reference
    // expression as an entry in a tuple.
    if (subjectExpression.nodeType === ParseNodeType.Tuple) {
        const matchingEntryIndex = subjectExpression.d.items.findIndex((expr) => isMatchingExpression(reference, expr));
        if (matchingEntryIndex >= 0) {
            const typeResult = evaluator.getTypeOfExpression(subjectExpression.d.items[matchingEntryIndex]);

            return (narrowedSubjectType: Type) => {
                let canNarrow = true;
                const narrowedSubtypes: Type[] = [];

                doForEachSubtype(narrowedSubjectType, (subtype) => {
                    if (
                        isClassInstance(subtype) &&
                        ClassType.isBuiltIn(subtype, 'tuple') &&
                        subtype.priv.tupleTypeArgs &&
                        matchingEntryIndex < subtype.priv.tupleTypeArgs.length &&
                        subtype.priv.tupleTypeArgs.every((e) => !e.isUnbounded)
                    ) {
                        narrowedSubtypes.push(subtype.priv.tupleTypeArgs[matchingEntryIndex].type);
                    } else if (isNever(narrowedSubjectType)) {
                        narrowedSubtypes.push(narrowedSubjectType);
                    } else {
                        canNarrow = false;
                    }
                });

                return canNarrow
                    ? { type: combineTypes(narrowedSubtypes), isIncomplete: typeResult.isIncomplete }
                    : undefined;
            };
        }
    }

    // Look for a subject expression of the form "a.b" where "b" is an attribute
    // that is annotated with a literal type.
    if (
        subjectExpression.nodeType === ParseNodeType.MemberAccess &&
        isMatchingExpression(reference, subjectExpression.d.leftExpr)
    ) {
        const unnarrowedReferenceTypeResult = evaluator.getTypeOfExpression(
            subjectExpression.d.leftExpr,
            EvalFlags.CallBaseDefaults
        );
        const unnarrowedReferenceType = unnarrowedReferenceTypeResult.type;

        return (narrowedSubjectType: Type) => {
            if (isNever(narrowedSubjectType)) {
                return { type: NeverType.createNever() };
            }

            if (!isLiteralTypeOrUnion(narrowedSubjectType)) {
                return undefined;
            }

            const resultType = mapSubtypes(narrowedSubjectType, (literalSubtype) => {
                assert(isClassInstance(literalSubtype) && literalSubtype.priv.literalValue !== undefined);

                return narrowTypeForDiscriminatedLiteralFieldComparison(
                    evaluator,
                    unnarrowedReferenceType,
                    subjectExpression.d.member.d.value,
                    literalSubtype,
                    /* isPositiveTest */ true
                );
            });

            return {
                type: resultType,
            };
        };
    }

    return undefined;
}

function reportUnnecessaryPattern(evaluator: TypeEvaluator, pattern: PatternAtomNode, subjectType: Type): void {
    // If this is a simple wildcard pattern, exempt it from this diagnostic.
    if (
        pattern.nodeType === ParseNodeType.PatternAs &&
        pattern.d.orPatterns.length === 1 &&
        pattern.d.orPatterns[0].nodeType === ParseNodeType.PatternCapture &&
        pattern.d.orPatterns[0].d.isWildcard
    ) {
        return;
    }

    evaluator.addDiagnostic(
        DiagnosticRule.reportUnnecessaryComparison,
        LocMessage.patternNeverMatches().format({ type: evaluator.printType(subjectType) }),
        pattern
    );
}
