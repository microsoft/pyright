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
import { PythonVersion, pythonVersion3_10 } from '../common/pythonVersion';
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
import { EvalFlags, MagicMethodDeprecationInfo, TypeEvaluator, TypeResult } from './typeEvaluatorTypes';
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
    specializeWithDefaultTypeArgs,
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
    isFunctionOrOverloaded,
    isInstantiableClass,
    isNever,
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
): TypeResult {
    const leftType = leftTypeResult.type;
    const rightType = rightTypeResult.type;
    const isIncomplete = !!leftTypeResult.isIncomplete || !!rightTypeResult.isIncomplete;
    let type: Type | undefined;
    let concreteLeftType = evaluator.makeTopLevelTypeVarsConcrete(leftType);
    let deprecatedInfo: MagicMethodDeprecationInfo | undefined;

    if (booleanOperatorMap[operator] !== undefined) {
        // If it's an AND or OR, we need to handle short-circuiting by
        // eliminating any known-truthy or known-falsy types.
        if (operator === OperatorType.And) {
            // If the LHS evaluates to falsy, the And expression will
            // always return the type of the left-hand side.
            if (!evaluator.canBeTruthy(concreteLeftType)) {
                return { type: leftType };
            }

            // If the LHS evaluates to truthy, the And expression will
            // always return the type of the right-hand side.
            if (!evaluator.canBeFalsy(concreteLeftType)) {
                return { type: rightType };
            }

            concreteLeftType = evaluator.removeTruthinessFromType(concreteLeftType);

            if (isNever(rightType)) {
                return { type: concreteLeftType };
            }
        } else if (operator === OperatorType.Or) {
            // If the LHS evaluates to truthy, the Or expression will
            // always return the type of the left-hand side.
            if (!evaluator.canBeFalsy(concreteLeftType)) {
                return { type: leftType };
            }

            // If the LHS evaluates to falsy, the Or expression will
            // always return the type of the right-hand side.
            if (!evaluator.canBeTruthy(concreteLeftType)) {
                return { type: rightType };
            }

            concreteLeftType = evaluator.removeFalsinessFromType(concreteLeftType);

            if (isNever(rightType)) {
                return { type: concreteLeftType };
            }
        }

        if (isNever(leftType) || isNever(rightType)) {
            return { type: NeverType.createNever() };
        }

        // The "in" and "not in" operators make use of the __contains__
        // magic method.
        if (operator === OperatorType.In || operator === OperatorType.NotIn) {
            const result = validateContainmentOperation(
                evaluator,
                operator,
                leftTypeResult,
                concreteLeftType,
                rightTypeResult,
                errorNode,
                diag
            );

            if (result.magicMethodDeprecationInfo) {
                deprecatedInfo = result.magicMethodDeprecationInfo;
            }

            type = result.type;

            // Assume that a bool is returned even if the type is unknown.
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
            return { type: NeverType.createNever() };
        }

        // Handle certain operations on certain homogenous literal types
        // using special-case math. For example, Literal[1, 2] + Literal[3, 4]
        // should result in Literal[4, 5, 6].
        if (options.isLiteralMathAllowed) {
            type = calcLiteralForBinaryOp(operator, leftType, rightType);
        }

        if (!type) {
            const result = validateArithmeticOperation(
                evaluator,
                operator,
                leftTypeResult,
                rightTypeResult,
                errorNode,
                inferenceContext,
                diag,
                options
            );

            if (result.magicMethodDeprecationInfo) {
                deprecatedInfo = result.magicMethodDeprecationInfo;
            }

            type = result.type;
        }
    }

    return { type: type ?? UnknownType.create(isIncomplete), magicMethodDeprecationInfo: deprecatedInfo };
}

export function getTypeOfBinaryOperation(
    evaluator: TypeEvaluator,
    node: BinaryOperationNode,
    flags: EvalFlags,
    inferenceContext: InferenceContext | undefined
): TypeResult {
    const leftExpression = node.d.leftExpr;
    let rightExpression = node.d.rightExpr;
    let isIncomplete = false;
    let typeErrors = false;

    // If this is a comparison and the left expression is also a comparison,
    // we need to change the behavior to accommodate python's "chained
    // comparisons" feature.
    if (operatorSupportsChaining(node.d.operator)) {
        if (
            rightExpression.nodeType === ParseNodeType.BinaryOperation &&
            !rightExpression.d.hasParens &&
            operatorSupportsChaining(rightExpression.d.operator)
        ) {
            // Evaluate the right expression so it is type checked.
            getTypeOfBinaryOperation(evaluator, rightExpression, flags, inferenceContext);

            // Use the left side of the right expression for comparison purposes.
            rightExpression = rightExpression.d.leftExpr;
        }
    }

    // For most binary operations, the "expected type" is applied to the output
    // of the magic method for that operation. However, the "or" and "and" operators
    // have no magic method, so we apply the expected type directly to both operands.
    let expectedOperandType =
        node.d.operator === OperatorType.Or || node.d.operator === OperatorType.And
            ? inferenceContext?.expectedType
            : undefined;

    // Handle the very special case where the expected type is a list
    // and the operator is a multiply. This comes up in the common case
    // of "x: List[Optional[X]] = [None] * y" where y is an integer literal.
    let expectedLeftOperandType: Type | undefined;
    if (
        node.d.operator === OperatorType.Multiply &&
        inferenceContext &&
        isClassInstance(inferenceContext.expectedType) &&
        ClassType.isBuiltIn(inferenceContext.expectedType, 'list') &&
        inferenceContext.expectedType.priv.typeArgs &&
        inferenceContext.expectedType.priv.typeArgs.length >= 1 &&
        node.d.leftExpr.nodeType === ParseNodeType.List
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
        if (node.d.operator === OperatorType.Or || node.d.operator === OperatorType.And) {
            // For "or" and "and", use the type of the left operand under certain
            // circumstances. This allows us to infer a better type for expressions
            // like `x or []`. Do this only if it's a generic class (like list or dict)
            // or a TypedDict.
            if (
                someSubtypes(leftType, (subtype) => {
                    if (!isClassInstance(subtype)) {
                        return false;
                    }

                    return ClassType.isTypedDictClass(subtype) || subtype.shared.typeParams.length > 0;
                })
            ) {
                expectedOperandType = leftType;
            }
        } else if (node.d.operator === OperatorType.Add && node.d.rightExpr.nodeType === ParseNodeType.List) {
            // For the "+" operator , use this technique only if the right operand is
            // a list expression. This heuristic handles the common case of `my_list + [0]`.
            expectedOperandType = leftType;
        } else if (node.d.operator === OperatorType.BitwiseOr) {
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
        node.d.operator === OperatorType.BitwiseOr &&
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
            if (isInstantiableClass(adjustedLeftType)) {
                adjustedLeftType = specializeWithDefaultTypeArgs(adjustedLeftType);
            }

            if (isInstantiableClass(adjustedRightType)) {
                adjustedRightType = specializeWithDefaultTypeArgs(adjustedRightType);
            }

            return createUnionType(
                evaluator,
                node,
                flags,
                leftTypeResult,
                rightTypeResult,
                adjustedRightType,
                adjustedLeftType
            );
        }
    }

    if ((flags & EvalFlags.TypeExpression) !== 0) {
        // Exempt "|" because it might be a union operation involving unknowns.
        if (node.d.operator !== OperatorType.BitwiseOr) {
            evaluator.addDiagnostic(DiagnosticRule.reportInvalidTypeForm, LocMessage.binaryOperationNotAllowed(), node);
            return { type: UnknownType.create() };
        }
    }

    // Optional checks apply to all operations except for boolean operations.
    let isLeftOptionalType = false;
    if (booleanOperatorMap[node.d.operator] === undefined) {
        // None is a valid operand for == and != even if the type stub says otherwise.
        if (node.d.operator === OperatorType.Equals || node.d.operator === OperatorType.NotEquals) {
            leftType = removeNoneFromUnion(leftType);
        } else {
            isLeftOptionalType = isOptionalType(leftType);
        }

        // None is a valid operand for == and != even if the type stub says otherwise.
        if (node.d.operator === OperatorType.Equals || node.d.operator === OperatorType.NotEquals) {
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

    const typeResult = validateBinaryOperation(
        evaluator,
        node.d.operator,
        { type: leftType, isIncomplete: leftTypeResult.isIncomplete },
        { type: rightType, isIncomplete: rightTypeResult.isIncomplete },
        node,
        inferenceContext,
        diag,
        { isLiteralMathAllowed, isTupleAddAllowed }
    );

    if (typeResult.isIncomplete) {
        isIncomplete = true;
    }

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
                        operator: printOperator(node.d.operator),
                    }),
                    node.d.leftExpr
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
                        operator: printOperator(node.d.operator),
                        leftType: evaluator.printType(leftType),
                        rightType: evaluator.printType(rightType),
                    }) + diagString,
                    node
                );
            }
        }
    }

    return {
        type: typeResult.type,
        isIncomplete,
        typeErrors,
        magicMethodDeprecationInfo: typeResult.magicMethodDeprecationInfo,
    };
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
    let deprecatedInfo: MagicMethodDeprecationInfo | undefined;

    const leftTypeResult = evaluator.getTypeOfExpression(node.d.leftExpr);
    const leftType = leftTypeResult.type;

    let expectedOperandType: Type | undefined;
    if (node.d.operator === OperatorType.BitwiseOrEqual) {
        // If this is a bitwise or ("|="), use the type of the left operand. This allows
        // us to support the case where a TypedDict is being updated with a dict expression.
        expectedOperandType = leftType;
    }

    const rightTypeResult = evaluator.getTypeOfExpression(
        node.d.rightExpr,
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

                        const magicMethodName = operatorMap[node.d.operator][0];
                        let returnTypeResult = evaluator.getTypeOfMagicMethodCall(
                            leftSubtypeUnexpanded,
                            magicMethodName,
                            [{ type: rightSubtypeUnexpanded, isIncomplete: rightTypeResult.isIncomplete }],
                            node,
                            inferenceContext
                        );

                        if (!returnTypeResult && leftSubtypeUnexpanded !== leftSubtypeExpanded) {
                            // Try with the expanded left type.
                            returnTypeResult = evaluator.getTypeOfMagicMethodCall(
                                leftSubtypeExpanded,
                                magicMethodName,
                                [{ type: rightSubtypeUnexpanded, isIncomplete: rightTypeResult.isIncomplete }],
                                node,
                                inferenceContext
                            );
                        }

                        if (!returnTypeResult && rightSubtypeUnexpanded !== rightSubtypeExpanded) {
                            // Try with the expanded left and right type.
                            returnTypeResult = evaluator.getTypeOfMagicMethodCall(
                                leftSubtypeExpanded,
                                magicMethodName,
                                [{ type: rightSubtypeExpanded, isIncomplete: rightTypeResult.isIncomplete }],
                                node,
                                inferenceContext
                            );
                        }

                        if (!returnTypeResult) {
                            // If the LHS class didn't support the magic method for augmented
                            // assignment, fall back on the normal binary expression evaluator.
                            const binaryOperator = operatorMap[node.d.operator][1];

                            // Don't use literal math if the operation is within a loop
                            // because the literal values may change each time.
                            const isLiteralMathAllowed =
                                !isWithinLoop(node) &&
                                isExpressionLocalVariable(evaluator, node.d.leftExpr) &&
                                getUnionSubtypeCount(leftType) * getUnionSubtypeCount(rightType) <
                                    maxLiteralMathSubtypeCount;

                            // Don't special-case tuple __add__ if the left type is a union. This
                            // can result in an infinite loop if we keep creating new tuple types
                            // within a loop construct using __add__.
                            const isTupleAddAllowed = !isUnion(leftType);

                            returnTypeResult = validateBinaryOperation(
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

                        if (returnTypeResult?.magicMethodDeprecationInfo) {
                            deprecatedInfo = returnTypeResult.magicMethodDeprecationInfo;
                        }

                        return returnTypeResult?.type;
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
                        operator: printOperator(node.d.operator),
                        leftType: evaluator.printType(leftType),
                        rightType: evaluator.printType(rightType),
                    }) + diag.getString(),
                    node
                );
            }
        }

        typeResult = { type, isIncomplete, magicMethodDeprecationInfo: deprecatedInfo };
    }

    evaluator.assignTypeToExpression(node.d.destExpr, typeResult, node.d.rightExpr);

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

    const exprTypeResult = evaluator.getTypeOfExpression(node.d.expr);
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
        [OperatorType.Not]: '__bool__',
    };

    let type: Type | undefined;
    let deprecatedInfo: MagicMethodDeprecationInfo | undefined;

    if (node.d.operator !== OperatorType.Not) {
        if (isOptionalType(exprType)) {
            evaluator.addDiagnostic(
                DiagnosticRule.reportOptionalOperand,
                LocMessage.noneOperator().format({
                    operator: printOperator(node.d.operator),
                }),
                node.d.expr
            );
            exprType = removeNoneFromUnion(exprType);
        }
    }

    // Handle certain operations on certain literal types
    // using special-case math. Do not apply this if the input type
    // is incomplete because we may be evaluating an expression within
    // a loop, so the literal value may change each time.
    if (!exprTypeResult.isIncomplete) {
        type = calcLiteralForUnaryOp(node.d.operator, exprType);
    }

    if (!type) {
        if (isAnyOrUnknown(exprType)) {
            type = exprType;
        } else {
            const magicMethodName = unaryOperatorMap[node.d.operator];
            let isResultValid = true;

            type = evaluator.mapSubtypesExpandTypeVars(exprType, /* options */ undefined, (subtypeExpanded) => {
                const typeResult = evaluator.getTypeOfMagicMethodCall(
                    subtypeExpanded,
                    magicMethodName,
                    [],
                    node,
                    inferenceContext
                );

                if (!typeResult) {
                    isResultValid = false;
                }

                if (typeResult?.magicMethodDeprecationInfo) {
                    deprecatedInfo = typeResult.magicMethodDeprecationInfo;
                }

                return typeResult?.type;
            });

            if (!isResultValid) {
                type = undefined;
            }
        }

        // __not__ always returns a boolean.
        if (node.d.operator === OperatorType.Not) {
            type = evaluator.getBuiltInObject(node, 'bool');
            if (!type) {
                type = UnknownType.create();
            }
        }

        if (!type) {
            if (!isIncomplete) {
                if (inferenceContext && !isAnyOrUnknown(inferenceContext.expectedType)) {
                    evaluator.addDiagnostic(
                        DiagnosticRule.reportOperatorIssue,
                        LocMessage.typeNotSupportUnaryOperatorBidirectional().format({
                            operator: printOperator(node.d.operator),
                            type: evaluator.printType(exprType),
                            expectedType: evaluator.printType(inferenceContext.expectedType),
                        }),
                        node
                    );
                } else {
                    evaluator.addDiagnostic(
                        DiagnosticRule.reportOperatorIssue,
                        LocMessage.typeNotSupportUnaryOperator().format({
                            operator: printOperator(node.d.operator),
                            type: evaluator.printType(exprType),
                        }),
                        node
                    );
                }
            }

            type = UnknownType.create(isIncomplete);
        }
    }

    return { type, isIncomplete, magicMethodDeprecationInfo: deprecatedInfo };
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

    evaluator.getTypeOfExpression(node.d.testExpr);

    const typesToCombine: Type[] = [];
    let isIncomplete = false;
    let typeErrors = false;

    const constExprValue = evaluateStaticBoolExpression(
        node.d.testExpr,
        fileInfo.executionEnvironment,
        fileInfo.definedConstants
    );

    if (constExprValue !== false && evaluator.isNodeReachable(node.d.ifExpr)) {
        const ifType = evaluator.getTypeOfExpression(node.d.ifExpr, flags, inferenceContext);
        typesToCombine.push(ifType.type);
        if (ifType.isIncomplete) {
            isIncomplete = true;
        }
        if (ifType.typeErrors) {
            typeErrors = true;
        }
    }

    if (constExprValue !== true && evaluator.isNodeReachable(node.d.elseExpr)) {
        const elseType = evaluator.getTypeOfExpression(node.d.elseExpr, flags, inferenceContext);
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

function createUnionType(
    evaluator: TypeEvaluator,
    node: BinaryOperationNode,
    flags: EvalFlags,
    leftTypeResult: TypeResult,
    rightTypeResult: TypeResult,
    adjustedRightType: Type,
    adjustedLeftType: Type
): TypeResult {
    const leftExpression = node.d.leftExpr;
    const rightExpression = node.d.rightExpr;
    const fileInfo = getFileInfo(node);
    const unionNotationSupported =
        fileInfo.isStubFile ||
        (flags & EvalFlags.ForwardRefs) !== 0 ||
        PythonVersion.isGreaterOrEqualTo(fileInfo.executionEnvironment.pythonVersion, pythonVersion3_10);

    if (!unionNotationSupported) {
        // If the left type is Any, we can't say for sure whether this
        // is an illegal syntax or a valid application of the "|" operator.
        if (!isAnyOrUnknown(adjustedLeftType)) {
            evaluator.addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.unionSyntaxIllegal(),
                node,
                node.d.operatorToken
            );
        }
    }

    const isLeftTypeArgValid = evaluator.validateTypeArg({ ...leftTypeResult, node: leftExpression });
    const isRightTypeArgValid = evaluator.validateTypeArg({ ...rightTypeResult, node: rightExpression });

    if (!isLeftTypeArgValid || !isRightTypeArgValid) {
        return { type: UnknownType.create() };
    }

    adjustedLeftType = evaluator.reportMissingTypeArgs(
        node.d.leftExpr,
        adjustedLeftType,
        flags | EvalFlags.InstantiableType
    );
    adjustedRightType = evaluator.reportMissingTypeArgs(
        node.d.rightExpr,
        adjustedRightType,
        flags | EvalFlags.InstantiableType
    );

    let newUnion = combineTypes([adjustedLeftType, adjustedRightType], { skipElideRedundantLiterals: true });

    const unionClass = evaluator.getUnionClassType();
    if (unionClass && isInstantiableClass(unionClass) && (flags & EvalFlags.IsinstanceArg) === 0) {
        newUnion = TypeBase.cloneAsSpecialForm(newUnion, ClassType.cloneAsInstance(unionClass));
    }

    if (leftTypeResult.type.props?.typeForm && rightTypeResult.type.props?.typeForm) {
        const newTypeForm = combineTypes([leftTypeResult.type.props.typeForm, rightTypeResult.type.props.typeForm]);
        newUnion = TypeBase.cloneWithTypeForm(newUnion, newTypeForm);
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
            otherType = rightTypeResult.type;
        } else if (rightExpression.nodeType === ParseNodeType.StringList) {
            stringNode = rightExpression;
            otherNode = leftExpression;
            otherType = leftTypeResult.type;
        }

        if (stringNode && otherNode && otherType) {
            let isAllowed = true;
            if (isClass(otherType)) {
                if (!otherType.priv.isTypeArgExplicit || isClassInstance(otherType)) {
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

// Attempts to apply "literal math" for a literal operands.
function calcLiteralForUnaryOp(operator: OperatorType, operandType: Type): Type | undefined {
    let type: Type | undefined;

    if (getUnionSubtypeCount(operandType) >= maxLiteralMathSubtypeCount) {
        return undefined;
    }

    if (!!getTypeCondition(operandType) || someSubtypes(operandType, (subtype) => !!getTypeCondition(subtype))) {
        return undefined;
    }

    const literalClassName = getLiteralTypeClassName(operandType);

    if (literalClassName === 'int') {
        if (operator === OperatorType.Add) {
            type = operandType;
        } else if (operator === OperatorType.Subtract) {
            type = mapSubtypes(operandType, (subtype) => {
                const classSubtype = subtype as ClassType;
                return ClassType.cloneWithLiteral(classSubtype, -(classSubtype.priv.literalValue as number | bigint));
            });
        } else if (operator === OperatorType.BitwiseInvert) {
            type = mapSubtypes(operandType, (subtype) => {
                const classSubtype = subtype as ClassType;
                return ClassType.cloneWithLiteral(classSubtype, ~(classSubtype.priv.literalValue as number | bigint));
            });
        }
    } else if (literalClassName === 'bool') {
        if (operator === OperatorType.Not) {
            type = mapSubtypes(operandType, (subtype) => {
                const classSubtype = subtype as ClassType;
                return ClassType.cloneWithLiteral(classSubtype, !(classSubtype.priv.literalValue as boolean));
            });
        }
    }

    return type;
}

// Attempts to apply "literal math" for two literal operands.
function calcLiteralForBinaryOp(operator: OperatorType, leftType: Type, rightType: Type): Type | undefined {
    const leftLiteralClassName = getLiteralTypeClassName(leftType);
    if (
        !leftLiteralClassName ||
        getTypeCondition(leftType) ||
        someSubtypes(leftType, (subtype) => !!getTypeCondition(subtype))
    ) {
        return undefined;
    }

    const rightLiteralClassName = getLiteralTypeClassName(rightType);
    if (
        leftLiteralClassName !== rightLiteralClassName ||
        getTypeCondition(rightType) ||
        someSubtypes(rightType, (subtype) => !!getTypeCondition(subtype)) ||
        getUnionSubtypeCount(leftType) * getUnionSubtypeCount(rightType) >= maxLiteralMathSubtypeCount
    ) {
        return undefined;
    }

    // Handle str and bytes literals.
    if (leftLiteralClassName === 'str' || leftLiteralClassName === 'bytes') {
        if (operator === OperatorType.Add) {
            return mapSubtypes(leftType, (leftSubtype) => {
                return mapSubtypes(rightType, (rightSubtype) => {
                    const leftClassSubtype = leftSubtype as ClassType;
                    const rightClassSubtype = rightSubtype as ClassType;

                    return ClassType.cloneWithLiteral(
                        leftClassSubtype,
                        ((leftClassSubtype.priv.literalValue as string) + rightClassSubtype.priv.literalValue) as string
                    );
                });
            });
        }
    }

    // Handle int literals.
    if (leftLiteralClassName === 'int') {
        const supportedOps = [
            OperatorType.Add,
            OperatorType.Subtract,
            OperatorType.Multiply,
            OperatorType.FloorDivide,
            OperatorType.Mod,
            OperatorType.Power,
            OperatorType.LeftShift,
            OperatorType.RightShift,
            OperatorType.BitwiseAnd,
            OperatorType.BitwiseOr,
            OperatorType.BitwiseXor,
        ];
        if (!supportedOps.includes(operator)) {
            return undefined;
        }

        let isValidResult = true;

        const type = mapSubtypes(leftType, (leftSubtype) => {
            return mapSubtypes(rightType, (rightSubtype) => {
                try {
                    const leftClassSubtype = leftSubtype as ClassType;
                    const rightClassSubtype = rightSubtype as ClassType;
                    const leftLiteralValue = BigInt(leftClassSubtype.priv.literalValue as number | bigint);
                    const rightLiteralValue = BigInt(rightClassSubtype.priv.literalValue as number | bigint);

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

                            // BigInt rounds to zero, but floor divide rounds to negative
                            // infinity, so we need to adjust the result if the signs
                            // of the operands are different.
                            if (
                                newValue * rightLiteralValue !== leftLiteralValue &&
                                leftLiteralValue < BigInt(0) !== rightLiteralValue < BigInt(0)
                            ) {
                                newValue -= BigInt(1);
                            }
                        }
                    } else if (operator === OperatorType.Mod) {
                        if (rightLiteralValue !== BigInt(0)) {
                            // BigInt always produces a remainder, but Python produces
                            // a modulo result whose sign is always the same as the
                            // right operand.
                            newValue = ((leftLiteralValue % rightLiteralValue) + rightLiteralValue) % rightLiteralValue;
                        }
                    } else if (operator === OperatorType.Power) {
                        if (rightLiteralValue >= BigInt(0)) {
                            try {
                                newValue = leftLiteralValue ** rightLiteralValue;
                            } catch {
                                // Don't allow if we exceed max bigint integer value.
                            }
                        }
                    } else if (operator === OperatorType.LeftShift) {
                        if (rightLiteralValue >= BigInt(0)) {
                            newValue = leftLiteralValue << rightLiteralValue;
                        }
                    } else if (operator === OperatorType.RightShift) {
                        if (rightLiteralValue >= BigInt(0)) {
                            newValue = leftLiteralValue >> rightLiteralValue;
                        }
                    } else if (operator === OperatorType.BitwiseAnd) {
                        newValue = leftLiteralValue & rightLiteralValue;
                    } else if (operator === OperatorType.BitwiseOr) {
                        newValue = leftLiteralValue | rightLiteralValue;
                    } else if (operator === OperatorType.BitwiseXor) {
                        newValue = leftLiteralValue ^ rightLiteralValue;
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
                        if (newValue >= Number.MIN_SAFE_INTEGER && newValue <= Number.MAX_SAFE_INTEGER) {
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

        if (isValidResult) {
            return type;
        }
    }

    return undefined;
}

function customMetaclassSupportsMethod(type: Type, methodName: string): boolean {
    if (!isInstantiableClass(type)) {
        return false;
    }

    const metaclass = type.shared.effectiveMetaclass;
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
    if (isFunctionOrOverloaded(type)) {
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

    const symbolWithScope = evaluator.lookUpSymbolRecursive(node, node.d.value, /* honorCodeFlow */ false);
    if (!symbolWithScope) {
        return false;
    }

    const currentScope = getScopeForNode(node);
    return currentScope === symbolWithScope.scope;
}

function validateContainmentOperation(
    evaluator: TypeEvaluator,
    operator: OperatorType,
    leftTypeResult: TypeResult,
    concreteLeftType: Type,
    rightTypeResult: TypeResult,
    errorNode: ExpressionNode,
    diag: DiagnosticAddendum
): TypeResult {
    let deprecatedInfo: MagicMethodDeprecationInfo | undefined;

    const type = evaluator.mapSubtypesExpandTypeVars(
        rightTypeResult.type,
        /* options */ undefined,
        (rightSubtypeExpanded, rightSubtypeUnexpanded) => {
            return evaluator.mapSubtypesExpandTypeVars(
                concreteLeftType,
                { conditionFilter: getTypeCondition(rightSubtypeExpanded) },
                (leftSubtype) => {
                    if (isAnyOrUnknown(leftSubtype) || isAnyOrUnknown(rightSubtypeUnexpanded)) {
                        return preserveUnknown(leftSubtype, rightSubtypeExpanded);
                    }

                    let returnTypeResult = evaluator.getTypeOfMagicMethodCall(
                        rightSubtypeExpanded,
                        '__contains__',
                        [{ type: leftSubtype, isIncomplete: leftTypeResult.isIncomplete }],
                        errorNode,
                        /* inferenceContext */ undefined
                    );

                    if (!returnTypeResult) {
                        // If __contains__ was not supported, fall back
                        // on an iterable.
                        const iteratorType = evaluator.getTypeOfIterator(
                            { type: rightSubtypeExpanded, isIncomplete: rightTypeResult.isIncomplete },
                            /* isAsync */ false,
                            errorNode,
                            /* emitNotIterableError */ false
                        )?.type;

                        if (iteratorType && evaluator.assignType(iteratorType, leftSubtype)) {
                            returnTypeResult = { type: evaluator.getBuiltInObject(errorNode, 'bool') };
                        }
                    }

                    if (!returnTypeResult) {
                        diag.addMessage(
                            LocMessage.typeNotSupportBinaryOperator().format({
                                operator: printOperator(operator),
                                leftType: evaluator.printType(leftSubtype),
                                rightType: evaluator.printType(rightSubtypeExpanded),
                            })
                        );
                    }

                    if (returnTypeResult?.magicMethodDeprecationInfo) {
                        deprecatedInfo = returnTypeResult.magicMethodDeprecationInfo;
                    }

                    return returnTypeResult?.type ?? evaluator.getBuiltInObject(errorNode, 'bool');
                }
            );
        }
    );

    return { type, magicMethodDeprecationInfo: deprecatedInfo };
}

function validateArithmeticOperation(
    evaluator: TypeEvaluator,
    operator: OperatorType,
    leftTypeResult: TypeResult,
    rightTypeResult: TypeResult,
    errorNode: ExpressionNode,
    inferenceContext: InferenceContext | undefined,
    diag: DiagnosticAddendum,
    options: BinaryOperationOptions
): TypeResult {
    let deprecatedInfo: MagicMethodDeprecationInfo | undefined;
    const isIncomplete = !!leftTypeResult.isIncomplete || !!rightTypeResult.isIncomplete;

    const type = evaluator.mapSubtypesExpandTypeVars(
        leftTypeResult.type,
        /* options */ undefined,
        (leftSubtypeExpanded, leftSubtypeUnexpanded) => {
            return evaluator.mapSubtypesExpandTypeVars(
                rightTypeResult.type,
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
                        leftSubtypeExpanded.priv.tupleTypeArgs &&
                        isClassInstance(rightSubtypeExpanded) &&
                        isTupleClass(rightSubtypeExpanded) &&
                        rightSubtypeExpanded.priv.tupleTypeArgs &&
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
                                    ...leftSubtypeExpanded.priv.tupleTypeArgs,
                                    ...rightSubtypeExpanded.priv.tupleTypeArgs,
                                ])
                            );
                        }
                    }

                    const magicMethodName = binaryOperatorMap[operator][0];
                    let resultTypeResult = evaluator.getTypeOfMagicMethodCall(
                        convertFunctionToObject(evaluator, leftSubtypeUnexpanded),
                        magicMethodName,
                        [{ type: rightSubtypeUnexpanded, isIncomplete: rightTypeResult.isIncomplete }],
                        errorNode,
                        inferenceContext
                    );

                    if (!resultTypeResult && leftSubtypeUnexpanded !== leftSubtypeExpanded) {
                        // Try the expanded left type.
                        resultTypeResult = evaluator.getTypeOfMagicMethodCall(
                            convertFunctionToObject(evaluator, leftSubtypeExpanded),
                            magicMethodName,
                            [{ type: rightSubtypeUnexpanded, isIncomplete: rightTypeResult.isIncomplete }],
                            errorNode,
                            inferenceContext
                        );
                    }

                    if (!resultTypeResult && rightSubtypeUnexpanded !== rightSubtypeExpanded) {
                        // Try the expanded left and right type.
                        resultTypeResult = evaluator.getTypeOfMagicMethodCall(
                            convertFunctionToObject(evaluator, leftSubtypeExpanded),
                            magicMethodName,
                            [{ type: rightSubtypeExpanded, isIncomplete: rightTypeResult.isIncomplete }],
                            errorNode,
                            inferenceContext
                        );
                    }

                    if (!resultTypeResult) {
                        // Try the alternate form (swapping right and left).
                        const altMagicMethodName = binaryOperatorMap[operator][1];
                        resultTypeResult = evaluator.getTypeOfMagicMethodCall(
                            convertFunctionToObject(evaluator, rightSubtypeUnexpanded),
                            altMagicMethodName,
                            [{ type: leftSubtypeUnexpanded, isIncomplete: leftTypeResult.isIncomplete }],
                            errorNode,
                            inferenceContext
                        );

                        if (!resultTypeResult && rightSubtypeUnexpanded !== rightSubtypeExpanded) {
                            // Try the expanded right type.
                            resultTypeResult = evaluator.getTypeOfMagicMethodCall(
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

                        if (!resultTypeResult && leftSubtypeUnexpanded !== leftSubtypeExpanded) {
                            // Try the expanded right and left type.
                            resultTypeResult = evaluator.getTypeOfMagicMethodCall(
                                convertFunctionToObject(evaluator, rightSubtypeExpanded),
                                altMagicMethodName,
                                [{ type: leftSubtypeExpanded, isIncomplete: leftTypeResult.isIncomplete }],
                                errorNode,
                                inferenceContext
                            );
                        }
                    }

                    if (!resultTypeResult) {
                        if (inferenceContext && !isAnyOrUnknown(inferenceContext.expectedType)) {
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

                    if (resultTypeResult?.magicMethodDeprecationInfo) {
                        deprecatedInfo = resultTypeResult.magicMethodDeprecationInfo;
                    }

                    return resultTypeResult?.type ?? UnknownType.create(isIncomplete);
                }
            );
        }
    );

    return { type, magicMethodDeprecationInfo: deprecatedInfo };
}
