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
    ArgCategory,
    AssignmentExpressionNode,
    ExpressionNode,
    isExpressionNode,
    NameNode,
    ParamCategory,
    ParseNode,
    ParseNodeType,
} from '../parser/parseNodes';
import { KeywordType, OperatorType } from '../parser/tokenizerTypes';
import { getFileInfo } from './analyzerNodeInfo';
import { addConstraintsForExpectedType } from './constraintSolver';
import { ConstraintTracker } from './constraintTracker';
import { Declaration, DeclarationType } from './declaration';
import { transformTypeForEnumMember } from './enums';
import * as ParseTreeUtils from './parseTreeUtils';
import { ScopeType } from './scope';
import { getScopeForNode, isScopeContainedWithin } from './scopeUtils';
import { Symbol, SymbolFlags } from './symbol';
import { getTypedDictMembersForClass } from './typedDicts';
import { AssignTypeFlags, EvalFlags, TypeEvaluator } from './typeEvaluatorTypes';
import {
    AnyType,
    ClassType,
    ClassTypeFlags,
    combineTypes,
    EnumLiteral,
    FunctionParam,
    FunctionParamFlags,
    FunctionType,
    FunctionTypeFlags,
    isAnyOrUnknown,
    isClass,
    isClassInstance,
    isFunction,
    isFunctionOrOverloaded,
    isInstantiableClass,
    isModule,
    isNever,
    isOverloaded,
    isParamSpec,
    isTypeSame,
    isTypeVar,
    isUnpackedTypeVarTuple,
    maxTypeRecursionCount,
    OverloadedType,
    TupleTypeArg,
    Type,
    TypeBase,
    TypeCondition,
    TypedDictEntry,
    TypeVarType,
    UnknownType,
} from './types';
import {
    addConditionToType,
    ClassMember,
    computeMroLinearization,
    convertToInstance,
    convertToInstantiable,
    derivesFromAnyOrUnknown,
    doForEachSubtype,
    getSpecializedTupleType,
    getTypeCondition,
    getTypeVarScopeIds,
    getUnknownTypeForCallable,
    isInstantiableMetaclass,
    isLiteralLikeType,
    isLiteralType,
    isLiteralTypeOrUnion,
    isMaybeDescriptorInstance,
    isMetaclassInstance,
    isNoneInstance,
    isNoneTypeClass,
    isProperty,
    isTupleClass,
    isTupleGradualForm,
    isUnboundedTupleClass,
    lookUpClassMember,
    lookUpObjectMember,
    makeTypeVarsFree,
    mapSubtypes,
    MemberAccessFlags,
    specializeTupleClass,
    specializeWithUnknownTypeArgs,
    stripTypeForm,
    transformPossibleRecursiveTypeAlias,
} from './typeUtils';

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
            testExpression.d.operator === OperatorType.Is || testExpression.d.operator === OperatorType.IsNot;
        const equalsOrNotEqualsOperator =
            testExpression.d.operator === OperatorType.Equals || testExpression.d.operator === OperatorType.NotEquals;
        const comparisonOperator =
            equalsOrNotEqualsOperator ||
            testExpression.d.operator === OperatorType.LessThan ||
            testExpression.d.operator === OperatorType.LessThanOrEqual ||
            testExpression.d.operator === OperatorType.GreaterThan ||
            testExpression.d.operator === OperatorType.GreaterThanOrEqual;

        if (isOrIsNotOperator || equalsOrNotEqualsOperator) {
            // Invert the "isPositiveTest" value if this is an "is not" operation.
            const adjIsPositiveTest =
                testExpression.d.operator === OperatorType.Is || testExpression.d.operator === OperatorType.Equals
                    ? isPositiveTest
                    : !isPositiveTest;

            // Look for "X is None", "X is not None", "X == None", and "X != None".
            // These are commonly-used patterns used in control flow.
            if (
                testExpression.d.rightExpr.nodeType === ParseNodeType.Constant &&
                testExpression.d.rightExpr.d.constType === KeywordType.None
            ) {
                // Allow the LHS to be either a simple expression or an assignment
                // expression that assigns to a simple name.
                let leftExpression = testExpression.d.leftExpr;
                if (leftExpression.nodeType === ParseNodeType.AssignmentExpression) {
                    leftExpression = leftExpression.d.name;
                }

                if (
                    ParseTreeUtils.isMatchingExpression(reference, leftExpression, (ref, expr) =>
                        isNameSameScope(evaluator, ref, expr)
                    )
                ) {
                    return (type: Type) => {
                        return { type: narrowTypeForIsNone(evaluator, type, adjIsPositiveTest), isIncomplete: false };
                    };
                }

                if (
                    leftExpression.nodeType === ParseNodeType.Index &&
                    ParseTreeUtils.isMatchingExpression(reference, leftExpression.d.leftExpr, (ref, expr) =>
                        isNameSameScope(evaluator, ref, expr)
                    ) &&
                    leftExpression.d.items.length === 1 &&
                    !leftExpression.d.trailingComma &&
                    leftExpression.d.items[0].d.argCategory === ArgCategory.Simple &&
                    !leftExpression.d.items[0].d.name &&
                    leftExpression.d.items[0].d.valueExpr.nodeType === ParseNodeType.Number &&
                    leftExpression.d.items[0].d.valueExpr.d.isInteger &&
                    !leftExpression.d.items[0].d.valueExpr.d.isImaginary
                ) {
                    const indexValue = leftExpression.d.items[0].d.valueExpr.d.value;
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
            if (testExpression.d.rightExpr.nodeType === ParseNodeType.Ellipsis) {
                // Allow the LHS to be either a simple expression or an assignment
                // expression that assigns to a simple name.
                let leftExpression = testExpression.d.leftExpr;
                if (leftExpression.nodeType === ParseNodeType.AssignmentExpression) {
                    leftExpression = leftExpression.d.name;
                }

                if (
                    ParseTreeUtils.isMatchingExpression(reference, leftExpression, (ref, expr) =>
                        isNameSameScope(evaluator, ref, expr)
                    )
                ) {
                    return (type: Type) => {
                        return {
                            type: narrowTypeForIsEllipsis(evaluator, testExpression, type, adjIsPositiveTest),
                            isIncomplete: false,
                        };
                    };
                }
            }

            // Look for "type(X) is Y", "type(X) is not Y", "type(X) == Y" or "type(X) != Y".
            if (testExpression.d.leftExpr.nodeType === ParseNodeType.Call) {
                if (
                    testExpression.d.leftExpr.d.args.length === 1 &&
                    testExpression.d.leftExpr.d.args[0].d.argCategory === ArgCategory.Simple
                ) {
                    const arg0Expr = testExpression.d.leftExpr.d.args[0].d.valueExpr;
                    if (
                        ParseTreeUtils.isMatchingExpression(reference, arg0Expr, (ref, expr) =>
                            isNameSameScope(evaluator, ref, expr)
                        )
                    ) {
                        const callType = evaluator.getTypeOfExpression(
                            testExpression.d.leftExpr.d.leftExpr,
                            EvalFlags.CallBaseDefaults
                        ).type;

                        if (isInstantiableClass(callType) && ClassType.isBuiltIn(callType, 'type')) {
                            const rhsResult = evaluator.getTypeOfExpression(testExpression.d.rightExpr);
                            const classTypes: ClassType[] = [];
                            let isClassType = true;

                            evaluator.mapSubtypesExpandTypeVars(
                                rhsResult.type,
                                /* options */ undefined,
                                (expandedSubtype) => {
                                    if (isInstantiableClass(expandedSubtype)) {
                                        classTypes.push(expandedSubtype);
                                    } else {
                                        isClassType = false;
                                    }
                                    return undefined;
                                }
                            );

                            if (isClassType && classTypes.length > 0) {
                                return (type: Type) => {
                                    return {
                                        type: narrowTypeForTypeIs(evaluator, type, classTypes, adjIsPositiveTest),
                                        isIncomplete: !!rhsResult.isIncomplete,
                                    };
                                };
                            }
                        }
                    }
                }
            }

            if (isOrIsNotOperator) {
                if (
                    ParseTreeUtils.isMatchingExpression(reference, testExpression.d.leftExpr, (ref, expr) =>
                        isNameSameScope(evaluator, ref, expr)
                    )
                ) {
                    const rightTypeResult = evaluator.getTypeOfExpression(testExpression.d.rightExpr);
                    const rightType = rightTypeResult.type;

                    // Look for "X is Y" or "X is not Y" where Y is a literal.
                    if (isClassInstance(rightType) && rightType.priv.literalValue !== undefined) {
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
                    testExpression.d.leftExpr.nodeType === ParseNodeType.Index &&
                    testExpression.d.leftExpr.d.items.length === 1 &&
                    !testExpression.d.leftExpr.d.trailingComma &&
                    testExpression.d.leftExpr.d.items[0].d.argCategory === ArgCategory.Simple &&
                    ParseTreeUtils.isMatchingExpression(reference, testExpression.d.leftExpr.d.leftExpr, (ref, expr) =>
                        isNameSameScope(evaluator, ref, expr)
                    )
                ) {
                    const indexTypeResult = evaluator.getTypeOfExpression(
                        testExpression.d.leftExpr.d.items[0].d.valueExpr
                    );
                    const indexType = indexTypeResult.type;

                    if (isClassInstance(indexType) && isLiteralType(indexType)) {
                        if (ClassType.isBuiltIn(indexType, 'str')) {
                            const rightType = evaluator.getTypeOfExpression(testExpression.d.rightExpr).type;
                            if (isClassInstance(rightType) && rightType.priv.literalValue !== undefined) {
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
                            const rightTypeResult = evaluator.getTypeOfExpression(testExpression.d.rightExpr);
                            const rightType = rightTypeResult.type;

                            if (isClassInstance(rightType) && rightType.priv.literalValue !== undefined) {
                                let canNarrow = false;
                                // Narrowing can be applied only for bool or enum literals.
                                if (ClassType.isBuiltIn(rightType, 'bool')) {
                                    canNarrow = true;
                                } else if (rightType.priv.literalValue instanceof EnumLiteral) {
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
                    testExpression.d.operator === OperatorType.Equals ? isPositiveTest : !isPositiveTest;

                if (
                    ParseTreeUtils.isMatchingExpression(reference, testExpression.d.leftExpr, (ref, expr) =>
                        isNameSameScope(evaluator, ref, expr)
                    )
                ) {
                    const rightTypeResult = evaluator.getTypeOfExpression(testExpression.d.rightExpr);
                    const rightType = rightTypeResult.type;

                    if (isClassInstance(rightType) && rightType.priv.literalValue !== undefined) {
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
                    testExpression.d.leftExpr.nodeType === ParseNodeType.Index &&
                    testExpression.d.leftExpr.d.items.length === 1 &&
                    !testExpression.d.leftExpr.d.trailingComma &&
                    testExpression.d.leftExpr.d.items[0].d.argCategory === ArgCategory.Simple &&
                    ParseTreeUtils.isMatchingExpression(reference, testExpression.d.leftExpr.d.leftExpr, (ref, expr) =>
                        isNameSameScope(evaluator, ref, expr)
                    )
                ) {
                    const indexTypeResult = evaluator.getTypeOfExpression(
                        testExpression.d.leftExpr.d.items[0].d.valueExpr
                    );
                    const indexType = indexTypeResult.type;

                    if (isClassInstance(indexType) && isLiteralType(indexType)) {
                        if (ClassType.isBuiltIn(indexType, ['str', 'int'])) {
                            const rightTypeResult = evaluator.getTypeOfExpression(testExpression.d.rightExpr);
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
                testExpression.d.leftExpr.nodeType === ParseNodeType.MemberAccess &&
                ParseTreeUtils.isMatchingExpression(reference, testExpression.d.leftExpr.d.leftExpr, (ref, expr) =>
                    isNameSameScope(evaluator, ref, expr)
                )
            ) {
                const rightTypeResult = evaluator.getTypeOfExpression(testExpression.d.rightExpr);
                const rightType = rightTypeResult.type;
                const memberName = testExpression.d.leftExpr.d.member;

                if (isClassInstance(rightType)) {
                    if (rightType.priv.literalValue !== undefined || isNoneInstance(rightType)) {
                        return (type: Type) => {
                            return {
                                type: narrowTypeForDiscriminatedLiteralFieldComparison(
                                    evaluator,
                                    type,
                                    memberName.d.value,
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
                testExpression.d.leftExpr.nodeType === ParseNodeType.MemberAccess &&
                ParseTreeUtils.isMatchingExpression(reference, testExpression.d.leftExpr.d.leftExpr, (ref, expr) =>
                    isNameSameScope(evaluator, ref, expr)
                )
            ) {
                const rightTypeResult = evaluator.getTypeOfExpression(testExpression.d.rightExpr);
                const rightType = rightTypeResult.type;
                const memberName = testExpression.d.leftExpr.d.member;

                if (
                    isClassInstance(rightType) &&
                    (ClassType.isEnumClass(rightType) || ClassType.isBuiltIn(rightType, 'bool')) &&
                    rightType.priv.literalValue !== undefined
                ) {
                    return (type: Type) => {
                        return {
                            type: narrowTypeForDiscriminatedLiteralFieldComparison(
                                evaluator,
                                type,
                                memberName.d.value,
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
                testExpression.d.leftExpr.nodeType === ParseNodeType.MemberAccess &&
                ParseTreeUtils.isMatchingExpression(reference, testExpression.d.leftExpr.d.leftExpr, (ref, expr) =>
                    isNameSameScope(evaluator, ref, expr)
                ) &&
                testExpression.d.rightExpr.nodeType === ParseNodeType.Constant &&
                testExpression.d.rightExpr.d.constType === KeywordType.None
            ) {
                const memberName = testExpression.d.leftExpr.d.member;
                return (type: Type) => {
                    return {
                        type: narrowTypeForDiscriminatedFieldNoneComparison(
                            evaluator,
                            type,
                            memberName.d.value,
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
            testExpression.d.leftExpr.nodeType === ParseNodeType.Call &&
            testExpression.d.leftExpr.d.args.length === 1
        ) {
            const arg0Expr = testExpression.d.leftExpr.d.args[0].d.valueExpr;

            if (
                ParseTreeUtils.isMatchingExpression(reference, arg0Expr, (ref, expr) =>
                    isNameSameScope(evaluator, ref, expr)
                )
            ) {
                const callTypeResult = evaluator.getTypeOfExpression(
                    testExpression.d.leftExpr.d.leftExpr,
                    EvalFlags.CallBaseDefaults
                );
                const callType = callTypeResult.type;

                if (isFunction(callType) && callType.shared.fullName === 'builtins.len') {
                    const rightTypeResult = evaluator.getTypeOfExpression(testExpression.d.rightExpr);
                    const rightType = rightTypeResult.type;

                    if (
                        isClassInstance(rightType) &&
                        typeof rightType.priv.literalValue === 'number' &&
                        rightType.priv.literalValue >= 0
                    ) {
                        let tupleLength = rightType.priv.literalValue;

                        // We'll treat <, <= and == as positive tests with >=, > and != as
                        // their negative counterparts.
                        const isLessOrEqual =
                            testExpression.d.operator === OperatorType.Equals ||
                            testExpression.d.operator === OperatorType.LessThan ||
                            testExpression.d.operator === OperatorType.LessThanOrEqual;

                        const adjIsPositiveTest = isLessOrEqual ? isPositiveTest : !isPositiveTest;

                        // For <= (or its negative counterpart >), adjust the tuple length by 1.
                        if (
                            testExpression.d.operator === OperatorType.LessThanOrEqual ||
                            testExpression.d.operator === OperatorType.GreaterThan
                        ) {
                            tupleLength++;
                        }

                        const isEqualityCheck =
                            testExpression.d.operator === OperatorType.Equals ||
                            testExpression.d.operator === OperatorType.NotEquals;

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

        if (testExpression.d.operator === OperatorType.In || testExpression.d.operator === OperatorType.NotIn) {
            // Look for "x in y" or "x not in y" where y is one of several built-in types.
            if (
                ParseTreeUtils.isMatchingExpression(reference, testExpression.d.leftExpr, (ref, expr) =>
                    isNameSameScope(evaluator, ref, expr)
                )
            ) {
                const rightTypeResult = evaluator.getTypeOfExpression(testExpression.d.rightExpr);
                const rightType = rightTypeResult.type;
                const adjIsPositiveTest =
                    testExpression.d.operator === OperatorType.In ? isPositiveTest : !isPositiveTest;

                return (type: Type) => {
                    return {
                        type: narrowTypeForContainerType(evaluator, type, rightType, adjIsPositiveTest),
                        isIncomplete: !!rightTypeResult.isIncomplete,
                    };
                };
            }

            if (
                ParseTreeUtils.isMatchingExpression(reference, testExpression.d.rightExpr, (ref, expr) =>
                    isNameSameScope(evaluator, ref, expr)
                )
            ) {
                // Look for <string literal> in y where y is a union that contains
                // one or more TypedDicts.
                const leftTypeResult = evaluator.getTypeOfExpression(testExpression.d.leftExpr);
                const leftType = leftTypeResult.type;

                if (isClassInstance(leftType) && ClassType.isBuiltIn(leftType, 'str') && isLiteralType(leftType)) {
                    const adjIsPositiveTest =
                        testExpression.d.operator === OperatorType.In ? isPositiveTest : !isPositiveTest;
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
        if (testExpression.d.args.length === 2) {
            // Make sure the first parameter is a supported expression type
            // and the second parameter is a valid class type or a tuple
            // of valid class types.
            const arg0Expr = testExpression.d.args[0].d.valueExpr;
            const arg1Expr = testExpression.d.args[1].d.valueExpr;

            if (
                ParseTreeUtils.isMatchingExpression(reference, arg0Expr, (ref, expr) =>
                    isNameSameScope(evaluator, ref, expr)
                )
            ) {
                const callTypeResult = evaluator.getTypeOfExpression(
                    testExpression.d.leftExpr,
                    EvalFlags.CallBaseDefaults
                );
                const callType = callTypeResult.type;

                if (isFunction(callType) && FunctionType.isBuiltIn(callType, ['isinstance', 'issubclass'])) {
                    const isInstanceCheck = FunctionType.isBuiltIn(callType, 'isinstance');
                    const arg1TypeResult = evaluator.getTypeOfExpression(arg1Expr, EvalFlags.IsInstanceArgDefaults);
                    const arg1Type = arg1TypeResult.type;

                    const classTypeList = getIsInstanceClassTypes(evaluator, arg1Type);
                    const isIncomplete = !!callTypeResult.isIncomplete || !!arg1TypeResult.isIncomplete;

                    if (classTypeList) {
                        return (type: Type) => {
                            return {
                                type: narrowTypeForInstanceOrSubclass(
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

        // Look for "bool(X)"
        if (testExpression.d.args.length === 1 && !testExpression.d.args[0].d.name) {
            if (
                ParseTreeUtils.isMatchingExpression(reference, testExpression.d.args[0].d.valueExpr, (ref, expr) =>
                    isNameSameScope(evaluator, ref, expr)
                )
            ) {
                const callTypeResult = evaluator.getTypeOfExpression(
                    testExpression.d.leftExpr,
                    EvalFlags.CallBaseDefaults
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
        if (testExpression.d.args.length >= 1) {
            const arg0Expr = testExpression.d.args[0].d.valueExpr;
            if (
                ParseTreeUtils.isMatchingExpression(reference, arg0Expr, (ref, expr) =>
                    isNameSameScope(evaluator, ref, expr)
                )
            ) {
                // Does this look like it's a custom type guard function?
                let isPossiblyTypeGuard = false;

                const isFunctionReturnTypeGuard = (type: FunctionType) => {
                    return (
                        type.shared.declaredReturnType &&
                        isClassInstance(type.shared.declaredReturnType) &&
                        ClassType.isBuiltIn(type.shared.declaredReturnType, ['TypeGuard', 'TypeIs'])
                    );
                };

                const callTypeResult = evaluator.getTypeOfExpression(
                    testExpression.d.leftExpr,
                    EvalFlags.CallBaseDefaults
                );
                const callType = callTypeResult.type;

                if (isFunction(callType) && isFunctionReturnTypeGuard(callType)) {
                    isPossiblyTypeGuard = true;
                } else if (
                    isOverloaded(callType) &&
                    OverloadedType.getOverloads(callType).some((o) => isFunctionReturnTypeGuard(o))
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
                        ClassType.isBuiltIn(functionReturnType, ['TypeGuard', 'TypeIs']) &&
                        functionReturnType.priv.typeArgs &&
                        functionReturnType.priv.typeArgs.length > 0
                    ) {
                        const isStrictTypeGuard = ClassType.isBuiltIn(functionReturnType, 'TypeIs');
                        const typeGuardType = functionReturnType.priv.typeArgs[0];
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

    if (
        ParseTreeUtils.isMatchingExpression(reference, testExpression, (ref, expr) =>
            isNameSameScope(evaluator, ref, expr)
        )
    ) {
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
        if (
            testExpression.nodeType === ParseNodeType.UnaryOperation &&
            testExpression.d.operator === OperatorType.Not
        ) {
            return getTypeNarrowingCallback(
                evaluator,
                reference,
                testExpression.d.expr,
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

    const symbol = scope.lookUpSymbol(name.d.value);
    if (!symbol) {
        return undefined;
    }

    const decls = symbol.getDeclarations();
    if (requireUnique && decls.length > 1) {
        return undefined;
    }

    if (
        decls.length === 0 ||
        decls.some((decl) => decl.type !== DeclarationType.Variable && decl.type !== DeclarationType.Param)
    ) {
        return undefined;
    }

    // If there are any assignments within different scopes (e.g. via a "global" or
    // "nonlocal" reference), don't consider it a local variable.
    let prevDeclScope: ParseNode | undefined;
    if (
        decls.some((decl) => {
            const nodeToConsider = decl.type === DeclarationType.Param ? decl.node.d.name! : decl.node;
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
        getTypeNarrowingCallback(evaluator, reference, testExpression.d.rightExpr, isPositiveTest, recursionCount) ??
        getTypeNarrowingCallback(evaluator, reference, testExpression.d.name, isPositiveTest, recursionCount)
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
        let result = type;

        if (isPositiveTest) {
            result = typeGuardType;

            // If the type guard is a non-constrained TypeVar, add a
            // condition to the resulting type.
            if (isTypeVar(type) && !isParamSpec(type) && !TypeVarType.hasConstraints(type)) {
                result = addConditionToType(result, [{ typeVar: type, constraintIndex: 0 }]);
            }
            return result;
        }

        return result;
    }

    const filterTypes: Type[] = [];
    doForEachSubtype(typeGuardType, (typeGuardSubtype) => {
        filterTypes.push(convertToInstantiable(typeGuardSubtype));
    });

    return narrowTypeForInstanceOrSubclass(
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
        if (!tupleType || isUnboundedTupleClass(tupleType) || !tupleType.priv.tupleTypeArgs) {
            return subtype;
        }

        const tupleLength = tupleType.priv.tupleTypeArgs.length;
        if (indexValue < 0 || indexValue >= tupleLength) {
            return subtype;
        }

        const typeOfEntry = evaluator.makeTopLevelTypeVarsConcrete(tupleType.priv.tupleTypeArgs[indexValue].type);

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
                // Assume that "Any" is always both None and not None, so it matches
                // regardless of whether the test is positive or negative.
                return subtype;
            }

            let useExpandedSubtype = false;
            if (isTypeVar(unexpandedSubtype) && !TypeVarType.isSelf(unexpandedSubtype)) {
                // If the TypeVar has value constraints and one or more of them
                // are possibly compatible with None, use the expanded subtypes.
                if (
                    unexpandedSubtype.shared.constraints.some((constraint) => {
                        return evaluator.assignType(constraint, evaluator.getNoneType());
                    })
                ) {
                    useExpandedSubtype = true;
                }

                // If the TypeVar han an explicit bound that is possibly compatible
                // with None (e.g. "T: int | None"), use the expanded subtypes.
                if (
                    unexpandedSubtype.shared.boundType &&
                    evaluator.assignType(unexpandedSubtype.shared.boundType, evaluator.getNoneType())
                ) {
                    useExpandedSubtype = true;
                }
            }

            const adjustedSubtype = useExpandedSubtype ? subtype : unexpandedSubtype;

            // Is it an exact match for None?
            if (isNoneInstance(subtype)) {
                resultIncludesNoneSubtype = true;
                return isPositiveTest ? adjustedSubtype : undefined;
            }

            // Is it potentially None?
            if (evaluator.assignType(subtype, evaluator.getNoneType())) {
                resultIncludesNoneSubtype = true;
                return isPositiveTest
                    ? addConditionToType(evaluator.getNoneType(), subtype.props?.condition)
                    : adjustedSubtype;
            }

            return isPositiveTest ? undefined : adjustedSubtype;
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
function narrowTypeForIsEllipsis(evaluator: TypeEvaluator, node: ExpressionNode, type: Type, isPositiveTest: boolean) {
    const expandedType = mapSubtypes(type, (subtype) => {
        return transformPossibleRecursiveTypeAlias(subtype);
    });

    let resultIncludesEllipsisSubtype = false;

    const ellipsisType =
        evaluator.getBuiltInObject(node, 'EllipsisType') ??
        evaluator.getBuiltInObject(node, 'ellipsis') ??
        AnyType.create();

    const isEllipsisInstance = (subtype: Type) => {
        return isClassInstance(subtype) && ClassType.isBuiltIn(subtype, ['EllipsisType', 'ellipsis']);
    };

    const result = evaluator.mapSubtypesExpandTypeVars(
        expandedType,
        /* options */ undefined,
        (subtype, unexpandedSubtype) => {
            if (isAnyOrUnknown(subtype)) {
                // We need to assume that "Any" is always both ellipsis and not ellipsis,
                // so it matches regardless of whether the test is positive or negative.
                return subtype;
            }

            // If this is a TypeVar that isn't constrained, use the unexpanded
            // TypeVar. For all other cases (including constrained TypeVars),
            // use the expanded subtype.
            const adjustedSubtype =
                isTypeVar(unexpandedSubtype) && !TypeVarType.hasConstraints(unexpandedSubtype)
                    ? unexpandedSubtype
                    : subtype;

            // Is it an exact match for ellipsis?
            if (isEllipsisInstance(subtype)) {
                resultIncludesEllipsisSubtype = true;
                return isPositiveTest ? adjustedSubtype : undefined;
            }

            // Is it potentially ellipsis?
            if (evaluator.assignType(subtype, ellipsisType)) {
                resultIncludesEllipsisSubtype = true;
                return isPositiveTest ? addConditionToType(ellipsisType, subtype.props?.condition) : adjustedSubtype;
            }

            return isPositiveTest ? undefined : adjustedSubtype;
        }
    );

    // If this is a positive test and the result is a union that includes ellipsis,
    // we can eliminate all the non-ellipsis subtypes include Any or Unknown. If some
    // of the subtypes are ellipsis types with conditions, retain those.
    if (isPositiveTest && resultIncludesEllipsisSubtype) {
        return mapSubtypes(result, (subtype) => {
            return isEllipsisInstance(subtype) ? subtype : undefined;
        });
    }

    return result;
}

// The "isinstance" and "issubclass" calls support two forms - a simple form
// that accepts a single class, and a more complex form that accepts a tuple
// of classes (including arbitrarily-nested tuples). This method determines
// which form and returns a list of classes or undefined.
export function getIsInstanceClassTypes(
    evaluator: TypeEvaluator,
    argType: Type
): (ClassType | TypeVarType | FunctionType)[] | undefined {
    let foundNonClassType = false;
    const classTypeList: (ClassType | TypeVarType | FunctionType)[] = [];

    // Create a helper function that returns a list of class types or
    // undefined if any of the types are not valid.
    const addClassTypesToList = (types: Type[]) => {
        types.forEach((subtype) => {
            if (isClass(subtype)) {
                subtype = specializeWithUnknownTypeArgs(subtype, evaluator.getTupleClassType());

                if (isInstantiableClass(subtype) && ClassType.isBuiltIn(subtype, 'Callable')) {
                    subtype = convertToInstantiable(getUnknownTypeForCallable());
                }
            }

            if (isInstantiableClass(subtype)) {
                // If this is a reference to a class that has type promotions (e.g.
                // float or complex), remove the promotions for purposes of the
                // isinstance check).
                if (!subtype.priv.includeSubclasses && subtype.priv.includePromotions) {
                    subtype = ClassType.cloneRemoveTypePromotions(subtype);
                }
                classTypeList.push(subtype);
            } else if (isTypeVar(subtype) && TypeBase.isInstantiable(subtype)) {
                classTypeList.push(subtype);
            } else if (isNoneTypeClass(subtype)) {
                assert(isInstantiableClass(subtype));
                classTypeList.push(subtype);
            } else if (
                isFunction(subtype) &&
                subtype.shared.parameters.length === 2 &&
                subtype.shared.parameters[0].category === ParamCategory.ArgsList &&
                subtype.shared.parameters[1].category === ParamCategory.KwargsDict
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
            if (type.priv.tupleTypeArgs) {
                type.priv.tupleTypeArgs.forEach((tupleEntry) => {
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

export function narrowTypeForInstanceOrSubclass(
    evaluator: TypeEvaluator,
    type: Type,
    filterTypes: Type[],
    isInstanceCheck: boolean,
    isTypeIsCheck: boolean,
    isPositiveTest: boolean,
    errorNode: ExpressionNode
) {
    // First try with intersection types disallowed.
    const narrowedType = narrowTypeForInstanceOrSubclassInternal(
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
    return narrowTypeForInstanceOrSubclassInternal(
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

function narrowTypeForInstanceOrSubclassInternal(
    evaluator: TypeEvaluator,
    type: Type,
    filterTypes: Type[],
    isInstanceCheck: boolean,
    isTypeIsCheck: boolean,
    isPositiveTest: boolean,
    allowIntersections: boolean,
    errorNode: ExpressionNode
): Type {
    const result = mapSubtypes(type, (subtype) => {
        let adjSubtype = subtype;
        let resultRequiresAdj = false;
        let adjFilterTypes = filterTypes;

        if (!isInstanceCheck) {
            const isTypeInstance = isClassInstance(subtype) && ClassType.isBuiltIn(subtype, 'type');

            // Handle metaclass instances specially.
            if (isMetaclassInstance(subtype) && !isTypeInstance) {
                adjFilterTypes = filterTypes.map((filterType) => convertToInstantiable(filterType));
            } else {
                adjSubtype = convertToInstance(subtype);

                if (!isAnyOrUnknown(subtype) || isPositiveTest) {
                    resultRequiresAdj = true;
                }
            }
        }

        const narrowedResult = narrowTypeForInstance(
            evaluator,
            adjSubtype,
            adjFilterTypes,
            isTypeIsCheck,
            isPositiveTest,
            allowIntersections,
            errorNode
        );

        if (!resultRequiresAdj) {
            return narrowedResult;
        }

        if (isAnyOrUnknown(narrowedResult)) {
            const typeClass = evaluator.getTypeClassType();
            if (typeClass) {
                return ClassType.specialize(ClassType.cloneAsInstance(typeClass), [narrowedResult]);
            }
        }

        return convertToInstantiable(narrowedResult);
    });

    return result;
}

// Narrows a type based on a call to isinstance. For example, if the original
// type of expression "x" is "Mammal" and the test expression is
// "isinstance(x, Cow)", (assuming "Cow" is a subclass of "Mammal"), we can
// narrow x to "Cow".
function narrowTypeForInstance(
    evaluator: TypeEvaluator,
    type: Type,
    filterTypes: Type[],
    isTypeIsCheck: boolean,
    isPositiveTest: boolean,
    allowIntersections: boolean,
    errorNode: ExpressionNode
): Type {
    let expandedTypes = mapSubtypes(type, (subtype) => {
        return transformPossibleRecursiveTypeAlias(subtype);
    });

    expandedTypes = evaluator.expandPromotionTypes(errorNode, expandedTypes);

    const convertVarTypeToFree = (varType: Type): Type => {
        // If this is a TypeIs check, type variables should remain bound.
        if (isTypeIsCheck) {
            return varType;
        }

        // If this is an isinstance or issubclass check, the type variables
        // should be converted to "free" type variables.
        return makeTypeVarsFree(varType, ParseTreeUtils.getTypeVarScopesForNode(errorNode));
    };

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
            const concreteFilterType = evaluator.makeTopLevelTypeVarsConcrete(filterType);

            if (isInstantiableClass(concreteFilterType)) {
                const filterMetaclass = concreteFilterType.shared.effectiveMetaclass;
                if (
                    isInstantiableMetaclass(concreteVarType) &&
                    TypeBase.getInstantiableDepth(concreteFilterType) > 0 &&
                    filterMetaclass &&
                    isInstantiableClass(filterMetaclass)
                ) {
                    const metaclassType = convertToInstance(concreteVarType);
                    let isMetaclassOverlap = evaluator.assignType(
                        convertVarTypeToFree(metaclassType),
                        ClassType.cloneAsInstance(filterMetaclass)
                    );

                    // Handle the special case where the metaclass for the filter is type.
                    // This will normally be treated as type[Any], which is compatible with
                    // any metaclass, but we specifically want to treat type as the class
                    // type[object] in this case.
                    if (ClassType.isBuiltIn(filterMetaclass, 'type') && !filterMetaclass.priv.isTypeArgExplicit) {
                        if (!isClass(metaclassType) || !ClassType.isBuiltIn(metaclassType, 'type')) {
                            isMetaclassOverlap = false;
                        }
                    }

                    if (isMetaclassOverlap) {
                        if (isPositiveTest) {
                            filteredTypes.push(filterType);
                            foundSuperclass = true;
                        } else if (
                            !isTypeSame(metaclassType, filterMetaclass) ||
                            filterMetaclass.priv.includeSubclasses
                        ) {
                            filteredTypes.push(metaclassType);
                            isClassRelationshipIndeterminate = true;
                        }
                        continue;
                    }
                }

                let runtimeVarType = concreteVarType;

                // Type variables are erased for runtime types, so switch from
                // bound to free type variables. We'll retain the bound type
                // variables for TypeIs checks.
                if (!isTypeIsCheck) {
                    runtimeVarType = makeTypeVarsFree(
                        runtimeVarType,
                        ParseTreeUtils.getTypeVarScopesForNode(errorNode)
                    );
                }

                // If the value is a TypedDict, convert it into its runtime form,
                // which is a dict[str, Any].
                if (isInstantiableClass(runtimeVarType) && ClassType.isTypedDictClass(runtimeVarType)) {
                    const dictClass = evaluator.getDictClassType();
                    const strType = evaluator.getStrClassType();

                    if (dictClass && strType) {
                        runtimeVarType = ClassType.specialize(dictClass, [
                            ClassType.cloneAsInstance(strType),
                            UnknownType.create(),
                        ]);
                    }
                }

                const filterIsSuperclass = evaluator.assignType(
                    filterType,
                    runtimeVarType,
                    /* diag */ undefined,
                    /* constraints */ undefined,
                    AssignTypeFlags.AllowIsinstanceSpecialForms | AssignTypeFlags.AllowProtocolClassSource
                );

                let filterIsSubclass = evaluator.assignType(
                    runtimeVarType,
                    filterType,
                    /* diag */ undefined,
                    /* constraints */ undefined,
                    AssignTypeFlags.AllowIsinstanceSpecialForms | AssignTypeFlags.AllowProtocolClassSource
                );

                if (filterIsSuperclass) {
                    foundSuperclass = true;
                }

                // Special-case the TypeForm special form. This represents a variety
                // of runtime classes that will not appear to overlap with TypeForm.
                if (ClassType.isBuiltIn(runtimeVarType, 'TypeForm')) {
                    isClassRelationshipIndeterminate = true;
                    filterIsSubclass = true;
                }

                // Normally, a type should never be both a subclass and a superclass.
                // This can happen if either of the class types derives from a
                // class whose type is unknown (e.g. an import failed). We'll
                // note this case specially so we don't do any narrowing, which
                // will generate false positives.
                if (filterIsSuperclass) {
                    if (!isTypeIsCheck && concreteFilterType.priv.includeSubclasses) {
                        // If the filter type includes subclasses, we can't eliminate
                        // this type in the negative direction. We'll relax this for
                        // TypeIs checks.
                        isClassRelationshipIndeterminate = true;
                    }

                    if (filterIsSubclass && !ClassType.isSameGenericClass(runtimeVarType, concreteFilterType)) {
                        // If the runtime variable type is a type[T], handle a filter
                        // of 'type' as a special case.
                        if (
                            !ClassType.isBuiltIn(concreteFilterType, 'type') ||
                            TypeBase.getInstantiableDepth(runtimeVarType) === 0
                        ) {
                            isClassRelationshipIndeterminate = true;
                        }
                    }
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
                        if (isTypeVar(varType) && TypeVarType.isSelf(varType)) {
                            filteredTypes.push(addConditionToType(varType, conditions));
                        } else {
                            filteredTypes.push(addConditionToType(concreteVarType, conditions));
                        }
                    } else if (filterIsSubclass) {
                        // If the variable type is a superclass of the isinstance
                        // filter, we can narrow the type to the subclass.
                        let specializedFilterType = filterType;

                        // Try to retain the type arguments for the filter type. This is
                        // important because a specialized version of the filter cannot
                        // be passed to isinstance or issubclass.
                        if (isClass(filterType)) {
                            if (ClassType.isSpecialBuiltIn(filterType) || filterType.shared.typeParams.length > 0) {
                                if (
                                    !filterType.priv.isTypeArgExplicit &&
                                    !ClassType.isSameGenericClass(concreteVarType, filterType)
                                ) {
                                    const constraints = new ConstraintTracker();
                                    const unspecializedFilterType = ClassType.specialize(
                                        filterType,
                                        /* typeArg */ undefined
                                    );

                                    if (
                                        addConstraintsForExpectedType(
                                            evaluator,
                                            ClassType.cloneAsInstance(unspecializedFilterType),
                                            ClassType.cloneAsInstance(concreteVarType),
                                            constraints,
                                            /* liveTypeVarScopes */ undefined,
                                            errorNode.start
                                        )
                                    ) {
                                        specializedFilterType = evaluator.solveAndApplyConstraints(
                                            unspecializedFilterType,
                                            constraints,
                                            {
                                                replaceUnsolved: {
                                                    scopeIds: getTypeVarScopeIds(filterType),
                                                    useUnknown: true,
                                                    tupleClassType: evaluator.getTupleClassType(),
                                                },
                                            }
                                        ) as ClassType;
                                    }
                                }
                            }
                        }

                        filteredTypes.push(addConditionToType(specializedFilterType, conditions));
                    } else if (
                        ClassType.isSameGenericClass(
                            ClassType.cloneAsInstance(concreteVarType),
                            ClassType.cloneAsInstance(concreteFilterType)
                        )
                    ) {
                        if (!isTypeIsCheck) {
                            // Don't attempt to narrow in this case.
                            if (
                                concreteVarType.priv?.literalValue === undefined &&
                                concreteFilterType.priv?.literalValue === undefined
                            ) {
                                const intersection = intersectSameClassType(
                                    evaluator,
                                    concreteVarType,
                                    concreteFilterType
                                );
                                filteredTypes.push(intersection ?? varType);
                            }
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
                        let newClassType = evaluator.createSubclass(errorNode, concreteVarType, concreteFilterType);
                        if (isTypeVar(varType) && !isParamSpec(varType) && !TypeVarType.hasConstraints(varType)) {
                            newClassType = addConditionToType(newClassType, [{ typeVar: varType, constraintIndex: 0 }]);
                        }

                        filteredTypes.push(addConditionToType(newClassType, concreteVarType.props?.condition));
                    }
                } else {
                    if (isAnyOrUnknown(varType)) {
                        filteredTypes.push(addConditionToType(varType, conditions));
                    } else if (derivesFromAnyOrUnknown(varType) && !isTypeSame(concreteVarType, concreteFilterType)) {
                        filteredTypes.push(addConditionToType(varType, conditions));
                    }
                }
            } else if (isTypeVar(filterType) && TypeBase.isInstantiable(filterType)) {
                // Handle the case where the filter type is Type[T] and the unexpanded
                // subtype is some instance type, possibly T.
                if (TypeBase.isInstance(varType)) {
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
                }
            } else if (isFunction(filterType)) {
                // Handle an isinstance check against Callable.
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
                        filteredTypes.push(convertToInstantiable(varType));
                    } else {
                        foundSuperclass = true;
                    }
                } else if (
                    evaluator.assignType(
                        convertVarTypeToFree(concreteVarType),
                        filterType,
                        /* diag */ undefined,
                        /* constraints */ undefined,
                        AssignTypeFlags.AllowIsinstanceSpecialForms
                    )
                ) {
                    if (isPositiveTest) {
                        filteredTypes.push(addConditionToType(filterType, concreteVarType.props?.condition));
                    }
                } else if (allowIntersections && isPositiveTest) {
                    // The type appears to not be callable. It's possible that the
                    // two type is a subclass that is callable. We'll synthesize a
                    // new intersection type.
                    const className = `<callable subtype of ${concreteVarType.shared.name}>`;
                    const fileInfo = getFileInfo(errorNode);
                    let newClassType = ClassType.createInstantiable(
                        className,
                        ParseTreeUtils.getClassFullName(errorNode, fileInfo.moduleName, className),
                        fileInfo.moduleName,
                        fileInfo.fileUri,
                        ClassTypeFlags.None,
                        ParseTreeUtils.getTypeSourceId(errorNode),
                        /* declaredMetaclass */ undefined,
                        concreteVarType.shared.effectiveMetaclass,
                        concreteVarType.shared.docString
                    );
                    newClassType.shared.baseClasses = [concreteVarType];
                    computeMroLinearization(newClassType);

                    newClassType = addConditionToType(newClassType, concreteVarType.props?.condition);

                    // Add a __call__ method to the new class.
                    const callMethod = FunctionType.createSynthesizedInstance('__call__');
                    const selfParam = FunctionParam.create(
                        ParamCategory.Simple,
                        ClassType.cloneAsInstance(newClassType),
                        FunctionParamFlags.TypeDeclared,
                        'self'
                    );
                    FunctionType.addParam(callMethod, selfParam);
                    FunctionType.addDefaultParams(callMethod);
                    callMethod.shared.declaredReturnType = UnknownType.create();
                    ClassType.getSymbolTable(newClassType).set(
                        '__call__',
                        Symbol.createWithType(SymbolFlags.ClassMember, callMethod)
                    );

                    filteredTypes.push(ClassType.cloneAsInstance(newClassType));
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
                filteredTypes.push(convertToInstantiable(negativeFallbackType));
            }
        }

        return filteredTypes.map((t) => convertToInstance(t));
    };

    const isFilterTypeCallbackProtocol = (filterType: Type) => {
        return (
            isInstantiableClass(filterType) &&
            evaluator.getCallbackProtocolType(ClassType.cloneAsInstance(filterType)) !== undefined
        );
    };

    const filterFunctionType = (varType: FunctionType | OverloadedType, unexpandedType: Type): Type[] => {
        const filteredTypes: Type[] = [];

        if (isPositiveTest) {
            for (const filterType of filterTypes) {
                const concreteFilterType = evaluator.makeTopLevelTypeVarsConcrete(filterType);

                if (!isTypeIsCheck && isFilterTypeCallbackProtocol(concreteFilterType)) {
                    filteredTypes.push(convertToInstance(varType));
                } else if (evaluator.assignType(convertVarTypeToFree(varType), convertToInstance(concreteFilterType))) {
                    // If the filter type is a Callable, use the original type. If the
                    // filter type is a callback protocol, use the filter type.
                    if (isFunction(filterType)) {
                        filteredTypes.push(convertToInstance(unexpandedType));
                    } else {
                        filteredTypes.push(convertToInstance(filterType));
                    }
                } else {
                    const filterTypeInstance = convertToInstance(convertVarTypeToFree(concreteFilterType));
                    if (evaluator.assignType(filterTypeInstance, varType)) {
                        filteredTypes.push(convertToInstance(varType));
                    } else {
                        // If this is a class instance that's not callable and it's not @final,
                        // a subclass could be compatible with the filter type.
                        if (isClassInstance(filterTypeInstance) && !ClassType.isFinal(filterTypeInstance)) {
                            const gradualFunc = FunctionType.createSynthesizedInstance(
                                '',
                                FunctionTypeFlags.GradualCallableForm
                            );
                            FunctionType.addDefaultParams(gradualFunc);

                            // If the class is callable (i.e. can be assigned to the generic gradual
                            // function signature), then the assignment check above didn't fail because
                            // of a signature mismatch. It failed because the class is not callable.
                            // We assume therefore that a subclass might be.
                            if (!evaluator.assignType(gradualFunc, filterTypeInstance)) {
                                // The resulting type should be an intersection of the filter type and
                                // the subtype, but we don't have a way to encode that yet. For now,
                                // we'll use the filter type.
                                filteredTypes.push(convertToInstance(filterType));
                            }
                        }
                    }
                }
            }
        } else {
            // If one or more filters does not always filter the type,
            // we can't eliminate the type in the negative case.
            if (
                filterTypes.every((filterType) => {
                    const concreteFilterType = evaluator.makeTopLevelTypeVarsConcrete(filterType);

                    // If the filter type is a callback protocol, the runtime
                    // isinstance check will filter all objects that have a __call__
                    // method regardless of their signature types.
                    if (!isTypeIsCheck && isFilterTypeCallbackProtocol(concreteFilterType)) {
                        return false;
                    }

                    if (isFunction(concreteFilterType) && FunctionType.isGradualCallableForm(concreteFilterType)) {
                        return false;
                    }

                    const isSubtype = evaluator.assignType(
                        convertToInstance(convertVarTypeToFree(concreteFilterType)),
                        varType
                    );
                    const isSupertype = evaluator.assignType(
                        convertVarTypeToFree(varType),
                        convertToInstance(concreteFilterType)
                    );

                    return !isSubtype || isSupertype;
                })
            ) {
                filteredTypes.push(convertToInstance(varType));
            }
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
        {
            expandCallback: (type) => {
                return evaluator.expandPromotionTypes(errorNode, type);
            },
        },
        (subtype, unexpandedSubtype) => {
            // If we fail to filter anything in the negative case, we need to decide
            // whether to retain the original TypeVar or replace it with its specialized
            // type(s). We'll assume that if someone is using isinstance or issubclass
            // on a constrained TypeVar that they want to filter based on its constrained
            // parts.
            const negativeFallback = getTypeCondition(subtype) ? subtype : unexpandedSubtype;

            if (isPositiveTest && isAnyOrUnknown(subtype)) {
                // If this is a positive test and the effective type is Any or
                // Unknown, we can assume that the type matches one of the
                // specified types.
                anyOrUnknownSubstitutions.push(
                    combineTypes(filterTypes.map((classType) => convertToInstance(classType)))
                );

                anyOrUnknown.push(subtype);
                return undefined;
            }

            if (isNoneInstance(subtype)) {
                return classListContainsNoneType() === isPositiveTest ? subtype : undefined;
            }

            if (isModule(subtype) || (isClassInstance(subtype) && ClassType.isBuiltIn(subtype, 'ModuleType'))) {
                // Handle type narrowing for runtime-checkable protocols
                // when applied to modules.
                if (isPositiveTest) {
                    const filteredTypes = filterTypes.filter((classType) => {
                        const concreteClassType = evaluator.makeTopLevelTypeVarsConcrete(classType);
                        return isInstantiableClass(concreteClassType) && ClassType.isProtocolClass(concreteClassType);
                    });

                    if (filteredTypes.length > 0) {
                        return convertToInstance(combineTypes(filteredTypes));
                    }
                }
            }

            if (isClass(subtype)) {
                return combineTypes(
                    filterClassType(
                        unexpandedSubtype,
                        ClassType.cloneAsInstantiable(subtype),
                        getTypeCondition(subtype),
                        negativeFallback
                    )
                );
            }

            if (isFunctionOrOverloaded(subtype)) {
                return combineTypes(filterFunctionType(subtype, unexpandedSubtype));
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

// This function assumes that the caller has already verified that the two
// types are the same class and are not literals. It also assumes that the
// caller has verified that type1 is not assignable to type2 or vice versa.
// Returns undefined if there is no intersection between the two types.
function intersectSameClassType(evaluator: TypeEvaluator, type1: ClassType, type2: ClassType): ClassType | undefined {
    assert(isInstantiableClass(type1) && isInstantiableClass(type2));
    assert(ClassType.isSameGenericClass(type1, type2));
    assert(type1.priv?.literalValue === undefined);
    assert(type2.priv?.literalValue === undefined);

    // Handle tuples specially.
    if (ClassType.isBuiltIn(type1, 'tuple')) {
        return intersectTupleTypes(type1, type1);
    }

    // Indicate that there is no intersection.
    return undefined;
}

function intersectTupleTypes(type1: ClassType, type2: ClassType) {
    if (!type2.priv.tupleTypeArgs || isTupleGradualForm(type2)) {
        return addConditionToType(type1, type2.props?.condition);
    }

    if (!type1.priv.tupleTypeArgs || isTupleGradualForm(type1)) {
        return addConditionToType(type2, type1.props?.condition);
    }

    // For now, don't attempt to narrow in this case.
    // TODO - add more sophisticated logic here.
    return undefined;
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
            !concreteSubtype.priv.tupleTypeArgs
        ) {
            return subtype;
        }

        // If the tuple contains a TypeVarTuple, we can't narrow it.
        if (concreteSubtype.priv.tupleTypeArgs.some((typeArg) => isUnpackedTypeVarTuple(typeArg.type))) {
            return subtype;
        }

        // If the tuple contains no unbounded elements, then we know its length exactly.
        if (!concreteSubtype.priv.tupleTypeArgs.some((typeArg) => typeArg.isUnbounded)) {
            const tupleLengthMatches = isLessThanCheck
                ? concreteSubtype.priv.tupleTypeArgs.length < lengthValue
                : concreteSubtype.priv.tupleTypeArgs.length === lengthValue;

            return tupleLengthMatches === isPositiveTest ? subtype : undefined;
        }

        // The tuple contains a "...". We'll expand this into as many elements as
        // necessary to match the lengthValue.
        const elementsToAdd = lengthValue - concreteSubtype.priv.tupleTypeArgs.length + 1;

        if (!isLessThanCheck) {
            // If the specified length is smaller than the minimum length of this tuple,
            // we can rule it out for a positive test and rule it in for a negative test.
            if (elementsToAdd < 0) {
                return isPositiveTest ? undefined : subtype;
            }

            if (!isPositiveTest) {
                // If this is an equality check for the minimum length (e.g.
                // "len(x) == 0"), we can expand the minimum length by one).
                const minLen = concreteSubtype.priv.tupleTypeArgs.length - 1;
                if (lengthValue === minLen) {
                    return expandUnboundedTupleElement(concreteSubtype, 1, /* keepUnbounded */ true);
                }
                return subtype;
            }

            return expandUnboundedTupleElement(concreteSubtype, elementsToAdd, /* keepUnbounded */ false);
        }

        // If this is a tuple related to an "*args: P.args" parameter, don't expand it.
        if (isParamSpec(subtype) && subtype.priv.paramSpecAccess) {
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
    const tupleTypeArgs: TupleTypeArg[] = [];

    tupleType.priv.tupleTypeArgs!.forEach((typeArg) => {
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
        !containerType.priv.tupleTypeArgs
    ) {
        return referenceType;
    }

    // Determine which tuple types can be eliminated. Only "None" and
    // literal types can be handled here.
    const typesToEliminate: Type[] = [];
    containerType.priv.tupleTypeArgs.forEach((tupleEntry) => {
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
        if (isClassInstance(referenceSubtype) && referenceSubtype.priv.literalValue === undefined) {
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

    if (!containerType.priv.typeArgs || containerType.priv.typeArgs.length < 1) {
        return undefined;
    }

    let elementType = containerType.priv.typeArgs[0];
    if (isTupleClass(containerType) && containerType.priv.tupleTypeArgs) {
        elementType = combineTypes(containerType.priv.tupleTypeArgs.map((t) => t.type));
    }

    return elementType;
}

export function narrowTypeForContainerElementType(evaluator: TypeEvaluator, referenceType: Type, elementType: Type) {
    return evaluator.mapSubtypesExpandTypeVars(referenceType, /* options */ undefined, (referenceSubtype) => {
        return mapSubtypes(elementType, (elementSubtype) => {
            if (isAnyOrUnknown(elementSubtype)) {
                return referenceSubtype;
            }

            // If the two types are disjoint (i.e. are not comparable), eliminate this subtype.
            if (!evaluator.isTypeComparable(elementSubtype, referenceSubtype)) {
                return undefined;
            }

            // If one of the two types is a literal, we can narrow to that type.
            if (
                isClassInstance(elementSubtype) &&
                (isLiteralLikeType(elementSubtype) || isNoneInstance(elementSubtype)) &&
                evaluator.assignType(referenceSubtype, elementSubtype)
            ) {
                return stripTypeForm(addConditionToType(elementSubtype, referenceSubtype.props?.condition));
            }

            if (
                isClassInstance(referenceSubtype) &&
                (isLiteralLikeType(referenceSubtype) || isNoneInstance(referenceSubtype)) &&
                evaluator.assignType(elementSubtype, referenceSubtype)
            ) {
                return stripTypeForm(addConditionToType(referenceSubtype, elementSubtype.props?.condition));
            }

            // If the element type is a known class object that is assignable to
            // the reference type, we can narrow to that class object.
            if (
                isInstantiableClass(elementSubtype) &&
                !elementSubtype.priv.includeSubclasses &&
                evaluator.assignType(referenceSubtype, elementSubtype)
            ) {
                return stripTypeForm(addConditionToType(elementSubtype, referenceSubtype.props?.condition));
            }

            // It's not safe to narrow.
            return referenceSubtype;
        });
    });
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
                const tdEntry = entries.knownItems.get(literalKey.priv.literalValue as string) ?? entries.extraItems;

                if (isPositiveTest) {
                    if (!tdEntry) {
                        // If there is no TD entry for this key and no "extra items" defined,
                        // we have to assume that the TypedDict may contain extra items, so
                        // narrowing it isn't possible in this case.
                        return subtype;
                    }

                    if (isNever(tdEntry.valueType)) {
                        // If the entry is typed as Never or the "extra items" is typed as Never,
                        // then this key cannot be present in the TypedDict, and we can eliminate it.
                        return undefined;
                    }

                    // If the entry is currently not required and not marked provided, we can mark
                    // it as provided after this guard expression confirms it is.
                    if (tdEntry.isRequired || tdEntry.isProvided) {
                        return subtype;
                    }

                    const newNarrowedEntriesMap = new Map<string, TypedDictEntry>(
                        subtype.priv.typedDictNarrowedEntries ?? []
                    );

                    // Add the new entry.
                    newNarrowedEntriesMap.set(literalKey.priv.literalValue as string, {
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
            const tdEntry = symbolMap.knownItems.get(indexLiteralType.priv.literalValue as string);

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
            typeof indexLiteralType.priv.literalValue === 'number' &&
            isClassInstance(literalType)
        ) {
            const indexValue = indexLiteralType.priv.literalValue;
            if (subtype.priv.tupleTypeArgs && indexValue >= 0 && indexValue < subtype.priv.tupleTypeArgs.length) {
                const tupleEntryType = subtype.priv.tupleTypeArgs[indexValue]?.type;
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
                const getterType = memberType.priv.fgetInfo?.methodType;
                if (getterType && getterType.shared.declaredReturnType) {
                    const getterReturnType = FunctionType.getEffectiveReturnType(getterType);
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
function narrowTypeForTypeIs(evaluator: TypeEvaluator, type: Type, classTypes: ClassType[], isPositiveTest: boolean) {
    // We currently don't support narrowing in the negative direction
    // when there are more than one class types.
    if (!isPositiveTest && classTypes.length > 1) {
        return type;
    }

    const typesToCombine = classTypes.map((classType) => {
        return evaluator.mapSubtypesExpandTypeVars(
            type,
            /* options */ undefined,
            (subtype: Type, unexpandedSubtype: Type) => {
                if (isClassInstance(subtype)) {
                    const matches = ClassType.isDerivedFrom(classType, ClassType.cloneAsInstantiable(subtype));
                    if (isPositiveTest) {
                        if (matches) {
                            if (ClassType.isSameGenericClass(ClassType.cloneAsInstantiable(subtype), classType)) {
                                return addConditionToType(subtype, getTypeCondition(classType));
                            }

                            return addConditionToType(ClassType.cloneAsInstance(classType), subtype.props?.condition);
                        }

                        if (!classType.priv.includeSubclasses) {
                            return undefined;
                        }

                        if (!isTypeVar(unexpandedSubtype) || !TypeVarType.isSelf(unexpandedSubtype)) {
                            return addConditionToType(subtype, classType.props?.condition);
                        }
                    }

                    if (!classType.priv.includeSubclasses) {
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
                }

                if (isAnyOrUnknown(subtype)) {
                    return isPositiveTest
                        ? ClassType.cloneAsInstance(addConditionToType(classType, getTypeCondition(subtype)))
                        : subtype;
                }

                return unexpandedSubtype;
            }
        );
    });

    return combineTypes(typesToCombine);
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
        let concreteSubtype = evaluator.makeTopLevelTypeVarsConcrete(subtype);

        if (isPositiveTest) {
            if (
                isClassInstance(concreteSubtype) &&
                TypeBase.isInstance(subtype) &&
                ClassType.isBuiltIn(concreteSubtype, 'type')
            ) {
                concreteSubtype =
                    concreteSubtype.priv.typeArgs && concreteSubtype.priv.typeArgs.length > 0
                        ? convertToInstantiable(concreteSubtype.priv.typeArgs[0])
                        : UnknownType.create();
            }

            if (isAnyOrUnknown(concreteSubtype)) {
                return addConditionToType(classType, getTypeCondition(concreteSubtype));
            }

            if (isClass(concreteSubtype)) {
                if (TypeBase.isInstance(concreteSubtype)) {
                    return ClassType.isBuiltIn(concreteSubtype, 'object') ? classType : undefined;
                }

                const isSuperType = isFilterSuperclass(subtype, concreteSubtype, classType, classType);

                if (!classType.priv.includeSubclasses) {
                    // Handle the case where the LHS and RHS operands are specific
                    // classes, as opposed to types that represent classes and their
                    // subclasses.
                    if (!concreteSubtype.priv.includeSubclasses) {
                        return ClassType.isSameGenericClass(concreteSubtype, classType) ? classType : undefined;
                    }

                    if (isSuperType) {
                        return addConditionToType(classType, getTypeCondition(concreteSubtype));
                    }

                    const isSubType = ClassType.isDerivedFrom(classType, concreteSubtype);
                    if (isSubType) {
                        return addConditionToType(classType, getTypeCondition(concreteSubtype));
                    }

                    return undefined;
                }

                if (ClassType.isFinal(concreteSubtype) && !isSuperType) {
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

function isFilterSuperclass(
    varType: Type,
    concreteVarType: ClassType,
    filterType: Type,
    concreteFilterType: ClassType
) {
    if (isTypeVar(filterType) || concreteFilterType.priv.literalValue !== undefined) {
        return isTypeSame(convertToInstance(filterType), varType);
    }

    // If the filter type represents all possible subclasses
    // of a type, we can't make any statements about its superclass
    // relationship with concreteVarType.
    if (concreteFilterType.priv.includeSubclasses) {
        return false;
    }

    if (ClassType.isDerivedFrom(concreteVarType, concreteFilterType)) {
        return true;
    }

    // Handle the special case where the variable type is a TypedDict and
    // we're filtering against 'dict'. TypedDict isn't derived from dict,
    // but at runtime, isinstance returns True.
    if (ClassType.isBuiltIn(concreteFilterType, 'dict') && ClassType.isTypedDictClass(concreteVarType)) {
        return true;
    }

    return false;
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
    return evaluator.mapSubtypesExpandTypeVars(referenceType, /* options */ undefined, (subtype) => {
        subtype = evaluator.makeTopLevelTypeVarsConcrete(subtype);

        if (isAnyOrUnknown(subtype)) {
            if (isPositiveTest) {
                return literalType;
            }

            return subtype;
        }

        if (isClassInstance(subtype) && ClassType.isSameGenericClass(literalType, subtype)) {
            if (subtype.priv.literalValue !== undefined) {
                const literalValueMatches = ClassType.isLiteralValueSame(subtype, literalType);
                if (isPositiveTest) {
                    return literalValueMatches ? subtype : undefined;
                }

                const isEnumOrBool = ClassType.isEnumClass(literalType) || ClassType.isBuiltIn(literalType, 'bool');

                // For negative tests, we can eliminate the literal value if it doesn't match,
                // but only for equality tests or for 'is' tests that involve enums or bools.
                return literalValueMatches && (isEnumOrBool || !isIsOperator) ? undefined : subtype;
            }

            if (isPositiveTest) {
                return literalType;
            }

            // If we're able to enumerate all possible literal values
            // (for bool or enum), we can eliminate all others in a negative test.
            const allLiteralTypes = enumerateLiteralsForType(evaluator, subtype);
            if (allLiteralTypes && allLiteralTypes.length > 0) {
                return combineTypes(allLiteralTypes.filter((type) => !ClassType.isLiteralValueSame(type, literalType)));
            }

            return subtype;
        }

        if (isPositiveTest) {
            if (isClassInstance(subtype) && ClassType.isBuiltIn(subtype, 'LiteralString')) {
                return literalType;
            }

            if (isIsOperator || isNoneInstance(subtype)) {
                const isSubtype = evaluator.assignType(subtype, literalType);
                return isSubtype ? literalType : undefined;
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
        if (type.shared.baseClasses.some((baseClass) => isClass(baseClass) && ClassType.isBuiltIn(baseClass, 'Flag'))) {
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
                    symbolType.priv.literalValue !== undefined
                ) {
                    enumList.push(symbolType);
                }
            }
        });

        return enumList;
    }

    return undefined;
}

// Determines whether the expression name node is in the same scope or
// an outer scope from the reference name node. This allows isMatchingExpression
// to determine whether two name nodes are referring to the same symbol.
function isNameSameScope(evaluator: TypeEvaluator, reference: NameNode, expression: NameNode): boolean {
    const refSymbol = evaluator.lookUpSymbolRecursive(reference, reference.d.value, /* honorCodeFlow */ false);
    const exprSymbol = evaluator.lookUpSymbolRecursive(expression, expression.d.value, /* honorCodeFlow */ false);

    if (!refSymbol || !exprSymbol) {
        // This shouldn't happen, but just to be safe...
        return true;
    }

    const refScope = refSymbol.scope;
    const exprScope = exprSymbol.scope;

    if (refScope === exprScope) {
        return true;
    }

    return isScopeContainedWithin(refScope, exprScope);
}
