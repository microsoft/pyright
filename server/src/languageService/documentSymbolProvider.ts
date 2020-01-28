/*
* documentSymbolProvider.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Logic that enumerates all of the symbols within a specified
* source file document.
*/

import { DocumentSymbol, Location, Position, Range, SymbolInformation,
    SymbolKind } from 'vscode-languageserver';
import { URI } from 'vscode-uri';

import * as AnalyzerNodeInfo from '../analyzer/analyzerNodeInfo';
import { Declaration, DeclarationType } from '../analyzer/declaration';
import * as ParseTreeUtils from '../analyzer/parseTreeUtils';
import { ParseTreeWalker } from '../analyzer/parseTreeWalker';
import { getLastTypedDeclaredForSymbol } from '../analyzer/symbolUtils';
import { TypeEvaluator } from '../analyzer/typeEvaluator';
import { isProperty } from '../analyzer/typeUtils';
import { LineAndColumn, LineAndColumnRange } from '../common/textRange';
import { convertOffsetsToRange } from '../common/positionUtils';
import * as StringUtils from '../common/stringUtils';
import { ClassNode, FunctionNode, ListComprehensionNode, ModuleNode, ParseNode } from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';

// We'll use a somewhat-arbitrary cutoff value here to determine
// whether it's sufficiently similar.
const similarityLimit = 0.5;

class FindSymbolTreeWalker extends ParseTreeWalker {
    private _filePath: string;
    private _parseResults: ParseResults;
    private _symbolResults: SymbolInformation[];
    private _query: string | undefined;
    private _evaluator: TypeEvaluator;

    constructor(filePath: string, parseResults: ParseResults, symbolInfoResults: SymbolInformation[],
            query: string | undefined, evaluator: TypeEvaluator) {

        super();
        this._filePath = filePath;
        this._parseResults = parseResults;
        this._symbolResults = symbolInfoResults;
        this._query = query;
        this._evaluator = evaluator;
    }

    findSymbols() {
        this.walk(this._parseResults.parseTree);
    }

    visitModule(node: ModuleNode) {
        this._addSymbolInformationForScope(node, '');
        return true;
    }

    visitClass(node: ClassNode) {
        const className = node.name.value;
        this._addSymbolInformationForScope(node, className);
        return true;
    }

    visitFunction(node: FunctionNode) {
        const functionName = node.name.value;
        let containerName = functionName;
        const containingClass = ParseTreeUtils.getEnclosingClass(node, true);
        if (containingClass) {
            containerName = containingClass.name.value + '.' + functionName;
        }
        this._addSymbolInformationForScope(node, containerName);
        return true;
    }

    visitListComprehension(node: ListComprehensionNode) {
        this._addSymbolInformationForScope(node);
        return true;
    }

    private _addSymbolInformationForScope(node: ParseNode, containerName?: string) {
        const scope = AnalyzerNodeInfo.getScope(node);
        if (!scope) {
            return;
        }

        const symbolTable = scope.symbolTable;
        symbolTable.forEach((symbol, name) => {
            if (!symbol.isIgnoredForProtocolMatch()) {
                // Prefer declarations with a defined type.
                let decl = getLastTypedDeclaredForSymbol(symbol);

                // Fall back to declarations without a type.
                if (!decl && symbol.hasDeclarations()) {
                    decl = symbol.getDeclarations()[0];
                }

                if (decl) {
                    this._addSymbolInformationFromDeclaration(name, decl, containerName);
                }
            }
        });
    }

    private _addSymbolInformationFromDeclaration(name: string, declaration: Declaration,
            containerName?: string) {

        if (declaration.path !== this._filePath) {
            return;
        }

        if (this._query !== undefined) {
            const similarity = StringUtils.computeCompletionSimilarity(this._query, name);
            if (similarity < similarityLimit) {
                return;
            }
        }

        const resolvedSymbol = this._evaluator.resolveAliasDeclaration(declaration);
        if (!resolvedSymbol) {
            return;
        }

        const location: Location = {
            uri: URI.file(this._filePath).toString(),
            range: convertRange(declaration.range)
        };

        const symbolKind = getSymbolKind(name, declaration, this._evaluator);
        if (symbolKind === undefined) {
            return;
        }

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
}

function getSymbolKind(name: string, declaration: Declaration, evaluator: TypeEvaluator): SymbolKind | undefined {
    let symbolKind: SymbolKind;
    switch (declaration.type) {
        case DeclarationType.Class:
        case DeclarationType.SpecialBuiltInClass:
            symbolKind = SymbolKind.Class;
            break;

        case DeclarationType.Function:
            if (declaration.isMethod) {
                const declType = evaluator.getTypeForDeclaration(declaration);
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
            symbolKind = declaration.isConstant || declaration.isFinal ?
                SymbolKind.Constant : SymbolKind.Variable;
            break;

        default:
            symbolKind = SymbolKind.Variable;
            break;
    }

    return symbolKind;
}

function convertRange(range: LineAndColumnRange): Range {
    return Range.create(convertPosition(range.start),
        convertPosition(range.end));
}

function convertPosition(position: LineAndColumn): Position {
    return Position.create(position.line, position.column);
}

function getDocumentSymbolsRecursive(node: AnalyzerNodeInfo.ScopedNode,
        docSymbolResults: DocumentSymbol[], parseResults: ParseResults,
        evaluator: TypeEvaluator) {

    const scope = AnalyzerNodeInfo.getScope(node);
    if (!scope) {
        return;
    }

    const symbolTable = scope.symbolTable;
    symbolTable.forEach((symbol, name) => {
        if (!symbol.isIgnoredForProtocolMatch()) {
            // Prefer declarations with a defined type.
            let decl = getLastTypedDeclaredForSymbol(symbol);

            // Fall back to declarations without a type.
            if (!decl && symbol.hasDeclarations()) {
                decl = symbol.getDeclarations()[0];
            }

            if (decl) {
                getDocumentSymbolRecursive(name, decl, evaluator, parseResults, docSymbolResults);
            }
        }
    });
}

function getDocumentSymbolRecursive(name: string, declaration: Declaration,
        evaluator: TypeEvaluator, parseResults: ParseResults,
        docSymbolResults: DocumentSymbol[]) {

    if (declaration.type === DeclarationType.Alias) {
        return;
    }

    const symbolKind = getSymbolKind(name, declaration, evaluator);
    if (symbolKind === undefined) {
        return;
    }

    const selectionRange = convertRange(declaration.range);
    let range = selectionRange;
    const children: DocumentSymbol[] = [];

    if (declaration.type === DeclarationType.Class ||
            declaration.type === DeclarationType.Function) {

        getDocumentSymbolsRecursive(declaration.node, children, parseResults, evaluator);

        const nameRange = convertOffsetsToRange(declaration.node.start,
            declaration.node.name.start + declaration.node.length,
            parseResults.tokenizerOutput.lines);
        range = convertRange(nameRange);
    }

    const symbolInfo: DocumentSymbol = {
        name,
        kind: symbolKind,
        range,
        selectionRange,
        children
    };

    docSymbolResults.push(symbolInfo);
}

export class DocumentSymbolProvider {
    static addSymbolsForDocument(symbolList: SymbolInformation[], query: string | undefined,
            filePath: string, parseResults: ParseResults, evaluator: TypeEvaluator) {

        const symbolTreeWalker = new FindSymbolTreeWalker(filePath, parseResults,
            symbolList, query, evaluator);
        symbolTreeWalker.findSymbols();
    }

    static addHierarchicalSymbolsForDocument(symbolList: DocumentSymbol[],
            parseResults: ParseResults, evaluator: TypeEvaluator) {

        getDocumentSymbolsRecursive(parseResults.parseTree, symbolList, parseResults, evaluator);
    }
}
