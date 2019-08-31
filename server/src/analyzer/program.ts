/*
* program.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* An object that tracks all of the source files being analyzed
* and all of their recursive imports.
*/

import * as assert from 'assert';
import { CompletionList, SymbolInformation } from 'vscode-languageserver';

import { ConfigOptions } from '../common/configOptions';
import { ConsoleInterface, StandardConsole } from '../common/console';
import { Diagnostic, DiagnosticCategory, DiagnosticTextPosition,
    DiagnosticTextRange, DocumentTextRange, doRangesOverlap } from '../common/diagnostic';
import { FileDiagnostics } from '../common/diagnosticSink';
import { FileEditAction, TextEditAction } from '../common/editAction';
import { combinePaths, getDirectoryPath, getRelativePath, makeDirectories, normalizePath, stripFileExtension } from '../common/pathUtils';
import { Duration } from '../common/timing';
import { ModuleSymbolMap } from '../languageService/completionProvider';
import { HoverResults } from '../languageService/hoverProvider';
import { SignatureHelpResults } from '../languageService/signatureHelpProvider';
import { ImportMap } from './analyzerFileInfo';
import { AnalyzerNodeInfo } from './analyzerNodeInfo';
import { CircularDependency } from './circularDependency';
import { ImportResolver } from './importResolver';
import { ImportType } from './importResult';
import { Scope } from './scope';
import { SourceFile } from './sourceFile';
import { TypeStubWriter } from './typeStubWriter';

const _maxImportDepth = 256;
const _maxAnalysisTimeForCompletions = 500;

export interface SourceFileInfo {
    sourceFile: SourceFile;
    isTracked: boolean;
    isOpenByClient: boolean;
    isTypeshedFile: boolean;
    diagnosticsVersion: number;
    imports: SourceFileInfo[];
    builtinsImport?: SourceFileInfo;
    importedBy: SourceFileInfo[];
}

export interface MaxAnalysisTime {
    // Maximum number of ms to analyze when there are open files
    // that require analysis. This number is usually kept relatively
    // small to guarantee responsiveness during typing.
    openFilesTimeInMs: number;

    // Maximum number of ms to analyze when all open files and their
    // dependencies have been analyzed. This number can be higher
    // to reduce overall analysis time but needs to be short enough
    // to remain responsive if an open file is modified.
    noOpenFilesTimeInMs: number;
}

// Container for all of the files that are being analyzed. Files
// can fall into one or more of the following categories:
//  Tracked - specified by the config options
//  Referenced - part of the transitive closure
//  Opened - temporarily opened in the editor
export class Program {
    private _console: ConsoleInterface;
    private _sourceFileList: SourceFileInfo[] = [];
    private _sourceFileMap: { [path: string]: SourceFileInfo } = {};
    private _allowThirdPartyImports = false;

    constructor(console?: ConsoleInterface) {
        this._console = console || new StandardConsole();
    }

    // Sets the list of tracked files that make up the program.
    setTrackedFiles(filePaths: string[]): FileDiagnostics[] {
        if (this._sourceFileList.length > 0) {
            // We need to determine which files to remove from the existing file list.
            const newFileMap: { [path: string]: string } = {};
            filePaths.forEach(path => {
                newFileMap[path] = path;
            });

            // Files that are not in the tracked file list are
            // marked as no longer tracked.
            this._sourceFileList.forEach(oldFile => {
                const filePath = oldFile.sourceFile.getFilePath();
                if (newFileMap[filePath] === undefined) {
                    oldFile.isTracked = false;
                }
            });
        }

        // Add the new files. Only the new items will be added.
        this.addTrackedFiles(filePaths);

        return this._removeUnneededFiles();
    }

    setAllowThirdPartyImports() {
        this._allowThirdPartyImports = true;
    }

    getFileCount() {
        return this._sourceFileList.length;
    }

    getAverageAnalysisPassCount() {
        let passCount = 0;
        this._sourceFileList.forEach(sourceFileInfo => {
            passCount += sourceFileInfo.sourceFile.getAnalysisPassCount();
        });

        if (this._sourceFileList.length === 0) {
            return 0;
        }

        return passCount / this._sourceFileList.length;
    }

    getMaxAnalysisPassCount(): [number, SourceFile?] {
        let maxPassCount = 0;
        let sourceFile: SourceFile | undefined;

        this._sourceFileList.forEach(sourceFileInfo => {
            const passCount = sourceFileInfo.sourceFile.getAnalysisPassCount();
            if (passCount > maxPassCount) {
                maxPassCount = passCount;
                sourceFile = sourceFileInfo.sourceFile;
            }
        });

        return [maxPassCount, sourceFile];
    }

    getFilesToAnalyzeCount() {
        let sourceFileCount = 0;

        this._sourceFileList.forEach(fileInfo => {
            if (fileInfo.sourceFile.isParseRequired() ||
                    fileInfo.sourceFile.isSemanticAnalysisRequired() ||
                    fileInfo.sourceFile.isTypeAnalysisRequired()) {
                sourceFileCount++;
            }
        });

        return sourceFileCount;
    }

    addTrackedFiles(filePaths: string[]) {
        filePaths.forEach(filePath => {
            this.addTrackedFile(filePath);
        });
    }

    addTrackedFile(filePath: string): SourceFile {
        let sourceFileInfo = this._sourceFileMap[filePath];
        if (sourceFileInfo) {
            sourceFileInfo.isTracked = true;
            return sourceFileInfo.sourceFile;
        }

        const sourceFile = new SourceFile(filePath, false, this._console);
        sourceFileInfo = {
            sourceFile,
            isTracked: true,
            isOpenByClient: false,
            isTypeshedFile: false,
            diagnosticsVersion: sourceFile.getDiagnosticVersion(),
            imports: [],
            importedBy: []
        };
        this._addToSourceFileListAndMap(sourceFileInfo);
        return sourceFile;
    }

    setFileOpened(filePath: string, version: number | null, contents: string) {
        let sourceFileInfo = this._sourceFileMap[filePath];
        if (!sourceFileInfo) {
            const sourceFile = new SourceFile(filePath, false, this._console);
            sourceFileInfo = {
                sourceFile,
                isTracked: false,
                isOpenByClient: true,
                isTypeshedFile: false,
                diagnosticsVersion: sourceFile.getDiagnosticVersion(),
                imports: [],
                importedBy: []
            };
            this._addToSourceFileListAndMap(sourceFileInfo);
        } else {
            sourceFileInfo.isOpenByClient = true;
        }

        sourceFileInfo.sourceFile.setClientVersion(version, contents);
    }

    setFileClosed(filePath: string): FileDiagnostics[] {
        const sourceFileInfo = this._sourceFileMap[filePath];
        if (sourceFileInfo) {
            sourceFileInfo.isOpenByClient = false;
            sourceFileInfo.sourceFile.setClientVersion(null, '');
        }

        return this._removeUnneededFiles();
    }

    markAllFilesDirty(evenIfContentsAreSame: boolean) {
        const markDirtyMap: { [path: string]: boolean } = {};

        this._sourceFileList.forEach(sourceFileInfo => {
            if (evenIfContentsAreSame) {
                sourceFileInfo.sourceFile.markDirty();
            } else if (sourceFileInfo.sourceFile.didContentsChangeOnDisk()) {
                sourceFileInfo.sourceFile.markDirty();

                // Mark any files that depend on this file as dirty
                // also. This will retrigger analysis of these other files.
                this._markFileDirtyRecursive(sourceFileInfo, markDirtyMap);
            }
        });
    }

    markFilesWithErrorsDirty(options: ConfigOptions) {
        const markDirtyMap: { [path: string]: boolean } = {};

        this._sourceFileList.forEach(sourceFileInfo => {
            const diagnostics = sourceFileInfo.sourceFile.getDiagnostics(options);
            if (diagnostics && !!diagnostics.find(
                    diag => diag.category === DiagnosticCategory.Error)) {

                sourceFileInfo.sourceFile.markDirty();

                // Mark any files that depend on this file as dirty
                // also. This will retrigger analysis of these other files.
                this._markFileDirtyRecursive(sourceFileInfo, markDirtyMap);
            }
        });
    }

    markFilesDirty(filePaths: string[]) {
        const markDirtyMap: { [path: string]: boolean } = {};
        filePaths.forEach(filePath => {
            const sourceFileInfo = this._sourceFileMap[filePath];
            if (sourceFileInfo) {
                sourceFileInfo.sourceFile.markDirty();

                // Mark any files that depend on this file as dirty
                // also. This will retrigger analysis of these other files.
                this._markFileDirtyRecursive(sourceFileInfo, markDirtyMap);
            }
        });
    }

    getSourceFile(filePath: string): SourceFile | undefined {
        const sourceFileInfo = this._sourceFileMap[filePath];
        if (!sourceFileInfo) {
            return undefined;
        }
        return sourceFileInfo.sourceFile;
    }

    // Performs parsing and analysis of any source files in the program
    // that require it. If a limit time is specified, the operation
    // is interrupted when the time expires. The return value indicates
    // whether the method needs to be called again to complete the
    // analysis. In interactive mode, the timeout is always limited
    // to the smaller value to maintain responsiveness.
    analyze(options: ConfigOptions, importResolver: ImportResolver,
            maxTime?: MaxAnalysisTime, interactiveMode?: boolean): boolean {

        const elapsedTime = new Duration();

        const openFiles = this._sourceFileList.filter(
            sf => sf.isOpenByClient && !sf.sourceFile.isAnalysisFinalized()
        );

        if (openFiles.length > 0) {
            const isTimeElapsedOpenFiles = () => {
                return maxTime !== undefined &&
                    elapsedTime.getDurationInMilliseconds() > maxTime.openFilesTimeInMs;
            };

            // Start by parsing the open files.
            for (const sourceFileInfo of openFiles) {
                this._parseFile(sourceFileInfo, options, importResolver);

                if (isTimeElapsedOpenFiles()) {
                    return true;
                }
            }

            // Now do semantic analysis of the open files.
            for (const sourceFileInfo of openFiles) {
                this._doSemanticAnalysis(sourceFileInfo, options, importResolver);

                if (isTimeElapsedOpenFiles()) {
                    return true;
                }
            }

            // Now do type analysis of the open files.
            for (const sourceFileInfo of openFiles) {
                if (this._doFullAnalysis(sourceFileInfo, options, importResolver, isTimeElapsedOpenFiles)) {
                    return true;
                }
            }

            // If the caller specified a maxTime, return at this point
            // since we've finalized all open files. We want to get
            // the results to the user as quickly as possible.
            if (maxTime !== undefined) {
                return true;
            }
        }

        // Do type analysis of remaining files.
        const allFiles = this._sourceFileList;

        const isTimeElapsedNoOpenFiles = () => {
            if (maxTime === undefined) {
                return false;
            }
            const effectiveMaxTime = interactiveMode ?
                maxTime.openFilesTimeInMs :
                maxTime.noOpenFilesTimeInMs;
            return elapsedTime.getDurationInMilliseconds() > effectiveMaxTime;
        };

        // Now do type parsing and analysis of the remaining.
        for (const sourceFileInfo of allFiles) {
            if (this._doFullAnalysis(sourceFileInfo, options, importResolver, isTimeElapsedNoOpenFiles)) {
                return true;
            }
        }

        return false;
    }

    // Prints import dependency information for each of the files in
    // the program, skipping any typeshed files.
    printDependencies(projectRootDir: string, verbose: boolean) {
        const sortedFiles = this._sourceFileList.filter(s => !s.isTypeshedFile).sort((a, b) => {
            return (a.sourceFile.getFilePath() < b.sourceFile.getFilePath()) ? 1 : -1;
        });

        const zeroImportFiles: SourceFile[] = [];

        sortedFiles.forEach(sfInfo => {
            this._console.log('');
            let filePath = sfInfo.sourceFile.getFilePath();
            const relPath = getRelativePath(filePath, projectRootDir);
            if (relPath) {
                filePath = relPath;
            }

            this._console.log(`${ filePath }`);

            this._console.log(` Imports     ${ sfInfo.imports.length } ` +
                `file${ sfInfo.imports.length === 1 ? '' : 's' }`);
            if (verbose) {
                sfInfo.imports.forEach(importInfo => {
                    this._console.log(`    ${ importInfo.sourceFile.getFilePath() }`);
                });
            }

            this._console.log(` Imported by ${ sfInfo.importedBy.length } ` +
                `file${ sfInfo.importedBy.length === 1 ? '' : 's' }`);
            if (verbose) {
                sfInfo.importedBy.forEach(importInfo => {
                    this._console.log(`    ${ importInfo.sourceFile.getFilePath() }`);
                });
            }

            if (sfInfo.importedBy.length === 0) {
                zeroImportFiles.push(sfInfo.sourceFile);
            }
        });

        if (zeroImportFiles.length > 0) {
            this._console.log('');
            this._console.log(`${ zeroImportFiles.length } file${ zeroImportFiles.length === 1 ? '' : 's' }` +
                ` not explicitly imported`);
            zeroImportFiles.forEach(importFile => {
                this._console.log(`    ${ importFile.getFilePath() }`);
            });
        }
    }

    printAnalysisPassDetails(projectRootDir: string) {
        const sortedFiles = this._sourceFileList.sort((a, b) => {
            // First sort alphabetically.
            return (a.sourceFile.getFilePath() < b.sourceFile.getFilePath()) ? 1 : -1;
        }).sort((a, b) => {
            // Then sort by pass count.
            const aPassCount = a.sourceFile.getAnalysisPassCount();
            const bPassCount = b.sourceFile.getAnalysisPassCount();
            return (aPassCount < bPassCount ? -1 : (aPassCount > bPassCount ? 1 : 0));
        });

        sortedFiles.forEach(sfInfo => {
            this._console.log('');
            let filePath = sfInfo.sourceFile.getFilePath();
            const relPath = getRelativePath(filePath, projectRootDir);
            if (relPath) {
                filePath = relPath;
            }
            this._console.log(`${ filePath }`);

            const analysisPassCount = sfInfo.sourceFile.getAnalysisPassCount();
            const lastRenalysisReason = sfInfo.sourceFile.getLastReanalysisReason();
            this._console.log(`  Analysis passes: ${ analysisPassCount }`);
            if (analysisPassCount > 1) {
                this._console.log(`  Reason for last reanalysis: ${ lastRenalysisReason }`);
            }
        });
    }

    writeTypeStub(targetImportPath: string, targetIsSingleFile: boolean, typingsPath: string) {
        for (const sourceFileInfo of this._sourceFileList) {
            const filePath = sourceFileInfo.sourceFile.getFilePath();

            // Generate type stubs only for the files within the target path,
            // not any files that the target module happened to import.
            const relativePath = getRelativePath(filePath, targetImportPath);
            if (relativePath !== undefined) {
                let typeStubPath = normalizePath(combinePaths(typingsPath, relativePath));

                // If the target is a single file implementation, as opposed to
                // a package in a directory, transform the name of the type stub
                // to __init__.pyi because we're placing it in a directory.
                if (targetIsSingleFile) {
                    typeStubPath = combinePaths(getDirectoryPath(typeStubPath), '__init__.pyi');
                } else {
                    typeStubPath = stripFileExtension(typeStubPath) + '.pyi';
                }

                const typeStubDir = getDirectoryPath(typeStubPath);

                try {
                    makeDirectories(typeStubDir, typingsPath);
                } catch (e) {
                    const errMsg = `Could not create directory for '${ typeStubDir }'`;
                    throw new Error(errMsg);
                }

                const writer = new TypeStubWriter(typeStubPath, sourceFileInfo.sourceFile);
                writer.write();
            }
        }
    }

    // This method is similar to analyze() except that it analyzes
    // a single file (and its dependencies if necessary).
    private _analyzeFile(sourceFileInfo: SourceFileInfo, options: ConfigOptions,
            importResolver: ImportResolver, maxTime?: MaxAnalysisTime) {

        const elapsedTime = new Duration();

        if (sourceFileInfo.sourceFile.isTypeAnalysisRequired()) {
            this._doFullAnalysis(sourceFileInfo, options, importResolver, () => {
                return maxTime !== undefined &&
                    elapsedTime.getDurationInMilliseconds() > maxTime.openFilesTimeInMs;
            });
        }
    }

    private _parseFile(fileToParse: SourceFileInfo, options: ConfigOptions,
            importResolver: ImportResolver) {

        if (!this._isFileNeeded(fileToParse) || !fileToParse.sourceFile.isParseRequired()) {
            return;
        }

        if (fileToParse.sourceFile.parse(options, importResolver)) {
            this._updateSourceFileImports(fileToParse, options);
        }

        if (fileToParse.sourceFile.isFileDeleted()) {
            fileToParse.isTracked = false;

            // Mark any files that depend on this file as dirty
            // also. This will retrigger analysis of these other files.
            const markDirtyMap: { [path: string]: boolean } = {};
            this._markFileDirtyRecursive(fileToParse, markDirtyMap);

            // Invalidate the import resolver's cache as well.
            importResolver.invalidateCache();
        }
    }

    private _doSemanticAnalysis(fileToAnalyze: SourceFileInfo,
            options: ConfigOptions, importResolver: ImportResolver) {

        if (!this._isFileNeeded(fileToAnalyze) || !fileToAnalyze.sourceFile.isSemanticAnalysisRequired()) {
            return;
        }

        this._parseFile(fileToAnalyze, options, importResolver);

        // We need to parse and semantically analyze the builtins import first.
        let builtinsScope: Scope | undefined;
        if (fileToAnalyze.builtinsImport) {
            this._doSemanticAnalysis(fileToAnalyze.builtinsImport, options, importResolver);

            // Get the builtins scope to pass to the semantic analyzer pass.
            const parseResults = fileToAnalyze.builtinsImport.sourceFile.getParseResults();
            if (parseResults) {
                builtinsScope = AnalyzerNodeInfo.getScope(parseResults.parseTree);
                assert(builtinsScope !== undefined);
            }
        }

        fileToAnalyze.sourceFile.doSemanticAnalysis(options, builtinsScope);
    }

    private _buildImportMap(sourceFileInfo: SourceFileInfo): ImportMap {
        const importMap: ImportMap = {};

        for (const importedFileInfo of sourceFileInfo.imports) {
            const parseResults = importedFileInfo.sourceFile.getParseResults();
            if (parseResults) {
                importMap[importedFileInfo.sourceFile.getFilePath()] = parseResults;
            }
        }

        return importMap;
    }

    // Build a map of all modules within this program and the module-
    // level scope that contains the symbol table for the module.
    private _buildModuleSymbolsMap(sourceFileToExclude?: SourceFileInfo): ModuleSymbolMap {
        const moduleSymbolMap: ModuleSymbolMap = {};

        this._sourceFileList.forEach(fileInfo => {
            if (fileInfo !== sourceFileToExclude) {
                const moduleScope = fileInfo.sourceFile.getModuleScope();
                if (moduleScope) {
                    moduleSymbolMap[fileInfo.sourceFile.getFilePath()] = moduleScope;
                }
            }
        });

        return moduleSymbolMap;
    }

    private _doFullAnalysis(fileToAnalyze: SourceFileInfo, options: ConfigOptions,
            importResolver: ImportResolver, timeElapsedCallback: () => boolean): boolean {

        // If the file isn't needed because it was eliminated from the
        // transitive closure or deleted, skip the file rather than wasting
        // time on it.
        if (!this._isFileNeeded(fileToAnalyze)) {
            return false;
        }

        // Discover all imports (recursively) that have not yet been finalized.
        const closureMap: { [path: string]: boolean } = {};
        const analysisQueue: SourceFileInfo[] = [];
        if (this._getNonFinalizedImportsRecursive(fileToAnalyze, closureMap,
                analysisQueue, options, importResolver, timeElapsedCallback, 0)) {
            return true;
        }

        // Perform type analysis on the files in the analysis queue, which
        // is ordered in a way that should minimize the number of passes
        // we need to perform (with lower-level imports earlier in the list).
        while (true) {
            const fileToAnalyze = analysisQueue.shift();
            if (!fileToAnalyze) {
                break;
            }

            closureMap[fileToAnalyze.sourceFile.getFilePath()] = false;

            if (fileToAnalyze.sourceFile.isTypeAnalysisRequired()) {
                // Build the import map for the file.
                const importMap = this._buildImportMap(fileToAnalyze);

                // Do a type analysis pass and determine if any internal changes occurred
                // during the pass. If so, continue to analyze until it stops changing and
                // mark all of its dependencies as needing to be reanalyzed.
                let didAnalysisChange = false;
                while (true) {
                    fileToAnalyze.sourceFile.doTypeAnalysis(options, importMap);

                    if (!fileToAnalyze.sourceFile.isTypeAnalysisRequired()) {
                        break;
                    } else {
                        didAnalysisChange = true;
                        if (timeElapsedCallback()) {
                            break;
                        }
                    }
                }

                // We completed one or more updates to the file in this type
                // analysis pass, so we need to add its dependencies back
                // onto the queue if they're not already on it.
                if (didAnalysisChange) {
                    for (const dependency of fileToAnalyze.importedBy) {
                        const dependencyFilePath = dependency.sourceFile.getFilePath();

                        // If the dependency isn't part of the closure, we can ignore it.
                        if (closureMap[dependencyFilePath] !== undefined) {
                            dependency.sourceFile.setTypeAnalysisPassNeeded();

                            if (!closureMap[dependencyFilePath]) {
                                analysisQueue.push(dependency);
                                closureMap[dependencyFilePath] = true;
                            }
                        }
                    }
                }

                if (timeElapsedCallback()) {
                    return true;
                }
            }
        }

        // Mark all files in the closure as finalized.
        Object.keys(closureMap).forEach(filePath => {
            assert(!this._sourceFileMap[filePath].sourceFile.isAnalysisFinalized());

            // Don't detect import cycles when doing type stub generation. Some
            // third-party modules are pretty convoluted.
            if (!this._allowThirdPartyImports) {
                if (options.diagnosticSettings.reportImportCycles !== 'none') {
                    this._detectAndReportImportCycles(this._sourceFileMap[filePath]);
                }
            }

            this._sourceFileMap[filePath].sourceFile.finalizeAnalysis();
        });

        return false;
    }

    // Builds a map of files that includes fileToAnalyze and all of the files
    // it imports (recursively) and ensures that all such files have been semantically
    // analyzed in preparation for the type analysis phase. If any of these files have
    // already been finalized (they and their recursive imports have completed the
    // type analysis phase), they are not included in the results. Also builds a
    // prioritized queue of files to analyze. Returns true if it ran out of time before
    // completing.
    private _getNonFinalizedImportsRecursive(fileToAnalyze: SourceFileInfo,
            closureMap: { [path: string]: boolean }, analysisQueue: SourceFileInfo[],
            options: ConfigOptions, importResolver: ImportResolver,
            timeElapsedCallback: () => boolean,
            recursionCount: number): boolean {

        // If the file is already finalized, no need to do any more work.
        if (fileToAnalyze.sourceFile.isAnalysisFinalized()) {
            return false;
        }

        // If the file is already in the closure map, we found a cyclical
        // dependency. Don't recurse further.
        const filePath = fileToAnalyze.sourceFile.getFilePath();
        if (closureMap[filePath] !== undefined) {
            return false;
        }

        // If the import chain is too long, emit an error. Otherwise we
        // risk blowing the stack.
        if (recursionCount > _maxImportDepth) {
            fileToAnalyze.sourceFile.setHitMaxImportDepth(_maxImportDepth);
            return false;
        }

        // Make sure the file is parsed and semantically analyzed.
        this._doSemanticAnalysis(fileToAnalyze, options, importResolver);
        if (timeElapsedCallback()) {
            return true;
        }

        // Add the file to the closure map.
        closureMap[filePath] = false;

        // Recursively add the file's imports.
        for (const importedFileInfo of fileToAnalyze.imports) {
            if (this._getNonFinalizedImportsRecursive(importedFileInfo, closureMap,
                    analysisQueue, options, importResolver,
                    timeElapsedCallback, recursionCount + 1)) {
                return true;
            }
        }

        // If the file hasn't already been added to the analysis queue,
        // add it now.
        if (!closureMap[filePath]) {
            closureMap[filePath] = true;
            analysisQueue.push(fileToAnalyze);
        }

        return false;
    }

    private _detectAndReportImportCycles(sourceFileInfo: SourceFileInfo,
            dependencyChain: SourceFileInfo[] = [],
            dependencyMap: { [path: string]: SourceFileInfo } = {}): boolean {

        // Don't bother checking for typestub files.
        if (sourceFileInfo.sourceFile.isStubFile()) {
            return false;
        }

        // Don't bother checking files that are already finalized
        // because they've already been searched.
        if (sourceFileInfo.sourceFile.isAnalysisFinalized()) {
            return false;
        }

        const filePath = sourceFileInfo.sourceFile.getFilePath();
        if (dependencyMap[filePath]) {
            // Look for chains at least two in length. A file that contains
            // an "import . from X" will technically create a cycle with
            // itself, but those are not interesting to report.
            if (dependencyChain.length > 1 && sourceFileInfo === dependencyChain[0]) {
                this._logImportCycle(dependencyChain);
                return true;
            }
            return false;
        } else {
            // We use both a map (for fast lookups) and a list
            // (for ordering information).
            dependencyMap[filePath] = sourceFileInfo;
            dependencyChain.push(sourceFileInfo);

            let reportedCycle = false;
            for (const imp of sourceFileInfo.imports) {
                if (this._detectAndReportImportCycles(imp, dependencyChain, dependencyMap)) {
                    reportedCycle = true;
                }
            }

            delete dependencyMap[filePath];
            dependencyChain.pop();

            return reportedCycle;
        }
    }

    private _logImportCycle(dependencyChain: SourceFileInfo[]) {
        const circDep = new CircularDependency();
        dependencyChain.forEach(sourceFileInfo => {
            circDep.appendPath(sourceFileInfo.sourceFile.getFilePath());
        });

        circDep.normalizeOrder();
        const firstFilePath = circDep.getPaths()[0];
        const firstSourceFile = this._sourceFileMap[firstFilePath];
        assert(firstSourceFile !== undefined);
        firstSourceFile.sourceFile.addCircularDependency(circDep);
    }

    private _markFileDirtyRecursive(sourceFileInfo: SourceFileInfo,
            markMap: { [path: string]: boolean }) {

        const filePath = sourceFileInfo.sourceFile.getFilePath();

        // Don't mark it again if it's already been visited.
        if (markMap[filePath] === undefined) {
            sourceFileInfo.sourceFile.markReanalysisRequired();
            markMap[filePath] = true;

            sourceFileInfo.importedBy.forEach(dep => {
                this._markFileDirtyRecursive(dep, markMap);
            });
        }
    }

    getDiagnostics(options: ConfigOptions): FileDiagnostics[] {
        const fileDiagnostics: FileDiagnostics[] = this._removeUnneededFiles();

        this._sourceFileList.forEach(sourceFileInfo => {
            const diagnostics = sourceFileInfo.sourceFile.getDiagnostics(
                    options, sourceFileInfo.diagnosticsVersion);
            if (diagnostics !== undefined) {
                fileDiagnostics.push({
                    filePath: sourceFileInfo.sourceFile.getFilePath(),
                    diagnostics
                });

                // Update the cached diagnosticsVersion so we can determine
                // whether there are any updates next time we call getDiagnostics.
                sourceFileInfo.diagnosticsVersion =
                    sourceFileInfo.sourceFile.getDiagnosticVersion();
            }
        });

        return fileDiagnostics;
    }

    getDiagnosticsForRange(filePath: string, options: ConfigOptions, range: DiagnosticTextRange): Diagnostic[] {
        const sourceFile = this.getSourceFile(filePath);
        if (!sourceFile) {
            return [];
        }

        const unfilteredDiags = sourceFile.getDiagnostics(options);
        if (!unfilteredDiags) {
            return [];
        }

        return unfilteredDiags.filter(diag => {
            return doRangesOverlap(diag.range, range);
        });
    }

    getDefinitionsForPosition(filePath: string, position: DiagnosticTextPosition):
            DocumentTextRange[] | undefined {

        const sourceFile = this.getSourceFile(filePath);
        if (!sourceFile) {
            return undefined;
        }

        return sourceFile.getDefinitionsForPosition(position);
    }

    getReferencesForPosition(filePath: string, position: DiagnosticTextPosition,
            options: ConfigOptions, importResolver: ImportResolver,
            includeDeclaration: boolean): DocumentTextRange[] | undefined {

        const sourceFileInfo = this._sourceFileMap[filePath];
        if (!sourceFileInfo) {
            return undefined;
        }

        if (sourceFileInfo.sourceFile.isTypeAnalysisRequired()) {
            this._analyzeFile(sourceFileInfo, options, importResolver, {
                openFilesTimeInMs: _maxAnalysisTimeForCompletions,
                noOpenFilesTimeInMs: _maxAnalysisTimeForCompletions
            });
        }

        const referencesResult = sourceFileInfo.sourceFile.getReferencesForPosition(
            position, includeDeclaration);

        if (!referencesResult) {
            return undefined;
        }

        // Do we need to do a global search as well?
        if (referencesResult.requiresGlobalSearch) {
            for (const curSourceFileInfo of this._sourceFileList) {
                if (curSourceFileInfo !== sourceFileInfo) {
                    if (curSourceFileInfo.sourceFile.isTypeAnalysisRequired()) {
                        this._analyzeFile(curSourceFileInfo, options, importResolver, {
                            openFilesTimeInMs: _maxAnalysisTimeForCompletions,
                            noOpenFilesTimeInMs: _maxAnalysisTimeForCompletions
                        });
                    }

                    curSourceFileInfo.sourceFile.addReferences(referencesResult,
                        includeDeclaration);
                }
            }
        }

        return referencesResult.locations;
    }

    getSymbolsForDocument(filePath: string): SymbolInformation[] {
        const sourceFileInfo = this._sourceFileMap[filePath];
        if (!sourceFileInfo) {
            return [];
        }

        return sourceFileInfo.sourceFile.getSymbolsForDocument();
    }

    getHoverForPosition(filePath: string, position: DiagnosticTextPosition):
            HoverResults | undefined {

        const sourceFileInfo = this._sourceFileMap[filePath];
        if (!sourceFileInfo) {
            return undefined;
        }

        return sourceFileInfo.sourceFile.getHoverForPosition(position,
            this._buildImportMap(sourceFileInfo));
    }

    getSignatureHelpForPosition(filePath: string, position: DiagnosticTextPosition,
            options: ConfigOptions, importResolver: ImportResolver): SignatureHelpResults | undefined {

        const sourceFileInfo = this._sourceFileMap[filePath];
        if (!sourceFileInfo) {
            return undefined;
        }

        if (sourceFileInfo.sourceFile.isTypeAnalysisRequired()) {
            this._analyzeFile(sourceFileInfo, options, importResolver, {
                openFilesTimeInMs: _maxAnalysisTimeForCompletions,
                noOpenFilesTimeInMs: _maxAnalysisTimeForCompletions
            });
        }

        return sourceFileInfo.sourceFile.getSignatureHelpForPosition(position);
    }

    getCompletionsForPosition(filePath: string, position: DiagnosticTextPosition,
        options: ConfigOptions, importResolver: ImportResolver): CompletionList | undefined {

        const sourceFileInfo = this._sourceFileMap[filePath];
        if (!sourceFileInfo) {
            return undefined;
        }

        if (sourceFileInfo.sourceFile.isTypeAnalysisRequired()) {
            this._analyzeFile(sourceFileInfo, options, importResolver, {
                openFilesTimeInMs: _maxAnalysisTimeForCompletions,
                noOpenFilesTimeInMs: _maxAnalysisTimeForCompletions
            });

            // If we ran out of time before completing the type
            // analysis, do our best.
        }

        return sourceFileInfo.sourceFile.getCompletionsForPosition(
            position, options, importResolver,
            () => this._buildImportMap(sourceFileInfo),
            () => this._buildModuleSymbolsMap(sourceFileInfo));
    }

    sortImports(filePath: string, options: ConfigOptions,
            importResolver: ImportResolver): TextEditAction[] | undefined {

        const sourceFileInfo = this._sourceFileMap[filePath];
        if (!sourceFileInfo) {
            return undefined;
        }

        if (sourceFileInfo.sourceFile.isTypeAnalysisRequired()) {
            this._analyzeFile(sourceFileInfo, options, importResolver, {
                openFilesTimeInMs: _maxAnalysisTimeForCompletions,
                noOpenFilesTimeInMs: _maxAnalysisTimeForCompletions
            });
        }

        return sourceFileInfo.sourceFile.sortImports();
    }

    renameSymbolAtPosition(filePath: string, position: DiagnosticTextPosition,
            newName: string, options: ConfigOptions,
            importResolver: ImportResolver): FileEditAction[] | undefined {

        const sourceFileInfo = this._sourceFileMap[filePath];
        if (!sourceFileInfo) {
            return undefined;
        }

        const referencesResult = sourceFileInfo.sourceFile.getReferencesForPosition(
            position, true);

        if (!referencesResult) {
            return undefined;
        }

        // Do we need to do a global search as well?
        if (referencesResult.requiresGlobalSearch) {
            for (const curSourceFileInfo of this._sourceFileList) {
                if (curSourceFileInfo !== sourceFileInfo) {
                    if (curSourceFileInfo.sourceFile.isTypeAnalysisRequired()) {
                        this._analyzeFile(curSourceFileInfo, options, importResolver, {
                            openFilesTimeInMs: _maxAnalysisTimeForCompletions,
                            noOpenFilesTimeInMs: _maxAnalysisTimeForCompletions
                        });
                    }

                    curSourceFileInfo.sourceFile.addReferences(referencesResult, true);
                }
            }
        }

        const editActions: FileEditAction[] = [];

        referencesResult.locations.forEach(loc => {
            editActions.push({
                filePath: loc.path,
                range: loc.range,
                replacementText: newName
            });
        });

        return editActions;
    }

    // Returns a list of empty file diagnostic entries for the files
    // that have been removed. This is needed to clear out the
    // errors for files that have been deleted or closed.
    private _removeUnneededFiles(): FileDiagnostics[] {
        const fileDiagnostics: FileDiagnostics[] = [];

        // If a file is no longer tracked or opened, it can
        // be removed from the program.
        for (let i = 0; i < this._sourceFileList.length; ) {
            const fileInfo = this._sourceFileList[i];
            if (!this._isFileNeeded(fileInfo)) {
                fileDiagnostics.push({
                    filePath: fileInfo.sourceFile.getFilePath(),
                    diagnostics: []
                });

                fileInfo.sourceFile.prepareForClose();
                delete this._sourceFileMap[fileInfo.sourceFile.getFilePath()];
                this._sourceFileList.splice(i, 1);

                // Unlink any imports and remove them from the list if
                // they are no longer referenced.
                fileInfo.imports.forEach(importedFile => {
                    const indexToRemove = importedFile.importedBy.findIndex(fi => fi === fileInfo);
                    assert(indexToRemove >= 0);
                    importedFile.importedBy.splice(indexToRemove, 1);

                    // See if we need to remove the imported file because it
                    // is no longer needed. If its index is >= i, it will be
                    // removed when we get to it.
                    if (!this._isFileNeeded(importedFile)) {
                        const indexToRemove = this._sourceFileList.findIndex(fi => fi === importedFile);
                        if (indexToRemove >= 0 && indexToRemove < i) {
                            fileDiagnostics.push({
                                filePath: importedFile.sourceFile.getFilePath(),
                                diagnostics: []
                            });

                            importedFile.sourceFile.prepareForClose();
                            delete this._sourceFileMap[importedFile.sourceFile.getFilePath()];
                            this._sourceFileList.splice(indexToRemove, 1);
                            i--;
                        }
                    }
                });
            } else {
                i++;
            }
        }

        return fileDiagnostics;
    }

    private _isFileNeeded(fileInfo: SourceFileInfo) {
        if (fileInfo.sourceFile.isFileDeleted()) {
            return false;
        }

        if (fileInfo.isTracked || fileInfo.isOpenByClient) {
            return true;
        }

        if (fileInfo.importedBy.length === 0) {
            return false;
        }

        // It's possible for a cycle of files to be imported
        // by a tracked file but then abandoned. The import cycle
        // will keep the entire group "alive" if we don't detect
        // the condition and garbage collect them.
        return this._isImportNeededRecursive(fileInfo, {});
    }

    private _isImportNeededRecursive(fileInfo: SourceFileInfo, recursionMap: { [path: string ]: boolean }) {
        if (fileInfo.isTracked || fileInfo.isOpenByClient) {
            return true;
        }

        const filePath = fileInfo.sourceFile.getFilePath();

        // Avoid infinite recursion.
        if (recursionMap[filePath]) {
            return false;
        }

        recursionMap[filePath] = true;

        for (const importerInfo of fileInfo.importedBy) {
            if (this._isImportNeededRecursive(importerInfo, recursionMap)) {
                return true;
            }
        }

        return false;
    }

    private _updateSourceFileImports(sourceFileInfo: SourceFileInfo,
            options: ConfigOptions): SourceFileInfo[] {

        const filesAdded: SourceFileInfo[] = [];

        // Get the new list of imports and see if it changed from the last
        // list of imports for this file.
        const imports = sourceFileInfo.sourceFile.getImports();

        // Create a map of unique imports, since imports can appear more than once.
        const newImportPathMap: { [name: string]: boolean } =  {};
        imports.forEach(importResult => {
            if (importResult.isImportFound) {
                // Don't explore any third-party files unless they're type stub files
                // or we've been told explicitly that third-party imports are OK.
                if (importResult.importType === ImportType.Local || importResult.isStubFile ||
                        this._allowThirdPartyImports) {

                    // Namespace packages have no __init__.py file, so the resolved
                    // path points to a directory.
                    if (!importResult.isNamespacePackage && importResult.resolvedPaths.length > 0) {
                        const filePath = importResult.resolvedPaths[
                            importResult.resolvedPaths.length - 1];
                        newImportPathMap[filePath] = !!importResult.isTypeshedFile;
                    }

                    importResult.implicitImports.forEach(implicitImport => {
                        newImportPathMap[implicitImport.path] = !!importResult.isTypeshedFile;
                    });
                }
            } else if (options.verboseOutput) {
                if (!sourceFileInfo.isTypeshedFile || options.diagnosticSettings.reportTypeshedErrors) {
                    this._console.log(`Could not import '${ importResult.importName }' ` +
                        `in file '${ sourceFileInfo.sourceFile.getFilePath() }'`);
                    if (importResult.importFailureInfo) {
                        importResult.importFailureInfo.forEach(diag => {
                            this._console.log(`  ${ diag }`);
                        });
                    }
                }
            }
        });

        const updatedImportMap: { [name: string]: SourceFileInfo } = {};
        sourceFileInfo.imports.forEach(importInfo => {
            const oldFilePath = importInfo.sourceFile.getFilePath();

            // A previous import was removed.
            if (newImportPathMap[oldFilePath] === undefined) {
                importInfo.importedBy = importInfo.importedBy.filter(
                    fi => fi.sourceFile.getFilePath() !== sourceFileInfo.sourceFile.getFilePath());
            } else {
                updatedImportMap[oldFilePath] = importInfo;
            }
        });

        // See if there are any new imports to be added.
        Object.keys(newImportPathMap).forEach(importPath => {
            if (updatedImportMap[importPath] === undefined) {
                // We found a new import to add. See if it's already part
                // of the program.
                let importedFileInfo: SourceFileInfo;
                if (this._sourceFileMap[importPath] !== undefined) {
                    importedFileInfo = this._sourceFileMap[importPath];
                } else {
                    const isTypeShedFile = newImportPathMap[importPath];
                    const sourceFile = new SourceFile(
                        importPath, isTypeShedFile, this._console);
                    importedFileInfo = {
                        sourceFile,
                        isTracked: false,
                        isOpenByClient: false,
                        isTypeshedFile: isTypeShedFile,
                        diagnosticsVersion: sourceFile.getDiagnosticVersion(),
                        imports: [],
                        importedBy: []
                    };

                    this._addToSourceFileListAndMap(importedFileInfo);
                    filesAdded.push(importedFileInfo);
                }

                importedFileInfo.importedBy.push(sourceFileInfo);
                updatedImportMap[importPath] = importedFileInfo;
            }
        });

        // Update the imports list. It should now map the set of imports
        // specified by the source file.
        sourceFileInfo.imports = Object.keys(newImportPathMap).map(
            importPath => this._sourceFileMap[importPath]);

        // Resolve the builtins import for the file. This needs to be
        // analyzed before the file can be analyzed.
        sourceFileInfo.builtinsImport = undefined;
        const builtinsImport = sourceFileInfo.sourceFile.getBuiltinsImport();
        if (builtinsImport) {
            const resolvedBuiltinsPath = builtinsImport.resolvedPaths[
                builtinsImport.resolvedPaths.length - 1];
            sourceFileInfo.builtinsImport = this._sourceFileMap[resolvedBuiltinsPath];
        }

        return filesAdded;
    }

    private _addToSourceFileListAndMap(fileInfo: SourceFileInfo) {
        const filePath = fileInfo.sourceFile.getFilePath();

        // We should never add a file with the same path twice.
        assert(this._sourceFileMap[filePath] === undefined);

        this._sourceFileList.push(fileInfo);
        this._sourceFileMap[filePath] = fileInfo;
    }
}
