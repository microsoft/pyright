/*
* completionProvider.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Logic that maps a position within a Python program file into
* a list of zero or more text completions that apply in the context.
*/

import { CompletionItem, CompletionItemKind, CompletionList,
    MarkupKind, TextEdit } from 'vscode-languageserver';

import { ImportMap } from '../analyzer/analyzerFileInfo';
import * as AnalyzerNodeInfo from '../analyzer/analyzerNodeInfo';
import { DeclarationCategory } from '../analyzer/declaration';
import { ImportedModuleDescriptor, ImportResolver, ModuleNameAndType } from '../analyzer/importResolver';
import { ImportType } from '../analyzer/importResult';
import * as ImportStatementUtils from '../analyzer/importStatementUtils';
import * as ParseTreeUtils from '../analyzer/parseTreeUtils';
import { ScopeType } from '../analyzer/scope';
import { Symbol, SymbolTable } from '../analyzer/symbol';
import * as SymbolNameUtils from '../analyzer/symbolNameUtils';
import { ClassType, FunctionType, printType, Type, TypeCategory } from '../analyzer/types';
import * as TypeUtils from '../analyzer/typeUtils';
import { ConfigOptions } from '../common/configOptions';
import { DiagnosticTextPosition } from '../common/diagnostic';
import { TextEditAction } from '../common/editAction';
import { combinePaths, getDirectoryPath, getFileName, stripFileExtension } from '../common/pathUtils';
import { convertPositionToOffset } from '../common/positionUtils';
import * as StringUtils from '../common/stringUtils';
import { TextRange } from '../common/textRange';
import { ErrorExpressionCategory, ErrorExpressionNode, ExpressionNode, ImportFromNode,
    isExpressionNode, ModuleNameNode, ParseNode, ParseNodeType } from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';
import { TokenType } from '../parser/tokenizerTypes';

const _keywords: string[] = [
    // Expression keywords
    'True',
    'False',
    'None',
    'and',
    'or',
    'await',
    'not',
    'is',
    'lambda',
    'yield',

    // Statement keywords
    'assert',
    'async',
    'break',
    'class',
    'continue',
    'def',
    'del',
    'elif',
    'else',
    'except',
    'finally',
    'for',
    'from',
    'global',
    'if',
    'import',
    'in',
    'nonlocal',
    'pass',
    'raise',
    'return',
    'try',
    'while',
    'yield'
];

enum SortCategory {
    // The order of the following is important. We use
    // this to order the completion suggestions.

    // A keyword that must be entered for the syntax to be correct.
    LikelyKeyword,

    // A module name recently used in an import statement.
    RecentImportModuleName,

    // A module name used in an import statement.
    ImportModuleName,

    // A keyword or symbol that was recently used for completion.
    RecentKeywordOrSymbol,

    // An auto-import symbol that was recently used for completion.
    RecentAutoImport,

    // A keyword in the python syntax.
    Keyword,

    // A normal symbol.
    NormalSymbol,

    // A symbol that starts with _ or __ (used only when there is
    // no matching filter).
    PrivateSymbol,

    // A symbol with a dunder name (e.g. __init__).
    DunderSymbol,

    // An auto-import symbol.
    AutoImport
}

// Completion items can have arbitrary data hanging off them.
// This data allows the resolve handling to disambiguate
// which item was selected.
interface CompletionItemData {
    autoImportText: string;
}

interface RecentCompletionInfo {
    label: string;
    autoImportText: string;
}

// We'll use a somewhat-arbitrary cutoff value here to determine
// whether it's sufficiently similar.
const similarityLimit = 0.25;

// We'll remember this many completions in the MRU list.
const maxRecentCompletions = 128;

export type ModuleSymbolMap = { [file: string]: SymbolTable };

export class CompletionProvider {
    private static _mostRecentCompletions: RecentCompletionInfo[] = [];

    constructor(private _parseResults: ParseResults,
        private _fileContents: string,
        private _importResolver: ImportResolver,
        private _position: DiagnosticTextPosition,
        private _filePath: string,
        private _configOptions: ConfigOptions,
        private _importMapCallback: () => ImportMap,
        private _moduleSymbolsCallback: () => ModuleSymbolMap) {
    }

    // When the user selects a completion, this callback is invoked,
    // allowing us to record what was selected. This allows us to
    // build our MRU cache so we can better predict entries.
    static recordCompletionResolve(completionItem: CompletionItem) {
        const label = completionItem.label;
        let autoImportText = '';
        if (completionItem.data) {
            const completionItemData = completionItem.data as CompletionItemData;
            if (completionItemData && completionItemData.autoImportText) {
                autoImportText = completionItemData.autoImportText;
            }
        }
        const curIndex = this._mostRecentCompletions.findIndex(
            item => item.label === label &&
            item.autoImportText === autoImportText);

        if (curIndex > 0) {
            // If there's an existing entry with the same name that's not at the
            // beginning of the array, remove it.
            this._mostRecentCompletions = this._mostRecentCompletions.splice(curIndex, 1);
        }

        if (curIndex !== 0) {
            // Add to the start of the array.
            this._mostRecentCompletions.unshift({ label, autoImportText });
        }

        if (this._mostRecentCompletions.length > maxRecentCompletions) {
            // Prevent the MRU list from growing indefinitely.
            this._mostRecentCompletions.pop();
        }
    }

    getCompletionsForPosition(): CompletionList | undefined {
        const offset = convertPositionToOffset(this._position, this._parseResults.lines);
        if (offset === undefined) {
            return undefined;
        }

        let node = ParseTreeUtils.findNodeByOffset(this._parseResults.parseTree, offset);

        // See if we can get to a "better" node by backing up a few columns.
        // A "better" node is defined as one that's deeper than the current
        // node.
        const initialNode = node;
        const initialDepth = node ? ParseTreeUtils.getNodeDepth(node) : 0;
        let curOffset = offset;
        while (curOffset >= 0) {
            curOffset--;

            // Stop scanning backward if we hit certain stop characters.
            const curChar = this._fileContents.substr(curOffset, 1);
            if (curChar === '(' || curChar === '\n') {
                break;
            }

            const curNode = ParseTreeUtils.findNodeByOffset(this._parseResults.parseTree, curOffset);
            if (curNode && curNode !== initialNode) {
                if (ParseTreeUtils.getNodeDepth(curNode) > initialDepth) {
                    node = curNode;
                }
                break;
            }
        }

        if (node === undefined) {
            return undefined;
        }

        // Get the text on that line prior to the insertion point.
        const lineTextRange = this._parseResults.lines.getItemAt(this._position.line);
        const textOnLine = this._fileContents.substr(lineTextRange.start, lineTextRange.length);
        const priorText = textOnLine.substr(0, this._position.column);
        const priorWordIndex = priorText.search(/\w+$/);
        const priorWord = priorWordIndex >= 0 ? priorText.substr(priorWordIndex) : '';

        // Don't offer completions if we're within a comment or a string.
        if (this._isWithinCommentOrString(offset, priorText)) {
            return undefined;
        }

        // See if the node is part of an error node. If so, that takes
        // precedence.
        let errorNode: ParseNode | undefined = node;
        while (errorNode) {
            if (errorNode.nodeType === ParseNodeType.Error) {
                break;
            }

            errorNode = errorNode.parent;
        }

        // Determine the context based on the parse node's type and
        // that of its ancestors.
        let curNode = errorNode || node;
        while (true) {
            // Don't offer completions inside of a string node.
            if (curNode.nodeType === ParseNodeType.StringList) {
                return undefined;
            }

            if (curNode.nodeType === ParseNodeType.ModuleName) {
                return this._getImportModuleCompletions(curNode);
            }

            if (curNode.nodeType === ParseNodeType.Error) {
                return this._getExpressionErrorCompletions(curNode, priorWord);
            }

            if (curNode.nodeType === ParseNodeType.MemberAccess) {
                return this._getMemberAccessCompletions(curNode.leftExpression, priorWord);
            }

            if (curNode.nodeType === ParseNodeType.Name) {
                // Are we within a "from X import Y as Z" statement and
                // more specifically within the "Y"?
                if (curNode.parent && curNode.parent.nodeType === ParseNodeType.ImportFromAs) {
                    const parentNode = curNode.parent.parent;

                    if (parentNode && parentNode.nodeType === ParseNodeType.ImportFrom) {
                        if (curNode.parent.name === curNode) {
                            return this._getImportFromCompletions(parentNode, priorWord);
                        } else {
                            return this._getImportFromCompletions(parentNode, '');
                        }
                    }
                } else if (curNode.parent && curNode.parent.nodeType === ParseNodeType.MemberAccess) {
                    return this._getMemberAccessCompletions(
                        curNode.parent.leftExpression, priorWord);
                }
            }

            if (curNode.nodeType === ParseNodeType.ImportFrom) {
                return this._getImportFromCompletions(curNode, priorWord);
            }

            if (isExpressionNode(curNode)) {
                return this._getExpressionCompletions(curNode, priorWord);
            }

            if (curNode.nodeType === ParseNodeType.Suite || curNode.nodeType === ParseNodeType.Module) {
                return this._getStatementCompletions(curNode, priorWord);
            }

            if (!curNode.parent) {
                break;
            }

            curNode = curNode.parent;
        }

        return undefined;
    }

    private _isWithinCommentOrString(offset: number, priorText: string): boolean {
        const tokenIndex = this._parseResults.tokens.getItemAtPosition(offset);
        if (tokenIndex < 0) {
            return false;
        }

        const token = this._parseResults.tokens.getItemAt(tokenIndex);

        if (token.type === TokenType.String) {
            return true;
        }

        // If we're in the middle of a token, we're not in a comment.
        if (offset > token.start && offset < TextRange.getEnd(token)) {
            return false;
        }

        // See if the text that precedes the current position contains
        // a '#' character.
        return !!priorText.match(/#/);
    }

    private _getExpressionErrorCompletions(node: ErrorExpressionNode, priorWord: string):
            CompletionList | undefined {

        // Is the error due to a missing member access name? If so,
        // we can evaluate the left side of the member access expression
        // to determine its type and offer suggestions based on it.
        switch (node.category) {
            case ErrorExpressionCategory.MissingIn: {
                return this._createSingleKeywordCompletionList('in');
            }

            case ErrorExpressionCategory.MissingElse: {
                return this._createSingleKeywordCompletionList('else');
            }

            case ErrorExpressionCategory.MissingExpression:
            case ErrorExpressionCategory.MissingDecoratorCallName: {
                return this._getExpressionCompletions(node, priorWord);
            }

            case ErrorExpressionCategory.MissingMemberAccessName: {
                if (node.child && isExpressionNode(node.child)) {
                    return this._getMemberAccessCompletions(node.child, priorWord);
                }
                break;
            }
        }

        return undefined;
    }

    private _createSingleKeywordCompletionList(keyword: string): CompletionList {
        const completionItem = CompletionItem.create(keyword);
        completionItem.kind = CompletionItemKind.Keyword;
        completionItem.sortText =
            this._makeSortText(SortCategory.LikelyKeyword, keyword);

        return CompletionList.create([completionItem]);
    }

    private _getMemberAccessCompletions(leftExprNode: ExpressionNode,
            priorWord: string): CompletionList | undefined {

        const leftType = AnalyzerNodeInfo.getExpressionType(leftExprNode);
        let symbolTable = new SymbolTable();

        if (leftType) {
            if (leftType.category === TypeCategory.Object) {
                TypeUtils.getMembersForClass(leftType.classType, symbolTable, true);
            } else if (leftType.category === TypeCategory.Class) {
                TypeUtils.getMembersForClass(leftType, symbolTable, false);
            } else if (leftType.category === TypeCategory.Module) {
                symbolTable = leftType.fields;
            }
        }

        const completionList = CompletionList.create();
        this._addSymbolsForSymbolTable(symbolTable, name => true,
            priorWord, completionList);

        return completionList;
    }

    private _getStatementCompletions(parseNode: ParseNode, priorWord: string):
            CompletionList | undefined {

        // For now, use the same logic for expressions and statements.
        return this._getExpressionCompletions(parseNode, priorWord);
    }

    private _getExpressionCompletions(parseNode: ParseNode, priorWord: string):
            CompletionList | undefined {

        const completionList = CompletionList.create();

        // Add symbols.
        this._addSymbols(parseNode, priorWord, completionList);

        // Add keywords.
        this._findMatchingKeywords(_keywords, priorWord).map(keyword => {
            const completionItem = CompletionItem.create(keyword);
            completionItem.kind = CompletionItemKind.Keyword;
            completionList.items.push(completionItem);
            completionItem.sortText =
                this._makeSortText(SortCategory.Keyword, keyword);
        });

        // Add auto-import suggestions from other modules.
        // Ignore this check for privates, since they are not imported.
        if (!priorWord.startsWith('_')) {
            this._getAutoImportCompletions(priorWord, completionList);
        }

        return completionList;
    }

    private _getAutoImportCompletions(priorWord: string, completionList: CompletionList) {
        const moduleSymbolMap = this._moduleSymbolsCallback();
        const importStatements = ImportStatementUtils.getTopLevelImports(
            this._parseResults.parseTree);

        Object.keys(moduleSymbolMap).forEach(filePath => {
            const fileName = stripFileExtension(getFileName(filePath));

            // Don't offer imports from files that are named with private
            // naming semantics like "_ast.py".
            if (!SymbolNameUtils.isPrivateOrProtectedName(fileName)) {
                const symbolTable = moduleSymbolMap[filePath];

                symbolTable.forEach((symbol, name) => {
                    // For very short matching strings, we will require an exact match. Otherwise
                    // we will tend to return a list that's too long. Once we get beyond two
                    // characters, we can do a fuzzy match.
                    const isSimilar = priorWord.length > 2 ?
                        StringUtils.computeCompletionSimilarity(priorWord, name) > similarityLimit :
                        name.startsWith(priorWord);

                    if (isSimilar) {
                        if (!symbol.isExternallyHidden()) {
                            // If there's already a local completion suggestion with
                            // this name, don't add an auto-import suggestion with
                            // the same name.
                            const localDuplicate = completionList.items.find(
                                item => item.label === name && !item.data.autoImport);
                            const declarations = symbol.getDeclarations();
                            if (declarations && declarations.length > 0 && localDuplicate === undefined) {
                                // Don't include imported symbols, only those that
                                // are declared within this file.
                                if (declarations[0].path === filePath) {
                                    const localImport = importStatements.mapByFilePath[filePath];
                                    let importSource: string;
                                    let moduleNameAndType: ModuleNameAndType | undefined;

                                    if (localImport) {
                                        importSource = localImport.moduleName;
                                    } else {
                                        moduleNameAndType = this._getModuleNameAndTypeFromFilePath(filePath);
                                        importSource = moduleNameAndType.moduleName;
                                    }

                                    const autoImportTextEdits = this._getTextEditsForAutoImportByFilePath(
                                        name, importStatements, filePath, importSource,
                                        moduleNameAndType ? moduleNameAndType.importType : ImportType.Local);

                                    this._addSymbol(name, symbol, priorWord,
                                        completionList, importSource, autoImportTextEdits);
                                }
                            }
                        }
                    }
                });

                // See if this file should be offered as an implicit import.
                const fileDir = getDirectoryPath(filePath);
                const initPathPy = combinePaths(fileDir, '__init__.py');
                const initPathPyi = initPathPy + 'i';

                // If the current file is in a directory that also contains an "__init__.py[i]"
                // file, we can use that directory name as an implicit import target.
                if (moduleSymbolMap[initPathPy] || moduleSymbolMap[initPathPyi]) {
                    const name = getFileName(fileDir);
                    const moduleNameAndType = this._getModuleNameAndTypeFromFilePath(
                        getDirectoryPath(fileDir));
                    if (moduleNameAndType.moduleName) {
                        const autoImportText = `Auto-import from ${ moduleNameAndType.moduleName }`;

                        const isDuplicateEntry = completionList.items.find(item => {
                            if (item.label === name) {
                                // Don't add if there's already a local completion suggestion.
                                if (!item.data.autoImport) {
                                    return true;
                                }

                                // Don't add the same auto-import suggestion twice.
                                if (item.data && item.data.autoImport === autoImportText) {
                                    return true;
                                }
                            }

                            return false;
                        });

                        if (!isDuplicateEntry) {
                            const autoImportTextEdits = this._getTextEditsForAutoImportByFilePath(
                                name, importStatements, filePath, moduleNameAndType.moduleName,
                                moduleNameAndType ? moduleNameAndType.importType : ImportType.Local);
                            this._addNameToCompletionList(name, CompletionItemKind.Module, priorWord, completionList,
                                name, '', autoImportText, autoImportTextEdits);
                        }
                    }
                }
            }
        });
    }

    // Given the file path of a module that we want to import,
    // convert to a module name that can be used in an
    // 'import from' statement.
    private _getModuleNameAndTypeFromFilePath(filePath: string): ModuleNameAndType {
        const execEnvironment = this._configOptions.findExecEnvironment(this._filePath);
        return this._importResolver.getModuleNameForImport(
            filePath, execEnvironment);
    }

    private _getTextEditsForAutoImportByFilePath(symbolName: string,
            importStatements: ImportStatementUtils.ImportStatements, filePath: string,
            moduleName: string, importType: ImportType): TextEditAction[] {

        // Does an 'import from' statement already exist? If so, we'll reuse it.
        const importStatement = importStatements.mapByFilePath[filePath];
        if (importStatement && importStatement.node.nodeType === ParseNodeType.ImportFrom) {
            return ImportStatementUtils.getTextEditsForAutoImportSymbolAddition(
                symbolName, importStatement, this._parseResults);
        }

        return ImportStatementUtils.getTextEditsForAutoImportInsertion(symbolName,
            importStatements, moduleName, importType, this._parseResults);
    }

    private _getImportFromCompletions(importFromNode: ImportFromNode,
            priorWord: string): CompletionList | undefined {

        // Don't attempt to provide completions for "from X import *".
        if (importFromNode.isWildcardImport) {
            return undefined;
        }

        // Access the imported module information, which is hanging
        // off the ImportFromNode.
        const importInfo = AnalyzerNodeInfo.getImportInfo(importFromNode.module);
        if (!importInfo) {
            return undefined;
        }

        const completionList = CompletionList.create();

        const resolvedPath = importInfo.resolvedPaths.length > 0 ?
            importInfo.resolvedPaths[importInfo.resolvedPaths.length - 1] : '';

        const importMap = this._importMapCallback();

        if (importMap[resolvedPath]) {
            const moduleType = importMap[resolvedPath];
            if (moduleType) {
                const moduleFields = moduleType.fields;
                this._addSymbolsForSymbolTable(moduleFields,
                    name => {
                        // Don't suggest symbols that have already been imported.
                        return !importFromNode.imports.find(
                            imp => imp.name.nameToken.value === name);
                    },
                    priorWord, completionList);
            }
        }

        // Add the implicit imports.
        importInfo.implicitImports.forEach(implImport => {
            if (!importFromNode.imports.find(imp => imp.name.nameToken.value === implImport.name)) {
                this._addNameToCompletionList(implImport.name, CompletionItemKind.Module,
                    priorWord, completionList);
            }
        });

        return completionList;
    }

    private _findMatchingKeywords(keywordList: string[], partialMatch: string): string[] {
        return keywordList.filter(keyword => {
            if (partialMatch) {
                return StringUtils.computeCompletionSimilarity(partialMatch, keyword) > similarityLimit;
            } else {
                return true;
            }
        });
    }

    private _addSymbols(node: ParseNode, priorWord: string, completionList: CompletionList) {
        let curNode: ParseNode | undefined = node;

        while (curNode) {
            // Does this node have a scope associated with it?
            let scope = AnalyzerNodeInfo.getScope(curNode);
            if (scope && scope.getType() !== ScopeType.Temporary) {
                while (scope) {
                    this._addSymbolsForSymbolTable(scope.getSymbolTable(),
                        () => true, priorWord, completionList);
                    scope = scope.getParent();
                }
                break;
            }

            curNode = curNode.parent;
        }
    }

    private _addSymbolsForSymbolTable(symbolTable: SymbolTable,
            includeSymbolCallback: (name: string) => boolean,
            priorWord: string, completionList: CompletionList) {

        symbolTable.forEach((symbol, name) => {
            // If there are no declarations or the symbol is not
            // exported from this scope, don't include it in the
            // suggestion list.
            if (!symbol.isExternallyHidden() && includeSymbolCallback(name)) {
                this._addSymbol(name, symbol, priorWord, completionList);
            }
        });
    }

    private _addSymbol(name: string, symbol: Symbol,
            priorWord: string, completionList: CompletionList,
            autoImportSource?: string, additionalTextEdits?: TextEditAction[]) {

        const declarations = symbol.getDeclarations();

        if (declarations.length > 0) {
            let itemKind: CompletionItemKind = CompletionItemKind.Variable;
            let typeDetail: string | undefined;
            let documentation: string | undefined;

            const declaration = declarations[0];
            const type = declaration.declaredType;
            itemKind = this._convertDeclarationCategoryToItemKind(
                declaration.category, type);

            if (type) {
                switch (declaration.category) {
                    case DeclarationCategory.Variable:
                    case DeclarationCategory.Parameter:
                        typeDetail = name + ': ' + printType(type);
                        break;

                    case DeclarationCategory.Function:
                    case DeclarationCategory.Method:
                        if (type.category === TypeCategory.OverloadedFunction) {
                            typeDetail = type.overloads.map(overload =>
                                name + printType(overload.type)).join('\n');
                        } else {
                            typeDetail = name + printType(type);
                        }
                        break;

                    case DeclarationCategory.Class:
                        typeDetail = 'class ' + name + '()';
                        break;

                    case DeclarationCategory.Module:
                    default:
                        typeDetail = name;
                        break;
                }
            }

            if (type) {
                if (type.category === TypeCategory.Module) {
                    documentation = type.docString;
                } else if (type.category === TypeCategory.Class) {
                    documentation = ClassType.getDocString(type);
                } else if (type.category === TypeCategory.Function) {
                    documentation = FunctionType.getDocString(type);
                }
            }

            let autoImportText: string | undefined;
            if (autoImportSource) {
                autoImportText = `Auto-import from ${ autoImportSource }`;
            }

            this._addNameToCompletionList(name, itemKind, priorWord, completionList,
                typeDetail, documentation, autoImportText, additionalTextEdits);
        }
    }

    private _addNameToCompletionList(name: string, itemKind: CompletionItemKind,
            filter: string, completionList: CompletionList, typeDetail?: string,
            documentation?: string, autoImportText?: string,
            additionalTextEdits?: TextEditAction[]) {

        const similarity = StringUtils.computeCompletionSimilarity(filter, name);

        if (similarity > similarityLimit) {
            const completionItem = CompletionItem.create(name);
            completionItem.kind = itemKind;
            completionItem.data = {};

            if (autoImportText) {
                // Force auto-import entries to the end.
                completionItem.sortText =
                    this._makeSortText(SortCategory.AutoImport, name, autoImportText);
                const completionItemData: CompletionItemData = {
                    autoImportText
                };
                completionItem.data = completionItemData;
            } else if (SymbolNameUtils.isDunderName(name)) {
                // Force dunder-named symbols to appear after all other symbols.
                completionItem.sortText =
                    this._makeSortText(SortCategory.DunderSymbol, name);
            } else if (filter === '' && (SymbolNameUtils.isPrivateOrProtectedName(name))) {
                // Distinguish between normal and private symbols only if there is
                // currently no filter text. Once we get a single character to filter
                // upon, we'll no longer differentiate.
                completionItem.sortText =
                    this._makeSortText(SortCategory.PrivateSymbol, name);
            } else {
                completionItem.sortText =
                    this._makeSortText(SortCategory.NormalSymbol, name);
            }

            let markdownString = '';

            if (autoImportText) {
                markdownString += autoImportText;
                markdownString += '\n\n';
                completionItem.data.autoImport = autoImportText;
            }

            if (typeDetail) {
                markdownString += '```python\n' + typeDetail + '\n```\n';
            }

            if (documentation) {
                markdownString += '```text\n\n';
                // Add spaces to the beginning of each line so
                // the text is treated as "preformatted" by the
                // markdown interpreter.
                markdownString += documentation;
                markdownString += '\n```\n';
            }

            if (markdownString) {
                completionItem.documentation = {
                    kind: MarkupKind.Markdown,
                    value: markdownString
                };
            }

            if (additionalTextEdits) {
                completionItem.additionalTextEdits = additionalTextEdits.map(te => {
                    const textEdit: TextEdit = {
                        range: {
                            start: { line: te.range.start.line, character: te.range.start.column },
                            end: { line: te.range.end.line, character: te.range.end.column }
                        },
                        newText: te.replacementText
                    };
                    return textEdit;
                });
            }

            completionList.items.push(completionItem);
        }
    }

    private _getRecentListIndex(name: string, autoImportText: string) {
        return CompletionProvider._mostRecentCompletions.findIndex(
            item => item.label === name &&
                item.autoImportText === autoImportText);
    }

    private _makeSortText(sortCategory: SortCategory, name: string,
            autoImportText = ''): string {

        const recentListIndex = this._getRecentListIndex(name, autoImportText);

        // If the label is in the recent list, modify the category
        // so it appears higher in our list.
        if (recentListIndex >= 0) {
            if (sortCategory === SortCategory.AutoImport) {
                sortCategory = SortCategory.RecentAutoImport;
            } else if (sortCategory === SortCategory.ImportModuleName) {
                sortCategory = SortCategory.RecentImportModuleName;
            } else if (sortCategory === SortCategory.Keyword ||
                    sortCategory === SortCategory.NormalSymbol ||
                    sortCategory === SortCategory.PrivateSymbol ||
                    sortCategory === SortCategory.DunderSymbol) {
                sortCategory = SortCategory.RecentKeywordOrSymbol;
            }
        }

        // Generate a sort string of the format
        //    XX.YYYY.name
        // where XX is the sort category
        // and YYYY is the index of the item in the MRU list
        return this._formatInteger(sortCategory, 2) + '.' +
            this._formatInteger(recentListIndex, 4) + '.' +
            name;
    }

    private _formatInteger(val: number, digits: number): string {
        const charCodeZero = '0'.charCodeAt(0);

        let result = '';
        for (let i = 0; i < digits; i++) {
            // Prepend the next digit.
            let digit = Math.floor(val % 10);
            if (digit < 0) {
                digit = 9;
            }
            result = String.fromCharCode(digit + charCodeZero) + result;
            val = Math.floor(val / 10);
        }

        return result;
    }

    private _convertDeclarationCategoryToItemKind(category: DeclarationCategory,
            type?: Type): CompletionItemKind {

        switch (category) {
            case DeclarationCategory.Variable:
            case DeclarationCategory.Parameter:
                return CompletionItemKind.Variable;

            case DeclarationCategory.Function:
                return CompletionItemKind.Function;

            case DeclarationCategory.Method:
                if (type && type.category === TypeCategory.Property) {
                    return CompletionItemKind.Property;
                }
                return CompletionItemKind.Method;

            case DeclarationCategory.Class:
                return CompletionItemKind.Class;

            case DeclarationCategory.Module:
                return CompletionItemKind.Module;
        }
    }

    private _getImportModuleCompletions(node: ModuleNameNode): CompletionList {
        const execEnvironment = this._configOptions.findExecEnvironment(this._filePath);
        const moduleDescriptor: ImportedModuleDescriptor = {
            leadingDots: node.leadingDots,
            hasTrailingDot: node.hasTrailingDot,
            nameParts: node.nameParts.map(part => part.nameToken.value),
            importedSymbols: []
        };

        const completions = this._importResolver.getCompletionSuggestions(this._filePath,
            execEnvironment, moduleDescriptor, similarityLimit);

        const completionList = CompletionList.create();

        // If we're in the middle of a "from X import Y" statement, offer
        // the "import" keyword as a completion.
        if (!node.hasTrailingDot && node.parent && node.parent.nodeType === ParseNodeType.ImportFrom &&
                node.parent.missingImportKeyword) {

            const keyword = 'import';
            const completionItem = CompletionItem.create(keyword);
            completionItem.kind = CompletionItemKind.Keyword;
            completionList.items.push(completionItem);
            completionItem.sortText =
                this._makeSortText(SortCategory.Keyword, keyword);
        }

        completions.forEach(completionName => {
            const completionItem = CompletionItem.create(completionName);
            completionItem.kind = CompletionItemKind.Module;
            completionList.items.push(completionItem);
            completionItem.sortText =
                this._makeSortText(SortCategory.ImportModuleName, completionName);
        });

        return completionList;
    }
}
