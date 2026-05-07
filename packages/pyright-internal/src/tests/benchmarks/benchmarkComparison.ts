export type BenchmarkMetricDirection = 'improvement' | 'regression' | 'unchanged';

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

export function renderBenchmarkComparisonMarkdown(comparison: BenchmarkResultSetComparison): string {
    const lines = [
        '| Case | Metric | Baseline | Candidate | Delta | Delta % | Direction |',
        '|---|---:|---:|---:|---:|---:|---|',
    ];

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
