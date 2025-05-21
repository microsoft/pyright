/*
 * documentSymbolCollector.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Collects symbols within the given tree that are semantically
 * equivalent to the requested symbol.
 */

import { CancellationToken } from 'vscode-languageserver';

import * as AnalyzerNodeInfo from '../analyzer/analyzerNodeInfo';
import { AliasDeclaration, Declaration, DeclarationType, isAliasDeclaration } from '../analyzer/declaration';
import {
    areDeclarationsSame,
    getDeclarationsWithUsesLocalNameRemoved,
    synthesizeAliasDeclaration,
} from '../analyzer/declarationUtils';
import { getModuleNode, getStringNodeValueRange } from '../analyzer/parseTreeUtils';
import { ParseTreeWalker } from '../analyzer/parseTreeWalker';
import { ScopeType } from '../analyzer/scope';
import * as ScopeUtils from '../analyzer/scopeUtils';
import { IPythonMode } from '../analyzer/sourceFile';
import { collectImportedByCells } from '../analyzer/sourceFileInfoUtils';
import { isStubFile } from '../analyzer/sourceMapper';
import { Symbol } from '../analyzer/symbol';
import { TypeEvaluator } from '../analyzer/typeEvaluatorTypes';
import { TypeCategory } from '../analyzer/types';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { appendArray } from '../common/collectionUtils';
import { isDefined } from '../common/core';
import { assert } from '../common/debug';
import { ProgramView, ReferenceUseCase, SymbolUsageProvider } from '../common/extensibility';
import { ServiceKeys } from '../common/serviceKeys';
import { TextRange } from '../common/textRange';
import { ImportAsNode, NameNode, ParseNode, ParseNodeType, StringListNode, StringNode } from '../parser/parseNodes';

export type CollectionResult = {
    node: NameNode | StringNode;
    range: TextRange;
};

export interface DocumentSymbolCollectorOptions {
    readonly treatModuleInImportAndFromImportSame?: boolean;
    readonly skipUnreachableCode?: boolean;
    readonly useCase?: ReferenceUseCase;

    /**
     * If `providers` are set, `collector` will assume
     * `appendSymbolNamesTo` and `appendDeclarationsTo` have already
     * been handled and will not call them again.
     *
     * If `collector` will result in the same `providers`, `symbolNames`, and `decls` for
     * all files, set `providers` so that `collector` doesn't need to perform the same work
     * repeatedly for all files.
     */
    readonly providers?: readonly SymbolUsageProvider[];
}

// 99% of time, `find all references` is looking for a symbol imported from the other file to this file.
// By caching the result of `resolveAlias` we only need to resolve it once per a file.
const withLocalNamesCacheIndex = 0;
const withoutLocalNamesCacheIndex = 1;

type CacheEntry = { original: Declaration; resolved: Declaration | undefined } | undefined;

export class AliasResolver {
    private readonly _caches: CacheEntry[] = [undefined, undefined];

    constructor(private readonly _evaluator: TypeEvaluator) {
        // Empty
    }

    resolve(declaration: Declaration, resolveLocalNames: boolean): Declaration | undefined {
        const index = resolveLocalNames ? withLocalNamesCacheIndex : withoutLocalNamesCacheIndex;

        if (this._caches[index] && this._caches[index]!.original === declaration) {
            return this._caches[index]!.resolved;
        }

        const resolved = this._evaluator.resolveAliasDeclaration(declaration, resolveLocalNames, {
            allowExternallyHiddenAccess: true,
            skipFileNeededCheck: true,
        });

        this._caches[index] = { original: declaration, resolved };
        return resolved;
    }
}

// This walker looks for symbols that are semantically equivalent
// to the requested symbol.
export class DocumentSymbolCollector extends ParseTreeWalker {
    private readonly _results: CollectionResult[] = [];
    private readonly _dunderAllNameNodes = new Set<StringNode>();
    private readonly _symbolNames: Set<string> = new Set<string>();
    private readonly _declarations: Declaration[] = [];

    private readonly _usageProviders: readonly SymbolUsageProvider[];
    private readonly _treatModuleInImportAndFromImportSame: boolean;
    private readonly _skipUnreachableCode: boolean;
    private readonly _useCase: ReferenceUseCase;

    private _aliasResolver: AliasResolver;

    constructor(
        private readonly _program: ProgramView,
        symbolNames: string[],
        declarations: Declaration[],
        private readonly _startingNode: ParseNode,
        private readonly _cancellationToken: CancellationToken,
        options?: DocumentSymbolCollectorOptions
    ) {
        super();

        this._aliasResolver = new AliasResolver(this._program.evaluator!);

        // Start with the symbols passed in
        symbolNames.forEach((s) => this._symbolNames.add(s));
        this._declarations.push(...declarations);

        this._treatModuleInImportAndFromImportSame = options?.treatModuleInImportAndFromImportSame ?? false;
        this._skipUnreachableCode = options?.skipUnreachableCode ?? true;
        this._useCase = options?.useCase ?? ReferenceUseCase.References;

        this._usageProviders =
            options?.providers ??
            (this._program.serviceProvider.tryGet(ServiceKeys.symbolUsageProviderFactory) ?? [])
                .map((f) => f.tryCreateProvider(this._useCase, declarations, this._cancellationToken))
                .filter(isDefined);

        if (options?.providers === undefined) {
            // Check whether we need to add new symbol names and declarations.
            this._usageProviders.forEach((p) => {
                p.appendSymbolNamesTo(this._symbolNames);
                p.appendDeclarationsTo(this._declarations);
            });
        }

        // Don't report strings in __all__ right away, that will
        // break the assumption on the result ordering.
        this._setDunderAllNodes(this._startingNode);
    }

    static collectFromNode(
        program: ProgramView,
        node: NameNode,
        cancellationToken: CancellationToken,
        startingNode?: ParseNode,
        options?: DocumentSymbolCollectorOptions
    ): CollectionResult[] {
        const declarations = this.getDeclarationsForNode(program, node, /* resolveLocalName */ true, cancellationToken);

        startingNode = startingNode ?? getModuleNode(node);
        if (!startingNode) {
            return [];
        }

        const collector = new DocumentSymbolCollector(
            program,
            [node.d.value],
            declarations,
            startingNode,
            cancellationToken,
            options
        );

        return collector.collect();
    }

    static getDeclarationsForNode(
        program: ProgramView,
        node: NameNode,
        resolveLocalName: boolean,
        token: CancellationToken
    ): Declaration[] {
        throwIfCancellationRequested(token);

        const evaluator = program.evaluator;
        if (!evaluator) {
            return [];
        }

        const declarations = getDeclarationsForNameNode(evaluator, node, /* skipUnreachableCode */ false);
        const fileInfo = AnalyzerNodeInfo.getFileInfo(node);
        const fileUri = fileInfo.fileUri;

        const resolvedDeclarations: Declaration[] = [];
        const sourceMapper = program.getSourceMapper(fileUri, token);
        declarations.forEach((decl) => {
            const resolvedDecl = evaluator.resolveAliasDeclaration(decl, resolveLocalName);
            if (resolvedDecl) {
                addDeclarationIfUnique(resolvedDeclarations, resolvedDecl);
                if (sourceMapper && isStubFile(resolvedDecl.uri)) {
                    const implDecls = sourceMapper.findDeclarations(resolvedDecl);
                    for (const implDecl of implDecls) {
                        if (implDecl && !implDecl.uri.isEmpty()) {
                            addDeclarationIfUnique(resolvedDeclarations, implDecl);
                        }
                    }
                }
            }
        });

        const sourceFileInfo = program.getSourceFileInfo(fileUri);
        if (sourceFileInfo && sourceFileInfo.ipythonMode === IPythonMode.CellDocs) {
            // Add declarations from chained source files
            let builtinsScope = fileInfo.builtinsScope;
            while (builtinsScope && builtinsScope.type === ScopeType.Module) {
                const symbol = builtinsScope?.lookUpSymbol(node.d.value);
                appendSymbolDeclarations(symbol, resolvedDeclarations);
                builtinsScope = builtinsScope?.parent;
            }

            // Add declarations from files that implicitly import the target file.
            const implicitlyImportedBy = collectImportedByCells(program, sourceFileInfo);
            implicitlyImportedBy.forEach((implicitImport) => {
                const parseTree = program.getParseResults(implicitImport.uri)?.parserOutput.parseTree;
                if (parseTree) {
                    const scope = AnalyzerNodeInfo.getScope(parseTree);
                    const symbol = scope?.lookUpSymbol(node.d.value);
                    appendSymbolDeclarations(symbol, resolvedDeclarations);
                }
            });
        }

        return resolvedDeclarations;

        function appendSymbolDeclarations(symbol: Symbol | undefined, declarations: Declaration[]) {
            symbol
                ?.getDeclarations()
                .filter((d) => !isAliasDeclaration(d))
                .forEach((decl) => {
                    const resolvedDecl = evaluator!.resolveAliasDeclaration(decl, resolveLocalName);
                    if (resolvedDecl) {
                        addDeclarationIfUnique(declarations, resolvedDecl);
                    }
                });
        }
    }

    collect() {
        this.walk(this._startingNode);
        return this._results;
    }

    override walk(node: ParseNode) {
        if (!this._skipUnreachableCode || !AnalyzerNodeInfo.isCodeUnreachable(node)) {
            super.walk(node);
        }
    }

    override visitName(node: NameNode): boolean {
        throwIfCancellationRequested(this._cancellationToken);

        // No need to do any more work if the symbol name doesn't match.
        if (!this._symbolNames.has(node.d.value)) {
            return false;
        }

        if (this._declarations.length > 0) {
            const declarations = getDeclarationsForNameNode(this._evaluator, node, this._skipUnreachableCode);
            if (declarations && declarations.length > 0) {
                // Does this name share a declaration with the symbol of interest?
                if (this._resultsContainsDeclaration(node, declarations)) {
                    this._addResult(node);
                }
            }
        } else {
            // There were no declarations
            this._addResult(node);
        }

        return false;
    }

    override visitStringList(node: StringListNode): boolean {
        // See if we have reference that matches this node.
        if (this._declarations.some((d) => d.node?.id === node.id)) {
            // Then the matching string should be included
            const matching = node.d.strings.find((s) => this._symbolNames.has(s.d.value));
            if (matching && matching.nodeType === ParseNodeType.String) {
                this._addResult(matching);
            }
        }

        return super.visitStringList(node);
    }

    override visitString(node: StringNode): boolean {
        throwIfCancellationRequested(this._cancellationToken);

        if (this._dunderAllNameNodes.has(node)) {
            this._addResult(node);
        }

        return false;
    }

    private get _evaluator(): TypeEvaluator {
        return this._program.evaluator!;
    }

    private _addResult(node: NameNode | StringNode) {
        const range: TextRange = node.nodeType === ParseNodeType.Name ? node.d.token : getStringNodeValueRange(node);
        this._results.push({ node, range });
    }

    private _isDeclarationAllowed(resolvedDecl: Declaration) {
        return this._declarations.some((decl) =>
            areDeclarationsSame(
                decl,
                resolvedDecl,
                this._treatModuleInImportAndFromImportSame,
                /* skipRangeForAliases */ true
            )
        );
    }

    private _resultsContainsDeclaration(usage: ParseNode, declarations: readonly Declaration[]) {
        const results = [...declarations];
        this._usageProviders.forEach((p) => p.appendDeclarationsAt(usage, declarations, results));

        return results.some((declaration) => {
            // Resolve the declaration.
            const resolvedDecl = this._aliasResolver.resolve(declaration, /* resolveLocalNames */ false);
            if (!resolvedDecl) {
                return false;
            }

            // The reference results declarations are already resolved, so we don't
            // need to call resolveAliasDeclaration on them.
            if (this._isDeclarationAllowed(resolvedDecl)) {
                return true;
            }

            // We didn't find the declaration using local-only alias resolution. Attempt
            // it again by fully resolving the alias.
            const resolvedDeclNonlocal = this._getResolveAliasDeclaration(resolvedDecl);
            if (!resolvedDeclNonlocal || resolvedDeclNonlocal === resolvedDecl) {
                return false;
            }

            return this._isDeclarationAllowed(resolvedDeclNonlocal);
        });
    }

    private _getResolveAliasDeclaration(declaration: Declaration) {
        // TypeEvaluator.resolveAliasDeclaration only resolve alias in AliasDeclaration in the form of
        // "from x import y as [y]" but don't do thing for alias in "import x as [x]"
        // Here, alias should have same name as module name.
        if (isAliasDeclFromImportAsWithAlias(declaration)) {
            return getDeclarationsWithUsesLocalNameRemoved([declaration])[0];
        }

        const resolvedDecl = this._aliasResolver.resolve(declaration, /* resolveLocalNames */ true);
        return isAliasDeclFromImportAsWithAlias(resolvedDecl)
            ? getDeclarationsWithUsesLocalNameRemoved([resolvedDecl])[0]
            : resolvedDecl;

        function isAliasDeclFromImportAsWithAlias(decl?: Declaration): decl is AliasDeclaration {
            return (
                !!decl &&
                decl.type === DeclarationType.Alias &&
                decl.node &&
                decl.usesLocalName &&
                decl.node.nodeType === ParseNodeType.ImportAs
            );
        }
    }

    private _setDunderAllNodes(node: ParseNode) {
        if (node.nodeType !== ParseNodeType.Module) {
            return;
        }

        const dunderAllInfo = AnalyzerNodeInfo.getDunderAllInfo(node);
        if (!dunderAllInfo) {
            return;
        }

        const moduleScope = ScopeUtils.getScopeForNode(node);
        if (!moduleScope) {
            return;
        }

        dunderAllInfo.stringNodes.forEach((stringNode) => {
            if (!this._symbolNames.has(stringNode.d.value)) {
                return;
            }

            const symbolInScope = moduleScope.lookUpSymbolRecursive(stringNode.d.value);
            if (!symbolInScope) {
                return;
            }

            if (!this._resultsContainsDeclaration(stringNode, symbolInScope.symbol.getDeclarations())) {
                return;
            }

            this._dunderAllNameNodes.add(stringNode);
        });
    }
}

export function getDeclarationsForNameNode(evaluator: TypeEvaluator, node: NameNode, skipUnreachableCode = true) {
    // This can handle symbols brought in by wildcard (import *) as long as the declarations that the symbol collector
    // compares against point to the actual alias declaration, not one that uses local name (ex, import alias)
    if (node.parent?.nodeType !== ParseNodeType.ModuleName) {
        return _getDeclarationsForNonModuleNameNode(evaluator, node, skipUnreachableCode);
    }

    return _getDeclarationsForModuleNameNode(evaluator, node);
}

export function addDeclarationIfUnique(declarations: Declaration[], itemToAdd: Declaration) {
    for (const def of declarations) {
        if (
            areDeclarationsSame(
                def,
                itemToAdd,
                /* treatModuleInImportAndFromImportSame */ false,
                /* skipRangeForAliases */ true
            )
        ) {
            return;
        }
    }

    declarations.push(itemToAdd);
}

function _getDeclarationsForNonModuleNameNode(
    evaluator: TypeEvaluator,
    node: NameNode,
    skipUnreachableCode = true
): Declaration[] {
    assert(node.parent?.nodeType !== ParseNodeType.ModuleName);

    let decls = evaluator.getDeclInfoForNameNode(node, skipUnreachableCode)?.decls || [];
    if (node.parent?.nodeType === ParseNodeType.ImportFromAs) {
        // Make sure we get the decl for this specific "from import" statement
        decls = decls.filter((d) => d.node === node.parent);
    }

    // If we can't get decl, see whether we can get type from the node.
    // Some might have synthesized type for the node such as subModule in import X.Y statement.
    if (decls.length === 0) {
        const type = evaluator.getType(node);
        if (type?.category === TypeCategory.Module) {
            // Synthesize decl for the module.
            return [synthesizeAliasDeclaration(type.priv.fileUri)];
        }
    }

    // We would like to make X in import X and import X.Y as Y to match, but path for
    // X in import X and one in import X.Y as Y might not match since path in X.Y will point
    // to X.Y rather than X if import statement has an alias.
    // so, for such case, we put synthesized one so we can treat X in both statement same.
    for (const aliasDecl of decls.filter((d) => isAliasDeclaration(d) && !d.loadSymbolsFromPath)) {
        const node = (aliasDecl as AliasDeclaration).node;
        if (node.nodeType === ParseNodeType.ImportFromAs) {
            // from ... import X case, decl in the submodule fallback has the path.
            continue;
        }

        appendArray(
            decls,
            evaluator.getDeclInfoForNameNode(node.d.module.d.nameParts[0], skipUnreachableCode)?.decls || []
        );
    }

    return decls;
}

function _getDeclarationsForModuleNameNode(evaluator: TypeEvaluator, node: NameNode): Declaration[] {
    assert(node.parent?.nodeType === ParseNodeType.ModuleName);

    // We don't have symbols corresponding to ModuleName in our system since those
    // are not referenceable. but in "find all reference", we want to match those
    // if it refers to the same module file. Code below handles different kind of
    // ModuleName cases.
    const moduleName = node.parent;
    if (
        moduleName.parent?.nodeType === ParseNodeType.ImportAs ||
        moduleName.parent?.nodeType === ParseNodeType.ImportFrom
    ) {
        const index = moduleName.d.nameParts.findIndex((n) => n === node);

        // Special case, first module name part.
        if (index === 0) {
            // 1. import X or from X import ...
            const decls: Declaration[] = [];

            // First, we need to put decls for module names type evaluator synthesized so that
            // we can match both "import X" and "from X import ..."
            appendArray(
                decls,
                evaluator
                    .getDeclInfoForNameNode(moduleName.d.nameParts[0])
                    ?.decls?.filter((d) => isAliasDeclaration(d)) || []
            );

            if (decls.length === 0 || moduleName.parent.nodeType !== ParseNodeType.ImportAs) {
                return decls;
            }

            // If module name belong to "import xxx" not "from xxx", then see whether
            // we can get regular decls (decls created from binder, not synthesized from type eval)
            // from symbol as well.
            // ex, import X as x
            const isImportAsWithAlias =
                moduleName.d.nameParts.length === 1 &&
                moduleName.parent.nodeType === ParseNodeType.ImportAs &&
                !!moduleName.parent.d.alias;

            // if "import" has alias, symbol is assigned to alias, not the module.
            const importName = isImportAsWithAlias
                ? (moduleName.parent as ImportAsNode).d.alias!.d.value
                : moduleName.d.nameParts[0].d.value;

            // And we also need to re-use "decls for X" binder has created
            // so that it matches with decls type evaluator returns for "references for X".
            // ex) import X or from .X import ... in init file and etc.
            const symbolWithScope = ScopeUtils.getScopeForNode(node)?.lookUpSymbolRecursive(importName);
            if (symbolWithScope && moduleName.d.nameParts.length === 1) {
                let declsFromSymbol: Declaration[] = [];

                appendArray(
                    declsFromSymbol,
                    symbolWithScope.symbol.getDeclarations().filter((d) => isAliasDeclaration(d))
                );

                // If symbols are re-used, then find one that belong to this import statement.
                if (declsFromSymbol.length > 1) {
                    declsFromSymbol = declsFromSymbol.filter((d) => {
                        d = d as AliasDeclaration;

                        if (d.firstNamePart !== undefined) {
                            // For multiple import statements with sub modules, decl can be re-used.
                            // ex) import X.Y and import X.Z or from .X import ... in init file.
                            // Decls for X will be reused for both import statements, and node will point
                            // to first import statement. For those case, use firstNamePart instead to check.
                            return d.firstNamePart === moduleName.d.nameParts[0].d.value;
                        }

                        return d.node === moduleName.parent;
                    });
                }

                // ex, import X as x
                // We have decls for the alias "x" not the module name "X". Convert decls for the "X"
                if (isImportAsWithAlias) {
                    declsFromSymbol = getDeclarationsWithUsesLocalNameRemoved(declsFromSymbol);
                }

                appendArray(decls, declsFromSymbol);
            }

            return decls;
        }

        if (index > 0) {
            // 2. import X.Y or from X.Y import ....
            // For submodule "Y", we just use synthesized decls from type evaluator.
            // Decls for these sub module don't actually exist in the system. Instead, symbol for Y in
            // "import X.Y" hold onto synthesized module type (without any decl).
            // And "from X.Y import ..." doesn't have any symbol associated module names.
            // they can't be referenced in the module.
            return evaluator.getDeclInfoForNameNode(moduleName.d.nameParts[index])?.decls || [];
        }

        return [];
    }

    return [];
}
