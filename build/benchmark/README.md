# Cross-Type-Checker Benchmark

`typecheck_benchmark.py` compares wall-clock speed and peak RSS for Pyright, Pyrefly, ty, mypy, and
Zuban. It is a Pyright-specific adaptation directly from the original MIT-licensed
[`lolpack/type_coverage_py`](https://github.com/lolpack/type_coverage_py) benchmark, pinned to
[`typecheck_benchmark/daily_runner.py` at commit `85667d6f090ce9648d88cd7a9777b492f3b95f1c`](https://github.com/lolpack/type_coverage_py/blob/85667d6f090ce9648d88cd7a9777b492f3b95f1c/typecheck_benchmark/daily_runner.py).
The upstream copyright and MIT license are reproduced in
[`UPSTREAM_LICENSE.txt`](UPSTREAM_LICENSE.txt).
The local integration preserves repository-specific behavior: it builds and invokes the current
checkout's Pyright production bundle rather than resolving Pyright from `PATH`. The benchmark
measures corpus performance, with a separate small behavioral audit rather than a comprehensive
diagnostic-accuracy or type-precision comparison.

The checked corpus is a curated set of source repositories derived from
[`lolpack/type_coverage_py`](https://github.com/lolpack/type_coverage_py/blob/main/included_packages.txt).
Each entry in `install_envs.json` defines its repository, check paths, installation behavior, and
additional dependencies. Repository commits are pinned so pull-request comparisons analyze the same
source revisions.

Entries can define `exclude_directories`, translated into exclusions in each benchmark config.
The benchmark passes configured roots to each checker and preserves native file discovery; it
does not select implementations over stubs or stubs over implementations. Native import resolution
normally prefers stubs where available. NumPy excludes its test directories; pandas includes its test
and `_testing` directories. Generated benchmark configurations explicitly retain
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
python build/benchmark/typecheck_benchmark.py -c pyright pyright-threads -r 3 -w 1
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

The hosted release-history workflow installs each official npm release separately and sets
`PYRIGHT_BENCHMARK_ENTRY_POINT` to its `index.js`. This bypasses the Python package wrapper so Linux
peak RSS measures the Node checker process directly. The override must point to a package containing
both `index.js` and `dist/pyright.js`; normal local and weekly benchmarks leave it unset.

Use `--skip-pyright-build` to reuse an existing production bundle. The script rejects this flag if
`packages/pyright/dist/pyright.js` does not exist.

Select `pyright-threads` alongside `pyright` to compare normal single-threaded analysis with
Pyright's `--threads` mode. The benchmark supplies no explicit thread count, so Pyright selects its
default from the machine's logical CPU count (and falls back to one thread on machines with fewer
than four logical CPUs). It does not collect `--stats` phase timings because Pyright does not allow
`--threads` and `--stats` together.

## Local directories

Use `--local PATH` to benchmark an existing directory without cloning it, installing it, or deleting
it afterward. If Pyright is selected, the local Pyright production bundle is still built first unless
`--skip-pyright-build` is supplied.

Checker configuration files use unique temporary names in the target directory and are removed after
each invocation. Every checker receives an explicit configuration, including Zuban, whose mode is
also explicitly `default`. Existing repository configuration files are not overwritten or extended.
The temporary configuration selects the full local directory.

## Fairness and interpretation

The benchmark is an end-to-end CLI throughput measurement, not an equal-work or quality-adjusted
ranking. A slower result does not by itself prove that a checker does more analysis. Different
inference algorithms, import graphs, bundled stubs, diagnostics, threading, startup, and diagnostic
formatting all contribute to wall time.

All checkers target the running interpreter's Python major/minor version and receive its interpreter
path. ty and Pyrefly ignore `.gitignore` and `.ignore`; Zuban disables gitignore exclusions.
ty also merges user-level configuration even when `--config-file` is supplied, so both ty profiles
run with fresh empty `APPDATA`/`XDG_CONFIG_HOME` config directories, removed after each invocation.
ty's built-in directory exclusions are reset before applying Pyright's standard exclusions, and
Pyrefly's exclusion heuristics are disabled in favor of those same exclusions. This avoids silently
skipping selected `dist`, `venv`, or ignored source files, or checking hidden directories only in ty.
Imported dependencies may still be analyzed differently; matching entry-point scope does not imply
matching transitive work.

Each checker discovers files natively within the configured roots. A missing configured path or
empty root selection is an error; neither falls back to checking the whole repository.
mypy and Zuban receive roots through TOML file lists to avoid command-line size limits and
Windows INI backslash escaping. ty's source selectors use gitignore-pattern separators even on
Windows, where native backslashes can silently match no files.

Before checking, an **untimed repository configuration search** recursively inventories native
`pyrightconfig.json`, `ty.toml`, `pyrefly.toml`, `zuban.toml`, `mypy.ini`, and `.mypy.ini` candidates.
It also searches TOML files for checker-specific `[tool.*]` settings and `project.requires-python`,
and INI settings in `setup.cfg` and mypy configs. JSON records `repository_configs` per package;
console output and the weekly HTML show paths, sections/setting names, and that explicit benchmark
configs are passed instead. Configuration values are not published, and detected does not mean
applied. Invalid TOML/INI files produce visible audit parse errors rather than disappearing from
the inventory. The search skips VCS metadata, `node_modules`, `__pycache__`, and harness-generated
configs. It does not modify or delete repository configs. The real-binary suppression tests below,
not discovery alone, provide evidence that conflicting corpus configs cannot override the harness.

Before any warmups or measured runs, each checker performs one **untimed file-count audit** using
the benchmark configuration and native discovery. Pyright reports checked files in `--stats`,
threaded Pyright reports files to analyze with `--verbose`, Pyrefly reports project modules with
`--summary=full`, ty logs checked file paths with `-vv`, and mypy/Zuban report checked source-file
counts in their summaries. Missing/zero counts and fatal errors reject that checker's measurements.
Verbose/debug audit output is not enabled for measured runs.
Counts in ordinary checker output are also checked during warmups and measured runs.
The audit is recorded separately as `uncounted_validation_runs_per_checker = 1`, including when
`--warmup 0` is selected; this is therefore not a cold-filesystem measurement.

Each successful checker records its native `files_selected`, `file_count_verified`, and separate
`file_count_audit_time_s`. Different audited counts make that package **Not comparable**, including
across separate weekly checker jobs; its timings are excluded from report totals rather than
forcing the tools to discover the same files. Raw JSON retains the measurements and differences.
The regression comparator rejects changed native counts, roots, exclusions, or audit-run settings.
These are source entry-point counts, **not total imported or parsed files**. Equal counts do not
prove identical file identities, equal dependency work, or equal diagnostic coverage.
Repository and user configs are tested
separately with deliberately suppressed diagnostics, and source-level ignore comments retain each
tool's semantics.

The `ty` profile retains ty's default return-type inference. The separately selectable `ty-infer`
profile uses the same binary and configuration except for
`analysis.return-type-inference = "always"`. Pyrefly explicitly uses its `all` preset,
`check-unannotated-defs = true`, and `infer-return-types = "checked"`. Pyright uses `basic` mode with
unannotated-function analysis enabled by default; mypy uses `check_untyped_defs = True`.
Pyrefly's `all` preset enables every error kind and strict callable subtyping; it is not equivalent
to Pyright's `basic` mode. Similar option names or presets do not imply equivalent inference.
Changing diagnostic severity does not necessarily change how much analysis a checker performs.
In particular, ty documents limitations for generator and asynchronous return inference even with `"always"`.

```console
python build/benchmark/typecheck_benchmark.py -c ty ty-infer -r 3 -w 1
```

After corpus timings finish, the harness runs an **untimed behavioral capability suite** with two
batch invocations per installed checker, using the same configurations and interpreter.
Eight paired probes cover an exact-type assertion
control, unannotated return inference, unannotated function body checking, generics, overloads,
protocols, narrowing, and propagation from a local annotated import. The import probe does not
model all third-party package or stub-resolution behavior.

The positive examples must be accepted, including exact `typing.assert_type` checks; unexpected
`Any` or `Unknown` therefore cannot satisfy an `int` assertion. Negative examples must report a
diagnostic at exactly the intended line, with no other diagnostic lines. The assertion control
must pass before any case can match. Both batches require native file counts covering all eight
probe files; crashes, timeouts, missing counts, and unrecognized output are **not evaluated**,
not zero capability or a successful result.

JSON stores the versioned suite identity, per-case diagnostic lines, and raw process evidence in
`capability_suite`. HTML adds a **Behavior matches** column and a per-case matrix. Mismatches can
mean a missed error, lost precision, or additional strictness diagnostics: for example, Pyrefly's
`all` preset also requires return annotations. Do not equate every mismatch with weaker inference.
Comparisons reject changed suite identities or behavioral outcomes rather than accepting a
speedup that silently changed these observed behaviors.
Package-shard merges require identical suite identities and outcomes but permit different raw
process evidence (such as temporary paths); the merged result retains the first shard's evidence.

These are a few examples, not a weighted quality score, a measurement of internal work, or proof
that the timed corpus receives equivalent analysis. Runtime is not divided by matches, rules, or
diagnostic counts. Even passing every probe does not justify a quality-adjusted corpus speed ratio;
that requires a separately controlled workload with verified shared behavioral requirements.
Historical results without this audit have no verified behavior-match count.

For defensible cross-checker comparisons, use the same machine, pinned source commits, dependency
versions, interpreter, target platform, source scope, and resource/thread budgets. The weekly jobs
currently use separate hosted runners and install dependencies without a shared version lock, so
their results are independent trends rather than a controlled speed ranking. Repeated fresh
processes after a warmup measure a warm-filesystem CLI workload, not editor incrementality or a
cold-disk workload. Alternate run order for paired experiments and report the individual samples
and dispersion, not only a speedup.

Do not divide total runtime by enabled rule count or emitted diagnostic count. Rules differ in
granularity and share parsing, import resolution, inference, constraint solving, and caches.
Disabling a diagnostic often suppresses reporting without removing its prerequisite analysis.
For a feature-cost investigation, use focused workloads (for example overload resolution,
protocol matching, generics, narrowing, unannotated returns, and typed versus untyped imports),
verify expected diagnostics and inferred types outside the timed runs, and compare paired
feature-on/feature-off measurements within each checker where supported. Report these as marginal
costs on that workload, not additive or portable "time per rule". Report type-system conformance
and curated false-positive/false-negative cases separately from throughput; the
[Python typing conformance suite](https://github.com/python/typing/tree/main/conformance) is a useful
shared specification, but not a performance weighting scheme.

Linux peak RSS currently polls only `/proc/<parent-pid>/status`; it does not sum child-process memory.
In particular, Pyright `--threads` RSS must not be interpreted as total worker memory or a memory
improvement over single-process Pyright. Windows RSS is unavailable. Neither limitation prevents
wall-time measurements, but neither supports cross-process memory rankings.

Configuration changes are recorded as `checker_config_version` in result JSON. Comparisons reject
different versions, including pre-versioned results, so regenerate baselines rather than comparing
new file-selection or interpreter settings against old measurements.
Pyrefly's exit-code-1 "no files matched" error is a failed measurement, not an ordinary type error.

The opt-in integration tests execute the real binaries against conflicting root/nested configs,
ignored files, directory-exclusion probes, and paired implementations/stubs. They verify every
checker's native count before and after the hostile configs, including clean files and standalone stubs,
and check that `ty-infer` catches an inferred-return
assignment that the default profile does not. Install all default checkers and build Pyright first,
then set `TYPECHECK_BENCHMARK_INTEGRATION=1` and run:

```console
python -m unittest discover -s build/benchmark -p test_typecheck_benchmark.py
```

Configuration references:
[ty configuration](https://docs.astral.sh/ty/configuration/),
[ty inference and source options](https://docs.astral.sh/ty/reference/configuration/),
[Pyrefly configuration selection and presets](https://pyrefly.org/en/docs/configuration/),
and [Zuban modes and configuration](https://docs.zubanls.com/en/latest/usage.html).

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

Pull requests that change `packages/pyright-internal/src/analyzer/` or
`packages/pyright-internal/typeshed-fallback/` automatically run the hosted benchmark only after
`Validation` succeeds, including all test platforms, type checking, style, and
the build. `mypy_primer` also waits for successful Validation and runs on every pull request. For
external contributors, both wait for a maintainer to approve workflows to run before Validation can
start. Subsequent commits require successful Validation for the new head before either check runs.
The trusted triggers run from the base repository and reject outdated PR heads.

Both follow-up checks appear on the PR head as queued while Validation runs, then report their
execution results with links to the workflow runs. If Validation does not pass, both are skipped;
the benchmark is also skipped for PRs without analyzer or bundled typeshed changes. Check reporting does not change
branch protection. Only trusted reporting jobs receive permission to write checks; jobs executing
the candidate code keep read-only repository access.

To run the benchmark again, or to run it for another pull request, a maintainer can comment exactly
`/benchmark` on an open or merged pull request. The command must be the entire comment. The trusted
command workflow checks that the commenter has `write`, `maintain`, or `admin` repository permission
and then explicitly dispatches the benchmark with the pull request's head and candidate commits.
The command also requires successful Validation for the PR head. Closed, unmerged pull requests are
ignored. Users without one of these permissions cannot start the
benchmark.

For an open pull request, the dispatched workflow runs GitHub's current synthetic merge commit. For
a merged pull request, it runs the checked-in merge or squash commit. Both modes compare the
candidate against its exact first parent, so a historical run uses the base revision from merge time
rather than the current `main` head. The workflow uses the base revision's benchmark harness and
package configuration for both binaries, uses read-only repository permissions, and measures the
base and candidate sequentially on the same runner. When the run completes, a separate trusted job
validates the result's head, candidate, and first-parent commits, then renders the exact measured
comparison using default-branch code. It creates or updates one benchmark comment. The trusted job runs on a separate runner with
pull-request write permission. The Actions job summary and benchmark artifact contain both results.

Each PR benchmark shard retries pnpm setup once if the initial bootstrap fails, allowing recovery
from transient download failures. The setup action cleans its installation directory before each
attempt. A second failure still fails the shard; missing package results remain an error.

Shards must use matching benchmark settings and runner profiles. The descriptive `platform_details`
field may differ when hosted runners use different kernel versions; merged results retain all distinct
descriptions in sorted order. Platform, architecture, runner class and image, CPU count, and Python
version must still match.

The benchmark measures the exact first-parent and candidate commits on the same hosted runner. The
trusted job appends both measurements to the checked-in Pyright release history and uploads an HTML
report, execution-time and peak-memory SVG charts, and combined JSON as a 90-day artifact linked from
the benchmark comment. The published release history remains unchanged.

After successful Validation, comment `/benchmark` to rerun the same head or request a benchmark for
another pull request. The trigger workflows must already exist on the repository's default branch; a pull request
that first introduces them cannot trigger itself.

## Options

| Flag | Description |
| --- | --- |
| `-c, --checkers NAME [NAME ...]` | Checkers to run; choices are `pyright`, `pyright-threads`, `pyright-pip`, `pyrefly`, `ty`, `ty-infer`, `mypy`, and `zuban` |
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
For Pyright, result JSON and Markdown reports also include the `--stats` file counts and phase timings
for source discovery, reads, tokenization, parsing, import resolution, binding, checking, and cycle
detection. This does not enable verbose or per-file logging.
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

On pull requests, the benchmark pins Python 3.14.6 and never writes dependency caches because it
executes untrusted pull-request code. It can restore a benchmark-only pnpm store created by the
trusted weekly workflow; the lockfile hash isolates incompatible stores, and
`actions/cache/restore` prevents the PR workflow from saving cache content. The benchmark runs
Pyright with a 6.5 GiB V8 old-space limit and compares the median of three measured runs after one
discarded warmup. Each package runs as an independent matrix job, with its base and candidate
measurements paired sequentially on the same hosted runner. Wall-clock duration is therefore bounded
primarily by the slowest package rather than the sum of the full corpus. Each invocation may take up
to 30 minutes. A regression must exceed both a 20% relative threshold and an absolute variance guard
of 1 second for time or 100 MB for peak memory. These are the comparator defaults, so the gate and
trusted comment renderer share one configuration source. The comparison-history artifact retains the
single-run release series and labels the paired base and PR points with their separate multi-run
median methodology. Retained PR history artifacts are published under
`typecheck-benchmark/pr/<number>/<run-id>/<run-attempt>/`, so each benchmark comment retains
immutable chart URLs even when jobs are rerun. The benchmark comment embeds the execution-time and
peak-memory charts. Reports and artifacts are published before a failed comparison marks the job
unsuccessful.

The weekly workflow runs Pyright, Pyrefly, ty, mypy, and Zuban in independent hosted-runner jobs.
The ty job runs `ty` and `ty-infer` sequentially against the same prepared corpus, with separate
labels and results; it does not replace ty's default behavior with a stricter configuration.
The Pyright job measures single-threaded mode and `--threads` mode sequentially on the same runner and
prepared package corpus. Each mode performs three measured runs after one warmup. The report includes
a per-package Pyright threading chart with wall time, peak RSS, and speedup. The aggregate job stores
each raw JSON result with a self-contained `index.html` comparison for 90 days; its Actions job
summary links directly to the downloadable report artifact.

The release-history workflow benchmarks every stable Pyright release published in the prior year
against the same pinned corpus. It runs one measured pass per package, renders normalized per-package
execution-time and peak-memory SVG charts, and publishes them under
`typecheck-benchmark/history/`. Each new GitHub release rebuilds the rolling one-year history.

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
