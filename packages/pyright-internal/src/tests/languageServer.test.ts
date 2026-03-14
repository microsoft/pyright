/*
 * languageServer.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Tests to verify Pyright works as the backend for a language server.
 */

import assert from 'assert';
import {
    CancellationToken,
    CompletionRequest,
    ConfigurationItem,
    DidChangeTextDocumentNotification,
    DidChangeWorkspaceFoldersNotification,
    InitializedNotification,
    InitializeRequest,
    MarkupContent,
} from 'vscode-languageserver';

import { convertOffsetToPosition } from '../common/positionUtils';
import { PythonVersion, pythonVersion3_10 } from '../common/pythonVersion';

import { isArray } from '../common/core';
import { normalizeSlashes } from '../common/pathUtils';
import {
    cleanupAfterAll,
    DEFAULT_WORKSPACE_ROOT,
    getParseResults,
    hover,
    openFile,
    PyrightServerInfo,
    runPyrightServer,
    waitForDiagnostics,
    waitForEvent,
} from './lsp/languageServerTestUtils';

describe(`Basic language server tests`, () => {
    let serverInfo: PyrightServerInfo | undefined;
    async function runLanguageServer(
        projectRoots: string[] | string,
        code: string,
        callInitialize = true,
        extraSettings?: { item: ConfigurationItem; value: any }[],
        pythonVersion: PythonVersion = pythonVersion3_10,
        supportsBackgroundThread?: boolean,
        supportsPullDiagnostics?: boolean
    ) {
        const result = await runPyrightServer(
            projectRoots,
            code,
            callInitialize,
            extraSettings,
            pythonVersion,
            supportsBackgroundThread,
            supportsPullDiagnostics
        );
        serverInfo = result;
        return result;
    }

    afterEach(async () => {
        if (serverInfo) {
            await serverInfo.dispose();
            serverInfo = undefined;
        }
    });

    afterAll(async () => {
        await cleanupAfterAll();
    });

    test.each([
        { name: 'capability disabled', capability: false, initFolders: 1, firstNotify: null, secondNotify: null },
        { name: '1 init, no notifications', capability: true, initFolders: 1, firstNotify: null, secondNotify: null },
        { name: '1 init, notify with 0', capability: true, initFolders: 1, firstNotify: 0, secondNotify: null },
        { name: '1 init, notify with 1', capability: true, initFolders: 1, firstNotify: 1, secondNotify: null },
        { name: '1 init, notify with 2', capability: true, initFolders: 1, firstNotify: 2, secondNotify: null },
        { name: '1 init, notify with 0 then 0', capability: true, initFolders: 1, firstNotify: 0, secondNotify: 0 },
        { name: '1 init, notify with 0 then 1', capability: true, initFolders: 1, firstNotify: 0, secondNotify: 1 },
        { name: '1 init, notify with 0 then 2', capability: true, initFolders: 1, firstNotify: 0, secondNotify: 2 },
        { name: '1 init, notify with 1 then 0', capability: true, initFolders: 1, firstNotify: 1, secondNotify: 0 },
        { name: '1 init, notify with 1 then 1', capability: true, initFolders: 1, firstNotify: 1, secondNotify: 1 },
        { name: '1 init, notify with 1 then 2', capability: true, initFolders: 1, firstNotify: 1, secondNotify: 2 },
        { name: '1 init, notify with 2 then 0', capability: true, initFolders: 1, firstNotify: 2, secondNotify: 0 },
        { name: '1 init, notify with 2 then 1', capability: true, initFolders: 1, firstNotify: 2, secondNotify: 1 },
        { name: '1 init, notify with 2 then 2', capability: true, initFolders: 1, firstNotify: 2, secondNotify: 2 },
        { name: '2 init, no notifications', capability: true, initFolders: 2, firstNotify: null, secondNotify: null },
        { name: '2 init, notify with 2', capability: true, initFolders: 2, firstNotify: 2, secondNotify: null },
        { name: '0 init, notify with 1', capability: true, initFolders: 0, firstNotify: 1, secondNotify: null },
        { name: '0 init, notify with 2', capability: true, initFolders: 0, firstNotify: 2, secondNotify: null },
    ])('workspace initialization: $name', async ({ capability, initFolders, firstNotify, secondNotify }) => {
        const code = `
// @filename: test.py
//// import [|/*marker*/os|]
        `;
        const info = await runLanguageServer(DEFAULT_WORKSPACE_ROOT, code, false);
        const params = info.getInitializeParams();
        const folders = params.workspaceFolders!;
        const folder2 = { name: 'workspace2', uri: 'file:///workspace2' };

        params.capabilities.workspace!.workspaceFolders = capability;
        if (initFolders === 0) {
            params.workspaceFolders = [];
        } else if (initFolders === 2) {
            params.workspaceFolders = [...folders, folder2];
        }

        await info.connection.sendRequest(InitializeRequest.type, params, CancellationToken.None);
        await info.connection.sendNotification(InitializedNotification.type, {});

        const getFoldersForNotify = (count: number) => {
            if (count === 0) return [];
            if (count === 1) return folders;
            return [...folders, folder2];
        };

        if (firstNotify !== null) {
            await info.connection.sendNotification(DidChangeWorkspaceFoldersNotification.type, {
                event: { added: getFoldersForNotify(firstNotify), removed: [] },
            });
        }
        if (secondNotify !== null) {
            await info.connection.sendNotification(DidChangeWorkspaceFoldersNotification.type, {
                event: { added: getFoldersForNotify(secondNotify), removed: [] },
            });
        }

        openFile(info, 'marker');
        const result = await hover(info, 'marker');
        assert(result && MarkupContent.is(result.contents));
        assert.strictEqual(result.contents.value, '```python\n(module) os\n```');
    });

    test('Hover', async () => {
        const code = `
// @filename: test.py
//// import [|/*marker*/os|]
        `;
        const info = await runLanguageServer(DEFAULT_WORKSPACE_ROOT, code, /* callInitialize */ true);

        // Do simple hover request
        openFile(info, 'marker');
        const hoverResult = await hover(info, 'marker');
        assert(hoverResult);
        assert(MarkupContent.is(hoverResult.contents));
        assert.strictEqual(hoverResult.contents.value, '```python\n(module) os\n```');
    });
    test('Completions', async () => {
        const code = `
// @filename: test.py
//// import os
//// os.[|/*marker*/|]
        `;
        const info = await runLanguageServer(DEFAULT_WORKSPACE_ROOT, code, /* callInitialize */ true);

        // Do simple completion request
        openFile(info, 'marker');
        const marker = info.testData.markerPositions.get('marker')!;
        const fileUri = marker.fileUri;
        const text = info.testData.files.find((d) => d.fileName === marker.fileName)!.content;
        const parseResult = getParseResults(text);
        const completionResult = await info.connection.sendRequest(
            CompletionRequest.type,
            {
                textDocument: { uri: fileUri.toString() },
                position: convertOffsetToPosition(marker.position, parseResult.tokenizerOutput.lines),
            },
            CancellationToken.None
        );

        assert(completionResult);
        assert(!isArray(completionResult));

        const completionItem = completionResult.items.find((i) => i.label === 'path')!;
        assert(completionItem);
    });

    [false, true].forEach((supportsPullDiagnostics) => {
        describe(`Diagnostics ${supportsPullDiagnostics ? 'pull' : 'push'}`, () => {
            // Background analysis takes longer than 5 seconds sometimes, so we need to
            // increase the timeout.
            jest.setTimeout(200000);
            test('background thread diagnostics', async () => {
                const code = `
// @filename: root/test.py
//// from math import cos, sin
//// import sys
//// [|/*marker*/|]
        `;
                const settings = [
                    {
                        item: {
                            scopeUri: `file://${normalizeSlashes(DEFAULT_WORKSPACE_ROOT, '/')}`,
                            section: 'python.analysis',
                        },
                        value: {
                            typeCheckingMode: 'strict',
                            diagnosticMode: 'workspace',
                        },
                    },
                ];

                const info = await runLanguageServer(
                    DEFAULT_WORKSPACE_ROOT,
                    code,
                    /* callInitialize */ true,
                    settings,
                    undefined,
                    /* supportsBackgroundThread */ true,
                    supportsPullDiagnostics
                );

                // get the file containing the marker that also contains our task list comments
                await openFile(info, 'marker');

                // Wait for the diagnostics to publish
                const diagnostics = await waitForDiagnostics(info);
                const diagnostic = diagnostics.find((d) => d.uri.includes('root/test.py'));
                assert(diagnostic);
                assert.equal(diagnostic.diagnostics.length, 6);

                // Make sure the error has a special rule
                assert.equal(diagnostic.diagnostics[1].code, 'reportUnusedImport');
                assert.equal(diagnostic.diagnostics[3].code, 'reportUnusedImport');
                assert.equal(diagnostic.diagnostics[4].code, 'reportUnusedImport');
            });

            test('background thread diagnostics open mode', async () => {
                const code = `
// @filename: root/test.py
//// from math import cos, sin
//// import sys
//// [|/*marker*/|]
        `;
                const settings = [
                    {
                        item: {
                            scopeUri: `file://${normalizeSlashes(DEFAULT_WORKSPACE_ROOT, '/')}`,
                            section: 'python.analysis',
                        },
                        value: {
                            typeCheckingMode: 'strict',
                        },
                    },
                ];

                const info = await runLanguageServer(
                    DEFAULT_WORKSPACE_ROOT,
                    code,
                    /* callInitialize */ true,
                    settings,
                    undefined,
                    /* supportsBackgroundThread */ true,
                    supportsPullDiagnostics
                );

                // get the file containing the marker that also contains our task list comments
                await openFile(info, 'marker');

                // Wait for the diagnostics to publish
                const diagnostics = await waitForDiagnostics(info);
                const diagnostic = diagnostics.find((d) => d.uri.includes('root/test.py'));
                assert(diagnostic);
                const unusedImports = diagnostic.diagnostics.filter((d) => d.code === 'reportUnusedImport');
                assert.equal(unusedImports.length, 3);
            });

            test('Diagnostic severity overrides test', async () => {
                const code = `
// @filename: test.py
//// def test([|/*marker*/x|]): ...
//// 
// @filename: pyproject.toml
//// 
    `;
                const settings = [
                    {
                        item: {
                            scopeUri: `file://${normalizeSlashes(DEFAULT_WORKSPACE_ROOT, '/')}`,
                            section: 'python.analysis',
                        },
                        value: {
                            diagnosticSeverityOverrides: {
                                reportUnknownParameterType: 'warning',
                            },
                        },
                    },
                ];

                const info = await runLanguageServer(
                    DEFAULT_WORKSPACE_ROOT,
                    code,
                    /* callInitialize */ true,
                    settings,
                    undefined,
                    /* supportsBackgroundThread */ true,
                    supportsPullDiagnostics
                );

                // get the file containing the marker that also contains our task list comments
                await openFile(info, 'marker');

                // Wait for the diagnostics to publish
                const diagnostics = await waitForDiagnostics(info);
                const diagnostic = diagnostics.find((d) => d.uri.includes('test.py'));
                assert(diagnostic);

                // Make sure the error has a special rule
                assert.ok(
                    diagnostic.diagnostics.some((d) => d.code === 'reportUnknownParameterType'),
                    `Expected diagnostic not found. Got ${JSON.stringify(diagnostic.diagnostics)}`
                );
            });
        });
    });

    describe('clearDiagnosticsOnChange', () => {
        jest.setTimeout(200000);

        test('clears diagnostics immediately on didChange when enabled', async () => {
            const code = `
// @filename: root/test.py
//// from math import cos, sin
//// [|/*marker*/|]
            `;
            const settings = [
                {
                    item: {
                        scopeUri: `file://${normalizeSlashes(DEFAULT_WORKSPACE_ROOT, '/')}`,
                        section: 'python.analysis',
                    },
                    value: {
                        typeCheckingMode: 'strict',
                        diagnosticMode: 'workspace',
                    },
                },
                {
                    item: {
                        scopeUri: `file://${normalizeSlashes(DEFAULT_WORKSPACE_ROOT, '/')}`,
                        section: 'pyright',
                    },
                    value: {
                        clearDiagnosticsOnChange: true,
                    },
                },
            ];

            const info = await runLanguageServer(
                DEFAULT_WORKSPACE_ROOT,
                code,
                /* callInitialize */ true,
                settings,
                undefined,
                /* supportsBackgroundThread */ false
            );

            await openFile(info, 'marker');

            // Wait for initial diagnostics to appear (unused imports).
            const initialDiagnostics = await waitForDiagnostics(info);
            const fileDiagnostics = initialDiagnostics.find((d) => d.uri.includes('root/test.py'));
            assert(fileDiagnostics, 'Expected diagnostics for test.py');
            assert.ok(
                fileDiagnostics.diagnostics.length > 0,
                `Expected non-empty diagnostics but got: ${JSON.stringify(fileDiagnostics.diagnostics)}`
            );

            const marker = info.testData.markerPositions.get('marker')!;
            const fileUri = marker.fileUri.toString();

            // Send a textDocument/didChange notification for the file.
            // With clearDiagnosticsOnChange enabled, diagnostics should be cleared immediately.
            info.connection.sendNotification(DidChangeTextDocumentNotification.type, {
                textDocument: { uri: fileUri, version: 2 },
                contentChanges: [{ text: 'from math import cos, sin\n' }],
            });

            // Wait for an empty diagnostics notification for this file.
            await waitForEvent(
                info.diagnosticsEvent,
                'empty diagnostics on change',
                (p) => p.uri === fileUri && p.diagnostics.length === 0
            );
        });

        test('does not clear diagnostics on didChange when disabled', async () => {
            const code = `
// @filename: root/test.py
//// from math import cos, sin
//// [|/*marker*/|]
            `;
            const settings = [
                {
                    item: {
                        scopeUri: `file://${normalizeSlashes(DEFAULT_WORKSPACE_ROOT, '/')}`,
                        section: 'python.analysis',
                    },
                    value: {
                        typeCheckingMode: 'strict',
                        diagnosticMode: 'workspace',
                    },
                },
            ];

            const info = await runLanguageServer(
                DEFAULT_WORKSPACE_ROOT,
                code,
                /* callInitialize */ true,
                settings,
                undefined,
                /* supportsBackgroundThread */ false
            );

            await openFile(info, 'marker');

            // Wait for initial diagnostics to appear.
            const initialDiagnostics = await waitForDiagnostics(info);
            const fileDiagnostics = initialDiagnostics.find((d) => d.uri.includes('root/test.py'));
            assert(fileDiagnostics, 'Expected diagnostics for test.py');
            assert.ok(
                fileDiagnostics.diagnostics.length > 0,
                `Expected non-empty diagnostics but got: ${JSON.stringify(fileDiagnostics.diagnostics)}`
            );

            const marker = info.testData.markerPositions.get('marker')!;
            const fileUri = marker.fileUri.toString();

            // Register a listener BEFORE sending didChange to track any empty-diagnostics events.
            let sawEmptyDiagnosticsForFile = false;
            const disposable = info.diagnosticsEvent((p) => {
                if (p.uri === fileUri && p.diagnostics.length === 0) {
                    sawEmptyDiagnosticsForFile = true;
                }
            });

            try {
                // Send a textDocument/didChange notification for the file.
                info.connection.sendNotification(DidChangeTextDocumentNotification.type, {
                    textDocument: { uri: fileUri, version: 2 },
                    contentChanges: [{ text: 'from math import cos, sin\n' }],
                });

                // Wait for the full reanalysis cycle to complete by waiting for the next
                // non-empty diagnostics event for this file. This is deterministic: once the
                // analysis-cycle diagnostics arrive, all synchronous events (including any
                // spurious empty-diagnostics publish) will have already fired.
                await waitForEvent(
                    info.diagnosticsEvent,
                    'reanalysis diagnostics',
                    (p) => p.uri === fileUri && p.diagnostics.length > 0
                );
            } finally {
                disposable.dispose();
            }

            // After the full cycle, verify that no empty-diagnostics notification was published.
            assert.strictEqual(
                sawEmptyDiagnosticsForFile,
                false,
                `Expected no empty diagnostics when clearDiagnosticsOnChange is disabled`
            );
        });
    });
});
