/*
 * workspaceEditUtils.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * test workspaceEditUtils
 */

import * as assert from 'assert';
import { TextDocumentEdit } from 'vscode-languageserver-types';

import { CancellationToken } from 'vscode-languageserver';
import { IPythonMode } from '../analyzer/sourceFile';
import { combinePaths, convertPathToUri, getDirectoryPath } from '../common/pathUtils';
import { applyWorkspaceEdit, generateWorkspaceEdit } from '../common/workspaceEditUtils';
import { AnalyzerServiceExecutor } from '../languageService/analyzerServiceExecutor';
import { TestLanguageService } from './harness/fourslash/testLanguageService';
import { TestState, parseAndGetTestState } from './harness/fourslash/testState';
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
    applyWorkspaceEdit(
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

test('test edit mode for workspace', async () => {
    const code = `
// @filename: test.py
//// [|/*marker*/|]
            `;

    const state = parseAndGetTestState(code).state;
    state.workspace.service.enterEditMode();
    const range = state.getRangeByMarkerName('marker')!;

    const fileChanged = new Set<string>();
    applyWorkspaceEdit(
        state.workspace.service,
        {
            documentChanges: [
                TextDocumentEdit.create(
                    {
                        uri: convertPathToUri(state.workspace.service.fs, range.fileName),
                        version: null,
                    },
                    [
                        {
                            range: state.convertPositionRange(range),
                            newText: 'import sys',
                        },
                    ]
                ),
            ],
        },
        fileChanged
    );

    assert.strictEqual(fileChanged.size, 1);
    const newSourceFile = state.workspace.service.test_program.getSourceFile(range.fileName);
    state.workspace.service.backgroundAnalysisProgram.analyzeFile(newSourceFile!.getFilePath(), CancellationToken.None);
    assert.strictEqual(newSourceFile?.getFileContent(), 'import sys');
    assert.strictEqual(newSourceFile.getImports().length, 2);

    // Add a new file.
    const addedFilePath = combinePaths(getDirectoryPath(range.fileName), 'test2.py');
    state.workspace.service.backgroundAnalysisProgram.program.setFileOpened(addedFilePath, 0, [{ text: '' }], {
        isTracked: true,
        ipythonMode: IPythonMode.None,
        chainedFilePath: undefined,
        realFilePath: addedFilePath,
    });

    applyWorkspaceEdit(
        state.workspace.service,
        {
            documentChanges: [
                TextDocumentEdit.create(
                    {
                        uri: convertPathToUri(state.workspace.service.fs, addedFilePath),
                        version: null,
                    },
                    [
                        {
                            range: state.convertPositionRange(range),
                            newText: 'import sys',
                        },
                    ]
                ),
            ],
        },
        fileChanged
    );

    let addedSourceFile = state.workspace.service.test_program.getSourceFile(addedFilePath);
    state.workspace.service.backgroundAnalysisProgram.analyzeFile(
        addedSourceFile!.getFilePath(),
        CancellationToken.None
    );
    assert.strictEqual(addedSourceFile?.getFileContent(), 'import sys');
    assert.strictEqual(addedSourceFile.getImports().length, 2);

    const edits = state.workspace.service.leaveEditMode();

    // After leaving edit mode, we should be back to where we were.
    const oldSourceFile = state.workspace.service.test_program.getSourceFile(range.fileName);
    state.workspace.service.backgroundAnalysisProgram.analyzeFile(oldSourceFile!.getFilePath(), CancellationToken.None);
    assert.strictEqual(oldSourceFile?.getFileContent(), '');
    assert.strictEqual(oldSourceFile.getImports().length, 1);
    assert.strictEqual(edits.length, 2);
    assert.deepStrictEqual(edits[0].replacementText, 'import sys');
    addedSourceFile = state.workspace.service.test_program.getSourceFile(addedFilePath);
    assert.strictEqual(addedSourceFile, undefined);
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
    applyWorkspaceEdit(
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
    applyWorkspaceEdit(
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

    applyWorkspaceEdit(
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
    applyWorkspaceEdit(
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

    applyWorkspaceEdit(
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

    const actualEdits = generateWorkspaceEdit(state.workspace.service, cloned, fileChanged);
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
        new TestLanguageService(state.workspace, state.console, state.workspace.service.fs),
        state.workspace,
        { useBackgroundAnalysis: false }
    );
}
