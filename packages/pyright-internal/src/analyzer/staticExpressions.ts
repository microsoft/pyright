/*
 * staticExpressions.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Functions that operate on expressions (parse node trees)
 * whose values can be evaluated statically.
 */

import { ExecutionEnvironment, PythonPlatform } from '../common/configOptions';
import { PythonReleaseLevel, PythonVersion } from '../common/pythonVersion';
import { ArgumentCategory, ExpressionNode, NameNode, NumberNode, ParseNodeType, TupleNode } from '../parser/parseNodes';
import { KeywordType, OperatorType } from '../parser/tokenizerTypes';

// Returns undefined if the expression cannot be evaluated
// statically as a bool value or true/false if it can.
export function evaluateStaticBoolExpression(
    node: ExpressionNode,
    execEnv: ExecutionEnvironment,
    definedConstants: Map<string, boolean | string>,
    typingImportAliases?: string[],
    sysImportAliases?: string[]
): boolean | undefined {
    if (node.nodeType === ParseNodeType.AssignmentExpression) {
        return evaluateStaticBoolExpression(
            node.rightExpression,
            execEnv,
            definedConstants,
            typingImportAliases,
            sysImportAliases
        );
    }

    if (node.nodeType === ParseNodeType.UnaryOperation) {
        if (node.operator === OperatorType.Not) {
            const value = evaluateStaticBoolLikeExpression(
                node.expression,
                execEnv,
                definedConstants,
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
                definedConstants,
                typingImportAliases,
                sysImportAliases
            );
            const rightValue = evaluateStaticBoolExpression(
                node.rightExpression,
                execEnv,
                definedConstants,
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
            return _evaluateVersionBinaryOperation(node.operator, execEnv.pythonVersion, comparisonVersion);
        }

        if (
            node.leftExpression.nodeType === ParseNodeType.Index &&
            _isSysVersionInfoExpression(node.leftExpression.baseExpression, sysImportAliases) &&
            node.leftExpression.items.length === 1 &&
            !node.leftExpression.trailingComma &&
            !node.leftExpression.items[0].name &&
            node.leftExpression.items[0].argumentCategory === ArgumentCategory.Simple &&
            node.leftExpression.items[0].valueExpression.nodeType === ParseNodeType.Number &&
            !node.leftExpression.items[0].valueExpression.isImaginary &&
            node.leftExpression.items[0].valueExpression.value === 0 &&
            node.rightExpression.nodeType === ParseNodeType.Number &&
            node.rightExpression.isInteger &&
            typeof node.rightExpression.value === 'number'
        ) {
            // Handle the special case of "sys.version_info[0] >= X"
            return _evaluateVersionBinaryOperation(
                node.operator,
                new PythonVersion(execEnv.pythonVersion.major, 0),
                new PythonVersion(node.rightExpression.value, 0)
            );
        }

        if (
            _isSysPlatformInfoExpression(node.leftExpression, sysImportAliases) &&
            node.rightExpression.nodeType === ParseNodeType.StringList
        ) {
            // Handle the special case of "sys.platform != 'X'"
            const comparisonPlatform = node.rightExpression.strings.map((s) => s.value).join('');
            const expectedPlatformName = _getExpectedPlatformNameFromPlatform(execEnv);
            return _evaluateStringBinaryOperation(node.operator, expectedPlatformName, comparisonPlatform);
        }

        if (
            _isOsNameInfoExpression(node.leftExpression) &&
            node.rightExpression.nodeType === ParseNodeType.StringList
        ) {
            // Handle the special case of "os.name == 'X'"
            const comparisonOsName = node.rightExpression.strings.map((s) => s.value).join('');
            const expectedOsName = _getExpectedOsNameFromPlatform(execEnv);
            if (expectedOsName !== undefined) {
                return _evaluateStringBinaryOperation(node.operator, expectedOsName, comparisonOsName);
            }
        } else {
            // Handle the special case of <definedConstant> == 'X' or <definedConstant> != 'X'.
            if (node.rightExpression.nodeType === ParseNodeType.StringList) {
                let constantValue: string | number | boolean | undefined;

                if (node.leftExpression.nodeType === ParseNodeType.Name) {
                    constantValue = definedConstants.get(node.leftExpression.value);
                } else if (node.leftExpression.nodeType === ParseNodeType.MemberAccess) {
                    constantValue = definedConstants.get(node.leftExpression.memberName.value);
                }

                if (constantValue !== undefined && typeof constantValue === 'string') {
                    const comparisonStringName = node.rightExpression.strings.map((s) => s.value).join('');
                    return _evaluateStringBinaryOperation(node.operator, constantValue, comparisonStringName);
                }
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

        const constant = definedConstants.get(node.value);
        if (constant !== undefined) {
            return !!constant;
        }
    } else if (node.nodeType === ParseNodeType.MemberAccess) {
        if (
            typingImportAliases &&
            node.memberName.value === 'TYPE_CHECKING' &&
            node.leftExpression.nodeType === ParseNodeType.Name &&
            typingImportAliases.some((alias) => alias === (node.leftExpression as NameNode).value)
        ) {
            return true;
        }

        const constant = definedConstants.get(node.memberName.value);
        if (constant !== undefined) {
            return !!constant;
        }
    }

    return undefined;
}

// Similar to evaluateStaticBoolExpression except that it handles
// other non-bool values that are statically falsy or truthy
// (like "None").
export function evaluateStaticBoolLikeExpression(
    node: ExpressionNode,
    execEnv: ExecutionEnvironment,
    definedConstants: Map<string, boolean | string>,
    typingImportAliases?: string[],
    sysImportAliases?: string[]
): boolean | undefined {
    if (node.nodeType === ParseNodeType.Constant) {
        if (node.constType === KeywordType.None) {
            return false;
        }
    }

    return evaluateStaticBoolExpression(node, execEnv, definedConstants, typingImportAliases, sysImportAliases);
}

function _convertTupleToVersion(node: TupleNode): PythonVersion | undefined {
    if (node.expressions.length >= 2) {
        if (
            node.expressions[0].nodeType === ParseNodeType.Number &&
            !node.expressions[0].isImaginary &&
            node.expressions[1].nodeType === ParseNodeType.Number &&
            !node.expressions[1].isImaginary
        ) {
            const majorNode = node.expressions[0];
            const minorNode = node.expressions[1];
            if (typeof majorNode.value !== 'number' || typeof minorNode.value !== 'number') {
                return undefined;
            }

            const major = majorNode.value;
            const minor = minorNode.value;
            let micro: number | undefined;
            if (
                node.expressions.length >= 3 &&
                node.expressions[2].nodeType === ParseNodeType.Number &&
                !node.expressions[2].isImaginary &&
                typeof node.expressions[2].value === 'number'
            ) {
                micro = node.expressions[2].value;
            }

            let releaseLevel: PythonReleaseLevel | undefined;
            if (
                node.expressions.length >= 4 &&
                node.expressions[3].nodeType === ParseNodeType.StringList &&
                node.expressions[3].strings.length === 1 &&
                node.expressions[3].strings[0].nodeType === ParseNodeType.String
            ) {
                releaseLevel = node.expressions[3].strings[0].value as PythonReleaseLevel;
            }

            let serial: number | undefined;
            if (
                node.expressions.length >= 5 &&
                node.expressions[4].nodeType === ParseNodeType.Number &&
                !node.expressions[4].isImaginary &&
                typeof node.expressions[4].value === 'number'
            ) {
                serial = node.expressions[4].value;
            }

            return new PythonVersion(major, minor, micro, releaseLevel, serial);
        }
    } else if (node.expressions.length === 1) {
        const major = node.expressions[0] as NumberNode;
        if (typeof major.value === 'number') {
            return new PythonVersion(major.value, 0);
        }
    }

    return undefined;
}

function _evaluateVersionBinaryOperation(
    operatorType: OperatorType,
    leftValue: PythonVersion | undefined,
    rightValue: PythonVersion | undefined
): any | undefined {
    if (leftValue !== undefined && rightValue !== undefined) {
        if (operatorType === OperatorType.LessThan) {
            return leftValue.isLessThan(rightValue);
        }

        if (operatorType === OperatorType.LessThanOrEqual) {
            return leftValue.isLessOrEqualTo(rightValue);
        }

        if (operatorType === OperatorType.GreaterThan) {
            return leftValue.isGreaterThan(rightValue);
        }

        if (operatorType === OperatorType.GreaterThanOrEqual) {
            return leftValue.isGreaterOrEqualTo(rightValue);
        }

        if (operatorType === OperatorType.Equals) {
            return leftValue.isEqualTo(rightValue);
        }

        if (operatorType === OperatorType.NotEquals) {
            return !leftValue.isEqualTo(rightValue);
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
