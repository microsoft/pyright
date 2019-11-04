/*
* symbolUtils.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Collection of functions that operate on Symbol objects.
*/

import { DeclarationType } from './declaration';
import { getTypeForDeclaration } from './declarationUtils';
import { Symbol } from './symbol';
import { Type, UnknownType } from './types';

export function getEffectiveTypeOfSymbol(symbol: Symbol): Type {
    // If there's a declared type, it takes precedence.
    const declaredType = getDeclaredTypeOfSymbol(symbol);

    if (declaredType) {
        return declaredType;
    }

    return symbol.getInferredType();
}

export function getDeclaredTypeOfSymbol(symbol: Symbol): Type | undefined {
    const typedDecls = symbol.getTypedDeclarations();

    if (typedDecls.length > 0) {
        // If there's more than one declared type, we will
        // use the last one, which is assumed to supersede
        // the earlier ones.
        const lastDeclType = getTypeForDeclaration(typedDecls[typedDecls.length - 1]);
        return lastDeclType || UnknownType.create();
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
