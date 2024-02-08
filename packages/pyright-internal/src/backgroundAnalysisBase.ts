/*
 * backgroundAnalysisBase.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * run analyzer from background thread
 */

import { CancellationToken } from 'vscode-languageserver';
import { MessageChannel, MessagePort, Worker, parentPort, threadId, workerData } from 'worker_threads';

import { AnalysisCompleteCallback, AnalysisResults, analyzeProgram, nullCallback } from './analyzer/analysis';
import { BackgroundAnalysisProgram, InvalidatedReason } from './analyzer/backgroundAnalysisProgram';
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
import { BasedConfigOptions, ConfigOptions } from './common/configOptions';
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

export class BackgroundAnalysisBase {
    private _worker: Worker | undefined;
    private _onAnalysisCompletion: AnalysisCompleteCallback = nullCallback;

    protected constructor(protected console: ConsoleInterface) {
        // Don't allow instantiation of this type directly.
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

    startAnalysis(program: BackgroundAnalysisProgram, token: CancellationToken) {
        this._startOrResumeAnalysis('analyze', program, token);
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
        this.enqueueRequest({ requestType: 'shutdown', data: null });
    }

    protected setup(worker: Worker) {
        this._worker = worker;

        // global channel to communicate from BG channel to main thread.
        worker.on('message', (msg: AnalysisResponse) => this.onMessage(msg));

        // this will catch any exception thrown from background thread,
        // print log and ignore exception
        worker.on('error', (msg) => {
            this.log(LogLevel.Error, `Error occurred on background thread: ${JSON.stringify(msg)}`);
        });
    }

    protected onMessage(msg: AnalysisResponse) {
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

    protected enqueueRequest(request: AnalysisRequest) {
        if (this._worker) {
            this._worker.postMessage(request, request.port ? [request.port] : undefined);
        }
    }

    protected log(level: LogLevel, msg: string) {
        log(this.console, level, msg);
    }

    protected handleAnalysisResponse(
        msg: AnalysisResponse,
        program: BackgroundAnalysisProgram,
        port1: MessagePort,
        port2: MessagePort,
        token: CancellationToken
    ) {
        switch (msg.requestType) {
            case 'analysisResult': {
                this._onAnalysisCompletion(convertAnalysisResults(deserialize(msg.data)));
                break;
            }

            case 'analysisPaused': {
                port2.close();
                port1.close();

                // Analysis request has completed, but there is more to
                // analyze, so queue another message to resume later.
                this._startOrResumeAnalysis('resumeAnalysis', program, token);
                break;
            }

            case 'analysisDone': {
                disposeCancellationToken(token);
                port2.close();
                port1.close();
                break;
            }

            default:
                debug.fail(`${msg.requestType} is not expected. Message structure: ${JSON.stringify(msg)}`);
        }
    }

    private _startOrResumeAnalysis(
        requestType: 'analyze' | 'resumeAnalysis',
        program: BackgroundAnalysisProgram,
        token: CancellationToken
    ) {
        const { port1, port2 } = new MessageChannel();

        // Handle response from background thread to main thread.
        port1.on('message', (msg: AnalysisResponse) => this.handleAnalysisResponse(msg, program, port1, port2, token));

        const cancellationId = getCancellationTokenId(token);
        this.enqueueRequest({ requestType, data: serialize(cancellationId), port: port2 });
    }
}

export abstract class BackgroundAnalysisRunnerBase extends BackgroundThreadBase {
    private _configOptions: ConfigOptions;
    private _program: Program;

    protected importResolver: ImportResolver;
    protected logTracker: LogTracker;
    protected isCaseSensitive = true;

    protected constructor(protected serviceProvider: ServiceProvider) {
        super(workerData as InitializationData, serviceProvider);

        // Stash the base directory into a global variable.
        const data = workerData as InitializationData;
        this.log(LogLevel.Info, `Background analysis(${threadId}) root directory: ${data.rootUri}`);
        this._configOptions = new BasedConfigOptions(Uri.parse(data.rootUri, serviceProvider.fs().isCaseSensitive));
        this.importResolver = this.createImportResolver(serviceProvider, this._configOptions, this.createHost());

        const console = this.getConsole();
        this.logTracker = new LogTracker(console, `BG(${threadId})`);

        this._program = new Program(this.importResolver, this._configOptions, serviceProvider, this.logTracker);
    }

    get program(): Program {
        return this._program;
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

    protected onMessage(msg: AnalysisRequest) {
        switch (msg.requestType) {
            case 'analyze': {
                const port = msg.port!;
                const data = deserialize(msg.data);
                const token = getCancellationTokenFromId(data);

                this.handleAnalyze(port, data, token);
                break;
            }

            case 'resumeAnalysis': {
                const port = msg.port!;
                const data = deserialize(msg.data);
                const token = getCancellationTokenFromId(data);

                this.handleResumeAnalysis(port, data, token);
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
                this.handleUpdateChainedfileUri(fileUri, chainedUri);
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

    protected handleAnalyze(port: MessagePort, cancellationId: string, token: CancellationToken) {
        // Report files to analyze first.
        const filesLeftToAnalyze = this.program.getFilesToAnalyzeCount();

        this.onAnalysisCompletion(port, {
            diagnostics: [],
            filesInProgram: this.program.getFileCount(),
            filesRequiringAnalysis: filesLeftToAnalyze,
            checkingOnlyOpenFiles: this.program.isCheckingOnlyOpenFiles(),
            fatalErrorOccurred: false,
            configParseErrorOccurred: false,
            elapsedTime: 0,
        });

        this.handleResumeAnalysis(port, cancellationId, token);
    }

    protected handleResumeAnalysis(port: MessagePort, cancellationId: string, token: CancellationToken) {
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
            this._analysisPaused(port, cancellationId);
        } else {
            this.analysisDone(port, cancellationId);
        }
    }

    protected handleAnalyzeFile(fileUri: Uri, token: CancellationToken) {
        throwIfCancellationRequested(token);
        return this.program.analyzeFile(fileUri, token);
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
        const execEnv = this._configOptions.getExecutionEnvironments().find((e) => e.root === executionRoot);
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

    protected handleUpdateChainedfileUri(fileUri: Uri, chainedfileUri: Uri | undefined) {
        this.program.updateChainedUri(fileUri, chainedfileUri);
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

    protected analysisDone(port: MessagePort, cancellationId: string) {
        port.postMessage({ requestType: 'analysisDone', data: cancellationId });
    }

    protected onAnalysisCompletion(port: MessagePort, result: AnalysisResults) {
        // Result URIs can't be sent in current form as they contain methods on
        // them. This causes a DataCloneError when posting.
        // See https://stackoverflow.com/questions/68467946/datacloneerror-the-object-could-not-be-cloned-firefox-browser
        // We turn them back into JSON so we can use Uri.fromJsonObj on the other side.
        port.postMessage({ requestType: 'analysisResult', data: serialize(result) });
    }

    private _onMessageWrapper(msg: AnalysisRequest) {
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

    private _reportDiagnostics(diagnostics: FileDiagnostics[], filesLeftToAnalyze: number, elapsedTime: number) {
        if (parentPort) {
            this.onAnalysisCompletion(parentPort, {
                diagnostics,
                filesInProgram: this.program.getFileCount(),
                filesRequiringAnalysis: filesLeftToAnalyze,
                checkingOnlyOpenFiles: this.program.isCheckingOnlyOpenFiles(),
                fatalErrorOccurred: false,
                configParseErrorOccurred: false,
                elapsedTime,
            });
        }
    }

    private _analysisPaused(port: MessagePort, cancellationId: string) {
        port.postMessage({ requestType: 'analysisPaused', data: cancellationId });
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

export type AnalysisRequestKind =
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
    | 'analyzeFile';

export interface AnalysisRequest {
    requestType: AnalysisRequestKind;
    data: string | null;
    port?: MessagePort | undefined;
}

export type AnalysisResponseKind = 'log' | 'analysisResult' | 'analysisPaused' | 'analysisDone';

export interface AnalysisResponse {
    requestType: AnalysisResponseKind;
    data: string | null;
}

export interface RefreshOptions {
    // No files/folders are added or removed. only changes.
    changesOnly: boolean;
}
