/*
* completionProvider.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Logic that maps a position within a Python program file into
* a list of zero or more text completions that apply in the context.
*/

import * as assert from 'assert';
import { CompletionItem, CompletionItemKind, CompletionList, MarkupKind } from 'vscode-languageserver';

import { ConfigOptions } from '../common/configOptions';
import { DiagnosticTextPosition } from '../common/diagnostic';
import { convertPositionToOffset } from '../common/positionUtils';
import { ErrorExpressionCategory, ErrorExpressionNode, ExpressionNode,
    ImportFromAsNode, ImportFromNode, MemberAccessExpressionNode,
    ModuleNameNode, ModuleNode, NameNode, ParseNode,
    StringListNode, SuiteNode } from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';
import { TokenType } from '../parser/tokenizerTypes';
import { ImportMap } from './analyzerFileInfo';
import { AnalyzerNodeInfo } from './analyzerNodeInfo';
import { DeclarationCategory } from './declaration';
import { ImportedModuleDescriptor, ImportResolver } from './importResolver';
import { ParseTreeUtils } from './parseTreeUtils';
import { SymbolTable } from './symbol';
import { ClassType, FunctionType, ModuleType, ObjectType, OverloadedFunctionType } from './types';
import { TypeUtils } from './typeUtils';

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

export class CompletionProvider {
    static getCompletionsForPosition(parseResults: ParseResults, fileContents: string,
            position: DiagnosticTextPosition, filePath: string, configOptions: ConfigOptions,
            importMap: ImportMap): CompletionList | undefined {

        let offset = convertPositionToOffset(position, parseResults.lines);
        if (offset === undefined) {
            return undefined;
        }

        let node = ParseTreeUtils.findNodeByOffset(parseResults.parseTree, offset);

        // See if we can get to a "better" node by backing up a few columns.
        // A "better" node is defined as one that's deeper than the current
        // node.
        const initialNode = node;
        const initialDepth = node ? ParseTreeUtils.getNodeDepth(node) : 0;
        let curOffset = offset;
        while (curOffset >= 0) {
            curOffset--;
            let curNode = ParseTreeUtils.findNodeByOffset(parseResults.parseTree, curOffset);
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
        const lineTextRange = parseResults.lines.getItemAt(position.line);
        const textOnLine = fileContents.substr(lineTextRange.start, lineTextRange.length);
        const priorText = textOnLine.substr(0, position.column);
        const priorWordIndex = priorText.search(/\w+$/);
        const priorWord = priorWordIndex >= 0 ? priorText.substr(priorWordIndex) : '';

        // Don't offer completions if we're within a comment or a string.
        if (this._isWithinCommentOrString(parseResults, offset, priorText)) {
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
                return this._getImportModuleCompletions(curNode, filePath, configOptions);
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

                    return this._getImportFromCompletions(curNode, priorWord, importMap);
                }
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

    private static _isWithinCommentOrString(parseResults: ParseResults, offset: number,
            priorText: string): boolean {

        const tokenIndex = parseResults.tokens.getItemAtPosition(offset);
        if (tokenIndex < 0) {
            return false;
        }

        const token = parseResults.tokens.getItemAt(tokenIndex);

        if (token.type === TokenType.String) {
            return true;
        }

        // If we're in the middle of a token, we're not in a comment.
        if (offset >= token.start && offset < token.end) {
            return false;
        }

        // See if the text that preceeds the current position contains
        // a '#' character.
        return !!priorText.match(/#/);
    }

    private static _getExpressionErrorCompletions(node: ErrorExpressionNode,
            priorWord: string): CompletionList | undefined {

        // Is the error due to a missing member access name? If so,
        // we can evaluate the left side of the member access expression
        // to determine its type and offer suggestions based on it.
        if (node.category === ErrorExpressionCategory.MissingMemberAccessName) {
            if (node.child instanceof ExpressionNode) {
                return this._getMemberAccessCompletions(node.child, priorWord);
            }
        }

        return undefined;
    }

    private static _getMemberAccessCompletions(leftExprNode: ExpressionNode,
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
        this._addSymbolsForSymbolTable(symbolTable, priorWord, completionList);

        return completionList;
    }

    private static _getStatementCompletions(parseNode: ParseNode,
            priorWord: string): CompletionList | undefined {

        // For now, use the same logic for expressions and statements.
        return this._getExpressionCompletions(parseNode, priorWord);
    }

    private static _getExpressionCompletions(parseNode: ParseNode,
            priorWord: string): CompletionList | undefined {

        const completionList = CompletionList.create();

        // Add symbols.
        this._addSymbols(parseNode, priorWord, completionList);

        // Add keywords.
        this._findMatchingKeywords(_keywords, priorWord).map(keyword => {
            let completionItem = CompletionItem.create(keyword);
            completionItem.kind = CompletionItemKind.Keyword;
            completionList.items.push(completionItem);
        });

        return completionList;
    }

    private static _getImportFromCompletions(nameNode: NameNode,
            priorWord: string, importMap: ImportMap): CompletionList | undefined {

        assert(nameNode.parent instanceof ImportFromAsNode);
        const importFromAsNode = nameNode.parent as ImportFromAsNode;
        assert(importFromAsNode.parent instanceof ImportFromNode);
        const importFromNode = importFromAsNode.parent as ImportFromNode;

        // Don't attempt to provide completions for "import * from".
        if (importFromNode.imports.length === 0) {
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

        if (importMap[resolvedPath]) {
            const moduleNode = importMap[resolvedPath].parseTree;
            if (moduleNode) {
                const moduleType = AnalyzerNodeInfo.getExpressionType(moduleNode) as ModuleType;
                if (moduleType) {
                    const moduleFields = moduleType.getFields();
                    this._addSymbolsForSymbolTable(moduleFields, priorWord, completionList);
                }
            }
        }

        // Add the implicit imports.
        importInfo.implicitImports.forEach(implImport => {
            this._addNameToCompletionList(implImport.name, CompletionItemKind.Module,
                priorWord, completionList);
        });

        return completionList;
    }

    private static _findMatchingKeywords(keywordList: string[],
            partialMatch: string): string[] {

        return keywordList.filter(keyword => {
            if (partialMatch) {
                return keyword.startsWith(partialMatch);
            } else {
                return true;
            }
        });
    }

    private static _addSymbols(node: ParseNode, priorWord: string,
            completionList: CompletionList) {

        let curNode: ParseNode | undefined = node;

        while (curNode) {
            // Does this node have a scope associated with it?
            let scope = AnalyzerNodeInfo.getScope(curNode);
            if (scope) {
                while (scope) {
                    this._addSymbolsForSymbolTable(scope.getSymbolTable(),
                        priorWord, completionList);
                    scope = scope.getParent();
                }
                break;
            }

            curNode = curNode.parent;
        }
    }

    private static _addSymbolsForSymbolTable(symbolTable: SymbolTable,
            priorWord: string, completionList: CompletionList) {

        symbolTable.forEach((item, name) => {
            // Determine the kind.
            let itemKind: CompletionItemKind = CompletionItemKind.Variable;
            const declarations = item.getDeclarations();
            let typeDetail: string | undefined;
            let documentation: string | undefined;

            if (declarations.length > 0) {
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
            }

            this._addNameToCompletionList(name, itemKind, priorWord, completionList,
                typeDetail, documentation);
        });
    }

    private static _addNameToCompletionList(name: string, itemKind: CompletionItemKind,
            filter: string, completionList: CompletionList, typeDetail?: string,
            documentation?: string) {

        if (name.startsWith(filter)) {
            const completionItem = CompletionItem.create(name);
            completionItem.kind = itemKind;
            let markdownString = '';

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
            completionList.items.push(completionItem);
        }
    }

    private static _convertDeclarationCategoryToItemKind(
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

    private static _getImportModuleCompletions(node: ModuleNameNode,
            filePath: string, configOptions: ConfigOptions): CompletionList {

        const execEnvironment = configOptions.findExecEnvironment(filePath);
        const resolver = new ImportResolver(filePath, configOptions, execEnvironment);
        const moduleDescriptor: ImportedModuleDescriptor = {
            leadingDots: node.leadingDots,
            hasTrailingDot: node.hasTrailingDot,
            nameParts: node.nameParts.map(part => part.nameToken.value),
            importedSymbols: []
        };

        const completions = resolver.getCompletionSuggestions(moduleDescriptor);

        const completionList = CompletionList.create();
        completions.forEach(completionName => {
            const completionItem = CompletionItem.create(completionName);
            completionItem.kind = CompletionItemKind.Module;
            completionList.items.push(completionItem);
        });

        return completionList;
    }
}
