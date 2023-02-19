/*
 * BackgroundAnalysisProgram.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Applies operations to both the foreground program and a background
 * analysis running in a worker process.
 */

import { CancellationToken } from 'vscode-languageserver';
import { TextDocumentContentChangeEvent } from 'vscode-languageserver-textdocument';

import { BackgroundAnalysisBase, IndexOptions, RefreshOptions } from '../backgroundAnalysisBase';
import { ConfigOptions, ExecutionEnvironment } from '../common/configOptions';
import { ConsoleInterface } from '../common/console';
import { Diagnostic } from '../common/diagnostic';
import { FileDiagnostics } from '../common/diagnosticSink';
import { Range } from '../common/textRange';
import { AnalysisCompleteCallback, analyzeProgram } from './analysis';
import { CacheManager } from './cacheManager';
import { ImportResolver } from './importResolver';
import { Indices, MaxAnalysisTime, OpenFileOptions, Program } from './program';

export class BackgroundAnalysisProgram {
    private _program: Program;
    private _disposed = false;
    private _onAnalysisCompletion: AnalysisCompleteCallback | undefined;

    constructor(
        private _console: ConsoleInterface,
        private _configOptions: ConfigOptions,
        private _importResolver: ImportResolver,
        protected _backgroundAnalysis?: BackgroundAnalysisBase,
        private _maxAnalysisTime?: MaxAnalysisTime,
        private _disableChecker?: boolean,
        cacheManager?: CacheManager
    ) {
        this._program = new Program(
            this._importResolver,
            this._configOptions,
            this._console,
            undefined,
            this._disableChecker,
            cacheManager
        );
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

    contains(filePath: string): boolean {
        return !!this._program.getSourceFile(filePath);
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
        this._configOptions.getExecutionEnvironments().forEach((e) => this._ensurePartialStubPackages(e));
    }

    setTrackedFiles(filePaths: string[]) {
        this._backgroundAnalysis?.setTrackedFiles(filePaths);
        const diagnostics = this._program.setTrackedFiles(filePaths);
        this._reportDiagnosticsForRemovedFiles(diagnostics);
    }

    setAllowedThirdPartyImports(importNames: string[]) {
        this._backgroundAnalysis?.setAllowedThirdPartyImports(importNames);
        this._program.setAllowedThirdPartyImports(importNames);
    }

    setFileOpened(filePath: string, version: number | null, contents: string, options: OpenFileOptions) {
        this._backgroundAnalysis?.setFileOpened(filePath, version, [{ text: contents }], options);
        this._program.setFileOpened(filePath, version, [{ text: contents }], options);
    }

    getChainedFilePath(filePath: string): string | undefined {
        return this._program.getChainedFilePath(filePath);
    }

    updateChainedFilePath(filePath: string, chainedFilePath: string | undefined) {
        this._backgroundAnalysis?.updateChainedFilePath(filePath, chainedFilePath);
        this._program.updateChainedFilePath(filePath, chainedFilePath);
    }

    updateOpenFileContents(
        path: string,
        version: number | null,
        contents: TextDocumentContentChangeEvent[],
        options: OpenFileOptions
    ) {
        this._backgroundAnalysis?.setFileOpened(path, version, contents, options);
        this._program.setFileOpened(path, version, contents, options);
        this.markFilesDirty([path], /* evenIfContentsAreSame */ true);
    }

    setFileClosed(filePath: string, isTracked?: boolean) {
        this._backgroundAnalysis?.setFileClosed(filePath, isTracked);
        const diagnostics = this._program.setFileClosed(filePath, isTracked);
        this._reportDiagnosticsForRemovedFiles(diagnostics);
    }

    addTrackedFile(filePath: string, isThirdPartyImport: boolean) {
        this._backgroundAnalysis?.addTrackedFile(filePath, isThirdPartyImport);
        this._program.addTrackedFile(filePath, isThirdPartyImport);
    }

    markAllFilesDirty(evenIfContentsAreSame: boolean, indexingNeeded = true) {
        this._backgroundAnalysis?.markAllFilesDirty(evenIfContentsAreSame, indexingNeeded);
        this._program.markAllFilesDirty(evenIfContentsAreSame, indexingNeeded);
    }

    markFilesDirty(filePaths: string[], evenIfContentsAreSame: boolean, indexingNeeded = true) {
        this._backgroundAnalysis?.markFilesDirty(filePaths, evenIfContentsAreSame, indexingNeeded);
        this._program.markFilesDirty(filePaths, evenIfContentsAreSame, indexingNeeded);
    }

    setCompletionCallback(callback?: AnalysisCompleteCallback) {
        this._onAnalysisCompletion = callback;
        this._backgroundAnalysis?.setCompletionCallback(callback);
    }

    startAnalysis(token: CancellationToken): boolean {
        if (this._backgroundAnalysis) {
            this._backgroundAnalysis.startAnalysis(this._getIndices(), token);
            return false;
        }

        return analyzeProgram(
            this._program,
            this._maxAnalysisTime,
            this._configOptions,
            this._onAnalysisCompletion,
            this._console,
            token
        );
    }

    analyzeFile(filePath: string, token: CancellationToken): boolean {
        return this._program.analyzeFile(filePath, token);
    }

    startIndexing(indexOptions: IndexOptions) {
        this._backgroundAnalysis?.startIndexing(indexOptions, this._configOptions, this.importResolver, this.host.kind);
    }

    refreshIndexing(refreshOptions?: RefreshOptions) {
        this._backgroundAnalysis?.refreshIndexing(
            this._configOptions,
            this.importResolver,
            this.host.kind,
            refreshOptions
        );
    }

    cancelIndexing() {
        this._backgroundAnalysis?.cancelIndexing();
    }

    getIndexing(filePath: string) {
        return this._getIndices()?.getIndex(this._configOptions.findExecEnvironment(filePath).root);
    }

    async getDiagnosticsForRange(filePath: string, range: Range, token: CancellationToken): Promise<Diagnostic[]> {
        if (this._backgroundAnalysis) {
            return this._backgroundAnalysis.getDiagnosticsForRange(filePath, range, token);
        }

        return this._program.getDiagnosticsForRange(filePath, range);
    }

    async writeTypeStub(
        targetImportPath: string,
        targetIsSingleFile: boolean,
        stubPath: string,
        token: CancellationToken
    ): Promise<any> {
        if (this._backgroundAnalysis) {
            return this._backgroundAnalysis.writeTypeStub(targetImportPath, targetIsSingleFile, stubPath, token);
        }

        analyzeProgram(
            this._program,
            /* maxTime */ undefined,
            this._configOptions,
            this._onAnalysisCompletion,
            this._console,
            token
        );
        return this._program.writeTypeStub(targetImportPath, targetIsSingleFile, stubPath, token);
    }

    invalidateAndForceReanalysis(
        rebuildUserFileIndexing: boolean,
        rebuildLibraryIndexing: boolean,
        refreshOptions?: RefreshOptions
    ) {
        if (rebuildLibraryIndexing) {
            this.refreshIndexing(refreshOptions);
        }

        this._backgroundAnalysis?.invalidateAndForceReanalysis(rebuildUserFileIndexing);

        // Make sure the import resolver doesn't have invalid
        // cached entries.
        this._importResolver.invalidateCache();

        // Mark all files with one or more errors dirty.
        this._program.markAllFilesDirty(true, rebuildUserFileIndexing);
    }

    restart() {
        this._backgroundAnalysis?.restart();
    }

    dispose() {
        this._disposed = true;
        this._program.dispose();
        this._backgroundAnalysis?.shutdown();
    }

    private _ensurePartialStubPackages(execEnv: ExecutionEnvironment) {
        this._backgroundAnalysis?.ensurePartialStubPackages(execEnv.root);
        return this._importResolver.ensurePartialStubPackages(execEnv);
    }

    private _reportDiagnosticsForRemovedFiles(fileDiags: FileDiagnostics[]) {
        if (fileDiags.length > 0) {
            // If analysis is running in the foreground process, report any
            // diagnostics that resulted from the close operation (used to
            // clear diagnostics that are no longer of interest).
            if (!this._backgroundAnalysis && this._onAnalysisCompletion) {
                this._onAnalysisCompletion({
                    diagnostics: fileDiags,
                    filesInProgram: this._program.getFileCount(),
                    filesRequiringAnalysis: this._program.getFilesToAnalyzeCount(),
                    checkingOnlyOpenFiles: this._program.isCheckingOnlyOpenFiles(),
                    fatalErrorOccurred: false,
                    configParseErrorOccurred: false,
                    elapsedTime: 0,
                });
            }
        }
    }

    protected _getIndices(): Indices | undefined {
        return undefined;
    }
}

export type BackgroundAnalysisProgramFactory = (
    serviceId: string,
    console: ConsoleInterface,
    configOptions: ConfigOptions,
    importResolver: ImportResolver,
    backgroundAnalysis?: BackgroundAnalysisBase,
    maxAnalysisTime?: MaxAnalysisTime,
    cacheManager?: CacheManager
) => BackgroundAnalysisProgram;
