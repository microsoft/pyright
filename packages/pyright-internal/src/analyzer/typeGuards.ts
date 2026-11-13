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
import { OperatorType } from '../parser/tokenizerTypes';
import { getInfoReader, AnalyzerNodeInfoAccessor } from './analyzerNodeInfo';
import { addConstraintsForExpectedType } from './constraintSolver';
import { ConstraintTracker } from './constraintTracker';
import { Declaration, DeclarationType } from './declaration';
import { getParamListDetails, ParamKind } from './parameterUtils';
import * as ParseTreeUtils from './parseTreeUtils';
import { ScopeType } from './scope';
import { getScopeForNode } from './scopeUtils';
import { Symbol, SymbolFlags } from './symbol';
import * as TypeEvaluatorNarrowing from './typeEvaluator/typeGuardNarrowing';
import { AssignTypeFlags, EvalFlags, TypeEvaluator } from './typeEvaluatorTypes';
import {
    ClassType,
    ClassTypeFlags,
    combineTypes,
    FunctionParam,
    FunctionParamFlags,
    FunctionType,
    FunctionTypeFlags,
    getInferredTupleLiteralBase,
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
    isUnion,
    maxTypeRecursionCount,
    OverloadedType,
    retainInferredTupleLiterals,
    Type,
    TypeBase,
    TypeCondition,
    TypeVarType,
    UnknownType,
} from './types';
import {
    addConditionToType,
    computeMroLinearization,
    convertToInstance,
    convertToInstantiable,
    derivesFromAnyOrUnknown,
    doForEachSubtype,
    getTypeCondition,
    getTypeVarScopeIds,
    isInstantiableMetaclass,
    isMetaclassInstance,
    isNoneInstance,
    isNoneTypeClass,
    isTupleGradualForm,
    lookUpClassMember,
    makeTypeVarsFree,
    mapSubtypes,
    MemberAccessFlags,
    transformPossibleRecursiveTypeAlias,
} from './typeUtils';

export interface TypeNarrowingResult {
    type: Type;
    isIncomplete: boolean;
}

export interface IsInstanceClassTypeInfo {
    classTypes: (ClassType | TypeVarType | FunctionType)[];
    negativeClassTypes: (ClassType | TypeVarType | FunctionType)[];
}

export type TypeNarrowingCallback = (type: Type) => TypeNarrowingResult | undefined;

export function applyTypeNarrowingCallback(
    callback: TypeNarrowingCallback,
    type: Type
): TypeNarrowingResult | undefined {
    const result = callback(type);
    const baseType = getInferredTupleLiteralBase(type);
    if (baseType === type) {
        return result;
    }

    // Narrow both views at the flow boundary, not recursively within a guard.
    // Independently established literals must survive mutable inference too.
    const baseResult = callback(baseType);
    if (!result && !baseResult) {
        return undefined;
    }
    return {
        type: retainInferredTupleLiterals(
            result?.type ?? type,
            getInferredTupleLiteralBase(baseResult?.type ?? baseType)
        ),
        isIncomplete: !!result?.isIncomplete || !!baseResult?.isIncomplete,
    };
}

function getEqualsNarrowingContext(evaluator: TypeEvaluator): TypeEvaluatorNarrowing.EqualsNarrowingContext {
    return {
        getTypeOfExpression: (expression) => evaluator.getTypeOfExpression(expression),
        isMatchingExpression: (reference, expression) =>
            ParseTreeUtils.isMatchingExpression(reference, expression, (ref, expr) =>
                isNameSameScope(evaluator, ref, expr)
            ),
        isMatchingExpressionOrWalrusRhs: (reference, expression) =>
            isMatchingExpressionOrWalrusRhs(evaluator, reference, expression),
    };
}

function getMemberAccessNarrowingContext(
    evaluator: TypeEvaluator
): TypeEvaluatorNarrowing.MemberAccessNarrowingContext {
    return {
        getTypeOfExpression: (expression) => evaluator.getTypeOfExpression(expression),
        isMatchingExpression: (reference, expression) =>
            ParseTreeUtils.isMatchingExpression(reference, expression, (ref, expr) =>
                isNameSameScope(evaluator, ref, expr)
            ),
    };
}

function getLenComparisonNarrowingContext(
    evaluator: TypeEvaluator
): TypeEvaluatorNarrowing.LenComparisonNarrowingContext {
    return {
        getTypeOfExpression: (expression, flags) => evaluator.getTypeOfExpression(expression, flags),
        isMatchingExpression: (reference, expression) =>
            ParseTreeUtils.isMatchingExpression(reference, expression, (ref, expr) =>
                isNameSameScope(evaluator, ref, expr)
            ),
    };
}

function getInOperatorNarrowingContext(evaluator: TypeEvaluator): TypeEvaluatorNarrowing.InOperatorNarrowingContext {
    return {
        getTypeOfExpression: (expression, flags) => evaluator.getTypeOfExpression(expression, flags),
        isMatchingExpression: (reference, expression) =>
            ParseTreeUtils.isMatchingExpression(reference, expression, (ref, expr) =>
                isNameSameScope(evaluator, ref, expr)
            ),
        isMatchingExpressionOrWalrusRhs: (reference, expression) =>
            isMatchingExpressionOrWalrusRhs(evaluator, reference, expression),
    };
}

function getNoneEllipsisNarrowingContext(
    evaluator: TypeEvaluator
): TypeEvaluatorNarrowing.NoneEllipsisNarrowingContext {
    return {
        isMatchingExpression: (reference, expression) =>
            ParseTreeUtils.isMatchingExpression(reference, expression, (ref, expr) =>
                isNameSameScope(evaluator, ref, expr)
            ),
        isMatchingExpressionOrWalrusRhs: (reference, expression) =>
            isMatchingExpressionOrWalrusRhs(evaluator, reference, expression),
    };
}

function getTypeIsCallNarrowingContext(evaluator: TypeEvaluator): TypeEvaluatorNarrowing.TypeIsCallNarrowingContext {
    return {
        getTypeOfExpression: (expression, flags) => evaluator.getTypeOfExpression(expression, flags),
        isMatchingExpressionOrWalrusRhs: (reference, expression) =>
            isMatchingExpressionOrWalrusRhs(evaluator, reference, expression),
        mapSubtypesExpandTypeVars: (type, callback) =>
            evaluator.mapSubtypesExpandTypeVars(type, /* options */ undefined, callback),
    };
}

function getIsLiteralOrClassNarrowingContext(
    evaluator: TypeEvaluator
): TypeEvaluatorNarrowing.IsLiteralOrClassNarrowingContext {
    return {
        getTypeOfExpression: (expression) => evaluator.getTypeOfExpression(expression),
        isMatchingExpressionOrWalrusRhs: (reference, expression) =>
            isMatchingExpressionOrWalrusRhs(evaluator, reference, expression),
    };
}

function getIndexedLiteralNarrowingContext(
    evaluator: TypeEvaluator
): TypeEvaluatorNarrowing.IndexedLiteralNarrowingContext {
    return {
        getTypeOfExpression: (expression) => evaluator.getTypeOfExpression(expression),
        isMatchingExpression: (reference, expression) =>
            ParseTreeUtils.isMatchingExpression(reference, expression, (ref, expr) =>
                isNameSameScope(evaluator, ref, expr)
            ),
    };
}

function getIsInstanceCallNarrowingContext(
    evaluator: TypeEvaluator
): TypeEvaluatorNarrowing.IsInstanceCallNarrowingContext {
    return {
        getTypeOfExpression: (expression, flags) => evaluator.getTypeOfExpression(expression, flags),
        getIsInstanceClassTypes: (argType, argExpr) => getIsInstanceClassTypes(evaluator, argType, argExpr),
        isMatchingExpressionOrWalrusRhs: (reference, expression) =>
            isMatchingExpressionOrWalrusRhs(evaluator, reference, expression),
    };
}

function getBoolCallNarrowingContext(evaluator: TypeEvaluator): TypeEvaluatorNarrowing.BoolCallNarrowingContext {
    return {
        getTypeOfExpression: (expression, flags) => evaluator.getTypeOfExpression(expression, flags),
        isMatchingExpressionOrWalrusRhs: (reference, expression) =>
            isMatchingExpressionOrWalrusRhs(evaluator, reference, expression),
    };
}

// Given a reference expression and a test expression, returns a callback that
// can be used to narrow the type described by the reference expression.
// If the specified flow node is not associated with the test expression,
// it returns undefined.
export function getTypeNarrowingCallback(
    evaluator: TypeEvaluator,
    reference: ExpressionNode,
    testExpression: ExpressionNode,
    isPositiveTest: boolean,
    nodeInfo: AnalyzerNodeInfoAccessor,
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
            nodeInfo,
            recursionCount
        );
    }

    if (testExpression.nodeType === ParseNodeType.BinaryOperation) {
        const isOrIsNotOperator =
            testExpression.d.operator === OperatorType.Is || testExpression.d.operator === OperatorType.IsNot;
        const equalsOrNotEqualsOperator =
            testExpression.d.operator === OperatorType.Equals || testExpression.d.operator === OperatorType.NotEquals;

        if (isOrIsNotOperator || equalsOrNotEqualsOperator) {
            const noneEllipsisInfo = TypeEvaluatorNarrowing.getNoneEllipsisNarrowingInfo(
                getNoneEllipsisNarrowingContext(evaluator),
                reference,
                testExpression,
                isPositiveTest
            );
            if (noneEllipsisInfo) {
                if (noneEllipsisInfo.kind === 'none') {
                    return (type: Type) => {
                        return {
                            type: narrowTypeForIsNone(evaluator, type, noneEllipsisInfo.adjIsPositiveTest),
                            isIncomplete: false,
                        };
                    };
                }

                if (noneEllipsisInfo.kind === 'tuple-none') {
                    return (type: Type) => {
                        return {
                            type: narrowTupleTypeForIsNone(
                                evaluator,
                                type,
                                noneEllipsisInfo.adjIsPositiveTest,
                                noneEllipsisInfo.tupleIndex!
                            ),
                            isIncomplete: false,
                        };
                    };
                }

                return (type: Type) => {
                    return {
                        type: narrowTypeForIsEllipsis(
                            evaluator,
                            testExpression,
                            type,
                            noneEllipsisInfo.adjIsPositiveTest
                        ),
                        isIncomplete: false,
                    };
                };
            }

            const typeIsCallInfo = TypeEvaluatorNarrowing.getTypeIsCallNarrowingInfo(
                getTypeIsCallNarrowingContext(evaluator),
                reference,
                testExpression,
                isPositiveTest
            );
            if (typeIsCallInfo) {
                return (type: Type) => {
                    return {
                        type: narrowTypeForTypeIs(
                            evaluator,
                            type,
                            typeIsCallInfo.classTypes,
                            typeIsCallInfo.adjIsPositiveTest,
                            typeIsCallInfo.isOrIsNotOperator,
                            typeIsCallInfo.classTypeVar,
                            typeIsCallInfo.allowLegacyEquality,
                            typeIsCallInfo.allowExactStringFlow
                        ),
                        isIncomplete: typeIsCallInfo.isIncomplete,
                    };
                };
            }

            if (isOrIsNotOperator) {
                const isLiteralOrClassInfo = TypeEvaluatorNarrowing.getIsLiteralOrClassNarrowingInfo(
                    getIsLiteralOrClassNarrowingContext(evaluator),
                    reference,
                    testExpression,
                    isPositiveTest
                );
                if (isLiteralOrClassInfo) {
                    if (isLiteralOrClassInfo.kind === 'literal') {
                        return (type: Type) => {
                            return {
                                type: narrowTypeForLiteralComparison(
                                    evaluator,
                                    type,
                                    isLiteralOrClassInfo.rightType,
                                    isLiteralOrClassInfo.adjIsPositiveTest,
                                    /* isIsOperator */ true
                                ),
                                isIncomplete: isLiteralOrClassInfo.isIncomplete,
                            };
                        };
                    }

                    return (type: Type) => {
                        return {
                            type: narrowTypeForClassComparison(
                                evaluator,
                                type,
                                isLiteralOrClassInfo.rightType,
                                isLiteralOrClassInfo.adjIsPositiveTest
                            ),
                            isIncomplete: isLiteralOrClassInfo.isIncomplete,
                        };
                    };
                }

                const indexedLiteralInfo = TypeEvaluatorNarrowing.getIndexedLiteralNarrowingInfo(
                    getIndexedLiteralNarrowingContext(evaluator),
                    reference,
                    testExpression,
                    isPositiveTest
                );
                if (indexedLiteralInfo) {
                    if (indexedLiteralInfo.kind === 'dict') {
                        return (type: Type) => {
                            return {
                                type: narrowTypeForDiscriminatedDictEntryComparison(
                                    evaluator,
                                    type,
                                    indexedLiteralInfo.indexType,
                                    indexedLiteralInfo.rightType,
                                    indexedLiteralInfo.adjIsPositiveTest
                                ),
                                isIncomplete: indexedLiteralInfo.isIncomplete,
                            };
                        };
                    }

                    return (type: Type) => {
                        return {
                            type: narrowTypeForDiscriminatedTupleComparison(
                                evaluator,
                                type,
                                indexedLiteralInfo.indexType,
                                indexedLiteralInfo.rightType,
                                indexedLiteralInfo.adjIsPositiveTest
                            ),
                            isIncomplete: indexedLiteralInfo.isIncomplete,
                        };
                    };
                }
            }

            const equalsInfo = TypeEvaluatorNarrowing.getEqualsNarrowingInfo(
                getEqualsNarrowingContext(evaluator),
                reference,
                testExpression,
                isPositiveTest
            );
            if (equalsInfo) {
                if (equalsInfo.kind === 'literal') {
                    return (type: Type) => {
                        return {
                            type: narrowTypeForLiteralComparison(
                                evaluator,
                                type,
                                equalsInfo.rightType,
                                equalsInfo.adjIsPositiveTest,
                                /* isIsOperator */ false
                            ),
                            isIncomplete: equalsInfo.isIncomplete,
                        };
                    };
                }

                if (equalsInfo.kind === 'class') {
                    return (type: Type) => {
                        return {
                            type: narrowTypeForClassComparison(
                                evaluator,
                                type,
                                equalsInfo.rightType,
                                equalsInfo.adjIsPositiveTest,
                                /* isIsOperator */ false
                            ),
                            isIncomplete: equalsInfo.isIncomplete,
                        };
                    };
                }

                return (type: Type) => {
                    let narrowedType: Type;
                    const indexType = equalsInfo.indexType;

                    if (ClassType.isBuiltIn(indexType, 'str')) {
                        narrowedType = narrowTypeForDiscriminatedDictEntryComparison(
                            evaluator,
                            type,
                            indexType,
                            equalsInfo.rightType,
                            equalsInfo.adjIsPositiveTest
                        );
                    } else {
                        narrowedType = narrowTypeForDiscriminatedTupleComparison(
                            evaluator,
                            type,
                            indexType,
                            equalsInfo.rightType,
                            equalsInfo.adjIsPositiveTest
                        );
                    }

                    return {
                        type: narrowedType,
                        isIncomplete: equalsInfo.isIncomplete,
                    };
                };
            }

            const memberAccessInfo = TypeEvaluatorNarrowing.getMemberAccessNarrowingInfo(
                getMemberAccessNarrowingContext(evaluator),
                reference,
                testExpression,
                isPositiveTest
            );
            if (memberAccessInfo) {
                if (memberAccessInfo.kind === 'none') {
                    return (type: Type) => {
                        return {
                            type: narrowTypeForDiscriminatedFieldNoneComparison(
                                evaluator,
                                type,
                                memberAccessInfo.memberName,
                                memberAccessInfo.adjIsPositiveTest
                            ),
                            isIncomplete: false,
                        };
                    };
                }

                return (type: Type) => {
                    return {
                        type: narrowTypeForDiscriminatedLiteralFieldComparison(
                            evaluator,
                            type,
                            memberAccessInfo.memberName,
                            memberAccessInfo.rightType!,
                            memberAccessInfo.adjIsPositiveTest
                        ),
                        isIncomplete: memberAccessInfo.isIncomplete,
                    };
                };
            }
        }

        const lenComparisonInfo = TypeEvaluatorNarrowing.getLenComparisonNarrowingInfo(
            getLenComparisonNarrowingContext(evaluator),
            reference,
            testExpression,
            isPositiveTest
        );
        if (lenComparisonInfo) {
            return (type: Type) => {
                return {
                    type: narrowTypeForTupleLength(
                        evaluator,
                        type,
                        lenComparisonInfo.tupleLength,
                        lenComparisonInfo.adjIsPositiveTest,
                        lenComparisonInfo.isLessThanCheck
                    ),
                    isIncomplete: lenComparisonInfo.isIncomplete,
                };
            };
        }

        const inOperatorInfo = TypeEvaluatorNarrowing.getInOperatorNarrowingInfo(
            getInOperatorNarrowingContext(evaluator),
            reference,
            testExpression,
            isPositiveTest
        );
        if (inOperatorInfo) {
            if (inOperatorInfo.kind === 'container') {
                return (type: Type) => {
                    return {
                        type: narrowTypeForContainerType(
                            evaluator,
                            type,
                            inOperatorInfo.containerType!,
                            inOperatorInfo.adjIsPositiveTest
                        ),
                        isIncomplete: inOperatorInfo.isIncomplete,
                    };
                };
            }

            return (type: Type) => {
                return {
                    type: narrowTypeForTypedDictKey(
                        evaluator,
                        type,
                        inOperatorInfo.typedDictKeyType!,
                        inOperatorInfo.adjIsPositiveTest
                    ),
                    isIncomplete: inOperatorInfo.isIncomplete,
                };
            };
        }
    }

    if (testExpression.nodeType === ParseNodeType.Call) {
        const isInstanceInfo = TypeEvaluatorNarrowing.getIsInstanceCallNarrowingInfo(
            getIsInstanceCallNarrowingContext(evaluator),
            reference,
            testExpression,
            isPositiveTest
        );
        if (isInstanceInfo) {
            if (isInstanceInfo.kind === 'narrow') {
                return (type: Type) => {
                    return {
                        type: narrowTypeForInstanceOrSubclass(
                            evaluator,
                            type,
                            isInstanceInfo.classTypeList!,
                            isInstanceInfo.isInstanceCheck!,
                            /* isTypeIsCheck */ false,
                            isPositiveTest,
                            testExpression,
                            nodeInfo
                        ),
                        isIncomplete: isInstanceInfo.isIncomplete,
                    };
                };
            }

            return (type: Type) => {
                return {
                    type,
                    isIncomplete: true,
                };
            };
        }

        const boolCallInfo = TypeEvaluatorNarrowing.getBoolCallNarrowingInfo(
            getBoolCallNarrowingContext(evaluator),
            reference,
            testExpression
        );
        if (boolCallInfo) {
            return (type: Type) => {
                return {
                    type: narrowTypeForTruthiness(evaluator, type, isPositiveTest),
                    isIncomplete: boolCallInfo.isIncomplete,
                };
            };
        }

        // Look for a TypeGuard function.
        const isFunctionReturnTypeGuard = (type: FunctionType): boolean => {
            const returnType = type.shared.declaredReturnType;
            if (!returnType) {
                return false;
            }
            if (isClassInstance(returnType)) {
                return ClassType.isBuiltIn(returnType, ['TypeGuard', 'TypeIs']);
            }
            if (isUnion(returnType)) {
                let isAllGuards = true;
                doForEachSubtype(returnType, (subtype) => {
                    if (!isClassInstance(subtype) || !ClassType.isBuiltIn(subtype, ['TypeGuard', 'TypeIs'])) {
                        isAllGuards = false;
                    }
                });
                return isAllGuards;
            }
            return false;
        };

        // Reject unrelated references before evaluating the callee.
        if (
            testExpression.d.args.some((arg) => isMatchingExpressionOrWalrusRhs(evaluator, reference, arg.d.valueExpr))
        ) {
            const callTypeResult = evaluator.getTypeOfExpression(testExpression.d.leftExpr, EvalFlags.CallBaseDefaults);
            const callType = callTypeResult.type;

            let isPossiblyTypeGuard = false;
            if (isFunction(callType)) {
                isPossiblyTypeGuard = isFunctionReturnTypeGuard(callType);
            } else if (isOverloaded(callType)) {
                isPossiblyTypeGuard = OverloadedType.getOverloads(callType).some(isFunctionReturnTypeGuard);
            } else if (isClassInstance(callType)) {
                // A callable object's __call__ may be overloaded, a property or have
                // an inferred return type, so rely on the evaluated call below.
                isPossiblyTypeGuard = true;
            }

            if (isPossiblyTypeGuard) {
                const functionReturnTypeResult = evaluator.getTypeOfExpression(testExpression);
                const functionReturnType = functionReturnTypeResult.type;
                let typeGuardType: Type | undefined;
                let isStrictTypeGuard = false;

                if (
                    isClassInstance(functionReturnType) &&
                    ClassType.isBuiltIn(functionReturnType, ['TypeGuard', 'TypeIs']) &&
                    functionReturnType.priv.typeArgs &&
                    functionReturnType.priv.typeArgs.length > 0
                ) {
                    isStrictTypeGuard = ClassType.isBuiltIn(functionReturnType, 'TypeIs');
                    typeGuardType = functionReturnType.priv.typeArgs[0];
                } else if (isUnion(functionReturnType)) {
                    const typeGuardSubtypes: ClassType[] = [];
                    let isAllGuards = true;

                    doForEachSubtype(functionReturnType, (subtype) => {
                        if (
                            isClassInstance(subtype) &&
                            ClassType.isBuiltIn(subtype, ['TypeGuard', 'TypeIs']) &&
                            subtype.priv.typeArgs &&
                            subtype.priv.typeArgs.length > 0
                        ) {
                            typeGuardSubtypes.push(subtype);
                        } else {
                            isAllGuards = false;
                        }
                    });

                    if (isAllGuards && typeGuardSubtypes.length > 0) {
                        // A union of type guards cannot be strict in the negative case because at runtime
                        // only one arm of the overload/union is selected. Treating it as strict would
                        // unsoundly eliminate types in the negative branch.
                        isStrictTypeGuard = false;
                        typeGuardType = combineTypes(typeGuardSubtypes.map((subtype) => subtype.priv.typeArgs![0]));
                    }
                }

                if (typeGuardType) {
                    // Map only guard-returning calls. Ordinary callable predicates
                    // do not need their virtual parameter lists expanded.
                    const getTargetArgExpr = (fnType: FunctionType): ExpressionNode | undefined => {
                        // Callable-valued attributes can have binding metadata without a method receiver.
                        const isUnbound =
                            fnType.shared.methodClass !== undefined &&
                            !FunctionType.isStaticMethod(fnType) &&
                            fnType.priv.strippedFirstParamType === undefined;

                        const targetIndex = isUnbound ? 1 : 0;
                        const getPositionalArgExpr = (): ExpressionNode | undefined => {
                            // Unpacking before the guarded position obscures its argument expression.
                            let positionalIndex = 0;
                            for (const arg of testExpression.d.args) {
                                if (arg.d.name) {
                                    continue;
                                }
                                if (arg.d.argCategory !== ArgCategory.Simple) {
                                    return undefined;
                                }
                                if (positionalIndex === targetIndex) {
                                    return arg.d.valueExpr;
                                }
                                positionalIndex++;
                            }

                            return undefined;
                        };

                        // Simple leading parameters bind positionally without expanding the rest of the signature.
                        const firstParam = fnType.shared.parameters[0];
                        const targetParam = fnType.shared.parameters[targetIndex];
                        if (
                            firstParam?.category === ParamCategory.Simple &&
                            firstParam.name &&
                            targetParam?.category === ParamCategory.Simple &&
                            targetParam.name
                        ) {
                            const positionalArgExpr = getPositionalArgExpr();
                            if (positionalArgExpr) {
                                return positionalArgExpr;
                            }
                        }

                        const paramDetails = getParamListDetails(fnType);
                        if (targetIndex >= paramDetails.params.length) {
                            return undefined;
                        }

                        const target = paramDetails.params[targetIndex];
                        if (
                            target.param.category !== ParamCategory.Simple &&
                            target.param.category !== ParamCategory.ArgsList
                        ) {
                            return undefined;
                        }

                        if (
                            (target.kind === ParamKind.Standard || target.kind === ParamKind.Keyword) &&
                            target.param.name
                        ) {
                            const kwArg = testExpression.d.args.find(
                                (arg) =>
                                    arg.d.argCategory === ArgCategory.Simple &&
                                    arg.d.name?.d.value === target.param.name
                            );
                            if (kwArg) {
                                return kwArg.d.valueExpr;
                            }
                        }

                        if (target.kind === ParamKind.Keyword) {
                            return undefined;
                        }

                        return getPositionalArgExpr();
                    };

                    let arg0Expr: ExpressionNode | undefined;
                    const overloadsUsed = functionReturnTypeResult.overloadsUsedForCall;
                    if (overloadsUsed && overloadsUsed.length > 0) {
                        arg0Expr = getTargetArgExpr(overloadsUsed[0]);
                        for (let i = 1; arg0Expr && i < overloadsUsed.length; i++) {
                            if (getTargetArgExpr(overloadsUsed[i]) !== arg0Expr) {
                                arg0Expr = undefined;
                                break;
                            }
                        }
                    } else if (isFunction(callType)) {
                        arg0Expr = getTargetArgExpr(callType);
                    }

                    if (arg0Expr && isMatchingExpressionOrWalrusRhs(evaluator, reference, arg0Expr)) {
                        const isIncomplete = !!callTypeResult.isIncomplete || !!functionReturnTypeResult.isIncomplete;
                        const guardType = typeGuardType;

                        return (type: Type) => {
                            return {
                                type: narrowTypeForUserDefinedTypeGuard(
                                    evaluator,
                                    type,
                                    guardType,
                                    isPositiveTest,
                                    isStrictTypeGuard,
                                    testExpression,
                                    nodeInfo
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
        nodeInfo,
        recursionCount
    );
    if (narrowingCallback) {
        return narrowingCallback;
    }

    // We normally won't find a "not" operator here because they are stripped out
    // by the binder when it creates condition flow nodes, but we can find this
    // in the case of local variables type narrowing.
    const notExpressionInfo = TypeEvaluatorNarrowing.getNotExpressionNarrowingInfo(
        reference,
        testExpression,
        isPositiveTest
    );
    if (reference.nodeType === ParseNodeType.Name && notExpressionInfo) {
        return getTypeNarrowingCallback(
            evaluator,
            reference,
            notExpressionInfo.innerExpression,
            notExpressionInfo.adjIsPositiveTest,
            nodeInfo,
            recursionCount
        );
    }

    return undefined;
}

function getTypeNarrowingCallbackForAliasedCondition(
    evaluator: TypeEvaluator,
    reference: ExpressionNode,
    testExpression: ExpressionNode,
    isPositiveTest: boolean,
    nodeInfo: AnalyzerNodeInfoAccessor,
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

    return getTypeNarrowingCallback(evaluator, reference, initNode, isPositiveTest, nodeInfo, recursionCount);
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
    const nodeInfo = getInfoReader(evaluator);
    const scope = getScopeForNode(name, nodeInfo);
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
            const declScopeNode = ParseTreeUtils.getExecutionScopeNode(nodeToConsider, nodeInfo);
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
    nodeInfo: AnalyzerNodeInfoAccessor,
    recursionCount: number
) {
    return (
        getTypeNarrowingCallback(
            evaluator,
            reference,
            testExpression.d.rightExpr,
            isPositiveTest,
            nodeInfo,
            recursionCount
        ) ??
        getTypeNarrowingCallback(evaluator, reference, testExpression.d.name, isPositiveTest, nodeInfo, recursionCount)
    );
}

function narrowTypeForUserDefinedTypeGuard(
    evaluator: TypeEvaluator,
    type: Type,
    typeGuardType: Type,
    isPositiveTest: boolean,
    isStrictTypeGuard: boolean,
    errorNode: ExpressionNode,
    nodeInfo: AnalyzerNodeInfoAccessor
): Type {
    return TypeEvaluatorNarrowing.narrowTypeForUserDefinedTypeGuard(
        evaluator,
        type,
        typeGuardType,
        isPositiveTest,
        isStrictTypeGuard,
        errorNode,
        nodeInfo,
        narrowTypeForInstanceOrSubclass
    );
}

// Narrow the type based on whether the subtype can be true or false.
function narrowTypeForTruthiness(evaluator: TypeEvaluator, type: Type, isPositiveTest: boolean) {
    return TypeEvaluatorNarrowing.narrowTypeForTruthiness(evaluator, type, isPositiveTest);
}

// Handle type narrowing for expressions of the form "a[I] is None" and "a[I] is not None" where
// I is an integer and a is a union of Tuples (or subtypes thereof) with known lengths and entry types.
function narrowTupleTypeForIsNone(evaluator: TypeEvaluator, type: Type, isPositiveTest: boolean, indexValue: number) {
    return TypeEvaluatorNarrowing.narrowTupleTypeForIsNone(evaluator, type, isPositiveTest, indexValue);
}

// Handle type narrowing for expressions of the form "x is None" and "x is not None".
function narrowTypeForIsNone(evaluator: TypeEvaluator, type: Type, isPositiveTest: boolean) {
    return TypeEvaluatorNarrowing.narrowTypeForIsNone(evaluator, type, isPositiveTest);
}

// Handle type narrowing for expressions of the form "x is ..." and "x is not ...".
function narrowTypeForIsEllipsis(evaluator: TypeEvaluator, node: ExpressionNode, type: Type, isPositiveTest: boolean) {
    return TypeEvaluatorNarrowing.narrowTypeForIsEllipsis(evaluator, node, type, isPositiveTest);
}

// The "isinstance" and "issubclass" calls accept classes, runtime unions,
// and arbitrarily-nested tuples of these. This method extracts possible
// classes and guaranteed negative filters,
// or undefined if the filter contains a non-class type.
export function getIsInstanceClassTypes(
    evaluator: TypeEvaluator,
    argType: Type,
    argExpr: ExpressionNode
): IsInstanceClassTypeInfo | undefined {
    return TypeEvaluatorNarrowing.getIsInstanceClassTypes(evaluator, argType, argExpr);
}

export function narrowTypeForInstanceOrSubclass(
    evaluator: TypeEvaluator,
    type: Type,
    filterTypes: Type[],
    isInstanceCheck: boolean,
    isTypeIsCheck: boolean,
    isPositiveTest: boolean,
    errorNode: ExpressionNode,
    nodeInfo: AnalyzerNodeInfoAccessor
) {
    return TypeEvaluatorNarrowing.narrowTypeForInstanceOrSubclass(
        evaluator,
        type,
        filterTypes,
        isInstanceCheck,
        isTypeIsCheck,
        isPositiveTest,
        errorNode,
        nodeInfo,
        narrowTypeForInstanceOrSubclassInternal
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
    errorNode: ExpressionNode,
    nodeInfo: AnalyzerNodeInfoAccessor
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
            errorNode,
            nodeInfo
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
    errorNode: ExpressionNode,
    nodeInfo: AnalyzerNodeInfoAccessor
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
        return makeTypeVarsFree(varType, ParseTreeUtils.getTypeVarScopesForNode(errorNode, nodeInfo));
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
                        ParseTreeUtils.getTypeVarScopesForNode(errorNode, nodeInfo)
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
                    if (
                        !isTypeIsCheck &&
                        concreteFilterType.priv.includeSubclasses &&
                        !ClassType.isFinal(concreteFilterType)
                    ) {
                        // If the filter type includes subclasses and is not final, we can't eliminate
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
                    const fileInfo = nodeInfo.getFileInfo(errorNode);
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
    return TypeEvaluatorNarrowing.narrowTypeForTupleLength(
        evaluator,
        referenceType,
        lengthValue,
        isPositiveTest,
        isLessThanCheck
    );
}

// Expands a tuple type that contains an unbounded element to include
// multiple bounded elements of that same type in place of (or in addition
// to) the unbounded element.

// Attempts to narrow a type (make it more constrained) based on an "in" binary operator.
function narrowTypeForContainerType(
    evaluator: TypeEvaluator,
    referenceType: Type,
    containerType: Type,
    isPositiveTest: boolean
) {
    return TypeEvaluatorNarrowing.narrowTypeForContainerType(evaluator, referenceType, containerType, isPositiveTest);
}

export function getElementTypeForContainerNarrowing(containerType: Type) {
    return TypeEvaluatorNarrowing.getElementTypeForContainerNarrowing(containerType);
}

export function narrowTypeForContainerElementType(evaluator: TypeEvaluator, referenceType: Type, elementType: Type) {
    return TypeEvaluatorNarrowing.narrowTypeForContainerElementType(evaluator, referenceType, elementType);
}

// Attempts to narrow a type based on whether it is a TypedDict with
// a literal key value.
function narrowTypeForTypedDictKey(
    evaluator: TypeEvaluator,
    referenceType: Type,
    literalKey: ClassType,
    isPositiveTest: boolean
): Type {
    return TypeEvaluatorNarrowing.narrowTypeForTypedDictKey(evaluator, referenceType, literalKey, isPositiveTest);
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
    return TypeEvaluatorNarrowing.narrowTypeForDiscriminatedDictEntryComparison(
        evaluator,
        referenceType,
        indexLiteralType,
        literalType,
        isPositiveTest
    );
}

export function narrowTypeForDiscriminatedTupleComparison(
    evaluator: TypeEvaluator,
    referenceType: Type,
    indexLiteralType: ClassType,
    literalType: Type,
    isPositiveTest: boolean
): Type {
    return TypeEvaluatorNarrowing.narrowTypeForDiscriminatedTupleComparison(
        evaluator,
        referenceType,
        indexLiteralType,
        literalType,
        isPositiveTest
    );
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
    return TypeEvaluatorNarrowing.narrowTypeForDiscriminatedLiteralFieldComparison(
        evaluator,
        referenceType,
        memberName,
        literalType,
        isPositiveTest
    );
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
    return TypeEvaluatorNarrowing.narrowTypeForDiscriminatedFieldNoneComparison(
        evaluator,
        referenceType,
        memberName,
        isPositiveTest
    );
}

// Determines whether two classes have incompatible disjoint bases (PEP 800),
// in which case no class can derive from both of them.

// Fill gradual holes without replacing facts inferred from the guarded value.

// Attempts to narrow a type based on a "type(x) is y" or "type(x) is not y" check.
function narrowTypeForTypeIs(
    evaluator: TypeEvaluator,
    type: Type,
    classTypes: ClassType[],
    isPositiveTest: boolean,
    isIsOperator: boolean,
    classTypeVar: TypeVarType | undefined,
    allowLegacyEquality: boolean,
    allowExactStringFlow: boolean
) {
    return TypeEvaluatorNarrowing.narrowTypeForTypeIs(
        evaluator,
        type,
        classTypes,
        isPositiveTest,
        isIsOperator,
        classTypeVar,
        allowLegacyEquality,
        allowExactStringFlow
    );
}

// Determines whether an equality comparison ("==" or "!=") involving the
// specified class object is guaranteed to have identity semantics. This
// requires that the class is statically closed (it cannot be a subclass
// with a different metaclass), is not generic (specialized aliases compare
// by value), and its metaclass does not override "__eq__" or "__ne__".

// Legacy forward type(x) equality guards check declared metaclasses without closing subclass hierarchies.

// Attempts to narrow a type based on a comparison with a class using "is" or
// "is not", or "==" or "!=".
function narrowTypeForClassComparison(
    evaluator: TypeEvaluator,
    referenceType: Type,
    classType: ClassType,
    isPositiveTest: boolean,
    isIsOperator = true
): Type {
    return TypeEvaluatorNarrowing.narrowTypeForClassComparison(
        evaluator,
        referenceType,
        classType,
        isPositiveTest,
        isIsOperator
    );
}

// Determines whether the specified class is an enum class whose members derive
// from a primitive type (e.g. IntEnum or StrEnum). Members of such classes
// compare equal to their underlying primitive value at runtime.

// Determines whether enumType is a primitive-backed enum class and primitiveType
// is the primitive type (int or str) from which it derives.

// If the specified type is a literal member of a primitive-backed enum class,
// returns the corresponding primitive literal type. Otherwise returns the type
// unmodified.

// Determines whether two literal types compare equal using the `==` operator at
// runtime. This differs from ClassType.isLiteralValueSame only for members of
// primitive-backed enum classes, which compare equal to their underlying
// primitive values.

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
    return TypeEvaluatorNarrowing.narrowTypeForLiteralComparison(
        evaluator,
        referenceType,
        literalType,
        isPositiveTest,
        isIsOperator
    );
}

export function enumerateLiteralsForType(evaluator: TypeEvaluator, type: ClassType): ClassType[] | undefined {
    return TypeEvaluatorNarrowing.enumerateLiteralsForType(evaluator, type);
}

// Determines whether the expression name node is in the same scope or
// an outer scope from the reference name node. This allows isMatchingExpression
// to determine whether two name nodes are referring to the same symbol.
function isNameSameScope(evaluator: TypeEvaluator, reference: NameNode, expression: NameNode): boolean {
    return TypeEvaluatorNarrowing.isNameSameScope(evaluator, reference, expression);
}

// Matches a reference against an expression, including the RHS of an assignment
// expression. This keeps walrus narrowing consistent with truthiness handling in
// getTypeNarrowingCallbackForAssignmentExpression.
function isMatchingExpressionOrWalrusRhs(
    evaluator: TypeEvaluator,
    reference: ExpressionNode,
    expression: ExpressionNode
): boolean {
    const compareName = (ref: NameNode, expr: NameNode) => isNameSameScope(evaluator, ref, expr);

    if (ParseTreeUtils.isMatchingExpression(reference, expression, compareName)) {
        return true;
    }

    if (expression.nodeType === ParseNodeType.AssignmentExpression) {
        return ParseTreeUtils.isMatchingExpression(reference, expression.d.rightExpr, compareName);
    }

    return false;
}
