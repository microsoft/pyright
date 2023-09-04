/*
 * program.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * An object that tracks all of the source files being analyzed
 * and all of their recursive imports.
 */

import { CancellationToken } from 'vscode-languageserver';

import { TextDocument } from 'vscode-languageserver-textdocument';
import { OperationCanceledException, throwIfCancellationRequested } from '../common/cancellationUtils';
import { ConfigOptions, ExecutionEnvironment, matchFileSpecs } from '../common/configOptions';
import { ConsoleInterface, StandardConsole } from '../common/console';
import * as debug from '../common/debug';
import { assert } from '../common/debug';
import { Diagnostic } from '../common/diagnostic';
import { FileDiagnostics } from '../common/diagnosticSink';
import { FileEditAction } from '../common/editAction';
import { EditableProgram, Extensions, ProgramView } from '../common/extensibility';
import { FileSystem } from '../common/fileSystem';
import { LogTracker } from '../common/logTracker';
import {
    combinePaths,
    getDirectoryPath,
    getFileName,
    getRelativePath,
    makeDirectories,
    normalizePath,
    normalizePathCase,
    stripFileExtension,
} from '../common/pathUtils';
import { convertRangeToTextRange } from '../common/positionUtils';
import { ServiceProvider } from '../common/serviceProvider';
import '../common/serviceProviderExtensions';
import { ServiceKeys } from '../common/serviceProviderExtensions';
import { Range, doRangesIntersect } from '../common/textRange';
import { Duration, timingStats } from '../common/timing';
import { ParseResults } from '../parser/parser';
import { AbsoluteModuleDescriptor, ImportLookupResult, LookupImportOptions } from './analyzerFileInfo';
import * as AnalyzerNodeInfo from './analyzerNodeInfo';
import { CacheManager } from './cacheManager';
import { CircularDependency } from './circularDependency';
import { ImportResolver } from './importResolver';
import { ImportResult, ImportType } from './importResult';
import { getDocString } from './parseTreeUtils';
import { Scope } from './scope';
import { IPythonMode, SourceFile, SourceFileEditMode } from './sourceFile';
import { createChainedByList, isUserCode, verifyNoCyclesInChainedFiles } from './sourceFileInfoUtils';
import { SourceMapper } from './sourceMapper';
import { Symbol } from './symbol';
import { createTracePrinter } from './tracePrinter';
import { PrintTypeOptions, TypeEvaluator } from './typeEvaluatorTypes';
import { createTypeEvaluatorWithTracker } from './typeEvaluatorWithTracker';
import { PrintTypeFlags } from './typePrinter';
import { TypeStubWriter } from './typeStubWriter';
import { Type } from './types';
import { SourceFileInfo } from './sourceFileInfo';

const _maxImportDepth = 256;

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
    path: string;
    isTypeshedFile: boolean;
    isThirdPartyImport: boolean;
    isPyTypedPresent: boolean;
}

export type PreCheckCallback = (parseResults: ParseResults, evaluator: TypeEvaluator) => void;

export interface ISourceFileFactory {
    createSourceFile(
        fs: FileSystem,
        filePath: string,
        moduleName: string,
        isThirdPartyImport: boolean,
        isThirdPartyPyTypedPresent: boolean,
        editMode: SourceFileEditMode,
        console?: ConsoleInterface,
        logTracker?: LogTracker,
        realFilePath?: string,
        ipythonMode?: IPythonMode
    ): SourceFile;
}

export namespace ISourceFileFactory {
    export function is(obj: any): obj is ISourceFileFactory {
        return obj.createSourceFile !== undefined;
    }
}

export interface OpenFileOptions {
    isTracked: boolean;
    ipythonMode: IPythonMode;
    chainedFilePath: string | undefined;
    realFilePath: string | undefined;
}

// Track edit mode related information.
class EditModeTracker {
    private _isEditMode = false;
    private _mutatedFiles: SourceFileInfo[] = [];

    get isEditMode() {
        return this._isEditMode;
    }

    addMutatedFiles(file: SourceFileInfo) {
        this._mutatedFiles.push(file);
    }

    enable() {
        this._isEditMode = true;
        this._mutatedFiles = [];
    }

    disable() {
        this._isEditMode = false;

        const files = this._mutatedFiles;
        this._mutatedFiles = [];

        return files;
    }
}

// Container for all of the files that are being analyzed. Files
// can fall into one or more of the following categories:
//  Tracked - specified by the config options
//  Referenced - part of the transitive closure
//  Opened - temporarily opened in the editor
//  Shadowed - implementation file that shadows a type stub file
export class Program {
    private static _nextId = 0;

    private readonly _console: ConsoleInterface;
    private readonly _sourceFileList: SourceFileInfo[] = [];
    private readonly _sourceFileMap = new Map<string, SourceFileInfo>();

    private readonly _logTracker: LogTracker;
    private readonly _cacheManager: CacheManager;
    private readonly _id: string;

    private _allowedThirdPartyImports: string[] | undefined;
    private _configOptions: ConfigOptions;
    private _importResolver: ImportResolver;
    private _evaluator: TypeEvaluator | undefined;

    private _parsedFileCount = 0;
    private _preCheckCallback: PreCheckCallback | undefined;
    private _editModeTracker = new EditModeTracker();
    private _sourceFileFactory: ISourceFileFactory;

    constructor(
        initialImportResolver: ImportResolver,
        initialConfigOptions: ConfigOptions,
        private _serviceProvider: ServiceProvider,
        logTracker?: LogTracker,
        private _disableChecker?: boolean,
        cacheManager?: CacheManager,
        id?: string
    ) {
        this._console = _serviceProvider.tryGet(ServiceKeys.console) || new StandardConsole();
        this._logTracker = logTracker ?? new LogTracker(this._console, 'FG');
        this._importResolver = initialImportResolver;
        this._configOptions = initialConfigOptions;
        this._sourceFileFactory = _serviceProvider.sourceFileFactory();

        this._cacheManager = cacheManager ?? new CacheManager();
        this._cacheManager.registerCacheOwner(this);
        this._createNewEvaluator();

        this._id = id ?? `Prog_${Program._nextId}`;
        Program._nextId += 1;
    }

    get id() {
        return this._id;
    }

    get console(): ConsoleInterface {
        return this._console;
    }

    get rootPath(): string {
        return this._configOptions.projectRoot;
    }

    get evaluator(): TypeEvaluator | undefined {
        return this._evaluator;
    }

    get configOptions(): ConfigOptions {
        return this._configOptions;
    }

    get importResolver(): ImportResolver {
        return this._importResolver;
    }

    get fileSystem() {
        return this._importResolver.fileSystem;
    }

    dispose() {
        this._cacheManager.unregisterCacheOwner(this);
    }

    enterEditMode() {
        this._editModeTracker.enable();
    }

    exitEditMode() {
        // Stop applying edit mode to new source files.
        const mutatedFiles = this._editModeTracker.disable();

        const filesToDelete = new Set<SourceFileInfo>();
        const edits: FileEditAction[] = [];

        // Tell all source files we're no longer in edit mode. Gather
        // up all of their edits and find files that no longer needed.
        mutatedFiles.forEach((fileInfo) => {
            if (fileInfo.isCreatedInEditMode) {
                filesToDelete.add(fileInfo);
            }

            const newContents = fileInfo.restore();
            if (newContents) {
                // Create a text document so we can compute the edits.
                const textDocument = TextDocument.create(
                    fileInfo.sourceFile.getFilePath(),
                    'python',
                    1,
                    fileInfo.sourceFile.getFileContent() || ''
                );

                // Add an edit action to the list.
                edits.push({
                    filePath: fileInfo.sourceFile.getFilePath(),
                    range: {
                        start: { line: 0, character: 0 },
                        end: { line: textDocument.lineCount, character: 0 },
                    },
                    replacementText: newContents,
                });
            }
        });

        // Delete files added while in edit mode
        if (filesToDelete.size > 0) {
            // delete from the back to make sure index is valid.
            for (let i = this._sourceFileList.length - 1; i >= 0; i--) {
                const v = this._sourceFileList[i];
                if (filesToDelete.has(v)) {
                    // We don't need to care about file diagnostics since in edit mode
                    // checker won't run.
                    v.sourceFile.prepareForClose();
                    this._removeSourceFileFromListAndMap(v.sourceFile.getFilePath(), i);
                }
            }
        }

        return edits;
    }

    setConfigOptions(configOptions: ConfigOptions) {
        this._configOptions = configOptions;
        this._importResolver.setConfigOptions(configOptions);

        // Create a new evaluator with the updated config options.
        this._createNewEvaluator();
    }

    setImportResolver(importResolver: ImportResolver) {
        this._importResolver = importResolver;

        // Create a new evaluator with the updated import resolver.
        // Otherwise, lookup import passed to type evaluator might use
        // older import resolver when resolving imports after parsing.
        this._createNewEvaluator();
    }

    // Sets the list of tracked files that make up the program.
    setTrackedFiles(filePaths: string[]): FileDiagnostics[] {
        if (this._sourceFileList.length > 0) {
            // We need to determine which files to remove from the existing file list.
            const newFileMap = new Map<string, string>();
            filePaths.forEach((path) => {
                newFileMap.set(normalizePathCase(this.fileSystem, path), path);
            });

            // Files that are not in the tracked file list are
            // marked as no longer tracked.
            this._sourceFileList.forEach((oldFile) => {
                const filePath = normalizePathCase(this.fileSystem, oldFile.sourceFile.getFilePath());
                if (!newFileMap.has(filePath)) {
                    oldFile.isTracked = false;
                }
            });
        }

        // Add the new files. Only the new items will be added.
        this.addTrackedFiles(filePaths);

        return this._removeUnneededFiles();
    }

    // Allows a caller to set a callback that is called right before
    // a source file is type checked. It is intended for testing only.
    setPreCheckCallback(preCheckCallback: PreCheckCallback) {
        this._preCheckCallback = preCheckCallback;
    }

    // By default, no third-party imports are allowed. This enables
    // third-party imports for a specified import and its children.
    // For example, if importNames is ['tensorflow'], then third-party
    // (absolute) imports are allowed for 'import tensorflow',
    // 'import tensorflow.optimizers', etc.
    setAllowedThirdPartyImports(importNames: string[]) {
        this._allowedThirdPartyImports = importNames;
    }

    addTrackedFiles(filePaths: string[], isThirdPartyImport = false, isInPyTypedPackage = false) {
        filePaths.forEach((filePath) => {
            this.addTrackedFile(filePath, isThirdPartyImport, isInPyTypedPackage);
        });
    }

    addInterimFile(filePath: string): SourceFileInfo {
        // Double check not already there.
        let fileInfo = this.getSourceFileInfo(filePath);
        if (!fileInfo) {
            fileInfo = this._createInterimFileInfo(filePath);
            this._addToSourceFileListAndMap(fileInfo);
        }
        return fileInfo;
    }

    addTrackedFile(filePath: string, isThirdPartyImport = false, isInPyTypedPackage = false): SourceFile {
        let sourceFileInfo = this.getSourceFileInfo(filePath);
        const importName = this._getImportNameForFile(filePath);

        if (sourceFileInfo) {
            // The module name may have changed based on updates to the
            // search paths, so update it here.
            sourceFileInfo.sourceFile.setModuleName(importName);
            sourceFileInfo.isTracked = true;
            return sourceFileInfo.sourceFile;
        }

        const sourceFile = this._sourceFileFactory.createSourceFile(
            this.fileSystem,
            filePath,
            importName,
            isThirdPartyImport,
            isInPyTypedPackage,
            this._editModeTracker,
            this._console,
            this._logTracker
        );
        sourceFileInfo = new SourceFileInfo(
            sourceFile,
            /* isTypeshedFile */ false,
            isThirdPartyImport,
            isInPyTypedPackage,
            this._editModeTracker,
            {
                isTracked: true,
            }
        );
        this._addToSourceFileListAndMap(sourceFileInfo);
        return sourceFile;
    }

    setFileOpened(filePath: string, version: number | null, contents: string, options?: OpenFileOptions) {
        let sourceFileInfo = this.getSourceFileInfo(filePath);
        if (!sourceFileInfo) {
            const importName = this._getImportNameForFile(filePath);
            const sourceFile = this._sourceFileFactory.createSourceFile(
                this.fileSystem,
                filePath,
                importName,
                /* isThirdPartyImport */ false,
                /* isInPyTypedPackage */ false,
                this._editModeTracker,
                this._console,
                this._logTracker,
                options?.realFilePath,
                options?.ipythonMode ?? IPythonMode.None
            );
            const chainedFilePath = options?.chainedFilePath;
            sourceFileInfo = new SourceFileInfo(
                sourceFile,
                /* isTypeshedFile */ false,
                /* isThirdPartyImport */ false,
                /* isThirdPartyPyTypedPresent */ false,
                this._editModeTracker,
                {
                    isTracked: options?.isTracked ?? false,
                    chainedSourceFile: chainedFilePath ? this.getSourceFileInfo(chainedFilePath) : undefined,
                    isOpenByClient: true,
                }
            );
            this._addToSourceFileListAndMap(sourceFileInfo);
        } else {
            sourceFileInfo.isOpenByClient = true;

            // Reset the diagnostic version so we force an update to the
            // diagnostics, which can change based on whether the file is open.
            // We do not set the version to undefined here because that implies
            // there are no diagnostics currently reported for this file.
            sourceFileInfo.diagnosticsVersion = 0;
        }

        verifyNoCyclesInChainedFiles(sourceFileInfo);
        sourceFileInfo.sourceFile.setClientVersion(version, contents);
    }

    getChainedFilePath(filePath: string): string | undefined {
        const sourceFileInfo = this.getSourceFileInfo(filePath);
        return sourceFileInfo?.chainedSourceFile?.sourceFile.getFilePath();
    }

    updateChainedFilePath(filePath: string, chainedFilePath: string | undefined) {
        const sourceFileInfo = this.getSourceFileInfo(filePath);
        if (!sourceFileInfo) {
            return;
        }

        sourceFileInfo.chainedSourceFile = chainedFilePath ? this.getSourceFileInfo(chainedFilePath) : undefined;
        sourceFileInfo.sourceFile.markDirty();
        this._markFileDirtyRecursive(sourceFileInfo, new Set<string>());

        verifyNoCyclesInChainedFiles(sourceFileInfo);
    }

    setFileClosed(filePath: string, isTracked?: boolean): FileDiagnostics[] {
        const sourceFileInfo = this.getSourceFileInfo(filePath);
        if (sourceFileInfo) {
            sourceFileInfo.isOpenByClient = false;
            sourceFileInfo.isTracked = isTracked ?? sourceFileInfo.isTracked;
            sourceFileInfo.sourceFile.setClientVersion(null, '');

            // There is no guarantee that content is saved before the file is closed.
            // We need to mark the file dirty so we can re-analyze next time.
            // This won't matter much for OpenFileOnly users, but it will matter for
            // people who use diagnosticMode Workspace.
            if (sourceFileInfo.sourceFile.didContentsChangeOnDisk()) {
                sourceFileInfo.sourceFile.markDirty();
                this._markFileDirtyRecursive(sourceFileInfo, new Set<string>());
            }
        }

        return this._removeUnneededFiles();
    }

    markAllFilesDirty(evenIfContentsAreSame: boolean) {
        const markDirtySet = new Set<string>();

        this._sourceFileList.forEach((sourceFileInfo) => {
            if (evenIfContentsAreSame) {
                sourceFileInfo.sourceFile.markDirty();
            } else if (sourceFileInfo.sourceFile.didContentsChangeOnDisk()) {
                sourceFileInfo.sourceFile.markDirty();

                // Mark any files that depend on this file as dirty
                // also. This will retrigger analysis of these other files.
                this._markFileDirtyRecursive(sourceFileInfo, markDirtySet);
            }
        });

        if (markDirtySet.size > 0) {
            this._createNewEvaluator();
        }
    }

    markFilesDirty(filePaths: string[], evenIfContentsAreSame: boolean) {
        const markDirtySet = new Set<string>();
        filePaths.forEach((filePath) => {
            const sourceFileInfo = this.getSourceFileInfo(filePath);
            if (sourceFileInfo) {
                const fileName = getFileName(filePath);

                // Handle builtins and __builtins__ specially. They are implicitly
                // included by all source files.
                if (fileName === 'builtins.pyi' || fileName === '__builtins__.pyi') {
                    this.markAllFilesDirty(evenIfContentsAreSame);
                    return;
                }

                // If !evenIfContentsAreSame, see if the on-disk contents have
                // changed. If the file is open, the on-disk contents don't matter
                // because we'll receive updates directly from the client.
                if (
                    evenIfContentsAreSame ||
                    (!sourceFileInfo.isOpenByClient && sourceFileInfo.sourceFile.didContentsChangeOnDisk())
                ) {
                    sourceFileInfo.sourceFile.markDirty();

                    // Mark any files that depend on this file as dirty
                    // also. This will retrigger analysis of these other files.
                    this._markFileDirtyRecursive(sourceFileInfo, markDirtySet);
                }
            }
        });

        if (markDirtySet.size > 0) {
            this._createNewEvaluator();
        }
    }

    getFileCount(userFileOnly = true) {
        if (userFileOnly) {
            return this._sourceFileList.filter((f) => isUserCode(f)).length;
        }

        return this._sourceFileList.length;
    }

    // Returns the number of files that are considered "user" files and therefore
    // are checked.
    getUserFileCount() {
        return this._sourceFileList.filter((s) => isUserCode(s)).length;
    }

    getUserFiles(): SourceFileInfo[] {
        return this._sourceFileList.filter((s) => isUserCode(s));
    }

    getOpened(): SourceFileInfo[] {
        return this._sourceFileList.filter((s) => s.isOpenByClient);
    }

    getFilesToAnalyzeCount() {
        let sourceFileCount = 0;

        if (this._disableChecker) {
            return sourceFileCount;
        }

        this._sourceFileList.forEach((fileInfo) => {
            if (fileInfo.sourceFile.isCheckingRequired()) {
                if (this._shouldCheckFile(fileInfo)) {
                    sourceFileCount++;
                }
            }
        });

        return sourceFileCount;
    }

    isCheckingOnlyOpenFiles() {
        return this._configOptions.checkOnlyOpenFiles || false;
    }

    functionSignatureDisplay() {
        return this._configOptions.functionSignatureDisplay;
    }

    containsSourceFileIn(folder: string): boolean {
        const normalizedFolder = normalizePathCase(this.fileSystem, folder);
        for (const normalizedSourceFilePath of this._sourceFileMap.keys()) {
            if (normalizedSourceFilePath.startsWith(normalizedFolder)) {
                return true;
            }
        }

        return false;
    }

    owns(filePath: string) {
        const fileInfo = this.getSourceFileInfo(filePath);
        if (fileInfo) {
            // If we already determined whether the file is tracked or not, don't do it again.
            // This will make sure we have consistent look at the state once it is loaded to the memory.
            return fileInfo.isTracked;
        }

        return matchFileSpecs(this._configOptions, filePath);
    }

    getSourceFile(filePath: string): SourceFile | undefined {
        const sourceFileInfo = this.getSourceFileInfo(filePath);
        if (!sourceFileInfo) {
            return undefined;
        }

        return sourceFileInfo.sourceFile;
    }

    getBoundSourceFile(filePath: string): SourceFile | undefined {
        return this.getBoundSourceFileInfo(filePath)?.sourceFile;
    }

    getSourceFileInfoList(): readonly SourceFileInfo[] {
        return this._sourceFileList;
    }

    getSourceFileInfo(filePath: string): SourceFileInfo | undefined {
        return this._sourceFileMap.get(normalizePathCase(this.fileSystem, filePath));
    }

    getBoundSourceFileInfo(filePath: string, content?: string, force?: boolean): SourceFileInfo | undefined {
        const sourceFileInfo = this.getSourceFileInfo(filePath);
        if (!sourceFileInfo) {
            return undefined;
        }

        this._bindFile(sourceFileInfo, content, force);
        return sourceFileInfo;
    }

    // Performs parsing and analysis of any source files in the program
    // that require it. If a limit time is specified, the operation
    // is interrupted when the time expires. The return value indicates
    // whether the method needs to be called again to complete the
    // analysis. In interactive mode, the timeout is always limited
    // to the smaller value to maintain responsiveness.
    analyze(maxTime?: MaxAnalysisTime, token: CancellationToken = CancellationToken.None): boolean {
        return this._runEvaluatorWithCancellationToken(token, () => {
            const elapsedTime = new Duration();

            const openFiles = this._sourceFileList.filter(
                (sf) => sf.isOpenByClient && sf.sourceFile.isCheckingRequired()
            );

            if (openFiles.length > 0) {
                const effectiveMaxTime = maxTime ? maxTime.openFilesTimeInMs : Number.MAX_VALUE;

                // Check the open files.
                for (const sourceFileInfo of openFiles) {
                    if (this._checkTypes(sourceFileInfo, token)) {
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
                const effectiveMaxTime = maxTime ? maxTime.noOpenFilesTimeInMs : Number.MAX_VALUE;

                // Now do type parsing and analysis of the remaining.
                for (const sourceFileInfo of this._sourceFileList) {
                    if (!isUserCode(sourceFileInfo)) {
                        continue;
                    }

                    if (this._checkTypes(sourceFileInfo, token)) {
                        if (elapsedTime.getDurationInMilliseconds() > effectiveMaxTime) {
                            return true;
                        }
                    }
                }
            }

            return false;
        });
    }

    // Performs parsing and analysis of a single file in the program. If the file is not part of
    // the program returns false to indicate analysis was not performed.
    analyzeFile(filePath: string, token: CancellationToken = CancellationToken.None): boolean {
        return this._runEvaluatorWithCancellationToken(token, () => {
            const sourceFileInfo = this.getSourceFileInfo(filePath);
            if (sourceFileInfo && this._checkTypes(sourceFileInfo, token)) {
                return true;
            }
            return false;
        });
    }

    // This will allow the callback to execute a type evaluator with an associated
    // cancellation token and provide a read-only program.
    run<T>(callback: (p: ProgramView) => T, token: CancellationToken): T {
        return this._runEvaluatorWithCancellationToken(token, () => callback(this));
    }

    // This will allow the callback to execute a type evaluator with an associated
    // cancellation token and provide a mutable program. Should already be in edit mode when called.
    runEditMode(callback: (v: EditableProgram) => void, token: CancellationToken): void {
        if (this._editModeTracker.isEditMode) {
            return this._runEvaluatorWithCancellationToken(token, () => callback(this));
        }
    }

    getSourceMapper(
        filePath: string,
        token: CancellationToken,
        mapCompiled?: boolean,
        preferStubs?: boolean
    ): SourceMapper {
        const sourceFileInfo = this.getSourceFileInfo(filePath);
        const execEnv = this._configOptions.findExecEnvironment(filePath);
        return this._createSourceMapper(execEnv, token, sourceFileInfo, mapCompiled, preferStubs);
    }

    getParseResults(filePath: string): ParseResults | undefined {
        return this.getBoundSourceFile(filePath)?.getParseResults();
    }

    handleMemoryHighUsage() {
        this._handleMemoryHighUsage();
    }

    // Prints a detailed list of files that have been checked and the times associated
    // with each of them, sorted greatest to least.
    printDetailedAnalysisTimes() {
        const sortedFiles = this._sourceFileList
            .filter((s) => s.sourceFile.getCheckTime() !== undefined)
            .sort((a, b) => {
                return b.sourceFile.getCheckTime()! - a.sourceFile.getCheckTime()!;
            });

        this._console.info('');
        this._console.info('Analysis time by file');

        sortedFiles.forEach((sfInfo) => {
            const checkTimeInMs = sfInfo.sourceFile.getCheckTime()!;
            this._console.info(`${checkTimeInMs}ms: ${sfInfo.sourceFile.getFilePath()}`);
        });
    }

    // Prints import dependency information for each of the files in
    // the program, skipping any typeshed files.
    printDependencies(projectRootDir: string, verbose: boolean) {
        const fs = this._importResolver.fileSystem;
        const sortedFiles = this._sourceFileList
            .filter((s) => !s.isTypeshedFile)
            .sort((a, b) => {
                return fs.getOriginalFilePath(a.sourceFile.getFilePath()) <
                    fs.getOriginalFilePath(b.sourceFile.getFilePath())
                    ? 1
                    : -1;
            });

        const zeroImportFiles: SourceFile[] = [];

        sortedFiles.forEach((sfInfo) => {
            this._console.info('');
            let filePath = fs.getOriginalFilePath(sfInfo.sourceFile.getFilePath());
            const relPath = getRelativePath(filePath, projectRootDir);
            if (relPath) {
                filePath = relPath;
            }

            this._console.info(`${filePath}`);

            this._console.info(
                ` Imports     ${sfInfo.imports.length} ` + `file${sfInfo.imports.length === 1 ? '' : 's'}`
            );
            if (verbose) {
                sfInfo.imports.forEach((importInfo) => {
                    this._console.info(`    ${fs.getOriginalFilePath(importInfo.sourceFile.getFilePath())}`);
                });
            }

            this._console.info(
                ` Imported by ${sfInfo.importedBy.length} ` + `file${sfInfo.importedBy.length === 1 ? '' : 's'}`
            );
            if (verbose) {
                sfInfo.importedBy.forEach((importInfo) => {
                    this._console.info(`    ${fs.getOriginalFilePath(importInfo.sourceFile.getFilePath())}`);
                });
            }

            if (sfInfo.importedBy.length === 0) {
                zeroImportFiles.push(sfInfo.sourceFile);
            }
        });

        if (zeroImportFiles.length > 0) {
            this._console.info('');
            this._console.info(
                `${zeroImportFiles.length} file${zeroImportFiles.length === 1 ? '' : 's'}` + ` not explicitly imported`
            );
            zeroImportFiles.forEach((importFile) => {
                this._console.info(`    ${fs.getOriginalFilePath(importFile.getFilePath())}`);
            });
        }
    }

    writeTypeStub(targetImportPath: string, targetIsSingleFile: boolean, stubPath: string, token: CancellationToken) {
        for (const sourceFileInfo of this._sourceFileList) {
            throwIfCancellationRequested(token);

            const filePath = sourceFileInfo.sourceFile.getFilePath();

            // Generate type stubs only for the files within the target path,
            // not any files that the target module happened to import.
            const relativePath = getRelativePath(filePath, targetImportPath);
            if (relativePath !== undefined) {
                let typeStubPath = normalizePath(combinePaths(stubPath, relativePath));

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
                    makeDirectories(this.fileSystem, typeStubDir, stubPath);
                } catch (e: any) {
                    const errMsg = `Could not create directory for '${typeStubDir}'`;
                    throw new Error(errMsg);
                }

                this._bindFile(sourceFileInfo);

                this._runEvaluatorWithCancellationToken(token, () => {
                    const writer = new TypeStubWriter(typeStubPath, sourceFileInfo.sourceFile, this._evaluator!);
                    writer.write();
                });

                // This operation can consume significant memory, so check
                // for situations where we need to discard the type cache.
                this._handleMemoryHighUsage();
            }
        }
    }

    getTypeOfSymbol(symbol: Symbol) {
        this._handleMemoryHighUsage();

        const evaluator = this._evaluator || this._createNewEvaluator();
        return evaluator.getEffectiveTypeOfSymbol(symbol);
    }

    printType(type: Type, options?: PrintTypeOptions): string {
        this._handleMemoryHighUsage();

        const evaluator = this._evaluator || this._createNewEvaluator();
        return evaluator.printType(type, options);
    }

    getTextOnRange(filePath: string, range: Range, token: CancellationToken): string | undefined {
        const sourceFileInfo = this.getSourceFileInfo(filePath);
        if (!sourceFileInfo) {
            return undefined;
        }

        const sourceFile = sourceFileInfo.sourceFile;
        const fileContents = sourceFile.getOpenFileContents();
        if (fileContents === undefined) {
            // this only works with opened file
            return undefined;
        }

        return this._runEvaluatorWithCancellationToken(token, () => {
            this._parseFile(sourceFileInfo);

            const parseTree = sourceFile.getParseResults()!;
            const textRange = convertRangeToTextRange(range, parseTree.tokenizerOutput.lines);
            if (!textRange) {
                return undefined;
            }

            return fileContents.substr(textRange.start, textRange.length);
        });
    }

    getDiagnostics(options: ConfigOptions): FileDiagnostics[] {
        const fileDiagnostics: FileDiagnostics[] = this._removeUnneededFiles();

        this._sourceFileList.forEach((sourceFileInfo) => {
            if (this._shouldCheckFile(sourceFileInfo)) {
                const diagnostics = sourceFileInfo.sourceFile.getDiagnostics(
                    options,
                    sourceFileInfo.diagnosticsVersion
                );
                if (diagnostics !== undefined) {
                    fileDiagnostics.push({
                        filePath: sourceFileInfo.sourceFile.getFilePath(),
                        version: sourceFileInfo.sourceFile.getClientVersion(),
                        diagnostics,
                    });

                    // Update the cached diagnosticsVersion so we can determine
                    // whether there are any updates next time we call getDiagnostics.
                    sourceFileInfo.diagnosticsVersion = sourceFileInfo.sourceFile.getDiagnosticVersion();
                }
            } else if (
                !sourceFileInfo.isOpenByClient &&
                options.checkOnlyOpenFiles &&
                sourceFileInfo.diagnosticsVersion !== undefined
            ) {
                // This condition occurs when the user switches from workspace to
                // "open files only" mode. Clear all diagnostics for this file.
                fileDiagnostics.push({
                    filePath: sourceFileInfo.sourceFile.getFilePath(),
                    version: sourceFileInfo.sourceFile.getClientVersion(),
                    diagnostics: [],
                });
                sourceFileInfo.diagnosticsVersion = undefined;
            }
        });

        return fileDiagnostics;
    }

    getDiagnosticsForRange(filePath: string, range: Range): Diagnostic[] {
        const sourceFile = this.getSourceFile(filePath);
        if (!sourceFile) {
            return [];
        }

        const unfilteredDiagnostics = sourceFile.getDiagnostics(this._configOptions);
        if (!unfilteredDiagnostics) {
            return [];
        }

        return unfilteredDiagnostics.filter((diag) => {
            return doRangesIntersect(diag.range, range);
        });
    }

    clone() {
        const program = new Program(
            this._importResolver,
            this._configOptions,
            this._serviceProvider,
            new LogTracker(this._console, 'Cloned')
        );

        // Cloned program will use whatever user files the program currently has.
        const userFiles = this.getUserFiles();
        program.setTrackedFiles(userFiles.map((i) => i.sourceFile.getFilePath()));
        program.markAllFilesDirty(/* evenIfContentsAreSame */ true);

        // Make sure we keep editor content (open file) which could be different than one in the file system.
        for (const fileInfo of this.getOpened()) {
            const version = fileInfo.sourceFile.getClientVersion();
            if (version === undefined) {
                continue;
            }

            program.setFileOpened(
                fileInfo.sourceFile.getFilePath(),
                version,
                fileInfo.sourceFile.getOpenFileContents() ?? '',
                {
                    chainedFilePath: fileInfo.chainedSourceFile?.sourceFile.getFilePath(),
                    ipythonMode: fileInfo.sourceFile.getIPythonMode(),
                    isTracked: fileInfo.isTracked,
                    realFilePath: fileInfo.sourceFile.getRealFilePath(),
                }
            );
        }

        return program;
    }

    // Returns a value from 0 to 1 (or more) indicating how "full" the cache is
    // relative to some predetermined high-water mark. We'll compute this value
    // based on two easy-to-compute metrics: the number of entries in the type
    // cache and the number of parsed files.
    getCacheUsage() {
        const typeCacheEntryCount = this._evaluator!.getTypeCacheEntryCount();
        const entryCountRatio = typeCacheEntryCount / 750000;
        const fileCountRatio = this._parsedFileCount / 1000;

        return Math.max(entryCountRatio, fileCountRatio);
    }

    // Discards any cached information associated with this program.
    emptyCache() {
        this._createNewEvaluator();
        this._discardCachedParseResults();
        this._parsedFileCount = 0;
        Extensions.getProgramExtensions(this.rootPath).forEach((e) => (e.clearCache ? e.clearCache() : null));
    }

    private _handleMemoryHighUsage() {
        const cacheUsage = this._cacheManager.getCacheUsage();

        // If the total cache has exceeded 75%, determine whether we should empty
        // the cache.
        if (cacheUsage > 0.75) {
            const usedHeapRatio = this._cacheManager.getUsedHeapRatio(
                this._configOptions.verboseOutput ? this._console : undefined
            );

            // The type cache uses a Map, which has an absolute limit of 2^24 entries
            // before it will fail. If we cross the 95% mark, we'll empty the cache.
            const absoluteMaxCacheEntryCount = (1 << 24) * 0.9;
            const typeCacheEntryCount = this._evaluator!.getTypeCacheEntryCount();

            // If we use more than 90% of the heap size limit, avoid a crash
            // by emptying the type cache.
            if (typeCacheEntryCount > absoluteMaxCacheEntryCount || usedHeapRatio > 0.9) {
                this._cacheManager.emptyCache(this._console);
            }
        }
    }

    // Discards all cached parse results and file contents to free up memory.
    // It does not discard cached index results or diagnostics for files.
    private _discardCachedParseResults() {
        for (const sourceFileInfo of this._sourceFileList) {
            sourceFileInfo.sourceFile.dropParseAndBindInfo();
        }
    }

    // Wrapper function that should be used when invoking this._evaluator
    // with a cancellation token. It handles cancellation exceptions and
    // any other unexpected exceptions.
    private _runEvaluatorWithCancellationToken<T>(token: CancellationToken | undefined, callback: () => T): T {
        try {
            if (token) {
                return this._evaluator!.runWithCancellationToken(token, callback);
            } else {
                return callback();
            }
        } catch (e: any) {
            // An unexpected exception occurred, potentially leaving the current evaluator
            // in an inconsistent state. Discard it and replace it with a fresh one. It is
            // Cancellation exceptions are known to handle this correctly.
            if (!OperationCanceledException.is(e) || e.isTypeCacheInvalid) {
                this._createNewEvaluator();
            }
            throw e;
        }
    }

    // Returns a list of empty file diagnostic entries for the files
    // that have been removed. This is needed to clear out the
    // errors for files that have been deleted or closed.
    private _removeUnneededFiles(): FileDiagnostics[] {
        const fileDiagnostics: FileDiagnostics[] = [];

        // If a file is no longer tracked, opened or shadowed, it can
        // be removed from the program.
        for (let i = 0; i < this._sourceFileList.length; ) {
            const fileInfo = this._sourceFileList[i];
            if (!this._isFileNeeded(fileInfo)) {
                // Clear only if there are any errors for this file.
                if (fileInfo.diagnosticsVersion !== undefined) {
                    fileDiagnostics.push({
                        filePath: fileInfo.sourceFile.getFilePath(),
                        version: fileInfo.sourceFile.getClientVersion(),
                        diagnostics: [],
                    });
                }

                fileInfo.sourceFile.prepareForClose();
                this._removeSourceFileFromListAndMap(fileInfo.sourceFile.getFilePath(), i);

                // Unlink any imports and remove them from the list if
                // they are no longer referenced.
                fileInfo.imports.forEach((importedFile) => {
                    const indexToRemove = importedFile.importedBy.findIndex((fi) => fi === fileInfo);
                    if (indexToRemove < 0) {
                        return;
                    }

                    importedFile.mutate((s) => s.importedBy.splice(indexToRemove, 1));

                    // See if we need to remove the imported file because it
                    // is no longer needed. If its index is >= i, it will be
                    // removed when we get to it.
                    if (!this._isFileNeeded(importedFile)) {
                        const indexToRemove = this._sourceFileList.findIndex((fi) => fi === importedFile);
                        if (indexToRemove >= 0 && indexToRemove < i) {
                            // Clear if there are any errors for this import.
                            if (importedFile.diagnosticsVersion !== undefined) {
                                fileDiagnostics.push({
                                    filePath: importedFile.sourceFile.getFilePath(),
                                    version: importedFile.sourceFile.getClientVersion(),
                                    diagnostics: [],
                                });
                            }

                            importedFile.sourceFile.prepareForClose();
                            this._removeSourceFileFromListAndMap(importedFile.sourceFile.getFilePath(), indexToRemove);
                            i--;
                        }
                    }
                });

                // Remove any shadowed files corresponding to this file.
                fileInfo.shadowedBy.forEach((shadowedFile) => {
                    shadowedFile.mutate((s) => (s.shadows = s.shadows.filter((f) => f !== fileInfo)));
                });
                fileInfo.mutate((s) => (s.shadowedBy = []));
            } else {
                // If we're showing the user errors only for open files, clear
                // out the errors for the now-closed file.
                if (!this._shouldCheckFile(fileInfo) && fileInfo.diagnosticsVersion !== undefined) {
                    fileDiagnostics.push({
                        filePath: fileInfo.sourceFile.getFilePath(),
                        version: fileInfo.sourceFile.getClientVersion(),
                        diagnostics: [],
                    });
                    fileInfo.diagnosticsVersion = undefined;
                }

                i++;
            }
        }

        return fileDiagnostics;
    }

    private _isFileNeeded(fileInfo: SourceFileInfo, skipFileNeededCheck?: boolean) {
        if (fileInfo.sourceFile.isFileDeleted()) {
            return false;
        }

        if (!!skipFileNeededCheck || fileInfo.isTracked || fileInfo.isOpenByClient) {
            return true;
        }

        if (fileInfo.shadows.length > 0) {
            return true;
        }

        if (fileInfo.importedBy.length === 0) {
            return false;
        }

        // It's possible for a cycle of files to be imported
        // by a tracked file but then abandoned. The import cycle
        // will keep the entire group "alive" if we don't detect
        // the condition and garbage collect them.
        return this._isImportNeededRecursive(fileInfo, new Set<string>());
    }

    private _isImportNeededRecursive(fileInfo: SourceFileInfo, recursionSet: Set<string>) {
        if (fileInfo.isTracked || fileInfo.isOpenByClient || fileInfo.shadows.length > 0) {
            return true;
        }

        const filePath = normalizePathCase(this.fileSystem, fileInfo.sourceFile.getFilePath());

        // Avoid infinite recursion.
        if (recursionSet.has(filePath)) {
            return false;
        }

        recursionSet.add(filePath);

        for (const importerInfo of fileInfo.importedBy) {
            if (this._isImportNeededRecursive(importerInfo, recursionSet)) {
                return true;
            }
        }

        return false;
    }

    private _createSourceMapper(
        execEnv: ExecutionEnvironment,
        token: CancellationToken,
        from?: SourceFileInfo,
        mapCompiled?: boolean,
        preferStubs?: boolean
    ) {
        const sourceMapper = new SourceMapper(
            this._importResolver,
            execEnv,
            this._evaluator!,
            (stubFilePath: string, implFilePath: string) => {
                let stubFileInfo = this.getSourceFileInfo(stubFilePath);
                if (!stubFileInfo) {
                    // Special case for import statement like "import X.Y". The SourceFile
                    // for X might not be in memory since import `X.Y` only brings in Y.
                    stubFileInfo = this.addInterimFile(stubFilePath);
                }

                this._addShadowedFile(stubFileInfo, implFilePath);
                return this.getBoundSourceFile(implFilePath);
            },
            (f) => {
                let fileInfo = this.getBoundSourceFileInfo(f);
                if (!fileInfo) {
                    // Special case for import statement like "import X.Y". The SourceFile
                    // for X might not be in memory since import `X.Y` only brings in Y.
                    fileInfo = this.addInterimFile(f);

                    // Even though this file is not referenced by anything, make sure
                    // we have a parse tree for the doc string.
                    this._parseFile(fileInfo, /* content */ undefined, /* force */ true);
                }

                return fileInfo;
            },
            mapCompiled ?? false,
            preferStubs ?? false,
            from,
            token
        );
        return sourceMapper;
    }

    private _isImportAllowed(importer: SourceFileInfo, importResult: ImportResult, isImportStubFile: boolean): boolean {
        // Don't import native libs. We don't want to track these files,
        // and we definitely don't want to attempt to parse them.
        if (importResult.isNativeLib) {
            return false;
        }

        let thirdPartyImportAllowed =
            this._configOptions.useLibraryCodeForTypes ||
            (importResult.importType === ImportType.ThirdParty && !!importResult.pyTypedInfo) ||
            (importResult.importType === ImportType.Local && importer.isThirdPartyPyTypedPresent);

        if (
            importResult.importType === ImportType.ThirdParty ||
            (importer.isThirdPartyImport && importResult.importType === ImportType.Local)
        ) {
            if (this._allowedThirdPartyImports) {
                if (importResult.isRelative) {
                    // If it's a relative import, we'll allow it because the
                    // importer was already deemed to be allowed.
                    thirdPartyImportAllowed = true;
                } else if (
                    this._allowedThirdPartyImports.some((importName: string) => {
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
                    })
                ) {
                    thirdPartyImportAllowed = true;
                }
            } else if (importer.isThirdPartyImport && this._configOptions.useLibraryCodeForTypes) {
                // If the importing file is a third-party import, allow importing of
                // additional third-party imports. This supports the case where the importer
                // is in a py.typed library but is importing from another non-py.typed
                // library. It also supports the case where someone explicitly opens a
                // library source file in their editor.
                thirdPartyImportAllowed = true;
            } else if (
                importResult.isNamespacePackage &&
                Array.from(importResult.filteredImplicitImports.values()).some(
                    (implicitImport) => !!implicitImport.pyTypedInfo
                )
            ) {
                // Handle the case where the import targets a namespace package, and a
                // submodule contained within it has a py.typed marker.
                thirdPartyImportAllowed = true;
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

    private _updateSourceFileImports(sourceFileInfo: SourceFileInfo, options: ConfigOptions): SourceFileInfo[] {
        const filesAdded: SourceFileInfo[] = [];

        // Get the new list of imports and see if it changed from the last
        // list of imports for this file.
        const imports = sourceFileInfo.sourceFile.getImports();

        // Create a local function that determines whether the import should
        // be considered a "third-party import" and whether it is coming from
        // a third-party package that claims to be typed. An import is
        // considered third-party if it is external to the importer
        // or is internal but the importer is itself a third-party package.
        const getThirdPartyImportInfo = (importResult: ImportResult) => {
            let isThirdPartyImport = false;
            let isPyTypedPresent = false;

            if (importResult.importType === ImportType.ThirdParty) {
                isThirdPartyImport = true;
                if (importResult.pyTypedInfo) {
                    isPyTypedPresent = true;
                }
            } else if (sourceFileInfo.isThirdPartyImport && importResult.importType === ImportType.Local) {
                isThirdPartyImport = true;
                if (sourceFileInfo.isThirdPartyPyTypedPresent) {
                    isPyTypedPresent = true;
                }
            }

            return {
                isThirdPartyImport,
                isPyTypedPresent,
            };
        };

        // Create a map of unique imports, since imports can appear more than once.
        const newImportPathMap = new Map<string, UpdateImportInfo>();

        // Add chained source file as import if it exists.
        if (sourceFileInfo.chainedSourceFile) {
            if (sourceFileInfo.chainedSourceFile.sourceFile.isFileDeleted()) {
                sourceFileInfo.chainedSourceFile = undefined;
            } else {
                const filePath = sourceFileInfo.chainedSourceFile.sourceFile.getFilePath();
                newImportPathMap.set(normalizePathCase(this.fileSystem, filePath), {
                    path: filePath,
                    isTypeshedFile: false,
                    isThirdPartyImport: false,
                    isPyTypedPresent: false,
                });
            }
        }

        imports.forEach((importResult) => {
            if (importResult.isImportFound) {
                if (this._isImportAllowed(sourceFileInfo, importResult, importResult.isStubFile)) {
                    if (importResult.resolvedPaths.length > 0) {
                        const filePath = importResult.resolvedPaths[importResult.resolvedPaths.length - 1];
                        if (filePath) {
                            const thirdPartyTypeInfo = getThirdPartyImportInfo(importResult);
                            newImportPathMap.set(normalizePathCase(this.fileSystem, filePath), {
                                path: filePath,
                                isTypeshedFile:
                                    !!importResult.isStdlibTypeshedFile || !!importResult.isThirdPartyTypeshedFile,
                                isThirdPartyImport: thirdPartyTypeInfo.isThirdPartyImport,
                                isPyTypedPresent: thirdPartyTypeInfo.isPyTypedPresent,
                            });
                        }
                    }
                }

                importResult.filteredImplicitImports.forEach((implicitImport) => {
                    if (this._isImportAllowed(sourceFileInfo, importResult, implicitImport.isStubFile)) {
                        if (!implicitImport.isNativeLib) {
                            const thirdPartyTypeInfo = getThirdPartyImportInfo(importResult);
                            newImportPathMap.set(normalizePathCase(this.fileSystem, implicitImport.path), {
                                path: implicitImport.path,
                                isTypeshedFile:
                                    !!importResult.isStdlibTypeshedFile || !!importResult.isThirdPartyTypeshedFile,
                                isThirdPartyImport: thirdPartyTypeInfo.isThirdPartyImport,
                                isPyTypedPresent: thirdPartyTypeInfo.isPyTypedPresent,
                            });
                        }
                    }
                });

                // If the stub was found but the non-stub (source) file was not, dump
                // the failure to the log for diagnostic purposes.
                if (importResult.nonStubImportResult && !importResult.nonStubImportResult.isImportFound) {
                    // We'll skip this for imports from within stub files and imports that target
                    // stdlib typeshed stubs because many of these are known to not have
                    // associated source files, and we don't want to fill the logs with noise.
                    if (!sourceFileInfo.sourceFile.isStubFile() && !importResult.isStdlibTypeshedFile) {
                        if (options.verboseOutput) {
                            this._console.info(
                                `Could not resolve source for '${importResult.importName}' ` +
                                    `in file '${sourceFileInfo.sourceFile.getFilePath()}'`
                            );

                            if (importResult.nonStubImportResult.importFailureInfo) {
                                importResult.nonStubImportResult.importFailureInfo.forEach((diag) => {
                                    this._console.info(`  ${diag}`);
                                });
                            }
                        }
                    }
                }
            } else if (options.verboseOutput) {
                this._console.info(
                    `Could not import '${importResult.importName}' ` +
                        `in file '${sourceFileInfo.sourceFile.getFilePath()}'`
                );
                if (importResult.importFailureInfo) {
                    importResult.importFailureInfo.forEach((diag) => {
                        this._console.info(`  ${diag}`);
                    });
                }
            }
        });

        const updatedImportMap = new Map<string, SourceFileInfo>();
        sourceFileInfo.imports.forEach((importInfo) => {
            const oldFilePath = normalizePathCase(this.fileSystem, importInfo.sourceFile.getFilePath());

            // A previous import was removed.
            if (!newImportPathMap.has(oldFilePath)) {
                importInfo.mutate((s) => {
                    s.importedBy = s.importedBy.filter(
                        (fi) =>
                            normalizePathCase(this.fileSystem, fi.sourceFile.getFilePath()) !==
                            normalizePathCase(this.fileSystem, sourceFileInfo.sourceFile.getFilePath())
                    );
                });
            } else {
                updatedImportMap.set(oldFilePath, importInfo);
            }
        });

        // See if there are any new imports to be added.
        newImportPathMap.forEach((importInfo, normalizedImportPath) => {
            if (!updatedImportMap.has(normalizedImportPath)) {
                // We found a new import to add. See if it's already part
                // of the program.
                let importedFileInfo = this.getSourceFileInfo(importInfo.path);
                if (!importedFileInfo) {
                    const importName = this._getImportNameForFile(importInfo.path);
                    const sourceFile = new SourceFile(
                        this.fileSystem,
                        importInfo.path,
                        importName,
                        importInfo.isThirdPartyImport,
                        importInfo.isPyTypedPresent,
                        this._editModeTracker,
                        this._console,
                        this._logTracker
                    );
                    importedFileInfo = new SourceFileInfo(
                        sourceFile,
                        importInfo.isTypeshedFile,
                        importInfo.isThirdPartyImport,
                        importInfo.isPyTypedPresent,
                        this._editModeTracker
                    );

                    this._addToSourceFileListAndMap(importedFileInfo);
                    filesAdded.push(importedFileInfo);
                }

                importedFileInfo.mutate((s) => s.importedBy.push(sourceFileInfo));
                updatedImportMap.set(normalizedImportPath, importedFileInfo);
            }
        });

        // Update the imports list. It should now map the set of imports
        // specified by the source file.
        sourceFileInfo.mutate((s) => (s.imports = []));
        newImportPathMap.forEach((_, path) => {
            if (this.getSourceFileInfo(path)) {
                sourceFileInfo.mutate((s) => s.imports.push(this.getSourceFileInfo(path)!));
            }
        });

        // Resolve the builtins import for the file. This needs to be
        // analyzed before the file can be analyzed.
        sourceFileInfo.builtinsImport = undefined;
        const builtinsImport = sourceFileInfo.sourceFile.getBuiltinsImport();
        if (builtinsImport && builtinsImport.isImportFound) {
            const resolvedBuiltinsPath = builtinsImport.resolvedPaths[builtinsImport.resolvedPaths.length - 1];
            sourceFileInfo.builtinsImport = this.getSourceFileInfo(resolvedBuiltinsPath);
        }

        // Resolve the ipython display import for the file. This needs to be
        // analyzed before the file can be analyzed.
        sourceFileInfo.ipythonDisplayImport = undefined;
        const ipythonDisplayImport = sourceFileInfo.sourceFile.getIPythonDisplayImport();
        if (ipythonDisplayImport && ipythonDisplayImport.isImportFound) {
            const resolvedIPythonDisplayPath =
                ipythonDisplayImport.resolvedPaths[ipythonDisplayImport.resolvedPaths.length - 1];
            sourceFileInfo.ipythonDisplayImport = this.getSourceFileInfo(resolvedIPythonDisplayPath);
        }

        return filesAdded;
    }

    private _removeSourceFileFromListAndMap(filePath: string, indexToRemove: number) {
        this._sourceFileMap.delete(normalizePathCase(this.fileSystem, filePath));
        this._sourceFileList.splice(indexToRemove, 1);
    }

    private _addToSourceFileListAndMap(fileInfo: SourceFileInfo) {
        const filePath = normalizePathCase(this.fileSystem, fileInfo.sourceFile.getFilePath());

        // We should never add a file with the same path twice.
        assert(!this._sourceFileMap.has(filePath));

        this._sourceFileList.push(fileInfo);
        this._sourceFileMap.set(filePath, fileInfo);
    }

    private static _getPrintTypeFlags(configOptions: ConfigOptions): PrintTypeFlags {
        let flags = PrintTypeFlags.None;

        if (configOptions.diagnosticRuleSet.printUnknownAsAny) {
            flags |= PrintTypeFlags.PrintUnknownWithAny;
        }

        if (configOptions.diagnosticRuleSet.omitConditionalConstraint) {
            flags |= PrintTypeFlags.OmitConditionalConstraint;
        }

        if (configOptions.diagnosticRuleSet.omitTypeArgsIfUnknown) {
            flags |= PrintTypeFlags.OmitTypeArgumentsIfUnknown;
        }

        if (configOptions.diagnosticRuleSet.omitUnannotatedParamType) {
            flags |= PrintTypeFlags.OmitUnannotatedParamType;
        }

        if (configOptions.diagnosticRuleSet.pep604Printing) {
            flags |= PrintTypeFlags.PEP604;
        }

        return flags;
    }

    private _getImportNameForFile(filePath: string) {
        // We allow illegal module names (e.g. names that include "-" in them)
        // because we want a unique name for each module even if it cannot be
        // imported through an "import" statement. It's important to have a
        // unique name in case two modules declare types with the same local
        // name. The type checker uses the fully-qualified (unique) module name
        // to differentiate between such types.
        const moduleNameAndType = this._importResolver.getModuleNameForImport(
            filePath,
            this._configOptions.getDefaultExecEnvironment(),
            /* allowIllegalModuleName */ true
        );
        return moduleNameAndType.moduleName;
    }

    // A "shadowed" file is a python source file that has been added to the program because
    // it "shadows" a type stub file for purposes of finding doc strings and definitions.
    // We need to track the relationship so if the original type stub is removed from the
    // program, we can remove the corresponding shadowed file and any files it imports.
    private _addShadowedFile(stubFile: SourceFileInfo, shadowImplPath: string): SourceFile {
        let shadowFileInfo = this.getSourceFileInfo(shadowImplPath);

        if (!shadowFileInfo) {
            shadowFileInfo = this.addInterimFile(shadowImplPath);
        }

        if (!shadowFileInfo.shadows.includes(stubFile)) {
            shadowFileInfo.mutate((s) => s.shadows.push(stubFile));
        }

        if (!stubFile.shadowedBy.includes(shadowFileInfo)) {
            stubFile.mutate((s) => s.shadowedBy.push(shadowFileInfo!));
        }

        return shadowFileInfo.sourceFile;
    }

    private _createInterimFileInfo(filePath: string) {
        const importName = this._getImportNameForFile(filePath);
        const sourceFile = this._sourceFileFactory.createSourceFile(
            this.fileSystem,
            filePath,
            importName,
            /* isThirdPartyImport */ false,
            /* isInPyTypedPackage */ false,
            this._editModeTracker,
            this._console,
            this._logTracker
        );
        const sourceFileInfo = new SourceFileInfo(
            sourceFile,
            /* isTypeshedFile */ false,
            /* isThirdPartyImport */ false,
            /* isThirdPartyPyTypedPresent */ false,
            this._editModeTracker
        );

        return sourceFileInfo;
    }

    private _createNewEvaluator() {
        if (this._evaluator) {
            // We shouldn't need to call this, but there appears to be a bug
            // in the v8 garbage collector where it's unable to resolve orphaned
            // objects without us giving it some assistance.
            this._evaluator.disposeEvaluator();
        }

        this._evaluator = createTypeEvaluatorWithTracker(
            this._lookUpImport,
            {
                printTypeFlags: Program._getPrintTypeFlags(this._configOptions),
                logCalls: this._configOptions.logTypeEvaluationTime,
                minimumLoggingThreshold: this._configOptions.typeEvaluationTimeThreshold,
                evaluateUnknownImportsAsAny: !!this._configOptions.evaluateUnknownImportsAsAny,
                verifyTypeCacheEvaluatorFlags: !!this._configOptions.internalTestMode,
            },
            this._logTracker,
            this._configOptions.logTypeEvaluationTime
                ? createTracePrinter(
                      this._importResolver.getImportRoots(
                          this._configOptions.findExecEnvironment(this._configOptions.projectRoot)
                      )
                  )
                : undefined
        );

        return this._evaluator;
    }

    private _parseFile(fileToParse: SourceFileInfo, content?: string, skipFileNeededCheck?: boolean) {
        if (!this._isFileNeeded(fileToParse, skipFileNeededCheck) || !fileToParse.sourceFile.isParseRequired()) {
            return;
        }

        // SourceFile.parse should only be called here in the program, as calling it
        // elsewhere could break the entire dependency graph maintained by the program.
        // Other parts of the program should use _parseFile to create ParseResults from
        // the sourceFile. For standalone parseResults, use parseFile or the Parser directly.
        if (fileToParse.sourceFile.parse(this._configOptions, this._importResolver, content)) {
            this._parsedFileCount++;
            this._updateSourceFileImports(fileToParse, this._configOptions);
        }

        if (fileToParse.sourceFile.isFileDeleted()) {
            fileToParse.isTracked = false;

            // Mark any files that depend on this file as dirty
            // also. This will retrigger analysis of these other files.
            const markDirtySet = new Set<string>();
            this._markFileDirtyRecursive(fileToParse, markDirtySet);

            // Invalidate the import resolver's cache as well.
            this._importResolver.invalidateCache();
        }
    }

    private _getImplicitImports(file: SourceFileInfo) {
        // If file is not parsed, then chainedSourceFile, ipythonDisplayImport,
        // builtinsImport might not exist or incorrect.
        // They will be added when _parseFile is called and _updateSourceFileImports ran.
        if (file.builtinsImport === file) {
            return undefined;
        }

        const tryReturn = (input: SourceFileInfo | undefined) => {
            if (!input || input.sourceFile.isFileDeleted()) {
                return undefined;
            }

            return input;
        };

        return tryReturn(file.chainedSourceFile) ?? tryReturn(file.ipythonDisplayImport) ?? file.builtinsImport;
    }

    private _bindImplicitImports(fileToAnalyze: SourceFileInfo, skipFileNeededCheck?: boolean) {
        // Get all of the potential imports for this file.
        const implicitImports: SourceFileInfo[] = [];
        const implicitSet = new Set<string>();

        let nextImplicitImport = this._getImplicitImports(fileToAnalyze);
        while (nextImplicitImport) {
            const implicitPath = nextImplicitImport.sourceFile.getFilePath();
            if (implicitSet.has(implicitPath)) {
                // We've found a cycle. Break out of the loop.
                debug.fail(`Found a cycle in implicit imports files`);
            }

            implicitSet.add(implicitPath);
            implicitImports.push(nextImplicitImport);

            this._parseFile(nextImplicitImport, /* content */ undefined, skipFileNeededCheck);
            nextImplicitImport = this._getImplicitImports(nextImplicitImport);
        }

        if (implicitImports.length === 0) {
            return;
        }

        // Go in reverse order (so top of chain is first).
        let implicitImport = implicitImports.pop();
        while (implicitImport) {
            // Bind this file, but don't recurse into its imports.
            this._bindFile(implicitImport, undefined, skipFileNeededCheck, /* isImplicitImport */ true);
            implicitImport = implicitImports.pop();
        }
    }

    // Binds the specified file and all of its dependencies, recursively. If
    // it runs out of time, it returns true. If it completes, it returns false.
    private _bindFile(
        fileToAnalyze: SourceFileInfo,
        content?: string,
        skipFileNeededCheck?: boolean,
        isImplicitImport?: boolean
    ): void {
        if (!this._isFileNeeded(fileToAnalyze, skipFileNeededCheck) || !fileToAnalyze.sourceFile.isBindingRequired()) {
            return;
        }

        this._parseFile(fileToAnalyze, content, skipFileNeededCheck);

        // Create a function to get the scope info.
        const getScopeIfAvailable = (fileInfo: SourceFileInfo | undefined) => {
            if (!fileInfo || fileInfo === fileToAnalyze) {
                return undefined;
            }

            // If the file was deleted, there's no scope to return.
            if (fileInfo.sourceFile.isFileDeleted()) {
                return undefined;
            }

            const parseResults = fileInfo.sourceFile.getParseResults();
            if (!parseResults) {
                return undefined;
            }

            // File should already be bound because of the chained file binding above.
            const scope = AnalyzerNodeInfo.getScope(parseResults.parseTree);
            return scope;
        };

        let builtinsScope: Scope | undefined;
        if (fileToAnalyze.builtinsImport && fileToAnalyze.builtinsImport !== fileToAnalyze) {
            // Bind all of the implicit imports first. So we don't recurse into them.
            if (!isImplicitImport) {
                this._bindImplicitImports(fileToAnalyze);
            }

            // If it is not builtin module itself, we need to parse and bind
            // the ipython display import if required. Otherwise, get builtin module.
            builtinsScope =
                getScopeIfAvailable(fileToAnalyze.chainedSourceFile) ??
                getScopeIfAvailable(fileToAnalyze.ipythonDisplayImport) ??
                getScopeIfAvailable(fileToAnalyze.builtinsImport);
        }

        let futureImports = fileToAnalyze.sourceFile.getParseResults()!.futureImports;
        if (fileToAnalyze.chainedSourceFile) {
            futureImports = this._getEffectiveFutureImports(futureImports, fileToAnalyze.chainedSourceFile);
        }
        fileToAnalyze.effectiveFutureImports = futureImports.size > 0 ? futureImports : undefined;

        fileToAnalyze.sourceFile.bind(this._configOptions, this._lookUpImport, builtinsScope, futureImports);
    }

    private _getEffectiveFutureImports(futureImports: Set<string>, chainedSourceFile: SourceFileInfo): Set<string> {
        const effectiveFutureImports = new Set<string>(futureImports);

        chainedSourceFile.effectiveFutureImports?.forEach((value) => {
            effectiveFutureImports.add(value);
        });

        return effectiveFutureImports;
    }

    private _lookUpImport = (
        filePathOrModule: string | AbsoluteModuleDescriptor,
        options?: LookupImportOptions
    ): ImportLookupResult | undefined => {
        let sourceFileInfo: SourceFileInfo | undefined;

        if (typeof filePathOrModule === 'string') {
            sourceFileInfo = this.getSourceFileInfo(filePathOrModule);
        } else {
            // Resolve the import.
            const importResult = this._importResolver.resolveImport(
                filePathOrModule.importingFilePath,
                this._configOptions.findExecEnvironment(filePathOrModule.importingFilePath),
                {
                    leadingDots: 0,
                    nameParts: filePathOrModule.nameParts,
                    importedSymbols: undefined,
                }
            );

            if (importResult.isImportFound && !importResult.isNativeLib && importResult.resolvedPaths.length > 0) {
                let resolvedPath = importResult.resolvedPaths[importResult.resolvedPaths.length - 1];
                if (resolvedPath) {
                    // See if the source file already exists in the program.
                    sourceFileInfo = this.getSourceFileInfo(resolvedPath);

                    if (!sourceFileInfo) {
                        resolvedPath = normalizePathCase(this.fileSystem, resolvedPath);

                        // Start tracking the source file.
                        this.addTrackedFile(resolvedPath);
                        sourceFileInfo = this.getSourceFileInfo(resolvedPath);
                    }
                }
            }
        }

        if (!sourceFileInfo) {
            return undefined;
        }

        if (options?.skipParsing) {
            // Return dummy information if the caller has indicated that parsing is
            // unnecessary. This is used in cases where the caller simply wants to
            // know if the source file exists but is not interested in the contents.
            return {
                symbolTable: new Map<string, Symbol>(),
                dunderAllNames: undefined,
                usesUnsupportedDunderAllForm: false,
                get docString() {
                    return undefined;
                },
                isInPyTypedPackage: false,
            };
        }

        if (sourceFileInfo.sourceFile.isBindingRequired()) {
            // Bind the file if it's not already bound. Don't count this time
            // against the type checker.
            timingStats.typeCheckerTime.subtractFromTime(() => {
                this._bindFile(sourceFileInfo!, /* content */ undefined, options?.skipFileNeededCheck);
            });
        }

        const symbolTable = sourceFileInfo.sourceFile.getModuleSymbolTable();
        if (!symbolTable) {
            return undefined;
        }

        const parseResults = sourceFileInfo.sourceFile.getParseResults();
        const moduleNode = parseResults!.parseTree;
        const fileInfo = AnalyzerNodeInfo.getFileInfo(moduleNode);

        const dunderAllInfo = AnalyzerNodeInfo.getDunderAllInfo(parseResults!.parseTree);

        return {
            symbolTable,
            dunderAllNames: dunderAllInfo?.names,
            usesUnsupportedDunderAllForm: dunderAllInfo?.usesUnsupportedDunderAllForm ?? false,
            get docString() {
                return getDocString(moduleNode.statements);
            },
            isInPyTypedPackage: fileInfo.isInPyTypedPackage,
        };
    };

    private _shouldCheckFile(fileInfo: SourceFileInfo) {
        // Always do a full checking for a file that's open in the editor.
        if (fileInfo.isOpenByClient) {
            return true;
        }

        // If the file isn't currently open, only perform full checking for
        // files that are tracked, and only if the checkOnlyOpenFiles is disabled.
        if (!this._configOptions.checkOnlyOpenFiles && fileInfo.isTracked) {
            return true;
        }

        return false;
    }

    private _checkTypes(fileToCheck: SourceFileInfo, token: CancellationToken, chainedByList?: SourceFileInfo[]) {
        return this._logTracker.log(`analyzing: ${fileToCheck.sourceFile.getFilePath()}`, (logState) => {
            // If the file isn't needed because it was eliminated from the
            // transitive closure or deleted, skip the file rather than wasting
            // time on it.
            if (!this._isFileNeeded(fileToCheck)) {
                logState.suppress();
                return false;
            }

            if (!fileToCheck.sourceFile.isCheckingRequired()) {
                logState.suppress();
                return false;
            }

            if (!this._shouldCheckFile(fileToCheck)) {
                logState.suppress();
                return false;
            }

            if (!this._disableChecker) {
                // For ipython, make sure we check all its dependent files first since
                // their results can affect this file's result.
                const dependentFiles = this._checkDependentFiles(fileToCheck, chainedByList, token);

                this._bindFile(fileToCheck);
                if (this._preCheckCallback) {
                    const parseResults = fileToCheck.sourceFile.getParseResults();
                    if (parseResults) {
                        this._preCheckCallback(parseResults, this._evaluator!);
                    }
                }

                const execEnv = this._configOptions.findExecEnvironment(fileToCheck.sourceFile.getFilePath());
                fileToCheck.sourceFile.check(
                    this.configOptions,
                    this._importResolver,
                    this._evaluator!,
                    this._createSourceMapper(execEnv, token, fileToCheck),
                    dependentFiles
                );
            }

            // For very large programs, we may need to discard the evaluator and
            // its cached types to avoid running out of heap space.
            this._handleMemoryHighUsage();

            // Detect import cycles that involve the file.
            if (this._configOptions.diagnosticRuleSet.reportImportCycles !== 'none') {
                // Don't detect import cycles when doing type stub generation. Some
                // third-party modules are pretty convoluted.
                // Or if the file is the notebook cell. notebook cell can't have cycles.
                if (
                    !this._allowedThirdPartyImports &&
                    fileToCheck.sourceFile.getIPythonMode() !== IPythonMode.CellDocs
                ) {
                    // We need to force all of the files to be parsed and build
                    // a closure map for the files.
                    const closureMap = new Map<string, SourceFileInfo>();
                    this._getImportsRecursive(fileToCheck, closureMap, 0);

                    closureMap.forEach((file) => {
                        timingStats.cycleDetectionTime.timeOperation(() => {
                            const filesVisitedMap = new Map<string, SourceFileInfo>();

                            if (!this._detectAndReportImportCycles(file, filesVisitedMap)) {
                                // If no cycles were found in any of the files we visited,
                                // set a flag to indicates that we don't need to visit them again
                                // on subsequent cycle checks.
                                filesVisitedMap.forEach((sourceFileInfo) => {
                                    sourceFileInfo.sourceFile.setNoCircularDependencyConfirmed();
                                });
                            }
                        });
                    });
                }
            }

            return true;
        });
    }

    private _checkDependentFiles(
        fileToCheck: SourceFileInfo,
        chainedByList: SourceFileInfo[] | undefined,
        token: CancellationToken
    ) {
        if (fileToCheck.sourceFile.getIPythonMode() !== IPythonMode.CellDocs) {
            return undefined;
        }

        // If we don't have chainedByList, it means none of them are checked yet.
        const needToRunChecker = !chainedByList;

        chainedByList = chainedByList ?? createChainedByList(this, fileToCheck);
        const index = chainedByList.findIndex((v) => v === fileToCheck);
        if (index < 0) {
            return undefined;
        }

        const startIndex = index + 1;
        if (startIndex >= chainedByList.length) {
            return undefined;
        }

        if (needToRunChecker) {
            // If the file is already analyzed, it will be no op.
            // And make sure we don't dump parse tree and etc while
            // calling checker. Otherwise, checkType can dump parse
            // tree required by outer check.
            const handle = this._cacheManager.pauseTracking();
            try {
                for (let i = chainedByList.length - 1; i >= startIndex; i--) {
                    this._checkTypes(chainedByList[i], token, chainedByList);
                }
            } finally {
                handle.dispose();
            }
        }

        const dependentFiles = [];
        for (let i = startIndex; i < chainedByList.length; i++) {
            const file = chainedByList[i];
            const parseResults = file?.sourceFile.getParseResults();
            if (!parseResults) {
                continue;
            }

            // We might not have the file info if binding failed for whatever reasons.
            const fileInfo = AnalyzerNodeInfo.getFileInfo(parseResults.parseTree);
            if (fileInfo && fileInfo.accessedSymbolSet) {
                dependentFiles.push(parseResults);
            }
        }

        return dependentFiles;
    }

    // Builds a map of files that includes the specified file and all of the files
    // it imports (recursively) and ensures that all such files. If any of these files
    // have already been checked (they and their recursive imports have completed the
    // check phase), they are not included in the results.
    private _getImportsRecursive(
        file: SourceFileInfo,
        closureMap: Map<string, SourceFileInfo>,
        recursionCount: number
    ) {
        // If the file is already in the closure map, we found a cyclical
        // dependency. Don't recur further.
        const filePath = normalizePathCase(this.fileSystem, file.sourceFile.getFilePath());
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

        // If this file hasn't already been parsed, parse it now. This will
        // discover any files it imports. Skip this if the file is part
        // of a library. We'll assume that no cycles will be generated from
        // library code or typeshed stubs.
        if (isUserCode(file)) {
            this._parseFile(file);
        }

        // Recursively add the file's imports.
        for (const importedFileInfo of file.imports) {
            this._getImportsRecursive(importedFileInfo, closureMap, recursionCount + 1);
        }
    }

    private _detectAndReportImportCycles(
        sourceFileInfo: SourceFileInfo,
        filesVisited: Map<string, SourceFileInfo>,
        dependencyChain: SourceFileInfo[] = [],
        dependencyMap = new Map<string, boolean>()
    ): boolean {
        // Don't bother checking for typestub files or third-party files.
        if (sourceFileInfo.sourceFile.isStubFile() || sourceFileInfo.isThirdPartyImport) {
            return false;
        }

        // If we've already confirmed that this source file isn't part of a
        // cycle, we can skip it entirely.
        if (sourceFileInfo.sourceFile.isNoCircularDependencyConfirmed()) {
            return false;
        }

        const filePath = normalizePathCase(this.fileSystem, sourceFileInfo.sourceFile.getFilePath());

        filesVisited.set(filePath, sourceFileInfo);

        let detectedCycle = false;

        if (dependencyMap.has(filePath)) {
            // We detect a cycle (partial or full). A full cycle is one that is
            // rooted in the file at the start of our dependency chain. A partial
            // cycle loops back on some other file in the dependency chain. We
            // will report only full cycles here and leave the reporting of
            // partial cycles to other passes.
            detectedCycle = true;

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
                return false;
            }

            // We use both a map (for fast lookups) and a list
            // (for ordering information). Set the dependency map
            // entry to true to indicate that we're actively exploring
            // that dependency.
            dependencyMap.set(filePath, true);
            dependencyChain.push(sourceFileInfo);

            for (const imp of sourceFileInfo.imports) {
                if (this._detectAndReportImportCycles(imp, filesVisited, dependencyChain, dependencyMap)) {
                    detectedCycle = true;
                }
            }

            // Set the dependencyMap entry to false to indicate that we have
            // already explored this file and don't need to explore it again.
            dependencyMap.set(filePath, false);
            dependencyChain.pop();
        }

        return detectedCycle;
    }

    private _logImportCycle(dependencyChain: SourceFileInfo[]) {
        const circDep = new CircularDependency();
        dependencyChain.forEach((sourceFileInfo) => {
            circDep.appendPath(sourceFileInfo.sourceFile.getFilePath());
        });

        circDep.normalizeOrder();
        const firstFilePath = circDep.getPaths()[0];
        const firstSourceFile = this.getSourceFileInfo(firstFilePath)!;
        assert(firstSourceFile !== undefined);
        firstSourceFile.sourceFile.addCircularDependency(this.configOptions, circDep);
    }

    private _markFileDirtyRecursive(sourceFileInfo: SourceFileInfo, markSet: Set<string>, forceRebinding = false) {
        const filePath = normalizePathCase(this.fileSystem, sourceFileInfo.sourceFile.getFilePath());

        // Don't mark it again if it's already been visited.
        if (markSet.has(filePath)) {
            return;
        }

        sourceFileInfo.sourceFile.markReanalysisRequired(forceRebinding);
        markSet.add(filePath);

        sourceFileInfo.importedBy.forEach((dep) => {
            // Changes on chained source file can change symbols in the symbol table and
            // dependencies on the dependent file. Force rebinding.
            const forceRebinding = dep.chainedSourceFile === sourceFileInfo;
            this._markFileDirtyRecursive(dep, markSet, forceRebinding);
        });

        // Change in the current file could impact checker result of chainedSourceFile such as unused symbols.
        let chainedSourceFile = sourceFileInfo.chainedSourceFile;
        while (chainedSourceFile) {
            if (chainedSourceFile.sourceFile.isCheckingRequired()) {
                // If the file is marked for checking, its chained one should be marked
                // as well. Stop here.
                return;
            }

            chainedSourceFile.sourceFile.markReanalysisRequired(/* forceRebinding */ false);
            chainedSourceFile = chainedSourceFile.chainedSourceFile;
        }
    }
}
