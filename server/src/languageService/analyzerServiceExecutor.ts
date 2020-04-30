/*
 * analyzerServiceExecutor.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Runs the analyzer service of a given workspace service instance
 * with a specified set of options.
 */

import { CommandLineOptions } from '../common/commandLineOptions';
import { combinePaths, normalizePath } from '../common/pathUtils';
import { ServerSettings, WorkspaceServiceInstance } from '../languageServerBase';

export class AnalyzerServiceExecutor {
    static runWithOptions(
        languageServiceRootPath: string,
        workspace: WorkspaceServiceInstance,
        serverSettings: ServerSettings,
        typeStubTargetImportName?: string,
        trackFiles = true
    ): void {
        const commandLineOptions = _getCommandLineOptions(
            languageServiceRootPath,
            workspace.rootPath,
            serverSettings,
            typeStubTargetImportName
        );

        if (!trackFiles) {
            commandLineOptions.watchForSourceChanges = false;
            commandLineOptions.watchForLibraryChanges = false;
        }

        // Setting options causes the analyzer service to re-analyze everything.
        workspace.serviceInstance.setOptions(commandLineOptions, trackFiles);
    }
}

function _getCommandLineOptions(
    languageServiceRootPath: string,
    workspaceRootPath: string,
    serverSettings: ServerSettings,
    typeStubTargetImportName?: string
) {
    const commandLineOptions = new CommandLineOptions(workspaceRootPath, true);
    commandLineOptions.checkOnlyOpenFiles = serverSettings.openFilesOnly;
    commandLineOptions.useLibraryCodeForTypes = serverSettings.useLibraryCodeForTypes;
    commandLineOptions.watchForSourceChanges = serverSettings.watchForSourceChanges;
    commandLineOptions.watchForLibraryChanges = serverSettings.watchForLibraryChanges;
    commandLineOptions.typeCheckingMode = serverSettings.typeCheckingMode;

    if (serverSettings.venvPath) {
        commandLineOptions.venvPath = combinePaths(
            workspaceRootPath || languageServiceRootPath,
            normalizePath(_expandPathVariables(languageServiceRootPath, serverSettings.venvPath))
        );
    }

    if (serverSettings.pythonPath) {
        // The Python VS Code extension treats the value "python" specially. This means
        // the local python interpreter should be used rather than interpreting the
        // setting value as a path to the interpreter. We'll simply ignore it in this case.
        if (serverSettings.pythonPath.trim() !== 'python') {
            commandLineOptions.pythonPath = combinePaths(
                workspaceRootPath || languageServiceRootPath,
                normalizePath(_expandPathVariables(languageServiceRootPath, serverSettings.pythonPath))
            );
        }
    }

    if (serverSettings.typeshedPath) {
        // Pyright supports only one typeshed path currently, whereas the
        // official VS Code Python extension supports multiple typeshed paths.
        // We'll use the first one specified and ignore the rest.
        commandLineOptions.typeshedPath = _expandPathVariables(languageServiceRootPath, serverSettings.typeshedPath);
    }

    if (typeStubTargetImportName) {
        commandLineOptions.typeStubTargetImportName = typeStubTargetImportName;
    }

    commandLineOptions.autoSearchPaths = serverSettings.autoSearchPaths;

    return commandLineOptions;
}

// Expands certain predefined variables supported within VS Code settings.
// Ideally, VS Code would provide an API for doing this expansion, but
// it doesn't. We'll handle the most common variables here as a convenience.
function _expandPathVariables(rootPath: string, value: string): string {
    const regexp = /\$\{(.*?)\}/g;
    return value.replace(regexp, (match: string, name: string) => {
        const trimmedName = name.trim();
        if (trimmedName === 'workspaceFolder') {
            return rootPath;
        }
        return match;
    });
}
