/*
 * inProcTypeServerTestUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * In-process test harness for the Pyright type server (TSP).
 *
 * Boots a `TypeServer` over a pair of in-memory duplex streams so tests can drive the
 * protocol requests directly (initialize, open documents, query types). This exercises the
 * full server-side conversion path (fromProtocolNode -> evaluate -> ProtocolTypeFactory)
 * without needing any client-side consumer stack.
 *
 * This is a Pyright-native adaptation of Pylance's `inProcTypeServerTestUtils`. It omits the
 * client-side `ExternalProgram`/`snapshotSync` machinery (which stays in Pylance) and asserts
 * on the protocol-level responses instead.
 */

import { Duplex } from 'stream';

import { StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node';
import { ProtocolRequestType } from 'vscode-languageserver-protocol';
import {
    CancellationToken,
    ConfigurationRequest,
    Connection,
    createConnection,
    DiagnosticRefreshRequest,
    DidOpenTextDocumentNotification,
    InitializedNotification,
    InitializeRequest,
    LSPErrorCodes,
    RegistrationRequest,
    ShutdownRequest,
    UnregistrationRequest,
} from 'vscode-languageserver/node';

import { initializeDependencies } from '../../common/asyncInitialization';
import { ConsoleWithLogLevel, NullConsole } from '../../common/console';
import { convertOffsetsToRange } from '../../common/positionUtils';
import { WorkspaceFileWatcherProvider } from '../../common/realFileSystem';
import { ServiceProvider } from '../../common/serviceProvider';
import { createServiceProvider } from '../../common/serviceProviderExtensions';
import { Duration } from '../../common/timing';
import { Uri } from '../../common/uri/uri';
import { UriEx } from '../../common/uri/uriUtils';
import { Tokenizer, TokenizerOutput } from '../../parser/tokenizer';
import { PartialStubService } from '../../partialStubService';
import { NotebookUriMapper } from '../../typeServer/notebookUriMapper';
import { TypeServerFileSystem } from '../../typeServer/typeServerFileSystem';
import { TypeServerProtocol } from '../../typeServer/protocol/typeServerProtocol';
import { TypeServer } from '../../typeServer/server';
import { TypeServerServiceKeys } from '../../typeServer/typeServerServiceKeys';
import { parseTestData } from '../harness/fourslash/fourSlashParser';
import {
    FourSlashData,
    FourSlashFile,
    Marker as FourSlashMarker,
    Range as FourSlashRange,
} from '../harness/fourslash/fourSlashTypes';
import { createFileSystem, DEFAULT_WORKSPACE_ROOT } from '../lsp/languageServerTestUtils';

export async function initializeDependenciesForInProcTests() {
    await initializeDependencies();
}

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function _isConnectionDisposedError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
        return false;
    }

    const maybeError = error as { code?: unknown; message?: unknown };
    return (
        maybeError.code === 2 &&
        typeof maybeError.message === 'string' &&
        maybeError.message.includes('Connection is disposed')
    );
}

function _isPendingResponseRejectedError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
        return false;
    }

    const maybeError = error as { code?: unknown; message?: unknown };
    // PendingResponseRejected has code -32097.
    return (
        maybeError.code === -32097 &&
        typeof maybeError.message === 'string' &&
        maybeError.message.includes('Pending response rejected')
    );
}

function _makeRemoteConsoleSafeDuringDispose(connection: Connection) {
    // Some background work (e.g. analysis timers) can outlive the test and attempt to log
    // via `connection.console.*` after we tear down the in-proc jsonrpc connection.
    // vscode-jsonrpc throws synchronously in this case; swallow the specific disposed error
    // so Jest doesn't fail after the test itself succeeded.
    const remoteConsole = connection.console;

    (['log', 'info', 'warn', 'error'] as const).forEach((methodName) => {
        const original = remoteConsole[methodName].bind(remoteConsole);
        remoteConsole[methodName] = (message: string) => {
            try {
                original(message);
            } catch (e) {
                if (_isConnectionDisposedError(e)) {
                    return;
                }
                throw e;
            }
        };
    });
}

/**
 * Runs `callback` while temporarily swallowing `unhandledRejection`/`uncaughtException`
 * events that match `shouldIgnore`. This is needed during teardown because background
 * analysis timers can fire after the in-proc connection is disposed and vscode-jsonrpc
 * throws synchronously ("Connection is disposed."). Any error that does not match
 * `shouldIgnore` is collected and rethrown so real failures aren't masked.
 */
async function runWithConnectionErrorGuard(
    shouldIgnore: (error: unknown) => boolean,
    callback: () => Promise<void>
): Promise<void> {
    const unexpected: unknown[] = [];
    const handler = (error: unknown) => {
        if (shouldIgnore(error)) {
            return;
        }
        unexpected.push(error);
    };

    process.on('unhandledRejection', handler);
    process.on('uncaughtException', handler);
    try {
        await callback();
    } finally {
        process.off('unhandledRejection', handler);
        process.off('uncaughtException', handler);
    }

    if (unexpected.length === 0) {
        return;
    }

    const first = unexpected[0];
    throw first instanceof Error ? first : new Error(`Unexpected error during dispose: ${String(first)}`);
}

export class TestStream extends Duplex {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    override _write(chunk: string, _encoding: string, done: () => void) {
        this.emit('data', chunk);
        done();
    }

    // eslint-disable-next-line @typescript-eslint/naming-convention
    override _read(_size: number) {
        return;
    }
}

export interface InProcTypeServer {
    clientConnection: Connection;
    serverConnection: Connection;
    server: TypeServer;
    serviceProvider: ServiceProvider;
    fourslash: FourSlashData;
    dispose(): Promise<void>;
}

export interface InProcTypeServerContext {
    fourslash: FourSlashData;
    serviceProvider: ServiceProvider;
    openFileForMarker(markerName: string, version?: number): Promise<void>;
    getFileUriForMarker(markerName: string): Uri;
    getNodeForMarker(markerName: string): TypeServerProtocol.Node;
    refreshSnapshot(): Promise<number>;
    waitForSnapshotChanged(): Promise<void>;
    sendRequest: Connection['sendRequest'];
    sendNotification: Connection['sendNotification'];
    onNotification: Connection['onNotification'];
    sendRequestWithSnapshot<P extends { snapshot: number }, R, PR, E, RO>(
        type: ProtocolRequestType<P, R, PR, E, RO>,
        params: Omit<P, 'snapshot'>,
        token?: CancellationToken
    ): Promise<R>;
}

function _getFourslashMarker(data: FourSlashData, markerName: string): FourSlashMarker {
    const marker = data.markerPositions.get(markerName);
    if (!marker) {
        throw new Error(
            `Unable to find fourslash marker '${markerName}'. Markers: ${Array.from(data.markerPositions.keys()).join(
                ', '
            )}`
        );
    }

    return marker;
}

function _markerEquals(a: FourSlashMarker, b: FourSlashMarker): boolean {
    return a.fileName === b.fileName && a.position === b.position && a.fileUri.toString() === b.fileUri.toString();
}

function _getFourslashRangeByMarker(data: FourSlashData, markerName: string): FourSlashRange {
    const marker = _getFourslashMarker(data, markerName);
    const range = data.ranges.find((r) => r.marker && _markerEquals(r.marker, marker));
    if (!range) {
        throw new Error(`Unable to find a fourslash range for marker '${markerName}'.`);
    }

    return range;
}

function _getFourslashFileByUri(data: FourSlashData, uri: string): FourSlashFile {
    const file = data.files.find((f) => f.fileUri.toString() === uri);
    if (!file) {
        throw new Error(
            `Unable to find fourslash file for uri '${uri}'. Files: ${data.files
                .map((f) => f.fileUri.toString())
                .join(', ')}`
        );
    }

    return file;
}

function _getLinesFromText(text: string): TokenizerOutput['lines'] {
    return new Tokenizer().tokenize(text).lines;
}

async function createInProcTypeServer(code: string): Promise<InProcTypeServer> {
    const clientToServer = new TestStream();
    const serverToClient = new TestStream();

    // The server listens automatically (LanguageServerBase ctor calls connection.listen()).
    const serverConnection = createConnection(
        new StreamMessageReader(clientToServer),
        new StreamMessageWriter(serverToClient),
        {}
    );

    const clientConnection = createConnection(
        new StreamMessageReader(serverToClient),
        new StreamMessageWriter(clientToServer),
        {}
    );

    // Minimal client stubs required by LanguageServerBase during initialization.
    clientConnection.onRequest(ConfigurationRequest.type, (params) => params.items.map(() => ({})));
    clientConnection.onRequest(RegistrationRequest.type, () => undefined);
    clientConnection.onRequest(UnregistrationRequest.type, () => undefined);
    clientConnection.onRequest(DiagnosticRefreshRequest.type, () => undefined);
    clientConnection.listen();

    // Parse the fourslash content and build a VFS-backed service provider that mounts the
    // bundled typeshed-fallback so stdlib/builtins resolve during type evaluation.
    const fourslash = parseTestData(DEFAULT_WORKSPACE_ROOT, code, 'main.py');
    const testFS = createFileSystem(DEFAULT_WORKSPACE_ROOT, fourslash);
    const uriMapper = new NotebookUriMapper(testFS);
    const pyrightFs = new TypeServerFileSystem(testFS, uriMapper);
    const serverConsole = new ConsoleWithLogLevel(new NullConsole(), 'typeServer.inProc');
    const partialStubs = new PartialStubService(pyrightFs);
    const serviceProvider = createServiceProvider(testFS, pyrightFs, serverConsole, partialStubs);
    serviceProvider.add(TypeServerServiceKeys.uriMapper, uriMapper);

    const fileWatcherProvider = new WorkspaceFileWatcherProvider();
    const rootUri = Uri.file(DEFAULT_WORKSPACE_ROOT, serviceProvider);

    const server = new TypeServer(
        {
            productName: 'PyrightInProcTypeServer',
            rootDirectory: rootUri,
            version: '1.0.0-test',
            serviceProvider,
            fileWatcherHandler: fileWatcherProvider,
        },
        serverConnection
    );

    const dispose = async () => {
        // Make console logging safe even after the connection is disposed.
        _makeRemoteConsoleSafeDuringDispose(serverConnection);
        _makeRemoteConsoleSafeDuringDispose(clientConnection);

        try {
            await clientConnection.sendRequest(ShutdownRequest.type, undefined);
        } catch {
            // Best-effort shutdown.
        }

        // Give the server time to complete any pending operations and settle down. This
        // helps avoid "Pending response rejected" errors from in-flight server requests.
        await sleep(100);

        // Background analysis timers can fire after we dispose the connection; guard against
        // the synchronous "Connection is disposed." throws they produce.
        await runWithConnectionErrorGuard(
            (error) => _isConnectionDisposedError(error) || _isPendingResponseRejectedError(error),
            async () => {
                try {
                    server.dispose();
                } catch {
                    // Ignore.
                }
                try {
                    clientConnection.dispose();
                } catch {
                    // Ignore.
                }
                try {
                    serverConnection.dispose();
                } catch {
                    // Ignore.
                }

                // Give a moment for any pending rejections/exceptions to be observed.
                await sleep(50);
            }
        );
    };

    return { clientConnection, serverConnection, server, serviceProvider, fourslash, dispose };
}

async function initializeInProcServer(clientConnection: Connection) {
    const rootUri = UriEx.file(DEFAULT_WORKSPACE_ROOT).toString();

    await clientConnection.sendRequest(InitializeRequest.type, {
        processId: null,
        rootUri,
        capabilities: {
            workspace: {
                workspaceFolders: true,
                configuration: true,
            },
            textDocument: {
                synchronization: {
                    dynamicRegistration: true,
                },
                diagnostic: {
                    dynamicRegistration: true,
                },
            },
        },
        initializationOptions: {
            supportsPullDiagnostics: true,
            disablePullDiagnostics: false,
        },
        workspaceFolders: [{ uri: rootUri, name: 'workspace' }],
    });

    clientConnection.sendNotification(InitializedNotification.type, {});
}

export async function getStableSnapshot(
    clientConnection: Connection,
    timeoutMs = 5000,
    pollIntervalMs = 5
): Promise<number> {
    const first = await clientConnection.sendRequest(TypeServerProtocol.GetSnapshotRequest.type);

    // Fast path: if the snapshot is already stable, avoid sleeping.
    const second = await clientConnection.sendRequest(TypeServerProtocol.GetSnapshotRequest.type);
    if (second === first && second >= 0) {
        return second;
    }

    let previous = second;
    const duration = new Duration();
    while (duration.getDurationInMilliseconds() < timeoutMs) {
        await sleep(pollIntervalMs);
        const current = await clientConnection.sendRequest(TypeServerProtocol.GetSnapshotRequest.type);
        if (current === previous && current >= 0) {
            return current;
        }
        previous = current;
    }

    return previous;
}

export async function withInProcTypeServer(
    code: string,
    callback: (context: InProcTypeServerContext) => Promise<void>
) {
    const server = await createInProcTypeServer(code);
    const { clientConnection, fourslash, serviceProvider } = server;

    try {
        await initializeInProcServer(clientConnection);

        const linesCache = new Map<string, TokenizerOutput['lines']>();
        const getLinesForUri = (uri: string) => {
            const cached = linesCache.get(uri);
            if (cached) {
                return cached;
            }

            const file = _getFourslashFileByUri(fourslash, uri);
            const lines = _getLinesFromText(file.content);
            linesCache.set(uri, lines);
            return lines;
        };

        const openFileForMarker = async (markerName: string, version = 1) => {
            const marker = _getFourslashMarker(fourslash, markerName);
            const file = _getFourslashFileByUri(fourslash, marker.fileUri.toString());
            clientConnection.sendNotification(DidOpenTextDocumentNotification.type, {
                textDocument: {
                    uri: marker.fileUri.toString(),
                    languageId: 'python',
                    version,
                    text: file.content,
                },
            });

            // Wait for the server to process the open and settle its snapshot.
            await getStableSnapshot(clientConnection);
        };

        const getFileUriForMarker = (markerName: string) => _getFourslashMarker(fourslash, markerName).fileUri;

        const getNodeForMarker = (markerName: string): TypeServerProtocol.Node => {
            const range = _getFourslashRangeByMarker(fourslash, markerName);
            const uri = range.fileUri.toString();
            const lines = getLinesForUri(uri);

            return {
                uri,
                range: convertOffsetsToRange(range.pos, range.end, lines),
            };
        };

        const sendRequestWithSnapshot = async <P extends { snapshot: number }, R, PR, E, RO>(
            type: ProtocolRequestType<P, R, PR, E, RO>,
            params: Omit<P, 'snapshot'>,
            token: CancellationToken = CancellationToken.None
        ): Promise<R> => {
            let lastError: unknown;
            for (let attempt = 0; attempt < 10; attempt++) {
                const snapshot = await getStableSnapshot(clientConnection);
                try {
                    // Use the string method overload so tests don't couple to the request
                    // type generics (which don't always line up with the sendRequest overloads).
                    return (await clientConnection.sendRequest(type.method, { ...params, snapshot } as P, token)) as R;
                } catch (e) {
                    if (e && (e as { code?: number }).code === LSPErrorCodes.ServerCancelled) {
                        // The snapshot moved between reading it and issuing the request; retry.
                        lastError = e;
                        await sleep(5);
                        continue;
                    }
                    throw e;
                }
            }

            throw lastError ?? new Error('sendRequestWithSnapshot failed to obtain a matching snapshot.');
        };

        const refreshSnapshot = () => getStableSnapshot(clientConnection);

        const waitForSnapshotChanged = () =>
            new Promise<void>((resolve) => {
                const disposable = clientConnection.onNotification(
                    TypeServerProtocol.SnapshotChangedNotification.type,
                    () => {
                        disposable.dispose();
                        resolve();
                    }
                );
            });

        const context: InProcTypeServerContext = {
            fourslash,
            serviceProvider,
            openFileForMarker,
            getFileUriForMarker,
            getNodeForMarker,
            refreshSnapshot,
            waitForSnapshotChanged,
            sendRequest: clientConnection.sendRequest.bind(clientConnection),
            sendNotification: clientConnection.sendNotification.bind(clientConnection),
            onNotification: clientConnection.onNotification.bind(clientConnection),
            sendRequestWithSnapshot,
        };

        await callback(context);
    } finally {
        await server.dispose();
    }
}
