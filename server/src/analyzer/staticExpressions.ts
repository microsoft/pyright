/*
* staticExpressions.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Collection of static methods that operate on expressions
* (parse node trees).
*/

import { ExecutionEnvironment } from '../common/configOptions';
import { ExpressionNode, NumberNode, ParseNodeType, TupleExpressionNode } from '../parser/parseNodes';
import { KeywordType, OperatorType } from '../parser/tokenizerTypes';

// Returns undefined if the expression cannot be evaluated
// statically or a value if it can.
export function evaluateStaticExpression(node: ExpressionNode,
        execEnv: ExecutionEnvironment): boolean | undefined {

    if (node.nodeType === ParseNodeType.BinaryOperation) {
        if (_isSysVersionInfoExpression(node.leftExpression) &&
                node.rightExpression.nodeType === ParseNodeType.Tuple) {

            // Handle the special case of "sys.version_info >= (3, x)"
            const comparisonVersion = _convertTupleToVersion(node.rightExpression);
            return _evaluateNumericBinaryOperation(node.operator,
                execEnv.pythonVersion, comparisonVersion);

        } else if (node.leftExpression.nodeType === ParseNodeType.Index &&
                _isSysVersionInfoExpression(node.leftExpression.baseExpression) &&
                node.leftExpression.items.items.length === 1 &&
                node.leftExpression.items.items[0].nodeType === ParseNodeType.Number &&
                node.leftExpression.items.items[0].token.value === 0 &&
                node.rightExpression.nodeType === ParseNodeType.Number) {

            // Handle the special case of "sys.version_info[0] >= X"
            return _evaluateNumericBinaryOperation(node.operator,
                Math.floor(execEnv.pythonVersion / 256), node.rightExpression.token.value);
        } else if (_isSysPlatformInfoExpression(node.leftExpression) &&
                node.rightExpression.nodeType === ParseNodeType.StringList) {
            // Handle the special case of "sys.platform != 'X'"
            const comparisonPlatform = node.rightExpression.strings.map(s => s.value).join('');
            if (execEnv.pythonPlatform !== undefined) {
                return _evaluateStringBinaryOperation(node.operator,
                    execEnv.pythonPlatform, comparisonPlatform);
            }
        } else if (_isOsNameInfoExpression(node.leftExpression) &&
                node.rightExpression.nodeType === ParseNodeType.StringList) {
            // Handle the special case of "os.name == 'X'"
            const comparisonOsName = node.rightExpression.strings.map(s => s.value).join('');
            const expectedOsName = _getExpectedOsNameFromPlatform(execEnv);
            if (expectedOsName !== undefined) {
                return _evaluateStringBinaryOperation(node.operator,
                    expectedOsName, comparisonOsName);
            }
        }
    } else if (node.nodeType === ParseNodeType.Constant) {
        if (node.token.keywordType === KeywordType.True) {
            return true;
        } else if (node.token.keywordType === KeywordType.False) {
            return false;
        }
    } else if (node.nodeType === ParseNodeType.Name) {
        if (node.nameToken.value === 'TYPE_CHECKING') {
            return true;
        }
    }

    return undefined;
}

function _convertTupleToVersion(node: TupleExpressionNode): number | undefined {
    let comparisonVersion: number | undefined;
    if (node.expressions.length === 2) {
        if (node.expressions[0].nodeType === ParseNodeType.Number &&
                node.expressions[1].nodeType === ParseNodeType.Number) {
            const majorVersion = node.expressions[0];
            const minorVersion = node.expressions[1];
            comparisonVersion = majorVersion.token.value * 256 + minorVersion.token.value;
        }
    } else if (node.expressions.length === 1) {
        const majorVersion = node.expressions[0] as NumberNode;
        comparisonVersion = majorVersion.token.value * 256;
    }

    return comparisonVersion;
}

function _evaluateNumericBinaryOperation(operatorType: OperatorType, leftValue: number | undefined,
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

function _evaluateStringBinaryOperation(operatorType: OperatorType,
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

function _isSysVersionInfoExpression(node: ExpressionNode): boolean {
    if (node.nodeType === ParseNodeType.MemberAccess) {
        if (node.leftExpression.nodeType === ParseNodeType.Name &&
                node.leftExpression.nameToken.value === 'sys' &&
                node.memberName.nameToken.value === 'version_info') {
            return true;
        }
    }

    return false;
}

function _isSysPlatformInfoExpression(node: ExpressionNode): boolean {
    if (node.nodeType === ParseNodeType.MemberAccess) {
        if (node.leftExpression.nodeType === ParseNodeType.Name &&
                node.leftExpression.nameToken.value === 'sys' &&
                node.memberName.nameToken.value === 'platform') {
            return true;
        }
    }

    return false;
}

function _isOsNameInfoExpression(node: ExpressionNode): boolean {
    if (node.nodeType === ParseNodeType.MemberAccess) {
        if (node.leftExpression.nodeType === ParseNodeType.Name &&
                node.leftExpression.nameToken.value === 'os' &&
                node.memberName.nameToken.value === 'name') {
            return true;
        }
    }

    return false;
}

function _getExpectedOsNameFromPlatform(execEnv: ExecutionEnvironment): string | undefined {
    if (execEnv.pythonPlatform === 'Darwin') {
        return 'posix';
    } else if (execEnv.pythonPlatform === 'Windows') {
        return 'nt';
    } else if (execEnv.pythonPlatform === 'Linux') {
        return 'linux';
    }

    return undefined;
}
