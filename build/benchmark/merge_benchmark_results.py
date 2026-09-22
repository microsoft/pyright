#!/usr/bin/env python3

from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path
from typing import Any

import typecheck_benchmark


VARIABLE_FIELDS = {"aggregate", "date", "package_count", "results", "timestamp"}


def merge_results(paths: list[Path]) -> dict[str, Any]:
    if not paths:
        raise ValueError("At least one benchmark result is required")

    merged: dict[str, Any] | None = None
    expected_metadata: dict[str, Any] | None = None
    results: list[typecheck_benchmark.PackageResult] = []
    package_names: set[str] = set()
    timestamps: list[str] = []

    for path in paths:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError(f"{path} must contain a JSON object")

        metadata = {
            key: value for key, value in data.items() if key not in VARIABLE_FIELDS
        }
        if expected_metadata is None:
            expected_metadata = metadata
            merged = copy.deepcopy(data)
        elif metadata != expected_metadata:
            raise ValueError(f"{path} uses different benchmark metadata")

        timestamp = data.get("timestamp")
        if not isinstance(timestamp, str) or not timestamp:
            raise ValueError(f"{path} does not contain a timestamp")
        timestamps.append(timestamp)

        shard_results = data.get("results")
        if not isinstance(shard_results, list) or not shard_results:
            raise ValueError(f"{path} does not contain package results")
        for package in shard_results:
            if not isinstance(package, dict):
                raise ValueError(f"{path} contains a non-object package result")
            package_name = package.get("package_name")
            if not isinstance(package_name, str) or not package_name:
                raise ValueError(f"{path} contains a package without a name")
            if package_name in package_names:
                raise ValueError(f"Duplicate package result: {package_name}")
            package_names.add(package_name)
            results.append(package)

    assert merged is not None
    type_checkers = merged.get("type_checkers")
    if not isinstance(type_checkers, list) or not all(
        isinstance(checker, str) for checker in type_checkers
    ):
        raise ValueError("Benchmark results contain invalid type checkers")

    timestamp = max(timestamps)
    merged["timestamp"] = timestamp
    merged["date"] = timestamp[:10]
    merged["package_count"] = len(results)
    merged["results"] = sorted(results, key=lambda result: result["package_name"])
    merged["aggregate"] = typecheck_benchmark.compute_aggregate_stats(
        merged["results"], type_checkers
    )
    return merged


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Merge package-sharded type checker benchmark results"
    )
    parser.add_argument("results", nargs="+", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    merged = merge_results(args.results)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(merged, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
