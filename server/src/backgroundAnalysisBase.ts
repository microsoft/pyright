/*
 * backgroundAnalysisBase.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * run analyzer from background thread
 */

import { CancellationToken } from 'vscode-languageserver';
import { MessageChannel, MessagePort, parentPort, Worker, workerData } from 'worker_threads';

import { AnalysisCompleteCallback, AnalysisResults, analyzeProgram, nullCallback } from './analyzer/analysis';
import { ImportResolver } from './analyzer/importResolver';
import { Program } from './analyzer/program';
import {
    disposeCancellationToken,
    getCancellationTokenFromId,
    getCancellationTokenId,
    OperationCanceledException,
    setCancellationFolderName,
    throwIfCancellationRequested,
} from './common/cancellationUtils';
import { ConfigOptions } from './common/configOptions';
import { ConsoleInterface } from './common/console';
import * as debug from './common/debug';
import { Diagnostic } from './common/diagnostic';
import { FileDiagnostics } from './common/diagnosticSink';
import { LanguageServiceExtension } from './common/extensibility';
import { createFromRealFileSystem, FileSystem } from './common/fileSystem';
import { FileSpec } from './common/pathUtils';
import { Range } from './common/textRange';

export class BackgroundAnalysisBase {
    private _worker: Worker;
    private _console: ConsoleInterface;
    private _onAnalysisCompletion: AnalysisCompleteCallback = nullCallback;

    protected constructor() {
        // Don't allow instantiation of this type directly.
    }

    protected setup(worker: Worker, console: ConsoleInterface) {
        this._worker = worker;
        this._console = console;

        // global channel to communicate from BG channel to main thread.
        worker.on('message', (msg: AnalysisResponse) => {
            switch (msg.requestType) {
                case 'log':
                    this.log(msg.data);
                    break;

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
            this.log(`Error occurred on background thread: ${JSON.stringify(msg)}`);
        });
    }

    setCompletionCallback(callback?: AnalysisCompleteCallback) {
        this._onAnalysisCompletion = callback ?? nullCallback;
    }

    setConfigOptions(configOptions: ConfigOptions) {
        this._enqueueRequest({ requestType: 'setConfigOptions', data: configOptions });
    }

    setTrackedFiles(filePaths: string[]) {
        this._enqueueRequest({ requestType: 'setTrackedFiles', data: filePaths });
    }

    setAllowedThirdPartyImports(importNames: string[]) {
        this._enqueueRequest({ requestType: 'setAllowedThirdPartyImports', data: importNames });
    }

    setFileOpened(filePath: string, version: number | null, contents: string) {
        this._enqueueRequest({ requestType: 'setFileOpened', data: { filePath, version, contents } });
    }

    setFileClosed(filePath: string) {
        this._enqueueRequest({ requestType: 'setFileClosed', data: filePath });
    }

    markAllFilesDirty(evenIfContentsAreSame: boolean) {
        this._enqueueRequest({ requestType: 'markAllFilesDirty', data: evenIfContentsAreSame });
    }

    markFilesDirty(filePaths: string[], evenIfContentsAreSame: boolean) {
        this._enqueueRequest({ requestType: 'markFilesDirty', data: { filePaths, evenIfContentsAreSame } });
    }

    startAnalysis(token: CancellationToken) {
        const { port1, port2 } = new MessageChannel();

        // Handle response from background thread to main thread.
        port1.on('message', (msg: AnalysisResponse) => {
            switch (msg.requestType) {
                case 'analysisResult': {
                    this._onAnalysisCompletion(convertAnalysisResults(msg.data));
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
        this._enqueueRequest({ requestType: 'analyze', data: cancellationId, port: port2 });
    }

    async getDiagnosticsForRange(filePath: string, range: Range, token: CancellationToken): Promise<Diagnostic[]> {
        throwIfCancellationRequested(token);

        const { port1, port2 } = new MessageChannel();
        const waiter = getBackgroundWaiter<Diagnostic[]>(port1);

        const cancellationId = getCancellationTokenId(token);
        this._enqueueRequest({
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
        this._enqueueRequest({
            requestType: 'writeTypeStub',
            data: { targetImportPath, targetIsSingleFile, stubPath, cancellationId },
            port: port2,
        });

        await waiter;

        port2.close();
        port1.close();
    }

    invalidateAndForceReanalysis() {
        this._enqueueRequest({ requestType: 'invalidateAndForceReanalysis', data: null });
    }

    restart() {
        this._enqueueRequest({ requestType: 'restart', data: null });
    }

    private _enqueueRequest(request: AnalysisRequest) {
        this._worker.postMessage(request, request.port ? [request.port] : undefined);
    }

    protected log(msg: string) {
        this._console.log(msg);
    }
}

export class BackgroundAnalysisRunnerBase {
    private _fs: FileSystem;
    private _configOptions: ConfigOptions;
    private _importResolver: ImportResolver;
    private _program: Program;

    protected constructor(private _extension?: LanguageServiceExtension) {
        const data = workerData as InitializationData;
        setCancellationFolderName(data.cancellationFolderName);

        // Stash the base directory into a global variable.
        (global as any).__rootDirectory = data.rootDirectory;
        this.log(`Background analysis root directory: ${data.rootDirectory}`);

        this._fs = createFromRealFileSystem(this._getConsole());

        this._configOptions = new ConfigOptions(data.rootDirectory);
        this._importResolver = this.createImportResolver(this._fs, this._configOptions);
        this._program = new Program(this._importResolver, this._configOptions, this._getConsole(), this._extension);
    }

    start() {
        this.log(`Background analysis started`);

        // Get requests from main thread.
        parentPort?.on('message', (msg: AnalysisRequest) => {
            switch (msg.requestType) {
                case 'analyze': {
                    const port = msg.port!;
                    const token = getCancellationTokenFromId(msg.data);

                    // Report results at the interval of the max analysis time.
                    const maxTime = { openFilesTimeInMs: 50, noOpenFilesTimeInMs: 200 };
                    let moreToAnalyze = true;

                    while (moreToAnalyze) {
                        moreToAnalyze = analyzeProgram(
                            this._program,
                            maxTime,
                            this._configOptions,
                            (result) => this._onAnalysisCompletion(port, result),
                            this._getConsole(),
                            token
                        );
                    }

                    this._analysisDone(port, msg.data);
                    break;
                }

                case 'getDiagnosticsForRange': {
                    run(() => {
                        const { filePath, range, cancellationId } = msg.data;
                        const token = getCancellationTokenFromId(cancellationId);
                        throwIfCancellationRequested(token);

                        return this._program.getDiagnosticsForRange(filePath, range);
                    }, msg.port!);
                    break;
                }

                case 'writeTypeStub': {
                    run(() => {
                        const { targetImportPath, targetIsSingleFile, stubPath, cancellationId } = msg.data;
                        const token = getCancellationTokenFromId(cancellationId);

                        analyzeProgram(
                            this._program,
                            undefined,
                            this._configOptions,
                            nullCallback,
                            this._getConsole(),
                            token
                        );
                        this._program.writeTypeStub(targetImportPath, targetIsSingleFile, stubPath, token);
                    }, msg.port!);
                    break;
                }

                case 'setConfigOptions': {
                    this._configOptions = createConfigOptionsFrom(msg.data);
                    this._importResolver = this.createImportResolver(this._fs, this._configOptions);
                    this._program.setConfigOptions(this._configOptions);
                    this._program.setImportResolver(this._importResolver);
                    break;
                }

                case 'setTrackedFiles': {
                    const diagnostics = this._program.setTrackedFiles(msg.data);
                    this._reportDiagnostics(diagnostics, this._program.getFilesToAnalyzeCount(), 0);
                    break;
                }

                case 'setAllowedThirdPartyImports': {
                    this._program.setAllowedThirdPartyImports(msg.data);
                    break;
                }

                case 'setFileOpened': {
                    const { filePath, version, contents } = msg.data;
                    this._program.setFileOpened(filePath, version, contents);
                    break;
                }

                case 'setFileClosed': {
                    const diagnostics = this._program.setFileClosed(msg.data);
                    this._reportDiagnostics(diagnostics, this._program.getFilesToAnalyzeCount(), 0);
                    break;
                }

                case 'markAllFilesDirty': {
                    this._program.markAllFilesDirty(msg.data);
                    break;
                }

                case 'markFilesDirty': {
                    const { filePaths, evenIfContentsAreSame } = msg.data;
                    this._program.markFilesDirty(filePaths, evenIfContentsAreSame);
                    break;
                }

                case 'invalidateAndForceReanalysis': {
                    // Make sure the import resolver doesn't have invalid
                    // cached entries.
                    this._importResolver.invalidateCache();

                    // Mark all files with one or more errors dirty.
                    this._program.markAllFilesDirty(true);
                    break;
                }

                case 'restart': {
                    // recycle import resolver
                    this._importResolver = this.createImportResolver(this._fs, this._configOptions);
                    this._program.setImportResolver(this._importResolver);
                    break;
                }

                default: {
                    debug.fail(`${msg.requestType} is not expected`);
                }
            }
        });

        parentPort?.on('error', (msg) => debug.fail(`failed ${msg}`));
        parentPort?.on('exit', (c) => {
            if (c !== 0) {
                debug.fail(`worker stopped with exit code ${c}`);
            }
        });
    }

    protected log(msg: string) {
        parentPort?.postMessage({ requestType: 'log', data: msg });
    }

    protected createImportResolver(fs: FileSystem, options: ConfigOptions): ImportResolver {
        return new ImportResolver(fs, options);
    }

    private _reportDiagnostics(diagnostics: FileDiagnostics[], filesLeftToAnalyze: number, elapsedTime: number) {
        if (parentPort) {
            this._onAnalysisCompletion(parentPort, {
                diagnostics,
                filesInProgram: this._program.getFileCount(),
                filesRequiringAnalysis: filesLeftToAnalyze,
                checkingOnlyOpenFiles: this._program.isCheckingOnlyOpenFiles(),
                fatalErrorOccurred: false,
                configParseErrorOccurred: false,
                elapsedTime,
            });
        }
    }

    private _onAnalysisCompletion(port: MessagePort, result: AnalysisResults) {
        port.postMessage({ requestType: 'analysisResult', data: result });
    }

    private _analysisDone(port: MessagePort, cancellationId: string) {
        port.postMessage({ requestType: 'analysisDone', data: cancellationId });
    }

    private _getConsole() {
        return {
            log: (msg: string) => {
                this.log(msg);
            },
            error: (msg: string) => {
                this.log(msg);
            },
        };
    }
}

function createConfigOptionsFrom(jsonObject: any): ConfigOptions {
    const configOptions = new ConfigOptions(jsonObject.projectRoot);
    const getFileSpec = (fileSpec: any): FileSpec => {
        return { wildcardRoot: fileSpec.wildcardRoot, regExp: new RegExp(fileSpec.regExp.source) };
    };

    configOptions.pythonPath = jsonObject.pythonPath;
    configOptions.typeshedPath = jsonObject.typeshedPath;
    configOptions.stubPath = jsonObject.stubPath;
    configOptions.autoExcludeVenv = jsonObject.autoExcludeVenv;
    configOptions.verboseOutput = jsonObject.verboseOutput;
    configOptions.checkOnlyOpenFiles = jsonObject.checkOnlyOpenFiles;
    configOptions.useLibraryCodeForTypes = jsonObject.useLibraryCodeForTypes;
    configOptions.internalTestMode = jsonObject.internalTestMode;
    configOptions.venvPath = jsonObject.venvPath;
    configOptions.defaultVenv = jsonObject.defaultVenv;
    configOptions.defaultPythonVersion = jsonObject.defaultPythonVersion;
    configOptions.defaultPythonPlatform = jsonObject.defaultPythonPlatform;
    configOptions.diagnosticRuleSet = jsonObject.diagnosticRuleSet;
    configOptions.executionEnvironments = jsonObject.executionEnvironments;
    configOptions.include = jsonObject.include.map((f: any) => getFileSpec(f));
    configOptions.exclude = jsonObject.exclude.map((f: any) => getFileSpec(f));
    configOptions.ignore = jsonObject.ignore.map((f: any) => getFileSpec(f));
    configOptions.strict = jsonObject.strict.map((f: any) => getFileSpec(f));

    return configOptions;
}

function run(code: () => any, port: MessagePort) {
    try {
        const result = code();
        port.postMessage({ kind: 'ok', data: result });
    } catch (e) {
        if (OperationCanceledException.is(e)) {
            port.postMessage({ kind: 'cancelled', data: e.message });
            return;
        }

        port.postMessage({ kind: 'failed', data: `Exception: ${e.message} in ${e.stack}` });
    }
}

function getBackgroundWaiter<T>(port: MessagePort): Promise<T> {
    return new Promise((resolve, reject) => {
        port.on('message', (m: RequestResponse) => {
            switch (m.kind) {
                case 'ok':
                    resolve(m.data);
                    break;

                case 'cancelled':
                    reject(new OperationCanceledException());
                    break;

                case 'failed':
                    reject(m.data);
                    break;

                default:
                    debug.fail(`unknown kind ${m.kind}`);
            }
        });
    });
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
}

interface AnalysisRequest {
    requestType:
        | 'analyze'
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
        | 'writeTypeStub';

    data: any;
    port?: MessagePort;
}

interface AnalysisResponse {
    requestType: 'log' | 'analysisResult' | 'analysisDone';
    data: any;
}

interface RequestResponse {
    kind: 'ok' | 'failed' | 'cancelled';
    data: any;
}
