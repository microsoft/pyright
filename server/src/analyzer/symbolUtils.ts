/*
* symbolUtils.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Collection of functions that operate on Symbol objects.
*/

import { ImportLookup } from './analyzerFileInfo';
import { Declaration, DeclarationType } from './declaration';
import { getInferredTypeOfDeclaration, getTypeForDeclaration } from './declarationUtils';
import { Symbol } from './symbol';
import { combineTypes, Type, UnknownType } from './types';
import { stripLiteralValue } from './typeUtils';

export function getEffectiveTypeOfSymbol(symbol: Symbol, importLookup: ImportLookup): Type {
    // If there's a declared type, it takes precedence.
    const declaredType = getDeclaredTypeOfSymbol(symbol);

    if (declaredType) {
        return declaredType;
    }

    // Determine the inferred type.
    const typesToCombine: Type[] = [];
    const isPrivate = symbol.isPrivateMember();
    symbol.getDeclarations().forEach(decl => {
        let type = getInferredTypeOfDeclaration(decl, importLookup);
        if (type) {
            const isConstant = decl.type === DeclarationType.Variable && !!decl.isConstant;

            // If the symbol is private or constant, we can retain the literal
            // value. Otherwise, strip them off to make the type less specific,
            // allowing other values to be assigned to it in subclasses.
            if (!isPrivate && !isConstant) {
                type = stripLiteralValue(type);
            }
            typesToCombine.push(type);
        }
    });

    if (typesToCombine.length > 0) {
        return combineTypes(typesToCombine);
    }

    return UnknownType.create();
}

export function getDeclaredTypeOfSymbol(symbol: Symbol): Type | undefined {
    const lastDecl = getLastTypedDeclaredForSymbol(symbol);

    if (lastDecl) {
        return getTypeForDeclaration(lastDecl) || UnknownType.create();
    }

    return undefined;
}

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
