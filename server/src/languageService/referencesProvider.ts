/*
* referencesProvider.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Logic that finds all of the references to a symbol specified
* by a location within a file.
*/

import { ImportLookup } from '../analyzer/analyzerFileInfo';
import { Declaration, DeclarationType } from '../analyzer/declaration';
import * as DeclarationUtils from '../analyzer/declarationUtils';
import * as ParseTreeUtils from '../analyzer/parseTreeUtils';
import { ParseTreeWalker } from '../analyzer/parseTreeWalker';
import { DiagnosticTextPosition, DocumentTextRange } from '../common/diagnostic';
import { convertOffsetToPosition, convertPositionToOffset } from '../common/positionUtils';
import { TextRange } from '../common/textRange';
import { NameNode, ParseNode, ParseNodeType } from '../parser/parseNodes';
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
    private _importLookup: ImportLookup;

    constructor(parseResults: ParseResults, filePath: string,
            referencesResult: ReferencesResult, includeDeclaration: boolean,
            importLookup: ImportLookup) {

        super();
        this._parseResults = parseResults;
        this._filePath = filePath;
        this._referencesResult = referencesResult;
        this._includeDeclaration = includeDeclaration;
        this._importLookup = importLookup;
    }

    findReferences() {
        this.walk(this._parseResults.parseTree);
    }

    visitName(node: NameNode): boolean {
        const declarations = DeclarationUtils.getDeclarationsForNameNode(node );

        if (declarations && declarations.length > 0) {
            // Does this name share a declaration with the symbol of interest?
            if (declarations.some(decl => this._resultsContainsDeclaration(decl))) {
                // Is it the same symbol?
                if (this._includeDeclaration || node !== this._referencesResult.nodeAtOffset) {
                    this._referencesResult.locations.push({
                        path: this._filePath,
                        range: {
                            start: convertOffsetToPosition(node.start, this._parseResults.tokenizerOutput.lines),
                            end: convertOffsetToPosition(TextRange.getEnd(node), this._parseResults.tokenizerOutput.lines)
                        }
                    });
                }
            }
        }

        return true;
    }

    private _resultsContainsDeclaration(declaration: Declaration) {
        const resolvedDecl = DeclarationUtils.resolveAliasDeclaration(declaration, this._importLookup);
        if (!resolvedDecl) {
            return false;
        }

        // The reference results declarations are already resolved, so we don't
        // need to call resolveAliasDeclaration on them.
        return this._referencesResult.declarations.some(decl =>
            DeclarationUtils.areDeclarationsSame(decl, resolvedDecl));
    }
}

export class ReferencesProvider {
    static getReferencesForPosition(parseResults: ParseResults, filePath: string,
            position: DiagnosticTextPosition, includeDeclaration: boolean,
            importLookup: ImportLookup):
                ReferencesResult | undefined {

        const offset = convertPositionToOffset(position, parseResults.tokenizerOutput.lines);
        if (offset === undefined) {
            return undefined;
        }

        const node = ParseTreeUtils.findNodeByOffset(parseResults.parseTree, offset);
        if (node === undefined) {
            return undefined;
        }

        if (node.nodeType !== ParseNodeType.Name) {
            return undefined;
        }

        const declarations = DeclarationUtils.getDeclarationsForNameNode(node);
        if (!declarations) {
            return undefined;
        }

        const resolvedDeclarations: Declaration[] = [];
        declarations.forEach(decl => {
            const resovledDecl = DeclarationUtils.resolveAliasDeclaration(decl, importLookup);
            if (resovledDecl) {
                resolvedDeclarations.push(resovledDecl);
            }
        });

        if (resolvedDeclarations.length === 0) {
            return undefined;
        }

        // Is this a type that potentially requires a global search?
        const symbolDeclType = resolvedDeclarations[0].type;

        // Parameters are local to a scope, so they don't require a global search.
        const requiresGlobalSearch = symbolDeclType !== DeclarationType.Parameter;

        const results: ReferencesResult = {
            requiresGlobalSearch,
            nodeAtOffset: node,
            declarations: resolvedDeclarations,
            locations: []
        };

        const refTreeWalker = new FindReferencesTreeWalker(parseResults,
            filePath, results, includeDeclaration, importLookup);
        refTreeWalker.findReferences();

        return results;
    }

    static addReferences(parseResults: ParseResults, filePath: string,
            referencesResult: ReferencesResult, includeDeclaration: boolean,
            importLookup: ImportLookup): void {

        const refTreeWalker = new FindReferencesTreeWalker(parseResults,
            filePath, referencesResult, includeDeclaration, importLookup);
        refTreeWalker.findReferences();
    }
}
