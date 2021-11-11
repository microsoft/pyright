/*
 * service.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * A persistent service that is able to analyze a collection of
 * Python files.
 */

import * as TOML from '@iarna/toml';
import * as JSONC from 'jsonc-parser';
import {
    AbstractCancellationTokenSource,
    CancellationToken,
    CompletionItem,
    DocumentSymbol,
} from 'vscode-languageserver';
import { TextDocumentContentChangeEvent } from 'vscode-languageserver-textdocument';
import {
    CallHierarchyIncomingCall,
    CallHierarchyItem,
    CallHierarchyOutgoingCall,
    DocumentHighlight,
    MarkupKind,
} from 'vscode-languageserver-types';

import { BackgroundAnalysisBase } from '../backgroundAnalysisBase';
import { CancellationProvider, DefaultCancellationProvider } from '../common/cancellationUtils';
import { CommandLineOptions } from '../common/commandLineOptions';
import { ConfigOptions } from '../common/configOptions';
import { ConsoleInterface, log, LogLevel, StandardConsole } from '../common/console';
import { Diagnostic } from '../common/diagnostic';
import { FileEditAction, TextEditAction } from '../common/editAction';
import { LanguageServiceExtension } from '../common/extensibility';
import { FileSystem, FileWatcher, ignoredWatchEventFunction } from '../common/fileSystem';
import { Host, HostFactory, NoAccessHost } from '../common/host';
import {
    combinePaths,
    FileSpec,
    forEachAncestorDirectory,
    getDirectoryPath,
    getFileName,
    getFileSpec,
    getFileSystemEntries,
    isDirectory,
    isFile,
    makeDirectories,
    normalizePath,
    normalizeSlashes,
    stripFileExtension,
    tryRealpath,
    tryStat,
} from '../common/pathUtils';
import { DocumentRange, Position, Range } from '../common/textRange';
import { timingStats } from '../common/timing';
import { AbbreviationMap, CompletionOptions, CompletionResults } from '../languageService/completionProvider';
import { DefinitionFilter } from '../languageService/definitionProvider';
import { IndexResults, WorkspaceSymbolCallback } from '../languageService/documentSymbolProvider';
import { HoverResults } from '../languageService/hoverProvider';
import { ReferenceCallback } from '../languageService/referencesProvider';
import { SignatureHelpResults } from '../languageService/signatureHelpProvider';
import { AnalysisCompleteCallback } from './analysis';
import { BackgroundAnalysisProgram, BackgroundAnalysisProgramFactory } from './backgroundAnalysisProgram';
import { createImportedModuleDescriptor, ImportResolver, ImportResolverFactory } from './importResolver';
import { MaxAnalysisTime } from './program';
import { findPythonSearchPaths } from './pythonPathUtils';
import { TypeEvaluator } from './typeEvaluatorTypes';

export const configFileNames = ['pyrightconfig.json'];
export const pyprojectTomlName = 'pyproject.toml';

// How long since the last user activity should we wait until running
// the analyzer on any files that have not yet been analyzed?
const _userActivityBackoffTimeInMs = 250;

const _gitDirectory = normalizeSlashes('/.git/');
const _includeFileRegex = /\.pyi?$/;

export class AnalyzerService {
    private _hostFactory: HostFactory;
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
    private _maxAnalysisTimeInForeground: MaxAnalysisTime | undefined;
    private _backgroundAnalysisProgramFactory: BackgroundAnalysisProgramFactory | undefined;
    private _disposed = false;
    private _cancellationProvider: CancellationProvider;

    constructor(
        instanceName: string,
        fs: FileSystem,
        console?: ConsoleInterface,
        hostFactory?: HostFactory,
        importResolverFactory?: ImportResolverFactory,
        configOptions?: ConfigOptions,
        extension?: LanguageServiceExtension,
        backgroundAnalysis?: BackgroundAnalysisBase,
        maxAnalysisTime?: MaxAnalysisTime,
        backgroundAnalysisProgramFactory?: BackgroundAnalysisProgramFactory,
        cancellationProvider?: CancellationProvider
    ) {
        this._instanceName = instanceName;
        this._console = console || new StandardConsole();
        this._executionRootPath = '';
        this._extension = extension;
        this._importResolverFactory = importResolverFactory || AnalyzerService.createImportResolver;
        this._maxAnalysisTimeInForeground = maxAnalysisTime;
        this._backgroundAnalysisProgramFactory = backgroundAnalysisProgramFactory;
        this._cancellationProvider = cancellationProvider ?? new DefaultCancellationProvider();
        this._hostFactory = hostFactory ?? (() => new NoAccessHost());

        configOptions = configOptions ?? new ConfigOptions(process.cwd());
        const importResolver = this._importResolverFactory(fs, configOptions, this._hostFactory());

        this._backgroundAnalysisProgram =
            backgroundAnalysisProgramFactory !== undefined
                ? backgroundAnalysisProgramFactory(
                      this._console,
                      configOptions,
                      importResolver,
                      this._extension,
                      backgroundAnalysis,
                      this._maxAnalysisTimeInForeground
                  )
                : new BackgroundAnalysisProgram(
                      this._console,
                      configOptions,
                      importResolver,
                      this._extension,
                      backgroundAnalysis,
                      this._maxAnalysisTimeInForeground
                  );
    }

    clone(instanceName: string, backgroundAnalysis?: BackgroundAnalysisBase, fs?: FileSystem): AnalyzerService {
        const service = new AnalyzerService(
            instanceName,
            fs ?? this._fs,
            this._console,
            this._hostFactory,
            this._importResolverFactory,
            this._backgroundAnalysisProgram.configOptions,
            this._extension,
            backgroundAnalysis,
            this._maxAnalysisTimeInForeground,
            this._backgroundAnalysisProgramFactory,
            this._cancellationProvider
        );

        // Make sure we keep editor content (open file) which could be different than one in the file system.
        for (const fileInfo of this.backgroundAnalysisProgram.program.getOpened()) {
            const version = fileInfo.sourceFile.getClientVersion();
            if (version !== undefined) {
                service.setFileOpened(
                    fileInfo.sourceFile.getFilePath(),
                    version,
                    fileInfo.sourceFile.getOpenFileContents()!
                );
            }
        }

        return service;
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

    get backgroundAnalysisProgram(): BackgroundAnalysisProgram {
        return this._backgroundAnalysisProgram;
    }

    static createImportResolver(fs: FileSystem, options: ConfigOptions, host: Host): ImportResolver {
        return new ImportResolver(fs, options, host);
    }

    setCompletionCallback(callback: AnalysisCompleteCallback | undefined): void {
        this._onCompletionCallback = callback;
        this._backgroundAnalysisProgram.setCompletionCallback(callback);
    }

    setOptions(commandLineOptions: CommandLineOptions): void {
        this._commandLineOptions = commandLineOptions;

        const host = this._hostFactory();
        const configOptions = this._getConfigOptions(host, commandLineOptions);

        if (configOptions.pythonPath) {
            // Make sure we have default python environment set.
            configOptions.ensureDefaultPythonVersion(host, this._console);
        }

        configOptions.ensureDefaultPythonPlatform(host, this._console);

        this._backgroundAnalysisProgram.setConfigOptions(configOptions);

        this._executionRootPath = normalizePath(
            combinePaths(commandLineOptions.executionRoot, configOptions.projectRoot)
        );
        this._applyConfigOptions(host);
    }

    isTracked(filePath: string): boolean {
        for (const includeSpec of this._configOptions.include) {
            if (this._matchIncludeFileSpec(includeSpec.regExp, this._configOptions.exclude, filePath)) {
                return true;
            }
        }

        return false;
    }

    setFileOpened(path: string, version: number | null, contents: string) {
        this._backgroundAnalysisProgram.setFileOpened(path, version, contents, this.isTracked(path));
        this._scheduleReanalysis(false);
    }

    updateOpenFileContents(path: string, version: number | null, contents: TextDocumentContentChangeEvent[]) {
        this._backgroundAnalysisProgram.updateOpenFileContents(path, version, contents, this.isTracked(path));
        this._scheduleReanalysis(false);
    }

    test_setIndexing(
        workspaceIndices: Map<string, IndexResults>,
        libraryIndices: Map<string | undefined, Map<string, IndexResults>>
    ) {
        this._backgroundAnalysisProgram.test_setIndexing(workspaceIndices, libraryIndices);
    }

    startIndexing() {
        this._backgroundAnalysisProgram.startIndexing();
    }

    setFileClosed(path: string) {
        this._backgroundAnalysisProgram.setFileClosed(path);
        this._scheduleReanalysis(false);
    }

    getParseResult(path: string) {
        return this._program.getBoundSourceFile(path)?.getParseResults();
    }

    getTextOnRange(filePath: string, range: Range, token: CancellationToken) {
        return this._program.getTextOnRange(filePath, range, token);
    }

    getAutoImports(
        filePath: string,
        range: Range,
        similarityLimit: number,
        nameMap: AbbreviationMap | undefined,
        lazyEdit: boolean,
        allowVariableInAll: boolean,
        token: CancellationToken
    ) {
        return this._program.getAutoImports(
            filePath,
            range,
            similarityLimit,
            nameMap,
            this._backgroundAnalysisProgram.getIndexing(filePath),
            lazyEdit,
            allowVariableInAll,
            token
        );
    }

    getDefinitionForPosition(
        filePath: string,
        position: Position,
        filter: DefinitionFilter,
        token: CancellationToken
    ): DocumentRange[] | undefined {
        return this._program.getDefinitionsForPosition(filePath, position, filter, token);
    }

    reportReferencesForPosition(
        filePath: string,
        position: Position,
        includeDeclaration: boolean,
        reporter: ReferenceCallback,
        token: CancellationToken
    ) {
        this._program.reportReferencesForPosition(filePath, position, includeDeclaration, reporter, token);
    }

    addSymbolsForDocument(filePath: string, symbolList: DocumentSymbol[], token: CancellationToken) {
        this._program.addSymbolsForDocument(filePath, symbolList, token);
    }

    reportSymbolsForWorkspace(query: string, reporter: WorkspaceSymbolCallback, token: CancellationToken) {
        this._program.reportSymbolsForWorkspace(query, reporter, token);
    }

    getHoverForPosition(
        filePath: string,
        position: Position,
        format: MarkupKind,
        token: CancellationToken
    ): HoverResults | undefined {
        return this._program.getHoverForPosition(filePath, position, format, token);
    }

    getDocumentHighlight(
        filePath: string,
        position: Position,
        token: CancellationToken
    ): DocumentHighlight[] | undefined {
        return this._program.getDocumentHighlight(filePath, position, token);
    }

    getSignatureHelpForPosition(
        filePath: string,
        position: Position,
        format: MarkupKind,
        token: CancellationToken
    ): SignatureHelpResults | undefined {
        return this._program.getSignatureHelpForPosition(filePath, position, format, token);
    }

    getCompletionsForPosition(
        filePath: string,
        position: Position,
        workspacePath: string,
        options: CompletionOptions,
        nameMap: AbbreviationMap | undefined,
        token: CancellationToken
    ): Promise<CompletionResults | undefined> {
        return this._program.getCompletionsForPosition(
            filePath,
            position,
            workspacePath,
            options,
            nameMap,
            this._backgroundAnalysisProgram.getIndexing(filePath),
            token
        );
    }

    getEvaluator(): TypeEvaluator | undefined {
        return this._program.evaluator;
    }

    resolveCompletionItem(
        filePath: string,
        completionItem: CompletionItem,
        options: CompletionOptions,
        nameMap: AbbreviationMap | undefined,
        token: CancellationToken
    ) {
        this._program.resolveCompletionItem(
            filePath,
            completionItem,
            options,
            nameMap,
            this._backgroundAnalysisProgram.getIndexing(filePath),
            token
        );
    }

    performQuickAction(
        filePath: string,
        command: string,
        args: any[],
        token: CancellationToken
    ): TextEditAction[] | undefined {
        return this._program.performQuickAction(filePath, command, args, token);
    }

    renameModule(filePath: string, newFilePath: string, token: CancellationToken): FileEditAction[] | undefined {
        return this._program.renameModule(filePath, newFilePath, token);
    }

    renameSymbolAtPosition(
        filePath: string,
        position: Position,
        newName: string,
        isDefaultWorkspace: boolean,
        token: CancellationToken
    ): FileEditAction[] | undefined {
        return this._program.renameSymbolAtPosition(filePath, position, newName, isDefaultWorkspace, token);
    }

    getCallForPosition(filePath: string, position: Position, token: CancellationToken): CallHierarchyItem | undefined {
        return this._program.getCallForPosition(filePath, position, token);
    }

    getIncomingCallsForPosition(
        filePath: string,
        position: Position,
        token: CancellationToken
    ): CallHierarchyIncomingCall[] | undefined {
        return this._program.getIncomingCallsForPosition(filePath, position, token);
    }

    getOutgoingCallsForPosition(
        filePath: string,
        position: Position,
        token: CancellationToken
    ): CallHierarchyOutgoingCall[] | undefined {
        return this._program.getOutgoingCallsForPosition(filePath, position, token);
    }

    printStats() {
        this._console.info('');
        this._console.info('Analysis stats');

        const fileCount = this._program.getFileCount();
        this._console.info('Total files analyzed: ' + fileCount.toString());
    }

    printDependencies(verbose: boolean) {
        this._program.printDependencies(this._executionRootPath, verbose);
    }

    getDiagnosticsForRange(filePath: string, range: Range, token: CancellationToken): Promise<Diagnostic[]> {
        return this._backgroundAnalysisProgram.getDiagnosticsForRange(filePath, range, token);
    }

    getConfigOptions() {
        return this._configOptions;
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
    get test_program() {
        return this._program;
    }

    test_getConfigOptions(commandLineOptions: CommandLineOptions): ConfigOptions {
        return this._getConfigOptions(this._backgroundAnalysisProgram.host, commandLineOptions);
    }

    test_getFileNamesFromFileSpecs(): string[] {
        return this._getFileNamesFromFileSpecs();
    }

    // Calculates the effective options based on the command-line options,
    // an optional config file, and default values.
    private _getConfigOptions(host: Host, commandLineOptions: CommandLineOptions): ConfigOptions {
        let projectRoot = commandLineOptions.executionRoot;
        let configFilePath: string | undefined;
        let pyprojectFilePath: string | undefined;

        if (commandLineOptions.configFilePath) {
            // If the config file path was specified, determine whether it's
            // a directory (in which case the default config file name is assumed)
            // or a file.
            configFilePath = combinePaths(
                commandLineOptions.executionRoot,
                normalizePath(commandLineOptions.configFilePath)
            );
            if (!this._fs.existsSync(configFilePath)) {
                this._console.info(`Configuration file not found at ${configFilePath}.`);
                configFilePath = commandLineOptions.executionRoot;
            } else {
                if (configFilePath.toLowerCase().endsWith('.json')) {
                    projectRoot = getDirectoryPath(configFilePath);
                } else {
                    projectRoot = configFilePath;
                    configFilePath = this._findConfigFile(configFilePath);
                    if (!configFilePath) {
                        this._console.info(`Configuration file not found at ${projectRoot}.`);
                    }
                }
            }
        } else if (projectRoot) {
            // In a project-based IDE like VS Code, we should assume that the
            // project root directory contains the config file.
            configFilePath = this._findConfigFile(projectRoot);

            // If pyright is being executed from the command line, the working
            // directory may be deep within a project, and we need to walk up the
            // directory hierarchy to find the project root.
            if (!configFilePath && !commandLineOptions.fromVsCodeExtension) {
                configFilePath = this._findConfigFileHereOrUp(projectRoot);
            }

            if (configFilePath) {
                projectRoot = getDirectoryPath(configFilePath);
            } else {
                this._console.info(`No configuration file found.`);
                configFilePath = undefined;
            }
        }

        if (!configFilePath) {
            // See if we can find a pyproject.toml file in this directory.
            pyprojectFilePath = this._findPyprojectTomlFile(projectRoot);

            if (!pyprojectFilePath && !commandLineOptions.fromVsCodeExtension) {
                pyprojectFilePath = this._findPyprojectTomlFileHereOrUp(projectRoot);
            }

            if (pyprojectFilePath) {
                projectRoot = getDirectoryPath(pyprojectFilePath);
                this._console.info(`pyproject.toml file found at ${projectRoot}.`);
            } else {
                this._console.info(`No pyproject.toml file found.`);
            }
        }

        const configOptions = new ConfigOptions(projectRoot, this._typeCheckingMode);
        const defaultExcludes = ['**/node_modules', '**/__pycache__', '.git'];

        if (commandLineOptions.pythonPath) {
            this._console.info(
                `Setting pythonPath for service "${this._instanceName}": ` + `"${commandLineOptions.pythonPath}"`
            );
            configOptions.pythonPath = commandLineOptions.pythonPath;
        }

        // The pythonPlatform and pythonVersion from the command-line can be overridden
        // by the config file, so initialize them upfront.
        configOptions.defaultPythonPlatform = commandLineOptions.pythonPlatform;
        configOptions.defaultPythonVersion = commandLineOptions.pythonVersion;
        configOptions.ensureDefaultExtraPaths(
            this._fs,
            commandLineOptions.autoSearchPaths || false,
            commandLineOptions.extraPaths
        );

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

        this._configFilePath = configFilePath || pyprojectFilePath;

        // If we found a config file, parse it to compute the effective options.
        let configJsonObj: object | undefined;
        if (configFilePath) {
            this._console.info(`Loading configuration file at ${configFilePath}`);
            configJsonObj = this._parseJsonConfigFile(configFilePath);
        } else if (pyprojectFilePath) {
            this._console.info(`Loading pyproject.toml file at ${pyprojectFilePath}`);
            configJsonObj = this._parsePyprojectTomlFile(pyprojectFilePath);
        }

        if (configJsonObj) {
            configOptions.initializeFromJson(
                configJsonObj,
                this._typeCheckingMode,
                this._console,
                host,
                commandLineOptions.diagnosticSeverityOverrides,
                commandLineOptions.fileSpecs.length > 0
            );

            const configFileDir = getDirectoryPath(this._configFilePath!);

            // If no include paths were provided, assume that all files within
            // the project should be included.
            if (configOptions.include.length === 0) {
                this._console.info(`No include entries specified; assuming ${configFileDir}`);
                configOptions.include.push(getFileSpec(configFileDir, '.'));
            }

            // If there was no explicit set of excludes, add a few common ones to avoid long scan times.
            if (configOptions.exclude.length === 0) {
                defaultExcludes.forEach((exclude) => {
                    this._console.info(`Auto-excluding ${exclude}`);
                    configOptions.exclude.push(getFileSpec(configFileDir, exclude));
                });

                if (configOptions.autoExcludeVenv === undefined) {
                    configOptions.autoExcludeVenv = true;
                }
            }
        } else {
            configOptions.autoExcludeVenv = true;
            configOptions.applyDiagnosticOverrides(commandLineOptions.diagnosticSeverityOverrides);
        }

        configOptions.analyzeUnannotatedFunctions = commandLineOptions.analyzeUnannotatedFunctions ?? true;

        const reportDuplicateSetting = (settingName: string, configValue: number | string | boolean) => {
            const settingSource = commandLineOptions.fromVsCodeExtension
                ? 'the client settings'
                : 'a command-line option';
            this._console.warn(
                `The ${settingName} has been specified in both the config file and ` +
                    `${settingSource}. The value in the config file (${configValue}) ` +
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
                reportDuplicateSetting('venvPath', configOptions.venvPath);
            }
        }

        if (commandLineOptions.typeshedPath) {
            if (!configOptions.typeshedPath) {
                configOptions.typeshedPath = commandLineOptions.typeshedPath;
            } else {
                reportDuplicateSetting('typeshedPath', configOptions.typeshedPath);
            }
        }

        configOptions.verboseOutput = commandLineOptions.verboseOutput ?? configOptions.verboseOutput;
        configOptions.checkOnlyOpenFiles = !!commandLineOptions.checkOnlyOpenFiles;
        configOptions.autoImportCompletions = !!commandLineOptions.autoImportCompletions;
        configOptions.indexing = !!commandLineOptions.indexing;
        configOptions.logTypeEvaluationTime = !!commandLineOptions.logTypeEvaluationTime;
        configOptions.typeEvaluationTimeThreshold = commandLineOptions.typeEvaluationTimeThreshold;

        // If useLibraryCodeForTypes was not specified in the config, allow the settings
        // or command line to override it.
        if (configOptions.useLibraryCodeForTypes === undefined) {
            configOptions.useLibraryCodeForTypes = !!commandLineOptions.useLibraryCodeForTypes;
        } else if (commandLineOptions.useLibraryCodeForTypes !== undefined) {
            reportDuplicateSetting('useLibraryCodeForTypes', configOptions.useLibraryCodeForTypes);
        }

        // If there was no stub path specified, use a default path.
        if (commandLineOptions.stubPath) {
            if (!configOptions.stubPath) {
                configOptions.stubPath = commandLineOptions.stubPath;
            } else {
                reportDuplicateSetting('stubPath', configOptions.stubPath);
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
                this._console.error(`venvPath ${configOptions.venvPath} is not a valid directory.`);
            }

            // venvPath without venv means it won't do anything while resolveImport.
            // so first, try to set venv from existing configOption if it is null. if both are null,
            // then, resolveImport won't consider venv
            configOptions.venv = configOptions.venv ?? this._configOptions.venv;
            if (configOptions.venv) {
                const fullVenvPath = combinePaths(configOptions.venvPath, configOptions.venv);

                if (!this._fs.existsSync(fullVenvPath) || !isDirectory(this._fs, fullVenvPath)) {
                    this._console.error(
                        `venv ${configOptions.venv} subdirectory not found in venv path ${configOptions.venvPath}.`
                    );
                } else {
                    const importFailureInfo: string[] = [];
                    if (findPythonSearchPaths(this._fs, configOptions, host, importFailureInfo) === undefined) {
                        this._console.error(
                            `site-packages directory cannot be located for venvPath ` +
                                `${configOptions.venvPath} and venv ${configOptions.venv}.`
                        );

                        if (configOptions.verboseOutput) {
                            importFailureInfo.forEach((diag) => {
                                this._console.error(`  ${diag}`);
                            });
                        }
                    }
                }
            }
        }

        // Is there a reference to a venv? If so, there needs to be a valid venvPath.
        if (configOptions.venv) {
            if (!configOptions.venvPath) {
                this._console.warn(`venvPath not specified, so venv settings will be ignored.`);
            }
        }

        if (configOptions.typeshedPath) {
            if (
                !this._fs.existsSync(configOptions.typeshedPath) ||
                !isDirectory(this._fs, configOptions.typeshedPath)
            ) {
                this._console.error(`typeshedPath ${configOptions.typeshedPath} is not a valid directory.`);
            }
        }

        if (configOptions.stubPath) {
            if (!this._fs.existsSync(configOptions.stubPath) || !isDirectory(this._fs, configOptions.stubPath)) {
                this._console.warn(`stubPath ${configOptions.stubPath} is not a valid directory.`);
            }
        }

        return configOptions;
    }

    writeTypeStub(token: CancellationToken): void {
        const typingsSubdirPath = this._getTypeStubFolder();

        this._program.writeTypeStub(
            this._typeStubTargetPath ?? '',
            this._typeStubTargetIsSingleFile,
            typingsSubdirPath,
            token
        );
    }

    writeTypeStubInBackground(token: CancellationToken): Promise<any> {
        const typingsSubdirPath = this._getTypeStubFolder();

        return this._backgroundAnalysisProgram.writeTypeStub(
            this._typeStubTargetPath ?? '',
            this._typeStubTargetIsSingleFile,
            typingsSubdirPath,
            token
        );
    }

    // This is called after a new type stub has been created. It allows
    // us to invalidate caches and force reanalysis of files that potentially
    // are affected by the appearance of a new type stub.
    invalidateAndForceReanalysis(rebuildLibraryIndexing = true, updateTrackedFileList = false) {
        if (updateTrackedFileList) {
            this._updateTrackedFileList(/* markFilesDirtyUnconditionally */ false);
        }

        // Mark all files with one or more errors dirty.
        this._backgroundAnalysisProgram.invalidateAndForceReanalysis(rebuildLibraryIndexing);
    }

    // Forces the service to stop all analysis, discard all its caches,
    // and research for files.
    restart() {
        this._applyConfigOptions(this._hostFactory());

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

    private get _watchForConfigChanges() {
        return !!this._commandLineOptions?.watchForConfigChanges;
    }

    private get _typeCheckingMode() {
        return this._commandLineOptions?.typeCheckingMode;
    }

    private get _verboseOutput(): boolean {
        return !!this._configOptions.verboseOutput;
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
            this._console.info(errMsg);
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
        } catch (e: any) {
            const errMsg = `Could not create typings directory '${stubPath}'`;
            this._console.error(errMsg);
            throw new Error(errMsg);
        }

        // Generate a typings subdirectory hierarchy.
        const typingsSubdirPath = combinePaths(stubPath, typeStubInputTargetParts[0]);
        const typingsSubdirHierarchy = combinePaths(stubPath, ...typeStubInputTargetParts);

        try {
            // Generate a new typings subdirectory if necessary.
            if (!this._fs.existsSync(typingsSubdirHierarchy)) {
                makeDirectories(this._fs, typingsSubdirHierarchy, stubPath);
            }
        } catch (e: any) {
            const errMsg = `Could not create typings subdirectory '${typingsSubdirHierarchy}'`;
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

    private _findPyprojectTomlFileHereOrUp(searchPath: string): string | undefined {
        return forEachAncestorDirectory(searchPath, (ancestor) => this._findPyprojectTomlFile(ancestor));
    }

    private _findPyprojectTomlFile(searchPath: string) {
        const fileName = combinePaths(searchPath, pyprojectTomlName);
        if (this._fs.existsSync(fileName)) {
            return fileName;
        }
        return undefined;
    }

    private _parseJsonConfigFile(configPath: string): object | undefined {
        return this._attemptParseFile(configPath, (fileContents) => {
            return JSONC.parse(fileContents);
        });
    }

    private _parsePyprojectTomlFile(pyprojectPath: string): object | undefined {
        return this._attemptParseFile(pyprojectPath, (fileContents, attemptCount) => {
            try {
                const configObj = TOML.parse(fileContents);
                if (configObj && configObj.tool && (configObj.tool as TOML.JsonMap).pyright) {
                    return (configObj.tool as TOML.JsonMap).pyright as object;
                }
            } catch (e: any) {
                this._console.error(`Pyproject file parse attempt ${attemptCount} error: ${JSON.stringify(e)}`);
                throw e;
            }

            this._console.error(`Pyproject file "${pyprojectPath}" is missing "[tool.pyright]" section.`);
            return undefined;
        });
    }

    private _attemptParseFile(
        filePath: string,
        parseCallback: (contents: string, attempt: number) => object | undefined
    ): object | undefined {
        let fileContents = '';
        let parseAttemptCount = 0;

        while (true) {
            // Attempt to read the file contents.
            try {
                fileContents = this._fs.readFileSync(filePath, 'utf8');
            } catch {
                this._console.error(`Config file "${filePath}" could not be read.`);
                this._reportConfigParseError();
                return undefined;
            }

            // Attempt to parse the file.
            let parseFailed = false;
            try {
                return parseCallback(fileContents, parseAttemptCount + 1);
            } catch (e: any) {
                parseFailed = true;
            }

            if (!parseFailed) {
                break;
            }

            // If we attempt to read the file immediately after it was saved, it
            // may have been partially written when we read it, resulting in parse
            // errors. We'll give it a little more time and try again.
            if (parseAttemptCount++ >= 5) {
                this._console.error(`Config file "${filePath}" could not be parsed. Verify that format is correct.`);
                this._reportConfigParseError();
                return undefined;
            }
        }

        return undefined;
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
            const moduleDescriptor = createImportedModuleDescriptor(this._typeStubTargetImportName);
            const importResult = this._backgroundAnalysisProgram.importResolver.resolveImport(
                '',
                execEnv,
                moduleDescriptor
            );

            if (importResult.isImportFound) {
                const filesToImport: string[] = [];

                // Determine the directory that contains the root package.
                const finalResolvedPath = importResult.resolvedPaths[importResult.resolvedPaths.length - 1];
                const isFinalPathFile = isFile(this._fs, finalResolvedPath);
                const isFinalPathInitFile =
                    isFinalPathFile && stripFileExtension(getFileName(finalResolvedPath)) === '__init__';

                let rootPackagePath = finalResolvedPath;

                if (isFinalPathFile) {
                    // If the module is a __init__.pyi? file, use its parent directory instead.
                    rootPackagePath = getDirectoryPath(rootPackagePath);
                }

                for (let i = importResult.resolvedPaths.length - 2; i >= 0; i--) {
                    if (importResult.resolvedPaths[i]) {
                        rootPackagePath = importResult.resolvedPaths[i];
                    } else {
                        // If there was no file corresponding to this portion
                        // of the name path, assume that it's contained
                        // within its parent directory.
                        rootPackagePath = getDirectoryPath(rootPackagePath);
                    }
                }

                if (isDirectory(this._fs, rootPackagePath)) {
                    this._typeStubTargetPath = rootPackagePath;
                } else if (isFile(this._fs, rootPackagePath)) {
                    // This can occur if there is a "dir/__init__.py" at the same level as a
                    // module "dir/module.py" that is specifically targeted for stub generation.
                    this._typeStubTargetPath = getDirectoryPath(rootPackagePath);
                }

                if (!finalResolvedPath) {
                    this._typeStubTargetIsSingleFile = false;
                } else {
                    filesToImport.push(finalResolvedPath);
                    this._typeStubTargetIsSingleFile = importResult.resolvedPaths.length === 1 && !isFinalPathInitFile;
                }

                // Add the implicit import paths.
                importResult.filteredImplicitImports.forEach((implicitImport) => {
                    filesToImport.push(implicitImport.path);
                });

                this._backgroundAnalysisProgram.setAllowedThirdPartyImports([this._typeStubTargetImportName]);
                this._backgroundAnalysisProgram.setTrackedFiles(filesToImport);
            } else {
                this._console.error(`Import '${this._typeStubTargetImportName}' not found`);
            }
        } else {
            let fileList: string[] = [];
            this._console.info(`Searching for source files`);
            fileList = this._getFileNamesFromFileSpecs();

            this._backgroundAnalysisProgram.setTrackedFiles(fileList);
            this._backgroundAnalysisProgram.markAllFilesDirty(markFilesDirtyUnconditionally);

            if (fileList.length === 0) {
                this._console.info(`No source files found.`);
            } else {
                this._console.info(`Found ${fileList.length} ` + `source ${fileList.length === 1 ? 'file' : 'files'}`);
            }
        }

        this._requireTrackedFileUpdate = false;
    }

    private _matchFiles(include: FileSpec[], exclude: FileSpec[]): string[] {
        const envMarkers = [['bin', 'activate'], ['Scripts', 'activate'], ['pyvenv.cfg']];
        const results: string[] = [];
        const startTime = Date.now();
        const longOperationLimitInSec = 10;
        let loggedLongOperationError = false;

        const visitDirectoryUnchecked = (absolutePath: string, includeRegExp: RegExp) => {
            if (!loggedLongOperationError) {
                const secondsSinceStart = (Date.now() - startTime) * 0.001;

                // If this is taking a long time, log an error to help the user
                // diagnose and mitigate the problem.
                if (secondsSinceStart >= longOperationLimitInSec) {
                    this._console.error(
                        `Enumeration of workspace source files is taking longer than ${longOperationLimitInSec} seconds.\n` +
                            'This may be because:\n' +
                            '* You have opened your home directory or entire hard drive as a workspace\n' +
                            '* Your workspace contains a very large number of directories and files\n' +
                            '* Your workspace contains a symlink to a directory with many files\n' +
                            '* Your workspace is remote, and file enumeration is slow\n' +
                            'To reduce this time, open a workspace directory with fewer files ' +
                            'or add a pyrightconfig.json configuration file with an "exclude" section to exclude ' +
                            'subdirectories from your workspace. For more details, refer to ' +
                            'https://github.com/microsoft/pyright/blob/main/docs/configuration.md.'
                    );
                    loggedLongOperationError = true;
                }
            }

            if (this._configOptions.autoExcludeVenv) {
                if (envMarkers.some((f) => this._fs.existsSync(combinePaths(absolutePath, ...f)))) {
                    this._console.info(`Auto-excluding ${absolutePath}`);
                    return;
                }
            }

            const { files, directories } = getFileSystemEntries(this._fs, absolutePath);

            for (const file of files) {
                const filePath = combinePaths(absolutePath, file);

                if (this._matchIncludeFileSpec(includeRegExp, exclude, filePath)) {
                    results.push(filePath);
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

        const seenDirs = new Set<string>();
        const visitDirectory = (absolutePath: string, includeRegExp: RegExp) => {
            const realDirPath = tryRealpath(this._fs, absolutePath);
            if (!realDirPath) {
                this._console.warn(`Skipping broken link "${absolutePath}"`);
                return;
            }

            if (seenDirs.has(realDirPath)) {
                this._console.warn(`Skipping recursive symlink "${absolutePath}" -> "${realDirPath}"`);
                return;
            }
            seenDirs.add(realDirPath);

            try {
                visitDirectoryUnchecked(absolutePath, includeRegExp);
            } finally {
                seenDirs.delete(realDirPath);
            }
        };

        include.forEach((includeSpec) => {
            if (!this._isInExcludePath(includeSpec.wildcardRoot, exclude)) {
                let foundFileSpec = false;

                const stat = tryStat(this._fs, includeSpec.wildcardRoot);
                if (stat?.isFile()) {
                    if (this._shouldIncludeFile(includeSpec.wildcardRoot)) {
                        results.push(includeSpec.wildcardRoot);
                        foundFileSpec = true;
                    }
                } else if (stat?.isDirectory()) {
                    visitDirectory(includeSpec.wildcardRoot, includeSpec.regExp);
                    foundFileSpec = true;
                }

                if (!foundFileSpec) {
                    this._console.error(`File or directory "${includeSpec.wildcardRoot}" does not exist.`);
                }
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

        if (!this._watchForSourceChanges) {
            return;
        }

        if (this._configOptions.include.length > 0) {
            const fileList = this._configOptions.include.map((spec) => {
                return combinePaths(this._executionRootPath, spec.wildcardRoot);
            });

            try {
                if (this._verboseOutput) {
                    this._console.info(`Adding fs watcher for directories:\n ${fileList.join('\n')}`);
                }

                const isIgnored = ignoredWatchEventFunction(fileList);
                this._sourceFileWatcher = this._fs.createFileSystemWatcher(fileList, (event, path) => {
                    if (!path) {
                        return;
                    }

                    if (this._verboseOutput) {
                        this._console.info(`SourceFile: Received fs event '${event}' for path '${path}'`);
                    }

                    if (isIgnored(path)) {
                        return;
                    }

                    // Wholesale ignore events that appear to be from tmp file / .git modification.
                    if (path.endsWith('.tmp') || path.endsWith('.git') || path.includes(_gitDirectory)) {
                        return;
                    }

                    const stats = tryStat(this._fs, path);

                    if (stats && stats.isFile() && !path.endsWith('.py') && !path.endsWith('.pyi')) {
                        return;
                    }

                    // Delete comes in as a change event, so try to distinguish here.
                    if (event === 'change' && stats) {
                        this._backgroundAnalysisProgram.markFilesDirty([path], /* evenIfContentsAreSame */ false);
                        this._scheduleReanalysis(/* requireTrackedFileUpdate */ false);
                    } else {
                        // Determine if this is an add or delete event related to a temporary
                        // file. Some tools (like auto-formatters) create temporary files
                        // alongside the original file and name them "x.py.<temp-id>.py" where
                        // <temp-id> is a 32-character random string of hex digits. We don't
                        // want these events to trigger a full reanalysis.
                        const fileName = getFileName(path);
                        const fileNameSplit = fileName.split('.');
                        let isTemporaryFile = false;
                        if (fileNameSplit.length === 4) {
                            if (fileNameSplit[3] === fileNameSplit[1] && fileNameSplit[2].length === 32) {
                                isTemporaryFile = true;
                            }
                        }

                        if (!isTemporaryFile) {
                            // Added/deleted/renamed files impact imports,
                            // clear the import resolver cache and reanalyze everything.
                            this.invalidateAndForceReanalysis(/* rebuildLibraryIndexing */ false);
                            this._scheduleReanalysis(/* requireTrackedFileUpdate */ true);
                        }
                    }
                });
            } catch {
                this._console.error(`Exception caught when installing fs watcher for:\n ${fileList.join('\n')}`);
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

        if (!this._watchForLibraryChanges) {
            return;
        }

        // Watch the library paths for package install/uninstall.
        const importFailureInfo: string[] = [];
        const watchList = findPythonSearchPaths(
            this._fs,
            this._backgroundAnalysisProgram.configOptions,
            this._backgroundAnalysisProgram.host,
            importFailureInfo,
            true,
            this._executionRootPath
        );

        if (watchList && watchList.length > 0) {
            try {
                if (this._verboseOutput) {
                    this._console.info(`Adding fs watcher for library directories:\n ${watchList.join('\n')}`);
                }
                const isIgnored = ignoredWatchEventFunction(watchList);
                this._libraryFileWatcher = this._fs.createFileSystemWatcher(watchList, (event, path) => {
                    if (!path) {
                        return;
                    }

                    if (this._verboseOutput) {
                        this._console.info(`LibraryFile: Received fs event '${event}' for path '${path}'}'`);
                    }

                    if (isIgnored(path)) {
                        return;
                    }

                    this._scheduleLibraryAnalysis();
                });
            } catch {
                this._console.error(`Exception caught when installing fs watcher for:\n ${watchList.join('\n')}`);
            }
        }
    }

    private _clearLibraryReanalysisTimer() {
        if (this._libraryReanalysisTimer) {
            clearTimeout(this._libraryReanalysisTimer);
            this._libraryReanalysisTimer = undefined;
            this._backgroundAnalysisProgram?.cancelIndexing();
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
        }, 1000);
    }

    private _removeConfigFileWatcher() {
        if (this._configFileWatcher) {
            this._configFileWatcher.close();
            this._configFileWatcher = undefined;
        }
    }

    private _updateConfigFileWatcher() {
        this._removeConfigFileWatcher();

        if (!this._watchForConfigChanges) {
            return;
        }

        if (this._configFilePath) {
            this._configFileWatcher = this._fs.createFileSystemWatcher([this._configFilePath], (event) => {
                if (this._verboseOutput) {
                    this._console.info(`Received fs event '${event}' for config file`);
                }
                this._scheduleReloadConfigFile();
            });
        } else if (this._executionRootPath) {
            this._configFileWatcher = this._fs.createFileSystemWatcher([this._executionRootPath], (event, path) => {
                if (!path) {
                    return;
                }

                if (event === 'add' || event === 'change') {
                    const fileName = getFileName(path);
                    if (fileName && configFileNames.some((name) => name === fileName)) {
                        if (this._verboseOutput) {
                            this._console.info(`Received fs event '${event}' for config file`);
                        }
                        if (this._commandLineOptions) {
                            this.setOptions(this._commandLineOptions);
                        }
                    }
                }
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
        this._updateConfigFileWatcher();

        if (this._configFilePath) {
            this._console.info(`Reloading configuration file at ${this._configFilePath}`);

            const host = this._backgroundAnalysisProgram.host;

            // We can't just reload config file when it is changed; we need to consider
            // command line options as well to construct new config Options.
            const configOptions = this._getConfigOptions(host, this._commandLineOptions!);
            this._backgroundAnalysisProgram.setConfigOptions(configOptions);

            this._applyConfigOptions(host);
        }
    }

    private _applyConfigOptions(host: Host) {
        // Allocate a new import resolver because the old one has information
        // cached based on the previous config options.
        const importResolver = this._importResolverFactory(
            this._fs,
            this._backgroundAnalysisProgram.configOptions,
            host
        );

        this._backgroundAnalysisProgram.setImportResolver(importResolver);

        if (this._commandLineOptions?.fromVsCodeExtension || this._configOptions.verboseOutput) {
            const logLevel = this._configOptions.verboseOutput ? LogLevel.Info : LogLevel.Log;
            for (const execEnv of this._configOptions.getExecutionEnvironments()) {
                log(this._console, logLevel, `Search paths for ${execEnv.root || '<default>'}`);
                const roots = importResolver.getImportRoots(execEnv, /* forLogging */ true);
                roots.forEach((path) => {
                    log(this._console, logLevel, `  ${path}`);
                });
            }
        }

        this._updateLibraryFileWatcher();
        this._updateConfigFileWatcher();
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
        if (this._disposed || !this._commandLineOptions?.enableAmbientAnalysis) {
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
            this._backgroundAnalysisCancellationSource = this._cancellationProvider.createCancellationTokenSource();
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

    private _shouldIncludeFile(filePath: string) {
        return _includeFileRegex.test(filePath);
    }

    private _isInExcludePath(path: string, excludePaths: FileSpec[]) {
        return !!excludePaths.find((excl) => excl.regExp.test(path));
    }

    private _matchIncludeFileSpec(includeRegExp: RegExp, exclude: FileSpec[], filePath: string) {
        if (includeRegExp.test(filePath)) {
            if (!this._isInExcludePath(filePath, exclude) && this._shouldIncludeFile(filePath)) {
                return true;
            }
        }

        return false;
    }
}
