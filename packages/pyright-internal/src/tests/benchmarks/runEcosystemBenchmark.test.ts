/*
 * runEcosystemBenchmark.test.ts
 * Copyright (c) Microsoft Corporation.
 *
 * Tests for the ecosystem benchmark runner entry point.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { BenchmarkReport, benchmarkReportSchemaVersion } from './benchmarkUtils';
import {
    buildPyrightInvocation,
    buildEcosystemBenchmarkManifest,
    compareEcosystemBenchmarkReports,
    EcosystemBenchmarkResult,
    executePyrightProjectCommand,
    parseEcosystemBenchmarkArgs,
    runEcosystemBenchmark,
    writeEcosystemBenchmarkManifest,
} from './runEcosystemBenchmark';
import { GeneratedEcosystemProject } from './syncMypyPrimerProjects';

const RUN_BENCHMARKS_ENV = 'PYRIGHT_RUN_BENCHMARKS';

const benchmarkSuite = process.env[RUN_BENCHMARKS_ENV] === '1' ? describe : describe.skip;

benchmarkSuite('Ecosystem Benchmark Runner', () => {
    test('parses smoke runner arguments', () => {
        const config = parseEcosystemBenchmarkArgs([
            '--suite',
            'smoke',
            '--tag',
            'overloads',
            '--project',
            'pandas',
            '--num-shards',
            '2',
            '--shard-index',
            '1',
            '--project-date',
            '2026-01-01',
            '--output',
            'artifacts/ecosystem-smoke',
        ]);

        expect(config.mode).toBe('select');
        if (config.mode !== 'select') {
            throw new Error('Expected selection mode.');
        }

        expect(config.suiteName).toBe('smoke');
        expect(config.tag).toBe('overloads');
        expect(config.projectPattern?.source).toBe('pandas');
        expect(config.numShards).toBe(2);
        expect(config.shardIndex).toBe(1);
        expect(config.projectDate).toBe('2026-01-01');
        expect(config.outputDir).toBe('artifacts/ecosystem-smoke');
    });

    test('builds a filtered smoke manifest', () => {
        const config = parseEcosystemBenchmarkArgs(['--suite', 'smoke', '--tag', 'overloads', '--output', 'artifacts']);

        expect(config.mode).toBe('select');
        if (config.mode !== 'select') {
            throw new Error('Expected selection mode.');
        }

        const manifest = buildEcosystemBenchmarkManifest(config);

        expect(manifest.executionMode).toBe('selection-only');
        expect(manifest.selectedProjectCount).toBe(1);
        expect(manifest.selectedProjects.map((project) => project.name)).toEqual(['pandas']);
    });

    test('writes an ecosystem run manifest', () => {
        const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyright-ecosystem-runner-'));

        try {
            const config = parseEcosystemBenchmarkArgs([
                '--suite',
                'smoke',
                '--project',
                'django',
                '--output',
                outputDir,
            ]);

            expect(config.mode).toBe('select');
            if (config.mode !== 'select') {
                throw new Error('Expected selection mode.');
            }

            const manifest = buildEcosystemBenchmarkManifest(config);
            const manifestPath = writeEcosystemBenchmarkManifest(outputDir, manifest);

            expect(manifestPath).toBe(path.join(outputDir, 'ecosystem-run-manifest.json'));
            expect(JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))).toEqual(manifest);
        } finally {
            fs.rmSync(outputDir, { force: true, recursive: true });
        }
    });

    test('runs end to end and writes a manifest artifact', () => {
        const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyright-ecosystem-runner-main-'));

        try {
            const manifestPath = runEcosystemBenchmark([
                '--suite',
                'smoke',
                '--tag',
                'parser-heavy',
                '--output',
                outputDir,
            ]);

            expect(typeof manifestPath).toBe('string');

            const manifest = JSON.parse(fs.readFileSync(manifestPath as string, 'utf-8'));

            expect(manifest.selectedProjects.map((project: { name: string }) => project.name)).toEqual(['black']);
        } finally {
            fs.rmSync(outputDir, { force: true, recursive: true });
        }
    });

    test('rejects unsupported suite names', () => {
        expect(() => parseEcosystemBenchmarkArgs(['--suite', 'full', '--output', 'artifacts'])).toThrow(
            'Unsupported ecosystem benchmark suite'
        );
    });

    test('parses comparison mode arguments', () => {
        const config = parseEcosystemBenchmarkArgs([
            '--baseline-report',
            'old.json',
            '--candidate-report',
            'new.json',
            '--output',
            'artifacts',
        ]);

        expect(config).toEqual({
            mode: 'compare',
            baselineReportPath: 'old.json',
            candidateReportPath: 'new.json',
            outputDir: 'artifacts',
        });
    });

    test('parses execution mode arguments', () => {
        const config = parseEcosystemBenchmarkArgs([
            '--suite',
            'smoke',
            '--project-root',
            'q:/projects',
            '--baseline-executable',
            'node ./out/packages/pyright-internal/src/pyright.js',
            '--output',
            'artifacts',
        ]);

        expect(config).toEqual({
            mode: 'execute',
            suiteName: 'smoke',
            outputDir: 'artifacts',
            projectRoot: 'q:/projects',
            projectDate: undefined,
            tag: undefined,
            projectPattern: undefined,
            numShards: undefined,
            shardIndex: undefined,
            baselineExecutable: 'node ./out/packages/pyright-internal/src/pyright.js',
            candidateExecutable: undefined,
        });
    });

    test('builds a pyright invocation from project metadata', () => {
        const invocation = buildPyrightInvocation('node ./dist/pyright.js', {
            name: 'black',
            mypyPrimerProject: 'black',
            source: { kind: 'mypy-primer' },
            pyrightCommand: '{pyright} --lib {paths}',
            paths: ['src', 'tests'],
        });

        expect(invocation.command).toBe('node');
        expect(invocation.args).toEqual(['./dist/pyright.js', '--lib', 'src', 'tests', '--outputjson']);
    });

    test('executes a project command and captures benchmark results', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyright-ecosystem-execute-'));
        const workingDirectory = path.join(tempDir, 'black');
        const fakePyrightScriptPath = path.join(tempDir, 'fake-pyright.js');

        try {
            fs.mkdirSync(workingDirectory, { recursive: true });
            fs.writeFileSync(
                fakePyrightScriptPath,
                [
                    'const result = {',
                    '  generalDiagnostics: [{ severity: "error" }, { severity: "warning" }],',
                    '  summary: {',
                    '    filesAnalyzed: 3,',
                    '    errorCount: 1,',
                    '    warningCount: 1,',
                    '    informationCount: 0,',
                    '    timeInSec: 0.25',
                    '  }',
                    '};',
                    'console.log(JSON.stringify(result));',
                ].join('\n'),
                'utf-8'
            );

            const result = executePyrightProjectCommand(
                'black',
                createGeneratedProject({ pyrightCommand: `{pyright} "${fakePyrightScriptPath}" {paths}`, paths: ['src'] }),
                workingDirectory,
                process.execPath
            );

            expect(result.projectName).toBe('black');
            expect(result.diagnosticCount).toBe(2);
            expect(result.errorCount).toBe(1);
            expect(result.warningCount).toBe(1);
            expect(result.informationCount).toBe(0);
            expect(result.totalTimeMs).toBeGreaterThanOrEqual(0);
        } finally {
            fs.rmSync(tempDir, { force: true, recursive: true });
        }
    });

    test('runs execution mode end to end and writes reports plus comparison artifacts', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyright-ecosystem-execution-main-'));
        const projectRoot = tempDir;
        const projectDir = path.join(projectRoot, 'black');
        const outputDir = path.join(tempDir, 'artifacts');
        const baselineScriptPath = path.join(tempDir, 'baseline-pyright.js');
        const candidateScriptPath = path.join(tempDir, 'candidate-pyright.js');

        try {
            fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });
            fs.writeFileSync(path.join(projectDir, 'src', 'sample.py'), 'x = 1\n', 'utf-8');

            fs.writeFileSync(
                baselineScriptPath,
                createFakePyrightScript({ errorCount: 1, warningCount: 0, informationCount: 0 }),
                'utf-8'
            );
            fs.writeFileSync(
                candidateScriptPath,
                createFakePyrightScript({ errorCount: 0, warningCount: 1, informationCount: 0 }),
                'utf-8'
            );

            const artifactPaths = runEcosystemBenchmark([
                '--suite',
                'smoke',
                '--tag',
                'parser-heavy',
                '--project-root',
                projectRoot,
                '--baseline-executable',
                `"${process.execPath}" "${baselineScriptPath}"`,
                '--candidate-executable',
                `"${process.execPath}" "${candidateScriptPath}"`,
                '--output',
                outputDir,
            ]);

            expect(typeof artifactPaths).not.toBe('string');
            expect(fs.existsSync((artifactPaths as { baselineReportPath: string }).baselineReportPath)).toBe(true);
            expect(fs.existsSync((artifactPaths as { candidateReportPath: string }).candidateReportPath)).toBe(true);
            expect(
                fs.existsSync(
                    (artifactPaths as { comparisonArtifactPaths: { jsonPath: string } }).comparisonArtifactPaths.jsonPath
                )
            ).toBe(true);
        } finally {
            fs.rmSync(tempDir, { force: true, recursive: true });
        }
    });

    test('writes comparison artifacts from ecosystem benchmark reports', () => {
        const reportsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyright-ecosystem-report-'));
        const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyright-ecosystem-compare-'));

        try {
            const baselinePath = path.join(reportsDir, 'old.json');
            const candidatePath = path.join(reportsDir, 'new.json');

            fs.writeFileSync(
                baselinePath,
                JSON.stringify(
                    createEcosystemBenchmarkReport('2026-05-07T00:00:00.000Z', [
                        { projectName: 'black', totalTimeMs: 100, maxMemoryMB: 250 },
                    ]),
                    undefined,
                    2
                ),
                'utf-8'
            );
            fs.writeFileSync(
                candidatePath,
                JSON.stringify(
                    createEcosystemBenchmarkReport('2026-05-07T01:00:00.000Z', [
                        { projectName: 'black', totalTimeMs: 120, maxMemoryMB: 260 },
                    ]),
                    undefined,
                    2
                ),
                'utf-8'
            );

            const artifactPaths = compareEcosystemBenchmarkReports(baselinePath, candidatePath, outputDir);

            expect(JSON.parse(fs.readFileSync(artifactPaths.jsonPath, 'utf-8')).compared[0].key).toBe('black');
            expect(fs.readFileSync(artifactPaths.markdownPath, 'utf-8')).toContain('Largest Regressions');
            expect(JSON.parse(fs.readFileSync(artifactPaths.oldJsonPath, 'utf-8')).results[0].projectName).toBe(
                'black'
            );
        } finally {
            fs.rmSync(reportsDir, { force: true, recursive: true });
            fs.rmSync(outputDir, { force: true, recursive: true });
        }
    });

    test('runs comparison mode end to end', () => {
        const reportsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyright-ecosystem-report-main-'));
        const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyright-ecosystem-compare-main-'));

        try {
            const baselinePath = path.join(reportsDir, 'old.json');
            const candidatePath = path.join(reportsDir, 'new.json');

            fs.writeFileSync(
                baselinePath,
                JSON.stringify(
                    createEcosystemBenchmarkReport('2026-05-07T00:00:00.000Z', [
                        { projectName: 'black', totalTimeMs: 100 },
                    ]),
                    undefined,
                    2
                ),
                'utf-8'
            );
            fs.writeFileSync(
                candidatePath,
                JSON.stringify(
                    createEcosystemBenchmarkReport('2026-05-07T01:00:00.000Z', [
                        { projectName: 'black', totalTimeMs: 95 },
                    ]),
                    undefined,
                    2
                ),
                'utf-8'
            );

            const artifactPaths = runEcosystemBenchmark([
                '--baseline-report',
                baselinePath,
                '--candidate-report',
                candidatePath,
                '--output',
                outputDir,
            ]);

            expect(typeof artifactPaths).not.toBe('string');
            expect(fs.existsSync((artifactPaths as { jsonPath: string }).jsonPath)).toBe(true);
        } finally {
            fs.rmSync(reportsDir, { force: true, recursive: true });
            fs.rmSync(outputDir, { force: true, recursive: true });
        }
    });
});

function createEcosystemBenchmarkReport(
    timestamp: string,
    results: EcosystemBenchmarkResult[]
): BenchmarkReport<EcosystemBenchmarkResult> {
    return {
        schemaVersion: benchmarkReportSchemaVersion,
        suiteName: 'ecosystem-smoke',
        timestamp,
        system: {
            platform: 'win32',
            arch: 'x64',
            cpus: 'test-cpu',
            cpuCount: 8,
            totalMemoryMB: 16384,
            nodeVersion: process.version,
        },
        config: {
            warmupIterations: 0,
            benchmarkIterations: 1,
        },
        results,
    };
}

function createGeneratedProject(overrides: Partial<GeneratedEcosystemProject> = {}): GeneratedEcosystemProject {
    return {
        name: 'black',
        mypyPrimerProject: 'black',
        source: { kind: 'mypy-primer' },
        ...overrides,
    };
}

function createFakePyrightScript(counts: {
    errorCount: number;
    warningCount: number;
    informationCount: number;
}): string {
    const diagnosticEntries = [
        ...Array.from({ length: counts.errorCount }, () => '{ severity: "error" }'),
        ...Array.from({ length: counts.warningCount }, () => '{ severity: "warning" }'),
        ...Array.from({ length: counts.informationCount }, () => '{ severity: "information" }'),
    ].join(', ');

    return [
        'const result = {',
        `  generalDiagnostics: [${diagnosticEntries}],`,
        '  summary: {',
        '    filesAnalyzed: 3,',
        `    errorCount: ${counts.errorCount},`,
        `    warningCount: ${counts.warningCount},`,
        `    informationCount: ${counts.informationCount},`,
        '    timeInSec: 0.25',
        '  }',
        '};',
        'console.log(JSON.stringify(result));',
    ].join('\n');
}
