/*
 * BackgroundAnalysisProgram.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Applies operations to both the foreground program and a background
 * analysis running in a worker process.
 */

import { CancellationToken } from 'vscode-languageserver';

import { IBackgroundAnalysis } from '../backgroundAnalysisBase';
import { ConfigOptions, ExecutionEnvironment } from '../common/configOptions';
import { Diagnostic } from '../common/diagnostic';
import { FileDiagnostics } from '../common/diagnosticSink';
import { ServiceProvider } from '../common/serviceProvider';
import '../common/serviceProviderExtensions';
import { Range } from '../common/textRange';
import { Uri } from '../common/uri/uri';
import { AnalysisCompleteCallback, analyzeProgram } from './analysis';
import { ImportResolver } from './importResolver';
import { MaxAnalysisTime, OpenFileOptions, Program } from './program';

export enum InvalidatedReason {
    Reanalyzed,
    SourceWatcherChanged,
    LibraryWatcherChanged,
    LibraryWatcherContentOnlyChanged,
}

export class BackgroundAnalysisProgram {
    private _program: Program;
    private _disposed = false;
    private _onAnalysisCompletion: AnalysisCompleteCallback | undefined;
    private _preEditAnalysis: IBackgroundAnalysis | undefined;

    constructor(
        protected readonly serviceId: string,
        private readonly _serviceProvider: ServiceProvider,
        private _configOptions: ConfigOptions,
        private _importResolver: ImportResolver,
        private _backgroundAnalysis?: IBackgroundAnalysis,
        private readonly _maxAnalysisTime?: MaxAnalysisTime,
        private readonly _disableChecker?: boolean
    ) {
        this._program = new Program(
            this.importResolver,
            this.configOptions,
            this._serviceProvider,
            undefined,
            this._disableChecker,
            serviceId
        );
        this._backgroundAnalysis?.setProgramView(this._program);
    }

    get serviceProvider() {
        return this._serviceProvider;
    }

    get configOptions() {
        return this._configOptions;
    }

    get importResolver() {
        return this._importResolver;
    }

    get program() {
        return this._program;
    }

    get host() {
        return this._importResolver.host;
    }

    get backgroundAnalysis() {
        return this._backgroundAnalysis;
    }

    hasSourceFile(fileUri: Uri): boolean {
        return !!this._program.getSourceFile(fileUri);
    }

    setConfigOptions(configOptions: ConfigOptions) {
        this._configOptions = configOptions;
        this._backgroundAnalysis?.setConfigOptions(configOptions);
        this._program.setConfigOptions(configOptions);
    }

    setImportResolver(importResolver: ImportResolver) {
        this._importResolver = importResolver;
        this._backgroundAnalysis?.setImportResolver(importResolver);

        this._program.setImportResolver(importResolver);
        this.configOptions.getExecutionEnvironments().forEach((e) => this._ensurePartialStubPackages(e));
    }

    setTrackedFiles(fileUris: Uri[]) {
        this._backgroundAnalysis?.setTrackedFiles(fileUris);
        const diagnostics = this._program.setTrackedFiles(fileUris);
        this._reportDiagnosticsForRemovedFiles(diagnostics);
    }

    setAllowedThirdPartyImports(importNames: string[]) {
        this._backgroundAnalysis?.setAllowedThirdPartyImports(importNames);
        this._program.setAllowedThirdPartyImports(importNames);
    }

    setFileOpened(fileUri: Uri, version: number | null, contents: string, options: OpenFileOptions) {
        this._backgroundAnalysis?.setFileOpened(fileUri, version, contents, options);
        this._program.setFileOpened(fileUri, version, contents, options);
    }

    getChainedUri(fileUri: Uri): Uri | undefined {
        return this._program.getChainedUri(fileUri);
    }

    updateChainedUri(fileUri: Uri, chainedUri: Uri | undefined) {
        this._backgroundAnalysis?.updateChainedUri(fileUri, chainedUri);
        this._program.updateChainedUri(fileUri, chainedUri);
    }

    updateOpenFileContents(uri: Uri, version: number | null, contents: string, options: OpenFileOptions) {
        this._backgroundAnalysis?.setFileOpened(uri, version, contents, options);
        this._program.setFileOpened(uri, version, contents, options);
        this.markFilesDirty([uri], /* evenIfContentsAreSame */ true);
    }

    setFileClosed(fileUri: Uri, isTracked?: boolean) {
        this._backgroundAnalysis?.setFileClosed(fileUri, isTracked);
        const diagnostics = this._program.setFileClosed(fileUri, isTracked);
        this._reportDiagnosticsForRemovedFiles(diagnostics);
    }

    addInterimFile(fileUri: Uri) {
        this._backgroundAnalysis?.addInterimFile(fileUri);
        this._program.addInterimFile(fileUri);
    }

    markAllFilesDirty(evenIfContentsAreSame: boolean) {
        this._backgroundAnalysis?.markAllFilesDirty(evenIfContentsAreSame);
        this._program.markAllFilesDirty(evenIfContentsAreSame);
    }

    markFilesDirty(fileUris: Uri[], evenIfContentsAreSame: boolean) {
        this._backgroundAnalysis?.markFilesDirty(fileUris, evenIfContentsAreSame);
        this._program.markFilesDirty(fileUris, evenIfContentsAreSame);
    }

    setCompletionCallback(callback?: AnalysisCompleteCallback) {
        this._onAnalysisCompletion = callback;
        this._backgroundAnalysis?.setCompletionCallback(callback);
    }

    startAnalysis(token: CancellationToken): boolean {
        if (this._backgroundAnalysis) {
            this._backgroundAnalysis.startAnalysis(token);
            return false;
        }

        return analyzeProgram(
            this._program,
            this._maxAnalysisTime,
            this._configOptions,
            this._onAnalysisCompletion,
            this._serviceProvider.console(),
            token
        );
    }

    async analyzeFile(fileUri: Uri, token: CancellationToken): Promise<boolean> {
        if (this._backgroundAnalysis) {
            return this._backgroundAnalysis.analyzeFile(fileUri, token);
        }

        return this._program.analyzeFile(fileUri, token);
    }

    async analyzeFileAndGetDiagnostics(fileUri: Uri, token: CancellationToken): Promise<Diagnostic[]> {
        if (this._backgroundAnalysis) {
            return this._backgroundAnalysis.analyzeFileAndGetDiagnostics(fileUri, token);
        }

        return this._program.analyzeFileAndGetDiagnostics(fileUri, token);
    }

    libraryUpdated(): boolean {
        return false;
    }

    async getDiagnosticsForRange(fileUri: Uri, range: Range, token: CancellationToken): Promise<Diagnostic[]> {
        if (this._backgroundAnalysis) {
            return this._backgroundAnalysis.getDiagnosticsForRange(fileUri, range, token);
        }

        return this._program.getDiagnosticsForRange(fileUri, range);
    }

    async writeTypeStub(
        targetImportUri: Uri,
        targetIsSingleFile: boolean,
        stubUri: Uri,
        token: CancellationToken
    ): Promise<any> {
        if (this._backgroundAnalysis) {
            return this._backgroundAnalysis.writeTypeStub(targetImportUri, targetIsSingleFile, stubUri, token);
        }

        analyzeProgram(
            this._program,
            /* maxTime */ undefined,
            this._configOptions,
            this._onAnalysisCompletion,
            this._serviceProvider.console(),
            token
        );
        return this._program.writeTypeStub(targetImportUri, targetIsSingleFile, stubUri, token);
    }

    invalidateAndForceReanalysis(reason: InvalidatedReason) {
        this._backgroundAnalysis?.invalidateAndForceReanalysis(reason);

        // Make sure the import resolver doesn't have invalid
        // cached entries.
        this._importResolver.invalidateCache();

        // Mark all files with one or more errors dirty.
        this._program.markAllFilesDirty(/* evenIfContentsAreSame */ true);
    }

    restart() {
        this._backgroundAnalysis?.restart();
    }

    dispose() {
        if (this._disposed) {
            return;
        }

        this._disposed = true;
        this._program.dispose();
        this._backgroundAnalysis?.shutdown();
        this._backgroundAnalysis?.dispose();
    }

    enterEditMode() {
        // Turn off analysis while in edit mode.
        this._preEditAnalysis = this._backgroundAnalysis;
        this._backgroundAnalysis = undefined;

        // Forward this request to the program.
        this._program.enterEditMode();
    }

    exitEditMode() {
        this._backgroundAnalysis = this._preEditAnalysis;
        this._preEditAnalysis = undefined;
        return this._program.exitEditMode();
    }

    private _ensurePartialStubPackages(execEnv: ExecutionEnvironment) {
        this._backgroundAnalysis?.ensurePartialStubPackages(execEnv.root?.toString());
        return this._importResolver.ensurePartialStubPackages(execEnv);
    }

    private _reportDiagnosticsForRemovedFiles(fileDiags: FileDiagnostics[]) {
        if (fileDiags.length === 0) {
            return;
        }

        // If analysis is running in the foreground process, report any
        // diagnostics that resulted from the close operation (used to
        // clear diagnostics that are no longer of interest).
        if (!this._backgroundAnalysis && this._onAnalysisCompletion) {
            this._onAnalysisCompletion({
                diagnostics: fileDiags,
                filesInProgram: this._program.getFileCount(),
                requiringAnalysisCount: this._program.getFilesToAnalyzeCount(),
                checkingOnlyOpenFiles: this._program.isCheckingOnlyOpenFiles(),
                fatalErrorOccurred: false,
                configParseErrorOccurred: false,
                elapsedTime: 0,
                reason: 'tracking',
            });
        }
    }
}

export type BackgroundAnalysisProgramFactory = (
    serviceId: string,
    serviceProvider: ServiceProvider,
    configOptions: ConfigOptions,
    importResolver: ImportResolver,
    backgroundAnalysis?: IBackgroundAnalysis,
    maxAnalysisTime?: MaxAnalysisTime
) => BackgroundAnalysisProgram;
