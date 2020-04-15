/*
 * BackgroundAnalysisProgram.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * this makes sure same operation is applied to
 * both program and background analysis
 */

import { CancellationToken } from 'vscode-languageserver';

import { BackgroundAnalysisBase } from '../backgroundAnalysisBase';
import { ConfigOptions } from '../common/configOptions';
import { ConsoleInterface } from '../common/console';
import { Diagnostic } from '../common/diagnostic';
import { LanguageServiceExtension } from '../common/extensibility';
import { Range } from '../common/textRange';
import { AnalysisCompleteCallback, analyzeProgram } from './analysis';
import { ImportResolver } from './importResolver';
import { Program } from './program';

export class BackgroundAnalysisProgram {
    private _program: Program;
    private _backgroundAnalysis?: BackgroundAnalysisBase;
    private _onAnalysisCompletion?: AnalysisCompleteCallback;

    constructor(
        private _console: ConsoleInterface,
        private _configOptions: ConfigOptions,
        private _importResolver: ImportResolver,
        extension?: LanguageServiceExtension,
        backgroundAnalysis?: BackgroundAnalysisBase
    ) {
        this._program = new Program(this._importResolver, this._configOptions, this._console, extension);
        this._backgroundAnalysis = backgroundAnalysis;
    }

    get configOptions() {
        // not sure why program won't just expose configOptions it has
        // rather than this has a separate reference to it
        return this._configOptions;
    }

    get importResolver() {
        // not sure why program won't just expose importResolver it has
        // rather than this has a separate reference to it
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

        // nothing for background analysis.
        // backgroundAnalysis updates importer when configOptions is changed rather than
        // having 2 APIs to reduce chance of program and importer pointing to 2 different
        // configOptions.
    }

    setTrackedFiles(filePaths: string[]) {
        this._backgroundAnalysis?.setTrackedFiles(filePaths);
        this._program.setTrackedFiles(filePaths);
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
        this.markFilesDirty([path]);
    }

    setFileClosed(filePath: string) {
        this._backgroundAnalysis?.setFileClosed(filePath);
        this._program.setFileClosed(filePath);
    }

    markAllFilesDirty(evenIfContentsAreSame: boolean) {
        this._backgroundAnalysis?.markAllFilesDirty(evenIfContentsAreSame);
        this._program.markAllFilesDirty(evenIfContentsAreSame);
    }

    markFilesDirty(filePaths: string[]) {
        this._backgroundAnalysis?.markFilesDirty(filePaths);
        this._program.markFilesDirty(filePaths);
    }

    setCompletionCallback(callback?: AnalysisCompleteCallback) {
        this._onAnalysisCompletion = callback;
        this._backgroundAnalysis?.setCompletionCallback(callback);
    }

    startAnalysis(token: CancellationToken) {
        if (this._backgroundAnalysis) {
            this._backgroundAnalysis.startAnalysis(token);
            return;
        }

        analyzeProgram(this._program, undefined, this._configOptions, this._onAnalysisCompletion, this._console, token);
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
        typingsPath: string,
        token: CancellationToken
    ): Promise<any> {
        if (this._backgroundAnalysis) {
            return this._backgroundAnalysis.writeTypeStub(targetImportPath, targetIsSingleFile, typingsPath, token);
        }

        analyzeProgram(this._program, undefined, this._configOptions, this._onAnalysisCompletion, this._console, token);
        return this._program.writeTypeStub(targetImportPath, targetIsSingleFile, typingsPath, token);
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
    }

    restart() {
        this._backgroundAnalysis?.restart();
    }
}
