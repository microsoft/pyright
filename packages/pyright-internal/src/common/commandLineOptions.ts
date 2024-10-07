/*
 * commandLineOptions.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Class that holds the command-line options (those that can be
 * passed into the main entry point of the command-line version
 * of the analyzer).
 */

import { TaskListToken } from './diagnostic';
import { PythonVersion } from './pythonVersion';
import { Uri } from './uri/uri';

export const enum DiagnosticSeverityOverrides {
    Error = 'error',
    Warning = 'warning',
    Information = 'information',
    None = 'none',
}

export function getDiagnosticSeverityOverrides() {
    return [
        DiagnosticSeverityOverrides.Error,
        DiagnosticSeverityOverrides.Warning,
        DiagnosticSeverityOverrides.Information,
        DiagnosticSeverityOverrides.None,
    ];
}

export type DiagnosticSeverityOverridesMap = { [ruleName: string]: DiagnosticSeverityOverrides };
export type DiagnosticBooleanOverridesMap = { [ruleName: string]: boolean };

// Options that can be specified in a JSON config file. This list should match what is
// defined in the pyrightconfig.schema.json file.
export class CommandLineConfigOptions {
    // A list of file specs to include in the analysis. Can contain
    // directories, in which case all "*.py" files within those directories
    // are included.
    includeFileSpecs: string[] = [];

    // If specified, this list of file specs overrides the includeFileSpecs
    // above, rendering it as ignored. This is used
    // for the CLI "--files" option, which should always override the "include"
    // and "exclude" config file settings.
    includeFileSpecsOverride?: string[];

    // A list of file specs to exclude in the analysis. Can contain
    // directories, in which case all "*.py" files within those directories
    // are excluded.
    excludeFileSpecs: string[] = [];

    // A list of file specs whose errors and warnings should be ignored even
    // if they are included in the transitive closure of included files.
    ignoreFileSpecs: string[] = [];

    // Virtual environments directory.
    venvPath?: string | undefined;

    // Path to python interpreter.
    pythonPath?: string | undefined;

    // Name for the virtual environment.
    pythonEnvironmentName?: string | undefined;

    // Python platform indicator (darwin, linux, win32)
    pythonPlatform?: 'Darwin' | 'Linux' | 'Windows' | undefined;

    // Python version string (3.3, 3.4, etc.)
    pythonVersion?: PythonVersion | undefined;

    // Path of typeshed stubs.
    typeshedPath?: string | undefined;

    // Path of typing folder
    stubPath?: string | undefined;
    // In the absence of type stubs, use library implementations
    // to extract type information?
    useLibraryCodeForTypes?: boolean | undefined;

    // Look for a common root folders such as 'src' and automatically
    // add them as extra paths if the user has not explicitly defined
    // execution environments.
    autoSearchPaths?: boolean | undefined;

    // Extra paths to add to the default execution environment
    // when user has not explicitly defined execution environments.
    extraPaths?: string[] | undefined;

    // Default type-checking rule set. Should be one of 'off',
    // 'basic', 'standard', or 'strict'.
    typeCheckingMode?: string | undefined;

    // Indicates diagnostic severity overrides
    diagnosticSeverityOverrides?: DiagnosticSeverityOverridesMap | undefined;

    // Indicates diagnostic boolean overrides
    diagnosticBooleanOverrides?: DiagnosticBooleanOverridesMap | undefined;

    // Analyze functions and methods that have no type annotations?
    analyzeUnannotatedFunctions?: boolean;

    // Emit verbose information to console?
    verboseOutput?: boolean | undefined;
}

// Options that are not specified in a JSON config file but apply to a language server.
export class CommandLineLanguageServerOptions {
    // Watch for changes in workspace source files.
    watchForSourceChanges?: boolean | undefined;

    // Watch for changes in environment library/search paths.
    watchForLibraryChanges?: boolean | undefined;

    // Watch for changes in config files.
    watchForConfigChanges?: boolean | undefined;

    // Type stub import target (for creation of type stubs).
    typeStubTargetImportName?: string | undefined;

    // Indicates that only open files should be checked.
    checkOnlyOpenFiles?: boolean | undefined;

    // Offer auto-import completions.
    autoImportCompletions?: boolean | undefined;

    // Use indexing.
    indexing?: boolean | undefined;

    // Task list tokens, used for VS task list population
    taskListTokens?: TaskListToken[] | undefined;

    // Use type evaluator call tracking.
    logTypeEvaluationTime = false;

    // Minimum threshold for type eval logging.
    typeEvaluationTimeThreshold = 50;

    // Run ambient analysis.
    enableAmbientAnalysis = true;

    // Disable reporting of hint diagnostics with tags?
    disableTaggedHints?: boolean;

    // Path to python interpreter. This is used when the language server
    // gets the python path from the client.
    pythonPath?: string | undefined;

    // Virtual environments directory.
    venvPath?: string | undefined;
}

// Some options can be specified from a source other than the pyright config file.
// This can be from command-line parameters or some other settings mechanism, like
// that provided through a language client like the VS Code editor. These options
// are later combined with those from the config file to produce the final configuration.
export class CommandLineOptions {
    // Settings that are possible to set in a config.json file.
    configSettings: CommandLineConfigOptions = new CommandLineConfigOptions();

    // Settings that are not possible to set in a config.json file.
    languageServerSettings: CommandLineLanguageServerOptions = new CommandLineLanguageServerOptions();

    // Path of config file. This option cannot be combined with
    // file specs.
    configFilePath?: string | undefined;

    // Absolute execution root (current working directory).
    executionRoot: string | Uri | undefined;

    // Indicates that the settings came from a language server rather than
    // from the command-line. Useful for providing clearer error
    // messages.
    fromLanguageServer: boolean;

    constructor(executionRoot: string | Uri | undefined, fromLanguageServer: boolean) {
        this.executionRoot = executionRoot;
        this.fromLanguageServer = fromLanguageServer;
    }
}
