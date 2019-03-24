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
    constructor(executionRoot: string) {
        this.executionRoot = executionRoot;
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

    // Path of python environment.
    pythonPath?: string;

    // Path of typeshed stubs.
    typeshedPath?: string;

    // Absolute execution root (current working directory).
    executionRoot: string;
}
