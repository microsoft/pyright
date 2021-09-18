/*
 * referencesProvider.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Logic that finds all of the references to a symbol specified
 * by a location within a file.
 */

import { CancellationToken } from 'vscode-languageserver';

import * as AnalyzerNodeInfo from '../analyzer/analyzerNodeInfo';
import { Declaration } from '../analyzer/declaration';
import * as DeclarationUtils from '../analyzer/declarationUtils';
import * as ParseTreeUtils from '../analyzer/parseTreeUtils';
import { ParseTreeWalker } from '../analyzer/parseTreeWalker';
import { isStubFile, SourceMapper } from '../analyzer/sourceMapper';
import { TypeEvaluator } from '../analyzer/typeEvaluatorTypes';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { convertOffsetToPosition, convertPositionToOffset } from '../common/positionUtils';
import { DocumentRange, Position } from '../common/textRange';
import { TextRange } from '../common/textRange';
import { ModuleNameNode, NameNode, ParseNode, ParseNodeType } from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';

export type ReferenceCallback = (locations: DocumentRange[]) => void;

export class ReferencesResult {
    private readonly _locations: DocumentRange[] = [];

    constructor(
        readonly requiresGlobalSearch: boolean,
        readonly nodeAtOffset: ParseNode,
        readonly symbolName: string,
        readonly declarations: Declaration[],
        private readonly _reporter?: ReferenceCallback
    ) {}

    get locations(): readonly DocumentRange[] {
        return this._locations;
    }

    addLocations(...locs: DocumentRange[]) {
        if (locs.length === 0) {
            return;
        }

        if (this._reporter) {
            this._reporter(locs);
        }

        this._locations.push(...locs);
    }
}

export class FindReferencesTreeWalker extends ParseTreeWalker {
    private readonly _locationsFound: DocumentRange[] = [];

    constructor(
        private _parseResults: ParseResults,
        private _filePath: string,
        private _referencesResult: ReferencesResult,
        private _includeDeclaration: boolean,
        private _evaluator: TypeEvaluator,
        private _cancellationToken: CancellationToken
    ) {
        super();
    }

    findReferences(rootNode = this._parseResults.parseTree) {
        this.walk(rootNode);

        return this._locationsFound;
    }

    override walk(node: ParseNode) {
        if (!AnalyzerNodeInfo.isCodeUnreachable(node)) {
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
        if (node.value !== this._referencesResult.symbolName) {
            return false;
        }

        const declarations = this._evaluator.getDeclarationsForNameNode(node);

        if (declarations && declarations.length > 0) {
            // Does this name share a declaration with the symbol of interest?
            if (declarations.some((decl) => this._resultsContainsDeclaration(decl))) {
                // Is it the same symbol?
                if (this._includeDeclaration || node !== this._referencesResult.nodeAtOffset) {
                    this._locationsFound.push({
                        path: this._filePath,
                        range: {
                            start: convertOffsetToPosition(node.start, this._parseResults.tokenizerOutput.lines),
                            end: convertOffsetToPosition(
                                TextRange.getEnd(node),
                                this._parseResults.tokenizerOutput.lines
                            ),
                        },
                    });
                }
            }
        }

        return true;
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
            this._referencesResult.declarations.some((decl) => DeclarationUtils.areDeclarationsSame(decl, resolvedDecl))
        ) {
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

        return this._referencesResult.declarations.some((decl) =>
            DeclarationUtils.areDeclarationsSame(decl, resolvedDeclNonlocal)
        );
    }
}

export class ReferencesProvider {
    static getDeclarationForPosition(
        sourceMapper: SourceMapper,
        parseResults: ParseResults,
        filePath: string,
        position: Position,
        evaluator: TypeEvaluator,
        reporter: ReferenceCallback | undefined,
        token: CancellationToken
    ): ReferencesResult | undefined {
        throwIfCancellationRequested(token);

        const offset = convertPositionToOffset(position, parseResults.tokenizerOutput.lines);
        if (offset === undefined) {
            return undefined;
        }

        const node = ParseTreeUtils.findNodeByOffset(parseResults.parseTree, offset);
        if (node === undefined) {
            return undefined;
        }

        // If this isn't a name node, there are no references to be found.
        if (node.nodeType !== ParseNodeType.Name) {
            return undefined;
        }

        // Special case module names, which don't have references.
        if (node.parent?.nodeType === ParseNodeType.ModuleName) {
            return undefined;
        }

        const declarations = evaluator.getDeclarationsForNameNode(node);
        if (!declarations) {
            return undefined;
        }

        const resolvedDeclarations: Declaration[] = [];
        declarations.forEach((decl) => {
            const resolvedDecl = evaluator.resolveAliasDeclaration(decl, /* resolveLocalNames */ false);
            if (resolvedDecl) {
                resolvedDeclarations.push(resolvedDecl);

                if (isStubFile(resolvedDecl.path)) {
                    const implDecls = sourceMapper.findDeclarations(resolvedDecl);
                    for (const implDecl of implDecls) {
                        if (implDecl && implDecl.path) {
                            this._addIfUnique(resolvedDeclarations, implDecl);
                        }
                    }
                }
            }
        });

        if (resolvedDeclarations.length === 0) {
            return undefined;
        }

        // Does this symbol require search beyond the current file? Determine whether
        // the symbol is declared within an evaluation scope that is within the current
        // file and cannot be imported directly from other modules.
        const requiresGlobalSearch = resolvedDeclarations.some((decl) => {
            // If the declaration is outside of this file, a global search is needed.
            if (decl.path !== filePath) {
                return true;
            }

            const evalScope = ParseTreeUtils.getEvaluationScopeNode(decl.node);

            // If the declaration is at the module level or a class level, it can be seen
            // outside of the current module, so a global search is needed.
            if (evalScope.nodeType === ParseNodeType.Module || evalScope.nodeType === ParseNodeType.Class) {
                return true;
            }

            // If the name node is a member variable, we need to do a global search.
            if (
                decl.node?.parent?.nodeType === ParseNodeType.MemberAccess &&
                decl.node === decl.node.parent.memberName
            ) {
                return true;
            }

            return false;
        });

        return new ReferencesResult(requiresGlobalSearch, node, node.value, resolvedDeclarations, reporter);
    }

    private static _addIfUnique(declarations: Declaration[], itemToAdd: Declaration) {
        for (const def of declarations) {
            if (DeclarationUtils.areDeclarationsSame(def, itemToAdd)) {
                return;
            }
        }

        declarations.push(itemToAdd);
    }

    static addReferences(
        parseResults: ParseResults,
        filePath: string,
        referencesResult: ReferencesResult,
        includeDeclaration: boolean,
        evaluator: TypeEvaluator,
        token: CancellationToken
    ): void {
        const refTreeWalker = new FindReferencesTreeWalker(
            parseResults,
            filePath,
            referencesResult,
            includeDeclaration,
            evaluator,
            token
        );

        referencesResult.addLocations(...refTreeWalker.findReferences());
    }
}
