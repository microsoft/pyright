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
    parseEcosystemBenchmarkArgs,
    runEcosystemBenchmark,
    writeEcosystemBenchmarkManifest,
} from './runEcosystemBenchmark';

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

        expect(config.suiteName).toBe('smoke');
        expect(config.tag).toBe('overloads');
        expect(config.projectPattern?.source).toBe('pandas');
        expect(config.numShards).toBe(2);
        expect(config.shardIndex).toBe(1);
        expect(config.projectDate).toBe('2026-01-01');
        expect(config.outputDir).toBe('artifacts/ecosystem-smoke');
    });

    test('builds a filtered smoke manifest', () => {
        const manifest = buildEcosystemBenchmarkManifest(
            parseEcosystemBenchmarkArgs(['--suite', 'smoke', '--tag', 'overloads', '--output', 'artifacts'])
        );

        expect(manifest.executionMode).toBe('selection-only');
        expect(manifest.selectedProjectCount).toBe(1);
        expect(manifest.selectedProjects.map((project) => project.name)).toEqual(['pandas']);
    });

    test('writes an ecosystem run manifest', () => {
        const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyright-ecosystem-runner-'));

        try {
            const manifest = buildEcosystemBenchmarkManifest(
                parseEcosystemBenchmarkArgs(['--suite', 'smoke', '--project', 'django', '--output', outputDir])
            );
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
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

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
});