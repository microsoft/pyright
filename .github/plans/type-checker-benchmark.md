# Pyright Type Checker Benchmark Plan

## Problem and approach

Add a type-checking speed and peak-memory benchmark to the Pyright repository, based directly on the original MIT-licensed benchmark in [`lolpack/type_coverage_py`](https://github.com/lolpack/type_coverage_py). During implementation, upstream `main` was checked at commit [`85667d6f090ce9648d88cd7a9777b492f3b95f1c`](https://github.com/lolpack/type_coverage_py/blob/85667d6f090ce9648d88cd7a9777b492f3b95f1c/typecheck_benchmark/daily_runner.py) from 2026-07-06. The benchmark will compare Pyright with other type checkers on real Python packages, initially using only pandas. Unlike the upstream script's PATH-based Pyright invocation, this repository-specific adaptation will build and measure the production CLI from the current Pyright checkout.

## Current state

- `build/perfCompare.py` already compares Pyright performance across git revisions on a user-supplied corpus. It should remain focused on regression comparisons and should not be replaced.
- Pyright's production CLI is built with `npm run build` in `packages/pyright` and invoked as `node packages/pyright/dist/pyright.js`.
- The repository has no existing cross-type-checker package benchmark harness.
- Existing generated benchmark data is ignored, but a new result directory under `build/benchmark` will need its own ignore rule.
- The original `lolpack/type_coverage_py` implementation:
  - clones configured repositories into a temporary directory;
  - installs the package and declared dependencies into the active Python environment;
  - creates checker-specific minimal configs;
  - runs warmup and measured iterations;
  - records wall-clock time and peak RSS;
  - writes dated and `latest` JSON reports.

## Todos

1. **Create the benchmark harness**
   - Add `build/benchmark/typecheck_benchmark.py`, preserving attribution to the original upstream MIT-licensed implementation and its pinned source revision.
   - Port package loading, temporary cloning, dependency installation, checker-specific configuration, timeout and OOM handling, warmup/measured runs, statistics, summary output, and JSON report generation.
   - Keep the comparison checker set aligned with the source benchmark: Pyright, Pyrefly, ty, mypy, and Zuban. Missing optional checkers should be reported as unavailable rather than aborting the entire run.
   - Treat normal type-error exit codes as successful benchmark runs while detecting timeouts and checker-specific fatal failures.

2. **Integrate the local Pyright build**
   - Resolve the repository root from the script location.
   - Before timing, run the production build once with `npm run build` in `packages/pyright`.
   - Invoke Pyright directly with Node and `packages/pyright/dist/pyright.js`, so the benchmark measures the current checkout rather than a globally installed package.
   - Add `--skip-pyright-build` for repeated runs when the production bundle already exists; validate the bundle path and fail clearly if it is missing.
   - Detect and record the local CLI's version using the same direct Node invocation.
   - Exclude the one-time build duration from all benchmark measurements.

3. **Add the initial pandas package configuration**
   - Add `build/benchmark/install_envs.json` with only `pandas-dev/pandas`.
   - Configure `pandas` as the check path, editable installation enabled, and the dependency set used by the upstream benchmark (`numpy`, date/time and database stubs, setuptools stubs, and pytest).
   - Keep the schema compatible with adding more package entries later without changing the harness.

4. **Document usage and outputs**
   - Add `build/benchmark/README.md` explaining prerequisites, environment isolation, the automatic local Pyright build, supported checkers, pandas-only initial scope, CLI flags, platform-specific memory behavior, and JSON output.
   - Include a minimal local-Pyright command and examples for selecting checkers, changing run counts, skipping the build, and choosing an output directory.
   - Update `CONTRIBUTING.md` to distinguish:
     - `build/perfCompare.py` for comparing Pyright revisions; and
     - `build/benchmark/typecheck_benchmark.py` for comparing type checkers on external packages.

5. **Keep generated artifacts out of source control**
   - Add `build/benchmark/results/` to `.gitignore`.
   - Continue using temporary directories for cloned pandas sources so package checkouts are removed after the run.
   - Use uniquely named temporary checker configs and remove them after each invocation, including when benchmarking a user-provided local directory.

6. **Validate the implementation**
   - Run Python syntax/help checks for the new script.
   - Add and run focused standard-library unit tests for config generation, command construction, provenance, local mode, and warmup/capture behavior.
   - Exercise argument validation and the missing/skip-build paths.
   - Build the production Pyright CLI.
   - Confirm generated JSON parses and contains the upstream provenance, local Pyright version, execution-time statistics, peak-memory fields, and configured memory limit.
   - Run the repository's existing formatting checks on the changed documentation and JSON.
   - Do not run a full pandas clone/install benchmark as part of implementation validation.

## Notes and considerations

- The benchmark measures end-to-end checker process wall time, whereas `perfCompare.py` parses Pyright's internal timing. The documentation should make this distinction explicit.
- Peak RSS follows the pinned upstream behavior: Linux samples `/proc/<pid>/status` and enforces a configurable limit, macOS uses `/usr/bin/time -l`, and Windows reports memory as unavailable.
- Dependency installation mutates the active Python environment, matching the upstream workflow. The README should strongly recommend running from a dedicated virtual environment.
- A full pandas benchmark requires a Python environment capable of installing pandas and its build dependencies.
