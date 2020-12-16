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
import { CommandLineOptions } from '../common/commandLineOptions';
import { combinePaths } from '../common/pathUtils';
import { ServerSettings, WorkspaceServiceInstance } from '../languageServerBase';

export class AnalyzerServiceExecutor {
    static runWithOptions(
        languageServiceRootPath: string,
        workspace: WorkspaceServiceInstance,
        serverSettings: ServerSettings,
        typeStubTargetImportName?: string,
        trackFiles = true
    ): void {
        const commandLineOptions = getEffectiveCommandLineOptions(
            languageServiceRootPath,
            workspace.rootPath,
            serverSettings,
            trackFiles,
            typeStubTargetImportName
        );

        // Setting options causes the analyzer service to re-analyze everything.
        workspace.serviceInstance.setOptions(commandLineOptions, trackFiles);
    }
}

function getEffectiveCommandLineOptions(
    languageServiceRootPath: string,
    workspaceRootPath: string,
    serverSettings: ServerSettings,
    trackFiles: boolean,
    typeStubTargetImportName?: string
) {
    const commandLineOptions = new CommandLineOptions(workspaceRootPath, true);
    commandLineOptions.checkOnlyOpenFiles = serverSettings.openFilesOnly;
    commandLineOptions.useLibraryCodeForTypes = serverSettings.useLibraryCodeForTypes;
    commandLineOptions.typeCheckingMode = serverSettings.typeCheckingMode;
    commandLineOptions.autoImportCompletions = serverSettings.autoImportCompletions;
    commandLineOptions.indexing = serverSettings.indexing;

    if (!trackFiles) {
        commandLineOptions.watchForSourceChanges = false;
        commandLineOptions.watchForLibraryChanges = false;
    } else {
        commandLineOptions.watchForSourceChanges = serverSettings.watchForSourceChanges;
        commandLineOptions.watchForLibraryChanges = serverSettings.watchForLibraryChanges;
    }

    if (serverSettings.venvPath) {
        commandLineOptions.venvPath = combinePaths(
            workspaceRootPath || languageServiceRootPath,
            serverSettings.venvPath
        );
    }

    if (serverSettings.pythonPath) {
        // The Python VS Code extension treats the value "python" specially. This means
        // the local python interpreter should be used rather than interpreting the
        // setting value as a path to the interpreter. We'll simply ignore it in this case.
        if (!isPythonBinary(serverSettings.pythonPath)) {
            commandLineOptions.pythonPath = combinePaths(
                workspaceRootPath || languageServiceRootPath,
                serverSettings.pythonPath
            );
        }
    }

    if (serverSettings.typeshedPath) {
        // Pyright supports only one typeshed path currently, whereas the
        // official VS Code Python extension supports multiple typeshed paths.
        // We'll use the first one specified and ignore the rest.
        commandLineOptions.typeshedPath = serverSettings.typeshedPath;
    }

    if (serverSettings.stubPath) {
        commandLineOptions.stubPath = serverSettings.stubPath;
    }

    if (typeStubTargetImportName) {
        commandLineOptions.typeStubTargetImportName = typeStubTargetImportName;
    }

    commandLineOptions.autoSearchPaths = serverSettings.autoSearchPaths;
    commandLineOptions.extraPaths = serverSettings.extraPaths;
    commandLineOptions.diagnosticSeverityOverrides = serverSettings.diagnosticSeverityOverrides;

    return commandLineOptions;
}
