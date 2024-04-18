/*
 * symbolUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Functions that operate on Symbol objects.
 */

import { Declaration, DeclarationType } from './declaration';
import { Symbol } from './symbol';

export function getLastTypedDeclarationForSymbol(symbol: Symbol): Declaration | undefined {
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

export function isVisibleExternally(symbol: Symbol) {
    return !symbol.isExternallyHidden() && !symbol.isPrivatePyTypedImport();
}

export function isEffectivelyClassVar(symbol: Symbol, isInDataclass: boolean) {
    if (symbol.isClassVar()) {
        return true;
    }

    if (symbol.isFinalVarInClassBody()) {
        return !isInDataclass;
    }

    return false;
}
