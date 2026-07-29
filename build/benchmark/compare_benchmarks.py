#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, TypedDict


class ComparisonRow(TypedDict):
    package: str
    checker: str
    execution_time_s: float | None
    time_delta: float | None
    peak_memory_mb: float | None
    memory_delta: float | None
    status: str


def _load_results(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"Unable to load {path}: {exc}") from exc


def _metrics_by_package(data: dict[str, Any]) -> dict[tuple[str, str], dict[str, Any]]:
    metrics: dict[tuple[str, str], dict[str, Any]] = {}
    for package in data.get("results", []):
        package_name = package.get("package_name")
        if not package_name:
            continue
        for checker, checker_metrics in package.get("metrics", {}).items():
            metrics[(package_name, checker)] = checker_metrics
    return metrics


def _packages_by_name(data: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        package["package_name"]: package
        for package in data.get("results", [])
        if package.get("package_name")
    }


def _percent_change(baseline: float, candidate: float) -> float:
    return ((candidate - baseline) / baseline) * 100 if baseline else 0.0


def _analyze(
    baseline: dict[str, Any], candidate: dict[str, Any], threshold_percent: float
) -> tuple[list[str], list[ComparisonRow]]:
    failures: list[str] = []
    rows: list[ComparisonRow] = []
    for field in (
        "platform",
        "architecture",
        "python_version",
        "memory_limit_mb",
        "runs_per_package",
        "warmup_runs",
        "timeout_s",
    ):
        if baseline.get(field) != candidate.get(field):
            failures.append(
                f"environment mismatch for {field}: "
                f"{baseline.get(field)!r} != {candidate.get(field)!r}"
            )
    baseline_metrics = _metrics_by_package(baseline)
    candidate_metrics = _metrics_by_package(candidate)
    baseline_packages = _packages_by_name(baseline)
    candidate_packages = _packages_by_name(candidate)

    for key, old in sorted(baseline_metrics.items()):
        package, checker = key
        new = candidate_metrics.get(key)
        if not old.get("ok"):
            rows.append(
                {
                    "package": package,
                    "checker": checker,
                    "execution_time_s": None,
                    "time_delta": None,
                    "peak_memory_mb": None,
                    "memory_delta": None,
                    "status": "Baseline unavailable",
                }
            )
            continue
        old_package = baseline_packages[package]
        new_package = candidate_packages.get(package)
        if not new_package:
            failures.append(f"{package}/{checker}: candidate result is missing")
            rows.append(
                {
                    "package": package,
                    "checker": checker,
                    "execution_time_s": None,
                    "time_delta": None,
                    "peak_memory_mb": None,
                    "memory_delta": None,
                    "status": "Missing",
                }
            )
            continue
        if old_package.get("commit") != new_package.get("commit"):
            failures.append(
                f"{package}/{checker}: package commit changed from "
                f"{old_package.get('commit')} to {new_package.get('commit')}"
            )
            rows.append(
                {
                    "package": package,
                    "checker": checker,
                    "execution_time_s": None,
                    "time_delta": None,
                    "peak_memory_mb": None,
                    "memory_delta": None,
                    "status": "Commit changed",
                }
            )
            continue
        scope_changed = False
        for field in ("check_paths", "exclude_directories"):
            if old_package.get(field, []) != new_package.get(field, []):
                failures.append(
                    f"{package}/{checker}: package {field} changed from "
                    f"{old_package.get(field, [])} to {new_package.get(field, [])}"
                )
                rows.append(
                    {
                        "package": package,
                        "checker": checker,
                        "execution_time_s": None,
                        "time_delta": None,
                        "peak_memory_mb": None,
                        "memory_delta": None,
                        "status": "Scope changed",
                    }
                )
                scope_changed = True
                break
        if scope_changed:
            continue
        if not new or not new.get("ok"):
            failures.append(f"{package}/{checker}: candidate result failed or is missing")
            rows.append(
                {
                    "package": package,
                    "checker": checker,
                    "execution_time_s": None,
                    "time_delta": None,
                    "peak_memory_mb": None,
                    "memory_delta": None,
                    "status": "Failed",
                }
            )
            continue

        old_time = float(old["execution_time_s"])
        new_time = float(new["execution_time_s"])
        old_memory = float(old.get("peak_memory_mb", 0.0))
        new_memory = float(new.get("peak_memory_mb", 0.0))
        time_delta = _percent_change(old_time, new_time)
        memory_delta = _percent_change(old_memory, new_memory)
        status = "Pass"
        if time_delta > threshold_percent:
            failures.append(
                f"{package}/{checker}: time regressed {time_delta:.1f}% "
                f"(limit {threshold_percent:.1f}%)"
            )
            status = "Regression"
        if old_memory > 0 and memory_delta > threshold_percent:
            failures.append(
                f"{package}/{checker}: memory regressed {memory_delta:.1f}% "
                f"(limit {threshold_percent:.1f}%)"
            )
            status = "Regression"
        rows.append(
            {
                "package": package,
                "checker": checker,
                "execution_time_s": new_time,
                "time_delta": time_delta,
                "peak_memory_mb": new_memory,
                "memory_delta": memory_delta,
                "status": status,
            }
        )
    return failures, rows


def compare(
    baseline: dict[str, Any], candidate: dict[str, Any], threshold_percent: float
) -> list[str]:
    failures, rows = _analyze(baseline, candidate, threshold_percent)
    print(
        f"{'Package':<20} {'Checker':<10} {'Time':>10} {'Delta':>9} "
        f"{'Memory':>10} {'Delta':>9}"
    )
    print("-" * 72)
    for row in rows:
        if row["execution_time_s"] is None:
            continue
        print(
            f"{row['package']:<20} {row['checker']:<10} "
            f"{row['execution_time_s']:>9.3f}s {row['time_delta']:>+8.1f}% "
            f"{row['peak_memory_mb']:>9.1f}M {row['memory_delta']:>+8.1f}%"
        )
    return failures


def render_markdown(
    baseline: dict[str, Any], candidate: dict[str, Any], threshold_percent: float
) -> str:
    failures, rows = _analyze(baseline, candidate, threshold_percent)
    if failures:
        summary = f"**{len(failures)} regression check(s) failed.**"
    else:
        summary = "**No performance regressions detected.**"
    lines = [
        "## Type checker benchmark",
        "",
        summary,
        "",
        f"Regression threshold: `{threshold_percent:.1f}%`",
        "",
        "| Package | Checker | Time | Time delta | Peak memory | Memory delta | Status |",
        "| --- | --- | ---: | ---: | ---: | ---: | --- |",
    ]
    for row in rows:
        execution_time = (
            f"{row['execution_time_s']:.3f}s"
            if row["execution_time_s"] is not None
            else "N/A"
        )
        time_delta = (
            f"{row['time_delta']:+.1f}%" if row["time_delta"] is not None else "N/A"
        )
        peak_memory = (
            f"{row['peak_memory_mb']:.1f} MB"
            if row["peak_memory_mb"] is not None
            else "N/A"
        )
        memory_delta = (
            f"{row['memory_delta']:+.1f}%"
            if row["memory_delta"] is not None
            else "N/A"
        )
        lines.append(
            f"| {row['package']} | {row['checker']} | {execution_time} | "
            f"{time_delta} | {peak_memory} | {memory_delta} | {row['status']} |"
        )
    if failures:
        lines.extend(["", "### Failures", ""])
        lines.extend(f"- {failure}" for failure in failures)
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Compare two benchmark result files")
    parser.add_argument("baseline", type=Path)
    parser.add_argument("candidate", type=Path)
    parser.add_argument("--threshold-percent", type=float, default=10.0)
    parser.add_argument("--markdown-output", type=Path)
    args = parser.parse_args(argv)

    try:
        baseline = _load_results(args.baseline)
        candidate = _load_results(args.candidate)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    failures = compare(baseline, candidate, args.threshold_percent)
    if args.markdown_output:
        args.markdown_output.write_text(
            render_markdown(baseline, candidate, args.threshold_percent),
            encoding="utf-8",
        )
    if failures:
        print("\nRegressions:")
        for failure in failures:
            print(f"  {failure}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())