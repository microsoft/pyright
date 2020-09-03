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
import { IndexResults } from '../languageService/documentSymbolProvider';
import { AnalysisCompleteCallback, analyzeProgram } from './analysis';
import { ImportResolver } from './importResolver';
import { Indices, MaxAnalysisTime, Program } from './program';

export class BackgroundAnalysisProgram {
    private _program: Program;
    private _backgroundAnalysis?: BackgroundAnalysisBase;
    private _onAnalysisCompletion?: AnalysisCompleteCallback;
    private _maxAnalysisTime?: MaxAnalysisTime;
    private _indices: Indices | undefined;

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
            this._backgroundAnalysis.startAnalysis(this._indices, token);
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

    test_setIndexing(
        workspaceIndices: Map<string, IndexResults>,
        libraryIndices: Map<string, Map<string, IndexResults>>
    ) {
        const indices = this._getIndices();
        for (const [filePath, indexResults] of workspaceIndices) {
            indices.setWorkspaceIndex(filePath, indexResults);
        }

        for (const [execEnvRoot, map] of libraryIndices) {
            for (const [libraryPath, indexResults] of map) {
                indices.setIndex(execEnvRoot, libraryPath, indexResults);
            }
        }
    }

    startIndexing() {
        this._backgroundAnalysis?.startIndexing(this._configOptions, this._getIndices());
    }

    refreshIndexing() {
        this._backgroundAnalysis?.refreshIndexing(this._configOptions, this._indices);
    }

    cancelIndexing() {
        this._backgroundAnalysis?.cancelIndexing(this._configOptions);
    }

    getIndexing(filePath: string) {
        return this._indices?.getIndex(this._configOptions.findExecEnvironment(filePath).root);
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
        this.refreshIndexing();

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

    restart() {
        this._backgroundAnalysis?.restart();
    }

    private _getIndices(): Indices {
        if (!this._indices) {
            const program = this._program;

            // The map holds onto index results of library files per execution root.
            // The map will be refreshed together when library files are re-scanned.
            // It can't be cached by sourceFile since some of library files won't have
            // corresponding sourceFile created.
            const map = new Map<string, Map<string, IndexResults>>();
            this._indices = {
                setWorkspaceIndex(path: string, indexResults: IndexResults): void {
                    // Index result of workspace file will be cached by each sourceFile
                    // and it will go away when the source file goes away.
                    program.getSourceFile(path)?.cacheIndexResults(indexResults);
                },
                getIndex(execEnv: string): Map<string, IndexResults> | undefined {
                    return map.get(execEnv);
                },
                setIndex(execEnv: string, path: string, indexResults: IndexResults): void {
                    let indicesMap = map.get(execEnv);
                    if (!indicesMap) {
                        indicesMap = new Map<string, IndexResults>();
                        map.set(execEnv, indicesMap);
                    }

                    indicesMap.set(path, indexResults);
                },
                reset(): void {
                    map.clear();
                },
            };
        }

        return this._indices!;
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

export type BackgroundAnalysisProgramFactory = (
    console: ConsoleInterface,
    configOptions: ConfigOptions,
    importResolver: ImportResolver,
    extension?: LanguageServiceExtension,
    backgroundAnalysis?: BackgroundAnalysisBase,
    maxAnalysisTime?: MaxAnalysisTime
) => BackgroundAnalysisProgram;
