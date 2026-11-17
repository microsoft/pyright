import {
    BrowserMessageReader,
    BrowserMessageWriter,
    createMessageConnection,
    Diagnostic,
    DidChangeTextDocumentNotification,
    DidOpenTextDocumentNotification,
    InitializedNotification,
    InitializeParams,
    InitializeRequest,
    PublishDiagnosticsNotification,
} from 'vscode-languageserver-protocol/browser';

import { createBrowserCancellationStrategy } from '../../../pyright-internal/src/browser/browserConnection';

const editor = document.querySelector<HTMLTextAreaElement>('#source')!;
const diagnostics = document.querySelector<HTMLPreElement>('#diagnostics')!;
const status = document.querySelector<HTMLParagraphElement>('#status')!;
const reset = document.querySelector<HTMLButtonElement>('#restart')!;
const uri = 'file:///main.py';
let version = 1;

function formatDiagnostic(diagnostic: Diagnostic) {
    const { line, character } = diagnostic.range.start;
    return `${line + 1}:${character + 1} ${diagnostic.code ?? ''}: ${diagnostic.message}`;
}

async function start() {
    status.textContent = 'Starting Pyright...';
    editor.disabled = true;
    reset.disabled = true;
    const worker = new Worker(new URL('worker.js', window.location.href));
    const connection = createMessageConnection(
        new BrowserMessageReader(worker),
        new BrowserMessageWriter(worker),
        undefined,
        {
            cancellationStrategy: createBrowserCancellationStrategy('url'),
        }
    );
    let failed = false;
    const fail = (message: string) => {
        if (failed) {
            return;
        }
        failed = true;
        worker.terminate();
        connection.dispose();
        status.textContent = message;
        diagnostics.textContent = 'Analysis unavailable.';
        editor.disabled = true;
        reset.disabled = false;
        reset.onclick = () => {
            version = 1;
            void start();
        };
    };
    const ready = new Promise<void>((resolve, reject) => {
        connection.onNotification('pyright/ready', resolve);
        connection.onNotification('pyright/startupFailed', (params: { message: string }) =>
            reject(new Error(params.message))
        );
        worker.addEventListener('error', (event) => reject(new Error(event.message)), { once: true });
    });
    worker.addEventListener('error', (event) => {
        fail(`Pyright worker failed: ${event.message}`);
    });
    connection.onNotification('pyright/assetLoadFailed', (params: { message: string }) =>
        fail(`Pyright analysis failed: ${params.message}`)
    );
    connection.onNotification(PublishDiagnosticsNotification.type, (params) => {
        if (failed || params.uri !== uri || (params.version !== undefined && params.version !== version)) {
            return;
        }
        diagnostics.textContent = params.diagnostics.map(formatDiagnostic).join('\n\n') || 'No errors.';
        status.textContent = `Checked main.py (version ${version})`;
    });
    connection.onRequest('workspace/configuration', (params: { items: { section?: string }[] }) =>
        params.items.map((item) => (item.section === 'python' ? { analysis: { typeCheckingMode: 'standard' } } : {}))
    );
    connection.listen();
    try {
        await ready;
        const params: InitializeParams = {
            processId: null,
            rootUri: null,
            capabilities: {
                workspace: { configuration: true },
                textDocument: { publishDiagnostics: { versionSupport: true } },
            },
        };
        await connection.sendRequest(InitializeRequest.type, params);
        await connection.sendNotification(InitializedNotification.type, {});
        await connection.sendNotification(DidOpenTextDocumentNotification.type, {
            textDocument: { uri, languageId: 'python', version, text: editor.value },
        });
        editor.disabled = false;
        reset.disabled = false;
        editor.oninput = () => {
            version++;
            status.textContent = `Checking main.py (version ${version})...`;
            void connection.sendNotification(DidChangeTextDocumentNotification.type, {
                textDocument: { uri, version },
                contentChanges: [{ text: editor.value }],
            });
        };
        reset.onclick = () => {
            worker.terminate();
            connection.dispose();
            version = 1;
            void start();
        };
    } catch (error: unknown) {
        fail(`Unable to start Pyright: ${String(error)}`);
    }
}

void start();
