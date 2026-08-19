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

The checked corpus is a curated set of source repositories derived from
[`lolpack/type_coverage_py`](https://github.com/lolpack/type_coverage_py/blob/main/included_packages.txt).
Each entry in `install_envs.json` defines its repository, check paths, installation behavior, and
additional dependencies. Repository commits are pinned so pull-request comparisons analyze the same
source revisions.

Entries can define `exclude_directories` to prune named directories while resolving their check
paths. The benchmark expands those entries to `.py` and `.pyi` files before invoking any checker, so
all checkers analyze the same scope. NumPy excludes its test directories; pandas includes its test
and `_testing` directories. Generated Pyright configurations explicitly retain
its standard `**/node_modules`, `**/__pycache__`, and `**/.*` exclusions.

## Prerequisites

- Python 3.14.6, with pip
- Git
- Node.js and pnpm
- The non-Pyright checkers you want to measure installed in the active Python environment:

    ```console
    python -m pip install pyrefly ty mypy zuban
    ```

- To compare the working tree with the latest Pyright release from PyPI:

    ```console
    python -m pip install --upgrade pyright
    ```

Use a dedicated virtual environment with pip available. The benchmark clones each package into a
temporary directory and installs the project and configured dependencies into a package-specific
target directory outside the source checkout. Checker subprocesses use only that package's target,
so installations for earlier corpus entries cannot affect later measurements. A benchmark that
reports a dependency-installation warning is not a valid prepared-environment measurement and
should be rerun after fixing pip or the package installation.

From the repository root:

```console
python build/benchmark/typecheck_benchmark.py
python build/benchmark/typecheck_benchmark.py -c pyright mypy -r 3 -w 1
python build/benchmark/typecheck_benchmark.py -c pyright --skip-pyright-build
python build/benchmark/typecheck_benchmark.py -c pyright --local path/to/project
python build/benchmark/typecheck_benchmark.py -c pyright pyright-pip -r 3 -w 1
```

## Local Pyright build

When Pyright is selected, the script automatically runs `pnpm run build` in `packages/pyright` once
before cloning or timing the corpus. Build time is not measured. Every Pyright invocation, including
version detection, uses `node packages/pyright/index.js`; a `pyright` executable on `PATH` is never
used. The package entry point initializes the production bundle's resource root before loading
`dist/pyright.js`.

Select `pyright-pip` alongside `pyright` to compare the working tree against the Pyright package
installed in the active Python environment. `pyright-pip` invokes `python -m pyright`, so it cannot
accidentally resolve an npm-installed executable from `PATH`. Both variants run over the same prepared
corpus in one invocation; their versions, timing, and peak memory are reported in adjacent summary
rows. Upgrade the package first when the comparison should use the latest PyPI release.

Use `--skip-pyright-build` to reuse an existing production bundle. The script rejects this flag if
`packages/pyright/dist/pyright.js` does not exist.

## Local directories

Use `--local PATH` to benchmark an existing directory without cloning it, installing it, or deleting
it afterward. If Pyright is selected, the local Pyright production bundle is still built first unless
`--skip-pyright-build` is supplied.

Checker configuration files use unique temporary names in the target directory and are removed after
each invocation. Existing `pyrightconfig.json`, mypy, ty, or Pyrefly configuration files are not
overwritten. The temporary configuration selects the full local directory.

## Developer workflow

To compare working-tree changes with the latest Pyright release on the pinned corpus, install or
upgrade Pyright in the active virtual environment and select both Pyright variants:

```console
python -m pip install --upgrade pyright
python build/benchmark/typecheck_benchmark.py \
    -c pyright pyright-pip -r 3 -w 1
```

`pyright` builds and runs the current checkout. `pyright-pip` runs the release through the active
interpreter with `python -m pyright`. The summary shows each version, timing, and peak memory in
adjacent rows. Add `--local PATH` for a quick comparison on one existing project; omit it to use the
full pinned corpus. Use the same machine and active environment for both variants.

Local results should be used for investigation, not compared with the checked-in hosted-runner
baseline. Machine class, operating system, Python version, and benchmark settings are part of the
result contract, and the comparator rejects mismatched environments.

## Maintainer workflow

The hosted pull-request benchmark runs only when a maintainer comments exactly `/benchmark` on an
open pull request. The command must be the entire comment. The trusted command workflow checks that
the commenter has `write`, `maintain`, or `admin` repository permission and then toggles the
`run-typecheck-benchmark` label. Users without one of these permissions cannot start the benchmark.

The label event runs the pull request's current head with read-only repository permissions. When the
run completes, a separate trusted workflow validates that the result belongs to the pull request's
current head, renders it using default-branch code, and creates or updates one benchmark comment. The
Actions job summary and `typecheck-benchmark-linux-x64` artifact contain the same candidate results.

Comment `/benchmark` again after pushing a new commit or when rerunning the same head. No benchmark is
started automatically for later commits. The command workflow must already exist on the repository's
default branch before comments can trigger it; a pull request that first introduces the workflow
cannot trigger itself.

## Options

| Flag | Description |
| --- | --- |
| `-c, --checkers NAME [NAME ...]` | Checkers to run; choices are `pyright`, `pyright-pip`, `pyrefly`, `ty`, `mypy`, and `zuban` |
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

Checked-in reference runs live in `build/benchmark/baselines/`. Generate a candidate with the same
OS label, run count, warmup count, memory limit, Python version, and package commits as its baseline,
then compare it before submitting a performance-sensitive pull request:

```console
python build/benchmark/typecheck_benchmark.py \
    -c pyright -r 1 -w 0 -t 600 --memory-limit-mb 8192 \
    --os-name linux-x64 --output build/benchmark/results
python build/benchmark/compare_benchmarks.py \
    build/benchmark/baselines/latest-linux-x64.json \
    build/benchmark/results/latest-linux-x64.json
```

The comparator reports per-package timing and memory deltas and exits nonzero when a previously
successful result is missing, the environment contract differs, or a result exceeds the default 20%
regression threshold. Package commits, check paths, and excluded directory names must also match.
Candidate-only package/checker results are reported as not regression-gated and require a regenerated
baseline before they are protected. Runner class, hosted runner image, CPU count, and the exact Python
version are part of the environment contract. The dependency-isolation mode and exact `NODE_OPTIONS`
value are also recorded and must match so results collected with different dependency or Node heap
settings cannot be compared. Use `--threshold-percent` to select another threshold. Results from
different runner classes are historical data, not a reliable regression gate.

The invocation timeout is recorded but is not an environment compatibility field: raising a kill
threshold does not alter a checker invocation that completed below either threshold. A timed-out
candidate cannot replace a successful baseline. If a candidate succeeds where the baseline timed out
or otherwise failed, it is reported as `No baseline` until a new hosted baseline is checked in.
The pull-request workflow also fails if any candidate package cannot be prepared or any checker
times out, crashes, or otherwise fails, even when that package has no successful baseline yet.

On pull requests, the benchmark pins Python 3.14.6, caches pip downloads using `install_envs.json` as
the cache key, runs Pyright with a 6 GiB V8 old-space limit, and allows each invocation up to 30
minutes. A regression must exceed both a 20% relative threshold and an absolute variance guard of 1
second for time or 100 MB for peak memory. These are the comparator defaults, so the gate and trusted
comment renderer share one configuration source. Reports and artifacts are published before a failed
comparison marks the job unsuccessful.

The weekly workflow runs Pyright, Pyrefly, ty, mypy, and Zuban in independent hosted-runner jobs.
Each checker performs three measured runs after one warmup over the same pinned corpus. The aggregate
job stores each raw JSON result with a self-contained `index.html` comparison for 90 days; its Actions
job summary links directly to the downloadable report artifact.

The top-level JSON records the timestamp, platform, checker versions, run settings, aggregate
statistics, per-package results, configured memory limit, and an `upstream_source` object containing
the original repository, exact commit, and source-file URL. Each package result records the cloned
repository commit. Each successful checker result contains the measured wall times and peak-memory
values, plus min, max, mean, median, and standard deviation.
Aggregate data contains package counts and mean, p50, p90, p95, maximum, and total timing or memory
statistics.

On Linux, peak RSS is sampled from `/proc/<pid>/status`. The process group is killed and the result is
reported as OOM if RSS exceeds `--memory-limit-mb`; use `0` to disable the limit. On macOS, peak RSS
is read from `/usr/bin/time -l`. Windows memory measurement remains unavailable, so memory values are
`0` and `memory_measurement` is `unavailable`.

Every invocation captures output so fatal checker messages cannot be mistaken for ordinary type
errors. `--warmup 0` still performs one
uncounted validation pass labeled `Check`; otherwise exactly the requested number of warmups is
reported and discarded.

Dependency installation failures mark the package as unmeasured and skip its checker runs. The PR
report displays these preparation failures, but they do not count as performance regressions. If none
of a package's configured check paths exist, the benchmark warns and checks the full repository.

## Relationship to `perfCompare.py`

`build/perfCompare.py` compares Pyright revisions on the same corpus to detect performance
regressions. This benchmark compares the local Pyright build with other type checkers across the
configured package set.
