#! /usr/bin/env python3

# perfCompare.py
# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.
#
# Benchmarks pyright's type-checking performance across two or more git
# commits/branches by building the production CLI bundle at each commit and
# timing repeated runs over a fixed corpus. See the module docstring for usage
# and the measurement methodology.

"""Compare pyright type-checking performance across two or more commits/branches.

Adapted from mypy's misc/perf_compare.py for pyright. Where mypy self-checks its
own (mypyc-compiled) source, pyright is a bundled JS CLI, so this script:

 * For each target commit: checks it out *in place*, builds the production CLI
   bundle (``packages/pyright/dist``), and stashes that dist dir under
   ``build/perfCompare/binaries/<sha>/`` so later runs can skip the rebuild.
 * Restores your original branch/commit when the build phase is done.
 * Runs each commit's bundle N times over a fixed corpus, in randomized
   interleaved order, parsing pyright's own ``Completed in X.XXXsec`` line as the
   per-run metric (in-process analysis time -- excludes node startup jitter).
 * Reports per-commit mean/median plus robust paired deltas vs the baseline.

Usage:

    python build/perfCompare.py --corpus <path-to-python-project> main HEAD

Requirements / caveats:

 * Run from the pyright repo root with a CLEAN working tree (it checks out
   commits in place, reusing the already-installed node_modules -- worktrees
   would lack them).
 * The corpus path is whatever you want type-checked; it stays fixed across all
   commits so only the checker changes. Errors in the corpus are ignored.
 * Builds are keyed by the resolved commit SHA, so passing a moving ref like
   HEAD/branch name caches under its current SHA (fine within one run).
"""

import argparse
import os
import random
import re
import resource
import shutil
import statistics
import subprocess
import sys
import time

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)
PYRIGHT_PKG = os.path.join(REPO_ROOT, "packages", "pyright")
DIST_DIR = os.path.join(PYRIGHT_PKG, "dist")
# Cached production bundles, keyed by commit SHA, kept beside this script (gitignored).
BUILD_CACHE = os.path.join(SCRIPT_DIR, "perfCompare", "binaries")

COMPLETED_RE = re.compile(r"Completed in ([\d.]+)sec")
CHECK_RE = re.compile(r"Check:\s+([\d.]+)sec")


def heading(s: str) -> None:
    print()
    print(f"=== {s} ===")
    print()


def git(*args: str, capture: bool = False) -> str:
    res = subprocess.run(
        ["git", *args], cwd=REPO_ROOT, check=True, text=True,
        stdout=subprocess.PIPE if capture else None,
    )
    return (res.stdout or "").strip()


def resolve_sha(commit: str) -> str:
    return git("rev-parse", commit, capture=True)


def current_ref() -> str:
    """The symbolic branch name if on one, else the detached SHA -- for restore."""
    branch = git("rev-parse", "--abbrev-ref", "HEAD", capture=True)
    return branch if branch != "HEAD" else resolve_sha("HEAD")


def working_tree_clean() -> bool:
    return git("status", "--porcelain", capture=True) == ""


def build_commit(commit: str, sha: str) -> str:
    """Check out `commit`, build the prod bundle, cache dist under the SHA. Returns cache dir."""
    cache_dir = os.path.join(BUILD_CACHE, sha)
    if os.path.isdir(cache_dir) and os.path.isfile(os.path.join(cache_dir, "pyright.js")):
        print(f"build cache hit for {commit} ({sha[:10]}): {cache_dir}")
        return cache_dir

    heading(f"Building {commit} ({sha[:10]})")
    git("checkout", "-q", sha)
    subprocess.run(["npm", "run", "build"], cwd=PYRIGHT_PKG, check=True)

    if os.path.isdir(cache_dir):
        shutil.rmtree(cache_dir)
    os.makedirs(BUILD_CACHE, exist_ok=True)
    shutil.copytree(DIST_DIR, cache_dir, symlinks=True)
    print(f"cached build -> {cache_dir}")
    return cache_dir


def run_once(bundle_dir: str, corpus: str) -> tuple[float, float | None, float]:
    """Run pyright on corpus once; return (wall_completed_sec, check_sec | None, cpu_sec).

    `wall` is pyright's own ``Completed in`` (in-process analysis wall time). `cpu` is the
    user+sys CPU time of the node child, via the RUSAGE_CHILDREN delta around the run --
    much less sensitive to scheduling/background noise. This is accurate because pyright runs
    single-process by default (no ``--threads``), so there are no un-reaped worker processes
    whose CPU would escape node's accounting.
    """
    cmd = ["node", os.path.join(bundle_dir, "pyright.js"), "--stats", os.path.abspath(corpus)]
    r0 = resource.getrusage(resource.RUSAGE_CHILDREN)
    # Ignore exit code: corpora routinely produce type errors.
    res = subprocess.run(cmd, cwd=REPO_ROOT, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    r1 = resource.getrusage(resource.RUSAGE_CHILDREN)
    cpu = (r1.ru_utime - r0.ru_utime) + (r1.ru_stime - r0.ru_stime)
    m = COMPLETED_RE.search(res.stdout)
    if not m:
        sys.stderr.write(res.stdout[-2000:] + "\n")
        raise RuntimeError("Could not parse 'Completed in ...sec' from pyright output")
    c = CHECK_RE.search(res.stdout)
    return float(m.group(1)), (float(c.group(1)) if c else None), cpu


def winsorized_paired_stats(diffs: list[float], *, trim_frac: float = 0.1, conf: float = 0.95) -> dict[str, float]:
    """Robust paired-difference summary (trimmed mean + Tukey-McLaughlin SE). See mypy's perf_compare."""
    n = len(diffs)
    s = sorted(diffs)
    g = int(n * trim_frac)
    median = statistics.median(s)
    if n < 2 or n - 2 * g < 2:
        return {"est": statistics.mean(s), "median": median, "ci": 0.0, "kept": float(n)}
    kept = s[g: n - g]
    est = statistics.mean(kept)
    wins = [kept[0]] * g + kept + [kept[-1]] * g
    wvar = statistics.variance(wins)
    se = (wvar ** 0.5) / ((1 - 2 * trim_frac) * (n ** 0.5))
    z = statistics.NormalDist().inv_cdf(0.5 + conf / 2)
    return {"est": est, "median": median, "ci": z * se, "kept": float(len(kept))}


def main() -> None:
    t0 = time.time()
    p = argparse.ArgumentParser(
        formatter_class=argparse.RawDescriptionHelpFormatter, description=__doc__
    )
    src = p.add_mutually_exclusive_group(required=True)
    src.add_argument("--corpus", help="path to a Python project *directory* to type-check (fixed across commits)")
    src.add_argument("--corpus-file", help="path to a single Python *file* to type-check (e.g. one hot file). "
                                           "Lower per-run cost and variance than a whole project.")
    p.add_argument("--num-runs", type=int, default=10, help="measured runs per commit (default 10)")
    p.add_argument("--warmup-runs", type=int, default=2, help="leading warmup runs to discard (default 2)")
    p.add_argument("--metric", choices=["wall", "cpu"], default="wall",
                   help="quantity to compare: 'wall' (pyright's reported analysis time, default) or "
                        "'cpu' (user+sys CPU of the node child). 'cpu' is far less sensitive to background "
                        "interference/scheduling, tightening the distribution -- recommended for high run counts.")
    p.add_argument("--workers1", action="store_true",
                   help="parity flag with mypy's perf_compare: assert single-process analysis. Pyright already "
                        "runs single-process by default (multi-process needs --threads, which this script never "
                        "passes), so this is the default; the flag is accepted to document intent.")
    p.add_argument("--no-build", action="store_true", help="skip building; reuse cached dist bundles under build/perfCompare/binaries/")
    p.add_argument("commit", nargs="+", help="git revisions to compare; the first is the baseline (e.g. main HEAD)")
    args = p.parse_args()

    if not os.path.isdir(os.path.join(REPO_ROOT, ".git")):
        sys.exit("error: run from the pyright repo root")
    corpus = args.corpus if args.corpus is not None else args.corpus_file
    if args.corpus is not None and not os.path.isdir(args.corpus):
        sys.exit(f"error: --corpus directory not found: {args.corpus}")
    if args.corpus_file is not None and not os.path.isfile(args.corpus_file):
        sys.exit(f"error: --corpus-file not found: {args.corpus_file}")

    commits: list[str] = args.commit
    shas = {c: resolve_sha(c) for c in commits}

    bundles: dict[str, str] = {}
    if args.no_build:
        for c in commits:
            cache_dir = os.path.join(BUILD_CACHE, shas[c])
            if not os.path.isfile(os.path.join(cache_dir, "pyright.js")):
                sys.exit(f"error: --no-build but no cached bundle for {c} ({shas[c][:10]})")
            bundles[c] = cache_dir
    else:
        if not working_tree_clean():
            sys.exit("error: working tree not clean -- commit/stash first (this script checks out commits in place)")
        original = current_ref()
        print(f"original ref: {original} (will restore after building)")
        try:
            for c in commits:
                bundles[c] = build_commit(c, shas[c])
        finally:
            heading(f"Restoring {original}")
            git("checkout", "-q", original)

    num_runs = args.num_runs + args.warmup_runs
    metric_label = "CPU time (user+sys)" if args.metric == "cpu" else "pyright-reported wall time"
    heading(f"Measuring (corpus: {corpus}, {args.num_runs} runs + {args.warmup_runs} warmup, "
            f"metric: {args.metric}, single-process)")
    # `results` holds the chosen comparison metric; the other values are still printed per run.
    results: dict[str, list[float]] = {c: [] for c in commits}
    for n in range(num_runs):
        warm = n < args.warmup_runs
        print(f"{'Warmup' if warm else 'Run'} {n + 1 - (0 if warm else args.warmup_runs)}/"
              f"{args.warmup_runs if warm else args.num_runs}...")
        order = commits[:]
        random.shuffle(order)
        for c in order:
            wall, check, cpu = run_once(bundles[c], corpus)
            metric_val = cpu if args.metric == "cpu" else wall
            if not warm:
                results[c].append(metric_val)
                check_str = f" check={check:.2f}s" if check is not None else ""
                print(f"  {c}: cpu={cpu:.3f}s wall={wall:.3f}s{check_str}")

    baseline = commits[0]
    heading(f"Results ({metric_label})")
    first_mean = first_median = -1.0
    for c in commits:
        mean = statistics.mean(results[c])
        median = statistics.median(results[c])
        sd = statistics.pstdev(results[c]) if len(results[c]) > 1 else 0.0
        if first_mean < 0:
            first_mean, first_median = mean, median
            dm = dmed = "0.0%"
        else:
            dm = f"{mean / first_mean - 1:+.1%}"
            dmed = f"{median / first_median - 1:+.1%}"
        print(f"{c:<22} mean {mean:.3f}s ({dm}) | stdev {sd:.3f}s | median {median:.3f}s ({dmed})")

    base_runs = results[baseline]
    base_center = statistics.median(base_runs)
    heading(f"Paired deltas vs {baseline} (per-round diffs; median +/- 95% CI)")
    for c in commits:
        if c == baseline:
            print(f"{c:<22} baseline")
            continue
        diffs = [a - b for a, b in zip(results[c], base_runs)]
        st = winsorized_paired_stats(diffs)
        pct = (st["median"] / base_center * 100) if base_center else 0.0
        print(f"{c:<22} median {st['median'] * 1000:+7.1f}ms  +/-{st['ci'] * 1000:4.1f}  ({pct:+.2f}%)")

    t = int(time.time() - t0)
    print(f"\nTotal wall time: {t // 60}m {t % 60}s")


if __name__ == "__main__":
    main()
