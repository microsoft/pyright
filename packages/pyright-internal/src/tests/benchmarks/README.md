# Pyright Benchmarks

This directory contains opt-in performance benchmarks for Pyright internals. They are excluded from the normal Jest test
suite and run through the package benchmark script.

```bash
cd packages/pyright-internal
npm run test:benchmark
```

Benchmark JSON artifacts are written under:

```text
src/tests/benchmarks/.generated/benchmark-results/
```

## Current Suites

- `parserBenchmark.test.ts` measures parser throughput over representative Python corpora.
- `tokenizerBenchmark.test.ts` measures tokenizer throughput and runs each corpus in a fresh child process to reduce
    cross-test heap effects.
- `benchmarkUtils.ts` contains shared statistics, system metadata, corpus loading, JSON artifact writing, count
    formatting, and child-process benchmark helpers.

## Result Shape

The current microbenchmark reports use this common envelope:

```ts
interface BenchmarkReport<ResultT> {
    timestamp: string;
    system: BenchmarkSystemInfo;
    config: {
        warmupIterations: number;
        benchmarkIterations: number;
    };
    results: ResultT[];
}
```

Individual suites add case-specific fields such as token count, AST node count, median time, p95 time, and throughput.

## Implementation Roadmap

1. Extend microbenchmarks with deterministic generated cases for evaluator-heavy paths.
2. Add ecosystem smoke benchmarks that compare base and head Pyright builds on a curated mypy_primer-compatible project list.
3. Emit structured phase metrics from `TimingStats` rather than parsing CLI `--stats` text.
4. Add heuristic counters and sweep reports for evaluator bailout thresholds.
5. Add LSP operation benchmarks after CLI and ecosystem reporting are stable.

## CodSpeed Notes

Before adding CodSpeed integration, review the current CodSpeed documentation at <https://codspeed.io/docs>. Use CodSpeed
only for stable, low-noise microbenchmarks at first; keep ecosystem, heuristic sweep, and LSP benchmarks in the JSON
artifact/report workflow until their runtime and variance are better understood.

Keep new benchmark cases deterministic and report-only by default. Performance thresholds should be introduced only after
repeated runs establish noise levels.