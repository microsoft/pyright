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

import { WellKnownWorkspaceKinds, Workspace, createInitStatus } from '../workspaceFactory';

export interface CloneOptions {
    useBackgroundAnalysis?: boolean;
    typeStubTargetImportName?: string;
    fileSystem?: FileSystem;
}

export class AnalyzerServiceExecutor {
    static runWithOptions(
        workspace: Workspace,
        serverSettings: ServerSettings,
        typeStubTargetImportName?: string,
        trackFiles = true
    ): void {
        const commandLineOptions = getEffectiveCommandLineOptions(
            workspace.rootUri,
            serverSettings,
            trackFiles,
            typeStubTargetImportName,
            workspace.pythonEnvironmentName
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

        options = options ?? {};

        const tempWorkspace: Workspace = {
            ...workspace,
            workspaceName: `temp workspace for cloned service`,
            rootUri: workspace.rootUri,
            pythonPath: workspace.pythonPath,
            pythonPathKind: workspace.pythonPathKind,
            kinds: [...workspace.kinds, WellKnownWorkspaceKinds.Cloned],
            service: workspace.service.clone(
                instanceName,
                serviceId,
                options.useBackgroundAnalysis ? ls.createBackgroundAnalysis(serviceId) : undefined,
                options.fileSystem
            ),
            disableLanguageServices: true,
            disableTaggedHints: true,
            disableOrganizeImports: true,
            disableWorkspaceSymbol: true,
            isInitialized: createInitStatus(),
            searchPathsToWatch: [],
        };

        const serverSettings = await ls.getSettings(workspace);
        AnalyzerServiceExecutor.runWithOptions(
            tempWorkspace,
            serverSettings,
            options.typeStubTargetImportName,
            /* trackFiles */ false
        );

        return tempWorkspace.service;
    }
}

function getEffectiveCommandLineOptions(
    workspaceRootUri: Uri | undefined,
    serverSettings: ServerSettings,
    trackFiles: boolean,
    typeStubTargetImportName?: string,
    pythonEnvironmentName?: string
) {
    const commandLineOptions = new CommandLineOptions(workspaceRootUri, true);
    commandLineOptions.checkOnlyOpenFiles = serverSettings.openFilesOnly;
    commandLineOptions.useLibraryCodeForTypes = serverSettings.useLibraryCodeForTypes;
    commandLineOptions.typeCheckingMode = serverSettings.typeCheckingMode;
    commandLineOptions.autoImportCompletions = serverSettings.autoImportCompletions;
    commandLineOptions.indexing = serverSettings.indexing;
    commandLineOptions.taskListTokens = serverSettings.taskListTokens;
    commandLineOptions.logTypeEvaluationTime = serverSettings.logTypeEvaluationTime ?? false;
    commandLineOptions.typeEvaluationTimeThreshold = serverSettings.typeEvaluationTimeThreshold ?? 50;
    commandLineOptions.enableAmbientAnalysis = trackFiles;
    commandLineOptions.pythonEnvironmentName = pythonEnvironmentName;
    commandLineOptions.disableTaggedHints = serverSettings.disableTaggedHints;

    if (!trackFiles) {
        commandLineOptions.watchForSourceChanges = false;
        commandLineOptions.watchForLibraryChanges = false;
        commandLineOptions.watchForConfigChanges = false;
    } else {
        commandLineOptions.watchForSourceChanges = serverSettings.watchForSourceChanges;
        commandLineOptions.watchForLibraryChanges = serverSettings.watchForLibraryChanges;
        commandLineOptions.watchForConfigChanges = serverSettings.watchForConfigChanges;
    }

    if (serverSettings.venvPath) {
        commandLineOptions.venvPath = serverSettings.venvPath.getFilePath();
    }

    if (serverSettings.pythonPath) {
        // The Python VS Code extension treats the value "python" specially. This means
        // the local python interpreter should be used rather than interpreting the
        // setting value as a path to the interpreter. We'll simply ignore it in this case.
        if (!isPythonBinary(serverSettings.pythonPath.getFilePath())) {
            commandLineOptions.pythonPath = serverSettings.pythonPath.getFilePath();
        }
    }

    if (serverSettings.typeshedPath) {
        // Pyright supports only one typeshed path currently, whereas the
        // official VS Code Python extension supports multiple typeshed paths.
        // We'll use the first one specified and ignore the rest.
        commandLineOptions.typeshedPath = serverSettings.typeshedPath.getFilePath();
    }

    if (serverSettings.stubPath) {
        commandLineOptions.stubPath = serverSettings.stubPath.getFilePath();
    }

    if (serverSettings.logLevel === LogLevel.Log) {
        // When logLevel is "Trace", turn on verboseOutput as well
        // so we can get detailed log from analysis service.
        commandLineOptions.verboseOutput = true;
    }

    if (typeStubTargetImportName) {
        commandLineOptions.typeStubTargetImportName = typeStubTargetImportName;
    }

    commandLineOptions.autoSearchPaths = serverSettings.autoSearchPaths;
    commandLineOptions.extraPaths = serverSettings.extraPaths?.map((e) => e.getFilePath()) ?? [];
    commandLineOptions.diagnosticSeverityOverrides = serverSettings.diagnosticSeverityOverrides;

    commandLineOptions.includeFileSpecs = serverSettings.includeFileSpecs ?? [];
    commandLineOptions.excludeFileSpecs = serverSettings.excludeFileSpecs ?? [];
    commandLineOptions.ignoreFileSpecs = serverSettings.ignoreFileSpecs ?? [];

    return commandLineOptions;
}
