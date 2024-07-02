/*
 * operations.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Provides type evaluation logic for unary, binary, augmented assignment,
 * and ternary operators.
 */

import { DiagnosticAddendum } from '../common/diagnostic';
import { DiagnosticRule } from '../common/diagnosticRules';
import { pythonVersion3_10 } from '../common/pythonVersion';
import { LocMessage } from '../localization/localize';
import {
    AugmentedAssignmentNode,
    BinaryOperationNode,
    ExpressionNode,
    ParseNodeType,
    TernaryNode,
    UnaryOperationNode,
} from '../parser/parseNodes';
import { OperatorType } from '../parser/tokenizerTypes';
import { getFileInfo } from './analyzerNodeInfo';
import { getEnclosingLambda, isWithinLoop, operatorSupportsChaining, printOperator } from './parseTreeUtils';
import { getScopeForNode } from './scopeUtils';
import { evaluateStaticBoolExpression } from './staticExpressions';
import { EvalFlags, TypeEvaluator, TypeResult } from './typeEvaluatorTypes';
import {
    InferenceContext,
    convertToInstantiable,
    getLiteralTypeClassName,
    getTypeCondition,
    getUnionSubtypeCount,
    isNoneInstance,
    isOptionalType,
    isTupleClass,
    isUnboundedTupleClass,
    isUnionableType,
    lookUpClassMember,
    makeInferenceContext,
    mapSubtypes,
    preserveUnknown,
    removeNoneFromUnion,
    someSubtypes,
    specializeTupleClass,
    transformPossibleRecursiveTypeAlias,
} from './typeUtils';
import {
    ClassType,
    NeverType,
    Type,
    TypeBase,
    UnknownType,
    combineTypes,
    isAnyOrUnknown,
    isClass,
    isClassInstance,
    isFunction,
    isInstantiableClass,
    isNever,
    isOverloadedFunction,
    isUnion,
} from './types';

// Maps binary operators to the magic methods that implement them.
const binaryOperatorMap: { [operator: number]: [string, string] } = {
    [OperatorType.Add]: ['__add__', '__radd__'],
    [OperatorType.Subtract]: ['__sub__', '__rsub__'],
    [OperatorType.Multiply]: ['__mul__', '__rmul__'],
    [OperatorType.FloorDivide]: ['__floordiv__', '__rfloordiv__'],
    [OperatorType.Divide]: ['__truediv__', '__rtruediv__'],
    [OperatorType.Mod]: ['__mod__', '__rmod__'],
    [OperatorType.Power]: ['__pow__', '__rpow__'],
    [OperatorType.MatrixMultiply]: ['__matmul__', '__rmatmul__'],
    [OperatorType.BitwiseAnd]: ['__and__', '__rand__'],
    [OperatorType.BitwiseOr]: ['__or__', '__ror__'],
    [OperatorType.BitwiseXor]: ['__xor__', '__rxor__'],
    [OperatorType.LeftShift]: ['__lshift__', '__rlshift__'],
    [OperatorType.RightShift]: ['__rshift__', '__rrshift__'],
    [OperatorType.Equals]: ['__eq__', '__eq__'],
    [OperatorType.NotEquals]: ['__ne__', '__ne__'],
    [OperatorType.LessThan]: ['__lt__', '__gt__'],
    [OperatorType.LessThanOrEqual]: ['__le__', '__ge__'],
    [OperatorType.GreaterThan]: ['__gt__', '__lt__'],
    [OperatorType.GreaterThanOrEqual]: ['__ge__', '__le__'],
};

// Map of operators that always return a bool result.
const booleanOperatorMap: { [operator: number]: true } = {
    [OperatorType.And]: true,
    [OperatorType.Or]: true,
    [OperatorType.Is]: true,
    [OperatorType.IsNot]: true,
    [OperatorType.In]: true,
    [OperatorType.NotIn]: true,
};

interface BinaryOperationOptions {
    isLiteralMathAllowed?: boolean;
    isTupleAddAllowed?: boolean;
}

// If the number of subtypes starts to explode when applying "literal math",
// cut off the literal union and fall back to the non-literal supertype.
const maxLiteralMathSubtypeCount = 64;

export function validateBinaryOperation(
    evaluator: TypeEvaluator,
    operator: OperatorType,
    leftTypeResult: TypeResult,
    rightTypeResult: TypeResult,
    errorNode: ExpressionNode,
    inferenceContext: InferenceContext | undefined,
    diag: DiagnosticAddendum,
    options: BinaryOperationOptions
): Type {
    const leftType = leftTypeResult.type;
    const rightType = rightTypeResult.type;
    const isIncomplete = !!leftTypeResult.isIncomplete || !!rightTypeResult.isIncomplete;
    let type: Type | undefined;
    let concreteLeftType = evaluator.makeTopLevelTypeVarsConcrete(leftType);

    if (booleanOperatorMap[operator] !== undefined) {
        // If it's an AND or OR, we need to handle short-circuiting by
        // eliminating any known-truthy or known-falsy types.
        if (operator === OperatorType.And) {
            // If the LHS evaluates to falsy, the And expression will
            // always return the type of the left-hand side.
            if (!evaluator.canBeTruthy(concreteLeftType)) {
                return leftType;
            }

            // If the LHS evaluates to truthy, the And expression will
            // always return the type of the right-hand side.
            if (!evaluator.canBeFalsy(concreteLeftType)) {
                return rightType;
            }

            concreteLeftType = evaluator.removeTruthinessFromType(concreteLeftType);

            if (isNever(rightType)) {
                return concreteLeftType;
            }
        } else if (operator === OperatorType.Or) {
            // If the LHS evaluates to truthy, the Or expression will
            // always return the type of the left-hand side.
            if (!evaluator.canBeFalsy(concreteLeftType)) {
                return leftType;
            }

            // If the LHS evaluates to falsy, the Or expression will
            // always return the type of the right-hand side.
            if (!evaluator.canBeTruthy(concreteLeftType)) {
                return rightType;
            }

            concreteLeftType = evaluator.removeFalsinessFromType(concreteLeftType);

            if (isNever(rightType)) {
                return concreteLeftType;
            }
        }

        if (isNever(leftType) || isNever(rightType)) {
            return NeverType.createNever();
        }

        // The "in" and "not in" operators make use of the __contains__
        // magic method.
        if (operator === OperatorType.In || operator === OperatorType.NotIn) {
            type = evaluator.mapSubtypesExpandTypeVars(
                rightType,
                /* options */ undefined,
                (rightSubtypeExpanded, rightSubtypeUnexpanded) => {
                    return evaluator.mapSubtypesExpandTypeVars(
                        concreteLeftType,
                        { conditionFilter: getTypeCondition(rightSubtypeExpanded) },
                        (leftSubtype) => {
                            if (isAnyOrUnknown(leftSubtype) || isAnyOrUnknown(rightSubtypeUnexpanded)) {
                                return preserveUnknown(leftSubtype, rightSubtypeExpanded);
                            }

                            let returnType = evaluator.getTypeOfMagicMethodCall(
                                rightSubtypeExpanded,
                                '__contains__',
                                [{ type: leftSubtype, isIncomplete: leftTypeResult.isIncomplete }],
                                errorNode,
                                /* inferenceContext */ undefined
                            );

                            if (!returnType) {
                                // If __contains__ was not supported, fall back
                                // on an iterable.
                                const iteratorType = evaluator.getTypeOfIterator(
                                    { type: rightSubtypeExpanded, isIncomplete: rightTypeResult.isIncomplete },
                                    /* isAsync */ false,
                                    errorNode,
                                    /* emitNotIterableError */ false
                                )?.type;

                                if (iteratorType && evaluator.assignType(iteratorType, leftSubtype)) {
                                    returnType = evaluator.getBuiltInObject(errorNode, 'bool');
                                }
                            }

                            if (!returnType) {
                                diag.addMessage(
                                    LocMessage.typeNotSupportBinaryOperator().format({
                                        operator: printOperator(operator),
                                        leftType: evaluator.printType(leftSubtype),
                                        rightType: evaluator.printType(rightSubtypeExpanded),
                                    })
                                );
                            }

                            return returnType;
                        }
                    );
                }
            );

            // Assume that a bool is returned even if the type is unknown
            if (type && !isNever(type)) {
                type = evaluator.getBuiltInObject(errorNode, 'bool');
            }
        } else {
            type = evaluator.mapSubtypesExpandTypeVars(
                concreteLeftType,
                /* options */ undefined,
                (leftSubtypeExpanded, leftSubtypeUnexpanded) => {
                    return evaluator.mapSubtypesExpandTypeVars(
                        rightType,
                        { conditionFilter: getTypeCondition(leftSubtypeExpanded) },
                        (rightSubtypeExpanded, rightSubtypeUnexpanded) => {
                            // If the operator is an AND or OR, we need to combine the two types.
                            if (operator === OperatorType.And || operator === OperatorType.Or) {
                                return combineTypes([leftSubtypeUnexpanded, rightSubtypeUnexpanded]);
                            }
                            // The other boolean operators always return a bool value.
                            return evaluator.getBuiltInObject(errorNode, 'bool');
                        }
                    );
                }
            );
        }
    } else if (binaryOperatorMap[operator]) {
        if (isNever(leftType) || isNever(rightType)) {
            return NeverType.createNever();
        }

        // Handle certain operations on certain homogenous literal types
        // using special-case math. For example, Literal[1, 2] + Literal[3, 4]
        // should result in Literal[4, 5, 6].
        if (options.isLiteralMathAllowed) {
            const leftLiteralClassName = getLiteralTypeClassName(leftType);
            if (leftLiteralClassName && !getTypeCondition(leftType)) {
                const rightLiteralClassName = getLiteralTypeClassName(rightType);

                if (
                    leftLiteralClassName === rightLiteralClassName &&
                    !getTypeCondition(rightType) &&
                    getUnionSubtypeCount(leftType) * getUnionSubtypeCount(rightType) < maxLiteralMathSubtypeCount
                ) {
                    if (leftLiteralClassName === 'str' || leftLiteralClassName === 'bytes') {
                        if (operator === OperatorType.Add) {
                            type = mapSubtypes(leftType, (leftSubtype) => {
                                return mapSubtypes(rightType, (rightSubtype) => {
                                    const leftClassSubtype = leftSubtype as ClassType;
                                    const rightClassSubtype = rightSubtype as ClassType;

                                    return ClassType.cloneWithLiteral(
                                        leftClassSubtype,
                                        ((leftClassSubtype.literalValue as string) +
                                            rightClassSubtype.literalValue) as string
                                    );
                                });
                            });
                        }
                    } else if (leftLiteralClassName === 'int') {
                        if (
                            operator === OperatorType.Add ||
                            operator === OperatorType.Subtract ||
                            operator === OperatorType.Multiply ||
                            operator === OperatorType.FloorDivide ||
                            operator === OperatorType.Mod
                        ) {
                            let isValidResult = true;

                            type = mapSubtypes(leftType, (leftSubtype) => {
                                return mapSubtypes(rightType, (rightSubtype) => {
                                    try {
                                        const leftClassSubtype = leftSubtype as ClassType;
                                        const rightClassSubtype = rightSubtype as ClassType;
                                        const leftLiteralValue = BigInt(
                                            leftClassSubtype.literalValue as number | bigint
                                        );
                                        const rightLiteralValue = BigInt(
                                            rightClassSubtype.literalValue as number | bigint
                                        );

                                        let newValue: number | bigint | undefined;
                                        if (operator === OperatorType.Add) {
                                            newValue = leftLiteralValue + rightLiteralValue;
                                        } else if (operator === OperatorType.Subtract) {
                                            newValue = leftLiteralValue - rightLiteralValue;
                                        } else if (operator === OperatorType.Multiply) {
                                            newValue = leftLiteralValue * rightLiteralValue;
                                        } else if (operator === OperatorType.FloorDivide) {
                                            if (rightLiteralValue !== BigInt(0)) {
                                                newValue = leftLiteralValue / rightLiteralValue;
                                            }
                                        } else if (operator === OperatorType.Mod) {
                                            if (rightLiteralValue !== BigInt(0)) {
                                                newValue = leftLiteralValue % rightLiteralValue;
                                            }
                                        }

                                        if (newValue === undefined) {
                                            isValidResult = false;
                                            return undefined;
                                        } else if (typeof newValue === 'number' && isNaN(newValue)) {
                                            isValidResult = false;
                                            return undefined;
                                        } else {
                                            // Convert back to a simple number if it fits. Leave as a bigint
                                            // if it doesn't.
                                            if (
                                                newValue >= Number.MIN_SAFE_INTEGER &&
                                                newValue <= Number.MAX_SAFE_INTEGER
                                            ) {
                                                newValue = Number(newValue);
                                            }

                                            return ClassType.cloneWithLiteral(leftClassSubtype, newValue);
                                        }
                                    } catch {
                                        isValidResult = false;
                                        return undefined;
                                    }
                                });
                            });

                            if (!isValidResult) {
                                type = undefined;
                            }
                        }
                    }
                }
            }
        }

        if (!type) {
            type = evaluator.mapSubtypesExpandTypeVars(
                leftType,
                /* options */ undefined,
                (leftSubtypeExpanded, leftSubtypeUnexpanded) => {
                    return evaluator.mapSubtypesExpandTypeVars(
                        rightType,
                        { conditionFilter: getTypeCondition(leftSubtypeExpanded) },
                        (rightSubtypeExpanded, rightSubtypeUnexpanded) => {
                            if (isAnyOrUnknown(leftSubtypeUnexpanded) || isAnyOrUnknown(rightSubtypeUnexpanded)) {
                                return preserveUnknown(leftSubtypeUnexpanded, rightSubtypeUnexpanded);
                            }

                            const tupleClassType = evaluator.getTupleClassType();

                            // Special-case __add__ for tuples when the types for both tuples are known.
                            if (
                                options.isTupleAddAllowed &&
                                operator === OperatorType.Add &&
                                isClassInstance(leftSubtypeExpanded) &&
                                isTupleClass(leftSubtypeExpanded) &&
                                leftSubtypeExpanded.tupleTypeArguments &&
                                isClassInstance(rightSubtypeExpanded) &&
                                isTupleClass(rightSubtypeExpanded) &&
                                rightSubtypeExpanded.tupleTypeArguments &&
                                tupleClassType &&
                                isInstantiableClass(tupleClassType)
                            ) {
                                // If at least one of the tuples is of fixed size, we can
                                // combine them into a precise new type. If both are unbounded
                                // (or contain an unbounded element), we cannot combine them
                                // in this manner because tuples can contain at most one
                                // unbounded element.
                                if (
                                    !isUnboundedTupleClass(leftSubtypeExpanded) ||
                                    !isUnboundedTupleClass(rightSubtypeExpanded)
                                ) {
                                    return ClassType.cloneAsInstance(
                                        specializeTupleClass(tupleClassType, [
                                            ...leftSubtypeExpanded.tupleTypeArguments,
                                            ...rightSubtypeExpanded.tupleTypeArguments,
                                        ])
                                    );
                                }
                            }

                            const magicMethodName = binaryOperatorMap[operator][0];
                            let resultType = evaluator.getTypeOfMagicMethodCall(
                                convertFunctionToObject(evaluator, leftSubtypeUnexpanded),
                                magicMethodName,
                                [{ type: rightSubtypeUnexpanded, isIncomplete: rightTypeResult.isIncomplete }],
                                errorNode,
                                inferenceContext
                            );

                            if (!resultType && leftSubtypeUnexpanded !== leftSubtypeExpanded) {
                                // Try the expanded left type.
                                resultType = evaluator.getTypeOfMagicMethodCall(
                                    convertFunctionToObject(evaluator, leftSubtypeExpanded),
                                    magicMethodName,
                                    [{ type: rightSubtypeUnexpanded, isIncomplete: rightTypeResult.isIncomplete }],
                                    errorNode,
                                    inferenceContext
                                );
                            }

                            if (!resultType && rightSubtypeUnexpanded !== rightSubtypeExpanded) {
                                // Try the expanded left and right type.
                                resultType = evaluator.getTypeOfMagicMethodCall(
                                    convertFunctionToObject(evaluator, leftSubtypeExpanded),
                                    magicMethodName,
                                    [{ type: rightSubtypeExpanded, isIncomplete: rightTypeResult.isIncomplete }],
                                    errorNode,
                                    inferenceContext
                                );
                            }

                            if (!resultType) {
                                // Try the alternate form (swapping right and left).
                                const altMagicMethodName = binaryOperatorMap[operator][1];
                                resultType = evaluator.getTypeOfMagicMethodCall(
                                    convertFunctionToObject(evaluator, rightSubtypeUnexpanded),
                                    altMagicMethodName,
                                    [{ type: leftSubtypeUnexpanded, isIncomplete: leftTypeResult.isIncomplete }],
                                    errorNode,
                                    inferenceContext
                                );

                                if (!resultType && rightSubtypeUnexpanded !== rightSubtypeExpanded) {
                                    // Try the expanded right type.
                                    resultType = evaluator.getTypeOfMagicMethodCall(
                                        convertFunctionToObject(evaluator, rightSubtypeExpanded),
                                        altMagicMethodName,
                                        [
                                            {
                                                type: leftSubtypeUnexpanded,
                                                isIncomplete: leftTypeResult.isIncomplete,
                                            },
                                        ],
                                        errorNode,
                                        inferenceContext
                                    );
                                }

                                if (!resultType && leftSubtypeUnexpanded !== leftSubtypeExpanded) {
                                    // Try the expanded right and left type.
                                    resultType = evaluator.getTypeOfMagicMethodCall(
                                        convertFunctionToObject(evaluator, rightSubtypeExpanded),
                                        altMagicMethodName,
                                        [{ type: leftSubtypeExpanded, isIncomplete: leftTypeResult.isIncomplete }],
                                        errorNode,
                                        inferenceContext
                                    );
                                }
                            }

                            if (!resultType) {
                                if (inferenceContext) {
                                    diag.addMessage(
                                        LocMessage.typeNotSupportBinaryOperatorBidirectional().format({
                                            operator: printOperator(operator),
                                            leftType: evaluator.printType(leftSubtypeExpanded),
                                            rightType: evaluator.printType(rightSubtypeExpanded),
                                            expectedType: evaluator.printType(inferenceContext.expectedType),
                                        })
                                    );
                                } else {
                                    diag.addMessage(
                                        LocMessage.typeNotSupportBinaryOperator().format({
                                            operator: printOperator(operator),
                                            leftType: evaluator.printType(leftSubtypeExpanded),
                                            rightType: evaluator.printType(rightSubtypeExpanded),
                                        })
                                    );
                                }
                            }

                            return resultType ?? UnknownType.create(isIncomplete);
                        }
                    );
                }
            );
        }
    }

    return type ?? UnknownType.create(isIncomplete);
}

export function getTypeOfBinaryOperation(
    evaluator: TypeEvaluator,
    node: BinaryOperationNode,
    flags: EvalFlags,
    inferenceContext: InferenceContext | undefined
): TypeResult {
    const leftExpression = node.leftExpression;
    let rightExpression = node.rightExpression;
    let isIncomplete = false;
    let typeErrors = false;

    // If this is a comparison and the left expression is also a comparison,
    // we need to change the behavior to accommodate python's "chained
    // comparisons" feature.
    if (operatorSupportsChaining(node.operator)) {
        if (
            rightExpression.nodeType === ParseNodeType.BinaryOperation &&
            !rightExpression.parenthesized &&
            operatorSupportsChaining(rightExpression.operator)
        ) {
            // Evaluate the right expression so it is type checked.
            getTypeOfBinaryOperation(evaluator, rightExpression, flags, inferenceContext);

            // Use the left side of the right expression for comparison purposes.
            rightExpression = rightExpression.leftExpression;
        }
    }

    // For most binary operations, the "expected type" is applied to the output
    // of the magic method for that operation. However, the "or" and "and" operators
    // have no magic method, so we apply the expected type directly to both operands.
    let expectedOperandType =
        node.operator === OperatorType.Or || node.operator === OperatorType.And
            ? inferenceContext?.expectedType
            : undefined;

    // Handle the very special case where the expected type is a list
    // and the operator is a multiply. This comes up in the common case
    // of "x: List[Optional[X]] = [None] * y" where y is an integer literal.
    let expectedLeftOperandType: Type | undefined;
    if (
        node.operator === OperatorType.Multiply &&
        inferenceContext &&
        isClassInstance(inferenceContext.expectedType) &&
        ClassType.isBuiltIn(inferenceContext.expectedType, 'list') &&
        inferenceContext.expectedType.typeArguments &&
        inferenceContext.expectedType.typeArguments.length >= 1 &&
        node.leftExpression.nodeType === ParseNodeType.List
    ) {
        expectedLeftOperandType = inferenceContext.expectedType;
    }

    const effectiveExpectedType = expectedOperandType ?? expectedLeftOperandType;
    const leftTypeResult = evaluator.getTypeOfExpression(
        leftExpression,
        flags,
        makeInferenceContext(effectiveExpectedType)
    );
    let leftType = leftTypeResult.type;

    if (!expectedOperandType) {
        if (node.operator === OperatorType.Or || node.operator === OperatorType.And) {
            // For "or" and "and", use the type of the left operand under certain
            // circumstances. This allows us to infer a better type for expressions
            // like `x or []`. Do this only if it's a generic class (like list or dict)
            // or a TypedDict.
            if (
                someSubtypes(leftType, (subtype) => {
                    if (!isClassInstance(subtype)) {
                        return false;
                    }

                    return ClassType.isTypedDictClass(subtype) || subtype.details.typeParameters.length > 0;
                })
            ) {
                expectedOperandType = leftType;
            }
        } else if (node.operator === OperatorType.Add && node.rightExpression.nodeType === ParseNodeType.List) {
            // For the "+" operator , use this technique only if the right operand is
            // a list expression. This heuristic handles the common case of `my_list + [0]`.
            expectedOperandType = leftType;
        } else if (node.operator === OperatorType.BitwiseOr) {
            // If this is a bitwise or ("|"), use the type of the left operand. This allows
            // us to support the case where a TypedDict is being updated with a dict expression.
            if (isClassInstance(leftType) && ClassType.isTypedDictClass(leftType)) {
                expectedOperandType = leftType;
            }
        }
    }

    const rightTypeResult = evaluator.getTypeOfExpression(
        rightExpression,
        flags,
        makeInferenceContext(expectedOperandType)
    );
    let rightType = rightTypeResult.type;

    if (leftTypeResult.isIncomplete || rightTypeResult.isIncomplete) {
        isIncomplete = true;
    }

    // Is this a "|" operator used in a context where it is supposed to be
    // interpreted as a union operator?
    if (
        node.operator === OperatorType.BitwiseOr &&
        !customMetaclassSupportsMethod(leftType, '__or__') &&
        !customMetaclassSupportsMethod(rightType, '__ror__')
    ) {
        let adjustedRightType = rightType;
        let adjustedLeftType = leftType;
        if (!isNoneInstance(leftType) && isNoneInstance(rightType)) {
            // Handle the special case where "None" is being added to the union
            // with something else. Even though "None" will normally be interpreted
            // as the None singleton object in contexts where a type annotation isn't
            // assumed, we'll allow it here.
            adjustedRightType = convertToInstantiable(evaluator.getNoneType());
        } else if (!isNoneInstance(rightType) && isNoneInstance(leftType)) {
            adjustedLeftType = convertToInstantiable(evaluator.getNoneType());
        }

        if (isUnionableType([adjustedLeftType, adjustedRightType])) {
            const fileInfo = getFileInfo(node);
            const unionNotationSupported =
                fileInfo.isStubFile ||
                (flags & EvalFlags.ForwardRefs) !== 0 ||
                fileInfo.executionEnvironment.pythonVersion.isGreaterOrEqualTo(pythonVersion3_10);

            if (!unionNotationSupported) {
                // If the left type is Any, we can't say for sure whether this
                // is an illegal syntax or a valid application of the "|" operator.
                if (!isAnyOrUnknown(adjustedLeftType)) {
                    evaluator.addDiagnostic(
                        DiagnosticRule.reportGeneralTypeIssues,
                        LocMessage.unionSyntaxIllegal(),
                        node,
                        node.operatorToken
                    );
                }
            }

            const isLeftTypeArgValid = evaluator.validateTypeArg({ ...leftTypeResult, node: leftExpression });
            const isRightTypeArgValid = evaluator.validateTypeArg({ ...rightTypeResult, node: rightExpression });

            if (!isLeftTypeArgValid || !isRightTypeArgValid) {
                return { type: UnknownType.create() };
            }

            adjustedLeftType = evaluator.reportMissingTypeArguments(
                node.leftExpression,
                adjustedLeftType,
                flags | EvalFlags.InstantiableType
            );
            adjustedRightType = evaluator.reportMissingTypeArguments(
                node.rightExpression,
                adjustedRightType,
                flags | EvalFlags.InstantiableType
            );

            let newUnion = combineTypes([adjustedLeftType, adjustedRightType]);

            const unionClass = evaluator.getUnionClassType();
            if (unionClass && isInstantiableClass(unionClass)) {
                newUnion = TypeBase.cloneAsSpecialForm(newUnion, ClassType.cloneAsInstance(unionClass));
            }

            // Check for "stringified" forward reference type expressions. The "|" operator
            // doesn't support these except in certain circumstances. Notably, it can't be used
            // with other strings or with types that are not specialized using an index form.
            if (!fileInfo.isStubFile) {
                let stringNode: ExpressionNode | undefined;
                let otherNode: ExpressionNode | undefined;
                let otherType: Type | undefined;

                if (leftExpression.nodeType === ParseNodeType.StringList) {
                    stringNode = leftExpression;
                    otherNode = rightExpression;
                    otherType = rightType;
                } else if (rightExpression.nodeType === ParseNodeType.StringList) {
                    stringNode = rightExpression;
                    otherNode = leftExpression;
                    otherType = leftType;
                }

                if (stringNode && otherNode && otherType) {
                    let isAllowed = true;
                    if (isClass(otherType)) {
                        if (!otherType.isTypeArgumentExplicit || isClassInstance(otherType)) {
                            isAllowed = false;
                        }
                    }

                    if (!isAllowed) {
                        evaluator.addDiagnostic(
                            DiagnosticRule.reportGeneralTypeIssues,
                            LocMessage.unionForwardReferenceNotAllowed(),
                            stringNode
                        );
                    }
                }
            }

            return { type: newUnion };
        }
    }

    if ((flags & EvalFlags.TypeExpression) !== 0) {
        // Exempt "|" because it might be a union operation involving unknowns.
        if (node.operator !== OperatorType.BitwiseOr) {
            evaluator.addDiagnostic(DiagnosticRule.reportInvalidTypeForm, LocMessage.binaryOperationNotAllowed(), node);
            return { type: UnknownType.create() };
        }
    }

    // Optional checks apply to all operations except for boolean operations.
    let isLeftOptionalType = false;
    if (booleanOperatorMap[node.operator] === undefined) {
        // None is a valid operand for == and != even if the type stub says otherwise.
        if (node.operator === OperatorType.Equals || node.operator === OperatorType.NotEquals) {
            leftType = removeNoneFromUnion(leftType);
        } else {
            isLeftOptionalType = isOptionalType(leftType);
        }

        // None is a valid operand for == and != even if the type stub says otherwise.
        if (node.operator === OperatorType.Equals || node.operator === OperatorType.NotEquals) {
            rightType = removeNoneFromUnion(rightType);
        }
    }

    const diag = new DiagnosticAddendum();

    // Don't use literal math if the operation is within a loop
    // because the literal values may change each time. We also don't want to
    // apply literal math within the body of a lambda because they are often
    // used as callbacks where the value changes each time they are called.
    const isLiteralMathAllowed = !isWithinLoop(node) && !getEnclosingLambda(node);

    // Don't special-case tuple __add__ if the left type is a union. This
    // can result in an infinite loop if we keep creating new tuple types
    // within a loop construct using __add__.
    const isTupleAddAllowed = !isUnion(leftType);

    const type = validateBinaryOperation(
        evaluator,
        node.operator,
        { type: leftType, isIncomplete: leftTypeResult.isIncomplete },
        { type: rightType, isIncomplete: rightTypeResult.isIncomplete },
        node,
        inferenceContext,
        diag,
        { isLiteralMathAllowed, isTupleAddAllowed }
    );

    if (!diag.isEmpty()) {
        typeErrors = true;

        if (!isIncomplete) {
            if (isLeftOptionalType && diag.getMessages().length === 1) {
                // If the left was an optional type and there is just one diagnostic,
                // assume that it was due to a "None" not being supported. Report
                // this as a reportOptionalOperand diagnostic rather than a
                // reportGeneralTypeIssues diagnostic.
                evaluator.addDiagnostic(
                    DiagnosticRule.reportOptionalOperand,
                    LocMessage.noneOperator().format({
                        operator: printOperator(node.operator),
                    }),
                    node.leftExpression
                );
            } else {
                // If neither the LHS or RHS are unions, don't include a diagnostic addendum
                // because it will be redundant with the main diagnostic message. The addenda
                // are useful only if union expansion was used for one or both operands.
                let diagString = '';
                if (
                    isUnion(evaluator.makeTopLevelTypeVarsConcrete(leftType)) ||
                    isUnion(evaluator.makeTopLevelTypeVarsConcrete(rightType))
                ) {
                    diagString = diag.getString();
                }

                evaluator.addDiagnostic(
                    DiagnosticRule.reportOperatorIssue,
                    LocMessage.typeNotSupportBinaryOperator().format({
                        operator: printOperator(node.operator),
                        leftType: evaluator.printType(leftType),
                        rightType: evaluator.printType(rightType),
                    }) + diagString,
                    node
                );
            }
        }
    }

    return { type, isIncomplete, typeErrors };
}

export function getTypeOfAugmentedAssignment(
    evaluator: TypeEvaluator,
    node: AugmentedAssignmentNode,
    inferenceContext: InferenceContext | undefined
): TypeResult {
    const operatorMap: { [operator: number]: [string, OperatorType] } = {
        [OperatorType.AddEqual]: ['__iadd__', OperatorType.Add],
        [OperatorType.SubtractEqual]: ['__isub__', OperatorType.Subtract],
        [OperatorType.MultiplyEqual]: ['__imul__', OperatorType.Multiply],
        [OperatorType.FloorDivideEqual]: ['__ifloordiv__', OperatorType.FloorDivide],
        [OperatorType.DivideEqual]: ['__itruediv__', OperatorType.Divide],
        [OperatorType.ModEqual]: ['__imod__', OperatorType.Mod],
        [OperatorType.PowerEqual]: ['__ipow__', OperatorType.Power],
        [OperatorType.MatrixMultiplyEqual]: ['__imatmul__', OperatorType.MatrixMultiply],
        [OperatorType.BitwiseAndEqual]: ['__iand__', OperatorType.BitwiseAnd],
        [OperatorType.BitwiseOrEqual]: ['__ior__', OperatorType.BitwiseOr],
        [OperatorType.BitwiseXorEqual]: ['__ixor__', OperatorType.BitwiseXor],
        [OperatorType.LeftShiftEqual]: ['__ilshift__', OperatorType.LeftShift],
        [OperatorType.RightShiftEqual]: ['__irshift__', OperatorType.RightShift],
    };

    let type: Type | undefined;
    let typeResult: TypeResult | undefined;
    const diag = new DiagnosticAddendum();

    const leftTypeResult = evaluator.getTypeOfExpression(node.leftExpression);
    const leftType = leftTypeResult.type;

    let expectedOperandType: Type | undefined;
    if (node.operator === OperatorType.BitwiseOrEqual) {
        // If this is a bitwise or ("|="), use the type of the left operand. This allows
        // us to support the case where a TypedDict is being updated with a dict expression.
        expectedOperandType = leftType;
    }

    const rightTypeResult = evaluator.getTypeOfExpression(
        node.rightExpression,
        /* flags */ undefined,
        makeInferenceContext(expectedOperandType)
    );
    const rightType = rightTypeResult.type;
    const isIncomplete = !!rightTypeResult.isIncomplete || !!leftTypeResult.isIncomplete;

    if (isNever(leftType) || isNever(rightType)) {
        typeResult = { type: NeverType.createNever(), isIncomplete };
    } else {
        type = evaluator.mapSubtypesExpandTypeVars(
            leftType,
            /* options */ undefined,
            (leftSubtypeExpanded, leftSubtypeUnexpanded) => {
                return evaluator.mapSubtypesExpandTypeVars(
                    rightType,
                    { conditionFilter: getTypeCondition(leftSubtypeExpanded) },
                    (rightSubtypeExpanded, rightSubtypeUnexpanded) => {
                        if (isAnyOrUnknown(leftSubtypeUnexpanded) || isAnyOrUnknown(rightSubtypeUnexpanded)) {
                            return preserveUnknown(leftSubtypeUnexpanded, rightSubtypeUnexpanded);
                        }

                        const magicMethodName = operatorMap[node.operator][0];
                        let returnType = evaluator.getTypeOfMagicMethodCall(
                            leftSubtypeUnexpanded,
                            magicMethodName,
                            [{ type: rightSubtypeUnexpanded, isIncomplete: rightTypeResult.isIncomplete }],
                            node,
                            inferenceContext
                        );

                        if (!returnType && leftSubtypeUnexpanded !== leftSubtypeExpanded) {
                            // Try with the expanded left type.
                            returnType = evaluator.getTypeOfMagicMethodCall(
                                leftSubtypeExpanded,
                                magicMethodName,
                                [{ type: rightSubtypeUnexpanded, isIncomplete: rightTypeResult.isIncomplete }],
                                node,
                                inferenceContext
                            );
                        }

                        if (!returnType && rightSubtypeUnexpanded !== rightSubtypeExpanded) {
                            // Try with the expanded left and right type.
                            returnType = evaluator.getTypeOfMagicMethodCall(
                                leftSubtypeExpanded,
                                magicMethodName,
                                [{ type: rightSubtypeExpanded, isIncomplete: rightTypeResult.isIncomplete }],
                                node,
                                inferenceContext
                            );
                        }

                        if (!returnType) {
                            // If the LHS class didn't support the magic method for augmented
                            // assignment, fall back on the normal binary expression evaluator.
                            const binaryOperator = operatorMap[node.operator][1];

                            // Don't use literal math if the operation is within a loop
                            // because the literal values may change each time.
                            const isLiteralMathAllowed =
                                !isWithinLoop(node) &&
                                isExpressionLocalVariable(evaluator, node.leftExpression) &&
                                getUnionSubtypeCount(leftType) * getUnionSubtypeCount(rightType) <
                                    maxLiteralMathSubtypeCount;

                            // Don't special-case tuple __add__ if the left type is a union. This
                            // can result in an infinite loop if we keep creating new tuple types
                            // within a loop construct using __add__.
                            const isTupleAddAllowed = !isUnion(leftType);

                            returnType = validateBinaryOperation(
                                evaluator,
                                binaryOperator,
                                { type: leftSubtypeUnexpanded, isIncomplete: leftTypeResult.isIncomplete },
                                { type: rightSubtypeUnexpanded, isIncomplete: rightTypeResult.isIncomplete },
                                node,
                                inferenceContext,
                                diag,
                                { isLiteralMathAllowed, isTupleAddAllowed }
                            );
                        }

                        return returnType;
                    }
                );
            }
        );

        // If the LHS class didn't support the magic method for augmented
        // assignment, fall back on the normal binary expression evaluator.
        if (!diag.isEmpty() || !type || isNever(type)) {
            if (!isIncomplete) {
                evaluator.addDiagnostic(
                    DiagnosticRule.reportOperatorIssue,
                    LocMessage.typeNotSupportBinaryOperator().format({
                        operator: printOperator(node.operator),
                        leftType: evaluator.printType(leftType),
                        rightType: evaluator.printType(rightType),
                    }) + diag.getString(),
                    node
                );
            }
        }

        typeResult = { type, isIncomplete };
    }

    evaluator.assignTypeToExpression(node.destExpression, typeResult, node.rightExpression);

    return typeResult;
}

export function getTypeOfUnaryOperation(
    evaluator: TypeEvaluator,
    node: UnaryOperationNode,
    flags: EvalFlags,
    inferenceContext: InferenceContext | undefined
): TypeResult {
    if ((flags & EvalFlags.TypeExpression) !== 0) {
        evaluator.addDiagnostic(DiagnosticRule.reportInvalidTypeForm, LocMessage.unaryOperationNotAllowed(), node);
        return { type: UnknownType.create() };
    }

    const exprTypeResult = evaluator.getTypeOfExpression(node.expression);
    let exprType = evaluator.makeTopLevelTypeVarsConcrete(transformPossibleRecursiveTypeAlias(exprTypeResult.type));

    const isIncomplete = exprTypeResult.isIncomplete;

    if (isNever(exprType)) {
        return { type: NeverType.createNever(), isIncomplete };
    }

    // Map unary operators to magic functions. Note that the bitwise
    // invert has two magic functions that are aliases of each other.
    const unaryOperatorMap: { [operator: number]: string } = {
        [OperatorType.Add]: '__pos__',
        [OperatorType.Subtract]: '__neg__',
        [OperatorType.BitwiseInvert]: '__invert__',
    };

    let type: Type | undefined;

    if (node.operator !== OperatorType.Not) {
        if (isOptionalType(exprType)) {
            evaluator.addDiagnostic(
                DiagnosticRule.reportOptionalOperand,
                LocMessage.noneOperator().format({
                    operator: printOperator(node.operator),
                }),
                node.expression
            );
            exprType = removeNoneFromUnion(exprType);
        }
    }

    // Handle certain operations on certain literal types
    // using special-case math. Do not apply this if the input type
    // is incomplete because we may be evaluating an expression within
    // a loop, so the literal value may change each time.
    if (!exprTypeResult.isIncomplete) {
        const literalClassName = getLiteralTypeClassName(exprType);
        if (literalClassName === 'int') {
            if (node.operator === OperatorType.Add) {
                type = exprType;
            } else if (node.operator === OperatorType.Subtract) {
                type = mapSubtypes(exprType, (subtype) => {
                    const classSubtype = subtype as ClassType;
                    return ClassType.cloneWithLiteral(classSubtype, -(classSubtype.literalValue as number | bigint));
                });
            }
        } else if (literalClassName === 'bool') {
            if (node.operator === OperatorType.Not) {
                type = mapSubtypes(exprType, (subtype) => {
                    const classSubtype = subtype as ClassType;
                    return ClassType.cloneWithLiteral(classSubtype, !(classSubtype.literalValue as boolean));
                });
            }
        }
    }

    if (!type) {
        // __not__ always returns a boolean.
        if (node.operator === OperatorType.Not) {
            type = evaluator.getBuiltInObject(node, 'bool');
            if (!type) {
                type = UnknownType.create();
            }
        } else {
            if (isAnyOrUnknown(exprType)) {
                type = exprType;
            } else {
                const magicMethodName = unaryOperatorMap[node.operator];
                let isResultValid = true;

                type = evaluator.mapSubtypesExpandTypeVars(exprType, /* options */ undefined, (subtypeExpanded) => {
                    const result = evaluator.getTypeOfMagicMethodCall(
                        subtypeExpanded,
                        magicMethodName,
                        [],
                        node,
                        inferenceContext
                    );

                    if (!result) {
                        isResultValid = false;
                    }

                    return result;
                });

                if (!isResultValid) {
                    type = undefined;
                }
            }

            if (!type) {
                if (!isIncomplete) {
                    if (inferenceContext) {
                        evaluator.addDiagnostic(
                            DiagnosticRule.reportOperatorIssue,
                            LocMessage.typeNotSupportUnaryOperatorBidirectional().format({
                                operator: printOperator(node.operator),
                                type: evaluator.printType(exprType),
                                expectedType: evaluator.printType(inferenceContext.expectedType),
                            }),
                            node
                        );
                    } else {
                        evaluator.addDiagnostic(
                            DiagnosticRule.reportOperatorIssue,
                            LocMessage.typeNotSupportUnaryOperator().format({
                                operator: printOperator(node.operator),
                                type: evaluator.printType(exprType),
                            }),
                            node
                        );
                    }
                }

                type = UnknownType.create(isIncomplete);
            }
        }
    }

    return { type, isIncomplete };
}

export function getTypeOfTernaryOperation(
    evaluator: TypeEvaluator,
    node: TernaryNode,
    flags: EvalFlags,
    inferenceContext: InferenceContext | undefined
): TypeResult {
    const fileInfo = getFileInfo(node);

    if ((flags & EvalFlags.TypeExpression) !== 0) {
        evaluator.addDiagnostic(DiagnosticRule.reportInvalidTypeForm, LocMessage.ternaryNotAllowed(), node);
        return { type: UnknownType.create() };
    }

    evaluator.getTypeOfExpression(node.testExpression);

    const typesToCombine: Type[] = [];
    let isIncomplete = false;
    let typeErrors = false;

    const constExprValue = evaluateStaticBoolExpression(
        node.testExpression,
        fileInfo.executionEnvironment,
        fileInfo.definedConstants
    );

    if (constExprValue !== false && evaluator.isNodeReachable(node.ifExpression)) {
        const ifType = evaluator.getTypeOfExpression(node.ifExpression, flags, inferenceContext);
        typesToCombine.push(ifType.type);
        if (ifType.isIncomplete) {
            isIncomplete = true;
        }
        if (ifType.typeErrors) {
            typeErrors = true;
        }
    }

    if (constExprValue !== true && evaluator.isNodeReachable(node.elseExpression)) {
        const elseType = evaluator.getTypeOfExpression(node.elseExpression, flags, inferenceContext);
        typesToCombine.push(elseType.type);
        if (elseType.isIncomplete) {
            isIncomplete = true;
        }
        if (elseType.typeErrors) {
            typeErrors = true;
        }
    }

    return { type: combineTypes(typesToCombine), isIncomplete, typeErrors };
}

function customMetaclassSupportsMethod(type: Type, methodName: string): boolean {
    if (!isInstantiableClass(type)) {
        return false;
    }

    const metaclass = type.details.effectiveMetaclass;
    if (!metaclass || !isInstantiableClass(metaclass)) {
        return false;
    }

    if (ClassType.isBuiltIn(metaclass, 'type')) {
        return false;
    }

    const memberInfo = lookUpClassMember(metaclass, methodName);
    if (!memberInfo) {
        return false;
    }

    // If the metaclass inherits from Any or Unknown, we have to guess
    // whether the method is supported. We'll assume it's not, since this
    // is the most likely case.
    if (isAnyOrUnknown(memberInfo.classType)) {
        return false;
    }

    if (isInstantiableClass(memberInfo.classType) && ClassType.isBuiltIn(memberInfo.classType, 'type')) {
        return false;
    }

    return true;
}

// All functions in Python derive from object, so they inherit all
// of the capabilities of an object. This function converts a function
// to an object instance.
function convertFunctionToObject(evaluator: TypeEvaluator, type: Type) {
    if (isFunction(type) || isOverloadedFunction(type)) {
        return evaluator.getObjectType();
    }

    return type;
}

// Determines whether the expression refers to a variable that
// is defined within the current scope or some outer scope.
function isExpressionLocalVariable(evaluator: TypeEvaluator, node: ExpressionNode): boolean {
    if (node.nodeType !== ParseNodeType.Name) {
        return false;
    }

    const symbolWithScope = evaluator.lookUpSymbolRecursive(node, node.value, /* honorCodeFlow */ false);
    if (!symbolWithScope) {
        return false;
    }

    const currentScope = getScopeForNode(node);
    return currentScope === symbolWithScope.scope;
}
