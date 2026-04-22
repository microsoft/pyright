/*
 * parserBenchmark.test.ts
 * Copyright (c) Microsoft Corporation.
 *
 * Microbenchmark for the Python parser.
 * Measures nodes/sec, parse time, AST node count across representative corpora.
 *
 * Run with:
 *   cd packages/pyright/packages/pyright-internal
 *   node node_modules\jest\bin\jest parserBenchmark.test --runInBand --detectOpenHandles --forceExit --testTimeout=300000
 *
 * Results are written as JSON to:
 *   src/tests/benchmarks/.generated/benchmark-results/parser/
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { DiagnosticSink } from '../../common/diagnosticSink';
import { ParseOptions, Parser } from '../../parser/parser';

// --- Configuration ---

const WARMUP_ITERATIONS = 3;
const BENCHMARK_ITERATIONS = 10;

const BENCHMARK_OUTPUT_DIR = path.join(__dirname, '.generated', 'benchmark-results', 'parser');

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
    nodeCount: number;
    nodesPerSec: number;
    statementCount: number;
    errorCount: number;
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
    const filename = `parser-benchmark-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    const outputPath = path.join(BENCHMARK_OUTPUT_DIR, filename);
    fs.writeFileSync(outputPath, JSON.stringify(report, undefined, 2), 'utf-8');
    console.log(`\nBenchmark results written to: ${outputPath}`);
}

function printResultTable(results: ReadonlyArray<BenchmarkResult>): void {
    console.log('\n=== Parser Benchmark Results ===\n');
    console.log(
        `${'Corpus'.padEnd(25)} ${'Size'.padStart(8)} ${'Nodes'.padStart(8)} ${'Stmts'.padStart(7)} ${'Errors'.padStart(
            7
        )} ${'Median'.padStart(10)} ${'Min'.padStart(10)} ${'Max'.padStart(10)} ${'Avg'.padStart(
            10
        )} ${'Nodes/s'.padStart(12)}`
    );
    console.log('-'.repeat(117));

    for (const r of results) {
        const sizeKB = `${(r.fileSizeBytes / 1024).toFixed(1)}KB`;
        console.log(
            `${r.corpus.padEnd(25)} ${sizeKB.padStart(8)} ${String(r.nodeCount).padStart(8)} ${String(
                r.statementCount
            ).padStart(7)} ${String(r.errorCount).padStart(7)} ${r.medianMs.toFixed(2).padStart(10)} ${r.minMs
                .toFixed(2)
                .padStart(10)} ${r.maxMs.toFixed(2).padStart(10)} ${r.avgMs.toFixed(2).padStart(10)} ${Math.round(
                r.nodesPerSec
            )
                .toLocaleString()
                .padStart(12)}`
        );
    }
    console.log('');
}

/**
 * Count all AST nodes by walking the tree recursively.
 * Pyright parse nodes have: { nodeType, d: { ...children }, ... }
 */
function countNodes(node: any): number {
    if (!node || typeof node !== 'object' || !('nodeType' in node)) {
        return 0;
    }

    let count = 1;

    // Walk the .d data bag where child nodes live
    const data = node.d;
    if (data && typeof data === 'object') {
        for (const key of Object.keys(data)) {
            const val = data[key];
            if (val && typeof val === 'object') {
                if ('nodeType' in val) {
                    count += countNodes(val);
                } else if (Array.isArray(val)) {
                    for (const item of val) {
                        if (item && typeof item === 'object' && 'nodeType' in item) {
                            count += countNodes(item);
                        }
                    }
                }
            }
        }
    }

    return count;
}

function benchmarkParse(corpusName: string, code: string): BenchmarkResult {
    const times: number[] = [];
    let nodeCount = 0;
    let statementCount = 0;
    let errorCount = 0;

    const parseOptions = new ParseOptions();

    // Warmup
    for (let i = 0; i < WARMUP_ITERATIONS; i++) {
        const parser = new Parser();
        const diagSink = new DiagnosticSink();
        parser.parseSourceFile(code, parseOptions, diagSink);
    }

    // Benchmark
    for (let i = 0; i < BENCHMARK_ITERATIONS; i++) {
        const parser = new Parser();
        const diagSink = new DiagnosticSink();

        const start = performance.now();
        const result = parser.parseSourceFile(code, parseOptions, diagSink);
        const elapsed = performance.now() - start;

        times.push(elapsed);
        statementCount = result.parserOutput.parseTree.d.statements.length;
        errorCount = diagSink.getErrors().length;

        // Count nodes on the last iteration only (it's expensive)
        if (i === BENCHMARK_ITERATIONS - 1) {
            nodeCount = countNodes(result.parserOutput.parseTree);
        }
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
        nodeCount,
        nodesPerSec: nodeCount / (stats.median / 1000),
        statementCount,
        errorCount,
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
];

// --- Tests ---

describe('Parser Benchmark', () => {
    const allResults: BenchmarkResult[] = [];

    for (const { name, file } of corpora) {
        test(`parse ${name}`, () => {
            const code = loadCorpus(file);
            const result = benchmarkParse(name, code);
            allResults.push(result);

            console.log(
                `  ${name}: median=${result.medianMs.toFixed(2)}ms, nodes=${result.nodeCount}, stmts=${
                    result.statementCount
                }, nodes/sec=${Math.round(result.nodesPerSec).toLocaleString()}`
            );

            // Sanity: parser should produce statements
            expect(result.statementCount).toBeGreaterThan(0);
            // Sanity: should complete in reasonable time (< 10s per file)
            expect(result.medianMs).toBeLessThan(10000);
        });
    }

    test('scaled corpus (10x large_stdlib)', () => {
        const base = loadCorpus('large_stdlib.py');
        const scaled = Array(10).fill(base).join('\n');

        const result = benchmarkParse('large_stdlib_10x', scaled);
        allResults.push(result);

        console.log(
            `  large_stdlib_10x: median=${result.medianMs.toFixed(2)}ms, nodes=${
                result.nodeCount
            }, nodes/sec=${Math.round(result.nodesPerSec).toLocaleString()}`
        );

        expect(result.statementCount).toBeGreaterThan(0);
    });

    afterAll(() => {
        if (allResults.length === 0) {
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
