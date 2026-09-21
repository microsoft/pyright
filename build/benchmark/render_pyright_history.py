#!/usr/bin/env python3

from __future__ import annotations

import argparse
import html
import json
import math
import re
from pathlib import Path
from typing import Any, Literal


CHECKERS = ("pyright", "pyright-pip")
PALETTE = (
    "#1864ab",
    "#087f5b",
    "#c92a2a",
    "#e67700",
    "#7048e8",
    "#0b7285",
    "#a61e4d",
    "#5c940d",
    "#495057",
)
PROFILE_FIELDS = (
    "python_version",
    "runner_class",
    "runner_image",
    "memory_limit_mb",
    "node_options",
    "dependency_isolation",
    "runs_per_package",
    "warmup_runs",
)
COMPARISON_PROFILE_FIELDS = tuple(
    field for field in PROFILE_FIELDS if field not in {"runs_per_package", "warmup_runs"}
)
Statistic = Literal["mean", "median"]


def _version_key(version: str) -> tuple[int, ...]:
    if not re.fullmatch(r"\d+(?:\.\d+)+", version):
        raise ValueError(f"Unsupported Pyright release version: {version}")
    return tuple(int(part) for part in version.split("."))


def _checker(data: dict[str, Any], path: Path) -> str:
    checkers = data.get("type_checkers", [])
    if len(checkers) != 1 or checkers[0] not in CHECKERS:
        raise ValueError(f"{path} must contain exactly one Pyright checker")
    return str(checkers[0])


def _package_signature(data: dict[str, Any]) -> list[tuple[Any, ...]]:
    return sorted(
        (
            package.get("package_name"),
            package.get("commit"),
            tuple(package.get("check_paths", [])),
            tuple(package.get("exclude_directories", [])),
        )
        for package in data.get("results", [])
    )


def _package_corpus(data: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        {
            "package_name": package_name,
            "commit": commit,
            "check_paths": list(check_paths),
            "exclude_directories": list(exclude_directories),
        }
        for package_name, commit, check_paths, exclude_directories in _package_signature(
            data
        )
    ]


def _corpus_signature(corpus: list[dict[str, Any]]) -> list[tuple[Any, ...]]:
    return sorted(
        (
            package.get("package_name"),
            package.get("commit"),
            tuple(package.get("check_paths", [])),
            tuple(package.get("exclude_directories", [])),
        )
        for package in corpus
    )


def _metric_value(metric: dict[str, Any], field: str, statistic: Statistic) -> Any:
    if statistic == "mean":
        return metric.get(field)
    stats_field = (
        "execution_time_stats" if field == "execution_time_s" else "peak_memory_stats"
    )
    stats = metric.get(stats_field)
    return stats.get("median") if isinstance(stats, dict) else None


def _package_metrics(
    data: dict[str, Any], checker: str, statistic: Statistic = "mean"
) -> dict[str, dict[str, float]]:
    package_metrics: dict[str, dict[str, float]] = {}
    for package in data.get("results", []):
        name = package.get("package_name")
        metric = package.get("metrics", {}).get(checker, {})
        if not name or not metric.get("ok"):
            continue
        execution_time = _metric_value(metric, "execution_time_s", statistic)
        peak_memory = _metric_value(metric, "peak_memory_mb", statistic)
        if not isinstance(execution_time, (int, float)) or not isinstance(
            peak_memory, (int, float)
        ):
            continue
        package_metrics[str(name)] = {
            "execution_time_s": float(execution_time),
            "peak_memory_mb": float(peak_memory),
        }
    return package_metrics


def load_history(
    paths: list[Path], manifest_path: Path | None = None
) -> dict[str, Any]:
    if not paths:
        raise ValueError("At least one release result is required")

    expected: dict[str, str] = {}
    if manifest_path:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        expected = {
            str(release["version"]): str(release["published_at"])
            for release in manifest["releases"]
        }

    releases: list[dict[str, Any]] = []
    versions: set[str] = set()
    profile: dict[str, Any] | None = None
    package_signature: list[tuple[Any, ...]] | None = None

    for path in paths:
        data = json.loads(path.read_text(encoding="utf-8"))
        checker = _checker(data, path)
        version = str(
            data.get("release_version")
            or data.get("type_checker_versions", {}).get(checker, "")
        )
        _version_key(version)
        if version in versions:
            raise ValueError(f"Duplicate Pyright release result: {version}")
        versions.add(version)

        current_profile = {field: data.get(field) for field in PROFILE_FIELDS}
        if profile is None:
            profile = current_profile
        elif current_profile != profile:
            raise ValueError(f"{path} uses a different benchmark profile")

        current_signature = _package_signature(data)
        if package_signature is None:
            package_signature = current_signature
        elif current_signature != package_signature:
            raise ValueError(f"{path} uses a different package corpus")

        releases.append(
            {
                "version": version,
                "published_at": str(
                    data.get("release_published_at") or expected.get(version, "")
                ),
                "measured_at": str(data.get("timestamp", "")),
                "packages": _package_metrics(data, checker),
            }
        )

    missing = sorted(set(expected) - versions, key=_version_key)
    unexpected = sorted(versions - set(expected), key=_version_key) if expected else []
    if missing or unexpected:
        details = []
        if missing:
            details.append(f"missing releases: {', '.join(missing)}")
        if unexpected:
            details.append(f"unexpected releases: {', '.join(unexpected)}")
        raise ValueError("; ".join(details))

    releases.sort(key=lambda release: _version_key(release["version"]))
    packages = sorted(
        {
            package
            for release in releases
            for package in release["packages"]
        }
    )
    return {
        "profile": profile or {},
        "packages": packages,
        "package_corpus": _package_corpus(
            json.loads(paths[0].read_text(encoding="utf-8"))
        ),
        "releases": releases,
    }


def append_candidates(
    history_path: Path,
    candidate_paths: list[Path],
    candidate_labels: list[str],
    statistic: Statistic = "mean",
) -> dict[str, Any]:
    history = json.loads(history_path.read_text(encoding="utf-8"))
    expected_packages = set(history.get("packages", []))
    expected_signature = _corpus_signature(history.get("package_corpus", []))
    if not expected_signature:
        raise ValueError(f"{history_path} does not contain a package corpus")
    existing_labels = {str(release.get("version")) for release in history["releases"]}
    comparison_signature: list[tuple[Any, ...]] | None = None
    comparison_profile: dict[str, Any] | None = None
    for candidate_path, candidate_label in zip(
        candidate_paths, candidate_labels, strict=True
    ):
        candidate = json.loads(candidate_path.read_text(encoding="utf-8"))
        checker = _checker(candidate, candidate_path)
        profile = {field: candidate.get(field) for field in PROFILE_FIELDS}
        comparable_profile = {
            field: candidate.get(field) for field in COMPARISON_PROFILE_FIELDS
        }
        history_profile = {
            field: history.get("profile", {}).get(field)
            for field in COMPARISON_PROFILE_FIELDS
        }
        if comparable_profile != history_profile:
            raise ValueError(f"{candidate_path} uses a different benchmark profile")
        if comparison_profile is None:
            comparison_profile = profile
        elif profile != comparison_profile:
            raise ValueError(f"{candidate_path} uses a different comparison profile")

        candidate_packages = {
            str(package.get("package_name"))
            for package in candidate.get("results", [])
            if package.get("package_name")
        }
        if candidate_packages != expected_packages:
            raise ValueError(f"{candidate_path} uses a different package corpus")
        current_signature = _package_signature(candidate)
        if current_signature != expected_signature:
            raise ValueError(f"{candidate_path} uses a different history package corpus")
        if comparison_signature is None:
            comparison_signature = current_signature
        elif current_signature != comparison_signature:
            raise ValueError(f"{candidate_path} uses a different package corpus")
        if candidate_label in existing_labels:
            raise ValueError(f"Duplicate history label: {candidate_label}")
        existing_labels.add(candidate_label)
        history["releases"].append(
            {
                "version": candidate_label,
                "published_at": "",
                "measured_at": str(candidate.get("timestamp", "")),
                "packages": _package_metrics(candidate, checker, statistic),
                "comparison": True,
            }
        )
    history["comparison_profile"] = comparison_profile
    history["comparison_statistic"] = statistic
    return history


def render_svg(
    history: dict[str, Any],
    metric_name: str,
    title: str,
    unit: str,
) -> str:
    releases = history["releases"]
    packages = history["packages"]
    width = 1280
    height = 760
    left = 90
    right = 50
    top = 80
    bottom = 170
    chart_width = width - left - right
    chart_height = height - top - bottom
    baseline_values = {}
    normalized_values = []
    for package in packages:
        for release in releases:
            metrics = release["packages"].get(package)
            if metrics and metric_name in metrics:
                baseline_values[package] = metrics[metric_name]
                break
        baseline = baseline_values.get(package)
        if not baseline:
            continue
        normalized_values.extend(
            metrics[metric_name] / baseline * 100
            for release in releases
            if (metrics := release["packages"].get(package))
            and metric_name in metrics
        )
    observed_min = min(normalized_values, default=100.0)
    observed_max = max(normalized_values, default=100.0)
    y_min = max(0.0, math.floor((min(observed_min, 100.0) - 5) / 10) * 10)
    y_max = math.ceil((max(observed_max, 100.0) + 5) / 10) * 10
    if y_max - y_min < 20:
        y_min = max(0.0, y_min - 10)
        y_max += 10

    def x_position(index: int) -> float:
        if len(releases) == 1:
            return left + chart_width / 2
        return left + chart_width * index / (len(releases) - 1)

    def y_position(value: float) -> float:
        return top + chart_height * (y_max - value) / (y_max - y_min)

    elements = [
        f'<svg xmlns="http://www.w3.org/2000/svg" role="img" '
        f'aria-labelledby="title description" viewBox="0 0 {width} {height}">',
        f'<title id="title">{html.escape(title)}</title>',
        (
            '<desc id="description">One line per benchmark package across Pyright releases'
            f'{" plus the base and pull request comparison" if any(release.get("comparison") for release in releases) else ""}.</desc>'
        ),
        "<style>",
        "text{font-family:Aptos,Arial,sans-serif;fill:#18222c}",
        ".grid{stroke:#d5ded9;stroke-width:1}.axis{stroke:#52616b;stroke-width:1.5}",
        ".series{fill:none;stroke-width:2.5;vector-effect:non-scaling-stroke}",
        ".point{stroke:#fff;stroke-width:1.5}.label{font-size:13px}.tick{font-size:12px;fill:#52616b}",
        "</style>",
        '<rect width="1280" height="760" fill="#f8faf9"/>',
        f'<text x="{left}" y="38" font-size="26" font-weight="700">{html.escape(title)}</text>',
        f'<text x="{left}" y="61" font-size="14" fill="#60717f">Earliest release = 100% for each package - lower is better</text>',
    ]

    for tick in range(6):
        value = y_min + (y_max - y_min) * tick / 5
        y = y_position(value)
        elements.append(
            f'<line class="grid" x1="{left}" y1="{y:.1f}" x2="{width - right}" y2="{y:.1f}"/>'
        )
        elements.append(
            f'<text class="tick" x="{left - 12}" y="{y + 4:.1f}" text-anchor="end">'
            f"{value:g}%</text>"
        )
    baseline_y = y_position(100)
    elements.append(
        f'<line x1="{left}" y1="{baseline_y:.1f}" x2="{width - right}" '
        f'y2="{baseline_y:.1f}" stroke="#52616b" stroke-width="1.5" stroke-dasharray="6 5"/>'
    )

    elements.extend(
        [
            f'<line class="axis" x1="{left}" y1="{top}" x2="{left}" y2="{top + chart_height}"/>',
            f'<line class="axis" x1="{left}" y1="{top + chart_height}" '
            f'x2="{width - right}" y2="{top + chart_height}"/>',
        ]
    )

    for index, release in enumerate(releases):
        x = x_position(index)
        version = html.escape(release["version"])
        published = html.escape(release["published_at"][:10])
        elements.append(
            f'<text class="tick" x="{x:.1f}" y="{top + chart_height + 24}" '
            f'text-anchor="middle">{version}</text>'
        )
        if published:
            elements.append(
                f'<text class="tick" x="{x:.1f}" y="{top + chart_height + 42}" '
                f'text-anchor="middle">{published}</text>'
            )

    for package_index, package in enumerate(packages):
        color = PALETTE[package_index % len(PALETTE)]
        baseline = baseline_values.get(package)
        if not baseline:
            continue
        points: list[str] = []
        circles: list[str] = []
        for release_index, release in enumerate(releases):
            metrics = release["packages"].get(package)
            if not metrics or metric_name not in metrics:
                continue
            exact_value = metrics[metric_name]
            value = exact_value / baseline * 100
            x = x_position(release_index)
            y = y_position(value)
            points.append(f"{x:.1f},{y:.1f}")
            circles.append(
                f'<circle class="point" cx="{x:.1f}" cy="{y:.1f}" r="4" fill="{color}">'
                f"<title>{html.escape(package)} - {html.escape(release['version'])}: "
                f"{exact_value:.2f} {html.escape(unit)} ({value:.1f}%)</title></circle>"
            )
        if len(points) > 1:
            elements.append(
                f'<polyline class="series" points="{" ".join(points)}" stroke="{color}"/>'
            )
        elements.extend(circles)

        column = package_index % 3
        row = package_index // 3
        legend_x = left + column * 360
        legend_y = top + chart_height + 80 + row * 25
        elements.append(
            f'<line x1="{legend_x}" y1="{legend_y}" x2="{legend_x + 24}" '
            f'y2="{legend_y}" stroke="{color}" stroke-width="3"/>'
        )
        elements.append(
            f'<text class="label" x="{legend_x + 32}" y="{legend_y + 4}">'
            f"{html.escape(package)}</text>"
        )

    elements.append("</svg>")
    return "".join(elements)


def render_html(history: dict[str, Any]) -> str:
    profile = history["profile"]
    releases = history["releases"]
    has_comparison = any(release.get("comparison") for release in releases)
    comparison_profile = history.get("comparison_profile", {})
    comparison_statistic = history.get("comparison_statistic", "mean")
    comparison_methodology = ""
    if has_comparison:
        comparison_methodology = (
            f" The base and PR points use the {html.escape(str(comparison_statistic))} "
            f"of {html.escape(str(comparison_profile.get('runs_per_package', 'unknown')))} "
            "measured runs after "
            f"{html.escape(str(comparison_profile.get('warmup_runs', 'unknown')))} "
            "warmup run(s) on the same hosted runner."
        )
    rows = []
    for release in releases:
        rows.append(
            "<tr>"
            f"<th>{html.escape(release['version'])}</th>"
            f"<td>{html.escape(release['published_at'][:10])}</td>"
            f"<td>{len(release['packages'])}</td>"
            f"<td>{html.escape(release['measured_at'])}</td>"
            "</tr>"
        )
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pyright package performance by release</title>
<style>
body {{ margin:0; color:#18222c; background:#f4f7f5; font-family:Aptos,"Trebuchet MS",sans-serif; }}
header {{ color:white; background:#173b47; padding:38px max(24px,calc((100vw - 1240px)/2)); border-bottom:5px solid #e67700; }}
h1 {{ margin:0 0 8px; font-family:Georgia,serif; font-size:clamp(2rem,5vw,3.6rem); }}
header p {{ margin:0; color:#d8e7e8; }}
main {{ max-width:1240px; margin:auto; padding:32px 24px 64px; }}
section {{ margin-bottom:36px; }} img {{ width:100%; height:auto; border:1px solid #cdd8d3; background:white; }}
.note {{ color:#52616b; }} .table-wrap {{ overflow:auto; border:1px solid #cdd8d3; background:white; }}
table {{ width:100%; border-collapse:collapse; }} th,td {{ padding:11px 14px; border-bottom:1px solid #dce5e1; text-align:left; }}
thead {{ background:#edf2ef; }} code {{ background:#e5ece8; padding:2px 5px; }}
</style>
</head>
<body>
<header><h1>Pyright package performance by release</h1><p>Every stable Pyright release from the prior year{" plus the base and pull request comparison" if has_comparison else ""}, measured against one pinned package corpus.</p></header>
<main>
<section><h2>Execution time</h2><img src="execution-time.svg" alt="Per-package Pyright execution time across releases"></section>
<section><h2>Peak memory</h2><img src="peak-memory.svg" alt="Per-package Pyright peak memory across releases"></section>
<section><h2>Methodology</h2>
<p class="note">Each release point is one measured run on a GitHub-hosted Ubuntu runner and is normalized to that package's earliest release.{comparison_methodology} Releases and comparisons use the same package commits, check paths, Python version, memory limit, and dependency-isolation mode. Separate hosted runners introduce machine variance, so use the release series for release-scale trends rather than small differences.</p>
<p>Profile: Python <code>{html.escape(str(profile.get("python_version", "unknown")))}</code>,
runner <code>{html.escape(str(profile.get("runner_class", "unknown")))}</code>,
{html.escape(str(profile.get("runs_per_package", "unknown")))} measured run per package.</p></section>
<section><h2>{"Benchmark runs" if has_comparison else "Release runs"}</h2><div class="table-wrap"><table><thead><tr><th>{"Version / comparison" if has_comparison else "Version"}</th><th>Published</th><th>Packages measured</th><th>Measured at</th></tr></thead><tbody>{''.join(rows)}</tbody></table></div></section>
<p><a href="../">Back to the weekly type checker comparison</a> | <a href="history.json">Download summarized JSON</a></p>
</main>
</body>
</html>
"""


def _write_bundle(history: dict[str, Any], output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "history.json").write_text(
        json.dumps(history, indent=2) + "\n", encoding="utf-8"
    )
    (output_dir / "execution-time.svg").write_text(
        render_svg(history, "execution_time_s", "Pyright execution time by package", "s"),
        encoding="utf-8",
    )
    (output_dir / "peak-memory.svg").write_text(
        render_svg(history, "peak_memory_mb", "Pyright peak memory by package", "MB"),
        encoding="utf-8",
    )
    (output_dir / "index.html").write_text(render_html(history), encoding="utf-8")


def write_history(
    paths: list[Path], output_dir: Path, manifest_path: Path | None = None
) -> dict[str, Any]:
    history = load_history(paths, manifest_path)
    _write_bundle(history, output_dir)
    return history


def write_candidate_history(
    history_path: Path,
    candidate_paths: list[Path],
    candidate_labels: list[str],
    output_dir: Path,
    statistic: Statistic = "mean",
) -> dict[str, Any]:
    history = append_candidates(
        history_path, candidate_paths, candidate_labels, statistic
    )
    _write_bundle(history, output_dir)
    return history


def main() -> int:
    parser = argparse.ArgumentParser(description="Render Pyright release history charts")
    parser.add_argument("results", nargs="*", type=Path)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--existing-history", type=Path)
    parser.add_argument("--candidate-label", action="append")
    parser.add_argument(
        "--candidate-statistic", choices=("mean", "median"), default="mean"
    )
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if args.existing_history:
        if (
            not args.results
            or len(args.results) != len(args.candidate_label or [])
            or args.manifest
        ):
            parser.error(
                "--existing-history requires one --candidate-label per result"
            )
        write_candidate_history(
            args.existing_history,
            args.results,
            args.candidate_label,
            args.output,
            args.candidate_statistic,
        )
    else:
        if not args.results or args.candidate_label:
            parser.error("release history rendering requires release result files")
        write_history(args.results, args.output, args.manifest)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
