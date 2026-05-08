# Pyright Ecosystem Performance, Correctness, and Heuristics Benchmark Plan

## Goal

Build a repeatable benchmark system for Pyright and Pylance that answers five questions on every meaningful change:

1. Did diagnostics change?
2. Did total runtime regress?
3. Which phase regressed: parse, bind, type evaluation, import resolution, typeshed loading, completion building, or cache behavior?
4. Which project shape triggered it?
5. Can we safely tune evaluator heuristics such as recursion limits, union expansion limits, overload pruning thresholds, and protocol matching depth?

The plan combines three ideas:

- Use `mypy_primer` as the real-world project source of truth.
- Use Ty/Ruff-style cold, warm, incremental, and language-server benchmarks.
- Add Pyright-specific instrumentation so regressions and heuristic wins are explainable.

## Status Update

Current implementation status as of 2026-05-08:

- Completed: benchmark test directory layout, shared benchmark utilities, benchmark README, parser/tokenizer JSON artifact output,
  synthetic evaluator microbenchmarks, structured timing snapshots, evaluator phase timing metrics, curated ecosystem smoke
  project manifest and selectors, and old/new/comparison report comparison helpers.
- Completed: comparison helpers now support summary sections, largest regressions/improvements, threshold classification,
  `old.json`, `new.json`, `comparison.json`, and `comparison.md` generation, plus loading reports back from disk and a
  one-call compare-and-write flow.
- Completed externally: CodSpeed bootstrap work has an initial PR in `bschnurr/pyright`, so the remaining local work is
  to align this benchmark suite with that setup rather than starting CodSpeed integration from zero.
- In progress: ecosystem benchmark runner implementation. The manifest, selectors, report schema, comparison pipeline,
  and a `runEcosystemBenchmark.ts` entry point are in place for smoke-suite selection and report comparison, but there is
  not yet a `mypy_primer`-backed runner that executes base/head Pyright across the smoke suite.
- In progress: `mypy_primer` metadata synchronization has started with a generated project file, local overrides, and an
  initial `syncMypyPrimerProjects.ts` scaffold, but it does not yet sync from a checked-in upstream snapshot or drive
  real ecosystem execution.
- Not started: actual ecosystem execution, heuristic sweep harness, LSP benchmarks, and CI workflow wiring.

---

## Core Objectives

The benchmark system should support these goals:

1. Detect diagnostic regressions on real projects.
2. Detect total performance regressions.
3. Attribute regressions to parser, binder, evaluator, import resolver, typeshed, LSP, completion, or memory behavior.
4. Compare Pyright against Ty-style benchmark categories: cold check, warm check, time to first diagnostic, and incremental re-check.
5. Reuse the same ecosystem strategy as `mypy_primer`.
6. Benchmark Pylance/LSP operations like completion, hover, references, semantic tokens, and workspace load.
7. Safely tune Pyright type-evaluator heuristics and bailout thresholds.
8. Produce PR comments and artifacts that are useful to reviewers.
9. Support local developer workflows for comparing a branch against `main`.

---

## Why Reuse `mypy_primer`

`mypy_primer` already solves a hard problem: maintaining a real-world corpus of typed Python projects that can be checked by different type checkers. It includes project metadata such as:

```python
Project(
    location="https://github.com/pandas-dev/pandas",
    pyright_cmd="{pyright} {paths}",
    paths=["pandas"],
    deps=[...],
    expected_success=("mypy",),
    cost={"mypy": 355, "ty": 14},
)
```

Pyright should not invent a completely separate ecosystem list. Instead, Pyright should reuse the `mypy_primer` project list, then add Pyright-specific tags, benchmark tiers, performance metrics, and heuristic experiments.

The role split should be:

```text
mypy_primer:
  Did real-world diagnostics change?

Pyright benchmark harness:
  Why did performance change?
  Which phase changed?
  Which project pattern exposed it?
  Which heuristic settings are safe?
```

---

## Benchmark Categories

### 1. Microbenchmarks

Run on every relevant PR.

Purpose: catch parser, binder, evaluator, and completion hot-path regressions quickly.

Example cases:

```text
micro/parser_large_file
micro/tokenizer_comments_strings
micro/binder_many_imports
micro/union_expansion
micro/large_union_narrowing
micro/overload_many_candidates
micro/overload_union_cross_product
micro/protocol_many_members_match
micro/protocol_many_members_mismatch
micro/recursive_protocol
micro/typed_dict_many_keys
micro/typevar_constraint_matrix
micro/deep_generic_alias_chain
micro/literal_union_math
micro/completion_list_building
```

Metrics:

```text
elapsedMs
parseMs
bindMs
checkMs
tokens/sec
filesParsed
filesBound
filesChecked
AST node count
symbol count
type cache hits/misses
heapUsedMb
```

Use synthetic generators rather than committing giant hand-written Python files.

Example generator targets:

```text
generateLargeUnionNarrowingCase(10, 50, 100, 250)
generateManyOverloadsCase(10, 50, 100, 500)
generateProtocolCase(members=50, match=true/false)
generateLargeTypedDictCase(keys=100, 500, 1000)
generateImportGraphCase(files=100, 1000)
generateRecursiveAliasCase(depth=16, 32, 64, 128)
```

---

### 2. Ecosystem Smoke Benchmarks

Run on most PRs that touch parser, binder, evaluator, import resolver, typeshed, or diagnostics.

Use a curated subset of `mypy_primer` projects.

Suggested smoke suite:

```text
black
pytest
attrs
pydantic
python-chess
packaging
rich
mypy_primer
django-modern-rest
pandas
```

Reasoning:

```text
black:
  Parser-heavy, practical codebase.

pytest:
  Large, dynamic Python codebase.

attrs:
  Dataclass-like patterns and decorators.

pydantic:
  Decorators, generics, validation model patterns.

python-chess:
  Relatively clean expected-success signal.

packaging:
  Small stable baseline.

rich:
  Practical typed library with meaningful structure.

mypy_primer:
  Typed tool codebase.

django-modern-rest:
  Web, Django-ish, pydantic-ish patterns.

pandas:
  Data-science, stubs-heavy, overload-heavy.
```

Target runtime: under 10–15 minutes.

Metrics:

```text
diagnostic diff
total runtime
parse/bind/check/import resolver timings
files analyzed
memory usage
phase-level deltas
```

---

### 3. Full Ecosystem Benchmarks

Run nightly, manually, and on risky PRs.

Use all `mypy_primer` projects that support Pyright via `pyright_cmd`.

Use sharding:

```yaml
strategy:
  matrix:
    shard-index: [0, 1, 2, 3, 4, 5, 6, 7]
```

Inputs:

```text
--suite full
--num-shards 8
--shard-index N
--project-date YYYY-MM-DD
```

The full run should compare:

```text
base commit vs head commit
old diagnostics vs new diagnostics
old metrics vs new metrics
old phase timings vs new phase timings
```

---

### 4. Ty-Style Benchmarks

Ty tracks more than one mode. Pyright should mirror the same broad categories:

```text
cold check:
  Type-check a project from scratch.

warm check:
  Re-check with caches already populated.

time to first diagnostic:
  Start a language-server-like session and measure first diagnostics.

incremental re-check:
  Simulate an edit and measure diagnostics recomputation.
```

Benchmark operations:

```text
cold[project]
warm[project]
first_diagnostic[project]
incremental[edit_private_function_body]
incremental[edit_public_function_signature]
incremental[edit_imported_symbol]
incremental[edit_protocol_member]
incremental[edit_type_alias]
incremental[edit_pyproject_config]
```

Track:

```text
elapsedMs
files invalidated
files reparsed
files rebound
files rechecked
diagnostics recomputed
cache hits/misses
memory before/after
```

---

### 5. Pylance/LSP Benchmarks

CLI type checking does not exercise all user-visible performance paths. Add a dedicated LSP harness.

Operations:

```text
lsp/open_workspace
lsp/first_diagnostics
lsp/completion_after_dot
lsp/completion_import_statement
lsp/completion_auto_imports_small
lsp/completion_auto_imports_large
lsp/hover_generic_call
lsp/go_to_definition
lsp/find_references
lsp/rename_symbol
lsp/document_symbols
lsp/workspace_symbols
lsp/semantic_tokens_large_file
```

Metrics:

```text
request latency p50/p95
items produced
items filtered
auto-import candidates scanned
sort/filter time
symbol index lookup time
diagnostics latency
semantic token count
heap before/after
```

Useful LSP stress workspaces:

```text
large venv
pandas-like project
django-like project
repo with many exports
repo with many same-named symbols
repo with deep import graph
```

---

## Evaluator Heuristics Tuning

This should be a first-class goal.

Pyright has many evaluator heuristics and bailout thresholds. The benchmark suite should allow safe experimentation with:

```text
recursion limits
union expansion limits
overload candidate pruning
protocol matching depth
recursive type alias expansion
speculative evaluation limits
constraint solver bailout thresholds
literal math / enum expansion thresholds
TypedDict key analysis limits
call-site cache eviction thresholds
type cache sizing
```

The benchmark suite should answer:

```text
Can we lower or raise this limit?
Does it improve performance?
Does it change diagnostics?
Does it reduce worst-case cliffs?
Which real projects are affected?
```

---

## Evaluator Heuristic Sweeps

Add a dedicated benchmark category:

```text
packages/pyright-internal/benchmarks/evaluatorHeuristics/
  heuristicMatrix.json
  runHeuristicSweep.ts
  renderHeuristicReport.ts
  cases/
    recursiveAlias.ts
    deepGenericAlias.ts
    overloadUnionExpansion.ts
    protocolRecursive.ts
    constrainedTypeVarExplosion.ts
    typedDictHugeKeySet.ts
```

Example `heuristicMatrix.json`:

```json
{
  "recursionDepthLimit": [16, 32, 64, 128],
  "unionExpansionLimit": [16, 32, 64, 128],
  "overloadCandidateLimit": [32, 64, 128, 256],
  "protocolMatchDepthLimit": [8, 16, 32, 64],
  "typeAliasExpansionLimit": [16, 32, 64, 128],
  "speculativeEvalLimit": [64, 128, 256, 512]
}
```

Example command:

```bash
node runHeuristicSweep.js   --project pandas   --heuristic unionExpansionLimit   --values 16,32,64,128
```

Possible hidden/test-only override mechanism:

```bash
PYRIGHT_PERF_UNION_EXPANSION_LIMIT=32
PYRIGHT_PERF_RECURSION_DEPTH_LIMIT=64
PYRIGHT_PERF_PROTOCOL_DEPTH_LIMIT=16
```

Or a test-only config object:

```ts
const options = {
  typeCheckingMode: "strict",
  perfOptions: {
    evaluatorHeuristics: {
      unionExpansionLimit: 32,
      recursionDepthLimit: 64,
      protocolMatchDepthLimit: 16
    }
  }
};
```

---

## Heuristic Instrumentation

Add optional counters for when heuristics trigger:

```text
recursionLimitHitCount
unionExpansionLimitHitCount
overloadPrunedCandidateCount
protocolDepthLimitHitCount
typeAliasExpansionLimitHitCount
speculativeEvalLimitHitCount
constraintSolverBailoutCount
maxTypeEvalRecursionDepth
maxUnionExpansionSize
maxProtocolMatchDepth
maxOverloadCandidateCount
```

Example raw result:

```json
{
  "case": "recursive_alias_depth_64",
  "heuristic": "recursionDepthLimit",
  "value": 32,
  "diagnosticCount": 2,
  "diagnosticDiff": false,
  "elapsedMs": 84,
  "checkMs": 72,
  "bailoutCount": 1,
  "maxObservedDepth": 31,
  "cacheHitRate": 0.82
}
```

Useful interpretation:

```text
pandas:
  checkMs: +2.1%
  overloadPrunedCandidateCount: 0
  recursionLimitHitCount: 0

pydantic:
  checkMs: -14.8%
  speculativeEvalLimitHitCount: +120
  diagnosticDiff: false
```

That tells reviewers whether a heuristic helped safely.

---

## Synthetic Cliff Tests

Add synthetic cases that intentionally hit worst-case evaluator paths.

```text
synthetic[recursive_alias_depth][16,32,64,128]
synthetic[overload_union_cross_product][4x4,8x8,16x16]
synthetic[protocol_recursive_members][8,16,32]
synthetic[generic_alias_chain][16,32,64,128]
synthetic[constrained_typevar_matrix][4,8,16]
synthetic[literal_union_math][32,64,128,256]
synthetic[typed_dict_key_count][100,500,1000]
```

Goal: reveal complexity cliffs.

Example output:

```text
recursive_alias_depth:
  depth=16    8ms
  depth=32   21ms
  depth=64   98ms
  depth=128  1100ms  ⚠️ cliff
```

---

## Real-Project Heuristic Targets

Run heuristic sweeps against selected ecosystem projects.

```text
pandas:
  overloads, stubs, data-science

pydantic:
  decorators, generics, dataclass-like transforms

attrs:
  dataclass-like, protocols

sqlalchemy:
  generics, overloads, ORM patterns

xarray:
  pandas/numpy typing, overloads

jax:
  numpy-style typing, generics

pytest:
  dynamic patterns, plugins

django-modern-rest:
  pydantic + web + serializers

mypy_primer:
  typed codebase, real tool
```

For each heuristic experiment, require:

```text
no unexpected diagnostic diff
no new crashes
no large increase in Unknown/Any if tracked
performance improvement or reduced worst-case cliff
```

---

## Heuristic Decision Report

Each heuristic sweep should produce a recommendation document.

Example:

```md
# Heuristic sweep: unionExpansionLimit

## Recommendation

Keep default at 64.

## Why

- 32 improves worst-case synthetic benchmarks by 18–40%.
- But 32 causes diagnostic diffs in pandas and xarray.
- 64 avoids diffs and still prevents 128-depth explosion.
- 128 gives no useful real-project benefit and increases check time in overload-heavy cases.

## Results

| Project | 32 | 64 | 128 | Diagnostic diff |
|---|---:|---:|---:|---|
| pandas | 41.2s | 44.0s | 46.7s | yes at 32 |
| pydantic | 12.1s | 12.4s | 12.8s | no |
| xarray | 31.4s | 33.0s | 36.5s | yes at 32 |
```

This turns heuristic tuning into an evidence-based process.

---

## Project Tagging

Add Pyright-specific tags on top of the `mypy_primer` manifest.

Example `ecosystem-projects.overrides.json`:

```json
{
  "pandas": {
    "tags": ["large", "data-science", "numpy", "overloads", "stubs-heavy"]
  },
  "jax": {
    "tags": ["large", "ml", "numpy", "generics", "overloads"]
  },
  "pydantic": {
    "tags": ["decorators", "dataclass-like", "generics"]
  },
  "attrs": {
    "tags": ["dataclass-like", "stubs", "protocols"]
  },
  "pytest": {
    "tags": ["dynamic", "plugins", "large-tests"]
  },
  "django-modern-rest": {
    "tags": ["django", "pydantic", "web"]
  },
  "sqlalchemy": {
    "tags": ["orm", "generics", "overloads"]
  },
  "xarray": {
    "tags": ["data-science", "pandas", "numpy", "large"]
  }
}
```

Commands:

```bash
node runEcosystemBenchmark.js --tag overloads
node runEcosystemBenchmark.js --tag parser-heavy
node runEcosystemBenchmark.js --tag data-science
node runEcosystemBenchmark.js --tag decorators
node runEcosystemBenchmark.js --tag completion-heavy
```

This lets a parser PR run parser-heavy projects, while an overload PR runs overload-heavy projects.

---

## Metrics Model

Every benchmark should emit structured JSON.

Example:

```json
{
  "benchmark": "cold[pandas]",
  "suite": "ecosystem-smoke",
  "project": "pandas",
  "commit": "abc123",
  "totalMs": 123456,
  "parseMs": 1234,
  "bindMs": 2345,
  "checkMs": 100000,
  "importResolverMs": 3456,
  "typeshedLoadMs": 789,
  "filesParsed": 1234,
  "filesBound": 1234,
  "filesChecked": 1200,
  "sourceLines": 500000,
  "tokenCount": 8000000,
  "astNodeCount": 3000000,
  "symbolCount": 400000,
  "typeCacheHits": 123456,
  "typeCacheMisses": 12345,
  "overloadResolutionCount": 9876,
  "unionExpansionCount": 1234,
  "speculativeEvalCount": 2222,
  "heuristicCounters": {
    "recursionLimitHitCount": 0,
    "unionExpansionLimitHitCount": 12,
    "overloadPrunedCandidateCount": 300
  },
  "diagnosticCount": 42,
  "heapUsedMb": 512
}
```

---

## Comparison Output

Generate:

```text
old.json
new.json
comparison.json
comparison.md
```

Example Markdown report:

```md
# Pyright Ecosystem Benchmark

Base: abc123
Head: def456

## Summary

| Metric | Old | New | Delta |
|---|---:|---:|---:|
| Total time | 322.4s | 309.8s | -3.9% |
| Parse time | 24.1s | 17.2s | -28.6% |
| Bind time | 31.0s | 31.5s | +1.6% |
| Check time | 250.7s | 247.9s | -1.1% |

## Largest Regressions

| Project | Old | New | Delta | Phase |
|---|---:|---:|---:|---|
| pandas | 58.2s | 63.1s | +8.4% | check |
| jax | 41.0s | 43.7s | +6.6% | import resolver |

## Largest Wins

| Project | Old | New | Delta | Phase |
|---|---:|---:|---:|---|
| black | 11.2s | 8.0s | -28.6% | parse |
```

---

## Regression Thresholds

Use both percent and absolute thresholds.

Example:

```json
{
  "failOnDiagnosticsDiff": true,
  "warnTotalRegressionPct": 5,
  "failTotalRegressionPct": 10,
  "warnProjectRegressionPct": 10,
  "failProjectRegressionPct": 20,
  "minAbsoluteRegressionMs": 3000
}
```

Reason: tiny projects can produce noisy percentage swings.

---

## Project-Date Pinning

Use a pinned project date for ecosystem stability.

Example:

```bash
mypy_primer --type-checker pyright --project-date 2026-01-01
```

Store in the benchmark config:

```json
{
  "projectDate": "2026-01-01"
}
```

Update the date intentionally, maybe monthly, not accidentally on every run.

---

## File Layout

```text
packages/pyright-internal/
  src/tests/benchmarks/
    README.md

    micro/
      runMicroBenchmarks.ts
      cases/
        parserLargeFile.ts
        tokenizerStrings.ts
        overloadCache.ts
        unionExpansion.ts
        recursiveAlias.ts
        protocolMatching.ts
        typedDictHuge.ts

    ecosystem/
      ecosystem-projects.generated.json
      ecosystem-projects.overrides.json
      syncMypyPrimerProjects.ts
      runEcosystemBenchmark.ts
      compareBenchmarkResults.ts
      renderMarkdownReport.ts
      projectTags.ts

    lsp/
      runLspBenchmarks.ts
      lspPerfHarness.ts
      scenarios/
        completionLargeModule.json
        completionAutoImports.json
        hoverLargeUnion.json
        semanticTokensLargeFile.json
        findReferencesLargeWorkspace.json

    evaluatorHeuristics/
      heuristicMatrix.json
      runHeuristicSweep.ts
      renderHeuristicReport.ts
      cases/
        recursiveAlias.ts
        deepGenericAlias.ts
        overloadUnionExpansion.ts
        protocolRecursive.ts
        constrainedTypeVarExplosion.ts
        typedDictHugeKeySet.ts

    artifacts/
      .gitignore
```

---

## CI Workflows

### PR Smoke Benchmark

```yaml
name: Pyright ecosystem smoke benchmark

on:
  pull_request:
    paths:
      - 'packages/pyright/**'
      - 'packages/pyright-internal/src/**'
      - 'packages/pyright-internal/typeshed-fallback/**'

jobs:
  ecosystem-smoke:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4

      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - run: npm ci
      - run: npm run build

      - run: python -m pip install -U pip
      - run: pip install git+https://github.com/hauntsaninja/mypy_primer.git

      - name: Run smoke ecosystem benchmark
        run: |
          node packages/pyright-internal/benchmarks/ecosystem/runEcosystemBenchmark.js \
            --suite smoke \
            --base origin/${{ github.base_ref }} \
            --head ${{ github.sha }} \
            --project-date 2026-01-01 \
            --output artifacts/ecosystem-smoke

      - uses: actions/upload-artifact@v4
        with:
          name: pyright-ecosystem-smoke
          path: artifacts/ecosystem-smoke
```

### Nightly Full Benchmark

```yaml
name: Pyright ecosystem full benchmark

on:
  schedule:
    - cron: '0 8 * * *'
  workflow_dispatch:

jobs:
  full:
    strategy:
      fail-fast: false
      matrix:
        shard-index: [0,1,2,3,4,5,6,7]

    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - run: npm ci
      - run: npm run build
      - run: python -m pip install -U pip
      - run: pip install git+https://github.com/hauntsaninja/mypy_primer.git

      - run: |
          node packages/pyright-internal/benchmarks/ecosystem/runEcosystemBenchmark.js \
            --suite full \
            --num-shards 8 \
            --shard-index ${{ matrix.shard-index }} \
            --project-date 2026-01-01 \
            --output artifacts/full-${{ matrix.shard-index }}
```

### Manual Targeted Benchmark

```yaml
on:
  workflow_dispatch:
    inputs:
      tag:
        description: 'Project tag: overloads, parser-heavy, data-science, decorators'
        required: false
      project:
        description: 'Specific project regex'
        required: false
      heuristic:
        description: 'Optional heuristic sweep name'
        required: false
```

---

## Local Developer Commands

Add scripts:

```json
{
  "scripts": {
    "bench:micro": "node packages/pyright-internal/benchmarks/micro/runMicroBenchmarks.js",
    "bench:ecosystem:smoke": "node packages/pyright-internal/benchmarks/ecosystem/runEcosystemBenchmark.js --suite smoke",
    "bench:ecosystem:full": "node packages/pyright-internal/benchmarks/ecosystem/runEcosystemBenchmark.js --suite full",
    "bench:ecosystem:tag": "node packages/pyright-internal/benchmarks/ecosystem/runEcosystemBenchmark.js --tag",
    "bench:lsp": "node packages/pyright-internal/benchmarks/lsp/runLspBenchmarks.js",
    "bench:heuristics": "node packages/pyright-internal/benchmarks/evaluatorHeuristics/runHeuristicSweep.js"
  }
}
```

Example usage:

```bash
npm run bench:micro
npm run bench:ecosystem:smoke
npm run bench:ecosystem:tag -- overloads
npm run bench:lsp
npm run bench:heuristics -- --heuristic recursionDepthLimit --values 16,32,64,128
```

---

## CodSpeed Integration

Use CodSpeed for Tier 0 and selected stable microbenchmarks.

Status update:

- Initial CodSpeed setup already exists in an external PR in `bschnurr/pyright`.
- The next step in this repo is to wire the stable microbenchmark subset into that setup once the local benchmark entry
  points match the expected runner shape.

Good candidates:

```text
parser large file
tokenizer comments/strings
union expansion
overload many candidates
protocol mismatch
typed dict many keys
completion list building
```

Do not start by putting all ecosystem benchmarks into CodSpeed. Use CodSpeed for stable, smaller, lower-noise cases. Use the ecosystem runner for heavier PR and nightly artifacts.

---

## Optimization Use Cases

### Parser/tokenizer rewrite

Expected wins:

```text
parseMs lower
token/sec higher
totalMs lower on parser-heavy projects
no diagnostic diff
```

Stress projects:

```text
black
mypy
pytest
pandas
sphinx-like docs projects
```

### Import resolver/cache changes

Expected wins:

```text
importResolverMs lower
typeshedLoadMs lower
fewer filesystem stats
fewer repeated module resolutions
```

Stress projects:

```text
pandas
xarray
jax
scikit-learn
django-style projects
large venv workspace
```

### Overload resolution optimization

Expected wins:

```text
checkMs lower
overloadResolutionCount same or lower
cache hit rate higher
diagnostics unchanged
```

Stress projects:

```text
pandas
jax
xarray
pydantic
sqlalchemy
numpy/scipy-stubs if included
```

### Evaluator heuristic tuning

Expected wins:

```text
reduced worst-case cliffs
fewer runaway expansions
diagnostics unchanged
bounded cache/memory growth
```

Stress cases:

```text
recursive aliases
deep generic aliases
union cross products
large overload sets
recursive protocols
constrained TypeVar matrices
```

### Completion list building

Expected wins:

```text
completion latency lower
auto-import scan time lower
sort/filter time lower
items unchanged or intentionally improved
```

Stress workspaces:

```text
large venv
pandas project
django project
repo with many exports
```

### Typeshed/stub changes

Expected wins:

```text
diagnostic diffs explainable
typeshedLoadMs stable
checkMs stable
Unknown/Any regressions detected if tracked
```

Stress projects:

```text
pandas
requests users
django-stubs users
numpy/scipy-stubs users
pydantic users
```

---

## MVP Implementation

First useful version:

1. [x] Add benchmark directory layout.
2. [~] Add `syncMypyPrimerProjects.ts`.
3. [x] Generate `ecosystem-projects.generated.json`.
4. [x] Add `ecosystem-projects.overrides.json`.
5. [x] Add a smoke suite of 8–10 projects.
6. [~] Add `runEcosystemBenchmark.ts`.
  - [x] Parse smoke-suite selection inputs (`--suite`, `--tag`, `--project`, `--num-shards`, `--shard-index`, `--output`).
  - [x] Write a selection manifest artifact for the resolved project set.
  - [x] Compare existing ecosystem benchmark reports into `old.json`, `new.json`, `comparison.json`, and `comparison.md`.
  - [ ] Run base vs head Pyright for the selected projects.
  - [x] Resolve the smoke suite from generated project metadata plus local overrides.
7. [ ] Run base vs head Pyright.
8. [ ] Capture:
   - total runtime
   - diagnostic count
   - diagnostic diff
   - process memory
9. [~] Generate:
  - [x] `old.json`
  - [x] `new.json`
  - [x] `comparison.json`
  - [x] `comparison.md`
  - [~] Wire these artifacts into an actual ecosystem benchmark runner output.
10. [ ] Add manual GitHub workflow.
11. [ ] Add one heuristic sweep:
   - `recursionDepthLimit` or `unionExpansionLimit`
12. [x] Add two synthetic heuristic cases:
  - [x] recursive alias depth
  - [x] overload union cross product
13. [ ] Add one heuristic report:
   - `heuristic-recommendation.md`

MVP smoke project list:

```text
black
pytest
attrs
pydantic
python-chess
packaging
rich
mypy_primer
django-modern-rest
pandas
```

---

## Longer-Term Implementation Stages

### Stage 1: Correctness + wall time

Use `mypy_primer` project list. Compare old vs new Pyright output and total runtime.

### Stage 2: Phase metrics

Add Pyright benchmark JSON output with parse, bind, check, import resolver, typeshed, and memory metrics.

### Stage 3: LSP metrics

Add Pylance-style LSP operation benchmark harness.

### Stage 4: Heuristic sweeps

Add test-only evaluator heuristic overrides and sweep reports.

### Stage 5: PR comments

Post concise benchmark summaries on PRs.

### Stage 6: CodSpeed

Use CodSpeed for stable microbenchmarks and low-noise hot paths.

### Stage 7: Nightly dashboards

Track trends over time for full ecosystem and heuristic counters.

---

## Final Design Principle

Use `mypy_primer` as the ecosystem correctness corpus, but own the Pyright performance and heuristic story.

`mypy_primer` answers:

```text
Did behavior change on real projects?
```

The Pyright benchmark harness answers:

```text
Why did performance change?
Which phase changed?
Which project pattern exposed it?
Which evaluator heuristic setting is safe?
What should reviewers do with this information?
```
