/*
* service.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* A persistent service that is able to analyze a collection of
* Python files.
*/

import * as fs from 'fs';

import { CommandLineOptions } from '../common/commandLineOptions';
import { ConfigOptions } from '../common/configOptions';
import { ConsoleInterface, StandardConsole } from '../common/console';
import { DiagnosticTextPosition, DocumentTextRange } from '../common/diagnostic';
import { FileDiagnostics } from '../common/diagnosticSink';
import { combinePaths, forEachAncestorDirectory, getDirectoryPath, getFileSystemEntries,
    isDirectory, isFile, normalizePath } from '../common/pathUtils';
import { Duration, timingStats } from '../common/timing';
import { MaxAnalysisTime, Program } from './program';
import { PythonPathUtils } from './pythonPathUtils';

const _defaultConfigFileName = 'pyrightconfig.json';

export { MaxAnalysisTime } from './program';

export interface AnalysisResults {
    diagnostics: FileDiagnostics[];
    filesInProgram: number;
    filesRequiringAnalysis: number;
    fatalErrorOccurred: boolean;
    elapsedTime: number;
}

export type AnalysisCompleteCallback = (results: AnalysisResults) => void;

export class AnalyzerService {
    private _program: Program;
    private _configOptions: ConfigOptions;
    private _executionRootPath: string;
    private _console: ConsoleInterface;
    private _sourceFileWatcher: (fs.FSWatcher | undefined)[] | undefined;
    private _reloadConfigTimer: any;
    private _configFilePath: string | undefined;
    private _configFileWatcher: fs.FSWatcher | undefined;
    private _onCompletionCallback: AnalysisCompleteCallback | undefined;
    private _watchForChanges = false;
    private _maxAnalysisTime?: MaxAnalysisTime;
    private _analyzeTimer: any;
    private _requireTrackedFileUpdate = true;

    constructor(console?: ConsoleInterface) {
        this._console = console || new StandardConsole();
        this._program = new Program(this._console);
        this._configOptions = new ConfigOptions(process.cwd());
        this._executionRootPath = '/';
    }

    setCompletionCallback(callback: AnalysisCompleteCallback | undefined): void {
        this._onCompletionCallback = callback;
    }

    setMaxAnalysisDuration(maxAnalysisTime?: MaxAnalysisTime) {
        this._maxAnalysisTime = maxAnalysisTime;
    }

    setOptions(commandLineOptions: CommandLineOptions): void {
        this._watchForChanges = !!commandLineOptions.watch;
        this._configOptions = this._getConfigOptions(commandLineOptions);

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
        let fileDiagnostics = this._program.setFileClosed(path);
        this._reportDiagnosticsForRemovedFiles(fileDiagnostics);
        this._scheduleReanalysis(false);
    }

    markFilesChanged(fileList: string[]) {
        this._program.markFilesDirty(fileList);
        this._scheduleReanalysis(false);
    }

    getDefinitionForPosition(filePath: string, position: DiagnosticTextPosition):
            DocumentTextRange | undefined {
        return this._program.getDefinitionForPosition(filePath, position);
    }

    getHoverForPosition(filePath: string, position: DiagnosticTextPosition):
            string | undefined {
        return this._program.getHoverForPosition(filePath, position);
    }

    printStats() {
        this._console.log('');
        this._console.log('Analysis stats');

        const fileCount = this._program.getFileCount();
        this._console.log('Total files analyzed: ' + fileCount.toString());

        let averagePassCount = this._program.getAverageAnalysisPassCount();
        averagePassCount = Math.round(averagePassCount * 10) / 10;
        this._console.log('Average pass count:   ' + averagePassCount.toString());

        const [maxPassCount, sourceFile] = this._program.getMaxAnalysisPassCount();
        const path = sourceFile ? ` (${ sourceFile.getFilePath() })` : '';
        this._console.log('Maximum pass count:   ' + maxPassCount.toString() + path);
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
                this._console.log('Project can not be mixed with source files on a command line.');
            }
        } else if (commandLineOptions.configFilePath) {
            // If the config file path was specified, determine whether it's
            // a directory (in which case the default config file name is assumed)
            // or a file.
            configFilePath = combinePaths(commandLineOptions.executionRoot,
                normalizePath(commandLineOptions.configFilePath));
            if (!fs.existsSync(configFilePath)) {
                this._console.log(`Configuration file not found at ${ configFilePath }.`);
                configFilePath = commandLineOptions.executionRoot;
            } else {
                if (configFilePath.toLowerCase().endsWith('.json')) {
                    projectRoot = getDirectoryPath(configFilePath);
                } else {
                    projectRoot = configFilePath;
                    configFilePath = combinePaths(configFilePath, _defaultConfigFileName);
                    if (!fs.existsSync(configFilePath)) {
                        this._console.log(`Configuration file not found at ${ configFilePath }.`);
                        configFilePath = undefined;
                    }
                }
            }
        } else {
            configFilePath = this._findConfigFile(projectRoot);
            if (configFilePath) {
                projectRoot = getDirectoryPath(configFilePath);
            } else {
                this._console.log(`No configuration file found.`);
                configFilePath = undefined;
            }
        }

        let configOptions = new ConfigOptions(projectRoot);

        if (commandLineOptions.fileSpecs) {
            configOptions.include.push(...commandLineOptions.fileSpecs);
        }

        this._configFilePath = configFilePath;

        // If we found a config file, parse it to compute the effective options.
        if (configFilePath) {
            this._console.log(`Loading configuration file at ${ configFilePath }`);
            let configJsonObj = this._parseConfigFile(configFilePath);
            if (configJsonObj) {
                configOptions.initializeFromJson(configJsonObj, this._console);
            }
            this._updateConfigFileWatcher();
        }

        const reportDuplicateSetting = (settingName: string) => {
            const settingSource = commandLineOptions.fromVsCodeSettings ?
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
            configOptions.pythonPath = commandLineOptions.pythonPath;
        }

        if (commandLineOptions.typeshedPath) {
            if (!configOptions.typeshedPath) {
                configOptions.typeshedPath = commandLineOptions.typeshedPath;
            } else {
                reportDuplicateSetting('typeshedPath');
            }
        }

        // Do some sanity checks on the specified settings and report missing
        // or inconsistent information.
        if (configOptions.venvPath) {
            if (!fs.existsSync(configOptions.venvPath) || !isDirectory(configOptions.venvPath)) {
                this._console.log(
                    `venvPath ${ configOptions.venvPath } is not a valid directory.`);
            }

            if (!configOptions.defaultVenv) {
                this._console.log(
                    `venvPath must be used in conjunction with venv setting, which was omitted.`);
            } else {
                const fullVenvPath = combinePaths(configOptions.venvPath, configOptions.defaultVenv);
                if (!fs.existsSync(fullVenvPath) || !isDirectory(fullVenvPath)) {
                    this._console.log(
                        `venv ${ configOptions.defaultVenv } subdirectory not found ` +
                        `in venv path ${ configOptions.venvPath }.`);
                } else if (PythonPathUtils.findPythonSearchPaths(configOptions) === undefined) {
                    this._console.log(
                        `site-packages directory cannot be located for venvPath ` +
                        `${ configOptions.venvPath } and venv ${ configOptions.defaultVenv }.`);
                }
            }
        } else {
            const pythonPaths = PythonPathUtils.getPythonPathEnvironmentVariable();
            if (pythonPaths.length === 0) {
                this._console.log(
                    `No venvPath specified, and no search paths found for configured python interpreter.`);
            } else {
                this._console.log(
                    `Using PYTHONPATH directories to resolve imports:`);
                pythonPaths.forEach(path => {
                    this._console.log(`  ${ path }`);
                });
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
            if (!fs.existsSync(configOptions.typeshedPath) || !isDirectory(configOptions.typeshedPath)) {
                this._console.log(
                    `typeshedPath ${ configOptions.typeshedPath } is not a valid directory.`);
            }
        }

        if (configOptions.typingsPath) {
            if (!fs.existsSync(configOptions.typingsPath) || !isDirectory(configOptions.typingsPath)) {
                this._console.log(
                    `typingsPath ${ configOptions.typingsPath } is not a valid directory.`);
            }
        }

        return configOptions;
    }

    private _findConfigFile(searchPath: string): string | undefined {
        return forEachAncestorDirectory(searchPath, ancestor => {
            const fileName = combinePaths(ancestor, _defaultConfigFileName);
            return fs.existsSync(fileName) ? fileName : undefined;
        });
    }

    private _parseConfigFile(configPath: string): any | undefined {
        let configContents = '';
        let parseAttemptCount = 0;

        while (true) {
            // Attempt to read the config file contents.
            try {
                configContents = fs.readFileSync(configPath, { encoding: 'utf8' });
            } catch {
                this._console.log(`Config file "${ configPath }" could not be read.`);
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
                this._console.log(`Config file "${ configPath }" could not be parsed.`);
                return undefined;
            }
        }
    }

    private _getFileNamesFromFileSpecs(): string[] {
        // Use a map to generate a list of unique files.
        const fileMap: { [key: string]: string } = {};

        timingStats.findFilesTime.timeOperation(() => {
            let matchedFiles = this._matchFiles(this._configOptions.include,
                this._configOptions.exclude, this._executionRootPath);

            for (const file of matchedFiles) {
                fileMap[file] = file;
            }
        });

        return Object.keys(fileMap);
    }

    private _updateTrackedFileList() {
        this._console.log(`Searching for source files`);
        let fileList = this._getFileNamesFromFileSpecs();

        let fileDiagnostics = this._program.setTrackedFiles(fileList);
        this._reportDiagnosticsForRemovedFiles(fileDiagnostics);
        this._program.markAllFilesDirty();
        if (fileList.length === 0) {
            this._console.log(`No source files found.`);
        } else {
            this._console.log(`Found ${ fileList.length } ` +
                `source ${ fileList.length === 1 ? 'file' : 'files' }`);
        }

        this._requireTrackedFileUpdate = false;
    }

    private _isInExcludePath(path: string, excludePaths: string[]) {
        return !!excludePaths.find(excl => path.startsWith(excl));
    }

    private _matchFiles(include: string[], exclude: string[], basePath: string): string[] {
        let results: string[] = [];

        let visitDirectory = (absolutePath: string) => {
            const includeFileRegex = /\.pyi?$/;
            const { files, directories } = getFileSystemEntries(absolutePath);

            for (const file of files) {
                const filePath = combinePaths(absolutePath, file);

                if (!this._isInExcludePath(filePath, exclude) && includeFileRegex.test(filePath)) {
                    results.push(filePath);
                }
            }

            for (const directory of directories) {
                const dirPath = combinePaths(absolutePath, directory);
                if (!this._isInExcludePath(absolutePath, exclude)) {
                    visitDirectory(dirPath);
                }
            }
        };

        include.forEach(includeSpec => {
            let foundFileSpec = false;

            if (!this._isInExcludePath(includeSpec, exclude) && fs.existsSync(includeSpec)) {
                try {
                    let stat = fs.statSync(includeSpec);
                    if (stat.isFile()) {
                        results.push(includeSpec);
                        foundFileSpec = true;
                    } else if (stat.isDirectory()) {
                        visitDirectory(includeSpec);
                        foundFileSpec = true;
                    }
                } catch {
                    // Ignore the exception.
                }
            }

            if (!foundFileSpec) {
                this._console.log(`File or directory "${ includeSpec }" does not exist.`);
            }
        });

        return results;
    }

    private _updateSourceFileWatchers() {
        if (this._sourceFileWatcher) {
            this._sourceFileWatcher.forEach(watcher => {
                if (watcher) {
                    watcher.close();
                }
            });
            this._sourceFileWatcher = undefined;
        }

        if (!this._watchForChanges) {
            return;
        }

        if (this._configOptions.include.length > 0) {
            let fileList = this._configOptions.include.map(spec => {
                return combinePaths(this._executionRootPath, spec);
            });

            this._sourceFileWatcher = fileList.map(fileSpec => {
                try {
                    return fs.watch(fileSpec, { recursive: true }, (event, fileName) => {
                        if (event === 'change') {
                            let filePath = fileSpec;
                            if (!isFile(filePath)) {
                                filePath = combinePaths(fileSpec, fileName);
                            }
                            this._program.markFilesDirty([filePath]);
                            this._scheduleReanalysis(false);
                        } else if (event === 'rename') {
                            this._scheduleReanalysis(true);
                        }
                    });
                } catch {
                    return undefined;
                }
            });
        }
    }

    private _updateConfigFileWatcher() {
        if (this._configFileWatcher) {
            this._configFileWatcher.close();
            this._configFileWatcher = undefined;
        }

        if (this._watchForChanges && this._configFilePath) {
            this._configFileWatcher = fs.watch(this._configFilePath, {}, (event, fileName) => {
                if (event === 'change') {
                    this._scheduleReloadConfigFile();
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
        if (this._configFilePath) {
            this._updateConfigFileWatcher();

            this._console.log(`Reloading configuration file at ${ this._configFilePath }`);
            let configJsonObj = this._parseConfigFile(this._configFilePath);
            if (configJsonObj) {
                this._configOptions.initializeFromJson(configJsonObj, this._console);
            }

            this._applyConfigOptions();
        }
    }

    private _applyConfigOptions() {
        this._updateSourceFileWatchers();
        this._updateTrackedFileList();
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

        // Schedule a new timer.
        this._analyzeTimer = setTimeout(() => {
            if (this._requireTrackedFileUpdate) {
                this._updateTrackedFileList();
            }

            let moreToAnalyze = this._reanalyze();
            this._analyzeTimer = undefined;

            if (moreToAnalyze) {
                this._scheduleReanalysis(false);
            }
        }, 0);
    }

    // Performs analysis for a while (up to this._maxAnalysisTimeInMs) before
    // returning some results. Return value indicates whether more analysis is
    // required to finish the entire program.
    private _reanalyze(): boolean {
        let moreToAnalyze = false;

        try {
            let duration = new Duration();
            moreToAnalyze = this._program.analyze(this._configOptions, this._maxAnalysisTime);

            let results: AnalysisResults = {
                diagnostics: this._program.getDiagnostics(this._configOptions),
                filesInProgram: this._program.getFileCount(),
                filesRequiringAnalysis: this._program.getFilesToAnalyzeCount(),
                fatalErrorOccurred: false,
                elapsedTime: duration.getDurationInSeconds()
            };

            let fileCount = results.diagnostics.length;
            if (fileCount > 0) {
                if (this._onCompletionCallback) {
                    this._onCompletionCallback(results);
                }
            }
        } catch (err) {
            this._console.log('Error performing analysis: ' + JSON.stringify(err));

            if (this._onCompletionCallback) {
                this._onCompletionCallback({
                    diagnostics: [],
                    filesInProgram: 0,
                    filesRequiringAnalysis: 0,
                    fatalErrorOccurred: true,
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
                    fatalErrorOccurred: false,
                    elapsedTime: 0
                });
            }
        }
    }
}
