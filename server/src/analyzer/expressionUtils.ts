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
import { BinaryExpressionNode, ConstantNode, ExpressionNode, IndexExpressionNode,
    MemberAccessExpressionNode, NameNode, NumberNode, StringListNode,
    TupleExpressionNode } from '../parser/parseNodes';
import { KeywordType, OperatorType } from '../parser/tokenizerTypes';

export class ExpressionUtils {
    // Returns undefined if the expression cannot be evaluated
    // statically or a value if it can.
    static evaluateConstantExpression(node: ExpressionNode,
            execEnv: ExecutionEnvironment): boolean | undefined {

        if (node instanceof BinaryExpressionNode) {
            if (this._isSysVersionInfoExpression(node.leftExpression) &&
                    node.rightExpression instanceof TupleExpressionNode) {

                // Handle the special case of "sys.version_info >= (3, x)"
                let comparisonVersion = this._convertTupleToVersion(node.rightExpression);
                return this._evaluateNumericBinaryOperation(node.operator,
                    execEnv.pythonVersion, comparisonVersion);

            } else if (node.leftExpression instanceof IndexExpressionNode &&
                    this._isSysVersionInfoExpression(node.leftExpression.baseExpression) &&
                    node.leftExpression.items.items.length === 1 &&
                    node.leftExpression.items.items[0] instanceof NumberNode &&
                    (node.leftExpression.items.items[0] as NumberNode).token.value === 0 &&
                    node.rightExpression instanceof NumberNode) {

                // Handle the special case of "sys.version_info[0] >= X"
                return this._evaluateNumericBinaryOperation(node.operator,
                    Math.floor(execEnv.pythonVersion / 256), node.rightExpression.token.value);
            } else if (this._isSysPlatformInfoExpression(node.leftExpression) &&
                    node.rightExpression instanceof StringListNode) {
                // Handle the special case of "sys.platform != 'X'"
                const comparisonPlatform = node.rightExpression.getValue();
                if (execEnv.pythonPlatform !== undefined) {
                    return this._evaluateStringBinaryOperation(node.operator,
                        execEnv.pythonPlatform, comparisonPlatform);
                }
            } else if (this._isOsNameInfoExpression(node.leftExpression) &&
                    node.rightExpression instanceof StringListNode) {
                // Handle the special case of "os.name == 'X'"
                const comparisonOsName = node.rightExpression.getValue();
                let expectedOsName = this._getExpectedOsNameFromPlatform(execEnv);
                if (expectedOsName !== undefined) {
                    return this._evaluateStringBinaryOperation(node.operator,
                        expectedOsName, comparisonOsName);
                }
            }
        } else if (node instanceof ConstantNode) {
            if (node.token.keywordType === KeywordType.True) {
                return true;
            } else if (node.token.keywordType === KeywordType.False) {
                return false;
            }
        } else if (node instanceof NameNode) {
            if (node.nameToken.value === 'TYPE_CHECKING') {
                return true;
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

    private static _isOsNameInfoExpression(node: ExpressionNode): boolean {
        if (node instanceof MemberAccessExpressionNode) {
            if (node.leftExpression instanceof NameNode &&
                    node.leftExpression.nameToken.value === 'os' &&
                    node.memberName.nameToken.value === 'name') {
                return true;
            }
        }

        return false;
    }

    private static _getExpectedOsNameFromPlatform(execEnv: ExecutionEnvironment): string | undefined {
        if (execEnv.pythonPlatform === 'Darwin') {
            return 'posix';
        } else if (execEnv.pythonPlatform === 'Windows') {
            return 'nt';
        } else if (execEnv.pythonPlatform === 'Linux') {
            return 'linux';
        }

        return undefined;
    }
}
