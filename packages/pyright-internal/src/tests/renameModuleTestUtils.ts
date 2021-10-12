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
import { Diagnostic } from '../common/diagnostic';
import { DiagnosticRule } from '../common/diagnosticRules';
import { FileEditAction } from '../common/editAction';
import { getDirectoryPath, isFile } from '../common/pathUtils';
import { convertRangeToTextRange } from '../common/positionUtils';
import { rangesAreEqual, TextRange } from '../common/textRange';
import { Range } from './harness/fourslash/fourSlashTypes';
import { TestState } from './harness/fourslash/testState';

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

    const editsPerFileMap = createMapFromItems(edits, (e) => e.filePath);

    // Make sure we don't have missing imports on the original state.
    for (const editFileName of editsPerFileMap.keys()) {
        const sourceFile = state.program.getBoundSourceFile(editFileName)!;
        _verifyMissingImportsDiagnostics(sourceFile.getDiagnostics(state.configOptions));
    }

    // Verify edits
    for (const edit of edits) {
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

    // Apply changes
    // First, apply text changes
    for (const [editFileName, editsPerFile] of editsPerFileMap) {
        const result = _applyEdits(state, editFileName, editsPerFile);
        state.testFS.writeFileSync(editFileName, result.text, 'utf8');

        // Update open file content if the file is in opened state.
        if (result.version) {
            let openedFilePath = editFileName;
            if (editFileName === filePath) {
                openedFilePath = newFilePath;
                state.program.setFileClosed(filePath);
            }

            state.program.setFileOpened(openedFilePath, result.version + 1, [{ text: result.text }]);
        }
    }

    // Second, apply filename change to disk or rename directory.
    if (isFile(state.testFS, filePath)) {
        state.testFS.mkdirpSync(getDirectoryPath(newFilePath));
        state.testFS.renameSync(filePath, newFilePath);

        // Add new file as tracked file
        state.program.addTrackedFile(newFilePath);
    } else {
        state.testFS.renameSync(filePath, newFilePath);
    }

    // And refresh program.
    state.importResolver.invalidateCache();
    state.program.markAllFilesDirty(true);

    // Make sure we don't have missing imports after the change.
    for (const editFileName of editsPerFileMap.keys()) {
        const sourceFile = state.program.getBoundSourceFile(editFileName)!;
        _verifyMissingImportsDiagnostics(sourceFile.getDiagnostics(state.configOptions));
    }
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
