/*
 * staticExpressions.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Collection of static methods that operate on expressions
 * (parse node trees).
 */

import { ExecutionEnvironment, PythonPlatform } from '../common/configOptions';
import { ArgumentCategory, ExpressionNode, NameNode, NumberNode, ParseNodeType, TupleNode } from '../parser/parseNodes';
import { KeywordType, OperatorType } from '../parser/tokenizerTypes';

// Returns undefined if the expression cannot be evaluated
// statically as a bool value or true/false if it can.
export function evaluateStaticBoolExpression(
    node: ExpressionNode,
    execEnv: ExecutionEnvironment,
    typingImportAliases?: string[],
    sysImportAliases?: string[]
): boolean | undefined {
    if (node.nodeType === ParseNodeType.AssignmentExpression) {
        return evaluateStaticBoolExpression(node.rightExpression, execEnv, typingImportAliases, sysImportAliases);
    }

    if (node.nodeType === ParseNodeType.UnaryOperation) {
        if (node.operator === OperatorType.Or || node.operator === OperatorType.And) {
            const value = evaluateStaticBoolLikeExpression(
                node.expression,
                execEnv,
                typingImportAliases,
                sysImportAliases
            );
            if (value !== undefined) {
                return !value;
            }
        }
    } else if (node.nodeType === ParseNodeType.BinaryOperation) {
        // Is it an OR or AND expression?
        if (node.operator === OperatorType.Or || node.operator === OperatorType.And) {
            const leftValue = evaluateStaticBoolExpression(
                node.leftExpression,
                execEnv,
                typingImportAliases,
                sysImportAliases
            );
            const rightValue = evaluateStaticBoolExpression(
                node.rightExpression,
                execEnv,
                typingImportAliases,
                sysImportAliases
            );

            if (leftValue === undefined || rightValue === undefined) {
                return undefined;
            }

            if (node.operator === OperatorType.Or) {
                return leftValue || rightValue;
            } else {
                return leftValue && rightValue;
            }
        }

        if (
            _isSysVersionInfoExpression(node.leftExpression, sysImportAliases) &&
            node.rightExpression.nodeType === ParseNodeType.Tuple
        ) {
            // Handle the special case of "sys.version_info >= (3, x)"
            const comparisonVersion = _convertTupleToVersion(node.rightExpression);
            return _evaluateNumericBinaryOperation(node.operator, execEnv.pythonVersion, comparisonVersion);
        } else if (
            node.leftExpression.nodeType === ParseNodeType.Index &&
            _isSysVersionInfoExpression(node.leftExpression.baseExpression, sysImportAliases) &&
            node.leftExpression.items.length === 1 &&
            !node.leftExpression.trailingComma &&
            !node.leftExpression.items[0].name &&
            node.leftExpression.items[0].argumentCategory === ArgumentCategory.Simple &&
            node.leftExpression.items[0].valueExpression.nodeType === ParseNodeType.Number &&
            !node.leftExpression.items[0].valueExpression.isImaginary &&
            node.leftExpression.items[0].valueExpression.value === 0 &&
            node.rightExpression.nodeType === ParseNodeType.Number
        ) {
            // Handle the special case of "sys.version_info[0] >= X"
            return _evaluateNumericBinaryOperation(
                node.operator,
                Math.floor(execEnv.pythonVersion / 256),
                node.rightExpression.value
            );
        } else if (
            _isSysPlatformInfoExpression(node.leftExpression, sysImportAliases) &&
            node.rightExpression.nodeType === ParseNodeType.StringList
        ) {
            // Handle the special case of "sys.platform != 'X'"
            const comparisonPlatform = node.rightExpression.strings.map((s) => s.value).join('');
            const expectedPlatformName = _getExpectedPlatformNameFromPlatform(execEnv);
            return _evaluateStringBinaryOperation(node.operator, expectedPlatformName, comparisonPlatform);
        } else if (
            _isOsNameInfoExpression(node.leftExpression) &&
            node.rightExpression.nodeType === ParseNodeType.StringList
        ) {
            // Handle the special case of "os.name == 'X'"
            const comparisonOsName = node.rightExpression.strings.map((s) => s.value).join('');
            const expectedOsName = _getExpectedOsNameFromPlatform(execEnv);
            if (expectedOsName !== undefined) {
                return _evaluateStringBinaryOperation(node.operator, expectedOsName, comparisonOsName);
            }
        }
    } else if (node.nodeType === ParseNodeType.Constant) {
        if (node.constType === KeywordType.True) {
            return true;
        } else if (node.constType === KeywordType.False) {
            return false;
        }
    } else if (node.nodeType === ParseNodeType.Name) {
        if (node.value === 'TYPE_CHECKING') {
            return true;
        }
    } else if (
        typingImportAliases &&
        node.nodeType === ParseNodeType.MemberAccess &&
        node.memberName.value === 'TYPE_CHECKING' &&
        node.leftExpression.nodeType === ParseNodeType.Name &&
        typingImportAliases.some((alias) => alias === (node.leftExpression as NameNode).value)
    ) {
        return true;
    }

    return undefined;
}

// Similar to evaluateStaticBoolExpression except that it handles
// other non-bool values that are statically falsy or truthy
// (like "None").
export function evaluateStaticBoolLikeExpression(
    node: ExpressionNode,
    execEnv: ExecutionEnvironment,
    typingImportAliases?: string[],
    sysImportAliases?: string[]
): boolean | undefined {
    if (node.nodeType === ParseNodeType.Constant) {
        if (node.constType === KeywordType.None) {
            return false;
        }
    }

    return evaluateStaticBoolExpression(node, execEnv, typingImportAliases, sysImportAliases);
}

function _convertTupleToVersion(node: TupleNode): number | undefined {
    let comparisonVersion: number | undefined;
    // Ignore patch versions.
    if (node.expressions.length >= 2) {
        if (
            node.expressions[0].nodeType === ParseNodeType.Number &&
            !node.expressions[0].isImaginary &&
            node.expressions[1].nodeType === ParseNodeType.Number &&
            !node.expressions[1].isImaginary
        ) {
            const majorVersion = node.expressions[0];
            const minorVersion = node.expressions[1];
            if (typeof majorVersion.value === 'number' && typeof minorVersion.value === 'number') {
                comparisonVersion = majorVersion.value * 256 + minorVersion.value;
            }
        }
    } else if (node.expressions.length === 1) {
        const majorVersion = node.expressions[0] as NumberNode;
        if (typeof majorVersion.value === 'number') {
            comparisonVersion = majorVersion.value * 256;
        }
    }

    return comparisonVersion;
}

function _evaluateNumericBinaryOperation(
    operatorType: OperatorType,
    leftValue: number | bigint | undefined,
    rightValue: number | bigint | undefined
): any | undefined {
    if (leftValue !== undefined && rightValue !== undefined) {
        leftValue = BigInt(leftValue);
        rightValue = BigInt(rightValue);

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

function _evaluateStringBinaryOperation(
    operatorType: OperatorType,
    leftValue: string | undefined,
    rightValue: string | undefined
): any | undefined {
    if (leftValue !== undefined && rightValue !== undefined) {
        if (operatorType === OperatorType.Equals) {
            return leftValue === rightValue;
        } else if (operatorType === OperatorType.NotEquals) {
            return leftValue !== rightValue;
        }
    }

    return undefined;
}

function _isSysVersionInfoExpression(node: ExpressionNode, sysImportAliases: string[] = ['sys']): boolean {
    if (node.nodeType === ParseNodeType.MemberAccess) {
        if (node.leftExpression.nodeType === ParseNodeType.Name && node.memberName.value === 'version_info') {
            if (sysImportAliases.some((alias) => alias === (node.leftExpression as NameNode).value)) {
                return true;
            }
        }
    }

    return false;
}

function _isSysPlatformInfoExpression(node: ExpressionNode, sysImportAliases: string[] = ['sys']): boolean {
    if (node.nodeType === ParseNodeType.MemberAccess) {
        if (node.leftExpression.nodeType === ParseNodeType.Name && node.memberName.value === 'platform') {
            if (sysImportAliases.some((alias) => alias === (node.leftExpression as NameNode).value)) {
                return true;
            }
        }
    }

    return false;
}

function _isOsNameInfoExpression(node: ExpressionNode): boolean {
    if (node.nodeType === ParseNodeType.MemberAccess) {
        if (
            node.leftExpression.nodeType === ParseNodeType.Name &&
            node.leftExpression.value === 'os' &&
            node.memberName.value === 'name'
        ) {
            return true;
        }
    }

    return false;
}

function _getExpectedPlatformNameFromPlatform(execEnv: ExecutionEnvironment): string | undefined {
    if (execEnv.pythonPlatform === PythonPlatform.Darwin) {
        return 'darwin';
    } else if (execEnv.pythonPlatform === PythonPlatform.Windows) {
        return 'win32';
    } else if (execEnv.pythonPlatform === PythonPlatform.Linux) {
        return 'linux';
    }

    return undefined;
}

function _getExpectedOsNameFromPlatform(execEnv: ExecutionEnvironment): string | undefined {
    if (execEnv.pythonPlatform === PythonPlatform.Darwin) {
        return 'posix';
    } else if (execEnv.pythonPlatform === PythonPlatform.Windows) {
        return 'nt';
    } else if (execEnv.pythonPlatform === PythonPlatform.Linux) {
        return 'posix';
    }

    return undefined;
}
