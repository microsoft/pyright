# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

"""Cache-only, observation-only access to controller-selected checker artifacts."""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
import subprocess
import uuid
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Literal

from pydantic import Field, JsonValue

from issue_review_models import Entry, Record, ReproductionTarget
from issue_review_reproduction import (
    SHA, UPSTREAM, VERSION, TargetStore, artifact_urls, fingerprint, relative_path, run_target_io,
)


class PreparedCheck(Record):
    target_id: str = Field(min_length=64, max_length=64)
    phase: Literal["original", "control"]
    configuration_reason: str = Field(
        min_length=1, max_length=4096,
        description="Explain the explicit experimental settings, including missing reporter settings. "
        "No setting is inferred by the tool or certified as report-faithful.",
    )
    original_receipt_id: str | None = Field(
        default=None, description="For a separate control, the successful original receipt from this tool.",
    )


def selected_targets(entry: Entry) -> list[ReproductionTarget]:
    targets = list(entry.reproduction_stage.targets) if entry.reproduction_stage else []
    observation = entry.diagnostic_observations
    if observation is not None:
        for case in [observation, *observation.cases]:
            targets.extend(
                ReproductionTarget.model_validate(receipt["target"])
                for receipt in case.receipts if isinstance(receipt.get("target"), dict)
            )
    return targets


def selection(target: ReproductionTarget) -> str:
    if target.role == "main":
        return "pinned_upstream_main"
    if target.role == "latest":
        return "latest_at_controller_selection"
    return "selected_as_of_issue_creation" if target.approximate else "reported_release"


def target_id(target: ReproductionTarget) -> str:
    return fingerprint(target.model_dump(mode="json", exclude={
        "version", "directory", "cli", "tree_hash", "artifact_sha512", "status", "error",
    }))


def validate_target(target: ReproductionTarget, store: TargetStore) -> None:
    if target.registry != store.registry:
        raise ValueError("Prepared target registry differs from the controller policy")
    if target.role == "main":
        if target.source != UPSTREAM or not SHA.fullmatch(target.identity):
            raise ValueError("Prepared main target must identify the pinned trusted upstream commit")
    elif (
        not VERSION.fullmatch(target.version) or target.identity != f"npm:pyright@{target.version}"
        or target.source not in artifact_urls(target.version, store.registry) or not target.integrity
    ):
        raise ValueError("Prepared release must identify the exact integrity-pinned trusted package")


def validate_receipt(record: dict[str, JsonValue]) -> None:
    if (
        record.get("kind") != "prepared_pyright" or record.get("experimental") is not True
        or record.get("faithful_reproduction") is not False or record.get("action_ineligible") is not True
        or record.get("receipt_hash") != fingerprint({
            key: value for key, value in record.items() if key not in {"receipt_hash", "investigator"}
        })
    ):
        raise ValueError("Prepared execution receipt identity or observation-only policy changed")
    if record.get("error"):
        raise ValueError("Prepared checker execution was blocked: " + str(record["error"]))
    target = ReproductionTarget.model_validate(record.get("target"))
    inputs = record.get("inputs")
    if (
        not isinstance(inputs, dict) or record.get("inputs_hash") != fingerprint(inputs)
        or not isinstance(record.get("command"), str) or not isinstance(record.get("cwd"), str)
        or record.get("target_selection") != selection(target)
        or record.get("target_id") != target_id(target)
        or target.status != "ready" or not target.cli or not target.directory or not target.tree_hash
    ):
        raise ValueError("Prepared execution receipt target or inputs changed")
    if any(not isinstance(content, str) for content in inputs.values()):
        raise ValueError("Prepared execution inputs must preserve exact source text")
    hashes = {
        str(relative_path(name)): hashlib.sha256(str(content).encode("utf-8")).hexdigest()
        for name, content in inputs.items()
    }
    cwd = Path(str(record["cwd"]))
    if (
        record.get("input_hash") != fingerprint(hashes)
        or record.get("configuration") != json.loads(str(inputs.get("pyrightconfig.json", "")))
        or record["command"] != subprocess.list2cmdline([
            "node", target.cli, "--project", str(cwd / "pyrightconfig.json"),
            "--outputjson", "--pythonpath", str(cwd / "unavailable-python"),
        ])
    ):
        raise ValueError("Prepared execution command, configuration or frozen input hash changed")
    output = json.loads(str(record.get("stdout", "")))
    stderr = record.get("stderr")
    if (
        not isinstance(output, dict) or output.get("version") != target.version
        or not isinstance(output.get("generalDiagnostics"), list)
        or not all(isinstance(item, dict) for item in output["generalDiagnostics"])
        or not isinstance(output.get("summary"), dict)
        or type(output["summary"].get("filesAnalyzed")) is not int
        or output["summary"]["filesAnalyzed"] < 1
        or type(record.get("exit_code")) is not int or record["exit_code"] not in (0, 1)
        or not isinstance(stderr, str) or stderr.strip()
    ):
        raise ValueError("Invalid checker JSON/version, zero files, or unverified setup output")


class PreparedChecks:
    def __init__(
        self, store: TargetStore, targets: list[ReproductionTarget], directory: Path,
        screen: Callable[[JsonValue, str], Awaitable[None]],
    ):
        self.store, self.directory, self.screen = store, directory.resolve(), screen
        self.targets: dict[str, ReproductionTarget] = {}
        for target in targets:
            copied = target.model_copy(deep=True)
            self.targets[target_id(copied)] = copied
        if len(self.targets) > 24:
            raise ValueError("Prepared checker selection exceeds the bounded target budget")
        self.receipts: dict[str, dict[str, JsonValue]] = {}
        self.attempts = 0
        self.lock = asyncio.Lock()

    def catalog(self) -> list[dict[str, JsonValue]]:
        return [{
            "target_id": key, "target": target.model_dump(mode="json"),
            "target_selection": selection(target),
            "availability": "Cache/integrity revalidated at execution; no acquisition is authorized",
            "experimental": True, "faithful_reproduction": False, "action_ineligible": True,
        } for key, target in self.targets.items()]

    async def run(self, request: PreparedCheck, scratch: Path) -> dict[str, JsonValue]:
        async with self.lock:
            if self.attempts >= 12:
                raise ValueError("Prepared checker budget exhausted (12 attempts per investigation)")
            self.attempts += 1
            if self.directory.is_relative_to(scratch.resolve()):
                raise ValueError("Prepared receipts and execution inputs must be outside investigator write scope")
            if request.target_id not in self.targets:
                raise ValueError("Select an exact controller-advertised target_id; arbitrary versions are unavailable")
            target = self.targets[request.target_id].model_copy(deep=True)
            if target.status == "blocked":
                raise ValueError(target.error or "Selected checker target is blocked")
            validate_target(target, self.store)
            expected_version = target.version
            # restore verifies the selected cache key, saved provenance, entrypoint and complete runtime tree.
            await run_target_io(self.store.restore, target)
            validate_target(target, self.store)
            if target.role != "main" and target.version != expected_version:
                raise ValueError("Cached release version differs from the selected publication")
            inputs = await run_target_io(self.snapshot, scratch)
            original = self.receipts.get(request.original_receipt_id or "")
            original_inputs = None if original is None else original.get("inputs")
            if request.phase == "control":
                if (
                    original is None or original.get("phase") != "original"
                    or original.get("target_id") != request.target_id
                    or not isinstance(original_inputs, dict)
                    or original_inputs.keys() != inputs.keys()
                    or original_inputs["pyrightconfig.json"] != inputs["pyrightconfig.json"]
                ):
                    raise ValueError("Separate controls require a successful original with the same target, file set and configuration")
                validate_receipt(original)
            elif request.original_receipt_id is not None:
                raise ValueError("An original experiment cannot reference a control baseline")
            screening_input: dict[str, JsonValue] = {
                "inputs": {key: value for key, value in inputs.items()}, "request": request.model_dump(mode="json"),
            }
            await self.screen(screening_input, "prepared-check-inputs")
            record = await self.store.run_static(target, inputs, self.directory / uuid.uuid4().hex)
            record.update({
                "kind": "prepared_pyright", "target_id": request.target_id, "target_selection": selection(target),
                "phase": request.phase, "original_receipt_id": request.original_receipt_id,
                "inputs_hash": fingerprint(inputs),
                "configuration": json.loads(inputs["pyrightconfig.json"]),
                "configuration_reason": request.configuration_reason,
                "configuration_provenance": "Investigator-selected experiment; correspondence to reporter settings unverified",
                "source_provenance": "Investigator-labelled original/control; report fidelity unverified",
                "experimental": True, "faithful_reproduction": False, "action_ineligible": True,
            })
            record["receipt_hash"] = fingerprint(record)
            self.directory.mkdir(parents=True, exist_ok=True)
            (self.directory / f"{record['id']}.json").write_text(json.dumps(record, indent=2), encoding="utf-8")
            validate_receipt(record)
            await self.screen(record, "prepared-check-output")
            self.receipts[str(record["id"])] = record
            return record

    @staticmethod
    def snapshot(scratch: Path) -> dict[str, str]:
        inputs: dict[str, str] = {}
        for path in sorted(scratch.rglob("*")):
            if path.is_symlink() or not path.resolve().is_relative_to(scratch.resolve()):
                raise ValueError("Prepared checker inputs cannot contain links or leave scratch")
            if path.is_file() and (path.suffix in {".py", ".pyi"} or path == scratch / "pyrightconfig.json"):
                name = str(path.relative_to(scratch))
                relative_path(name)
                if path.stat().st_size > 65536:
                    raise ValueError("Prepared checker files must not exceed 64 KiB")
                inputs[name] = path.read_text(encoding="utf-8")
        if not 1 <= sum(name.endswith((".py", ".pyi")) for name in inputs) <= 30:
            raise ValueError("Prepared checks require 1-30 inspected Python/stub files")
        if "pyrightconfig.json" not in inputs:
            raise ValueError("Create an explicit scratch pyrightconfig.json before a prepared check")
        config = json.loads(inputs["pyrightconfig.json"])
        if not isinstance(config, dict):
            raise ValueError("Prepared checker configuration must be a JSON object")
        if config.get("typeCheckingMode") not in {"off", "basic", "standard", "strict"} or not re.fullmatch(
            r"3\.\d+", str(config.get("pythonVersion", "")),
        ):
            raise ValueError("Explicit experimental pythonVersion and typeCheckingMode are required; missing reporter settings remain unknown")
        for key, value in config.items():
            if key in {"include", "exclude", "strict"}:
                if not isinstance(value, list):
                    raise ValueError("Prepared checker scope must use ordinary relative scratch paths")
                for item in value:
                    if not isinstance(item, str) or not item:
                        raise ValueError("Prepared checker scope must use ordinary relative scratch paths")
                    if item != ".":
                        relative_path(item)
            elif key not in {"pythonVersion", "pythonPlatform", "typeCheckingMode", "enableExperimentalFeatures"} and not key.startswith("report"):
                raise ValueError(f"Configuration '{key}' is unavailable in this controlled probe")
        return inputs
