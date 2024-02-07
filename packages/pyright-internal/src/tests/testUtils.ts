/*
 * testUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Utility functions that are common to a bunch of the tests.
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { ImportResolver } from '../analyzer/importResolver';
import { Program } from '../analyzer/program';
import { NameTypeWalker } from '../analyzer/testWalker';
import { TypeEvaluator } from '../analyzer/typeEvaluatorTypes';
import { ConfigOptions, ExecutionEnvironment } from '../common/configOptions';
import { ConsoleWithLogLevel, NullConsole } from '../common/console';
import { fail } from '../common/debug';
import { Diagnostic, DiagnosticCategory } from '../common/diagnostic';
import { DiagnosticSink } from '../common/diagnosticSink';
import { FullAccessHost } from '../common/fullAccessHost';
import { createFromRealFileSystem } from '../common/realFileSystem';
import { createServiceProvider } from '../common/serviceProviderExtensions';
import { Uri } from '../common/uri/uri';
import { ParseOptions, ParseResults, Parser } from '../parser/parser';
import { throwIfUndefined } from 'throw-expression';
import { entries } from '@detachhead/ts-helpers/dist/functions/misc';
import { zip } from 'lodash';
import { DiagnosticRule } from '../common/diagnosticRules';

// This is a bit gross, but it's necessary to allow the fallback typeshed
// directory to be located when running within the jest environment. This
// assumes that the working directory has been set appropriately before
// running the tests.
(global as any).__rootDirectory = path.resolve();

export interface FileAnalysisResult {
    fileUri: Uri;
    parseResults?: ParseResults | undefined;
    errors: Diagnostic[];
    warnings: Diagnostic[];
    infos: Diagnostic[];
    unusedCodes: Diagnostic[];
    unreachableCodes: Diagnostic[];
    deprecateds: Diagnostic[];
}

export interface FileParseResult {
    fileContents: string;
    parseResults: ParseResults;
}

export function resolveSampleFilePath(fileName: string): string {
    return path.resolve(path.dirname(module.filename), `./samples/${fileName}`);
}

export function readSampleFile(fileName: string): string {
    const filePath = resolveSampleFilePath(fileName);

    try {
        return fs.readFileSync(filePath, { encoding: 'utf8' });
    } catch {
        console.error(`Could not read file "${fileName}"`);
        return '';
    }
}

export function parseText(
    textToParse: string,
    diagSink: DiagnosticSink,
    parseOptions: ParseOptions = new ParseOptions()
): ParseResults {
    const parser = new Parser();
    return parser.parseSourceFile(textToParse, parseOptions, diagSink);
}

export function parseSampleFile(
    fileName: string,
    diagSink: DiagnosticSink,
    execEnvironment = new ExecutionEnvironment(
        'python',
        Uri.file('.'),
        /* defaultPythonVersion */ undefined,
        /* defaultPythonPlatform */ undefined,
        /* defaultExtraPaths */ undefined
    )
): FileParseResult {
    const text = readSampleFile(fileName);
    const parseOptions = new ParseOptions();
    if (fileName.endsWith('pyi')) {
        parseOptions.isStubFile = true;
    }
    parseOptions.pythonVersion = execEnvironment.pythonVersion;

    return {
        fileContents: text,
        parseResults: parseText(text, diagSink),
    };
}

export function typeAnalyzeSampleFiles(
    fileNames: string[],
    configOptions = new ConfigOptions(Uri.empty()),
    console?: ConsoleWithLogLevel
): FileAnalysisResult[] {
    // Always enable "test mode".
    configOptions.internalTestMode = true;

    if (configOptions.typeCheckingMode === undefined) {
        configOptions.typeCheckingMode = 'standard';
    }
    const fs = createFromRealFileSystem();
    const serviceProvider = createServiceProvider(fs, console || new NullConsole());
    const importResolver = new ImportResolver(serviceProvider, configOptions, new FullAccessHost(serviceProvider));

    const program = new Program(importResolver, configOptions, serviceProvider);
    const fileUris = fileNames.map((name) => Uri.file(resolveSampleFilePath(name)));
    program.setTrackedFiles(fileUris);

    // Set a "pre-check callback" so we can evaluate the types of each NameNode
    // prior to checking the full document. This will exercise the contextual
    // evaluation logic.
    program.setPreCheckCallback((parseResults: ParseResults, evaluator: TypeEvaluator) => {
        const nameTypeWalker = new NameTypeWalker(evaluator);
        nameTypeWalker.walk(parseResults.parseTree);
    });

    const results = getAnalysisResults(program, fileUris, configOptions);

    program.dispose();
    return results;
}

export function getAnalysisResults(
    program: Program,
    fileUris: Uri[],
    configOptions = new ConfigOptions(Uri.empty())
): FileAnalysisResult[] {
    // Always enable "test mode".
    configOptions.internalTestMode = true;

    while (program.analyze()) {
        // Continue to call analyze until it completes. Since we're not
        // specifying a timeout, it should complete the first time.
    }

    const sourceFiles = fileUris.map((filePath) => program.getSourceFile(filePath));
    return sourceFiles.map((sourceFile, index) => {
        if (sourceFile) {
            const diagnostics = sourceFile.getDiagnostics(configOptions) || [];
            const analysisResult: FileAnalysisResult = {
                fileUri: sourceFile.getUri(),
                parseResults: sourceFile.getParseResults(),
                errors: diagnostics.filter((diag) => diag.category === DiagnosticCategory.Error),
                warnings: diagnostics.filter((diag) => diag.category === DiagnosticCategory.Warning),
                infos: diagnostics.filter((diag) => diag.category === DiagnosticCategory.Information),
                unusedCodes: diagnostics.filter((diag) => diag.category === DiagnosticCategory.UnusedCode),
                unreachableCodes: diagnostics.filter((diag) => diag.category === DiagnosticCategory.UnreachableCode),
                deprecateds: diagnostics.filter((diag) => diag.category === DiagnosticCategory.Deprecated),
            };
            return analysisResult;
        } else {
            fail(`Source file not found for ${fileUris[index]}`);

            const analysisResult: FileAnalysisResult = {
                fileUri: Uri.empty(),
                parseResults: undefined,
                errors: [],
                warnings: [],
                infos: [],
                unusedCodes: [],
                unreachableCodes: [],
                deprecateds: [],
            };
            return analysisResult;
        }
    });
}

export function printDiagnostics(fileResults: FileAnalysisResult) {
    if (fileResults.errors.length > 0) {
        console.error(`Errors in ${fileResults.fileUri}:`);
        for (const diag of fileResults.errors) {
            console.error(`  ${diag.message}`);
        }
    }

    if (fileResults.warnings.length > 0) {
        console.error(`Warnings in ${fileResults.fileUri}:`);
        for (const diag of fileResults.warnings) {
            console.error(`  ${diag.message}`);
        }
    }
}

/** @deprecated use {@link validateResultsButBased} instead */
export function validateResults(
    results: FileAnalysisResult[],
    errorCount: number,
    warningCount = 0,
    infoCount?: number,
    unusedCode?: number,
    unreachableCode?: number,
    deprecated?: number
) {
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].errors.length, errorCount);
    assert.strictEqual(results[0].warnings.length, warningCount);

    if (infoCount !== undefined) {
        assert.strictEqual(results[0].infos.length, infoCount);
    }

    if (unusedCode !== undefined) {
        assert.strictEqual(results[0].unusedCodes.length, unusedCode);
    }

    if (unreachableCode !== undefined) {
        assert.strictEqual(results[0].unreachableCodes.length, unreachableCode);
    }

    if (deprecated !== undefined) {
        assert.strictEqual(results[0].deprecateds.length, deprecated);
    }
}

export type ExpectedResults = {
    [key in Exclude<keyof FileAnalysisResult, 'fileUri' | 'parseResults'>]?: {
        message?: string;
        line: number;
        code?: DiagnosticRule;
    }[];
};

export const validateResultsButBased = (allResults: FileAnalysisResult[], expectedResults: ExpectedResults) => {
    assert.strictEqual(allResults.length, 1);
    const result = allResults[0];
    for (const [diagnosticType] of entries(result)) {
        if (diagnosticType === 'fileUri' || diagnosticType === 'parseResults') {
            continue;
        }
        const actualResult = result[diagnosticType];
        const expectedResult = expectedResults[diagnosticType] ?? [];
        assert.equal(actualResult.length, expectedResult.length);
        zip(expectedResult, actualResult).forEach(([expectedDiagnostic, actualDiagnostic]) => {
            // length checked above so these should never be undefined
            expectedDiagnostic = throwIfUndefined(expectedDiagnostic);
            actualDiagnostic = throwIfUndefined(actualDiagnostic);
            assert.deepStrictEqual(actualDiagnostic.getRule(), expectedDiagnostic.code);
            assert.deepStrictEqual(actualDiagnostic.range.start.line, expectedDiagnostic.line);
            if (expectedDiagnostic.message) {
                assert.deepStrictEqual(actualDiagnostic.message, expectedDiagnostic.message);
            }
        });
    }
};
