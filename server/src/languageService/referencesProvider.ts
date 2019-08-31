/*
* referencesProvider.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Logic that finds all of the references to a symbol specified
* by a location within a file.
*/

import { AnalyzerNodeInfo } from '../analyzer/analyzerNodeInfo';
import { Declaration, DeclarationCategory } from '../analyzer/declaration';
import { ParseTreeUtils } from '../analyzer/parseTreeUtils';
import { ParseTreeWalker } from '../analyzer/parseTreeWalker';
import { Symbol } from '../analyzer/symbol';
import { DiagnosticTextPosition, DocumentTextRange } from '../common/diagnostic';
import { convertOffsetToPosition, convertPositionToOffset } from '../common/positionUtils';
import { NameNode, ParseNode } from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';

export interface ReferencesResult {
    requiresGlobalSearch: boolean;
    nodeAtOffset: ParseNode;
    declarations: Declaration[];
    locations: DocumentTextRange[];
}

class FindReferencesTreeWalker extends ParseTreeWalker {
    private _parseResults: ParseResults;
    private _filePath: string;
    private _referencesResult: ReferencesResult;
    private _includeDeclaration: boolean;

    constructor(parseResults: ParseResults, filePath: string,
            referencesResult: ReferencesResult, includeDeclaration: boolean) {

        super();
        this._parseResults = parseResults;
        this._filePath = filePath;
        this._referencesResult = referencesResult;
        this._includeDeclaration = includeDeclaration;
    }

    findReferences() {
        this.walk(this._parseResults.parseTree);
    }

    visitName(node: NameNode): boolean {
        const declarations = AnalyzerNodeInfo.getDeclarations(node);
        if (declarations && declarations.length > 0) {
            // Does this name share a declaration with the symbol of interest?
            if (declarations.some(decl => this._resultsContainsDeclaration(decl))) {
                // Is it the same symbol?
                if (this._includeDeclaration || node !== this._referencesResult.nodeAtOffset) {
                    this._referencesResult.locations.push({
                        path: this._filePath,
                        range: {
                            start: convertOffsetToPosition(node.start, this._parseResults.lines),
                            end: convertOffsetToPosition(node.end, this._parseResults.lines)
                        }
                    });
                }
            }
        }

        return true;
    }

    private _resultsContainsDeclaration(declaration: Declaration) {
        return this._referencesResult.declarations.some(decl =>
            Symbol.areDeclarationsEqual(decl, declaration));
    }
}

export class ReferencesProvider {
    static getReferencesForPosition(parseResults: ParseResults, filePath: string,
            position: DiagnosticTextPosition, includeDeclaration: boolean):
                ReferencesResult | undefined {

        const offset = convertPositionToOffset(position, parseResults.lines);
        if (offset === undefined) {
            return undefined;
        }

        const node = ParseTreeUtils.findNodeByOffset(parseResults.parseTree, offset);
        if (node === undefined) {
            return undefined;
        }

        const declarations = AnalyzerNodeInfo.getDeclarations(node);
        if (!declarations || declarations.length === 0) {
            return undefined;
        }

        // Is this a type that potentially requires a global search?
        const symbolCategory = declarations[0].category;

        // Parameters are local to a scope, so they don't require a global search.
        const requiresGlobalSearch = symbolCategory !== DeclarationCategory.Parameter;

        const results: ReferencesResult = {
            requiresGlobalSearch,
            nodeAtOffset: node,
            declarations,
            locations: []
        };

        const refTreeWalker = new FindReferencesTreeWalker(parseResults,
            filePath, results, includeDeclaration);
        refTreeWalker.findReferences();

        return results;
    }

    static addReferences(parseResults: ParseResults, filePath: string,
            referencesResult: ReferencesResult, includeDeclaration: boolean): void {

        const refTreeWalker = new FindReferencesTreeWalker(parseResults,
            filePath, referencesResult, includeDeclaration);
        refTreeWalker.findReferences();
    }
}
