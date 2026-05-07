/*
 * benchmarkComparison.test.ts
 * Copyright (c) Microsoft Corporation.
 *
 * Tests for benchmark result comparison helpers.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
    calculatePercentDelta,
    compareBenchmarkReports,
    compareBenchmarkResultSets,
    renderBenchmarkComparisonMarkdown,
    writeBenchmarkComparisonArtifacts,
} from './benchmarkComparison';
import { BenchmarkReport, benchmarkReportSchemaVersion } from './benchmarkUtils';

const RUN_BENCHMARKS_ENV = 'PYRIGHT_RUN_BENCHMARKS';

interface TestResult {
    name: string;
    medianMs?: number;
    tokensPerSec?: number;
}

const benchmarkSuite = process.env[RUN_BENCHMARKS_ENV] === '1' ? describe : describe.skip;

benchmarkSuite('Benchmark Comparison', () => {
    test('calculates percent deltas', () => {
        expect(calculatePercentDelta(100, 125)).toBe(25);
        expect(calculatePercentDelta(100, 80)).toBe(-20);
        expect(calculatePercentDelta(0, 0)).toBe(0);
        expect(calculatePercentDelta(0, 10)).toBeUndefined();
    });

    test('compares common benchmark results and tracks added and removed cases', () => {
        const comparison = compareBenchmarkResultSets<TestResult>(
            [
                { name: 'large_file', medianMs: 100, tokensPerSec: 1000 },
                { name: 'removed_case', medianMs: 50, tokensPerSec: 500 },
            ],
            [
                { name: 'large_file', medianMs: 115, tokensPerSec: 1200 },
                { name: 'added_case', medianMs: 10, tokensPerSec: 100 },
            ],
            (result) => result.name,
            [
                { name: 'medianMs', getValue: (result) => result.medianMs, minAbsoluteDelta: 5 },
                {
                    name: 'tokensPerSec',
                    getValue: (result) => result.tokensPerSec,
                    lowerIsBetter: false,
                    minAbsoluteDelta: 10,
                },
            ]
        );

        expect(comparison.addedKeys).toEqual(['added_case']);
        expect(comparison.removedKeys).toEqual(['removed_case']);
        expect(comparison.compared).toHaveLength(1);
        expect(comparison.compared[0].metrics).toEqual([
            {
                metric: 'medianMs',
                baselineValue: 100,
                candidateValue: 115,
                absoluteDelta: 15,
                percentDelta: 15,
                direction: 'regression',
            },
            {
                metric: 'tokensPerSec',
                baselineValue: 1000,
                candidateValue: 1200,
                absoluteDelta: 200,
                percentDelta: 20,
                direction: 'improvement',
            },
        ]);
    });

    test('compares benchmark report envelopes', () => {
        const comparison = compareBenchmarkReports<TestResult>(
            createTestReport('parser', '2026-05-07T00:00:00.000Z', [{ name: 'case_a', medianMs: 100 }]),
            createTestReport('parser', '2026-05-07T01:00:00.000Z', [{ name: 'case_a', medianMs: 90 }]),
            (result) => result.name,
            [{ name: 'medianMs', getValue: (result) => result.medianMs }]
        );

        expect(comparison.schemaVersion).toBe(benchmarkReportSchemaVersion);
        expect(comparison.suiteName).toBe('parser');
        expect(comparison.baselineTimestamp).toBe('2026-05-07T00:00:00.000Z');
        expect(comparison.candidateTimestamp).toBe('2026-05-07T01:00:00.000Z');
        expect(comparison.compared[0].metrics[0].direction).toBe('improvement');
    });

    test('rejects incompatible benchmark report envelopes', () => {
        expect(() =>
            compareBenchmarkReports<TestResult>(
                createTestReport('parser', '2026-05-07T00:00:00.000Z', []),
                createTestReport('tokenizer', '2026-05-07T01:00:00.000Z', []),
                (result) => result.name,
                [{ name: 'medianMs', getValue: (result) => result.medianMs }]
            )
        ).toThrow('different suites');

        expect(() =>
            compareBenchmarkReports<TestResult>(
                { ...createTestReport('parser', '2026-05-07T00:00:00.000Z', []), schemaVersion: 0 },
                createTestReport('parser', '2026-05-07T01:00:00.000Z', []),
                (result) => result.name,
                [{ name: 'medianMs', getValue: (result) => result.medianMs }]
            )
        ).toThrow('Unsupported baseline benchmark report schema version');
    });

    test('renders a markdown comparison table', () => {
        const comparison = compareBenchmarkResultSets<TestResult>(
            [{ name: 'case_a', medianMs: 100 }],
            [{ name: 'case_a', medianMs: 110 }],
            (result) => result.name,
            [{ name: 'medianMs', getValue: (result) => result.medianMs }]
        );

        expect(renderBenchmarkComparisonMarkdown(comparison)).toContain('| case_a | medianMs | 100.00 | 110.00 |');
    });

    test('writes comparison artifacts', () => {
        const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyright-benchmark-comparison-'));

        try {
            const comparison = compareBenchmarkResultSets<TestResult>(
                [{ name: 'case_a', medianMs: 100 }],
                [{ name: 'case_a', medianMs: 110 }],
                (result) => result.name,
                [{ name: 'medianMs', getValue: (result) => result.medianMs }]
            );
            const paths = writeBenchmarkComparisonArtifacts(outputDir, comparison);

            expect(paths.jsonPath).toBe(path.join(outputDir, 'comparison.json'));
            expect(paths.markdownPath).toBe(path.join(outputDir, 'comparison.md'));
            expect(JSON.parse(fs.readFileSync(paths.jsonPath, 'utf-8'))).toEqual(comparison);
            expect(fs.readFileSync(paths.markdownPath, 'utf-8')).toContain('| case_a | medianMs |');
        } finally {
            fs.rmSync(outputDir, { force: true, recursive: true });
        }
    });

    test('rejects duplicate result keys', () => {
        expect(() =>
            compareBenchmarkResultSets<TestResult>(
                [
                    { name: 'duplicate', medianMs: 1 },
                    { name: 'duplicate', medianMs: 2 },
                ],
                [],
                (result) => result.name,
                [{ name: 'medianMs', getValue: (result) => result.medianMs }]
            )
        ).toThrow('Duplicate benchmark result key');
    });
});

function createTestReport(suiteName: string, timestamp: string, results: TestResult[]): BenchmarkReport<TestResult> {
    return {
        schemaVersion: benchmarkReportSchemaVersion,
        suiteName,
        timestamp,
        system: {
            platform: 'test',
            arch: 'test',
            cpus: 'test',
            cpuCount: 1,
            totalMemoryMB: 1,
            nodeVersion: 'test',
        },
        config: {
            warmupIterations: 0,
            benchmarkIterations: 1,
        },
        results,
    };
}
