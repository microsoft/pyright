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
import { ArgCategory, ExpressionNode, NameNode, NumberNode, ParseNodeType, TupleNode } from '../parser/parseNodes';
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
            node.d.rightExpr,
            execEnv,
            definedConstants,
            typingImportAliases,
            sysImportAliases
        );
    }

    if (node.nodeType === ParseNodeType.UnaryOperation) {
        if (node.d.operator === OperatorType.Not) {
            const value = evaluateStaticBoolLikeExpression(
                node.d.expr,
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
                node.d.leftExpr,
                execEnv,
                definedConstants,
                typingImportAliases,
                sysImportAliases
            );
            const rightValue = evaluateStaticBoolExpression(
                node.d.rightExpr,
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
            _isSysVersionInfoExpression(node.d.leftExpr, sysImportAliases) &&
            node.d.rightExpr.nodeType === ParseNodeType.Tuple
        ) {
            // Handle the special case of "sys.version_info >= (3, x)"
            const comparisonVersion = _convertTupleToVersion(node.d.rightExpr);
            return _evaluateVersionBinaryOperation(node.d.operator, execEnv.pythonVersion, comparisonVersion);
        }

        if (
            node.d.leftExpr.nodeType === ParseNodeType.Index &&
            _isSysVersionInfoExpression(node.d.leftExpr.d.leftExpr, sysImportAliases) &&
            node.d.leftExpr.d.items.length === 1 &&
            !node.d.leftExpr.d.trailingComma &&
            !node.d.leftExpr.d.items[0].d.name &&
            node.d.leftExpr.d.items[0].d.argCategory === ArgCategory.Simple &&
            node.d.leftExpr.d.items[0].d.valueExpr.nodeType === ParseNodeType.Number &&
            !node.d.leftExpr.d.items[0].d.valueExpr.d.isImaginary &&
            node.d.leftExpr.d.items[0].d.valueExpr.d.value === 0 &&
            node.d.rightExpr.nodeType === ParseNodeType.Number &&
            node.d.rightExpr.d.isInteger &&
            typeof node.d.rightExpr.d.value === 'number'
        ) {
            // Handle the special case of "sys.version_info[0] >= X"
            return _evaluateVersionBinaryOperation(
                node.d.operator,
                PythonVersion.create(execEnv.pythonVersion.major, 0),
                PythonVersion.create(node.d.rightExpr.d.value, 0)
            );
        }

        if (
            _isSysPlatformInfoExpression(node.d.leftExpr, sysImportAliases) &&
            node.d.rightExpr.nodeType === ParseNodeType.StringList
        ) {
            // Handle the special case of "sys.platform != 'X'"
            const comparisonPlatform = node.d.rightExpr.d.strings.map((s) => s.d.value).join('');
            const expectedPlatformName = _getExpectedPlatformNameFromPlatform(execEnv);
            return _evaluateStringBinaryOperation(node.d.operator, expectedPlatformName, comparisonPlatform);
        }

        if (_isOsNameInfoExpression(node.d.leftExpr) && node.d.rightExpr.nodeType === ParseNodeType.StringList) {
            // Handle the special case of "os.name == 'X'"
            const comparisonOsName = node.d.rightExpr.d.strings.map((s) => s.d.value).join('');
            const expectedOsName = _getExpectedOsNameFromPlatform(execEnv);
            if (expectedOsName !== undefined) {
                return _evaluateStringBinaryOperation(node.d.operator, expectedOsName, comparisonOsName);
            }
        } else {
            // Handle the special case of <definedConstant> == 'X' or <definedConstant> != 'X'.
            if (node.d.rightExpr.nodeType === ParseNodeType.StringList) {
                let constantValue: string | number | boolean | undefined;

                if (node.d.leftExpr.nodeType === ParseNodeType.Name) {
                    constantValue = definedConstants.get(node.d.leftExpr.d.value);
                } else if (node.d.leftExpr.nodeType === ParseNodeType.MemberAccess) {
                    constantValue = definedConstants.get(node.d.leftExpr.d.member.d.value);
                }

                if (constantValue !== undefined && typeof constantValue === 'string') {
                    const comparisonStringName = node.d.rightExpr.d.strings.map((s) => s.d.value).join('');
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
            node.d.member.d.value === 'TYPE_CHECKING' &&
            node.d.leftExpr.nodeType === ParseNodeType.Name &&
            typingImportAliases.some((alias) => alias === (node.d.leftExpr as NameNode).d.value)
        ) {
            return true;
        }

        const constant = definedConstants.get(node.d.member.d.value);
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
    if (node.d.items.length >= 2) {
        if (
            node.d.items[0].nodeType === ParseNodeType.Number &&
            !node.d.items[0].d.isImaginary &&
            node.d.items[1].nodeType === ParseNodeType.Number &&
            !node.d.items[1].d.isImaginary
        ) {
            const majorNode = node.d.items[0];
            const minorNode = node.d.items[1];
            if (typeof majorNode.d.value !== 'number' || typeof minorNode.d.value !== 'number') {
                return undefined;
            }

            const major = majorNode.d.value;
            const minor = minorNode.d.value;
            let micro: number | undefined;
            if (
                node.d.items.length >= 3 &&
                node.d.items[2].nodeType === ParseNodeType.Number &&
                !node.d.items[2].d.isImaginary &&
                typeof node.d.items[2].d.value === 'number'
            ) {
                micro = node.d.items[2].d.value;
            }

            let releaseLevel: PythonReleaseLevel | undefined;
            if (
                node.d.items.length >= 4 &&
                node.d.items[3].nodeType === ParseNodeType.StringList &&
                node.d.items[3].d.strings.length === 1 &&
                node.d.items[3].d.strings[0].nodeType === ParseNodeType.String
            ) {
                releaseLevel = node.d.items[3].d.strings[0].d.value as PythonReleaseLevel;
            }

            let serial: number | undefined;
            if (
                node.d.items.length >= 5 &&
                node.d.items[4].nodeType === ParseNodeType.Number &&
                !node.d.items[4].d.isImaginary &&
                typeof node.d.items[4].d.value === 'number'
            ) {
                serial = node.d.items[4].d.value;
            }

            return PythonVersion.create(major, minor, micro, releaseLevel, serial);
        }
    } else if (node.d.items.length === 1) {
        const major = node.d.items[0] as NumberNode;
        if (typeof major.d.value === 'number') {
            return PythonVersion.create(major.d.value, 0);
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
            return PythonVersion.isLessThan(leftValue, rightValue);
        }

        if (operatorType === OperatorType.LessThanOrEqual) {
            return PythonVersion.isLessOrEqualTo(leftValue, rightValue);
        }

        if (operatorType === OperatorType.GreaterThan) {
            return PythonVersion.isGreaterThan(leftValue, rightValue);
        }

        if (operatorType === OperatorType.GreaterThanOrEqual) {
            return PythonVersion.isGreaterOrEqualTo(leftValue, rightValue);
        }

        if (operatorType === OperatorType.Equals) {
            return PythonVersion.isEqualTo(leftValue, rightValue);
        }

        if (operatorType === OperatorType.NotEquals) {
            return !PythonVersion.isEqualTo(leftValue, rightValue);
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
        if (node.d.leftExpr.nodeType === ParseNodeType.Name && node.d.member.d.value === 'version_info') {
            if (sysImportAliases.some((alias) => alias === (node.d.leftExpr as NameNode).d.value)) {
                return true;
            }
        }
    }

    return false;
}

function _isSysPlatformInfoExpression(node: ExpressionNode, sysImportAliases: string[] = ['sys']): boolean {
    if (node.nodeType === ParseNodeType.MemberAccess) {
        if (node.d.leftExpr.nodeType === ParseNodeType.Name && node.d.member.d.value === 'platform') {
            if (sysImportAliases.some((alias) => alias === (node.d.leftExpr as NameNode).d.value)) {
                return true;
            }
        }
    }

    return false;
}

function _isOsNameInfoExpression(node: ExpressionNode): boolean {
    if (node.nodeType === ParseNodeType.MemberAccess) {
        if (
            node.d.leftExpr.nodeType === ParseNodeType.Name &&
            node.d.leftExpr.d.value === 'os' &&
            node.d.member.d.value === 'name'
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
