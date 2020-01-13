/*
* symbolUtils.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Collection of functions that operate on Symbol objects.
*/

import { Declaration, DeclarationType } from './declaration';
import { isFinalVariableDeclaration } from './declarationUtils';
import { Symbol } from './symbol';

export function getLastTypedDeclaredForSymbol(symbol: Symbol): Declaration | undefined {
    const typedDecls = symbol.getTypedDeclarations();

    if (typedDecls.length > 0) {
        return typedDecls[typedDecls.length - 1];
    }

    return undefined;
}

// Within TypedDict classes, member variables are not accessible as
// normal attributes. Instead, they are accessed through index operations.
export function isTypedDictMemberAccessedThroughIndex(symbol: Symbol): boolean {
    const typedDecls = symbol.getTypedDeclarations();

    if (typedDecls.length > 0) {
        const lastDecl = typedDecls[typedDecls.length - 1];
        if (lastDecl.type === DeclarationType.Variable) {
            return true;
        }
    }

    return false;
}

export function isFinalVariable(symbol: Symbol): boolean {
    return symbol.getDeclarations().some(decl => isFinalVariableDeclaration(decl));
}
