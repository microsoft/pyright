/*
 * aliasDeclarationUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Helper functions around alias declarations.
 */

import { ImportLookup, ImportLookupResult } from './analyzerFileInfo';
import { Declaration, DeclarationType } from './declaration';
import { Symbol } from './symbol';

export interface ResolvedAliasInfo {
    declaration: Declaration;
    isPrivate: boolean;
    privatePyTypedImported?: string;
    privatePyTypedImporter?: string;
}

// If the specified declaration is an alias declaration that points to a symbol,
// it resolves the alias and looks up the symbol, then returns the first declaration
// associated with that symbol. It does this recursively if necessary. If a symbol
// lookup fails, undefined is returned. If resolveLocalNames is true, the method
// resolves aliases through local renames ("as" clauses found in import statements).
export function resolveAliasDeclaration(
    importLookup: ImportLookup,
    declaration: Declaration,
    resolveLocalNames: boolean,
    allowExternallyHiddenAccess: boolean
): ResolvedAliasInfo | undefined {
    let curDeclaration: Declaration | undefined = declaration;
    const alreadyVisited: Declaration[] = [];
    let isPrivate = false;
    let isPrivatePyTypedImport = false;
    let privatePyTypedImported: string | undefined;
    let privatePyTypedImporter: string | undefined;

    while (true) {
        if (curDeclaration.type !== DeclarationType.Alias || !curDeclaration.symbolName) {
            return {
                declaration: curDeclaration,
                isPrivate,
                privatePyTypedImported,
                privatePyTypedImporter,
            };
        }

        // If we are not supposed to follow local alias names and this
        // is a local name, don't continue to follow the alias.
        if (!resolveLocalNames && curDeclaration.usesLocalName) {
            return {
                declaration: curDeclaration,
                isPrivate,
                privatePyTypedImported,
                privatePyTypedImporter,
            };
        }

        let lookupResult: ImportLookupResult | undefined;
        if (curDeclaration.path) {
            lookupResult = importLookup(curDeclaration.path);
        }

        const symbol: Symbol | undefined = lookupResult
            ? lookupResult.symbolTable.get(curDeclaration.symbolName)
            : undefined;
        if (!symbol) {
            if (curDeclaration.submoduleFallback) {
                return resolveAliasDeclaration(
                    importLookup,
                    curDeclaration.submoduleFallback,
                    resolveLocalNames,
                    allowExternallyHiddenAccess
                );
            }
            return undefined;
        }

        if (symbol.isPrivateMember()) {
            isPrivate = true;
        }

        if (symbol.isExternallyHidden() && !allowExternallyHiddenAccess) {
            return undefined;
        }

        // Prefer declarations with specified types. If we don't have any of those,
        // fall back on declarations with inferred types.
        let declarations = symbol.getTypedDeclarations();
        if (declarations.length === 0) {
            declarations = symbol.getDeclarations();

            if (declarations.length === 0) {
                return undefined;
            }
        }

        // Prefer the last declaration in the list. This ensures that
        // we use all of the overloads if it's an overloaded function.
        curDeclaration = declarations[declarations.length - 1];

        if (isPrivatePyTypedImport) {
            privatePyTypedImported = privatePyTypedImported ?? curDeclaration?.moduleName;
        }

        if (symbol.isPrivatePyTypedImport()) {
            isPrivatePyTypedImport = true;
        }

        if (isPrivatePyTypedImport) {
            privatePyTypedImporter = privatePyTypedImporter ?? curDeclaration?.moduleName;
        }

        // Make sure we don't follow a circular list indefinitely.
        if (alreadyVisited.find((decl) => decl === curDeclaration)) {
            // If the path path of the alias points back to the original path, use the submodule
            // fallback instead. This happens in the case where a module's __init__.py file
            // imports a submodule using itself as the import target. For example, if
            // the module is foo, and the foo.__init__.py file contains the statement
            // "from foo import bar", we want to import the foo/bar.py submodule.
            if (
                curDeclaration.path === declaration.path &&
                curDeclaration.type === DeclarationType.Alias &&
                curDeclaration.submoduleFallback
            ) {
                return resolveAliasDeclaration(
                    importLookup,
                    curDeclaration.submoduleFallback,
                    resolveLocalNames,
                    allowExternallyHiddenAccess
                );
            }
            return {
                declaration,
                isPrivate,
                privatePyTypedImported,
                privatePyTypedImporter,
            };
        }
        alreadyVisited.push(curDeclaration);
    }
}
