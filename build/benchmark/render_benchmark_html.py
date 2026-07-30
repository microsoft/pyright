#!/usr/bin/env python3

from __future__ import annotations

import argparse
import html
import json
from pathlib import Path
from typing import Any


CHECKER_ORDER = ["pyright", "pyrefly", "ty", "mypy", "zuban"]


def load_checker_results(paths: list[Path]) -> dict[str, dict[str, Any]]:
    results: dict[str, dict[str, Any]] = {}
    for path in paths:
        data = json.loads(path.read_text(encoding="utf-8"))
        checkers = data.get("type_checkers", [])
        if len(checkers) != 1:
            raise ValueError(f"{path} must contain exactly one type checker")
        checker = checkers[0]
        if checker in results:
            raise ValueError(f"Duplicate result for {checker}")
        results[checker] = data
    return results


def _ordered_checkers(results: dict[str, dict[str, Any]]) -> list[str]:
    return sorted(
        results,
        key=lambda checker: (
            CHECKER_ORDER.index(checker) if checker in CHECKER_ORDER else len(CHECKER_ORDER),
            checker,
        ),
    )


def _package_metrics(data: dict[str, Any], checker: str) -> dict[str, dict[str, Any]]:
    return {
        package["package_name"]: package.get("metrics", {}).get(checker, {})
        for package in data.get("results", [])
        if package.get("package_name")
    }


def render_html(results: dict[str, dict[str, Any]]) -> str:
    if not results:
        raise ValueError("At least one checker result is required")
    checkers = _ordered_checkers(results)
    packages = sorted(
        {
            package["package_name"]
            for data in results.values()
            for package in data.get("results", [])
            if package.get("package_name")
        }
    )
    metrics = {
        checker: _package_metrics(results[checker], checker) for checker in checkers
    }
    totals = {
        checker: float(
            results[checker].get("aggregate", {})
            .get(checker, {})
            .get("total_execution_time_s", 0.0)
        )
        for checker in checkers
    }
    max_total = max(totals.values(), default=0.0)
    timestamp = max(str(data.get("timestamp", "")) for data in results.values())
    environment = next(iter(results.values()))

    summary_rows: list[str] = []
    for checker in checkers:
        aggregate = results[checker].get("aggregate", {}).get(checker, {})
        tested = int(aggregate.get("packages_tested", 0))
        failed = int(aggregate.get("packages_failed", 0))
        total = totals[checker]
        share = total / max_total * 100 if max_total else 0.0
        version = results[checker].get("type_checker_versions", {}).get(checker, "unknown")
        summary_rows.append(
            "<tr>"
            f"<th scope=\"row\"><span class=\"checker\">{html.escape(checker)}</span>"
            f"<small>{html.escape(str(version))}</small></th>"
            f"<td>{tested}</td><td class=\"{'failed' if failed else 'passed'}\">{failed}</td>"
            f"<td><div class=\"bar\" style=\"--size:{share:.1f}%\"></div>"
            f"<strong>{total:.1f}s</strong></td>"
            f"<td>{float(aggregate.get('p50_execution_time_s', 0.0)):.1f}s</td>"
            f"<td>{float(aggregate.get('p50_peak_memory_mb', 0.0)):.0f} MB</td>"
            "</tr>"
        )

    package_rows: list[str] = []
    for package in packages:
        successful = {
            checker: float(metrics[checker][package]["execution_time_s"])
            for checker in checkers
            if metrics[checker].get(package, {}).get("ok")
        }
        fastest = min(successful, key=successful.get) if successful else None
        cells = []
        for checker in checkers:
            metric = metrics[checker].get(package, {})
            if not metric.get("ok"):
                cells.append('<td class="failed">Not measured</td>')
                continue
            class_name = "fastest" if checker == fastest else ""
            cells.append(
                f'<td class="{class_name}"><strong>{float(metric["execution_time_s"]):.2f}s</strong>'
                f'<small>{float(metric.get("peak_memory_mb", 0.0)):.0f} MB</small></td>'
            )
        package_rows.append(
            f'<tr><th scope="row">{html.escape(package)}</th>{"".join(cells)}</tr>'
        )

    checker_headers = "".join(f"<th>{html.escape(checker)}</th>" for checker in checkers)
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Python type checker benchmark</title>
<style>
:root {{ --ink:#18222c; --muted:#60717f; --paper:#f4f7f5; --line:#cdd8d3; --green:#087f5b; --red:#c92a2a; --blue:#1864ab; --amber:#e67700; }}
* {{ box-sizing:border-box; }}
body {{ margin:0; color:var(--ink); background-color:var(--paper); background-image:linear-gradient(#dce5e1 1px,transparent 1px),linear-gradient(90deg,#dce5e1 1px,transparent 1px); background-size:32px 32px; font-family:Aptos,"Trebuchet MS",sans-serif; }}
header {{ color:white; background:#173b47; padding:42px max(24px,calc((100vw - 1180px)/2)); border-bottom:5px solid var(--amber); }}
h1 {{ margin:0 0 8px; font-family:Georgia,serif; font-size:clamp(2rem,5vw,4rem); letter-spacing:0; }}
header p {{ margin:0; color:#d8e7e8; }}
main {{ max-width:1180px; margin:0 auto; padding:34px 24px 64px; }}
section {{ margin-bottom:42px; }}
h2 {{ font-family:Georgia,serif; font-size:1.55rem; letter-spacing:0; }}
.table-wrap {{ overflow-x:auto; border:1px solid var(--line); background:white; box-shadow:6px 6px 0 #b9c9c2; }}
table {{ width:100%; border-collapse:collapse; min-width:760px; }}
th,td {{ padding:13px 15px; border-bottom:1px solid var(--line); text-align:right; vertical-align:middle; }}
thead th {{ color:#43535e; background:#edf2ef; font-size:.75rem; text-transform:uppercase; }}
th:first-child {{ text-align:left; }}
tbody tr:last-child th,tbody tr:last-child td {{ border-bottom:0; }}
small {{ display:block; margin-top:3px; color:var(--muted); font-family:"IBM Plex Mono","Courier New",monospace; }}
.checker {{ display:block; font-size:1.05rem; text-transform:capitalize; }}
.bar {{ float:left; width:var(--size); min-width:3px; height:8px; margin:6px 10px 0 0; background:var(--blue); }}
.passed {{ color:var(--green); }} .failed {{ color:var(--red); }}
.fastest {{ color:var(--green); background:#e6f5ef; }}
.legend {{ color:var(--muted); font-size:.9rem; }}
@media (max-width:640px) {{ header {{ padding-top:30px; padding-bottom:30px; }} main {{ padding-inline:14px; }} }}
</style>
</head>
<body>
<header><h1>Python type checker benchmark</h1><p>Weekly cross-checker performance on pinned open-source projects.</p></header>
<main>
<section><h2>Run summary</h2><p class="legend">Generated {html.escape(timestamp)} · Python {html.escape(str(environment.get('python_version', 'unknown')))} · {html.escape(str(environment.get('platform_details', environment.get('platform', 'unknown'))))}</p>
<div class="table-wrap"><table><thead><tr><th>Checker</th><th>Measured</th><th>Failed</th><th>Total time</th><th>Median time</th><th>Median RSS</th></tr></thead><tbody>{''.join(summary_rows)}</tbody></table></div></section>
<section><h2>Package comparison</h2><p class="legend">Fastest successful checker per package is highlighted. Cells show wall time and peak RSS.</p>
<div class="table-wrap"><table><thead><tr><th>Package</th>{checker_headers}</tr></thead><tbody>{''.join(package_rows)}</tbody></table></div></section>
</main>
</body>
</html>
"""


def main() -> int:
    parser = argparse.ArgumentParser(description="Render multi-checker benchmark HTML")
    parser.add_argument("results", nargs="+", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        render_html(load_checker_results(args.results)), encoding="utf-8"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())