/*
 * analyzerServiceExecutor.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Runs the analyzer service of a given workspace service instance
 * with a specified set of options.
 */

import { isPythonBinary } from '../analyzer/pythonPathUtils';
import { AnalyzerService, getNextServiceId } from '../analyzer/service';
import { CommandLineOptions } from '../common/commandLineOptions';
import { LogLevel } from '../common/console';
import { FileSystem } from '../common/fileSystem';
import { LanguageServerBaseInterface, ServerSettings } from '../common/languageServerInterface';
import { Uri } from '../common/uri/uri';

import { Workspace } from '../workspaceFactory';

export interface CloneOptions {
    useBackgroundAnalysis?: boolean;
    fileSystem?: FileSystem;
}

export interface RunOptions {
    trackFiles?: boolean;
    pythonEnvironmentName?: string;
}

export class AnalyzerServiceExecutor {
    static runWithOptions(workspace: Workspace, serverSettings: ServerSettings, options?: RunOptions): void {
        const commandLineOptions = getEffectiveCommandLineOptions(
            workspace.rootUri,
            serverSettings,
            options?.trackFiles ?? true,
            options?.pythonEnvironmentName
        );

        // Setting options causes the analyzer service to re-analyze everything.
        workspace.service.setOptions(commandLineOptions);
    }

    static async cloneService(
        ls: LanguageServerBaseInterface,
        workspace: Workspace,
        options?: CloneOptions
    ): Promise<AnalyzerService> {
        // Allocate a temporary pseudo-workspace to perform this job.
        const instanceName = 'cloned service';
        const serviceId = getNextServiceId(instanceName);

        return workspace.service.clone(instanceName, serviceId, {
            backgroundAnalysis: options?.useBackgroundAnalysis
                ? ls.createBackgroundAnalysis(serviceId, workspace.rootUri ?? Uri.empty())
                : undefined,
            fileSystem: options?.fileSystem,
        });
    }
}

export function getEffectiveCommandLineOptions(
    workspaceRootUri: Uri | undefined,
    serverSettings: ServerSettings,
    trackFiles: boolean,
    pythonEnvironmentName?: string
) {
    const commandLineOptions = new CommandLineOptions(workspaceRootUri, true);
    commandLineOptions.languageServerSettings.checkOnlyOpenFiles = serverSettings.openFilesOnly;
    commandLineOptions.configSettings.useLibraryCodeForTypes = serverSettings.useLibraryCodeForTypes;
    commandLineOptions.configSettings.typeCheckingMode = serverSettings.typeCheckingMode;
    commandLineOptions.languageServerSettings.autoImportCompletions = serverSettings.autoImportCompletions;
    commandLineOptions.languageServerSettings.indexing = serverSettings.indexing;
    commandLineOptions.languageServerSettings.taskListTokens = serverSettings.taskListTokens;
    commandLineOptions.languageServerSettings.logTypeEvaluationTime = serverSettings.logTypeEvaluationTime ?? false;
    commandLineOptions.languageServerSettings.typeEvaluationTimeThreshold =
        serverSettings.typeEvaluationTimeThreshold ?? 50;
    commandLineOptions.languageServerSettings.enableAmbientAnalysis = trackFiles;
    commandLineOptions.configSettings.pythonEnvironmentName = pythonEnvironmentName;
    commandLineOptions.languageServerSettings.disableTaggedHints = serverSettings.disableTaggedHints;

    if (!trackFiles) {
        commandLineOptions.languageServerSettings.watchForSourceChanges = false;
        commandLineOptions.languageServerSettings.watchForLibraryChanges = false;
        commandLineOptions.languageServerSettings.watchForConfigChanges = false;
    } else {
        commandLineOptions.languageServerSettings.watchForSourceChanges = serverSettings.watchForSourceChanges;
        commandLineOptions.languageServerSettings.watchForLibraryChanges = serverSettings.watchForLibraryChanges;
        commandLineOptions.languageServerSettings.watchForConfigChanges = serverSettings.watchForConfigChanges;
    }

    if (serverSettings.venvPath) {
        commandLineOptions.languageServerSettings.venvPath = serverSettings.venvPath.getFilePath();
    }

    if (serverSettings.pythonPath) {
        // The Python VS Code extension treats the value "python" specially. This means
        // the local python interpreter should be used rather than interpreting the
        // setting value as a path to the interpreter. We'll simply ignore it in this case.
        if (!isPythonBinary(serverSettings.pythonPath.getFilePath())) {
            commandLineOptions.languageServerSettings.pythonPath = serverSettings.pythonPath.getFilePath();
        }
    }

    if (serverSettings.typeshedPath) {
        // Pyright supports only one typeshed path currently, whereas the
        // official VS Code Python extension supports multiple typeshed paths.
        // We'll use the first one specified and ignore the rest.
        commandLineOptions.configSettings.typeshedPath = serverSettings.typeshedPath.getFilePath();
    }

    if (serverSettings.stubPath) {
        commandLineOptions.configSettings.stubPath = serverSettings.stubPath.getFilePath();
    }

    if (serverSettings.logLevel === LogLevel.Log) {
        // When logLevel is "Trace", turn on verboseOutput as well
        // so we can get detailed log from analysis service.
        commandLineOptions.configSettings.verboseOutput = true;
    }

    commandLineOptions.configSettings.autoSearchPaths = serverSettings.autoSearchPaths;
    commandLineOptions.configSettings.useDefaultExcludes = serverSettings.useDefaultExcludes;
    commandLineOptions.configSettings.extraPaths = serverSettings.extraPathFileSpecs ?? [];
    commandLineOptions.configSettings.diagnosticSeverityOverrides = serverSettings.diagnosticSeverityOverrides;
    commandLineOptions.configSettings.diagnosticBooleanOverrides = serverSettings.diagnosticBooleanOverrides;

    commandLineOptions.configSettings.includeFileSpecs = serverSettings.includeFileSpecs ?? [];
    commandLineOptions.configSettings.excludeFileSpecs = serverSettings.excludeFileSpecs ?? [];
    commandLineOptions.configSettings.ignoreFileSpecs = serverSettings.ignoreFileSpecs ?? [];

    return commandLineOptions;
}
