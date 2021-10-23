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

import { PythonVersion } from './pythonVersion';

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

// Some options can be specified from a source other than the pyright config file.
// This can be from command-line parameters or some other settings mechanism, like
// that provided through a language client like the VS Code editor. These options
// are later combined with those from the config file to produce the final configuration.
export class CommandLineOptions {
    constructor(executionRoot: string, fromVsCodeExtension: boolean) {
        this.executionRoot = executionRoot;
        this.fromVsCodeExtension = fromVsCodeExtension;
    }

    // A list of file specs to include in the analysis. Can contain
    // directories, in which case all "*.py" files within those directories
    // are included.
    fileSpecs: string[] = [];

    // Watch for changes in workspace source files.
    watchForSourceChanges?: boolean | undefined;

    // Watch for changes in environment library/search paths.
    watchForLibraryChanges?: boolean | undefined;

    // Watch for changes in config files.
    watchForConfigChanges?: boolean | undefined;

    // Path of config file. This option cannot be combined with
    // file specs.
    configFilePath?: string | undefined;

    // Virtual environments directory.
    venvPath?: string | undefined;

    // Path to python interpreter.
    pythonPath?: string | undefined;

    // Python platform indicator (darwin, linux, win32)
    pythonPlatform?: 'Darwin' | 'Linux' | 'Windows' | undefined;

    // Python version string (3.3, 3.4, etc.)
    pythonVersion?: PythonVersion | undefined;

    // Path of typeshed stubs.
    typeshedPath?: string | undefined;

    // Path of typing folder
    stubPath?: string | undefined;

    // Absolute execution root (current working directory).
    executionRoot: string;

    // Type stub import target (for creation of type stubs).
    typeStubTargetImportName?: string | undefined;

    // Emit verbose information to console?
    verboseOutput?: boolean | undefined;

    // Indicates that only open files should be checked.
    checkOnlyOpenFiles?: boolean | undefined;

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
    // 'basic', or 'strict'.
    typeCheckingMode?: string | undefined;

    // Indicates that the settings came from VS Code rather than
    // from the command-line. Useful for providing clearer error
    // messages.
    fromVsCodeExtension: boolean;

    // Indicates diagnostic severity overrides
    diagnosticSeverityOverrides?: DiagnosticSeverityOverridesMap | undefined;

    // Offer auto-import completions.
    autoImportCompletions?: boolean | undefined;

    // Use indexing.
    indexing?: boolean | undefined;

    // Use type evaluator call tracking.
    logTypeEvaluationTime = false;

    // Minimum threshold for type eval logging.
    typeEvaluationTimeThreshold = 50;

    // Run ambient analysis.
    enableAmbientAnalysis = true;

    // Analyze functions and methods that have no type annotations?
    analyzeUnannotatedFunctions = true;
}
