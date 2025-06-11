/*
 * languageServerTestUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Utilities for running tests against the LSP server.
 */

import assert from 'assert';
import * as fs from 'fs-extra';
import { isMainThread, threadId, Worker } from 'node:worker_threads';
import path from 'path';
import {
    ApplyWorkspaceEditParams,
    ApplyWorkspaceEditRequest,
    CancellationToken,
    ConfigurationItem,
    ConfigurationRequest,
    DiagnosticRefreshRequest,
    DidChangeWorkspaceFoldersNotification,
    DidOpenTextDocumentNotification,
    Disposable,
    DocumentDiagnosticReport,
    DocumentDiagnosticRequest,
    FullDocumentDiagnosticReport,
    InitializedNotification,
    InitializeParams,
    InitializeRequest,
    InlayHintRefreshRequest,
    LogMessageNotification,
    LogMessageParams,
    PublishDiagnosticsNotification,
    PublishDiagnosticsParams,
    Registration,
    RegistrationRequest,
    SemanticTokensRefreshRequest,
    ShutdownRequest,
    TelemetryEventNotification,
    UnchangedDocumentDiagnosticReport,
    UnregistrationRequest,
    WorkspaceDiagnosticReport,
    WorkspaceDiagnosticRequest,
} from 'vscode-languageserver-protocol';
import {
    Connection,
    createConnection,
    Emitter,
    Event,
    HoverRequest,
    NotificationHandler,
    PortMessageReader,
    PortMessageWriter,
    ProgressToken,
    ProgressType,
    ProtocolNotificationType,
    WorkDoneProgress,
    WorkDoneProgressCancelNotification,
    WorkDoneProgressCreateRequest,
} from 'vscode-languageserver/node';
import { PythonPathResult } from '../../analyzer/pythonPathUtils';
import { deserialize } from '../../backgroundThreadBase';
import { PythonPlatform } from '../../common/configOptions';
import { toBoolean } from '../../common/core';
import { createDeferred, Deferred } from '../../common/deferred';
import { DiagnosticSink } from '../../common/diagnosticSink';
import { FileSystem } from '../../common/fileSystem';
import { LimitedAccessHost } from '../../common/fullAccessHost';
import { HostKind, ScriptOutput } from '../../common/host';
import { combinePaths, resolvePaths } from '../../common/pathUtils';
import { convertOffsetToPosition } from '../../common/positionUtils';
import { PythonVersion, pythonVersion3_10 } from '../../common/pythonVersion';
import { FileUri } from '../../common/uri/fileUri';
import { Uri } from '../../common/uri/uri';
import { UriEx } from '../../common/uri/uriUtils';
import { ParseOptions, Parser } from '../../parser/parser';
import { parseTestData } from '../harness/fourslash/fourSlashParser';
import { FourSlashData, GlobalMetadataOptionNames } from '../harness/fourslash/fourSlashTypes';
import { createVfsInfoFromFourSlashData, getMarkerByName } from '../harness/fourslash/testStateUtils';
import * as host from '../harness/testHost';
import { createFromFileSystem, distlibFolder, libFolder } from '../harness/vfs/factory';
import * as vfs from '../harness/vfs/filesystem';
import { CustomLSP } from './customLsp';

// bundled root on test virtual file system.
const bundledStubsFolder = combinePaths(vfs.MODULE_PATH, 'bundled', 'stubs');

// bundled file path on real file system.
const bundledStubsFolderPath = resolvePaths(__dirname, '../../bundled/stubs');
const bundledStubsFolderPathTestServer = resolvePaths(__dirname, '../bundled/stubs');

// project root on test virtual file system.
export const DEFAULT_WORKSPACE_ROOT = combinePaths('/', 'src');

export const ERROR_SCRIPT_OUTPUT = 'Error: script failed to run';
export const STALL_SCRIPT_OUTPUT = 'Timeout: script never finished running';

export interface PyrightServerInfo {
    disposables: Disposable[];
    registrations: Registration[];
    logs: LogMessageParams[];
    connection: Connection;
    signals: Map<CustomLSP.TestSignalKinds, Deferred<boolean>>;
    testName: string; // Used for debugging
    testData: FourSlashData;
    projectRoots: Uri[];
    progressReporters: string[];
    progressReporterStatus: Map<string, number>;
    progressParts: Map<string, TestProgressPart>;
    telemetry: any[];
    supportsPullDiagnostics: boolean;
    diagnostics: PublishDiagnosticsParams[];
    diagnosticsEvent: Event<PublishDiagnosticsParams>;
    workspaceEdits: ApplyWorkspaceEditParams[];
    workspaceEditsEvent: Event<ApplyWorkspaceEditParams>;
    getInitializeParams(): InitializeParams;
    dispose(): Promise<void>;
    convertPathToUri(path: string): Uri;
}

export class TestHostOptions {
    version: PythonVersion;
    platform: PythonPlatform;

    // Search path on virtual file system.
    searchPaths: Uri[];

    // Run script function
    runScript: (
        pythonPath: Uri | undefined,
        scriptPath: Uri,
        args: string[],
        cwd: Uri,
        token: CancellationToken
    ) => Promise<ScriptOutput>;

    constructor({
        version = pythonVersion3_10,
        platform = PythonPlatform.Linux,
        searchPaths = [libFolder, distlibFolder],
        runScript = async (
            pythonPath: Uri | undefined,
            scriptPath: Uri,
            args: string[],
            cwd: Uri,
            token: CancellationToken
        ) => {
            return { stdout: '', stderr: '' };
        },
    } = {}) {
        this.version = version;
        this.platform = platform;
        this.searchPaths = searchPaths;
        this.runScript = runScript;
    }
}
// Enable this to log to disk for debugging sync issues.
export const logToDisk = (m: string, f: Uri) => {}; // logToDiskImpl
export function logToDiskImpl(message: string, fileName: Uri) {
    const thread = isMainThread ? 'main' : threadId.toString();
    fs.writeFileSync(fileName.getFilePath(), `${Date.now()} : ${thread} : ${message}\n`, {
        flag: 'a+',
    });
}

// Global server worker.
let serverWorker: Worker | undefined;
let serverWorkerFile: string | undefined;
let lastServerFinished: { name: string; finished: boolean } = { name: '', finished: true };

function removeAllListeners(worker: Worker) {
    // Only remove the 'message', 'error' and 'close' events
    worker.rawListeners('message').forEach((listener) => worker.removeListener('message', listener as any));
    worker.rawListeners('error').forEach((listener) => worker.removeListener('error', listener as any));
    worker.rawListeners('close').forEach((listener) => worker.removeListener('close', listener as any));
}

function createServerWorker(file: string, testServerData: CustomLSP.TestServerStartOptions) {
    // Do not terminate the worker if it's the same file. Reuse it.
    // This makes tests run a lot faster because creating a worker is the same
    // as starting a new process.
    if (!serverWorker || serverWorkerFile !== file) {
        serverWorker?.terminate();
        serverWorkerFile = file;
        serverWorker = new Worker(file);
        logToDisk(`Created new server worker for ${file}`, testServerData.logFile);
    }
    // Every time we 'create' the worker, refresh its message handlers. This
    // is essentially the same thing as creating a new worker.
    removeAllListeners(serverWorker);
    logToDisk(
        `Removed all worker listeners. Test ${testServerData.testName} is starting.\n  Last test was ${lastServerFinished.name} and finished: ${lastServerFinished.finished}`,
        testServerData.logFile
    );
    serverWorker.on('error', (e) => {
        logToDisk(`Worker error: ${e}`, testServerData.logFile);
    });
    serverWorker.on('exit', (code) => {
        logToDisk(`Worker exit: ${code}`, testServerData.logFile);
        serverWorker = undefined;
    });
    return serverWorker;
}

export async function cleanupAfterAll() {
    if (serverWorker) {
        await serverWorker.terminate();
        serverWorker = undefined;
    }
}

export function getFileLikePath(uri: Uri): string {
    return FileUri.isFileUri(uri) ? uri.getFilePath() : uri.toString();
}

export function createFileSystem(projectRoot: string, testData: FourSlashData, optionalHost?: host.TestHost) {
    const mountedPaths = new Map<string, string>();
    if (fs.existsSync(bundledStubsFolderPath)) {
        mountedPaths.set(bundledStubsFolder, bundledStubsFolderPath);
    } else if (fs.existsSync(bundledStubsFolderPathTestServer)) {
        mountedPaths.set(bundledStubsFolder, bundledStubsFolderPathTestServer);
    }

    const vfsInfo = createVfsInfoFromFourSlashData(projectRoot, testData);
    return createFromFileSystem(
        optionalHost ?? host.HOST,
        vfsInfo.ignoreCase,
        { cwd: vfsInfo.projectRoot, files: vfsInfo.files, meta: testData.globalOptions },
        mountedPaths
    );
}

const settingsMap = new Map<PyrightServerInfo, { item: ConfigurationItem; value: any }[]>();

export function updateSettingsMap(info: PyrightServerInfo, settings: { item: ConfigurationItem; value: any }[]) {
    const ignoreCase = toBoolean(info.testData.globalOptions[GlobalMetadataOptionNames.ignoreCase]);
    // Normalize the URIs for all of the settings.
    settings.forEach((s) => {
        if (s.item.scopeUri) {
            s.item.scopeUri = UriEx.parse(s.item.scopeUri, !ignoreCase).toString();
        }
    });

    const current = settingsMap.get(info) || [];
    settingsMap.set(info, [...settings, ...current]);
}

export function getParseResults(fileContents: string, isStubFile = false, useNotebookMode = false) {
    const diagSink = new DiagnosticSink();
    const parseOptions = new ParseOptions();
    parseOptions.useNotebookMode = useNotebookMode;
    parseOptions.isStubFile = isStubFile;
    parseOptions.pythonVersion = pythonVersion3_10;
    parseOptions.skipFunctionAndClassBody = false;

    // Parse the token stream, building the abstract syntax tree.
    const parser = new Parser();
    return parser.parseSourceFile(fileContents, parseOptions, diagSink);
}

function createServerConnection(testServerData: CustomLSP.TestServerStartOptions, disposables: Disposable[]) {
    // Start a worker with the server running in it.
    const serverPath = path.join(__dirname, '..', '..', '..', 'out', 'testServer.bundle.js');
    assert(
        fs.existsSync(serverPath),
        `Server bundle does not exist: ${serverPath}. Make sure you ran the build script for test bundle (npm run webpack:testserver).`
    );
    const serverWorker = createServerWorker(serverPath, testServerData);
    const options = {};

    const connection = createConnection(
        new PortMessageReader(serverWorker),
        new PortMessageWriter(serverWorker),
        options
    );
    disposables.push(connection);

    return connection;
}

function getProjectRootString(info: PyrightServerInfo, projectRoot?: Uri) {
    return projectRoot ? projectRoot.toString() : info.projectRoots.length > 0 ? info.projectRoots[0].toString() : '';
}

export async function getOpenFiles(info: PyrightServerInfo, projectRoot?: Uri): Promise<Uri[]> {
    const uri = getProjectRootString(info, projectRoot);
    const result = await CustomLSP.sendRequest(info.connection, CustomLSP.Requests.GetOpenFiles, { uri });
    return deserialize(result.files);
}

async function waitForPushDiagnostics(info: PyrightServerInfo, timeout = 10000) {
    const deferred = createDeferred<void>();
    const disposable = info.diagnosticsEvent((params) => {
        if (params.diagnostics.length > 0) {
            deferred.resolve();
        }
    });
    const timer = setTimeout(() => deferred.reject('Timed out waiting for diagnostics'), timeout);
    try {
        await deferred.promise;
    } finally {
        clearTimeout(timer);
        disposable.dispose();
    }
    return info.diagnostics;
}

export async function waitForEvent<T>(event: Event<T>, name: string, condition: (p: T) => boolean, timeout = 10000) {
    const deferred = createDeferred<void>();
    const disposable = event((params) => {
        if (condition(params)) {
            deferred.resolve();
        }
    });

    const timer = setTimeout(() => deferred.reject(`Timed out waiting for ${name} event`), timeout);

    try {
        await deferred.promise;
    } finally {
        clearTimeout(timer);
        disposable.dispose();
    }
}

function convertDiagnosticReportItem(
    uri: string,
    item: FullDocumentDiagnosticReport | UnchangedDocumentDiagnosticReport
): PublishDiagnosticsParams {
    if (item.kind === 'unchanged') {
        return {
            uri,
            diagnostics: [],
        };
    }

    return {
        uri,
        diagnostics: item.items,
    };
}
export function convertDiagnosticReport(
    uri: string | undefined,
    report: DocumentDiagnosticReport | WorkspaceDiagnosticReport
): PublishDiagnosticsParams[] {
    if (!(report as any).kind || !uri) {
        const workspaceReport = report as WorkspaceDiagnosticReport;
        return workspaceReport.items.map((item) => convertDiagnosticReportItem(item.uri, item));
    }
    const documentReport = report as DocumentDiagnosticReport;
    return [convertDiagnosticReportItem(uri, documentReport)];
}

async function waitForPullDiagnostics(info: PyrightServerInfo): Promise<PublishDiagnosticsParams[]> {
    const openFiles = await getOpenFiles(info);
    if (openFiles.length <= 0) {
        const results = await info.connection.sendRequest(WorkspaceDiagnosticRequest.type, {
            identifier: 'Pylance',
            previousResultIds: [],
        });
        return convertDiagnosticReport(undefined, results);
    } else {
        const results: PublishDiagnosticsParams[] = [];
        for (const openFile of openFiles) {
            const result = await info.connection.sendRequest(DocumentDiagnosticRequest.type, {
                textDocument: {
                    uri: openFile.toString(),
                },
            });
            results.push(convertDiagnosticReport(openFile.toString(), result)[0]);
        }
        return results;
    }
}

export async function waitForDiagnostics(info: PyrightServerInfo, timeout = 20000) {
    if (info.supportsPullDiagnostics) {
        // Timeout doesn't apply on pull because we can actually ask for them.
        return waitForPullDiagnostics(info);
    }
    return waitForPushDiagnostics(info, timeout);
}

interface ProgressPart {}

interface ProgressContext {
    onProgress<P>(type: ProgressType<P>, token: string | number, handler: NotificationHandler<P>): Disposable;
    sendNotification<P, RO>(type: ProtocolNotificationType<P, RO>, params?: P): void;
}

class TestProgressPart implements ProgressPart {
    constructor(
        private readonly _context: ProgressContext,
        private readonly _token: ProgressToken,
        info: PyrightServerInfo,
        done: () => void
    ) {
        info.disposables.push(
            info.connection.onProgress(WorkDoneProgress.type, _token, (params) => {
                switch (params.kind) {
                    case 'begin':
                        info.progressReporterStatus.set(_token.toString(), 0);
                        break;
                    case 'report':
                        info.progressReporterStatus.set(_token.toString(), params.percentage ?? 0);
                        break;
                    case 'end':
                        done();
                        break;
                }
            })
        );
        info.progressReporters.push(this._token.toString());
        info.progressParts.set(this._token.toString(), this);
    }

    sendCancel() {
        this._context.sendNotification(WorkDoneProgressCancelNotification.type, { token: this._token });
    }
}

export async function runPyrightServer(
    projectRoots: string[] | string,
    code: string,
    callInitialize = true,
    extraSettings?: { item: ConfigurationItem; value: any }[],
    pythonVersion: PythonVersion = pythonVersion3_10,
    backgroundAnalysis?: boolean,
    supportPullDiagnostics?: boolean
): Promise<PyrightServerInfo> {
    // Setup the test data we need to send for Test server startup.
    const projectRootsArray = Array.isArray(projectRoots) ? projectRoots : [projectRoots];

    // Here all Uri has `isCaseSensitive` as true.
    const testServerData: CustomLSP.TestServerStartOptions = {
        testName: expect.getState().currentTestName ?? 'NoName',
        code,
        projectRoots: projectRootsArray.map((p) => (p.includes(':') ? UriEx.parse(p) : UriEx.file(p))),
        pythonVersion: PythonVersion.toString(pythonVersion),
        backgroundAnalysis,
        logFile: UriEx.file(path.join(__dirname, `log${process.pid}.txt`)),
        pid: process.pid.toString(),
    };

    logToDisk(`Starting test ${testServerData.testName}`, testServerData.logFile);
    lastServerFinished = { name: testServerData.testName, finished: false };

    // Parse the test data on this side as well. This allows the use of markers and such.
    const testData = parseTestData(
        testServerData.projectRoots.length === 1
            ? getFileLikePath(testServerData.projectRoots[0])
            : DEFAULT_WORKSPACE_ROOT,
        testServerData.code,
        'noname.py'
    );

    const ignoreCase = toBoolean(testData.globalOptions[GlobalMetadataOptionNames.ignoreCase]);

    // Normalize the URIs for all of the settings.
    extraSettings?.forEach((s) => {
        if (s.item.scopeUri) {
            s.item.scopeUri = UriEx.parse(s.item.scopeUri, !ignoreCase).toString();
        }
    });

    // Start listening to the 'client' side of the connection.
    const disposables: Disposable[] = [];
    const connection = createServerConnection(testServerData, disposables);
    const serverStarted = createDeferred<string>();
    const diagnosticsEmitter = new Emitter<PublishDiagnosticsParams>();
    const workspaceEditsEmitter = new Emitter<ApplyWorkspaceEditParams>();
    const diagnosticsMode = extraSettings?.find((s) => s.item.section === 'python.analysis')?.value?.diagnosticMode;

    // Setup the server info.
    const info: PyrightServerInfo = {
        disposables,
        registrations: [],
        connection,
        logs: [],
        progressReporters: [],
        progressReporterStatus: new Map<string, number>(),
        progressParts: new Map<string, TestProgressPart>(),
        signals: new Map(Object.values(CustomLSP.TestSignalKinds).map((v) => [v, createDeferred<boolean>()])),
        testData,
        testName: testServerData.testName,
        telemetry: [],
        supportsPullDiagnostics: (supportPullDiagnostics && diagnosticsMode !== 'workspace') ?? false,
        projectRoots: testServerData.projectRoots,
        diagnostics: [],
        diagnosticsEvent: diagnosticsEmitter.event,
        workspaceEdits: [],
        workspaceEditsEvent: workspaceEditsEmitter.event,
        getInitializeParams: () =>
            getInitializeParams(testServerData.projectRoots, !!supportPullDiagnostics, diagnosticsMode),
        convertPathToUri: (path: string) => UriEx.file(path, !ignoreCase),
        dispose: async () => {
            // Send shutdown. This should disconnect the dispatcher and kill the server.
            if (serverWorker) {
                await connection.sendRequest(ShutdownRequest.type, undefined);
            }

            // Now we can dispose the connection.
            disposables.forEach((d) => d.dispose());

            logToDisk(`Finished test ${testServerData.testName}`, testServerData.logFile);
        },
    };
    info.disposables.push(
        info.connection.onNotification(CustomLSP.Notifications.TestStartServerResponse, (p) => {
            serverStarted.resolve(p.testName);
        }),
        info.connection.onRequest(RegistrationRequest.type, (p) => {
            info.registrations.push(...p.registrations);
        }),
        info.connection.onNotification(CustomLSP.Notifications.TestSignal, (p: CustomLSP.TestSignal) => {
            info.signals.get(p.kind)!.resolve(true);
        }),
        info.connection.onNotification(LogMessageNotification.type, (p) => {
            info.logs.push(p);
        }),
        info.connection.onRequest(SemanticTokensRefreshRequest.type, () => {
            // Empty. Silently ignore for now.
        }),
        info.connection.onRequest(InlayHintRefreshRequest.type, () => {
            // Empty. Silently ignore for now.
        }),
        info.connection.onRequest(DiagnosticRefreshRequest.type, () => {}),
        info.connection.onRequest(ApplyWorkspaceEditRequest.type, (p) => {
            info.workspaceEdits.push(p);
            workspaceEditsEmitter.fire(p);
            return { applied: true };
        }),
        info.connection.onRequest(UnregistrationRequest.type, (p) => {
            const unregisterIds = p.unregisterations.map((u) => u.id);
            info.registrations = info.registrations.filter((r) => !unregisterIds.includes(r.id));
        }),
        info.connection.onRequest(WorkDoneProgressCreateRequest.type, (p) => {
            // Save the progress reporter so we can send progress updates.
            info.progressReporters.push(p.token.toString());
            info.disposables.push(
                info.connection.onProgress(WorkDoneProgress.type, p.token, (params) => {
                    switch (params.kind) {
                        case 'begin':
                            info.progressReporterStatus.set(p.token.toString(), 0);
                            break;
                        case 'report':
                            info.progressReporterStatus.set(p.token.toString(), params.percentage ?? 0);
                            break;
                        case 'end':
                            break;
                    }
                })
            );
        }),
        info.connection.onNotification(PublishDiagnosticsNotification.type, (p) => {
            info.diagnostics.push(p);
            diagnosticsEmitter.fire(p);
        }),
        info.connection.onNotification(TelemetryEventNotification.type, (p) => {
            info.telemetry.push(p);
        })
    );
    info.disposables.push(
        info.connection.onRequest(ConfigurationRequest.type, (p) => {
            const result = [];
            const mappedSettings = settingsMap.get(info) || [];
            for (const item of p.items) {
                const setting = mappedSettings.find(
                    (s) =>
                        (s.item.scopeUri === item.scopeUri || s.item.scopeUri === undefined) &&
                        s.item.section === item.section
                );
                result.push(setting?.value);
            }

            return result;
        })
    );

    // Merge the extra settings.
    const settings: { item: ConfigurationItem; value: any }[] = [];
    if (extraSettings) {
        for (const extra of extraSettings) {
            const existing = settings.find(
                (s) => s.item.section === extra.item.section && s.item.scopeUri === extra.item.scopeUri
            );
            if (existing) {
                existing.value = { ...existing.value, ...extra.value };
            } else {
                settings.push(extra);
            }
        }
    }
    settingsMap.set(info, settings);

    // Wait for the server to be started.
    connection.listen();
    logToDisk(`Sending start notification for ${testServerData.testName}`, testServerData.logFile);
    CustomLSP.sendNotification(connection, CustomLSP.Notifications.TestStartServer, testServerData);
    const serverTestName = await serverStarted.promise;
    assert.equal(serverTestName, testServerData.testName, 'Server started for wrong test');

    logToDisk(`Started test ${testServerData.testName}`, testServerData.logFile);

    // Initialize the server if requested.
    if (callInitialize) {
        await initializeLanguageServer(info);
        logToDisk(`Initialized test ${testServerData.testName}`, testServerData.logFile);
    }

    if (lastServerFinished.name === testServerData.testName) {
        lastServerFinished.finished = true;
    } else {
        logToDisk(`Last server finished was incorrectly updated to ${lastServerFinished.name}`, testServerData.logFile);
    }

    return info;
}

export async function initializeLanguageServer(info: PyrightServerInfo) {
    const params = info.getInitializeParams();

    // Send the initialize request.
    const result = await info.connection.sendRequest(InitializeRequest.type, params, CancellationToken.None);
    info.connection.sendNotification(InitializedNotification.type, {});

    if (params.workspaceFolders?.length) {
        await info.connection.sendNotification(DidChangeWorkspaceFoldersNotification.type, {
            event: {
                added: params.workspaceFolders!,
                removed: [],
            },
        });

        // Wait until workspace initialization is done.
        // This is required since some tests check status of server directly. In such case, even if the client sent notification,
        // server might not have processed it and still in the event queue.
        // This check makes sure server at least processed initialization before test checking server status directly.
        // If test only uses response from client.sendRequest, then this won't be needed.
        await info.signals.get(CustomLSP.TestSignalKinds.Initialization)!.promise;
    }

    return result;
}

export async function sleep(timeout: number): Promise<number> {
    return new Promise<number>((resolve) => {
        setTimeout(() => resolve(timeout), timeout);
    });
}

export function openFile(info: PyrightServerInfo, markerName: string, text?: string) {
    const marker = getMarkerByName(info.testData, markerName);
    const uri = marker.fileUri.toString();

    text = text ?? info.testData.files.find((f) => f.fileName === marker.fileName)!.content;

    info.connection.sendNotification(DidOpenTextDocumentNotification.type, {
        textDocument: { uri, languageId: 'python', version: 1, text },
    });
}

export async function hover(info: PyrightServerInfo, markerName: string) {
    const marker = info.testData.markerPositions.get('marker')!;
    const fileUri = marker.fileUri;
    const text = info.testData.files.find((d) => d.fileName === marker.fileName)!.content;
    const parseResult = getParseResults(text);
    const hoverResult = await info.connection.sendRequest(
        HoverRequest.type,
        {
            textDocument: { uri: fileUri.toString() },
            position: convertOffsetToPosition(marker.position, parseResult.tokenizerOutput.lines),
        },
        CancellationToken.None
    );

    return hoverResult;
}

export function getInitializeParams(
    projectRoots: Uri[],
    supportsPullDiagnostics: boolean,
    diagnosticMode: string | undefined = undefined
) {
    // cloned vscode "1.71.0-insider"'s initialize params.
    const workspaceFolders = projectRoots
        ? projectRoots.map((root, i) => ({ name: root.fileName, uri: projectRoots[i].toString() }))
        : [];

    const params: InitializeParams = {
        processId: process.pid,
        clientInfo: {
            name: `Pylance Unit Test ${expect.getState().currentTestName}`,
            version: '1.71.0-insider',
        },
        locale: 'en-us',
        rootPath: null,
        rootUri: null,
        capabilities: {
            workspace: {
                applyEdit: true,
                workspaceEdit: {
                    documentChanges: true,
                    resourceOperations: ['create', 'rename', 'delete'],
                    failureHandling: 'textOnlyTransactional',
                    normalizesLineEndings: true,
                    changeAnnotationSupport: {
                        groupsOnLabel: true,
                    },
                },
                configuration: true,
                didChangeWatchedFiles: {
                    dynamicRegistration: true,
                    relativePatternSupport: true,
                },
                symbol: {
                    dynamicRegistration: true,
                    symbolKind: {
                        valueSet: [
                            1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
                            26,
                        ],
                    },
                    tagSupport: {
                        valueSet: [1],
                    },
                    resolveSupport: {
                        properties: ['location.range'],
                    },
                },
                codeLens: {
                    refreshSupport: true,
                },
                executeCommand: {
                    dynamicRegistration: true,
                },
                didChangeConfiguration: {
                    dynamicRegistration: true,
                },
                workspaceFolders: true,
                semanticTokens: {
                    refreshSupport: true,
                },
                fileOperations: {
                    dynamicRegistration: true,
                    didCreate: true,
                    didRename: true,
                    didDelete: true,
                    willCreate: true,
                    willRename: true,
                    willDelete: true,
                },
                inlineValue: {
                    refreshSupport: true,
                },
                inlayHint: {
                    refreshSupport: true,
                },
                diagnostics: {
                    refreshSupport: true,
                },
            },
            textDocument: {
                publishDiagnostics: {
                    relatedInformation: true,
                    versionSupport: false,
                    tagSupport: {
                        valueSet: [1, 2],
                    },
                    codeDescriptionSupport: true,
                    dataSupport: true,
                },
                synchronization: {
                    dynamicRegistration: true,
                    willSave: true,
                    willSaveWaitUntil: true,
                    didSave: true,
                },
                completion: {
                    dynamicRegistration: true,
                    contextSupport: true,
                    completionItem: {
                        snippetSupport: true,
                        commitCharactersSupport: true,
                        documentationFormat: ['markdown', 'plaintext'],
                        deprecatedSupport: true,
                        preselectSupport: true,
                        tagSupport: {
                            valueSet: [1],
                        },
                        insertReplaceSupport: true,
                        resolveSupport: {
                            properties: ['documentation', 'detail', 'additionalTextEdits'],
                        },
                        insertTextModeSupport: {
                            valueSet: [1, 2],
                        },
                        labelDetailsSupport: true,
                    },
                    insertTextMode: 2,
                    completionItemKind: {
                        valueSet: [
                            1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
                        ],
                    },
                    completionList: {
                        itemDefaults: ['commitCharacters', 'editRange', 'insertTextFormat', 'insertTextMode'],
                    },
                },
                hover: {
                    dynamicRegistration: true,
                    contentFormat: ['markdown', 'plaintext'],
                },
                signatureHelp: {
                    dynamicRegistration: true,
                    signatureInformation: {
                        documentationFormat: ['markdown', 'plaintext'],
                        parameterInformation: {
                            labelOffsetSupport: true,
                        },
                        activeParameterSupport: true,
                    },
                    contextSupport: true,
                },
                definition: {
                    dynamicRegistration: true,
                    linkSupport: true,
                },
                references: {
                    dynamicRegistration: true,
                },
                documentHighlight: {
                    dynamicRegistration: true,
                },
                documentSymbol: {
                    dynamicRegistration: true,
                    symbolKind: {
                        valueSet: [
                            1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
                            26,
                        ],
                    },
                    hierarchicalDocumentSymbolSupport: true,
                    tagSupport: {
                        valueSet: [1],
                    },
                    labelSupport: true,
                },
                codeAction: {
                    dynamicRegistration: true,
                    isPreferredSupport: true,
                    disabledSupport: true,
                    dataSupport: true,
                    resolveSupport: {
                        properties: ['edit'],
                    },
                    codeActionLiteralSupport: {
                        codeActionKind: {
                            valueSet: [
                                '',
                                'quickfix',
                                'refactor',
                                'refactor.extract',
                                'refactor.inline',
                                'refactor.rewrite',
                                'source',
                                'source.organizeImports',
                            ],
                        },
                    },
                    honorsChangeAnnotations: false,
                },
                codeLens: {
                    dynamicRegistration: true,
                },
                formatting: {
                    dynamicRegistration: true,
                },
                rangeFormatting: {
                    dynamicRegistration: true,
                },
                onTypeFormatting: {
                    dynamicRegistration: true,
                },
                rename: {
                    dynamicRegistration: true,
                    prepareSupport: true,
                    prepareSupportDefaultBehavior: 1,
                    honorsChangeAnnotations: true,
                },
                documentLink: {
                    dynamicRegistration: true,
                    tooltipSupport: true,
                },
                typeDefinition: {
                    dynamicRegistration: true,
                    linkSupport: true,
                },
                implementation: {
                    dynamicRegistration: true,
                    linkSupport: true,
                },
                colorProvider: {
                    dynamicRegistration: true,
                },
                foldingRange: {
                    dynamicRegistration: true,
                    rangeLimit: 5000,
                    lineFoldingOnly: true,
                    foldingRangeKind: {
                        valueSet: ['comment', 'imports', 'region'],
                    },
                    foldingRange: {
                        collapsedText: false,
                    },
                },
                declaration: {
                    dynamicRegistration: true,
                    linkSupport: true,
                },
                selectionRange: {
                    dynamicRegistration: true,
                },
                callHierarchy: {
                    dynamicRegistration: true,
                },
                semanticTokens: {
                    dynamicRegistration: true,
                    tokenTypes: [
                        'namespace',
                        'type',
                        'class',
                        'enum',
                        'interface',
                        'struct',
                        'typeParameter',
                        'parameter',
                        'variable',
                        'property',
                        'enumMember',
                        'event',
                        'function',
                        'method',
                        'macro',
                        'keyword',
                        'modifier',
                        'comment',
                        'string',
                        'number',
                        'regexp',
                        'operator',
                        'decorator',
                    ],
                    tokenModifiers: [
                        'declaration',
                        'definition',
                        'readonly',
                        'static',
                        'deprecated',
                        'abstract',
                        'async',
                        'modification',
                        'documentation',
                        'defaultLibrary',
                    ],
                    formats: ['relative'],
                    requests: {
                        range: true,
                        full: {
                            delta: true,
                        },
                    },
                    multilineTokenSupport: false,
                    overlappingTokenSupport: false,
                    serverCancelSupport: true,
                    augmentsSyntaxTokens: true,
                },
                linkedEditingRange: {
                    dynamicRegistration: true,
                },
                typeHierarchy: {
                    dynamicRegistration: true,
                },
                inlineValue: {
                    dynamicRegistration: true,
                },
                inlayHint: {
                    dynamicRegistration: true,
                    resolveSupport: {
                        properties: ['tooltip', 'textEdits', 'label.tooltip', 'label.location', 'label.command'],
                    },
                },
                diagnostic: {
                    dynamicRegistration: true,
                    relatedDocumentSupport: false,
                },
            },
            window: {
                showMessage: {
                    messageActionItem: {
                        additionalPropertiesSupport: true,
                    },
                },
                showDocument: {
                    support: true,
                },
                workDoneProgress: true,
            },
            general: {
                staleRequestSupport: {
                    cancel: true,
                    retryOnContentModified: [
                        'textDocument/semanticTokens/full',
                        'textDocument/semanticTokens/range',
                        'textDocument/semanticTokens/full/delta',
                    ],
                },
                regularExpressions: {
                    engine: 'ECMAScript',
                    version: 'ES2020',
                },
                markdown: {
                    parser: 'marked',
                    version: '1.1.0',
                },
                positionEncodings: ['utf-16'],
            },
            notebookDocument: {
                synchronization: {
                    dynamicRegistration: true,
                    executionSummarySupport: true,
                },
            },
        },
        initializationOptions: {
            autoFormatStrings: true,
            diagnosticMode: diagnosticMode ?? 'openFilesOnly',
            disablePullDiagnostics: !supportsPullDiagnostics,
        },
        workspaceFolders,
    };

    return params;
}

export class TestHost extends LimitedAccessHost {
    private readonly _options: TestHostOptions;

    constructor(
        readonly fs: FileSystem,
        readonly testFs: vfs.TestFileSystem,
        readonly testData: FourSlashData,
        readonly projectRoots: string[],
        options?: TestHostOptions
    ) {
        super();

        this._options = options ?? new TestHostOptions();
    }

    override get kind(): HostKind {
        return HostKind.FullAccess;
    }

    override getPythonVersion(pythonPath?: Uri, logInfo?: string[]): PythonVersion | undefined {
        return this._options.version;
    }

    override getPythonPlatform(logInfo?: string[]): PythonPlatform | undefined {
        return this._options.platform;
    }

    override getPythonSearchPaths(pythonPath?: Uri, logInfo?: string[]): PythonPathResult {
        return {
            paths: this._options.searchPaths,
            prefix: Uri.empty(),
        };
    }

    override runScript(
        pythonPath: Uri | undefined,
        scriptPath: Uri,
        args: string[],
        cwd: Uri,
        token: CancellationToken
    ): Promise<ScriptOutput> {
        return this._options.runScript(pythonPath, scriptPath, args, cwd, token);
    }
}
