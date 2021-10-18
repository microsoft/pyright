/*
 * documentSymbolProvider.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Logic that enumerates all of the symbols within a specified
 * source file document.
 */

import {
    CancellationToken,
    CompletionItemKind,
    DocumentSymbol,
    Location,
    SymbolInformation,
    SymbolKind,
} from 'vscode-languageserver';
import { URI } from 'vscode-uri';

import { resolveAliasDeclaration } from '../analyzer/aliasDeclarationUtils';
import { AnalyzerFileInfo, ImportLookup } from '../analyzer/analyzerFileInfo';
import * as AnalyzerNodeInfo from '../analyzer/analyzerNodeInfo';
import { AliasDeclaration, Declaration, DeclarationType } from '../analyzer/declaration';
import { getNameFromDeclaration } from '../analyzer/declarationUtils';
import { getLastTypedDeclaredForSymbol } from '../analyzer/symbolUtils';
import { TypeEvaluator } from '../analyzer/typeEvaluatorTypes';
import { isProperty } from '../analyzer/typeUtils';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { convertOffsetsToRange } from '../common/positionUtils';
import * as StringUtils from '../common/stringUtils';
import { Range } from '../common/textRange';
import { ParseResults } from '../parser/parser';
import { convertSymbolKindToCompletionItemKind } from './autoImporter';

export interface IndexAliasData {
    readonly originalName: string;
    readonly modulePath: string;
    readonly kind: SymbolKind;
    readonly itemKind?: CompletionItemKind | undefined;
}

export interface IndexSymbolData {
    readonly name: string;
    readonly externallyVisible: boolean;
    readonly kind: SymbolKind;
    readonly itemKind?: CompletionItemKind | undefined;
    readonly alias?: IndexAliasData | undefined;
    readonly range?: Range | undefined;
    readonly selectionRange?: Range | undefined;
    readonly children?: IndexSymbolData[] | undefined;
}

export interface IndexResults {
    readonly privateOrProtected: boolean;
    readonly symbols: IndexSymbolData[];
}

export interface IndexOptions {
    indexingForAutoImportMode: boolean;
}

export type WorkspaceSymbolCallback = (symbols: SymbolInformation[]) => void;

export function getIndexAliasData(
    importLookup: ImportLookup,
    declaration: AliasDeclaration
): IndexAliasData | undefined {
    if (!declaration.symbolName) {
        return undefined;
    }

    const resolvedInfo = resolveAliasDeclaration(
        importLookup,
        declaration,
        /* resolveLocalNames */ true,
        /* allowExternallyHiddenAccess */ false
    );
    if (!resolvedInfo || !resolvedInfo.declaration) {
        return undefined;
    }

    if (resolvedInfo.isPrivate) {
        return undefined;
    }

    const nameValue = getNameFromDeclaration(resolvedInfo.declaration);
    if (!nameValue || resolvedInfo.declaration.path.length <= 0) {
        return undefined;
    }

    const symbolKind = getSymbolKind(nameValue, resolvedInfo.declaration) ?? SymbolKind.Module;
    return {
        originalName: nameValue,
        modulePath: resolvedInfo.declaration.path,
        kind: symbolKind,
        itemKind: convertSymbolKindToCompletionItemKind(symbolKind),
    };
}

export function convertToFlatSymbols(documentUri: string, symbolList: DocumentSymbol[]): SymbolInformation[] {
    const flatSymbols: SymbolInformation[] = [];

    for (const symbol of symbolList) {
        appendToFlatSymbolsRecursive(flatSymbols, documentUri, symbol);
    }

    return flatSymbols;
}

export class DocumentSymbolProvider {
    static getSymbolsForDocument(
        fileInfo: AnalyzerFileInfo | undefined,
        indexResults: IndexResults | undefined,
        parseResults: ParseResults | undefined,
        filePath: string,
        query: string,
        token: CancellationToken
    ): SymbolInformation[] {
        const symbolList: SymbolInformation[] = [];

        if (!indexResults && !parseResults) {
            return symbolList;
        }

        const indexSymbolData =
            (indexResults?.symbols as IndexSymbolData[]) ??
            DocumentSymbolProvider.indexSymbols(fileInfo!, parseResults!, { indexingForAutoImportMode: false }, token);

        appendWorkspaceSymbolsRecursive(indexSymbolData, filePath, query, '', symbolList, token);
        return symbolList;
    }

    static addHierarchicalSymbolsForDocument(
        fileInfo: AnalyzerFileInfo | undefined,
        indexResults: IndexResults | undefined,
        parseResults: ParseResults | undefined,
        symbolList: DocumentSymbol[],
        token: CancellationToken
    ) {
        if (!indexResults && !parseResults) {
            return;
        }

        const indexSymbolData =
            (indexResults?.symbols as IndexSymbolData[]) ??
            DocumentSymbolProvider.indexSymbols(fileInfo!, parseResults!, { indexingForAutoImportMode: false }, token);
        appendDocumentSymbolsRecursive(indexSymbolData, symbolList, token);
    }

    static indexSymbols(
        fileInfo: AnalyzerFileInfo,
        parseResults: ParseResults,
        options: IndexOptions,
        token: CancellationToken
    ): IndexSymbolData[] {
        // Here are the rule of what symbols are indexed for a file.
        // 1. If it is a stub file, we index every public symbols defined by "https://www.python.org/dev/peps/pep-0484/#stub-files"
        // 2. If it is a py file and it is py.typed package, we index public symbols
        //    defined by "https://github.com/microsoft/pyright/blob/main/docs/typed-libraries.md#library-interface"
        // 3. If it is a py file and it is not py.typed package, we index only symbols that appear in
        //    __all__ to make sure we don't include too many symbols in the index.

        const indexSymbolData: IndexSymbolData[] = [];
        collectSymbolIndexData(fileInfo, parseResults, parseResults.parseTree, options, indexSymbolData, token);

        return indexSymbolData;
    }
}

function getSymbolKind(name: string, declaration: Declaration, evaluator?: TypeEvaluator): SymbolKind | undefined {
    let symbolKind: SymbolKind;
    switch (declaration.type) {
        case DeclarationType.Class:
        case DeclarationType.SpecialBuiltInClass:
            symbolKind = SymbolKind.Class;
            break;

        case DeclarationType.Function:
            if (declaration.isMethod) {
                const declType = evaluator?.getTypeForDeclaration(declaration);
                if (declType && isProperty(declType)) {
                    symbolKind = SymbolKind.Property;
                } else {
                    symbolKind = SymbolKind.Method;
                }
            } else {
                symbolKind = SymbolKind.Function;
            }
            break;

        case DeclarationType.Alias:
            symbolKind = SymbolKind.Module;
            break;

        case DeclarationType.Parameter:
            if (name === 'self' || name === 'cls' || name === '_') {
                return;
            }
            symbolKind = SymbolKind.Variable;
            break;

        case DeclarationType.Variable:
            if (name === '_') {
                return;
            }
            symbolKind = declaration.isConstant || declaration.isFinal ? SymbolKind.Constant : SymbolKind.Variable;
            break;

        default:
            symbolKind = SymbolKind.Variable;
            break;
    }

    return symbolKind;
}

function appendWorkspaceSymbolsRecursive(
    indexSymbolData: IndexSymbolData[] | undefined,
    filePath: string,
    query: string,
    container: string,
    symbolList: SymbolInformation[],
    token: CancellationToken
) {
    throwIfCancellationRequested(token);

    if (!indexSymbolData) {
        return;
    }

    for (const symbolData of indexSymbolData) {
        if (symbolData.alias) {
            continue;
        }

        if (StringUtils.isPatternInSymbol(query, symbolData.name)) {
            const location: Location = {
                uri: URI.file(filePath).toString(),
                range: symbolData.selectionRange!,
            };

            const symbolInfo: SymbolInformation = {
                name: symbolData.name,
                kind: symbolData.kind,
                location,
            };

            if (container.length) {
                symbolInfo.containerName = container;
            }

            symbolList.push(symbolInfo);
        }

        appendWorkspaceSymbolsRecursive(
            symbolData.children,
            filePath,
            query,
            getContainerName(container, symbolData.name),
            symbolList,
            token
        );
    }

    function getContainerName(container: string, name: string) {
        if (container.length > 0) {
            return `${container}.${name}`;
        }

        return name;
    }
}

function appendDocumentSymbolsRecursive(
    indexSymbolData: IndexSymbolData[] | undefined,
    symbolList: DocumentSymbol[],
    token: CancellationToken
) {
    throwIfCancellationRequested(token);

    if (!indexSymbolData) {
        return;
    }

    for (const symbolData of indexSymbolData) {
        if (symbolData.alias) {
            continue;
        }

        const children: DocumentSymbol[] = [];
        appendDocumentSymbolsRecursive(symbolData.children, children, token);

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

function collectSymbolIndexData(
    fileInfo: AnalyzerFileInfo,
    parseResults: ParseResults,
    node: AnalyzerNodeInfo.ScopedNode,
    options: IndexOptions,
    indexSymbolData: IndexSymbolData[],
    token: CancellationToken
) {
    throwIfCancellationRequested(token);

    const scope = AnalyzerNodeInfo.getScope(node);
    if (!scope) {
        return;
    }

    const symbolTable = scope.symbolTable;
    symbolTable.forEach((symbol, name) => {
        if (symbol.isIgnoredForProtocolMatch()) {
            return;
        }

        // If we are not py.typed package, symbol must exist in __all__ for auto import mode.
        if (
            options.indexingForAutoImportMode &&
            !fileInfo.isStubFile &&
            !fileInfo.isInPyTypedPackage &&
            !symbol.isInDunderAll()
        ) {
            return;
        }

        // Prefer declarations with a defined type.
        let declaration = getLastTypedDeclaredForSymbol(symbol);

        // Fall back to declarations without a type.
        if (!declaration && symbol.hasDeclarations()) {
            declaration = symbol.getDeclarations()[0];
        }

        if (!declaration) {
            return;
        }

        if (DeclarationType.Alias === declaration.type) {
            if (!options.indexingForAutoImportMode) {
                // We don't include import alias for workspace files.
                return;
            }

            if (!declaration.loadSymbolsFromPath || declaration.path.length <= 0) {
                // If alias doesn't have a path to the original file, we can't do dedup
                // so ignore those aliases.
                // ex) asyncio.futures, asyncio.base_futures.futures and many will dedup
                //     to asyncio.futures
                return;
            }
        }

        // We rely on ExternallyHidden flag to determine what
        // symbols should be public (included in the index)
        collectSymbolIndexDataForName(
            fileInfo,
            parseResults,
            declaration,
            options,
            !symbol.isExternallyHidden(),
            name,
            indexSymbolData,
            token
        );
    });
}

function collectSymbolIndexDataForName(
    fileInfo: AnalyzerFileInfo,
    parseResults: ParseResults,
    declaration: Declaration,
    options: IndexOptions,
    externallyVisible: boolean,
    name: string,
    indexSymbolData: IndexSymbolData[],
    token: CancellationToken
) {
    if (options.indexingForAutoImportMode && !externallyVisible) {
        return;
    }

    const symbolKind = getSymbolKind(name, declaration);
    if (symbolKind === undefined) {
        return;
    }

    const selectionRange = declaration.range;
    let range = selectionRange;
    const children: IndexSymbolData[] = [];

    if (declaration.type === DeclarationType.Class || declaration.type === DeclarationType.Function) {
        if (!options.indexingForAutoImportMode) {
            collectSymbolIndexData(fileInfo, parseResults, declaration.node, options, children, token);
        }

        range = convertOffsetsToRange(
            declaration.node.start,
            declaration.node.start + declaration.node.length,
            parseResults.tokenizerOutput.lines
        );
    }

    const data: IndexSymbolData = {
        name,
        externallyVisible,
        kind: symbolKind,
        itemKind: convertSymbolKindToCompletionItemKind(symbolKind),
        alias:
            DeclarationType.Alias === declaration.type
                ? getIndexAliasData(AnalyzerNodeInfo.getFileInfo(parseResults.parseTree)!.importLookup, declaration)
                : undefined,
        range: options.indexingForAutoImportMode ? undefined : range,
        selectionRange: options.indexingForAutoImportMode ? undefined : selectionRange,
        children: options.indexingForAutoImportMode ? undefined : children,
    };

    indexSymbolData.push(data);
}

function appendToFlatSymbolsRecursive(
    flatSymbols: SymbolInformation[],
    documentUri: string,
    symbol: DocumentSymbol,
    parent?: DocumentSymbol
) {
    const flatSymbol: SymbolInformation = {
        name: symbol.name,
        kind: symbol.kind,
        location: Location.create(documentUri, symbol.range),
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
            appendToFlatSymbolsRecursive(flatSymbols, documentUri, child, symbol);
        }
    }
}
