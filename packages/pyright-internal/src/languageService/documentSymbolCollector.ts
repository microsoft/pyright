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
    createSynthesizedAliasDeclaration,
    getDeclarationsWithUsesLocalNameRemoved,
} from '../analyzer/declarationUtils';
import { getModuleNode, getStringNodeValueRange } from '../analyzer/parseTreeUtils';
import { ParseTreeWalker } from '../analyzer/parseTreeWalker';
import * as ScopeUtils from '../analyzer/scopeUtils';
import { isStubFile, SourceMapper } from '../analyzer/sourceMapper';
import { TypeEvaluator } from '../analyzer/typeEvaluatorTypes';
import { TypeCategory } from '../analyzer/types';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { TextRange } from '../common/textRange';
import { ImportAsNode, NameNode, ParseNode, ParseNodeType, StringNode } from '../parser/parseNodes';

export type CollectionResult = {
    node: NameNode | StringNode;
    range: TextRange;
};

// This walker looks for symbols that are semantically equivalent
// to the requested symbol.
export class DocumentSymbolCollector extends ParseTreeWalker {
    static collectFromNode(
        node: NameNode,
        evaluator: TypeEvaluator,
        cancellationToken: CancellationToken,
        startingNode?: ParseNode,
        treatModuleInImportAndFromImportSame = false
    ): CollectionResult[] {
        const symbolName = node.value;
        const declarations = this.getDeclarationsForNode(
            node,
            evaluator,
            /* resolveLocalName */ true,
            cancellationToken
        );

        startingNode = startingNode ?? getModuleNode(node);
        if (!startingNode) {
            return [];
        }

        const collector = new DocumentSymbolCollector(
            symbolName,
            declarations,
            evaluator,
            cancellationToken,
            startingNode,
            treatModuleInImportAndFromImportSame
        );

        return collector.collect();
    }

    static getDeclarationsForNode(
        node: NameNode,
        evaluator: TypeEvaluator,
        resolveLocalName: boolean,
        token: CancellationToken,
        sourceMapper?: SourceMapper
    ): Declaration[] {
        throwIfCancellationRequested(token);

        const declarations = this._getDeclarationsForNode(node, evaluator);

        const resolvedDeclarations: Declaration[] = [];
        declarations.forEach((decl) => {
            const resolvedDecl = evaluator.resolveAliasDeclaration(decl, resolveLocalName);
            if (resolvedDecl) {
                resolvedDeclarations.push(resolvedDecl);

                if (sourceMapper && isStubFile(resolvedDecl.path)) {
                    const implDecls = sourceMapper.findDeclarations(resolvedDecl);
                    for (const implDecl of implDecls) {
                        if (implDecl && implDecl.path) {
                            this._addIfUnique(resolvedDeclarations, implDecl);
                        }
                    }
                }
            }
        });

        return resolvedDeclarations;
    }

    private _results: CollectionResult[] = [];
    private _dunderAllNameNodes = new Set<StringNode>();

    constructor(
        private _symbolName: string,
        private _declarations: Declaration[],
        private _evaluator: TypeEvaluator,
        private _cancellationToken: CancellationToken,
        private _startingNode: ParseNode,
        private _treatModuleInImportAndFromImportSame = false
    ) {
        super();

        // Don't report strings in __all__ right away, that will
        // break the assumption on the result ordering.
        this._setDunderAllNodes(this._startingNode);
    }

    collect() {
        this.walk(this._startingNode);
        return this._results;
    }

    override walk(node: ParseNode) {
        if (!AnalyzerNodeInfo.isCodeUnreachable(node)) {
            super.walk(node);
        }
    }

    override visitName(node: NameNode): boolean {
        throwIfCancellationRequested(this._cancellationToken);

        // No need to do any more work if the symbol name doesn't match.
        if (node.value !== this._symbolName) {
            return false;
        }

        if (this._declarations.length > 0) {
            const declarations = DocumentSymbolCollector._getDeclarationsForNode(node, this._evaluator);

            if (declarations && declarations.length > 0) {
                // Does this name share a declaration with the symbol of interest?
                if (declarations.some((decl) => this._resultsContainsDeclaration(decl))) {
                    this._addResult(node);
                }
            }
        } else {
            // There were no declarations
            this._addResult(node);
        }

        return false;
    }

    override visitString(node: StringNode): boolean {
        throwIfCancellationRequested(this._cancellationToken);

        if (this._dunderAllNameNodes.has(node)) {
            this._addResult(node);
        }

        return false;
    }

    private _addResult(node: NameNode | StringNode) {
        const range: TextRange = node.nodeType === ParseNodeType.Name ? node : getStringNodeValueRange(node);
        this._results.push({ node, range });
    }

    private _resultsContainsDeclaration(declaration: Declaration) {
        // Resolve the declaration.
        const resolvedDecl = this._evaluator.resolveAliasDeclaration(declaration, /* resolveLocalNames */ false);
        if (!resolvedDecl) {
            return false;
        }

        // The reference results declarations are already resolved, so we don't
        // need to call resolveAliasDeclaration on them.
        if (
            this._declarations.some((decl) =>
                areDeclarationsSame(decl, resolvedDecl, this._treatModuleInImportAndFromImportSame)
            )
        ) {
            return true;
        }

        // We didn't find the declaration using local-only alias resolution. Attempt
        // it again by fully resolving the alias.
        const resolvedDeclNonlocal = this._getResolveAliasDeclaration(resolvedDecl);
        if (!resolvedDeclNonlocal || resolvedDeclNonlocal === resolvedDecl) {
            return false;
        }

        return this._declarations.some((decl) =>
            areDeclarationsSame(decl, resolvedDeclNonlocal, this._treatModuleInImportAndFromImportSame)
        );
    }

    private _getResolveAliasDeclaration(declaration: Declaration) {
        // TypeEvaluator.resolveAliasDeclaration only resolve alias in AliasDeclaration in the form of
        // "from x import y as [y]" but don't do thing for alias in "import x as [x]"
        // Here, alias should have same name as module name.
        if (isAliasDeclFromImportAsWithAlias(declaration)) {
            return getDeclarationsWithUsesLocalNameRemoved([declaration])[0];
        }

        const resolvedDecl = this._evaluator.resolveAliasDeclaration(declaration, /* resolveLocalNames */ true);
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
            if (stringNode.value !== this._symbolName) {
                return;
            }

            const symbolInScope = moduleScope.lookUpSymbolRecursive(stringNode.value);
            if (!symbolInScope) {
                return;
            }

            if (!symbolInScope.symbol.getDeclarations().some((d) => this._resultsContainsDeclaration(d))) {
                return;
            }

            this._dunderAllNameNodes.add(stringNode);
        });
    }

    private static _addIfUnique(declarations: Declaration[], itemToAdd: Declaration) {
        for (const def of declarations) {
            if (areDeclarationsSame(def, itemToAdd)) {
                return;
            }
        }

        declarations.push(itemToAdd);
    }

    private static _getDeclarationsForNode(node: NameNode, evaluator: TypeEvaluator): Declaration[] {
        // This can handle symbols brought in by wildcard as long as declarations symbol collector
        // compare against point to actual alias declaration, not one that use local name (ex, import alias)
        if (node.parent?.nodeType !== ParseNodeType.ModuleName) {
            let decls = evaluator.getDeclarationsForNameNode(node) || [];

            if (node.parent?.nodeType === ParseNodeType.ImportFromAs) {
                // Make sure we get the decl for this specific from import statement
                decls = decls.filter((d) => d.node === node.parent);
            }

            // If we can't get decl, see whether we can get type from the node.
            // Some might have synthesized type for the node such as subModule in import X.Y statement.
            if (decls.length === 0) {
                const type = evaluator.getType(node);
                if (type?.category === TypeCategory.Module) {
                    // Synthesize decl for the module.
                    return [createSynthesizedAliasDeclaration(type.filePath)];
                }
            }

            // We would like to make X in import X and import X.Y as Y to match, but path for
            // X in import X and one in import X.Y as Y might not match since path in X.Y will point
            // to X.Y rather than X if import statement has an alias.
            // so, for such case, we put synthesized one so we can treat X in both statement same.
            for (const aliasDecl of decls.filter((d) => isAliasDeclaration(d) && !d.loadSymbolsFromPath)) {
                const node = (aliasDecl as AliasDeclaration).node;
                if (node.nodeType === ParseNodeType.ImportFromAs) {
                    // from ... import X case, decl in the submodulefallback has the path.
                    continue;
                }

                decls.push(...(evaluator.getDeclarationsForNameNode(node.module.nameParts[0]) || []));
            }

            return decls;
        }

        // We treat module name special in find all references. so symbol highlight or rename on multiple files
        // works even if it is not actually a symbol defined in the file.
        const moduleName = node.parent;
        if (
            moduleName.parent?.nodeType === ParseNodeType.ImportAs ||
            moduleName.parent?.nodeType === ParseNodeType.ImportFrom
        ) {
            const index = moduleName.nameParts.findIndex((n) => n === node);

            // Special case, first module name part.
            if (index === 0) {
                // 1. import X or from X import ...
                let decls: Declaration[] = [];

                // ex, import X as x
                const isImportAsWithAlias =
                    moduleName.nameParts.length === 1 &&
                    moduleName.parent.nodeType === ParseNodeType.ImportAs &&
                    !!moduleName.parent.alias;

                // if "import" has alias, symbol is assigned to alias, not the module.
                const importName = isImportAsWithAlias
                    ? (moduleName.parent as ImportAsNode).alias!.value
                    : moduleName.nameParts[0].value;

                // First, we need to re-use "decls for X" binder has created
                // so that it matches with decls type evaluator returns for "references for X".
                // ex) import X or from .X import ... in init file and etc.
                const symbolWithScope = ScopeUtils.getScopeForNode(node)?.lookUpSymbolRecursive(importName);
                if (symbolWithScope && moduleName.nameParts.length === 1) {
                    decls.push(...symbolWithScope.symbol.getDeclarations().filter((d) => isAliasDeclaration(d)));

                    // If symbols are re-used, then find one that belong to this import statement.
                    if (decls.length > 1) {
                        decls = decls.filter((d) => {
                            d = d as AliasDeclaration;

                            if (d.firstNamePart !== undefined) {
                                // For multiple import statements with sub modules, decl can be re-used.
                                // ex) import X.Y and import X.Z or from .X import ... in init file.
                                // Decls for X will be reused for both import statements, and node will point
                                // to first import statement. For those case, use firstNamePart instead to check.
                                return d.firstNamePart === moduleName.nameParts[0].value;
                            }

                            return d.node === moduleName.parent;
                        });
                    }

                    // ex, import X as x
                    // We have decls for the alias "x" not the module name "X". Convert decls for the "X"
                    if (isImportAsWithAlias) {
                        decls = getDeclarationsWithUsesLocalNameRemoved(decls);
                    }
                }

                // But, also, we need to put decls for module names type evaluator synthesized so that
                // we can match both "import X" and "from X import ..."
                decls.push(
                    ...(evaluator
                        .getDeclarationsForNameNode(moduleName.nameParts[0])
                        ?.filter((d) => isAliasDeclaration(d)) || [])
                );

                return decls;
            }

            if (index > 0) {
                // 2. import X.Y or from X.Y import ....
                // For submodule "Y", we just use synthesized decls from type evaluator.
                // Decls for these sub module don't actually exist in the system. Instead, symbol for Y in
                // "import X.Y" hold onto synthesized module type (without any decl).
                // And "from X.Y import ..." doesn't have any symbol associated module names.
                // they can't be referenced in the module.
                return evaluator.getDeclarationsForNameNode(moduleName.nameParts[index]) || [];
            }

            return [];
        }

        return [];
    }
}
