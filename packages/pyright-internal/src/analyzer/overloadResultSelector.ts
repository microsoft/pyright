/*
 * overloadResultSelector.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Bounded proof domain for the opt-in automatic overload-result experiment.
 */

import { ArgCategory, CallNode, NameNode, ParseNode, ParseNodeType } from '../parser/parseNodes';
import { DeclarationType } from './declaration';
import { TypeEvaluator } from './typeEvaluatorTypes';
import { ClassType, isAny, isClassInstance, isTypeSame, Type, Variance } from './types';

export type OverloadCoverage = 'covered' | 'not-covered' | 'unsupported';

export interface AutomaticOverloadSelection {
    candidates: readonly Type[];
    reason: string;
    coverage: OverloadCoverage[];
    matches: number[];
    units: number;
}

export class OverloadSelectionBudget {
    used = 0;
    exceeded = false;

    constructor(readonly limit: number) {}

    take() {
        if (this.used >= this.limit) {
            this.exceeded = true;
            return false;
        }
        this.used++;
        return true;
    }
}

// No MRO adaptation, protocols, variance inference, tuple/union expansion or
// TypeVar solving is part of this proof domain. Those remain ordinary calls.
export function isFixedOverloadArgumentShape(type: Type, budget: OverloadSelectionBudget): boolean {
    return isFixedOverloadShape(type, budget, /* allowAny */ true);
}

export function isFixedOverloadReturnShape(type: Type, budget: OverloadSelectionBudget): boolean {
    // Any is a coverage hole for arguments, never a concrete return witness.
    return isFixedOverloadShape(type, budget, /* allowAny */ false);
}

function isFixedOverloadShape(type: Type, budget: OverloadSelectionBudget, allowAny: boolean): boolean {
    if (!budget.take()) {
        return false;
    }
    if (isAny(type)) {
        return allowAny;
    }
    if (
        !isClassInstance(type) ||
        ClassType.isProtocolClass(type) ||
        ClassType.isTypedDictClass(type) ||
        ClassType.isPartiallyEvaluated(type) ||
        type.priv.tupleTypeArgs ||
        type.priv.literalValue !== undefined ||
        type.props?.condition ||
        type.shared.typeParams.some((p) => p.shared.declaredVariance !== Variance.Invariant)
    ) {
        return false;
    }
    const args = type.priv.typeArgs ?? [];
    return (
        args.length === type.shared.typeParams.length &&
        args.every((arg) => isFixedOverloadShape(arg, budget, allowAny))
    );
}

export function getFixedOverloadCoverage(
    source: Type,
    destination: Type,
    budget: OverloadSelectionBudget
): OverloadCoverage {
    if (!budget.take()) {
        return 'unsupported';
    }
    if (isAny(destination)) {
        return 'covered';
    }
    if (isAny(source)) {
        return 'not-covered';
    }
    if (
        !isClassInstance(source) ||
        !isClassInstance(destination) ||
        !ClassType.isSameGenericClass(source, destination)
    ) {
        return 'unsupported';
    }
    const sourceArgs = source.priv.typeArgs ?? [];
    const destArgs = destination.priv.typeArgs ?? [];
    if (sourceArgs.length !== destArgs.length) {
        return 'unsupported';
    }
    if (!sourceArgs.length) {
        return isTypeSame(source, destination) ? 'covered' : 'unsupported';
    }
    const coverage = sourceArgs.map((arg, index) => getFixedOverloadCoverage(arg, destArgs[index], budget));
    return coverage.includes('unsupported')
        ? 'unsupported'
        : coverage.includes('not-covered')
        ? 'not-covered'
        : 'covered';
}

export function hasNestedOverloadAny(type: Type): boolean {
    return isClassInstance(type) && !!type.priv.typeArgs?.some((arg) => isAny(arg) || hasNestedOverloadAny(arg));
}

// This is an over-approximation for local-use preflight, not a type match.
// Parameter-only operands avoid contextual inference and dependent producers.
export function findAutomaticOverloadSeeds(nodes: readonly ParseNode[], evaluator: TypeEvaluator): CallNode[] {
    const declarations = (name: NameNode) =>
        evaluator.lookUpSymbolRecursive(name, name.d.value, true)?.symbol.getDeclarations() ?? [];
    return nodes.filter((node): node is CallNode => {
        if (
            node.nodeType !== ParseNodeType.Call ||
            node.d.leftExpr.nodeType !== ParseNodeType.Name ||
            node.parent?.nodeType !== ParseNodeType.Assignment ||
            node.parent.d.rightExpr !== node ||
            node.d.args.length === 0 ||
            node.d.args.length > 8 ||
            node.d.args.some(
                (arg) =>
                    arg.d.argCategory !== ArgCategory.Simple ||
                    arg.d.name ||
                    arg.d.valueExpr.nodeType !== ParseNodeType.Name
            )
        ) {
            return false;
        }
        const callee = declarations(node.d.leftExpr);
        if (
            callee.length < 2 ||
            callee.length > 33 ||
            callee.some((d) => d.type !== DeclarationType.Function || d.isMethod || !d.node.d.returnAnnotation)
        ) {
            return false;
        }
        return node.d.args.every((arg) => {
            if (arg.d.valueExpr.nodeType !== ParseNodeType.Name) {
                return false;
            }
            const decls = declarations(arg.d.valueExpr);
            return decls.length === 1 && decls[0].type === DeclarationType.Param;
        });
    });
}
