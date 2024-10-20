/*
 * declarationUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Collection of static methods that operate on declarations.
 */

import { assertNever } from '../common/debug';
import { getEmptyRange } from '../common/textRange';
import { Uri } from '../common/uri/uri';
import { NameNode, ParseNodeType } from '../parser/parseNodes';
import { ImportLookup, ImportLookupResult } from './analyzerFileInfo';
import { AliasDeclaration, Declaration, DeclarationType, ModuleLoaderActions, isAliasDeclaration } from './declaration';
import { getFileInfoFromNode } from './parseTreeUtils';
import { Symbol } from './symbol';

export interface ResolvedAliasInfo {
    declaration: Declaration | undefined;
    isPrivate: boolean;
    privatePyTypedImported?: string;
    privatePyTypedImporter?: string;
}

export function hasTypeForDeclaration(declaration: Declaration): boolean {
    switch (declaration.type) {
        case DeclarationType.Intrinsic:
        case DeclarationType.Class:
        case DeclarationType.SpecialBuiltInClass:
        case DeclarationType.Function:
        case DeclarationType.TypeParam:
        case DeclarationType.TypeAlias:
            return true;

        case DeclarationType.Param: {
            if (declaration.node.d.annotation || declaration.node.d.annotationComment) {
                return true;
            }

            // Handle function type comments.
            const parameterParent = declaration.node.parent;
            if (parameterParent?.nodeType === ParseNodeType.Function) {
                if (parameterParent.d.funcAnnotationComment && !parameterParent.d.funcAnnotationComment.d.isEllipsis) {
                    const paramAnnotations = parameterParent.d.funcAnnotationComment.d.paramAnnotations;

                    // Handle the case where the annotation comment is missing an
                    // annotation for the first parameter (self or cls).
                    if (
                        parameterParent.d.params.length > paramAnnotations.length &&
                        declaration.node === parameterParent.d.params[0]
                    ) {
                        return false;
                    }

                    return true;
                }
            }
            return false;
        }

        case DeclarationType.Variable:
            return !!declaration.typeAnnotationNode;

        case DeclarationType.Alias:
            return false;
    }
}

export function areDeclarationsSame(
    decl1: Declaration,
    decl2: Declaration,
    treatModuleInImportAndFromImportSame = false,
    skipRangeForAliases = false
): boolean {
    if (decl1.type !== decl2.type) {
        return false;
    }

    if (!decl1.uri.equals(decl2.uri)) {
        return false;
    }

    if (!skipRangeForAliases || decl1.type !== DeclarationType.Alias) {
        if (
            decl1.range.start.line !== decl2.range.start.line ||
            decl1.range.start.character !== decl2.range.start.character
        ) {
            return false;
        }
    }

    // Alias declarations refer to the entire import statement.
    // We need to further differentiate.
    if (decl1.type === DeclarationType.Alias && decl2.type === DeclarationType.Alias) {
        if (decl1.symbolName !== decl2.symbolName || decl1.usesLocalName !== decl2.usesLocalName) {
            return false;
        }

        if (treatModuleInImportAndFromImportSame) {
            // Treat "module" in "import [|module|]", "from [|module|] import ..."
            // or "from ... import [|module|]" same in IDE services.
            //
            // Some case such as "from [|module|] import ...", symbol for [|module|] doesn't even
            // exist and it can't be referenced inside of a module, but nonetheless, IDE still
            // needs these sometimes for things like hover tooltip, highlight references,
            // find all references and etc.
            return true;
        }

        if (decl1.node !== decl2.node) {
            return false;
        }
    }

    return true;
}

export function getNameFromDeclaration(declaration: Declaration) {
    switch (declaration.type) {
        case DeclarationType.Alias:
            return declaration.symbolName;

        case DeclarationType.Class:
        case DeclarationType.Function:
        case DeclarationType.TypeParam:
        case DeclarationType.TypeAlias:
            return declaration.node.d.name.d.value;

        case DeclarationType.Param:
            return declaration.node.d.name?.d.value;

        case DeclarationType.Variable:
            return declaration.node.nodeType === ParseNodeType.Name ? declaration.node.d.value : undefined;

        case DeclarationType.Intrinsic:
        case DeclarationType.SpecialBuiltInClass:
            return declaration.node.nodeType === ParseNodeType.TypeAnnotation &&
                declaration.node.d.valueExpr.nodeType === ParseNodeType.Name
                ? declaration.node.d.valueExpr.d.value
                : undefined;

        default: {
            assertNever(declaration);
        }
    }

    throw new Error(`Shouldn't reach here`);
}

export function getNameNodeForDeclaration(declaration: Declaration): NameNode | undefined {
    switch (declaration.type) {
        case DeclarationType.Alias:
            if (declaration.node.nodeType === ParseNodeType.ImportAs) {
                return declaration.node.d.alias ?? declaration.node.d.module.d.nameParts[0];
            } else if (declaration.node.nodeType === ParseNodeType.ImportFromAs) {
                return declaration.node.d.alias ?? declaration.node.d.name;
            } else {
                return declaration.node.d.module.d.nameParts[0];
            }

        case DeclarationType.Class:
        case DeclarationType.Function:
        case DeclarationType.TypeParam:
        case DeclarationType.Param:
        case DeclarationType.TypeAlias:
            return declaration.node.d.name;

        case DeclarationType.Variable:
            return declaration.node.nodeType === ParseNodeType.Name ? declaration.node : undefined;

        case DeclarationType.Intrinsic:
        case DeclarationType.SpecialBuiltInClass:
            return undefined;

        default: {
            assertNever(declaration);
        }
    }

    throw new Error(`Shouldn't reach here`);
}

export function isDefinedInFile(decl: Declaration, fileUri: Uri) {
    if (isAliasDeclaration(decl)) {
        // Alias decl's path points to the original symbol
        // the alias is pointing to. So, we need to get the
        // filepath in that the alias is defined from the node.
        return getFileInfoFromNode(decl.node)?.fileUri.equals(fileUri);
    }

    // Other decls, the path points to the file the symbol is defined in.
    return decl.uri.equals(fileUri);
}

export function getDeclarationsWithUsesLocalNameRemoved(decls: Declaration[]) {
    // Make a shallow copy and clear the "usesLocalName" field.
    return decls.map((localDecl) => {
        if (localDecl.type !== DeclarationType.Alias) {
            return localDecl;
        }

        const nonLocalDecl: AliasDeclaration = { ...localDecl };
        nonLocalDecl.usesLocalName = false;
        return nonLocalDecl;
    });
}

export function synthesizeAliasDeclaration(uri: Uri): AliasDeclaration {
    // The only time this decl is used is for IDE services such as
    // the find all references, hover provider and etc.
    return {
        type: DeclarationType.Alias,
        node: undefined!,
        uri,
        loadSymbolsFromPath: false,
        range: getEmptyRange(),
        implicitImports: new Map<string, ModuleLoaderActions>(),
        usesLocalName: false,
        moduleName: '',
        isInExceptSuite: false,
    };
}

export interface ResolveAliasOptions {
    resolveLocalNames: boolean;
    allowExternallyHiddenAccess: boolean;
    skipFileNeededCheck: boolean;
}

// If the specified declaration is an alias declaration that points to a symbol,
// it resolves the alias and looks up the symbol, then returns a declaration
// (typically the last) associated with that symbol. It does this recursively if
// necessary. If a symbol lookup fails, undefined is returned. If resolveLocalNames
// is true, the method resolves aliases through local renames ("as" clauses found
// in import statements).
export function resolveAliasDeclaration(
    importLookup: ImportLookup,
    declaration: Declaration,
    options: ResolveAliasOptions
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
        if (!options.resolveLocalNames && curDeclaration.usesLocalName) {
            return {
                declaration: curDeclaration,
                isPrivate,
                privatePyTypedImported,
                privatePyTypedImporter,
            };
        }

        let lookupResult: ImportLookupResult | undefined;
        if (!curDeclaration.uri.isEmpty() && curDeclaration.loadSymbolsFromPath) {
            lookupResult = importLookup(curDeclaration.uri, {
                skipFileNeededCheck: options.skipFileNeededCheck,
            });
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
                        !curDeclaration.uri.isEmpty() &&
                        curDeclaration.submoduleFallback.type === DeclarationType.Alias &&
                        !curDeclaration.submoduleFallback.uri.isEmpty()
                    ) {
                        const lookupResult = importLookup(curDeclaration.submoduleFallback.uri, {
                            skipFileNeededCheck: options.skipFileNeededCheck,
                            skipParsing: true,
                        });
                        if (!lookupResult) {
                            return undefined;
                        }
                    }
                }

                let submoduleFallback = curDeclaration.submoduleFallback;
                if (curDeclaration.symbolName) {
                    submoduleFallback = { ...curDeclaration.submoduleFallback };
                    let baseModuleName = submoduleFallback.moduleName;

                    if (baseModuleName) {
                        baseModuleName = `${baseModuleName}.`;
                    }

                    submoduleFallback.moduleName = `${baseModuleName}${curDeclaration.symbolName}`;
                }

                return resolveAliasDeclaration(importLookup, submoduleFallback, options);
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

        if (symbol.isPrivateMember() && !sawPyTypedTransition) {
            isPrivate = true;
        }

        if (symbol.isExternallyHidden() && !options.allowExternallyHiddenAccess) {
            return undefined;
        }

        // Prefer declarations with specified types. If we don't have any of those,
        // fall back on declarations with inferred types.
        let declarations: Declaration[] = symbol.getTypedDeclarations();

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

        const prevDeclaration = curDeclaration;

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
                    privatePyTypedImporter = prevDeclaration?.moduleName;
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
            if (curDeclaration.type === DeclarationType.Alias && curDeclaration.submoduleFallback) {
                return resolveAliasDeclaration(importLookup, curDeclaration.submoduleFallback, options);
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
