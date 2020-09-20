/*
 * documentHighlightProvider.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Logic that maps a position within a Python program file into
 * one or more highlight types.
 */

import { CancellationToken, DocumentHighlight, DocumentHighlightKind } from 'vscode-languageserver';

import { isCodeUnreachable } from '../analyzer/analyzerNodeInfo';
import { Declaration } from '../analyzer/declaration';
import { areDeclarationsSame } from '../analyzer/declarationUtils';
import * as ParseTreeUtils from '../analyzer/parseTreeUtils';
import { ParseTreeWalker } from '../analyzer/parseTreeWalker';
import { TypeEvaluator } from '../analyzer/typeEvaluator';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { convertOffsetToPosition, convertPositionToOffset } from '../common/positionUtils';
import { Position, TextRange } from '../common/textRange';
import { ModuleNameNode, NameNode, ParseNode, ParseNodeType, StringNode } from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';

// This walker looks for symbols that are semantically equivalent
// to the requested symbol.
class HighlightSymbolTreeWalker extends ParseTreeWalker {
    constructor(
        private _symbolName: string,
        private _declarations: Declaration[],
        private _parseResults: ParseResults,
        private _highlightResults: DocumentHighlight[],
        private _evaluator: TypeEvaluator,
        private _cancellationToken: CancellationToken
    ) {
        super();
    }

    findHighlights() {
        this.walk(this._parseResults.parseTree);
    }

    walk(node: ParseNode) {
        if (!isCodeUnreachable(node)) {
            super.walk(node);
        }
    }

    visitModuleName(node: ModuleNameNode): boolean {
        // Don't ever look for references within a module name.
        return false;
    }

    visitName(node: NameNode): boolean {
        throwIfCancellationRequested(this._cancellationToken);

        // No need to do any more work if the symbol name doesn't match.
        if (node.value !== this._symbolName) {
            return false;
        }

        if (this._declarations.length > 0) {
            const declarations = this._evaluator.getDeclarationsForNameNode(node);

            if (declarations && declarations.length > 0) {
                // Does this name share a declaration with the symbol of interest?
                if (declarations.some((decl) => this._resultsContainsDeclaration(decl))) {
                    this._addResult(node);
                }
            }
        } else {
            // There were no declarations
            this._addResult(node);
        }

        return true;
    }

    private _addResult(node: NameNode) {
        this._highlightResults.push({
            kind: this._isWriteAccess(node) ? DocumentHighlightKind.Write : DocumentHighlightKind.Read,
            range: {
                start: convertOffsetToPosition(node.start, this._parseResults.tokenizerOutput.lines),
                end: convertOffsetToPosition(TextRange.getEnd(node), this._parseResults.tokenizerOutput.lines),
            },
        });
    }

    private _isWriteAccess(node: NameNode) {
        let prevNode: ParseNode = node;
        let curNode: ParseNode | undefined = prevNode.parent;

        while (curNode) {
            switch (curNode.nodeType) {
                case ParseNodeType.Assignment: {
                    return prevNode === curNode.leftExpression;
                }

                case ParseNodeType.AugmentedAssignment: {
                    return prevNode === curNode.leftExpression;
                }

                case ParseNodeType.AssignmentExpression: {
                    return prevNode === curNode.name;
                }

                case ParseNodeType.Del: {
                    return true;
                }

                case ParseNodeType.For: {
                    return prevNode === curNode.targetExpression;
                }

                case ParseNodeType.ImportAs: {
                    return (
                        prevNode === curNode.alias ||
                        (curNode.module.nameParts.length > 0 && prevNode === curNode.module.nameParts[0])
                    );
                }

                case ParseNodeType.ImportFromAs: {
                    return prevNode === curNode.alias || (!curNode.alias && prevNode === curNode.name);
                }

                case ParseNodeType.MemberAccess: {
                    if (prevNode !== curNode.memberName) {
                        return false;
                    }
                    break;
                }

                case ParseNodeType.Except: {
                    return prevNode === curNode.name;
                }

                case ParseNodeType.With: {
                    return curNode.withItems.some((item) => item === prevNode);
                }

                case ParseNodeType.ListComprehensionFor: {
                    return prevNode === curNode.targetExpression;
                }

                case ParseNodeType.TypeAnnotation: {
                    if (prevNode === curNode.typeAnnotation) {
                        return false;
                    }
                    break;
                }

                case ParseNodeType.Function:
                case ParseNodeType.Class:
                case ParseNodeType.Module: {
                    return false;
                }
            }

            prevNode = curNode;
            curNode = curNode.parent;
        }

        return false;
    }

    private _resultsContainsDeclaration(declaration: Declaration) {
        // Resolve the declaration.
        const resolvedDecl = this._evaluator.resolveAliasDeclaration(declaration, /* resolveLocalNames */ false);
        if (!resolvedDecl) {
            return false;
        }

        // The reference results declarations are already resolved, so we don't
        // need to call resolveAliasDeclaration on them.
        if (this._declarations.some((decl) => areDeclarationsSame(decl, resolvedDecl))) {
            return true;
        }

        // We didn't find the declaration using local-only alias resolution. Attempt
        // it again by fully resolving the alias.
        const resolvedDeclNonlocal = this._evaluator.resolveAliasDeclaration(
            resolvedDecl,
            /* resolveLocalNames */ true
        );
        if (!resolvedDeclNonlocal || resolvedDeclNonlocal === resolvedDecl) {
            return false;
        }

        return this._declarations.some((decl) => areDeclarationsSame(decl, resolvedDeclNonlocal));
    }
}

// This walker looks for strings that are equivalent
// to the requested string.
class HighlightStringTreeWalker extends ParseTreeWalker {
    constructor(
        private _stringValue: string,
        private _parseResults: ParseResults,
        private _highlightResults: DocumentHighlight[],
        private _cancellationToken: CancellationToken
    ) {
        super();
    }

    findHighlights() {
        this.walk(this._parseResults.parseTree);
    }

    walk(node: ParseNode) {
        if (!isCodeUnreachable(node)) {
            super.walk(node);
        }
    }

    visitString(node: StringNode): boolean {
        throwIfCancellationRequested(this._cancellationToken);

        // Compare the unescaped values.
        if (node.value !== this._stringValue) {
            return false;
        }

        this._highlightResults.push({
            kind: DocumentHighlightKind.Text,
            range: {
                start: convertOffsetToPosition(node.start, this._parseResults.tokenizerOutput.lines),
                end: convertOffsetToPosition(TextRange.getEnd(node), this._parseResults.tokenizerOutput.lines),
            },
        });

        return true;
    }
}

export class DocumentHighlightProvider {
    static getDocumentHighlight(
        parseResults: ParseResults,
        position: Position,
        evaluator: TypeEvaluator,
        token: CancellationToken
    ): DocumentHighlight[] | undefined {
        throwIfCancellationRequested(token);

        const offset = convertPositionToOffset(position, parseResults.tokenizerOutput.lines);
        if (offset === undefined) {
            return undefined;
        }

        const node = ParseTreeUtils.findNodeByOffset(parseResults.parseTree, offset);
        if (node === undefined) {
            return undefined;
        }

        const results: DocumentHighlight[] = [];

        if (node.nodeType === ParseNodeType.Name) {
            const declarations = evaluator.getDeclarationsForNameNode(node) || [];

            const resolvedDeclarations: Declaration[] = [];
            declarations.forEach((decl) => {
                const resolvedDecl = evaluator.resolveAliasDeclaration(decl, true);
                if (resolvedDecl) {
                    resolvedDeclarations.push(resolvedDecl);
                }
            });

            const walker = new HighlightSymbolTreeWalker(
                node.value,
                resolvedDeclarations,
                parseResults,
                results,
                evaluator,
                token
            );
            walker.findHighlights();
        } else if (node.nodeType === ParseNodeType.String) {
            // User feedback indicates that most users don't want string literals
            // to be highlighted through the document highlight provider, so we
            // will disable this.
            // const walker = new HighlightStringTreeWalker(node.value, parseResults, results, token);
            // walker.findHighlights();
        }

        return results.length > 0 ? results : undefined;
    }
}
