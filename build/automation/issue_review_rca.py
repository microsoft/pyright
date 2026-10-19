# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

"""Private copies of the prepared CLI and bounded, source-mapped inspector captures."""

from __future__ import annotations

import asyncio
import hashlib
import json
import shutil
import subprocess
import uuid
from collections.abc import Awaitable, Callable
from pathlib import Path

from pydantic import Field, JsonValue, TypeAdapter

from issue_review_models import Record, Text

JSON = TypeAdapter(JsonValue)
Runner = Callable[[list[str], Path], Awaitable[tuple[int, str, str]]]


class Breakpoint(Record):
    file: Text = Field(description="Path relative to the runner's source root: pyright-internal/src for CLI, vscode-pyright/src for editor")
    line: int = Field(gt=0)
    expressions: list[str] = Field(default_factory=list, max_length=6)


class RootCauseRun(Record):
    breakpoints: list[Breakpoint] = Field(default_factory=list, max_length=4)


class RootCauseRuntime:
    def __init__(self, root: Path, directory: Path, scratch: Path, runner: Runner):
        self.root, self.directory, self.scratch, self.runner = root, directory, scratch, runner
        self.snapshot = directory / "runtime"
        self.helper = root / "build" / "automation" / "issue_review_debug.cjs"
        self.snapshot_hash: str | None = None

    def fingerprint(self) -> str:
        files = {
            str(path.relative_to(self.snapshot)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(self.snapshot.rglob("*")) if path.is_file()
        }
        return hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest()

    async def prepare(self) -> None:
        source = self.root / "packages" / "pyright" / "dist"
        for required in ("pyright.js", "pyright-internal.js", "pyright-internal.js.map", "vendor.js"):
            if not (source / required).is_file():
                raise ValueError(f"RCA needs a prepared source CLI with source maps: missing {source / required}")
        if any(not path.resolve().is_relative_to(source.resolve()) for path in source.rglob("*")):
            raise ValueError("RCA cannot copy a runtime containing links outside its build directory")
        await asyncio.to_thread(shutil.copytree, source, self.snapshot)
        self.snapshot_hash = await asyncio.to_thread(self.fingerprint)
        (self.directory / "runtime.json").write_text(json.dumps({
            "source": str(source), "snapshot": str(self.snapshot), "sha256": self.snapshot_hash,
            "note": "A private copy of the actual prepared bundle, maps and stubs; not a security sandbox.",
        }, indent=2), encoding="utf-8")

    async def run(self, request: RootCauseRun) -> dict[str, JsonValue]:
        if self.snapshot_hash is None or await asyncio.to_thread(self.fingerprint) != self.snapshot_hash:
            raise ValueError("Private RCA runtime is unavailable or changed")
        source_root = self.root / "packages" / "pyright-internal" / "src"
        for breakpoint in request.breakpoints:
            path = (source_root / breakpoint.file).resolve()
            if not path.is_relative_to(source_root.resolve()) or path.suffix != ".ts" or not path.is_file():
                raise ValueError("Breakpoints must name an existing TypeScript file inside pyright-internal/src")
            if any(len(expression) > 2000 for expression in breakpoint.expressions):
                raise ValueError("Debugger expressions are limited to 2000 characters")
        identifier = uuid.uuid4().hex
        manifest = self.directory / f"{identifier}-request.json"
        artifact = self.directory / f"{identifier}-debug.json"
        manifest.write_text(json.dumps({
            "id": identifier, "runtime": str(self.snapshot), "source_root": str(source_root),
            "dependency_root": str(self.root / "packages" / "pyright-internal"),
            "config": str(self.scratch / "pyrightconfig.json"), "artifact": str(artifact),
            "breakpoints": [breakpoint.model_dump() for breakpoint in request.breakpoints],
        }), encoding="utf-8")
        inputs: list[JsonValue] = [
            {"file": str(path.relative_to(self.scratch)), "content": path.read_text(encoding="utf-8")}
            for path in sorted([self.scratch / "pyrightconfig.json", *self.scratch.rglob("*.py"), *self.scratch.rglob("*.pyi")])
        ]
        command = ["node", str(self.helper), str(manifest)]
        code, output, error = await self.runner(command, self.scratch)
        if not artifact.is_file():
            raise ValueError(f"Inspector produced no artifact (exit {code}): {error}\n{output}")
        debug = JSON.validate_json(artifact.read_text(encoding="utf-8"))
        if not isinstance(debug, dict) or debug.get("id") != identifier:
            raise ValueError("Inspector artifact does not match its controller invocation")
        if await asyncio.to_thread(self.fingerprint) != self.snapshot_hash:
            raise ValueError("Private RCA runtime changed during execution")
        return {
            "id": identifier, "kind": "debugger" if request.breakpoints else "product_run",
            "command": subprocess.list2cmdline(command), "cwd": str(self.scratch),
            "exit_code": code, "stdout": output, "stderr": error, "debug": debug,
            "inputs": inputs, "runtime_hash": self.snapshot_hash,
        }
