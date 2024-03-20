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
    initializeLanguageServer,
    openFile,
    PyrightServerInfo,
    runPyrightServer,
    waitForDiagnostics,
} from './lsp/languageServerTestUtils';

describe(`Basic language server tests`, () => {
    let serverInfo: PyrightServerInfo | undefined;
    async function runLanguageServer(
        projectRoots: string[] | string,
        code: string,
        callInitialize = true,
        extraSettings?: { item: ConfigurationItem; value: any }[],
        pythonVersion: PythonVersion = pythonVersion3_10,
        supportsBackgroundThread?: boolean
    ) {
        const result = await runPyrightServer(
            projectRoots,
            code,
            callInitialize,
            extraSettings,
            pythonVersion,
            supportsBackgroundThread
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

    test('Basic Initialize', async () => {
        const code = `
// @filename: test.py
//// # empty file
        `;
        const serverInfo = await runLanguageServer(DEFAULT_WORKSPACE_ROOT, code, /* callInitialize */ false);

        const initializeResult = await initializeLanguageServer(serverInfo);

        assert(initializeResult);
        assert(initializeResult.capabilities.completionProvider?.resolveProvider);
    });

    test('Initialize without workspace folder support', async () => {
        const code = `
// @filename: test.py
//// import [|/*marker*/os|]
        `;
        const info = await runLanguageServer(DEFAULT_WORKSPACE_ROOT, code, /* callInitialize */ false);

        // This will test clients with no folder and configuration support.
        const params = info.getInitializeParams();
        params.capabilities.workspace!.workspaceFolders = false;
        params.capabilities.workspace!.configuration = false;

        // Perform LSP Initialize/Initialized handshake.
        const result = await info.connection.sendRequest(InitializeRequest.type, params, CancellationToken.None);
        assert(result);

        await info.connection.sendNotification(InitializedNotification.type, {});

        // Do simple hover request to verify our server works with a client that doesn't support
        // workspace folder/configuration capabilities.
        openFile(info, 'marker');
        const hoverResult = await hover(info, 'marker');
        assert(hoverResult);
        assert(MarkupContent.is(hoverResult.contents));
        assert.strictEqual(hoverResult.contents.value, '```python\n(module) os\n```');
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
                    section: 'basedpyright.analysis',
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
            /* supportsBackgroundThread */ true
        );

        // get the file containing the marker that also contains our task list comments
        await openFile(info, 'marker');

        // Wait for the diagnostics to publish
        const diagnostics = await waitForDiagnostics(info);
        assert.equal(diagnostics[0]!.diagnostics.length, 6);

        // Make sure the error has a special rule
        assert.equal(diagnostics[0].diagnostics[1].code, 'reportUnusedImport');
        assert.equal(diagnostics[0].diagnostics[3].code, 'reportUnusedImport');
        assert.equal(diagnostics[0].diagnostics[5].code, 'reportUnusedImport');
    });
});
