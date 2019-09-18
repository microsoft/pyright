/*
* documentSymbolProvider.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Logic that enumerates all of the symbols within a specified
* source file document.
*/

import { Location, Position, Range, SymbolInformation, SymbolKind } from 'vscode-languageserver';
import VSCodeUri from 'vscode-uri';

import * as AnalyzerNodeInfo from '../analyzer/analyzerNodeInfo';
import { Declaration, DeclarationCategory } from '../analyzer/declaration';
import * as ParseTreeUtils from '../analyzer/parseTreeUtils';
import { ParseTreeWalker } from '../analyzer/parseTreeWalker';
import { TypeCategory } from '../analyzer/types';
import { DiagnosticTextPosition, DiagnosticTextRange } from '../common/diagnostic';
import * as StringUtils from '../common/stringUtils';
import { ClassNode, FunctionNode, ModuleNode, ParseNode } from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';

// We'll use a somewhat-arbitrary cutoff value here to determine
// whether it's sufficiently similar.
const similarityLimit = 0.5;

class FindSymbolTreeWalker extends ParseTreeWalker {
    private _filePath: string;
    private _parseResults: ParseResults;
    private _symbolResults: SymbolInformation[];
    private _query: string | undefined;

    constructor(filePath: string, parseResults: ParseResults,
            results: SymbolInformation[], query: string | undefined) {

        super();
        this._filePath = filePath;
        this._parseResults = parseResults;
        this._symbolResults = results;
        this._query = query;
    }

    findSymbols() {
        this.walk(this._parseResults.parseTree);
    }

    visitModule(node: ModuleNode) {
        this._addSymbolsForScope(node, '');
        return true;
    }

    visitClass(node: ClassNode) {
        const className = node.name.nameToken.value;
        this._addSymbolsForScope(node, className);
        return true;
    }

    visitFunction(node: FunctionNode) {
        const functionName = node.name.nameToken.value;
        let containerName = functionName;
        const containingClass = ParseTreeUtils.getEnclosingClass(node, true);
        if (containingClass) {
            containerName = containingClass.name.nameToken.value + '.' + functionName;
        }
        this._addSymbolsForScope(node, containerName);
        return true;
    }

    private _addSymbolsForScope(node: ParseNode, containerName: string) {
        const scope = AnalyzerNodeInfo.getScope(node);
        if (!scope) {
            return;
        }

        const symbolTable = scope.getSymbolTable();
        symbolTable.forEach((symbol, key) => {
            const declarations = symbol.getDeclarations();
            if (declarations && declarations.length > 0) {
                const primaryDecl = declarations[0];

                this._addSymbolFromDeclaration(key, primaryDecl, containerName);
            }
        });
    }

    private _addSymbolFromDeclaration(name: string, declaration: Declaration,
            containerName: string) {

        if (declaration.path !== this._filePath) {
            return;
        }

        if (this._query !== undefined) {
            const similarity = StringUtils.computeCompletionSimilarity(this._query, name);
            if (similarity < similarityLimit) {
                return;
            }
        }

        let symbolKind: SymbolKind;
        switch (declaration.category) {
            case DeclarationCategory.Class:
                symbolKind = SymbolKind.Class;
                break;

            case DeclarationCategory.Function:
                symbolKind = SymbolKind.Function;
                break;

            case DeclarationCategory.Method:
                if (declaration.declaredType && declaration.declaredType.category === TypeCategory.Property) {
                    symbolKind = SymbolKind.Property;
                } else {
                    symbolKind = SymbolKind.Method;
                }
                break;

            case DeclarationCategory.Module:
                symbolKind = SymbolKind.Module;
                break;

            case DeclarationCategory.Parameter:
                if (name === 'self' || name === 'cls' || name === '_') {
                    return;
                }
                symbolKind = SymbolKind.Variable;
                break;

            case DeclarationCategory.Variable:
            default:
                if (name === '_') {
                    return;
                }
                symbolKind = SymbolKind.Variable;
                break;
        }

        const location: Location = {
            uri: VSCodeUri.file(this._filePath).toString(),
            range: this._convertRange(declaration.range)
        };

        const symbolInfo: SymbolInformation = {
            name,
            kind: symbolKind,
            location
        };

        if (containerName) {
            symbolInfo.containerName = containerName;
        }

        this._symbolResults.push(symbolInfo);
    }

    private _convertRange(range: DiagnosticTextRange): Range {
        return Range.create(this._convertPosition(range.start),
            this._convertPosition(range.end));
    }

    private _convertPosition(position: DiagnosticTextPosition): Position {
        return Position.create(position.line, position.column);
   }

}

export class DocumentSymbolProvider {
    static addSymbolsForDocument(symbolList: SymbolInformation[], query: string | undefined,
            filePath: string, parseResults: ParseResults) {

        const symbolTreeWalker = new FindSymbolTreeWalker(filePath, parseResults,
            symbolList, query);
        symbolTreeWalker.findSymbols();
    }
}
