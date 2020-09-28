/*
 * documentSymbolProvider.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Logic that enumerates all of the symbols within a specified
 * source file document.
 */

import { CancellationToken, DocumentSymbol, Location, SymbolInformation, SymbolKind } from 'vscode-languageserver';
import { URI } from 'vscode-uri';

import { resolveAliasDeclaration } from '../analyzer/aliasDeclarationUtils';
import { ImportLookup } from '../analyzer/analyzerFileInfo';
import * as AnalyzerNodeInfo from '../analyzer/analyzerNodeInfo';
import { AliasDeclaration, Declaration, DeclarationType } from '../analyzer/declaration';
import { getNameFromDeclaration } from '../analyzer/declarationUtils';
import { getLastTypedDeclaredForSymbol } from '../analyzer/symbolUtils';
import { TypeEvaluator } from '../analyzer/typeEvaluator';
import { isProperty } from '../analyzer/typeUtils';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { convertOffsetsToRange } from '../common/positionUtils';
import * as StringUtils from '../common/stringUtils';
import { Range } from '../common/textRange';
import { ParseResults } from '../parser/parser';

export interface IndexAliasData {
    readonly originalName: string;
    readonly modulePath: string;
}

export interface IndexSymbolData {
    readonly name: string;
    readonly alias: IndexAliasData | undefined;
    readonly externallyVisible: boolean;
    readonly kind: SymbolKind;
    readonly range: Range;
    readonly selectionRange: Range;
    readonly children: IndexSymbolData[];
}

export interface IndexResults {
    readonly privateOrProtected: boolean;
    readonly symbols: IndexSymbolData[];
}

export function includeAliasDeclarationInIndex(declaration: AliasDeclaration): boolean {
    return declaration.usesLocalName && !!declaration.symbolName && declaration.path.length > 0;
}

export function getIndexAliasData(
    importLookup: ImportLookup | undefined,
    declaration: AliasDeclaration
): IndexAliasData | undefined {
    if (!declaration.symbolName) {
        return undefined;
    }

    const aliasData = { originalName: declaration.symbolName!, modulePath: declaration.path };
    if (!importLookup) {
        return aliasData;
    }

    const resolved = resolveAliasDeclaration(importLookup, declaration, true);
    const nameValue = resolved ? getNameFromDeclaration(resolved) : undefined;
    if (!nameValue || resolved!.path.length <= 0) {
        return aliasData;
    }

    return { originalName: nameValue, modulePath: resolved!.path };
}

// We'll use a somewhat-arbitrary cutoff value here to determine
// whether it's sufficiently similar.
const similarityLimit = 0.5;

export class DocumentSymbolProvider {
    static addSymbolsForDocument(
        indexResults: IndexResults | undefined,
        parseResults: ParseResults | undefined,
        filePath: string,
        query: string,
        symbolList: SymbolInformation[],
        token: CancellationToken
    ) {
        if (!indexResults && !parseResults) {
            return;
        }

        const indexSymbolData =
            indexResults?.symbols ?? DocumentSymbolProvider.indexSymbols(parseResults!, false, token);
        appendWorkspaceSymbolsRecursive(indexSymbolData, filePath, query, '', symbolList, token);
    }

    static addHierarchicalSymbolsForDocument(
        indexResults: IndexResults | undefined,
        parseResults: ParseResults | undefined,
        symbolList: DocumentSymbol[],
        token: CancellationToken
    ) {
        if (!indexResults && !parseResults) {
            return;
        }

        const indexSymbolData =
            indexResults?.symbols ?? DocumentSymbolProvider.indexSymbols(parseResults!, false, token);
        appendDocumentSymbolsRecursive(indexSymbolData, symbolList, token);
    }

    static indexSymbols(
        parseResults: ParseResults,
        importSymbolsOnly: boolean,
        token: CancellationToken
    ): IndexSymbolData[] {
        const indexSymbolData: IndexSymbolData[] = [];
        collectSymbolIndexData(parseResults, parseResults.parseTree, importSymbolsOnly, indexSymbolData, token);

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
    indexSymbolData: IndexSymbolData[],
    filePath: string,
    query: string,
    container: string,
    symbolList: SymbolInformation[],
    token: CancellationToken
) {
    throwIfCancellationRequested(token);

    for (const symbolData of indexSymbolData) {
        if (symbolData.alias) {
            continue;
        }

        const similarity = StringUtils.computeCompletionSimilarity(query, symbolData.name);
        if (similarity >= similarityLimit) {
            const location: Location = {
                uri: URI.file(filePath).toString(),
                range: symbolData.selectionRange,
            };

            const symbolInfo: SymbolInformation = {
                name: symbolData.name,
                kind: symbolData.kind,
                containerName: container.length > 0 ? container : undefined,
                location,
            };

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
    indexSymbolData: IndexSymbolData[],
    symbolList: DocumentSymbol[],
    token: CancellationToken
) {
    throwIfCancellationRequested(token);

    for (const symbolData of indexSymbolData) {
        if (symbolData.alias) {
            continue;
        }

        const children: DocumentSymbol[] = [];
        appendDocumentSymbolsRecursive(symbolData.children, children, token);

        const symbolInfo: DocumentSymbol = {
            name: symbolData.name,
            kind: symbolData.kind,
            range: symbolData.range,
            selectionRange: symbolData.selectionRange,
            children: children,
        };

        symbolList.push(symbolInfo);
    }
}

function collectSymbolIndexData(
    parseResults: ParseResults,
    node: AnalyzerNodeInfo.ScopedNode,
    autoImportMode: boolean,
    indexSymbolData: IndexSymbolData[],
    token: CancellationToken
) {
    throwIfCancellationRequested(token);

    const scope = AnalyzerNodeInfo.getScope(node);
    if (!scope) {
        return;
    }

    // Build __all__ map for regular python file to reduce candidate in autoImportMode.
    const file = AnalyzerNodeInfo.getFileInfo(parseResults.parseTree);
    let allNameTable: Set<string> | undefined;
    if (autoImportMode && !file?.isStubFile) {
        allNameTable = new Set<string>(AnalyzerNodeInfo.getDunderAllNames(parseResults.parseTree) ?? []);
    }

    const symbolTable = scope.symbolTable;
    symbolTable.forEach((symbol, name) => {
        if (symbol.isIgnoredForProtocolMatch()) {
            return;
        }

        if (allNameTable && !allNameTable.has(name)) {
            // if allNameTable exists, then name must exist in the table.
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
            if (declaration.path.length <= 0) {
                return;
            }

            if (!allNameTable && !includeAliasDeclarationInIndex(declaration)) {
                // For import alias, we only put the alias in the index if it is the form of
                // "from x import y as z" or the alias is explicitly listed in __all__
                return;
            }
        }

        collectSymbolIndexDataForName(
            parseResults,
            declaration,
            autoImportMode,
            !symbol.isExternallyHidden(),
            name,
            indexSymbolData,
            token
        );
    });
}

function collectSymbolIndexDataForName(
    parseResults: ParseResults,
    declaration: Declaration,
    autoImportMode: boolean,
    externallyVisible: boolean,
    name: string,
    indexSymbolData: IndexSymbolData[],
    token: CancellationToken
) {
    if (autoImportMode && !externallyVisible) {
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
        if (!autoImportMode) {
            collectSymbolIndexData(parseResults, declaration.node, false, children, token);
        }

        const nameRange = convertOffsetsToRange(
            declaration.node.start,
            declaration.node.name.start + declaration.node.length,
            parseResults.tokenizerOutput.lines
        );
        range = nameRange;
    }

    const data: IndexSymbolData = {
        name,
        alias:
            DeclarationType.Alias === declaration.type
                ? getIndexAliasData(AnalyzerNodeInfo.getFileInfo(parseResults.parseTree)?.importLookup, declaration)
                : undefined,
        externallyVisible,
        kind: symbolKind,
        range,
        selectionRange,
        children,
    };

    indexSymbolData.push(data);
}
