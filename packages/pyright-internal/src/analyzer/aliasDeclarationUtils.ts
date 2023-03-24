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
    declaration: Declaration | undefined;
    isPrivate: boolean;
    privatePyTypedImported?: string;
    privatePyTypedImporter?: string;
}

// If the specified declaration is an alias declaration that points to a symbol,
// it resolves the alias and looks up the symbol, then returns the a declaration
// (typically the last) associated with that symbol. It does this recursively if
// necessary. If a symbol lookup fails, undefined is returned. If resolveLocalNames
// is true, the method resolves aliases through local renames ("as" clauses found
// in import statements).
export function resolveAliasDeclaration(
    importLookup: ImportLookup,
    declaration: Declaration,
    resolveLocalNames: boolean,
    allowExternallyHiddenAccess: boolean
): ResolvedAliasInfo | undefined {
    let curDeclaration: Declaration | undefined = declaration;
    const alreadyVisited: Declaration[] = [];
    let isPrivate = false;

    // These variables are used to find a transition from a non-py.typed to
    // a py.typed resolution chain. In this case, if the imported symbol
    // is a private symbol (i.e. not intended to be re-exported), we store
    // the name of the importer and imported modules so the caller can
    // report an error.
    let sawPyTypedTransition = false;
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
        if (curDeclaration.path && curDeclaration.loadSymbolsFromPath) {
            lookupResult = importLookup(curDeclaration.path);
        }

        const symbol: Symbol | undefined = lookupResult
            ? lookupResult.symbolTable.get(curDeclaration.symbolName)
            : undefined;
        if (!symbol) {
            if (curDeclaration.submoduleFallback) {
                if (curDeclaration.symbolName) {
                    // See if we are resolving a specific imported symbol name and the submodule
                    // fallback cannot be resolved. For example, `from a import b`. If b is both
                    // a symbol in `a/__init__.py` and a submodule `a/b.py` and we are not using
                    // type information from this library (e.g. a non-py.typed library source file
                    // when useLibraryCodeForTypes is disabled), b should be evaluated as Unknown,
                    // not as a module.
                    if (
                        curDeclaration.submoduleFallback.type === DeclarationType.Alias &&
                        curDeclaration.submoduleFallback.path
                    ) {
                        const lookupResult = importLookup(curDeclaration.submoduleFallback.path);
                        if (!lookupResult) {
                            return undefined;
                        }
                    }
                }

                return resolveAliasDeclaration(
                    importLookup,
                    curDeclaration.submoduleFallback,
                    resolveLocalNames,
                    allowExternallyHiddenAccess
                );
            }

            // If the symbol comes from a native library, we won't
            // be able to resolve its type directly.
            if (curDeclaration.isNativeLib) {
                return {
                    declaration: undefined,
                    isPrivate,
                };
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

        // Try not to use declarations within an except suite even if it's a typed
        // declaration. These are typically used for fallback exception handling.
        declarations = declarations.filter((decl) => !decl.isInExceptSuite);

        if (declarations.length === 0) {
            declarations = symbol.getDeclarations();
            declarations = declarations.filter((decl) => !decl.isInExceptSuite);
        }

        if (declarations.length === 0) {
            // Use declarations within except clauses if there are no alternatives.
            declarations = symbol.getDeclarations();
        }

        if (declarations.length === 0) {
            return undefined;
        }

        // Prefer the last unvisited declaration in the list. This ensures that
        // we use all of the overloads if it's an overloaded function.
        const unvisitedDecls = declarations.filter((decl) => !alreadyVisited.includes(decl));
        if (unvisitedDecls.length > 0) {
            curDeclaration = unvisitedDecls[unvisitedDecls.length - 1];
        } else {
            curDeclaration = declarations[declarations.length - 1];
        }

        if (lookupResult?.isInPyTypedPackage) {
            if (!sawPyTypedTransition) {
                if (symbol.isPrivatePyTypedImport()) {
                    privatePyTypedImporter = curDeclaration?.moduleName;
                }

                // Note that we've seen a transition from a non-py.typed to a py.typed
                // import. No further check is needed.
                sawPyTypedTransition = true;
            } else {
                // If we've already seen a transition, look for the first non-private
                // symbol that is resolved so we can tell the user to import from this
                // location instead.
                if (!symbol.isPrivatePyTypedImport()) {
                    privatePyTypedImported = privatePyTypedImported ?? curDeclaration?.moduleName;
                }
            }
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
