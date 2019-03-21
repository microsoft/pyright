/*
* expressionUtils.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Collection of static methods that operate on expressions
* (parse node trees).
*/

import { ExecutionEnvironment } from '../common/configOptions';
import { BinaryExpressionNode, ExpressionNode, IndexExpressionNode, MemberAccessExpressionNode,
    NameNode, NumberNode, StringNode, TupleExpressionNode } from '../parser/parseNodes';
import { OperatorType } from '../parser/tokenizerTypes';

export class ExpressionUtils {
    // Returns undefined if the expression cannot be evaluated
    // statically or a value if it can.
    static evaluateConstantExpression(node: ExpressionNode, execEnv: ExecutionEnvironment): any | undefined {
        if (node instanceof BinaryExpressionNode) {
            if (this._isSysVersionInfoExpression(node.leftExpression) &&
                    node.rightExpression instanceof TupleExpressionNode) {

                // Handle the special case of "sys.version_info >= (3, x)"
                let comparisonVersion = this._convertTupleToVersion(node.rightExpression);
                return this._evaluateNumericBinaryOperation(node.operator, execEnv.pythonVersion, comparisonVersion);

            } else if (node.leftExpression instanceof IndexExpressionNode &&
                    this._isSysVersionInfoExpression(node.leftExpression.baseExpression) &&
                    node.leftExpression.indexExpression instanceof NumberNode &&
                    node.leftExpression.indexExpression.token.value === 0 &&
                    node.rightExpression instanceof NumberNode) {

                // Handle the special case of "sys.version_info[0] >= X"
                return this._evaluateNumericBinaryOperation(node.operator, execEnv.pythonVersion / 256,
                    node.rightExpression.token.value);
            } else if (this._isSysPlatformInfoExpression(node.leftExpression) &&
                    node.rightExpression instanceof StringNode) {
                // Handle the special case of "sys.platform != 'X'"
                let comparisonPlatform = node.rightExpression.getValue();
                if (execEnv.pythonPlatform !== undefined) {
                    return this._evaluateStringBinaryOperation(node.operator,
                        execEnv.pythonPlatform, comparisonPlatform);
                }
            }
        }

        return undefined;
    }

    private static _convertTupleToVersion(node: TupleExpressionNode): number | undefined {
        let comparisonVersion: number | undefined;
        if (node.expressions.length === 2) {
            if (node.expressions[0] instanceof NumberNode &&
                    node.expressions[1] instanceof NumberNode) {
                const majorVersion = node.expressions[0] as NumberNode;
                const minorVersion = node.expressions[1] as NumberNode;
                comparisonVersion = majorVersion.token.value * 256 + minorVersion.token.value;
            }
        } else if (node.expressions.length === 1) {
            const majorVersion = node.expressions[0] as NumberNode;
            comparisonVersion = majorVersion.token.value * 256;
        }

        return comparisonVersion;
    }

    private static _evaluateNumericBinaryOperation(operatorType: OperatorType, leftValue: number | undefined,
            rightValue: number | undefined): any | undefined {
        if (leftValue !== undefined && rightValue !== undefined) {
            if (operatorType === OperatorType.LessThan) {
                return leftValue < rightValue;
            } else if (operatorType === OperatorType.LessThanOrEqual) {
                return leftValue <= rightValue;
            } else if (operatorType === OperatorType.GreaterThan) {
                return leftValue > rightValue;
            } else if (operatorType === OperatorType.GreaterThanOrEqual) {
                return leftValue >= rightValue;
            } else if (operatorType === OperatorType.Equals) {
                return leftValue === rightValue;
            } else if (operatorType === OperatorType.NotEquals) {
                return leftValue !== rightValue;
            }
        }

        return undefined;
    }

    private static _evaluateStringBinaryOperation(operatorType: OperatorType,
            leftValue: string | undefined, rightValue: string | undefined): any | undefined {
        if (leftValue !== undefined && rightValue !== undefined) {
            if (operatorType === OperatorType.Equals) {
                return leftValue === rightValue;
            } else if (operatorType === OperatorType.NotEquals) {
                return leftValue !== rightValue;
            }
        }

        return undefined;
    }

    private static _isSysVersionInfoExpression(node: ExpressionNode): boolean {
        if (node instanceof MemberAccessExpressionNode) {
            if (node.leftExpression instanceof NameNode &&
                    node.leftExpression.nameToken.value === 'sys' &&
                    node.memberName.nameToken.value === 'version_info') {
                return true;
            }
        }

        return false;
    }

    private static _isSysPlatformInfoExpression(node: ExpressionNode): boolean {
        if (node instanceof MemberAccessExpressionNode) {
            if (node.leftExpression instanceof NameNode &&
                    node.leftExpression.nameToken.value === 'sys' &&
                    node.memberName.nameToken.value === 'platform') {
                return true;
            }
        }

        return false;
    }
}
