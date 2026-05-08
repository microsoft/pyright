/*
 * runEcosystemBenchmark.test.ts
 * Copyright (c) Microsoft Corporation.
 *
 * Tests for the ecosystem benchmark runner entry point.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
    buildEcosystemBenchmarkManifest,
    compareEcosystemBenchmarkReports,
    EcosystemBenchmarkResult,
    parseEcosystemBenchmarkArgs,
    runEcosystemBenchmark,
    writeEcosystemBenchmarkManifest,
} from './runEcosystemBenchmark';
import { BenchmarkReport, benchmarkReportSchemaVersion } from './benchmarkUtils';

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
            const config = parseEcosystemBenchmarkArgs(['--suite', 'smoke', '--project', 'django', '--output', outputDir]);

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

    test('writes comparison artifacts from ecosystem benchmark reports', () => {
        const reportsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyright-ecosystem-report-'));
        const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyright-ecosystem-compare-'));

        try {
            const baselinePath = path.join(reportsDir, 'old.json');
            const candidatePath = path.join(reportsDir, 'new.json');

            fs.writeFileSync(
                baselinePath,
                JSON.stringify(createEcosystemBenchmarkReport('2026-05-07T00:00:00.000Z', [{ projectName: 'black', totalTimeMs: 100, maxMemoryMB: 250 }]), undefined, 2),
                'utf-8'
            );
            fs.writeFileSync(
                candidatePath,
                JSON.stringify(createEcosystemBenchmarkReport('2026-05-07T01:00:00.000Z', [{ projectName: 'black', totalTimeMs: 120, maxMemoryMB: 260 }]), undefined, 2),
                'utf-8'
            );

            const artifactPaths = compareEcosystemBenchmarkReports(baselinePath, candidatePath, outputDir);

            expect(JSON.parse(fs.readFileSync(artifactPaths.jsonPath, 'utf-8')).compared[0].key).toBe('black');
            expect(fs.readFileSync(artifactPaths.markdownPath, 'utf-8')).toContain('Largest Regressions');
            expect(JSON.parse(fs.readFileSync(artifactPaths.oldJsonPath, 'utf-8')).results[0].projectName).toBe('black');
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
                JSON.stringify(createEcosystemBenchmarkReport('2026-05-07T00:00:00.000Z', [{ projectName: 'black', totalTimeMs: 100 }]), undefined, 2),
                'utf-8'
            );
            fs.writeFileSync(
                candidatePath,
                JSON.stringify(createEcosystemBenchmarkReport('2026-05-07T01:00:00.000Z', [{ projectName: 'black', totalTimeMs: 95 }]), undefined, 2),
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