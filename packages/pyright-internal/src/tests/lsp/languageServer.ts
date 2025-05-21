/*
 * languageServer.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Test language server wrapper that lets us run the language server during a test.
 */
import {
    CancellationToken,
    Connection,
    Disposable,
    Message,
    MessageReader,
    MessageWriter,
    PortMessageReader,
    PortMessageWriter,
    ShutdownRequest,
    createConnection,
} from 'vscode-languageserver/node';
import { MessagePort, getEnvironmentData, parentPort, setEnvironmentData } from 'worker_threads';

import { Deferred, createDeferred } from '../../common/deferred';
import { FileSystemEntries, resolvePaths } from '../../common/pathUtils';
import { ServiceProvider } from '../../common/serviceProvider';
import { Uri } from '../../common/uri/uri';
import { parseTestData } from '../harness/fourslash/fourSlashParser';
import * as PyrightTestHost from '../harness/testHost';
import { clearCache } from '../harness/vfs/factory';

import { BackgroundAnalysis, BackgroundAnalysisRunner } from '../../backgroundAnalysis';
import { IBackgroundAnalysis } from '../../backgroundAnalysisBase';
import { serialize } from '../../backgroundThreadBase';
import { initializeDependencies } from '../../common/asyncInitialization';
import { FileSystem } from '../../common/fileSystem';
import { ServerSettings } from '../../common/languageServerInterface';
import { PythonVersion } from '../../common/pythonVersion';
import { ServiceKeys } from '../../common/serviceKeys';
import { PyrightFileSystem } from '../../pyrightFileSystem';
import { PyrightServer } from '../../server';
import { InitStatus, Workspace } from '../../workspaceFactory';
import { CustomLSP } from './customLsp';
import {
    DEFAULT_WORKSPACE_ROOT,
    TestHost,
    TestHostOptions,
    createFileSystem,
    getFileLikePath,
    logToDisk,
    sleep,
} from './languageServerTestUtils';

const WORKER_STARTED = 'WORKER_STARTED';
const WORKER_BACKGROUND_DATA = 'WORKER_BACKGROUND_DATA';

function getCommonRoot(files: Uri[]) {
    let root = files[0]?.getPath() || DEFAULT_WORKSPACE_ROOT;
    for (let i = 1; i < files.length; i++) {
        const file = files[i];
        while (root.length > 0 && !file.pathStartsWith(root)) {
            root = root.slice(0, root.lastIndexOf('/'));
        }
    }
    return root;
}

class TestPyrightHost implements PyrightTestHost.TestHost {
    constructor(private _host: PyrightTestHost.TestHost) {}
    useCaseSensitiveFileNames(): boolean {
        return this._host.useCaseSensitiveFileNames();
    }
    getAccessibleFileSystemEntries(dirname: string): FileSystemEntries {
        return this._host.getAccessibleFileSystemEntries(dirname);
    }
    directoryExists(path: string): boolean {
        return this._host.directoryExists(path);
    }
    fileExists(fileName: string): boolean {
        return this._host.fileExists(fileName);
    }
    getFileSize(path: string): number {
        return this._host.getFileSize(path);
    }
    readFile(path: string): string | undefined {
        return this._host.readFile(path);
    }
    getWorkspaceRoot(): string {
        // The default workspace root is wrong. It should be based on where the bundle is running.
        // That's where the typeshed fallback and other bundled files are located.
        return resolvePaths(__dirname);
    }
    writeFile(path: string, contents: string): void {
        this._host.writeFile(path, contents);
    }
    listFiles(
        path: string,
        filter?: RegExp | undefined,
        options?: { recursive?: boolean | undefined } | undefined
    ): string[] {
        return this._host.listFiles(path, filter, options);
    }
    log(text: string): void {
        this._host.log(text);
    }
}

function createTestHost(testServerData: CustomLSP.TestServerStartOptions) {
    const scriptOutput = '';
    const runScript = async (
        pythonPath: Uri | undefined,
        scriptPath: Uri,
        args: string[],
        cwd: Uri,
        token: CancellationToken
    ) => {
        return { stdout: scriptOutput, stderr: '', exitCode: 0 };
    };
    const options = new TestHostOptions({ version: PythonVersion.fromString(testServerData.pythonVersion), runScript });
    const projectRootPaths = testServerData.projectRoots.map((p) => getFileLikePath(p));
    const testData = parseTestData(
        testServerData.projectRoots.length === 1 ? projectRootPaths[0] : DEFAULT_WORKSPACE_ROOT,
        testServerData.code,
        'noname.py'
    );
    const commonRoot = getCommonRoot(testServerData.projectRoots);

    // Make sure global variables from previous tests are cleared.
    clearCache();

    // create a test file system using the test data.
    const fs = createFileSystem(commonRoot, testData, new TestPyrightHost(PyrightTestHost.HOST));

    return new TestHost(fs, fs, testData, projectRootPaths, options);
}

class TestServer extends PyrightServer {
    constructor(
        connection: Connection,
        fs: FileSystem,
        private readonly _supportsBackgroundAnalysis: boolean | undefined
    ) {
        super(connection, _supportsBackgroundAnalysis ? 1 : 0, fs);
    }

    test_onDidChangeWatchedFiles(params: any) {
        this.onDidChangeWatchedFiles(params);
    }

    override async updateSettingsForWorkspace(
        workspace: Workspace,
        status: InitStatus | undefined,
        serverSettings?: ServerSettings | undefined
    ): Promise<void> {
        const result = await super.updateSettingsForWorkspace(workspace, status, serverSettings);

        // LSP notification only allows synchronous callback. because of that, the one that sent the notification can't know
        // when the work caused by the notification actually ended. To workaround that issue, we will send custom lsp to indicate
        // something has been done.
        CustomLSP.sendNotification(this.connection, CustomLSP.Notifications.TestSignal, {
            uri: workspace.rootUri?.toString() ?? '',
            kind: CustomLSP.TestSignalKinds.Initialization,
        });

        return result;
    }

    override createBackgroundAnalysis(serviceId: string, workspaceRoot: Uri): IBackgroundAnalysis | undefined {
        if (this._supportsBackgroundAnalysis) {
            return new BackgroundAnalysis(workspaceRoot, this.serverOptions.serviceProvider);
        }
        return undefined;
    }
}

async function runServer(
    testServerData: CustomLSP.TestServerStartOptions,
    reader: MessageReader,
    writer: MessageWriter,
    connectionFactory: (reader: MessageReader, writer: MessageWriter) => Connection
): Promise<{ disposables: Disposable[]; connection: Connection }> {
    // Create connection back to the client first.
    const connection = connectionFactory(reader, writer);

    // Fixup the input data.
    testServerData = {
        ...testServerData,
        projectRoots: testServerData.projectRoots.map((p) => Uri.fromJsonObj(p)),
        logFile: Uri.fromJsonObj(testServerData.logFile),
    };

    try {
        // Create a host so we can control the file system for the PyrightServer.
        const disposables: Disposable[] = [];
        const host = createTestHost(testServerData);
        const server = new TestServer(connection, host.fs, testServerData.backgroundAnalysis);

        // Listen for the test messages from the client. These messages
        // are how the test code queries the state of the server.
        disposables.push(
            CustomLSP.onRequest(connection, CustomLSP.Requests.GetDiagnostics, async (params, token) => {
                const filePath = Uri.parse(params.uri, server.serviceProvider);
                const workspace = await server.getWorkspaceForFile(filePath);
                workspace.service.test_program.analyze(undefined, token);
                const file = workspace.service.test_program.getBoundSourceFile(filePath);
                const diagnostics = file?.getDiagnostics(workspace.service.test_program.configOptions) || [];
                return { diagnostics: serialize(diagnostics) };
            }),
            CustomLSP.onRequest(connection, CustomLSP.Requests.GetOpenFiles, async (params) => {
                const workspace = await server.getWorkspaceForFile(Uri.parse(params.uri, server.serviceProvider));
                const files = serialize(workspace.service.test_program.getOpened().map((f) => f.uri));
                return { files: files };
            })
        );

        // Dispose the server and connection when terminating the server.
        disposables.push(server);
        disposables.push(connection);

        return { disposables, connection };
    } catch (err) {
        console.error(err);
        return { disposables: [], connection };
    }
}

class ListeningPortMessageWriter extends PortMessageWriter {
    private _callbacks: ((msg: Message) => Promise<void>)[] = [];
    constructor(port: MessagePort) {
        super(port);
    }
    override async write(msg: Message): Promise<void> {
        await Promise.all(this._callbacks.map((c) => c(msg)));
        return super.write(msg);
    }

    onPostMessage(callback: (msg: Message) => Promise<void>) {
        this._callbacks.push(callback);
    }
}

/**
 * Object that exists in the worker thread that starts and stops (and cleans up after) the main server.
 */
class ServerStateManager {
    private _instances: { disposables: Disposable[]; connection: Connection }[] = [];
    private _pendingDispose: Deferred<void> | undefined;
    private _reader = new PortMessageReader(parentPort!);
    private _writer = new ListeningPortMessageWriter(parentPort!);
    private _currentOptions: CustomLSP.TestServerStartOptions | undefined;
    private _shutdownId: string | number | null = null;
    constructor(private readonly _connectionFactory: (reader: MessageReader, writer: MessageWriter) => Connection) {
        // Listen for shutdown response.
        this._writer.onPostMessage(async (msg: Message) => {
            if (Message.isResponse(msg) && msg.id === this._shutdownId) {
                await this._handleShutdown();
            }
        });
    }

    run() {
        parentPort?.on('message', (message) => this._handleMessage(message));
    }

    private _handleMessage(message: any) {
        try {
            // Debug output to help diagnose sync issues.
            if (message && message.method === CustomLSP.Notifications.TestStartServer) {
                this._handleStart(message.params);
            } else if (Message.isRequest(message) && message.method === ShutdownRequest.method) {
                this._shutdownId = message.id;
            }
        } catch (err) {
            console.error(err);
        }
    }

    private async _handleStart(options: CustomLSP.TestServerStartOptions) {
        logToDisk(`Starting server for ${options.testName}`, options.logFile);

        // Every time we start the server, remove all message handlers from our PortMessageReader.
        // This prevents the old servers from responding to messages for new ones.
        this._reader.dispose();
        // Wait for the previous server to finish. This should be okay because the test
        // client waits for the response message before sending anything else. Otherwise
        // we'd receive the initialize message for the server and drop it before the server
        // actually started.
        if (this._pendingDispose) {
            logToDisk(
                `Waiting for previous server ${this._currentOptions?.testName} to finish for ${options.testName}`,
                options.logFile
            );
            await this._pendingDispose.promise;
            this._pendingDispose = undefined;
        }
        this._currentOptions = options;

        // Set the worker data for the current test. Any background threads
        // started after this point will pick up this value.
        setEnvironmentData(WORKER_BACKGROUND_DATA, options);

        // Create an instance of the server.
        const { disposables, connection } = await runServer(
            options,
            this._reader,
            this._writer,
            this._connectionFactory
        );
        this._instances.push({ disposables, connection });

        // Enable this to help diagnose sync issues.
        logToDisk(`Started server for ${options.testName}`, options.logFile);

        // Respond back.
        parentPort?.postMessage({
            jsonrpc: '2.0',
            method: CustomLSP.Notifications.TestStartServerResponse,
            params: options,
        });
    }

    private async _handleShutdown() {
        if (this._currentOptions) {
            logToDisk(`Stopping ${this._currentOptions?.testName}`, this._currentOptions.logFile);
        }
        this._shutdownId = null;
        const instance = this._instances.pop();
        if (instance) {
            this._pendingDispose = createDeferred<void>();

            // Dispose the server first. This might send a message or two.
            const serverIndex = instance.disposables.findIndex((d) => d instanceof TestServer);
            if (serverIndex >= 0) {
                try {
                    instance.disposables[serverIndex].dispose();
                    instance.disposables = instance.disposables.splice(serverIndex, 1);
                } catch (e) {
                    // Dispose failures don't matter.
                }
            }

            // Wait for our connection to finish first. Give it 10 tries.
            // This is a bit of a hack but there are no good ways to cancel all running requests
            // on shutdown.
            let count = 0;
            while (count < 10 && (instance.connection as any).console?._rawConnection?.hasPendingResponse()) {
                await sleep(10);
                count += 1;
            }
            this._pendingDispose.resolve();
            try {
                instance.disposables.forEach((d) => {
                    d.dispose();
                });
            } catch (e) {
                // Dispose failures don't matter.
            }
            this._pendingDispose = undefined;
            if (this._currentOptions) {
                logToDisk(`Stopped ${this._currentOptions?.testName}`, this._currentOptions.logFile);
            }
        } else {
            if (this._currentOptions) {
                logToDisk(`Failed to stop ${this._currentOptions?.testName}`, this._currentOptions.logFile);
            }
        }
        if (global.gc) {
            global.gc();
        }
    }
}

async function runTestBackgroundThread() {
    let options = getEnvironmentData(WORKER_BACKGROUND_DATA) as CustomLSP.TestServerStartOptions;

    // Normalize the options.
    options = {
        ...options,
        projectRoots: options.projectRoots.map((p) => Uri.fromJsonObj(p)),
        logFile: Uri.fromJsonObj(options.logFile),
    };
    try {
        // Create a host on the background thread too so that it uses
        // the host's file system. Has to be sync so that we don't
        // drop any messages sent to the background thread.
        const host = createTestHost(options);
        const fs = new PyrightFileSystem(host.fs);
        const serviceProvider = new ServiceProvider();
        serviceProvider.add(ServiceKeys.fs, fs);

        // run default background runner
        const runner = new BackgroundAnalysisRunner(serviceProvider);
        runner.start();
    } catch (e) {
        console.error(`BackgroundThread crashed with ${e}`);
    }
}

export async function run() {
    await initializeDependencies();

    // Start the background thread if this is not the first worker.
    if (getEnvironmentData(WORKER_STARTED) === 'true') {
        runTestBackgroundThread();
    } else {
        setEnvironmentData(WORKER_STARTED, 'true');

        // Start the server state manager.
        const stateManager = new ServerStateManager((reader, writer) => createConnection(reader, writer, {}));
        stateManager.run();
    }
}

process.on('uncaughtException', (err) => {
    console.error('Uncaught exception in worker:', err);
    process.exit(10); // Exit the worker process
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled rejection in worker:', reason);
    process.exit(11); // Exit the worker process
});
