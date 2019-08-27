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

import { AnalyzerNodeInfo } from '../analyzer/analyzerNodeInfo';
import { Declaration, DeclarationCategory } from '../analyzer/declaration';
import { ParseTreeUtils } from '../analyzer/parseTreeUtils';
import { ParseTreeWalker } from '../analyzer/parseTreeWalker';
import { DiagnosticTextPosition, DiagnosticTextRange } from '../common/diagnostic';
import { ClassNode, FunctionNode, ModuleNode, ParseNode } from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';

class FindSymbolTreeWalker extends ParseTreeWalker {
    private _filePath: string;
    private _parseResults: ParseResults;
    private _symbolResults: SymbolInformation[];

    constructor(filePath: string, parseResults: ParseResults, results: SymbolInformation[]) {
        super();
        this._filePath = filePath;
        this._parseResults = parseResults;
        this._symbolResults = results;
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
        let containingClass = ParseTreeUtils.getEnclosingClass(node, true);
        if (containingClass) {
            containerName = containingClass.name.nameToken.value + '.' + functionName;
        }
        this._addSymbolsForScope(node, containerName);
        return true;
    }

    private _addSymbolsForScope(node: ParseNode, constainerName: string) {
        const scope = AnalyzerNodeInfo.getScope(node);
        if (!scope) {
            return;
        }

        const symbolTable = scope.getSymbolTable();
        symbolTable.forEach((symbol, key) => {
            const declarations = symbol.getDeclarations();
            if (declarations && declarations.length > 0) {
                const primaryDecl = declarations[0];

                this._addSymbolFromDeclaration(key, primaryDecl, constainerName);
            }
        });
    }

    private _addSymbolFromDeclaration(name: string, declaration: Declaration,
            containerName: string) {

        if (declaration.path !== this._filePath) {
            return;
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
                symbolKind = SymbolKind.Method;
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
    static getSymbolsForDocument(filePath: string, parseResults: ParseResults): SymbolInformation[] {
        const results: SymbolInformation[] = [];
        const symbolTreeWalker = new FindSymbolTreeWalker(filePath, parseResults, results);
        symbolTreeWalker.findSymbols();

        return results;
    }
}
