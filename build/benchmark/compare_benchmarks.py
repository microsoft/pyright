#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any, TypedDict

DEFAULT_THRESHOLD_PERCENT = 20.0
DEFAULT_TIME_NOISE_FLOOR_SECONDS = 1.0
DEFAULT_MEMORY_NOISE_FLOOR_MB = 100.0


class ComparisonRow(TypedDict, total=False):
    package: str
    checker: str
    execution_time_s: float | None
    time_delta: float | None
    peak_memory_mb: float | None
    memory_delta: float | None
    files_checked: int | None
    status: str


def _load_results(path: Path) -> dict[str, Any]:
    def reject_constant(value: str) -> None:
        raise ValueError(f"non-finite number {value}")

    try:
        data = json.loads(
            path.read_text(encoding="utf-8"), parse_constant=reject_constant
        )
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        raise ValueError(f"Unable to load {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return data


def _is_finite_number(value: object) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(float(value))
    )


def _validate_results(data: dict[str, Any], label: str) -> list[str]:
    failures: list[str] = []
    results = data.get("results")
    if not isinstance(results, list):
        return [f"{label}: results must be a list"]
    for package_index, package in enumerate(results):
        package_label = f"{label}: results[{package_index}]"
        if not isinstance(package, dict):
            failures.append(f"{package_label} must be an object")
            continue
        package_name = package.get("package_name")
        if not isinstance(package_name, str) or not package_name:
            failures.append(f"{package_label}.package_name must be a non-empty string")
        metrics = package.get("metrics", {})
        if not isinstance(metrics, dict):
            failures.append(f"{package_label}.metrics must be an object")
            continue
        for checker, checker_metrics in metrics.items():
            metric_label = f"{package_label}.metrics[{checker!r}]"
            if not isinstance(checker, str) or not checker:
                failures.append(f"{package_label}.metrics keys must be non-empty strings")
                continue
            if not isinstance(checker_metrics, dict):
                failures.append(f"{metric_label} must be an object")
                continue
            if not isinstance(checker_metrics.get("ok"), bool):
                failures.append(f"{metric_label}.ok must be a boolean")
                continue
            if checker_metrics["ok"]:
                for field in ("execution_time_s", "peak_memory_mb"):
                    if not _is_finite_number(checker_metrics.get(field)):
                        failures.append(f"{metric_label}.{field} must be a finite number")
    return failures


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


def _escape_markdown(value: object) -> str:
    text = str(value).replace("\\", "\\\\").replace("\r", " ").replace("\n", " ")
    for character in "`*_{}[]<>()#+-.!|":
        text = text.replace(character, f"\\{character}")
    return text


def _analyze(
    baseline: dict[str, Any],
    candidate: dict[str, Any],
    threshold_percent: float,
    time_noise_floor_s: float = 0.0,
    memory_noise_floor_mb: float = 0.0,
    fail_on_preparation_error: bool = False,
) -> tuple[list[str], list[ComparisonRow]]:
    failures = [
        *_validate_results(baseline, "baseline"),
        *_validate_results(candidate, "candidate"),
    ]
    rows: list[ComparisonRow] = []
    if failures:
        return failures, rows
    for field in (
        "platform",
        "architecture",
        "runner_class",
        "runner_image",
        "cpu_count",
        "python_version",
        "memory_limit_mb",
        "node_options",
        "runs_per_package",
        "warmup_runs",
        "uncounted_validation_runs_per_checker",
        "dependency_isolation",
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
            if new and new.get("ok"):
                rows.append(
                    {
                        "package": package,
                        "checker": checker,
                        "execution_time_s": float(new["execution_time_s"]),
                        "time_delta": None,
                        "peak_memory_mb": float(new["peak_memory_mb"]),
                        "memory_delta": None,
                        "files_checked": new.get("files_checked"),
                        "status": "No baseline",
                    }
                )
                continue
            if fail_on_preparation_error:
                failures.append(
                    f"{package}/{checker}: candidate result failed or is missing"
                )
                status = "Failed"
            else:
                status = "Baseline unavailable"
            rows.append(
                {
                    "package": package,
                    "checker": checker,
                    "execution_time_s": None,
                    "time_delta": None,
                    "peak_memory_mb": None,
                    "memory_delta": None,
                    "status": status,
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
        if new_package.get("error"):
            if fail_on_preparation_error:
                failures.append(
                    f"{package}/{checker}: candidate package preparation failed"
                )
            rows.append(
                {
                    "package": package,
                    "checker": checker,
                    "execution_time_s": None,
                    "time_delta": None,
                    "peak_memory_mb": None,
                    "memory_delta": None,
                    "status": "Preparation failed",
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
        if (
            time_delta > threshold_percent
            and new_time - old_time > time_noise_floor_s
        ):
            failures.append(
                f"{package}/{checker}: time regressed {time_delta:.1f}% "
                f"(limit {threshold_percent:.1f}%)"
            )
            status = "Regression"
        if (
            old_memory > 0
            and memory_delta > threshold_percent
            and new_memory - old_memory > memory_noise_floor_mb
        ):
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
                "files_checked": new.get("files_checked"),
                "status": status,
            }
        )
    for key, new in sorted(candidate_metrics.items()):
        if key in baseline_metrics:
            continue
        package, checker = key
        rows.append(
            {
                "package": package,
                "checker": checker,
                "execution_time_s": (
                    float(new["execution_time_s"]) if new.get("ok") else None
                ),
                "time_delta": None,
                "peak_memory_mb": (
                    float(new["peak_memory_mb"]) if new.get("ok") else None
                ),
                "memory_delta": None,
                "files_checked": new.get("files_checked"),
                "status": "No baseline",
            }
        )
    return failures, rows


def compare(
    baseline: dict[str, Any],
    candidate: dict[str, Any],
    threshold_percent: float,
    time_noise_floor_s: float = 0.0,
    memory_noise_floor_mb: float = 0.0,
    fail_on_preparation_error: bool = False,
) -> list[str]:
    failures, rows = _analyze(
        baseline,
        candidate,
        threshold_percent,
        time_noise_floor_s,
        memory_noise_floor_mb,
        fail_on_preparation_error,
    )
    print(
        f"{'Package':<20} {'Checker':<10} {'Time':>10} {'Delta':>9} "
        f"{'Memory':>10} {'Delta':>9} {'Files':>8}"
    )
    print("-" * 81)
    for row in rows:
        if row["execution_time_s"] is None:
            continue
        time_delta = (
            f"{row['time_delta']:+8.1f}%" if row["time_delta"] is not None else f"{'N/A':>9}"
        )
        memory_delta = (
            f"{row['memory_delta']:+8.1f}%" if row["memory_delta"] is not None else f"{'N/A':>9}"
        )
        print(
            f"{row['package']:<20} {row['checker']:<10} "
            f"{row['execution_time_s']:>9.3f}s {time_delta} "
            f"{row['peak_memory_mb']:>9.1f}M {memory_delta} "
            f"{row.get('files_checked') if row.get('files_checked') is not None else 'N/A':>8}"
        )
    return failures


def render_markdown(
    baseline: dict[str, Any],
    candidate: dict[str, Any],
    threshold_percent: float,
    time_noise_floor_s: float = 0.0,
    memory_noise_floor_mb: float = 0.0,
    fail_on_preparation_error: bool = False,
) -> str:
    failures, rows = _analyze(
        baseline,
        candidate,
        threshold_percent,
        time_noise_floor_s,
        memory_noise_floor_mb,
        fail_on_preparation_error,
    )
    if failures:
        summary = f"🔴 **{len(failures)} regression check(s) failed.**"
    else:
        summary = "🟢 **No performance regressions detected.**"
    preparation_failures = sum(
        row["status"] == "Preparation failed" for row in rows
    )
    if preparation_failures:
        summary += (
            f"\n\n🟡 **{preparation_failures} package(s) could not be prepared "
            "and were not measured.**"
        )
    missing_baselines = sum(row["status"] == "No baseline" for row in rows)
    if missing_baselines:
        summary += (
            f"\n\n🟡 **{missing_baselines} candidate result(s) have no baseline "
            "and were not regression-gated.**"
        )
    lines = [
        "## Type checker benchmark",
        "",
        summary,
        "",
        f"Regression threshold: `{threshold_percent:.1f}%`",
    ]
    if time_noise_floor_s > 0 or memory_noise_floor_mb > 0:
        lines.append(
            f"Variance guard: `>{time_noise_floor_s:.1f}s` time and "
            f"`>{memory_noise_floor_mb:.1f} MB` memory"
        )
    lines.extend(
        [
            "",
            "| Package | Checker | Files checked | Time | Time delta | Peak memory | Memory delta | Status |",
            "| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |",
        ]
    )
    status_indicators = {
        "Pass": "🟢 Pass",
        "Regression": "🔴 Regression",
        "Failed": "🔴 Failed",
        "Missing": "🔴 Missing",
        "Commit changed": "🔴 Commit changed",
        "Scope changed": "🔴 Scope changed",
        "Preparation failed": "🟡 Preparation failed",
        "Baseline unavailable": "⚪ Baseline unavailable",
        "No baseline": "🟡 No baseline",
    }
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
        files_checked = row.get("files_checked")
        files_checked_text = str(files_checked) if files_checked is not None else "N/A"
        lines.append(
            f"| {_escape_markdown(row['package'])} | "
            f"{_escape_markdown(row['checker'])} | {files_checked_text} | {execution_time} | "
            f"{time_delta} | {peak_memory} | {memory_delta} | "
            f"{status_indicators[row['status']]} |"
        )
    pyright_stats = []
    for package in candidate.get("results", []):
        if not isinstance(package, dict):
            continue
        checker_metrics = package.get("metrics", {})
        if not isinstance(checker_metrics, dict):
            continue
        metrics = checker_metrics.get("pyright", {})
        if not isinstance(metrics, dict):
            continue
        phase_times = metrics.get("phase_times_s")
        if metrics.get("ok") and isinstance(phase_times, dict):
            pyright_stats.append((package.get("package_name", ""), metrics, phase_times))
    if pyright_stats:
        lines.extend(
            [
                "",
                "### Pyright stats",
                "",
                "| Package | Parsed/bound | Checked | Find | Read | Tokenize | Parse | Imports | Bind | Check | Cycles |",
                "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
            ]
        )
        for package, metrics, phase_times in pyright_stats:
            def phase(name: str) -> str:
                value = phase_times.get(name)
                return f"{float(value):.3f}s" if _is_finite_number(value) else "N/A"

            lines.append(
                f"| {_escape_markdown(package)} | {metrics.get('files_parsed', 'N/A')} | "
                f"{metrics.get('files_checked', 'N/A')} | {phase('find_source_files')} | "
                f"{phase('read_source_files')} | {phase('tokenize')} | {phase('parse')} | "
                f"{phase('resolve_imports')} | {phase('bind')} | {phase('check')} | "
                f"{phase('detect_cycles')} |"
            )
    if failures:
        lines.extend(["", "### Failures", ""])
        lines.extend(f"- {_escape_markdown(failure)}" for failure in failures)
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Compare two benchmark result files")
    parser.add_argument("baseline", type=Path)
    parser.add_argument("candidate", type=Path)
    parser.add_argument(
        "--threshold-percent", type=float, default=DEFAULT_THRESHOLD_PERCENT
    )
    parser.add_argument(
        "--time-noise-floor-seconds",
        type=float,
        default=DEFAULT_TIME_NOISE_FLOOR_SECONDS,
    )
    parser.add_argument(
        "--memory-noise-floor-mb",
        type=float,
        default=DEFAULT_MEMORY_NOISE_FLOOR_MB,
    )
    parser.add_argument("--fail-on-preparation-error", action="store_true")
    parser.add_argument("--markdown-output", type=Path)
    args = parser.parse_args(argv)

    try:
        baseline = _load_results(args.baseline)
        candidate = _load_results(args.candidate)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    failures = compare(
        baseline,
        candidate,
        args.threshold_percent,
        args.time_noise_floor_seconds,
        args.memory_noise_floor_mb,
        args.fail_on_preparation_error,
    )
    if args.markdown_output:
        args.markdown_output.write_text(
            render_markdown(
                baseline,
                candidate,
                args.threshold_percent,
                args.time_noise_floor_seconds,
                args.memory_noise_floor_mb,
                args.fail_on_preparation_error,
            ),
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