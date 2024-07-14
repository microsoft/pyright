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
            node.d.rightExpression,
            execEnv,
            definedConstants,
            typingImportAliases,
            sysImportAliases
        );
    }

    if (node.nodeType === ParseNodeType.UnaryOperation) {
        if (node.d.operator === OperatorType.Not) {
            const value = evaluateStaticBoolLikeExpression(
                node.d.expression,
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
        if (node.d.operator === OperatorType.Or || node.d.operator === OperatorType.And) {
            const leftValue = evaluateStaticBoolExpression(
                node.d.leftExpression,
                execEnv,
                definedConstants,
                typingImportAliases,
                sysImportAliases
            );
            const rightValue = evaluateStaticBoolExpression(
                node.d.rightExpression,
                execEnv,
                definedConstants,
                typingImportAliases,
                sysImportAliases
            );

            if (leftValue === undefined || rightValue === undefined) {
                return undefined;
            }

            if (node.d.operator === OperatorType.Or) {
                return leftValue || rightValue;
            } else {
                return leftValue && rightValue;
            }
        }

        if (
            _isSysVersionInfoExpression(node.d.leftExpression, sysImportAliases) &&
            node.d.rightExpression.nodeType === ParseNodeType.Tuple
        ) {
            // Handle the special case of "sys.version_info >= (3, x)"
            const comparisonVersion = _convertTupleToVersion(node.d.rightExpression);
            return _evaluateVersionBinaryOperation(node.d.operator, execEnv.pythonVersion, comparisonVersion);
        }

        if (
            node.d.leftExpression.nodeType === ParseNodeType.Index &&
            _isSysVersionInfoExpression(node.d.leftExpression.d.baseExpression, sysImportAliases) &&
            node.d.leftExpression.d.items.length === 1 &&
            !node.d.leftExpression.d.trailingComma &&
            !node.d.leftExpression.d.items[0].d.name &&
            node.d.leftExpression.d.items[0].d.argumentCategory === ArgumentCategory.Simple &&
            node.d.leftExpression.d.items[0].d.valueExpression.nodeType === ParseNodeType.Number &&
            !node.d.leftExpression.d.items[0].d.valueExpression.d.isImaginary &&
            node.d.leftExpression.d.items[0].d.valueExpression.d.value === 0 &&
            node.d.rightExpression.nodeType === ParseNodeType.Number &&
            node.d.rightExpression.d.isInteger &&
            typeof node.d.rightExpression.d.value === 'number'
        ) {
            // Handle the special case of "sys.version_info[0] >= X"
            return _evaluateVersionBinaryOperation(
                node.d.operator,
                new PythonVersion(execEnv.pythonVersion.major, 0),
                new PythonVersion(node.d.rightExpression.d.value, 0)
            );
        }

        if (
            _isSysPlatformInfoExpression(node.d.leftExpression, sysImportAliases) &&
            node.d.rightExpression.nodeType === ParseNodeType.StringList
        ) {
            // Handle the special case of "sys.platform != 'X'"
            const comparisonPlatform = node.d.rightExpression.d.strings.map((s) => s.d.value).join('');
            const expectedPlatformName = _getExpectedPlatformNameFromPlatform(execEnv);
            return _evaluateStringBinaryOperation(node.d.operator, expectedPlatformName, comparisonPlatform);
        }

        if (
            _isOsNameInfoExpression(node.d.leftExpression) &&
            node.d.rightExpression.nodeType === ParseNodeType.StringList
        ) {
            // Handle the special case of "os.name == 'X'"
            const comparisonOsName = node.d.rightExpression.d.strings.map((s) => s.d.value).join('');
            const expectedOsName = _getExpectedOsNameFromPlatform(execEnv);
            if (expectedOsName !== undefined) {
                return _evaluateStringBinaryOperation(node.d.operator, expectedOsName, comparisonOsName);
            }
        } else {
            // Handle the special case of <definedConstant> == 'X' or <definedConstant> != 'X'.
            if (node.d.rightExpression.nodeType === ParseNodeType.StringList) {
                let constantValue: string | number | boolean | undefined;

                if (node.d.leftExpression.nodeType === ParseNodeType.Name) {
                    constantValue = definedConstants.get(node.d.leftExpression.d.value);
                } else if (node.d.leftExpression.nodeType === ParseNodeType.MemberAccess) {
                    constantValue = definedConstants.get(node.d.leftExpression.d.memberName.d.value);
                }

                if (constantValue !== undefined && typeof constantValue === 'string') {
                    const comparisonStringName = node.d.rightExpression.d.strings.map((s) => s.d.value).join('');
                    return _evaluateStringBinaryOperation(node.d.operator, constantValue, comparisonStringName);
                }
            }
        }
    } else if (node.nodeType === ParseNodeType.Constant) {
        if (node.d.constType === KeywordType.True) {
            return true;
        } else if (node.d.constType === KeywordType.False) {
            return false;
        }
    } else if (node.nodeType === ParseNodeType.Name) {
        if (node.d.value === 'TYPE_CHECKING') {
            return true;
        }

        const constant = definedConstants.get(node.d.value);
        if (constant !== undefined) {
            return !!constant;
        }
    } else if (node.nodeType === ParseNodeType.MemberAccess) {
        if (
            typingImportAliases &&
            node.d.memberName.d.value === 'TYPE_CHECKING' &&
            node.d.leftExpression.nodeType === ParseNodeType.Name &&
            typingImportAliases.some((alias) => alias === (node.d.leftExpression as NameNode).d.value)
        ) {
            return true;
        }

        const constant = definedConstants.get(node.d.memberName.d.value);
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
        if (node.d.constType === KeywordType.None) {
            return false;
        }
    }

    return evaluateStaticBoolExpression(node, execEnv, definedConstants, typingImportAliases, sysImportAliases);
}

function _convertTupleToVersion(node: TupleNode): PythonVersion | undefined {
    if (node.d.expressions.length >= 2) {
        if (
            node.d.expressions[0].nodeType === ParseNodeType.Number &&
            !node.d.expressions[0].d.isImaginary &&
            node.d.expressions[1].nodeType === ParseNodeType.Number &&
            !node.d.expressions[1].d.isImaginary
        ) {
            const majorNode = node.d.expressions[0];
            const minorNode = node.d.expressions[1];
            if (typeof majorNode.d.value !== 'number' || typeof minorNode.d.value !== 'number') {
                return undefined;
            }

            const major = majorNode.d.value;
            const minor = minorNode.d.value;
            let micro: number | undefined;
            if (
                node.d.expressions.length >= 3 &&
                node.d.expressions[2].nodeType === ParseNodeType.Number &&
                !node.d.expressions[2].d.isImaginary &&
                typeof node.d.expressions[2].d.value === 'number'
            ) {
                micro = node.d.expressions[2].d.value;
            }

            let releaseLevel: PythonReleaseLevel | undefined;
            if (
                node.d.expressions.length >= 4 &&
                node.d.expressions[3].nodeType === ParseNodeType.StringList &&
                node.d.expressions[3].d.strings.length === 1 &&
                node.d.expressions[3].d.strings[0].nodeType === ParseNodeType.String
            ) {
                releaseLevel = node.d.expressions[3].d.strings[0].d.value as PythonReleaseLevel;
            }

            let serial: number | undefined;
            if (
                node.d.expressions.length >= 5 &&
                node.d.expressions[4].nodeType === ParseNodeType.Number &&
                !node.d.expressions[4].d.isImaginary &&
                typeof node.d.expressions[4].d.value === 'number'
            ) {
                serial = node.d.expressions[4].d.value;
            }

            return new PythonVersion(major, minor, micro, releaseLevel, serial);
        }
    } else if (node.d.expressions.length === 1) {
        const major = node.d.expressions[0] as NumberNode;
        if (typeof major.d.value === 'number') {
            return new PythonVersion(major.d.value, 0);
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
        if (node.d.leftExpression.nodeType === ParseNodeType.Name && node.d.memberName.d.value === 'version_info') {
            if (sysImportAliases.some((alias) => alias === (node.d.leftExpression as NameNode).d.value)) {
                return true;
            }
        }
    }

    return false;
}

function _isSysPlatformInfoExpression(node: ExpressionNode, sysImportAliases: string[] = ['sys']): boolean {
    if (node.nodeType === ParseNodeType.MemberAccess) {
        if (node.d.leftExpression.nodeType === ParseNodeType.Name && node.d.memberName.d.value === 'platform') {
            if (sysImportAliases.some((alias) => alias === (node.d.leftExpression as NameNode).d.value)) {
                return true;
            }
        }
    }

    return false;
}

function _isOsNameInfoExpression(node: ExpressionNode): boolean {
    if (node.nodeType === ParseNodeType.MemberAccess) {
        if (
            node.d.leftExpression.nodeType === ParseNodeType.Name &&
            node.d.leftExpression.d.value === 'os' &&
            node.d.memberName.d.value === 'name'
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
