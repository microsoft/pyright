/*
 * typeGuards.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Provides logic for narrowing types based on conditional
 * expressions. The logic handles both positive ("if") and
 * negative ("else") narrowing cases.
 */

import { assert } from '../common/debug';
import {
    ArgumentCategory,
    AssignmentExpressionNode,
    ExpressionNode,
    isExpressionNode,
    NameNode,
    ParameterCategory,
    ParseNode,
    ParseNodeType,
} from '../parser/parseNodes';
import { KeywordType, OperatorType } from '../parser/tokenizerTypes';
import { getFileInfo } from './analyzerNodeInfo';
import { populateTypeVarContextBasedOnExpectedType } from './constraintSolver';
import { Declaration, DeclarationType } from './declaration';
import { transformTypeForEnumMember } from './enums';
import * as ParseTreeUtils from './parseTreeUtils';
import { ScopeType } from './scope';
import { getScopeForNode } from './scopeUtils';
import { Symbol, SymbolFlags } from './symbol';
import { getTypedDictMembersForClass } from './typedDicts';
import { EvaluatorFlags, TypeEvaluator } from './typeEvaluatorTypes';
import {
    ClassType,
    ClassTypeFlags,
    combineTypes,
    EnumLiteral,
    FunctionParameter,
    FunctionType,
    isAnyOrUnknown,
    isClass,
    isClassInstance,
    isFunction,
    isInstantiableClass,
    isModule,
    isNever,
    isOverloadedFunction,
    isParamSpec,
    isSameWithoutLiteralValue,
    isTypeSame,
    isTypeVar,
    isUnpackedVariadicTypeVar,
    maxTypeRecursionCount,
    OverloadedFunctionType,
    TupleTypeArgument,
    Type,
    TypeBase,
    TypeCategory,
    TypeCondition,
    TypedDictEntry,
    TypeVarType,
    UnknownType,
} from './types';
import {
    addConditionToType,
    applySolvedTypeVars,
    AssignTypeFlags,
    ClassMember,
    computeMroLinearization,
    convertToInstance,
    convertToInstantiable,
    doForEachSubtype,
    getSpecializedTupleType,
    getTypeCondition,
    getTypeVarScopeId,
    getUnknownTypeForCallable,
    isInstantiableMetaclass,
    isLiteralType,
    isLiteralTypeOrUnion,
    isMaybeDescriptorInstance,
    isMetaclassInstance,
    isNoneInstance,
    isNoneTypeClass,
    isProperty,
    isTupleClass,
    isUnboundedTupleClass,
    lookUpClassMember,
    lookUpObjectMember,
    mapSubtypes,
    MemberAccessFlags,
    specializeTupleClass,
    specializeWithUnknownTypeArgs,
    transformPossibleRecursiveTypeAlias,
} from './typeUtils';
import { TypeVarContext } from './typeVarContext';

export interface TypeNarrowingResult {
    type: Type;
    isIncomplete: boolean;
}

export type TypeNarrowingCallback = (type: Type) => TypeNarrowingResult | undefined;

// Given a reference expression and a test expression, returns a callback that
// can be used to narrow the type described by the reference expression.
// If the specified flow node is not associated with the test expression,
// it returns undefined.
export function getTypeNarrowingCallback(
    evaluator: TypeEvaluator,
    reference: ExpressionNode,
    testExpression: ExpressionNode,
    isPositiveTest: boolean,
    recursionCount = 0
): TypeNarrowingCallback | undefined {
    if (recursionCount > maxTypeRecursionCount) {
        return undefined;
    }

    recursionCount++;

    if (testExpression.nodeType === ParseNodeType.AssignmentExpression) {
        return getTypeNarrowingCallbackForAssignmentExpression(
            evaluator,
            reference,
            testExpression,
            isPositiveTest,
            recursionCount
        );
    }

    if (testExpression.nodeType === ParseNodeType.BinaryOperation) {
        const isOrIsNotOperator =
            testExpression.operator === OperatorType.Is || testExpression.operator === OperatorType.IsNot;
        const equalsOrNotEqualsOperator =
            testExpression.operator === OperatorType.Equals || testExpression.operator === OperatorType.NotEquals;
        const comparisonOperator =
            equalsOrNotEqualsOperator ||
            testExpression.operator === OperatorType.LessThan ||
            testExpression.operator === OperatorType.LessThanOrEqual ||
            testExpression.operator === OperatorType.GreaterThan ||
            testExpression.operator === OperatorType.GreaterThanOrEqual;

        if (isOrIsNotOperator || equalsOrNotEqualsOperator) {
            // Invert the "isPositiveTest" value if this is an "is not" operation.
            const adjIsPositiveTest =
                testExpression.operator === OperatorType.Is || testExpression.operator === OperatorType.Equals
                    ? isPositiveTest
                    : !isPositiveTest;

            // Look for "X is None", "X is not None", "X == None", and "X != None".
            // These are commonly-used patterns used in control flow.
            if (
                testExpression.rightExpression.nodeType === ParseNodeType.Constant &&
                testExpression.rightExpression.constType === KeywordType.None
            ) {
                // Allow the LHS to be either a simple expression or an assignment
                // expression that assigns to a simple name.
                let leftExpression = testExpression.leftExpression;
                if (leftExpression.nodeType === ParseNodeType.AssignmentExpression) {
                    leftExpression = leftExpression.name;
                }

                if (ParseTreeUtils.isMatchingExpression(reference, leftExpression)) {
                    return (type: Type) => {
                        return { type: narrowTypeForIsNone(evaluator, type, adjIsPositiveTest), isIncomplete: false };
                    };
                }

                if (
                    leftExpression.nodeType === ParseNodeType.Index &&
                    ParseTreeUtils.isMatchingExpression(reference, leftExpression.baseExpression) &&
                    leftExpression.items.length === 1 &&
                    !leftExpression.trailingComma &&
                    leftExpression.items[0].argumentCategory === ArgumentCategory.Simple &&
                    !leftExpression.items[0].name &&
                    leftExpression.items[0].valueExpression.nodeType === ParseNodeType.Number &&
                    leftExpression.items[0].valueExpression.isInteger &&
                    !leftExpression.items[0].valueExpression.isImaginary
                ) {
                    const indexValue = leftExpression.items[0].valueExpression.value;
                    if (typeof indexValue === 'number') {
                        return (type: Type) => {
                            return {
                                type: narrowTupleTypeForIsNone(evaluator, type, adjIsPositiveTest, indexValue),
                                isIncomplete: false,
                            };
                        };
                    }
                }
            }

            // Look for "X is ...", "X is not ...", "X == ...", and "X != ...".
            if (testExpression.rightExpression.nodeType === ParseNodeType.Ellipsis) {
                // Allow the LHS to be either a simple expression or an assignment
                // expression that assigns to a simple name.
                let leftExpression = testExpression.leftExpression;
                if (leftExpression.nodeType === ParseNodeType.AssignmentExpression) {
                    leftExpression = leftExpression.name;
                }

                if (ParseTreeUtils.isMatchingExpression(reference, leftExpression)) {
                    return (type: Type) => {
                        return {
                            type: narrowTypeForIsEllipsis(evaluator, type, adjIsPositiveTest),
                            isIncomplete: false,
                        };
                    };
                }
            }

            // Look for "type(X) is Y", "type(X) is not Y", "type(X) == Y" or "type(X) != Y".
            if (testExpression.leftExpression.nodeType === ParseNodeType.Call) {
                if (
                    testExpression.leftExpression.arguments.length === 1 &&
                    testExpression.leftExpression.arguments[0].argumentCategory === ArgumentCategory.Simple
                ) {
                    const arg0Expr = testExpression.leftExpression.arguments[0].valueExpression;
                    if (ParseTreeUtils.isMatchingExpression(reference, arg0Expr)) {
                        const callType = evaluator.getTypeOfExpression(
                            testExpression.leftExpression.leftExpression,
                            EvaluatorFlags.CallBaseDefaults
                        ).type;

                        if (isInstantiableClass(callType) && ClassType.isBuiltIn(callType, 'type')) {
                            const classTypeResult = evaluator.getTypeOfExpression(testExpression.rightExpression);
                            const classType = evaluator.makeTopLevelTypeVarsConcrete(classTypeResult.type);

                            if (isInstantiableClass(classType)) {
                                return (type: Type) => {
                                    return {
                                        type: narrowTypeForTypeIs(evaluator, type, classType, adjIsPositiveTest),
                                        isIncomplete: !!classTypeResult.isIncomplete,
                                    };
                                };
                            }
                        }
                    }
                }
            }

            if (isOrIsNotOperator) {
                if (ParseTreeUtils.isMatchingExpression(reference, testExpression.leftExpression)) {
                    const rightTypeResult = evaluator.getTypeOfExpression(testExpression.rightExpression);
                    const rightType = rightTypeResult.type;

                    // Look for "X is Y" or "X is not Y" where Y is a an enum or bool literal.
                    if (
                        isClassInstance(rightType) &&
                        (ClassType.isEnumClass(rightType) || ClassType.isBuiltIn(rightType, 'bool')) &&
                        rightType.literalValue !== undefined
                    ) {
                        return (type: Type) => {
                            return {
                                type: narrowTypeForLiteralComparison(
                                    evaluator,
                                    type,
                                    rightType,
                                    adjIsPositiveTest,
                                    /* isIsOperator */ true
                                ),
                                isIncomplete: !!rightTypeResult.isIncomplete,
                            };
                        };
                    }

                    // Look for X is <class> or X is not <class>.
                    if (isInstantiableClass(rightType)) {
                        return (type: Type) => {
                            return {
                                type: narrowTypeForClassComparison(evaluator, type, rightType, adjIsPositiveTest),
                                isIncomplete: !!rightTypeResult.isIncomplete,
                            };
                        };
                    }
                }

                // Look for X[<literal>] is <literal> or X[<literal>] is not <literal>.
                if (
                    testExpression.leftExpression.nodeType === ParseNodeType.Index &&
                    testExpression.leftExpression.items.length === 1 &&
                    !testExpression.leftExpression.trailingComma &&
                    testExpression.leftExpression.items[0].argumentCategory === ArgumentCategory.Simple &&
                    ParseTreeUtils.isMatchingExpression(reference, testExpression.leftExpression.baseExpression)
                ) {
                    const indexTypeResult = evaluator.getTypeOfExpression(
                        testExpression.leftExpression.items[0].valueExpression
                    );
                    const indexType = indexTypeResult.type;

                    if (isClassInstance(indexType) && isLiteralType(indexType)) {
                        if (ClassType.isBuiltIn(indexType, 'str')) {
                            const rightType = evaluator.getTypeOfExpression(testExpression.rightExpression).type;
                            if (isClassInstance(rightType) && rightType.literalValue !== undefined) {
                                return (type: Type) => {
                                    return {
                                        type: narrowTypeForDiscriminatedDictEntryComparison(
                                            evaluator,
                                            type,
                                            indexType,
                                            rightType,
                                            adjIsPositiveTest
                                        ),
                                        isIncomplete: !!indexTypeResult.isIncomplete,
                                    };
                                };
                            }
                        } else if (ClassType.isBuiltIn(indexType, 'int')) {
                            const rightTypeResult = evaluator.getTypeOfExpression(testExpression.rightExpression);
                            const rightType = rightTypeResult.type;

                            if (isClassInstance(rightType) && rightType.literalValue !== undefined) {
                                let canNarrow = false;
                                // Narrowing can be applied only for bool or enum literals.
                                if (ClassType.isBuiltIn(rightType, 'bool')) {
                                    canNarrow = true;
                                } else if (rightType.literalValue instanceof EnumLiteral) {
                                    canNarrow = true;
                                }

                                if (canNarrow) {
                                    return (type: Type) => {
                                        return {
                                            type: narrowTypeForDiscriminatedTupleComparison(
                                                evaluator,
                                                type,
                                                indexType,
                                                rightType,
                                                adjIsPositiveTest
                                            ),
                                            isIncomplete: !!rightTypeResult.isIncomplete,
                                        };
                                    };
                                }
                            }
                        }
                    }
                }
            }

            if (equalsOrNotEqualsOperator) {
                // Look for X == <literal> or X != <literal>
                const adjIsPositiveTest =
                    testExpression.operator === OperatorType.Equals ? isPositiveTest : !isPositiveTest;

                if (ParseTreeUtils.isMatchingExpression(reference, testExpression.leftExpression)) {
                    // Use speculative mode here to avoid polluting the type cache. This is
                    // important in cases where evaluation of the right expression creates
                    // a false dependency on another variable.
                    const rightTypeResult = evaluator.useSpeculativeMode(testExpression.rightExpression, () => {
                        return evaluator.getTypeOfExpression(testExpression.rightExpression);
                    });

                    const rightType = rightTypeResult.type;

                    if (isClassInstance(rightType) && rightType.literalValue !== undefined) {
                        return (type: Type) => {
                            return {
                                type: narrowTypeForLiteralComparison(
                                    evaluator,
                                    type,
                                    rightType,
                                    adjIsPositiveTest,
                                    /* isIsOperator */ false
                                ),
                                isIncomplete: !!rightTypeResult.isIncomplete,
                            };
                        };
                    }
                }

                // Look for X[<literal>] == <literal> or X[<literal>] != <literal>
                if (
                    testExpression.leftExpression.nodeType === ParseNodeType.Index &&
                    testExpression.leftExpression.items.length === 1 &&
                    !testExpression.leftExpression.trailingComma &&
                    testExpression.leftExpression.items[0].argumentCategory === ArgumentCategory.Simple &&
                    ParseTreeUtils.isMatchingExpression(reference, testExpression.leftExpression.baseExpression)
                ) {
                    const indexTypeResult = evaluator.getTypeOfExpression(
                        testExpression.leftExpression.items[0].valueExpression
                    );
                    const indexType = indexTypeResult.type;

                    if (isClassInstance(indexType) && isLiteralType(indexType)) {
                        if (ClassType.isBuiltIn(indexType, ['str', 'int'])) {
                            const rightTypeResult = evaluator.getTypeOfExpression(testExpression.rightExpression);
                            const rightType = rightTypeResult.type;

                            if (isLiteralTypeOrUnion(rightType)) {
                                return (type: Type) => {
                                    let narrowedType: Type;

                                    if (ClassType.isBuiltIn(indexType, 'str')) {
                                        narrowedType = narrowTypeForDiscriminatedDictEntryComparison(
                                            evaluator,
                                            type,
                                            indexType,
                                            rightType,
                                            adjIsPositiveTest
                                        );
                                    } else {
                                        narrowedType = narrowTypeForDiscriminatedTupleComparison(
                                            evaluator,
                                            type,
                                            indexType,
                                            rightType,
                                            adjIsPositiveTest
                                        );
                                    }

                                    return {
                                        type: narrowedType,
                                        isIncomplete: !!indexTypeResult.isIncomplete || !!rightTypeResult.isIncomplete,
                                    };
                                };
                            }
                        }
                    }
                }
            }

            // Look for X.Y == <literal> or X.Y != <literal>
            if (
                equalsOrNotEqualsOperator &&
                testExpression.leftExpression.nodeType === ParseNodeType.MemberAccess &&
                ParseTreeUtils.isMatchingExpression(reference, testExpression.leftExpression.leftExpression)
            ) {
                const rightTypeResult = evaluator.getTypeOfExpression(testExpression.rightExpression);
                const rightType = rightTypeResult.type;
                const memberName = testExpression.leftExpression.memberName;

                if (isClassInstance(rightType)) {
                    if (rightType.literalValue !== undefined || isNoneInstance(rightType)) {
                        return (type: Type) => {
                            return {
                                type: narrowTypeForDiscriminatedLiteralFieldComparison(
                                    evaluator,
                                    type,
                                    memberName.value,
                                    rightType,
                                    adjIsPositiveTest
                                ),
                                isIncomplete: !!rightTypeResult.isIncomplete,
                            };
                        };
                    }
                }
            }

            // Look for X.Y is <literal> or X.Y is not <literal> where <literal> is
            // an enum or bool literal
            if (
                testExpression.leftExpression.nodeType === ParseNodeType.MemberAccess &&
                ParseTreeUtils.isMatchingExpression(reference, testExpression.leftExpression.leftExpression)
            ) {
                const rightTypeResult = evaluator.getTypeOfExpression(testExpression.rightExpression);
                const rightType = rightTypeResult.type;
                const memberName = testExpression.leftExpression.memberName;

                if (
                    isClassInstance(rightType) &&
                    (ClassType.isEnumClass(rightType) || ClassType.isBuiltIn(rightType, 'bool')) &&
                    rightType.literalValue !== undefined
                ) {
                    return (type: Type) => {
                        return {
                            type: narrowTypeForDiscriminatedLiteralFieldComparison(
                                evaluator,
                                type,
                                memberName.value,
                                rightType,
                                adjIsPositiveTest
                            ),
                            isIncomplete: !!rightTypeResult.isIncomplete,
                        };
                    };
                }
            }

            // Look for X.Y is None or X.Y is not None
            // These are commonly-used patterns used in control flow.
            if (
                testExpression.leftExpression.nodeType === ParseNodeType.MemberAccess &&
                ParseTreeUtils.isMatchingExpression(reference, testExpression.leftExpression.leftExpression) &&
                testExpression.rightExpression.nodeType === ParseNodeType.Constant &&
                testExpression.rightExpression.constType === KeywordType.None
            ) {
                const memberName = testExpression.leftExpression.memberName;
                return (type: Type) => {
                    return {
                        type: narrowTypeForDiscriminatedFieldNoneComparison(
                            evaluator,
                            type,
                            memberName.value,
                            adjIsPositiveTest
                        ),
                        isIncomplete: false,
                    };
                };
            }
        }

        // Look for len(x) == <literal>, len(x) != <literal>, len(x) < <literal>, etc.
        if (
            comparisonOperator &&
            testExpression.leftExpression.nodeType === ParseNodeType.Call &&
            testExpression.leftExpression.arguments.length === 1
        ) {
            const arg0Expr = testExpression.leftExpression.arguments[0].valueExpression;

            if (ParseTreeUtils.isMatchingExpression(reference, arg0Expr)) {
                const callTypeResult = evaluator.getTypeOfExpression(
                    testExpression.leftExpression.leftExpression,
                    EvaluatorFlags.CallBaseDefaults
                );
                const callType = callTypeResult.type;

                if (isFunction(callType) && callType.details.fullName === 'builtins.len') {
                    const rightTypeResult = evaluator.getTypeOfExpression(testExpression.rightExpression);
                    const rightType = rightTypeResult.type;

                    if (
                        isClassInstance(rightType) &&
                        typeof rightType.literalValue === 'number' &&
                        rightType.literalValue >= 0
                    ) {
                        let tupleLength = rightType.literalValue;

                        // We'll treat <, <= and == as positive tests with >=, > and != as
                        // their negative counterparts.
                        const isLessOrEqual =
                            testExpression.operator === OperatorType.Equals ||
                            testExpression.operator === OperatorType.LessThan ||
                            testExpression.operator === OperatorType.LessThanOrEqual;

                        const adjIsPositiveTest = isLessOrEqual ? isPositiveTest : !isPositiveTest;

                        // For <= (or its negative counterpart >), adjust the tuple length by 1.
                        if (
                            testExpression.operator === OperatorType.LessThanOrEqual ||
                            testExpression.operator === OperatorType.GreaterThan
                        ) {
                            tupleLength++;
                        }

                        const isEqualityCheck =
                            testExpression.operator === OperatorType.Equals ||
                            testExpression.operator === OperatorType.NotEquals;

                        return (type: Type) => {
                            return {
                                type: narrowTypeForTupleLength(
                                    evaluator,
                                    type,
                                    tupleLength,
                                    adjIsPositiveTest,
                                    !isEqualityCheck
                                ),
                                isIncomplete: !!callTypeResult.isIncomplete || !!rightTypeResult.isIncomplete,
                            };
                        };
                    }
                }
            }
        }

        if (testExpression.operator === OperatorType.In || testExpression.operator === OperatorType.NotIn) {
            // Look for "x in y" or "x not in y" where y is one of several built-in types.
            if (ParseTreeUtils.isMatchingExpression(reference, testExpression.leftExpression)) {
                const rightTypeResult = evaluator.getTypeOfExpression(testExpression.rightExpression);
                const rightType = rightTypeResult.type;
                const adjIsPositiveTest =
                    testExpression.operator === OperatorType.In ? isPositiveTest : !isPositiveTest;

                return (type: Type) => {
                    return {
                        type: narrowTypeForContainerType(evaluator, type, rightType, adjIsPositiveTest),
                        isIncomplete: !!rightTypeResult.isIncomplete,
                    };
                };
            }

            if (ParseTreeUtils.isMatchingExpression(reference, testExpression.rightExpression)) {
                // Look for <string literal> in y where y is a union that contains
                // one or more TypedDicts.
                const leftTypeResult = evaluator.getTypeOfExpression(testExpression.leftExpression);
                const leftType = leftTypeResult.type;

                if (isClassInstance(leftType) && ClassType.isBuiltIn(leftType, 'str') && isLiteralType(leftType)) {
                    const adjIsPositiveTest =
                        testExpression.operator === OperatorType.In ? isPositiveTest : !isPositiveTest;
                    return (type: Type) => {
                        return {
                            type: narrowTypeForTypedDictKey(
                                evaluator,
                                type,
                                ClassType.cloneAsInstantiable(leftType),
                                adjIsPositiveTest
                            ),
                            isIncomplete: !!leftTypeResult.isIncomplete,
                        };
                    };
                }
            }
        }
    }

    if (testExpression.nodeType === ParseNodeType.Call) {
        // Look for "isinstance(X, Y)" or "issubclass(X, Y)".
        if (testExpression.arguments.length === 2) {
            // Make sure the first parameter is a supported expression type
            // and the second parameter is a valid class type or a tuple
            // of valid class types.
            const arg0Expr = testExpression.arguments[0].valueExpression;
            const arg1Expr = testExpression.arguments[1].valueExpression;

            if (ParseTreeUtils.isMatchingExpression(reference, arg0Expr)) {
                const callTypeResult = evaluator.getTypeOfExpression(
                    testExpression.leftExpression,
                    EvaluatorFlags.CallBaseDefaults
                );
                const callType = callTypeResult.type;

                if (
                    isFunction(callType) &&
                    (callType.details.builtInName === 'isinstance' || callType.details.builtInName === 'issubclass')
                ) {
                    const isInstanceCheck = callType.details.builtInName === 'isinstance';
                    const arg1TypeResult = evaluator.getTypeOfExpression(
                        arg1Expr,
                        EvaluatorFlags.AllowMissingTypeArgs |
                            EvaluatorFlags.EvaluateStringLiteralAsType |
                            EvaluatorFlags.DisallowParamSpec |
                            EvaluatorFlags.DisallowTypeVarTuple |
                            EvaluatorFlags.DisallowFinal |
                            EvaluatorFlags.DoNotSpecialize
                    );
                    const arg1Type = arg1TypeResult.type;

                    const classTypeList = getIsInstanceClassTypes(arg1Type);
                    const isIncomplete = !!callTypeResult.isIncomplete || !!arg1TypeResult.isIncomplete;

                    if (classTypeList) {
                        return (type: Type) => {
                            return {
                                type: narrowTypeForIsInstance(
                                    evaluator,
                                    type,
                                    classTypeList,
                                    isInstanceCheck,
                                    /* isTypeIsCheck */ false,
                                    isPositiveTest,
                                    testExpression
                                ),
                                isIncomplete,
                            };
                        };
                    } else if (isIncomplete) {
                        // If the type is incomplete, it may include unknowns, which will result
                        // in classTypeList being undefined.
                        return (type: Type) => {
                            return {
                                type,
                                isIncomplete: true,
                            };
                        };
                    }
                }
            }
        }

        // Look for "callable(X)"
        if (testExpression.arguments.length === 1) {
            const arg0Expr = testExpression.arguments[0].valueExpression;
            if (ParseTreeUtils.isMatchingExpression(reference, arg0Expr)) {
                const callTypeResult = evaluator.getTypeOfExpression(
                    testExpression.leftExpression,
                    EvaluatorFlags.CallBaseDefaults
                );
                const callType = callTypeResult.type;

                if (isFunction(callType) && callType.details.builtInName === 'callable') {
                    return (type: Type) => {
                        let narrowedType = narrowTypeForCallable(
                            evaluator,
                            type,
                            isPositiveTest,
                            testExpression,
                            /* allowIntersections */ false
                        );
                        if (isPositiveTest && isNever(narrowedType)) {
                            // Try again with intersections allowed.
                            narrowedType = narrowTypeForCallable(
                                evaluator,
                                type,
                                isPositiveTest,
                                testExpression,
                                /* allowIntersections */ true
                            );
                        }

                        return { type: narrowedType, isIncomplete: !!callTypeResult.isIncomplete };
                    };
                }
            }
        }

        // Look for "bool(X)"
        if (testExpression.arguments.length === 1 && !testExpression.arguments[0].name) {
            if (ParseTreeUtils.isMatchingExpression(reference, testExpression.arguments[0].valueExpression)) {
                const callTypeResult = evaluator.getTypeOfExpression(
                    testExpression.leftExpression,
                    EvaluatorFlags.CallBaseDefaults
                );
                const callType = callTypeResult.type;

                if (isInstantiableClass(callType) && ClassType.isBuiltIn(callType, 'bool')) {
                    return (type: Type) => {
                        return {
                            type: narrowTypeForTruthiness(evaluator, type, isPositiveTest),
                            isIncomplete: !!callTypeResult.isIncomplete,
                        };
                    };
                }
            }
        }

        // Look for a TypeGuard function.
        if (testExpression.arguments.length >= 1) {
            const arg0Expr = testExpression.arguments[0].valueExpression;
            if (ParseTreeUtils.isMatchingExpression(reference, arg0Expr)) {
                // Does this look like it's a custom type guard function?
                let isPossiblyTypeGuard = false;

                const isFunctionReturnTypeGuard = (type: FunctionType) => {
                    return (
                        type.details.declaredReturnType &&
                        isClassInstance(type.details.declaredReturnType) &&
                        ClassType.isBuiltIn(type.details.declaredReturnType, ['TypeGuard', 'TypeIs'])
                    );
                };

                const callTypeResult = evaluator.getTypeOfExpression(
                    testExpression.leftExpression,
                    EvaluatorFlags.CallBaseDefaults
                );
                const callType = callTypeResult.type;

                if (isFunction(callType) && isFunctionReturnTypeGuard(callType)) {
                    isPossiblyTypeGuard = true;
                } else if (
                    isOverloadedFunction(callType) &&
                    OverloadedFunctionType.getOverloads(callType).some((o) => isFunctionReturnTypeGuard(o))
                ) {
                    isPossiblyTypeGuard = true;
                } else if (isClassInstance(callType)) {
                    isPossiblyTypeGuard = true;
                }

                if (isPossiblyTypeGuard) {
                    // Evaluate the type guard call expression.
                    const functionReturnTypeResult = evaluator.getTypeOfExpression(testExpression);
                    const functionReturnType = functionReturnTypeResult.type;

                    if (
                        isClassInstance(functionReturnType) &&
                        ClassType.isBuiltIn(functionReturnType, 'bool') &&
                        functionReturnType.typeGuardType
                    ) {
                        const isStrictTypeGuard = !!functionReturnType.isStrictTypeGuard;
                        const typeGuardType = functionReturnType.typeGuardType;
                        const isIncomplete = !!callTypeResult.isIncomplete || !!functionReturnTypeResult.isIncomplete;

                        return (type: Type) => {
                            return {
                                type: narrowTypeForUserDefinedTypeGuard(
                                    evaluator,
                                    type,
                                    typeGuardType,
                                    isPositiveTest,
                                    isStrictTypeGuard,
                                    testExpression
                                ),
                                isIncomplete,
                            };
                        };
                    }
                }
            }
        }
    }

    if (ParseTreeUtils.isMatchingExpression(reference, testExpression)) {
        return (type: Type) => {
            return {
                type: narrowTypeForTruthiness(evaluator, type, isPositiveTest),
                isIncomplete: false,
            };
        };
    }

    // Is this a reference to an aliased conditional expression (a local variable
    // that was assigned a value that can inform type narrowing of the reference expression)?
    const narrowingCallback = getTypeNarrowingCallbackForAliasedCondition(
        evaluator,
        reference,
        testExpression,
        isPositiveTest,
        recursionCount
    );
    if (narrowingCallback) {
        return narrowingCallback;
    }

    // We normally won't find a "not" operator here because they are stripped out
    // by the binder when it creates condition flow nodes, but we can find this
    // in the case of local variables type narrowing.
    if (reference.nodeType === ParseNodeType.Name) {
        if (testExpression.nodeType === ParseNodeType.UnaryOperation && testExpression.operator === OperatorType.Not) {
            return getTypeNarrowingCallback(
                evaluator,
                reference,
                testExpression.expression,
                !isPositiveTest,
                recursionCount
            );
        }
    }

    return undefined;
}

function getTypeNarrowingCallbackForAliasedCondition(
    evaluator: TypeEvaluator,
    reference: ExpressionNode,
    testExpression: ExpressionNode,
    isPositiveTest: boolean,
    recursionCount: number
) {
    if (
        testExpression.nodeType !== ParseNodeType.Name ||
        reference.nodeType !== ParseNodeType.Name ||
        testExpression === reference
    ) {
        return undefined;
    }

    // Make sure the reference expression is a constant parameter or variable.
    // If the reference expression is modified within the scope multiple times,
    // we need to validate that it is not modified between the test expression
    // evaluation and the conditional check.
    const testExprDecl = getDeclsForLocalVar(evaluator, testExpression, testExpression, /* requireUnique */ true);
    if (!testExprDecl || testExprDecl.length !== 1 || testExprDecl[0].type !== DeclarationType.Variable) {
        return undefined;
    }

    const referenceDecls = getDeclsForLocalVar(evaluator, reference, testExpression, /* requireUnique */ false);
    if (!referenceDecls) {
        return undefined;
    }

    let modifyingDecls: Declaration[] = [];
    if (referenceDecls.length > 1) {
        // If there is more than one assignment to the reference variable within
        // the local scope, make sure that none of these assignments are done
        // after the test expression but before the condition check.
        //
        // This is OK:
        //  val = None
        //  is_none = val is None
        //  if is_none: ...
        //
        // This is not OK:
        //  val = None
        //  is_none = val is None
        //  val = 1
        //  if is_none: ...
        modifyingDecls = referenceDecls.filter((decl) => {
            return (
                evaluator.isNodeReachable(testExpression, decl.node) &&
                evaluator.isNodeReachable(decl.node, testExprDecl[0].node)
            );
        });
    }

    if (modifyingDecls.length !== 0) {
        return undefined;
    }

    const initNode = testExprDecl[0].inferredTypeSource;

    if (!initNode || ParseTreeUtils.isNodeContainedWithin(testExpression, initNode) || !isExpressionNode(initNode)) {
        return undefined;
    }

    return getTypeNarrowingCallback(evaluator, reference, initNode, isPositiveTest, recursionCount);
}

// Determines whether the symbol is a local variable or parameter within
// the current scope. If requireUnique is true, there can be only one
// declaration (assignment) of the symbol, otherwise it is rejected.
function getDeclsForLocalVar(
    evaluator: TypeEvaluator,
    name: NameNode,
    reachableFrom: ParseNode,
    requireUnique: boolean
): Declaration[] | undefined {
    const scope = getScopeForNode(name);
    if (scope?.type !== ScopeType.Function && scope?.type !== ScopeType.Module) {
        return undefined;
    }

    const symbol = scope.lookUpSymbol(name.value);
    if (!symbol) {
        return undefined;
    }

    const decls = symbol.getDeclarations();
    if (requireUnique && decls.length > 1) {
        return undefined;
    }

    if (
        decls.length === 0 ||
        decls.some((decl) => decl.type !== DeclarationType.Variable && decl.type !== DeclarationType.Parameter)
    ) {
        return undefined;
    }

    // If there are any assignments within different scopes (e.g. via a "global" or
    // "nonlocal" reference), don't consider it a local variable.
    let prevDeclScope: ParseNode | undefined;
    if (
        decls.some((decl) => {
            const nodeToConsider = decl.type === DeclarationType.Parameter ? decl.node.name! : decl.node;
            const declScopeNode = ParseTreeUtils.getExecutionScopeNode(nodeToConsider);
            if (prevDeclScope && declScopeNode !== prevDeclScope) {
                return true;
            }
            prevDeclScope = declScopeNode;
            return false;
        })
    ) {
        return undefined;
    }

    const reachableDecls = decls.filter((decl) => evaluator.isNodeReachable(reachableFrom, decl.node));

    return reachableDecls.length > 0 ? reachableDecls : undefined;
}

function getTypeNarrowingCallbackForAssignmentExpression(
    evaluator: TypeEvaluator,
    reference: ExpressionNode,
    testExpression: AssignmentExpressionNode,
    isPositiveTest: boolean,
    recursionCount: number
) {
    return (
        getTypeNarrowingCallback(
            evaluator,
            reference,
            testExpression.rightExpression,
            isPositiveTest,
            recursionCount
        ) ?? getTypeNarrowingCallback(evaluator, reference, testExpression.name, isPositiveTest, recursionCount)
    );
}

function narrowTypeForUserDefinedTypeGuard(
    evaluator: TypeEvaluator,
    type: Type,
    typeGuardType: Type,
    isPositiveTest: boolean,
    isStrictTypeGuard: boolean,
    errorNode: ExpressionNode
): Type {
    // For non-strict type guards, always narrow to the typeGuardType
    // in the positive case and don't narrow in the negative case.
    if (!isStrictTypeGuard) {
        return isPositiveTest ? typeGuardType : type;
    }

    const filterTypes: Type[] = [];
    doForEachSubtype(typeGuardType, (typeGuardSubtype) => {
        filterTypes.push(convertToInstantiable(typeGuardSubtype));
    });

    return narrowTypeForIsInstance(
        evaluator,
        type,
        filterTypes,
        /* isInstanceCheck */ true,
        /* isTypeIsCheck */ true,
        isPositiveTest,
        errorNode
    );
}

// Narrow the type based on whether the subtype can be true or false.
function narrowTypeForTruthiness(evaluator: TypeEvaluator, type: Type, isPositiveTest: boolean) {
    return mapSubtypes(type, (subtype) => {
        if (isPositiveTest) {
            if (evaluator.canBeTruthy(subtype)) {
                return evaluator.removeFalsinessFromType(subtype);
            }
        } else {
            if (evaluator.canBeFalsy(subtype)) {
                return evaluator.removeTruthinessFromType(subtype);
            }
        }
        return undefined;
    });
}

// Handle type narrowing for expressions of the form "a[I] is None" and "a[I] is not None" where
// I is an integer and a is a union of Tuples (or subtypes thereof) with known lengths and entry types.
function narrowTupleTypeForIsNone(evaluator: TypeEvaluator, type: Type, isPositiveTest: boolean, indexValue: number) {
    return evaluator.mapSubtypesExpandTypeVars(type, /* options */ undefined, (subtype) => {
        const tupleType = getSpecializedTupleType(subtype);
        if (!tupleType || isUnboundedTupleClass(tupleType) || !tupleType.tupleTypeArguments) {
            return subtype;
        }

        const tupleLength = tupleType.tupleTypeArguments.length;
        if (indexValue < 0 || indexValue >= tupleLength) {
            return subtype;
        }

        const typeOfEntry = evaluator.makeTopLevelTypeVarsConcrete(tupleType.tupleTypeArguments[indexValue].type);

        if (isPositiveTest) {
            if (!evaluator.assignType(typeOfEntry, evaluator.getNoneType())) {
                return undefined;
            }
        } else {
            if (isNoneInstance(typeOfEntry)) {
                return undefined;
            }
        }

        return subtype;
    });
}

// Handle type narrowing for expressions of the form "x is None" and "x is not None".
function narrowTypeForIsNone(evaluator: TypeEvaluator, type: Type, isPositiveTest: boolean) {
    const expandedType = mapSubtypes(type, (subtype) => {
        return transformPossibleRecursiveTypeAlias(subtype);
    });

    let resultIncludesNoneSubtype = false;

    const result = evaluator.mapSubtypesExpandTypeVars(
        expandedType,
        /* options */ undefined,
        (subtype, unexpandedSubtype) => {
            if (isAnyOrUnknown(subtype)) {
                // We need to assume that "Any" is always both None and not None,
                // so it matches regardless of whether the test is positive or negative.
                return subtype;
            }

            // If this is a TypeVar that isn't constrained, use the unexpanded
            // TypeVar. For all other cases (including constrained TypeVars),
            // use the expanded subtype.
            const adjustedSubtype =
                isTypeVar(unexpandedSubtype) && unexpandedSubtype.details.constraints.length === 0
                    ? unexpandedSubtype
                    : subtype;

            // See if it's a match for object.
            if (isClassInstance(subtype) && ClassType.isBuiltIn(subtype, 'object')) {
                resultIncludesNoneSubtype = true;
                return isPositiveTest
                    ? addConditionToType(evaluator.getNoneType(), subtype.condition)
                    : adjustedSubtype;
            }

            // See if it's a match for None.
            if (isNoneInstance(subtype) === isPositiveTest) {
                resultIncludesNoneSubtype = true;

                if (isTypeVar(adjustedSubtype) && adjustedSubtype.details.isSynthesizedSelf) {
                    return adjustedSubtype;
                }

                return subtype;
            }

            return undefined;
        }
    );

    // If this is a positive test and the result is a union that includes None,
    // we can eliminate all the non-None subtypes include Any or Unknown. If some
    // of the subtypes are None types with conditions, retain those.
    if (isPositiveTest && resultIncludesNoneSubtype) {
        return mapSubtypes(result, (subtype) => {
            return isNoneInstance(subtype) ? subtype : undefined;
        });
    }

    return result;
}

// Handle type narrowing for expressions of the form "x is ..." and "x is not ...".
function narrowTypeForIsEllipsis(evaluator: TypeEvaluator, type: Type, isPositiveTest: boolean) {
    const expandedType = mapSubtypes(type, (subtype) => {
        return transformPossibleRecursiveTypeAlias(subtype);
    });

    return evaluator.mapSubtypesExpandTypeVars(expandedType, /* options */ undefined, (subtype, unexpandedSubtype) => {
        if (isAnyOrUnknown(subtype)) {
            // We need to assume that "Any" is always both None and not None,
            // so it matches regardless of whether the test is positive or negative.
            return subtype;
        }

        // If this is a TypeVar that isn't constrained, use the unexpanded
        // TypeVar. For all other cases (including constrained TypeVars),
        // use the expanded subtype.
        const adjustedSubtype =
            isTypeVar(unexpandedSubtype) && unexpandedSubtype.details.constraints.length === 0
                ? unexpandedSubtype
                : subtype;

        // See if it's a match for object.
        if (isClassInstance(subtype) && ClassType.isBuiltIn(subtype, 'object')) {
            return isPositiveTest ? addConditionToType(evaluator.getNoneType(), subtype.condition) : adjustedSubtype;
        }

        const isEllipsis = isClassInstance(subtype) && ClassType.isBuiltIn(subtype, ['EllipsisType', 'ellipsis']);

        // See if it's a match for "...".
        if (isEllipsis === isPositiveTest) {
            return subtype;
        }

        return undefined;
    });
}

// The "isinstance" and "issubclass" calls support two forms - a simple form
// that accepts a single class, and a more complex form that accepts a tuple
// of classes (including arbitrarily-nested tuples). This method determines
// which form and returns a list of classes or undefined.
function getIsInstanceClassTypes(argType: Type): (ClassType | TypeVarType | FunctionType)[] | undefined {
    let foundNonClassType = false;
    const classTypeList: (ClassType | TypeVarType | FunctionType)[] = [];

    // Create a helper function that returns a list of class types or
    // undefined if any of the types are not valid.
    const addClassTypesToList = (types: Type[]) => {
        types.forEach((subtype) => {
            if (isClass(subtype)) {
                subtype = specializeWithUnknownTypeArgs(subtype);

                if (isInstantiableClass(subtype) && ClassType.isBuiltIn(subtype, 'Callable')) {
                    subtype = convertToInstantiable(getUnknownTypeForCallable());
                }
            }

            if (isInstantiableClass(subtype) || (isTypeVar(subtype) && TypeBase.isInstantiable(subtype))) {
                classTypeList.push(subtype);
            } else if (isNoneTypeClass(subtype)) {
                assert(isInstantiableClass(subtype));
                classTypeList.push(subtype);
            } else if (
                isFunction(subtype) &&
                subtype.details.parameters.length === 2 &&
                subtype.details.parameters[0].category === ParameterCategory.ArgsList &&
                subtype.details.parameters[1].category === ParameterCategory.KwargsDict
            ) {
                classTypeList.push(subtype);
            } else {
                foundNonClassType = true;
            }
        });
    };

    const addClassTypesRecursive = (type: Type, recursionCount = 0) => {
        if (recursionCount > maxTypeRecursionCount) {
            return;
        }

        if (isClass(type) && TypeBase.isInstance(type) && isTupleClass(type)) {
            if (type.tupleTypeArguments) {
                type.tupleTypeArguments.forEach((tupleEntry) => {
                    addClassTypesRecursive(tupleEntry.type, recursionCount + 1);
                });
            }
        } else {
            doForEachSubtype(type, (subtype) => {
                addClassTypesToList([subtype]);
            });
        }
    };

    doForEachSubtype(argType, (subtype) => {
        addClassTypesRecursive(subtype);
    });

    return foundNonClassType ? undefined : classTypeList;
}

export function isIsinstanceFilterSuperclass(
    evaluator: TypeEvaluator,
    varType: Type,
    concreteVarType: ClassType,
    filterType: Type,
    concreteFilterType: ClassType,
    isInstanceCheck: boolean
) {
    if (isTypeVar(filterType) || concreteFilterType.literalValue !== undefined) {
        return isTypeSame(convertToInstance(filterType), varType);
    }

    // If the filter type represents all possible subclasses
    // of a type, we can't make any statements about its superclass
    // relationship with concreteVarType.
    if (concreteFilterType.includeSubclasses) {
        return false;
    }

    if (ClassType.isDerivedFrom(concreteVarType, concreteFilterType)) {
        return true;
    }

    if (isInstanceCheck) {
        if (
            ClassType.isProtocolClass(concreteFilterType) &&
            evaluator.assignType(concreteFilterType, concreteVarType)
        ) {
            return true;
        }
    }

    // Handle the special case where the variable type is a TypedDict and
    // we're filtering against 'dict'. TypedDict isn't derived from dict,
    // but at runtime, isinstance returns True.
    if (ClassType.isBuiltIn(concreteFilterType, 'dict') && ClassType.isTypedDictClass(concreteVarType)) {
        return true;
    }

    return false;
}

export function isIsinstanceFilterSubclass(
    evaluator: TypeEvaluator,
    varType: ClassType,
    concreteFilterType: ClassType,
    isInstanceCheck: boolean
) {
    if (ClassType.isDerivedFrom(concreteFilterType, varType)) {
        return true;
    }

    if (isInstanceCheck) {
        if (ClassType.isProtocolClass(varType) && evaluator.assignType(varType, concreteFilterType)) {
            return true;
        }
    }

    return false;
}

function narrowTypeForIsInstance(
    evaluator: TypeEvaluator,
    type: Type,
    filterTypes: Type[],
    isInstanceCheck: boolean,
    isTypeIsCheck: boolean,
    isPositiveTest: boolean,
    errorNode: ExpressionNode
) {
    // First try with intersection types disallowed.
    const narrowedType = narrowTypeForIsInstanceInternal(
        evaluator,
        type,
        filterTypes,
        isInstanceCheck,
        isTypeIsCheck,
        isPositiveTest,
        /* allowIntersections */ false,
        errorNode
    );

    if (!isNever(narrowedType)) {
        return narrowedType;
    }

    // Try again with intersection types allowed.
    return narrowTypeForIsInstanceInternal(
        evaluator,
        type,
        filterTypes,
        isInstanceCheck,
        isTypeIsCheck,
        isPositiveTest,
        /* allowIntersections */ true,
        errorNode
    );
}

// Attempts to narrow a type (make it more constrained) based on a
// call to isinstance or issubclass. For example, if the original
// type of expression "x" is "Mammal" and the test expression is
// "isinstance(x, Cow)", (assuming "Cow" is a subclass of "Mammal"),
// we can conclude that x must be constrained to "Cow".
function narrowTypeForIsInstanceInternal(
    evaluator: TypeEvaluator,
    type: Type,
    filterTypes: Type[],
    isInstanceCheck: boolean,
    isTypeIsCheck: boolean,
    isPositiveTest: boolean,
    allowIntersections: boolean,
    errorNode: ExpressionNode
): Type {
    let expandedTypes = mapSubtypes(type, (subtype) => {
        return transformPossibleRecursiveTypeAlias(subtype);
    });

    expandedTypes = evaluator.expandPromotionTypes(errorNode, expandedTypes);

    // Filters the varType by the parameters of the isinstance
    // and returns the list of types the varType could be after
    // applying the filter.
    const filterClassType = (
        varType: Type,
        concreteVarType: ClassType,
        conditions: TypeCondition[] | undefined,
        negativeFallbackType: Type
    ): Type[] => {
        const filteredTypes: Type[] = [];

        let foundSuperclass = false;
        let isClassRelationshipIndeterminate = false;

        for (const filterType of filterTypes) {
            let concreteFilterType = evaluator.makeTopLevelTypeVarsConcrete(filterType);

            if (isInstantiableClass(concreteFilterType)) {
                let filterIsSuperclass: boolean;
                let filterIsSubclass: boolean;

                if (isTypeIsCheck) {
                    filterIsSuperclass = evaluator.assignType(filterType, concreteVarType);
                    filterIsSubclass = evaluator.assignType(concreteVarType, filterType);
                } else {
                    // If the class was implicitly specialized (e.g. because its type
                    // parameters have default values), replace the default type arguments
                    // with Unknown.
                    if (concreteFilterType.typeArguments && !concreteFilterType.isTypeArgumentExplicit) {
                        concreteFilterType = specializeWithUnknownTypeArgs(
                            ClassType.cloneForSpecialization(
                                concreteFilterType,
                                /* typeArguments */ undefined,
                                /* isTypeArgumentExplicit */ false
                            )
                        );
                    }

                    filterIsSuperclass = isIsinstanceFilterSuperclass(
                        evaluator,
                        varType,
                        concreteVarType,
                        filterType,
                        concreteFilterType,
                        isInstanceCheck
                    );
                    filterIsSubclass = isIsinstanceFilterSubclass(
                        evaluator,
                        concreteVarType,
                        concreteFilterType,
                        isInstanceCheck
                    );
                }

                if (filterIsSuperclass) {
                    foundSuperclass = true;
                }

                // Normally, a type should never be both a subclass and a superclass.
                // This can happen if either of the class types derives from a
                // class whose type is unknown (e.g. an import failed). We'll
                // note this case specially so we don't do any narrowing, which
                // will generate false positives.
                if (
                    filterIsSubclass &&
                    filterIsSuperclass &&
                    !ClassType.isSameGenericClass(concreteVarType, concreteFilterType)
                ) {
                    isClassRelationshipIndeterminate = true;
                }

                // If both the variable type and the filter type ar generics, we can't
                // determine the relationship between the two.
                if (isTypeVar(varType) && isTypeVar(filterType)) {
                    isClassRelationshipIndeterminate = true;
                }

                if (isPositiveTest) {
                    if (filterIsSuperclass) {
                        // If the variable type is a subclass of the isinstance filter,
                        // we haven't learned anything new about the variable type.

                        // If the varType is a Self or type[Self], retain the unnarrowedType.
                        if (isTypeVar(varType) && varType.details.isSynthesizedSelf) {
                            filteredTypes.push(addConditionToType(varType, conditions));
                        } else {
                            filteredTypes.push(addConditionToType(concreteVarType, conditions));
                        }
                    } else if (filterIsSubclass) {
                        if (
                            evaluator.assignType(
                                concreteVarType,
                                concreteFilterType,
                                /* diag */ undefined,
                                /* destTypeVarContext */ undefined,
                                /* srcTypeVarContext */ undefined,
                                AssignTypeFlags.IgnoreTypeVarScope |
                                    AssignTypeFlags.IgnoreProtocolAssignmentCheck |
                                    AssignTypeFlags.AllowIsinstanceSpecialForms
                            )
                        ) {
                            // If the variable type is a superclass of the isinstance
                            // filter, we can narrow the type to the subclass.
                            let specializedFilterType = filterType;

                            // Try to retain the type arguments for the filter type. This is
                            // important because a specialized version of the filter cannot
                            // be passed to isinstance or issubclass.
                            if (isClass(filterType)) {
                                if (
                                    ClassType.isSpecialBuiltIn(filterType) ||
                                    filterType.details.typeParameters.length > 0
                                ) {
                                    if (
                                        !filterType.typeArguments ||
                                        !filterType.isTypeArgumentExplicit ||
                                        !ClassType.isSameGenericClass(concreteVarType, filterType)
                                    ) {
                                        const typeVarContext = new TypeVarContext(getTypeVarScopeId(filterType));
                                        const unspecializedFilterType = ClassType.cloneForSpecialization(
                                            filterType,
                                            /* typeArguments */ undefined,
                                            /* isTypeArgumentExplicit */ false
                                        );

                                        if (
                                            populateTypeVarContextBasedOnExpectedType(
                                                evaluator,
                                                unspecializedFilterType,
                                                concreteVarType,
                                                typeVarContext,
                                                /* liveTypeVarScopes */ undefined,
                                                errorNode.start
                                            )
                                        ) {
                                            specializedFilterType = applySolvedTypeVars(
                                                unspecializedFilterType,
                                                typeVarContext,
                                                { unknownIfNotFound: true, useUnknownOverDefault: true }
                                            ) as ClassType;
                                        }
                                    }
                                }
                            }

                            filteredTypes.push(addConditionToType(specializedFilterType, conditions));
                        }
                    } else if (
                        allowIntersections &&
                        !ClassType.isFinal(concreteVarType) &&
                        !ClassType.isFinal(concreteFilterType)
                    ) {
                        // The two types appear to have no relation. It's possible that the
                        // two types are protocols or the program is expecting one type to
                        // be a mix-in class used with the other. In this case, we'll
                        // synthesize a new class type that represents an intersection of
                        // the two types.
                        const className = `<subclass of ${concreteVarType.details.name} and ${concreteFilterType.details.name}>`;
                        const fileInfo = getFileInfo(errorNode);

                        // The effective metaclass of the intersection is the narrower of the two metaclasses.
                        let effectiveMetaclass = concreteVarType.details.effectiveMetaclass;
                        if (concreteFilterType.details.effectiveMetaclass) {
                            if (
                                !effectiveMetaclass ||
                                evaluator.assignType(effectiveMetaclass, concreteFilterType.details.effectiveMetaclass)
                            ) {
                                effectiveMetaclass = concreteFilterType.details.effectiveMetaclass;
                            }
                        }

                        let newClassType = ClassType.createInstantiable(
                            className,
                            ParseTreeUtils.getClassFullName(errorNode, fileInfo.moduleName, className),
                            fileInfo.moduleName,
                            fileInfo.fileUri,
                            ClassTypeFlags.None,
                            ParseTreeUtils.getTypeSourceId(errorNode),
                            /* declaredMetaclass */ undefined,
                            effectiveMetaclass,
                            concreteVarType.details.docString
                        );
                        newClassType.details.baseClasses = [
                            ClassType.cloneAsInstantiable(concreteVarType),
                            concreteFilterType,
                        ];
                        computeMroLinearization(newClassType);

                        newClassType = addConditionToType(newClassType, concreteFilterType.condition) as ClassType;

                        if (
                            isTypeVar(varType) &&
                            !varType.details.isParamSpec &&
                            varType.details.constraints.length === 0
                        ) {
                            newClassType = addConditionToType(newClassType, [
                                { typeVar: varType, constraintIndex: 0 },
                            ]) as ClassType;
                        }

                        let newClassInstanceType = ClassType.cloneAsInstance(newClassType);

                        if (concreteVarType.condition) {
                            newClassInstanceType = addConditionToType(
                                newClassInstanceType,
                                concreteVarType.condition
                            ) as ClassType;
                        }

                        // If this is a issubclass check, we do a double conversion from instantiable
                        // to instance back to instantiable to make sure that the includeSubclasses flag
                        // gets cleared.
                        filteredTypes.push(
                            isInstanceCheck ? newClassInstanceType : ClassType.cloneAsInstantiable(newClassInstanceType)
                        );
                    }
                }
            } else if (isTypeVar(filterType) && TypeBase.isInstantiable(filterType)) {
                // Handle the case where the filter type is Type[T] and the unexpanded
                // subtype is some instance type, possibly T.
                if (isInstanceCheck && TypeBase.isInstance(varType)) {
                    if (isTypeVar(varType) && isTypeSame(convertToInstance(filterType), varType)) {
                        // If the unexpanded subtype is T, we can definitively filter
                        // in both the positive and negative cases.
                        if (isPositiveTest) {
                            filteredTypes.push(varType);
                        } else {
                            foundSuperclass = true;
                        }
                    } else {
                        if (isPositiveTest) {
                            filteredTypes.push(convertToInstance(filterType));
                        } else {
                            // If the unexpanded subtype is some other instance, we can't
                            // filter anything because it might be an instance.
                            filteredTypes.push(varType);
                            isClassRelationshipIndeterminate = true;
                        }
                    }
                } else if (!isInstanceCheck && TypeBase.isInstantiable(varType)) {
                    if (isTypeVar(varType) && isTypeSame(filterType, varType)) {
                        if (isPositiveTest) {
                            filteredTypes.push(varType);
                        }
                    } else {
                        if (isPositiveTest) {
                            filteredTypes.push(filterType);
                        } else {
                            filteredTypes.push(varType);
                            isClassRelationshipIndeterminate = true;
                        }
                    }
                }
            } else if (isFunction(filterType)) {
                // Handle an isinstance check against Callable.
                if (isInstanceCheck) {
                    let isCallable = false;

                    if (isClass(concreteVarType)) {
                        if (TypeBase.isInstantiable(varType)) {
                            isCallable = true;
                        } else {
                            isCallable = !!lookUpClassMember(
                                concreteVarType,
                                '__call__',
                                MemberAccessFlags.SkipInstanceMembers
                            );
                        }
                    }

                    if (isCallable) {
                        if (isPositiveTest) {
                            filteredTypes.push(varType);
                        } else {
                            foundSuperclass = true;
                        }
                    } else if (
                        evaluator.assignType(
                            concreteVarType,
                            filterType,
                            /* diag */ undefined,
                            /* destTypeVarContext */ undefined,
                            /* srcTypeVarContext */ undefined,
                            AssignTypeFlags.AllowIsinstanceSpecialForms
                        )
                    ) {
                        if (isPositiveTest) {
                            filteredTypes.push(filterType);
                        }
                    }
                }
            }
        }

        // In the negative case, if one or more of the filters
        // always match the type (i.e. they are an exact match or
        // a superclass of the type), then there's nothing left after
        // the filter is applied. If we didn't find any superclass
        // match, then the original variable type survives the filter.
        if (!isPositiveTest) {
            if (!foundSuperclass || isClassRelationshipIndeterminate) {
                filteredTypes.push(
                    isInstanceCheck ? convertToInstantiable(negativeFallbackType) : negativeFallbackType
                );
            }
        }

        if (!isInstanceCheck) {
            // We perform a double conversion from instance to instantiable
            // here to make sure that the includeSubclasses flag is cleared
            // if it's a class.
            return filteredTypes.map((t) => (isInstantiableClass(t) ? convertToInstantiable(convertToInstance(t)) : t));
        }

        return filteredTypes.map((t) => convertToInstance(t));
    };

    // Filters the metaclassType (which is assumed to be a metaclass instance)
    // by the classTypeList and returns the list of types the varType could be
    // after applying the filter.
    const filterMetaclassType = (metaclassType: ClassType, negativeFallbackType: Type): Type[] => {
        const filteredTypes: Type[] = [];

        let foundPositiveMatch = false;
        let isMatchIndeterminate = false;

        for (const filterType of filterTypes) {
            const concreteFilterType = evaluator.makeTopLevelTypeVarsConcrete(filterType);

            if (isInstantiableClass(concreteFilterType)) {
                const filterMetaclass = concreteFilterType.details.effectiveMetaclass;

                if (filterMetaclass && isInstantiableClass(filterMetaclass)) {
                    let isMetaclassOverlap = evaluator.assignType(
                        metaclassType,
                        ClassType.cloneAsInstance(filterMetaclass)
                    );

                    // Handle the special case where the metaclass for the filter is type.
                    // This will normally be treated as type[Any], which is compatible with
                    // any metaclass, but we specifically want to treat type as the class
                    // type[object] in this case.
                    if (ClassType.isBuiltIn(filterMetaclass, 'type') && !filterMetaclass.isTypeArgumentExplicit) {
                        if (!ClassType.isBuiltIn(metaclassType, 'type')) {
                            isMetaclassOverlap = false;
                        }
                    }

                    if (isMetaclassOverlap) {
                        if (isPositiveTest) {
                            filteredTypes.push(filterType);
                            foundPositiveMatch = true;
                        } else if (!isTypeSame(metaclassType, filterMetaclass) || filterMetaclass.includeSubclasses) {
                            filteredTypes.push(metaclassType);
                            isMatchIndeterminate = true;
                        }
                    }
                } else {
                    filteredTypes.push(metaclassType);
                    isMatchIndeterminate = true;
                }
            } else {
                filteredTypes.push(metaclassType);
                isMatchIndeterminate = true;
            }
        }

        // In the negative case, if one or more of the filters
        // always match the type in the positive case, then there's nothing
        // left after the filter is applied.
        if (!isPositiveTest) {
            if (!foundPositiveMatch || isMatchIndeterminate) {
                filteredTypes.push(negativeFallbackType);
            }
        }

        // We perform a double conversion from instance to instantiable
        // here to make sure that the includeSubclasses flag is cleared
        // if it's a class.
        return filteredTypes.map((t) => (isInstantiableClass(t) ? convertToInstantiable(convertToInstance(t)) : t));
    };

    const filterFunctionType = (varType: FunctionType | OverloadedFunctionType, unexpandedType: Type): Type[] => {
        const filteredTypes: Type[] = [];

        if (isPositiveTest) {
            for (const filterType of filterTypes) {
                const concreteFilterType = evaluator.makeTopLevelTypeVarsConcrete(filterType);

                if (
                    evaluator.assignType(
                        varType,
                        convertToInstance(concreteFilterType),
                        /* diag */ undefined,
                        /* destTypeVarContext */ undefined,
                        /* srcTypeVarContext */ undefined,
                        AssignTypeFlags.IgnoreTypeVarScope
                    )
                ) {
                    // If the filter type is a Callable, use the original type. If the
                    // filter type is a callback protocol, use the filter type.
                    if (isFunction(filterType)) {
                        filteredTypes.push(unexpandedType);
                    } else {
                        filteredTypes.push(convertToInstance(filterType));
                    }
                }
            }
        } else if (
            !filterTypes.some((filterType) => {
                // If the filter type is a runtime checkable protocol class, it can
                // be used in an instance check.
                const concreteFilterType = evaluator.makeTopLevelTypeVarsConcrete(filterType);
                if (isClass(concreteFilterType) && !ClassType.isProtocolClass(concreteFilterType)) {
                    return false;
                }

                return evaluator.assignType(varType, convertToInstance(concreteFilterType));
            })
        ) {
            filteredTypes.push(unexpandedType);
        }

        return filteredTypes;
    };

    const classListContainsNoneType = () =>
        filterTypes.some((t) => {
            if (isNoneTypeClass(t)) {
                return true;
            }
            return isInstantiableClass(t) && ClassType.isBuiltIn(t, 'NoneType');
        });

    const anyOrUnknownSubstitutions: Type[] = [];
    const anyOrUnknown: Type[] = [];

    const filteredType = evaluator.mapSubtypesExpandTypeVars(
        expandedTypes,
        /* options */ undefined,
        (subtype, unexpandedSubtype) => {
            // If we fail to filter anything in the negative case, we need to decide
            // whether to retain the original TypeVar or replace it with its specialized
            // type(s). We'll assume that if someone is using isinstance or issubclass
            // on a constrained TypeVar that they want to filter based on its constrained
            // parts.
            const negativeFallback = getTypeCondition(subtype) ? subtype : unexpandedSubtype;
            const isSubtypeMetaclass = isMetaclassInstance(subtype);

            if (isPositiveTest && isAnyOrUnknown(subtype)) {
                // If this is a positive test and the effective type is Any or
                // Unknown, we can assume that the type matches one of the
                // specified types.
                if (isInstanceCheck) {
                    anyOrUnknownSubstitutions.push(
                        combineTypes(filterTypes.map((classType) => convertToInstance(classType)))
                    );
                } else {
                    // We perform a double conversion from instance to instantiable
                    // here to make sure that the includeSubclasses flag is cleared
                    // if it's a class.
                    anyOrUnknownSubstitutions.push(
                        combineTypes(
                            filterTypes.map((classType) => convertToInstantiable(convertToInstance(classType)))
                        )
                    );
                }

                anyOrUnknown.push(subtype);
                return undefined;
            }

            if (isInstanceCheck) {
                if (isNoneInstance(subtype)) {
                    return classListContainsNoneType() === isPositiveTest ? subtype : undefined;
                }

                if (isModule(subtype) || (isClassInstance(subtype) && ClassType.isBuiltIn(subtype, 'ModuleType'))) {
                    // Handle type narrowing for runtime-checkable protocols
                    // when applied to modules.
                    if (isPositiveTest) {
                        const filteredTypes = filterTypes.filter((classType) => {
                            const concreteClassType = evaluator.makeTopLevelTypeVarsConcrete(classType);
                            return (
                                isInstantiableClass(concreteClassType) && ClassType.isProtocolClass(concreteClassType)
                            );
                        });

                        if (filteredTypes.length > 0) {
                            return convertToInstance(combineTypes(filteredTypes));
                        }
                    }
                }

                if (isClassInstance(subtype)) {
                    return combineTypes(
                        filterClassType(
                            unexpandedSubtype,
                            ClassType.cloneAsInstantiable(subtype),
                            getTypeCondition(subtype),
                            negativeFallback
                        )
                    );
                }

                if ((isFunction(subtype) || isOverloadedFunction(subtype)) && isInstanceCheck) {
                    return combineTypes(filterFunctionType(subtype, convertToInstance(unexpandedSubtype)));
                }

                if (isInstantiableClass(subtype) || isSubtypeMetaclass) {
                    // Handle the special case of isinstance(x, metaclass).
                    const includesMetaclassType = filterTypes.some((classType) => isInstantiableMetaclass(classType));
                    if (isPositiveTest) {
                        return includesMetaclassType ? negativeFallback : undefined;
                    } else {
                        return includesMetaclassType ? undefined : negativeFallback;
                    }
                }
            } else {
                if (isNoneTypeClass(subtype)) {
                    return classListContainsNoneType() === isPositiveTest ? subtype : undefined;
                }

                if (isClass(subtype)) {
                    if (isInstantiableClass(subtype)) {
                        return combineTypes(
                            filterClassType(unexpandedSubtype, subtype, getTypeCondition(subtype), negativeFallback)
                        );
                    } else if (isMetaclassInstance(subtype)) {
                        return combineTypes(filterMetaclassType(subtype, negativeFallback));
                    }
                }

                if (isSubtypeMetaclass) {
                    const objectType = evaluator.getBuiltInObject(errorNode, 'object');
                    if (objectType && isClassInstance(objectType)) {
                        return combineTypes(
                            filterClassType(
                                convertToInstantiable(unexpandedSubtype),
                                ClassType.cloneAsInstantiable(objectType),
                                getTypeCondition(subtype),
                                negativeFallback
                            )
                        );
                    }
                }
            }

            return isPositiveTest ? undefined : negativeFallback;
        }
    );

    // If the result is Any/Unknown and contains no other subtypes and
    // we have substitutions for Any/Unknown, use those instead. We don't
    // want to apply this if the filtering produced something other than
    // Any/Unknown. For example, if the statement is "isinstance(x, list)"
    // and the type of x is "List[str] | int | Any", the result should be
    // "List[str]", not "List[str] | List[Unknown]".
    if (isNever(filteredType) && anyOrUnknownSubstitutions.length > 0) {
        return combineTypes(anyOrUnknownSubstitutions);
    }

    if (isNever(filteredType) && anyOrUnknown.length > 0) {
        return combineTypes(anyOrUnknown);
    }

    return filteredType;
}

// Attempts to narrow a union of tuples based on their known length.
function narrowTypeForTupleLength(
    evaluator: TypeEvaluator,
    referenceType: Type,
    lengthValue: number,
    isPositiveTest: boolean,
    isLessThanCheck: boolean
) {
    return mapSubtypes(referenceType, (subtype) => {
        const concreteSubtype = evaluator.makeTopLevelTypeVarsConcrete(subtype);

        // If it's not a tuple, we can't narrow it.
        if (
            !isClassInstance(concreteSubtype) ||
            !isTupleClass(concreteSubtype) ||
            !concreteSubtype.tupleTypeArguments
        ) {
            return subtype;
        }

        // If the tuple contains a variadic TypeVar, we can't narrow it.
        if (concreteSubtype.tupleTypeArguments.some((typeArg) => isUnpackedVariadicTypeVar(typeArg.type))) {
            return subtype;
        }

        // If the tuple contains no unbounded elements, then we know its length exactly.
        if (!concreteSubtype.tupleTypeArguments.some((typeArg) => typeArg.isUnbounded)) {
            const tupleLengthMatches = isLessThanCheck
                ? concreteSubtype.tupleTypeArguments.length < lengthValue
                : concreteSubtype.tupleTypeArguments.length === lengthValue;

            return tupleLengthMatches === isPositiveTest ? subtype : undefined;
        }

        // The tuple contains a "...". We'll expand this into as many elements as
        // necessary to match the lengthValue.
        const elementsToAdd = lengthValue - concreteSubtype.tupleTypeArguments.length + 1;

        if (!isLessThanCheck) {
            // If the specified length is smaller than the minimum length of this tuple,
            // we can rule it out for a positive test and rule it in for a negative test.
            if (elementsToAdd < 0) {
                return isPositiveTest ? undefined : subtype;
            }

            if (!isPositiveTest) {
                return subtype;
            }

            return expandUnboundedTupleElement(concreteSubtype, elementsToAdd, /* keepUnbounded */ false);
        }

        // If this is a tuple related to an "*args: P.args" parameter, don't expand it.
        if (isParamSpec(subtype) && subtype.paramSpecAccess) {
            return subtype;
        }

        // Place an upper limit on the number of union subtypes we
        // will expand the tuple to.
        const maxTupleUnionExpansion = 32;
        if (elementsToAdd > maxTupleUnionExpansion) {
            return subtype;
        }

        if (isPositiveTest) {
            if (elementsToAdd < 1) {
                return undefined;
            }

            const typesToCombine: Type[] = [];

            for (let i = 0; i < elementsToAdd; i++) {
                typesToCombine.push(expandUnboundedTupleElement(concreteSubtype, i, /* keepUnbounded */ false));
            }

            return combineTypes(typesToCombine);
        }

        return expandUnboundedTupleElement(concreteSubtype, elementsToAdd, /* keepUnbounded */ true);
    });
}

// Expands a tuple type that contains an unbounded element to include
// multiple bounded elements of that same type in place of (or in addition
// to) the unbounded element.
function expandUnboundedTupleElement(tupleType: ClassType, elementsToAdd: number, keepUnbounded: boolean) {
    const tupleTypeArgs: TupleTypeArgument[] = [];

    tupleType.tupleTypeArguments!.forEach((typeArg) => {
        if (!typeArg.isUnbounded) {
            tupleTypeArgs.push(typeArg);
        } else {
            for (let i = 0; i < elementsToAdd; i++) {
                tupleTypeArgs.push({ isUnbounded: false, type: typeArg.type });
            }

            if (keepUnbounded) {
                tupleTypeArgs.push(typeArg);
            }
        }
    });

    return specializeTupleClass(tupleType, tupleTypeArgs);
}

// Attempts to narrow a type (make it more constrained) based on an "in" binary operator.
function narrowTypeForContainerType(
    evaluator: TypeEvaluator,
    referenceType: Type,
    containerType: Type,
    isPositiveTest: boolean
) {
    if (isPositiveTest) {
        const elementType = getElementTypeForContainerNarrowing(containerType);
        if (!elementType) {
            return referenceType;
        }

        return narrowTypeForContainerElementType(
            evaluator,
            referenceType,
            evaluator.makeTopLevelTypeVarsConcrete(elementType)
        );
    }

    // Narrowing in the negative case is possible only with tuples
    // with a known length.
    if (
        !isClassInstance(containerType) ||
        !ClassType.isBuiltIn(containerType, 'tuple') ||
        !containerType.tupleTypeArguments
    ) {
        return referenceType;
    }

    // Determine which tuple types can be eliminated. Only "None" and
    // literal types can be handled here.
    const typesToEliminate: Type[] = [];
    containerType.tupleTypeArguments.forEach((tupleEntry) => {
        if (!tupleEntry.isUnbounded) {
            if (isNoneInstance(tupleEntry.type)) {
                typesToEliminate.push(tupleEntry.type);
            } else if (isClassInstance(tupleEntry.type) && isLiteralType(tupleEntry.type)) {
                typesToEliminate.push(tupleEntry.type);
            }
        }
    });

    if (typesToEliminate.length === 0) {
        return referenceType;
    }

    return mapSubtypes(referenceType, (referenceSubtype) => {
        referenceSubtype = evaluator.makeTopLevelTypeVarsConcrete(referenceSubtype);
        if (isClassInstance(referenceSubtype) && referenceSubtype.literalValue === undefined) {
            // If we're able to enumerate all possible literal values
            // (for bool or enum), we can eliminate all others in a negative test.
            const allLiteralTypes = enumerateLiteralsForType(evaluator, referenceSubtype);
            if (allLiteralTypes && allLiteralTypes.length > 0) {
                return combineTypes(
                    allLiteralTypes.filter((type) => !typesToEliminate.some((t) => isTypeSame(t, type)))
                );
            }
        }

        if (typesToEliminate.some((t) => isTypeSame(t, referenceSubtype))) {
            return undefined;
        }

        return referenceSubtype;
    });
}

export function getElementTypeForContainerNarrowing(containerType: Type) {
    // We support contains narrowing only for certain built-in types that have been specialized.
    const supportedContainers = ['list', 'set', 'frozenset', 'deque', 'tuple', 'dict', 'defaultdict', 'OrderedDict'];
    if (!isClassInstance(containerType) || !ClassType.isBuiltIn(containerType, supportedContainers)) {
        return undefined;
    }

    if (!containerType.typeArguments || containerType.typeArguments.length < 1) {
        return undefined;
    }

    let elementType = containerType.typeArguments[0];
    if (isTupleClass(containerType) && containerType.tupleTypeArguments) {
        elementType = combineTypes(containerType.tupleTypeArguments.map((t) => t.type));
    }

    return elementType;
}

export function narrowTypeForContainerElementType(evaluator: TypeEvaluator, referenceType: Type, elementType: Type) {
    let canNarrow = true;
    const elementTypeWithoutLiteral = evaluator.stripLiteralValue(elementType);

    // Look for cases where one or more of the reference subtypes are
    // supertypes of the element types. For example, if the element type
    // is "int | str" and the reference type is "float | bytes", we can
    // narrow the reference type to "float" because it is a supertype of "int".
    const narrowedSupertypes = evaluator.mapSubtypesExpandTypeVars(
        referenceType,
        /* options */ undefined,
        (referenceSubtype) => {
            if (isAnyOrUnknown(referenceSubtype)) {
                canNarrow = false;
                return referenceSubtype;
            }

            // Handle "type" specially.
            if (isClassInstance(referenceSubtype) && ClassType.isBuiltIn(referenceSubtype, 'type')) {
                canNarrow = false;
                return referenceSubtype;
            }

            if (evaluator.assignType(elementType, referenceSubtype)) {
                return referenceSubtype;
            }

            if (evaluator.assignType(elementTypeWithoutLiteral, referenceSubtype)) {
                return mapSubtypes(elementType, (elementSubtype) => {
                    if (
                        isClassInstance(elementSubtype) &&
                        isSameWithoutLiteralValue(referenceSubtype, elementSubtype)
                    ) {
                        return elementSubtype;
                    }
                    return undefined;
                });
            }

            return undefined;
        }
    );

    // Look for cases where one or more of the reference subtypes are
    // subtypes of the element types. For example, if the element type
    // is "int | str" and the reference type is "object", we can
    // narrow the reference type to "int | str" because they are both
    // subtypes of "object".
    const narrowedSubtypes = evaluator.mapSubtypesExpandTypeVars(
        elementType,
        /* options */ undefined,
        (elementSubtype) => {
            if (isAnyOrUnknown(elementSubtype)) {
                canNarrow = false;
                return referenceType;
            }

            // Handle the special case where the reference type is a dict or Mapping and
            // the element type is a TypedDict. In this case, we can't say whether there
            // is a type overlap, so don't apply narrowing.
            if (isClassInstance(referenceType) && ClassType.isBuiltIn(referenceType, ['dict', 'Mapping'])) {
                if (isClassInstance(elementSubtype) && ClassType.isTypedDictClass(elementSubtype)) {
                    return elementSubtype;
                }
            }

            if (evaluator.assignType(referenceType, elementSubtype)) {
                return elementSubtype;
            }

            return undefined;
        }
    );

    return canNarrow ? combineTypes([narrowedSupertypes, narrowedSubtypes]) : referenceType;
}

// Attempts to narrow a type based on whether it is a TypedDict with
// a literal key value.
function narrowTypeForTypedDictKey(
    evaluator: TypeEvaluator,
    referenceType: Type,
    literalKey: ClassType,
    isPositiveTest: boolean
): Type {
    const narrowedType = evaluator.mapSubtypesExpandTypeVars(
        referenceType,
        /* options */ undefined,
        (subtype, unexpandedSubtype) => {
            if (isParamSpec(unexpandedSubtype)) {
                return unexpandedSubtype;
            }

            if (isClassInstance(subtype) && ClassType.isTypedDictClass(subtype)) {
                const entries = getTypedDictMembersForClass(evaluator, subtype, /* allowNarrowed */ true);
                const tdEntry = entries.knownItems.get(literalKey.literalValue as string) ?? entries.extraItems;

                if (isPositiveTest) {
                    if (!tdEntry) {
                        return undefined;
                    }

                    // If the entry is currently not required and not marked provided, we can mark
                    // it as provided after this guard expression confirms it is.
                    if (tdEntry.isRequired || tdEntry.isProvided) {
                        return subtype;
                    }

                    const newNarrowedEntriesMap = new Map<string, TypedDictEntry>(
                        subtype.typedDictNarrowedEntries ?? []
                    );

                    // Add the new entry.
                    newNarrowedEntriesMap.set(literalKey.literalValue as string, {
                        valueType: tdEntry.valueType,
                        isReadOnly: tdEntry.isReadOnly,
                        isRequired: false,
                        isProvided: true,
                    });

                    // Clone the TypedDict object with the new entries.
                    return ClassType.cloneAsInstance(
                        ClassType.cloneForNarrowedTypedDictEntries(
                            ClassType.cloneAsInstantiable(subtype),
                            newNarrowedEntriesMap
                        )
                    );
                } else {
                    return tdEntry !== undefined && (tdEntry.isRequired || tdEntry.isProvided) ? undefined : subtype;
                }
            }

            return subtype;
        }
    );

    return narrowedType;
}

// Attempts to narrow a TypedDict type based on a comparison (equal or not
// equal) between a discriminating entry type that has a declared literal
// type to a literal value.
export function narrowTypeForDiscriminatedDictEntryComparison(
    evaluator: TypeEvaluator,
    referenceType: Type,
    indexLiteralType: ClassType,
    literalType: Type,
    isPositiveTest: boolean
): Type {
    let canNarrow = true;

    const narrowedType = mapSubtypes(referenceType, (subtype) => {
        if (isClassInstance(subtype) && ClassType.isTypedDictClass(subtype)) {
            const symbolMap = getTypedDictMembersForClass(evaluator, subtype);
            const tdEntry = symbolMap.knownItems.get(indexLiteralType.literalValue as string);

            if (tdEntry && isLiteralTypeOrUnion(tdEntry.valueType)) {
                if (isPositiveTest) {
                    let foundMatch = false;

                    doForEachSubtype(literalType, (literalSubtype) => {
                        if (evaluator.assignType(tdEntry.valueType, literalSubtype)) {
                            foundMatch = true;
                        }
                    });

                    return foundMatch ? subtype : undefined;
                } else {
                    let foundNonMatch = false;

                    doForEachSubtype(literalType, (literalSubtype) => {
                        if (!evaluator.assignType(literalSubtype, tdEntry.valueType)) {
                            foundNonMatch = true;
                        }
                    });

                    return foundNonMatch ? subtype : undefined;
                }
            }
        }

        canNarrow = false;
        return subtype;
    });

    return canNarrow ? narrowedType : referenceType;
}

export function narrowTypeForDiscriminatedTupleComparison(
    evaluator: TypeEvaluator,
    referenceType: Type,
    indexLiteralType: ClassType,
    literalType: Type,
    isPositiveTest: boolean
): Type {
    let canNarrow = true;

    const narrowedType = mapSubtypes(referenceType, (subtype) => {
        if (
            isClassInstance(subtype) &&
            ClassType.isTupleClass(subtype) &&
            !isUnboundedTupleClass(subtype) &&
            typeof indexLiteralType.literalValue === 'number' &&
            isClassInstance(literalType)
        ) {
            const indexValue = indexLiteralType.literalValue;
            if (subtype.tupleTypeArguments && indexValue >= 0 && indexValue < subtype.tupleTypeArguments.length) {
                const tupleEntryType = subtype.tupleTypeArguments[indexValue]?.type;
                if (tupleEntryType && isLiteralTypeOrUnion(tupleEntryType)) {
                    if (isPositiveTest) {
                        return evaluator.assignType(tupleEntryType, literalType) ? subtype : undefined;
                    } else {
                        return evaluator.assignType(literalType, tupleEntryType) ? undefined : subtype;
                    }
                }
            }
        }

        canNarrow = false;
        return subtype;
    });

    return canNarrow ? narrowedType : referenceType;
}

// Attempts to narrow a type based on a comparison (equal or not equal)
// between a discriminating field that has a declared literal type to a
// literal value.
export function narrowTypeForDiscriminatedLiteralFieldComparison(
    evaluator: TypeEvaluator,
    referenceType: Type,
    memberName: string,
    literalType: ClassType,
    isPositiveTest: boolean
): Type {
    const narrowedType = mapSubtypes(referenceType, (subtype) => {
        let memberInfo: ClassMember | undefined;

        if (isClassInstance(subtype)) {
            memberInfo = lookUpObjectMember(subtype, memberName);
        } else if (isInstantiableClass(subtype)) {
            memberInfo = lookUpClassMember(subtype, memberName);
        }

        if (memberInfo && memberInfo.isTypeDeclared) {
            let memberType = evaluator.getTypeOfMember(memberInfo);

            // Handle the case where the field is a property
            // that has a declared literal return type for its getter.
            if (isClassInstance(subtype) && isClassInstance(memberType) && isProperty(memberType)) {
                const getterType = memberType.fgetInfo?.methodType;
                if (getterType && getterType.details.declaredReturnType) {
                    const getterReturnType = FunctionType.getSpecializedReturnType(getterType);
                    if (getterReturnType) {
                        memberType = getterReturnType;
                    }
                }
            }

            if (isLiteralTypeOrUnion(memberType, /* allowNone */ true)) {
                if (isPositiveTest) {
                    return evaluator.assignType(memberType, literalType) ? subtype : undefined;
                } else {
                    return evaluator.assignType(literalType, memberType) ? undefined : subtype;
                }
            }
        }

        return subtype;
    });

    return narrowedType;
}

// Attempts to narrow a type based on a comparison (equal or not equal)
// between a discriminating field that has a declared None type to a
// None.
function narrowTypeForDiscriminatedFieldNoneComparison(
    evaluator: TypeEvaluator,
    referenceType: Type,
    memberName: string,
    isPositiveTest: boolean
): Type {
    return mapSubtypes(referenceType, (subtype) => {
        let memberInfo: ClassMember | undefined;
        if (isClassInstance(subtype)) {
            memberInfo = lookUpObjectMember(subtype, memberName);
        } else if (isInstantiableClass(subtype)) {
            memberInfo = lookUpClassMember(subtype, memberName);
        }

        if (memberInfo && memberInfo.isTypeDeclared) {
            const memberType = evaluator.makeTopLevelTypeVarsConcrete(evaluator.getTypeOfMember(memberInfo));
            let canNarrow = true;

            if (isPositiveTest) {
                doForEachSubtype(memberType, (memberSubtype) => {
                    memberSubtype = evaluator.makeTopLevelTypeVarsConcrete(memberSubtype);

                    // Don't attempt to narrow if the member is a descriptor or property.
                    if (isProperty(memberSubtype) || isMaybeDescriptorInstance(memberSubtype)) {
                        canNarrow = false;
                    }

                    if (isAnyOrUnknown(memberSubtype) || isNoneInstance(memberSubtype) || isNever(memberSubtype)) {
                        canNarrow = false;
                    }
                });
            } else {
                canNarrow = isNoneInstance(memberType);
            }

            if (canNarrow) {
                return undefined;
            }
        }

        return subtype;
    });
}

// Attempts to narrow a type based on a "type(x) is y" or "type(x) is not y" check.
function narrowTypeForTypeIs(evaluator: TypeEvaluator, type: Type, classType: ClassType, isPositiveTest: boolean) {
    return evaluator.mapSubtypesExpandTypeVars(
        type,
        /* options */ undefined,
        (subtype: Type, unexpandedSubtype: Type) => {
            if (isClassInstance(subtype)) {
                const matches = ClassType.isDerivedFrom(classType, ClassType.cloneAsInstantiable(subtype));
                if (isPositiveTest) {
                    if (matches) {
                        if (ClassType.isSameGenericClass(subtype, classType)) {
                            return subtype;
                        }

                        return addConditionToType(ClassType.cloneAsInstance(classType), subtype.condition);
                    }

                    if (!classType.includeSubclasses) {
                        return undefined;
                    }
                } else if (!classType.includeSubclasses) {
                    // If the class if marked final and it matches, then
                    // we can eliminate it in the negative case.
                    if (matches && ClassType.isFinal(subtype)) {
                        return undefined;
                    }

                    // We can't eliminate the subtype in the negative
                    // case because it could be a subclass of the type,
                    // in which case `type(x) is y` would fail.
                    return subtype;
                }
            } else if (isNoneInstance(subtype)) {
                return isPositiveTest ? undefined : subtype;
            } else if (isAnyOrUnknown(subtype)) {
                return isPositiveTest ? ClassType.cloneAsInstance(classType) : subtype;
            }

            return unexpandedSubtype;
        }
    );
}

// Attempts to narrow a type based on a comparison with a class using "is" or
// "is not". This pattern is sometimes used for sentinels.
function narrowTypeForClassComparison(
    evaluator: TypeEvaluator,
    referenceType: Type,
    classType: ClassType,
    isPositiveTest: boolean
): Type {
    return mapSubtypes(referenceType, (subtype) => {
        const concreteSubtype = evaluator.makeTopLevelTypeVarsConcrete(subtype);

        if (isPositiveTest) {
            if (isNoneInstance(concreteSubtype)) {
                return undefined;
            }

            if (isClassInstance(concreteSubtype) && TypeBase.isInstance(subtype)) {
                if (ClassType.isBuiltIn(concreteSubtype, 'type')) {
                    return classType;
                }

                return undefined;
            }

            if (isInstantiableClass(concreteSubtype) && ClassType.isFinal(concreteSubtype)) {
                if (
                    !ClassType.isSameGenericClass(concreteSubtype, classType) &&
                    !isIsinstanceFilterSuperclass(
                        evaluator,
                        subtype,
                        concreteSubtype,
                        classType,
                        classType,
                        /* isInstanceCheck */ false
                    )
                ) {
                    return undefined;
                }
            }
        } else {
            if (
                isInstantiableClass(concreteSubtype) &&
                ClassType.isSameGenericClass(classType, concreteSubtype) &&
                ClassType.isFinal(classType)
            ) {
                return undefined;
            }
        }

        return subtype;
    });
}

// Attempts to narrow a type (make it more constrained) based on a comparison
// (equal or not equal) to a literal value. It also handles "is" or "is not"
// operators if isIsOperator is true.
function narrowTypeForLiteralComparison(
    evaluator: TypeEvaluator,
    referenceType: Type,
    literalType: ClassType,
    isPositiveTest: boolean,
    isIsOperator: boolean
): Type {
    return mapSubtypes(referenceType, (subtype) => {
        subtype = evaluator.makeTopLevelTypeVarsConcrete(subtype);

        if (isAnyOrUnknown(subtype)) {
            if (isPositiveTest) {
                return literalType;
            }

            return subtype;
        } else if (isClassInstance(subtype) && ClassType.isSameGenericClass(literalType, subtype)) {
            if (subtype.literalValue !== undefined) {
                const literalValueMatches = ClassType.isLiteralValueSame(subtype, literalType);
                if ((literalValueMatches && !isPositiveTest) || (!literalValueMatches && isPositiveTest)) {
                    return undefined;
                }
                return subtype;
            } else if (isPositiveTest) {
                return literalType;
            } else {
                // If we're able to enumerate all possible literal values
                // (for bool or enum), we can eliminate all others in a negative test.
                const allLiteralTypes = enumerateLiteralsForType(evaluator, subtype);
                if (allLiteralTypes && allLiteralTypes.length > 0) {
                    return combineTypes(
                        allLiteralTypes.filter((type) => !ClassType.isLiteralValueSame(type, literalType))
                    );
                }
            }
        } else if (isPositiveTest) {
            if (isIsOperator || isNoneInstance(subtype)) {
                return undefined;
            }
        }

        return subtype;
    });
}

export function enumerateLiteralsForType(evaluator: TypeEvaluator, type: ClassType): ClassType[] | undefined {
    if (ClassType.isBuiltIn(type, 'bool')) {
        // Booleans have only two types: True and False.
        return [
            ClassType.cloneWithLiteral(type, /* value */ true),
            ClassType.cloneWithLiteral(type, /* value */ false),
        ];
    }

    if (ClassType.isEnumClass(type)) {
        // Enum expansion doesn't apply to enum classes that derive
        // from enum.Flag.
        if (
            type.details.baseClasses.some((baseClass) => isClass(baseClass) && ClassType.isBuiltIn(baseClass, 'Flag'))
        ) {
            return undefined;
        }

        // Enumerate all of the values in this enumeration.
        const enumList: ClassType[] = [];
        const fields = ClassType.getSymbolTable(type);
        fields.forEach((symbol, name) => {
            if (!symbol.isIgnoredForProtocolMatch()) {
                let symbolType = evaluator.getEffectiveTypeOfSymbol(symbol);
                symbolType = transformTypeForEnumMember(evaluator, type, name) ?? symbolType;

                if (
                    isClassInstance(symbolType) &&
                    ClassType.isSameGenericClass(type, symbolType) &&
                    symbolType.literalValue !== undefined
                ) {
                    enumList.push(symbolType);
                }
            }
        });

        return enumList;
    }

    return undefined;
}

// Attempts to narrow a type (make it more constrained) based on a
// call to "callable". For example, if the original type of expression "x" is
// Union[Callable[..., Any], Type[int], int], it would remove the "int" because
// it's not callable.
function narrowTypeForCallable(
    evaluator: TypeEvaluator,
    type: Type,
    isPositiveTest: boolean,
    errorNode: ExpressionNode,
    allowIntersections: boolean
): Type {
    return evaluator.mapSubtypesExpandTypeVars(type, /* options */ undefined, (subtype) => {
        switch (subtype.category) {
            case TypeCategory.Function:
            case TypeCategory.OverloadedFunction: {
                return isPositiveTest ? subtype : undefined;
            }

            case TypeCategory.Module: {
                return isPositiveTest ? undefined : subtype;
            }

            case TypeCategory.Class: {
                if (isNoneInstance(subtype)) {
                    return isPositiveTest ? undefined : subtype;
                }

                if (TypeBase.isInstantiable(subtype)) {
                    return isPositiveTest ? subtype : undefined;
                }

                // See if the object is callable.
                const callMemberType = lookUpClassMember(subtype, '__call__', MemberAccessFlags.SkipInstanceMembers);

                if (!callMemberType) {
                    if (!isPositiveTest) {
                        return subtype;
                    }

                    if (allowIntersections) {
                        // The type appears to not be callable. It's possible that the
                        // two type is a subclass that is callable. We'll synthesize a
                        // new intersection type.
                        const className = `<callable subtype of ${subtype.details.name}>`;
                        const fileInfo = getFileInfo(errorNode);
                        let newClassType = ClassType.createInstantiable(
                            className,
                            ParseTreeUtils.getClassFullName(errorNode, fileInfo.moduleName, className),
                            fileInfo.moduleName,
                            fileInfo.fileUri,
                            ClassTypeFlags.None,
                            ParseTreeUtils.getTypeSourceId(errorNode),
                            /* declaredMetaclass */ undefined,
                            subtype.details.effectiveMetaclass,
                            subtype.details.docString
                        );
                        newClassType.details.baseClasses = [ClassType.cloneAsInstantiable(subtype)];
                        computeMroLinearization(newClassType);

                        newClassType = addConditionToType(newClassType, subtype.condition) as ClassType;

                        // Add a __call__ method to the new class.
                        const callMethod = FunctionType.createSynthesizedInstance('__call__');
                        const selfParam: FunctionParameter = {
                            category: ParameterCategory.Simple,
                            name: 'self',
                            type: ClassType.cloneAsInstance(newClassType),
                            hasDeclaredType: true,
                        };
                        FunctionType.addParameter(callMethod, selfParam);
                        FunctionType.addDefaultParameters(callMethod);
                        callMethod.details.declaredReturnType = UnknownType.create();
                        ClassType.getSymbolTable(newClassType).set(
                            '__call__',
                            Symbol.createWithType(SymbolFlags.ClassMember, callMethod)
                        );

                        return ClassType.cloneAsInstance(newClassType);
                    }

                    return undefined;
                } else {
                    return isPositiveTest ? subtype : undefined;
                }
            }

            default: {
                // For all other types, we can't determine whether it's
                // callable or not, so we can't eliminate them.
                return subtype;
            }
        }
    });
}

export class Animal {}
export class Dog extends Animal {}

export class Plant {}
export class Tree extends Plant {}

export function func1(val: Animal) {
    if (val instanceof Tree) {
        console.log(val);
    } else {
        console.log(val);
    }
}
