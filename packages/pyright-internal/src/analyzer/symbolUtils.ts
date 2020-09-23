/*
 * symbolUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Collection of functions that operate on Symbol objects.
 */

import { ParseNodeType } from '../parser/parseNodes';
import { Declaration, DeclarationType } from './declaration';
import { isFinalVariableDeclaration } from './declarationUtils';
import { Symbol, SymbolTable } from './symbol';

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
    return symbol.getDeclarations().some((decl) => isFinalVariableDeclaration(decl));
}

export function getNamesInDunderAll(symbolTable: SymbolTable): string[] | undefined {
    const namesToImport: string[] = [];

    const allSymbol = symbolTable.get('__all__');
    if (allSymbol) {
        const decls = allSymbol.getDeclarations();

        // For now, we handle only the case where __all__ is defined
        // through a simple assignment. Some libraries use more complex
        // logic like __all__.extend(X) or __all__ += X. We'll punt on
        // those for now.
        if (decls.length === 1 && decls[0].type === DeclarationType.Variable) {
            const firstDecl = decls[0];
            if (firstDecl.node.parent && firstDecl.node.parent.nodeType === ParseNodeType.Assignment) {
                const expr = firstDecl.node.parent.rightExpression;
                if (expr.nodeType === ParseNodeType.List) {
                    expr.entries.forEach((listEntryNode) => {
                        if (
                            listEntryNode.nodeType === ParseNodeType.StringList &&
                            listEntryNode.strings.length === 1 &&
                            listEntryNode.strings[0].nodeType === ParseNodeType.String
                        ) {
                            namesToImport.push(listEntryNode.strings[0].value);
                        }
                    });

                    return namesToImport;
                }
            }
        }
    }

    return undefined;
}
