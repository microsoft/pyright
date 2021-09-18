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

import { isCodeUnreachable } from '../analyzer/analyzerNodeInfo';
import { Declaration } from '../analyzer/declaration';
import { areDeclarationsSame } from '../analyzer/declarationUtils';
import { getModuleNode } from '../analyzer/parseTreeUtils';
import { ParseTreeWalker } from '../analyzer/parseTreeWalker';
import { TypeEvaluator } from '../analyzer/typeEvaluatorTypes';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { ModuleNameNode, NameNode, ParseNode } from '../parser/parseNodes';

// This walker looks for symbols that are semantically equivalent
// to the requested symbol.
export class DocumentSymbolCollector extends ParseTreeWalker {
    private _symbolName: string;
    private _declarations: Declaration[] = [];
    private _startingNode: ParseNode | undefined;

    constructor(
        node: NameNode,
        private _evaluator: TypeEvaluator,
        private _results: NameNode[],
        private _cancellationToken: CancellationToken,
        startingNode?: ParseNode
    ) {
        super();
        this._symbolName = node.value;

        const declarations = this._evaluator.getDeclarationsForNameNode(node) || [];

        declarations.forEach((decl) => {
            const resolvedDecl = this._evaluator.resolveAliasDeclaration(decl, /* resolveLocalNames */ true);
            if (resolvedDecl) {
                this._declarations.push(resolvedDecl);
            }
        });

        this._startingNode = startingNode ?? getModuleNode(node);
    }

    collect() {
        if (!this._startingNode) {
            return;
        }

        this.walk(this._startingNode);
    }

    override walk(node: ParseNode) {
        if (!isCodeUnreachable(node)) {
            super.walk(node);
        }
    }

    override visitModuleName(node: ModuleNameNode): boolean {
        // Don't ever look for references within a module name.
        return false;
    }

    override visitName(node: NameNode): boolean {
        throwIfCancellationRequested(this._cancellationToken);

        // No need to do any more work if the symbol name doesn't match.
        if (node.value !== this._symbolName) {
            return false;
        }

        if (this._declarations.length > 0) {
            const declarations = this._evaluator.getDeclarationsForNameNode(node);

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

        return true;
    }

    private _addResult(node: NameNode) {
        this._results.push(node);
    }

    private _resultsContainsDeclaration(declaration: Declaration) {
        // Resolve the declaration.
        const resolvedDecl = this._evaluator.resolveAliasDeclaration(declaration, /* resolveLocalNames */ false);
        if (!resolvedDecl) {
            return false;
        }

        // The reference results declarations are already resolved, so we don't
        // need to call resolveAliasDeclaration on them.
        if (this._declarations.some((decl) => areDeclarationsSame(decl, resolvedDecl))) {
            return true;
        }

        // We didn't find the declaration using local-only alias resolution. Attempt
        // it again by fully resolving the alias.
        const resolvedDeclNonlocal = this._evaluator.resolveAliasDeclaration(
            resolvedDecl,
            /* resolveLocalNames */ true
        );
        if (!resolvedDeclNonlocal || resolvedDeclNonlocal === resolvedDecl) {
            return false;
        }

        return this._declarations.some((decl) => areDeclarationsSame(decl, resolvedDeclNonlocal));
    }
}
