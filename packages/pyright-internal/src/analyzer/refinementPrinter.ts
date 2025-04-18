/*
 * refinementPrinter.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Logic that converts a refinement type to a user-visible string.
 */

import { assertNever } from '../common/debug';
import { OperatorType } from '../parser/tokenizerTypes';
import { RefinementExpr, RefinementNodeType, TypeRefinement } from './refinementTypes';
import { printBytesLiteral, printStringLiteral } from './typePrinterUtils';

export interface PrintRefinementExprOptions {
    // Include scopes for refinement variables?
    printVarScopes?: boolean;

    // Surround tuples with parens?
    encloseTupleInParens?: boolean;
}

// Converts a refinement definition to its text form.
export function printRefinement(refinement: TypeRefinement, options?: PrintRefinementExprOptions): string {
    const value = printRefinementExpr(refinement.value, options);
    const condition = refinement.condition ? ` if ${printRefinementExpr(refinement.condition, options)}` : '';

    if (refinement.classDetails.baseSupportsLiteral && !condition) {
        if (
            refinement.value.nodeType === RefinementNodeType.Number ||
            refinement.value.nodeType === RefinementNodeType.String ||
            refinement.value.nodeType === RefinementNodeType.Bytes ||
            refinement.value.nodeType === RefinementNodeType.Boolean
        ) {
            return value;
        }
    }

    if (refinement.classDetails.baseSupportsStringShortcut) {
        return `"${value}${condition}"`;
    }

    return `${refinement.classDetails.className}("${value}${condition}")`;
}

export function printRefinementExpr(expr: RefinementExpr, options: PrintRefinementExprOptions = {}): string {
    switch (expr.nodeType) {
        case RefinementNodeType.Number: {
            return expr.value.toString();
        }

        case RefinementNodeType.String: {
            return printStringLiteral(expr.value, "'");
        }

        case RefinementNodeType.Bytes: {
            return printBytesLiteral(expr.value);
        }

        case RefinementNodeType.Boolean: {
            return expr.value ? 'True' : 'False';
        }

        case RefinementNodeType.Wildcard: {
            return '_';
        }

        case RefinementNodeType.Var: {
            if (options?.printVarScopes) {
                return `${expr.var.shared.name}@${expr.var.shared.scopeName}`;
            }

            return expr.var.shared.name;
        }

        case RefinementNodeType.BinaryOp: {
            // Map the operator to a string and numerical evaluation precedence.
            const operatorMap: { [key: number]: [string, number, boolean] } = {
                [OperatorType.Multiply]: ['*', 1, true],
                [OperatorType.FloorDivide]: ['//', 1, false],
                [OperatorType.Mod]: ['%', 1, false],
                [OperatorType.Add]: ['+', 2, true],
                [OperatorType.Subtract]: ['-', 2, false],
                [OperatorType.Equals]: ['==', 3, false],
                [OperatorType.NotEquals]: ['!=', 3, false],
                [OperatorType.LessThan]: ['<', 3, false],
                [OperatorType.LessThanOrEqual]: ['<=', 3, false],
                [OperatorType.GreaterThan]: ['>', 3, false],
                [OperatorType.GreaterThanOrEqual]: ['>=', 3, false],
                [OperatorType.And]: ['and', 4, true],
                [OperatorType.Or]: ['or', 5, true],
            };

            const operatorStr = operatorMap[expr.operator][0] ?? '<unknown>';
            const isCommutative = operatorMap[expr.operator][2] ?? false;

            let leftStr = printRefinementExpr(expr.leftExpr, options);
            let rightStr = printRefinementExpr(expr.rightExpr, options);

            const operatorPrecedence = operatorMap[expr.operator][1] ?? 0;

            if (expr.leftExpr.nodeType === RefinementNodeType.BinaryOp) {
                const leftPrecedence = operatorMap[expr.leftExpr.operator][1] ?? 0;
                if (leftPrecedence > operatorPrecedence) {
                    leftStr = `(${leftStr})`;
                }
            }

            if (expr.rightExpr.nodeType === RefinementNodeType.BinaryOp) {
                const rightPrecedence = operatorMap[expr.rightExpr.operator][1] ?? 0;
                const isRightCommutative = operatorMap[expr.rightExpr.operator][1] ?? 0;

                let includeParens = rightPrecedence >= operatorPrecedence;
                if (rightPrecedence === operatorPrecedence && isCommutative && isRightCommutative) {
                    includeParens = false;
                }

                if (includeParens) {
                    rightStr = `(${rightStr})`;
                }
            }

            return `${leftStr} ${operatorStr} ${rightStr}`;
        }

        case RefinementNodeType.UnaryOp: {
            const operatorMap: { [key: number]: string } = {
                [OperatorType.Add]: '+',
                [OperatorType.Subtract]: '-',
                [OperatorType.Not]: 'not ',
            };

            const operatorStr = operatorMap[expr.operator] ?? '<unknown>';
            return `${operatorStr}${printRefinementExpr(expr.expr, options)}`;
        }

        case RefinementNodeType.Tuple: {
            const entries = expr.entries.map((elem) => {
                let baseElemStr = printRefinementExpr(elem.value, options);
                if (elem.value.nodeType === RefinementNodeType.Tuple) {
                    baseElemStr = `(${baseElemStr})`;
                }
                return `${elem.isUnpacked ? '*' : ''}${baseElemStr}`;
            });

            if (expr.entries.length === 0) {
                return '()';
            }

            let tupleStr: string;
            if (expr.entries.length === 1) {
                tupleStr = `${entries[0]},`;
            } else {
                tupleStr = entries.join(', ');
            }

            if (options.encloseTupleInParens) {
                return `(${tupleStr})`;
            }

            return tupleStr;
        }

        case RefinementNodeType.Call: {
            const args = expr.args.map((arg) => printRefinementExpr(arg, { ...options, encloseTupleInParens: true }));
            return `${expr.name}(${args.join(', ')})`;
        }

        default: {
            assertNever(expr);
        }
    }
}
