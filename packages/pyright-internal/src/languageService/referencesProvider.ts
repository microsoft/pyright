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

import { Declaration } from '../analyzer/declaration';
import * as ParseTreeUtils from '../analyzer/parseTreeUtils';
import { SourceMapper } from '../analyzer/sourceMapper';
import { TypeEvaluator } from '../analyzer/typeEvaluatorTypes';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { convertOffsetToPosition, convertPositionToOffset } from '../common/positionUtils';
import { DocumentRange, Position } from '../common/textRange';
import { TextRange } from '../common/textRange';
import { NameNode, ParseNode, ParseNodeType } from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';
import { DocumentSymbolCollector } from './documentSymbolCollector';

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

export class FindReferencesTreeWalker {
    constructor(
        private _parseResults: ParseResults,
        private _filePath: string,
        private _referencesResult: ReferencesResult,
        private _includeDeclaration: boolean,
        private _evaluator: TypeEvaluator,
        private _cancellationToken: CancellationToken
    ) {}

    findReferences(rootNode = this._parseResults.parseTree) {
        const collector = new DocumentSymbolCollector(
            this._referencesResult.symbolName,
            this._referencesResult.declarations,
            this._evaluator,
            this._cancellationToken,
            rootNode,
            /* treat module in import and from import same */ true
        );

        const results: DocumentRange[] = [];
        for (const result of collector.collect()) {
            // Is it the same symbol?
            if (this._includeDeclaration || result.node !== this._referencesResult.nodeAtOffset) {
                results.push({
                    path: this._filePath,
                    range: {
                        start: convertOffsetToPosition(result.range.start, this._parseResults.tokenizerOutput.lines),
                        end: convertOffsetToPosition(
                            TextRange.getEnd(result.range),
                            this._parseResults.tokenizerOutput.lines
                        ),
                    },
                });
            }
        }

        return results;
    }
}

export class ReferencesProvider {
    static getDeclarationForNode(
        sourceMapper: SourceMapper,
        filePath: string,
        node: NameNode,
        evaluator: TypeEvaluator,
        reporter: ReferenceCallback | undefined,
        token: CancellationToken
    ) {
        throwIfCancellationRequested(token);

        const declarations = DocumentSymbolCollector.getDeclarationsForNode(
            node,
            evaluator,
            /* resolveLocalNames */ false,
            token,
            sourceMapper
        );

        if (declarations.length === 0) {
            return undefined;
        }

        // Does this symbol require search beyond the current file? Determine whether
        // the symbol is declared within an evaluation scope that is within the current
        // file and cannot be imported directly from other modules.
        const requiresGlobalSearch = declarations.some((decl) => {
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

        return new ReferencesResult(requiresGlobalSearch, node, node.value, declarations, reporter);
    }

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

        return this.getDeclarationForNode(sourceMapper, filePath, node, evaluator, reporter, token);
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
