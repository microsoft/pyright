/*
 * tokenizerBenchmark.test.ts
 * Copyright (c) Microsoft Corporation.
 *
 * Microbenchmark for the Python tokenizer.
 * Measures tokens/sec and time-to-tokenize across representative corpora.
 *
 * Run with:
 *   cd packages/pyright-internal
 *   node node_modules\jest\bin\jest tokenizerBenchmark.test --runInBand --detectOpenHandles --forceExit --testTimeout=300000
 *
 * Results are written as JSON to:
 *   src/tests/benchmarks/.generated/benchmark-results/tokenizer/
 */

import { Tokenizer } from '../../parser/tokenizer';
import {
    calculateStats,
    createBenchmarkReport,
    formatCount,
    loadBenchmarkCorpus,
    runJestBenchmarkInFreshProcess,
    writeBenchmarkReport,
} from './benchmarkUtils';

// --- Configuration ---

const WARMUP_ITERATIONS = 3;
const BENCHMARK_ITERATIONS = 10;

const CHILD_RESULT_PREFIX = '__TOKENIZER_BENCHMARK_RESULT__';
const CHILD_MODE_ENV = 'PYRIGHT_TOKENIZER_BENCH_CHILD';
const RUN_BENCHMARKS_ENV = 'PYRIGHT_RUN_BENCHMARKS';

// --- Types ---

interface BenchmarkResult {
    corpus: string;
    fileSizeBytes: number;
    iterations: number;
    timesMs: number[];
    medianMs: number;
    p95Ms: number;
    minMs: number;
    maxMs: number;
    avgMs: number;
    tokenCount: number;
    tokensPerSec: number;
}

// --- Helpers ---

function printResultTable(results: ReadonlyArray<BenchmarkResult>): void {
    console.log('\n=== Tokenizer Benchmark Results ===\n');
    console.log(
        `${'Corpus'.padEnd(25)} ${'Size'.padStart(8)} ${'Tokens'.padStart(8)} ${'Median'.padStart(10)} ${'Min'.padStart(
            10
        )} ${'Max'.padStart(10)} ${'Avg'.padStart(10)} ${'p95'.padStart(10)} ${'Tok/sec'.padStart(12)}`
    );
    console.log('-'.repeat(113));

    for (const result of results) {
        const sizeKB = `${(result.fileSizeBytes / 1024).toFixed(1)}KB`;
        console.log(
            `${result.corpus.padEnd(25)} ${sizeKB.padStart(8)} ${String(result.tokenCount).padStart(
                8
            )} ${result.medianMs.toFixed(2).padStart(10)} ${result.minMs.toFixed(2).padStart(10)} ${result.maxMs
                .toFixed(2)
                .padStart(10)} ${result.avgMs.toFixed(2).padStart(10)} ${result.p95Ms
                .toFixed(2)
                .padStart(10)} ${formatCount(result.tokensPerSec).padStart(12)}`
        );
    }
    console.log('');
}

function emitChildResult(result: BenchmarkResult): void {
    process.stdout.write(`${CHILD_RESULT_PREFIX}${JSON.stringify(result)}\n`);
}

function runBenchmarkInFreshProcess(testName: string): BenchmarkResult {
    return runJestBenchmarkInFreshProcess(
        __filename,
        'Tokenizer Benchmark',
        testName,
        CHILD_RESULT_PREFIX,
        CHILD_MODE_ENV
    );
}

function benchmarkTokenize(corpusName: string, code: string): BenchmarkResult {
    const times: number[] = [];
    let tokenCount = 0;

    for (let i = 0; i < WARMUP_ITERATIONS; i++) {
        const tokenizer = new Tokenizer();
        tokenizer.tokenize(code);
    }

    for (let i = 0; i < BENCHMARK_ITERATIONS; i++) {
        const tokenizer = new Tokenizer();

        const start = performance.now();
        const results = tokenizer.tokenize(code);
        const elapsed = performance.now() - start;

        times.push(elapsed);
        tokenCount = results.tokens.count;
    }

    const stats = calculateStats(times);

    return {
        corpus: corpusName,
        fileSizeBytes: Buffer.byteLength(code, 'utf-8'),
        iterations: BENCHMARK_ITERATIONS,
        timesMs: times,
        medianMs: stats.median,
        p95Ms: stats.p95,
        minMs: stats.min,
        maxMs: stats.max,
        avgMs: stats.avg,
        tokenCount,
        tokensPerSec: tokenCount / (stats.median / 1000),
    };
}

// --- Corpus definitions ---

const corpora: { name: string; file: string }[] = [
    { name: 'large_stdlib', file: 'large_stdlib.py' },
    { name: 'fstring_heavy', file: 'fstring_heavy.py' },
    { name: 'comment_heavy', file: 'comment_heavy.py' },
    { name: 'large_class', file: 'large_class.py' },
    { name: 'import_heavy', file: 'import_heavy.py' },
    { name: 'union_heavy', file: 'union_heavy.py' },
    { name: 'repetitive_identifiers', file: 'repetitive_identifiers.py' },
];

// --- Tests ---

const benchmarkSuite = process.env[RUN_BENCHMARKS_ENV] === '1' ? describe : describe.skip;

benchmarkSuite('Tokenizer Benchmark', () => {
    const allResults: BenchmarkResult[] = [];
    const isChildProcess = process.env[CHILD_MODE_ENV] === '1';

    for (const { name, file } of corpora) {
        test(`tokenize ${name}`, () => {
            const result = isChildProcess
                ? benchmarkTokenize(name, loadBenchmarkCorpus(file))
                : runBenchmarkInFreshProcess(`tokenize ${name}`);

            if (!isChildProcess) {
                allResults.push(result);
            }

            console.log(
                `  ${name}: median=${result.medianMs.toFixed(2)}ms, tokens=${result.tokenCount}, tok/sec=${formatCount(
                    result.tokensPerSec
                )}`
            );

            if (isChildProcess) {
                emitChildResult(result);
            }

            expect(result.tokenCount).toBeGreaterThan(0);
            expect(result.medianMs).toBeLessThan(5000);
        });
    }

    test('scaled corpus (10x large_stdlib)', () => {
        const result = isChildProcess
            ? benchmarkTokenize('large_stdlib_10x', Array(10).fill(loadBenchmarkCorpus('large_stdlib.py')).join('\n'))
            : runBenchmarkInFreshProcess('scaled corpus (10x large_stdlib)');

        if (!isChildProcess) {
            allResults.push(result);
        }

        console.log(
            `  large_stdlib_10x: median=${result.medianMs.toFixed(2)}ms, tokens=${
                result.tokenCount
            }, tok/sec=${formatCount(result.tokensPerSec)}`
        );

        if (isChildProcess) {
            emitChildResult(result);
        }

        expect(result.tokenCount).toBeGreaterThan(0);
    });

    afterAll(() => {
        if (isChildProcess || allResults.length === 0) {
            return;
        }

        printResultTable(allResults);

        writeBenchmarkReport(
            'tokenizer',
            'tokenizer-benchmark',
            createBenchmarkReport('tokenizer', WARMUP_ITERATIONS, BENCHMARK_ITERATIONS, allResults)
        );
    });
});
