/*
* service.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* A persistent service that is able to analyze a collection of
* Python files.
*/
import * as assert from 'assert';
import { CompletionItem, CompletionList, DocumentSymbol, SymbolInformation } from 'vscode-languageserver';

import { CommandLineOptions } from '../common/commandLineOptions';
import { ConfigOptions } from '../common/configOptions';
import { ConsoleInterface, StandardConsole } from '../common/console';
import { Diagnostic } from '../common/diagnostic';
import { FileDiagnostics } from '../common/diagnosticSink';
import { FileEditAction, TextEditAction } from '../common/editAction';
import {
    combinePaths, FileSpec, forEachAncestorDirectory, getDirectoryPath,
    getFileName, getFileSpec, getFileSystemEntries, isDirectory,
    normalizePath, stripFileExtension
} from '../common/pathUtils';
import { DocumentRange, Position, Range } from '../common/textRange';
import { Duration, timingStats } from '../common/timing';
import { FileWatcher, VirtualFileSystem } from '../common/vfs';
import { HoverResults } from '../languageService/hoverProvider';
import { SignatureHelpResults } from '../languageService/signatureHelpProvider';
import { ImportedModuleDescriptor, ImportResolver, ImportResolverFactory } from './importResolver';
import { MaxAnalysisTime, Program } from './program';
import * as PythonPathUtils from './pythonPathUtils';

export { MaxAnalysisTime } from './program';

export interface AnalysisResults {
    diagnostics: FileDiagnostics[];
    filesInProgram: number;
    checkingOnlyOpenFiles: boolean;
    filesRequiringAnalysis: number;
    fatalErrorOccurred: boolean;
    configParseErrorOccurred: boolean;
    elapsedTime: number;
}

export type AnalysisCompleteCallback = (results: AnalysisResults) => void;

const _configFileNames = ['pyrightconfig.json', 'mspythonconfig.json'];

export class AnalyzerService {
    private _instanceName: string;
    private _program: Program;
    private _configOptions: ConfigOptions;
    private _importResolverFactory: ImportResolverFactory;
    private _importResolver: ImportResolver;
    private _executionRootPath: string;
    private _typeStubTargetImportName: string | undefined;
    private _typeStubTargetPath: string | undefined;
    private _typeStubTargetIsSingleFile = false;
    private _console: ConsoleInterface;
    private _sourceFileWatcher: FileWatcher | undefined;
    private _reloadConfigTimer: any;
    private _configFilePath: string | undefined;
    private _configFileWatcher: FileWatcher | undefined;
    private _onCompletionCallback: AnalysisCompleteCallback | undefined;
    private _watchForSourceChanges = false;
    private _verboseOutput = false;
    private _maxAnalysisTime?: MaxAnalysisTime;
    private _analyzeTimer: any;
    private _requireTrackedFileUpdate = true;
    private _lastUserInteractionTime = Date.now();

    constructor(instanceName: string, fs: VirtualFileSystem, console?: ConsoleInterface, importResolverFactory?: ImportResolverFactory, configOptions?: ConfigOptions) {
        this._instanceName = instanceName;
        this._console = console || new StandardConsole();
        this._configOptions = configOptions ?? new ConfigOptions(process.cwd());
        this._importResolverFactory = importResolverFactory || AnalyzerService.createImportResolver;
        this._importResolver = this._importResolverFactory(fs, this._configOptions);
        this._program = new Program(this._importResolver, this._configOptions, this._console);
        this._executionRootPath = '';
        this._typeStubTargetImportName = undefined;
    }

    dispose() {
        this._removeSourceFileWatchers();
        this._removeConfigFileWatcher();
        this._clearReloadConfigTimer();
        this._clearReanalysisTimer();
    }

    static createImportResolver(fs: VirtualFileSystem, options: ConfigOptions): ImportResolver {
        return new ImportResolver(fs, options);
    }

    setCompletionCallback(callback: AnalysisCompleteCallback | undefined): void {
        this._onCompletionCallback = callback;
    }

    setMaxAnalysisDuration(maxAnalysisTime?: MaxAnalysisTime) {
        this._maxAnalysisTime = maxAnalysisTime;
    }

    setOptions(commandLineOptions: CommandLineOptions): void {
        this._watchForSourceChanges = !!commandLineOptions.watch;
        this._verboseOutput = !!commandLineOptions.verboseOutput;
        this._configOptions = this._getConfigOptions(commandLineOptions);
        this._program.setConfigOptions(this._configOptions);
        this._typeStubTargetImportName = commandLineOptions.typeStubTargetImportName;

        this._executionRootPath = normalizePath(combinePaths(
            commandLineOptions.executionRoot, this._configOptions.projectRoot));
        this._applyConfigOptions();
    }

    setFileOpened(path: string, version: number | null, contents: string) {
        this._program.setFileOpened(path, version, contents);
        this._scheduleReanalysis(false);
    }

    updateOpenFileContents(path: string, version: number | null, contents: string) {
        this._program.setFileOpened(path, version, contents);
        this._program.markFilesDirty([path]);
        this._scheduleReanalysis(false);
    }

    setFileClosed(path: string) {
        const fileDiagnostics = this._program.setFileClosed(path);
        this._reportDiagnosticsForRemovedFiles(fileDiagnostics);
        this._scheduleReanalysis(false);
    }

    getDefinitionForPosition(filePath: string, position: Position):
        DocumentRange[] | undefined {

        return this._program.getDefinitionsForPosition(filePath, position);
    }

    getReferencesForPosition(filePath: string, position: Position,
        includeDeclaration: boolean): DocumentRange[] | undefined {

        return this._program.getReferencesForPosition(filePath, position, includeDeclaration);
    }

    addSymbolsForDocument(filePath: string, symbolList: DocumentSymbol[]) {
        this._program.addSymbolsForDocument(filePath, symbolList);
    }

    addSymbolsForWorkspace(symbolList: SymbolInformation[], query: string) {
        this._program.addSymbolsForWorkspace(symbolList, query);
    }

    getHoverForPosition(filePath: string, position: Position):
        HoverResults | undefined {

        return this._program.getHoverForPosition(filePath, position);
    }

    getSignatureHelpForPosition(filePath: string, position: Position):
        SignatureHelpResults | undefined {

        return this._program.getSignatureHelpForPosition(filePath, position);
    }

    getCompletionsForPosition(filePath: string, position: Position,
        workspacePath: string): CompletionList | undefined {

        return this._program.getCompletionsForPosition(filePath, position, workspacePath);
    }

    resolveCompletionItem(filePath: string, completionItem: CompletionItem) {
        this._program.resolveCompletionItem(filePath, completionItem);
    }

    performQuickAction(filePath: string, command: string, args: any[]): TextEditAction[] | undefined {
        return this._program.performQuickAction(filePath, command, args);
    }

    renameSymbolAtPosition(filePath: string, position: Position,
        newName: string): FileEditAction[] | undefined {

        return this._program.renameSymbolAtPosition(filePath, position, newName);
    }

    printStats() {
        this._console.log('');
        this._console.log('Analysis stats');

        const fileCount = this._program.getFileCount();
        this._console.log('Total files analyzed: ' + fileCount.toString());
    }

    printDependencies(verbose: boolean) {
        this._program.printDependencies(this._executionRootPath, verbose);
    }

    test_getConfigOptions(commandLineOptions: CommandLineOptions): ConfigOptions {
        return this._getConfigOptions(commandLineOptions);
    }

    test_getFileNamesFromFileSpecs(): string[] {
        return this._getFileNamesFromFileSpecs();
    }

    getDiagnosticsForRange(filePath: string, range: Range): Diagnostic[] {
        return this._program.getDiagnosticsForRange(filePath, this._configOptions, range);
    }

    recordUserInteractionTime() {
        this._lastUserInteractionTime = Date.now();

        // If we have a pending timer for reanalysis, cancel it
        // and reschedule for some time in the future.
        if (this._analyzeTimer) {
            this._scheduleReanalysis(false);
        }
    }

    // Calculates the effective options based on the command-line options,
    // an optional config file, and default values.
    private _getConfigOptions(commandLineOptions: CommandLineOptions): ConfigOptions {
        let projectRoot = commandLineOptions.executionRoot;
        let configFilePath: string | undefined;

        if (commandLineOptions.fileSpecs && commandLineOptions.fileSpecs.length > 0) {
            // If file specs were passed in to the command line, no config file
            // will be used. In this case, all file specs are assumed to be
            // relative to the current working directory.
            if (commandLineOptions.configFilePath) {
                this._console.log('Project cannot be mixed with source files on a command line.');
            }
        } else if (commandLineOptions.configFilePath) {
            // If the config file path was specified, determine whether it's
            // a directory (in which case the default config file name is assumed)
            // or a file.
            configFilePath = combinePaths(commandLineOptions.executionRoot,
                normalizePath(commandLineOptions.configFilePath));
            if (!this._fs.existsSync(configFilePath)) {
                this._console.log(`Configuration file not found at ${ configFilePath }.`);
                configFilePath = commandLineOptions.executionRoot;
            } else {
                if (configFilePath.toLowerCase().endsWith('.json')) {
                    projectRoot = getDirectoryPath(configFilePath);
                } else {
                    projectRoot = configFilePath;
                    configFilePath = this._findConfigFile(configFilePath);
                    if (!configFilePath) {
                        this._console.log(`Configuration file not found at ${ projectRoot }.`);
                    }
                }
            }
        } else if (projectRoot) {
            configFilePath = this._findConfigFileHereOrUp(projectRoot);
            if (configFilePath) {
                projectRoot = getDirectoryPath(configFilePath);
            } else {
                this._console.log(`No configuration file found.`);
                configFilePath = undefined;
            }
        }

        const configOptions = new ConfigOptions(projectRoot);
        const defaultExcludes = ['**/node_modules', '**/__pycache__', '.venv', '.git'];

        if (commandLineOptions.fileSpecs.length > 0) {
            commandLineOptions.fileSpecs.forEach(fileSpec => {
                configOptions.include.push(getFileSpec(projectRoot, fileSpec));
            });
        } else if (!configFilePath) {
            // If no config file was found and there are no explicit include
            // paths specified, assume the caller wants to include all source
            // files under the execution root path.
            if (commandLineOptions.executionRoot) {
                configOptions.include.push(getFileSpec(commandLineOptions.executionRoot, '.'));

                // Add a few common excludes to avoid long scan times.
                defaultExcludes.forEach(exclude => {
                    configOptions.exclude.push(getFileSpec(commandLineOptions.executionRoot, exclude));
                });
            }
        }

        this._configFilePath = configFilePath;

        // If we found a config file, parse it to compute the effective options.
        if (configFilePath) {
            this._console.log(`Loading configuration file at ${ configFilePath }`);
            const configJsonObj = this._parseConfigFile(configFilePath);
            if (configJsonObj) {
                configOptions.initializeFromJson(configJsonObj, this._console);

                const configFileDir = getDirectoryPath(configFilePath);

                // If no include paths were provided, assume that all files within
                // the project should be included.
                if (configOptions.include.length === 0) {
                    this._console.log(`No include entries specified; assuming ${ configFilePath }`);
                    configOptions.include.push(getFileSpec(configFileDir, '.'));
                }

                // If there was no explicit set of excludes, add a few common ones to avoid long scan times.
                if (configOptions.exclude.length === 0) {
                    defaultExcludes.forEach(exclude => {
                        this._console.log(`Auto-excluding ${ exclude }`);
                        configOptions.exclude.push(getFileSpec(configFileDir, exclude));
                    });
                }
            }
            this._updateConfigFileWatcher();
        }

        const reportDuplicateSetting = (settingName: string) => {
            const settingSource = commandLineOptions.fromVsCodeExtension ?
                'the VS Code settings' : 'a command-line option';
            this._console.log(
                `The ${ settingName } has been specified in both the config file and ` +
                `${ settingSource }. The value in the config file (${ configOptions.venvPath }) ` +
                `will take precedence`);
        };

        // Apply the command-line options if the corresponding
        // item wasn't already set in the config file. Report any
        // duplicates.
        if (commandLineOptions.venvPath) {
            if (!configOptions.venvPath) {
                configOptions.venvPath = commandLineOptions.venvPath;
            } else {
                reportDuplicateSetting('venvPath');
            }
        }

        if (commandLineOptions.pythonPath) {
            this._console.log(`Setting pythonPath for service "${ this._instanceName }": ` +
                `"${ commandLineOptions.pythonPath }"`);
            configOptions.pythonPath = commandLineOptions.pythonPath;
        }

        if (commandLineOptions.typeshedPath) {
            if (!configOptions.typeshedPath) {
                configOptions.typeshedPath = commandLineOptions.typeshedPath;
            } else {
                reportDuplicateSetting('typeshedPath');
            }
        }

        configOptions.verboseOutput = !!commandLineOptions.verboseOutput;
        configOptions.checkOnlyOpenFiles = !!commandLineOptions.checkOnlyOpenFiles;
        configOptions.useLibraryCodeForTypes = !!commandLineOptions.useLibraryCodeForTypes;

        // If there was no typings path specified, use a default path.
        if (configOptions.typingsPath === undefined) {
            configOptions.typingsPath = normalizePath(combinePaths(configOptions.projectRoot, 'typings'));
        }

        // Do some sanity checks on the specified settings and report missing
        // or inconsistent information.
        if (configOptions.venvPath) {
            if (!this._fs.existsSync(configOptions.venvPath) || !isDirectory(this._fs, configOptions.venvPath)) {
                this._console.log(
                    `venvPath ${ configOptions.venvPath } is not a valid directory.`);
            }

            if (configOptions.defaultVenv) {
                const fullVenvPath = combinePaths(configOptions.venvPath, configOptions.defaultVenv);

                if (!this._fs.existsSync(fullVenvPath) || !isDirectory(this._fs, fullVenvPath)) {
                    this._console.log(
                        `venv ${ configOptions.defaultVenv } subdirectory not found ` +
                        `in venv path ${ configOptions.venvPath }.`);
                } else {
                    const importFailureInfo: string[] = [];
                    if (PythonPathUtils.findPythonSearchPaths(this._fs, configOptions, undefined, importFailureInfo) === undefined) {
                        this._console.log(
                            `site-packages directory cannot be located for venvPath ` +
                            `${ configOptions.venvPath } and venv ${ configOptions.defaultVenv }.`);

                        if (configOptions.verboseOutput) {
                            importFailureInfo.forEach(diag => {
                                this._console.log(`  ${ diag }`);
                            });
                        }
                    }
                }
            }
        } else {
            const importFailureInfo: string[] = [];
            const pythonPaths = PythonPathUtils.getPythonPathFromPythonInterpreter(this._fs, configOptions.pythonPath, importFailureInfo);
            if (pythonPaths.length === 0) {
                if (configOptions.verboseOutput) {
                    this._console.log(
                        `No search paths found for configured python interpreter.`);
                }
            } else {
                if (configOptions.verboseOutput) {
                    this._console.log(
                        `Search paths found for configured python interpreter:`);
                    pythonPaths.forEach(path => {
                        this._console.log(`  ${ path }`);
                    });
                }
            }

            if (configOptions.verboseOutput) {
                if (importFailureInfo.length > 0) {
                    this._console.log(
                        `When attempting to get search paths from python interpreter:`);
                    importFailureInfo.forEach(diag => {
                        this._console.log(`  ${ diag }`);
                    });
                }
            }
        }

        // Is there a reference to a venv? If so, there needs to be a valid venvPath.
        if (configOptions.defaultVenv || configOptions.executionEnvironments.find(e => !!e.venv)) {
            if (!configOptions.venvPath) {
                this._console.log(
                    `venvPath not specified, so venv settings will be ignored.`);
            }
        }

        if (configOptions.typeshedPath) {
            if (!this._fs.existsSync(configOptions.typeshedPath) || !isDirectory(this._fs, configOptions.typeshedPath)) {
                this._console.log(
                    `typeshedPath ${ configOptions.typeshedPath } is not a valid directory.`);
            }
        }

        if (configOptions.typingsPath) {
            if (!this._fs.existsSync(configOptions.typingsPath) || !isDirectory(this._fs, configOptions.typingsPath)) {
                this._console.log(
                    `typingsPath ${ configOptions.typingsPath } is not a valid directory.`);
            }
        }

        return configOptions;
    }

    writeTypeStub() {
        const typingsPath = this._configOptions.typingsPath;
        if (!this._typeStubTargetPath || !this._typeStubTargetImportName) {
            const errMsg = `Import '${ this._typeStubTargetImportName }'` +
                ` could not be resolved`;
            this._console.error(errMsg);
            throw new Error(errMsg);
        }

        if (!typingsPath) {
            // We should never get here because we always generate a
            // default typings path if none was specified.
            const errMsg = 'No typings path was specified';
            this._console.log(errMsg);
            throw new Error(errMsg);
        }

        const typeStubInputTargetParts = this._typeStubTargetImportName.split('.');
        if (typeStubInputTargetParts[0].length === 0) {
            // We should never get here because the import resolution
            // would have failed.
            const errMsg = `Import '${ this._typeStubTargetImportName }'` +
                ` could not be resolved`;
            this._console.error(errMsg);
            throw new Error(errMsg);
        }

        try {
            // Generate a new typings directory if necessary.
            if (!this._fs.existsSync(typingsPath)) {
                this._fs.mkdirSync(typingsPath);
            }
        } catch (e) {
            const errMsg = `Could not create typings directory '${ typingsPath }'`;
            this._console.error(errMsg);
            throw new Error(errMsg);
        }

        // Generate a typings subdirectory.
        const typingsSubdirPath = combinePaths(typingsPath, typeStubInputTargetParts[0]);
        try {
            // Generate a new typings subdirectory if necessary.
            if (!this._fs.existsSync(typingsSubdirPath)) {
                this._fs.mkdirSync(typingsSubdirPath);
            }
        } catch (e) {
            const errMsg = `Could not create typings subdirectory '${ typingsSubdirPath }'`;
            this._console.error(errMsg);
            throw new Error(errMsg);
        }

        this._program.writeTypeStub(this._typeStubTargetPath, this._typeStubTargetIsSingleFile, typingsSubdirPath);
    }

    // This is called after a new type stub has been created. It allows
    // us to invalidate caches and force reanalysis of files that potentially
    // are affected by the appearance of a new type stub.
    handlePostCreateTypeStub() {
        // Make sure the import resolver doesn't have invalid
        // cached entries.
        this._importResolver.invalidateCache();

        // Mark all files with one or more errors dirty.
        this._program.markAllFilesDirty(true);
    }

    private get _fs() {
        return this._importResolver.fileSystem;
    }

    private _findConfigFileHereOrUp(searchPath: string): string | undefined {
        return forEachAncestorDirectory(searchPath, ancestor => this._findConfigFile(ancestor));
    }

    private _findConfigFile(searchPath: string): string | undefined {
        for (const name of _configFileNames) {
            const fileName = combinePaths(searchPath, name);
            if (this._fs.existsSync(fileName)) {
                return fileName;
            }
        }
        return undefined;
    }

    private _parseConfigFile(configPath: string): any | undefined {
        let configContents = '';
        let parseAttemptCount = 0;

        while (true) {
            // Attempt to read the config file contents.
            try {
                configContents = this._fs.readFileSync(configPath, 'utf8');
            } catch {
                this._console.log(`Config file "${ configPath }" could not be read.`);
                this._reportConfigParseError();
                return undefined;
            }

            // Attempt to parse the config file.
            let configObj: any;
            let parseFailed = false;
            try {
                configObj = JSON.parse(configContents);
                return configObj;
            } catch {
                parseFailed = true;
            }

            if (!parseFailed) {
                break;
            }

            // If we attempt to read the config file immediately after it
            // was saved, it may have been partially written when we read it,
            // resulting in parse errors. We'll give it a little more time and
            // try again.
            if (parseAttemptCount++ >= 5) {
                this._console.log(`Config file "${ configPath }" could not be parsed. Verify that JSON is correct.`);
                this._reportConfigParseError();
                return undefined;
            }
        }
    }

    private _getFileNamesFromFileSpecs(): string[] {
        // Use a map to generate a list of unique files.
        const fileMap = new Map<string, string>();

        timingStats.findFilesTime.timeOperation(() => {
            const matchedFiles = this._matchFiles(this._configOptions.include,
                this._configOptions.exclude);

            for (const file of matchedFiles) {
                fileMap.set(file, file);
            }
        });

        return [...fileMap.values()];
    }

    // If markFilesDirtyUnconditionally is true, we need to reparse
    // and reanalyze all files in the program. If false, we will
    // reparse and reanalyze only those files whose on-disk contents
    // have changed. Unconditional dirtying is needed in the case where
    // configuration options have changed.
    private _updateTrackedFileList(markFilesDirtyUnconditionally: boolean) {
        // Are we in type stub generation mode? If so, we need to search
        // for a different set of files.
        if (this._typeStubTargetImportName) {
            const execEnv = this._configOptions.findExecEnvironment(this._executionRootPath);
            const moduleDescriptor: ImportedModuleDescriptor = {
                leadingDots: 0,
                nameParts: this._typeStubTargetImportName.split('.'),
                importedSymbols: []
            };

            const importResult = this._importResolver.resolveImport(
                '', execEnv, moduleDescriptor);

            if (importResult.isImportFound) {
                const filesToImport: string[] = [];

                // Namespace packages resolve to a directory name, so
                // don't include those.
                const resolvedPath = importResult.resolvedPaths[
                    importResult.resolvedPaths.length - 1];

                // Get the directory that contains the root package.
                let targetPath = getDirectoryPath(resolvedPath);
                for (let i = importResult.resolvedPaths.length - 2; i >= 0; i--) {
                    const resolvedPath = importResult.resolvedPaths[i];
                    if (resolvedPath) {
                        targetPath = getDirectoryPath(resolvedPath);
                    } else {
                        // If there was no file corresponding to this portion
                        // of the name path, assume that it's contained
                        // within its parent directory.
                        targetPath = getDirectoryPath(targetPath);
                    }
                }

                if (isDirectory(this._fs, targetPath)) {
                    this._typeStubTargetPath = targetPath;
                }

                if (!resolvedPath) {
                    this._typeStubTargetIsSingleFile = false;
                } else {
                    filesToImport.push(resolvedPath);
                    this._typeStubTargetIsSingleFile = importResult.resolvedPaths.length === 1 &&
                        stripFileExtension(getFileName(importResult.resolvedPaths[0])) !== '__init__';
                }

                // Add the implicit import paths.
                importResult.implicitImports.forEach(implicitImport => {
                    filesToImport.push(implicitImport.path);
                });

                this._program.setAllowedThirdPartyImports([this._typeStubTargetImportName]);
                this._program.setTrackedFiles(filesToImport);
            } else {
                this._console.log(`Import '${ this._typeStubTargetImportName }' not found`);
            }
        } else {
            let fileList: string[] = [];
            this._console.log(`Searching for source files`);
            fileList = this._getFileNamesFromFileSpecs();

            const fileDiagnostics = this._program.setTrackedFiles(fileList);
            this._reportDiagnosticsForRemovedFiles(fileDiagnostics);
            this._program.markAllFilesDirty(markFilesDirtyUnconditionally);

            if (fileList.length === 0) {
                this._console.log(`No source files found.`);
            } else {
                this._console.log(`Found ${ fileList.length } ` +
                    `source ${ fileList.length === 1 ? 'file' : 'files' }`);
            }
        }

        this._requireTrackedFileUpdate = false;
    }

    private _isInExcludePath(path: string, excludePaths: FileSpec[]) {
        return !!excludePaths.find(excl => excl.regExp.test(path));
    }

    private _matchFiles(include: FileSpec[], exclude: FileSpec[]): string[] {
        const includeFileRegex = /\.pyi?$/;
        const results: string[] = [];

        const visitDirectory = (absolutePath: string, includeRegExp: RegExp) => {
            const { files, directories } = getFileSystemEntries(this._fs, absolutePath);

            for (const file of files) {
                const filePath = combinePaths(absolutePath, file);

                if (includeRegExp.test(filePath)) {
                    if (!this._isInExcludePath(filePath, exclude) && includeFileRegex.test(filePath)) {
                        results.push(filePath);
                    }
                }
            }

            for (const directory of directories) {
                const dirPath = combinePaths(absolutePath, directory);
                if (includeRegExp.test(dirPath)) {
                    if (!this._isInExcludePath(dirPath, exclude)) {
                        visitDirectory(dirPath, includeRegExp);
                    }
                }
            }
        };

        include.forEach(includeSpec => {
            let foundFileSpec = false;

            if (!this._isInExcludePath(includeSpec.wildcardRoot, exclude)) {
                try {
                    const stat = this._fs.statSync(includeSpec.wildcardRoot);
                    if (stat.isFile()) {
                        if (includeFileRegex.test(includeSpec.wildcardRoot)) {
                            results.push(includeSpec.wildcardRoot);
                            foundFileSpec = true;
                        }
                    } else if (stat.isDirectory()) {
                        visitDirectory(includeSpec.wildcardRoot, includeSpec.regExp);
                        foundFileSpec = true;
                    }
                } catch {
                    // Ignore the exception.
                }
            }

            if (!foundFileSpec) {
                this._console.log(`File or directory "${ includeSpec.wildcardRoot }" does not exist.`);
            }
        });

        return results;
    }

    private _removeSourceFileWatchers() {
        if (this._sourceFileWatcher) {
            this._sourceFileWatcher.close();
            this._sourceFileWatcher = undefined;
        }
    }

    private _updateSourceFileWatchers() {
        this._removeSourceFileWatchers();

        // Invalidate import resolver because it could have cached
        // imports that are no longer valid because a source file has
        // been deleted or added.
        this._importResolver.invalidateCache();

        if (!this._watchForSourceChanges) {
            return;
        }

        if (this._configOptions.include.length > 0) {
            const fileList = this._configOptions.include.map(spec => {
                return combinePaths(this._executionRootPath, spec.wildcardRoot);
            });

            try {
                if (this._verboseOutput) {
                    this._console.log(`Adding fs watcher for directories:\n ${ fileList.join('\n') }`);
                }

                this._sourceFileWatcher = this._fs.createFileSystemWatcher(fileList, 'all', (event, path) => {
                    if (this._verboseOutput) {
                        this._console.log(`Received fs event '${ event }' for path '${ path }'`);
                    }

                    if (event === 'change') {
                        this._program.markFilesDirty([path]);
                        this._scheduleReanalysis(false);
                    } else {
                        this._scheduleReanalysis(true);
                    }
                });
            } catch {
                this._console.log(`Exception caught when installing fs watcher for:\n ${ fileList.join('\n') }`);
            }
        }
    }

    private _removeConfigFileWatcher() {
        if (this._configFileWatcher) {
            this._configFileWatcher.close();
            this._configFileWatcher = undefined;
        }
    }

    private _updateConfigFileWatcher() {
        this._removeConfigFileWatcher();

        if (this._configFilePath) {
            this._configFileWatcher = this._fs.createFileSystemWatcher([this._configFilePath],
                'all', event => {
                    if (this._verboseOutput) {
                        this._console.log(`Received fs event '${ event }' for config file`);
                    }
                    this._scheduleReloadConfigFile();
                });
        }
    }

    private _clearReloadConfigTimer() {
        if (this._reloadConfigTimer) {
            clearTimeout(this._reloadConfigTimer);
            this._reloadConfigTimer = undefined;
        }
    }

    private _scheduleReloadConfigFile() {
        this._clearReloadConfigTimer();

        // Wait for a little while after we receive the
        // change update event because it may take a while
        // for the file to be written out. Plus, there may
        // be multiple changes.
        this._reloadConfigTimer = setTimeout(() => {
            this._clearReloadConfigTimer();
            this._reloadConfigFile();
        }, 100);
    }

    private _reloadConfigFile() {
        if (this._configFilePath) {
            this._updateConfigFileWatcher();

            this._console.log(`Reloading configuration file at ${ this._configFilePath }`);
            const configJsonObj = this._parseConfigFile(this._configFilePath);
            if (configJsonObj) {
                this._configOptions.initializeFromJson(configJsonObj, this._console);
            }

            this._applyConfigOptions();
        }
    }

    private _applyConfigOptions() {
        // Allocate a new import resolver because the old one has information
        // cached based on the previous config options.
        this._importResolver = this._importResolverFactory(this._fs, this._configOptions);
        this._program.setImportResolver(this._importResolver);

        this._updateSourceFileWatchers();
        this._updateTrackedFileList(true);
        this._scheduleReanalysis(false);
    }

    private _clearReanalysisTimer() {
        if (this._analyzeTimer) {
            clearTimeout(this._analyzeTimer);
            this._analyzeTimer = undefined;
        }
    }

    private _scheduleReanalysis(requireTrackedFileUpdate: boolean) {
        if (requireTrackedFileUpdate) {
            this._requireTrackedFileUpdate = true;
        }

        // Remove any existing analysis timer.
        this._clearReanalysisTimer();

        // How long has it been since the user interacted with the service?
        // If the user is actively typing, back off to let him or her finish.
        const timeSinceLastUserInteractionInMs = Date.now() - this._lastUserInteractionTime;
        const minBackoffTimeInMs = 1000;

        // We choose a small non-zero value here. If this value
        // is too small (like zero), the VS Code extension becomes
        // unresponsive during heavy analysis. If this number is too
        // large, analysis takes longer.
        const minTimeBetweenAnalysisPassesInMs = 20;

        const timeUntilNextAnalysisInMs = Math.max(
            minBackoffTimeInMs - timeSinceLastUserInteractionInMs,
            minTimeBetweenAnalysisPassesInMs);

        // Schedule a new timer.
        this._analyzeTimer = setTimeout(() => {
            this._analyzeTimer = undefined;

            if (this._requireTrackedFileUpdate) {
                this._updateTrackedFileList(false);
            }

            const moreToAnalyze = this._reanalyze();

            if (moreToAnalyze) {
                this._scheduleReanalysis(false);
            }
        }, timeUntilNextAnalysisInMs);
    }

    // Determine whether the user appears to be interacting with
    // the service currently. In this case, we'll optimize for
    // responsiveness versus overall performance.
    private _useInteractiveMode(): boolean {
        const curTime = Date.now();

        // Assume we're in interactive mode if we've seen a
        // user action within this time (measured in ms).
        const interactiveTimeLimit = 1000;

        return curTime - this._lastUserInteractionTime < interactiveTimeLimit;
    }

    // Performs analysis for a while (up to this._maxAnalysisTimeInMs) before
    // returning some results. Return value indicates whether more analysis is
    // required to finish the entire program.
    private _reanalyze(): boolean {
        let moreToAnalyze = false;

        try {
            const duration = new Duration();
            moreToAnalyze = this._program.analyze(this._maxAnalysisTime, this._useInteractiveMode());
            const filesLeftToAnalyze = this._program.getFilesToAnalyzeCount();
            assert(filesLeftToAnalyze === 0 || moreToAnalyze);

            const results: AnalysisResults = {
                diagnostics: this._program.getDiagnostics(this._configOptions),
                filesInProgram: this._program.getFileCount(),
                filesRequiringAnalysis: filesLeftToAnalyze,
                checkingOnlyOpenFiles: this._program.isCheckingOnlyOpenFiles(),
                fatalErrorOccurred: false,
                configParseErrorOccurred: false,
                elapsedTime: duration.getDurationInSeconds()
            };

            const diagnosticFileCount = results.diagnostics.length;

            // Report any diagnostics or completion.
            if (diagnosticFileCount > 0 || !moreToAnalyze) {
                if (this._onCompletionCallback) {
                    this._onCompletionCallback(results);
                }
            }
        } catch (e) {
            const message: string = (e.stack ? e.stack.toString() : undefined) ||
                (typeof e.message === 'string' ? e.message : undefined) ||
                JSON.stringify(e);
            this._console.log('Error performing analysis: ' + message);

            if (this._onCompletionCallback) {
                this._onCompletionCallback({
                    diagnostics: [],
                    filesInProgram: 0,
                    filesRequiringAnalysis: 0,
                    checkingOnlyOpenFiles: true,
                    fatalErrorOccurred: true,
                    configParseErrorOccurred: false,
                    elapsedTime: 0
                });
            }
        }

        return moreToAnalyze;
    }

    private _reportDiagnosticsForRemovedFiles(fileDiags: FileDiagnostics[]) {
        if (fileDiags.length > 0) {
            if (this._onCompletionCallback) {
                this._onCompletionCallback({
                    diagnostics: fileDiags,
                    filesInProgram: this._program.getFileCount(),
                    filesRequiringAnalysis: this._program.getFilesToAnalyzeCount(),
                    checkingOnlyOpenFiles: this._program.isCheckingOnlyOpenFiles(),
                    fatalErrorOccurred: false,
                    configParseErrorOccurred: false,
                    elapsedTime: 0
                });
            }
        }
    }

    private _reportConfigParseError() {
        if (this._onCompletionCallback) {
            this._onCompletionCallback({
                diagnostics: [],
                filesInProgram: 0,
                filesRequiringAnalysis: 0,
                checkingOnlyOpenFiles: true,
                fatalErrorOccurred: false,
                configParseErrorOccurred: true,
                elapsedTime: 0
            });
        }
    }
}
