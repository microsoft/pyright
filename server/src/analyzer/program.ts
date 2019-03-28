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

import { ConfigOptions } from '../common/configOptions';
import { ConsoleInterface, StandardConsole } from '../common/console';
import { DiagnosticTextPosition, DocumentTextRange } from '../common/diagnostic';
import { FileDiagnostics } from '../common/diagnosticSink';
import { Duration } from '../common/timing';
import { ImportMap } from './analyzerFileInfo';
import { AnalyzerNodeInfo } from './analyzerNodeInfo';
import { ImportType } from './importResult';
import { Scope } from './scope';
import { SourceFile } from './sourceFile';

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

    constructor(console?: ConsoleInterface) {
        this._console = console || new StandardConsole();
    }

    // Sets the list of tracked files that make up the program.
    setTrackedFiles(filePaths: string[]): FileDiagnostics[] {
        if (this._sourceFileList.length > 0) {
            // We need to determine which files to remove from the existing file list.
            let newFileMap: { [path: string]: string } = {};
            filePaths.forEach(path => {
                newFileMap[path] = path;
            });

            // Files that are not in the tracked file list are
            // marked as no longer tracked.
            this._sourceFileList.forEach(oldFile => {
                let filePath = oldFile.sourceFile.getFilePath();
                if (newFileMap[filePath] === undefined) {
                    oldFile.isTracked = false;
                }
            });
        }

        // Add the new files. Only the new items will be added.
        this.addTrackedFiles(filePaths);

        return this._removeUnneededFiles();
    }

    getFileCount() {
        return this._sourceFileList.length;
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

        let sourceFile = new SourceFile(filePath, false, this._console);
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
            let sourceFile = new SourceFile(filePath, false, this._console);
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
        let sourceFileInfo = this._sourceFileMap[filePath];
        if (sourceFileInfo) {
            sourceFileInfo.isOpenByClient = false;
            sourceFileInfo.sourceFile.setClientVersion(null, '');
        }

        return this._removeUnneededFiles();
    }

    markAllFilesDirty() {
        this._sourceFileList.forEach(sourceFileInfo => {
            sourceFileInfo.sourceFile.markDirty();
        });
    }

    markFilesDirty(filePaths: string[]) {
        let markDirtyMap: { [path: string]: boolean } = {};
        filePaths.forEach(filePath => {
            let sourceFileInfo = this._sourceFileMap[filePath];
            if (sourceFileInfo) {
                sourceFileInfo.sourceFile.markDirty();

                // Mark any files that depend on this file as dirty
                // also. This will retrigger analysis of these other files.
                this._markFileDirtyRecursive(sourceFileInfo, markDirtyMap);
            }
        });
    }

    getSourceFile(filePath: string): SourceFile | undefined {
        let sourceFileInfo = this._sourceFileMap[filePath];
        if (!sourceFileInfo) {
            return undefined;
        }
        return sourceFileInfo.sourceFile;
    }

    // Performs parsing and analysis of any source files in the program
    // that require it. If a limit time is specified, the operation
    // is interrupted when the time expires. The return value indicates
    // whether the method needs to be called again to complete the
    // analysis.
    analyze(options: ConfigOptions, maxTime?: MaxAnalysisTime): boolean {
        let elapsedTime = new Duration();

        let openFiles = this._sourceFileList.filter(sf => sf.isOpenByClient);

        if (openFiles.length > 0) {
            let isTimeElapsedOpenFiles = () => {
                return maxTime !== undefined &&
                    elapsedTime.getDurationInMilliseconds() > maxTime.openFilesTimeInMs;
            };

            // Start by parsing the open files.
            for (let sourceFileInfo of openFiles) {
                this._parseFile(sourceFileInfo, options);

                if (isTimeElapsedOpenFiles()) {
                    return true;
                }
            }

            // Now do semantic analysis of the open files.
            for (let sourceFileInfo of openFiles) {
                this._doSemanticAnalysis(sourceFileInfo, options);

                if (isTimeElapsedOpenFiles()) {
                    return true;
                }
            }

            // Now do type analysis of the open files.
            for (let sourceFileInfo of openFiles) {
                if (this._doFullAnalysis(sourceFileInfo, options, isTimeElapsedOpenFiles)) {
                    return true;
                }
            }
        }

        // Do type analysis of remaining files.
        let allFiles = this._sourceFileList;

        let isTimeElapsedNoOpenFiles = () => {
            return maxTime !== undefined &&
                elapsedTime.getDurationInMilliseconds() > maxTime.noOpenFilesTimeInMs;
        };

        // Now do type parsing and analysis of the remaining.
        for (let sourceFileInfo of allFiles) {
            if (this._doFullAnalysis(sourceFileInfo, options, isTimeElapsedNoOpenFiles)) {
                return true;
            }
        }

        return false;
    }

    private _parseFile(fileToParse: SourceFileInfo, options: ConfigOptions) {
        if (!this._isFileNeeded(fileToParse) || !fileToParse.sourceFile.isParseRequired()) {
            return;
        }

        if (fileToParse.sourceFile.parse(options)) {
            this._updateSourceFileImports(fileToParse);
        }
    }

    private _doSemanticAnalysis(fileToAnalyze: SourceFileInfo, options: ConfigOptions) {
        if (!this._isFileNeeded(fileToAnalyze) || !fileToAnalyze.sourceFile.isSemanticAnalysisRequired()) {
            return;
        }

        this._parseFile(fileToAnalyze, options);

        // We need to parse and semantically analyze the builtins import first.
        let builtinsScope: Scope | undefined;
        if (fileToAnalyze.builtinsImport) {
            this._doSemanticAnalysis(fileToAnalyze.builtinsImport, options);

            // Get the builtins scope to pass to the semantic analyzer pass.
            const parseResults = fileToAnalyze.builtinsImport.sourceFile.getParseResults();
            if (parseResults) {
                builtinsScope = AnalyzerNodeInfo.getScope(parseResults.parseTree);
                assert(builtinsScope !== undefined);
            }
        }

        fileToAnalyze.sourceFile.doSemanticAnalysis(options, builtinsScope);
    }

    private _doFullAnalysis(fileToAnalyze: SourceFileInfo, options: ConfigOptions,
            timeElapsedCallback: () => boolean): boolean {
        // If the file isn't needed because it was eliminated from the
        // transitive closure or deleted, skip the file rather than wasting
        // time on it.
        if (!this._isFileNeeded(fileToAnalyze)) {
            return false;
        }

        // Discover all imports (recursively) that have not yet been finalized.
        let closureMap: { [path: string]: boolean } = {};
        let analysisQueue: SourceFileInfo[] = [];
        if (this._getNonFinalizedImportsRecursive(fileToAnalyze, closureMap,
                analysisQueue, options, timeElapsedCallback)) {
            return true;
        }

        // Perform type analysis on the files in the analysis queue, which
        // is ordered in a way that should minimize the number of passes
        // we need to perform (with lower-level imports earlier in the list).
        while (true) {
            let fileToAnalyze = analysisQueue.shift();
            if (!fileToAnalyze) {
                break;
            }

            closureMap[fileToAnalyze.sourceFile.getFilePath()] = false;

            if (fileToAnalyze.sourceFile.isTypeAnalysisRequired()) {
                // Build the import map for the file.
                let importMap: ImportMap = {};
                for (let importedFileInfo of fileToAnalyze.imports) {
                    let parseResults = importedFileInfo.sourceFile.getParseResults();
                    if (parseResults) {
                        importMap[importedFileInfo.sourceFile.getFilePath()] = parseResults;
                    }
                }

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
                    }
                }

                // We completed one or more updates to the file in this type
                // analysis pass, so we need to add its dependencies back
                // onto the queue if they're not already on it.
                if (didAnalysisChange) {
                    for (let dependency of fileToAnalyze.importedBy) {
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
            options: ConfigOptions, timeElapsedCallback: () => boolean): boolean {
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

        // Make sure the file is parsed and semantically analyzed.
        this._doSemanticAnalysis(fileToAnalyze, options);
        if (timeElapsedCallback()) {
            return true;
        }

        // Add the file to the closure map.
        closureMap[filePath] = false;

        // Recursively add the file's imports.
        for (let importedFileInfo of fileToAnalyze.imports) {
            if (this._getNonFinalizedImportsRecursive(importedFileInfo, closureMap,
                    analysisQueue, options, timeElapsedCallback)) {
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

    private _markFileDirtyRecursive(sourceFileInfo: SourceFileInfo,
            markMap: { [path: string]: boolean }) {
        let filePath = sourceFileInfo.sourceFile.getFilePath();

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
        let fileDiagnostics: FileDiagnostics[] = this._removeUnneededFiles();

        this._sourceFileList.forEach(sourceFileInfo => {
            let diagnostics = sourceFileInfo.sourceFile.getDiagnostics(
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

    getDefinitionForPosition(filePath: string, position: DiagnosticTextPosition):
            DocumentTextRange | undefined {
        let sourceFile = this.getSourceFile(filePath);
        if (!sourceFile) {
            return undefined;
        }

        return sourceFile.getDefinitionForPosition(position);
    }

    getHoverForPosition(filePath: string, position: DiagnosticTextPosition):
            string | undefined {
        let sourceFile = this.getSourceFile(filePath);
        if (!sourceFile) {
            return undefined;
        }

        return sourceFile.getHoverForPosition(position);
    }

    // Returns a list of empty file diagnostic entries for the files
    // that have been removed. This is needed to clear out the
    // errors for files that have been deleted or closed.
    private _removeUnneededFiles(): FileDiagnostics[] {
        let fileDiagnostics: FileDiagnostics[] = [];

        // If a file is no longer tracked or opened, it can
        // be removed from the program.
        for (let i = 0; i < this._sourceFileList.length; ) {
            let fileInfo = this._sourceFileList[i];
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
                    let indexToRemove = importedFile.importedBy.findIndex(fi => fi === fileInfo);
                    assert(indexToRemove >= 0);
                    importedFile.importedBy.splice(indexToRemove, 1);

                    // See if we need to remove the imported file because it
                    // is no longer needed. If its index is >= i, it will be
                    // removed when we get to it.
                    if (!this._isFileNeeded(importedFile)) {
                        let indexToRemove = this._sourceFileList.findIndex(fi => fi === importedFile);
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

        for (let importerInfo of fileInfo.importedBy) {
            if (this._isImportNeededRecursive(importerInfo, recursionMap)) {
                return true;
            }
        }

        return false;
    }

    private _updateSourceFileImports(sourceFileInfo: SourceFileInfo): SourceFileInfo[] {
        let filesAdded: SourceFileInfo[] = [];

        // Get the new list of imports and see if it changed from the last
        // list of imports for this file.
        let imports = sourceFileInfo.sourceFile.getImports();

        // Create a map of unique imports, since imports can appear more than once.
        let newImportPathMap: { [name: string]: boolean } = {};
        imports.forEach(importResult => {
            if (importResult.importFound && importResult.resolvedPaths.length > 0) {
                if (importResult.importType === ImportType.Local || importResult.isStubFile) {
                    // Namespace packages have no __init__.py file, so the resolved
                    // path points to a directory.
                    if (!importResult.isNamespacePackage) {
                        let filePath = importResult.resolvedPaths[
                            importResult.resolvedPaths.length - 1];
                        newImportPathMap[filePath] = !!importResult.isTypeshedFile;
                    }

                    importResult.implicitImports.forEach(implicitImport => {
                        newImportPathMap[implicitImport.path] = !!importResult.isTypeshedFile;
                    });
                }
            }
        });

        let updatedImportMap: { [name: string]: SourceFileInfo } = {};
        sourceFileInfo.imports.forEach(importInfo => {
            let oldFilePath = importInfo.sourceFile.getFilePath();

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
                    let sourceFile = new SourceFile(
                        importPath, newImportPathMap[importPath], this._console);
                    importedFileInfo = {
                        sourceFile,
                        isTracked: false,
                        isOpenByClient: false,
                        isTypeshedFile: newImportPathMap[importPath],
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
        let builtinsImport = sourceFileInfo.sourceFile.getBuiltinsImport();
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
