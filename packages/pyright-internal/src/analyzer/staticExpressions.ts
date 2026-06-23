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
import {
    ArgCategory,
    DictionaryEntryNode,
    ExpressionNode,
    NameNode,
    NumberNode,
    ParseNodeType,
    StringListNode,
    TupleNode,
} from '../parser/parseNodes';
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
    return _evaluateStaticBoolOrBoolLikeExpression(
        node,
        execEnv,
        definedConstants,
        typingImportAliases,
        sysImportAliases,
        _evaluateBoolConstant
    );
}

// Similar to evaluateStaticBoolExpression except that it handles other non-bool
// values that are statically falsy or truthy (like "None", "...", and
// numeric/string/container literals).
export function evaluateStaticBoolLikeExpression(
    node: ExpressionNode,
    execEnv: ExecutionEnvironment,
    definedConstants: Map<string, boolean | string>,
    typingImportAliases?: string[],
    sysImportAliases?: string[]
): boolean | undefined {
    return _evaluateStaticBoolOrBoolLikeExpression(
        node,
        execEnv,
        definedConstants,
        typingImportAliases,
        sysImportAliases,
        _evaluateBoolLikeLiteral
    );
}

// Shared implementation of the two functions above.
// The `evaluateLeafAsBool` callback evaluates leaf expressions.
function _evaluateStaticBoolOrBoolLikeExpression(
    node: ExpressionNode,
    execEnv: ExecutionEnvironment,
    definedConstants: Map<string, boolean | string>,
    typingImportAliases: string[] | undefined,
    sysImportAliases: string[] | undefined,
    evaluateLeafAsBool: (node: ExpressionNode) => boolean | undefined
): boolean | undefined {
    if (node.nodeType === ParseNodeType.AssignmentExpression) {
        return _evaluateStaticBoolOrBoolLikeExpression(
            node.d.rightExpr,
            execEnv,
            definedConstants,
            typingImportAliases,
            sysImportAliases,
            evaluateLeafAsBool
        );
    }

    if (node.nodeType === ParseNodeType.UnaryOperation) {
        if (node.d.operator === OperatorType.Not) {
            const value = _evaluateStaticBoolOrBoolLikeExpression(
                node.d.expr,
                execEnv,
                definedConstants,
                typingImportAliases,
                sysImportAliases,
                evaluateLeafAsBool
            );
            if (value !== undefined) {
                return !value;
            }
        }
    } else if (node.nodeType === ParseNodeType.BinaryOperation) {
        // Is it an OR or AND expression?
        if (node.d.operator === OperatorType.Or || node.d.operator === OperatorType.And) {
            const leftValue = _evaluateStaticBoolOrBoolLikeExpression(
                node.d.leftExpr,
                execEnv,
                definedConstants,
                typingImportAliases,
                sysImportAliases,
                evaluateLeafAsBool
            );
            const rightValue = _evaluateStaticBoolOrBoolLikeExpression(
                node.d.rightExpr,
                execEnv,
                definedConstants,
                typingImportAliases,
                sysImportAliases,
                evaluateLeafAsBool
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

    return evaluateLeafAsBool(node);
}

function _evaluateBoolConstant(node: ExpressionNode): boolean | undefined {
    if (node.nodeType === ParseNodeType.Constant) {
        if (node.d.constType === KeywordType.True) {
            return true;
        }
        if (node.d.constType === KeywordType.False) {
            return false;
        }
    }

    return undefined;
}

function _evaluateBoolLikeLiteral(node: ExpressionNode): boolean | undefined {
    switch (node.nodeType) {
        case ParseNodeType.Constant:
            if (node.d.constType === KeywordType.True) {
                return true;
            }
            if (node.d.constType === KeywordType.False || node.d.constType === KeywordType.None) {
                return false;
            }
            return undefined;

        case ParseNodeType.Ellipsis:
            return true;

        case ParseNodeType.Number:
            return _evaluateNumberTruthiness(node);

        case ParseNodeType.StringList:
            return _evaluateStringListTruthiness(node);

        case ParseNodeType.List:
        case ParseNodeType.Set:
        case ParseNodeType.Tuple:
            return _evaluateSequenceTruthiness(node.d.items);

        case ParseNodeType.Dictionary:
            return _evaluateDictTruthiness(node.d.items);

        default:
            return undefined;
    }
}

function _evaluateNumberTruthiness(node: NumberNode): boolean {
    // bool(v) is False iff v == 0:
    // - zero (0, 0.0, 0j) is falsy;
    // - everything else is truthy, including infinity and NaN.
    if (typeof node.d.value === 'bigint') {
        return node.d.value !== BigInt(0);
    }
    return node.d.value !== 0;
}

function _evaluateStringListTruthiness(node: StringListNode): boolean | undefined {
    // If any segment is an f-string, the concatenated value is runtime-dependent
    // (e.g. f"{x}" may be empty or not).
    if (node.d.strings.some((str) => str.nodeType === ParseNodeType.FormatString)) {
        return undefined;
    }

    // Truthy iff any segment is non-empty.
    return node.d.strings.some((str) => str.d.value.length > 0);
}

function _evaluateSequenceTruthiness(items: ExpressionNode[]): boolean | undefined {
    if (items.length === 0) {
        return false;
    }

    // A concrete element (not an unpack "*x" or a comprehension) guarantees the sequence is non-empty.
    if (items.some((item) => item.nodeType !== ParseNodeType.Unpack && item.nodeType !== ParseNodeType.Comprehension)) {
        return true;
    }

    // Only unpacks/comprehensions remain (e.g. "[*x]", "[i for i in y]").
    return undefined;
}

function _evaluateDictTruthiness(items: DictionaryEntryNode[]): boolean | undefined {
    if (items.length === 0) {
        return false;
    }

    // A concrete key/value entry guarantees the dict is non-empty.
    if (items.some((item) => item.nodeType === ParseNodeType.DictionaryKeyEntry)) {
        return true;
    }

    // Only "**" expansions or comprehensions remain.
    return undefined;
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
    } else if (execEnv.pythonPlatform === PythonPlatform.iOS) {
        return 'ios';
    } else if (execEnv.pythonPlatform === PythonPlatform.Android) {
        // Python >= 3.13 reports Android as 'android', earlier used to report it as 'linux'
        if (execEnv.pythonVersion.major === 3 && execEnv.pythonVersion.minor >= 13) {
            return 'android';
        } else {
            return 'linux';
        }
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
    } else if (execEnv.pythonPlatform === PythonPlatform.iOS) {
        return 'posix';
    } else if (execEnv.pythonPlatform === PythonPlatform.Android) {
        return 'posix';
    }

    return undefined;
}
