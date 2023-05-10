/*
 * workspaceEditUtils.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * test workspaceEditUtils
 */

import * as assert from 'assert';
import { TextDocumentEdit, WorkspaceEdit } from 'vscode-languageserver-types';

import { CancellationToken } from 'vscode-languageserver';
import { IPythonMode } from '../analyzer/sourceFile';
import { combinePaths, convertPathToUri, getDirectoryPath } from '../common/pathUtils';
import { applyWorkspaceEdit, generateWorkspaceEdit } from '../common/workspaceEditUtils';
import { AnalyzerServiceExecutor } from '../languageService/analyzerServiceExecutor';
import { TestLanguageService } from './harness/fourslash/testLanguageService';
import { TestState, parseAndGetTestState } from './harness/fourslash/testState';
import { verifyWorkspaceEdit } from './harness/fourslash/workspaceEditTestUtils';
import { AnalyzerService } from '../analyzer/service';

test('test applyWorkspaceEdits changes', async () => {
    const code = `
// @filename: test.py
//// [|/*marker*/|]
        `;

    const state = parseAndGetTestState(code).state;
    const cloned = await getClonedService(state);
    const range = state.getRangeByMarkerName('marker')!;

    const fileChanged = new Set<string>();
    applyWorkspaceEditToService(
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
    const range = state.getRangeByMarkerName('marker')!;
    const addedFilePath = combinePaths(getDirectoryPath(range.fileName), 'test2.py');
    const edits = await state.workspace.service.runEditMode(async () => {
        const fileChanged = new Set<string>();
        applyWorkspaceEditToService(
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
        state.workspace.service.backgroundAnalysisProgram.analyzeFile(
            newSourceFile!.getFilePath(),
            CancellationToken.None
        );
        assert.strictEqual(newSourceFile?.getFileContent(), 'import sys');
        assert.strictEqual(newSourceFile.getImports().length, 2);

        // Add a new file.
        state.workspace.service.backgroundAnalysisProgram.program.setFileOpened(addedFilePath, 0, '', {
            isTracked: true,
            ipythonMode: IPythonMode.None,
            chainedFilePath: undefined,
            realFilePath: addedFilePath,
        });

        applyWorkspaceEditToService(
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

        applyWorkspaceEditToService(
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
                                range: {
                                    start: { line: 0, character: 7 },
                                    end: { line: 0, character: 10 },
                                },
                                newText: 'os',
                            },
                        ]
                    ),
                ],
            },
            fileChanged
        );

        const addedSourceFile = state.workspace.service.test_program.getSourceFile(addedFilePath);
        state.workspace.service.backgroundAnalysisProgram.analyzeFile(
            addedSourceFile!.getFilePath(),
            CancellationToken.None
        );
        assert.strictEqual(addedSourceFile?.getFileContent(), 'import os');
        assert.strictEqual(addedSourceFile.getImports().length, 2);
    }, CancellationToken.None);

    // After leaving edit mode, we should be back to where we were.
    const oldSourceFile = state.workspace.service.test_program.getSourceFile(range.fileName);
    state.workspace.service.backgroundAnalysisProgram.analyzeFile(oldSourceFile!.getFilePath(), CancellationToken.None);
    assert.strictEqual(oldSourceFile?.getFileContent(), '');
    assert.strictEqual(oldSourceFile.getImports().length, 1);
    assert.strictEqual(edits.length, 2);
    assert.deepStrictEqual(edits[0].replacementText, 'import sys');
    assert.deepStrictEqual(edits[1].replacementText, 'import os');
    const addedSourceFile = state.workspace.service.test_program.getSourceFile(addedFilePath);

    // The added file should be there, but be empty.
    assert.ok(addedSourceFile);
    assert.strictEqual(addedSourceFile?.getFileContent(), '');
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
    applyWorkspaceEditToService(
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
    applyWorkspaceEditToService(
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

    applyWorkspaceEditToService(
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
    applyWorkspaceEditToService(
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

    applyWorkspaceEditToService(
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

function applyWorkspaceEditToService(service: AnalyzerService, edits: WorkspaceEdit, filesChanged: Set<string>) {
    const view = service.backgroundAnalysisProgram.program;
    const mutator = service;
    applyWorkspaceEdit(view, mutator, edits, filesChanged);
}

async function getClonedService(state: TestState) {
    return await AnalyzerServiceExecutor.cloneService(
        new TestLanguageService(state.workspace, state.console, state.workspace.service.fs),
        state.workspace,
        { useBackgroundAnalysis: false }
    );
}
