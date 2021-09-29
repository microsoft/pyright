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

import { AnalyzerFileInfo } from '../analyzer/analyzerFileInfo';
import { Binder } from '../analyzer/binder';
import { ImportResolver } from '../analyzer/importResolver';
import { Program } from '../analyzer/program';
import { NameTypeWalker, TestWalker } from '../analyzer/testWalker';
import { TypeEvaluator } from '../analyzer/typeEvaluatorTypes';
import { cloneDiagnosticRuleSet, ConfigOptions, ExecutionEnvironment } from '../common/configOptions';
import { fail } from '../common/debug';
import { Diagnostic, DiagnosticCategory } from '../common/diagnostic';
import { DiagnosticSink, TextRangeDiagnosticSink } from '../common/diagnosticSink';
import { FullAccessHost } from '../common/fullAccessHost';
import { createFromRealFileSystem } from '../common/realFileSystem';
import { ParseOptions, Parser, ParseResults } from '../parser/parser';

// This is a bit gross, but it's necessary to allow the fallback typeshed
// directory to be located when running within the jest environment. This
// assumes that the working directory has been set appropriately before
// running the tests.
(global as any).__rootDirectory = path.resolve();

export interface FileAnalysisResult {
    filePath: string;
    parseResults?: ParseResults | undefined;
    errors: Diagnostic[];
    warnings: Diagnostic[];
    infos: Diagnostic[];
    unusedCodes: Diagnostic[];
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
        '.',
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

export function buildAnalyzerFileInfo(
    filePath: string,
    fileContents: string,
    parseResults: ParseResults,
    configOptions: ConfigOptions
): AnalyzerFileInfo {
    const analysisDiagnostics = new TextRangeDiagnosticSink(parseResults.tokenizerOutput.lines);

    const fileInfo: AnalyzerFileInfo = {
        importLookup: (_) => undefined,
        futureImports: new Map<string, boolean>(),
        builtinsScope: undefined,
        diagnosticSink: analysisDiagnostics,
        executionEnvironment: configOptions.findExecEnvironment(filePath),
        diagnosticRuleSet: cloneDiagnosticRuleSet(configOptions.diagnosticRuleSet),
        fileContents,
        lines: parseResults.tokenizerOutput.lines,
        filePath,
        moduleName: '',
        isStubFile: filePath.endsWith('.pyi'),
        isTypingStubFile: false,
        isInPyTypedPackage: false,
        isTypingExtensionsStubFile: false,
        isBuiltInStubFile: false,
        accessedSymbolMap: new Map<number, true>(),
    };

    return fileInfo;
}

export function bindSampleFile(fileName: string, configOptions = new ConfigOptions('.')): FileAnalysisResult {
    const diagSink = new DiagnosticSink();
    const filePath = resolveSampleFilePath(fileName);
    const execEnvironment = configOptions.findExecEnvironment(filePath);
    const parseInfo = parseSampleFile(fileName, diagSink, execEnvironment);

    const fileInfo = buildAnalyzerFileInfo(filePath, parseInfo.fileContents, parseInfo.parseResults, configOptions);
    const binder = new Binder(fileInfo);
    binder.bindModule(parseInfo.parseResults.parseTree);

    // Walk the AST to verify internal consistency.
    const testWalker = new TestWalker();
    testWalker.walk(parseInfo.parseResults.parseTree);

    return {
        filePath,
        parseResults: parseInfo.parseResults,
        errors: fileInfo.diagnosticSink.getErrors(),
        warnings: fileInfo.diagnosticSink.getWarnings(),
        infos: fileInfo.diagnosticSink.getInformation(),
        unusedCodes: fileInfo.diagnosticSink.getUnusedCode(),
        deprecateds: fileInfo.diagnosticSink.getDeprecated(),
    };
}

export function typeAnalyzeSampleFiles(
    fileNames: string[],
    configOptions = new ConfigOptions('.')
): FileAnalysisResult[] {
    // Always enable "test mode".
    configOptions.internalTestMode = true;

    const fs = createFromRealFileSystem();
    const importResolver = new ImportResolver(fs, configOptions, new FullAccessHost(fs));

    const program = new Program(importResolver, configOptions);
    const filePaths = fileNames.map((name) => resolveSampleFilePath(name));
    program.setTrackedFiles(filePaths);

    // Set a "pre-check callback" so we can evaluate the types of each NameNode
    // prior to checking the full document.This will exercise the contextual
    // evaluation logic.
    program.setPreCheckCallback((parseResults: ParseResults, evaluator: TypeEvaluator) => {
        const nameTypeWalker = new NameTypeWalker(evaluator);
        nameTypeWalker.walk(parseResults.parseTree);
    });

    while (program.analyze()) {
        // Continue to call analyze until it completes. Since we're not
        // specifying a timeout, it should complete the first time.
    }

    const sourceFiles = filePaths.map((filePath) => program.getSourceFile(filePath));
    return sourceFiles.map((sourceFile, index) => {
        if (sourceFile) {
            const diagnostics = sourceFile.getDiagnostics(configOptions) || [];
            const analysisResult: FileAnalysisResult = {
                filePath: sourceFile.getFilePath(),
                parseResults: sourceFile.getParseResults(),
                errors: diagnostics.filter((diag) => diag.category === DiagnosticCategory.Error),
                warnings: diagnostics.filter((diag) => diag.category === DiagnosticCategory.Warning),
                infos: diagnostics.filter((diag) => diag.category === DiagnosticCategory.Information),
                unusedCodes: diagnostics.filter((diag) => diag.category === DiagnosticCategory.UnusedCode),
                deprecateds: diagnostics.filter((diag) => diag.category === DiagnosticCategory.Deprecated),
            };
            return analysisResult;
        } else {
            fail(`Source file not found for ${filePaths[index]}`);

            const analysisResult: FileAnalysisResult = {
                filePath: '',
                parseResults: undefined,
                errors: [],
                warnings: [],
                infos: [],
                unusedCodes: [],
                deprecateds: [],
            };
            return analysisResult;
        }
    });
}

export function printDiagnostics(fileResults: FileAnalysisResult) {
    if (fileResults.errors.length > 0) {
        console.error(`Errors in ${fileResults.filePath}:`);
        for (const diag of fileResults.errors) {
            console.error(`  ${diag.message}`);
        }
    }

    if (fileResults.warnings.length > 0) {
        console.error(`Warnings in ${fileResults.filePath}:`);
        for (const diag of fileResults.warnings) {
            console.error(`  ${diag.message}`);
        }
    }
}

export function validateResults(
    results: FileAnalysisResult[],
    errorCount: number,
    warningCount = 0,
    infoCount?: number,
    unusedCode?: number,
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

    if (deprecated !== undefined) {
        assert.strictEqual(results[0].deprecateds.length, deprecated);
    }
}
