/*
* completionProvider.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Logic that maps a position within a Python program file into
* a list of zero or more text completions that apply in the context.
*/

import { CompletionItem, CompletionItemKind, CompletionList, MarkupKind,
    Position, TextEdit } from 'vscode-languageserver';

import { ImportMap } from '../analyzer/analyzerFileInfo';
import { AnalyzerNodeInfo } from '../analyzer/analyzerNodeInfo';
import { DeclarationCategory } from '../analyzer/declaration';
import { ImportedModuleDescriptor, ImportResolver,
    ModuleNameAndType } from '../analyzer/importResolver';
import { ImportType } from '../analyzer/importResult';
import { ImportStatements, ImportStatementUtils } from '../analyzer/importStatementUtils';
import { ParseTreeUtils } from '../analyzer/parseTreeUtils';
import { Scope, ScopeType } from '../analyzer/scope';
import { Symbol, SymbolTable } from '../analyzer/symbol';
import { SymbolUtils } from '../analyzer/symbolUtils';
import { ClassType, FunctionType, ModuleType, ObjectType,
    OverloadedFunctionType } from '../analyzer/types';
import { TypeUtils } from '../analyzer/typeUtils';
import { ConfigOptions } from '../common/configOptions';
import { DiagnosticTextPosition } from '../common/diagnostic';
import { convertOffsetToPosition, convertPositionToOffset } from '../common/positionUtils';
import { StringUtils } from '../common/stringUtils';
import { AssignmentNode, ErrorExpressionCategory, ErrorExpressionNode,
    ExpressionNode, ImportFromAsNode, ImportFromNode,
    MemberAccessExpressionNode, ModuleNameNode, ModuleNode, NameNode,
    ParseNode, StatementListNode, StringListNode, SuiteNode  } from '../parser/parseNodes';
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

// We'll use a somewhat-arbitrary cutoff value here to determine
// whether it's sufficiently similar.
const SimilarityLimit = 0.25;

export type ModuleSymbolMap = { [file: string]: Scope };

export class CompletionProvider {
    constructor(private _parseResults: ParseResults,
        private _fileContents: string,
        private _importResolver: ImportResolver,
        private _position: DiagnosticTextPosition,
        private _filePath: string,
        private _configOptions: ConfigOptions,
        private _importMapCallback: () => ImportMap,
        private _moduleSymbolsCallback: () => ModuleSymbolMap) {
    }

    getCompletionsForPosition(): CompletionList | undefined {
        let offset = convertPositionToOffset(this._position, this._parseResults.lines);
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

            let curNode = ParseTreeUtils.findNodeByOffset(this._parseResults.parseTree, curOffset);
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
        // precendence.
        let errorNode: ParseNode | undefined = node;
        while (errorNode) {
            if (errorNode instanceof ErrorExpressionNode) {
                break;
            }

            errorNode = errorNode.parent;
        }

        // Determine the context based on the parse node's type and
        // that of its ancestors.
        let curNode = errorNode || node;
        while (true) {
            // Don't offer completions inside of a string node.
            if (curNode instanceof StringListNode) {
                return undefined;
            }

            if (curNode instanceof ModuleNameNode) {
                return this._getImportModuleCompletions(curNode);
            }

            if (curNode instanceof ErrorExpressionNode) {
                return this._getExpressionErrorCompletions(curNode, priorWord);
            }

            if (curNode instanceof MemberAccessExpressionNode) {
                return this._getMemberAccessCompletions(curNode.leftExpression, priorWord);
            }

            if (curNode instanceof NameNode) {
                // Are we within a "from X import Y as Z" statement and
                // more specifically within the "Y"?
                if (curNode.parent instanceof ImportFromAsNode &&
                        curNode.parent.name === curNode) {
                    const parentNode = curNode.parent.parent;

                    if (parentNode instanceof ImportFromNode) {
                        return this._getImportFromCompletions(parentNode, priorWord);
                    }
                } else if (curNode.parent instanceof MemberAccessExpressionNode) {
                    return this._getMemberAccessCompletions(
                        curNode.parent.leftExpression, priorWord);
                }
            }

            if (curNode instanceof ImportFromNode) {
                return this._getImportFromCompletions(curNode, priorWord);
            }

            if (curNode instanceof ExpressionNode) {
                return this._getExpressionCompletions(curNode, priorWord);
            }

            if (curNode instanceof SuiteNode || curNode instanceof ModuleNode) {
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
        if (offset > token.start && offset < token.end) {
            return false;
        }

        // See if the text that preceeds the current position contains
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
                if (node.child instanceof ExpressionNode) {
                    return this._getMemberAccessCompletions(node.child, priorWord);
                }
                break;
            }
        }

        return undefined;
    }

    private _createSingleKeywordCompletionList(keyword: string): CompletionList {
        const completionItem = CompletionItem.create('in');
        completionItem.kind = CompletionItemKind.Keyword;

        return CompletionList.create([completionItem]);
    }

    private _getMemberAccessCompletions(leftExprNode: ExpressionNode,
            priorWord: string): CompletionList | undefined {

        const leftType = AnalyzerNodeInfo.getExpressionType(leftExprNode);
        let symbolTable = new SymbolTable();

        if (leftType instanceof ObjectType) {
            TypeUtils.getMembersForClass(leftType.getClassType(), symbolTable, true);
        } else if (leftType instanceof ClassType) {
            TypeUtils.getMembersForClass(leftType, symbolTable, false);
        } else if (leftType instanceof ModuleType) {
            symbolTable = leftType.getFields();
        }

        let completionList = CompletionList.create();
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
        });

        // Add auto-import suggestions from other modules. Don't bother doing
        // this expensive check unless/until we get at least two characters.
        // Also, ignore this check for privates, since they are not imported.
        if (priorWord.length > 2 && !priorWord.startsWith('_')) {
            this._getAutoImportCompletions(priorWord, completionList);
        }

        return completionList;
    }

    private _getAutoImportCompletions(priorWord: string, completionList: CompletionList) {
        const moduleSymbolMap = this._moduleSymbolsCallback();
        const importStatements = ImportStatementUtils.getTopLevelImports(
            this._parseResults.parseTree);

        Object.keys(moduleSymbolMap).forEach(filePath => {
            const moduleScope = moduleSymbolMap[filePath];
            const symbolTable = moduleScope.getSymbolTable();

            symbolTable.forEach((item, name) => {
                if (name.startsWith(priorWord) && moduleScope.isSymbolExported(name)) {
                    // If there's already a local completion suggestion with
                    // this name, don't add an auto-import suggestion with
                    // the same name.
                    const localDuplicate = completionList.items.find(
                        item => item.label === name && !item.data.autoImport);
                    const declarations = item.getDeclarations();
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

                            const autoImportTextEdits = this._getTextEditsForAutoImport(
                                name, importStatements, filePath, importSource,
                                moduleNameAndType ? moduleNameAndType.importType : ImportType.Local);

                            this._addSymbol(name, item, priorWord,
                                completionList, importSource, autoImportTextEdits);
                        }
                    }
                }
            });
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

    private _getTextEditsForAutoImport(symbolName: string, importStatements: ImportStatements,
            filePath: string, moduleName: string, importType: ImportType): TextEdit[] {

        const textEditList: TextEdit[] = [];

        // Does an 'import from' statement already exist? If so, we'll reuse it.
        const importStatement = importStatements.mapByFilePath[filePath];
        if (importStatement && importStatement.node instanceof ImportFromNode) {
            // Scan through the import symbols to find the right insertion point,
            // assuming we want to keep the imports alphebetized.
            let priorImport: ImportFromAsNode | undefined;
            for (let curImport of importStatement.node.imports) {
                if (priorImport && curImport.name.nameToken.value > symbolName) {
                    break;
                }

                priorImport = curImport;
            }

            if (priorImport) {
                const insertionOffset = priorImport.name.end;
                const insertionPosition = convertOffsetToPosition(insertionOffset, this._parseResults.lines);

                textEditList.push(TextEdit.insert(
                    Position.create(insertionPosition.line, insertionPosition.column),
                    ', ' + symbolName)
                );
            }
        } else {
            // We need to emit a new 'from import' statement.
            let newImportStatement = `from ${ moduleName } import ${ symbolName }`;
            let insertionPosition: Position;
            if (importStatements.orderedImports.length > 0) {
                let insertBefore = true;
                let insertionImport = importStatements.orderedImports[0];

                // Find a good spot to insert the new import statement. Follow
                // the PEP8 standard sorting order whereby built-in imports are
                // followed by third-party, which are followed by local.
                let prevImportType = ImportType.BuiltIn;
                for (let curImport of importStatements.orderedImports) {
                    // If the import was resolved, use its import type. If it wasn't
                    // resolved, assume that it's the same import type as the previous
                    // one.
                    const curImportType: ImportType = curImport.importResult ?
                        curImport.importResult.importType : prevImportType;

                    if (importType < curImportType) {
                        if (!insertBefore && prevImportType < importType) {
                            // Add an extra line to create a new group.
                            newImportStatement = this._parseResults.predominantLineEndSequence + newImportStatement;
                        }
                        break;
                    }

                    if (importType === curImportType && curImport.moduleName > moduleName) {
                        break;
                    }

                    // If we're about to hit the end of the import statements, don't go
                    // any further.
                    if (curImport.followsNonImportStatement) {
                        if (importType > prevImportType) {
                            // Add an extra line to create a new group.
                            newImportStatement = this._parseResults.predominantLineEndSequence + newImportStatement;
                        }
                        break;
                    }

                    // If this is the last import, see if we need to create a new group.
                    if (curImport === importStatements.orderedImports[importStatements.orderedImports.length - 1]) {

                        if (importType > curImportType) {
                            // Add an extra line to create a new group.
                            newImportStatement = this._parseResults.predominantLineEndSequence + newImportStatement;
                        }
                    }

                    // Are we starting a new group?
                    if (!insertBefore && importType < prevImportType && importType === curImportType) {
                        insertBefore = true;
                    } else {
                        insertBefore = false;
                    }

                    prevImportType = curImportType;
                    insertionImport = curImport;
                }

                if (insertionImport) {
                    if (insertBefore) {
                        newImportStatement = newImportStatement + this._parseResults.predominantLineEndSequence;
                    } else {
                        newImportStatement = this._parseResults.predominantLineEndSequence + newImportStatement;
                    }

                    const position = convertOffsetToPosition(
                        insertBefore ? insertionImport.node.start : insertionImport.node.end,
                        this._parseResults.lines);
                    insertionPosition = Position.create(position.line, position.column);
                } else {
                    insertionPosition = Position.create(0, 0);
                }
            } else {
                // Insert at or near the top of the file. See if there's a doc string and
                // copyright notice, etc. at the top. If so, move past those.
                insertionPosition = Position.create(0, 0);
                let addNewLineBefore = false;

                for (let statement of this._parseResults.parseTree.statements) {
                    let stopHere = true;
                    if (statement instanceof StatementListNode && statement.statements.length === 1) {
                        const simpleStatement = statement.statements[0];

                        if (simpleStatement instanceof StringListNode) {
                            // Assume that it's a file header doc string.
                            stopHere = false;
                        } else if (simpleStatement instanceof AssignmentNode) {
                            if (simpleStatement.leftExpression instanceof NameNode) {
                                if (SymbolUtils.isDunderName(simpleStatement.leftExpression.nameToken.value)) {
                                    // Assume that it's an assignment of __copyright__, __author__, etc.
                                    stopHere = false;
                                }
                            }
                        }
                    }

                    if (stopHere) {
                        const statementPosition = convertOffsetToPosition(statement.start,
                            this._parseResults.lines);
                        insertionPosition = Position.create(statementPosition.line, statementPosition.column);
                        addNewLineBefore = false;
                        break;
                    } else {
                        const statementPosition = convertOffsetToPosition(statement.end,
                            this._parseResults.lines);
                        insertionPosition = Position.create(statementPosition.line, statementPosition.column);
                        addNewLineBefore = true;
                    }
                }

                newImportStatement += this._parseResults.predominantLineEndSequence +
                    this._parseResults.predominantLineEndSequence;

                if (addNewLineBefore) {
                    newImportStatement = this._parseResults.predominantLineEndSequence + newImportStatement;
                } else {
                    this._parseResults.predominantLineEndSequence += this._parseResults.predominantLineEndSequence;
                }
            }

            textEditList.push(TextEdit.insert(insertionPosition, newImportStatement));
        }

        return textEditList;
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
            const moduleNode = importMap[resolvedPath].parseTree;
            if (moduleNode) {
                const moduleType = AnalyzerNodeInfo.getExpressionType(moduleNode) as ModuleType;
                if (moduleType) {
                    const moduleFields = moduleType.getFields();
                    this._addSymbolsForSymbolTable(moduleFields,
                        name => {
                            // Don't suggest symbols that have already been imported.
                            return !importFromNode.imports.find(
                                imp => imp.name.nameToken.value === name);
                        },
                        priorWord, completionList);
                }
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
                return keyword.startsWith(partialMatch);
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
                        name => scope!.isSymbolExported(name),
                        priorWord, completionList);
                    scope = scope.getParent();
                }
                break;
            }

            curNode = curNode.parent;
        }
    }

    private _addSymbolsForSymbolTable(symbolTable: SymbolTable,
            isExportedCallback: (name: string) => boolean,
            priorWord: string, completionList: CompletionList) {

        symbolTable.forEach((item, name) => {
            // If there are no declarations or the symbol is not
            // exported from this scope, don't include it in the
            // suggestion list.
            if (isExportedCallback(name)) {
                this._addSymbol(name, item, priorWord, completionList);
            }
        });
    }

    private _addSymbol(name: string, symbol: Symbol,
            priorWord: string, completionList: CompletionList,
            autoImportSource?: string, additionalTextEdits?: TextEdit[]) {

        const declarations = symbol.getDeclarations();

        if (declarations.length > 0) {
            let itemKind: CompletionItemKind = CompletionItemKind.Variable;
            let typeDetail: string | undefined;
            let documentation: string | undefined;

            const declaration = declarations[0];
            itemKind = this._convertDeclarationCategoryToItemKind(
                declaration.category);

            const type = declaration.declaredType;
            if (type) {
                switch (declaration.category) {
                    case DeclarationCategory.Variable:
                    case DeclarationCategory.Parameter:
                        typeDetail = name + ': ' + type.asString();
                        break;

                    case DeclarationCategory.Function:
                    case DeclarationCategory.Method:
                        if (type instanceof OverloadedFunctionType) {
                            typeDetail = type.getOverloads().map(overload =>
                                name + overload.type.asString()).join('\n');
                        } else {
                            typeDetail = name + type.asString();
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

            if (type instanceof ModuleType ||
                    type instanceof ClassType ||
                    type instanceof FunctionType) {
                documentation = type.getDocString();
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
            additionalTextEdits?: TextEdit[]) {

        const similarity = StringUtils.computeCompletionSimilarity(filter, name);

        if (similarity > SimilarityLimit) {
            const completionItem = CompletionItem.create(name);
            completionItem.kind = itemKind;
            completionItem.data = {};

            if (autoImportText) {
                // Force auto-import entries to the end.
                completionItem.sortText = '~~' + name;
            } else if (SymbolUtils.isDunderName(name)) {
                // Force dunder-named symbols to appear after all other symbols.
                completionItem.sortText = '~' + name;
            } else {
                completionItem.sortText = name;
            }

            let markdownString = '';

            if (autoImportText) {
                markdownString += autoImportText;
                markdownString += '\n\n';
                completionItem.data.autoImport = true;
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
                completionItem.additionalTextEdits = additionalTextEdits;
            }

            completionList.items.push(completionItem);
        }
    }

    private _convertDeclarationCategoryToItemKind(
                category: DeclarationCategory): CompletionItemKind {

        switch (category) {
            case DeclarationCategory.Variable:
            case DeclarationCategory.Parameter:
                return CompletionItemKind.Variable;

            case DeclarationCategory.Function:
                return CompletionItemKind.Function;

            case DeclarationCategory.Method:
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
            execEnvironment, moduleDescriptor, SimilarityLimit);

        const completionList = CompletionList.create();
        completions.forEach(completionName => {
            const completionItem = CompletionItem.create(completionName);
            completionItem.kind = CompletionItemKind.Module;
            completionList.items.push(completionItem);
        });

        return completionList;
    }
}
