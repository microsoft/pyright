"""Compatibility checks shared by benchmark reports and regression history."""

from __future__ import annotations

import math
from typing import Any


EVIDENCE_VERSION = 8
ENVIRONMENT_FIELDS = (
    "platform", "architecture", "runner_class", "runner_image", "cpu_count",
    "python_version", "memory_measurement", "memory_limit_mb", "dependency_isolation",
    "checker_config_version", "uncounted_validation_runs_per_checker",
    "runs_per_package", "warmup_runs", "timeout_s",
    "import_path_overrides",
)
SCOPE_FIELDS = ("commit", "check_paths", "exclude_directories", "resolved_dependencies")


def validate_evidence(data: dict[str, Any]) -> None:
    if data.get("checker_config_version", 0) < EVIDENCE_VERSION:
        return
    for field in (*ENVIRONMENT_FIELDS, "installed_packages"):
        if field not in data:
            raise ValueError(f"Missing benchmark evidence field: {field}")
    names: set[str] = set()
    for package in data.get("results", []):
        name = package["package_name"]
        if name in names:
            raise ValueError(f"Duplicate package evidence: {name}")
        names.add(name)
        if not package.get("error"):
            for field in (*SCOPE_FIELDS, "repository_configs"):
                if field not in package:
                    raise ValueError(f"{name}: missing package evidence: {field}")
        for checker, metric in package.get("metrics", {}).items():
            if not metric.get("ok"):
                continue
            count = metric.get("files_selected")
            if (
                metric.get("file_count_verified") is not True
                or not isinstance(count, int) or isinstance(count, bool) or count <= 0
            ):
                raise ValueError(f"{name}/{checker}: source-file count is not verified")
            for field in ("execution_time_s", "peak_memory_mb"):
                value = metric.get(field)
                if (
                    not isinstance(value, (int, float)) or isinstance(value, bool)
                    or not math.isfinite(value) or value < 0
                ):
                    raise ValueError(f"{name}/{checker}: invalid {field}")


def validate_compatibility(left: dict[str, Any], right: dict[str, Any]) -> None:
    validate_evidence(left)
    validate_evidence(right)
    for field in ENVIRONMENT_FIELDS:
        if left.get(field) != right.get(field):
            raise ValueError(f"Incompatible benchmark environment: {field}")
    if left.get("installed_packages") != right.get("installed_packages"):
        raise ValueError("Incompatible benchmark import environments: installed_packages")
    left_packages = {item["package_name"]: item for item in left.get("results", [])}
    right_packages = {item["package_name"]: item for item in right.get("results", [])}
    if left_packages.keys() != right_packages.keys():
        raise ValueError("Incompatible benchmark package sets")
    for name in left_packages:
        old, new = left_packages[name], right_packages[name]
        # A failed preparation may lack dependency evidence. It is not shared successful work.
        fields = SCOPE_FIELDS if not old.get("error") and not new.get("error") else SCOPE_FIELDS[:3]
        for field in fields:
            if old.get(field) != new.get(field):
                raise ValueError(f"{name}: incompatible package {field}")
