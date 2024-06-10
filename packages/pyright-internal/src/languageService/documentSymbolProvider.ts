/*
 * documentSymbolProvider.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Logic that enumerates all of the symbols within a specified
 * source file document.
 */

import { CancellationToken, DocumentSymbol, Location, SymbolInformation } from 'vscode-languageserver';

import { getFileInfo } from '../analyzer/analyzerNodeInfo';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { ProgramView } from '../common/extensibility';
import { ReadOnlyFileSystem } from '../common/fileSystem';
import { Uri } from '../common/uri/uri';
import { convertUriToLspUriString } from '../common/uri/uriUtils';
import { ParseFileResults } from '../parser/parser';
import { IndexOptions, IndexSymbolData, SymbolIndexer } from './symbolIndexer';

export function convertToFlatSymbols(
    program: ProgramView,
    uri: Uri,
    symbolList: DocumentSymbol[]
): SymbolInformation[] {
    const flatSymbols: SymbolInformation[] = [];

    for (const symbol of symbolList) {
        _appendToFlatSymbolsRecursive(program.fileSystem, flatSymbols, uri, symbol);
    }

    return flatSymbols;
}

export class DocumentSymbolProvider {
    private _parseResults: ParseFileResults | undefined;

    constructor(
        protected readonly program: ProgramView,
        protected readonly uri: Uri,
        private readonly _supportHierarchicalDocumentSymbol: boolean,
        private readonly _indexOptions: IndexOptions,
        private readonly _token: CancellationToken
    ) {
        this._parseResults = this.program.getParseResults(this.uri);
    }

    getSymbols(): DocumentSymbol[] | SymbolInformation[] {
        if (!this._parseResults) {
            return [];
        }

        const symbolList = this.getHierarchicalSymbols();
        if (this._supportHierarchicalDocumentSymbol) {
            return symbolList;
        }

        return convertToFlatSymbols(this.program, this.uri, symbolList);
    }

    protected getHierarchicalSymbols() {
        const symbolList: DocumentSymbol[] = [];
        const parseResults = this.program.getParseResults(this.uri);
        if (!parseResults) {
            return symbolList;
        }

        const fileInfo = getFileInfo(parseResults.parserOutput.parseTree);
        if (!fileInfo) {
            return symbolList;
        }

        const indexSymbolData = SymbolIndexer.indexSymbols(fileInfo, parseResults, this._indexOptions, this._token);
        this.appendDocumentSymbolsRecursive(indexSymbolData, symbolList);

        return symbolList;
    }

    protected appendDocumentSymbolsRecursive(
        indexSymbolData: IndexSymbolData[] | undefined,
        symbolList: DocumentSymbol[]
    ) {
        throwIfCancellationRequested(this._token);

        if (!indexSymbolData) {
            return;
        }

        for (const symbolData of indexSymbolData) {
            if (symbolData.alias) {
                continue;
            }

            // It's possible for a name to be '' under certain error
            // conditions (such as a decorator with no associated function
            // or class).
            if (!symbolData.name) {
                continue;
            }

            const children: DocumentSymbol[] = [];
            this.appendDocumentSymbolsRecursive(symbolData.children, children);

            const symbolInfo: DocumentSymbol = {
                name: symbolData.name,
                kind: symbolData.kind,
                range: symbolData.range!,
                selectionRange: symbolData.selectionRange!,
                children: children!,
            };

            symbolList.push(symbolInfo);
        }
    }
}

function _appendToFlatSymbolsRecursive(
    fs: ReadOnlyFileSystem,
    flatSymbols: SymbolInformation[],
    documentUri: Uri,
    symbol: DocumentSymbol,
    parent?: DocumentSymbol
) {
    const flatSymbol: SymbolInformation = {
        name: symbol.name,
        kind: symbol.kind,
        location: Location.create(convertUriToLspUriString(fs, documentUri), symbol.range),
    };

    if (symbol.tags) {
        flatSymbol.tags = symbol.tags;
    }

    if (parent) {
        flatSymbol.containerName = parent.name;
    }

    flatSymbols.push(flatSymbol);

    if (symbol.children) {
        for (const child of symbol.children) {
            _appendToFlatSymbolsRecursive(fs, flatSymbols, documentUri, child, symbol);
        }
    }
}
