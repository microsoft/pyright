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

import { assert } from '../common/debug';
import { DiagnosticAddendum } from '../common/diagnostic';
import { DiagnosticRule } from '../common/diagnosticRules';
import { Localizer } from '../localization/localize';
import {
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
import { getFileInfo } from './analyzerNodeInfo';
import { getTypedDictMembersForClass } from './typedDicts';
import { TypeEvaluator } from './typeEvaluatorTypes';
import {
    AnyType,
    ClassType,
    combineTypes,
    isAnyOrUnknown,
    isClassInstance,
    isInstantiableClass,
    isNever,
    isUnknown,
    NeverType,
    Type,
    TypeBase,
    UnknownType,
} from './types';
import {
    convertToInstance,
    doForEachSubtype,
    getTypeCondition,
    isLiteralType,
    isOpenEndedTupleClass,
    isTupleClass,
    lookUpClassMember,
    mapSubtypes,
    partiallySpecializeType,
    specializeTupleClass,
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

interface SequencePatternInfo {
    subtype: Type;
    entryTypes: Type[];
    isIndeterminateLength: boolean;
    isTuple: boolean;
}

interface MappingPatternInfo {
    subtype: Type;
    typedDict?: ClassType;
    dictTypeArgs?: {
        key: Type;
        value: Type;
    };
}

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
            return isPositiveTest ? type : NeverType.create();
        }

        case ParseNodeType.Error: {
            return type;
        }
    }
}

function narrowTypeBasedOnSequencePattern(
    evaluator: TypeEvaluator,
    type: Type,
    pattern: PatternSequenceNode,
    isPositiveTest: boolean
): Type {
    if (!isPositiveTest) {
        // Never narrow in negative case.
        return type;
    }

    let sequenceInfo = getSequencePatternInfo(evaluator, type, pattern.entries.length, pattern.starEntryIndex);
    // Further narrow based on pattern entry types.
    sequenceInfo = sequenceInfo.filter((entry) => {
        let isPlausibleMatch = true;
        const narrowedEntryTypes: Type[] = [];
        let canNarrowTuple = entry.isTuple;

        pattern.entries.forEach((sequenceEntry, index) => {
            const entryType = getTypeForPatternSequenceEntry(
                evaluator,
                pattern,
                entry,
                index,
                pattern.entries.length,
                pattern.starEntryIndex
            );

            const narrowedEntryType = narrowTypeBasedOnPattern(
                evaluator,
                entryType,
                sequenceEntry,
                /* isPositiveTest */ true
            );
            if (index === pattern.starEntryIndex) {
                if (
                    isClassInstance(narrowedEntryType) &&
                    narrowedEntryType.tupleTypeArguments &&
                    !isOpenEndedTupleClass(narrowedEntryType) &&
                    narrowedEntryType.tupleTypeArguments
                ) {
                    narrowedEntryTypes.push(...narrowedEntryType.tupleTypeArguments);
                } else {
                    canNarrowTuple = false;
                }
            } else {
                narrowedEntryTypes.push(narrowedEntryType);
            }

            if (isNever(narrowedEntryType)) {
                isPlausibleMatch = false;
            }
        });

        // If this is a tuple, we can narrow it to a specific tuple type.
        // Other sequences cannot be narrowed because we don't know if they
        // are immutable (covariant).
        if (isPlausibleMatch && canNarrowTuple) {
            const tupleClassType = evaluator.getBuiltInType(pattern, 'tuple');
            if (tupleClassType && isInstantiableClass(tupleClassType)) {
                entry.subtype = ClassType.cloneAsInstance(specializeTupleClass(tupleClassType, narrowedEntryTypes));
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
    if (!isPositiveTest) {
        // Never narrow in negative case.
        return type;
    }

    let mappingInfo = getMappingPatternInfo(evaluator, type);

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
                            const valueEntry = tdEntries.get(keySubtype.literalValue as string);
                            if (valueEntry) {
                                const narrowedValueType = narrowTypeBasedOnPattern(
                                    evaluator,
                                    valueEntry.valueType,
                                    mappingEntry.valuePattern,
                                    /* isPositiveTest */ true
                                );
                                if (!isNever(narrowedValueType)) {
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
            !isOpenEndedTupleClass(matchArgsType) &&
            matchArgsType.tupleTypeArguments
        ) {
            const tupleArgs = matchArgsType.tupleTypeArguments;

            // Are all the args string literals?
            if (
                !tupleArgs.some(
                    (argType) =>
                        !isClassInstance(argType) || !ClassType.isBuiltIn(argType, 'str') || !isLiteralType(argType)
                )
            ) {
                return tupleArgs.map((argType) => (argType as ClassType).literalValue as string);
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
        return mapSubtypes(type, (subtype) => {
            if (
                isClassInstance(literalType) &&
                isLiteralType(literalType) &&
                isClassInstance(subtype) &&
                isLiteralType(subtype) &&
                evaluator.canAssignType(literalType, subtype, new DiagnosticAddendum())
            ) {
                return undefined;
            }

            // Narrow a non-literal bool based on a literal bool pattern.
            if (
                isClassInstance(subtype) &&
                ClassType.isBuiltIn(subtype, 'bool') &&
                subtype.literalValue === undefined &&
                isClassInstance(literalType) &&
                ClassType.isBuiltIn(literalType, 'bool') &&
                literalType.literalValue !== undefined
            ) {
                return ClassType.cloneWithLiteral(literalType, !(literalType.literalValue as boolean));
            }

            return subtype;
        });
    }

    return mapSubtypes(type, (subtype) => {
        if (evaluator.canAssignType(subtype, literalType, new DiagnosticAddendum())) {
            return literalType;
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
    const classType = evaluator.getTypeOfExpression(pattern.className).type;

    if (!isPositiveTest) {
        // Don't attempt to narrow if the class type is a more complex type (e.g. a TypeVar or union).
        if (!isInstantiableClass(classType)) {
            return type;
        }

        // Don't attempt to narrow if there are arguments.
        let hasArguments = pattern.arguments.length > 0;
        if (
            pattern.arguments.length === 1 &&
            !pattern.arguments[0].name &&
            classPatternSpecialCases.some((className) => classType.details.fullName === className)
        ) {
            hasArguments = false;
        }

        if (hasArguments) {
            return type;
        }

        // Don't attempt to narrow if the class type is generic.
        if (classType.details.typeParameters.length > 0) {
            return type;
        }

        const diag = new DiagnosticAddendum();
        const classInstance = convertToInstance(classType);
        return mapSubtypes(type, (subtype) => {
            if (evaluator.canAssignType(classInstance, subtype, diag)) {
                return undefined;
            }

            return subtype;
        });
    }

    if (!TypeBase.isInstantiable(classType)) {
        evaluator.addDiagnostic(
            getFileInfo(pattern).diagnosticRuleSet.reportGeneralTypeIssues,
            DiagnosticRule.reportGeneralTypeIssues,
            Localizer.DiagnosticAddendum.typeNotClass().format({ type: evaluator.printType(classType) }),
            pattern.className
        );
        return NeverType.create();
    }

    return evaluator.mapSubtypesExpandTypeVars(
        classType,
        /* conditionFilter */ undefined,
        (expandedSubtype, unexpandedSubtype) => {
            if (isAnyOrUnknown(expandedSubtype)) {
                return unexpandedSubtype;
            }

            if (isInstantiableClass(expandedSubtype)) {
                return mapSubtypes(type, (matchSubtype) => {
                    const concreteSubtype = evaluator.makeTopLevelTypeVarsConcrete(matchSubtype);

                    if (isAnyOrUnknown(concreteSubtype)) {
                        return matchSubtype;
                    }

                    if (isClassInstance(concreteSubtype)) {
                        let resultType: Type;

                        if (
                            evaluator.canAssignType(
                                expandedSubtype,
                                ClassType.cloneAsInstantiable(concreteSubtype),
                                new DiagnosticAddendum()
                            )
                        ) {
                            resultType = matchSubtype;
                        } else if (
                            evaluator.canAssignType(
                                ClassType.cloneAsInstantiable(concreteSubtype),
                                expandedSubtype,
                                new DiagnosticAddendum()
                            )
                        ) {
                            resultType = convertToInstance(unexpandedSubtype);
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
                            const narrowedArgType = narrowTypeOfClassPatternArgument(
                                evaluator,
                                arg,
                                index,
                                positionalArgNames,
                                expandedSubtype
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

function narrowTypeOfClassPatternArgument(
    evaluator: TypeEvaluator,
    arg: PatternClassArgumentNode,
    argIndex: number,
    positionalArgNames: string[],
    classType: ClassType
) {
    let argName: string | undefined;
    if (arg.name) {
        argName = arg.name.value;
    } else if (argIndex < positionalArgNames.length) {
        argName = positionalArgNames[argIndex];
    }

    const useSelfForPattern =
        classPatternSpecialCases.some((className) => classType.details.fullName === className) &&
        argIndex === 0 &&
        !arg.name;

    let argType: Type | undefined;
    if (useSelfForPattern) {
        argType = ClassType.cloneAsInstance(classType);
    } else {
        if (argName) {
            argType = evaluator.useSpeculativeMode(arg, () =>
                // We need to apply a rather ugly cast here because PatternClassArgumentNode is
                // not technically an ExpressionNode, but it is OK to use it in this context.
                evaluator.getTypeFromObjectMember(
                    arg as any as ExpressionNode,
                    ClassType.cloneAsInstance(classType),
                    argName!
                )
            )?.type;
        }

        if (!argType) {
            argType = UnknownType.create();
        }
    }

    return narrowTypeBasedOnPattern(evaluator, argType, arg.pattern, /* isPositiveTest */ true);
}

function narrowTypeBasedOnValuePattern(
    evaluator: TypeEvaluator,
    type: Type,
    pattern: PatternValueNode,
    isPositiveTest: boolean
): Type {
    if (!isPositiveTest) {
        // Never narrow in negative case.
        return type;
    }

    const valueType = evaluator.getTypeOfExpression(pattern.expression).type;
    const narrowedSubtypes: Type[] = [];

    evaluator.mapSubtypesExpandTypeVars(
        valueType,
        /* conditionFilter */ undefined,
        (leftSubtypeExpanded, leftSubtypeUnexpanded) => {
            narrowedSubtypes.push(
                evaluator.mapSubtypesExpandTypeVars(
                    type,
                    getTypeCondition(leftSubtypeExpanded),
                    (_, rightSubtypeUnexpanded) => {
                        if (isNever(leftSubtypeExpanded) || isNever(rightSubtypeUnexpanded)) {
                            return NeverType.create();
                        }

                        if (isAnyOrUnknown(leftSubtypeExpanded) || isAnyOrUnknown(rightSubtypeUnexpanded)) {
                            // If either type is "Unknown" (versus Any), propagate the Unknown.
                            return isUnknown(leftSubtypeExpanded) || isUnknown(rightSubtypeUnexpanded)
                                ? UnknownType.create()
                                : AnyType.create();
                        }

                        // Determine if we assignment is supported for this combination of
                        // value subtype and matching subtype.
                        const returnType = evaluator.useSpeculativeMode(pattern.expression, () =>
                            evaluator.getTypeFromMagicMethodReturn(
                                leftSubtypeExpanded,
                                [rightSubtypeUnexpanded],
                                '__eq__',
                                pattern.expression,
                                /* expectedType */ undefined
                            )
                        );

                        return returnType ? leftSubtypeUnexpanded : undefined;
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
function getMappingPatternInfo(evaluator: TypeEvaluator, type: Type): MappingPatternInfo[] {
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
        } else if (isClassInstance(concreteSubtype)) {
            if (ClassType.isTypedDictClass(concreteSubtype)) {
                mappingInfo.push({
                    subtype,
                    typedDict: concreteSubtype,
                });
            } else {
                let mroClassToSpecialize: ClassType | undefined;
                for (const mroClass of concreteSubtype.details.mro) {
                    if (isInstantiableClass(mroClass) && ClassType.isBuiltIn(mroClass, 'Mapping')) {
                        mroClassToSpecialize = mroClass;
                        break;
                    }
                }

                if (mroClassToSpecialize) {
                    const specializedMapping = partiallySpecializeType(
                        mroClassToSpecialize,
                        concreteSubtype
                    ) as ClassType;
                    if (specializedMapping.typeArguments && specializedMapping.typeArguments.length >= 2) {
                        mappingInfo.push({
                            subtype,
                            dictTypeArgs: {
                                key: specializedMapping.typeArguments[0],
                                value: specializedMapping.typeArguments[1],
                            },
                        });
                    }
                }
            }
        }
    });

    return mappingInfo;
}

// Returns information about all subtypes that match the definition of a "sequence" as
// specified in PEP 634. Eliminates sequences that are not of sufficient length.
function getSequencePatternInfo(
    evaluator: TypeEvaluator,
    type: Type,
    entryCount: number,
    starEntryIndex: number | undefined
): SequencePatternInfo[] {
    const sequenceInfo: SequencePatternInfo[] = [];
    const minEntryCount = starEntryIndex === undefined ? entryCount : entryCount - 1;

    doForEachSubtype(type, (subtype) => {
        const concreteSubtype = evaluator.makeTopLevelTypeVarsConcrete(subtype);
        let mroClassToSpecialize: ClassType | undefined;

        if (isAnyOrUnknown(concreteSubtype)) {
            sequenceInfo.push({
                subtype,
                entryTypes: [concreteSubtype],
                isIndeterminateLength: true,
                isTuple: false,
            });
        } else if (isClassInstance(concreteSubtype)) {
            for (const mroClass of concreteSubtype.details.mro) {
                if (!isInstantiableClass(mroClass)) {
                    break;
                }

                // Strings and bytes are explicitly excluded.
                if (ClassType.isBuiltIn(mroClass, 'str')) {
                    break;
                }

                if (ClassType.isBuiltIn(mroClass, 'bytes')) {
                    break;
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
                    if (specializedSequence.tupleTypeArguments) {
                        if (isOpenEndedTupleClass(specializedSequence)) {
                            sequenceInfo.push({
                                subtype,
                                entryTypes: [specializedSequence.tupleTypeArguments[0]],
                                isIndeterminateLength: true,
                                isTuple: true,
                            });
                        } else {
                            if (
                                specializedSequence.tupleTypeArguments.length >= minEntryCount &&
                                (starEntryIndex !== undefined ||
                                    specializedSequence.tupleTypeArguments.length === minEntryCount)
                            ) {
                                sequenceInfo.push({
                                    subtype,
                                    entryTypes: specializedSequence.tupleTypeArguments,
                                    isIndeterminateLength: false,
                                    isTuple: true,
                                });
                            }
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
                        isTuple: false,
                    });
                }
            }
        }
    });

    return sequenceInfo;
}

function getTypeForPatternSequenceEntry(
    evaluator: TypeEvaluator,
    node: ParseNode,
    sequenceInfo: SequencePatternInfo,
    entryIndex: number,
    entryCount: number,
    starEntryIndex: number | undefined
): Type {
    if (sequenceInfo.isIndeterminateLength) {
        if (starEntryIndex === entryIndex) {
            const tupleClassType = evaluator.getBuiltInType(node, 'tuple');
            if (tupleClassType && isInstantiableClass(tupleClassType)) {
                return ClassType.cloneAsInstance(
                    specializeTupleClass(tupleClassType, [
                        sequenceInfo.entryTypes[0],
                        AnyType.create(/* isEllipsis */ true),
                    ])
                );
            } else {
                return UnknownType.create();
            }
        } else {
            return sequenceInfo.entryTypes[0];
        }
    } else if (starEntryIndex === undefined || entryIndex < starEntryIndex) {
        return sequenceInfo.entryTypes[entryIndex];
    } else if (entryIndex === starEntryIndex) {
        // Create a tuple out of the entries that map to the star entry.
        const starEntryTypes = sequenceInfo.entryTypes.slice(
            starEntryIndex,
            starEntryIndex + sequenceInfo.entryTypes.length - entryCount + 1
        );
        const tupleClassType = evaluator.getBuiltInType(node, 'tuple');
        if (tupleClassType && isInstantiableClass(tupleClassType)) {
            return ClassType.cloneAsInstance(specializeTupleClass(tupleClassType, starEntryTypes));
        } else {
            return UnknownType.create();
        }
    } else {
        // The entry index is past the index of the star entry, so we need
        // to index from the end of the sequence rather than the start.
        const itemIndex = sequenceInfo.entryTypes.length - (entryCount - entryIndex);
        assert(itemIndex >= 0 && itemIndex < sequenceInfo.entryTypes.length);
        return sequenceInfo.entryTypes[itemIndex];
    }
}

// Recursively assigns the specified type to the pattern and any capture
// nodes within it
export function assignTypeToPatternTargets(
    evaluator: TypeEvaluator,
    type: Type,
    isTypeIncomplete: boolean,
    pattern: PatternAtomNode
) {
    // Further narrow the type based on this pattern.
    type = narrowTypeBasedOnPattern(evaluator, type, pattern, /* positiveTest */ true);

    switch (pattern.nodeType) {
        case ParseNodeType.PatternSequence: {
            const sequenceInfo = getSequencePatternInfo(
                evaluator,
                type,
                pattern.entries.length,
                pattern.starEntryIndex
            );

            pattern.entries.forEach((entry, index) => {
                const entryType = combineTypes(
                    sequenceInfo.map((info) =>
                        getTypeForPatternSequenceEntry(
                            evaluator,
                            pattern,
                            info,
                            index,
                            pattern.entries.length,
                            pattern.starEntryIndex
                        )
                    )
                );

                assignTypeToPatternTargets(evaluator, entryType, isTypeIncomplete, entry);
            });
            break;
        }

        case ParseNodeType.PatternAs: {
            if (pattern.target) {
                evaluator.assignTypeToExpression(pattern.target, type, isTypeIncomplete, pattern.target);
            }

            pattern.orPatterns.forEach((orPattern) => {
                assignTypeToPatternTargets(evaluator, type, isTypeIncomplete, orPattern);

                // OR patterns are evaluated left to right, so we can narrow
                // the type as we go.
                type = narrowTypeBasedOnPattern(evaluator, type, orPattern, /* positiveTest */ false);
            });
            break;
        }

        case ParseNodeType.PatternCapture: {
            evaluator.assignTypeToExpression(
                pattern.target,
                pattern.isWildcard ? AnyType.create() : type,
                isTypeIncomplete,
                pattern.target
            );
            break;
        }

        case ParseNodeType.PatternMapping: {
            const mappingInfo = getMappingPatternInfo(evaluator, type);

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
                                    const valueInfo = tdEntries.get(keySubtype.literalValue as string);
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

            evaluator.mapSubtypesExpandTypeVars(type, /* conditionFilter */ undefined, (expandedSubtype) => {
                if (isClassInstance(expandedSubtype)) {
                    doForEachSubtype(type, (matchSubtype) => {
                        const concreteSubtype = evaluator.makeTopLevelTypeVarsConcrete(matchSubtype);

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
                                    ClassType.cloneAsInstantiable(expandedSubtype)
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
}
