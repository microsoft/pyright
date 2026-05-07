/*
 * evaluatorBenchmark.test.ts
 * Copyright (c) Microsoft Corporation.
 *
 * Synthetic type evaluator microbenchmarks.
 * Measures cold analysis time for generated Python cases that exercise evaluator-heavy paths.
 */

import { TimingStatsSnapshot } from '../../common/timing';
import {
    TypeAnalysisSummary,
    analyzeBenchmarkSource,
    calculateStats,
    createBenchmarkReport,
    writeBenchmarkReport,
} from './benchmarkUtils';
import {
    generateOverloadUnionCrossProductCase,
    generateProtocolMismatchCase,
    generateRecursiveAliasCase,
    generateTypedDictCase,
} from './syntheticCases';

const WARMUP_ITERATIONS = 1;
const BENCHMARK_ITERATIONS = 5;
const RUN_BENCHMARKS_ENV = 'PYRIGHT_RUN_BENCHMARKS';

interface BenchmarkCase {
    name: string;
    fileName: string;
    scale: string;
    code: string;
    minDiagnosticCount: number;
}

interface BenchmarkResult {
    caseName: string;
    scale: string;
    fileSizeBytes: number;
    sourceLines: number;
    iterations: number;
    timesMs: number[];
    medianMs: number;
    p95Ms: number;
    minMs: number;
    maxMs: number;
    avgMs: number;
    diagnosticCount: number;
    errorCount: number;
    warningCount: number;
    informationCount: number;
    statementCount: number;
    timing: TimingStatsSnapshot;
}

function benchmarkAnalyze(testCase: BenchmarkCase): BenchmarkResult {
    const times: number[] = [];
    let summary: TypeAnalysisSummary | undefined;

    for (let i = 0; i < WARMUP_ITERATIONS; i++) {
        analyzeBenchmarkSource(testCase.code, testCase.fileName);
    }

    for (let i = 0; i < BENCHMARK_ITERATIONS; i++) {
        const start = performance.now();
        summary = analyzeBenchmarkSource(testCase.code, testCase.fileName);
        const elapsed = performance.now() - start;

        times.push(elapsed);
    }

    if (!summary) {
        throw new Error(`Benchmark case ${testCase.name} did not produce an analysis summary.`);
    }

    const stats = calculateStats(times);

    return {
        caseName: testCase.name,
        scale: testCase.scale,
        fileSizeBytes: Buffer.byteLength(testCase.code, 'utf-8'),
        sourceLines: testCase.code.split('\n').length - 1,
        iterations: BENCHMARK_ITERATIONS,
        timesMs: times,
        medianMs: stats.median,
        p95Ms: stats.p95,
        minMs: stats.min,
        maxMs: stats.max,
        avgMs: stats.avg,
        diagnosticCount: summary.diagnosticCount,
        errorCount: summary.errorCount,
        warningCount: summary.warningCount,
        informationCount: summary.informationCount,
        statementCount: summary.statementCount,
        timing: summary.timing,
    };
}

function printResultTable(results: ReadonlyArray<BenchmarkResult>): void {
    console.log('\n=== Evaluator Benchmark Results ===\n');
    console.log(
        `${'Case'.padEnd(34)} ${'Scale'.padEnd(12)} ${'Lines'.padStart(7)} ${'Diag'.padStart(5)} ${'Median'.padStart(
            10
        )} ${'Min'.padStart(10)} ${'Max'.padStart(10)} ${'Avg'.padStart(10)} ${'p95'.padStart(10)}`
    );
    console.log('-'.repeat(113));

    for (const result of results) {
        console.log(
            `${result.caseName.padEnd(34)} ${result.scale.padEnd(12)} ${String(result.sourceLines).padStart(
                7
            )} ${String(result.diagnosticCount).padStart(5)} ${result.medianMs.toFixed(2).padStart(10)} ${result.minMs
                .toFixed(2)
                .padStart(10)} ${result.maxMs.toFixed(2).padStart(10)} ${result.avgMs
                .toFixed(2)
                .padStart(10)} ${result.p95Ms.toFixed(2).padStart(10)}`
        );
    }

    console.log('');
}

const cases: BenchmarkCase[] = [
    {
        name: 'recursive_alias_depth',
        fileName: 'recursiveAlias.py',
        scale: 'depth=24',
        code: generateRecursiveAliasCase(24),
        minDiagnosticCount: 0,
    },
    {
        name: 'overload_union_cross_product',
        fileName: 'overloadUnionCrossProduct.py',
        scale: '8x8',
        code: generateOverloadUnionCrossProductCase(8),
        minDiagnosticCount: 0,
    },
    {
        name: 'protocol_many_members_mismatch',
        fileName: 'protocolMismatch.py',
        scale: 'members=40',
        code: generateProtocolMismatchCase(40),
        minDiagnosticCount: 1,
    },
    {
        name: 'typed_dict_many_keys',
        fileName: 'typedDictManyKeys.py',
        scale: 'keys=80',
        code: generateTypedDictCase(80),
        minDiagnosticCount: 0,
    },
];

const benchmarkSuite = process.env[RUN_BENCHMARKS_ENV] === '1' ? describe : describe.skip;

benchmarkSuite('Evaluator Benchmark', () => {
    const allResults: BenchmarkResult[] = [];

    for (const testCase of cases) {
        test(`analyze ${testCase.name} ${testCase.scale}`, () => {
            const result = benchmarkAnalyze(testCase);
            allResults.push(result);

            console.log(
                `  ${testCase.name} ${testCase.scale}: median=${result.medianMs.toFixed(2)}ms, diagnostics=${
                    result.diagnosticCount
                }, check=${result.timing.typeCheck.totalTimeMs.toFixed(2)}ms, lines=${result.sourceLines}`
            );

            expect(result.statementCount).toBeGreaterThan(0);
            expect(result.diagnosticCount).toBeGreaterThanOrEqual(testCase.minDiagnosticCount);
            expect(result.medianMs).toBeLessThan(30000);
        });
    }

    afterAll(() => {
        if (allResults.length === 0) {
            return;
        }

        printResultTable(allResults);

        writeBenchmarkReport(
            'evaluator',
            'evaluator-benchmark',
            createBenchmarkReport(WARMUP_ITERATIONS, BENCHMARK_ITERATIONS, allResults)
        );
    });
});
