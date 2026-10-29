# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

"""Freeze or run a small, human-reviewed development cohort through the real read-only assessor."""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import importlib.metadata
import inspect
import json
import shutil
import sys
import time
from pathlib import Path
from typing import Literal, Self

from copilot import CopilotClient, RuntimeConnection
from copilot.session import CopilotSession
from pydantic import Field, JsonValue, TypeAdapter, model_validator

from assess_issues import BUDGET, MODEL, arguments as assessment_arguments, assess, save, target_process
from evaluate_issue_assessment import (
    CASES, CandidateClaimResult, CandidateExecution, CandidateInput, CandidateObservation, CandidateScope,
    CheckerExecutionReceipt, FrozenAssessmentProtocol, RawSDKUsage, evaluate_candidates, load_candidates,
    make_protocol, save_frozen_candidates, validate_frozen_implementation, validate_protocol,
)
from issue_review_assessment_models import AssessmentInput, AssessmentReceipt, AssessmentRun, DeclaredClaim, VerificationPlan
from issue_review_models import Issue, Record, ReproductionTarget, Text
from issue_review_reproduction import REGISTRIES, TargetStore, fingerprint, observe_claims, run_target_io
from issue_review_safety import InjectionScreening, child_environment
from issue_review_sources import SettingChoice
from issue_review_validity import Hash, ValidityAssessment, ValidityEvidence, record_hash
from review_issues import ROOT, SDK, AutomationError, GitHub


class FrozenTargetAssignment(Record):
    input_sha256: Hash
    provenance: Text
    targets: list[ReproductionTarget] = Field(min_length=3, max_length=3)

    @model_validator(mode="after")
    def exact_roles(self) -> Self:
        if {item.role for item in self.targets} != {"historical", "main", "latest"}:
            raise ValueError("Each input requires distinct historical/main/latest assignments")
        return self


class SDKEvent(Record):
    at: Text
    type: Text
    data: dict[str, JsonValue]


def implementation_files() -> list[Path]:
    return [
        *sorted((ROOT / "build" / "automation").glob("*.py")),
        Path(inspect.getfile(CopilotClient)), Path(inspect.getfile(CopilotSession)),
    ]


def profile_files() -> list[Path]:
    return sorted((ROOT / ".github" / "agents").glob("*.md"))


def validate_runtime(
    protocol: FrozenAssessmentProtocol, targets: Path, sources: Path, normative: list[ValidityEvidence],
) -> None:
    validate_frozen_implementation(protocol)
    if protocol.role_budget_seconds != BUDGET or protocol.sdk_version != importlib.metadata.version("github-copilot-sdk"):
        raise ValueError("Actual assessor role budget or installed SDK differs from the frozen protocol")
    if (
        {Path(item.name).resolve() for item in protocol.implementation} != set(implementation_files())
        or {Path(item.name).resolve() for item in protocol.profiles} != set(profile_files())
        or {Path(item.name).resolve() for item in protocol.runtime_inputs} != {targets.resolve(), sources.resolve()}
        or {item.name: item.sha256 for item in protocol.permitted_normative_sources} != {item.id: record_hash(item) for item in normative}
    ):
        raise ValueError("Frozen implementation/profile/runtime/normative source set differs from the actual assessor")


def candidate_snapshot(
    report: CandidateInput, protocol: FrozenAssessmentProtocol, targets: FrozenTargetAssignment,
    normative: list[ValidityEvidence],
) -> AssessmentInput:
    digest = record_hash(report)
    if targets.input_sha256 != digest:
        raise ValueError("Frozen targets belong to a different candidate input")
    selections: list[SettingChoice] = []
    for setting in report.settings:
        if setting.provenance != "assumed":
            continue
        if setting.value is None:
            raise ValueError("An assumed setting needs an explicit value")
        if setting.name == "pythonVersion":
            selections.append(SettingChoice(setting="pythonVersion", value=setting.value, reason=setting.qualification))
        elif setting.name == "typeCheckingMode":
            selections.append(SettingChoice(setting="typeCheckingMode", value=setting.value, reason=setting.qualification))
        else:
            raise ValueError(f"Unsupported assumed setting: {setting.name}")
    return AssessmentInput(
        report_id="input-" + digest, origin=report.origin,
        provenance="Controller-frozen report bytes; identity and reference judgments withheld.",
        issue=Issue(
            number=0, title="Frozen report", body=report.report, html_url="assessment-fixture:" + digest,
            state="open", updated_at="not-provided-in-frozen-input", created_at=None, comments=0,
        ),
        comments=[], declared_claims=[DeclaredClaim(id=item.id, summary=item.summary) for item in report.claims],
        setting_choices=selections, limitations=report.limitations,
        expected_original_hashes={item.path: item.sha256 for item in report.files if item.role == "original_source"},
        blind=True, target_selection_provenance=(
            "Controller-frozen existing target snapshot; role names refer to that captured selection, "
            "not a fresh live main/latest lookup. No outcome-dependent selection."
        ),
        frozen_targets_hash=fingerprint([item.model_dump(mode="json") for item in targets.targets]),
        normative_evidence_hash=fingerprint([item.model_dump(mode="json") for item in normative]),
    )


def scoped_sources(report: CandidateInput, sources: list[ValidityEvidence]) -> list[ValidityEvidence]:
    ids = {claim.id for claim in report.claims}
    return [
        item.model_copy(update={"claim_ids": [identifier for identifier in item.claim_ids if identifier in ids]})
        for item in sources if ids.intersection(item.claim_ids)
    ]


def execution_ledger(
    directory: Path, report: CandidateInput, protocol: FrozenAssessmentProtocol,
) -> tuple[list[CheckerExecutionReceipt], int | None, bool, list[RawSDKUsage], list[str]]:
    receipts: list[CheckerExecutionReceipt] = []
    unknown = False
    paths = [*directory.glob("discovery-*/receipt.json"), *directory.glob("verification-*/*-receipt.json")]
    for path in sorted(paths):
        item = AssessmentReceipt.model_validate_json(path.read_bytes())
        raw = item.raw
        if not isinstance(raw.get("exit_code"), int) or isinstance(raw.get("exit_code"), bool):
            unknown = True
            continue
        if any(not isinstance(raw.get(key), str) for key in ("command", "cwd", "stdout", "stderr", "input_hash")):
            raise ValueError("Completed checker receipt is missing its command/output/input ledger")
        target = ReproductionTarget.model_validate(raw["target"])
        role: Literal["original", "control", "discovery"] = (
            "discovery" if item.kind == "discovery" else "control" if item.kind == "verification_control" else "original"
        )
        inline_precision = False
        if role == "original":
            plan = VerificationPlan.model_validate_json(path.with_name("plan.json").read_bytes())
            if (
                item.claim_id != plan.claim_id or item.plan_hash != fingerprint(plan.model_dump())
                or raw.get("scenario_hash") != fingerprint(plan.scenario.model_dump())
            ):
                raise ValueError("Original precision receipt differs from its frozen verification plan")
            inline_precision = (
                not plan.scenario.control_files
                and observe_claims(plan.scenario, raw).get(item.claim_id) in {"reproduced", "not_reproduced"}
            )
        receipts.append(CheckerExecutionReceipt(
            id=item.id, input_sha256=record_hash(report), protocol_sha256=record_hash(protocol),
            claim_ids=[item.claim_id], target=target.role, role=role, provenance="controller_execution",
            artifact_id=str(path.resolve()), sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
            original_precision_verified=inline_precision,
        ))
    for plan in directory.glob("discovery-*/plan.json"):
        unknown |= not plan.with_name("receipt.json").is_file()
    for started in directory.glob("verification-*/started.json"):
        plan = json.loads(started.with_name("plan.json").read_bytes())
        expected = 6 if plan["scenario"]["control_files"] else 3
        unknown |= len(list(started.parent.glob("*-receipt.json"))) != expected
    usage: list[RawSDKUsage] = []
    sdk_called = False
    for path in sorted((directory / "roles").glob("*/sdk-events.jsonl")):
        for ordinal, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            event = SDKEvent.model_validate_json(line)
            sdk_called = True
            if event.type != "assistant.usage":
                continue
            for name, value in event.data.items():
                if isinstance(value, bool) or not isinstance(value, (int, float)):
                    continue
                if "token" in name:
                    unit = "token_capacity" if name.startswith("max_") else "tokens"
                elif name == "cost":
                    unit = "sdk_reported_cost_units"
                else:
                    continue
                usage.append(RawSDKUsage(
                    event_id=str(event.data.get("event_id") or f"{path.relative_to(directory)}:{ordinal}"),
                    name=name, value=value, unit=unit,
                ))
    artifacts = [str(path.resolve()) for path in sorted(directory.rglob("*")) if path.is_file()]
    return receipts, None if unknown else len(receipts), sdk_called, usage, artifacts


def observations(
    result: AssessmentRun, receipts: list[CheckerExecutionReceipt],
) -> list[CandidateObservation]:
    output = []
    for progress in result.progress:
        for target, status in progress.target_observations.items():
            if target != "historical" and target != "main" and target != "latest":
                raise ValueError("Unknown controller target role")
            originals = [
                item.id for item in receipts
                if item.role == "original" and item.target == target and progress.claim_id in item.claim_ids
            ]
            controls = [
                item.id for item in receipts
                if item.role == "control" and item.target == target and progress.claim_id in item.claim_ids
            ]
            observed = status in {"reproduced", "not_reproduced"}
            output.append(CandidateObservation(
                claim_id=progress.claim_id, target=target,
                status="reproduced" if status == "reproduced" else "absent" if status == "not_reproduced" else "unobserved",
                qualification=(
                    "unobserved" if not observed else
                    "assumed_settings" if result.plan.assumptions else "verified"
                ),
                original_receipt_ids=originals if observed else [],
                affirmative_control_receipt_ids=controls if status == "not_reproduced" else [],
                affirmative_original_precision_receipt_ids=[
                    item.id for item in receipts if item.id in originals and item.original_precision_verified
                ] if status == "not_reproduced" else [],
                limitations=(
                    result.plan.assumptions if observed and result.plan.assumptions else []
                ),
            ))
    return output


class ProductionAssessmentRunner:
    def __init__(
        self, github: GitHub, sdk: SDK, store: TargetStore, state_directory: Path,
        target_manifest: Path, source_manifest: Path,
    ) -> None:
        self.github, self.sdk, self.store, self.directory = github, sdk, store, state_directory.resolve()
        self.target_manifest, self.source_manifest = target_manifest, source_manifest

    async def run(self, report: CandidateInput, protocol: FrozenAssessmentProtocol) -> CandidateExecution:
        assignments = TypeAdapter(list[FrozenTargetAssignment]).validate_json(self.target_manifest.read_bytes())
        sources = TypeAdapter(list[ValidityEvidence]).validate_json(self.source_manifest.read_bytes())
        validate_runtime(protocol, self.target_manifest, self.source_manifest, sources)
        if {item.name: item.sha256 for item in protocol.candidate_inputs}.get(report.id) != record_hash(report):
            raise ValueError("Candidate input differs from the frozen protocol")
        if self.sdk.model != protocol.model:
            raise ValueError("Actual SDK model differs from the frozen protocol")
        matching = [item for item in assignments if item.input_sha256 == record_hash(report)]
        if len(matching) != 1:
            raise ValueError("Candidate needs exactly one hash-bound target assignment")
        assignment = matching[0]
        normative = scoped_sources(report, sources)
        snapshot = candidate_snapshot(report, protocol, assignment, normative)
        directory = self.directory / snapshot.report_id
        args = assessment_arguments([
            "--issue", "0", "--state-dir", str(directory), "--model", protocol.model,
            "--registry", self.store.registry,
            *(["--allow-assumed-settings"] if snapshot.setting_choices else []),
        ])
        started = time.monotonic()
        result = None
        findings = None
        error: str | None = None
        status: Literal["completed", "timeout", "operational_failure"] = "completed"
        try:
            result = await assess(
                args, self.github, self.sdk, store=self.store, assessment_input=snapshot,
                frozen_targets=assignment.targets, normative_evidence=normative,
            )
            if result.validity is None:
                raise ValueError("Assessment did not produce validated semantic findings; see the retained phase failures")
            if isinstance(result.validity, dict) and result.validity.get("status") in {"blocked", "unperformed"}:
                raise AutomationError(f"Validity {result.validity['status']}: {result.validity.get('reason')}")
            findings = ValidityAssessment.model_validate(result.validity)
        except (ValueError, AutomationError, OSError, TimeoutError) as failure:
            error = f"{type(failure).__name__}: {failure}"
            status = "timeout" if isinstance(failure, TimeoutError) else "operational_failure"
        receipts, total, sdk_called, usage, artifacts = execution_ledger(directory, report, protocol)
        declared = {item.id for item in report.claims}
        return CandidateExecution(
            id=report.id, input_sha256=record_hash(report), protocol_sha256=record_hash(protocol), status=status,
            sdk_called=sdk_called, actual_checker_executions=total,
            claims=[] if findings is None else [
                CandidateClaimResult(
                    claim_id=item.claim_id, disposition=item.disposition, status=item.status, reasoning=item.reasoning,
                    evidence_ids=item.evidence_ids, information_requests=[
                        f"{request.requested} Why: {request.reason} Distinguishes: {request.distinguishes}"
                        for request in item.information_requests
                    ], limitations=[*item.assumptions, *item.limitations],
                ) for item in findings.claims
            ],
            observations=[] if result is None else observations(result, receipts),
            raw_sdk_usage=usage, usage_unavailable_reason=None if usage else "No numeric SDK usage was reported in the retained SDK event ledger.",
            elapsed_seconds=time.monotonic() - started, error=error, artifact_ids=artifacts, checker_receipts=receipts,
            additional_claims=[] if result is None else [
                CandidateScope(id=item.id, summary=item.summary) for item in result.plan.claims if item.id not in declared
            ],
            phase_failures=[] if result is None else result.failures,
        )


def arguments(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("freeze", "run"))
    parser.add_argument("--cases", type=Path, default=CASES)
    parser.add_argument("--targets", type=Path, required=True, help="Typed FrozenTargetAssignment list bound to candidate input hashes")
    parser.add_argument("--sources", type=Path, required=True, help="Controller-captured normative evidence, never reference answers")
    parser.add_argument("--output", type=Path, required=True, help="NEW freeze or evaluation directory")
    parser.add_argument("--protocol", type=Path, help="Required for run; written by freeze")
    parser.add_argument("--target-cache", type=Path, help="Existing trusted cache; acquisition is never enabled")
    parser.add_argument("--registry", choices=REGISTRIES, default=REGISTRIES[0])
    parser.add_argument("--model", default=MODEL)
    parser.add_argument("--cli-path", default=shutil.which("copilot"))
    return parser.parse_args(argv)


async def main(args: argparse.Namespace) -> None:
    cases = load_candidates(args.cases)
    assignments = TypeAdapter(list[FrozenTargetAssignment]).validate_json(args.targets.read_bytes())
    sources = TypeAdapter(list[ValidityEvidence]).validate_json(args.sources.read_bytes())
    inputs = {record_hash(case.input) for case in cases}
    if {item.input_sha256 for item in assignments} != inputs or len(assignments) != len(inputs):
        raise ValueError("Target assignments must cover the exact candidate inputs once each")
    if args.operation == "freeze":
        protocol = make_protocol(
            cases, model=args.model, sdk_version=importlib.metadata.version("github-copilot-sdk"),
            role_budget_seconds=BUDGET, implementation_files=implementation_files(), profiles=profile_files(),
            normative_sources=sources, runtime_files=[args.targets, args.sources],
        )
        save_frozen_candidates(cases, protocol, args.output, sources)
        return
    if args.protocol is None or args.target_cache is None or not args.cli_path:
        raise ValueError("Run requires a frozen protocol, trusted target cache and authenticated Copilot runtime")
    protocol = FrozenAssessmentProtocol.model_validate_json(args.protocol.read_bytes())
    validate_protocol(cases, protocol)
    if any(case.reference_status != "human_reviewed" for case in cases):
        raise ValueError("Human reference review is pending; no SDK, screening, checker or output will be started")
    validate_runtime(protocol, args.targets, args.sources, sources)
    if args.output.exists():
        raise FileExistsError("Evaluation requires a NEW output directory")
    if not args.target_cache.is_dir():
        raise ValueError("Target cache must already exist; this runner never acquires targets")
    github = GitHub(scorer=InjectionScreening.from_environment())
    store = TargetStore(args.target_cache, target_process, registry=args.registry)
    for assignment in assignments:
        for target in assignment.targets:
            await run_target_io(store.verify, target)
    async with CopilotClient(
        connection=RuntimeConnection.for_stdio(path=args.cli_path), working_directory=str(ROOT),
        env={**child_environment(), "USE_TGREP": "false"},
    ) as client:
        runner = ProductionAssessmentRunner(
            github, SDK(client, protocol.model, BUDGET), store, args.output / "assessments", args.targets, args.sources,
        )
        summary = await evaluate_candidates(cases, protocol, runner, args.output)
    save(args.output / "completed.json", summary)


if __name__ == "__main__":
    try:
        asyncio.run(main(arguments()))
    except (ValueError, AutomationError, OSError) as failure:
        print(f"Calibration blocked: {type(failure).__name__}: {failure}", file=sys.stderr)
        sys.exit(1)
