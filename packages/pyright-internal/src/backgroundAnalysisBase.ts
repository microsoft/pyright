/*
 * backgroundAnalysisBase.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * run analyzer from background thread
 */

import { CancellationToken, Disposable } from 'vscode-languageserver';
import { MessageChannel, MessagePort, Worker, parentPort, threadId, workerData } from 'worker_threads';

import {
    AnalysisCompleteCallback,
    AnalysisResults,
    RequiringAnalysisCount,
    analyzeProgram,
    nullCallback,
} from './analyzer/analysis';
import { InvalidatedReason } from './analyzer/backgroundAnalysisProgram';
import { ImportResolver } from './analyzer/importResolver';
import { OpenFileOptions, Program } from './analyzer/program';
import {
    BackgroundThreadBase,
    InitializationData,
    LogData,
    deserialize,
    getBackgroundWaiter,
    run,
    serialize,
} from './backgroundThreadBase';
import {
    OperationCanceledException,
    getCancellationTokenId,
    throwIfCancellationRequested,
} from './common/cancellationUtils';
import { ConfigOptions } from './common/configOptions';
import { ConsoleInterface, LogLevel, log } from './common/console';
import * as debug from './common/debug';
import { Diagnostic } from './common/diagnostic';
import { FileDiagnostics } from './common/diagnosticSink';
import { disposeCancellationToken, getCancellationTokenFromId } from './common/fileBasedCancellationUtils';
import { Host, HostKind } from './common/host';
import { LogTracker } from './common/logTracker';
import { ServiceProvider } from './common/serviceProvider';
import { Range } from './common/textRange';
import { Uri } from './common/uri/uri';
import { ProgramView } from './common/extensibility';

export interface IBackgroundAnalysis extends Disposable {
    setProgramView(program: Program): void;
    setCompletionCallback(callback?: AnalysisCompleteCallback): void;
    setImportResolver(importResolver: ImportResolver): void;
    setConfigOptions(configOptions: ConfigOptions): void;
    setTrackedFiles(fileUris: Uri[]): void;
    setAllowedThirdPartyImports(importNames: string[]): void;
    ensurePartialStubPackages(executionRoot: string | undefined): void;
    setFileOpened(fileUri: Uri, version: number | null, contents: string, options: OpenFileOptions): void;
    updateChainedUri(fileUri: Uri, chainedUri: Uri | undefined): void;
    setFileClosed(fileUri: Uri, isTracked?: boolean): void;
    addInterimFile(fileUri: Uri): void;
    markAllFilesDirty(evenIfContentsAreSame: boolean): void;
    markFilesDirty(fileUris: Uri[], evenIfContentsAreSame: boolean): void;
    startAnalysis(token: CancellationToken): void;
    analyzeFile(fileUri: Uri, token: CancellationToken): Promise<boolean>;
    analyzeFileAndGetDiagnostics(fileUri: Uri, token: CancellationToken): Promise<Diagnostic[]>;
    getDiagnosticsForRange(fileUri: Uri, range: Range, token: CancellationToken): Promise<Diagnostic[]>;
    writeTypeStub(
        targetImportPath: Uri,
        targetIsSingleFile: boolean,
        stubPath: Uri,
        token: CancellationToken
    ): Promise<any>;
    invalidateAndForceReanalysis(reason: InvalidatedReason): void;
    restart(): void;
    shutdown(): void;
}

export class BackgroundAnalysisBase implements IBackgroundAnalysis {
    // This map tracks pending analysis requests and their associated cancellation tokens.
    // When analysis is completed or cancelled, the token will be disposed.
    private readonly _analysisCancellationMap = new Map<string, CancellationToken>();

    private _worker: Worker | undefined;
    private _onAnalysisCompletion: AnalysisCompleteCallback = nullCallback;
    private _messageChannel: MessageChannel;

    protected program: ProgramView | undefined;

    protected constructor(protected console: ConsoleInterface) {
        // Don't allow instantiation of this type directly.

        // Create a message channel for handling 'analysis' or 'background' type results.
        // The other side of this channel will be sent to the BG thread for sending responses.
        this._messageChannel = new MessageChannel();
        this._messageChannel.port1.on('message', (msg: BackgroundResponse) => this.handleBackgroundResponse(msg));
    }

    dispose() {
        if (this._messageChannel) {
            this._messageChannel.port1.close();
            this._messageChannel.port2.close();
        }
        if (this._worker) {
            this._worker.terminate();
        }
    }

    setProgramView(programView: Program) {
        this.program = programView;
    }

    setCompletionCallback(callback?: AnalysisCompleteCallback) {
        this._onAnalysisCompletion = callback ?? nullCallback;
    }

    setImportResolver(importResolver: ImportResolver) {
        this.enqueueRequest({ requestType: 'setImportResolver', data: serialize(importResolver.host.kind) });
    }

    setConfigOptions(configOptions: ConfigOptions) {
        this.enqueueRequest({ requestType: 'setConfigOptions', data: serialize(configOptions) });
    }

    setTrackedFiles(fileUris: Uri[]) {
        this.enqueueRequest({ requestType: 'setTrackedFiles', data: serialize(fileUris) });
    }

    setAllowedThirdPartyImports(importNames: string[]) {
        this.enqueueRequest({ requestType: 'setAllowedThirdPartyImports', data: serialize(importNames) });
    }

    ensurePartialStubPackages(executionRoot: string | undefined) {
        this.enqueueRequest({ requestType: 'ensurePartialStubPackages', data: serialize({ executionRoot }) });
    }

    setFileOpened(fileUri: Uri, version: number | null, contents: string, options: OpenFileOptions) {
        this.enqueueRequest({
            requestType: 'setFileOpened',
            data: serialize({ fileUri, version, contents, options }),
        });
    }

    updateChainedUri(fileUri: Uri, chainedUri: Uri | undefined) {
        this.enqueueRequest({
            requestType: 'updateChainedFileUri',
            data: serialize({ fileUri, chainedUri }),
        });
    }

    setFileClosed(fileUri: Uri, isTracked?: boolean) {
        this.enqueueRequest({ requestType: 'setFileClosed', data: serialize({ fileUri, isTracked }) });
    }

    addInterimFile(fileUri: Uri) {
        this.enqueueRequest({ requestType: 'addInterimFile', data: serialize({ fileUri }) });
    }

    markAllFilesDirty(evenIfContentsAreSame: boolean) {
        this.enqueueRequest({ requestType: 'markAllFilesDirty', data: serialize({ evenIfContentsAreSame }) });
    }

    markFilesDirty(fileUris: Uri[], evenIfContentsAreSame: boolean) {
        this.enqueueRequest({
            requestType: 'markFilesDirty',
            data: serialize({ fileUris, evenIfContentsAreSame }),
        });
    }

    startAnalysis(token: CancellationToken) {
        const tokenId = getCancellationTokenId(token);
        if (tokenId) {
            this._analysisCancellationMap.set(tokenId, token);
        }

        this.enqueueRequest({
            requestType: 'analyze',
            data: serialize(token),
        });
    }

    async analyzeFile(fileUri: Uri, token: CancellationToken): Promise<boolean> {
        throwIfCancellationRequested(token);

        const { port1, port2 } = new MessageChannel();
        const waiter = getBackgroundWaiter<boolean>(port1);

        const cancellationId = getCancellationTokenId(token);
        this.enqueueRequest({
            requestType: 'analyzeFile',
            data: serialize({ fileUri, cancellationId }),
            port: port2,
        });

        const result = await waiter;

        port2.close();
        port1.close();

        return result;
    }

    async analyzeFileAndGetDiagnostics(fileUri: Uri, token: CancellationToken): Promise<Diagnostic[]> {
        throwIfCancellationRequested(token);

        const { port1, port2 } = new MessageChannel();
        const waiter = getBackgroundWaiter<Diagnostic[]>(port1);

        const cancellationId = getCancellationTokenId(token);
        this.enqueueRequest({
            requestType: 'analyzeFileAndGetDiagnostics',
            data: serialize({ fileUri, cancellationId }),
            port: port2,
        });

        const result = await waiter;

        port2.close();
        port1.close();

        return convertDiagnostics(result);
    }

    async getDiagnosticsForRange(fileUri: Uri, range: Range, token: CancellationToken): Promise<Diagnostic[]> {
        throwIfCancellationRequested(token);

        const { port1, port2 } = new MessageChannel();
        const waiter = getBackgroundWaiter<Diagnostic[]>(port1);

        const cancellationId = getCancellationTokenId(token);
        this.enqueueRequest({
            requestType: 'getDiagnosticsForRange',
            data: serialize({ fileUri, range, cancellationId }),
            port: port2,
        });

        const result = await waiter;

        port2.close();
        port1.close();

        return convertDiagnostics(result);
    }

    async writeTypeStub(
        targetImportPath: Uri,
        targetIsSingleFile: boolean,
        stubPath: Uri,
        token: CancellationToken
    ): Promise<any> {
        throwIfCancellationRequested(token);

        const { port1, port2 } = new MessageChannel();
        const waiter = getBackgroundWaiter(port1);

        const cancellationId = getCancellationTokenId(token);
        this.enqueueRequest({
            requestType: 'writeTypeStub',
            data: serialize({
                targetImportPath,
                targetIsSingleFile,
                stubPath,
                cancellationId,
            }),
            port: port2,
        });

        await waiter;

        port2.close();
        port1.close();
    }

    invalidateAndForceReanalysis(reason: InvalidatedReason) {
        this.enqueueRequest({ requestType: 'invalidateAndForceReanalysis', data: serialize({ reason }) });
    }

    restart() {
        this.enqueueRequest({ requestType: 'restart', data: null });
    }

    shutdown(): void {
        if (this._worker) {
            this.enqueueRequest({ requestType: 'shutdown', data: null });
        }
    }

    protected setup(worker: Worker) {
        this._worker = worker;

        // global channel to communicate from BG channel to main thread.
        worker.on('message', (msg: BackgroundResponse) => this.onMessage(msg));

        // this will catch any exception thrown from background thread,
        // print log and ignore exception
        worker.on('error', (msg) => {
            this.log(LogLevel.Error, `Error occurred on background thread: ${JSON.stringify(msg)}`);
        });

        worker.on('exit', (code) => {
            this.log(LogLevel.Log, `Background thread exited with code: ${code}`);
        });

        // Send the port to the other side for use in sending responses. It can only be sent once cause after it's transferred
        // it's not usable anymore.
        this.enqueueRequest({ requestType: 'start', data: '', port: this._messageChannel.port2 });
    }

    protected onMessage(msg: BackgroundResponse) {
        switch (msg.requestType) {
            case 'log': {
                const logData = deserialize<LogData>(msg.data);
                this.log(logData.level, logData.message);
                break;
            }

            case 'analysisResult': {
                // Change in diagnostics due to host such as file closed rather than
                // analyzing files.
                this._onAnalysisCompletion(convertAnalysisResults(deserialize(msg.data)));
                break;
            }

            default:
                debug.fail(`${msg.requestType} is not expected. Message structure: ${JSON.stringify(msg)}`);
        }
    }

    protected enqueueRequest(request: BackgroundRequest) {
        if (this._worker) {
            this._worker.postMessage(request, request.port ? [request.port] : undefined);
        }
    }

    protected log(level: LogLevel, msg: string) {
        log(this.console, level, msg);
    }

    protected handleBackgroundResponse(msg: BackgroundResponse) {
        switch (msg.requestType) {
            case 'analysisResult': {
                this._onAnalysisCompletion(convertAnalysisResults(deserialize(msg.data)));
                break;
            }

            case 'analysisPaused': {
                // Analysis request has completed, but there is more to
                // analyze, so queue another message to resume later.
                this.enqueueRequest({
                    requestType: 'resumeAnalysis',
                    data: serialize(msg.data),
                });
                break;
            }

            case 'analysisDone': {
                if (!msg.data) {
                    break;
                }

                const token = this._analysisCancellationMap.get(msg.data);
                this._analysisCancellationMap.delete(msg.data);

                if (!token) {
                    break;
                }

                disposeCancellationToken(token);
                break;
            }

            default:
                debug.fail(`${msg.requestType} is not expected. Message structure: ${JSON.stringify(msg)}`);
        }
    }
}

export abstract class BackgroundAnalysisRunnerBase extends BackgroundThreadBase {
    private _configOptions: ConfigOptions;
    private _program: Program;
    private _responsePort: MessagePort | undefined;
    protected importResolver: ImportResolver;
    protected logTracker: LogTracker;
    protected isCaseSensitive = true;

    protected constructor(protected serviceProvider: ServiceProvider) {
        super(workerData as InitializationData, serviceProvider);

        // Stash the base directory into a global variable.
        const data = workerData as InitializationData;
        this.log(LogLevel.Info, `Background analysis(${threadId}) root directory: ${data.rootUri}`);
        this._configOptions = new ConfigOptions(Uri.parse(data.rootUri, serviceProvider));
        this.importResolver = this.createImportResolver(serviceProvider, this._configOptions, this.createHost());

        const console = this.getConsole();
        this.logTracker = new LogTracker(console, `BG(${threadId})`);

        this._program = new Program(
            this.importResolver,
            this._configOptions,
            serviceProvider,
            this.logTracker,
            undefined,
            data.serviceId
        );
    }

    get program(): Program {
        return this._program;
    }

    get responsePort(): MessagePort {
        debug.assert(this._responsePort !== undefined, 'BG thread was not started properly. No response port');
        return this._responsePort!;
    }

    start() {
        this.log(LogLevel.Info, `Background analysis(${threadId}) started`);

        // Get requests from main thread.
        parentPort?.on('message', this._onMessageWrapper.bind(this));
        parentPort?.on('error', (msg) => debug.fail(`failed ${msg}`));
        parentPort?.on('exit', (c) => {
            if (c !== 0) {
                debug.fail(`worker stopped with exit code ${c}`);
            }
        });
    }

    protected onMessage(msg: BackgroundRequest) {
        switch (msg.requestType) {
            case 'start': {
                // Take ownership of the port for sending responses. This should
                // have been provided in the 'start' message.
                this._responsePort = msg.port!;
                break;
            }
            case 'cacheUsageBuffer': {
                this.serviceProvider.cacheManager()?.handleCachedUsageBufferMessage(msg);
                break;
            }

            case 'analyze': {
                const token = deserialize(msg.data);
                this.handleAnalyze(this.responsePort, token);
                break;
            }

            case 'resumeAnalysis': {
                const token = getCancellationTokenFromId(deserialize(msg.data));
                this.handleResumeAnalysis(this.responsePort, token);
                break;
            }

            case 'analyzeFile': {
                run(() => {
                    const { fileUri, cancellationId } = deserialize(msg.data);
                    const token = getCancellationTokenFromId(cancellationId);

                    return this.handleAnalyzeFile(fileUri, token);
                }, msg.port!);
                break;
            }

            case 'analyzeFileAndGetDiagnostics': {
                run(() => {
                    const { fileUri, cancellationId } = deserialize(msg.data);
                    const token = getCancellationTokenFromId(cancellationId);

                    return this.handleAnalyzeFileAndGetDiagnostics(fileUri, token);
                }, msg.port!);
                break;
            }

            case 'getDiagnosticsForRange': {
                run(() => {
                    const { fileUri, range, cancellationId } = deserialize(msg.data);
                    const token = getCancellationTokenFromId(cancellationId);

                    return this.handleGetDiagnosticsForRange(fileUri, range, token);
                }, msg.port!);
                break;
            }

            case 'writeTypeStub': {
                run(() => {
                    const { targetImportPath, targetIsSingleFile, stubPath, cancellationId } = deserialize(msg.data);
                    const token = getCancellationTokenFromId(cancellationId);

                    this.handleWriteTypeStub(targetImportPath, targetIsSingleFile, stubPath, token);
                }, msg.port!);
                break;
            }

            case 'setImportResolver': {
                this.handleSetImportResolver(deserialize(msg.data));
                break;
            }

            case 'setConfigOptions': {
                this.handleSetConfigOptions(deserialize<ConfigOptions>(msg.data));
                break;
            }

            case 'setTrackedFiles': {
                this.handleSetTrackedFiles(deserialize(msg.data));
                break;
            }

            case 'setAllowedThirdPartyImports': {
                this.handleSetAllowedThirdPartyImports(deserialize(msg.data));
                break;
            }

            case 'ensurePartialStubPackages': {
                const { executionRoot } = deserialize(msg.data);
                this.handleEnsurePartialStubPackages(executionRoot);
                break;
            }

            case 'setFileOpened': {
                const { fileUri, version, contents, options } = deserialize(msg.data);
                this.handleSetFileOpened(fileUri, version, contents, options);
                break;
            }

            case 'updateChainedFileUri': {
                const { fileUri, chainedUri } = deserialize(msg.data);
                this.handleUpdateChainedFileUri(fileUri, chainedUri);
                break;
            }

            case 'setFileClosed': {
                const { fileUri, isTracked } = deserialize(msg.data);
                this.handleSetFileClosed(fileUri, isTracked);
                break;
            }

            case 'addInterimFile': {
                const { fileUri } = deserialize(msg.data);
                this.handleAddInterimFile(fileUri);
                break;
            }

            case 'markAllFilesDirty': {
                const { evenIfContentsAreSame } = deserialize(msg.data);
                this.handleMarkAllFilesDirty(evenIfContentsAreSame);
                break;
            }

            case 'markFilesDirty': {
                const { fileUris, evenIfContentsAreSame } = deserialize(msg.data);
                this.handleMarkFilesDirty(fileUris, evenIfContentsAreSame);
                break;
            }

            case 'invalidateAndForceReanalysis': {
                const { reason } = deserialize(msg.data);
                this.handleInvalidateAndForceReanalysis(reason);
                break;
            }

            case 'restart': {
                // recycle import resolver
                this.handleRestart();
                break;
            }

            case 'shutdown': {
                this.handleShutdown();
                break;
            }

            default: {
                debug.fail(`${msg.requestType} is not expected. Message structure: ${JSON.stringify(msg)}`);
            }
        }
    }

    protected abstract createHost(): Host;

    protected abstract createImportResolver(
        serviceProvider: ServiceProvider,
        options: ConfigOptions,
        host: Host
    ): ImportResolver;

    protected handleAnalyze(port: MessagePort, token: CancellationToken) {
        // Report files to analyze first.
        const requiringAnalysisCount = this.program.getFilesToAnalyzeCount();

        this.onAnalysisCompletion(port, {
            diagnostics: [],
            filesInProgram: this.program.getFileCount(),
            requiringAnalysisCount: requiringAnalysisCount,
            checkingOnlyOpenFiles: this.program.isCheckingOnlyOpenFiles(),
            fatalErrorOccurred: false,
            configParseErrorOccurred: false,
            elapsedTime: 0,
            reason: 'analysis',
        });

        this.handleResumeAnalysis(port, token);
    }

    protected handleResumeAnalysis(port: MessagePort, token: CancellationToken) {
        // Report results at the interval of the max analysis time.
        const maxTime = { openFilesTimeInMs: 50, noOpenFilesTimeInMs: 200 };
        const moreToAnalyze = analyzeProgram(
            this.program,
            maxTime,
            this._configOptions,
            (result) => this.onAnalysisCompletion(port, result),
            this.getConsole(),
            token
        );

        if (moreToAnalyze) {
            // There's more to analyze after we exceeded max time,
            // so report that we are paused. The foreground thread will
            // then queue up a message to resume the analysis.
            this._analysisPaused(port, token);
        } else {
            this.analysisDone(port, token);
        }
    }

    protected handleAnalyzeFile(fileUri: Uri, token: CancellationToken) {
        throwIfCancellationRequested(token);
        return this.program.analyzeFile(fileUri, token);
    }

    protected handleAnalyzeFileAndGetDiagnostics(fileUri: Uri, token: CancellationToken) {
        return this.program.analyzeFileAndGetDiagnostics(fileUri, token);
    }

    protected handleGetDiagnosticsForRange(fileUri: Uri, range: Range, token: CancellationToken) {
        throwIfCancellationRequested(token);
        return this.program.getDiagnosticsForRange(fileUri, range);
    }

    protected handleWriteTypeStub(
        targetImportPath: Uri,
        targetIsSingleFile: boolean,
        stubPath: Uri,
        token: CancellationToken
    ) {
        analyzeProgram(
            this.program,
            /* maxTime */ undefined,
            this._configOptions,
            nullCallback,
            this.getConsole(),
            token
        );

        this.program.writeTypeStub(targetImportPath, targetIsSingleFile, stubPath, token);
    }

    protected handleSetImportResolver(hostKind: HostKind) {
        this.importResolver = this.createImportResolver(
            this.getServiceProvider(),
            this._configOptions,
            this.createHost()
        );
        this.program.setImportResolver(this.importResolver);
    }

    protected handleSetConfigOptions(configOptions: ConfigOptions) {
        this._configOptions = configOptions;

        this.importResolver = this.createImportResolver(
            this.getServiceProvider(),
            this._configOptions,
            this.importResolver.host
        );
        this.program.setConfigOptions(this._configOptions);
        this.program.setImportResolver(this.importResolver);
    }

    protected handleSetTrackedFiles(fileUris: Uri[]) {
        const diagnostics = this.program.setTrackedFiles(fileUris);
        this._reportDiagnostics(diagnostics, this.program.getFilesToAnalyzeCount(), 0);
    }

    protected handleSetAllowedThirdPartyImports(importNames: string[]) {
        this.program.setAllowedThirdPartyImports(importNames);
    }

    protected handleEnsurePartialStubPackages(executionRoot: string | undefined) {
        const execEnv = this._configOptions
            .getExecutionEnvironments()
            .find((e) => e.root?.toString() === executionRoot);
        if (execEnv) {
            this.importResolver.ensurePartialStubPackages(execEnv);
        }
    }

    protected handleSetFileOpened(
        fileUri: Uri,
        version: number | null,
        contents: string,
        options: OpenFileOptions | undefined
    ) {
        this.program.setFileOpened(
            fileUri,
            version,
            contents,
            options
                ? {
                      ...options,
                      chainedFileUri: Uri.fromJsonObj(options?.chainedFileUri),
                  }
                : undefined
        );
    }

    protected handleUpdateChainedFileUri(fileUri: Uri, chainedFileUri: Uri | undefined) {
        this.program.updateChainedUri(fileUri, chainedFileUri);
    }

    protected handleSetFileClosed(fileUri: Uri, isTracked: boolean | undefined) {
        const diagnostics = this.program.setFileClosed(fileUri, isTracked);
        this._reportDiagnostics(diagnostics, this.program.getFilesToAnalyzeCount(), 0);
    }

    protected handleAddInterimFile(fileUri: Uri) {
        this.program.addInterimFile(fileUri);
    }

    protected handleMarkFilesDirty(fileUris: Uri[], evenIfContentsAreSame: boolean) {
        this.program.markFilesDirty(fileUris, evenIfContentsAreSame);
    }

    protected handleMarkAllFilesDirty(evenIfContentsAreSame: boolean) {
        this.program.markAllFilesDirty(evenIfContentsAreSame);
    }

    protected handleInvalidateAndForceReanalysis(reason: InvalidatedReason) {
        // Make sure the import resolver doesn't have invalid
        // cached entries.
        this.importResolver.invalidateCache();

        // Mark all files with one or more errors dirty.
        this.program.markAllFilesDirty(/* evenIfContentsAreSame */ true);
    }

    protected handleRestart() {
        this.importResolver = this.createImportResolver(
            this.getServiceProvider(),
            this._configOptions,
            this.importResolver.host
        );
        this.program.setImportResolver(this.importResolver);
    }

    protected override handleShutdown() {
        this._program.dispose();
        super.handleShutdown();
    }

    protected analysisDone(port: MessagePort, token: CancellationToken) {
        port.postMessage({ requestType: 'analysisDone', data: getCancellationTokenId(token) });
    }

    protected onAnalysisCompletion(port: MessagePort, result: AnalysisResults) {
        // Result URIs can't be sent in current form as they contain methods on
        // them. This causes a DataCloneError when posting.
        // See https://stackoverflow.com/questions/68467946/datacloneerror-the-object-could-not-be-cloned-firefox-browser
        // We turn them back into JSON so we can use Uri.fromJsonObj on the other side.
        port.postMessage({ requestType: 'analysisResult', data: serialize(result) });
    }

    private _onMessageWrapper(msg: BackgroundRequest) {
        try {
            return this.onMessage(msg);
        } catch (e: any) {
            // Don't crash the worker, just send an exception or cancel message
            this.log(LogLevel.Log, `Background analysis exception leak: ${e}`);

            if (OperationCanceledException.is(e)) {
                parentPort?.postMessage({ kind: 'cancelled', data: e.message });
                return;
            }

            parentPort?.postMessage({
                kind: 'failed',
                data: `Exception: for msg ${msg.requestType}: ${e.message} in ${e.stack}`,
            });
        }
    }

    private _reportDiagnostics(
        diagnostics: FileDiagnostics[],
        requiringAnalysisCount: RequiringAnalysisCount,
        elapsedTime: number
    ) {
        if (parentPort) {
            this.onAnalysisCompletion(parentPort, {
                diagnostics,
                filesInProgram: this.program.getFileCount(),
                requiringAnalysisCount: requiringAnalysisCount,
                checkingOnlyOpenFiles: this.program.isCheckingOnlyOpenFiles(),
                fatalErrorOccurred: false,
                configParseErrorOccurred: false,
                elapsedTime,
                reason: 'tracking',
            });
        }
    }

    private _analysisPaused(port: MessagePort, token: CancellationToken) {
        port.postMessage({ requestType: 'analysisPaused', data: getCancellationTokenId(token) });
    }
}

function convertAnalysisResults(result: AnalysisResults): AnalysisResults {
    result.diagnostics = result.diagnostics.map((f: FileDiagnostics) => {
        return {
            fileUri: Uri.fromJsonObj(f.fileUri),
            version: f.version,
            diagnostics: convertDiagnostics(f.diagnostics),
        };
    });

    return result;
}

function convertDiagnostics(diagnostics: Diagnostic[]) {
    // Elements are typed as "any" since data crossing the process
    // boundary loses type info.
    return diagnostics.map<Diagnostic>((d: any) => {
        const diag = new Diagnostic(d.category, d.message, d.range, d.priority);
        if (d._actions) {
            for (const action of d._actions) {
                diag.addAction(action);
            }
        }

        if (d._rule) {
            diag.setRule(d._rule);
        }

        if (d._relatedInfo) {
            for (const info of d._relatedInfo) {
                diag.addRelatedInfo(info.message, info.uri, info.range);
            }
        }

        return diag;
    });
}

export type BackgroundRequestKind =
    | 'start'
    | 'analyze'
    | 'resumeAnalysis'
    | 'setConfigOptions'
    | 'setTrackedFiles'
    | 'setAllowedThirdPartyImports'
    | 'ensurePartialStubPackages'
    | 'setFileOpened'
    | 'updateChainedFileUri'
    | 'setFileClosed'
    | 'markAllFilesDirty'
    | 'markFilesDirty'
    | 'invalidateAndForceReanalysis'
    | 'restart'
    | 'getDiagnosticsForRange'
    | 'writeTypeStub'
    | 'setImportResolver'
    | 'shutdown'
    | 'addInterimFile'
    | 'analyzeFile'
    | 'analyzeFileAndGetDiagnostics'
    | 'cacheUsageBuffer';

export interface BackgroundRequest {
    requestType: BackgroundRequestKind;
    data: string | null;
    port?: MessagePort | undefined;
    sharedUsageBuffer?: SharedArrayBuffer;
}

export type BackgroundResponseKind = 'log' | 'analysisResult' | 'analysisPaused' | 'analysisDone';

export interface BackgroundResponse {
    requestType: BackgroundResponseKind;
    data: string | null;
}

export interface RefreshOptions {
    // No files/folders are added or removed. only changes.
    changesOnly: boolean;
}
