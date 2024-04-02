/*
 * textEditUtil.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 */

import assert from 'assert';
import { CancellationToken } from 'vscode-jsonrpc';

import { findNodeByOffset } from '../analyzer/parseTreeUtils';
import { FileEditAction } from '../common/editAction';
import { TextEditTracker } from '../common/textEditTracker';
import { Range } from './harness/fourslash/fourSlashTypes';
import { parseAndGetTestState, TestState } from './harness/fourslash/testState';
import { convertRangeToFileEditAction } from './testStateUtils';

test('simple add', () => {
    const code = `
//// import [|{|"r":"bar"|}foo|]
    `;

    verifyEdits(code);
});

test('multiple edits', () => {
    const code = `
//// import [|{|"r":"bar"|}foo|][|{|"r":"!n!import os"|}|]
    `;

    verifyEdits(code);
});

test('delete and add', () => {
    const code = `
//// [|{|"r":""|}import foo|][|{|"r":"import os"|}|]
    `;

    verifyEdits(code);
});

test('overlapped delete', () => {
    const code = `
//// [|{|"e":""|}[|{|"r":""|}import [|{|"r":""|}foo|]|]|]
    `;

    verifyEdits(code);
});

test('overlapped delete and add', () => {
    const code = `
//// [|{|"r":""|}import foo[|{|"r":"!n!import os"|}|]
//// |]
    `;

    verifyEdits(code);
});

test('dup with same range', () => {
    const code = `
//// [|{|"e":"import os"|}[|{|"r":"import os"|}[|{|"r":"import os"|}import foo|]|]|]
    `;

    verifyEdits(code);
});

test('delete and add with merge', () => {
    const code = `
//// [|{|"e":"import os"|}[|{|"r":""|}import foo|][|{|"r":"import os"|}|]|]
    `;

    verifyEdits(code, false);
});

test('overlapped delete with merge', () => {
    const code = `
//// [|{|"e":""|}[|{|"r":""|}import [|{|"r":""|}foo|]|]|]
    `;

    verifyEdits(code, false);
});

test('overlapped delete and add with merge', () => {
    const code = `
//// [|{|"e":"!n!import os"|}[|{|"r":""|}import foo[|{|"r":"!n!import os"|}|]
//// |]|]
    `;

    verifyEdits(code, false);
});

test('dup with overlapped range', () => {
    const code = `
//// [|{|"e":"import os"|}[|{|"r":""|}import sys!n!|][|{|"r":"import os"|}[|{|"r":"import os"|}import foo|]|]|]
    `;

    verifyEdits(code, false);
});

test('handle comments', () => {
    const code = `
//// from os import (
////      abort[|{|"e":""|},|] # comment[|{|"e":""|}
////      [|{|"r":""|}access|]|]
////      )
    `;

    verifyRemoveNodes(code);
});

function verifyRemoveNodes(code: string) {
    const state = parseAndGetTestState(code).state;
    const tracker = new TextEditTracker();

    const ranges = state.getRanges();
    const changeRanges = _getChangeRanges(ranges);
    for (const range of changeRanges) {
        const parseFileResults = state.program.getParseResults(range.fileUri)!;
        const node = findNodeByOffset(parseFileResults.parserOutput.parseTree, range.pos)!;
        tracker.removeNodes({ node, parseFileResults });
    }

    const edits = tracker.getEdits(CancellationToken.None);

    const editRanges = _getEditRanges(ranges);
    assert.strictEqual(edits.length, editRanges.length);
    assert(
        _areEqual(
            edits,
            editRanges.map((r) => _createFileActionEdit(state, r))
        )
    );
}

function verifyEdits(code: string, mergeOnlyDuplications = true) {
    const state = parseAndGetTestState(code).state;
    const tracker = new TextEditTracker(mergeOnlyDuplications);

    const ranges = state.getRanges();
    const changeRanges = _getChangeRanges(ranges);
    for (const range of changeRanges) {
        const edit = convertRangeToFileEditAction(state, range);
        tracker.addEdit(edit.fileUri, edit.range, edit.replacementText);
    }

    const edits = tracker.getEdits(CancellationToken.None);

    const editRanges = _getEditRanges(ranges);
    assert.strictEqual(edits.length, editRanges.length);
    assert(
        _areEqual(
            edits,
            editRanges.map((r) => _createFileActionEdit(state, r))
        )
    );
}

function _getChangeRanges(ranges: Range[]) {
    return ranges.filter((r) => r.marker?.data && (r.marker.data as { r: string }).r !== undefined);
}

function _getEditRanges(ranges: Range[]) {
    const editRanges = ranges.filter((r) => r.marker?.data && (r.marker.data as { e: string }).e !== undefined);
    return editRanges.length > 0 ? editRanges : _getChangeRanges(ranges);
}

function _areEqual(a1: FileEditAction[], a2: FileEditAction[]) {
    return a1.some((e1) => a2.some((e2) => FileEditAction.areEqual(e1, e2)));
}

function _createFileActionEdit(state: TestState, range: Range): FileEditAction {
    const replacementText = (range.marker!.data as { e: string }).e;
    return convertRangeToFileEditAction(state, range, replacementText);
}
