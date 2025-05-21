/*
 * service.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * A service that is able to analyze a collection of
 * Python files.
 */

import * as JSONC from 'jsonc-parser';
import { AbstractCancellationTokenSource, CancellationToken } from 'vscode-languageserver';
import { parse } from '../common/tomlUtils';

import { IBackgroundAnalysis, RefreshOptions } from '../backgroundAnalysisBase';
import {
    CommandLineConfigOptions,
    CommandLineLanguageServerOptions,
    CommandLineOptions,
} from '../common/commandLineOptions';
import { ConfigOptions, matchFileSpecs } from '../common/configOptions';
import { ConsoleInterface, LogLevel, StandardConsole, log } from '../common/console';
import { isString } from '../common/core';
import { Diagnostic } from '../common/diagnostic';
import { FileEditAction } from '../common/editAction';
import { EditableProgram, ProgramView } from '../common/extensibility';
import { FileSystem } from '../common/fileSystem';
import { FileWatcher, FileWatcherEventType, ignoredWatchEventFunction } from '../common/fileWatcher';
import { Host, HostFactory, NoAccessHost } from '../common/host';
import { configFileName, defaultStubsDirectory } from '../common/pathConsts';
import { getFileName, isRootedDiskPath, normalizeSlashes } from '../common/pathUtils';
import { PythonVersion } from '../common/pythonVersion';
import { ServiceKeys } from '../common/serviceKeys';
import { ServiceProvider } from '../common/serviceProvider';
import { Range } from '../common/textRange';
import { timingStats } from '../common/timing';
import { Uri } from '../common/uri/uri';
import {
    FileSpec,
    deduplicateFolders,
    getFileSpec,
    getFileSystemEntries,
    hasPythonExtension,
    isDirectory,
    isFile,
    makeDirectories,
    tryRealpath,
    tryStat,
} from '../common/uri/uriUtils';
import { Localizer } from '../localization/localize';
import { AnalysisCompleteCallback } from './analysis';
import {
    BackgroundAnalysisProgram,
    BackgroundAnalysisProgramFactory,
    InvalidatedReason,
} from './backgroundAnalysisProgram';
import { ImportResolver, ImportResolverFactory, createImportedModuleDescriptor } from './importResolver';
import { MaxAnalysisTime, Program } from './program';
import { findPythonSearchPaths } from './pythonPathUtils';
import {
    findConfigFile,
    findConfigFileHereOrUp,
    findPyprojectTomlFile,
    findPyprojectTomlFileHereOrUp,
} from './serviceUtils';
import { IPythonMode } from './sourceFile';

// How long since the last user activity should we wait until running
// the analyzer on any files that have not yet been analyzed?
const _userActivityBackoffTimeInMs = 250;

const _gitDirectory = normalizeSlashes('/.git/');

export interface LibraryReanalysisTimeProvider {
    (): number;
    libraryReanalysisStarted?: () => void;
    libraryUpdated?: (cancelled: boolean) => void;
}

export interface AnalyzerServiceOptions {
    console?: ConsoleInterface;
    hostFactory?: HostFactory;
    importResolverFactory?: ImportResolverFactory;
    configOptions?: ConfigOptions;
    backgroundAnalysis?: IBackgroundAnalysis;
    maxAnalysisTime?: MaxAnalysisTime;
    backgroundAnalysisProgramFactory?: BackgroundAnalysisProgramFactory;
    libraryReanalysisTimeProvider?: LibraryReanalysisTimeProvider;
    serviceId?: string;
    skipScanningUserFiles?: boolean;
    fileSystem?: FileSystem;
    usingPullDiagnostics?: boolean;
    onInvalidated?: (reason: InvalidatedReason) => void;
}

interface ConfigFileContents {
    configFileDirUri: Uri;
    configFileJsonObj: object;
}

// Hold uniqueId for this service. It can be used to distinguish each service later.
let _nextServiceId = 1;

export function getNextServiceId(name: string) {
    return `${name}_${_nextServiceId++}`;
}

export class AnalyzerService {
    protected readonly options: AnalyzerServiceOptions;
    private readonly _backgroundAnalysisProgram: BackgroundAnalysisProgram;
    private readonly _serviceProvider: ServiceProvider;

    private _instanceName: string;
    private _executionRootUri: Uri;
    private _typeStubTargetUri: Uri | undefined;
    private _typeStubTargetIsSingleFile = false;
    private _sourceFileWatcher: FileWatcher | undefined;
    private _reloadConfigTimer: any;
    private _libraryReanalysisTimer: any;
    private _primaryConfigFileUri: Uri | undefined;
    private _extendedConfigFileUris: Uri[] = [];
    private _configFileWatcher: FileWatcher | undefined;
    private _libraryFileWatcher: FileWatcher | undefined;
    private _librarySearchUrisToWatch: Uri[] | undefined;
    private _onCompletionCallback: AnalysisCompleteCallback | undefined;
    private _commandLineOptions: CommandLineOptions | undefined;
    private _analyzeTimer: any;
    private _requireTrackedFileUpdate = true;
    private _lastUserInteractionTime = 0;
    private _backgroundAnalysisCancellationSource: AbstractCancellationTokenSource | undefined;

    private _disposed = false;
    private _pendingLibraryChanges: RefreshOptions = { changesOnly: true };

    constructor(instanceName: string, serviceProvider: ServiceProvider, options: AnalyzerServiceOptions) {
        this._instanceName = instanceName;

        this._executionRootUri = Uri.empty();
        this.options = options;

        this.options.serviceId = this.options.serviceId ?? getNextServiceId(instanceName);
        this.options.console = options.console || new StandardConsole();

        // Create local copy of the given service provider.
        this._serviceProvider = serviceProvider.clone();

        // Override the console and the file system if they were explicitly provided.
        if (this.options.console) {
            this._serviceProvider.add(ServiceKeys.console, this.options.console);
        }
        if (this.options.fileSystem) {
            this._serviceProvider.add(ServiceKeys.fs, this.options.fileSystem);
        }

        this.options.importResolverFactory = options.importResolverFactory ?? AnalyzerService.createImportResolver;
        this.options.hostFactory = options.hostFactory ?? (() => new NoAccessHost());

        this.options.configOptions =
            options.configOptions ?? new ConfigOptions(Uri.file(process.cwd(), this._serviceProvider));
        const importResolver = this.options.importResolverFactory(
            this._serviceProvider,
            this.options.configOptions,
            this.options.hostFactory()
        );

        this._backgroundAnalysisProgram =
            this.options.backgroundAnalysisProgramFactory !== undefined
                ? this.options.backgroundAnalysisProgramFactory(
                      this.options.serviceId,
                      this._serviceProvider,
                      this.options.configOptions,
                      importResolver,
                      this.options.backgroundAnalysis,
                      this.options.maxAnalysisTime
                  )
                : new BackgroundAnalysisProgram(
                      this.options.serviceId,
                      this._serviceProvider,
                      this.options.configOptions,
                      importResolver,
                      this.options.backgroundAnalysis,
                      this.options.maxAnalysisTime,
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
        return this.serviceProvider.cancellationProvider();
    }

    get librarySearchUrisToWatch() {
        return this._librarySearchUrisToWatch;
    }

    get backgroundAnalysisProgram(): BackgroundAnalysisProgram {
        return this._backgroundAnalysisProgram;
    }

    get test_program() {
        return this._program;
    }

    get id() {
        return this.options.serviceId!;
    }

    setServiceName(instanceName: string) {
        this._instanceName = instanceName;
    }

    clone(
        instanceName: string,
        serviceId: string,
        backgroundAnalysis?: IBackgroundAnalysis,
        fileSystem?: FileSystem
    ): AnalyzerService {
        const service = new AnalyzerService(instanceName, this._serviceProvider, {
            ...this.options,
            serviceId,
            backgroundAnalysis,
            skipScanningUserFiles: true,
            fileSystem,
            usingPullDiagnostics: this.options.usingPullDiagnostics,
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
                    fileInfo.uri,
                    version,
                    fileInfo.sourceFile.getOpenFileContents()!,
                    fileInfo.ipythonMode,
                    fileInfo.chainedSourceFile?.uri
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

        this._backgroundAnalysisProgram.setConfigOptions(configOptions);

        this._executionRootUri = configOptions.projectRoot;
        this.applyConfigOptions(host);
    }

    hasSourceFile(uri: Uri): boolean {
        return this.backgroundAnalysisProgram.hasSourceFile(uri);
    }

    isTracked(uri: Uri): boolean {
        return this._program.owns(uri);
    }

    getUserFiles() {
        return this._program.getUserFiles().map((i) => i.uri);
    }

    getOpenFiles() {
        return this._program.getOpened().map((i) => i.uri);
    }

    getOwnedFiles() {
        return this._program.getOwnedFiles().map((i) => i.uri);
    }

    setFileOpened(
        uri: Uri,
        version: number | null,
        contents: string,
        ipythonMode = IPythonMode.None,
        chainedFileUri?: Uri
    ) {
        // Open the file. Notebook cells are always tracked as they aren't 3rd party library files.
        // This is how it's worked in the past since each notebook used to have its own
        // workspace and the workspace include setting marked all cells as tracked.
        this._backgroundAnalysisProgram.setFileOpened(uri, version, contents, {
            isTracked: this.isTracked(uri) || ipythonMode !== IPythonMode.None,
            ipythonMode,
            chainedFileUri: chainedFileUri,
        });
        this.scheduleReanalysis(/* requireTrackedFileUpdate */ false);
    }

    getChainedUri(uri: Uri): Uri | undefined {
        return this._backgroundAnalysisProgram.getChainedUri(uri);
    }

    updateChainedUri(uri: Uri, chainedFileUri: Uri | undefined) {
        this._backgroundAnalysisProgram.updateChainedUri(uri, chainedFileUri);
        this.scheduleReanalysis(/* requireTrackedFileUpdate */ false);
    }

    updateOpenFileContents(uri: Uri, version: number | null, contents: string, ipythonMode = IPythonMode.None) {
        this._backgroundAnalysisProgram.updateOpenFileContents(uri, version, contents, {
            isTracked: this.isTracked(uri),
            ipythonMode,
            chainedFileUri: undefined,
        });
        this.scheduleReanalysis(/* requireTrackedFileUpdate */ false);
    }

    setFileClosed(uri: Uri, isTracked?: boolean) {
        this._backgroundAnalysisProgram.setFileClosed(uri, isTracked);
        this.scheduleReanalysis(/* requireTrackedFileUpdate */ false);
    }

    addInterimFile(uri: Uri) {
        this._backgroundAnalysisProgram.addInterimFile(uri);
    }

    getParserOutput(uri: Uri) {
        return this._program.getParserOutput(uri);
    }

    getParseResults(uri: Uri) {
        return this._program.getParseResults(uri);
    }

    getSourceFile(uri: Uri) {
        return this._program.getBoundSourceFile(uri);
    }

    getTextOnRange(fileUri: Uri, range: Range, token: CancellationToken) {
        return this._program.getTextOnRange(fileUri, range, token);
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
        this._program.printDependencies(this._executionRootUri, verbose);
    }

    analyzeFile(fileUri: Uri, token: CancellationToken): Promise<boolean> {
        return this._backgroundAnalysisProgram.analyzeFile(fileUri, token);
    }

    analyzeFileAndGetDiagnostics(fileUri: Uri, token: CancellationToken): Promise<Diagnostic[]> {
        return this._backgroundAnalysisProgram.analyzeFileAndGetDiagnostics(fileUri, token);
    }

    getDiagnosticsForRange(fileUri: Uri, range: Range, token: CancellationToken): Promise<Diagnostic[]> {
        return this._backgroundAnalysisProgram.getDiagnosticsForRange(fileUri, range, token);
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
            this.scheduleReanalysis(/* requireTrackedFileUpdate */ false);
        }
    }

    test_getConfigOptions(commandLineOptions: CommandLineOptions): ConfigOptions {
        return this._getConfigOptions(this._backgroundAnalysisProgram.host, commandLineOptions);
    }

    test_getFileNamesFromFileSpecs(): Uri[] {
        return this._getFileNamesFromFileSpecs();
    }

    test_shouldHandleSourceFileWatchChanges(uri: Uri, isFile: boolean) {
        return this._shouldHandleSourceFileWatchChanges(uri, isFile);
    }

    test_shouldHandleLibraryFileWatchChanges(uri: Uri, libSearchUris: Uri[]) {
        return this._shouldHandleLibraryFileWatchChanges(uri, libSearchUris);
    }

    writeTypeStub(token: CancellationToken): void {
        const typingsSubdirUri = this._getTypeStubFolder();

        this._program.writeTypeStub(
            this._typeStubTargetUri ?? Uri.empty(),
            this._typeStubTargetIsSingleFile,
            typingsSubdirUri,
            token
        );
    }

    writeTypeStubInBackground(token: CancellationToken): Promise<any> {
        const typingsSubdirUri = this._getTypeStubFolder();

        return this._backgroundAnalysisProgram.writeTypeStub(
            this._typeStubTargetUri ?? Uri.empty(),
            this._typeStubTargetIsSingleFile,
            typingsSubdirUri,
            token
        );
    }

    invalidateAndForceReanalysis(reason: InvalidatedReason) {
        if (this.options.onInvalidated) {
            this.options.onInvalidated(reason);
        }

        this._backgroundAnalysisProgram.invalidateAndForceReanalysis(reason);
    }

    // Forces the service to stop all analysis, discard all its caches,
    // and research for files.
    restart() {
        this.applyConfigOptions(this._hostFactory());

        this._backgroundAnalysisProgram.restart();
    }

    protected runAnalysis(token: CancellationToken) {
        // In pull diagnostics mode, the service doesn't perform analysis on its own.
        // Instead the client deliberately asks for diagnostics on a file-by-file basis.
        if (!this.options.usingPullDiagnostics) {
            const moreToAnalyze = this._backgroundAnalysisProgram.startAnalysis(token);
            if (moreToAnalyze) {
                this.scheduleReanalysis(/* requireTrackedFileUpdate */ false);
            }
        }
    }

    protected scheduleReanalysis(requireTrackedFileUpdate: boolean) {
        if (this._disposed || !this._commandLineOptions?.languageServerSettings.enableAmbientAnalysis) {
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
        const minTimeBetweenAnalysisPassesInMs = 5;

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

            // Recreate the cancellation token every time we start analysis.
            this._backgroundAnalysisCancellationSource = this.cancellationProvider.createCancellationTokenSource();

            // Now that the timer has fired, actually send the message to the BG thread to
            // start the analysis.
            this.runAnalysis(this._backgroundAnalysisCancellationSource.token);
        }, timeUntilNextAnalysisInMs);
    }

    protected applyConfigOptions(host: Host) {
        // Indicate that we are about to reanalyze because of this config change.
        if (this.options.onInvalidated) {
            this.options.onInvalidated(InvalidatedReason.Reanalyzed);
        }
        // Allocate a new import resolver because the old one has information
        // cached based on the previous config options.
        const importResolver = this._importResolverFactory(
            this._serviceProvider,
            this._backgroundAnalysisProgram.configOptions,
            host
        );

        this._backgroundAnalysisProgram.setImportResolver(importResolver);

        if (this._commandLineOptions?.fromLanguageServer || this._configOptions.verboseOutput) {
            const logLevel = this._configOptions.verboseOutput ? LogLevel.Info : LogLevel.Log;

            const execEnvs = this._configOptions.getExecutionEnvironments();

            for (const execEnv of execEnvs) {
                log(this._console, logLevel, `Execution environment: ${execEnv.name}`);
                log(this._console, logLevel, `  Extra paths:`);
                if (execEnv.extraPaths.length > 0) {
                    execEnv.extraPaths.forEach((path) => {
                        log(this._console, logLevel, `    ${path.toUserVisibleString()}`);
                    });
                } else {
                    log(this._console, logLevel, `    (none)`);
                }
                log(this._console, logLevel, `  Python version: ${PythonVersion.toString(execEnv.pythonVersion)}`);
                log(this._console, logLevel, `  Python platform: ${execEnv.pythonPlatform ?? 'All'}`);
                log(this._console, logLevel, `  Search paths:`);
                const roots = importResolver.getImportRoots(execEnv, /* forLogging */ true);
                roots.forEach((path) => {
                    log(this._console, logLevel, `    ${path.toUserVisibleString()}`);
                });
            }
        }

        this._updateLibraryFileWatcher();
        this._updateConfigFileWatcher();
        this._updateSourceFileWatchers();
        this._updateTrackedFileList(/* markFilesDirtyUnconditionally */ true);

        this.scheduleReanalysis(/* requireTrackedFileUpdate */ false);
    }

    private get _console() {
        return this.options.console!;
    }

    private get _hostFactory() {
        return this.options.hostFactory!;
    }

    private get _importResolverFactory() {
        return this.options.importResolverFactory!;
    }

    private get _program() {
        return this._backgroundAnalysisProgram.program;
    }

    private get _configOptions() {
        return this._backgroundAnalysisProgram.configOptions;
    }

    private get _watchForSourceChanges() {
        return !!this._commandLineOptions?.languageServerSettings.watchForSourceChanges;
    }

    private get _watchForLibraryChanges() {
        return (
            !!this._commandLineOptions?.languageServerSettings.watchForLibraryChanges &&
            !!this.options.libraryReanalysisTimeProvider
        );
    }

    private get _watchForConfigChanges() {
        return !!this._commandLineOptions?.languageServerSettings.watchForConfigChanges;
    }

    private get _typeCheckingMode() {
        return this._commandLineOptions?.configSettings.typeCheckingMode;
    }

    private get _verboseOutput(): boolean {
        return !!this._configOptions.verboseOutput;
    }

    private get _typeStubTargetImportName() {
        return this._commandLineOptions?.languageServerSettings.typeStubTargetImportName;
    }

    // Calculates the effective options based on the command-line options,
    // an optional config file, and default values.
    private _getConfigOptions(host: Host, commandLineOptions: CommandLineOptions): ConfigOptions {
        const optionRoot = commandLineOptions.executionRoot;
        const executionRootUri = Uri.is(optionRoot)
            ? optionRoot
            : isString(optionRoot) && optionRoot.length > 0
            ? Uri.file(optionRoot, this.serviceProvider, /* checkRelative */ true)
            : Uri.defaultWorkspace(this.serviceProvider);

        const executionRoot = this.fs.realCasePath(executionRootUri);
        let projectRoot = executionRoot;
        let configFilePath: Uri | undefined;
        let pyprojectFilePath: Uri | undefined;

        if (commandLineOptions.configFilePath) {
            // If the config file path was specified, determine whether it's
            // a directory (in which case the default config file name is assumed)
            // or a file.
            configFilePath = this.fs.realCasePath(
                isRootedDiskPath(commandLineOptions.configFilePath)
                    ? Uri.file(commandLineOptions.configFilePath, this.serviceProvider, /* checkRelative */ true)
                    : projectRoot.resolvePaths(commandLineOptions.configFilePath)
            );

            if (!this.fs.existsSync(configFilePath)) {
                this._console.info(`Configuration file not found at ${configFilePath.toUserVisibleString()}.`);
                configFilePath = projectRoot;
            } else {
                if (configFilePath.lastExtension.endsWith('.json') || configFilePath.lastExtension.endsWith('.toml')) {
                    projectRoot = configFilePath.getDirectory();
                } else {
                    projectRoot = configFilePath;
                    configFilePath = findConfigFile(this.fs, configFilePath);
                    if (!configFilePath) {
                        this._console.info(`Configuration file not found at ${projectRoot.toUserVisibleString()}.`);
                    }
                }
            }
        } else if (commandLineOptions.executionRoot) {
            // In a project-based IDE like VS Code, we should assume that the
            // project root directory contains the config file.
            configFilePath = findConfigFile(this.fs, projectRoot);

            // If pyright is being executed from the command line, the working
            // directory may be deep within a project, and we need to walk up the
            // directory hierarchy to find the project root.
            if (!configFilePath && !commandLineOptions.fromLanguageServer) {
                configFilePath = findConfigFileHereOrUp(this.fs, projectRoot);
            }

            if (configFilePath) {
                projectRoot = configFilePath.getDirectory();
            } else {
                this._console.log(`No configuration file found.`);
                configFilePath = undefined;
            }
        }

        if (!configFilePath) {
            // See if we can find a pyproject.toml file in this directory.
            pyprojectFilePath = findPyprojectTomlFile(this.fs, projectRoot);

            if (!pyprojectFilePath && !commandLineOptions.fromLanguageServer) {
                pyprojectFilePath = findPyprojectTomlFileHereOrUp(this.fs, projectRoot);
            }

            if (pyprojectFilePath) {
                projectRoot = pyprojectFilePath.getDirectory();
                this._console.log(`pyproject.toml file found at ${projectRoot.toUserVisibleString()}.`);
            } else {
                this._console.log(`No pyproject.toml file found.`);
            }
        }

        const configOptions = new ConfigOptions(projectRoot);

        // If we found a config file, load it and apply its settings.
        const configs = this._getExtendedConfigurations(configFilePath ?? pyprojectFilePath);
        if (configs && configs.length > 0) {
            // With a pyrightconfig.json set, we want the typeCheckingMode to always be standard
            // as that's what the Pyright CLI will expect. Command line options (if not a language server) and
            // the config file can override this.
            configOptions.initializeTypeCheckingMode('standard');

            // Then we apply the config file settings. This can update the
            // the typeCheckingMode.
            for (const config of configs) {
                configOptions.initializeFromJson(
                    config.configFileJsonObj,
                    config.configFileDirUri,
                    this.serviceProvider,
                    host
                );
            }

            // Set the configFileSource since we have a config file.
            configOptions.configFileSource = configFilePath ?? pyprojectFilePath;

            // When not in language server mode, command line options override config file options.
            if (!commandLineOptions.fromLanguageServer) {
                this._applyCommandLineOverrides(configOptions, commandLineOptions.configSettings, projectRoot, false);
            }
        } else {
            // Initialize the type checking mode based on if this is for a language server or not. Language
            // servers default to 'off' when no config file is found.
            configOptions.initializeTypeCheckingMode(commandLineOptions.fromLanguageServer ? 'off' : 'standard');

            // If there are no config files, we can then directly apply the command line options.
            this._applyCommandLineOverrides(
                configOptions,
                commandLineOptions.configSettings,
                projectRoot,
                commandLineOptions.fromLanguageServer
            );
        }

        // Apply the command line options that are not in the config file. These settings
        // only apply to the language server.
        this._applyLanguageServerOptions(configOptions, projectRoot, commandLineOptions.languageServerSettings);

        // Ensure that if no command line or config options were applied, we have some defaults.
        this._ensureDefaultOptions(host, configOptions, projectRoot, executionRoot, commandLineOptions);

        // Once we have defaults, we can then setup the execution environments. Execution environments
        // inherit from the defaults.
        if (configs) {
            for (const config of configs) {
                configOptions.setupExecutionEnvironments(
                    config.configFileJsonObj,
                    config.configFileDirUri,
                    this.serviceProvider.console()
                );
            }
        }

        return configOptions;
    }

    private _ensureDefaultOptions(
        host: Host,
        configOptions: ConfigOptions,
        projectRoot: Uri,
        executionRoot: Uri,
        commandLineOptions: CommandLineOptions
    ) {
        const defaultExcludes = ['**/node_modules', '**/__pycache__', '**/.*'];

        // If no include paths were provided, assume that all files within
        // the project should be included.
        if (configOptions.include.length === 0) {
            this._console.info(`No include entries specified; assuming ${projectRoot.toUserVisibleString()}`);
            configOptions.include.push(getFileSpec(projectRoot, '.'));
        }

        // If there was no explicit set of excludes, add a few common ones to
        // avoid long scan times.
        if (configOptions.exclude.length === 0) {
            defaultExcludes.forEach((exclude) => {
                this._console.info(`Auto-excluding ${exclude}`);
                configOptions.exclude.push(getFileSpec(projectRoot, exclude));
            });

            if (configOptions.autoExcludeVenv === undefined) {
                configOptions.autoExcludeVenv = true;
            }
        }

        if (!configOptions.defaultExtraPaths) {
            configOptions.ensureDefaultExtraPaths(
                this.fs,
                commandLineOptions.configSettings.autoSearchPaths ?? false,
                commandLineOptions.configSettings.extraPaths
            );
        }

        if (configOptions.defaultPythonPlatform === undefined) {
            configOptions.defaultPythonPlatform = commandLineOptions.configSettings.pythonPlatform;
        }
        if (configOptions.defaultPythonVersion === undefined) {
            configOptions.defaultPythonVersion = commandLineOptions.configSettings.pythonVersion;
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
                configOptions.defaultPythonVersion,
                configOptions.defaultPythonPlatform
            );

            this._console.info(`Excluding typeshed stdlib stubs according to VERSIONS file:`);
            excludeList.forEach((exclude) => {
                this._console.info(`    ${exclude}`);
                configOptions.exclude.push(getFileSpec(executionRoot, exclude.getFilePath()));
            });
        }

        // If useLibraryCodeForTypes is unspecified, default it to true.
        if (configOptions.useLibraryCodeForTypes === undefined) {
            configOptions.useLibraryCodeForTypes = true;
        }
        if (configOptions.stubPath) {
            // If there was a stub path specified, validate it.
            if (!this.fs.existsSync(configOptions.stubPath) || !isDirectory(this.fs, configOptions.stubPath)) {
                this._console.warn(`stubPath ${configOptions.stubPath} is not a valid directory.`);
            }
        } else {
            // If no stub path was specified, use a default path.
            configOptions.stubPath = configOptions.projectRoot.resolvePaths(defaultStubsDirectory);
        }

        // Do some sanity checks on the specified settings and report missing
        // or inconsistent information.
        if (configOptions.venvPath) {
            if (!this.fs.existsSync(configOptions.venvPath) || !isDirectory(this.fs, configOptions.venvPath)) {
                this._console.error(
                    `venvPath ${configOptions.venvPath.toUserVisibleString()} is not a valid directory.`
                );
            }

            // venvPath without venv means it won't do anything while resolveImport.
            // so first, try to set venv from existing configOption if it is null. if both are null,
            // then, resolveImport won't consider venv
            configOptions.venv = configOptions.venv ?? this._configOptions.venv;
            if (configOptions.venv && configOptions.venvPath) {
                const fullVenvPath = configOptions.venvPath.resolvePaths(configOptions.venv);

                if (!this.fs.existsSync(fullVenvPath) || !isDirectory(this.fs, fullVenvPath)) {
                    this._console.error(
                        `venv ${
                            configOptions.venv
                        } subdirectory not found in venv path ${configOptions.venvPath.toUserVisibleString()}.`
                    );
                } else {
                    const importFailureInfo: string[] = [];
                    if (findPythonSearchPaths(this.fs, configOptions, host, importFailureInfo) === undefined) {
                        this._console.error(
                            `site-packages directory cannot be located for venvPath ` +
                                `${configOptions.venvPath.toUserVisibleString()} and venv ${configOptions.venv}.`
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
                this._console.error(
                    `typeshedPath ${configOptions.typeshedPath.toUserVisibleString()} is not a valid directory.`
                );
            }
        }

        // This is a special case. It can be set in the config file, but if it's set on the command line, we should always
        // override it.
        if (commandLineOptions.configSettings.verboseOutput !== undefined) {
            configOptions.verboseOutput = commandLineOptions.configSettings.verboseOutput;
        }

        // Ensure default python version and platform.
        configOptions.ensureDefaultPythonVersion(host, this._console);
        configOptions.ensureDefaultPythonPlatform(host, this._console);
    }

    private _applyLanguageServerOptions(
        configOptions: ConfigOptions,
        projectRoot: Uri,
        languageServerOptions: CommandLineLanguageServerOptions
    ) {
        configOptions.disableTaggedHints = !!languageServerOptions.disableTaggedHints;
        if (languageServerOptions.checkOnlyOpenFiles !== undefined) {
            configOptions.checkOnlyOpenFiles = languageServerOptions.checkOnlyOpenFiles;
        }
        if (languageServerOptions.autoImportCompletions !== undefined) {
            configOptions.autoImportCompletions = languageServerOptions.autoImportCompletions;
        }
        if (languageServerOptions.indexing !== undefined) {
            configOptions.indexing = languageServerOptions.indexing;
        }
        if (languageServerOptions.taskListTokens) {
            configOptions.taskListTokens = languageServerOptions.taskListTokens;
        }
        if (languageServerOptions.logTypeEvaluationTime !== undefined) {
            configOptions.logTypeEvaluationTime = languageServerOptions.logTypeEvaluationTime;
        }
        configOptions.typeEvaluationTimeThreshold = languageServerOptions.typeEvaluationTimeThreshold;

        // Special case, the language service can also set a pythonPath. It should override any other setting.
        if (languageServerOptions.pythonPath) {
            this._console.info(
                `Setting pythonPath for service "${this._instanceName}": ` + `"${languageServerOptions.pythonPath}"`
            );
            configOptions.pythonPath = this.fs.realCasePath(
                Uri.file(languageServerOptions.pythonPath, this.serviceProvider, /* checkRelative */ true)
            );
        }
        if (languageServerOptions.venvPath) {
            if (!configOptions.venvPath) {
                configOptions.venvPath = projectRoot.resolvePaths(languageServerOptions.venvPath);
            }
        }
    }

    private _applyCommandLineOverrides(
        configOptions: ConfigOptions,
        commandLineOptions: CommandLineConfigOptions,
        projectRoot: Uri,
        fromLanguageServer: boolean
    ) {
        if (commandLineOptions.typeCheckingMode) {
            configOptions.initializeTypeCheckingMode(commandLineOptions.typeCheckingMode);
        }

        if (commandLineOptions.extraPaths) {
            configOptions.ensureDefaultExtraPaths(
                this.fs,
                commandLineOptions.autoSearchPaths ?? false,
                commandLineOptions.extraPaths
            );
        }

        if (commandLineOptions.pythonVersion || commandLineOptions.pythonPlatform) {
            configOptions.defaultPythonVersion = commandLineOptions.pythonVersion ?? configOptions.defaultPythonVersion;
            configOptions.defaultPythonPlatform =
                commandLineOptions.pythonPlatform ?? configOptions.defaultPythonPlatform;
        }

        if (commandLineOptions.pythonPath) {
            this._console.info(
                `Setting pythonPath for service "${this._instanceName}": ` + `"${commandLineOptions.pythonPath}"`
            );
            configOptions.pythonPath = this.fs.realCasePath(
                Uri.file(commandLineOptions.pythonPath, this.serviceProvider, /* checkRelative */ true)
            );
        }

        if (commandLineOptions.pythonEnvironmentName) {
            this._console.info(
                `Setting environmentName for service "${this._instanceName}": ` +
                    `"${commandLineOptions.pythonEnvironmentName}"`
            );
            configOptions.pythonEnvironmentName = commandLineOptions.pythonEnvironmentName;
        }

        commandLineOptions.includeFileSpecs.forEach((fileSpec) => {
            configOptions.include.push(getFileSpec(projectRoot, fileSpec));
        });

        commandLineOptions.excludeFileSpecs.forEach((fileSpec) => {
            configOptions.exclude.push(getFileSpec(projectRoot, fileSpec));
        });

        commandLineOptions.ignoreFileSpecs.forEach((fileSpec) => {
            configOptions.ignore.push(getFileSpec(projectRoot, fileSpec));
        });

        configOptions.applyDiagnosticOverrides(commandLineOptions.diagnosticSeverityOverrides);
        configOptions.applyDiagnosticOverrides(commandLineOptions.diagnosticBooleanOverrides);

        // Override the analyzeUnannotatedFunctions setting based on the command-line setting.
        if (commandLineOptions.analyzeUnannotatedFunctions !== undefined) {
            configOptions.diagnosticRuleSet.analyzeUnannotatedFunctions =
                commandLineOptions.analyzeUnannotatedFunctions;
        }

        // Override the include based on command-line settings.
        if (commandLineOptions.includeFileSpecsOverride) {
            configOptions.include = [];
            commandLineOptions.includeFileSpecsOverride.forEach((include) => {
                configOptions.include.push(
                    getFileSpec(Uri.file(include, this.serviceProvider, /* checkRelative */ true), '.')
                );
            });
        }

        // Override the venvPath based on the command-line setting.
        if (commandLineOptions.venvPath) {
            configOptions.venvPath = projectRoot.resolvePaths(commandLineOptions.venvPath);
        }

        const reportDuplicateSetting = (settingName: string, configValue: number | string | boolean) => {
            const settingSource = fromLanguageServer ? 'the client settings' : 'a command-line option';
            this._console.warn(
                `The ${settingName} has been specified in both the config file and ` +
                    `${settingSource}. The value in the config file (${configValue}) ` +
                    `will take precedence`
            );
        };

        // Apply the command-line options if the corresponding
        // item wasn't already set in the config file. Report any
        // duplicates.

        if (commandLineOptions.typeshedPath) {
            if (!configOptions.typeshedPath) {
                configOptions.typeshedPath = projectRoot.resolvePaths(commandLineOptions.typeshedPath);
            } else {
                reportDuplicateSetting('typeshedPath', configOptions.typeshedPath.toUserVisibleString());
            }
        }

        // If useLibraryCodeForTypes was not specified in the config, allow the command line to override it.
        if (configOptions.useLibraryCodeForTypes === undefined) {
            configOptions.useLibraryCodeForTypes = commandLineOptions.useLibraryCodeForTypes;
        } else if (commandLineOptions.useLibraryCodeForTypes !== undefined) {
            reportDuplicateSetting('useLibraryCodeForTypes', configOptions.useLibraryCodeForTypes);
        }

        if (commandLineOptions.stubPath) {
            if (!configOptions.stubPath) {
                configOptions.stubPath = this.fs.realCasePath(projectRoot.resolvePaths(commandLineOptions.stubPath));
            } else {
                reportDuplicateSetting('stubPath', configOptions.stubPath.toUserVisibleString());
            }
        }
    }

    // Loads the config JSON object from the specified config file along with any
    // chained config files specified in the "extends" property (recursively).
    private _getExtendedConfigurations(primaryConfigFileUri: Uri | undefined): ConfigFileContents[] | undefined {
        this._primaryConfigFileUri = primaryConfigFileUri;
        this._extendedConfigFileUris = [];

        if (!primaryConfigFileUri) {
            return undefined;
        }

        let curConfigFileUri = primaryConfigFileUri;

        const configJsonObjs: ConfigFileContents[] = [];

        while (true) {
            this._extendedConfigFileUris.push(curConfigFileUri);

            let configFileJsonObj: object | undefined;

            // Is this a TOML or JSON file?
            if (curConfigFileUri.lastExtension.endsWith('.toml')) {
                this._console.info(`Loading pyproject.toml file at ${curConfigFileUri.toUserVisibleString()}`);
                configFileJsonObj = this._parsePyprojectTomlFile(curConfigFileUri);
            } else {
                this._console.info(`Loading configuration file at ${curConfigFileUri.toUserVisibleString()}`);
                configFileJsonObj = this._parseJsonConfigFile(curConfigFileUri);
            }

            if (!configFileJsonObj) {
                break;
            }

            // Push onto the start of the array so base configs are processed first.
            configJsonObjs.unshift({ configFileJsonObj, configFileDirUri: curConfigFileUri.getDirectory() });

            const baseConfigUri = ConfigOptions.resolveExtends(configFileJsonObj, curConfigFileUri.getDirectory());
            if (!baseConfigUri) {
                break;
            }

            // Check for circular references.
            if (this._extendedConfigFileUris.some((uri) => uri.equals(baseConfigUri))) {
                this._console.error(
                    `Circular reference in configuration file "extends" setting: ${curConfigFileUri.toUserVisibleString()} ` +
                        `extends ${baseConfigUri.toUserVisibleString()}`
                );
                break;
            }

            curConfigFileUri = baseConfigUri;
        }

        return configJsonObjs;
    }

    private _getTypeStubFolder() {
        const stubPath =
            this._configOptions.stubPath ??
            this.fs.realCasePath(this._configOptions.projectRoot.resolvePaths(defaultStubsDirectory));

        if (!this._typeStubTargetUri || !this._typeStubTargetImportName) {
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
            const errMsg = `Could not create typings directory '${stubPath.toUserVisibleString()}'`;
            this._console.error(errMsg);
            throw new Error(errMsg);
        }

        // Generate a typings subdirectory hierarchy.
        const typingsSubdirPath = stubPath.resolvePaths(typeStubInputTargetParts[0]);
        const typingsSubdirHierarchy = stubPath.resolvePaths(...typeStubInputTargetParts);

        try {
            // Generate a new typings subdirectory if necessary.
            if (!this.fs.existsSync(typingsSubdirHierarchy)) {
                makeDirectories(this.fs, typingsSubdirHierarchy, stubPath);
            }
        } catch (e: any) {
            const errMsg = `Could not create typings subdirectory '${typingsSubdirHierarchy.toUserVisibleString()}'`;
            this._console.error(errMsg);
            throw new Error(errMsg);
        }

        return typingsSubdirPath;
    }

    private _parseJsonConfigFile(configPath: Uri): object | undefined {
        return this._attemptParseFile(configPath, (fileContents) => {
            const errors: JSONC.ParseError[] = [];
            const result = JSONC.parse(fileContents, errors, { allowTrailingComma: true });
            if (errors.length > 0) {
                throw new Error('Errors parsing JSON file');
            }

            return result;
        });
    }

    private _parsePyprojectTomlFile(pyprojectPath: Uri): object | undefined {
        return this._attemptParseFile(pyprojectPath, (fileContents, attemptCount) => {
            try {
                const configObj = parse(fileContents);
                if (configObj && 'tool' in configObj) {
                    return (configObj.tool as Record<string, object>).pyright as object;
                }
            } catch (e: any) {
                this._console.error(`Pyproject file parse attempt ${attemptCount} error: ${JSON.stringify(e)}`);
                throw e;
            }

            this._console.info(
                `Pyproject file "${pyprojectPath.toUserVisibleString()}" has no "[tool.pyright]" section.`
            );
            return undefined;
        });
    }

    private _attemptParseFile(
        fileUri: Uri,
        parseCallback: (contents: string, attempt: number) => object | undefined
    ): object | undefined {
        let fileContents = '';
        let parseAttemptCount = 0;

        while (true) {
            // Attempt to read the file contents.
            try {
                fileContents = this.fs.readFileSync(fileUri, 'utf8');
            } catch {
                this._console.error(`Config file "${fileUri.toUserVisibleString()}" could not be read.`);
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
                this._console.error(
                    `Config file "${fileUri.toUserVisibleString()}" could not be parsed. Verify that format is correct.`
                );
                this._reportConfigParseError();
                return undefined;
            }
        }

        return undefined;
    }

    private _getFileNamesFromFileSpecs(): Uri[] {
        // Use a map to generate a list of unique files.
        const fileMap = new Map<string, Uri>();

        // Scan all matching files from file system.
        timingStats.findFilesTime.timeOperation(() => {
            const matchedFiles = this._matchFiles(this._configOptions.include, this._configOptions.exclude);

            for (const file of matchedFiles) {
                fileMap.set(file.key, file);
            }
        });

        // And scan all matching open files. We need to do this since some of files are not backed by
        // files in file system but only exist in memory (ex, virtual workspace)
        this._backgroundAnalysisProgram.program
            .getOpened()
            .map((o) => o.uri)
            .filter((f) => matchFileSpecs(this._program.configOptions, f))
            .forEach((f) => fileMap.set(f.key, f));

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
            const execEnv = this._configOptions.findExecEnvironment(this._executionRootUri);
            const moduleDescriptor = createImportedModuleDescriptor(this._typeStubTargetImportName);
            const importResult = this._backgroundAnalysisProgram.importResolver.resolveImport(
                Uri.empty(),
                execEnv,
                moduleDescriptor
            );

            if (importResult.isImportFound) {
                const filesToImport: Uri[] = [];

                // Determine the directory that contains the root package.
                const finalResolvedPath = importResult.resolvedUris[importResult.resolvedUris.length - 1];
                const isFinalPathFile = isFile(this.fs, finalResolvedPath);
                const isFinalPathInitFile =
                    isFinalPathFile && finalResolvedPath.stripAllExtensions().fileName === '__init__';

                let rootPackagePath = finalResolvedPath;

                if (isFinalPathFile) {
                    // If the module is a __init__.pyi? file, use its parent directory instead.
                    rootPackagePath = rootPackagePath.getDirectory();
                }

                for (let i = importResult.resolvedUris.length - 2; i >= 0; i--) {
                    if (!importResult.resolvedUris[i].isEmpty()) {
                        rootPackagePath = importResult.resolvedUris[i];
                    } else {
                        // If there was no file corresponding to this portion
                        // of the name path, assume that it's contained
                        // within its parent directory.
                        rootPackagePath = rootPackagePath.getDirectory();
                    }
                }

                if (isDirectory(this.fs, rootPackagePath)) {
                    this._typeStubTargetUri = rootPackagePath;
                } else if (isFile(this.fs, rootPackagePath)) {
                    // This can occur if there is a "dir/__init__.py" at the same level as a
                    // module "dir/module.py" that is specifically targeted for stub generation.
                    this._typeStubTargetUri = rootPackagePath.getDirectory();
                }

                if (finalResolvedPath.isEmpty()) {
                    this._typeStubTargetIsSingleFile = false;
                } else {
                    filesToImport.push(finalResolvedPath);
                    this._typeStubTargetIsSingleFile = importResult.resolvedUris.length === 1 && !isFinalPathInitFile;
                }

                // Add the implicit import paths.
                importResult.filteredImplicitImports.forEach((implicitImport) => {
                    if (ImportResolver.isSupportedImportSourceFile(implicitImport.uri)) {
                        filesToImport.push(implicitImport.uri);
                    }
                });

                this._backgroundAnalysisProgram.setAllowedThirdPartyImports([this._typeStubTargetImportName]);
                this._backgroundAnalysisProgram.setTrackedFiles(filesToImport);
            } else {
                this._console.error(`Import '${this._typeStubTargetImportName}' not found`);
            }
        } else if (!this.options.skipScanningUserFiles) {
            let fileList: Uri[] = [];
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

    private _tryShowLongOperationMessageBox() {
        const windowService = this.serviceProvider.tryGet(ServiceKeys.windowService);
        if (!windowService) {
            return;
        }

        const message = Localizer.Service.longOperation();
        const action = windowService.createGoToOutputAction();
        windowService.showInformationMessage(message, action);
    }

    private _matchFiles(include: FileSpec[], exclude: FileSpec[]): Uri[] {
        if (this._executionRootUri.isEmpty()) {
            // No user files for default workspace.
            return [];
        }

        const envMarkers = [['bin', 'activate'], ['Scripts', 'activate'], ['pyvenv.cfg'], ['conda-meta']];
        const results: Uri[] = [];
        const startTime = Date.now();
        const longOperationLimitInSec = 10;
        const nFilesToSuggestSubfolder = 50;

        let loggedLongOperationError = false;
        let nFilesVisited = 0;

        const visitDirectoryUnchecked = (absolutePath: Uri, includeRegExp: RegExp, hasDirectoryWildcard: boolean) => {
            if (!loggedLongOperationError) {
                const secondsSinceStart = (Date.now() - startTime) * 0.001;

                // If this is taking a long time, log an error to help the user
                // diagnose and mitigate the problem.
                if (secondsSinceStart >= longOperationLimitInSec && nFilesVisited >= nFilesToSuggestSubfolder) {
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

                    // Show it in message box if it is supported.
                    this._tryShowLongOperationMessageBox();

                    loggedLongOperationError = true;
                }
            }

            if (this._configOptions.autoExcludeVenv) {
                if (envMarkers.some((f) => this.fs.existsSync(absolutePath.resolvePaths(...f)))) {
                    // Save auto exclude paths in the configOptions once we found them.
                    if (!FileSpec.isInPath(absolutePath, exclude)) {
                        exclude.push(getFileSpec(this._configOptions.projectRoot, `${absolutePath}/**`));
                    }

                    this._console.info(`Auto-excluding ${absolutePath.toUserVisibleString()}`);
                    return;
                }
            }

            const { files, directories } = getFileSystemEntries(this.fs, absolutePath);

            for (const filePath of files) {
                if (FileSpec.matchIncludeFileSpec(includeRegExp, exclude, filePath)) {
                    nFilesVisited++;
                    results.push(filePath);
                }
            }

            for (const dirPath of directories) {
                if (dirPath.matchesRegex(includeRegExp) || hasDirectoryWildcard) {
                    if (!FileSpec.isInPath(dirPath, exclude)) {
                        visitDirectory(dirPath, includeRegExp, hasDirectoryWildcard);
                    }
                }
            }
        };

        const seenDirs = new Set<string>();
        const visitDirectory = (absolutePath: Uri, includeRegExp: RegExp, hasDirectoryWildcard: boolean) => {
            const realDirPath = tryRealpath(this.fs, absolutePath);
            if (!realDirPath) {
                this._console.warn(`Skipping broken link "${absolutePath}"`);
                return;
            }

            if (seenDirs.has(realDirPath.key)) {
                this._console.warn(`Skipping recursive symlink "${absolutePath}" -> "${realDirPath}"`);
                return;
            }
            seenDirs.add(realDirPath.key);

            try {
                visitDirectoryUnchecked(absolutePath, includeRegExp, hasDirectoryWildcard);
            } finally {
                seenDirs.delete(realDirPath.key);
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
                    this._console.error(
                        `File or directory "${includeSpec.wildcardRoot.toUserVisibleString()}" does not exist.`
                    );
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
                return spec.wildcardRoot;
            });

            try {
                if (this._verboseOutput) {
                    this._console.info(`Adding fs watcher for directories:\n ${fileList.join('\n')}`);
                }

                const isIgnored = ignoredWatchEventFunction(fileList.map((f) => f.getFilePath()));
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

                    let uri = Uri.file(path, this.serviceProvider, /* checkRelative */ true);

                    // Make sure path is the true case.
                    uri = this.fs.realCasePath(uri);

                    const eventInfo = getEventInfo(this.fs, this._console, this._program, event, uri);
                    if (!eventInfo) {
                        // no-op event, return.
                        return;
                    }

                    if (!this._shouldHandleSourceFileWatchChanges(uri, eventInfo.isFile)) {
                        return;
                    }

                    // This is for performance optimization. If the change only pertains to the content of one file,
                    // then it can't affect the 'import resolution' result. All we need to do is reanalyze the related files
                    // (those that have a transitive dependency on this file).
                    if (eventInfo.isFile && eventInfo.event === 'change') {
                        this._backgroundAnalysisProgram.markFilesDirty([uri], /* evenIfContentsAreSame */ false);
                        this.scheduleReanalysis(/* requireTrackedFileUpdate */ false);
                        return;
                    }

                    // When the file system structure changes, like when files are added or removed,
                    // this can affect how we resolve imports. This requires us to reset caches and reanalyze everything.
                    //
                    // However, we don't need to rebuild any indexes in this situation. Changes to workspace files don't affect library indices.
                    this.invalidateAndForceReanalysis(InvalidatedReason.SourceWatcherChanged);
                    this.scheduleReanalysis(/* requireTrackedFileUpdate */ true);
                });
            } catch {
                this._console.error(
                    `Exception caught when installing fs watcher for:\n ${fileList
                        .map((f) => f.toUserVisibleString())
                        .join('\n')}`
                );
            }
        }

        function getEventInfo(
            fs: FileSystem,
            console: ConsoleInterface,
            program: Program,
            event: FileWatcherEventType,
            path: Uri
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

    private _shouldHandleSourceFileWatchChanges(path: Uri, isFile: boolean) {
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

        const parentPath = path.getDirectory();
        const hasInit =
            parentPath.startsWith(this._configOptions.projectRoot) &&
            (this.fs.existsSync(parentPath.initPyUri) || this.fs.existsSync(parentPath.initPyiUri));

        // We don't have any file under the given path and its parent folder doesn't have __init__ then this folder change
        // doesn't have any meaning to us.
        if (!hasInit && !this._program.containsSourceFileIn(path)) {
            return false;
        }

        return true;

        function isTemporaryFile(path: Uri) {
            // Determine if this is an add or delete event related to a temporary
            // file. Some tools (like auto-formatters) create temporary files
            // alongside the original file and name them "x.py.<temp-id>.py" where
            // <temp-id> is a 32-character random string of hex digits. We don't
            // want these events to trigger a full reanalysis.
            const fileName = path.fileName;
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
            this._librarySearchUrisToWatch = undefined;
            return;
        }

        // Watch the library paths for package install/uninstall.
        const importFailureInfo: string[] = [];
        this._librarySearchUrisToWatch = findPythonSearchPaths(
            this.fs,
            this._backgroundAnalysisProgram.configOptions,
            this._backgroundAnalysisProgram.host,
            importFailureInfo,
            /* includeWatchPathsOnly */ true,
            this._executionRootUri
        );

        // Make sure the watch list includes extra paths that are not part of user files.
        // Sometimes, nested folders of the workspace are added as extra paths to import modules as top-level modules.
        const extraPaths = this._configOptions
            .getExecutionEnvironments()
            .map((e) => e.extraPaths.filter((p) => !matchFileSpecs(this._configOptions, p, /* isFile */ false)))
            .flat();

        const watchList = deduplicateFolders([this._librarySearchUrisToWatch, extraPaths]);
        if (watchList.length > 0) {
            try {
                if (this._verboseOutput) {
                    this._console.info(`Adding fs watcher for library directories:\n ${watchList.join('\n')}`);
                }
                const isIgnored = ignoredWatchEventFunction(watchList.map((f) => f.getFilePath()));
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

                    const uri = Uri.file(path, this.serviceProvider, /* checkRelative */ true);

                    if (!this._shouldHandleLibraryFileWatchChanges(uri, watchList)) {
                        return;
                    }

                    // If file doesn't exist, it is delete.
                    const isChange = event === 'change' && this.fs.existsSync(uri);
                    this._scheduleLibraryAnalysis(isChange);
                });
            } catch {
                this._console.error(
                    `Exception caught when installing fs watcher for:\n ${watchList
                        .map((w) => w.toUserVisibleString())
                        .join('\n')}`
                );
            }
        }
    }

    private _shouldHandleLibraryFileWatchChanges(path: Uri, libSearchPaths: Uri[]) {
        if (this._program.getSourceFileInfo(path)) {
            return true;
        }

        // find the innermost matching search path
        let matchingSearchPath;
        for (const libSearchPath of libSearchPaths) {
            if (
                path.isChild(libSearchPath) &&
                (!matchingSearchPath || matchingSearchPath.getPathLength() < libSearchPath.getPathLength())
            ) {
                matchingSearchPath = libSearchPath;
            }
        }

        if (!matchingSearchPath) {
            return true;
        }

        const parentComponents = matchingSearchPath.getPathComponents();
        const childComponents = path.getPathComponents();

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

            const handled = this._backgroundAnalysisProgram?.libraryUpdated();
            this.options.libraryReanalysisTimeProvider?.libraryUpdated?.(handled);
        }
    }

    private _scheduleLibraryAnalysis(isChange: boolean) {
        if (this._disposed) {
            // Already disposed.
            return;
        }

        this._clearLibraryReanalysisTimer();

        const reanalysisTimeProvider = this.options.libraryReanalysisTimeProvider;
        const backOffTimeInMS = reanalysisTimeProvider?.();
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
            this.scheduleReanalysis(/* requireTrackedFileUpdate */ false);

            // No more pending changes.
            reanalysisTimeProvider!.libraryReanalysisStarted?.();
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

        if (this._primaryConfigFileUri) {
            this._configFileWatcher = this.fs.createFileSystemWatcher(this._extendedConfigFileUris, (event) => {
                if (this._verboseOutput) {
                    this._console.info(`Received fs event '${event}' for config file`);
                }
                this._scheduleReloadConfigFile();
            });
        } else if (!this._executionRootUri.isEmpty()) {
            this._configFileWatcher = this.fs.createFileSystemWatcher([this._executionRootUri], (event, path) => {
                if (!path) {
                    return;
                }

                if (event === 'add' || event === 'change') {
                    const fileName = getFileName(path);
                    if (fileName === configFileName) {
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

        if (this._primaryConfigFileUri) {
            this._console.info(`Reloading configuration file at ${this._primaryConfigFileUri.toUserVisibleString()}`);

            const host = this._backgroundAnalysisProgram.host;

            // We can't just reload config file when it is changed; we need to consider
            // command line options as well to construct new config Options.
            const configOptions = this._getConfigOptions(host, this._commandLineOptions!);
            this._backgroundAnalysisProgram.setConfigOptions(configOptions);

            this.applyConfigOptions(host);
        }
    }

    private _clearReanalysisTimer() {
        if (this._analyzeTimer) {
            clearTimeout(this._analyzeTimer);
            this._analyzeTimer = undefined;
        }
    }

    private _reportConfigParseError() {
        if (this._onCompletionCallback) {
            this._onCompletionCallback({
                diagnostics: [],
                filesInProgram: 0,
                requiringAnalysisCount: { files: 0, cells: 0 },
                checkingOnlyOpenFiles: true,
                fatalErrorOccurred: false,
                configParseErrorOccurred: true,
                elapsedTime: 0,
                reason: 'analysis',
            });
        }
    }
}
