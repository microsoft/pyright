#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import re
import zipfile
from pathlib import Path, PurePosixPath
from typing import Any


ARTIFACT_PATTERN = re.compile(
    r"^typecheck-benchmark-history-pr-(\d+)-run-(\d+)-attempt-(\d+)"
    r"-base-[0-9a-f]{40}-candidate-[0-9a-f]{40}$"
)
EXPECTED_FILES = {
    "execution-time.svg",
    "history.json",
    "index.html",
    "peak-memory.svg",
}
MAX_FILE_SIZE = 5 * 1024 * 1024


def select_artifacts(artifacts: list[dict[str, Any]]) -> list[dict[str, int]]:
    selected: dict[tuple[int, int, int], dict[str, Any]] = {}
    for artifact in artifacts:
        match = ARTIFACT_PATTERN.fullmatch(str(artifact.get("name", "")))
        artifact_id = artifact.get("id")
        run_id = artifact.get("run_id")
        created_at = artifact.get("created_at")
        if (
            not match
            or not isinstance(artifact_id, int)
            or not isinstance(run_id, int)
            or not isinstance(created_at, str)
            or not created_at
        ):
            continue
        pr_number = int(match.group(1))
        if run_id != int(match.group(2)):
            continue
        run_attempt = int(match.group(3))
        key = (pr_number, run_id, run_attempt)
        current = selected.get(key)
        if current is None or str(current["created_at"]) < created_at:
            selected[key] = {
                "id": artifact_id,
                "pr_number": pr_number,
                "run_id": run_id,
                "run_attempt": run_attempt,
                "created_at": created_at,
            }
    return [
        {
            "id": int(artifact["id"]),
            "pr_number": int(artifact["pr_number"]),
            "run_id": int(artifact["run_id"]),
            "run_attempt": int(artifact["run_attempt"]),
        }
        for artifact in sorted(
            selected.values(),
            key=lambda artifact: (
                int(artifact["pr_number"]),
                int(artifact["run_id"]),
                int(artifact["run_attempt"]),
            ),
        )
    ]


def extract_archive(archive_path: Path, destination: Path) -> None:
    with zipfile.ZipFile(archive_path) as archive:
        files = [info for info in archive.infolist() if not info.is_dir()]
        names = {PurePosixPath(info.filename).name for info in files}
        if len(files) != len(EXPECTED_FILES) or names != EXPECTED_FILES or any(
            len(PurePosixPath(info.filename).parts) != 1 for info in files
        ):
            raise ValueError(f"Unexpected PR history archive entries: {sorted(names)}")
        for info in files:
            if info.file_size > MAX_FILE_SIZE:
                raise ValueError(f"PR history file is too large: {info.filename}")
        destination.mkdir(parents=True, exist_ok=True)
        for info in files:
            (destination / info.filename).write_bytes(archive.read(info))


def main() -> int:
    parser = argparse.ArgumentParser(description="Prepare retained PR history artifacts")
    subparsers = parser.add_subparsers(dest="command", required=True)

    select_parser = subparsers.add_parser("select")
    select_parser.add_argument("manifest", type=Path)
    select_parser.add_argument("output", type=Path)

    extract_parser = subparsers.add_parser("extract")
    extract_parser.add_argument("archive", type=Path)
    extract_parser.add_argument("destination", type=Path)

    args = parser.parse_args()
    if args.command == "select":
        artifacts = json.loads(args.manifest.read_text(encoding="utf-8"))
        if not isinstance(artifacts, list):
            raise ValueError("Artifact manifest must contain a list")
        selected = select_artifacts(artifacts)
        args.output.write_text(json.dumps(selected) + "\n", encoding="utf-8")
    else:
        extract_archive(args.archive, args.destination)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
