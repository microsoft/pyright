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
import { PythonVersion } from '../common/pythonVersion';
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
import { KeywordType, OperatorType, StringTokenFlags } from '../parser/tokenizerTypes';
import { DeclarationType } from './declaration';
import { Scope } from './scope';

const _mirroredComparisonOperators: Map<OperatorType, OperatorType> = new Map([
    [OperatorType.GreaterThan, OperatorType.LessThan],
    [OperatorType.LessThan, OperatorType.GreaterThan],
    [OperatorType.GreaterThanOrEqual, OperatorType.LessThanOrEqual],
    [OperatorType.LessThanOrEqual, OperatorType.GreaterThanOrEqual],
    [OperatorType.Equals, OperatorType.Equals],
    [OperatorType.NotEquals, OperatorType.NotEquals],
]);

// Returns undefined if the expression cannot be evaluated
// statically as a bool value or true/false if it can.
export function evaluateStaticBoolExpression(
    node: ExpressionNode,
    execEnv: ExecutionEnvironment,
    definedConstants: Map<string, boolean | string>,
    scope: Scope | undefined
): boolean | undefined {
    return _evaluateStaticBoolOrBoolLikeExpression(node, execEnv, definedConstants, scope, _evaluateBoolConstant);
}

// Similar to evaluateStaticBoolExpression except that it handles other non-bool
// values that are statically falsy or truthy (like "None", "...", and
// numeric/string/container literals).
export function evaluateStaticBoolLikeExpression(
    node: ExpressionNode,
    execEnv: ExecutionEnvironment,
    definedConstants: Map<string, boolean | string>,
    scope: Scope | undefined
): boolean | undefined {
    return _evaluateStaticBoolOrBoolLikeExpression(node, execEnv, definedConstants, scope, _evaluateBoolLikeLiteral);
}

// Shared implementation of the two functions above.
// The `evaluateLeafAsBool` callback evaluates leaf expressions.
function _evaluateStaticBoolOrBoolLikeExpression(
    node: ExpressionNode,
    execEnv: ExecutionEnvironment,
    definedConstants: Map<string, boolean | string>,
    scope: Scope | undefined,
    evaluateLeafAsBool: (node: ExpressionNode) => boolean | undefined
): boolean | undefined {
    if (node.nodeType === ParseNodeType.AssignmentExpression) {
        return _evaluateStaticBoolOrBoolLikeExpression(
            node.d.rightExpr,
            execEnv,
            definedConstants,
            scope,
            evaluateLeafAsBool
        );
    }

    if (node.nodeType === ParseNodeType.UnaryOperation) {
        if (node.d.operator === OperatorType.Not) {
            const value = _evaluateStaticBoolOrBoolLikeExpression(
                node.d.expr,
                execEnv,
                definedConstants,
                scope,
                // `not x` always forces a truthiness context on its operand and yields real `bool`.
                // So the operand is folded with the bool-like leaf even for strict callers.
                _evaluateBoolLikeLiteral
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
                scope,
                evaluateLeafAsBool
            );
            const rightValue = _evaluateStaticBoolOrBoolLikeExpression(
                node.d.rightExpr,
                execEnv,
                definedConstants,
                scope,
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

        let leftExpr = node.d.leftExpr;
        let rightExpr = node.d.rightExpr;
        let operator: OperatorType = node.d.operator;

        const mirroredOperator = _mirroredComparisonOperators.get(operator);
        if (
            mirroredOperator !== undefined &&
            _isStaticComparisonLiteral(leftExpr) &&
            !_isStaticComparisonLiteral(rightExpr)
        ) {
            [leftExpr, rightExpr] = [rightExpr, leftExpr];
            operator = mirroredOperator;
        }

        if (_isSysVersionInfoExpression(leftExpr, scope) && rightExpr.nodeType === ParseNodeType.Tuple) {
            // Handle the special case of "sys.version_info >= (3, x)"
            return _evaluateComparisonResult(operator, _compareVersionInfoToTuple(execEnv.pythonVersion, rightExpr));
        }

        if (
            leftExpr.nodeType === ParseNodeType.Index &&
            _isSysVersionInfoExpression(leftExpr.d.leftExpr, scope) &&
            leftExpr.d.items.length === 1 &&
            !leftExpr.d.trailingComma &&
            !leftExpr.d.items[0].d.name &&
            leftExpr.d.items[0].d.argCategory === ArgCategory.Simple &&
            leftExpr.d.items[0].d.valueExpr.nodeType === ParseNodeType.Number &&
            !leftExpr.d.items[0].d.valueExpr.d.isImaginary &&
            leftExpr.d.items[0].d.valueExpr.d.value === 0 &&
            rightExpr.nodeType === ParseNodeType.Number &&
            rightExpr.d.isInteger &&
            typeof rightExpr.d.value === 'number'
        ) {
            // Handle the special case of "sys.version_info[0] >= X"
            return _evaluateVersionBinaryOperation(
                operator,
                PythonVersion.create(execEnv.pythonVersion.major, 0),
                PythonVersion.create(rightExpr.d.value, 0)
            );
        }

        if (_isSysPlatformInfoExpression(leftExpr, scope) && rightExpr.nodeType === ParseNodeType.StringList) {
            // Handle the special case of "sys.platform != 'X'"
            return _evaluateStrComparisonToStringList(
                operator,
                rightExpr,
                _getExpectedPlatformNameFromPlatform(execEnv)
            );
        }

        if (_isOsNameInfoExpression(leftExpr, scope) && rightExpr.nodeType === ParseNodeType.StringList) {
            // Handle the special case of "os.name == 'X'"
            return _evaluateStrComparisonToStringList(operator, rightExpr, _getExpectedOsNameFromPlatform(execEnv));
        } else {
            // Handle the special case of <definedConstant> == 'X' or <definedConstant> != 'X'.
            if (rightExpr.nodeType === ParseNodeType.StringList) {
                let constantValue: string | number | boolean | undefined;

                if (leftExpr.nodeType === ParseNodeType.Name) {
                    constantValue = definedConstants.get(leftExpr.d.value);
                } else if (leftExpr.nodeType === ParseNodeType.MemberAccess) {
                    constantValue = definedConstants.get(leftExpr.d.member.d.value);
                }

                if (constantValue !== undefined && typeof constantValue === 'string') {
                    return _evaluateStrComparisonToStringList(operator, rightExpr, constantValue);
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
            node.d.member.d.value === 'TYPE_CHECKING' &&
            node.d.leftExpr.nodeType === ParseNodeType.Name &&
            (_isImportedModuleName(node.d.leftExpr, 'typing', scope) ||
                _isImportedModuleName(node.d.leftExpr, 'typing_extensions', scope))
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

// Compares sys.version_info with the tuple as Python compares tuples. Returns undefined
// if the result depends on a part of the version that isn't configured.
function _compareVersionInfoToTuple(version: PythonVersion, node: TupleNode): number | undefined {
    const versionInfo = [version.major, version.minor, version.micro, version.releaseLevel, version.serial];

    for (let i = 0; i < node.d.items.length; i++) {
        if (i >= versionInfo.length) {
            return -1;
        }

        const value = versionInfo[i];
        const item = node.d.items[i];

        if (typeof value === 'number') {
            if (item.nodeType !== ParseNodeType.Number || item.d.isImaginary || typeof item.d.value !== 'number') {
                return undefined;
            }

            if (value !== item.d.value) {
                return value < item.d.value ? -1 : 1;
            }
        } else if (typeof value === 'string') {
            if (
                item.nodeType !== ParseNodeType.StringList ||
                item.d.strings.length !== 1 ||
                item.d.strings[0].nodeType !== ParseNodeType.String ||
                item.d.strings[0].d.token.flags & StringTokenFlags.Bytes
            ) {
                return undefined;
            }

            const itemValue = item.d.strings[0].d.value;
            if (value !== itemValue) {
                return value < itemValue ? -1 : 1;
            }
        } else {
            return undefined;
        }
    }

    return node.d.items.length < versionInfo.length ? 1 : 0;
}

function _evaluateComparisonResult(operatorType: OperatorType, comparison: number | undefined): boolean | undefined {
    if (comparison === undefined) {
        return undefined;
    }

    switch (operatorType) {
        case OperatorType.LessThan:
            return comparison < 0;
        case OperatorType.LessThanOrEqual:
            return comparison <= 0;
        case OperatorType.GreaterThan:
            return comparison > 0;
        case OperatorType.GreaterThanOrEqual:
            return comparison >= 0;
        case OperatorType.Equals:
            return comparison === 0;
        case OperatorType.NotEquals:
            return comparison !== 0;
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

function _evaluateStrComparisonToStringList(
    operator: OperatorType,
    node: StringListNode,
    expectedValue: string | undefined
): boolean | undefined {
    if (node.d.strings.some((s) => s.nodeType === ParseNodeType.FormatString)) {
        return undefined;
    }
    if (node.d.strings.some((s) => s.d.token.flags & StringTokenFlags.Bytes)) {
        if (operator === OperatorType.Equals) {
            return false;
        } else if (operator === OperatorType.NotEquals) {
            return true;
        } else {
            return undefined;
        }
    }
    return _evaluateStringBinaryOperation(operator, expectedValue, node.d.strings.map((s) => s.d.value).join(''));
}

function _isStaticComparisonLiteral(node: ExpressionNode): boolean {
    return (
        node.nodeType === ParseNodeType.Tuple ||
        node.nodeType === ParseNodeType.Number ||
        node.nodeType === ParseNodeType.StringList
    );
}

function _isSysVersionInfoExpression(node: ExpressionNode, scope: Scope | undefined): boolean {
    if (node.nodeType === ParseNodeType.MemberAccess) {
        if (node.d.leftExpr.nodeType === ParseNodeType.Name && node.d.member.d.value === 'version_info') {
            return _isImportedModuleName(node.d.leftExpr, 'sys', scope);
        }
    }

    return false;
}

function _isSysPlatformInfoExpression(node: ExpressionNode, scope: Scope | undefined): boolean {
    if (node.nodeType === ParseNodeType.MemberAccess) {
        if (node.d.leftExpr.nodeType === ParseNodeType.Name && node.d.member.d.value === 'platform') {
            return _isImportedModuleName(node.d.leftExpr, 'sys', scope);
        }
    }

    return false;
}

function _isOsNameInfoExpression(node: ExpressionNode, scope: Scope | undefined): boolean {
    if (node.nodeType === ParseNodeType.MemberAccess) {
        if (node.d.leftExpr.nodeType === ParseNodeType.Name && node.d.member.d.value === 'name') {
            return _isImportedModuleName(node.d.leftExpr, 'os', scope);
        }
    }

    return false;
}

function _isImportedModuleName(node: NameNode, moduleName: string, scope: Scope | undefined): boolean {
    const declarations = scope?.lookUpSymbolRecursive(node.d.value)?.symbol.getDeclarations() ?? [];

    return (
        declarations.length > 0 &&
        declarations.every(
            (decl) => decl.type === DeclarationType.Alias && decl.moduleName === moduleName && !decl.symbolName
        )
    );
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
