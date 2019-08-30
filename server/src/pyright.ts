/*
* pyright.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Command-line entry point for pyright type checker.
*/

// Add the start timer at the very top of the file, before we import other modules.
import { timingStats } from './common/timing';

import chalk from 'chalk';
import * as commandLineArgs from 'command-line-args';
// tslint:disable-next-line
import { CommandLineOptions, OptionDefinition } from 'command-line-args';
import * as process from 'process';

import { AnalyzerService } from './analyzer/service';
import { CommandLineOptions as PyrightCommandLineOptions } from './common/commandLineOptions';
import { DiagnosticCategory } from './common/diagnostic';
import { FileDiagnostics } from './common/diagnosticSink';
import { combinePaths, normalizePath } from './common/pathUtils';

const toolName = 'pyright';

enum ExitStatus {
    NoErrors = 0,
    ErrorsReported = 1,
    FatalError = 2
}

interface DiagnosticResult {
    errorCount: number;
    warningCount: number;
    diagnosticCount: number;
}

function processArgs() {
    const optionDefinitions: OptionDefinition[] = [
        { name: 'createstub', type: String },
        { name: 'dependencies', type: Boolean },
        { name: 'files', type: String, multiple: true, defaultOption: true },
        { name: 'help', alias: 'h', type: Boolean },
        { name: 'project', alias: 'p', type: String },
        { name: 'stats' },
        { name: 'typeshed-path', alias: 't', type: String },
        { name: 'venv-path', alias: 'v', type: String },
        { name: 'verbose', type: Boolean },
        { name: 'version', type: Boolean },
        { name: 'watch', alias: 'w', type: Boolean }
    ];

    let args: CommandLineOptions;

    try {
        args = commandLineArgs(optionDefinitions);
    } catch (err) {
        let argErr: { name: string; optionName: string } = err;
        if (argErr && argErr.optionName) {
            console.error(`Unexpected option ${ argErr.optionName }.\n${ toolName } --help for usage`);
            return;
        }

        console.error(`Unexpected error\n${ toolName } --help for usage`);
        return;
    }

    if (args.help !== undefined) {
        printUsage();
        return;
    }

    if (args.version !== undefined) {
        printVersion();
        return;
    }

    const options = new PyrightCommandLineOptions(process.cwd(), false);

    // Assume any relative paths are relative to the working directory.
    if (args.files && Array.isArray(args.files)) {
        options.fileSpecs = args.files;
        options.fileSpecs = options.fileSpecs.map(f => combinePaths(process.cwd(), f));
    } else {
        options.fileSpecs = [];
    }

    if (args.project) {
        options.configFilePath = combinePaths(process.cwd(), normalizePath(args.project));
    }

    if (args['venv-path']) {
        options.venvPath = combinePaths(process.cwd(), normalizePath(args['venv-path']));
    }

    if (args['typeshed-path']) {
        options.typeshedPath = combinePaths(process.cwd(), normalizePath(args['typeshed-path']));
    }

    if (args.createstub) {
        options.typeStubTargetImportName = args.createstub;

        if (args.watch) {
            console.error(`Option 'createstub' cannot be used with option 'watch'`);
            return;
        }
    }

    options.verboseOutput = !!args.verbose;

    const watch = args.watch !== undefined;
    options.watch = watch;

    const service = new AnalyzerService('<default>');

    service.setCompletionCallback(results => {
        if (results.fatalErrorOccurred) {
            process.exit(ExitStatus.FatalError);
        }

        let errorCount = 0;
        if (results.diagnostics.length > 0 && !args.createstub) {
            const report = reportDiagnostics(results.diagnostics);
            errorCount += report.errorCount;
        }

        if (args.createstub && results.filesRequiringAnalysis === 0) {
            try {
                service.writeTypeStub();
                service.dispose();
                console.log(`Type stub was created for '${ args.createstub }'`);
            } catch (err) {
                let errMessage = '';
                if (err instanceof Error) {
                    errMessage = ': ' + err.message;
                }

                console.error(`Error occurred when creating type stub: ` + errMessage);
            }
            process.exit(ExitStatus.NoErrors);
        }

        if (!watch) {
            // Print the total time.
            timingStats.printSummary(console);
        }

        if (args.stats !== undefined) {
            // Print the stats details.
            service.printStats();
            timingStats.printDetails(console);
        }

        if (args.dependencies) {
            service.printDependencies(!!args.verbose);
        }

        if (!watch) {
            process.exit(
                errorCount > 0 ?
                ExitStatus.ErrorsReported :
                ExitStatus.NoErrors);
        }
    });

    // This will trigger the analyzer.
    service.setOptions(options);

    // Sleep indefinitely.
    let brokenPromise = new Promise(resolve => {
        // Do nothing.
    });
    brokenPromise.then().catch();
}

function printUsage() {
    console.log(
        'Usage: ' + toolName + ' [options] files...\n' +
        '  Options:\n' +
        '  --createstub IMPORT              Create type stub file(s) for import\n' +
        '  --dependencies                   Emit import dependecy information\n' +
        '  -h,--help                        Show this help message\n' +
        '  -p,--project FILE OR DIRECTORY   Use the configuration file at this location\n' +
        '  --stats                          Print detailed performance stats\n' +
        '  -t,--typeshed-path DIRECTORY     Use typeshed type stubs at this location\n' +
        '  -v,--venv-path DIRECTORY         Directory that contains virtual environments\n' +
        '  --verbose                        Emit verbose diagnostics\n' +
        '  --version                        Print Pyright version\n' +
        '  -w,--watch                       Continue to run and watch for changes\n'
    );
}

function printVersion() {
    const version = require('package.json').version;
    console.log(`${ toolName } ${ version.toString() }`);
}

function reportDiagnostics(fileDiagnostics: FileDiagnostics[]): DiagnosticResult {
    let errorCount = 0;
    let warningCount = 0;

    fileDiagnostics.forEach(fileDiagnostics => {
        // Don't report unused code diagnostics.
        const fileErrorsAndWarnings = fileDiagnostics.diagnostics.filter(
            diag => diag.category !== DiagnosticCategory.UnusedCode);

        if (fileErrorsAndWarnings.length > 0) {
            console.log(`${ fileDiagnostics.filePath }`);
            fileErrorsAndWarnings.forEach(diag => {
                let message = '  ';
                if (diag.range) {
                    message += chalk.yellow(`${ diag.range.start.line + 1 }`) + ':' +
                        chalk.yellow(`${ diag.range.start.column + 1 }`) + ' - ';
                }

                message += diag.category === DiagnosticCategory.Error ?
                    chalk.red('error') : chalk.green('warning');
                message += `: ${ diag.message }`;
                console.log(message);

                if (diag.category === DiagnosticCategory.Error) {
                    errorCount++;
                } else if (diag.category === DiagnosticCategory.Warning) {
                    warningCount++;
                }
            });
        }
    });

    console.log(
        `${ errorCount.toString() } ${ errorCount === 1 ? 'error' : 'errors' }, ` +
        `${ warningCount.toString() } ${ warningCount === 1 ? 'warning' : 'warnings' } `);

    return {
        errorCount,
        warningCount,
        diagnosticCount: errorCount + warningCount
    };
}

processArgs();
