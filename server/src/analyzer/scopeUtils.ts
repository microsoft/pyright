/*
* scopeUtils.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Static utility methods related to scopes and their related
* symbol tables.
*/

import { ParseNode } from '../parser/parseNodes';
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
export function getScopeForNode(node: ParseNode): Scope {
    const scopeNode = getEvaluationScopeNode(node);
    return getScope(scopeNode)!;
}
