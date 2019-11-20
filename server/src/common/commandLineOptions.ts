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

// Some options can be specified by command line.
export class CommandLineOptions {
    constructor(executionRoot: string, fromVsCodeExtension: boolean) {
        this.executionRoot = executionRoot;
        this.fromVsCodeExtension = fromVsCodeExtension;
    }

    // A list of file specs to include in the analysis. Can contain
    // directories, in which case all "*.py" files within those directories
    // are included.
    fileSpecs: string[] = [];

    // Watch for changes?
    watch?: boolean;

    // Path of config file. This option cannot be combined with
    // file specs.
    configFilePath?: string;

    // Virtual environments directory.
    venvPath?: string;

    // Path to python interpreter.
    pythonPath?: string;

    // Path of typeshed stubs.
    typeshedPath?: string;

    // Absolute execution root (current working directory).
    executionRoot: string;

    // Type stub import target (for creation of type stubs).
    typeStubTargetImportName?: string;

    // Emit verbose information to console?
    verboseOutput?: boolean;

    // Indicates that only open files should be checked.
    checkOnlyOpenFiles?: boolean;

    // In the absence of type stubs, use library implementations
    // to extract type information?
    useLibraryCodeForTypes?: boolean;

    // Indicates that the settings came from VS Code rather than
    // from the command-line. Useful for providing clearer error
    // messages.
    fromVsCodeExtension: boolean;
}
