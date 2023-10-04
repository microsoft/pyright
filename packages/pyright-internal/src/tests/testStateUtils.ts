/*
 * testStateUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Test helpers for TestState
 */

import assert from 'assert';
import { WorkspaceEdit } from 'vscode-languageserver-protocol';

import { createMapFromItems } from '../common/collectionUtils';
import { assertNever } from '../common/debug';
import { FileEditAction, FileEditActions, FileOperations } from '../common/editAction';
import { FileSystem } from '../common/fileSystem';
import { convertUriToPath, getDirectoryPath, isFile } from '../common/pathUtils';
import { TextRange, rangesAreEqual } from '../common/textRange';
import { applyTextEditsToString } from '../common/workspaceEditUtils';
import { Range } from './harness/fourslash/fourSlashTypes';
import { TestState } from './harness/fourslash/testState';
import { CancellationToken, CreateFile, DeleteFile, RenameFile, TextDocumentEdit } from 'vscode-languageserver';
import { Program } from '../analyzer/program';
import { ConfigOptions } from '../common/configOptions';
import { findNodeByOffset } from '../analyzer/parseTreeUtils';
import { DocumentSymbolCollector } from '../languageService/documentSymbolCollector';
import { NameNode } from '../parser/parseNodes';
import { isArray } from '../common/core';

export function convertFileEditActionToString(edit: FileEditAction): string {
    return `'${edit.replacementText.replace(/\n/g, '!n!')}'@'${edit.filePath}:(${edit.range.start.line},${
        edit.range.start.character
    })-(${edit.range.end.line},${edit.range.end.character})'`;
}

export function convertRangeToFileEditAction(state: TestState, range: Range, replacementText?: string): FileEditAction {
    const data = range.marker?.data as { r: string } | undefined;
    return {
        filePath: range.fileName,
        replacementText: (replacementText ?? data?.r ?? 'N/A').replace(/!n!/g, '\n'),
        range: state.convertPositionRange(range),
    };
}

export function verifyEdits(
    state: TestState,
    fileEditActions: FileEditActions,
    ranges: Range[],
    replacementText: string | undefined
) {
    for (const edit of fileEditActions.edits) {
        const expected: FileEditAction[] = ranges.map((r) => convertRangeToFileEditAction(state, r, replacementText));
        assert(
            expected.some((a) => {
                return (
                    a.filePath === edit.filePath &&
                    rangesAreEqual(a.range, edit.range) &&
                    a.replacementText === edit.replacementText
                );
            }),
            `can't find ${convertFileEditActionToString(edit)} in ${expected
                .map((a) => convertFileEditActionToString(a))
                .join('|')}`
        );
    }
}

export function applyFileEditActions(state: TestState, fileEditActions: FileEditActions) {
    // Apply changes
    // First, apply text changes
    const editsPerFileMap = createMapFromItems(fileEditActions.edits, (e) => e.filePath);

    for (const [editFileName, editsPerFile] of editsPerFileMap) {
        const result = _applyEdits(state, editFileName, editsPerFile);
        state.testFS.writeFileSync(editFileName, result.text, 'utf8');

        // Update open file content if the file is in opened state.
        if (result.version) {
            let openedFilePath = editFileName;
            const renamed = fileEditActions.fileOperations.find(
                (o) => o.kind === 'rename' && o.oldFilePath === editFileName
            );
            if (renamed?.kind === 'rename') {
                openedFilePath = renamed.newFilePath;
                state.program.setFileClosed(renamed.oldFilePath);
            }

            state.program.setFileOpened(openedFilePath, result.version + 1, result.text);
        }
    }

    // Second, apply filename change to disk or rename directory.
    for (const fileOperation of fileEditActions.fileOperations) {
        switch (fileOperation.kind) {
            case 'create': {
                state.testFS.mkdirpSync(getDirectoryPath(fileOperation.filePath));
                state.testFS.writeFileSync(fileOperation.filePath, '');
                break;
            }
            case 'rename': {
                if (isFile(state.testFS, fileOperation.oldFilePath)) {
                    state.testFS.mkdirpSync(getDirectoryPath(fileOperation.newFilePath));
                    state.testFS.renameSync(fileOperation.oldFilePath, fileOperation.newFilePath);

                    // Add new file as tracked file
                    state.program.addTrackedFile(fileOperation.newFilePath);
                } else {
                    state.testFS.renameSync(fileOperation.oldFilePath, fileOperation.newFilePath);
                }
                break;
            }
            case 'delete': {
                state.testFS.rimrafSync(fileOperation.filePath);
                break;
            }
            default:
                assertNever(fileOperation);
        }
    }

    // And refresh program.
    state.importResolver.invalidateCache();
    state.program.markAllFilesDirty(true);
}

function _applyEdits(state: TestState, filePath: string, edits: FileEditAction[]) {
    const sourceFile = state.program.getBoundSourceFile(filePath)!;
    const parseResults = sourceFile.getParseResults()!;

    const current = applyTextEditsToString(
        edits.filter((e) => e.filePath === filePath),
        parseResults.tokenizerOutput.lines,
        parseResults.text
    );

    return { version: sourceFile.getClientVersion(), text: current };
}

export function convertWorkspaceEditToFileEditActions(fs: FileSystem, edit: WorkspaceEdit): FileEditActions {
    const edits: FileEditAction[] = [];
    const fileOperations: FileOperations[] = [];

    if (edit.changes) {
        for (const kv of Object.entries(edit.changes)) {
            const filePath = convertUriToPath(fs, kv[0]);
            kv[1].forEach((e) => edits.push({ filePath, range: e.range, replacementText: e.newText }));
        }
    }

    if (edit.documentChanges) {
        for (const change of edit.documentChanges) {
            if (TextDocumentEdit.is(change)) {
                for (const e of change.edits) {
                    edits.push({
                        filePath: convertUriToPath(fs, change.textDocument.uri),
                        range: e.range,
                        replacementText: e.newText,
                    });
                }
            } else if (CreateFile.is(change)) {
                fileOperations.push({ kind: 'create', filePath: convertUriToPath(fs, change.uri) });
            } else if (RenameFile.is(change)) {
                fileOperations.push({
                    kind: 'rename',
                    oldFilePath: convertUriToPath(fs, change.oldUri),
                    newFilePath: convertUriToPath(fs, change.newUri),
                });
            } else if (DeleteFile.is(change)) {
                fileOperations.push({ kind: 'delete', filePath: convertUriToPath(fs, change.uri) });
            }
        }
    }
    return { edits, fileOperations: fileOperations };
}

export function verifyReferencesAtPosition(
    program: Program,
    configOption: ConfigOptions,
    symbolNames: string | string[],
    fileName: string,
    position: number,
    ranges: Range[]
) {
    const sourceFile = program.getBoundSourceFile(fileName);
    assert(sourceFile);

    const node = findNodeByOffset(sourceFile.getParseResults()!.parseTree, position);
    const decls = DocumentSymbolCollector.getDeclarationsForNode(
        program,
        node as NameNode,
        /* resolveLocalName */ true,
        CancellationToken.None
    );

    const rangesByFile = createMapFromItems(ranges, (r) => r.fileName);
    for (const rangeFileName of rangesByFile.keys()) {
        const collector = new DocumentSymbolCollector(
            program,
            isArray(symbolNames) ? symbolNames : [symbolNames],
            decls,
            program.getBoundSourceFile(rangeFileName)!.getParseResults()!.parseTree,
            CancellationToken.None,
            {
                treatModuleInImportAndFromImportSame: true,
                skipUnreachableCode: false,
            }
        );

        const results = collector.collect();
        const rangesOnFile = rangesByFile.get(rangeFileName)!;
        assert.strictEqual(results.length, rangesOnFile.length, `${rangeFileName}@${symbolNames}`);

        for (const result of results) {
            assert(rangesOnFile.some((r) => r.pos === result.range.start && r.end === TextRange.getEnd(result.range)));
        }
    }
}
