/*
* referencesProvider.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Logic that finds all of the references to a symbol specified
* by a location within a file.
*/

import * as AnalyzerNodeInfo from '../analyzer/analyzerNodeInfo';
import { Declaration, DeclarationType } from '../analyzer/declaration';
import * as DeclarationUtils from '../analyzer/declarationUtils';
import * as ParseTreeUtils from '../analyzer/parseTreeUtils';
import { ParseTreeWalker } from '../analyzer/parseTreeWalker';
import { TypeEvaluator } from '../analyzer/typeEvaluator';
import { Position, DocumentRange } from '../common/textRange';
import { convertOffsetToPosition, convertPositionToOffset } from '../common/positionUtils';
import { TextRange } from '../common/textRange';
import { NameNode, ParseNode, ParseNodeType } from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';

export interface ReferencesResult {
    requiresGlobalSearch: boolean;
    nodeAtOffset: ParseNode;
    declarations: Declaration[];
    locations: DocumentRange[];
}

class FindReferencesTreeWalker extends ParseTreeWalker {
    private _parseResults: ParseResults;
    private _filePath: string;
    private _referencesResult: ReferencesResult;
    private _includeDeclaration: boolean;
    private _evaluator: TypeEvaluator;

    constructor(parseResults: ParseResults, filePath: string,
            referencesResult: ReferencesResult, includeDeclaration: boolean,
            evaluator: TypeEvaluator) {

        super();
        this._parseResults = parseResults;
        this._filePath = filePath;
        this._referencesResult = referencesResult;
        this._includeDeclaration = includeDeclaration;
        this._evaluator = evaluator;
    }

    findReferences() {
        this.walk(this._parseResults.parseTree);
    }

    walk(node: ParseNode) {
        if (!AnalyzerNodeInfo.isCodeUnreachable(node)) {
            super.walk(node);
        }
    }

    visitName(node: NameNode): boolean {
        const declarations = this._evaluator.getDeclarationsForNameNode(node);

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
        const resolvedDecl = this._evaluator.resolveAliasDeclaration(declaration);
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
            position: Position, includeDeclaration: boolean,
            evaluator: TypeEvaluator): ReferencesResult | undefined {

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

        const declarations = evaluator.getDeclarationsForNameNode(node);
        if (!declarations) {
            return undefined;
        }

        const resolvedDeclarations: Declaration[] = [];
        declarations.forEach(decl => {
            const resolvedDecl = evaluator.resolveAliasDeclaration(decl);
            if (resolvedDecl) {
                resolvedDeclarations.push(resolvedDecl);
            }
        });

        if (resolvedDeclarations.length === 0) {
            return undefined;
        }

        // Is this a type that potentially requires a global search?
        const symbolDeclType = resolvedDeclarations[0].type;

        // Parameters are local to a scope, so they don't require a global search.
        // If it's a named argument referring to a parameter, we still need to perform
        // the global search.
        const requiresGlobalSearch = symbolDeclType !== DeclarationType.Parameter ||
            (node.parent !== undefined && node.parent.nodeType === ParseNodeType.Argument);

        const results: ReferencesResult = {
            requiresGlobalSearch,
            nodeAtOffset: node,
            declarations: resolvedDeclarations,
            locations: []
        };

        const refTreeWalker = new FindReferencesTreeWalker(parseResults,
            filePath, results, includeDeclaration, evaluator);
        refTreeWalker.findReferences();

        return results;
    }

    static addReferences(parseResults: ParseResults, filePath: string,
            referencesResult: ReferencesResult, includeDeclaration: boolean,
            evaluator: TypeEvaluator): void {

        const refTreeWalker = new FindReferencesTreeWalker(parseResults,
            filePath, referencesResult, includeDeclaration, evaluator);
        refTreeWalker.findReferences();
    }
}
