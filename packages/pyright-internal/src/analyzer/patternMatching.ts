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
    ArgumentCategory,
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
import { populateTypeVarContextBasedOnExpectedType } from './constraintSolver';
import { getTypeVarScopesForNode, isMatchingExpression } from './parseTreeUtils';
import { getTypedDictMembersForClass } from './typedDicts';
import { EvaluatorFlags, TypeEvaluator, TypeResult } from './typeEvaluatorTypes';
import {
    enumerateLiteralsForType,
    narrowTypeForDiscriminatedDictEntryComparison,
    narrowTypeForDiscriminatedLiteralFieldComparison,
    narrowTypeForDiscriminatedTupleComparison,
} from './typeGuards';
import {
    AnyType,
    ClassType,
    combineTypes,
    FunctionType,
    FunctionTypeFlags,
    isAnyOrUnknown,
    isClass,
    isClassInstance,
    isInstantiableClass,
    isNever,
    isSameWithoutLiteralValue,
    isTypeSame,
    isUnknown,
    isUnpackedVariadicTypeVar,
    NeverType,
    Type,
    TypeBase,
    TypedDictEntry,
    UnknownType,
} from './types';
import {
    addConditionToType,
    applySolvedTypeVars,
    containsAnyOrUnknown,
    convertToInstance,
    doForEachSubtype,
    getTypeCondition,
    getTypeVarScopeId,
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
    specializeClassType,
    specializeTupleClass,
    transformPossibleRecursiveTypeAlias,
} from './typeUtils';
import { TypeVarContext } from './typeVarContext';

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

interface SequencePatternInfo {
    subtype: Type;
    isDefiniteNoMatch: boolean;
    isPotentialNoMatch?: boolean;
    entryTypes: Type[];
    isIndeterminateLength?: boolean;
    isTuple?: boolean;
}

interface MappingPatternInfo {
    subtype: Type;
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
    } else if (pattern.nodeType === ParseNodeType.PatternAs && pattern.orPatterns.length > 1) {
        // Check each of the or patterns separately.
        pattern.orPatterns.forEach((orPattern) => {
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
        let canNarrowTuple = entry.isTuple;

        // Don't attempt to narrow tuples in the negative case if the subject
        // contains indeterminate-length entries.
        if (!isPositiveTest && entry.isIndeterminateLength) {
            canNarrowTuple = false;
        }

        // If the subject has an indeterminate length but the pattern does not accept
        // an arbitrary number of entries or accepts at least one non-star entry,
        // we can't prove that it's a definite match.
        if (entry.isIndeterminateLength) {
            if (pattern.entries.length !== 1 || pattern.starEntryIndex !== 0) {
                isDefiniteMatch = false;
            }
        }

        let negativeEntriesNarrowed = 0;
        pattern.entries.forEach((sequenceEntry, index) => {
            const entryType = getTypeOfPatternSequenceEntry(
                evaluator,
                pattern,
                entry,
                index,
                pattern.entries.length,
                pattern.starEntryIndex,
                /* unpackStarEntry */ true
            );

            const narrowedEntryType = narrowTypeBasedOnPattern(evaluator, entryType, sequenceEntry, isPositiveTest);

            if (isPositiveTest) {
                if (index === pattern.starEntryIndex) {
                    if (
                        isClassInstance(narrowedEntryType) &&
                        narrowedEntryType.tupleTypeArguments &&
                        !isUnboundedTupleClass(narrowedEntryType) &&
                        narrowedEntryType.tupleTypeArguments
                    ) {
                        appendArray(
                            narrowedEntryTypes,
                            narrowedEntryType.tupleTypeArguments.map((t) => t.type)
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

                    // Record the number of entries that were narrowed in the negative
                    // case. We can apply the tuple narrowing only if exactly one entry
                    // is narrowed.
                    negativeEntriesNarrowed++;
                    narrowedEntryTypes.push(narrowedEntryType);
                } else {
                    narrowedEntryTypes.push(entryType);
                }

                if (index === pattern.starEntryIndex) {
                    canNarrowTuple = false;
                }
            }
        });

        // If the pattern is an empty sequence, use the entry types.
        if (pattern.entries.length === 0 && entry.entryTypes.length > 0) {
            narrowedEntryTypes.push(combineTypes(entry.entryTypes));
        }

        if (!isPositiveTest) {
            // If the positive case is a definite match, the negative case can
            // eliminate this subtype entirely.
            if (isDefiniteMatch) {
                return false;
            }

            // Can we narrow a tuple?
            if (canNarrowTuple && negativeEntriesNarrowed === 1) {
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

                    entry.subtype = ClassType.cloneAsInstance(
                        ClassType.cloneForSpecialization(sequenceType, [typeArgType], /* isTypeArgumentExplicit */ true)
                    );
                }
            }
        }

        return isPlausibleMatch;
    });

    return combineTypes(sequenceInfo.map((entry) => entry.subtype));
}

function narrowTypeBasedOnAsPattern(
    evaluator: TypeEvaluator,
    type: Type,
    pattern: PatternAsNode,
    isPositiveTest: boolean
): Type {
    let remainingType = type;

    if (!isPositiveTest) {
        pattern.orPatterns.forEach((subpattern) => {
            remainingType = narrowTypeBasedOnPattern(evaluator, remainingType, subpattern, /* isPositiveTest */ false);
        });
        return remainingType;
    }

    const narrowedTypes = pattern.orPatterns.map((subpattern) => {
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
        // Our ability to narrow in the negative case for mapping patterns is
        // limited, but we can do it if the type is a union that includes a
        // TypedDict with a field discriminated by a literal.
        if (pattern.entries.length !== 1 || pattern.entries[0].nodeType !== ParseNodeType.PatternMappingKeyEntry) {
            return type;
        }

        const keyPattern = pattern.entries[0].keyPattern;
        const valuePattern = pattern.entries[0].valuePattern;
        if (
            keyPattern.nodeType !== ParseNodeType.PatternLiteral ||
            valuePattern.nodeType !== ParseNodeType.PatternAs ||
            !valuePattern.orPatterns.every((orPattern) => orPattern.nodeType === ParseNodeType.PatternLiteral)
        ) {
            return type;
        }

        const keyType = evaluator.getTypeOfExpression(keyPattern.expression).type;

        // The key type must be a str literal.
        if (!isClassInstance(keyType) || !ClassType.isBuiltIn(keyType, 'str') || keyType.literalValue === undefined) {
            return type;
        }
        const keyValue = keyType.literalValue as string;

        const valueTypes = valuePattern.orPatterns.map(
            (orPattern) => evaluator.getTypeOfExpression((orPattern as PatternLiteralNode).expression).type
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
                                valueType.literalValue === memberValueType.literalValue
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
        let isPlausibleMatch = true;
        pattern.entries.forEach((mappingEntry) => {
            if (mappingSubtypeInfo.typedDict) {
                if (mappingEntry.nodeType === ParseNodeType.PatternMappingKeyEntry) {
                    const narrowedKeyType = narrowTypeBasedOnPattern(
                        evaluator,
                        evaluator.getBuiltInObject(pattern, 'str'),
                        mappingEntry.keyPattern,
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
                            const valueEntry = tdEntries.knownItems.get(keySubtype.literalValue as string);
                            if (valueEntry) {
                                const narrowedValueType = narrowTypeBasedOnPattern(
                                    evaluator,
                                    valueEntry.valueType,
                                    mappingEntry.valuePattern,
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
                                            mappingSubtypeInfo.typedDict!.typedDictNarrowedEntries ?? []
                                        );
                                        newNarrowedEntriesMap.set(keySubtype.literalValue as string, {
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
                        mappingEntry.keyPattern,
                        isPositiveTest
                    );
                    const narrowedValueType = narrowTypeBasedOnPattern(
                        evaluator,
                        mappingSubtypeInfo.dictTypeArgs.value,
                        mappingEntry.valuePattern,
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
            matchArgsType.tupleTypeArguments
        ) {
            const tupleArgs = matchArgsType.tupleTypeArguments;

            // Are all the args string literals?
            if (
                tupleArgs.every(
                    (arg) =>
                        isClassInstance(arg.type) && ClassType.isBuiltIn(arg.type, 'str') && isLiteralType(arg.type)
                )
            ) {
                return tupleArgs.map((arg) => (arg.type as ClassType).literalValue as string);
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
    const literalType = evaluator.getTypeOfExpression(pattern.expression).type;

    if (!isPositiveTest) {
        return evaluator.mapSubtypesExpandTypeVars(
            type,
            /* options */ undefined,
            (expandedSubtype, unexpandedSubtype) => {
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
                    expandedSubtype.literalValue === undefined &&
                    isClassInstance(literalType) &&
                    ClassType.isBuiltIn(literalType, 'bool') &&
                    literalType.literalValue !== undefined
                ) {
                    return ClassType.cloneWithLiteral(literalType, !(literalType.literalValue as boolean));
                }

                return expandedSubtype;
            }
        );
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
    let exprType = evaluator.getTypeOfExpression(pattern.className, EvaluatorFlags.CallBaseDefaults).type;

    // If this is a class (but not a type alias that refers to a class),
    // specialize it with Unknown type arguments.
    if (isClass(exprType) && !exprType.typeAliasInfo) {
        exprType = ClassType.cloneRemoveTypePromotions(exprType);
        exprType = specializeClassType(exprType);
    }

    // Are there any positional arguments? If so, try to get the mappings for
    // these arguments by fetching the __match_args__ symbol from the class.
    let positionalArgNames: string[] = [];
    if (pattern.arguments.some((arg) => !arg.name) && isInstantiableClass(exprType)) {
        positionalArgNames = getPositionalMatchArgNames(evaluator, exprType);
    }

    if (!isPositiveTest) {
        // Don't attempt to narrow if the class type is a more complex type (e.g. a TypeVar or union).
        if (!isInstantiableClass(exprType)) {
            return type;
        }

        let classType = exprType;

        if (classType.details.typeParameters.length > 0) {
            classType = ClassType.cloneForSpecialization(
                classType,
                /* typeArguments */ undefined,
                /* isTypeArgumentExplicit */ false
            );
        }

        const classInstance = convertToInstance(classType);
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
                    const metaclass = subjectSubtypeExpanded.details.effectiveMetaclass ?? UnknownType.create();
                    if (isInstantiableClass(classType) && evaluator.assignType(classType, metaclass)) {
                        return undefined;
                    }

                    return subjectSubtypeExpanded;
                }

                if (!isNoneInstance(subjectSubtypeExpanded) && !isClassInstance(subjectSubtypeExpanded)) {
                    return subjectSubtypeUnexpanded;
                }

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

                if (pattern.arguments.length === 0) {
                    if (isClass(classInstance) && isClass(subjectSubtypeExpanded)) {
                        if (ClassType.isDerivedFrom(subjectSubtypeExpanded, classInstance)) {
                            // We know that this match will always succeed, so we can
                            // eliminate this subtype.
                            return undefined;
                        }

                        // Handle LiteralString as a special case.
                        if (
                            ClassType.isBuiltIn(classInstance, 'str') &&
                            ClassType.isBuiltIn(subjectSubtypeExpanded, 'LiteralString')
                        ) {
                            return undefined;
                        }
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

                for (let index = 0; index < pattern.arguments.length; index++) {
                    const narrowedArgType = narrowTypeOfClassPatternArgument(
                        evaluator,
                        pattern.arguments[index],
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
            pattern.className
        );
        return NeverType.createNever();
    } else if (
        isInstantiableClass(exprType) &&
        ClassType.isProtocolClass(exprType) &&
        !ClassType.isRuntimeCheckable(exprType)
    ) {
        evaluator.addDiagnostic(
            DiagnosticRule.reportGeneralTypeIssues,
            LocAddendum.protocolRequiresRuntimeCheckable(),
            pattern.className
        );
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
                                FunctionTypeFlags.SkipArgsKwargsCompatibilityCheck
                            );
                            FunctionType.addDefaultParameters(
                                unknownCallable,
                                /* useUnknown */ isUnknown(subjectSubtypeExpanded)
                            );
                            unknownCallable.details.declaredReturnType = subjectSubtypeExpanded;
                            return unknownCallable;
                        }

                        return convertToInstance(unexpandedSubtype);
                    }

                    // Handle the case where the class pattern references type() or a subtype thereof
                    // and the subject type is a class itself.
                    if (isPatternMetaclass && isInstantiableClass(subjectSubtypeExpanded)) {
                        const metaclass = subjectSubtypeExpanded.details.effectiveMetaclass ?? UnknownType.create();
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
                                    unexpandedSubtype.details.typeParameters.length > 0
                                ) {
                                    const typeVarContext = new TypeVarContext(getTypeVarScopeId(unexpandedSubtype));
                                    const unspecializedMatchType = ClassType.cloneForSpecialization(
                                        unexpandedSubtype,
                                        /* typeArguments */ undefined,
                                        /* isTypeArgumentExplicit */ false
                                    );

                                    const matchTypeInstance = ClassType.cloneAsInstance(unspecializedMatchType);
                                    if (
                                        populateTypeVarContextBasedOnExpectedType(
                                            evaluator,
                                            matchTypeInstance,
                                            subjectSubtypeExpanded,
                                            typeVarContext,
                                            /* liveTypeVarScopes */ undefined,
                                            /* usageOffset */ undefined
                                        )
                                    ) {
                                        resultType = applySolvedTypeVars(matchTypeInstance, typeVarContext, {
                                            unknownIfNotFound: true,
                                        }) as ClassType;
                                    }
                                }
                            }
                        } else {
                            return undefined;
                        }

                        // Are there any positional arguments? If so, try to get the mappings for
                        // these arguments by fetching the __match_args__ symbol from the class.
                        let positionalArgNames: string[] = [];
                        if (pattern.arguments.some((arg) => !arg.name)) {
                            positionalArgNames = getPositionalMatchArgNames(evaluator, expandedSubtype);
                        }

                        let isMatchValid = true;
                        pattern.arguments.forEach((arg, index) => {
                            // Narrow the arg pattern. It's possible that the actual type of the object
                            // being matched is a subtype of the resultType, so it might contain additional
                            // attributes that we don't know about.
                            const narrowedArgType = narrowTypeOfClassPatternArgument(
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
    if (classPatternSpecialCases.some((className) => classType.details.fullName === className)) {
        return true;
    }

    // If the class supplies its own `__match_args__`, it's not a special case.
    const matchArgsMemberInfo = lookUpClassMember(classType, '__match_args__');
    if (matchArgsMemberInfo) {
        return false;
    }

    // If the class derives from a built-in class, it is considered a special case.
    for (const mroClass of classType.details.mro) {
        if (
            isClass(mroClass) &&
            classPatternSpecialCases.some((className) => mroClass.details.fullName === className)
        ) {
            return true;
        }
    }

    return false;
}

// Narrows the pattern provided for a class pattern argument.
function narrowTypeOfClassPatternArgument(
    evaluator: TypeEvaluator,
    arg: PatternClassArgumentNode,
    argIndex: number,
    positionalArgNames: string[],
    matchType: Type,
    isPositiveTest: boolean
) {
    let argName: string | undefined;

    if (arg.name) {
        argName = arg.name.value;
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

    if (!arg.name && isClass(matchType) && argIndex === 0) {
        if (isClassSpecialCaseForClassPattern(matchType)) {
            useSelfForPattern = true;
        } else if (positionalArgNames.length === 0) {
            matchType.details.mro.forEach((mroClass) => {
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

    return narrowTypeBasedOnPattern(evaluator, argType, arg.pattern, isPositiveTest);
}

function narrowTypeBasedOnValuePattern(
    evaluator: TypeEvaluator,
    subjectType: Type,
    pattern: PatternValueNode,
    isPositiveTest: boolean
): Type {
    const valueType = evaluator.getTypeOfExpression(pattern.expression).type;
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
                                ClassType.isEnumClass(subjectSubtypeExpanded) &&
                                !isLiteralType(subjectSubtypeExpanded) &&
                                isClassInstance(valueSubtypeExpanded) &&
                                isSameWithoutLiteralValue(subjectSubtypeExpanded, valueSubtypeExpanded) &&
                                isLiteralType(valueSubtypeExpanded)
                            ) {
                                const allEnumTypes = enumerateLiteralsForType(evaluator, subjectSubtypeExpanded);
                                if (allEnumTypes) {
                                    return combineTypes(
                                        allEnumTypes.filter(
                                            (enumType) => !ClassType.isLiteralValueSame(valueSubtypeExpanded, enumType)
                                        )
                                    );
                                }
                            } else if (
                                isClassInstance(subjectSubtypeExpanded) &&
                                isClassInstance(valueSubtypeExpanded) &&
                                isLiteralType(subjectSubtypeExpanded) &&
                                ClassType.isLiteralValueSame(valueSubtypeExpanded, subjectSubtypeExpanded)
                            ) {
                                return undefined;
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
                            return ClassType.isLiteralValueSame(valueSubtypeExpanded, subjectSubtypeExpanded)
                                ? valueSubtypeUnexpanded
                                : undefined;
                        }

                        // Determine if assignment is supported for this combination of
                        // value subtype and matching subtype.
                        const returnType = evaluator.useSpeculativeMode(pattern.expression, () =>
                            evaluator.getTypeOfMagicMethodCall(
                                valueSubtypeExpanded,
                                '__eq__',
                                [{ type: subjectSubtypeExpanded }],
                                pattern.expression,
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
                    typedDict: concreteSubtype,
                });
                return;
            }

            // Is it a subclass of Mapping?
            let mroClassToSpecialize: ClassType | undefined;
            for (const mroClass of concreteSubtype.details.mro) {
                if (isInstantiableClass(mroClass) && ClassType.isBuiltIn(mroClass, 'Mapping')) {
                    mroClassToSpecialize = mroClass;
                    break;
                }
            }

            if (mroClassToSpecialize) {
                const specializedMapping = partiallySpecializeType(mroClassToSpecialize, concreteSubtype) as ClassType;

                if (specializedMapping.typeArguments && specializedMapping.typeArguments.length >= 2) {
                    mappingInfo.push({
                        subtype,
                        dictTypeArgs: {
                            key: specializedMapping.typeArguments[0],
                            value: specializedMapping.typeArguments[1],
                        },
                    });
                }

                return;
            }

            // Is it a superclass of Mapping?
            const mappingType = evaluator.getTypingType(node, 'Mapping');
            if (mappingType && isInstantiableClass(mappingType)) {
                const mappingObject = ClassType.cloneAsInstance(mappingType);
                if (evaluator.assignType(type, mappingObject)) {
                    mappingInfo.push({
                        subtype,
                        dictTypeArgs: {
                            key: UnknownType.create(),
                            value: UnknownType.create(),
                        },
                    });
                }
            }
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
    const patternEntryCount = pattern.entries.length;
    const patternStarEntryIndex = pattern.starEntryIndex;
    const sequenceInfo: SequencePatternInfo[] = [];

    doForEachSubtype(type, (subtype) => {
        const concreteSubtype = evaluator.makeTopLevelTypeVarsConcrete(subtype);
        let mroClassToSpecialize: ClassType | undefined;
        let pushedEntry = false;

        if (isClassInstance(concreteSubtype)) {
            for (const mroClass of concreteSubtype.details.mro) {
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
                const specializedSequence = partiallySpecializeType(mroClassToSpecialize, concreteSubtype) as ClassType;

                if (isTupleClass(specializedSequence)) {
                    const typeArgs = specializedSequence.tupleTypeArguments ?? [
                        { type: UnknownType.create(), isUnbounded: true },
                    ];

                    const tupleIndeterminateIndex = typeArgs.findIndex(
                        (t) => t.isUnbounded || isUnpackedVariadicTypeVar(t.type)
                    );

                    // If the tuple contains an indeterminate entry, expand or remove that
                    // entry to match the length of the pattern if possible.
                    if (tupleIndeterminateIndex >= 0) {
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
                                (t) => t.isUnbounded || isUnpackedVariadicTypeVar(t.type)
                            ),
                        });
                    }

                    if (typeArgs.length === patternEntryCount) {
                        let isDefiniteNoMatch = false;
                        let isPotentialNoMatch = tupleIndeterminateIndex >= 0;
                        if (patternStarEntryIndex !== undefined && patternEntryCount === 1) {
                            isPotentialNoMatch = false;
                        }

                        for (let i = 0; i < patternEntryCount; i++) {
                            const subPattern = pattern.entries[i];
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
                            isDefiniteNoMatch,
                            isPotentialNoMatch,
                        });
                        pushedEntry = true;
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

                                const subPattern = pattern.entries[i];
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
                                isDefiniteNoMatch,
                            });
                            pushedEntry = true;
                        }
                    }
                } else {
                    sequenceInfo.push({
                        subtype,
                        entryTypes: [
                            specializedSequence.typeArguments && specializedSequence.typeArguments.length > 0
                                ? specializedSequence.typeArguments[0]
                                : UnknownType.create(),
                        ],
                        isIndeterminateLength: true,
                        isDefiniteNoMatch: false,
                    });
                    pushedEntry = true;
                }
            }
        }

        if (!pushedEntry) {
            // If it wasn't a subtype of Sequence, see if it's a supertype.
            const sequenceType = evaluator.getTypingType(pattern, 'Sequence');

            if (sequenceType && isInstantiableClass(sequenceType)) {
                const sequenceTypeVarContext = new TypeVarContext(getTypeVarScopeId(sequenceType));
                if (
                    populateTypeVarContextBasedOnExpectedType(
                        evaluator,
                        ClassType.cloneAsInstance(sequenceType),
                        subtype,
                        sequenceTypeVarContext,
                        getTypeVarScopesForNode(pattern),
                        pattern.start
                    )
                ) {
                    const specializedSequence = applySolvedTypeVars(
                        ClassType.cloneAsInstantiable(sequenceType),
                        sequenceTypeVarContext
                    ) as ClassType;

                    if (specializedSequence.typeArguments && specializedSequence.typeArguments.length > 0) {
                        sequenceInfo.push({
                            subtype,
                            entryTypes: [specializedSequence.typeArguments[0]],
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
                        ClassType.cloneForSpecialization(
                            ClassType.cloneAsInstance(sequenceType),
                            [UnknownType.create()],
                            /* isTypeArgumentExplicit */ true
                        )
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

            // Push an entry that indicates that this is definitely not a match.
            sequenceInfo.push({
                subtype,
                entryTypes: [],
                isIndeterminateLength: true,
                isDefiniteNoMatch: true,
            });
        }
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
            .map((type) => evaluator.stripLiteralValue(type));

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

            pattern.entries.forEach((entry, index) => {
                const entryType = combineTypes(
                    sequenceInfo.map((info) =>
                        getTypeOfPatternSequenceEntry(
                            evaluator,
                            pattern,
                            info,
                            index,
                            pattern.entries.length,
                            pattern.starEntryIndex,
                            /* unpackStarEntry */ false
                        )
                    )
                );

                assignTypeToPatternTargets(evaluator, entryType, isTypeIncomplete, entry);
            });
            break;
        }

        case ParseNodeType.PatternAs: {
            if (pattern.target) {
                evaluator.assignTypeToExpression(pattern.target, narrowedType, isTypeIncomplete, pattern.target);
            }

            let runningNarrowedType = narrowedType;
            pattern.orPatterns.forEach((orPattern) => {
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
            if (pattern.isWildcard) {
                if (!isTypeIncomplete) {
                    if (isUnknown(narrowedType)) {
                        evaluator.addDiagnostic(
                            DiagnosticRule.reportUnknownVariableType,
                            LocMessage.wildcardPatternTypeUnknown(),
                            pattern.target
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
                            pattern.target
                        );
                    }
                }
            } else {
                evaluator.assignTypeToExpression(pattern.target, narrowedType, isTypeIncomplete, pattern.target);
            }
            break;
        }

        case ParseNodeType.PatternMapping: {
            const mappingInfo = getMappingPatternInfo(evaluator, narrowedType, pattern);

            pattern.entries.forEach((mappingEntry) => {
                const keyTypes: Type[] = [];
                const valueTypes: Type[] = [];

                mappingInfo.forEach((mappingSubtypeInfo) => {
                    if (mappingSubtypeInfo.typedDict) {
                        if (mappingEntry.nodeType === ParseNodeType.PatternMappingKeyEntry) {
                            const keyType = narrowTypeBasedOnPattern(
                                evaluator,
                                evaluator.getBuiltInObject(pattern, 'str'),
                                mappingEntry.keyPattern,
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
                                    const valueInfo = tdEntries.knownItems.get(keySubtype.literalValue as string);
                                    valueTypes.push(valueInfo ? valueInfo.valueType : UnknownType.create());
                                } else {
                                    valueTypes.push(UnknownType.create());
                                }
                            });
                        } else if (mappingEntry.nodeType === ParseNodeType.PatternMappingExpandEntry) {
                            keyTypes.push(evaluator.getBuiltInObject(pattern, 'str'));
                            valueTypes.push(UnknownType.create());
                        }
                    } else if (mappingSubtypeInfo.dictTypeArgs) {
                        if (mappingEntry.nodeType === ParseNodeType.PatternMappingKeyEntry) {
                            const keyType = narrowTypeBasedOnPattern(
                                evaluator,
                                mappingSubtypeInfo.dictTypeArgs.key,
                                mappingEntry.keyPattern,
                                /* isPositiveTest */ true
                            );
                            keyTypes.push(keyType);
                            valueTypes.push(
                                narrowTypeBasedOnPattern(
                                    evaluator,
                                    mappingSubtypeInfo.dictTypeArgs.value,
                                    mappingEntry.valuePattern,
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
                    assignTypeToPatternTargets(evaluator, keyType, isTypeIncomplete, mappingEntry.keyPattern);
                    assignTypeToPatternTargets(evaluator, valueType, isTypeIncomplete, mappingEntry.valuePattern);
                } else if (mappingEntry.nodeType === ParseNodeType.PatternMappingExpandEntry) {
                    const dictClass = evaluator.getBuiltInType(pattern, 'dict');
                    const strType = evaluator.getBuiltInObject(pattern, 'str');
                    const dictType =
                        dictClass && isInstantiableClass(dictClass) && isClassInstance(strType)
                            ? ClassType.cloneAsInstance(
                                  ClassType.cloneForSpecialization(
                                      dictClass,
                                      [keyType, valueType],
                                      /* isTypeArgumentExplicit */ true
                                  )
                              )
                            : UnknownType.create();
                    evaluator.assignTypeToExpression(
                        mappingEntry.target,
                        dictType,
                        isTypeIncomplete,
                        mappingEntry.target
                    );
                }
            });
            break;
        }

        case ParseNodeType.PatternClass: {
            const argTypes: Type[][] = pattern.arguments.map((arg) => []);

            evaluator.mapSubtypesExpandTypeVars(narrowedType, /* options */ undefined, (expandedSubtype) => {
                if (isClassInstance(expandedSubtype)) {
                    doForEachSubtype(narrowedType, (subjectSubtype) => {
                        const concreteSubtype = evaluator.makeTopLevelTypeVarsConcrete(subjectSubtype);

                        if (isAnyOrUnknown(concreteSubtype)) {
                            pattern.arguments.forEach((arg, index) => {
                                argTypes[index].push(concreteSubtype);
                            });
                        } else if (isClassInstance(concreteSubtype)) {
                            // Are there any positional arguments? If so, try to get the mappings for
                            // these arguments by fetching the __match_args__ symbol from the class.
                            let positionalArgNames: string[] = [];
                            if (pattern.arguments.some((arg) => !arg.name)) {
                                positionalArgNames = getPositionalMatchArgNames(
                                    evaluator,
                                    ClassType.cloneAsInstantiable(expandedSubtype)
                                );
                            }

                            pattern.arguments.forEach((arg, index) => {
                                const narrowedArgType = narrowTypeOfClassPatternArgument(
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
                    pattern.arguments.forEach((arg, index) => {
                        argTypes[index].push(UnknownType.create());
                    });
                }

                return undefined;
            });

            pattern.arguments.forEach((arg, index) => {
                assignTypeToPatternTargets(evaluator, combineTypes(argTypes[index]), isTypeIncomplete, arg.pattern);
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

        return ClassType.cloneForSpecialization(listObjectType, [type], /* isTypeArgumentExplicit */ true);
    }

    return UnknownType.create();
}

export function validateClassPattern(evaluator: TypeEvaluator, pattern: PatternClassNode) {
    let exprType = evaluator.getTypeOfExpression(pattern.className, EvaluatorFlags.CallBaseDefaults).type;

    // If the expression is a type alias or other special form, treat it
    // as the special form rather than the class.
    if (exprType.specialForm) {
        exprType = exprType.specialForm;
    }

    if (isAnyOrUnknown(exprType)) {
        return;
    }

    // Check for certain uses of type aliases that generate runtime exceptions.
    if (
        exprType.typeAliasInfo &&
        isInstantiableClass(exprType) &&
        exprType.typeArguments &&
        exprType.isTypeArgumentExplicit
    ) {
        evaluator.addDiagnostic(
            DiagnosticRule.reportGeneralTypeIssues,
            LocMessage.classPatternTypeAlias().format({ type: evaluator.printType(exprType) }),
            pattern.className
        );
    } else if (!isInstantiableClass(exprType)) {
        if (!isNever(exprType)) {
            evaluator.addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocAddendum.typeNotClass().format({ type: evaluator.printType(exprType) }),
                pattern.className
            );
        }
    } else {
        const isBuiltIn = isClassSpecialCaseForClassPattern(exprType);

        // If it's a special-case builtin class, only positional arguments are allowed.
        if (isBuiltIn) {
            if (pattern.arguments.length === 1 && pattern.arguments[0].name) {
                evaluator.addDiagnostic(
                    DiagnosticRule.reportGeneralTypeIssues,
                    LocMessage.classPatternBuiltInArgPositional(),
                    pattern.arguments[0].name
                );
            }
        }

        // Emits an error if the supplied number of positional patterns is less than
        // expected for the given subject type.
        let positionalPatternCount = pattern.arguments.findIndex((arg) => arg.name !== undefined);
        if (positionalPatternCount < 0) {
            positionalPatternCount = pattern.arguments.length;
        }

        let expectedPatternCount = 1;
        if (!isBuiltIn) {
            let positionalArgNames: string[] = [];
            if (pattern.arguments.some((arg) => !arg.name)) {
                positionalArgNames = getPositionalMatchArgNames(evaluator, exprType);
            }

            expectedPatternCount = positionalArgNames.length;
        }

        if (positionalPatternCount > expectedPatternCount) {
            evaluator.addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.classPatternPositionalArgCount().format({
                    type: exprType.details.name,
                    expected: expectedPatternCount,
                    received: positionalPatternCount,
                }),
                pattern.arguments[expectedPatternCount]
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
        subjectExpression.items.length === 1 &&
        !subjectExpression.trailingComma &&
        subjectExpression.items[0].argumentCategory === ArgumentCategory.Simple &&
        isMatchingExpression(reference, subjectExpression.baseExpression)
    ) {
        const indexTypeResult = evaluator.getTypeOfExpression(subjectExpression.items[0].valueExpression);
        const indexType = indexTypeResult.type;

        if (isClassInstance(indexType) && isLiteralType(indexType)) {
            if (ClassType.isBuiltIn(indexType, ['int', 'str'])) {
                const unnarrowedReferenceTypeResult = evaluator.getTypeOfExpression(
                    subjectExpression.baseExpression,
                    EvaluatorFlags.CallBaseDefaults
                );
                const unnarrowedReferenceType = unnarrowedReferenceTypeResult.type;

                return (narrowedSubjectType: Type) => {
                    let canNarrow = true;
                    const typesToCombine: Type[] = [];

                    doForEachSubtype(narrowedSubjectType, (subtype) => {
                        subtype = evaluator.makeTopLevelTypeVarsConcrete(subtype);

                        if (isClassInstance(subtype) && subtype.literalValue !== undefined) {
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
        const matchingEntryIndex = subjectExpression.expressions.findIndex((expr) =>
            isMatchingExpression(reference, expr)
        );
        if (matchingEntryIndex >= 0) {
            const typeResult = evaluator.getTypeOfExpression(subjectExpression.expressions[matchingEntryIndex]);

            return (narrowedSubjectType: Type) => {
                let canNarrow = true;
                const narrowedSubtypes: Type[] = [];

                doForEachSubtype(narrowedSubjectType, (subtype) => {
                    if (
                        isClassInstance(subtype) &&
                        ClassType.isBuiltIn(subtype, 'tuple') &&
                        subtype.tupleTypeArguments &&
                        matchingEntryIndex < subtype.tupleTypeArguments.length &&
                        subtype.tupleTypeArguments.every((e) => !e.isUnbounded)
                    ) {
                        narrowedSubtypes.push(subtype.tupleTypeArguments[matchingEntryIndex].type);
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
        isMatchingExpression(reference, subjectExpression.leftExpression)
    ) {
        const unnarrowedReferenceTypeResult = evaluator.getTypeOfExpression(
            subjectExpression.leftExpression,
            EvaluatorFlags.CallBaseDefaults
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
                assert(isClassInstance(literalSubtype) && literalSubtype.literalValue !== undefined);

                return narrowTypeForDiscriminatedLiteralFieldComparison(
                    evaluator,
                    unnarrowedReferenceType,
                    subjectExpression.memberName.value,
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
    evaluator.addDiagnostic(
        DiagnosticRule.reportUnnecessaryComparison,
        LocMessage.patternNeverMatches().format({ type: evaluator.printType(subjectType) }),
        pattern
    );
}
