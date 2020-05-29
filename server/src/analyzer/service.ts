/*
 * service.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * A persistent service that is able to analyze a collection of
 * Python files.
 */

import {
    AbstractCancellationTokenSource,
    CancellationToken,
    CompletionItem,
    CompletionList,
    DocumentSymbol,
    SymbolInformation,
} from 'vscode-languageserver';

import { BackgroundAnalysisBase } from '../backgroundAnalysisBase';
import { createAnalysisCancellationTokenSource } from '../common/cancellationUtils';
import { CommandLineOptions } from '../common/commandLineOptions';
import { ConfigOptions } from '../common/configOptions';
import { ConsoleInterface, StandardConsole } from '../common/console';
import { Diagnostic } from '../common/diagnostic';
import { FileEditAction, TextEditAction } from '../common/editAction';
import { LanguageServiceExtension } from '../common/extensibility';
import { FileSystem, FileWatcher } from '../common/fileSystem';
import {
    combinePaths,
    FileSpec,
    forEachAncestorDirectory,
    getDirectoryPath,
    getFileName,
    getFileSpec,
    getFileSystemEntries,
    isDirectory,
    normalizePath,
    stripFileExtension,
} from '../common/pathUtils';
import { DocumentRange, Position, Range } from '../common/textRange';
import { timingStats } from '../common/timing';
import { HoverResults } from '../languageService/hoverProvider';
import { SignatureHelpResults } from '../languageService/signatureHelpProvider';
import { AnalysisCompleteCallback } from './analysis';
import { BackgroundAnalysisProgram } from './backgroundAnalysisProgram';
import { ImportedModuleDescriptor, ImportResolver, ImportResolverFactory } from './importResolver';
import { MaxAnalysisTime } from './program';
import { findPythonSearchPaths, getPythonPathFromPythonInterpreter } from './pythonPathUtils';

export const configFileNames = ['pyrightconfig.json', 'mspythonconfig.json'];

// How long since the last user activity should we wait until running
// the analyzer on any files that have not yet been analyzed?
const _userActivityBackoffTimeInMs = 250;

export class AnalyzerService {
    private _instanceName: string;
    private _importResolverFactory: ImportResolverFactory;
    private _executionRootPath: string;
    private _typeStubTargetPath: string | undefined;
    private _typeStubTargetIsSingleFile = false;
    private _console: ConsoleInterface;
    private _sourceFileWatcher: FileWatcher | undefined;
    private _reloadConfigTimer: any;
    private _libraryReanalysisTimer: any;
    private _configFilePath: string | undefined;
    private _configFileWatcher: FileWatcher | undefined;
    private _libraryFileWatcher: FileWatcher | undefined;
    private _onCompletionCallback: AnalysisCompleteCallback | undefined;
    private _commandLineOptions: CommandLineOptions | undefined;
    private _analyzeTimer: any;
    private _requireTrackedFileUpdate = true;
    private _lastUserInteractionTime = Date.now();
    private _extension: LanguageServiceExtension | undefined;
    private _backgroundAnalysisProgram: BackgroundAnalysisProgram;
    private _backgroundAnalysisCancellationSource: AbstractCancellationTokenSource | undefined;
    private _maxAnalysisTimeInForeground?: MaxAnalysisTime;
    private _disposed = false;

    constructor(
        instanceName: string,
        fs: FileSystem,
        console?: ConsoleInterface,
        importResolverFactory?: ImportResolverFactory,
        configOptions?: ConfigOptions,
        extension?: LanguageServiceExtension,
        backgroundAnalysis?: BackgroundAnalysisBase,
        maxAnalysisTime?: MaxAnalysisTime
    ) {
        this._instanceName = instanceName;
        this._console = console || new StandardConsole();
        this._executionRootPath = '';
        this._extension = extension;
        this._importResolverFactory = importResolverFactory || AnalyzerService.createImportResolver;
        this._maxAnalysisTimeInForeground = maxAnalysisTime;

        configOptions = configOptions ?? new ConfigOptions(process.cwd());
        const importResolver = this._importResolverFactory(fs, configOptions);
        this._backgroundAnalysisProgram = new BackgroundAnalysisProgram(
            this._console,
            configOptions,
            importResolver,
            this._extension,
            backgroundAnalysis,
            this._maxAnalysisTimeInForeground
        );
    }

    clone(instanceName: string, backgroundAnalysis?: BackgroundAnalysisBase): AnalyzerService {
        return new AnalyzerService(
            instanceName,
            this._fs,
            this._console,
            this._importResolverFactory,
            this._backgroundAnalysisProgram.configOptions,
            this._extension,
            backgroundAnalysis,
            this._maxAnalysisTimeInForeground
        );
    }

    dispose() {
        this._disposed = true;
        this._removeSourceFileWatchers();
        this._removeConfigFileWatcher();
        this._removeLibraryFileWatcher();
        this._clearReloadConfigTimer();
        this._clearReanalysisTimer();
        this._clearLibraryReanalysisTimer();
    }

    static createImportResolver(fs: FileSystem, options: ConfigOptions): ImportResolver {
        return new ImportResolver(fs, options);
    }

    setCompletionCallback(callback: AnalysisCompleteCallback | undefined): void {
        this._onCompletionCallback = callback;
        this._backgroundAnalysisProgram.setCompletionCallback(callback);
    }

    setOptions(commandLineOptions: CommandLineOptions, reanalyze = true): void {
        this._commandLineOptions = commandLineOptions;

        const configOptions = this._getConfigOptions(commandLineOptions);
        this._backgroundAnalysisProgram.setConfigOptions(configOptions);

        this._executionRootPath = normalizePath(
            combinePaths(commandLineOptions.executionRoot, configOptions.projectRoot)
        );
        this._applyConfigOptions(reanalyze);
    }

    setFileOpened(path: string, version: number | null, contents: string) {
        this._backgroundAnalysisProgram.setFileOpened(path, version, contents);
        this._scheduleReanalysis(false);
    }

    updateOpenFileContents(path: string, version: number | null, contents: string) {
        this._backgroundAnalysisProgram.updateOpenFileContents(path, version, contents);
        this._scheduleReanalysis(false);
    }

    setFileClosed(path: string) {
        this._backgroundAnalysisProgram.setFileClosed(path);
        this._scheduleReanalysis(false);
    }

    getParseResult(path: string) {
        return this._program.getBoundSourceFile(path)?.getParseResults();
    }

    getAutoImports(
        filePath: string,
        range: Range,
        similarityLimit: number,
        nameMap: Map<string, string> | undefined,
        token: CancellationToken
    ) {
        return this._program.getAutoImports(filePath, range, similarityLimit, nameMap, token);
    }

    getDefinitionForPosition(
        filePath: string,
        position: Position,
        token: CancellationToken
    ): DocumentRange[] | undefined {
        return this._program.getDefinitionsForPosition(filePath, position, token);
    }

    getReferencesForPosition(
        filePath: string,
        position: Position,
        includeDeclaration: boolean,
        token: CancellationToken
    ): DocumentRange[] | undefined {
        return this._program.getReferencesForPosition(filePath, position, includeDeclaration, token);
    }

    addSymbolsForDocument(filePath: string, symbolList: DocumentSymbol[], token: CancellationToken) {
        this._program.addSymbolsForDocument(filePath, symbolList, token);
    }

    addSymbolsForWorkspace(symbolList: SymbolInformation[], query: string, token: CancellationToken) {
        this._program.addSymbolsForWorkspace(symbolList, query, token);
    }

    getHoverForPosition(filePath: string, position: Position, token: CancellationToken): HoverResults | undefined {
        return this._program.getHoverForPosition(filePath, position, token);
    }

    getSignatureHelpForPosition(
        filePath: string,
        position: Position,
        token: CancellationToken
    ): SignatureHelpResults | undefined {
        return this._program.getSignatureHelpForPosition(filePath, position, token);
    }

    getCompletionsForPosition(
        filePath: string,
        position: Position,
        workspacePath: string,
        token: CancellationToken
    ): Promise<CompletionList | undefined> {
        return this._program.getCompletionsForPosition(filePath, position, workspacePath, token);
    }

    resolveCompletionItem(filePath: string, completionItem: CompletionItem, token: CancellationToken) {
        this._program.resolveCompletionItem(filePath, completionItem, token);
    }

    performQuickAction(
        filePath: string,
        command: string,
        args: any[],
        token: CancellationToken
    ): TextEditAction[] | undefined {
        return this._program.performQuickAction(filePath, command, args, token);
    }

    renameSymbolAtPosition(
        filePath: string,
        position: Position,
        newName: string,
        token: CancellationToken
    ): FileEditAction[] | undefined {
        return this._program.renameSymbolAtPosition(filePath, position, newName, token);
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

    getDiagnosticsForRange(filePath: string, range: Range, token: CancellationToken): Promise<Diagnostic[]> {
        return this._backgroundAnalysisProgram.getDiagnosticsForRange(filePath, range, token);
    }

    getImportResolver(): ImportResolver {
        return this._backgroundAnalysisProgram.importResolver;
    }

    recordUserInteractionTime() {
        this._lastUserInteractionTime = Date.now();

        // If we have a pending timer for reanalysis, cancel it
        // and reschedule for some time in the future.
        if (this._analyzeTimer) {
            this._scheduleReanalysis(false);
        }
    }

    // test only APIs
    get test_configOptions() {
        return this._configOptions;
    }

    get test_program() {
        return this._program;
    }

    test_getConfigOptions(commandLineOptions: CommandLineOptions): ConfigOptions {
        return this._getConfigOptions(commandLineOptions);
    }

    test_getFileNamesFromFileSpecs(): string[] {
        return this._getFileNamesFromFileSpecs();
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
            configFilePath = combinePaths(
                commandLineOptions.executionRoot,
                normalizePath(commandLineOptions.configFilePath)
            );
            if (!this._fs.existsSync(configFilePath)) {
                this._console.log(`Configuration file not found at ${configFilePath}.`);
                configFilePath = commandLineOptions.executionRoot;
            } else {
                if (configFilePath.toLowerCase().endsWith('.json')) {
                    projectRoot = getDirectoryPath(configFilePath);
                } else {
                    projectRoot = configFilePath;
                    configFilePath = this._findConfigFile(configFilePath);
                    if (!configFilePath) {
                        this._console.log(`Configuration file not found at ${projectRoot}.`);
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

        const configOptions = new ConfigOptions(projectRoot, this._typeCheckingMode);
        const defaultExcludes = ['**/node_modules', '**/__pycache__', '.git'];

        if (commandLineOptions.fileSpecs.length > 0) {
            commandLineOptions.fileSpecs.forEach((fileSpec) => {
                configOptions.include.push(getFileSpec(projectRoot, fileSpec));
            });
        } else if (!configFilePath) {
            // If no config file was found and there are no explicit include
            // paths specified, assume the caller wants to include all source
            // files under the execution root path.
            if (commandLineOptions.executionRoot) {
                configOptions.include.push(getFileSpec(commandLineOptions.executionRoot, '.'));

                // Add a few common excludes to avoid long scan times.
                defaultExcludes.forEach((exclude) => {
                    configOptions.exclude.push(getFileSpec(commandLineOptions.executionRoot, exclude));
                });
            }
        }

        this._configFilePath = configFilePath;

        // If we found a config file, parse it to compute the effective options.
        if (configFilePath) {
            this._console.log(`Loading configuration file at ${configFilePath}`);
            const configJsonObj = this._parseConfigFile(configFilePath);
            if (configJsonObj) {
                configOptions.initializeFromJson(
                    configJsonObj,
                    this._typeCheckingMode,
                    this._console,
                    commandLineOptions.diagnosticSeverityOverrides,
                    commandLineOptions.pythonPath
                );

                const configFileDir = getDirectoryPath(configFilePath);

                // If no include paths were provided, assume that all files within
                // the project should be included.
                if (configOptions.include.length === 0) {
                    this._console.log(`No include entries specified; assuming ${configFilePath}`);
                    configOptions.include.push(getFileSpec(configFileDir, '.'));
                }

                // If there was no explicit set of excludes, add a few common ones to avoid long scan times.
                if (configOptions.exclude.length === 0) {
                    defaultExcludes.forEach((exclude) => {
                        this._console.log(`Auto-excluding ${exclude}`);
                        configOptions.exclude.push(getFileSpec(configFileDir, exclude));
                    });

                    if (configOptions.autoExcludeVenv === undefined) {
                        configOptions.autoExcludeVenv = true;
                    }
                }

                // If the user has defined execution environments, then we ignore
                // autoSearchPaths, extraPaths and leave it up to them to set
                // extraPaths on the execution environments.
                if (configOptions.executionEnvironments.length === 0) {
                    configOptions.addExecEnvironmentForExtraPaths(
                        this._fs,
                        commandLineOptions.autoSearchPaths || false,
                        commandLineOptions.extraPaths || []
                    );
                }
            }
            this._updateConfigFileWatcher();
            this._updateLibraryFileWatcher();
        } else {
            configOptions.addExecEnvironmentForExtraPaths(
                this._fs,
                commandLineOptions.autoSearchPaths || false,
                commandLineOptions.extraPaths || []
            );

            configOptions.autoExcludeVenv = true;
            configOptions.applyDiagnosticOverrides(commandLineOptions.diagnosticSeverityOverrides);
        }

        const reportDuplicateSetting = (settingName: string) => {
            const settingSource = commandLineOptions.fromVsCodeExtension
                ? 'the VS Code settings'
                : 'a command-line option';
            this._console.log(
                `The ${settingName} has been specified in both the config file and ` +
                    `${settingSource}. The value in the config file (${configOptions.venvPath}) ` +
                    `will take precedence`
            );
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
            this._console.log(
                `Setting pythonPath for service "${this._instanceName}": ` + `"${commandLineOptions.pythonPath}"`
            );
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

        // If there was no stub path specified, use a default path.
        if (commandLineOptions.stubPath) {
            if (!configOptions.stubPath) {
                configOptions.stubPath = commandLineOptions.stubPath;
            } else {
                reportDuplicateSetting('stubPath');
            }
        } else {
            if (!configOptions.stubPath) {
                configOptions.stubPath = normalizePath(combinePaths(configOptions.projectRoot, 'typings'));
            }
        }

        // Do some sanity checks on the specified settings and report missing
        // or inconsistent information.
        if (configOptions.venvPath) {
            if (!this._fs.existsSync(configOptions.venvPath) || !isDirectory(this._fs, configOptions.venvPath)) {
                this._console.log(`venvPath ${configOptions.venvPath} is not a valid directory.`);
            }

            // venvPath without defaultVenv means it won't do anything while resolveImport.
            // so first, try to set defaultVenv from existing configOption if it is null. if both are null,
            // then, resolveImport won't consider venv
            configOptions.defaultVenv = configOptions.defaultVenv ?? this._configOptions.defaultVenv;
            if (configOptions.defaultVenv) {
                const fullVenvPath = combinePaths(configOptions.venvPath, configOptions.defaultVenv);

                if (!this._fs.existsSync(fullVenvPath) || !isDirectory(this._fs, fullVenvPath)) {
                    this._console.log(
                        `venv ${configOptions.defaultVenv} subdirectory not found ` +
                            `in venv path ${configOptions.venvPath}.`
                    );
                } else {
                    const importFailureInfo: string[] = [];
                    if (findPythonSearchPaths(this._fs, configOptions, undefined, importFailureInfo) === undefined) {
                        this._console.log(
                            `site-packages directory cannot be located for venvPath ` +
                                `${configOptions.venvPath} and venv ${configOptions.defaultVenv}.`
                        );

                        if (configOptions.verboseOutput) {
                            importFailureInfo.forEach((diag) => {
                                this._console.log(`  ${diag}`);
                            });
                        }
                    }
                }
            }
        } else {
            const importFailureInfo: string[] = [];
            const pythonPaths = getPythonPathFromPythonInterpreter(
                this._fs,
                configOptions.pythonPath,
                importFailureInfo
            ).paths;
            if (pythonPaths.length === 0) {
                if (configOptions.verboseOutput) {
                    this._console.log(`No search paths found for configured python interpreter.`);
                }
            } else {
                if (configOptions.verboseOutput) {
                    this._console.log(`Search paths found for configured python interpreter:`);
                    pythonPaths.forEach((path) => {
                        this._console.log(`  ${path}`);
                    });
                }
            }

            if (configOptions.verboseOutput) {
                if (importFailureInfo.length > 0) {
                    this._console.log(`When attempting to get search paths from python interpreter:`);
                    importFailureInfo.forEach((diag) => {
                        this._console.log(`  ${diag}`);
                    });
                }
            }
        }

        // Is there a reference to a venv? If so, there needs to be a valid venvPath.
        if (configOptions.defaultVenv || configOptions.executionEnvironments.find((e) => !!e.venv)) {
            if (!configOptions.venvPath) {
                this._console.log(`venvPath not specified, so venv settings will be ignored.`);
            }
        }

        if (configOptions.typeshedPath) {
            if (
                !this._fs.existsSync(configOptions.typeshedPath) ||
                !isDirectory(this._fs, configOptions.typeshedPath)
            ) {
                this._console.log(`typeshedPath ${configOptions.typeshedPath} is not a valid directory.`);
            }
        }

        if (configOptions.stubPath) {
            if (!this._fs.existsSync(configOptions.stubPath) || !isDirectory(this._fs, configOptions.stubPath)) {
                this._console.log(`stubPath ${configOptions.stubPath} is not a valid directory.`);
            }
        }

        return configOptions;
    }

    writeTypeStub(token: CancellationToken): void {
        const typingsSubdirPath = this._getTypeStubFolder();

        this._program.writeTypeStub(
            this._typeStubTargetPath!,
            this._typeStubTargetIsSingleFile,
            typingsSubdirPath,
            token
        );
    }

    writeTypeStubInBackground(token: CancellationToken): Promise<any> {
        const typingsSubdirPath = this._getTypeStubFolder();

        return this._backgroundAnalysisProgram.writeTypeStub(
            this._typeStubTargetPath!,
            this._typeStubTargetIsSingleFile,
            typingsSubdirPath,
            token
        );
    }

    // This is called after a new type stub has been created. It allows
    // us to invalidate caches and force reanalysis of files that potentially
    // are affected by the appearance of a new type stub.
    invalidateAndForceReanalysis() {
        // Mark all files with one or more errors dirty.
        this._backgroundAnalysisProgram.invalidateAndForceReanalysis();
    }

    // Forces the service to stop all analysis, discard all its caches,
    // and research for files.
    restart() {
        this._applyConfigOptions();

        this._backgroundAnalysisProgram.restart();
    }

    private get _fs() {
        return this._backgroundAnalysisProgram.importResolver.fileSystem;
    }

    private get _program() {
        return this._backgroundAnalysisProgram.program;
    }

    private get _configOptions() {
        return this._backgroundAnalysisProgram.configOptions;
    }

    private get _watchForSourceChanges() {
        return !!this._commandLineOptions?.watchForSourceChanges;
    }

    private get _watchForLibraryChanges() {
        return !!this._commandLineOptions?.watchForLibraryChanges;
    }

    private get _typeCheckingMode() {
        return this._commandLineOptions?.typeCheckingMode;
    }

    private get _verboseOutput() {
        return !!this._commandLineOptions?.verboseOutput;
    }

    private get _typeStubTargetImportName() {
        return this._commandLineOptions?.typeStubTargetImportName;
    }

    private _getTypeStubFolder() {
        const stubPath = this._configOptions.stubPath;
        if (!this._typeStubTargetPath || !this._typeStubTargetImportName) {
            const errMsg = `Import '${this._typeStubTargetImportName}'` + ` could not be resolved`;
            this._console.error(errMsg);
            throw new Error(errMsg);
        }
        if (!stubPath) {
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
            const errMsg = `Import '${this._typeStubTargetImportName}'` + ` could not be resolved`;
            this._console.error(errMsg);
            throw new Error(errMsg);
        }
        try {
            // Generate a new typings directory if necessary.
            if (!this._fs.existsSync(stubPath)) {
                this._fs.mkdirSync(stubPath);
            }
        } catch (e) {
            const errMsg = `Could not create typings directory '${stubPath}'`;
            this._console.error(errMsg);
            throw new Error(errMsg);
        }
        // Generate a typings subdirectory.
        const typingsSubdirPath = combinePaths(stubPath, typeStubInputTargetParts[0]);
        try {
            // Generate a new typings subdirectory if necessary.
            if (!this._fs.existsSync(typingsSubdirPath)) {
                this._fs.mkdirSync(typingsSubdirPath);
            }
        } catch (e) {
            const errMsg = `Could not create typings subdirectory '${typingsSubdirPath}'`;
            this._console.error(errMsg);
            throw new Error(errMsg);
        }
        return typingsSubdirPath;
    }

    private _findConfigFileHereOrUp(searchPath: string): string | undefined {
        return forEachAncestorDirectory(searchPath, (ancestor) => this._findConfigFile(ancestor));
    }

    private _findConfigFile(searchPath: string): string | undefined {
        for (const name of configFileNames) {
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
                this._console.log(`Config file "${configPath}" could not be read.`);
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
                this._console.log(`Config file "${configPath}" could not be parsed. Verify that JSON is correct.`);
                this._reportConfigParseError();
                return undefined;
            }
        }
    }

    private _getFileNamesFromFileSpecs(): string[] {
        // Use a map to generate a list of unique files.
        const fileMap = new Map<string, string>();

        timingStats.findFilesTime.timeOperation(() => {
            const matchedFiles = this._matchFiles(this._configOptions.include, this._configOptions.exclude);

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
                importedSymbols: [],
            };

            const importResult = this._backgroundAnalysisProgram.importResolver.resolveImport(
                '',
                execEnv,
                moduleDescriptor
            );

            if (importResult.isImportFound) {
                const filesToImport: string[] = [];

                // Namespace packages resolve to a directory name, so
                // don't include those.
                const resolvedPath = importResult.resolvedPaths[importResult.resolvedPaths.length - 1];

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
                    this._typeStubTargetIsSingleFile =
                        importResult.resolvedPaths.length === 1 &&
                        stripFileExtension(getFileName(importResult.resolvedPaths[0])) !== '__init__';
                }

                // Add the implicit import paths.
                importResult.implicitImports.forEach((implicitImport) => {
                    filesToImport.push(implicitImport.path);
                });

                this._backgroundAnalysisProgram.setAllowedThirdPartyImports([this._typeStubTargetImportName]);
                this._backgroundAnalysisProgram.setTrackedFiles(filesToImport);
            } else {
                this._console.log(`Import '${this._typeStubTargetImportName}' not found`);
            }
        } else {
            let fileList: string[] = [];
            this._console.log(`Searching for source files`);
            fileList = this._getFileNamesFromFileSpecs();

            this._backgroundAnalysisProgram.setTrackedFiles(fileList);
            this._backgroundAnalysisProgram.markAllFilesDirty(markFilesDirtyUnconditionally);

            if (fileList.length === 0) {
                this._console.log(`No source files found.`);
            } else {
                this._console.log(`Found ${fileList.length} ` + `source ${fileList.length === 1 ? 'file' : 'files'}`);
            }
        }

        this._requireTrackedFileUpdate = false;
    }

    private _isInExcludePath(path: string, excludePaths: FileSpec[]) {
        return !!excludePaths.find((excl) => excl.regExp.test(path));
    }

    private _matchFiles(include: FileSpec[], exclude: FileSpec[]): string[] {
        const includeFileRegex = /\.pyi?$/;
        const envMarkers = [['bin', 'activate'], ['Scripts', 'activate'], ['pyvenv.cfg']];
        const results: string[] = [];

        const visitDirectory = (absolutePath: string, includeRegExp: RegExp) => {
            if (this._configOptions.autoExcludeVenv) {
                if (envMarkers.some((f) => this._fs.existsSync(combinePaths(absolutePath, ...f)))) {
                    this._console.log(`Auto-excluding ${absolutePath}`);
                    return;
                }
            }

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

        include.forEach((includeSpec) => {
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
                this._console.log(`File or directory "${includeSpec.wildcardRoot}" does not exist.`);
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

        this._backgroundAnalysisProgram.invalidateCache();

        if (!this._watchForSourceChanges) {
            return;
        }

        if (this._configOptions.include.length > 0) {
            const fileList = this._configOptions.include.map((spec) => {
                return combinePaths(this._executionRootPath, spec.wildcardRoot);
            });

            try {
                if (this._verboseOutput) {
                    this._console.log(`Adding fs watcher for directories:\n ${fileList.join('\n')}`);
                }

                this._sourceFileWatcher = this._fs.createFileSystemWatcher(fileList, (event, path) => {
                    if (this._verboseOutput) {
                        this._console.log(`Received fs event '${event}' for path '${path}'`);
                    }

                    // Delete comes in as a change event, so try to distinguish here.
                    if (event === 'change' && this._fs.existsSync(path)) {
                        this._backgroundAnalysisProgram.markFilesDirty([path], false);
                        this._scheduleReanalysis(false);
                    } else {
                        // Added/deleted/renamed files impact imports,
                        // clear the import resolver cache and reanalyze everything.
                        this.invalidateAndForceReanalysis();
                        this._scheduleReanalysis(true);
                    }
                });
            } catch {
                this._console.log(`Exception caught when installing fs watcher for:\n ${fileList.join('\n')}`);
            }
        }
    }

    private _removeLibraryFileWatcher() {
        if (this._libraryFileWatcher) {
            this._libraryFileWatcher.close();
            this._libraryFileWatcher = undefined;
        }
    }

    private _updateLibraryFileWatcher() {
        this._removeLibraryFileWatcher();

        this._backgroundAnalysisProgram.invalidateCache();

        if (!this._watchForLibraryChanges) {
            return;
        }

        // Watch the library paths for package install/uninstall.
        const importFailureInfo: string[] = [];
        const watchList = findPythonSearchPaths(
            this._fs,
            this._backgroundAnalysisProgram.configOptions,
            undefined,
            importFailureInfo,
            true,
            this._executionRootPath
        );

        if (watchList && watchList.length > 0) {
            try {
                if (this._verboseOutput) {
                    this._console.log(`Adding fs watcher for library directories:\n ${watchList.join('\n')}`);
                }

                this._libraryFileWatcher = this._fs.createFileSystemWatcher(watchList, (event, path) => {
                    if (this._verboseOutput) {
                        this._console.log(`Received fs event '${event}' for path '${path}'`);
                    }

                    this._scheduleLibraryAnalysis();
                });
            } catch {
                this._console.log(`Exception caught when installing fs watcher for:\n ${watchList.join('\n')}`);
            }
        }
    }

    private _clearLibraryReanalysisTimer() {
        if (this._libraryReanalysisTimer) {
            clearTimeout(this._libraryReanalysisTimer);
            this._libraryReanalysisTimer = undefined;
        }
    }

    private _scheduleLibraryAnalysis() {
        if (this._disposed) {
            // Already disposed.
            return;
        }

        this._clearLibraryReanalysisTimer();

        // Wait for a little while, since library changes
        // tend to happen in big batches when packages
        // are installed or uninstalled.
        this._libraryReanalysisTimer = setTimeout(() => {
            this._clearLibraryReanalysisTimer();

            // Invalidate import resolver, mark all files dirty unconditionally,
            // and reanalyze.
            this.invalidateAndForceReanalysis();
            this._scheduleReanalysis(false);
        }, 100);
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
            this._configFileWatcher = this._fs.createFileSystemWatcher([this._configFilePath], (event) => {
                if (this._verboseOutput) {
                    this._console.log(`Received fs event '${event}' for config file`);
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

            this._console.log(`Reloading configuration file at ${this._configFilePath}`);

            // We can't just reload config file when it is changed; we need to consider
            // command line options as well to construct new config Options.
            const configOptions = this._getConfigOptions(this._commandLineOptions!);
            this._backgroundAnalysisProgram.setConfigOptions(configOptions);

            this._applyConfigOptions();
        }
    }

    private _applyConfigOptions(reanalyze = true) {
        // Allocate a new import resolver because the old one has information
        // cached based on the previous config options.
        const importResolver = this._importResolverFactory(this._fs, this._backgroundAnalysisProgram.configOptions);
        this._backgroundAnalysisProgram.setImportResolver(importResolver);

        this._updateLibraryFileWatcher();
        this._updateSourceFileWatchers();
        this._updateTrackedFileList(true);

        if (reanalyze) {
            this._scheduleReanalysis(false);
        }
    }

    private _clearReanalysisTimer() {
        if (this._analyzeTimer) {
            clearTimeout(this._analyzeTimer);
            this._analyzeTimer = undefined;
        }
    }

    private _scheduleReanalysis(requireTrackedFileUpdate: boolean) {
        if (this._disposed) {
            // already disposed
            return;
        }

        if (requireTrackedFileUpdate) {
            this._requireTrackedFileUpdate = true;
        }

        this._backgroundAnalysisCancellationSource?.cancel();

        // Remove any existing analysis timer.
        this._clearReanalysisTimer();

        // How long has it been since the user interacted with the service?
        // If the user is actively typing, back off to let him or her finish.
        const timeSinceLastUserInteractionInMs = Date.now() - this._lastUserInteractionTime;
        const minBackoffTimeInMs = _userActivityBackoffTimeInMs;

        // We choose a small non-zero value here. If this value
        // is too small (like zero), the VS Code extension becomes
        // unresponsive during heavy analysis. If this number is too
        // large, analysis takes longer.
        const minTimeBetweenAnalysisPassesInMs = 20;

        const timeUntilNextAnalysisInMs = Math.max(
            minBackoffTimeInMs - timeSinceLastUserInteractionInMs,
            minTimeBetweenAnalysisPassesInMs
        );

        // Schedule a new timer.
        this._analyzeTimer = setTimeout(() => {
            this._analyzeTimer = undefined;

            if (this._requireTrackedFileUpdate) {
                this._updateTrackedFileList(false);
            }

            // This creates a cancellation source only if it actually gets used.
            this._backgroundAnalysisCancellationSource = createAnalysisCancellationTokenSource();
            const moreToAnalyze = this._backgroundAnalysisProgram.startAnalysis(
                this._backgroundAnalysisCancellationSource.token
            );
            if (moreToAnalyze) {
                this._scheduleReanalysis(false);
            }
        }, timeUntilNextAnalysisInMs);
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
                elapsedTime: 0,
            });
        }
    }
}
