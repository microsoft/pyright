/*
 * service.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * A service that is able to analyze a collection of
 * Python files.
 */

import * as TOML from '@iarna/toml';
import * as JSONC from 'jsonc-parser';
import { AbstractCancellationTokenSource, CancellationToken } from 'vscode-languageserver';

import { BackgroundAnalysisBase, RefreshOptions } from '../backgroundAnalysisBase';
import { CancellationProvider, DefaultCancellationProvider } from '../common/cancellationUtils';
import { CommandLineOptions } from '../common/commandLineOptions';
import { ConfigOptions, matchFileSpecs } from '../common/configOptions';
import { ConsoleInterface, LogLevel, StandardConsole, log } from '../common/console';
import { Diagnostic } from '../common/diagnostic';
import { FileEditAction } from '../common/editAction';
import { EditableProgram, ProgramView } from '../common/extensibility';
import { FileSystem } from '../common/fileSystem';
import { FileWatcher, FileWatcherEventType, ignoredWatchEventFunction } from '../common/fileWatcher';
import { Host, HostFactory, NoAccessHost } from '../common/host';
import { defaultStubsDirectory } from '../common/pathConsts';
import {
    FileSpec,
    combinePaths,
    containsPath,
    forEachAncestorDirectory,
    getDirectoryPath,
    getFileExtension,
    getFileName,
    getFileSpec,
    getFileSystemEntries,
    getPathComponents,
    hasPythonExtension,
    isDirectory,
    isFile,
    isFileSystemCaseSensitive,
    makeDirectories,
    normalizePath,
    normalizeSlashes,
    realCasePath,
    stripFileExtension,
    tryRealpath,
    tryStat,
} from '../common/pathUtils';
import { ServiceProvider } from '../common/serviceProvider';
import { ServiceKeys } from '../common/serviceProviderExtensions';
import { Range } from '../common/textRange';
import { timingStats } from '../common/timing';
import { AnalysisCompleteCallback } from './analysis';
import {
    BackgroundAnalysisProgram,
    BackgroundAnalysisProgramFactory,
    InvalidatedReason,
} from './backgroundAnalysisProgram';
import {
    ImportResolver,
    ImportResolverFactory,
    createImportedModuleDescriptor,
    supportedSourceFileExtensions,
} from './importResolver';
import { MaxAnalysisTime, Program } from './program';
import { findPythonSearchPaths } from './pythonPathUtils';
import { IPythonMode } from './sourceFile';
import { TypeEvaluator } from './typeEvaluatorTypes';

export const configFileNames = ['pyrightconfig.json'];
export const pyprojectTomlName = 'pyproject.toml';

// How long since the last user activity should we wait until running
// the analyzer on any files that have not yet been analyzed?
const _userActivityBackoffTimeInMs = 250;

const _gitDirectory = normalizeSlashes('/.git/');

export interface AnalyzerServiceOptions {
    console?: ConsoleInterface;
    hostFactory?: HostFactory;
    importResolverFactory?: ImportResolverFactory;
    configOptions?: ConfigOptions;
    backgroundAnalysis?: BackgroundAnalysisBase;
    maxAnalysisTime?: MaxAnalysisTime;
    backgroundAnalysisProgramFactory?: BackgroundAnalysisProgramFactory;
    cancellationProvider?: CancellationProvider;
    libraryReanalysisTimeProvider?: () => number;
    serviceId?: string;
    skipScanningUserFiles?: boolean;
    fileSystem?: FileSystem;
}

// Hold uniqueId for this service. It can be used to distinguish each service later.
let _nextServiceId = 1;

export function getNextServiceId(name: string) {
    return `${name}_${_nextServiceId++}`;
}

export class AnalyzerService {
    private readonly _instanceName: string;
    private readonly _options: AnalyzerServiceOptions;
    private readonly _backgroundAnalysisProgram: BackgroundAnalysisProgram;
    private readonly _serviceProvider: ServiceProvider;

    private _executionRootPath: string;
    private _typeStubTargetPath: string | undefined;
    private _typeStubTargetIsSingleFile = false;
    private _sourceFileWatcher: FileWatcher | undefined;
    private _reloadConfigTimer: any;
    private _libraryReanalysisTimer: any;
    private _configFilePath: string | undefined;
    private _configFileWatcher: FileWatcher | undefined;
    private _libraryFileWatcher: FileWatcher | undefined;
    private _librarySearchPathsToWatch: string[] | undefined;
    private _onCompletionCallback: AnalysisCompleteCallback | undefined;
    private _commandLineOptions: CommandLineOptions | undefined;
    private _analyzeTimer: any;
    private _requireTrackedFileUpdate = true;
    private _lastUserInteractionTime = Date.now();
    private _backgroundAnalysisCancellationSource: AbstractCancellationTokenSource | undefined;

    private _disposed = false;
    private _pendingLibraryChanges: RefreshOptions = { changesOnly: true };

    constructor(instanceName: string, serviceProvider: ServiceProvider, options: AnalyzerServiceOptions) {
        this._instanceName = instanceName;

        this._executionRootPath = '';
        this._options = options;

        this._options.serviceId = this._options.serviceId ?? getNextServiceId(instanceName);
        this._options.console = options.console || new StandardConsole();

        // Create local copy of the given service provider.
        this._serviceProvider = serviceProvider.clone();

        // Override the console and the file system if they were explicitly provided.
        if (this._options.console) {
            this._serviceProvider.add(ServiceKeys.console, this._options.console);
        }
        if (this._options.fileSystem) {
            this._serviceProvider.add(ServiceKeys.fs, this._options.fileSystem);
        }

        this._options.importResolverFactory = options.importResolverFactory ?? AnalyzerService.createImportResolver;
        this._options.cancellationProvider = options.cancellationProvider ?? new DefaultCancellationProvider();
        this._options.hostFactory = options.hostFactory ?? (() => new NoAccessHost());

        this._options.configOptions = options.configOptions ?? new ConfigOptions(process.cwd());
        const importResolver = this._options.importResolverFactory(
            this._serviceProvider,
            this._options.configOptions,
            this._options.hostFactory()
        );

        this._backgroundAnalysisProgram =
            this._options.backgroundAnalysisProgramFactory !== undefined
                ? this._options.backgroundAnalysisProgramFactory(
                      this._options.serviceId,
                      this._serviceProvider,
                      this._options.configOptions,
                      importResolver,
                      this._options.backgroundAnalysis,
                      this._options.maxAnalysisTime
                  )
                : new BackgroundAnalysisProgram(
                      this._options.serviceId,
                      this._serviceProvider,
                      this._options.configOptions,
                      importResolver,
                      this._options.backgroundAnalysis,
                      this._options.maxAnalysisTime,
                      /* disableChecker */ undefined
                  );
    }

    get fs() {
        return this._backgroundAnalysisProgram.importResolver.fileSystem;
    }

    get serviceProvider() {
        return this._serviceProvider;
    }

    get cancellationProvider() {
        return this._options.cancellationProvider!;
    }

    get librarySearchPathsToWatch() {
        return this._librarySearchPathsToWatch;
    }

    get backgroundAnalysisProgram(): BackgroundAnalysisProgram {
        return this._backgroundAnalysisProgram;
    }

    get test_program() {
        return this._program;
    }

    get id() {
        return this._options.serviceId!;
    }

    clone(
        instanceName: string,
        serviceId: string,
        backgroundAnalysis?: BackgroundAnalysisBase,
        fileSystem?: FileSystem
    ): AnalyzerService {
        const service = new AnalyzerService(instanceName, this._serviceProvider, {
            ...this._options,
            serviceId,
            backgroundAnalysis,
            skipScanningUserFiles: true,
            fileSystem,
        });

        // Cloned service will use whatever user files the service currently has.
        const userFiles = this.getUserFiles();
        service.backgroundAnalysisProgram.setTrackedFiles(userFiles);
        service.backgroundAnalysisProgram.markAllFilesDirty(true);

        // Make sure we keep editor content (open file) which could be different than one in the file system.
        for (const fileInfo of this.backgroundAnalysisProgram.program.getOpened()) {
            const version = fileInfo.sourceFile.getClientVersion();
            if (version !== undefined) {
                service.setFileOpened(
                    fileInfo.sourceFile.getFilePath(),
                    version,
                    fileInfo.sourceFile.getOpenFileContents()!,
                    fileInfo.sourceFile.getIPythonMode(),
                    fileInfo.chainedSourceFile?.sourceFile.getFilePath(),
                    fileInfo.sourceFile.getRealFilePath()
                );
            }
        }

        return service;
    }

    runEditMode(callback: (e: EditableProgram) => void, token: CancellationToken) {
        let edits: FileEditAction[] = [];
        this._backgroundAnalysisProgram.enterEditMode();
        try {
            this._program.runEditMode(callback, token);
        } finally {
            edits = this._backgroundAnalysisProgram.exitEditMode();
        }

        return token.isCancellationRequested ? [] : edits;
    }

    dispose() {
        if (!this._disposed) {
            // Make sure we dispose program, otherwise, entire program
            // will leak.
            this._backgroundAnalysisProgram.dispose();
        }

        this._disposed = true;
        this._removeSourceFileWatchers();
        this._removeConfigFileWatcher();
        this._removeLibraryFileWatcher();
        this._clearReloadConfigTimer();
        this._clearReanalysisTimer();
        this._clearLibraryReanalysisTimer();
    }

    static createImportResolver(serviceProvider: ServiceProvider, options: ConfigOptions, host: Host): ImportResolver {
        return new ImportResolver(serviceProvider, options, host);
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

        this._executionRootPath = realCasePath(
            combinePaths(commandLineOptions.executionRoot, configOptions.projectRoot),
            this.fs
        );
        this._applyConfigOptions(host);
    }

    hasSourceFile(filePath: string): boolean {
        return this.backgroundAnalysisProgram.hasSourceFile(filePath);
    }

    isTracked(filePath: string): boolean {
        return this._program.owns(filePath);
    }

    getUserFiles() {
        return this._program.getUserFiles().map((i) => i.sourceFile.getFilePath());
    }

    getOpenFiles() {
        return this._program.getOpened().map((i) => i.sourceFile.getFilePath());
    }

    setFileOpened(
        path: string,
        version: number | null,
        contents: string,
        ipythonMode = IPythonMode.None,
        chainedFilePath?: string,
        realFilePath?: string
    ) {
        // Open the file. Notebook cells are always tracked as they aren't 3rd party library files.
        // This is how it's worked in the past since each notebook used to have its own
        // workspace and the workspace include setting marked all cells as tracked.
        this._backgroundAnalysisProgram.setFileOpened(path, version, contents, {
            isTracked: this.isTracked(path) || ipythonMode !== IPythonMode.None,
            ipythonMode,
            chainedFilePath,
            realFilePath,
        });
        this._scheduleReanalysis(/* requireTrackedFileUpdate */ false);
    }

    getChainedFilePath(path: string): string | undefined {
        return this._backgroundAnalysisProgram.getChainedFilePath(path);
    }

    updateChainedFilePath(path: string, chainedFilePath: string | undefined) {
        this._backgroundAnalysisProgram.updateChainedFilePath(path, chainedFilePath);
        this._scheduleReanalysis(/* requireTrackedFileUpdate */ false);
    }

    updateOpenFileContents(
        path: string,
        version: number | null,
        contents: string,
        ipythonMode = IPythonMode.None,
        realFilePath?: string
    ) {
        this._backgroundAnalysisProgram.updateOpenFileContents(path, version, contents, {
            isTracked: this.isTracked(path),
            ipythonMode,
            chainedFilePath: undefined,
            realFilePath,
        });
        this._scheduleReanalysis(/* requireTrackedFileUpdate */ false);
    }

    setFileClosed(path: string, isTracked?: boolean) {
        this._backgroundAnalysisProgram.setFileClosed(path, isTracked);
        this._scheduleReanalysis(/* requireTrackedFileUpdate */ false);
    }

    addInterimFile(path: string) {
        this._backgroundAnalysisProgram.addInterimFile(path);
    }

    getParseResult(path: string) {
        return this._program.getParseResults(path);
    }

    getSourceFile(path: string) {
        return this._program.getBoundSourceFile(path);
    }

    getTextOnRange(filePath: string, range: Range, token: CancellationToken) {
        return this._program.getTextOnRange(filePath, range, token);
    }

    getEvaluator(): TypeEvaluator | undefined {
        return this._program.evaluator;
    }

    run<T>(callback: (p: ProgramView) => T, token: CancellationToken): T {
        return this._program.run(callback, token);
    }

    printStats() {
        this._console.info('');
        this._console.info('Analysis stats');

        const boundFileCount = this._program.getFileCount(/* userFileOnly */ false);
        this._console.info('Total files parsed and bound: ' + boundFileCount.toString());

        const checkedFileCount = this._program.getUserFileCount();
        this._console.info('Total files checked: ' + checkedFileCount.toString());
    }

    printDetailedAnalysisTimes() {
        this._program.printDetailedAnalysisTimes();
    }

    printDependencies(verbose: boolean) {
        this._program.printDependencies(this._executionRootPath, verbose);
    }

    analyzeFile(filePath: string, token: CancellationToken): Promise<boolean> {
        return this._backgroundAnalysisProgram.analyzeFile(filePath, token);
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
            this._scheduleReanalysis(/* requireTrackedFileUpdate */ false);
        }
    }

    test_getConfigOptions(commandLineOptions: CommandLineOptions): ConfigOptions {
        return this._getConfigOptions(this._backgroundAnalysisProgram.host, commandLineOptions);
    }

    test_getFileNamesFromFileSpecs(): string[] {
        return this._getFileNamesFromFileSpecs();
    }

    test_shouldHandleSourceFileWatchChanges(path: string, isFile: boolean) {
        return this._shouldHandleSourceFileWatchChanges(path, isFile);
    }

    test_shouldHandleLibraryFileWatchChanges(path: string, libSearchPaths: string[]) {
        return this._shouldHandleLibraryFileWatchChanges(path, libSearchPaths);
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

    invalidateAndForceReanalysis(reason: InvalidatedReason) {
        this._backgroundAnalysisProgram.invalidateAndForceReanalysis(reason);
    }

    // Forces the service to stop all analysis, discard all its caches,
    // and research for files.
    restart() {
        this._applyConfigOptions(this._hostFactory());

        this._backgroundAnalysisProgram.restart();
    }

    private get _console() {
        return this._options.console!;
    }

    private get _hostFactory() {
        return this._options.hostFactory!;
    }

    private get _importResolverFactory() {
        return this._options.importResolverFactory!;
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
        return !!this._commandLineOptions?.watchForLibraryChanges && !!this._options.libraryReanalysisTimeProvider;
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

    // Calculates the effective options based on the command-line options,
    // an optional config file, and default values.
    private _getConfigOptions(host: Host, commandLineOptions: CommandLineOptions): ConfigOptions {
        let projectRoot = realCasePath(commandLineOptions.executionRoot, this.fs);
        let configFilePath: string | undefined;
        let pyprojectFilePath: string | undefined;

        if (commandLineOptions.configFilePath) {
            // If the config file path was specified, determine whether it's
            // a directory (in which case the default config file name is assumed)
            // or a file.
            configFilePath = realCasePath(
                combinePaths(commandLineOptions.executionRoot, normalizePath(commandLineOptions.configFilePath)),
                this.fs
            );
            if (!this.fs.existsSync(configFilePath)) {
                this._console.info(`Configuration file not found at ${configFilePath}.`);
                configFilePath = realCasePath(commandLineOptions.executionRoot, this.fs);
            } else {
                if (configFilePath.toLowerCase().endsWith('.json')) {
                    projectRoot = realCasePath(getDirectoryPath(configFilePath), this.fs);
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
                this._console.log(`No configuration file found.`);
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
                this._console.log(`pyproject.toml file found at ${projectRoot}.`);
            } else {
                this._console.log(`No pyproject.toml file found.`);
            }
        }

        const configOptions = new ConfigOptions(projectRoot, this._typeCheckingMode);
        const defaultExcludes = ['**/node_modules', '**/__pycache__', '**/.*'];

        if (commandLineOptions.pythonPath) {
            this._console.info(
                `Setting pythonPath for service "${this._instanceName}": ` + `"${commandLineOptions.pythonPath}"`
            );
            (configOptions.pythonPath = commandLineOptions.pythonPath), this.fs;
        }

        if (commandLineOptions.pythonEnvironmentName) {
            this._console.info(
                `Setting environmentName for service "${this._instanceName}": ` +
                    `"${commandLineOptions.pythonEnvironmentName}"`
            );
            configOptions.pythonEnvironmentName = commandLineOptions.pythonEnvironmentName;
        }

        // The pythonPlatform and pythonVersion from the command-line can be overridden
        // by the config file, so initialize them upfront.
        configOptions.defaultPythonPlatform = commandLineOptions.pythonPlatform;
        configOptions.defaultPythonVersion = commandLineOptions.pythonVersion;
        configOptions.ensureDefaultExtraPaths(
            this.fs,
            commandLineOptions.autoSearchPaths ?? false,
            commandLineOptions.extraPaths
        );

        if (commandLineOptions.fileSpecs.length > 0) {
            commandLineOptions.fileSpecs.forEach((fileSpec) => {
                configOptions.include.push(getFileSpec(this.serviceProvider, projectRoot, fileSpec));
            });
        }

        if (commandLineOptions.excludeFileSpecs.length > 0) {
            commandLineOptions.excludeFileSpecs.forEach((fileSpec) => {
                configOptions.exclude.push(getFileSpec(this.serviceProvider, projectRoot, fileSpec));
            });
        }

        if (commandLineOptions.ignoreFileSpecs.length > 0) {
            commandLineOptions.ignoreFileSpecs.forEach((fileSpec) => {
                configOptions.ignore.push(getFileSpec(this.serviceProvider, projectRoot, fileSpec));
            });
        }

        if (!configFilePath && commandLineOptions.executionRoot) {
            if (commandLineOptions.fileSpecs.length === 0) {
                // If no config file was found and there are no explicit include
                // paths specified, assume the caller wants to include all source
                // files under the execution root path.
                configOptions.include.push(getFileSpec(this.serviceProvider, commandLineOptions.executionRoot, '.'));
            }

            if (commandLineOptions.excludeFileSpecs.length === 0) {
                // Add a few common excludes to avoid long scan times.
                defaultExcludes.forEach((exclude) => {
                    configOptions.exclude.push(
                        getFileSpec(this.serviceProvider, commandLineOptions.executionRoot, exclude)
                    );
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
                this.serviceProvider,
                host,
                commandLineOptions.diagnosticSeverityOverrides
            );

            const configFileDir = getDirectoryPath(this._configFilePath!);

            // If no include paths were provided, assume that all files within
            // the project should be included.
            if (configOptions.include.length === 0) {
                this._console.info(`No include entries specified; assuming ${configFileDir}`);
                configOptions.include.push(getFileSpec(this.serviceProvider, configFileDir, '.'));
            }

            // If there was no explicit set of excludes, add a few common ones to avoid long scan times.
            if (configOptions.exclude.length === 0) {
                defaultExcludes.forEach((exclude) => {
                    this._console.info(`Auto-excluding ${exclude}`);
                    configOptions.exclude.push(getFileSpec(this.serviceProvider, configFileDir, exclude));
                });

                if (configOptions.autoExcludeVenv === undefined) {
                    configOptions.autoExcludeVenv = true;
                }
            }
        } else {
            configOptions.autoExcludeVenv = true;
            configOptions.applyDiagnosticOverrides(commandLineOptions.diagnosticSeverityOverrides);
        }

        // Override the analyzeUnannotatedFunctions setting based on the command-line setting.
        if (commandLineOptions.analyzeUnannotatedFunctions !== undefined) {
            configOptions.diagnosticRuleSet.analyzeUnannotatedFunctions =
                commandLineOptions.analyzeUnannotatedFunctions;
        }

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
                configOptions.typeshedPath = realCasePath(commandLineOptions.typeshedPath, this.fs);
            } else {
                reportDuplicateSetting('typeshedPath', configOptions.typeshedPath);
            }
        }

        // If the caller specified that "typeshedPath" is the root of the project,
        // then we're presumably running in the typeshed project itself. Auto-exclude
        // stdlib packages that don't match the current Python version.
        if (
            configOptions.typeshedPath &&
            configOptions.typeshedPath === projectRoot &&
            configOptions.defaultPythonVersion !== undefined
        ) {
            const excludeList = this.getImportResolver().getTypeshedStdlibExcludeList(
                configOptions.typeshedPath,
                configOptions.defaultPythonVersion
            );

            this._console.info(`Excluding typeshed stdlib stubs according to VERSIONS file:`);
            excludeList.forEach((exclude) => {
                this._console.info(`    ${exclude}`);
                configOptions.exclude.push(
                    getFileSpec(this.serviceProvider, commandLineOptions.executionRoot, exclude)
                );
            });
        }

        configOptions.verboseOutput = commandLineOptions.verboseOutput ?? configOptions.verboseOutput;
        configOptions.checkOnlyOpenFiles = !!commandLineOptions.checkOnlyOpenFiles;
        configOptions.autoImportCompletions = !!commandLineOptions.autoImportCompletions;
        configOptions.indexing = !!commandLineOptions.indexing;
        configOptions.taskListTokens = commandLineOptions.taskListTokens;
        configOptions.logTypeEvaluationTime = !!commandLineOptions.logTypeEvaluationTime;
        configOptions.typeEvaluationTimeThreshold = commandLineOptions.typeEvaluationTimeThreshold;

        // If useLibraryCodeForTypes was not specified in the config, allow the settings
        // or command line to override it.
        if (configOptions.useLibraryCodeForTypes === undefined) {
            configOptions.useLibraryCodeForTypes = commandLineOptions.useLibraryCodeForTypes;
        } else if (commandLineOptions.useLibraryCodeForTypes !== undefined) {
            reportDuplicateSetting('useLibraryCodeForTypes', configOptions.useLibraryCodeForTypes);
        }

        // If useLibraryCodeForTypes is unspecified, default it to true.
        if (configOptions.useLibraryCodeForTypes === undefined) {
            configOptions.useLibraryCodeForTypes = true;
        }

        if (commandLineOptions.stubPath) {
            if (!configOptions.stubPath) {
                configOptions.stubPath = realCasePath(commandLineOptions.stubPath, this.fs);
            } else {
                reportDuplicateSetting('stubPath', configOptions.stubPath);
            }
        }

        if (configOptions.stubPath) {
            // If there was a stub path specified, validate it.
            if (!this.fs.existsSync(configOptions.stubPath) || !isDirectory(this.fs, configOptions.stubPath)) {
                this._console.warn(`stubPath ${configOptions.stubPath} is not a valid directory.`);
            }
        } else {
            // If no stub path was specified, use a default path.
            configOptions.stubPath = normalizePath(combinePaths(configOptions.projectRoot, defaultStubsDirectory));
        }

        // Do some sanity checks on the specified settings and report missing
        // or inconsistent information.
        if (configOptions.venvPath) {
            if (!this.fs.existsSync(configOptions.venvPath) || !isDirectory(this.fs, configOptions.venvPath)) {
                this._console.error(`venvPath ${configOptions.venvPath} is not a valid directory.`);
            }

            // venvPath without venv means it won't do anything while resolveImport.
            // so first, try to set venv from existing configOption if it is null. if both are null,
            // then, resolveImport won't consider venv
            configOptions.venv = configOptions.venv ?? this._configOptions.venv;
            if (configOptions.venv) {
                const fullVenvPath = combinePaths(configOptions.venvPath, configOptions.venv);

                if (!this.fs.existsSync(fullVenvPath) || !isDirectory(this.fs, fullVenvPath)) {
                    this._console.error(
                        `venv ${configOptions.venv} subdirectory not found in venv path ${configOptions.venvPath}.`
                    );
                } else {
                    const importFailureInfo: string[] = [];
                    if (findPythonSearchPaths(this.fs, configOptions, host, importFailureInfo) === undefined) {
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
            if (!this.fs.existsSync(configOptions.typeshedPath) || !isDirectory(this.fs, configOptions.typeshedPath)) {
                this._console.error(`typeshedPath ${configOptions.typeshedPath} is not a valid directory.`);
            }
        }

        return configOptions;
    }

    private _getTypeStubFolder() {
        const stubPath =
            this._configOptions.stubPath ??
            realCasePath(combinePaths(this._configOptions.projectRoot, defaultStubsDirectory), this.fs);

        if (!this._typeStubTargetPath || !this._typeStubTargetImportName) {
            const errMsg = `Import '${this._typeStubTargetImportName}'` + ` could not be resolved`;
            this._console.error(errMsg);
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
            if (!this.fs.existsSync(stubPath)) {
                this.fs.mkdirSync(stubPath);
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
            if (!this.fs.existsSync(typingsSubdirHierarchy)) {
                makeDirectories(this.fs, typingsSubdirHierarchy, stubPath);
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
            if (this.fs.existsSync(fileName)) {
                return realCasePath(fileName, this.fs);
            }
        }
        return undefined;
    }

    private _findPyprojectTomlFileHereOrUp(searchPath: string): string | undefined {
        return forEachAncestorDirectory(searchPath, (ancestor) => this._findPyprojectTomlFile(ancestor));
    }

    private _findPyprojectTomlFile(searchPath: string) {
        const fileName = combinePaths(searchPath, pyprojectTomlName);
        if (this.fs.existsSync(fileName)) {
            return realCasePath(fileName, this.fs);
        }
        return undefined;
    }

    private _parseJsonConfigFile(configPath: string): object | undefined {
        return this._attemptParseFile(configPath, (fileContents) => {
            const errors: JSONC.ParseError[] = [];
            const result = JSONC.parse(fileContents, errors, { allowTrailingComma: true });
            if (errors.length > 0) {
                throw new Error('Errors parsing JSON file');
            }

            return result;
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

            this._console.info(`Pyproject file "${pyprojectPath}" has no "[tool.pyright]" section.`);
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
                fileContents = this.fs.readFileSync(filePath, 'utf8');
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

        // Scan all matching files from file system.
        timingStats.findFilesTime.timeOperation(() => {
            const matchedFiles = this._matchFiles(this._configOptions.include, this._configOptions.exclude);

            for (const file of matchedFiles) {
                fileMap.set(file, file);
            }
        });

        // And scan all matching open files. We need to do this since some of files are not backed by
        // files in file system but only exist in memory (ex, virtual workspace)
        this._backgroundAnalysisProgram.program
            .getOpened()
            .map((o) => o.sourceFile.getFilePath())
            .filter((f) => matchFileSpecs(this._program.configOptions, f))
            .forEach((f) => fileMap.set(f, f));

        return Array.from(fileMap.values());
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
                const isFinalPathFile = isFile(this.fs, finalResolvedPath);
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

                if (isDirectory(this.fs, rootPackagePath)) {
                    this._typeStubTargetPath = rootPackagePath;
                } else if (isFile(this.fs, rootPackagePath)) {
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
                    const fileExtension = getFileExtension(implicitImport.path).toLowerCase();
                    if (supportedSourceFileExtensions.some((ext) => fileExtension === ext)) {
                        filesToImport.push(implicitImport.path);
                    }
                });

                this._backgroundAnalysisProgram.setAllowedThirdPartyImports([this._typeStubTargetImportName]);
                this._backgroundAnalysisProgram.setTrackedFiles(filesToImport);
            } else {
                this._console.error(`Import '${this._typeStubTargetImportName}' not found`);
            }
        } else if (!this._options.skipScanningUserFiles) {
            let fileList: string[] = [];
            this._console.log(`Searching for source files`);
            fileList = this._getFileNamesFromFileSpecs();

            // getFileNamesFromFileSpecs might have updated configOptions, resync options.
            this._backgroundAnalysisProgram.setConfigOptions(this._configOptions);
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

        const visitDirectoryUnchecked = (
            absolutePath: string,
            includeRegExp: RegExp,
            hasDirectoryWildcard: boolean
        ) => {
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
                if (envMarkers.some((f) => this.fs.existsSync(combinePaths(absolutePath, ...f)))) {
                    // Save auto exclude paths in the configOptions once we found them.
                    if (!FileSpec.isInPath(absolutePath, exclude)) {
                        exclude.push(
                            getFileSpec(this.serviceProvider, this._configOptions.projectRoot, `${absolutePath}/**`)
                        );
                    }

                    this._console.info(`Auto-excluding ${absolutePath}`);
                    return;
                }
            }

            const { files, directories } = getFileSystemEntries(this.fs, absolutePath);

            for (const file of files) {
                const filePath = combinePaths(absolutePath, file);

                if (FileSpec.matchIncludeFileSpec(includeRegExp, exclude, filePath)) {
                    results.push(filePath);
                }
            }

            for (const directory of directories) {
                const dirPath = combinePaths(absolutePath, directory);
                if (includeRegExp.test(dirPath) || hasDirectoryWildcard) {
                    if (!FileSpec.isInPath(dirPath, exclude)) {
                        visitDirectory(dirPath, includeRegExp, hasDirectoryWildcard);
                    }
                }
            }
        };

        const seenDirs = new Set<string>();
        const visitDirectory = (absolutePath: string, includeRegExp: RegExp, hasDirectoryWildcard: boolean) => {
            const realDirPath = tryRealpath(this.fs, absolutePath);
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
                visitDirectoryUnchecked(absolutePath, includeRegExp, hasDirectoryWildcard);
            } finally {
                seenDirs.delete(realDirPath);
            }
        };

        include.forEach((includeSpec) => {
            if (!FileSpec.isInPath(includeSpec.wildcardRoot, exclude)) {
                let foundFileSpec = false;

                const stat = tryStat(this.fs, includeSpec.wildcardRoot);
                if (stat?.isFile()) {
                    results.push(includeSpec.wildcardRoot);
                    foundFileSpec = true;
                } else if (stat?.isDirectory()) {
                    visitDirectory(includeSpec.wildcardRoot, includeSpec.regExp, includeSpec.hasDirectoryWildcard);
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
                this._sourceFileWatcher = this.fs.createFileSystemWatcher(fileList, (event, path) => {
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

                    // Make sure path is the true case.
                    path = realCasePath(path, this.fs);

                    const eventInfo = getEventInfo(this.fs, this._console, this._program, event, path);
                    if (!eventInfo) {
                        // no-op event, return.
                        return;
                    }

                    if (!this._shouldHandleSourceFileWatchChanges(path, eventInfo.isFile)) {
                        return;
                    }

                    // This is for performance optimization. If the change only pertains to the content of one file,
                    // then it can't affect the 'import resolution' result. All we need to do is reanalyze the related files
                    // (those that have a transitive dependency on this file).
                    if (eventInfo.isFile && eventInfo.event === 'change') {
                        this._backgroundAnalysisProgram.markFilesDirty([path], /* evenIfContentsAreSame */ false);
                        this._scheduleReanalysis(/* requireTrackedFileUpdate */ false);
                        return;
                    }

                    // When the file system structure changes, like when files are added or removed,
                    // this can affect how we resolve imports. This requires us to reset caches and reanalyze everything.
                    //
                    // However, we don't need to rebuild any indexes in this situation. Changes to workspace files don't affect library indices.
                    // As for user files, their indices don't contain import alias symbols, so adding or removing user files won't affect the existing indices.
                    // We only rebuild the indices for a user file when the symbols within the file are changed, like when a user edits the file.
                    // The index scanner will index any new files during its next background run.
                    this.invalidateAndForceReanalysis(InvalidatedReason.SourceWatcherChanged);
                    this._scheduleReanalysis(/* requireTrackedFileUpdate */ true);
                });
            } catch {
                this._console.error(`Exception caught when installing fs watcher for:\n ${fileList.join('\n')}`);
            }
        }

        function getEventInfo(
            fs: FileSystem,
            console: ConsoleInterface,
            program: Program,
            event: FileWatcherEventType,
            path: string
        ) {
            // Due to the way we implemented file watcher, we will only get 2 events; 'add' and 'change'.
            // Here, we will convert those 2 to 3 events. 'add', 'change' and 'unlink';
            const stats = tryStat(fs, path);
            if (event === 'add') {
                if (!stats) {
                    // If we are told that the path is added, but if we can't access it, then consider it as already deleted.
                    // there is nothing we need to do.
                    return undefined;
                }

                return { event, isFile: stats.isFile() };
            }

            if (event === 'change') {
                // If we got 'change', but can't access the path, then we consider it as delete.
                if (!stats) {
                    // See whether it is a file that got deleted.
                    const isFile = !!program.getSourceFile(path);

                    // If not, check whether it is a part of the workspace at all.
                    if (!isFile && !program.containsSourceFileIn(path)) {
                        // There is no source file under the given path. There is nothing we need to do.
                        return undefined;
                    }

                    return { event: 'unlink', isFile };
                }

                return { event, isFile: stats.isFile() };
            }

            // We have unknown event.
            console.warn(`Received unknown file change event: '${event}' for '${path}'`);
            return undefined;
        }
    }

    private _shouldHandleSourceFileWatchChanges(path: string, isFile: boolean) {
        if (isFile) {
            if (!hasPythonExtension(path) || isTemporaryFile(path)) {
                return false;
            }

            // Check whether the file change can affect semantics. If the file changed is not a user file or already a part of
            // the program (since we lazily load library files or extra path files when they are used), then the change can't
            // affect semantics. so just bail out.
            if (!this.isTracked(path) && !this._program.getSourceFileInfo(path)) {
                return false;
            }

            return true;
        }

        // The fs change is on a folder.
        if (!matchFileSpecs(this._program.configOptions, path, /* isFile */ false)) {
            // First, make sure the folder is included. By default, we exclude any folder whose name starts with '.'
            return false;
        }

        const parentPath = getDirectoryPath(path);
        const hasInit =
            parentPath.startsWith(this._configOptions.projectRoot) &&
            (this.fs.existsSync(combinePaths(parentPath, '__init__.py')) ||
                this.fs.existsSync(combinePaths(parentPath, '__init__.pyi')));

        // We don't have any file under the given path and its parent folder doesn't have __init__ then this folder change
        // doesn't have any meaning to us.
        if (!hasInit && !this._program.containsSourceFileIn(path)) {
            return false;
        }

        return true;

        function isTemporaryFile(path: string) {
            // Determine if this is an add or delete event related to a temporary
            // file. Some tools (like auto-formatters) create temporary files
            // alongside the original file and name them "x.py.<temp-id>.py" where
            // <temp-id> is a 32-character random string of hex digits. We don't
            // want these events to trigger a full reanalysis.
            const fileName = getFileName(path);
            const fileNameSplit = fileName.split('.');
            if (fileNameSplit.length === 4) {
                if (fileNameSplit[3] === fileNameSplit[1] && fileNameSplit[2].length === 32) {
                    return true;
                }
            }

            return false;
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
            this._librarySearchPathsToWatch = undefined;
            return;
        }

        // Watch the library paths for package install/uninstall.
        const importFailureInfo: string[] = [];
        this._librarySearchPathsToWatch = findPythonSearchPaths(
            this.fs,
            this._backgroundAnalysisProgram.configOptions,
            this._backgroundAnalysisProgram.host,
            importFailureInfo,
            /* includeWatchPathsOnly */ true,
            this._executionRootPath
        );

        const watchList = this._librarySearchPathsToWatch;
        if (watchList && watchList.length > 0) {
            try {
                if (this._verboseOutput) {
                    this._console.info(`Adding fs watcher for library directories:\n ${watchList.join('\n')}`);
                }
                const isIgnored = ignoredWatchEventFunction(watchList);
                this._libraryFileWatcher = this.fs.createFileSystemWatcher(watchList, (event, path) => {
                    if (!path) {
                        return;
                    }

                    if (this._verboseOutput) {
                        this._console.info(`LibraryFile: Received fs event '${event}' for path '${path}'`);
                    }

                    if (isIgnored(path)) {
                        return;
                    }

                    if (!this._shouldHandleLibraryFileWatchChanges(path, watchList)) {
                        return;
                    }

                    // If file doesn't exist, it is delete.
                    const isChange = event === 'change' && this.fs.existsSync(path);
                    this._scheduleLibraryAnalysis(isChange);
                });
            } catch {
                this._console.error(`Exception caught when installing fs watcher for:\n ${watchList.join('\n')}`);
            }
        }
    }

    private _shouldHandleLibraryFileWatchChanges(path: string, libSearchPaths: string[]) {
        if (this._program.getSourceFileInfo(path)) {
            return true;
        }

        // find the innermost matching search path
        let matchingSearchPath;
        const tempFile = this.serviceProvider.tryGet(ServiceKeys.tempFile);
        const ignoreCase = !isFileSystemCaseSensitive(this.fs, tempFile);
        for (const libSearchPath of libSearchPaths) {
            if (
                containsPath(libSearchPath, path, ignoreCase) &&
                (!matchingSearchPath || matchingSearchPath.length < libSearchPath.length)
            ) {
                matchingSearchPath = libSearchPath;
            }
        }

        if (!matchingSearchPath) {
            return true;
        }

        const parentComponents = getPathComponents(matchingSearchPath);
        const childComponents = getPathComponents(path);

        for (let i = parentComponents.length; i < childComponents.length; i++) {
            if (childComponents[i].startsWith('.')) {
                return false;
            }
        }

        return true;
    }

    private _clearLibraryReanalysisTimer() {
        if (this._libraryReanalysisTimer) {
            clearTimeout(this._libraryReanalysisTimer);
            this._libraryReanalysisTimer = undefined;
            this._backgroundAnalysisProgram?.libraryUpdated();
        }
    }

    private _scheduleLibraryAnalysis(isChange: boolean) {
        if (this._disposed) {
            // Already disposed.
            return;
        }

        this._clearLibraryReanalysisTimer();

        const backOffTimeInMS = this._options.libraryReanalysisTimeProvider?.();
        if (!backOffTimeInMS) {
            // We don't support library reanalysis.
            return;
        }

        // Add pending library files/folders changes.
        this._pendingLibraryChanges.changesOnly = this._pendingLibraryChanges.changesOnly && isChange;

        // Wait for a little while, since library changes
        // tend to happen in big batches when packages
        // are installed or uninstalled.
        this._libraryReanalysisTimer = setTimeout(() => {
            this._clearLibraryReanalysisTimer();

            // Invalidate import resolver, mark all files dirty unconditionally,
            // and reanalyze.
            this.invalidateAndForceReanalysis(
                this._pendingLibraryChanges.changesOnly
                    ? InvalidatedReason.LibraryWatcherContentOnlyChanged
                    : InvalidatedReason.LibraryWatcherChanged
            );
            this._scheduleReanalysis(/* requireTrackedFileUpdate */ false);

            // No more pending changes.
            this._pendingLibraryChanges.changesOnly = true;
        }, backOffTimeInMS);
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
            this._configFileWatcher = this.fs.createFileSystemWatcher([this._configFilePath], (event) => {
                if (this._verboseOutput) {
                    this._console.info(`Received fs event '${event}' for config file`);
                }
                this._scheduleReloadConfigFile();
            });
        } else if (this._executionRootPath) {
            this._configFileWatcher = this.fs.createFileSystemWatcher([this._executionRootPath], (event, path) => {
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
            this._serviceProvider,
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
        this._updateTrackedFileList(/* markFilesDirtyUnconditionally */ true);

        this._scheduleReanalysis(/* requireTrackedFileUpdate */ false);
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
                this._updateTrackedFileList(/* markFilesDirtyUnconditionally */ false);
            }

            // This creates a cancellation source only if it actually gets used.
            this._backgroundAnalysisCancellationSource = this.cancellationProvider.createCancellationTokenSource();
            const moreToAnalyze = this._backgroundAnalysisProgram.startAnalysis(
                this._backgroundAnalysisCancellationSource.token
            );
            if (moreToAnalyze) {
                this._scheduleReanalysis(/* requireTrackedFileUpdate */ false);
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
