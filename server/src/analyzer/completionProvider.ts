/*
* completionProvider.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Logic that maps a position within a Python program file into
* a list of zero or more text completions that apply in the context.
*/

import { CompletionItem, CompletionItemKind, CompletionList } from 'vscode-languageserver';

import { DiagnosticTextPosition } from '../common/diagnostic';
import { convertPositionToOffset } from '../common/positionUtils';
import { ErrorExpressionCategory, ErrorExpressionNode, ExpressionNode, MemberAccessExpressionNode,
    ModuleNode, ParseNode, SuiteNode } from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';
import { AnalyzerNodeInfo } from './analyzerNodeInfo';
import { ParseTreeUtils } from './parseTreeUtils';
import { SymbolCategory, SymbolTable } from './symbol';
import { ClassType, ModuleType, ObjectType } from './types';
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
            position: DiagnosticTextPosition): CompletionList | undefined {

        let offset = convertPositionToOffset(position, parseResults.lines);
        if (offset === undefined) {
            return undefined;
        }

        let node = ParseTreeUtils.findNodeByOffset(parseResults.parseTree, offset);

        // See if we can get to a "better" node by backing up a few columns.
        // A "better" node is defined as one that's deeper than the current
        // node.
        let initialNode = node;
        let initialDepth = node ? ParseTreeUtils.getNodeDepth(node) : 0;
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
            if (curNode instanceof ErrorExpressionNode) {
                return this._getExpressionErrorCompletions(curNode, priorWord);
            }

            if (curNode instanceof MemberAccessExpressionNode) {
                return this._getMemberAccessCompletions(curNode.leftExpression, priorWord);
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

        let completionList = CompletionList.create();

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

    private static _findMatchingKeywords(keywordList: string[], partialMatch: string): string[] {
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
            const scope = AnalyzerNodeInfo.getScope(curNode);
            if (scope) {
                this._addSymbolsForSymbolTable(scope.getSymbolTable(),
                    priorWord, completionList);
            }

            curNode = curNode.parent;
        }
    }

    private static _addSymbolsForSymbolTable(symbolTable: SymbolTable,
            priorWord: string, completionList: CompletionList) {

        symbolTable.forEach((item, name) => {
            if (name.startsWith(priorWord)) {
                let completionItem = CompletionItem.create(name);

                // Determine the kind.
                let itemKind: CompletionItemKind = CompletionItemKind.Variable;
                if (item.declarations) {
                    itemKind = this._convertSymbolCategoryToItemKind(
                        item.declarations[0].category);
                }
                completionItem.kind = itemKind;
                completionList.items.push(completionItem);
            }
        });
    }

    private static _convertSymbolCategoryToItemKind(category: SymbolCategory): CompletionItemKind {
        switch (category) {
            case SymbolCategory.Variable:
            case SymbolCategory.Parameter:
                return CompletionItemKind.Variable;

            case SymbolCategory.Function:
                return CompletionItemKind.Function;

            case SymbolCategory.Method:
                return CompletionItemKind.Method;

            case SymbolCategory.Class:
                return CompletionItemKind.Class;

            case SymbolCategory.Module:
                return CompletionItemKind.Module;
        }
    }
}
