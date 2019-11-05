/*
* scopeUtils.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Static utility methods related to scopes and their related
* symbol tables.
*/

import * as assert from 'assert';

import { ParseNode, ParseNodeType } from '../parser/parseNodes';
import { getScope } from './analyzerNodeInfo';
import { Scope, ScopeType } from './scope';
import { getEffectiveTypeOfSymbol } from './symbolUtils';
import { ClassType, ObjectType, Type, TypeCategory, UnknownType } from './types';

export function getBuiltInScope(currentScope: Scope): Scope {
    // Starting at the current scope, find the built-in scope, which should
    // be the top-most parent.
    let builtInScope = currentScope;

    while (builtInScope.getType() !== ScopeType.Builtin) {
        builtInScope = builtInScope.getParent()!;
    }

    return builtInScope;
}

export function getBuiltInType(currentScope: Scope, name: string): Type {
    const builtInScope = getBuiltInScope(currentScope);
    const nameType = builtInScope.lookUpSymbol(name);
    if (nameType) {
        return getEffectiveTypeOfSymbol(nameType);
    }

    return UnknownType.create();
}

export function getBuiltInObject(currentScope: Scope, className: string,
        typeArguments?: Type[]): Type {

    const nameType = getBuiltInType(currentScope, className);
    if (nameType.category === TypeCategory.Class) {
        let classType = nameType;
        if (typeArguments) {
            classType = ClassType.cloneForSpecialization(classType, typeArguments);
        }

        return ObjectType.create(classType);
    }

    return nameType;
}

// Locates the scope associated with the specified parse node. This is
// a little more complex than simply walking up the parse tree because
// some parse nodes (classes and functions) contain child nodes
// that are evaluated outside of their scopes.
export function getScopeForNode(node: ParseNode): Scope {
    let prevNode: ParseNode | undefined;
    let curNode: ParseNode | undefined = node;
    let isParamNameNode = false;

    while (curNode) {
        if (curNode.nodeType === ParseNodeType.Parameter && prevNode === curNode.name) {
            // Note that we passed through a parameter name node.
            isParamNameNode = true;
        }

        const scope = getScope(curNode);
        if (scope) {
            // We found a scope associated with this node. In most cases,
            // we'll return this scope, but in a few cases we need to return
            // the enclosing scope instead.
            if (curNode.nodeType === ParseNodeType.Function) {
                if (curNode.parameters.some(param => param === prevNode)) {
                    if (isParamNameNode) {
                        return scope;
                    }
                } else if (prevNode === curNode.suite) {
                    return scope;
                }
            } else if (curNode.nodeType === ParseNodeType.Class) {
                if (prevNode === curNode.suite) {
                    return scope;
                }
            } else {
                return scope;
            }
        }

        prevNode = curNode;
        curNode = curNode.parent;
    }

    return undefined!;
}
