/*
* program.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* An object that tracks all of the source files being analyzed
* and all of their recursive imports.
*/

import { CompletionItem, CompletionList, DocumentSymbol, SymbolInformation } from 'vscode-languageserver';

import { ConfigOptions } from '../common/configOptions';
import { ConsoleInterface, StandardConsole } from '../common/console';
import { assert } from '../common/debug';
import { Diagnostic } from '../common/diagnostic';
import { FileDiagnostics } from '../common/diagnosticSink';
import { FileEditAction, TextEditAction } from '../common/editAction';
import {
    combinePaths, getDirectoryPath, getRelativePath, makeDirectories,
    normalizePath, stripFileExtension
} from '../common/pathUtils';
import { DocumentRange, doRangesOverlap, Position, Range } from '../common/textRange';
import { Duration, timingStats } from '../common/timing';
import { ModuleSymbolMap } from '../languageService/completionProvider';
import { HoverResults } from '../languageService/hoverProvider';
import { SignatureHelpResults } from '../languageService/signatureHelpProvider';
import { ImportLookupResult } from './analyzerFileInfo';
import * as AnalyzerNodeInfo from './analyzerNodeInfo';
import { CircularDependency } from './circularDependency';
import { ImportResolver } from './importResolver';
import { ImportResult, ImportType } from './importResult';
import { Scope } from './scope';
import { SourceFile } from './sourceFile';
import { SymbolTable } from './symbol';
import { createTypeEvaluator, TypeEvaluator } from './typeEvaluator';
import { TypeStubWriter } from './typeStubWriter';

const _maxImportDepth = 256;

export interface SourceFileInfo {
    sourceFile: SourceFile;
    isTracked: boolean;
    isOpenByClient: boolean;
    isTypeshedFile: boolean;
    isThirdPartyImport: boolean;
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

interface UpdateImportInfo {
    isTypeshedFile: boolean;
    isThirdPartyImport: boolean;
}

// Container for all of the files that are being analyzed. Files
// can fall into one or more of the following categories:
//  Tracked - specified by the config options
//  Referenced - part of the transitive closure
//  Opened - temporarily opened in the editor
export class Program {
    private _console: ConsoleInterface;
    private _sourceFileList: SourceFileInfo[] = [];
    private _sourceFileMap = new Map<string, SourceFileInfo>();
    private _allowedThirdPartyImports: string[] | undefined;
    private _evaluator: TypeEvaluator;
    private _configOptions: ConfigOptions;
    private _importResolver: ImportResolver;

    constructor(initialImportResolver: ImportResolver, initialConfigOptions: ConfigOptions,
        console?: ConsoleInterface) {
        this._console = console || new StandardConsole();
        this._evaluator = createTypeEvaluator(this._lookUpImport);
        this._importResolver = initialImportResolver;
        this._configOptions = initialConfigOptions;
    }

    setConfigOptions(configOptions: ConfigOptions) {
        this._configOptions = configOptions;
    }

    setImportResolver(importResolver: ImportResolver) {
        this._importResolver = importResolver;
    }

    // Sets the list of tracked files that make up the program.
    setTrackedFiles(filePaths: string[]): FileDiagnostics[] {
        if (this._sourceFileList.length > 0) {
            // We need to determine which files to remove from the existing file list.
            const newFileMap = new Map<string, string>();
            filePaths.forEach(path => {
                newFileMap.set(path, path);
            });

            // Files that are not in the tracked file list are
            // marked as no longer tracked.
            this._sourceFileList.forEach(oldFile => {
                const filePath = oldFile.sourceFile.getFilePath();
                if (!newFileMap.has(filePath)) {
                    oldFile.isTracked = false;
                }
            });
        }

        // Add the new files. Only the new items will be added.
        this.addTrackedFiles(filePaths);

        return this._removeUnneededFiles();
    }

    // By default, no third-party imports are allowed. This enables
    // third-party imports for a specified import and its children.
    // For example, if importNames is ['tensorflow'], then third-party
    // (absolute) imports are allowed for 'import tensorflow',
    // 'import tensorflow.optimizers', etc.
    setAllowedThirdPartyImports(importNames: string[]) {
        this._allowedThirdPartyImports = importNames;
    }

    getFileCount() {
        return this._sourceFileList.length;
    }

    getFilesToAnalyzeCount() {
        let sourceFileCount = 0;

        this._sourceFileList.forEach(fileInfo => {
            if (fileInfo.sourceFile.isParseRequired() ||
                fileInfo.sourceFile.isBindingRequired() ||
                fileInfo.sourceFile.isCheckingRequired()) {

                if ((!this._configOptions.checkOnlyOpenFiles && fileInfo.isTracked) || fileInfo.isOpenByClient) {
                    sourceFileCount++;
                }
            }
        });

        return sourceFileCount;
    }

    isCheckingOnlyOpenFiles() {
        return this._configOptions.checkOnlyOpenFiles;
    }

    addTrackedFiles(filePaths: string[]) {
        filePaths.forEach(filePath => {
            this.addTrackedFile(filePath);
        });
    }

    addTrackedFile(filePath: string): SourceFile {
        let sourceFileInfo = this._sourceFileMap.get(filePath);
        if (sourceFileInfo) {
            sourceFileInfo.isTracked = true;
            return sourceFileInfo.sourceFile;
        }

        const sourceFile = new SourceFile(this._fs, filePath, false, false, this._console);
        sourceFileInfo = {
            sourceFile,
            isTracked: true,
            isOpenByClient: false,
            isTypeshedFile: false,
            isThirdPartyImport: false,
            diagnosticsVersion: sourceFile.getDiagnosticVersion(),
            imports: [],
            importedBy: []
        };
        this._addToSourceFileListAndMap(sourceFileInfo);
        return sourceFile;
    }

    setFileOpened(filePath: string, version: number | null, contents: string) {
        let sourceFileInfo = this._sourceFileMap.get(filePath);
        if (!sourceFileInfo) {
            const sourceFile = new SourceFile(this._fs, filePath, false, false, this._console);
            sourceFileInfo = {
                sourceFile,
                isTracked: false,
                isOpenByClient: true,
                isTypeshedFile: false,
                isThirdPartyImport: false,
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
        const sourceFileInfo = this._sourceFileMap.get(filePath);
        if (sourceFileInfo) {
            sourceFileInfo.isOpenByClient = false;
            sourceFileInfo.sourceFile.setClientVersion(null, '');
        }

        return this._removeUnneededFiles();
    }

    markAllFilesDirty(evenIfContentsAreSame: boolean) {
        const markDirtyMap = new Map<string, boolean>();

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

        if (markDirtyMap.size > 0) {
            this._createNewEvaluator();
        }
    }

    markFilesDirty(filePaths: string[]) {
        const markDirtyMap = new Map<string, boolean>();
        filePaths.forEach(filePath => {
            const sourceFileInfo = this._sourceFileMap.get(filePath);
            if (sourceFileInfo) {
                sourceFileInfo.sourceFile.markDirty();

                // Mark any files that depend on this file as dirty
                // also. This will retrigger analysis of these other files.
                this._markFileDirtyRecursive(sourceFileInfo, markDirtyMap);
            }
        });

        if (markDirtyMap.size > 0) {
            this._createNewEvaluator();
        }
    }

    getSourceFile(filePath: string): SourceFile | undefined {
        const sourceFileInfo = this._sourceFileMap.get(filePath);
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
    analyze(maxTime?: MaxAnalysisTime, interactiveMode?: boolean): boolean {
        const elapsedTime = new Duration();

        const openFiles = this._sourceFileList.filter(
            sf => sf.isOpenByClient && sf.sourceFile.isCheckingRequired()
        );

        if (openFiles.length > 0) {
            const effectiveMaxTime = maxTime ?
                maxTime.openFilesTimeInMs : Number.MAX_VALUE;

            // Check the open files.
            for (const sourceFileInfo of openFiles) {
                if (this._checkTypes(sourceFileInfo)) {
                    if (elapsedTime.getDurationInMilliseconds() > effectiveMaxTime) {
                        return true;
                    }
                }
            }

            // If the caller specified a maxTime, return at this point
            // since we've finalized all open files. We want to get
            // the results to the user as quickly as possible.
            if (maxTime !== undefined) {
                return true;
            }
        }

        if (!this._configOptions.checkOnlyOpenFiles) {
            // Do type analysis of remaining files.
            const allFiles = this._sourceFileList;
            const effectiveMaxTime = maxTime ?
                (interactiveMode ? maxTime.openFilesTimeInMs : maxTime.noOpenFilesTimeInMs) :
                Number.MAX_VALUE;

            // Now do type parsing and analysis of the remaining.
            for (const sourceFileInfo of allFiles) {
                if (this._checkTypes(sourceFileInfo)) {
                    if (elapsedTime.getDurationInMilliseconds() > effectiveMaxTime) {
                        return true;
                    }
                }
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
                    makeDirectories(this._fs, typeStubDir, typingsPath);
                } catch (e) {
                    const errMsg = `Could not create directory for '${ typeStubDir }'`;
                    throw new Error(errMsg);
                }

                this._bindFile(sourceFileInfo);
                const writer = new TypeStubWriter(typeStubPath, sourceFileInfo.sourceFile, this._evaluator);
                writer.write();
            }
        }
    }

    private get _fs() {
        return this._importResolver.fileSystem;
    }

    private _createNewEvaluator() {
        this._evaluator = createTypeEvaluator(this._lookUpImport);
    }

    private _parseFile(fileToParse: SourceFileInfo) {
        if (!this._isFileNeeded(fileToParse) || !fileToParse.sourceFile.isParseRequired()) {
            return;
        }

        if (fileToParse.sourceFile.parse(this._configOptions, this._importResolver)) {
            this._updateSourceFileImports(fileToParse, this._configOptions);
        }

        if (fileToParse.sourceFile.isFileDeleted()) {
            fileToParse.isTracked = false;

            // Mark any files that depend on this file as dirty
            // also. This will retrigger analysis of these other files.
            const markDirtyMap = new Map<string, boolean>();
            this._markFileDirtyRecursive(fileToParse, markDirtyMap);

            // Invalidate the import resolver's cache as well.
            this._importResolver.invalidateCache();
        }
    }

    // Binds the specified file and all of its dependencies, recursively. If
    // it runs out of time, it returns true. If it completes, it returns false.
    private _bindFile(fileToAnalyze: SourceFileInfo): void {
        if (!this._isFileNeeded(fileToAnalyze) || !fileToAnalyze.sourceFile.isBindingRequired()) {
            return;
        }

        this._parseFile(fileToAnalyze);

        // We need to parse and bind the builtins import first.
        let builtinsScope: Scope | undefined;
        if (fileToAnalyze.builtinsImport) {
            this._bindFile(fileToAnalyze.builtinsImport);

            // Get the builtins scope to pass to the binding pass.
            const parseResults = fileToAnalyze.builtinsImport.sourceFile.getParseResults();
            if (parseResults) {
                builtinsScope = AnalyzerNodeInfo.getScope(parseResults.parseTree);
                assert(builtinsScope !== undefined);
            }
        }

        fileToAnalyze.sourceFile.bind(this._configOptions, this._lookUpImport, builtinsScope);
    }

    private _lookUpImport = (filePath: string): ImportLookupResult | undefined => {
        const sourceFileInfo = this._sourceFileMap.get(filePath);
        if (!sourceFileInfo) {
            return undefined;
        }

        if (sourceFileInfo.sourceFile.isBindingRequired()) {
            // Bind the file if it's not already bound. Don't count this time
            // against the type checker.
            timingStats.typeCheckerTime.subtractFromTime(() => {
                this._bindFile(sourceFileInfo);
            });
        }

        const symbolTable = sourceFileInfo.sourceFile.getModuleSymbolTable();
        if (!symbolTable) {
            return undefined;
        }

        const docString = sourceFileInfo.sourceFile.getModuleDocString();

        return {
            symbolTable,
            docString
        };
    }

    // Build a map of all modules within this program and the module-
    // level scope that contains the symbol table for the module.
    private _buildModuleSymbolsMap(sourceFileToExclude?: SourceFileInfo): ModuleSymbolMap {
        const moduleSymbolMap = new Map<string, SymbolTable>();

        this._sourceFileList.forEach(fileInfo => {
            if (fileInfo !== sourceFileToExclude) {
                const symbolTable = fileInfo.sourceFile.getModuleSymbolTable();
                if (symbolTable) {
                    moduleSymbolMap.set(fileInfo.sourceFile.getFilePath(), symbolTable);
                }
            }
        });

        return moduleSymbolMap;
    }

    private _checkTypes(fileToCheck: SourceFileInfo) {
        // If the file isn't needed because it was eliminated from the
        // transitive closure or deleted, skip the file rather than wasting
        // time on it.
        if (!this._isFileNeeded(fileToCheck)) {
            return false;
        }

        if (!fileToCheck.sourceFile.isCheckingRequired()) {
            return false;
        }

        if (!fileToCheck.isTracked && !fileToCheck.isOpenByClient) {
            return false;
        }

        this._bindFile(fileToCheck);

        // For very large programs, we may need to discard the evaluator and
        // its cached types to avoid running out of heap space.
        if (this._evaluator.hasGrownTooLarge()) {
            this._console.log('Emptying type cache to avoid heap overflow');
            this._createNewEvaluator();
        }

        fileToCheck.sourceFile.check(this._evaluator);

        // Detect import cycles that involve the file.
        if (this._configOptions.diagnosticSettings.reportImportCycles !== 'none') {
            // Don't detect import cycles when doing type stub generation. Some
            // third-party modules are pretty convoluted.
            if (!this._allowedThirdPartyImports) {
                // We need to force all of the files to be parsed and build
                // a closure map for the files.
                const closureMap = new Map<string, SourceFileInfo>();
                this._getImportsRecursive(fileToCheck, closureMap, 0);

                closureMap.forEach(file => {
                    timingStats.cycleDetectionTime.timeOperation(() => {
                        this._detectAndReportImportCycles(file);
                    });
                });
            }
        }

        return true;
    }

    // Builds a map of files that includes the specified file and all of the files
    // it imports (recursively) and ensures that all such files. If any of these files
    // have already been checked (they and their recursive imports have completed the
    // check phase), they are not included in the results.
    private _getImportsRecursive(file: SourceFileInfo, closureMap: Map<string, SourceFileInfo>,
        recursionCount: number) {

        // If the file is already in the closure map, we found a cyclical
        // dependency. Don't recur further.
        const filePath = file.sourceFile.getFilePath();
        if (closureMap.has(filePath)) {
            return;
        }

        // If the import chain is too long, emit an error. Otherwise we
        // risk blowing the stack.
        if (recursionCount > _maxImportDepth) {
            file.sourceFile.setHitMaxImportDepth(_maxImportDepth);
            return;
        }

        // Add the file to the closure map.
        closureMap.set(filePath, file);

        // Recursively add the file's imports.
        for (const importedFileInfo of file.imports) {
            this._getImportsRecursive(importedFileInfo, closureMap, recursionCount + 1);
        }
    }

    private _detectAndReportImportCycles(sourceFileInfo: SourceFileInfo,
        dependencyChain: SourceFileInfo[] = [],
        dependencyMap = new Map<string, boolean>()): void {

        // Don't bother checking for typestub files or third-party files.
        if (sourceFileInfo.sourceFile.isStubFile() || sourceFileInfo.isThirdPartyImport) {
            return;
        }

        const filePath = sourceFileInfo.sourceFile.getFilePath();
        if (dependencyMap.has(filePath)) {
            // Look for chains at least two in length. A file that contains
            // an "import . from X" will technically create a cycle with
            // itself, but those are not interesting to report.
            if (dependencyChain.length > 1 && sourceFileInfo === dependencyChain[0]) {
                this._logImportCycle(dependencyChain);
            }
        } else {
            // If we've already checked this dependency along
            // some other path, we can skip it.
            if (dependencyMap.has(filePath)) {
                return;
            }

            // We use both a map (for fast lookups) and a list
            // (for ordering information). Set the dependency map
            // entry to true to indicate that we're actively exploring
            // that dependency.
            dependencyMap.set(filePath, true);
            dependencyChain.push(sourceFileInfo);

            for (const imp of sourceFileInfo.imports) {
                this._detectAndReportImportCycles(imp, dependencyChain, dependencyMap);
            }

            // Set the dependencyMap entry to false to indicate that we have
            // already explored this file and don't need to explore it again.
            dependencyMap.set(filePath, false);
            dependencyChain.pop();
        }
    }

    private _logImportCycle(dependencyChain: SourceFileInfo[]) {
        const circDep = new CircularDependency();
        dependencyChain.forEach(sourceFileInfo => {
            circDep.appendPath(sourceFileInfo.sourceFile.getFilePath());
        });

        circDep.normalizeOrder();
        const firstFilePath = circDep.getPaths()[0];
        const firstSourceFile = this._sourceFileMap.get(firstFilePath)!;
        assert(firstSourceFile !== undefined);
        firstSourceFile.sourceFile.addCircularDependency(circDep);
    }

    private _markFileDirtyRecursive(sourceFileInfo: SourceFileInfo,
        markMap: Map<string, boolean>) {

        const filePath = sourceFileInfo.sourceFile.getFilePath();

        // Don't mark it again if it's already been visited.
        if (!markMap.has(filePath)) {
            sourceFileInfo.sourceFile.markReanalysisRequired();
            markMap.set(filePath, true);

            sourceFileInfo.importedBy.forEach(dep => {
                this._markFileDirtyRecursive(dep, markMap);
            });
        }
    }

    getDiagnostics(options: ConfigOptions): FileDiagnostics[] {
        const fileDiagnostics: FileDiagnostics[] = this._removeUnneededFiles();

        this._sourceFileList.forEach(sourceFileInfo => {
            if ((!options.checkOnlyOpenFiles && sourceFileInfo.isTracked) || sourceFileInfo.isOpenByClient) {
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
            }
        });

        return fileDiagnostics;
    }

    getDiagnosticsForRange(filePath: string, options: ConfigOptions, range: Range): Diagnostic[] {
        const sourceFile = this.getSourceFile(filePath);
        if (!sourceFile) {
            return [];
        }

        const unfilteredDiagnostics = sourceFile.getDiagnostics(options);
        if (!unfilteredDiagnostics) {
            return [];
        }

        return unfilteredDiagnostics.filter(diag => {
            return doRangesOverlap(diag.range, range);
        });
    }

    getDefinitionsForPosition(filePath: string, position: Position):
        DocumentRange[] | undefined {

        const sourceFileInfo = this._sourceFileMap.get(filePath);
        if (!sourceFileInfo) {
            return undefined;
        }

        this._bindFile(sourceFileInfo);

        return sourceFileInfo.sourceFile.getDefinitionsForPosition(position, this._evaluator);
    }

    getReferencesForPosition(filePath: string, position: Position,
        includeDeclaration: boolean): DocumentRange[] | undefined {

        const sourceFileInfo = this._sourceFileMap.get(filePath);
        if (!sourceFileInfo) {
            return undefined;
        }

        this._bindFile(sourceFileInfo);

        const referencesResult = sourceFileInfo.sourceFile.getReferencesForPosition(
            position, includeDeclaration, this._evaluator);

        if (!referencesResult) {
            return undefined;
        }

        // Do we need to do a global search as well?
        if (referencesResult.requiresGlobalSearch) {
            for (const curSourceFileInfo of this._sourceFileList) {
                if (curSourceFileInfo !== sourceFileInfo) {
                    this._bindFile(curSourceFileInfo);

                    curSourceFileInfo.sourceFile.addReferences(referencesResult,
                        includeDeclaration, this._evaluator);
                }
            }
        }

        return referencesResult.locations;
    }

    addSymbolsForDocument(filePath: string, symbolList: DocumentSymbol[]) {
        const sourceFileInfo = this._sourceFileMap.get(filePath);
        if (sourceFileInfo) {
            this._bindFile(sourceFileInfo);

            sourceFileInfo.sourceFile.addHierarchicalSymbolsForDocument(
                symbolList, this._evaluator);
        }
    }

    addSymbolsForWorkspace(symbolList: SymbolInformation[], query: string) {
        // Don't do a search if the query is empty. We'll return
        // too many results in this case.
        if (!query) {
            return;
        }

        for (const sourceFileInfo of this._sourceFileList) {
            this._bindFile(sourceFileInfo);

            sourceFileInfo.sourceFile.addSymbolsForDocument(
                symbolList, this._evaluator, query);
        }
    }

    getHoverForPosition(filePath: string, position: Position):
        HoverResults | undefined {

        const sourceFileInfo = this._sourceFileMap.get(filePath);
        if (!sourceFileInfo) {
            return undefined;
        }

        this._bindFile(sourceFileInfo);

        return sourceFileInfo.sourceFile.getHoverForPosition(position, this._evaluator);
    }

    getSignatureHelpForPosition(filePath: string, position: Position):
        SignatureHelpResults | undefined {

        const sourceFileInfo = this._sourceFileMap.get(filePath);
        if (!sourceFileInfo) {
            return undefined;
        }

        this._bindFile(sourceFileInfo);

        return sourceFileInfo.sourceFile.getSignatureHelpForPosition(
            position, this._lookUpImport, this._evaluator);
    }

    getCompletionsForPosition(filePath: string, position: Position,
        workspacePath: string): CompletionList | undefined {

        const sourceFileInfo = this._sourceFileMap.get(filePath);
        if (!sourceFileInfo) {
            return undefined;
        }

        this._bindFile(sourceFileInfo);

        return sourceFileInfo.sourceFile.getCompletionsForPosition(
            position, workspacePath, this._configOptions,
            this._importResolver, this._lookUpImport, this._evaluator,
            () => this._buildModuleSymbolsMap(sourceFileInfo));
    }

    resolveCompletionItem(filePath: string, completionItem: CompletionItem) {
        const sourceFileInfo = this._sourceFileMap.get(filePath);
        if (!sourceFileInfo) {
            return;
        }

        this._bindFile(sourceFileInfo);

        sourceFileInfo.sourceFile.resolveCompletionItem(
            this._configOptions, this._importResolver, this._lookUpImport, this._evaluator,
            () => this._buildModuleSymbolsMap(sourceFileInfo), completionItem);
    }

    performQuickAction(filePath: string, command: string,
        args: any[]): TextEditAction[] | undefined {

        const sourceFileInfo = this._sourceFileMap.get(filePath);
        if (!sourceFileInfo) {
            return undefined;
        }

        this._bindFile(sourceFileInfo);

        return sourceFileInfo.sourceFile.performQuickAction(
            command, args);
    }

    renameSymbolAtPosition(filePath: string, position: Position,
        newName: string): FileEditAction[] | undefined {

        const sourceFileInfo = this._sourceFileMap.get(filePath);
        if (!sourceFileInfo) {
            return undefined;
        }

        const referencesResult = sourceFileInfo.sourceFile.getReferencesForPosition(
            position, true, this._evaluator);

        if (!referencesResult) {
            return undefined;
        }

        // Do we need to do a global search as well?
        if (referencesResult.requiresGlobalSearch) {
            for (const curSourceFileInfo of this._sourceFileList) {
                if (curSourceFileInfo !== sourceFileInfo) {
                    this._bindFile(curSourceFileInfo);

                    curSourceFileInfo.sourceFile.addReferences(referencesResult,
                        true, this._evaluator);
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
        for (let i = 0; i < this._sourceFileList.length;) {
            const fileInfo = this._sourceFileList[i];
            if (!this._isFileNeeded(fileInfo)) {
                fileDiagnostics.push({
                    filePath: fileInfo.sourceFile.getFilePath(),
                    diagnostics: []
                });

                fileInfo.sourceFile.prepareForClose();
                this._sourceFileMap.delete(fileInfo.sourceFile.getFilePath());
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
                            this._sourceFileMap.delete(importedFile.sourceFile.getFilePath());
                            this._sourceFileList.splice(indexToRemove, 1);
                            i--;
                        }
                    }
                });
            } else {
                // If we're showing the user errors only for open files, clear
                // out the errors for the now-closed file.
                if (this._configOptions.checkOnlyOpenFiles && !fileInfo.isOpenByClient) {
                    fileDiagnostics.push({
                        filePath: fileInfo.sourceFile.getFilePath(),
                        diagnostics: []
                    });
                }

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
        return this._isImportNeededRecursive(fileInfo, new Map<string, boolean>());
    }

    private _isImportNeededRecursive(fileInfo: SourceFileInfo, recursionMap: Map<string, boolean>) {
        if (fileInfo.isTracked || fileInfo.isOpenByClient) {
            return true;
        }

        const filePath = fileInfo.sourceFile.getFilePath();

        // Avoid infinite recursion.
        if (recursionMap.has(filePath)) {
            return false;
        }

        recursionMap.set(filePath, true);

        for (const importerInfo of fileInfo.importedBy) {
            if (this._isImportNeededRecursive(importerInfo, recursionMap)) {
                return true;
            }
        }

        return false;
    }

    private _isImportAllowed(importer: SourceFileInfo, importResult: ImportResult,
        isImportStubFile: boolean): boolean {

        let thirdPartyImportAllowed = this._configOptions.useLibraryCodeForTypes;

        if (importResult.importType === ImportType.ThirdParty ||
            (importer.isThirdPartyImport && importResult.importType === ImportType.Local)) {

            if (this._allowedThirdPartyImports) {
                if (importResult.isRelative) {
                    // If it's a relative import, we'll allow it because the
                    // importer was already deemed to be allowed.
                    thirdPartyImportAllowed = true;
                } else if (this._allowedThirdPartyImports.some((importName: string) => {
                    // If this import name is the one that was explicitly
                    // allowed or is a child of that import name,
                    // it's considered allowed.
                    if (importResult.importName === importName) {
                        return true;
                    }

                    if (importResult.importName.startsWith(importName + '.')) {
                        return true;
                    }

                    return false;
                })) {
                    thirdPartyImportAllowed = true;
                }
            }

            // Some libraries ship with stub files that import from non-stubs. Don't
            // explore those.
            // Don't explore any third-party files unless they're type stub files
            // or we've been told explicitly that third-party imports are OK.
            if (!isImportStubFile) {
                return thirdPartyImportAllowed;
            }
        }

        return true;
    }

    private _updateSourceFileImports(sourceFileInfo: SourceFileInfo,
        options: ConfigOptions): SourceFileInfo[] {

        const filesAdded: SourceFileInfo[] = [];

        // Get the new list of imports and see if it changed from the last
        // list of imports for this file.
        const imports = sourceFileInfo.sourceFile.getImports();

        // Create a map of unique imports, since imports can appear more than once.
        const newImportPathMap = new Map<string, UpdateImportInfo>();
        imports.forEach(importResult => {
            if (importResult.isImportFound) {
                if (this._isImportAllowed(sourceFileInfo, importResult, importResult.isStubFile)) {
                    if (importResult.resolvedPaths.length > 0) {
                        const filePath = importResult.resolvedPaths[
                            importResult.resolvedPaths.length - 1];
                        if (filePath) {
                            newImportPathMap.set(filePath, {
                                isTypeshedFile: !!importResult.isTypeshedFile,
                                isThirdPartyImport: importResult.importType === ImportType.ThirdParty ||
                                    (sourceFileInfo.isThirdPartyImport && importResult.importType === ImportType.Local)
                            });
                        }
                    }
                }

                importResult.implicitImports.forEach(implicitImport => {
                    if (this._isImportAllowed(sourceFileInfo, importResult, implicitImport.isStubFile)) {
                        newImportPathMap.set(implicitImport.path, {
                            isTypeshedFile: !!importResult.isTypeshedFile,
                            isThirdPartyImport: importResult.importType === ImportType.ThirdParty ||
                                (sourceFileInfo.isThirdPartyImport && importResult.importType === ImportType.Local)
                        });
                    }
                });
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

        const updatedImportMap = new Map<string, SourceFileInfo>();
        sourceFileInfo.imports.forEach(importInfo => {
            const oldFilePath = importInfo.sourceFile.getFilePath();

            // A previous import was removed.
            if (!newImportPathMap.has(oldFilePath)) {
                importInfo.importedBy = importInfo.importedBy.filter(
                    fi => fi.sourceFile.getFilePath() !== sourceFileInfo.sourceFile.getFilePath());
            } else {
                updatedImportMap.set(oldFilePath, importInfo);
            }
        });

        // See if there are any new imports to be added.
        newImportPathMap.forEach((importInfo, importPath) => {
            if (!updatedImportMap.has(importPath)) {
                // We found a new import to add. See if it's already part
                // of the program.
                let importedFileInfo: SourceFileInfo;
                if (this._sourceFileMap.has(importPath)) {
                    importedFileInfo = this._sourceFileMap.get(importPath)!;
                } else {
                    const sourceFile = new SourceFile(
                        this._fs,
                        importPath, importInfo.isTypeshedFile,
                        importInfo.isThirdPartyImport, this._console);
                    importedFileInfo = {
                        sourceFile,
                        isTracked: false,
                        isOpenByClient: false,
                        isTypeshedFile: importInfo.isTypeshedFile,
                        isThirdPartyImport: importInfo.isThirdPartyImport,
                        diagnosticsVersion: sourceFile.getDiagnosticVersion(),
                        imports: [],
                        importedBy: []
                    };

                    this._addToSourceFileListAndMap(importedFileInfo);
                    filesAdded.push(importedFileInfo);
                }

                importedFileInfo.importedBy.push(sourceFileInfo);
                updatedImportMap.set(importPath, importedFileInfo);
            }
        });

        // Update the imports list. It should now map the set of imports
        // specified by the source file.
        sourceFileInfo.imports = [];
        newImportPathMap.forEach((_, path) => {
            if (this._sourceFileMap.has(path)) {
                sourceFileInfo.imports.push(this._sourceFileMap.get(path)!);
            }
        });

        // Resolve the builtins import for the file. This needs to be
        // analyzed before the file can be analyzed.
        sourceFileInfo.builtinsImport = undefined;
        const builtinsImport = sourceFileInfo.sourceFile.getBuiltinsImport();
        if (builtinsImport) {
            const resolvedBuiltinsPath = builtinsImport.resolvedPaths[
                builtinsImport.resolvedPaths.length - 1];
            sourceFileInfo.builtinsImport = this._sourceFileMap.get(resolvedBuiltinsPath);
        }

        return filesAdded;
    }

    private _addToSourceFileListAndMap(fileInfo: SourceFileInfo) {
        const filePath = fileInfo.sourceFile.getFilePath();

        // We should never add a file with the same path twice.
        assert(!this._sourceFileMap.has(filePath));

        this._sourceFileList.push(fileInfo);
        this._sourceFileMap.set(filePath, fileInfo);
    }
}
