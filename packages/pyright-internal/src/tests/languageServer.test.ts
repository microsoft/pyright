import assert from 'assert';
import {
    CancellationToken,
    ConfigurationItem,
    DidOpenTextDocumentNotification,
    HoverRequest,
    InitializedNotification,
    InitializeRequest,
    MarkupContent,
} from 'vscode-languageserver';

import { convertOffsetToPosition } from '../common/positionUtils';
import { PythonVersion } from '../common/pythonVersion';

import {
    cleanupAfterAll,
    DEFAULT_WORKSPACE_ROOT,
    getParseResults,
    initializeLanguageServer,
    PyrightServerInfo,
    runPyrightServer,
} from './lsp/languageServerTestUtils';

describe(`Basic language server tests`, () => {
    let serverInfo: PyrightServerInfo | undefined;
    async function runLanguageServer(
        projectRoots: string[] | string,
        code: string,
        callInitialize = true,
        extraSettings?: { item: ConfigurationItem; value: any }[],
        pythonVersion: PythonVersion = PythonVersion.V3_10,
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
        assert(initializeResult.capabilities.inlayHintProvider);
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
        const marker = info.testData.markerPositions.get('marker')!;
        const fileUri = info.convertPathToUri(marker.fileName);
        const text = info.testData.files.find((d) => d.fileName === marker.fileName)!.content;

        await info.connection.sendNotification(DidOpenTextDocumentNotification.type, {
            textDocument: {
                uri: fileUri.toString(),
                languageId: 'python',
                version: 1,
                text,
            },
        });

        const parseResult = getParseResults(text);
        const hoverResult = await info.connection.sendRequest(
            HoverRequest.type,
            {
                textDocument: { uri: fileUri.toString() },
                position: convertOffsetToPosition(marker.position, parseResult.tokenizerOutput.lines),
            },
            CancellationToken.None
        );

        assert(hoverResult);
        assert(MarkupContent.is(hoverResult.contents));
        assert.strictEqual(hoverResult.contents.value, '```python\n(module) os\n```');
    });
});

// Probably only want these tests
// Initialization
// Completions
// Hover
// Background thread works (diagnostics)
