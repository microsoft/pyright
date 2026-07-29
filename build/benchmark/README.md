# Cross-Type-Checker Benchmark

`typecheck_benchmark.py` compares wall-clock speed and peak RSS for Pyright, Pyrefly, ty, mypy, and
Zuban. It is a Pyright-specific adaptation directly from the original MIT-licensed
[`lolpack/type_coverage_py`](https://github.com/lolpack/type_coverage_py) benchmark, pinned to
[`typecheck_benchmark/daily_runner.py` at commit `85667d6f090ce9648d88cd7a9777b492f3b95f1c`](https://github.com/lolpack/type_coverage_py/blob/85667d6f090ce9648d88cd7a9777b492f3b95f1c/typecheck_benchmark/daily_runner.py).
The upstream copyright and MIT license are reproduced in
[`UPSTREAM_LICENSE.txt`](UPSTREAM_LICENSE.txt).
The local integration preserves repository-specific behavior: it builds and invokes the current
checkout's Pyright production bundle rather than resolving Pyright from `PATH`. The benchmark
measures performance only, not diagnostic accuracy or type precision.

The checked corpus is intentionally limited to `pandas-dev/pandas`, with the `pandas` directory as
the check path.

## Prerequisites

- Python 3.10 or newer, with pip
- Git
- Node.js and npm
- The non-Pyright checkers you want to measure installed in the active Python environment:

    ```console
    python -m pip install pyrefly ty mypy zuban
    ```

Use a dedicated virtual environment. The benchmark clones pandas into a temporary directory and
installs pandas plus its configured dependencies into the active environment.

From the repository root:

```console
python build/benchmark/typecheck_benchmark.py
python build/benchmark/typecheck_benchmark.py -c pyright mypy -r 3 -w 1
python build/benchmark/typecheck_benchmark.py -c pyright --skip-pyright-build
python build/benchmark/typecheck_benchmark.py -c pyright --local path/to/project
```

## Local Pyright build

When Pyright is selected, the script automatically runs `npm run build` in `packages/pyright` once
before cloning or timing the corpus. Build time is not measured. Every Pyright invocation, including
version detection, uses `node packages/pyright/dist/pyright.js`; a `pyright` executable on `PATH` is
never used.

Use `--skip-pyright-build` to reuse an existing production bundle. The script rejects this flag if
`packages/pyright/dist/pyright.js` does not exist.

## Local directories

Use `--local PATH` to benchmark an existing directory without cloning it, installing it, or deleting
it afterward. If Pyright is selected, the local Pyright production bundle is still built first unless
`--skip-pyright-build` is supplied.

Checker configuration files use unique temporary names in the target directory and are removed after
each invocation. Existing `pyrightconfig.json`, mypy, ty, or Pyrefly configuration files are not
overwritten. The temporary configuration selects the full local directory.

## Options

| Flag | Description |
| --- | --- |
| `-c, --checkers NAME [NAME ...]` | Checkers to run; choices are `pyright`, `pyrefly`, `ty`, `mypy`, and `zuban` |
| `-r, --runs N` | Measured runs per checker (default: 5) |
| `-w, --warmup N` | Warmup runs discarded before measurement (default: 1) |
| `-t, --timeout SECONDS` | Timeout for each checker invocation (default: 300) |
| `-p, --packages N` | Maximum configured packages to run |
| `-n, --package-names NAME [NAME ...]` | Select configured packages by name |
| `-o, --output DIR` | Output directory |
| `--os-name NAME` | Add an OS or machine label to output filenames |
| `--install-envs PATH` | Use another package configuration JSON file |
| `--local PATH` | Benchmark a local directory without clone or dependency installation |
| `--memory-limit-mb N` | Linux per-process RSS limit in MiB (default: 4096); `0` disables it |
| `--skip-pyright-build` | Reuse the existing local Pyright production bundle |

## Results

By default, results are written to the ignored `build/benchmark/results/` directory. Each invocation
writes a UTC-dated file such as `benchmark_2026-07-28.json` and updates `latest.json`. With
`--os-name macos`, the names are `benchmark_2026-07-28_macos.json` and `latest-macos.json`.

The top-level JSON records the timestamp, platform, checker versions, run settings, aggregate
statistics, per-package results, configured memory limit, and an `upstream_source` object containing
the original repository, exact commit, and source-file URL. Each successful checker result contains
the measured wall times and peak-memory values, plus min, max, mean, median, and standard deviation.
Aggregate data contains package counts and mean, p50, p90, p95, maximum, and total timing or memory
statistics.

On Linux, peak RSS is sampled from `/proc/<pid>/status`. The process group is killed and the result is
reported as OOM if RSS exceeds `--memory-limit-mb`; use `0` to disable the limit. On macOS, peak RSS
is read from `/usr/bin/time -l`. Windows memory measurement remains unavailable, so memory values are
`0` and `memory_measurement` is `unavailable`.

The first discarded invocation captures output and validates that the checker can run. Remaining
warmups and all measured runs discard output to avoid pipe overhead. `--warmup 0` still performs one
uncounted validation pass labeled `Check`; otherwise exactly the requested number of warmups is
reported and discarded.

Dependency installation failures produce a warning and timing continues. If none of a package's
configured check paths exist, the benchmark warns and checks the full repository.

## Relationship to `perfCompare.py`

`build/perfCompare.py` compares Pyright revisions on the same corpus to detect performance
regressions. This benchmark compares the local Pyright build with other type checkers on pandas.
