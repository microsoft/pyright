import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface BenchmarkStats {
    median: number;
    p95: number;
    min: number;
    max: number;
    avg: number;
}

export interface BenchmarkSystemInfo {
    platform: string;
    arch: string;
    cpus: string;
    cpuCount: number;
    totalMemoryMB: number;
    nodeVersion: string;
}

export interface BenchmarkReport<ResultT> {
    timestamp: string;
    system: BenchmarkSystemInfo;
    config: {
        warmupIterations: number;
        benchmarkIterations: number;
    };
    results: ResultT[];
}

export const benchmarkDataDir = path.resolve(__dirname, '..', 'benchmarkData');
export const benchmarkResultsDir = path.join(__dirname, '.generated', 'benchmark-results');

export function calculateStats(times: ReadonlyArray<number>): BenchmarkStats {
    if (times.length === 0) {
        throw new Error('Cannot calculate benchmark stats for an empty sample set.');
    }

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

export function loadBenchmarkCorpus(filename: string): string {
    const filePath = path.resolve(benchmarkDataDir, filename);
    return fs.readFileSync(filePath, 'utf-8');
}

export function getSystemInfo(): BenchmarkSystemInfo {
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

export function createBenchmarkReport<ResultT>(
    warmupIterations: number,
    benchmarkIterations: number,
    results: ResultT[]
): BenchmarkReport<ResultT> {
    return {
        timestamp: new Date().toISOString(),
        system: getSystemInfo(),
        config: {
            warmupIterations,
            benchmarkIterations,
        },
        results,
    };
}

export function writeBenchmarkReport<ResultT>(
    suiteName: string,
    filePrefix: string,
    report: BenchmarkReport<ResultT>
): string {
    const outputDir = path.join(benchmarkResultsDir, suiteName);
    fs.mkdirSync(outputDir, { recursive: true });

    const filename = `${filePrefix}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    const outputPath = path.join(outputDir, filename);
    fs.writeFileSync(outputPath, JSON.stringify(report, undefined, 2), 'utf-8');
    console.log(`\nBenchmark results written to: ${outputPath}`);

    return outputPath;
}

export function formatCount(value: number): string {
    return Math.round(value).toLocaleString();
}

export function getChildProcessOutput(error: unknown): string {
    if (!(error instanceof Error)) {
        return '';
    }

    const stdout = 'stdout' in error && typeof error.stdout === 'string' ? error.stdout : '';
    const stderr = 'stderr' in error && typeof error.stderr === 'string' ? error.stderr : '';
    return [stdout, stderr].filter((part) => part.length > 0).join('\n');
}

export function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function runJestBenchmarkInFreshProcess<ResultT>(
    testFilePath: string,
    suiteName: string,
    testName: string,
    resultPrefix: string,
    childModeEnv: string
): ResultT {
    const jestBinPath = path.resolve(__dirname, '..', '..', '..', 'node_modules', 'jest', 'bin', 'jest.js');

    try {
        const output = execFileSync(
            process.execPath,
            [
                jestBinPath,
                testFilePath,
                '--runInBand',
                '--forceExit',
                '--testTimeout=300000',
                '--testNamePattern',
                `^${suiteName} ${escapeRegExp(testName)}$`,
            ],
            {
                cwd: path.resolve(__dirname, '..', '..', '..'),
                encoding: 'utf-8',
                env: {
                    ...process.env,
                    [childModeEnv]: '1',
                },
            }
        );

        const resultLine = output.split(/\r?\n/).find((line) => line.startsWith(resultPrefix));

        if (!resultLine) {
            throw new Error(`Child benchmark for "${testName}" did not emit a result.\n${output}`);
        }

        return JSON.parse(resultLine.slice(resultPrefix.length)) as ResultT;
    } catch (error) {
        const output = getChildProcessOutput(error);
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Child benchmark for "${testName}" failed.\n${message}${output ? `\n${output}` : ''}`);
    }
}
