/*
 * textEditUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Language server command execution functionality.
 */

import { CancellationToken, TextEdit, WorkspaceEdit } from 'vscode-languageserver';

import { getFileInfo } from '../analyzer/analyzerNodeInfo';
import {
    getAllImportNames,
    getContainingImportStatement,
    getTextRangeForImportNameDeletion,
} from '../analyzer/importStatementUtils';
import * as ParseTreeUtils from '../analyzer/parseTreeUtils';
import * as debug from '../common/debug';
import { FileEditAction, TextEditAction } from '../common/editAction';
import { ParseNode, ParseNodeType } from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';
import { appendArray, getOrAdd, removeArrayElements } from './collectionUtils';
import { isString } from './core';
import { convertTextRangeToRange } from './positionUtils';
import { doRangesIntersect, extendRange, Range, rangesAreEqual, TextRange } from './textRange';

export function convertEditActionsToTextEdits(editActions: TextEditAction[]): TextEdit[] {
    return editActions.map((editAction) => ({
        range: editAction.range,
        newText: editAction.replacementText,
    }));
}

export function convertEditActionsToWorkspaceEdit(
    uri: string,
    editActions: TextEditAction[] | undefined
): WorkspaceEdit {
    if (!editActions) {
        return {};
    }

    const edits = convertEditActionsToTextEdits(editActions);

    return {
        changes: {
            [uri]: edits,
        },
    };
}

export interface NodeToRemove {
    parseResults: ParseResults;
    node: ParseNode;
}

export class TextEditTracker {
    private readonly _nodesRemoved: NodeToRemove[] = [];
    private readonly _results = new Map<string, FileEditAction[]>();

    addEdits(...edits: FileEditAction[]) {
        edits.forEach((e) => this.addEdit(e.filePath, e.range, e.replacementText));
    }

    addEdit(filePath: string, range: Range, replacementText: string) {
        const edits = getOrAdd(this._results, filePath, () => []);
        if (replacementText === '') {
            // If it is a deletion, merge with overlapping deletion edit if there is any.
            const deletions = this.getDeletionsForSpan(edits, range);
            if (deletions.length > 0) {
                // Delete the existing ones.
                this.removeEdits(edits, deletions);

                // Extend range with deleted ones.
                extendRange(
                    range,
                    deletions.map((d) => d.range)
                );
            }
        }

        // Don't put duplicated edit. It can happen if code has duplicated module import.
        // ex) from a import b, b, c
        // If we need to introduce new "from import" statement for "b", we will add new statement twice.
        if (edits.some((e) => rangesAreEqual(e.range, range) && e.replacementText === replacementText)) {
            return;
        }

        edits.push({ filePath, range, replacementText });
    }

    getDeletionsForSpan(filePathOrEdit: string | FileEditAction[], range: Range) {
        if (isString(filePathOrEdit)) {
            filePathOrEdit = this._results.get(filePathOrEdit) ?? [];
        }

        return filePathOrEdit.filter((e) => e.replacementText === '' && doRangesIntersect(e.range, range));
    }

    removeEdits(filePathOrEdit: string | FileEditAction[], edits: FileEditAction[]) {
        if (isString(filePathOrEdit)) {
            filePathOrEdit = this._results.get(filePathOrEdit) ?? [];
        }

        removeArrayElements(filePathOrEdit, (f) => edits.findIndex((e) => e === f) >= 0);
    }

    removeNodes(...nodes: NodeToRemove[]) {
        this._nodesRemoved.push(...nodes);
    }

    getEdits(token: CancellationToken) {
        this._processNodeRemoved(token);

        const edits: FileEditAction[] = [];
        this._results.forEach((v) => appendArray(edits, v));

        return edits;
    }

    private _processNodeRemoved(token: CancellationToken) {
        while (this._nodesRemoved.length > 0) {
            const numberOfNodesBeforeProcessing = this._nodesRemoved.length;

            const peekNodeToRemove = this._nodesRemoved[this._nodesRemoved.length - 1];
            this._handleImportNameNode(peekNodeToRemove, token);

            if (this._nodesRemoved.length === numberOfNodesBeforeProcessing) {
                // It looks like we don't know how to handle the node,
                // Please add code to handle the case.
                debug.assert(`please add handler for ${peekNodeToRemove.node.nodeType}`);

                // As a default behavior, we will just remove the node
                this._nodesRemoved.pop();

                const info = getFileInfo(peekNodeToRemove.parseResults.parseTree);
                this.addEdit(info.filePath, convertTextRangeToRange(peekNodeToRemove.node, info.lines), '');
            }
        }
    }

    private _handleImportNameNode(peekNodeToRemove: NodeToRemove, token: CancellationToken) {
        const peekNode = peekNodeToRemove.node;
        if (peekNode.nodeType !== ParseNodeType.Name) {
            return false;
        }

        const module = peekNodeToRemove.parseResults.parseTree;
        const info = getFileInfo(module);
        const importNode = getContainingImportStatement(ParseTreeUtils.findNodeByOffset(module, peekNode.start), token);
        if (!importNode) {
            return false;
        }

        const nameNodes = getAllImportNames(importNode);

        // check various different cases
        // 1. check whether all imported names in the import statement is not used.
        const nodesRemoved = this._nodesRemoved.filter((nodeToRemove) =>
            nameNodes.some((n) => TextRange.overlapsRange(nodeToRemove.node, n))
        );

        if (nameNodes.length === nodesRemoved.length) {
            this.addEdit(
                info.filePath,
                ParseTreeUtils.getFullStatementRange(importNode, peekNodeToRemove.parseResults.tokenizerOutput),
                ''
            );

            // Remove nodes that are handled from queue.
            this._removeNodesHandled(nodesRemoved);
            return true;
        }

        // 2. some of modules in the import statement is used.
        const indices: number[] = [];
        for (let i = 0; i < nameNodes.length; i++) {
            const nameNode = nameNodes[i];

            if (nodesRemoved.some((r) => TextRange.overlapsRange(r.node, nameNode))) {
                indices.push(i);
            }
        }

        if (indices.length === 0) {
            // can't find module user wants to remove
            return false;
        }

        const editSpans = getTextRangeForImportNameDeletion(nameNodes, ...indices);
        editSpans.forEach((e) => this.addEdit(info.filePath, convertTextRangeToRange(e, info.lines), ''));

        this._removeNodesHandled(nodesRemoved);
        return true;
    }

    private _removeNodesHandled(nodesRemoved: NodeToRemove[]) {
        removeArrayElements(this._nodesRemoved, (n) => nodesRemoved.some((r) => r === n));
    }
}
