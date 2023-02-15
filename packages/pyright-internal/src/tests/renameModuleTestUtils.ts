/*
 * renameModuleTestUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Test helpers for rename module tests
 */

import assert from 'assert';
import { CancellationToken } from 'vscode-languageserver';

import { appendArray, createMapFromItems } from '../common/collectionUtils';
import { Diagnostic } from '../common/diagnostic';
import { DiagnosticRule } from '../common/diagnosticRules';
import { FileEditActions } from '../common/editAction';
import { Position } from '../common/textRange';
import { ImportFormat } from '../languageService/autoImporter';
import { Range } from './harness/fourslash/fourSlashTypes';
import { TestState } from './harness/fourslash/testState';
import {
    applyFileOperations,
    convertFileEditActionToString,
    convertRangeToFileEditAction,
    verifyEdits,
} from './testStateUtils';

export function testMoveSymbolAtPosition(
    state: TestState,
    filePath: string,
    newFilePath: string,
    position: Position,
    text?: string,
    replacementText?: string
) {
    const actions = state.program.moveSymbolAtPosition(
        filePath,
        newFilePath,
        position,
        { importFormat: ImportFormat.Absolute },
        CancellationToken.None
    );
    assert(actions);

    const ranges: Range[] = [];
    if (text !== undefined) {
        appendArray(ranges, state.getRangesByText().get(text)!);
    } else {
        appendArray(
            ranges,
            state.getRanges().filter((r) => !!r.marker?.data)
        );
    }

    assert.strictEqual(
        actions.edits.length,
        ranges.length,
        `${actions.edits.map((e) => convertFileEditActionToString(e)).join('|')} vs ${ranges
            .map((r) => convertRangeToFileEditAction(state, r, replacementText))
            .map((e) => convertFileEditActionToString(e))
            .join('|')}`
    );

    _verifyFileOperations(state, actions, ranges, replacementText);
}

export function testRenameModule(
    state: TestState,
    filePath: string,
    newFilePath: string,
    text?: string,
    replacementText?: string
) {
    const editActions = state.program.renameModule(filePath, newFilePath, CancellationToken.None);
    assert(editActions);

    const ranges: Range[] = [];
    if (text !== undefined) {
        appendArray(ranges, state.getRangesByText().get(text)!);
    } else {
        appendArray(
            ranges,
            state.getRanges().filter((r) => !!r.marker?.data)
        );
    }

    assert.strictEqual(
        editActions.edits.length,
        ranges.length,
        `${editActions.edits.map((e) => convertFileEditActionToString(e)).join('\n')} vs ${ranges
            .map((r) => convertRangeToFileEditAction(state, r, replacementText))
            .map((e) => convertFileEditActionToString(e))
            .join('\n')}`
    );

    editActions.fileOperations.push({ kind: 'rename', oldFilePath: filePath, newFilePath });

    // Make sure we don't have missing imports on the original state.
    _verifyFileOperations(state, editActions, ranges, replacementText);
}

function _verifyFileOperations(
    state: TestState,
    fileEditActions: FileEditActions,
    ranges: Range[],
    replacementText: string | undefined
) {
    const editsPerFileMap = createMapFromItems(fileEditActions.edits, (e) => e.filePath);

    _verifyMissingImports();

    verifyEdits(state, fileEditActions, ranges, replacementText);

    applyFileOperations(state, fileEditActions);

    // Make sure we don't have missing imports after the change.
    _verifyMissingImports();

    function _verifyMissingImports() {
        for (const editFileName of editsPerFileMap.keys()) {
            const sourceFile = state.program.getBoundSourceFile(editFileName)!;
            _verifyMissingImportsDiagnostics(sourceFile.getDiagnostics(state.configOptions));
        }
    }
}

function _verifyMissingImportsDiagnostics(diagnostics: Diagnostic[] | undefined) {
    assert(
        !diagnostics || diagnostics.filter((d) => d.getRule() === DiagnosticRule.reportMissingImports).length === 0,
        JSON.stringify(diagnostics!.map((d) => d.message))
    );
}
