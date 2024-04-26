/*
 * scopeUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Static utility methods related to scopes and their related
 * symbol tables.
 */

import { EvaluationScopeNode, ParseNode } from '../parser/parseNodes';
import { getScope } from './analyzerNodeInfo';
import { getEvaluationScopeNode } from './parseTreeUtils';
import { Scope, ScopeType } from './scope';

export function getBuiltInScope(currentScope: Scope): Scope {
    // Starting at the current scope, find the built-in scope, which should
    // be the top-most parent.
    let builtInScope = currentScope;

    while (builtInScope.type !== ScopeType.Builtin) {
        builtInScope = builtInScope.parent!;
    }

    return builtInScope;
}

// Locates the evaluation scope associated with the specified parse node.
export function getScopeForNode(node: ParseNode): Scope | undefined {
    const scopeNode = getEvaluationScopeNode(node).node;
    return getScope(scopeNode);
}

// Returns a list of scopes associated with the node and its ancestor nodes.
// If stopScope is provided, the search will stop at that scope.
// Returns undefined if stopScope is not found.
export function getScopeHierarchy(node: ParseNode, stopScope?: Scope): Scope[] | undefined {
    const scopeHierarchy: Scope[] = [];
    let curNode: ParseNode | undefined = node;

    while (curNode) {
        const scopeNode: EvaluationScopeNode = getEvaluationScopeNode(curNode).node;
        const curScope = getScope(scopeNode);

        if (!curScope) {
            return undefined;
        }

        if (scopeHierarchy.length === 0 || scopeHierarchy[scopeHierarchy.length - 1] !== curScope) {
            scopeHierarchy.push(curScope);
        }

        if (curScope === stopScope) {
            return scopeHierarchy;
        }

        curNode = scopeNode.parent;
    }

    return stopScope ? undefined : scopeHierarchy;
}

// Walks up the parse tree from the specified node to find the top-most node
// that is within specified scope.
export function findTopNodeInScope(node: ParseNode, scope: Scope): ParseNode | undefined {
    let curNode: ParseNode | undefined = node;
    let prevNode: ParseNode | undefined;
    let foundScope = false;

    while (curNode) {
        if (getScope(curNode) === scope) {
            foundScope = true;
        } else if (foundScope) {
            return prevNode;
        }

        prevNode = curNode;
        curNode = curNode.parent;
    }

    return undefined;
}

export function isScopeContainedWithin(scope: Scope, potentialParentScope: Scope): boolean {
    let curScope: Scope | undefined = scope;

    while (curScope) {
        if (curScope.parent === potentialParentScope) {
            return true;
        }

        curScope = curScope.parent;
    }

    return false;
}
