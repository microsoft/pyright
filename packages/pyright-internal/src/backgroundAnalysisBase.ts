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
import { ImportResolver } from './analyzer/importResolver';
import { OpenFileOptions, Program, SourceFileFactory } from './analyzer/program';
import {
    BackgroundThreadBase,
    InitializationData,
    LogData,
    createConfigOptionsFrom,
    getBackgroundWaiter,
    run,
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
import { Extensions } from './common/extensibility';
import { disposeCancellationToken, getCancellationTokenFromId } from './common/fileBasedCancellationUtils';
import { FileSystem } from './common/fileSystem';
import { Host, HostKind } from './common/host';
import { LogTracker } from './common/logTracker';
import { Range } from './common/textRange';
import { BackgroundAnalysisProgram, InvalidatedReason } from './analyzer/backgroundAnalysisProgram';

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
        this.enqueueRequest({ requestType: 'setImportResolver', data: importResolver.host.kind });
    }

    setConfigOptions(configOptions: ConfigOptions) {
        this.enqueueRequest({ requestType: 'setConfigOptions', data: configOptions });
    }

    setTrackedFiles(filePaths: string[]) {
        this.enqueueRequest({ requestType: 'setTrackedFiles', data: filePaths });
    }

    setAllowedThirdPartyImports(importNames: string[]) {
        this.enqueueRequest({ requestType: 'setAllowedThirdPartyImports', data: importNames });
    }

    ensurePartialStubPackages(executionRoot: string | undefined) {
        this.enqueueRequest({ requestType: 'ensurePartialStubPackages', data: { executionRoot } });
    }

    setFileOpened(filePath: string, version: number | null, contents: string, options: OpenFileOptions) {
        this.enqueueRequest({
            requestType: 'setFileOpened',
            data: { filePath, version, contents, options },
        });
    }

    updateChainedFilePath(filePath: string, chainedFilePath: string | undefined) {
        this.enqueueRequest({
            requestType: 'updateChainedFilePath',
            data: { filePath, chainedFilePath },
        });
    }

    setFileClosed(filePath: string, isTracked?: boolean) {
        this.enqueueRequest({ requestType: 'setFileClosed', data: { filePath, isTracked } });
    }

    addInterimFile(filePath: string) {
        this.enqueueRequest({ requestType: 'addInterimFile', data: { filePath } });
    }

    markAllFilesDirty(evenIfContentsAreSame: boolean) {
        this.enqueueRequest({ requestType: 'markAllFilesDirty', data: { evenIfContentsAreSame } });
    }

    markFilesDirty(filePaths: string[], evenIfContentsAreSame: boolean) {
        this.enqueueRequest({
            requestType: 'markFilesDirty',
            data: { filePaths, evenIfContentsAreSame },
        });
    }

    startAnalysis(program: BackgroundAnalysisProgram, token: CancellationToken) {
        this._startOrResumeAnalysis('analyze', program, token);
    }

    async getDiagnosticsForRange(filePath: string, range: Range, token: CancellationToken): Promise<Diagnostic[]> {
        throwIfCancellationRequested(token);

        const { port1, port2 } = new MessageChannel();
        const waiter = getBackgroundWaiter<Diagnostic[]>(port1);

        const cancellationId = getCancellationTokenId(token);
        this.enqueueRequest({
            requestType: 'getDiagnosticsForRange',
            data: { filePath, range, cancellationId },
            port: port2,
        });

        const result = await waiter;

        port2.close();
        port1.close();

        return convertDiagnostics(result);
    }

    async writeTypeStub(
        targetImportPath: string,
        targetIsSingleFile: boolean,
        stubPath: string,
        token: CancellationToken
    ): Promise<any> {
        throwIfCancellationRequested(token);

        const { port1, port2 } = new MessageChannel();
        const waiter = getBackgroundWaiter(port1);

        const cancellationId = getCancellationTokenId(token);
        this.enqueueRequest({
            requestType: 'writeTypeStub',
            data: { targetImportPath, targetIsSingleFile, stubPath, cancellationId },
            port: port2,
        });

        await waiter;

        port2.close();
        port1.close();
    }

    invalidateAndForceReanalysis(reason: InvalidatedReason) {
        this.enqueueRequest({ requestType: 'invalidateAndForceReanalysis', data: { reason } });
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
                const logData = msg.data as LogData;
                this.log(logData.level, logData.message);
                break;
            }

            case 'analysisResult': {
                // Change in diagnostics due to host such as file closed rather than
                // analyzing files.
                this._onAnalysisCompletion(convertAnalysisResults(msg.data));
                break;
            }

            default:
                debug.fail(`${msg.requestType} is not expected`);
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
                this._onAnalysisCompletion(convertAnalysisResults(msg.data));
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
                debug.fail(`${msg.requestType} is not expected`);
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
        this.enqueueRequest({ requestType, data: cancellationId, port: port2 });
    }
}

export abstract class BackgroundAnalysisRunnerBase extends BackgroundThreadBase {
    private _configOptions: ConfigOptions;
    private _program: Program;

    protected importResolver: ImportResolver;
    protected logTracker: LogTracker;

    protected constructor(fileSystem?: FileSystem, sourceFileFactory?: SourceFileFactory) {
        super(workerData as InitializationData, fileSystem);

        // Stash the base directory into a global variable.
        const data = workerData as InitializationData;
        this.log(LogLevel.Info, `Background analysis(${threadId}) root directory: ${data.rootDirectory}`);

        this._configOptions = new ConfigOptions(data.rootDirectory);
        this.importResolver = this.createImportResolver(this.fs, this._configOptions, this.createHost());

        const console = this.getConsole();
        this.logTracker = new LogTracker(console, `BG(${threadId})`);

        this._program = new Program(
            this.importResolver,
            this._configOptions,
            console,
            this.logTracker,
            sourceFileFactory
        );

        // Create the extensions bound to the program for this background thread
        Extensions.createProgramExtensions(this._program, {
            addInterimFile: (filePath: string) => this._program.addInterimFile(filePath),
            setFileOpened: (filePath, version, contents, ipythonMode, chainedFilePath, realFilePath) => {
                this._program.setFileOpened(filePath, version, contents, {
                    isTracked: this._program.owns(filePath),
                    ipythonMode,
                    chainedFilePath,
                    realFilePath,
                });
            },
            updateOpenFileContents: (filePath, version, contents, ipythonMode, realFilePath) => {
                this._program.setFileOpened(filePath, version, contents, {
                    isTracked: this._program.owns(filePath),
                    ipythonMode,
                    chainedFilePath: undefined,
                    realFilePath,
                });
            },
        });
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
        this.log(LogLevel.Log, `Background analysis message: ${msg.requestType}`);

        switch (msg.requestType) {
            case 'analyze': {
                const port = msg.port!;
                const token = getCancellationTokenFromId(msg.data);

                this.handleAnalyze(port, msg.data, token);
                break;
            }

            case 'resumeAnalysis': {
                const port = msg.port!;
                const token = getCancellationTokenFromId(msg.data);

                this.handleResumeAnalysis(port, msg.data, token);
                break;
            }

            case 'getDiagnosticsForRange': {
                run(() => {
                    const { filePath, range, cancellationId } = msg.data;
                    const token = getCancellationTokenFromId(cancellationId);

                    return this.handleGetDiagnosticsForRange(filePath, range, token);
                }, msg.port!);
                break;
            }

            case 'writeTypeStub': {
                run(() => {
                    const { targetImportPath, targetIsSingleFile, stubPath, cancellationId } = msg.data;
                    const token = getCancellationTokenFromId(cancellationId);

                    this.handleWriteTypeStub(targetImportPath, targetIsSingleFile, stubPath, token);
                }, msg.port!);
                break;
            }

            case 'setImportResolver': {
                this.handleSetImportResolver(msg.data);
                break;
            }

            case 'setConfigOptions': {
                this.handleSetConfigOptions(createConfigOptionsFrom(msg.data));
                break;
            }

            case 'setTrackedFiles': {
                this.handleSetTrackedFiles(msg.data);
                break;
            }

            case 'setAllowedThirdPartyImports': {
                this.handleSetAllowedThirdPartyImports(msg.data);
                break;
            }

            case 'ensurePartialStubPackages': {
                const { executionRoot } = msg.data;
                this.handleEnsurePartialStubPackages(executionRoot);
                break;
            }

            case 'setFileOpened': {
                const { filePath, version, contents, options } = msg.data;
                this.handleSetFileOpened(filePath, version, contents, options);
                break;
            }

            case 'updateChainedFilePath': {
                const { filePath, chainedFilePath } = msg.data;
                this.handleUpdateChainedFilePath(filePath, chainedFilePath);
                break;
            }

            case 'setFileClosed': {
                const { filePath, isTracked } = msg.data;
                this.handleSetFileClosed(filePath, isTracked);
                break;
            }

            case 'addInterimFile': {
                const { filePath } = msg.data;
                this.handleAddInterimFile(filePath);
                break;
            }

            case 'markAllFilesDirty': {
                const { evenIfContentsAreSame } = msg.data;
                this.handleMarkAllFilesDirty(evenIfContentsAreSame);
                break;
            }

            case 'markFilesDirty': {
                const { filePaths, evenIfContentsAreSame } = msg.data;
                this.handleMarkFilesDirty(filePaths, evenIfContentsAreSame);
                break;
            }

            case 'invalidateAndForceReanalysis': {
                const { reason } = msg.data;
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
                debug.fail(`${msg.requestType} is not expected`);
            }
        }
    }

    protected abstract createHost(): Host;

    protected abstract createImportResolver(fs: FileSystem, options: ConfigOptions, host: Host): ImportResolver;

    protected handleAnalyze(port: MessagePort, cancellationId: string, token: CancellationToken) {
        // Report files to analyze first.
        const filesLeftToAnalyze = this.program.getFilesToAnalyzeCount();

        this._onAnalysisCompletion(port, {
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
            (result) => this._onAnalysisCompletion(port, result),
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

    protected handleGetDiagnosticsForRange(filePath: string, range: Range, token: CancellationToken) {
        throwIfCancellationRequested(token);
        return this.program.getDiagnosticsForRange(filePath, range);
    }

    protected handleWriteTypeStub(
        targetImportPath: string,
        targetIsSingleFile: boolean,
        stubPath: string,
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
        this.importResolver = this.createImportResolver(this.fs, this._configOptions, this.createHost());
        this.program.setImportResolver(this.importResolver);
    }

    protected handleSetConfigOptions(configOptions: ConfigOptions) {
        this._configOptions = configOptions;

        this.importResolver = this.createImportResolver(this.fs, this._configOptions, this.importResolver.host);
        this.program.setConfigOptions(this._configOptions);
        this.program.setImportResolver(this.importResolver);
    }

    protected handleSetTrackedFiles(filePaths: string[]) {
        const diagnostics = this.program.setTrackedFiles(filePaths);
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
        filePath: string,
        version: number | null,
        contents: string,
        options: OpenFileOptions | undefined
    ) {
        this.program.setFileOpened(filePath, version, contents, options);
    }

    protected handleUpdateChainedFilePath(filePath: string, chainedFilePath: string | undefined) {
        this.program.updateChainedFilePath(filePath, chainedFilePath);
    }

    protected handleSetFileClosed(filePath: string, isTracked: boolean | undefined) {
        const diagnostics = this.program.setFileClosed(filePath, isTracked);
        this._reportDiagnostics(diagnostics, this.program.getFilesToAnalyzeCount(), 0);
    }

    protected handleAddInterimFile(filePath: string) {
        this.program.addInterimFile(filePath);
    }

    protected handleMarkFilesDirty(filePaths: string[], evenIfContentsAreSame: boolean) {
        this.program.markFilesDirty(filePaths, evenIfContentsAreSame);
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
        this.importResolver = this.createImportResolver(this.fs, this._configOptions, this.importResolver.host);
        this.program.setImportResolver(this.importResolver);
    }

    protected override handleShutdown() {
        this._program.dispose();
        Extensions.destroyProgramExtensions(this._program.id);
        super.handleShutdown();
    }

    protected analysisDone(port: MessagePort, cancellationId: string) {
        port.postMessage({ requestType: 'analysisDone', data: cancellationId });
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
            this._onAnalysisCompletion(parentPort, {
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

    private _onAnalysisCompletion(port: MessagePort, result: AnalysisResults) {
        port.postMessage({ requestType: 'analysisResult', data: result });
    }

    private _analysisPaused(port: MessagePort, cancellationId: string) {
        port.postMessage({ requestType: 'analysisPaused', data: cancellationId });
    }
}

function convertAnalysisResults(result: AnalysisResults): AnalysisResults {
    result.diagnostics = result.diagnostics.map((f: FileDiagnostics) => {
        return {
            filePath: f.filePath,
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
                diag.addRelatedInfo(info.message, info.filePath, info.range);
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
    | 'updateChainedFilePath'
    | 'setFileClosed'
    | 'markAllFilesDirty'
    | 'markFilesDirty'
    | 'invalidateAndForceReanalysis'
    | 'restart'
    | 'getDiagnosticsForRange'
    | 'writeTypeStub'
    | 'setImportResolver'
    | 'shutdown'
    | 'addInterimFile';

export interface AnalysisRequest {
    requestType: AnalysisRequestKind;
    data: any;
    port?: MessagePort | undefined;
}

export type AnalysisResponseKind = 'log' | 'analysisResult' | 'analysisPaused' | 'analysisDone';

export interface AnalysisResponse {
    requestType: AnalysisResponseKind;
    data: any;
}

export interface RefreshOptions {
    // No files/folders are added or removed. only changes.
    changesOnly: boolean;
}
