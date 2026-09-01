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

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { Tokenizer } from '../../parser/tokenizer';

// --- Configuration ---

const WARMUP_ITERATIONS = 3;
const BENCHMARK_ITERATIONS = 10;

const BENCHMARK_OUTPUT_DIR = path.join(__dirname, '.generated', 'benchmark-results', 'tokenizer');
const JEST_BIN_PATH = path.resolve(__dirname, '..', '..', '..', 'node_modules', 'jest', 'bin', 'jest.js');
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

interface BenchmarkReport {
    timestamp: string;
    system: {
        platform: string;
        arch: string;
        cpus: string;
        cpuCount: number;
        totalMemoryMB: number;
        nodeVersion: string;
    };
    config: {
        warmupIterations: number;
        benchmarkIterations: number;
    };
    results: BenchmarkResult[];
}

// --- Helpers ---

function calculateStats(times: ReadonlyArray<number>): {
    median: number;
    p95: number;
    min: number;
    max: number;
    avg: number;
} {
    const sorted = [...times].sort((a, b) => a - b);
    const len = sorted.length;

    const median = len % 2 === 0 ? (sorted[len / 2 - 1] + sorted[len / 2]) / 2 : sorted[Math.floor(len / 2)];
    const p95Index = Math.ceil(len * 0.95) - 1;
    const p95 = sorted[Math.min(p95Index, len - 1)];
    const min = sorted[0];
    const max = sorted[len - 1];
    const avg = times.reduce((a, b) => a + b, 0) / len;

    return { median, p95, min, max, avg };
}

function loadCorpus(filename: string): string {
    const filePath = path.resolve(__dirname, '..', 'benchmarkData', filename);
    return fs.readFileSync(filePath, 'utf-8');
}

function getSystemInfo(): BenchmarkReport['system'] {
    const cpus = os.cpus();
    return {
        platform: os.platform(),
        arch: os.arch(),
        cpus: cpus[0]?.model ?? 'unknown',
        cpuCount: cpus.length,
        totalMemoryMB: Math.round(os.totalmem() / (1024 * 1024)),
        nodeVersion: process.version,
    };
}

function writeReport(report: BenchmarkReport): void {
    fs.mkdirSync(BENCHMARK_OUTPUT_DIR, { recursive: true });
    const filename = `tokenizer-benchmark-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    const outputPath = path.join(BENCHMARK_OUTPUT_DIR, filename);
    fs.writeFileSync(outputPath, JSON.stringify(report, undefined, 2), 'utf-8');
    console.log(`\nBenchmark results written to: ${outputPath}`);
}

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
                .padStart(10)} ${Math.round(result.tokensPerSec).toLocaleString().padStart(12)}`
        );
    }
    console.log('');
}

function emitChildResult(result: BenchmarkResult): void {
    process.stdout.write(`${CHILD_RESULT_PREFIX}${JSON.stringify(result)}\n`);
}

function getChildOutput(error: unknown): string {
    if (!(error instanceof Error)) {
        return '';
    }

    const stdout = 'stdout' in error && typeof error.stdout === 'string' ? error.stdout : '';
    const stderr = 'stderr' in error && typeof error.stderr === 'string' ? error.stderr : '';
    return [stdout, stderr].filter((part) => part.length > 0).join('\n');
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function runBenchmarkInFreshProcess(testName: string): BenchmarkResult {
    try {
        const output = execFileSync(
            process.execPath,
            [
                JEST_BIN_PATH,
                __filename,
                '--runInBand',
                '--forceExit',
                '--testTimeout=300000',
                '--testNamePattern',
                `^Tokenizer Benchmark ${escapeRegExp(testName)}$`,
            ],
            {
                cwd: path.resolve(__dirname, '..', '..', '..'),
                encoding: 'utf-8',
                env: {
                    ...process.env,
                    [CHILD_MODE_ENV]: '1',
                },
            }
        );

        const resultLine = output.split(/\r?\n/).find((line) => line.startsWith(CHILD_RESULT_PREFIX));

        if (!resultLine) {
            throw new Error(`Child benchmark for "${testName}" did not emit a result.\n${output}`);
        }

        return JSON.parse(resultLine.slice(CHILD_RESULT_PREFIX.length)) as BenchmarkResult;
    } catch (error) {
        const output = getChildOutput(error);
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Child benchmark for "${testName}" failed.\n${message}${output ? `\n${output}` : ''}`);
    }
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
                ? benchmarkTokenize(name, loadCorpus(file))
                : runBenchmarkInFreshProcess(`tokenize ${name}`);

            if (!isChildProcess) {
                allResults.push(result);
            }

            console.log(
                `  ${name}: median=${result.medianMs.toFixed(2)}ms, tokens=${result.tokenCount}, tok/sec=${Math.round(
                    result.tokensPerSec
                ).toLocaleString()}`
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
            ? benchmarkTokenize('large_stdlib_10x', Array(10).fill(loadCorpus('large_stdlib.py')).join('\n'))
            : runBenchmarkInFreshProcess('scaled corpus (10x large_stdlib)');

        if (!isChildProcess) {
            allResults.push(result);
        }

        console.log(
            `  large_stdlib_10x: median=${result.medianMs.toFixed(2)}ms, tokens=${
                result.tokenCount
            }, tok/sec=${Math.round(result.tokensPerSec).toLocaleString()}`
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

        const report: BenchmarkReport = {
            timestamp: new Date().toISOString(),
            system: getSystemInfo(),
            config: {
                warmupIterations: WARMUP_ITERATIONS,
                benchmarkIterations: BENCHMARK_ITERATIONS,
            },
            results: allResults,
        };

        writeReport(report);
    });
});
