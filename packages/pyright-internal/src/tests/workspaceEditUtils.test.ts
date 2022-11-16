/*
 * workspaceEditUtils.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * test workspaceEditUtils
 */

import * as assert from 'assert';
import { TextDocumentEdit } from 'vscode-languageserver-types';

import { convertPathToUri } from '../common/pathUtils';
import { applyWorkspaceEdits, generateWorkspaceEdits } from '../common/workspaceEditUtils';
import { AnalyzerServiceExecutor } from '../languageService/analyzerServiceExecutor';
import { TestLanguageService } from './harness/fourslash/testLanguageService';
import { parseAndGetTestState, TestState } from './harness/fourslash/testState';
import { verifyWorkspaceEdit } from './harness/fourslash/workspaceEditTestUtils';

test('test applyWorkspaceEdits changes', async () => {
    const code = `
// @filename: test.py
//// [|/*marker*/|]
        `;

    const state = parseAndGetTestState(code).state;
    const cloned = await getClonedService(state);
    const range = state.getRangeByMarkerName('marker')!;

    const fileChanged = new Set<string>();
    applyWorkspaceEdits(
        cloned,
        {
            changes: {
                [convertPathToUri(cloned.fs, range.fileName)]: [
                    {
                        range: state.convertPositionRange(range),
                        newText: 'Text Changed',
                    },
                ],
            },
        },
        fileChanged
    );

    assert.strictEqual(fileChanged.size, 1);
    assert.strictEqual(cloned.test_program.getSourceFile(range.fileName)?.getFileContent(), 'Text Changed');
});

test('test applyWorkspaceEdits documentChanges', async () => {
    const code = `
// @filename: test.py
//// [|/*marker*/|]
        `;

    const state = parseAndGetTestState(code).state;
    const cloned = await getClonedService(state);
    const range = state.getRangeByMarkerName('marker')!;

    const fileChanged = new Set<string>();
    applyWorkspaceEdits(
        cloned,
        {
            documentChanges: [
                TextDocumentEdit.create(
                    {
                        uri: convertPathToUri(cloned.fs, range.fileName),
                        version: null,
                    },
                    [
                        {
                            range: state.convertPositionRange(range),
                            newText: 'Text Changed',
                        },
                    ]
                ),
            ],
        },
        fileChanged
    );

    assert.strictEqual(fileChanged.size, 1);
    assert.strictEqual(cloned.test_program.getSourceFile(range.fileName)?.getFileContent(), 'Text Changed');
});

test('test generateWorkspaceEdits', async () => {
    const code = `
// @filename: test1.py
//// [|/*marker1*/|]

// @filename: test2.py
//// [|/*marker2*/|]
        `;

    const state = parseAndGetTestState(code).state;
    const cloned = await getClonedService(state);
    const range1 = state.getRangeByMarkerName('marker1')!;

    const fileChanged = new Set<string>();
    applyWorkspaceEdits(
        cloned,
        {
            changes: {
                [convertPathToUri(cloned.fs, range1.fileName)]: [
                    {
                        range: state.convertPositionRange(range1),
                        newText: 'Test1 Changed',
                    },
                ],
            },
        },
        fileChanged
    );

    applyWorkspaceEdits(
        cloned,
        {
            documentChanges: [
                TextDocumentEdit.create(
                    {
                        uri: convertPathToUri(cloned.fs, range1.fileName),
                        version: null,
                    },
                    [
                        {
                            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
                            newText: 'NewTest1',
                        },
                    ]
                ),
            ],
        },
        fileChanged
    );

    const range2 = state.getRangeByMarkerName('marker2')!;
    applyWorkspaceEdits(
        cloned,
        {
            documentChanges: [
                TextDocumentEdit.create(
                    {
                        uri: convertPathToUri(cloned.fs, range2.fileName),
                        version: null,
                    },
                    [
                        {
                            range: state.convertPositionRange(range2),
                            newText: 'Test2 Changed',
                        },
                    ]
                ),
            ],
        },
        fileChanged
    );

    applyWorkspaceEdits(
        cloned,
        {
            changes: {
                [convertPathToUri(cloned.fs, range2.fileName)]: [
                    {
                        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
                        newText: 'NewTest2',
                    },
                ],
            },
        },
        fileChanged
    );

    assert.strictEqual(fileChanged.size, 2);

    const actualEdits = generateWorkspaceEdits(state.workspace.serviceInstance, cloned, fileChanged);
    verifyWorkspaceEdit(
        {
            changes: {
                [convertPathToUri(cloned.fs, range1.fileName)]: [
                    {
                        range: state.convertPositionRange(range1),
                        newText: 'NewTest1 Changed',
                    },
                ],
                [convertPathToUri(cloned.fs, range2.fileName)]: [
                    {
                        range: state.convertPositionRange(range1),
                        newText: 'NewTest2 Changed',
                    },
                ],
            },
        },
        actualEdits
    );
});

async function getClonedService(state: TestState) {
    return await AnalyzerServiceExecutor.cloneService(
        new TestLanguageService(state.workspace, state.console, state.workspace.serviceInstance.fs),
        state.workspace,
        { useBackgroundAnalysis: false }
    );
}
