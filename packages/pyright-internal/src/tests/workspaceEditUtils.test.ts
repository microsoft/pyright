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
import { AnalyzerService } from '../analyzer/service';
import { IPythonMode } from '../analyzer/sourceFile';
import { combinePaths, getDirectoryPath } from '../common/pathUtils';
import { Uri } from '../common/uri/uri';
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

    const fileChanged = new Map<string, Uri>();
    applyWorkspaceEditToService(
        cloned,
        {
            changes: {
                [range.fileUri.toString()]: [
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
    assert.strictEqual(cloned.test_program.getSourceFile(range.fileUri)?.getFileContent(), 'Text Changed');
});

test('test edit mode for workspace', async () => {
    const code = `
// @filename: test.py
//// [|/*marker*/|]
            `;

    const state = parseAndGetTestState(code).state;
    const range = state.getRangeByMarkerName('marker')!;
    const addedFileUri = Uri.file(combinePaths(getDirectoryPath(range.fileName), 'test2.py'), state.serviceProvider);
    const edits = state.workspace.service.runEditMode((program) => {
        const fileChanged = new Map<string, Uri>();
        applyWorkspaceEdit(
            program,
            {
                documentChanges: [
                    TextDocumentEdit.create(
                        {
                            uri: range.fileUri.toString(),
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
        const info = program.getSourceFileInfo(range.fileUri)!;

        program.analyzeFile(info.uri, CancellationToken.None);
        assert.strictEqual(info.contents, 'import sys');
        assert.strictEqual(info.imports.length, 3);

        // Add a new file.
        program.setFileOpened(addedFileUri, 0, '', {
            isTracked: true,
            ipythonMode: IPythonMode.None,
            chainedFileUri: undefined,
        });

        applyWorkspaceEdit(
            program,
            {
                documentChanges: [
                    TextDocumentEdit.create(
                        {
                            uri: addedFileUri.toString(),
                            version: null,
                        },
                        [
                            {
                                range: {
                                    start: { line: 0, character: 0 },
                                    end: { line: 0, character: 0 },
                                },
                                newText: 'import sys',
                            },
                        ]
                    ),
                ],
            },
            fileChanged
        );

        applyWorkspaceEdit(
            program,
            {
                documentChanges: [
                    TextDocumentEdit.create(
                        {
                            uri: addedFileUri.toString(),
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

        const addedInfo = program.getSourceFileInfo(addedFileUri)!;
        program.analyzeFile(addedInfo.uri, CancellationToken.None);

        assert.strictEqual(addedInfo.contents, 'import os');
        assert.strictEqual(addedInfo.imports.length, 3);
    }, CancellationToken.None);

    // After leaving edit mode, we should be back to where we were.
    const oldSourceFile = state.workspace.service.test_program.getSourceFile(range.fileUri);
    state.workspace.service.backgroundAnalysisProgram.analyzeFile(oldSourceFile!.getUri(), CancellationToken.None);

    assert.strictEqual(oldSourceFile?.getFileContent(), '');
    assert.strictEqual(oldSourceFile.getImports().length, 2);
    assert.strictEqual(edits.length, 2);

    assert.deepStrictEqual(edits[0].replacementText, 'import sys');
    assert.deepStrictEqual(edits[1].replacementText, 'import os');

    const addedSourceFile = state.workspace.service.test_program.getSourceFile(addedFileUri);

    // The added file should not be there.
    assert.ok(!addedSourceFile);
});

test('test applyWorkspaceEdits documentChanges', async () => {
    const code = `
// @filename: test.py
//// [|/*marker*/|]
        `;

    const state = parseAndGetTestState(code).state;
    const cloned = await getClonedService(state);
    const range = state.getRangeByMarkerName('marker')!;

    const fileChanged = new Map<string, Uri>();
    applyWorkspaceEditToService(
        cloned,
        {
            documentChanges: [
                TextDocumentEdit.create(
                    {
                        uri: range.fileUri.toString(),
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
    assert.strictEqual(cloned.test_program.getSourceFile(range.fileUri)?.getFileContent(), 'Text Changed');
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

    const fileChanged = new Map<string, Uri>();
    applyWorkspaceEditToService(
        cloned,
        {
            changes: {
                [range1.fileUri.toString()]: [
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
                        uri: range1.fileUri.toString(),
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
                        uri: range2.fileUri.toString(),
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
                [range2.fileUri.toString()]: [
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

    const actualEdits = generateWorkspaceEdit(state.workspace.service.fs, state.workspace.service, cloned, fileChanged);
    verifyWorkspaceEdit(
        {
            changes: {
                [range1.fileUri.toString()]: [
                    {
                        range: state.convertPositionRange(range1),
                        newText: 'NewTest1 Changed',
                    },
                ],
                [range2.fileUri.toString()]: [
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

function applyWorkspaceEditToService(service: AnalyzerService, edits: WorkspaceEdit, filesChanged: Map<string, Uri>) {
    const program = service.backgroundAnalysisProgram.program;
    applyWorkspaceEdit(program, edits, filesChanged);
}

async function getClonedService(state: TestState) {
    return await AnalyzerServiceExecutor.cloneService(
        new TestLanguageService(state.workspace, state.console, state.workspace.service.fs),
        state.workspace,
        { useBackgroundAnalysis: false }
    );
}
