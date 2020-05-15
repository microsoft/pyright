/*
 * BackgroundAnalysisProgram.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Applies operations to both the foreground program and a background
 * analysis running in a worker process.
 */

import { CancellationToken } from 'vscode-languageserver';

import { BackgroundAnalysisBase } from '../backgroundAnalysisBase';
import { ConfigOptions } from '../common/configOptions';
import { ConsoleInterface } from '../common/console';
import { Diagnostic } from '../common/diagnostic';
import { FileDiagnostics } from '../common/diagnosticSink';
import { LanguageServiceExtension } from '../common/extensibility';
import { Range } from '../common/textRange';
import { AnalysisCompleteCallback, analyzeProgram } from './analysis';
import { ImportResolver } from './importResolver';
import { MaxAnalysisTime, Program } from './program';

export class BackgroundAnalysisProgram {
    private _program: Program;
    private _backgroundAnalysis?: BackgroundAnalysisBase;
    private _onAnalysisCompletion?: AnalysisCompleteCallback;
    private _maxAnalysisTime?: MaxAnalysisTime;

    constructor(
        private _console: ConsoleInterface,
        private _configOptions: ConfigOptions,
        private _importResolver: ImportResolver,
        extension?: LanguageServiceExtension,
        backgroundAnalysis?: BackgroundAnalysisBase,
        maxAnalysisTime?: MaxAnalysisTime
    ) {
        this._program = new Program(this._importResolver, this._configOptions, this._console, extension);
        this._backgroundAnalysis = backgroundAnalysis;
        this._maxAnalysisTime = maxAnalysisTime;
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

    get backgroundAnalysis() {
        return this._backgroundAnalysis;
    }

    setConfigOptions(configOptions: ConfigOptions) {
        this._configOptions = configOptions;
        this._backgroundAnalysis?.setConfigOptions(configOptions);
        this._program.setConfigOptions(configOptions);
    }

    setImportResolver(importResolver: ImportResolver) {
        this._importResolver = importResolver;
        this._program.setImportResolver(importResolver);

        // Do nothing for background analysis.
        // Background analysis updates importer when configOptions is changed rather than
        // having two APIs to reduce the chance of the program and importer pointing to
        // two different configOptions.
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

    setFileOpened(filePath: string, version: number | null, contents: string) {
        this._backgroundAnalysis?.setFileOpened(filePath, version, contents);
        this._program.setFileOpened(filePath, version, contents);
    }

    updateOpenFileContents(path: string, version: number | null, contents: string) {
        this.setFileOpened(path, version, contents);
        this.markFilesDirty([path], true);
    }

    setFileClosed(filePath: string) {
        this._backgroundAnalysis?.setFileClosed(filePath);
        const diagnostics = this._program.setFileClosed(filePath);
        this._reportDiagnosticsForRemovedFiles(diagnostics);
    }

    markAllFilesDirty(evenIfContentsAreSame: boolean) {
        this._backgroundAnalysis?.markAllFilesDirty(evenIfContentsAreSame);
        this._program.markAllFilesDirty(evenIfContentsAreSame);
    }

    markFilesDirty(filePaths: string[], evenIfContentsAreSame: boolean) {
        this._backgroundAnalysis?.markFilesDirty(filePaths, evenIfContentsAreSame);
        this._program.markFilesDirty(filePaths, evenIfContentsAreSame);
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
            this._console,
            token
        );
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

        analyzeProgram(this._program, undefined, this._configOptions, this._onAnalysisCompletion, this._console, token);
        return this._program.writeTypeStub(targetImportPath, targetIsSingleFile, stubPath, token);
    }

    invalidateAndForceReanalysis() {
        this._backgroundAnalysis?.invalidateAndForceReanalysis();

        // Make sure the import resolver doesn't have invalid
        // cached entries.
        this._importResolver.invalidateCache();

        // Mark all files with one or more errors dirty.
        this._program.markAllFilesDirty(true);
    }

    invalidateCache() {
        // Invalidate import resolver because it could have cached
        // imports that are no longer valid because a source file has
        // been deleted or added.
        this._importResolver.invalidateCache();
    }

    initializeFromJson(configJsonObj: any, typeCheckingMode: string | undefined) {
        this._configOptions.initializeFromJson(configJsonObj, typeCheckingMode, this._console);
        this._backgroundAnalysis?.setConfigOptions(this._configOptions);
        this._program.setConfigOptions(this._configOptions);
    }

    restart() {
        this._backgroundAnalysis?.restart();
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
}
