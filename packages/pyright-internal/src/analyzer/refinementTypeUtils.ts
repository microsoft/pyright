/*
 * refinementTypeUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Utility functions and classes that operate upon refinement types
 * and refinement type variables.
 */

import { appendArray } from '../common/collectionUtils';
import { assertNever, fail } from '../common/debug';
import { DiagnosticAddendum } from '../common/diagnostic';
import { LocAddendum } from '../localization/localize';
import { OperatorType } from '../parser/tokenizerTypes';
import { RefinementVarMap } from './constraintSolution';
import {
    RefinementBinaryOpNode,
    RefinementBooleanNode,
    RefinementBytesNode,
    RefinementCallNode,
    RefinementExpr,
    RefinementExprType,
    RefinementNodeType,
    RefinementNumberNode,
    RefinementStringNode,
    RefinementTupleEntry,
    RefinementTupleNode,
    RefinementUnaryOpNode,
    RefinementVar,
    RefinementVarId,
    RefinementVarNode,
    RefinementWildcardNode,
    TypeRefinement,
} from './refinementTypes';

export interface RefinementOptions {
    // If provided, supplies a list of diagnostics for errors
    // encountered when evaluating the expression.
    errors?: RefinementTypeDiag[];

    // If provided, supplies a list of diagnostics for warnings
    // encountered when evaluating the expression.
    warnings?: RefinementTypeDiag[];
}

export interface EvaluateExprOptions {
    // If true, the evaluation will treat any free refinement
    // variables as wildcards.
    replaceUnknownVars?: boolean;

    refinements?: RefinementOptions;
}

export interface ApplyRefinementOptions {
    replaceUnsolved?: boolean;

    refinements?: RefinementOptions;
}

export interface RefinementTypeDiag {
    diag: DiagnosticAddendum;
}

// Transforms a refinement expression by replacing any free refinement
// variables with the expressions provided in the replacement map.
export function applySolvedRefinementVars(
    expr: RefinementExpr,
    replacementMap: RefinementVarMap,
    options?: ApplyRefinementOptions
): RefinementExpr {
    const transformer = new ApplySolvedRefinementVarsTransform(replacementMap, options ?? {});
    return transformer.apply(expr);
}

// Evaluates a set of conditions and determines whether they are all true.
export function evaluateRefinementCondition(condition: RefinementExpr, options: EvaluateExprOptions = {}): boolean {
    const errors: RefinementTypeDiag[] = [];
    const exprValue = evaluateRefinementExpression(condition, { replaceUnknownVars: true, refinements: { errors } });

    if (options.refinements?.errors) {
        appendArray(options.refinements.errors, errors);
    }

    return !isRefinementFalse(exprValue) && errors.length === 0;
}

export function getFreeRefinementVars(expr: RefinementExpr): RefinementVar[] {
    const collector = new RefinementVarsCollector();
    collector.apply(expr);
    return collector.getFreeVars();
}

export function evaluateRefinementExpression(expr: RefinementExpr, options?: EvaluateExprOptions): RefinementExpr {
    const transformer = new RefinementExprEvaluator(options ?? {});
    return transformer.apply(expr);
}

export function makeRefinementVarsBound(expr: RefinementExpr, scopeIds: RefinementVarId[]): RefinementExpr {
    const transformer = new BoundRefinementVarsTransform(scopeIds);
    return transformer.apply(expr);
}

export function makeRefinementVarsFree(expr: RefinementExpr, scopeIds: RefinementVarId[]): RefinementExpr {
    const transformer = new FreeRefinementVarsTransform(scopeIds);
    return transformer.apply(expr);
}

export function isRefinementFalse(expr: RefinementExpr): expr is RefinementNumberNode {
    return expr.nodeType === RefinementNodeType.Boolean && !expr.value;
}

export function isRefinementTrue(expr: RefinementExpr): expr is RefinementNumberNode {
    return expr.nodeType === RefinementNodeType.Boolean && !!expr.value;
}

export function isRefinementWildcard(expr: RefinementExpr): expr is RefinementWildcardNode {
    return expr.nodeType === RefinementNodeType.Wildcard;
}

export function isRefinementNumber(expr: RefinementExpr): expr is RefinementNumberNode {
    return expr.nodeType === RefinementNodeType.Number;
}

export function isRefinementString(expr: RefinementExpr): expr is RefinementStringNode {
    return expr.nodeType === RefinementNodeType.String;
}

export function isRefinementBytes(expr: RefinementExpr): expr is RefinementBytesNode {
    return expr.nodeType === RefinementNodeType.Bytes;
}

export function isRefinementBoolean(expr: RefinementExpr): expr is RefinementBooleanNode {
    return expr.nodeType === RefinementNodeType.Boolean;
}

export function isRefinementVar(expr: RefinementExpr): expr is RefinementVarNode {
    return expr.nodeType === RefinementNodeType.Var;
}

export function isRefinementBinaryOp(expr: RefinementExpr, op?: OperatorType): expr is RefinementBinaryOpNode {
    if (expr.nodeType !== RefinementNodeType.BinaryOp) {
        return false;
    }

    return op === undefined || op === expr.operator;
}

export function isRefinementUnaryOp(expr: RefinementExpr, op?: OperatorType): expr is RefinementUnaryOpNode {
    if (expr.nodeType !== RefinementNodeType.UnaryOp) {
        return false;
    }

    return op === undefined || op === expr.operator;
}

export function isRefinementLiteral(
    expr: RefinementExpr
): expr is RefinementNumberNode | RefinementStringNode | RefinementBytesNode | RefinementBooleanNode {
    return isRefinementNumber(expr) || isRefinementString(expr) || isRefinementBytes(expr) || isRefinementBoolean(expr);
}

export function isRefinementTuple(expr: RefinementExpr): expr is RefinementTupleNode {
    return expr.nodeType === RefinementNodeType.Tuple;
}

export function createTrueRefinementValue(): RefinementBooleanNode {
    return { nodeType: RefinementNodeType.Boolean, value: true };
}

export function createFalseRefinementValue(): RefinementBooleanNode {
    return { nodeType: RefinementNodeType.Boolean, value: false };
}

export function createWildcardRefinementValue(): RefinementWildcardNode {
    return { nodeType: RefinementNodeType.Wildcard };
}

export function isRefinementExprEquivalent(r1: RefinementExpr, r2: RefinementExpr): boolean {
    // Do a quick-and-dirty exact comparison.
    if (TypeRefinement.isRefinementExprSame(r1, r2)) {
        return true;
    }

    // TODO - add more logic here to handle equivalence, such
    // as operator commutativity and expansion.

    return false;
}

function getVarReplacement(refinementVar: RefinementVar): RefinementExpr | undefined {
    const conditions = refinementVar.shared.conditions;
    if (!conditions) {
        return undefined;
    }

    for (const condition of conditions) {
        const conjunctions: RefinementExpr[] = [];
        getConjunctionsRecursive(condition, conjunctions);

        for (const expr of conjunctions) {
            // Is this a condition of the form X = <expr> where X
            // is the specified refinement var?
            if (
                isRefinementBinaryOp(expr, OperatorType.Equals) &&
                isRefinementVar(expr.leftExpr) &&
                RefinementVar.isSameIgnoreBound(expr.leftExpr.var, refinementVar)
            ) {
                return makeRefinementVarsBound(expr.rightExpr, [refinementVar.scopeId]);
            }
        }
    }

    return undefined;
}

// Breaks a complex expression into individual conjunctions (expressions
// that are ANDed together).
function getConjunctionsRecursive(expr: RefinementExpr, conjunctions: RefinementExpr[]): void {
    if (isRefinementBinaryOp(expr, OperatorType.And)) {
        getConjunctionsRecursive(expr.leftExpr, conjunctions);
        getConjunctionsRecursive(expr.rightExpr, conjunctions);
        return;
    }

    conjunctions.push(expr);
}

// Class that transforms a refinement expression by replacing
// refinement variables with other expressions.
class RefinementExprTransformer {
    apply(expr: RefinementExpr): RefinementExpr {
        switch (expr.nodeType) {
            case RefinementNodeType.Number: {
                return this.transformNumber(expr);
            }

            case RefinementNodeType.String: {
                return this.transformString(expr);
            }

            case RefinementNodeType.Bytes: {
                return this.transformBytes(expr);
            }

            case RefinementNodeType.Boolean: {
                return this.transformBoolean(expr);
            }

            case RefinementNodeType.Wildcard: {
                return this.transformWildcard(expr);
            }

            case RefinementNodeType.BinaryOp: {
                return this.transformBinaryOp(expr);
            }

            case RefinementNodeType.UnaryOp: {
                return this.transformUnaryOp(expr);
            }

            case RefinementNodeType.Tuple: {
                return this.transformTuple(expr);
            }

            case RefinementNodeType.Var: {
                return this.transformVar(expr);
            }

            case RefinementNodeType.Call: {
                return this.transformCall(expr);
            }

            default: {
                assertNever(expr);
            }
        }
    }

    protected transformNumber(expr: RefinementNumberNode): RefinementExpr {
        return expr;
    }

    protected transformString(expr: RefinementStringNode): RefinementExpr {
        return expr;
    }

    protected transformBytes(expr: RefinementBytesNode): RefinementExpr {
        return expr;
    }

    protected transformBoolean(expr: RefinementBooleanNode): RefinementExpr {
        return expr;
    }

    protected transformWildcard(expr: RefinementWildcardNode): RefinementExpr {
        return expr;
    }

    protected transformBinaryOp(expr: RefinementBinaryOpNode): RefinementExpr {
        const leftExpr = this.apply(expr.leftExpr);
        const rightExpr = this.apply(expr.rightExpr);

        if (leftExpr === expr.leftExpr && rightExpr === expr.rightExpr) {
            return expr;
        }

        return { ...expr, leftExpr: leftExpr, rightExpr: rightExpr };
    }

    protected transformUnaryOp(expr: RefinementUnaryOpNode): RefinementExpr {
        const newExpr = this.apply(expr.expr);

        if (newExpr === expr.expr) {
            return expr;
        }

        return { ...expr, expr: newExpr };
    }

    protected transformTuple(expr: RefinementTupleNode): RefinementExpr {
        let didChange = false;

        const newElements = expr.entries.map((element) => {
            const newType = this.apply(element.value);
            if (newType !== element.value) {
                didChange = true;
                return { ...element, value: newType };
            }

            return element;
        });

        if (!didChange) {
            return expr;
        }

        return { ...expr, entries: newElements };
    }

    protected transformVar(expr: RefinementVarNode): RefinementExpr {
        return expr;
    }

    protected transformCall(expr: RefinementCallNode): RefinementExpr {
        let didChange = false;

        const newArgs = expr.args.map((arg) => {
            const newArg = this.apply(arg);
            if (newArg !== arg) {
                didChange = true;
            }
            return newArg;
        });

        if (!didChange) {
            return expr;
        }

        return { ...expr, args: newArgs };
    }
}

class ApplySolvedRefinementVarsTransform extends RefinementExprTransformer {
    private _pendingReplacements: Set<RefinementVarId> = new Set();

    constructor(private _replacementMap: RefinementVarMap, private _options: ApplyRefinementOptions) {
        super();
    }

    protected override transformVar(expr: RefinementVarNode): RefinementExpr {
        // Prevent infinite recursion.
        if (this._pendingReplacements.has(expr.var.id)) {
            return expr;
        }

        let replacement = this._replacementMap.get(expr.var.id);
        if (!replacement) {
            // Replace unsolved variables with a wildcard value.
            if (this._options.replaceUnsolved && !expr.var.isBound) {
                return createWildcardRefinementValue();
            }

            return expr;
        }

        this._pendingReplacements.add(expr.var.id);

        // Recursively apply the transform.
        replacement = this.apply(replacement);

        this._pendingReplacements.delete(expr.var.id);

        return replacement;
    }
}

class BoundRefinementVarsTransform extends RefinementExprTransformer {
    constructor(private _scopeIds: RefinementVarId[]) {
        super();
    }

    protected override transformVar(expr: RefinementVarNode): RefinementExpr {
        if (this._scopeIds.includes(expr.var.scopeId) && !expr.var.isBound) {
            const result: RefinementVarNode = {
                nodeType: RefinementNodeType.Var,
                var: RefinementVar.cloneAsBound(expr.var),
            };
            return result;
        }

        return expr;
    }
}

class FreeRefinementVarsTransform extends RefinementExprTransformer {
    constructor(private _scopeIds: RefinementVarId[]) {
        super();
    }

    protected override transformVar(expr: RefinementVarNode): RefinementExpr {
        if (this._scopeIds.includes(expr.var.scopeId) && expr.var.isBound) {
            const result: RefinementVarNode = {
                nodeType: RefinementNodeType.Var,
                var: RefinementVar.cloneAsFree(expr.var),
            };
            return result;
        }

        return expr;
    }
}

class RefinementVarsCollector extends RefinementExprTransformer {
    private _freeVars: Map<RefinementVarId, RefinementVar> = new Map();

    getFreeVars(): RefinementVar[] {
        return [...this._freeVars.values()];
    }

    protected override transformVar(expr: RefinementVarNode): RefinementExpr {
        if (!expr.var.isBound) {
            this._freeVars.set(expr.var.id, expr.var);
        }

        return expr;
    }
}

// Transformer that evaluates an expression, collapsing it to a
// single node if possible.
class RefinementExprEvaluator extends RefinementExprTransformer {
    // A stack of refinement variables that are currently being replaced.
    // Allows us to detect cycles in the replacement.
    private _activeReplacements: RefinementVar[] = [];

    constructor(private _options: EvaluateExprOptions) {
        super();
    }

    protected override transformVar(expr: RefinementVarNode): RefinementExpr {
        // Avoid recursion.
        if (!this._activeReplacements.some((r) => RefinementVar.isSameIgnoreBound(r, expr.var))) {
            // Does this variable have an equivalent expression?
            const replacement = getVarReplacement(expr.var);
            if (replacement) {
                this._activeReplacements.push(expr.var);
                const result = this.apply(replacement);
                this._activeReplacements.pop();

                return result;
            }
        }

        if (this._options.replaceUnknownVars && !expr.var.isBound) {
            return createWildcardRefinementValue();
        }

        return expr;
    }

    protected override transformBinaryOp(expr: RefinementBinaryOpNode): RefinementExpr {
        const result = super.transformBinaryOp(expr);
        if (result.nodeType !== RefinementNodeType.BinaryOp) {
            return result;
        }

        if (result.operator === OperatorType.And) {
            if (isRefinementFalse(result.leftExpr)) {
                return result.leftExpr;
            }

            if (isRefinementFalse(result.rightExpr)) {
                return result.rightExpr;
            }

            if (isRefinementTrue(result.leftExpr)) {
                return result.rightExpr;
            }

            if (isRefinementTrue(result.rightExpr)) {
                return result.leftExpr;
            }

            if (isRefinementWildcard(result.leftExpr)) {
                return result.leftExpr;
            }

            if (isRefinementWildcard(result.rightExpr)) {
                return result.rightExpr;
            }

            return result;
        }

        if (result.operator === OperatorType.Or) {
            if (isRefinementTrue(result.leftExpr)) {
                return result.leftExpr;
            }

            if (isRefinementTrue(result.rightExpr)) {
                return result.rightExpr;
            }

            if (isRefinementFalse(result.leftExpr)) {
                return result.rightExpr;
            }

            if (isRefinementFalse(result.rightExpr)) {
                return result.leftExpr;
            }

            if (isRefinementWildcard(result.leftExpr)) {
                return result.leftExpr;
            }

            if (isRefinementWildcard(result.rightExpr)) {
                return result.rightExpr;
            }

            return result;
        }

        // All other operations become a wildcard if either side is a wildcard.
        if (isRefinementWildcard(result.leftExpr)) {
            return result.leftExpr;
        }

        if (isRefinementWildcard(result.rightExpr)) {
            return result.rightExpr;
        }

        switch (result.operator) {
            case OperatorType.Add: {
                if (isRefinementWildcard(result.leftExpr) || isRefinementWildcard(result.rightExpr)) {
                    return createWildcardRefinementValue();
                }

                if (isRefinementNumber(result.leftExpr) && isRefinementNumber(result.rightExpr)) {
                    const newResult: RefinementNumberNode = {
                        nodeType: RefinementNodeType.Number,
                        value: this._makeNumber(BigInt(result.leftExpr.value) + BigInt(result.rightExpr.value)),
                    };
                    return newResult;
                }

                // Handle addition to 0.
                if (isRefinementNumber(result.leftExpr) && result.leftExpr.value === 0) {
                    return result.rightExpr;
                }
                if (isRefinementNumber(result.rightExpr) && result.rightExpr.value === 0) {
                    return result.leftExpr;
                }

                if (isRefinementString(result.leftExpr) && isRefinementString(result.rightExpr)) {
                    const newResult: RefinementStringNode = {
                        nodeType: RefinementNodeType.String,
                        value: result.leftExpr.value + result.rightExpr.value,
                    };
                    return newResult;
                }

                if (isRefinementBytes(result.leftExpr) && isRefinementBytes(result.rightExpr)) {
                    const newResult: RefinementBytesNode = {
                        nodeType: RefinementNodeType.Bytes,
                        value: result.leftExpr.value + result.rightExpr.value,
                    };
                    return newResult;
                }

                return this._simplifyNumericSum(result);
            }

            case OperatorType.Subtract: {
                if (isRefinementWildcard(result.leftExpr) || isRefinementWildcard(result.rightExpr)) {
                    return createWildcardRefinementValue();
                }

                if (isRefinementNumber(result.leftExpr) && isRefinementNumber(result.rightExpr)) {
                    const newResult: RefinementNumberNode = {
                        nodeType: RefinementNodeType.Number,
                        value: this._makeNumber(BigInt(result.leftExpr.value) - BigInt(result.rightExpr.value)),
                    };
                    return newResult;
                }

                // Handle subtraction from/to 0.
                if (isRefinementNumber(result.rightExpr) && result.rightExpr.value === 0) {
                    return result.leftExpr;
                }
                if (isRefinementNumber(result.leftExpr) && result.leftExpr.value === 0) {
                    return this._negateNumericValue(result.rightExpr);
                }

                return this._simplifyNumericSum(result);
            }

            case OperatorType.Multiply: {
                if (isRefinementWildcard(result.leftExpr) || isRefinementWildcard(result.rightExpr)) {
                    return createWildcardRefinementValue();
                }

                if (isRefinementNumber(result.leftExpr) && isRefinementNumber(result.rightExpr)) {
                    const newResult: RefinementNumberNode = {
                        nodeType: RefinementNodeType.Number,
                        value: this._makeNumber(BigInt(result.leftExpr.value) * BigInt(result.rightExpr.value)),
                    };
                    return newResult;
                }

                // Handle multiplication of 1.
                if (isRefinementNumber(result.leftExpr) && result.leftExpr.value === 1) {
                    return result.rightExpr;
                }
                if (isRefinementNumber(result.rightExpr) && result.rightExpr.value === 1) {
                    return result.leftExpr;
                }

                // Handle multiplication of 0.
                if (isRefinementNumber(result.leftExpr) && result.leftExpr.value === 0) {
                    return result.leftExpr;
                }
                if (isRefinementNumber(result.rightExpr) && result.rightExpr.value === 0) {
                    return result.rightExpr;
                }

                return result;
            }

            case OperatorType.FloorDivide: {
                if (isRefinementWildcard(result.leftExpr) || isRefinementWildcard(result.rightExpr)) {
                    return createWildcardRefinementValue();
                }

                if (isRefinementNumber(result.leftExpr) && isRefinementNumber(result.rightExpr)) {
                    if (result.rightExpr.value === 0) {
                        return createWildcardRefinementValue();
                    }

                    const newResult: RefinementNumberNode = {
                        nodeType: RefinementNodeType.Number,
                        value: this._makeNumber(BigInt(result.leftExpr.value) / BigInt(result.rightExpr.value)),
                    };
                    return newResult;
                }

                // Handle division by 1.
                if (isRefinementNumber(result.rightExpr) && result.rightExpr.value === 1) {
                    return result.leftExpr;
                }

                // Handle division of 0.
                if (isRefinementNumber(result.leftExpr) && result.leftExpr.value === 0) {
                    // We'll ignore the possibility of divide-by-zero here.
                    return result.leftExpr;
                }

                return result;
            }

            case OperatorType.Mod: {
                if (isRefinementWildcard(result.leftExpr) || isRefinementWildcard(result.rightExpr)) {
                    return createWildcardRefinementValue();
                }

                if (isRefinementNumber(result.leftExpr) && isRefinementNumber(result.rightExpr)) {
                    if (result.rightExpr.value === 0) {
                        return createWildcardRefinementValue();
                    }

                    const newResult: RefinementNumberNode = {
                        nodeType: RefinementNodeType.Number,
                        value: this._makeNumber(BigInt(result.leftExpr.value) % BigInt(result.rightExpr.value)),
                    };
                    return newResult;
                }

                return result;
            }

            case OperatorType.Equals: {
                if (isRefinementWildcard(result.leftExpr) || isRefinementWildcard(result.rightExpr)) {
                    return createWildcardRefinementValue();
                }

                if (isRefinementExprEquivalent(result.leftExpr, result.rightExpr)) {
                    return createTrueRefinementValue();
                }

                return createFalseRefinementValue();
            }

            case OperatorType.NotEquals: {
                if (isRefinementWildcard(result.leftExpr) || isRefinementWildcard(result.rightExpr)) {
                    return createWildcardRefinementValue();
                }

                if (isRefinementExprEquivalent(result.leftExpr, result.rightExpr)) {
                    return createFalseRefinementValue();
                }

                return createTrueRefinementValue();
            }

            case OperatorType.LessThan: {
                if (isRefinementWildcard(result.leftExpr) || isRefinementWildcard(result.rightExpr)) {
                    return createWildcardRefinementValue();
                }

                if (isRefinementNumber(result.leftExpr) && isRefinementNumber(result.rightExpr)) {
                    return result.leftExpr.value < result.rightExpr.value
                        ? createTrueRefinementValue()
                        : createFalseRefinementValue();
                }

                return this._verifyComparisonCondition(result)
                    ? createTrueRefinementValue()
                    : createFalseRefinementValue();
            }

            case OperatorType.LessThanOrEqual: {
                if (isRefinementWildcard(result.leftExpr) || isRefinementWildcard(result.rightExpr)) {
                    return createWildcardRefinementValue();
                }

                if (isRefinementNumber(result.leftExpr) && isRefinementNumber(result.rightExpr)) {
                    return result.leftExpr.value <= result.rightExpr.value
                        ? createTrueRefinementValue()
                        : createFalseRefinementValue();
                }

                return isRefinementExprEquivalent(result.leftExpr, result.rightExpr) ||
                    this._verifyComparisonCondition(result)
                    ? createTrueRefinementValue()
                    : createFalseRefinementValue();
            }

            case OperatorType.GreaterThan: {
                if (isRefinementWildcard(result.leftExpr) || isRefinementWildcard(result.rightExpr)) {
                    return createWildcardRefinementValue();
                }

                if (isRefinementNumber(result.leftExpr) && isRefinementNumber(result.rightExpr)) {
                    return result.leftExpr.value > result.rightExpr.value
                        ? createTrueRefinementValue()
                        : createFalseRefinementValue();
                }

                return this._verifyComparisonCondition(result)
                    ? createTrueRefinementValue()
                    : createFalseRefinementValue();
            }

            case OperatorType.GreaterThanOrEqual: {
                if (isRefinementWildcard(result.leftExpr) || isRefinementWildcard(result.rightExpr)) {
                    return createWildcardRefinementValue();
                }

                if (isRefinementNumber(result.leftExpr) && isRefinementNumber(result.rightExpr)) {
                    return result.leftExpr.value >= result.rightExpr.value
                        ? createTrueRefinementValue()
                        : createFalseRefinementValue();
                }

                return isRefinementExprEquivalent(result.leftExpr, result.rightExpr) ||
                    this._verifyComparisonCondition(result)
                    ? createTrueRefinementValue()
                    : createFalseRefinementValue();
            }
        }

        fail('Unexpected binary operator');
    }

    protected override transformUnaryOp(expr: RefinementUnaryOpNode): RefinementExpr {
        const result = super.transformUnaryOp(expr);
        if (result.nodeType !== RefinementNodeType.UnaryOp) {
            return result;
        }

        if (isRefinementWildcard(result.expr)) {
            return result.expr;
        }

        switch (result.operator) {
            case OperatorType.Add: {
                return result.expr;
            }

            case OperatorType.Subtract: {
                if (isRefinementNumber(result.expr)) {
                    const newResult: RefinementNumberNode = {
                        nodeType: RefinementNodeType.Number,
                        value: this._makeNumber(-BigInt(result.expr.value)),
                    };
                    return newResult;
                }

                if (isRefinementBinaryOp(result.expr)) {
                    if (result.expr.operator === OperatorType.Add || result.expr.operator === OperatorType.Subtract) {
                        const addOp: RefinementBinaryOpNode = {
                            nodeType: RefinementNodeType.BinaryOp,
                            operator: OperatorType.Add,
                            leftExpr: this._negateNumericValue(result.expr.leftExpr),
                            rightExpr:
                                result.expr.operator === OperatorType.Add
                                    ? this._negateNumericValue(result.expr.rightExpr)
                                    : result.expr.rightExpr,
                        };

                        return this.apply(addOp);
                    }
                }

                return result;
            }

            case OperatorType.Not: {
                if (isRefinementWildcard(result.expr)) {
                    return result;
                }
                return isRefinementTrue(result.expr) ? createFalseRefinementValue() : createTrueRefinementValue();
            }
        }

        fail('Unexpected unary operator');
    }

    protected override transformTuple(expr: RefinementTupleNode): RefinementExpr {
        const result = super.transformTuple(expr);
        if (result.nodeType !== RefinementNodeType.Tuple) {
            return result;
        }

        if (!result.entries.some((element) => element.isUnpacked && isRefinementTuple(element.value))) {
            return result;
        }

        // Expand any unpacked tuple entries.
        const newElements: RefinementTupleEntry[] = [];

        result.entries.forEach((element) => {
            if (element.isUnpacked && isRefinementTuple(element.value)) {
                newElements.push(...element.value.entries);
            } else {
                newElements.push(element);
            }
        });

        const newTuple: RefinementTupleNode = {
            nodeType: RefinementNodeType.Tuple,
            entries: newElements,
        };

        return newTuple;
    }

    protected override transformCall(expr: RefinementCallNode): RefinementExpr {
        const result = super.transformCall(expr);
        if (result.nodeType !== RefinementNodeType.Call) {
            return result;
        }

        switch (result.name) {
            case 'broadcast':
                return this._evalBroadcast(result, this._options);

            case 'concat':
                return this._evalConcat(result, this._options);

            case 'index':
                return this._evalIndex(result, this._options);

            case 'len':
                return this._evalLen(result, this._options);

            case 'permute':
                return this._evalPermute(result, this._options);

            case 'reshape':
                return this._evalReshape(result, this._options);

            case 'splice':
                return this._evalSplice(result, this._options);

            case 'swap':
                return this._evalSwap(result, this._options);
        }

        return result;
    }

    // Determines whether a comparison (<, <=, >, >=) is valid based on known
    // conditions for the variable.
    private _verifyComparisonCondition(expr: RefinementBinaryOpNode): boolean {
        if (
            isRefinementVar(expr.leftExpr) &&
            this._verifyComparisonConditionForVar(expr.leftExpr, expr.operator, expr.rightExpr)
        ) {
            return true;
        }

        const inverseOperator = this._getComparisonInverse(expr.operator);
        if (
            inverseOperator !== undefined &&
            isRefinementVar(expr.rightExpr) &&
            this._verifyComparisonConditionForVar(expr.rightExpr, inverseOperator, expr.leftExpr)
        ) {
            return true;
        }

        return false;
    }

    private _verifyComparisonConditionForVar(
        varNode: RefinementVarNode,
        operator: OperatorType,
        expr: RefinementExpr
    ): boolean {
        const conditions = varNode.var.shared.conditions;
        if (!conditions) {
            return false;
        }

        for (const condition of conditions) {
            const conjunctions: RefinementExpr[] = [];
            getConjunctionsRecursive(condition, conjunctions);

            for (const conditionExpr of conjunctions) {
                if (!isRefinementBinaryOp(conditionExpr, operator)) {
                    continue;
                }

                if (
                    isRefinementVar(conditionExpr.leftExpr) &&
                    RefinementVar.isSameIgnoreBound(conditionExpr.leftExpr.var, varNode.var) &&
                    conditionExpr.operator === operator &&
                    isRefinementExprEquivalent(conditionExpr.rightExpr, expr)
                ) {
                    return true;
                }

                // TODO - add more smarts to handle inequalities. For example,
                // if the condition is "a > 4", then we know that "a > 5" is
                // also true.
            }
        }

        return false;
    }

    private _getComparisonInverse(operator: OperatorType): OperatorType | undefined {
        switch (operator) {
            case OperatorType.LessThan:
                return OperatorType.GreaterThanOrEqual;

            case OperatorType.LessThanOrEqual:
                return OperatorType.GreaterThan;

            case OperatorType.GreaterThan:
                return OperatorType.LessThanOrEqual;

            case OperatorType.GreaterThanOrEqual:
                return OperatorType.LessThan;

            default:
                return undefined;
        }
    }

    private _simplifyNumericSum(expr: RefinementExpr): RefinementExpr {
        const terms = this._getSummableTermsRecursive(expr, /* negate */ false);
        if (!terms || terms.length < 2) {
            return expr;
        }

        // Combine all of the numeric terms into a single sum.
        const numericTerms = terms.filter((term) => isRefinementNumber(term));
        const remainingTerms = terms.filter((term) => !isRefinementNumber(term));

        if (numericTerms.length > 0) {
            let sum = BigInt(0);
            for (const term of numericTerms) {
                sum += BigInt(term.value);
            }

            if (sum !== BigInt(0)) {
                remainingTerms.push({ nodeType: RefinementNodeType.Number, value: this._makeNumber(sum) });
            }
        }

        if (remainingTerms.length === 1) {
            return remainingTerms[0];
        }

        let leftExpr = remainingTerms.shift()!;
        while (remainingTerms.length > 0) {
            const nextExpr = remainingTerms.shift()!;
            if (isRefinementUnaryOp(nextExpr, OperatorType.Subtract)) {
                leftExpr = {
                    nodeType: RefinementNodeType.BinaryOp,
                    operator: OperatorType.Subtract,
                    leftExpr,
                    rightExpr: nextExpr.expr,
                };
            } else {
                leftExpr = {
                    nodeType: RefinementNodeType.BinaryOp,
                    operator: OperatorType.Add,
                    leftExpr,
                    rightExpr: nextExpr,
                };
            }
        }

        return leftExpr;
    }

    // Converts an expression into a list of summable subexpressions, negating
    // them if necessary. If a non-numeric subexpression is encountered, it
    // returns undefined.
    private _getSummableTermsRecursive(expr: RefinementExpr, negate: boolean): RefinementExpr[] | undefined {
        switch (expr.nodeType) {
            case RefinementNodeType.Bytes:
            case RefinementNodeType.String:
            case RefinementNodeType.Boolean:
            case RefinementNodeType.Tuple:
                return undefined;

            case RefinementNodeType.Call:
            case RefinementNodeType.Wildcard:
                return [expr];

            case RefinementNodeType.Number:
                return [negate ? { nodeType: RefinementNodeType.Number, value: -expr.value } : expr];

            case RefinementNodeType.UnaryOp: {
                if (expr.operator === OperatorType.Subtract) {
                    return this._getSummableTermsRecursive(expr.expr, !negate);
                }

                if (expr.operator === OperatorType.Add) {
                    return this._getSummableTermsRecursive(expr.expr, negate);
                }

                return [expr];
            }

            case RefinementNodeType.BinaryOp: {
                if (expr.operator === OperatorType.Add || expr.operator === OperatorType.Subtract) {
                    const leftTerms = this._getSummableTermsRecursive(expr.leftExpr, negate);
                    const rightTerms = this._getSummableTermsRecursive(
                        expr.rightExpr,
                        expr.operator === OperatorType.Subtract ? !negate : negate
                    );

                    if (!leftTerms || !rightTerms) {
                        return undefined;
                    }

                    return [...leftTerms, ...rightTerms];
                }

                return [expr];
            }

            case RefinementNodeType.Var: {
                if (expr.var.shared.type !== RefinementExprType.Int) {
                    return undefined;
                }

                return negate
                    ? [{ nodeType: RefinementNodeType.UnaryOp, operator: OperatorType.Subtract, expr }]
                    : [expr];
            }
        }
    }

    private _negateNumericValue(expr: RefinementExpr): RefinementExpr {
        const unaryOp: RefinementUnaryOpNode = {
            nodeType: RefinementNodeType.UnaryOp,
            operator: OperatorType.Subtract,
            expr,
        };

        return this.apply(unaryOp);
    }

    private _makeNumber(value: number | bigint): number | bigint {
        if (value >= Number.MIN_SAFE_INTEGER && value <= Number.MAX_SAFE_INTEGER) {
            return Number(value);
        }
        return value;
    }

    // Evaluates the len(t) function within a refinement expression.
    private _evalLen(expr: RefinementCallNode, options?: EvaluateExprOptions): RefinementExpr {
        if (expr.args.length !== 1) {
            return expr;
        }

        const arg = expr.args[0];
        if (isRefinementTuple(arg)) {
            if (!arg.entries.some((entry) => entry.isUnpacked)) {
                return { nodeType: RefinementNodeType.Number, value: arg.entries.length };
            }
        } else if (isRefinementWildcard(arg)) {
            return createWildcardRefinementValue();
        }

        return expr;
    }

    // Evaluates the broadcast(t1, t2) function within a refinement expression.
    private _evalBroadcast(expr: RefinementCallNode, options?: EvaluateExprOptions): RefinementExpr {
        if (expr.args.length !== 2) {
            return expr;
        }

        const arg0 = expr.args[0];
        const arg1 = expr.args[1];

        if (isRefinementWildcard(arg0) || isRefinementWildcard(arg1)) {
            return createWildcardRefinementValue();
        }

        if (!isRefinementTuple(arg0) || !isRefinementTuple(arg1)) {
            return expr;
        }

        const entries0 = arg0.entries.slice().reverse();
        const entries1 = arg1.entries.slice().reverse();

        const finalEntries: RefinementTupleEntry[] = [];

        for (let i = 0; i < Math.max(entries0.length, entries1.length); i++) {
            if (i < entries0.length && i < entries1.length) {
                if (entries0[i].isUnpacked || entries1[i].isUnpacked) {
                    return expr;
                }

                const val0 = entries0[i].value;
                const val1 = entries1[i].value;

                if (isRefinementWildcard(val0) || isRefinementWildcard(val1)) {
                    finalEntries.push({ value: createWildcardRefinementValue(), isUnpacked: false });
                    continue;
                }

                if (isRefinementNumber(val0) && val0.value === 1) {
                    finalEntries.push(entries1[i]);
                    continue;
                }

                if (isRefinementNumber(val1) && val1.value === 1) {
                    finalEntries.push(entries0[i]);
                    continue;
                }

                if (isRefinementNumber(val0) && isRefinementNumber(val1)) {
                    if (val0.value !== val1.value) {
                        this._reportError(options, LocAddendum.refinementBroadcast());
                        return expr;
                    }

                    finalEntries.push(entries0[i]);
                    continue;
                }

                if (isRefinementExprEquivalent(val0, val1)) {
                    finalEntries.push(entries0[i]);
                    continue;
                }

                this._reportError(options, LocAddendum.refinementBroadcast());
                return expr;
            }

            finalEntries.push(i < entries0.length ? entries0[i] : entries1[i]);
        }

        const tupleExpr: RefinementTupleNode = {
            nodeType: RefinementNodeType.Tuple,
            entries: finalEntries.slice().reverse(),
        };

        return tupleExpr;
    }

    // Evaluates the concat(t1, t2, i1) function within a refinement expression.
    private _evalConcat(expr: RefinementCallNode, options?: EvaluateExprOptions): RefinementExpr {
        if (expr.args.length !== 3) {
            return expr;
        }

        const arg0 = expr.args[0];
        const arg1 = expr.args[1];
        const arg2 = expr.args[2];

        if (isRefinementWildcard(arg0) || isRefinementWildcard(arg1) || isRefinementWildcard(arg2)) {
            return createWildcardRefinementValue();
        }

        if (!isRefinementTuple(arg0) || !isRefinementTuple(arg1) || !isRefinementNumber(arg2)) {
            return expr;
        }

        if (
            arg0.entries.some((entry) => isRefinementWildcard(entry.value) || entry.isUnpacked) ||
            arg1.entries.some((entry) => isRefinementWildcard(entry.value) || entry.isUnpacked)
        ) {
            return expr;
        }

        const dim1 = this._getIndex(arg0, Number(arg2.value), options);
        if (dim1 === undefined) {
            return expr;
        }
        if (dim1 < 0) {
            return createWildcardRefinementValue();
        }

        const dim2 = this._getIndex(arg1, Number(arg2.value), options);
        if (dim2 === undefined) {
            return expr;
        }
        if (dim2 < 0) {
            return createWildcardRefinementValue();
        }

        // If the dimensions differ for all but the designated dimension, it's an error.
        if (arg0.entries.length !== arg1.entries.length) {
            this._reportError(options, LocAddendum.refinementConcatMismatch());
            return createWildcardRefinementValue();
        }

        for (let i = 0; i < arg0.entries.length; i++) {
            if (i !== dim1) {
                if (!isRefinementExprEquivalent(arg0.entries[i].value, arg1.entries[i].value)) {
                    this._reportError(options, LocAddendum.refinementConcatMismatch());
                    return createWildcardRefinementValue();
                }
            }
        }

        const concatDim: RefinementBinaryOpNode = {
            nodeType: RefinementNodeType.BinaryOp,
            operator: OperatorType.Add,
            leftExpr: arg0.entries[dim1].value,
            rightExpr: arg1.entries[dim1].value,
        };
        const newEntries = [...arg0.entries];
        newEntries[dim1] = { value: evaluateRefinementExpression(concatDim), isUnpacked: false };

        return { nodeType: RefinementNodeType.Tuple, entries: newEntries };
    }

    // Evaluates the splice(t1, i1, i2, t2) function within a refinement expression.
    private _evalSplice(expr: RefinementCallNode, options?: EvaluateExprOptions): RefinementExpr {
        if (expr.args.length !== 4) {
            return expr;
        }

        const arg0 = expr.args[0];
        const arg1 = expr.args[1];
        const arg2 = expr.args[2];
        const arg3 = expr.args[3];

        if (
            isRefinementWildcard(arg0) ||
            isRefinementWildcard(arg1) ||
            isRefinementWildcard(arg2) ||
            isRefinementWildcard(arg3)
        ) {
            return createWildcardRefinementValue();
        }

        if (
            !isRefinementTuple(arg0) ||
            !isRefinementNumber(arg1) ||
            !isRefinementNumber(arg2) ||
            !isRefinementTuple(arg3)
        ) {
            return expr;
        }

        const insertIndex = this._getIndex(arg0, Number(arg1.value), options, /* allowFullLength */ true);
        if (insertIndex === undefined) {
            return expr;
        }

        if (insertIndex < 0) {
            return createWildcardRefinementValue();
        }

        // Make sure the drop count is valid.
        const dropCount = Number(arg2.value);
        if (arg0.entries.length < insertIndex + dropCount) {
            if (arg0.entries.slice(insertIndex, insertIndex + dropCount).some((entry) => entry.isUnpacked)) {
                return expr;
            }

            this._reportError(
                options,
                LocAddendum.refinementIndexOutOfRange().format({ value: insertIndex + dropCount })
            );
            return createWildcardRefinementValue();
        }

        return {
            nodeType: RefinementNodeType.Tuple,
            entries: [
                ...arg0.entries.slice(0, insertIndex),
                ...arg3.entries,
                ...arg0.entries.slice(insertIndex + dropCount),
            ],
        };
    }

    // Evaluates the index(t, i) function within a refinement expression.
    private _evalIndex(expr: RefinementCallNode, options?: EvaluateExprOptions): RefinementExpr {
        if (expr.args.length !== 2) {
            return expr;
        }

        const arg0 = expr.args[0];
        const arg1 = expr.args[1];

        if (isRefinementWildcard(arg0) || isRefinementWildcard(arg1)) {
            return createWildcardRefinementValue();
        }

        if (!isRefinementTuple(arg0) || !isRefinementNumber(arg1)) {
            return expr;
        }

        const index = this._getIndex(arg0, Number(arg1.value), options);
        if (index === undefined) {
            return expr;
        }

        if (index < 0) {
            return createWildcardRefinementValue();
        }

        return arg0.entries[index].value;
    }

    // Evaluates the permute(t1, t2) function within a refinement expression.
    private _evalPermute(expr: RefinementCallNode, options?: EvaluateExprOptions): RefinementExpr {
        if (expr.args.length !== 2) {
            return expr;
        }

        const arg0 = expr.args[0];
        const arg1 = expr.args[1];

        if (isRefinementWildcard(arg0) || isRefinementWildcard(arg1)) {
            return createWildcardRefinementValue();
        }

        if (!isRefinementTuple(arg0) || !isRefinementTuple(arg1)) {
            return expr;
        }

        // We don't handle unpacked entries.
        if (arg0.entries.some((entry) => entry.isUnpacked) || arg1.entries.some((entry) => entry.isUnpacked)) {
            return expr;
        }

        // Check for mismatch in lengths.
        if (arg0.entries.length !== arg1.entries.length) {
            this._reportError(
                options,
                LocAddendum.refinementPermuteMismatch().format({
                    expected: arg0.entries.length.toString(),
                    received: arg1.entries.length.toString(),
                })
            );
            return createWildcardRefinementValue();
        }

        const seenIndices = new Set<number>();
        const newEntries: RefinementTupleEntry[] = [];

        for (let i = 0; i < arg1.entries.length; i++) {
            if (arg1.entries[i].isUnpacked) {
                return expr;
            }

            const valueExpr = arg1.entries[i].value;
            if (!isRefinementNumber(valueExpr)) {
                return expr;
            }

            const index = Number(valueExpr.value);
            const effectiveIndex = this._getIndex(arg0, index, options);

            if (effectiveIndex === undefined) {
                newEntries.push({ value: createWildcardRefinementValue(), isUnpacked: false });
                continue;
            }

            if (effectiveIndex < 0) {
                return createWildcardRefinementValue();
            }

            // Check for duplicate indices.
            if (seenIndices.has(effectiveIndex)) {
                this._reportError(options, LocAddendum.refinementPermuteDuplicate());
                return createWildcardRefinementValue();
            }

            seenIndices.add(effectiveIndex);
            newEntries.push(arg0.entries[effectiveIndex]);
        }

        // Create a new tuple with the permuted entries.
        return { nodeType: RefinementNodeType.Tuple, entries: newEntries };
    }

    // Evaluates the reshape(t1, t2) function within a refinement expression.
    private _evalReshape(expr: RefinementCallNode, options?: EvaluateExprOptions): RefinementExpr {
        if (expr.args.length !== 2) {
            return expr;
        }

        const arg0 = expr.args[0];
        const arg1 = expr.args[1];

        if (isRefinementWildcard(arg0) || isRefinementWildcard(arg1)) {
            return createWildcardRefinementValue();
        }

        if (!isRefinementTuple(arg0) || !isRefinementTuple(arg1)) {
            return expr;
        }

        // We don't handle unpacked entries.
        if (arg0.entries.some((entry) => entry.isUnpacked) || arg1.entries.some((entry) => entry.isUnpacked)) {
            return expr;
        }

        // Any wildcard entry results in a wildcard result.
        if (arg0.entries.some((entry) => isRefinementWildcard(entry.value))) {
            return arg1;
        }

        let inferIndex: number | undefined;
        let sawWildcardEntry = false;
        let srcDimProduct: RefinementExpr[] = [];
        let destDimProduct: RefinementExpr[] = [];

        arg0.entries.forEach((entry, index) => {
            if (isRefinementWildcard(entry.value)) {
                sawWildcardEntry = true;
                return;
            }

            // Treat a -1 entry in the source type as a wildcard.
            if (isRefinementNumber(entry.value) && entry.value.value === -1) {
                sawWildcardEntry = true;
                return;
            }

            srcDimProduct.push(entry.value);
        });

        arg1.entries.forEach((entry, index) => {
            if (isRefinementWildcard(entry.value)) {
                sawWildcardEntry = true;
                return;
            }

            if (isRefinementNumber(entry.value) && entry.value.value === -1) {
                if (inferIndex !== undefined) {
                    this._reportError(options, LocAddendum.refinementReshapeInferred());
                }
                inferIndex = index;
                return;
            }

            destDimProduct.push(entry.value);
        });

        // If there was one or more wildcard entry, assume success.
        if (sawWildcardEntry) {
            return arg1;
        }

        srcDimProduct = this._simplifyProduct(srcDimProduct);
        destDimProduct = this._simplifyProduct(destDimProduct);

        const dimRemaining = this._diffProduct(srcDimProduct, destDimProduct);
        if (!dimRemaining) {
            this._reportError(options, LocAddendum.refinementReshapeMismatch());
            return createWildcardRefinementValue();
        }

        if (inferIndex === undefined) {
            if (!isRefinementNumber(dimRemaining) || dimRemaining.value !== 1) {
                this._reportError(options, LocAddendum.refinementReshapeMismatch());
            }

            return arg1;
        }

        // Create a new tuple with the inferred dimension.
        const newEntries = [...arg1.entries];
        newEntries[inferIndex] = { value: dimRemaining, isUnpacked: false };

        return { nodeType: RefinementNodeType.Tuple, entries: newEntries };
    }

    // Evaluates the swap(t, i1, i2) function within a refinement expression.
    private _evalSwap(expr: RefinementCallNode, options?: EvaluateExprOptions): RefinementExpr {
        if (expr.args.length !== 3) {
            return expr;
        }

        const arg0 = expr.args[0];
        const arg1 = expr.args[1];
        const arg2 = expr.args[2];

        if (isRefinementWildcard(arg0) || isRefinementWildcard(arg1) || isRefinementWildcard(arg2)) {
            return createWildcardRefinementValue();
        }

        if (!isRefinementTuple(arg0) || !isRefinementNumber(arg1) || !isRefinementNumber(arg2)) {
            return expr;
        }

        if (arg0.entries.some((entry) => isRefinementWildcard(entry.value))) {
            return createWildcardRefinementValue();
        }

        const index1 = this._getIndex(arg0, Number(arg1.value), options);
        const index2 = this._getIndex(arg0, Number(arg2.value), options);
        if (index1 === undefined || index2 === undefined) {
            return expr;
        }

        if (index1 < 0 || index2 < 0) {
            return createWildcardRefinementValue();
        }

        const newEntries = [...arg0.entries];
        newEntries[index1] = arg0.entries[index2];
        newEntries[index2] = arg0.entries[index1];

        const result: RefinementTupleNode = {
            nodeType: RefinementNodeType.Tuple,
            entries: newEntries,
        };

        return result;
    }

    private _reportError(options: EvaluateExprOptions | undefined, message: string) {
        if (options?.refinements?.errors) {
            const diag = new DiagnosticAddendum();
            diag.addMessage(message);
            options.refinements.errors.push({ diag });
        }
    }

    // Returns the index of the specified tuple expression. Returns
    // undefined if the index cannot be determined. Logs an error if
    // the index is definitely out of range and returns a negative number.
    private _getIndex(
        tupleNode: RefinementTupleNode,
        index: number,
        options: EvaluateExprOptions | undefined,
        allowFullLength = false
    ): number | undefined {
        const entries = tupleNode.entries;

        const reportOutOfRange = () => {
            this._reportError(options, LocAddendum.refinementIndexOutOfRange().format({ value: index }));
        };

        let adjIndex = index;
        if (adjIndex >= 0) {
            if (adjIndex > entries.length || (!allowFullLength && adjIndex === entries.length)) {
                if (entries.some((entry) => entry.isUnpacked)) {
                    return undefined;
                }

                reportOutOfRange();
                return -1;
            }

            if (entries.slice(0, adjIndex + 1).some((entry) => entry.isUnpacked)) {
                return undefined;
            }
        } else {
            adjIndex = entries.length + adjIndex;
            if (adjIndex < 0) {
                if (entries.some((entry) => entry.isUnpacked)) {
                    return undefined;
                }

                reportOutOfRange();
                return -1;
            }

            if (entries.slice(adjIndex).some((entry) => entry.isUnpacked)) {
                return undefined;
            }
        }

        return adjIndex;
    }

    // Given a list of entries, computes a simplified product of the entries.
    // This includes collapsing any division operations.
    private _simplifyProduct(entries: RefinementExpr[]): RefinementExpr[] {
        let remaining = [...entries];

        // Simplify any division entries.
        remaining.forEach((entry, index) => {
            if (isRefinementBinaryOp(entry, OperatorType.FloorDivide)) {
                for (let i = 0; i < remaining.length; i++) {
                    if (i === index) {
                        continue;
                    }

                    if (isRefinementExprEquivalent(remaining[i], entry.rightExpr)) {
                        remaining[index] = entry.leftExpr;
                        remaining[i] = { nodeType: RefinementNodeType.Number, value: 1 };
                        break;
                    }
                }
            }
        });

        // Combine any numeric entries.
        const numericEntries = remaining.filter((entry) => isRefinementNumber(entry));
        remaining = remaining.filter((entry) => !isRefinementNumber(entry));

        if (numericEntries.length > 0) {
            const value = this._makeNumber(
                numericEntries.reduce((value, entry) => {
                    return BigInt(value) * BigInt(entry.value);
                }, BigInt(1))
            );

            if (remaining.length === 0 || value !== 1) {
                remaining.push({
                    nodeType: RefinementNodeType.Number,
                    value,
                });
            }
        }

        return remaining;
    }

    // Diffs two sets of refinement expressions, removing any expressions
    // from the left that are also found in the right. Combines the remaining
    // items into a single product expression. If there are expressions
    // on the right that are not found in the left, undefined is returned.
    private _diffProduct(left: RefinementExpr[], right: RefinementExpr[]): RefinementExpr | undefined {
        const remaining = [...left];

        for (const rightEntry of right) {
            const index = remaining.findIndex((leftEntry) => isRefinementExprEquivalent(leftEntry, rightEntry));
            if (index < 0) {
                return undefined;
            }

            remaining.splice(index, 1);
        }

        // Create a single product expression.
        return this._createProductRecursive(remaining);
    }

    private _createProductRecursive(entries: RefinementExpr[]): RefinementExpr {
        if (entries.length === 0) {
            return { nodeType: RefinementNodeType.Number, value: 1 };
        }

        if (entries.length === 1) {
            return entries[0];
        }

        return {
            nodeType: RefinementNodeType.BinaryOp,
            operator: OperatorType.Multiply,
            leftExpr: this._createProductRecursive(entries.slice(0, -1)),
            rightExpr: entries[entries.length - 1],
        };
    }
}
