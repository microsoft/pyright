/*
 * textEditTracker.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Tracks text edits on a per-file basis.
 */

import { CancellationToken } from 'vscode-languageserver';

import { getFileInfo } from '../analyzer/analyzerNodeInfo';
import {
    getAllImportNames,
    getContainingImportStatement,
    getTextEditsForAutoImportInsertion,
    getTextEditsForAutoImportSymbolAddition,
    getTextRangeForImportNameDeletion,
    haveSameParentModule,
    ImportGroup,
    ImportNameInfo,
    ImportStatements,
    ModuleNameInfo,
} from '../analyzer/importStatementUtils';
import * as ParseTreeUtils from '../analyzer/parseTreeUtils';
import {
    ImportAsNode,
    ImportFromAsNode,
    ImportFromNode,
    ImportNode,
    ParseNode,
    ParseNodeType,
} from '../parser/parseNodes';
import { ParseFileResults } from '../parser/parser';
import { appendArray, getOrAdd, removeArrayElements } from './collectionUtils';
import * as debug from './debug';
import { FileEditAction } from './editAction';
import { convertOffsetToPosition, convertTextRangeToRange } from './positionUtils';
import { doRangesIntersect, extendRange, isRangeInRange, Range, TextRange } from './textRange';
import { Uri } from './uri/uri';

export class TextEditTracker {
    private readonly _nodesRemoved: Map<ParseNode, ParseFileResults> = new Map<ParseNode, ParseFileResults>();
    private readonly _results = new Map<string, FileEditAction[]>();

    private readonly _pendingNodeToRemove: NodeToRemove[] = [];

    constructor(private _mergeOnlyDuplications = true) {
        // Empty
    }

    addEdits(...edits: FileEditAction[]) {
        edits.forEach((e) => this.addEdit(e.fileUri, e.range, e.replacementText));
    }

    addEdit(fileUri: Uri, range: Range, replacementText: string) {
        const edits = getOrAdd(this._results, fileUri.key, () => []);

        // If there is any overlapping edit, see whether we can merge edits.
        // We can merge edits, if one of them is 'deletion' or 2 edits has the same
        // replacement text with containing range.
        const overlappingEdits = this._getEditsToMerge(edits, range, replacementText);
        if (overlappingEdits.length > 0) {
            // Merge the given edit with the existing edits by
            // first deleting existing edits and expanding the current edit's range
            // to cover all existing edits.
            this._removeEdits(edits, overlappingEdits);
            overlappingEdits.forEach((e) => {
                extendRange(range, e.range);
            });
        }

        edits.push({ fileUri: fileUri, range, replacementText });
    }

    addEditWithTextRange(parseFileResults: ParseFileResults, range: TextRange, replacementText: string) {
        const filePath = getFileInfo(parseFileResults.parserOutput.parseTree).fileUri;

        const existing = parseFileResults.text.substr(range.start, range.length);
        if (existing === replacementText) {
            // No change. Return as it is.
            return;
        }

        this.addEdit(filePath, convertTextRangeToRange(range, parseFileResults.tokenizerOutput.lines), replacementText);
    }

    deleteImportName(parseFileResults: ParseFileResults, importToDelete: ImportFromAsNode | ImportAsNode) {
        // TODO: remove all these manual text handling and merge it to _processNodeRemoved that is
        //       used by remove unused imports.
        const imports: ImportFromAsNode[] | ImportAsNode[] =
            importToDelete.nodeType === ParseNodeType.ImportAs
                ? (importToDelete.parent as ImportNode).d.list
                : (importToDelete.parent as ImportFromNode).d.imports;

        const filePath = getFileInfo(parseFileResults.parserOutput.parseTree).fileUri;
        const ranges = getTextRangeForImportNameDeletion(
            parseFileResults,
            imports,
            imports.findIndex((v) => v === importToDelete)
        );

        ranges.forEach((r) => this.addEditWithTextRange(parseFileResults, r, ''));

        this._markNodeRemoved(importToDelete, parseFileResults);

        // Check whether we have deleted all trailing import names.
        // If either no trailing import is deleted or handled properly
        // then, there is nothing to do. otherwise, either delete the whole statement
        // or remove trailing comma.
        // ex) from x import [y], z or from x import y[, z]
        let lastImportIndexNotDeleted = 0;
        for (
            lastImportIndexNotDeleted = imports.length - 1;
            lastImportIndexNotDeleted >= 0;
            lastImportIndexNotDeleted--
        ) {
            if (!this._nodesRemoved.has(imports[lastImportIndexNotDeleted])) {
                break;
            }
        }

        if (lastImportIndexNotDeleted === -1) {
            // Whole statement is deleted. Remove the statement itself.
            // ex) [from x import a, b, c] or [import a]
            const importStatement = importToDelete.parent;
            if (importStatement) {
                this.addEdit(filePath, ParseTreeUtils.getFullStatementRange(importStatement, parseFileResults), '');
            }
        } else if (lastImportIndexNotDeleted >= 0 && lastImportIndexNotDeleted < imports.length - 2) {
            // We need to delete trailing comma
            // ex) from x import a, [b, c]
            const start = TextRange.getEnd(imports[lastImportIndexNotDeleted]);
            const length = TextRange.getEnd(imports[lastImportIndexNotDeleted + 1]) - start;
            this.addEditWithTextRange(parseFileResults, { start, length }, '');
        }
    }

    addOrUpdateImport(
        parseFileResults: ParseFileResults,
        importStatements: ImportStatements,
        moduleNameInfo: ModuleNameInfo,
        importGroup: ImportGroup,
        importNameInfo?: ImportNameInfo[],
        updateOptions?: {
            currentFromImport: ImportFromNode;
            originalModuleName: string;
        }
    ): void {
        // TODO: remove all these manual text handling and merge it to _processNodeRemoved that is
        //       used by remove unused imports.
        if (
            importNameInfo &&
            this._tryUpdateImport(parseFileResults, importStatements, moduleNameInfo, importNameInfo, updateOptions)
        ) {
            return;
        }

        this._addImport(parseFileResults, importStatements, moduleNameInfo, importGroup, importNameInfo);
    }

    removeNodes(...nodes: { node: ParseNode; parseFileResults: ParseFileResults }[]) {
        this._pendingNodeToRemove.push(...nodes);
    }

    isNodeRemoved(node: ParseNode) {
        return this._nodesRemoved.has(node);
    }

    getEdits(token: CancellationToken) {
        this._processNodeRemoved(token);

        const edits: FileEditAction[] = [];
        this._results.forEach((v) => appendArray(edits, v));

        return edits;
    }

    private _addImport(
        parseFileResults: ParseFileResults,
        importStatements: ImportStatements,
        moduleNameInfo: ModuleNameInfo,
        importGroup: ImportGroup,
        importNameInfo?: ImportNameInfo[]
    ) {
        const fileUri = getFileInfo(parseFileResults.parserOutput.parseTree).fileUri;

        this.addEdits(
            ...getTextEditsForAutoImportInsertion(
                importNameInfo ?? [],
                moduleNameInfo,
                importStatements,
                importGroup,
                parseFileResults,
                convertOffsetToPosition(
                    parseFileResults.parserOutput.parseTree.length,
                    parseFileResults.tokenizerOutput.lines
                )
            ).map((e) => ({ fileUri, range: e.range, replacementText: e.replacementText }))
        );
    }

    private _tryUpdateImport(
        parseFileResults: ParseFileResults,
        importStatements: ImportStatements,
        moduleNameInfo: ModuleNameInfo,
        importNameInfo: ImportNameInfo[],
        updateOptions?: UpdateOption
    ): boolean {
        if (!updateOptions) {
            return false;
        }

        // See whether we have existing from import statement for the same module
        // ex) from [|moduleName|] import subModule
        const imported = importStatements.orderedImports.find(
            (i) =>
                i.node.nodeType === ParseNodeType.ImportFrom &&
                (i.moduleName === moduleNameInfo.nameForImportFrom || i.moduleName === moduleNameInfo.name)
        );

        if (!imported || imported.node.nodeType !== ParseNodeType.ImportFrom || imported.node.d.isWildcardImport) {
            return false;
        }

        const fileUri = getFileInfo(parseFileResults.parserOutput.parseTree).fileUri;

        const edits = getTextEditsForAutoImportSymbolAddition(importNameInfo, imported, parseFileResults);
        if (imported.node !== updateOptions.currentFromImport) {
            // Add what we want to the existing "import from" statement as long as it is not the same import
            // node we are working on.
            // ex) from xxx import yyy <= we are working on here.
            //     from xxx import zzz <= but we found this.
            this.addEdits(...edits.map((e) => ({ fileUri, range: e.range, replacementText: e.replacementText })));
            return true;
        }

        const moduleNames = updateOptions.originalModuleName.split('.');
        const newModuleNames = moduleNameInfo.name.split('.');

        if (!haveSameParentModule(moduleNames, newModuleNames)) {
            // Module has moved.
            return false;
        }

        // Check whether we can avoid creating a new statement. We can't just merge with existing one since
        // we could create invalid text edits (2 edits that change the same span, or invalid replacement text since
        // texts on the node has changed)
        if (importNameInfo.length !== 1 || edits.length !== 1) {
            return false;
        }

        const deletions = this._getDeletionsForSpan(fileUri, edits[0].range);
        if (deletions.length === 0) {
            this.addEdit(fileUri, edits[0].range, edits[0].replacementText);
            return true;
        }

        const lastModuleName = moduleNames[moduleNames.length - 1];
        const newLastModuleName = newModuleNames[newModuleNames.length - 1];

        const alias = importNameInfo[0].alias === newLastModuleName ? lastModuleName : importNameInfo[0].alias;
        const importName = updateOptions.currentFromImport.d.imports.find(
            (i) => i.d.name.d.value === lastModuleName && i.d.alias?.d.value === alias
        );

        if (!importName) {
            return false;
        }

        this._removeEdits(fileUri, deletions);
        if (importName.d.alias) {
            this._nodesRemoved.delete(importName.d.alias);
        }

        this.addEdit(
            fileUri,
            convertTextRangeToRange(importName.d.name, parseFileResults.tokenizerOutput.lines),
            newLastModuleName
        );

        return true;
    }

    private _getDeletionsForSpan(fileUriOrEdit: Uri | FileEditAction[], range: Range) {
        const edits = this._getOverlappingForSpan(fileUriOrEdit, range);
        return edits.filter((e) => e.replacementText === '');
    }

    private _removeEdits(fileUriOrEdit: Uri | FileEditAction[], edits: FileEditAction[]) {
        if (Uri.is(fileUriOrEdit)) {
            fileUriOrEdit = this._results.get(fileUriOrEdit.key) ?? [];
        }

        removeArrayElements(fileUriOrEdit, (f) => edits.some((e) => FileEditAction.areEqual(f, e)));
    }

    private _getEditsToMerge(edits: FileEditAction[], range: Range, replacementText: string) {
        const overlappingEdits = this._getOverlappingForSpan(edits, range);
        if (this._mergeOnlyDuplications && overlappingEdits.length > 0) {
            // Merge duplicated deletion. For deletion, we can even merge edits
            // intersecting each other.
            if (replacementText === '') {
                return overlappingEdits.filter((e) => e.replacementText === '');
            }

            // Merge duplicated edits as long as one of them contains the other.
            return overlappingEdits.filter(
                (e) =>
                    e.replacementText === replacementText &&
                    (isRangeInRange(range, e.range) || isRangeInRange(e.range, range))
            );
        }

        // We are allowed to merge more than exact duplication. If the existing edit
        // is deletion or duplicated text with containing ranges, merge them to 1.
        return overlappingEdits.filter(
            (e) =>
                e.replacementText === '' ||
                (e.replacementText === replacementText &&
                    (isRangeInRange(range, e.range) || isRangeInRange(e.range, range)))
        );
    }

    private _getOverlappingForSpan(fileUriOrEdit: Uri | FileEditAction[], range: Range) {
        if (Uri.is(fileUriOrEdit)) {
            fileUriOrEdit = this._results.get(fileUriOrEdit.key) ?? [];
        }

        return fileUriOrEdit.filter((e) => doRangesIntersect(e.range, range));
    }

    private _processNodeRemoved(token: CancellationToken) {
        while (this._pendingNodeToRemove.length > 0) {
            const numberOfNodesBeforeProcessing = this._pendingNodeToRemove.length;

            const peekNodeToRemove = this._pendingNodeToRemove[this._pendingNodeToRemove.length - 1];
            this._handleImportNameNode(peekNodeToRemove, token);

            if (this._pendingNodeToRemove.length === numberOfNodesBeforeProcessing) {
                // It looks like we don't know how to handle the node,
                // Please add code to handle the case.
                debug.assert(`please add handler for ${peekNodeToRemove.node.nodeType}`);

                // As a default behavior, we will just remove the node
                this._pendingNodeToRemove.pop();

                const info = getFileInfo(peekNodeToRemove.parseFileResults.parserOutput.parseTree);
                this.addEdit(info.fileUri, convertTextRangeToRange(peekNodeToRemove.node, info.lines), '');
            }
        }
    }

    private _handleImportNameNode(nodeToRemove: NodeToRemove, token: CancellationToken) {
        const node = nodeToRemove.node;
        if (node.nodeType !== ParseNodeType.Name) {
            return false;
        }

        const module = nodeToRemove.parseFileResults.parserOutput.parseTree;
        const info = getFileInfo(module);
        const importNode = getContainingImportStatement(ParseTreeUtils.findNodeByOffset(module, node.start), token);
        if (!importNode) {
            return false;
        }

        const nameNodes = getAllImportNames(importNode);

        // check various different cases
        // 1. check whether all imported names in the import statement is not used.
        const nodesRemoved = this._pendingNodeToRemove.filter((nodeToRemove) =>
            nameNodes.some((n) => TextRange.overlapsRange(nodeToRemove.node, n))
        );

        if (nameNodes.length === nodesRemoved.length) {
            this.addEdit(
                info.fileUri,
                ParseTreeUtils.getFullStatementRange(importNode, nodeToRemove.parseFileResults),
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

        const editSpans = getTextRangeForImportNameDeletion(nodeToRemove.parseFileResults, nameNodes, ...indices);
        editSpans.forEach((e) => this.addEdit(info.fileUri, convertTextRangeToRange(e, info.lines), ''));

        this._removeNodesHandled(nodesRemoved);
        return true;
    }

    private _removeNodesHandled(nodesRemoved: NodeToRemove[]) {
        nodesRemoved.forEach((n) => this._markNodeRemoved(n.node, n.parseFileResults));
        removeArrayElements(this._pendingNodeToRemove, (n) => this._nodesRemoved.has(n.node));
    }

    private _markNodeRemoved(nodeToDelete: ParseNode, parseFileResults: ParseFileResults) {
        // Mark that we don't need to process these node again later.
        this._nodesRemoved.set(nodeToDelete, parseFileResults);
        if (nodeToDelete.nodeType === ParseNodeType.ImportAs) {
            this._nodesRemoved.set(nodeToDelete.d.module, parseFileResults);
            nodeToDelete.d.module.d.nameParts.forEach((n) => this._nodesRemoved.set(n, parseFileResults));
            if (nodeToDelete.d.alias) {
                this._nodesRemoved.set(nodeToDelete.d.alias, parseFileResults);
            }
        } else if (nodeToDelete.nodeType === ParseNodeType.ImportFromAs) {
            this._nodesRemoved.set(nodeToDelete.d.name, parseFileResults);
            if (nodeToDelete.d.alias) {
                this._nodesRemoved.set(nodeToDelete.d.alias, parseFileResults);
            }
        }
    }
}

interface UpdateOption {
    currentFromImport: ImportFromNode;
    originalModuleName: string;
}

interface NodeToRemove {
    node: ParseNode;
    parseFileResults: ParseFileResults;
}
