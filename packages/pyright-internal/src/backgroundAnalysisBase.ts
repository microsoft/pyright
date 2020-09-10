/*
 * backgroundAnalysisBase.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * run analyzer from background thread
 */

import { CancellationToken } from 'vscode-languageserver/node';
import { MessageChannel, MessagePort, parentPort, threadId, Worker, workerData } from 'worker_threads';

import { AnalysisCompleteCallback, AnalysisResults, analyzeProgram, nullCallback } from './analyzer/analysis';
import { ImportResolver } from './analyzer/importResolver';
import { Indices, Program } from './analyzer/program';
import {
    BackgroundThreadBase,
    createConfigOptionsFrom,
    getBackgroundWaiter,
    LogData,
    run,
} from './backgroundThreadBase';
import {
    disposeCancellationToken,
    getCancellationTokenFromId,
    getCancellationTokenId,
    throwIfCancellationRequested,
} from './common/cancellationUtils';
import { ConfigOptions } from './common/configOptions';
import { ConsoleInterface, log, LogLevel } from './common/console';
import * as debug from './common/debug';
import { Diagnostic } from './common/diagnostic';
import { FileDiagnostics } from './common/diagnosticSink';
import { LanguageServiceExtension } from './common/extensibility';
import { FileSystem } from './common/fileSystem';
import { Range } from './common/textRange';
import { IndexResults } from './languageService/documentSymbolProvider';

export class BackgroundAnalysisBase {
    private _worker: Worker | undefined;
    private _onAnalysisCompletion: AnalysisCompleteCallback = nullCallback;

    protected constructor(protected console: ConsoleInterface) {
        // Don't allow instantiation of this type directly.
    }

    protected setup(worker: Worker) {
        this._worker = worker;

        // global channel to communicate from BG channel to main thread.
        worker.on('message', (msg: AnalysisResponse) => {
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
        });

        // this will catch any exception thrown from background thread,
        // print log and ignore exception
        worker.on('error', (msg) => {
            this.log(LogLevel.Error, `Error occurred on background thread: ${JSON.stringify(msg)}`);
        });
    }

    setCompletionCallback(callback?: AnalysisCompleteCallback) {
        this._onAnalysisCompletion = callback ?? nullCallback;
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

    setFileOpened(filePath: string, version: number | null, contents: string) {
        this.enqueueRequest({ requestType: 'setFileOpened', data: { filePath, version, contents } });
    }

    setFileClosed(filePath: string) {
        this.enqueueRequest({ requestType: 'setFileClosed', data: filePath });
    }

    markAllFilesDirty(evenIfContentsAreSame: boolean) {
        this.enqueueRequest({ requestType: 'markAllFilesDirty', data: evenIfContentsAreSame });
    }

    markFilesDirty(filePaths: string[], evenIfContentsAreSame: boolean) {
        this.enqueueRequest({ requestType: 'markFilesDirty', data: { filePaths, evenIfContentsAreSame } });
    }

    startAnalysis(indices: Indices | undefined, token: CancellationToken) {
        this._startOrResumeAnalysis('analyze', indices, token);
    }

    private _startOrResumeAnalysis(
        requestType: 'analyze' | 'resumeAnalysis',
        indices: Indices | undefined,
        token: CancellationToken
    ) {
        const { port1, port2 } = new MessageChannel();

        // Handle response from background thread to main thread.
        port1.on('message', (msg: AnalysisResponse) => {
            switch (msg.requestType) {
                case 'analysisResult': {
                    this._onAnalysisCompletion(convertAnalysisResults(msg.data));
                    break;
                }

                case 'analysisPaused': {
                    disposeCancellationToken(token);
                    port2.close();
                    port1.close();

                    // Analysis request has completed, but there is more to
                    // analyze, so queue another message to resume later.
                    this._startOrResumeAnalysis('resumeAnalysis', indices, token);
                    break;
                }

                case 'indexResult': {
                    const { path, indexResults } = msg.data;
                    indices?.setWorkspaceIndex(path, indexResults);
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
        });

        const cancellationId = getCancellationTokenId(token);
        this.enqueueRequest({ requestType, data: cancellationId, port: port2 });
    }

    startIndexing(configOptions: ConfigOptions, indices: Indices) {
        /* noop */
    }

    refreshIndexing(configOptions: ConfigOptions, indices?: Indices) {
        /* noop */
    }

    cancelIndexing(configOptions: ConfigOptions) {
        /* noop */
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

    invalidateAndForceReanalysis() {
        this.enqueueRequest({ requestType: 'invalidateAndForceReanalysis', data: null });
    }

    restart() {
        this.enqueueRequest({ requestType: 'restart', data: null });
    }

    protected enqueueRequest(request: AnalysisRequest) {
        if (this._worker) {
            this._worker.postMessage(request, request.port ? [request.port] : undefined);
        }
    }

    protected log(level: LogLevel, msg: string) {
        log(this.console, level, msg);
    }
}

export class BackgroundAnalysisRunnerBase extends BackgroundThreadBase {
    private _configOptions: ConfigOptions;
    private _importResolver: ImportResolver;
    private _program: Program;

    get program(): Program {
        return this._program;
    }

    protected constructor(private _extension?: LanguageServiceExtension) {
        super(workerData as InitializationData);

        // Stash the base directory into a global variable.
        const data = workerData as InitializationData;
        this.log(LogLevel.Info, `Background analysis(${threadId}) root directory: ${data.rootDirectory}`);

        this._configOptions = new ConfigOptions(data.rootDirectory);
        this._importResolver = this.createImportResolver(this.fs, this._configOptions);
        this._program = new Program(
            this._importResolver,
            this._configOptions,
            this.getConsole(),
            this._extension,
            `BG(${threadId})`
        );
    }

    start() {
        this.log(LogLevel.Info, `Background analysis(${threadId}) started`);

        // Get requests from main thread.
        parentPort?.on('message', (msg: AnalysisRequest) => this.onMessage(msg));

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

                this._analyzeOneChunk(port, token, msg);
                break;
            }

            case 'resumeAnalysis': {
                const port = msg.port!;
                const token = getCancellationTokenFromId(msg.data);

                this._analyzeOneChunk(port, token, msg);
                break;
            }

            case 'getDiagnosticsForRange': {
                run(() => {
                    const { filePath, range, cancellationId } = msg.data;
                    const token = getCancellationTokenFromId(cancellationId);
                    throwIfCancellationRequested(token);

                    return this.program.getDiagnosticsForRange(filePath, range);
                }, msg.port!);
                break;
            }

            case 'writeTypeStub': {
                run(() => {
                    const { targetImportPath, targetIsSingleFile, stubPath, cancellationId } = msg.data;
                    const token = getCancellationTokenFromId(cancellationId);

                    analyzeProgram(
                        this.program,
                        undefined,
                        this._configOptions,
                        nullCallback,
                        this.getConsole(),
                        token
                    );
                    this.program.writeTypeStub(targetImportPath, targetIsSingleFile, stubPath, token);
                }, msg.port!);
                break;
            }

            case 'setConfigOptions': {
                this._configOptions = createConfigOptionsFrom(msg.data);
                this._importResolver = this.createImportResolver(this.fs, this._configOptions);
                this.program.setConfigOptions(this._configOptions);
                this.program.setImportResolver(this._importResolver);
                break;
            }

            case 'setTrackedFiles': {
                const diagnostics = this.program.setTrackedFiles(msg.data);
                this._reportDiagnostics(diagnostics, this.program.getFilesToAnalyzeCount(), 0);
                break;
            }

            case 'setAllowedThirdPartyImports': {
                this.program.setAllowedThirdPartyImports(msg.data);
                break;
            }

            case 'setFileOpened': {
                const { filePath, version, contents } = msg.data;
                this.program.setFileOpened(filePath, version, contents);
                break;
            }

            case 'setFileClosed': {
                const diagnostics = this.program.setFileClosed(msg.data);
                this._reportDiagnostics(diagnostics, this.program.getFilesToAnalyzeCount(), 0);
                break;
            }

            case 'markAllFilesDirty': {
                this.program.markAllFilesDirty(msg.data);
                break;
            }

            case 'markFilesDirty': {
                const { filePaths, evenIfContentsAreSame } = msg.data;
                this.program.markFilesDirty(filePaths, evenIfContentsAreSame);
                break;
            }

            case 'invalidateAndForceReanalysis': {
                // Make sure the import resolver doesn't have invalid
                // cached entries.
                this._importResolver.invalidateCache();

                // Mark all files with one or more errors dirty.
                this.program.markAllFilesDirty(true);
                break;
            }

            case 'restart': {
                // recycle import resolver
                this._importResolver = this.createImportResolver(this.fs, this._configOptions);
                this.program.setImportResolver(this._importResolver);
                break;
            }

            default: {
                debug.fail(`${msg.requestType} is not expected`);
            }
        }
    }

    private _analyzeOneChunk(port: MessagePort, token: CancellationToken, msg: AnalysisRequest) {
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
            this._analysisPaused(port, msg.data);
        } else {
            this.processIndexing(port, token);
            this._analysisDone(port, msg.data);
        }
    }

    protected createImportResolver(fs: FileSystem, options: ConfigOptions): ImportResolver {
        return new ImportResolver(fs, options);
    }

    protected processIndexing(port: MessagePort, token: CancellationToken) {
        /* noop */
    }

    protected reportIndex(port: MessagePort, result: { path: string; indexResults: IndexResults }) {
        port.postMessage({ requestType: 'indexResult', data: result });
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

    private _analysisDone(port: MessagePort, cancellationId: string) {
        port.postMessage({ requestType: 'analysisDone', data: cancellationId });
    }
}

function convertAnalysisResults(result: AnalysisResults): AnalysisResults {
    result.diagnostics = result.diagnostics.map((f: FileDiagnostics) => {
        return {
            filePath: f.filePath,
            diagnostics: convertDiagnostics(f.diagnostics),
        };
    });

    return result;
}

function convertDiagnostics(diagnostics: Diagnostic[]) {
    // Elements are typed as "any" since data crossing the process
    // boundary loses type info.
    return diagnostics.map<Diagnostic>((d: any) => {
        const diag = new Diagnostic(d.category, d.message, d.range);
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

export interface InitializationData {
    rootDirectory: string;
    cancellationFolderName?: string;
    runner?: string;
}

export interface AnalysisRequest {
    requestType:
        | 'analyze'
        | 'resumeAnalysis'
        | 'setConfigOptions'
        | 'setTrackedFiles'
        | 'setAllowedThirdPartyImports'
        | 'setFileOpened'
        | 'setFileClosed'
        | 'markAllFilesDirty'
        | 'markFilesDirty'
        | 'invalidateAndForceReanalysis'
        | 'restart'
        | 'getDiagnosticsForRange'
        | 'writeTypeStub'
        | 'getSemanticTokens';

    data: any;
    port?: MessagePort;
}

interface AnalysisResponse {
    requestType: 'log' | 'analysisResult' | 'analysisPaused' | 'indexResult' | 'analysisDone';
    data: any;
}
