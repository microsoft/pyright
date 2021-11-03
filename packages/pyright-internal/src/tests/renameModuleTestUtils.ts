/*
 * renameModule.fromImports.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Tests Program.RenameModule
 */

import assert from 'assert';
import { CancellationToken } from 'vscode-languageserver';

import { createMapFromItems } from '../common/collectionUtils';
import { assertNever } from '../common/debug';
import { Diagnostic } from '../common/diagnostic';
import { DiagnosticRule } from '../common/diagnosticRules';
import { FileEditAction, FileEditActions, FileOperations } from '../common/editAction';
import { getDirectoryPath, isFile } from '../common/pathUtils';
import { convertRangeToTextRange } from '../common/positionUtils';
import { Position, rangesAreEqual, TextRange } from '../common/textRange';
import { Range } from './harness/fourslash/fourSlashTypes';
import { TestState } from './harness/fourslash/testState';

export function testMoveSymbolAtPosition(
    state: TestState,
    filePath: string,
    newFilePath: string,
    position: Position,
    text?: string,
    replacementText?: string
) {
    const actions = state.program.moveSymbolAtPosition(filePath, newFilePath, position, CancellationToken.None);
    assert(actions);

    const ranges: Range[] = [];
    if (text !== undefined) {
        ranges.push(...state.getRangesByText().get(text)!);
    } else {
        ranges.push(...state.getRanges().filter((r) => !!r.marker?.data));
    }

    assert.strictEqual(actions.edits.length, ranges.length);

    _verifyFileOperations(state, actions, ranges, replacementText);
}

export function testRenameModule(
    state: TestState,
    filePath: string,
    newFilePath: string,
    text?: string,
    replacementText?: string
) {
    const edits = state.program.renameModule(filePath, newFilePath, CancellationToken.None);
    assert(edits);

    const ranges: Range[] = [];
    if (text !== undefined) {
        ranges.push(...state.getRangesByText().get(text)!);
    } else {
        ranges.push(...state.getRanges().filter((r) => !!r.marker?.data));
    }

    assert.strictEqual(edits.length, ranges.length);

    const fileOperations: FileOperations[] = [];
    fileOperations.push({ kind: 'rename', oldFilePath: filePath, newFilePath });

    // Make sure we don't have missing imports on the original state.
    _verifyFileOperations(state, { edits, fileOperations }, ranges, replacementText);
}

function _verifyFileOperations(
    state: TestState,
    fileEditActions: FileEditActions,
    ranges: Range[],
    replacementText: string | undefined
) {
    const editsPerFileMap = createMapFromItems(fileEditActions.edits, (e) => e.filePath);

    _verifyMissingImports();

    _verifyEdits(state, fileEditActions, ranges, replacementText);

    _applyFileOperations(state, fileEditActions);

    // Make sure we don't have missing imports after the change.
    _verifyMissingImports();

    function _verifyMissingImports() {
        for (const editFileName of editsPerFileMap.keys()) {
            const sourceFile = state.program.getBoundSourceFile(editFileName)!;
            _verifyMissingImportsDiagnostics(sourceFile.getDiagnostics(state.configOptions));
        }
    }
}

function _verifyEdits(
    state: TestState,
    fileEditActions: FileEditActions,
    ranges: Range[],
    replacementText: string | undefined
) {
    for (const edit of fileEditActions.edits) {
        assert(
            ranges.some((r) => {
                const data = r.marker?.data as { r: string } | undefined;
                const expectedText = replacementText ?? data?.r ?? 'N/A';
                const expectedRange = state.convertPositionRange(r);
                return (
                    r.fileName === edit.filePath &&
                    rangesAreEqual(expectedRange, edit.range) &&
                    expectedText.replace(/!n!/g, '\n') === edit.replacementText
                );
            }),
            `can't find '${replacementText ?? edit.replacementText}'@'${edit.filePath}:(${edit.range.start.line},${
                edit.range.start.character
            })'`
        );
    }
}

function _applyFileOperations(state: TestState, fileEditActions: FileEditActions) {
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

            state.program.setFileOpened(openedFilePath, result.version + 1, [{ text: result.text }]);
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

function _verifyMissingImportsDiagnostics(diagnostics: Diagnostic[] | undefined) {
    assert(
        !diagnostics || diagnostics.filter((d) => d.getRule() === DiagnosticRule.reportMissingImports).length === 0,
        JSON.stringify(diagnostics!.map((d) => d.message))
    );
}

function _applyEdits(state: TestState, filePath: string, edits: FileEditAction[]) {
    const sourceFile = state.program.getBoundSourceFile(filePath)!;
    const parseResults = sourceFile.getParseResults()!;

    const editsWithOffset = edits
        .map((e) => ({
            range: convertRangeToTextRange(e.range, parseResults.tokenizerOutput.lines)!,
            text: e.replacementText,
        }))
        .sort((e1, e2) => e2.range.start - e1.range.start);

    // Apply change in reverse order.
    let current = parseResults.text;
    for (const change of editsWithOffset) {
        current = current.substr(0, change.range.start) + change.text + current.substr(TextRange.getEnd(change.range));
    }

    return { version: sourceFile.getClientVersion(), text: current };
}
