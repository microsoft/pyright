import * as fs from 'fs';
import * as path from 'path';

import { BenchmarkReport, benchmarkReportSchemaVersion } from './benchmarkUtils';

export type BenchmarkMetricDirection = 'improvement' | 'regression' | 'unchanged';
export type BenchmarkRegressionSeverity = 'none' | 'warning' | 'failure';

export interface BenchmarkMetricDefinition<ResultT> {
    name: string;
    lowerIsBetter?: boolean;
    minAbsoluteDelta?: number;
    getValue: (result: ResultT) => number | undefined;
}

export interface BenchmarkMetricComparison {
    metric: string;
    baselineValue: number;
    candidateValue: number;
    absoluteDelta: number;
    percentDelta: number | undefined;
    direction: BenchmarkMetricDirection;
}

export interface BenchmarkResultComparison {
    key: string;
    metrics: BenchmarkMetricComparison[];
}

export interface BenchmarkResultSetComparison {
    compared: BenchmarkResultComparison[];
    addedKeys: string[];
    removedKeys: string[];
}

export interface BenchmarkMetricComparisonSummaryEntry extends BenchmarkMetricComparison {
    key: string;
}

export interface BenchmarkComparisonSummary {
    comparedResultCount: number;
    metricCount: number;
    regressionCount: number;
    improvementCount: number;
    unchangedCount: number;
    largestRegressions: BenchmarkMetricComparisonSummaryEntry[];
    largestImprovements: BenchmarkMetricComparisonSummaryEntry[];
}

export interface BenchmarkRegressionThresholds {
    warnRegressionPct?: number;
    failRegressionPct?: number;
    warnRegressionAbsolute?: number;
    failRegressionAbsolute?: number;
    minAbsoluteRegression?: number;
}

export interface BenchmarkRegressionThresholdResult extends BenchmarkMetricComparisonSummaryEntry {
    severity: BenchmarkRegressionSeverity;
}

export interface BenchmarkReportComparison extends BenchmarkResultSetComparison {
    schemaVersion: number;
    suiteName: string;
    baselineTimestamp: string;
    candidateTimestamp: string;
}

export interface BenchmarkComparisonArtifactPaths {
    jsonPath: string;
    markdownPath: string;
}

export function calculatePercentDelta(baselineValue: number, candidateValue: number): number | undefined {
    if (baselineValue === 0) {
        return candidateValue === 0 ? 0 : undefined;
    }

    return ((candidateValue - baselineValue) / Math.abs(baselineValue)) * 100;
}

export function compareBenchmarkResultSets<ResultT>(
    baselineResults: ReadonlyArray<ResultT>,
    candidateResults: ReadonlyArray<ResultT>,
    getKey: (result: ResultT) => string,
    metrics: ReadonlyArray<BenchmarkMetricDefinition<ResultT>>
): BenchmarkResultSetComparison {
    const baselineByKey = indexResultsByKey(baselineResults, getKey);
    const candidateByKey = indexResultsByKey(candidateResults, getKey);
    const baselineKeys = [...baselineByKey.keys()].sort();
    const candidateKeys = [...candidateByKey.keys()].sort();
    const comparedKeys = baselineKeys.filter((key) => candidateByKey.has(key));

    return {
        compared: comparedKeys.map((key) =>
            compareBenchmarkResult(key, baselineByKey.get(key)!, candidateByKey.get(key)!, metrics)
        ),
        addedKeys: candidateKeys.filter((key) => !baselineByKey.has(key)),
        removedKeys: baselineKeys.filter((key) => !candidateByKey.has(key)),
    };
}

export function compareBenchmarkReports<ResultT>(
    baselineReport: BenchmarkReport<ResultT>,
    candidateReport: BenchmarkReport<ResultT>,
    getKey: (result: ResultT) => string,
    metrics: ReadonlyArray<BenchmarkMetricDefinition<ResultT>>
): BenchmarkReportComparison {
    validateBenchmarkReportPair(baselineReport, candidateReport);

    return {
        schemaVersion: baselineReport.schemaVersion,
        suiteName: baselineReport.suiteName,
        baselineTimestamp: baselineReport.timestamp,
        candidateTimestamp: candidateReport.timestamp,
        ...compareBenchmarkResultSets(baselineReport.results, candidateReport.results, getKey, metrics),
    };
}

export function summarizeBenchmarkComparison(
    comparison: BenchmarkResultSetComparison,
    limit = 5
): BenchmarkComparisonSummary {
    const entries = getComparisonMetricEntries(comparison);
    const regressions = entries.filter((entry) => entry.direction === 'regression');
    const improvements = entries.filter((entry) => entry.direction === 'improvement');
    const unchanged = entries.filter((entry) => entry.direction === 'unchanged');

    return {
        comparedResultCount: comparison.compared.length,
        metricCount: entries.length,
        regressionCount: regressions.length,
        improvementCount: improvements.length,
        unchangedCount: unchanged.length,
        largestRegressions: sortMetricEntriesByMagnitude(regressions).slice(0, limit),
        largestImprovements: sortMetricEntriesByMagnitude(improvements).slice(0, limit),
    };
}

export function classifyBenchmarkRegression(
    entry: BenchmarkMetricComparison,
    thresholds: BenchmarkRegressionThresholds
): BenchmarkRegressionSeverity {
    if (entry.direction !== 'regression') {
        return 'none';
    }

    const absoluteMagnitude = Math.abs(entry.absoluteDelta);
    if (absoluteMagnitude < (thresholds.minAbsoluteRegression ?? 0)) {
        return 'none';
    }

    if (exceedsRegressionThreshold(entry, thresholds.failRegressionPct, thresholds.failRegressionAbsolute)) {
        return 'failure';
    }

    if (exceedsRegressionThreshold(entry, thresholds.warnRegressionPct, thresholds.warnRegressionAbsolute)) {
        return 'warning';
    }

    return 'none';
}

export function getBenchmarkRegressionThresholdResults(
    comparison: BenchmarkResultSetComparison,
    thresholds: BenchmarkRegressionThresholds
): BenchmarkRegressionThresholdResult[] {
    return getComparisonMetricEntries(comparison)
        .map((entry) => ({ ...entry, severity: classifyBenchmarkRegression(entry, thresholds) }))
        .filter((entry) => entry.severity !== 'none')
        .sort(compareThresholdResults);
}

export function renderBenchmarkComparisonMarkdown(comparison: BenchmarkResultSetComparison): string {
    const summary = summarizeBenchmarkComparison(comparison);
    const lines = [
        '## Summary',
        '',
        `Compared cases: ${summary.comparedResultCount}`,
        `Compared metrics: ${summary.metricCount}`,
        `Regressions: ${summary.regressionCount}`,
        `Improvements: ${summary.improvementCount}`,
        `Unchanged: ${summary.unchangedCount}`,
        '',
    ];

    appendMetricEntryTable(lines, '## Largest Regressions', summary.largestRegressions);
    appendMetricEntryTable(lines, '## Largest Improvements', summary.largestImprovements);

    lines.push(
        '## Details',
        '',
        '| Case | Metric | Baseline | Candidate | Delta | Delta % | Direction |',
        '|---|---:|---:|---:|---:|---:|---|'
    );

    for (const result of comparison.compared) {
        for (const metric of result.metrics) {
            lines.push(
                `| ${result.key} | ${metric.metric} | ${formatMetric(metric.baselineValue)} | ${formatMetric(
                    metric.candidateValue
                )} | ${formatMetric(metric.absoluteDelta)} | ${formatPercent(metric.percentDelta)} | ${
                    metric.direction
                } |`
            );
        }
    }

    if (comparison.addedKeys.length > 0) {
        lines.push('', `Added cases: ${comparison.addedKeys.join(', ')}`);
    }

    if (comparison.removedKeys.length > 0) {
        lines.push('', `Removed cases: ${comparison.removedKeys.join(', ')}`);
    }

    return `${lines.join('\n')}\n`;
}

function appendMetricEntryTable(
    lines: string[],
    heading: string,
    entries: ReadonlyArray<BenchmarkMetricComparisonSummaryEntry>
): void {
    lines.push(heading, '');

    if (entries.length === 0) {
        lines.push('None.', '');
        return;
    }

    lines.push('| Case | Metric | Baseline | Candidate | Delta | Delta % |', '|---|---:|---:|---:|---:|---:|');

    for (const entry of entries) {
        lines.push(
            `| ${entry.key} | ${entry.metric} | ${formatMetric(entry.baselineValue)} | ${formatMetric(
                entry.candidateValue
            )} | ${formatMetric(entry.absoluteDelta)} | ${formatPercent(entry.percentDelta)} |`
        );
    }

    lines.push('');
}

function getComparisonMetricEntries(comparison: BenchmarkResultSetComparison): BenchmarkMetricComparisonSummaryEntry[] {
    return comparison.compared.flatMap((result) => result.metrics.map((metric) => ({ key: result.key, ...metric })));
}

function sortMetricEntriesByMagnitude(
    entries: ReadonlyArray<BenchmarkMetricComparisonSummaryEntry>
): BenchmarkMetricComparisonSummaryEntry[] {
    return [...entries].sort((left, right) => getMetricMagnitude(right) - getMetricMagnitude(left));
}

function getMetricMagnitude(entry: BenchmarkMetricComparison): number {
    return Math.abs(entry.percentDelta ?? entry.absoluteDelta);
}

function exceedsRegressionThreshold(
    entry: BenchmarkMetricComparison,
    percentThreshold: number | undefined,
    absoluteThreshold: number | undefined
): boolean {
    const percentMagnitude = entry.percentDelta === undefined ? undefined : Math.abs(entry.percentDelta);
    const absoluteMagnitude = Math.abs(entry.absoluteDelta);

    return (
        (percentThreshold !== undefined && percentMagnitude !== undefined && percentMagnitude >= percentThreshold) ||
        (absoluteThreshold !== undefined && absoluteMagnitude >= absoluteThreshold)
    );
}

function compareThresholdResults(
    left: BenchmarkRegressionThresholdResult,
    right: BenchmarkRegressionThresholdResult
): number {
    const severityDelta = getSeverityRank(right.severity) - getSeverityRank(left.severity);
    if (severityDelta !== 0) {
        return severityDelta;
    }

    return getMetricMagnitude(right) - getMetricMagnitude(left);
}

function getSeverityRank(severity: BenchmarkRegressionSeverity): number {
    switch (severity) {
        case 'failure':
            return 2;
        case 'warning':
            return 1;
        case 'none':
            return 0;
    }
}

export function writeBenchmarkComparisonArtifacts(
    outputDir: string,
    comparison: BenchmarkResultSetComparison
): BenchmarkComparisonArtifactPaths {
    fs.mkdirSync(outputDir, { recursive: true });

    const jsonPath = path.join(outputDir, 'comparison.json');
    const markdownPath = path.join(outputDir, 'comparison.md');

    fs.writeFileSync(jsonPath, JSON.stringify(comparison, undefined, 2), 'utf-8');
    fs.writeFileSync(markdownPath, renderBenchmarkComparisonMarkdown(comparison), 'utf-8');

    return { jsonPath, markdownPath };
}

function validateBenchmarkReportPair<ResultT>(
    baselineReport: BenchmarkReport<ResultT>,
    candidateReport: BenchmarkReport<ResultT>
): void {
    validateBenchmarkReport(baselineReport, 'baseline');
    validateBenchmarkReport(candidateReport, 'candidate');

    if (baselineReport.suiteName !== candidateReport.suiteName) {
        throw new Error(
            `Cannot compare benchmark reports for different suites: ${baselineReport.suiteName}, ${candidateReport.suiteName}`
        );
    }
}

function validateBenchmarkReport<ResultT>(report: BenchmarkReport<ResultT>, label: string): void {
    if (report.schemaVersion !== benchmarkReportSchemaVersion) {
        throw new Error(
            `Unsupported ${label} benchmark report schema version ${report.schemaVersion}; expected ${benchmarkReportSchemaVersion}.`
        );
    }
}

function compareBenchmarkResult<ResultT>(
    key: string,
    baselineResult: ResultT,
    candidateResult: ResultT,
    metrics: ReadonlyArray<BenchmarkMetricDefinition<ResultT>>
): BenchmarkResultComparison {
    return {
        key,
        metrics: metrics.flatMap((metric) => {
            const baselineValue = metric.getValue(baselineResult);
            const candidateValue = metric.getValue(candidateResult);

            if (baselineValue === undefined || candidateValue === undefined) {
                return [];
            }

            const absoluteDelta = candidateValue - baselineValue;
            return [
                {
                    metric: metric.name,
                    baselineValue,
                    candidateValue,
                    absoluteDelta,
                    percentDelta: calculatePercentDelta(baselineValue, candidateValue),
                    direction: getMetricDirection(absoluteDelta, metric),
                },
            ];
        }),
    };
}

function getMetricDirection<ResultT>(
    absoluteDelta: number,
    metric: BenchmarkMetricDefinition<ResultT>
): BenchmarkMetricDirection {
    const minAbsoluteDelta = metric.minAbsoluteDelta ?? 0;

    if (Math.abs(absoluteDelta) <= minAbsoluteDelta) {
        return 'unchanged';
    }

    const lowerIsBetter = metric.lowerIsBetter ?? true;
    const isHigher = absoluteDelta > 0;

    return lowerIsBetter === isHigher ? 'regression' : 'improvement';
}

function indexResultsByKey<ResultT>(
    results: ReadonlyArray<ResultT>,
    getKey: (result: ResultT) => string
): Map<string, ResultT> {
    const resultsByKey = new Map<string, ResultT>();

    for (const result of results) {
        const key = getKey(result);
        if (resultsByKey.has(key)) {
            throw new Error(`Duplicate benchmark result key: ${key}`);
        }

        resultsByKey.set(key, result);
    }

    return resultsByKey;
}

function formatMetric(value: number): string {
    return value.toFixed(2);
}

function formatPercent(value: number | undefined): string {
    return value === undefined ? 'n/a' : `${value.toFixed(2)}%`;
}
