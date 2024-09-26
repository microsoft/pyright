/*
 * symbolIndexer.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Logic that collect all symbol decl information for a specified source file.
 */

import { CancellationToken, CompletionItemKind, SymbolKind } from 'vscode-languageserver';

import { AnalyzerFileInfo } from '../analyzer/analyzerFileInfo';
import * as AnalyzerNodeInfo from '../analyzer/analyzerNodeInfo';
import { AliasDeclaration, Declaration, DeclarationType } from '../analyzer/declaration';
import { getLastTypedDeclarationForSymbol, isVisibleExternally } from '../analyzer/symbolUtils';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { getSymbolKind } from '../common/lspUtils';
import { convertOffsetsToRange, convertTextRangeToRange } from '../common/positionUtils';
import { Range } from '../common/textRange';
import { Uri } from '../common/uri/uri';
import { ParseNodeType } from '../parser/parseNodes';
import { ParseFileResults } from '../parser/parser';
import { convertSymbolKindToCompletionItemKind } from './autoImporter';

export interface IndexOptions {
    includeAliases?: boolean;
}

export interface IndexAliasData {
    readonly originalName: string;
    readonly moduleUri: Uri;
    readonly kind: SymbolKind;
    readonly itemKind?: CompletionItemKind | undefined;
}

export const enum IndexSymbolVisibilityFlags {
    None = 0,

    // Indicates that the symbol is visible externally
    ExternallyVisible = 1 << 0,

    // Indicates that the symbol is included in `__all__`
    InDunderAll = 1 << 1,

    // Indicates that the symbol is redundantly aliased, such as
    // in 'from module import xx as xx' or 'import yy as yy'
    RedundantAlias = 1 << 2,
}

export function isIndexSymbolVisibleFlagSet(data: IndexSymbolData, flag: IndexSymbolVisibilityFlags) {
    return !!(data.visibilityFlags & flag);
}

export interface IndexSymbolData {
    readonly name: string;
    readonly visibilityFlags: IndexSymbolVisibilityFlags;
    readonly kind: SymbolKind;
    readonly itemKind?: CompletionItemKind | undefined;
    readonly alias?: IndexAliasData | undefined;
    readonly range?: Range | undefined;
    readonly selectionRange?: Range | undefined;
    readonly children?: IndexSymbolData[] | undefined;
}

export class SymbolIndexer {
    static indexSymbols(
        fileInfo: AnalyzerFileInfo,
        parseResults: ParseFileResults,
        indexOptions: IndexOptions,
        token: CancellationToken
    ): IndexSymbolData[] {
        // Here are the rule of what symbols are indexed for a file.
        // 1. If it is a stub file, we index every public symbols defined by "https://www.python.org/dev/peps/pep-0484/#stub-files"
        // 2. If it is a py file and it is py.typed package, we index public symbols
        //    defined by "https://github.com/microsoft/pyright/blob/main/docs/typed-libraries.md#library-interface"
        // 3. If it is a py file and it is not py.typed package, we index only symbols that appear in
        //    __all__ to make sure we don't include too many symbols in the index.

        const indexSymbolData: IndexSymbolData[] = [];
        collectSymbolIndexData(
            fileInfo,
            parseResults,
            parseResults.parserOutput.parseTree,
            indexOptions,
            indexSymbolData,
            token
        );

        return indexSymbolData;
    }
}

function collectSymbolIndexData(
    fileInfo: AnalyzerFileInfo,
    parseResults: ParseFileResults,
    node: AnalyzerNodeInfo.ScopedNode,
    indexOptions: IndexOptions,
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

        // Prefer declarations with a defined type.
        let declaration = getLastTypedDeclarationForSymbol(symbol);

        // Fall back to declarations without a type.
        if (!declaration && symbol.hasDeclarations()) {
            declaration = symbol.getDeclarations()[0];
        }

        if (!declaration) {
            return;
        }

        if (DeclarationType.Alias === declaration.type && !shouldAliasBeIndexed(declaration, indexOptions)) {
            return;
        }

        // We rely on ExternallyHidden flag to determine what
        // symbols should be public (included in the index)
        collectSymbolIndexDataForName(
            fileInfo,
            parseResults,
            declaration,
            indexOptions,
            isVisibleExternally(symbol),
            name,
            indexSymbolData,
            token
        );
    });
}

function collectSymbolIndexDataForName(
    fileInfo: AnalyzerFileInfo,
    parseResults: ParseFileResults,
    declaration: Declaration,
    indexOptions: IndexOptions,
    externallyVisible: boolean,
    name: string,
    indexSymbolData: IndexSymbolData[],
    token: CancellationToken
) {
    const symbolKind = getSymbolKind(declaration, undefined, name);
    if (symbolKind === undefined) {
        return;
    }

    let selectionRange = declaration.range;
    let range = selectionRange;
    const children: IndexSymbolData[] = [];

    if (declaration.type === DeclarationType.Class || declaration.type === DeclarationType.Function) {
        collectSymbolIndexData(fileInfo, parseResults, declaration.node, indexOptions, children, token);

        range = convertOffsetsToRange(
            declaration.node.start,
            declaration.node.start + declaration.node.length,
            parseResults.tokenizerOutput.lines
        );
    }

    if (DeclarationType.Alias === declaration.type) {
        if (!shouldAliasBeIndexed(declaration, indexOptions)) {
            return;
        }

        // The default range for a module alias is the first character of the module's file.
        // Replace that with the range of the alias token.
        if (declaration.node.nodeType === ParseNodeType.ImportAs && declaration.node.d.alias) {
            selectionRange = range = convertTextRangeToRange(
                declaration.node.d.alias.d.token,
                parseResults.tokenizerOutput.lines
            );
        }
    }

    const data: IndexSymbolData = {
        name,
        visibilityFlags: IndexSymbolVisibilityFlags.ExternallyVisible,
        kind: symbolKind,
        itemKind: convertSymbolKindToCompletionItemKind(symbolKind),
        alias: undefined,
        range: range,
        selectionRange: selectionRange,
        children: children,
    };

    indexSymbolData.push(data);
}

function shouldAliasBeIndexed(declaration: AliasDeclaration, indexOptions: IndexOptions) {
    if (!indexOptions.includeAliases) {
        return false;
    }

    // Only allow import statements with an alias (`import module as alias` or
    // `from module import symbol as alias`), since the alias is a symbol specific
    // to the importing file.
    return (
        (declaration.node.nodeType === ParseNodeType.ImportAs ||
            declaration.node.nodeType === ParseNodeType.ImportFromAs) &&
        declaration.node.d.alias !== undefined
    );
}
