/*
 * pyright.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Command-line entry point for pyright type checker.
 */

// Add the start timer at the very top of the file, before we import other modules.

/* eslint-disable */
import { timingStats } from './common/timing';
/* eslint-enable */

import chalk from 'chalk';
import commandLineArgs from 'command-line-args';
import { CommandLineOptions, OptionDefinition } from 'command-line-args';

import { PackageTypeVerifier } from './analyzer/packageTypeVerifier';
import { AnalyzerService } from './analyzer/service';
import { CommandLineOptions as PyrightCommandLineOptions } from './common/commandLineOptions';
import { LogLevel, StandardConsoleWithLevel, StderrConsoleWithLevel } from './common/console';
import { Diagnostic, DiagnosticCategory } from './common/diagnostic';
import { FileDiagnostics } from './common/diagnosticSink';
import { combinePaths, normalizePath } from './common/pathUtils';
import { createFromRealFileSystem } from './common/realFileSystem';
import { isEmptyRange, Range } from './common/textRange';
import { versionFromString } from './common/pythonVersion';
import { PyrightFileSystem } from './pyrightFileSystem';
import { PackageTypeReport, TypeKnownStatus } from './analyzer/packageTypeReport';
import { createDeferred } from './common/deferred';
import { FullAccessHost } from './common/fullAccessHost';
import { ChokidarFileWatcherProvider } from './common/chokidarFileWatcherProvider';

const toolName = 'pyright';

enum ExitStatus {
    NoErrors = 0,
    ErrorsReported = 1,
    FatalError = 2,
    ConfigFileParseError = 3,
    ParameterError = 4,
}

interface PyrightJsonResults {
    version: string;
    time: string;
    generalDiagnostics: PyrightJsonDiagnostic[];
    summary: PyrightJsonSummary;
    typeCompleteness?: PyrightTypeCompletenessReport;
}

interface PyrightSymbolCount {
    withKnownType: number;
    withAmbiguousType: number;
    withUnknownType: number;
}

interface PyrightTypeCompletenessReport {
    packageName: string;
    ignoreUnknownTypesFromImports: boolean;
    packageRootDirectory?: string | undefined;
    pyTypedPath?: string | undefined;
    exportedSymbolCounts: PyrightSymbolCount;
    otherSymbolCounts: PyrightSymbolCount;
    missingFunctionDocStringCount: number;
    missingClassDocStringCount: number;
    missingDefaultParamCount: number;
    completenessScore: number;
    modules: PyrightPublicModuleReport[];
    symbols: PyrightPublicSymbolReport[];
}

interface PyrightPublicModuleReport {
    name: string;
}

interface PyrightPublicSymbolReport {
    category: string;
    name: string;
    referenceCount: number;
    isTypeKnown: boolean;
    isTypeAmbiguous: boolean;
    isExported: boolean;
    diagnostics: PyrightJsonDiagnostic[];
    alternateNames?: string[] | undefined;
}

interface PyrightJsonDiagnostic {
    file: string;
    severity: 'error' | 'warning' | 'information';
    message: string;
    range?: Range | undefined;
    rule?: string | undefined;
}

interface PyrightJsonSummary {
    filesAnalyzed: number;
    errorCount: number;
    warningCount: number;
    informationCount: number;
    timeInSec: number;
}

interface DiagnosticResult {
    errorCount: number;
    warningCount: number;
    informationCount: number;
    diagnosticCount: number;
}

const cancellationNone = Object.freeze({
    isCancellationRequested: false,
    onCancellationRequested: function () {
        return {
            dispose() {
                /* empty */
            },
        };
    },
});

async function processArgs(): Promise<ExitStatus> {
    const optionDefinitions: OptionDefinition[] = [
        { name: 'createstub', type: String },
        { name: 'dependencies', type: Boolean },
        { name: 'files', type: String, multiple: true, defaultOption: true },
        { name: 'help', alias: 'h', type: Boolean },
        { name: 'ignoreexternal', type: Boolean },
        { name: 'lib', type: Boolean },
        { name: 'outputjson', type: Boolean },
        { name: 'project', alias: 'p', type: String },
        { name: 'pythonplatform', type: String },
        { name: 'pythonversion', type: String },
        { name: 'skipunannotated', type: Boolean },
        { name: 'stats', type: Boolean },
        { name: 'typeshed-path', alias: 't', type: String },
        { name: 'venv-path', alias: 'v', type: String },
        { name: 'verifytypes', type: String },
        { name: 'verbose', type: Boolean },
        { name: 'version', type: Boolean },
        { name: 'warnings', type: Boolean },
        { name: 'watch', alias: 'w', type: Boolean },
    ];

    let args: CommandLineOptions;

    try {
        args = commandLineArgs(optionDefinitions);
    } catch (e: any) {
        const argErr: { name: string; optionName: string } = e;
        if (argErr && argErr.optionName) {
            console.error(`Unexpected option ${argErr.optionName}.\n${toolName} --help for usage`);
            return ExitStatus.ParameterError;
        }

        console.error(`Unexpected error\n${toolName} --help for usage`);
        return ExitStatus.ParameterError;
    }

    if (args.help !== undefined) {
        printUsage();
        return ExitStatus.NoErrors;
    }

    if (args.version !== undefined) {
        printVersion();
        return ExitStatus.NoErrors;
    }

    for (const [arg, value] of Object.entries(args)) {
        if (value === null) {
            console.error(`'${arg}' option requires a value`);
            return ExitStatus.ParameterError;
        }
    }

    if (args.outputjson) {
        const incompatibleArgs = ['stats', 'verbose', 'createstub', 'dependencies'];
        for (const arg of incompatibleArgs) {
            if (args[arg] !== undefined) {
                console.error(`'outputjson' option cannot be used with '${arg}' option`);
                return ExitStatus.ParameterError;
            }
        }
    }

    if (args['verifytypes'] !== undefined) {
        const incompatibleArgs = ['watch', 'stats', 'createstub', 'dependencies', 'skipunannotated'];
        for (const arg of incompatibleArgs) {
            if (args[arg] !== undefined) {
                console.error(`'verifytypes' option cannot be used with '${arg}' option`);
                return ExitStatus.ParameterError;
            }
        }
    }

    if (args.createstub) {
        const incompatibleArgs = ['watch', 'stats', 'verifytypes', 'dependencies', 'skipunannotated'];
        for (const arg of incompatibleArgs) {
            if (args[arg] !== undefined) {
                console.error(`'createstub' option cannot be used with '${arg}' option`);
                return ExitStatus.ParameterError;
            }
        }
    }

    const options = new PyrightCommandLineOptions(process.cwd(), false);

    // Assume any relative paths are relative to the working directory.
    if (args.files && Array.isArray(args.files)) {
        options.fileSpecs = args.files;
        options.fileSpecs = options.fileSpecs.map((f) => combinePaths(process.cwd(), f));
    } else {
        options.fileSpecs = [];
    }

    if (args.project) {
        options.configFilePath = combinePaths(process.cwd(), normalizePath(args.project));
    }

    if (args.pythonplatform) {
        if (args.pythonplatform === 'Darwin' || args.pythonplatform === 'Linux' || args.pythonplatform === 'Windows') {
            options.pythonPlatform = args.pythonplatform;
        } else {
            console.error(
                `'${args.pythonplatform}' is not a supported Python platform; specify Darwin, Linux, or Windows`
            );
            return ExitStatus.ParameterError;
        }
    }

    if (args.pythonversion) {
        const version = versionFromString(args.pythonversion);
        if (version) {
            options.pythonVersion = version;
        } else {
            console.error(`'${args.pythonversion}' is not a supported Python version; specify 3.3, 3.4, etc.`);
            return ExitStatus.ParameterError;
        }
    }

    if (args['venv-path']) {
        options.venvPath = combinePaths(process.cwd(), normalizePath(args['venv-path']));
    }

    if (args['typeshed-path']) {
        options.typeshedPath = combinePaths(process.cwd(), normalizePath(args['typeshed-path']));
    }

    if (args.createstub) {
        options.typeStubTargetImportName = args.createstub;
    }

    options.analyzeUnannotatedFunctions = !args.skipunannotated;

    if (args.verbose) {
        options.verboseOutput = true;
    }

    if (args.lib) {
        options.useLibraryCodeForTypes = true;
    }

    options.checkOnlyOpenFiles = false;

    if (!!args.stats && !!args.verbose) {
        options.logTypeEvaluationTime = true;
    }

    const treatWarningsAsErrors = !!args.warnings;
    const logLevel = options.logTypeEvaluationTime ? LogLevel.Log : LogLevel.Error;

    // If using outputjson, redirect all console output to stderr so it doesn't mess
    // up the JSON output, which goes to stdout.
    const output = args.outputjson ? new StderrConsoleWithLevel(logLevel) : new StandardConsoleWithLevel(logLevel);
    const fileSystem = new PyrightFileSystem(createFromRealFileSystem(output, new ChokidarFileWatcherProvider(output)));

    // The package type verification uses a different path.
    if (args['verifytypes'] !== undefined) {
        return verifyPackageTypes(
            fileSystem,
            args['verifytypes'] || '',
            !!args.verbose,
            !!args.outputjson,
            args['ignoreexternal']
        );
    } else if (args['ignoreexternal'] !== undefined) {
        console.error(`'--ignoreexternal' is valid only when used with '--verifytypes'`);
        return ExitStatus.ParameterError;
    }

    const watch = args.watch !== undefined;
    options.watchForSourceChanges = watch;
    options.watchForConfigChanges = watch;

    const service = new AnalyzerService('<default>', fileSystem, output, () => new FullAccessHost(fileSystem));
    const exitStatus = createDeferred<ExitStatus>();

    service.setCompletionCallback((results) => {
        if (results.fatalErrorOccurred) {
            exitStatus.resolve(ExitStatus.FatalError);
            return;
        }

        if (results.configParseErrorOccurred) {
            exitStatus.resolve(ExitStatus.ConfigFileParseError);
            return;
        }

        let errorCount = 0;
        if (results.diagnostics.length > 0 && !args.createstub && !args['verifytypes']) {
            if (args.outputjson) {
                const report = reportDiagnosticsAsJson(
                    results.diagnostics,
                    results.filesInProgram,
                    results.elapsedTime
                );
                errorCount += report.errorCount;
                if (treatWarningsAsErrors) {
                    errorCount += report.warningCount;
                }
            } else {
                const report = reportDiagnosticsAsText(results.diagnostics);
                errorCount += report.errorCount;
                if (treatWarningsAsErrors) {
                    errorCount += report.warningCount;
                }
            }
        }

        if (args.createstub && results.filesRequiringAnalysis === 0) {
            try {
                service.writeTypeStub(cancellationNone);
                service.dispose();
                console.log(`Type stub was created for '${args.createstub}'`);
            } catch (err) {
                let errMessage = '';
                if (err instanceof Error) {
                    errMessage = ': ' + err.message;
                }

                console.error(`Error occurred when creating type stub: ` + errMessage);
                exitStatus.resolve(ExitStatus.FatalError);
                return;
            }
            exitStatus.resolve(ExitStatus.NoErrors);
            return;
        }

        if (!args.outputjson) {
            if (!watch) {
                // Print the total time.
                timingStats.printSummary(console);
            }

            if (args.stats) {
                // Print the stats details.
                service.printStats();
                timingStats.printDetails(console);
            }

            if (args.dependencies) {
                service.printDependencies(!!args.verbose);
            }
        }

        if (!watch) {
            exitStatus.resolve(errorCount > 0 ? ExitStatus.ErrorsReported : ExitStatus.NoErrors);
            return;
        } else if (!args.outputjson) {
            console.log('Watching for file changes...');
        }
    });

    // This will trigger the analyzer.
    service.setOptions(options);

    return await exitStatus.promise;
}

function verifyPackageTypes(
    fileSystem: PyrightFileSystem,
    packageName: string,
    verboseOutput: boolean,
    outputJson: boolean,
    ignoreUnknownTypesFromImports: boolean
): ExitStatus {
    try {
        const verifier = new PackageTypeVerifier(fileSystem, packageName, ignoreUnknownTypesFromImports);
        const report = verifier.verify();
        const jsonReport = buildTypeCompletenessReport(packageName, report);

        if (outputJson) {
            console.log(JSON.stringify(jsonReport, undefined, 4));
        } else {
            printTypeCompletenessReportText(jsonReport, verboseOutput);
        }

        return jsonReport.typeCompleteness!.completenessScore < 1 ? ExitStatus.ErrorsReported : ExitStatus.NoErrors;
    } catch (err) {
        let errMessage = '';
        if (err instanceof Error) {
            errMessage = ': ' + err.message;
        }

        console.error(`Error occurred when verifying types: ` + errMessage);
        return ExitStatus.FatalError;
    }
}

function accumulateReportDiagnosticStats(diag: PyrightJsonDiagnostic, report: PyrightJsonResults) {
    if (diag.severity === 'error') {
        report.summary.errorCount++;
    } else if (diag.severity === 'warning') {
        report.summary.warningCount++;
    } else if (diag.severity === 'information') {
        report.summary.informationCount++;
    }
}

function buildTypeCompletenessReport(packageName: string, completenessReport: PackageTypeReport): PyrightJsonResults {
    const report: PyrightJsonResults = {
        version: getVersionString(),
        time: Date.now().toString(),
        generalDiagnostics: [],
        summary: {
            filesAnalyzed: completenessReport.modules.size,
            errorCount: 0,
            warningCount: 0,
            informationCount: 0,
            timeInSec: timingStats.getTotalDuration(),
        },
    };

    // Add the general diagnostics.
    completenessReport.generalDiagnostics.forEach((diag) => {
        const jsonDiag = convertDiagnosticToJson('', diag);
        report.generalDiagnostics.push(jsonDiag);
        accumulateReportDiagnosticStats(jsonDiag, report);
    });

    report.typeCompleteness = {
        packageName,
        ignoreUnknownTypesFromImports: completenessReport.ignoreExternal,
        packageRootDirectory: completenessReport.rootDirectory,
        pyTypedPath: completenessReport.pyTypedPath,
        exportedSymbolCounts: {
            withKnownType: 0,
            withAmbiguousType: 0,
            withUnknownType: 0,
        },
        otherSymbolCounts: {
            withKnownType: 0,
            withAmbiguousType: 0,
            withUnknownType: 0,
        },
        missingFunctionDocStringCount: completenessReport.missingFunctionDocStringCount,
        missingClassDocStringCount: completenessReport.missingClassDocStringCount,
        missingDefaultParamCount: completenessReport.missingDefaultParamCount,
        completenessScore: 0,
        modules: [],
        symbols: [],
    };

    // Add the modules.
    completenessReport.modules.forEach((module) => {
        const jsonModule: PyrightPublicModuleReport = {
            name: module.name,
        };

        report.typeCompleteness!.modules.push(jsonModule);
    });

    // Add the symbols.
    completenessReport.symbols.forEach((symbol) => {
        const jsonSymbol: PyrightPublicSymbolReport = {
            category: PackageTypeVerifier.getSymbolCategoryString(symbol.category),
            name: symbol.fullName,
            referenceCount: symbol.referenceCount,
            isExported: symbol.isExported,
            isTypeKnown: symbol.typeKnownStatus === TypeKnownStatus.Known,
            isTypeAmbiguous: symbol.typeKnownStatus === TypeKnownStatus.Ambiguous,
            diagnostics: symbol.diagnostics.map((diag) => convertDiagnosticToJson(diag.filePath, diag.diagnostic)),
        };

        const alternateNames = completenessReport.alternateSymbolNames.get(symbol.fullName);
        if (alternateNames) {
            jsonSymbol.alternateNames = alternateNames;
        }

        report.typeCompleteness!.symbols.push(jsonSymbol);

        // Accumulate counts for report.
        if (symbol.typeKnownStatus === TypeKnownStatus.Known) {
            if (symbol.isExported) {
                report.typeCompleteness!.exportedSymbolCounts.withKnownType++;
            } else {
                report.typeCompleteness!.otherSymbolCounts.withKnownType++;
            }
        } else if (symbol.typeKnownStatus === TypeKnownStatus.Ambiguous) {
            if (symbol.isExported) {
                report.typeCompleteness!.exportedSymbolCounts.withAmbiguousType++;
            } else {
                report.typeCompleteness!.otherSymbolCounts.withAmbiguousType++;
            }
        } else {
            if (symbol.isExported) {
                report.typeCompleteness!.exportedSymbolCounts.withUnknownType++;
            } else {
                report.typeCompleteness!.otherSymbolCounts.withUnknownType++;
            }
        }
    });

    const unknownSymbolCount = report.typeCompleteness.exportedSymbolCounts.withUnknownType;
    const ambiguousSymbolCount = report.typeCompleteness.exportedSymbolCounts.withAmbiguousType;
    const knownSymbolCount = report.typeCompleteness.exportedSymbolCounts.withKnownType;
    const totalSymbolCount = unknownSymbolCount + ambiguousSymbolCount + knownSymbolCount;

    if (totalSymbolCount > 0) {
        report.typeCompleteness!.completenessScore = knownSymbolCount / totalSymbolCount;
    }

    return report;
}

function printTypeCompletenessReportText(results: PyrightJsonResults, verboseOutput: boolean) {
    const completenessReport = results.typeCompleteness!;

    console.log(`Package name: "${completenessReport.packageName}"`);
    if (completenessReport.packageRootDirectory !== undefined) {
        console.log(`Package directory: "${completenessReport.packageRootDirectory}"`);
    }

    if (completenessReport.pyTypedPath !== undefined) {
        console.log(`Path of py.typed file: "${completenessReport.pyTypedPath}"`);
    }

    // Print list of public modules.
    if (completenessReport.modules.length > 0) {
        console.log('');
        console.log(`Public modules: ${completenessReport.modules.length}`);
        completenessReport.modules.forEach((module) => {
            console.log(`   ${module.name}`);
        });
    }

    // Print list of all symbols.
    if (completenessReport.symbols.length > 0 && verboseOutput) {
        console.log('');
        console.log(`Exported symbols: ${completenessReport.symbols.filter((sym) => sym.isExported).length}`);
        completenessReport.symbols.forEach((symbol) => {
            if (symbol.isExported) {
                const refCount = symbol.referenceCount > 1 ? ` (${symbol.referenceCount} references)` : '';
                console.log(`   ${symbol.name}${refCount}`);
            }
        });

        console.log('');
        console.log(`Other referenced symbols: ${completenessReport.symbols.filter((sym) => !sym.isExported).length}`);
        completenessReport.symbols.forEach((symbol) => {
            if (!symbol.isExported) {
                const refCount = symbol.referenceCount > 1 ? ` (${symbol.referenceCount} references)` : '';
                console.log(`   ${symbol.name}${refCount}`);
            }
        });
    }

    // Print all the general diagnostics.
    results.generalDiagnostics.forEach((diag) => {
        logDiagnosticToConsole(diag);
    });

    // Print all the symbol-specific diagnostics.
    console.log('');
    console.log(`Symbols used in public interface:`);
    results.typeCompleteness!.symbols.forEach((symbol) => {
        let diagnostics = symbol.diagnostics;
        if (!verboseOutput) {
            diagnostics = diagnostics.filter((diag) => diag.severity === 'error');
        }
        if (diagnostics.length > 0) {
            console.log(`${symbol.name}`);
            diagnostics.forEach((diag) => {
                logDiagnosticToConsole(diag);
            });
        }
    });

    // Print other stats.
    console.log('');
    console.log(
        `Symbols exported by "${completenessReport.packageName}": ${
            completenessReport.exportedSymbolCounts.withKnownType +
            completenessReport.exportedSymbolCounts.withAmbiguousType +
            completenessReport.exportedSymbolCounts.withUnknownType
        }`
    );
    console.log(`  With known type: ${completenessReport.exportedSymbolCounts.withKnownType}`);
    console.log(`  With ambiguous type: ${completenessReport.exportedSymbolCounts.withAmbiguousType}`);
    console.log(`  With unknown type: ${completenessReport.exportedSymbolCounts.withUnknownType}`);
    if (completenessReport.ignoreUnknownTypesFromImports) {
        console.log(`    (Ignoring unknown types imported from other packages)`);
    }
    console.log(`  Functions without docstring: ${completenessReport.missingFunctionDocStringCount}`);
    console.log(`  Functions without default param: ${completenessReport.missingDefaultParamCount}`);
    console.log(`  Classes without docstring: ${completenessReport.missingClassDocStringCount}`);
    console.log('');
    console.log(
        `Other symbols referenced but not exported by "${completenessReport.packageName}": ${
            completenessReport.otherSymbolCounts.withKnownType +
            completenessReport.otherSymbolCounts.withAmbiguousType +
            completenessReport.otherSymbolCounts.withUnknownType
        }`
    );
    console.log(`  With known type: ${completenessReport.otherSymbolCounts.withKnownType}`);
    console.log(`  With ambiguous type: ${completenessReport.otherSymbolCounts.withAmbiguousType}`);
    console.log(`  With unknown type: ${completenessReport.otherSymbolCounts.withUnknownType}`);
    console.log('');
    console.log(`Type completeness score: ${Math.round(completenessReport.completenessScore * 1000) / 10}%`);
    console.log('');
    console.info(`Completed in ${results.summary.timeInSec}sec`);
    console.log('');
}

function printUsage() {
    console.log(
        'Usage: ' +
            toolName +
            ' [options] files...\n' +
            '  Options:\n' +
            '  --createstub <IMPORT>              Create type stub file(s) for import\n' +
            '  --dependencies                     Emit import dependency information\n' +
            '  -h,--help                          Show this help message\n' +
            '  --ignoreexternal                   Ignore external imports for --verifytypes\n' +
            '  --lib                              Use library code to infer types when stubs are missing\n' +
            '  --outputjson                       Output results in JSON format\n' +
            '  -p,--project <FILE OR DIRECTORY>   Use the configuration file at this location\n' +
            '  --pythonplatform <PLATFORM>        Analyze for a specific platform (Darwin, Linux, Windows)\n' +
            '  --pythonversion <VERSION>          Analyze for a specific version (3.3, 3.4, etc.)\n' +
            '  --skipunannotated                  Do not analyze functions and methods with no type annotations\n' +
            '  --stats                            Print detailed performance stats\n' +
            '  -t,--typeshed-path <DIRECTORY>     Use typeshed type stubs at this location\n' +
            '  -v,--venv-path <DIRECTORY>         Directory that contains virtual environments\n' +
            '  --verbose                          Emit verbose diagnostics\n' +
            '  --verifytypes <PACKAGE>            Verify type completeness of a py.typed package\n' +
            '  --version                          Print Pyright version\n' +
            '  --warnings                         Use exit code of 1 if warnings are reported\n' +
            '  -w,--watch                         Continue to run and watch for changes\n'
    );
}

function getVersionString() {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const version = require('../package.json').version;
    return version.toString();
}

function printVersion() {
    console.log(`${toolName} ${getVersionString()}`);
}

function reportDiagnosticsAsJson(
    fileDiagnostics: FileDiagnostics[],
    filesInProgram: number,
    timeInSec: number
): DiagnosticResult {
    const report: PyrightJsonResults = {
        version: getVersionString(),
        time: Date.now().toString(),
        generalDiagnostics: [],
        summary: {
            filesAnalyzed: filesInProgram,
            errorCount: 0,
            warningCount: 0,
            informationCount: 0,
            timeInSec,
        },
    };

    fileDiagnostics.forEach((fileDiag) => {
        fileDiag.diagnostics.forEach((diag) => {
            if (
                diag.category === DiagnosticCategory.Error ||
                diag.category === DiagnosticCategory.Warning ||
                diag.category === DiagnosticCategory.Information
            ) {
                const jsonDiag = convertDiagnosticToJson(fileDiag.filePath, diag);
                report.generalDiagnostics.push(jsonDiag);
                accumulateReportDiagnosticStats(jsonDiag, report);
            }
        });
    });

    console.log(JSON.stringify(report, undefined, 4));

    return {
        errorCount: report.summary.errorCount,
        warningCount: report.summary.warningCount,
        informationCount: report.summary.informationCount,
        diagnosticCount: report.summary.errorCount + report.summary.warningCount + report.summary.informationCount,
    };
}

function convertDiagnosticToJson(filePath: string, diag: Diagnostic): PyrightJsonDiagnostic {
    return {
        file: filePath,
        severity:
            diag.category === DiagnosticCategory.Error
                ? 'error'
                : diag.category === DiagnosticCategory.Warning
                ? 'warning'
                : 'information',
        message: diag.message,
        range: isEmptyRange(diag.range) ? undefined : diag.range,
        rule: diag.getRule(),
    };
}

function reportDiagnosticsAsText(fileDiagnostics: FileDiagnostics[]): DiagnosticResult {
    let errorCount = 0;
    let warningCount = 0;
    let informationCount = 0;

    fileDiagnostics.forEach((fileDiagnostics) => {
        // Don't report unused code or deprecated diagnostics.
        const fileErrorsAndWarnings = fileDiagnostics.diagnostics.filter(
            (diag) => diag.category !== DiagnosticCategory.UnusedCode && diag.category !== DiagnosticCategory.Deprecated
        );

        if (fileErrorsAndWarnings.length > 0) {
            console.log(`${fileDiagnostics.filePath}`);
            fileErrorsAndWarnings.forEach((diag) => {
                logDiagnosticToConsole(convertDiagnosticToJson(fileDiagnostics.filePath, diag));

                if (diag.category === DiagnosticCategory.Error) {
                    errorCount++;
                } else if (diag.category === DiagnosticCategory.Warning) {
                    warningCount++;
                } else if (diag.category === DiagnosticCategory.Information) {
                    informationCount++;
                }
            });
        }
    });

    console.log(
        `${errorCount.toString()} ${errorCount === 1 ? 'error' : 'errors'}, ` +
            `${warningCount.toString()} ${warningCount === 1 ? 'warning' : 'warnings'}, ` +
            `${informationCount.toString()} ${informationCount === 1 ? 'information' : 'informations'} `
    );

    return {
        errorCount,
        warningCount,
        informationCount,
        diagnosticCount: errorCount + warningCount + informationCount,
    };
}

function logDiagnosticToConsole(diag: PyrightJsonDiagnostic, prefix = '  ') {
    let message = prefix;
    if (diag.file) {
        message += `${diag.file}:`;
    }
    if (diag.range && !isEmptyRange(diag.range)) {
        message +=
            chalk.yellow(`${diag.range.start.line + 1}`) +
            ':' +
            chalk.yellow(`${diag.range.start.character + 1}`) +
            ' - ';
    }

    const [firstLine, ...remainingLines] = diag.message.split('\n');

    message +=
        diag.severity === 'error'
            ? chalk.red('error')
            : diag.severity === 'warning'
            ? chalk.cyan('warning')
            : chalk.blue('information');
    message += `: ${firstLine}`;
    if (remainingLines.length > 0) {
        message += '\n' + prefix + remainingLines.join('\n' + prefix);
    }

    if (diag.rule) {
        message += chalk.gray(` (${diag.rule})`);
    }

    console.log(message);
}

export async function main() {
    if (process.env.NODE_ENV === 'production') {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        require('source-map-support').install();
    }

    const exitCode = await processArgs();
    process.exitCode = exitCode;
    // Don't call process.exit; stdout may not have been flushed which can break readers.
    // https://github.com/nodejs/node/issues/6379
    // https://github.com/nodejs/node/issues/6456
    // https://github.com/nodejs/node/issues/19218
}
