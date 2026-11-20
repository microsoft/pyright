import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { PassThrough } from 'stream';
import { StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node';
import {
    createProtocolConnection,
    DidChangeTextDocumentNotification,
    DidOpenTextDocumentNotification,
    InitializedNotification,
    InitializeRequest,
    PublishDiagnosticsNotification,
    PublishDiagnosticsParams,
    ShutdownRequest,
} from 'vscode-languageserver-protocol';
import { createConnection } from 'vscode-languageserver/node';

import { BrowserFileSystem } from '../browser/browserFileSystem';
import { BrowserPyrightServer } from '../browser/browserServer';
import { UriEx } from '../common/uri/uriUtils';

test('strict static asset reads fail rather than silently weakening type information', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'XMLHttpRequest');
    Object.defineProperty(globalThis, 'XMLHttpRequest', {
        configurable: true,
        value: class {
            status = 200;
            responseType = '';
            responseText = '';
            open(_method: string, url: string) {
                this.status = url.endsWith('folderIndex.json') ? 200 : 404;
            }
            send() {
                this.responseText =
                    this.status === 200 ? JSON.stringify({ files: ['builtins.pyi', 'src/helper.pyi'] }) : '';
            }
        },
    });
    try {
        const fileSystem = new BrowserFileSystem('/', ['https://browser.invalid/'], [], { throwOnReadError: true });
        assert.strictEqual(fileSystem.existsSync(UriEx.file('/src/helper.pyi')), true);
        assert.throws(() => fileSystem.readFileSync(UriEx.file('/builtins.pyi'), 'utf8'), /HTTP 404/);
    } finally {
        if (descriptor) {
            Object.defineProperty(globalThis, 'XMLHttpRequest', descriptor);
        } else {
            Reflect.deleteProperty(globalThis, 'XMLHttpRequest');
        }
    }
});

test('browser server checks stdlib types and updates diagnostics after edits without Node host services', async () => {
    const typeshed = path.resolve(__dirname, '../../typeshed-fallback');
    const files = fs
        .readdirSync(path.join(typeshed, 'stdlib'), { recursive: true })
        .filter((entry): entry is string => typeof entry === 'string')
        .filter((entry) => fs.statSync(path.join(typeshed, 'stdlib', entry)).isFile())
        .map((entry) => `typeshed-fallback/stdlib/${entry.replace(/\\/g, '/')}`);
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'XMLHttpRequest');
    const rootDescriptor = Object.getOwnPropertyDescriptor(globalThis, '__rootDirectory');
    Object.defineProperty(globalThis, 'XMLHttpRequest', {
        configurable: true,
        value: class {
            status = 200;
            responseType = '';
            responseText = '';
            private _url = '';

            open(_method: string, url: string) {
                this._url = url;
            }
            send() {
                const relative = new URL(this._url).pathname.replace('/pyright/playground/', '');
                this.responseText =
                    relative === 'folderIndex.json'
                        ? JSON.stringify({ files })
                        : fs.readFileSync(path.join(typeshed, relative.replace('typeshed-fallback/', '')), 'utf8');
            }
        },
    });
    Object.defineProperty(globalThis, '__rootDirectory', { configurable: true, writable: true, value: '/' });

    const input = new PassThrough();
    const output = new PassThrough();
    const connection = createConnection(new StreamMessageReader(input), new StreamMessageWriter(output));
    const server = new BrowserPyrightServer(
        connection,
        new BrowserFileSystem('/', ['https://browser.invalid/pyright/playground/'], [])
    );
    const client = createProtocolConnection(new StreamMessageReader(output), new StreamMessageWriter(input));
    const uri = 'file:///main.py';
    function nextDiagnostics(version: number) {
        return new Promise<PublishDiagnosticsParams>((resolve) => {
            const subscription = client.onNotification(PublishDiagnosticsNotification.type, (params) => {
                if (params.uri === uri && params.version === version) {
                    subscription.dispose();
                    resolve(params);
                }
            });
        });
    }

    client.listen();
    try {
        await client.sendRequest(InitializeRequest.type, {
            processId: null,
            rootUri: null,
            capabilities: { textDocument: { publishDiagnostics: { versionSupport: true } } },
        });
        await client.sendNotification(InitializedNotification.type, {});
        const source = "from pathlib import Path\nname: str = Path('example.py').name\nanswer: int = 'wrong'\n";
        const initial = nextDiagnostics(1);
        await client.sendNotification(DidOpenTextDocumentNotification.type, {
            textDocument: { uri, languageId: 'python', version: 1, text: source },
        });
        assert.deepStrictEqual(
            (await initial).diagnostics.map((item) => item.code),
            ['reportAssignmentType']
        );

        const edited = nextDiagnostics(2);
        await client.sendNotification(DidChangeTextDocumentNotification.type, {
            textDocument: { uri, version: 2 },
            contentChanges: [{ text: source.replace("'wrong'", '42') }],
        });
        assert.deepStrictEqual((await edited).diagnostics, []);

        const missingImport = nextDiagnostics(3);
        await client.sendNotification(DidChangeTextDocumentNotification.type, {
            textDocument: { uri, version: 3 },
            contentChanges: [{ text: 'import definitely_missing_playground_package\n' }],
        });
        assert.deepStrictEqual(
            (await missingImport).diagnostics.map((item) => item.code),
            ['reportMissingImports']
        );
        await client.sendRequest(ShutdownRequest.type);
    } finally {
        server.dispose();
        client.dispose();
        connection.dispose();
        input.destroy();
        output.destroy();
        if (descriptor) {
            Object.defineProperty(globalThis, 'XMLHttpRequest', descriptor);
        } else {
            Reflect.deleteProperty(globalThis, 'XMLHttpRequest');
        }
        if (rootDescriptor) {
            Object.defineProperty(globalThis, '__rootDirectory', rootDescriptor);
        } else {
            Reflect.deleteProperty(globalThis, '__rootDirectory');
        }
    }
}, 30_000);
