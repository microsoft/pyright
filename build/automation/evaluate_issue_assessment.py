# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

"""Freeze and inspect provisional assessment candidates, or score saved offline results.

This CLI never starts an SDK, checker, download or issue lookup. The injected evaluation
API is for the integrated read-only assessor after actual human reference approval.
Synthetic contract observations are not measurements of issue-assessor usefulness.
"""

from __future__ import annotations

import argparse
import json
import time
from datetime import datetime, timezone
from pathlib import Path, PureWindowsPath
from typing import Literal, Protocol, Self

from pydantic import Field, TypeAdapter, model_validator

from issue_review_models import Record, Text
from issue_review_validity import (
    PROFILE, PROTOCOL, Disposition, Hash, ValidityEvidence, content_hash, record_hash,
)

CASES = Path(__file__).with_name("assessment_benchmark_candidates.json")
INTERPRETATION = (
    "Development reference agreement, not general accuracy or action eligibility. "
    "Host binding checks do not prove substantive reasoning. Synthetic observations are not actual executions. "
    "Provisional references require human review. Missing/unexecuted cases cannot pass."
)


class CandidateFile(Record):
    path: Text
    content: str
    sha256: Hash
    role: Literal["original_source", "configuration"]

    @model_validator(mode="after")
    def validate_file(self) -> Self:
        path = PureWindowsPath(self.path)
        if (
            path.is_absolute() or path.drive or ".." in path.parts or ":" in self.path
            or path.suffix not in {".py", ".pyi", ".json"}
        ):
            raise ValueError("Candidate files require safe relative Python/stub/configuration paths")
        if content_hash(self.content) != self.sha256:
            raise ValueError("Candidate file hash mismatch")
        return self


class CandidateSetting(Record):
    name: Text
    value: str | None
    provenance: Literal["reported", "assumed", "missing"]
    qualification: Text

    @model_validator(mode="after")
    def validate_setting(self) -> Self:
        if (self.provenance == "missing") != (self.value is None):
            raise ValueError("Missing settings cannot be silently supplied")
        return self


class CandidateScope(Record):
    id: Text
    summary: Text


class CandidateInput(Record):
    id: str = Field(pattern=r"^case-[a-z0-9-]+$")
    origin: Literal["synthetic_contract", "retained_report"]
    report: Text
    files: list[CandidateFile]
    settings: list[CandidateSetting]
    claims: list[CandidateScope] = Field(min_length=1)
    limitations: list[Text]

    @model_validator(mode="after")
    def validate_input(self) -> Self:
        if len({claim.id for claim in self.claims}) != len(self.claims):
            raise ValueError("Repeated candidate claim")
        if len({file.path.casefold() for file in self.files}) != len(self.files):
            raise ValueError("Repeated candidate file")
        if len({setting.name for setting in self.settings}) != len(self.settings):
            raise ValueError("Repeated candidate setting")
        return self


class ReferenceSource(Record):
    url: Text
    section: Text
    status: Literal["saved_report", "saved_observation", "not_retrieved"]
    evidence_id: str | None

    @model_validator(mode="after")
    def validate_source(self) -> Self:
        if self.status != "not_retrieved" and not self.evidence_id:
            raise ValueError("Saved reference evidence needs an exact evidence ID")
        if not self.url.startswith("https://"):
            raise ValueError("Reference review sources require HTTPS")
        return self


class ReferenceAlternative(Record):
    disposition: Disposition
    status: Literal["supported", "qualified", "inconclusive"]
    condition: Literal["no_verified_reproduction"]
    rationale: Text

    @model_validator(mode="after")
    def inconclusive_status(self) -> Self:
        if self.disposition == "inconclusive" and self.status != "inconclusive":
            raise ValueError("An inconclusive reference alternative must retain inconclusive status")
        return self


class ClaimReference(Record):
    claim_id: Text
    acceptable_dispositions: list[Disposition] = Field(min_length=1)
    expected_status: Literal["supported", "qualified", "inconclusive", "not_settled"]
    useful_information: list[Text]
    rationale: Text
    sources: list[ReferenceSource] = Field(min_length=1)
    version_configuration_limits: Text
    uncertainty: Text
    alternatives: list[ReferenceAlternative] = Field(default_factory=list, max_length=8)

    @model_validator(mode="after")
    def unique_alternatives(self) -> Self:
        keys = [(item.disposition, item.status, item.condition) for item in self.alternatives]
        if len(keys) != len(set(keys)) or self.expected_status == "not_settled" and self.alternatives:
            raise ValueError("Reference alternatives must be unique and cannot settle an unscored reference")
        return self


class HumanApproval(Record):
    reviewer: Text
    reviewed_at: Text
    judgment_sha256: Hash
    input_sha256: Hash

    @model_validator(mode="after")
    def validate_time(self) -> Self:
        if datetime.fromisoformat(self.reviewed_at.replace("Z", "+00:00")).tzinfo is None:
            raise ValueError("Human review time needs a timezone")
        return self


class CandidateJudgment(Record):
    claims: list[ClaimReference] = Field(min_length=1)
    whole_issue_reference: Literal["settled_single_claim", "mixed", "needs_information", "not_settled"]
    observation_pattern: Literal[
        "main_reproduced", "historical_only_pattern", "both_negative", "unobserved", "not_executed",
    ]
    observation_origin: Literal["synthetic_contract", "retained_qualified_pattern"]
    rationale: Text
    version_configuration_limits: Text
    uncertainty: Text


class AssessmentCandidate(Record):
    input: CandidateInput
    family: Text
    split: Literal["development", "holdout"]
    judgment: CandidateJudgment
    reference_status: Literal["provisional", "human_reviewed"]
    approval: HumanApproval | None
    provenance: Text

    @model_validator(mode="after")
    def validate_reference(self) -> Self:
        if {claim.claim_id for claim in self.judgment.claims} != {claim.id for claim in self.input.claims}:
            raise ValueError("Reference must cover every input claim")
        if len({claim.claim_id for claim in self.judgment.claims}) != len(self.judgment.claims):
            raise ValueError("Repeated reference claim")
        if (self.reference_status == "human_reviewed") != (self.approval is not None):
            raise ValueError("Human-reviewed status needs an explicit human approval record")
        if self.approval is not None and (
            self.approval.judgment_sha256 != record_hash(self.judgment)
            or self.approval.input_sha256 != record_hash(self.input)
        ):
            raise ValueError("Human approval must bind the exact input and judgment")
        if (
            self.input.origin == "synthetic_contract"
        ) != (self.judgment.observation_origin == "synthetic_contract"):
            raise ValueError("Synthetic references cannot masquerade as retained observations")
        return self


def load_candidates(path: Path = CASES) -> list[AssessmentCandidate]:
    candidates = TypeAdapter(list[AssessmentCandidate]).validate_json(path.read_bytes())
    if not candidates or len({case.input.id for case in candidates}) != len(candidates):
        raise ValueError("Candidates must be nonempty with unique IDs")
    families: dict[str, str] = {}
    for case in candidates:
        if case.family in families and families[case.family] != case.split:
            raise ValueError("Related issue families cannot cross development/holdout splits")
        families[case.family] = case.split
    return candidates


class NamedHash(Record):
    name: Text
    sha256: Hash


class FrozenAssessmentProtocol(Record):
    schema_version: Literal[1]
    candidate_inputs: list[NamedHash] = Field(min_length=1)
    candidate_references: list[NamedHash] = Field(min_length=1)
    implementation: list[NamedHash] = Field(min_length=1)
    profiles: list[NamedHash] = Field(min_length=1)
    model: Text
    sdk_version: Text
    protocol_sha256: Hash
    permitted_normative_sources: list[NamedHash]
    runtime_inputs: list[NamedHash] = Field(default_factory=list)
    research_policy: Literal["frozen_normative_only_no_identity_or_resolution"]
    role_budget_seconds: int = Field(ge=1, le=180)
    retry_policy: Literal["one_case_attempt_corrections_share_role_budget"]
    created_at: Text

    @model_validator(mode="after")
    def validate_freeze(self) -> Self:
        for values in (
            self.candidate_inputs, self.candidate_references, self.implementation,
            self.profiles, self.permitted_normative_sources, self.runtime_inputs,
        ):
            if len({value.name for value in values}) != len(values):
                raise ValueError("Frozen protocol entries must have unique names")
        if {item.name for item in self.candidate_inputs} != {item.name for item in self.candidate_references}:
            raise ValueError("Input/reference protocol IDs differ")
        if datetime.fromisoformat(self.created_at.replace("Z", "+00:00")).tzinfo is None:
            raise ValueError("Protocol time requires a timezone")
        return self


def validate_protocol(candidates: list[AssessmentCandidate], protocol: FrozenAssessmentProtocol) -> None:
    for case in candidates:
        AssessmentCandidate.model_validate_json(case.model_dump_json())
    if not candidates or len({case.input.id for case in candidates}) != len(candidates):
        raise ValueError("Candidates require unique IDs")
    families: dict[str, str] = {}
    for case in candidates:
        if case.family in families and families[case.family] != case.split:
            raise ValueError("Related issue families cannot cross development/holdout splits")
        families[case.family] = case.split
    expected_inputs = {case.input.id: record_hash(case.input) for case in candidates}
    expected_references = {case.input.id: record_hash(case) for case in candidates}
    if (
        {item.name: item.sha256 for item in protocol.candidate_inputs} != expected_inputs
        or {item.name: item.sha256 for item in protocol.candidate_references} != expected_references
    ):
        raise ValueError("Candidates changed after protocol freeze")


def make_protocol(
    candidates: list[AssessmentCandidate], *, model: str, sdk_version: str, role_budget_seconds: int,
    implementation_files: list[Path], profiles: list[Path], normative_sources: list[ValidityEvidence],
    runtime_files: list[Path] | None = None,
) -> FrozenAssessmentProtocol:
    """Caller supplies the actual integrated implementation/profile set, not a git SHA proxy."""
    if any(
        item.kind not in {"typing_spec", "policy", "python_docs"} or item.provenance != "retrieved_reference"
        for item in normative_sources
    ):
        raise ValueError("Blind calibration permits retrieved normative sources only, never issue resolutions/precedent")
    return FrozenAssessmentProtocol(
        schema_version=1,
        candidate_inputs=[NamedHash(name=case.input.id, sha256=record_hash(case.input)) for case in candidates],
        candidate_references=[NamedHash(name=case.input.id, sha256=record_hash(case)) for case in candidates],
        implementation=[NamedHash(name=str(path), sha256=content_hash(path.read_text(encoding="utf-8"))) for path in implementation_files],
        profiles=[NamedHash(name=str(path), sha256=content_hash(path.read_text(encoding="utf-8"))) for path in profiles],
        model=model, sdk_version=sdk_version, protocol_sha256=content_hash(PROTOCOL),
        permitted_normative_sources=[NamedHash(name=item.id, sha256=record_hash(item)) for item in normative_sources],
        runtime_inputs=[
            NamedHash(name=str(path.resolve()), sha256=content_hash(path.read_bytes().decode("utf-8")))
            for path in runtime_files or []
        ],
        research_policy="frozen_normative_only_no_identity_or_resolution",
        role_budget_seconds=role_budget_seconds,
        retry_policy="one_case_attempt_corrections_share_role_budget",
        created_at=datetime.now(timezone.utc).isoformat(),
    )


def validate_frozen_implementation(protocol: FrozenAssessmentProtocol) -> None:
    for item in [*protocol.implementation, *protocol.profiles]:
        if content_hash(Path(item.name).read_text(encoding="utf-8")) != item.sha256:
            raise ValueError(f"Frozen implementation/profile changed: {item.name}")
    for item in protocol.runtime_inputs:
        if content_hash(Path(item.name).read_bytes().decode("utf-8")) != item.sha256:
            raise ValueError(f"Frozen runtime input changed: {item.name}")
    if protocol.protocol_sha256 != content_hash(PROTOCOL):
        raise ValueError("Frozen validity protocol changed")


def save_frozen_candidates(
    candidates: list[AssessmentCandidate], protocol: FrozenAssessmentProtocol, directory: Path,
    normative_sources: list[ValidityEvidence] | None = None,
) -> None:
    validate_protocol(candidates, protocol)
    validate_frozen_implementation(protocol)
    normative_sources = [] if normative_sources is None else normative_sources
    if {item.id: record_hash(item) for item in normative_sources} != {
        item.name: item.sha256 for item in protocol.permitted_normative_sources
    }:
        raise ValueError("Frozen normative sources do not match their protocol hashes")
    if any(
        item.kind not in {"typing_spec", "policy", "python_docs"} or item.provenance != "retrieved_reference"
        for item in normative_sources
    ):
        raise ValueError("Identity/resolution research is disabled in calibration")
    directory.mkdir(parents=True, exist_ok=False)
    (directory / "inputs").mkdir()
    (directory / "references").mkdir()
    for case in candidates:
        (directory / "inputs" / f"{case.input.id}.json").write_text(
            case.input.model_dump_json(indent=2) + "\n", encoding="utf-8",
        )
        (directory / "references" / f"{case.input.id}.json").write_text(
            case.model_dump_json(indent=2) + "\n", encoding="utf-8",
        )
    (directory / "protocol.json").write_text(protocol.model_dump_json(indent=2) + "\n", encoding="utf-8")
    (directory / "normative-sources.json").write_bytes(
        TypeAdapter(list[ValidityEvidence]).dump_json(normative_sources, indent=2)
    )


class RawSDKUsage(Record):
    """No conversion to dollars; missing provider units stay missing."""

    event_id: Text
    name: Text
    value: float = Field(ge=0, allow_inf_nan=False)
    unit: Text


class CandidateClaimResult(Record):
    claim_id: Text
    disposition: Disposition
    status: Literal["supported", "qualified", "inconclusive"]
    reasoning: Text
    evidence_ids: list[Text]
    information_requests: list[Text]
    limitations: list[Text]


class CandidateObservation(Record):
    claim_id: Text
    target: Literal["historical", "main", "latest"]
    status: Literal["reproduced", "absent", "unobserved"]
    qualification: Literal["verified", "assumed_settings", "synthetic_contract", "unobserved"]
    original_receipt_ids: list[Text]
    affirmative_control_receipt_ids: list[Text]
    affirmative_original_precision_receipt_ids: list[Text] = Field(default_factory=list)
    limitations: list[Text]

    @model_validator(mode="after")
    def validate_observation(self) -> Self:
        if self.status != "unobserved" and not self.original_receipt_ids:
            raise ValueError("Observations require original execution receipts")
        if self.status == "absent" and not (
            self.affirmative_control_receipt_ids or self.affirmative_original_precision_receipt_ids
        ):
            raise ValueError("Affirmative absence requires positive precision controls")
        if self.status == "unobserved" and self.qualification != "unobserved":
            raise ValueError("Unobserved facts cannot be promoted to verified")
        if self.status != "unobserved" and self.qualification == "unobserved":
            raise ValueError("Observed status cannot carry an unobserved qualification")
        if self.qualification == "assumed_settings" and not self.limitations:
            raise ValueError("Assumed settings require disclosed limitations")
        return self


class CheckerExecutionReceipt(Record):
    """Controller-validated saved execution identity, never inferred from input origin."""

    id: Text
    input_sha256: Hash
    protocol_sha256: Hash
    claim_ids: list[Text] = Field(min_length=1)
    target: Literal["historical", "main", "latest"]
    role: Literal["original", "control", "discovery", "setup"]
    provenance: Literal["controller_execution", "synthetic_contract"]
    artifact_id: Text
    sha256: Hash
    original_precision_verified: bool = False

    @model_validator(mode="after")
    def original_precision_only(self) -> Self:
        if self.original_precision_verified and self.role != "original":
            raise ValueError("Inline precision can be carried only by an original execution receipt")
        return self


class CandidateExecution(Record):
    id: str = Field(pattern=r"^case-[a-z0-9-]+$")
    input_sha256: Hash
    protocol_sha256: Hash
    status: Literal["completed", "timeout", "operational_failure", "invalid_record", "not_run"]
    sdk_called: bool | None
    actual_checker_executions: int | None = Field(ge=0)
    claims: list[CandidateClaimResult]
    observations: list[CandidateObservation]
    raw_sdk_usage: list[RawSDKUsage]
    usage_unavailable_reason: str | None
    elapsed_seconds: float = Field(ge=0, allow_inf_nan=False)
    error: str | None
    artifact_ids: list[Text]
    checker_receipts: list[CheckerExecutionReceipt] = Field(default_factory=list)
    additional_claims: list[CandidateScope] = Field(default_factory=list)
    phase_failures: list[Text] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_execution(self) -> Self:
        if self.status == "completed" and (not self.sdk_called or not self.claims or not self.artifact_ids or self.error):
            raise ValueError("A completed assessment needs an SDK call, claim findings and saved artifacts")
        if self.status != "completed" and (not self.error or self.claims):
            raise ValueError("Unfinished assessments cannot carry success-shaped judgments")
        if self.status == "not_run" and (self.sdk_called is not False or self.actual_checker_executions != 0):
            raise ValueError("Not-run cases cannot claim execution")
        if not self.raw_sdk_usage and not self.usage_unavailable_reason:
            raise ValueError("Unavailable SDK usage must be explicit, not zero-filled")
        if len({(item.event_id, item.name, item.unit) for item in self.raw_sdk_usage}) != len(self.raw_sdk_usage):
            raise ValueError("Repeated raw usage event/unit")
        if len({item.id for item in self.additional_claims}) != len(self.additional_claims):
            raise ValueError("Repeated additional discovered claim")
        receipts = {item.id: item for item in self.checker_receipts}
        if len(receipts) != len(self.checker_receipts):
            raise ValueError("Repeated checker execution receipt")
        actual = [item for item in self.checker_receipts if item.provenance == "controller_execution"]
        if (
            self.actual_checker_executions is not None and self.actual_checker_executions != len(actual)
        ):
            raise ValueError("Actual checker execution count must match the controller receipt ledger")
        for item in self.checker_receipts:
            if item.input_sha256 != self.input_sha256 or item.protocol_sha256 != self.protocol_sha256:
                raise ValueError("Checker receipt does not match its frozen input/protocol")
            if item.provenance == "controller_execution" and item.artifact_id not in self.artifact_ids:
                raise ValueError("Controller execution receipt requires its saved artifact")
        for observation in self.observations:
            for identifier in observation.affirmative_original_precision_receipt_ids:
                receipt = receipts.get(identifier)
                if (
                    receipt is None or receipt.provenance != "controller_execution" or receipt.role != "original"
                    or not receipt.original_precision_verified or receipt.target != observation.target
                    or observation.claim_id not in receipt.claim_ids or identifier not in observation.original_receipt_ids
                    or observation.qualification not in {"verified", "assumed_settings"}
                ):
                    raise ValueError("Inline precision requires a matching affirmative original execution receipt")
            for role, identifiers in (
                ("original", observation.original_receipt_ids), ("control", observation.affirmative_control_receipt_ids),
            ):
                for identifier in identifiers:
                    receipt = receipts.get(identifier)
                    if observation.qualification in {"verified", "assumed_settings"}:
                        if (
                            receipt is None or receipt.provenance != "controller_execution" or receipt.role != role
                            or receipt.target != observation.target or observation.claim_id not in receipt.claim_ids
                        ):
                            raise ValueError("Actual observation requires matching controller-backed original/control receipts")
                    elif receipt is not None and receipt.provenance != "synthetic_contract":
                        raise ValueError("Hypothetical observations cannot reuse actual execution receipts")
        return self


class ClaimMetricReview(Record):
    """Human utility judgments are not inferred from nonempty model text."""

    case_id: Text
    claim_id: Text
    classification: Literal["useful_needs_info", "unnecessary_abstention", "other"]
    reviewer: Text
    rationale: Text
    status: Literal["provisional", "human_reviewed"]


def score_candidates(
    candidates: list[AssessmentCandidate], results: list[CandidateExecution], protocol: FrozenAssessmentProtocol,
    utility_reviews: list[ClaimMetricReview] | None = None,
) -> dict[str, object]:
    validate_protocol(candidates, protocol)
    by_id = {case.input.id: case for case in candidates}
    if len({row.id for row in results}) != len(results) or not {row.id for row in results} <= by_id.keys():
        raise ValueError("Unknown or repeated result; retries require a separate frozen run")
    counts: dict[str, int] = dict.fromkeys((
        "completed", "correct_by_design", "incorrect_by_design", "useful_needs_info",
        "unnecessary_abstention", "unscored_needs_info", "reference_agreements", "needs_info_with_requests",
        "potentially_unnecessary_abstention", "provisional_utility_reviews",
        "scored_claims", "operational_failures", "timeouts", "invalid_records",
        "cases_with_phase_failures", "phase_failures",
        "sdk_executed_cases", "checker_executed_cases", "actual_checker_executions",
        "unknown_sdk_execution_cases", "unknown_checker_execution_cases",
        "verified_target_observations", "assumed_target_observations", "synthetic_target_observations",
        "synthetic_input_checker_executed_cases", "retained_report_checker_executed_cases",
        "synthetic_input_actual_checker_executions", "retained_report_actual_checker_executions",
        "synthetic_input_verified_target_observations", "retained_report_verified_target_observations",
        "unreferenced_additional_claims",
    ), 0)
    latencies: list[float] = []
    rows: list[dict[str, object]] = []
    quality_groups = ("all_references", "human_reviewed", "human_reviewed_retained_holdout")
    quality = {group: dict.fromkeys((
        "planned_scored_claims", "completed_reference_claims", "scored_claims",
        "primary_agreements", "alternative_only_agreements",
        "inconclusive_predictions", "non_abstaining_predictions",
        "scored_non_abstaining_predictions", "non_abstaining_agreements",
        "inconclusive_agreements", "always_inconclusive_agreements",
        "singleton_reference_claims", "multiple_disposition_reference_claims",
    ), 0) for group in quality_groups}
    confusion: dict[str, dict[str, dict[str, int]]] = {group: {} for group in quality_groups}

    def groups(case: AssessmentCandidate) -> tuple[str, ...]:
        return (
            "all_references",
            *(("human_reviewed",) if case.reference_status == "human_reviewed" else ()),
            *(("human_reviewed_retained_holdout",) if (
                case.reference_status == "human_reviewed" and case.split == "holdout"
                and case.input.origin == "retained_report"
            ) else ()),
        )

    for case in candidates:
        for group in groups(case):
            quality[group]["planned_scored_claims"] += sum(
                reference.expected_status != "not_settled" for reference in case.judgment.claims
            )
    for row in results:
        row = CandidateExecution.model_validate_json(row.model_dump_json())
        case = by_id[row.id]
        if row.input_sha256 != record_hash(case.input) or row.protocol_sha256 != record_hash(protocol):
            raise ValueError("Result input/protocol identity does not match the frozen run")
        reference_ids = {claim.id for claim in case.input.claims}
        additional_ids = {claim.id for claim in row.additional_claims}
        if reference_ids & additional_ids:
            raise ValueError("Additional claims cannot replace or relabel declared reference identities")
        ids = reference_ids | additional_ids
        if (
            len({claim.claim_id for claim in row.claims}) != len(row.claims)
            or (row.status == "completed" and {claim.claim_id for claim in row.claims} != ids)
            or any(item.claim_id not in ids for item in row.observations)
            or len({(item.claim_id, item.target) for item in row.observations}) != len(row.observations)
            or any(not set(item.claim_ids) <= ids for item in row.checker_receipts)
        ):
            raise ValueError("Result omitted/repeated/invented a material claim or target")
        counts["sdk_executed_cases"] += int(row.sdk_called is True)
        counts["unknown_sdk_execution_cases"] += int(row.sdk_called is None)
        counts["unknown_checker_execution_cases"] += int(row.actual_checker_executions is None)
        counts["cases_with_phase_failures"] += int(bool(row.phase_failures))
        counts["phase_failures"] += len(row.phase_failures)
        confirmed = sum(receipt.provenance == "controller_execution" for receipt in row.checker_receipts)
        counts["checker_executed_cases"] += int(confirmed > 0)
        counts["actual_checker_executions"] += confirmed
        counts["unreferenced_additional_claims"] += len(additional_ids)
        origin_group = "synthetic_input" if case.input.origin == "synthetic_contract" else "retained_report"
        counts[f"{origin_group}_checker_executed_cases"] += int(confirmed > 0)
        counts[f"{origin_group}_actual_checker_executions"] += confirmed
        for item in row.observations:
            if item.status != "unobserved":
                key = {
                    "verified": "verified_target_observations", "assumed_settings": "assumed_target_observations",
                    "synthetic_contract": "synthetic_target_observations",
                }[item.qualification]
                counts[key] += 1
                if item.qualification == "verified":
                    counts[f"{origin_group}_verified_target_observations"] += 1
        if row.sdk_called:
            latencies.append(row.elapsed_seconds)
        if row.status == "completed":
            counts["completed"] += 1
            references = {item.claim_id: item for item in case.judgment.claims}
            for claim in row.claims:
                if claim.disposition == "inconclusive":
                    counts["needs_info_with_requests"] += int(bool(claim.information_requests))
                    counts["unscored_needs_info"] += 1
                reference = references.get(claim.claim_id)
                if reference is None:
                    continue
                settled = reference.expected_status != "not_settled"
                primary_agreement = (
                    claim.disposition in reference.acceptable_dispositions
                    and claim.status == reference.expected_status
                )
                reproduced = any(
                    item.claim_id == claim.claim_id and item.status == "reproduced"
                    and item.qualification in {"verified", "assumed_settings"}
                    for item in row.observations
                )
                alternative_agreement = not reproduced and any(
                    claim.disposition == alternative.disposition and claim.status == alternative.status
                    for alternative in reference.alternatives
                )
                agreement = primary_agreement or alternative_agreement
                for group in groups(case):
                    metric = quality[group]
                    abstaining = claim.disposition == "inconclusive"
                    metric["completed_reference_claims"] += 1
                    metric["inconclusive_predictions" if abstaining else "non_abstaining_predictions"] += 1
                    if not settled:
                        continue
                    metric["scored_claims"] += 1
                    metric["primary_agreements"] += int(primary_agreement)
                    metric["alternative_only_agreements"] += int(alternative_agreement and not primary_agreement)
                    metric["scored_non_abstaining_predictions"] += int(not abstaining)
                    metric["non_abstaining_agreements"] += int(not abstaining and agreement)
                    metric["inconclusive_agreements"] += int(abstaining and agreement)
                    baseline_agreement = (
                        "inconclusive" in reference.acceptable_dispositions
                        and reference.expected_status == "inconclusive"
                    ) or not reproduced and any(
                        alternative.disposition == "inconclusive" and alternative.status == "inconclusive"
                        for alternative in reference.alternatives
                    )
                    metric["always_inconclusive_agreements"] += int(baseline_agreement)
                    expected = set(reference.acceptable_dispositions)
                    if len(expected) == 1:
                        metric["singleton_reference_claims"] += 1
                        predictions = confusion[group].setdefault(next(iter(expected)), {})
                        predictions[claim.disposition] = predictions.get(claim.disposition, 0) + 1
                    else:
                        metric["multiple_disposition_reference_claims"] += 1
                if settled:
                    counts["scored_claims"] += 1
                    counts["reference_agreements"] += int(agreement)
                if claim.disposition == "as_designed" and claim.status == "supported":
                    # A non-settled reference is not a trusted negative label.
                    if settled:
                        counts["correct_by_design" if agreement else "incorrect_by_design"] += 1
                if claim.disposition == "inconclusive":
                    counts["potentially_unnecessary_abstention"] += int(reference.expected_status == "supported")
        elif row.status == "timeout":
            counts["timeouts"] += 1
        elif row.status == "invalid_record":
            counts["invalid_records"] += 1
        elif row.status == "operational_failure":
            counts["operational_failures"] += 1
        rows.append({
            **row.model_dump(mode="json"), "origin": case.input.origin,
            "reference_status": case.reference_status, "family": case.family,
        })
    indexed = {(row.id, claim.claim_id): claim for row in results for claim in row.claims}
    reviewed: set[tuple[str, str]] = set()
    for review in utility_reviews or []:
        key = (review.case_id, review.claim_id)
        if key not in indexed or key in reviewed or indexed[key].disposition != "inconclusive":
            raise ValueError("Utility review requires a unique actual inconclusive claim")
        reviewed.add(key)
        if review.status == "provisional":
            counts["provisional_utility_reviews"] += 1
        else:
            counts["unscored_needs_info"] -= 1
            if review.classification != "other":
                counts[review.classification] += 1
    coverage_complete = len(results) == len(candidates) and counts["completed"] == len(candidates)
    return {
        "planned_cases": len(candidates), "recorded_cases": len(results),
        "missing_cases": sorted(by_id.keys() - {row.id for row in results}),
        "execution_complete": coverage_complete, **counts,
        "reference_scope_complete": coverage_complete and counts["unreferenced_additional_claims"] == 0,
        "additional_claim_review_required": counts["unreferenced_additional_claims"] > 0,
        "reference_agreement_rate": (
            counts["reference_agreements"] / counts["scored_claims"] if counts["scored_claims"] else None
        ),
        "false_by_design_rate": (
            counts["incorrect_by_design"] / (counts["correct_by_design"] + counts["incorrect_by_design"])
            if counts["correct_by_design"] + counts["incorrect_by_design"] else None
        ),
        "human_reviewed_references": sum(case.reference_status == "human_reviewed" for case in candidates),
        "latency_seconds": latencies, "raw_usage_is_unconverted": True,
        "checker_counts_are_confirmed_lower_bounds": bool(counts["unknown_checker_execution_cases"]),
        "utility_reviews": [review.model_dump(mode="json") for review in utility_reviews or []],
        "passing_score": None, "interpretation": INTERPRETATION, "results": rows,
        "judgment_quality": {
            "groups": {
                group: {
                    **metric, "singleton_disposition_confusion": confusion[group],
                    "observed_decision_coverage": (
                        metric["scored_non_abstaining_predictions"] / metric["scored_claims"]
                        if metric["scored_claims"] else None
                    ),
                    "non_abstaining_reference_agreement_rate": (
                        metric["non_abstaining_agreements"] / metric["scored_non_abstaining_predictions"]
                        if metric["scored_non_abstaining_predictions"] else None
                    ),
                    "same_evidence_always_inconclusive_agreement_rate": (
                        metric["always_inconclusive_agreements"] / metric["scored_claims"]
                        if metric["scored_claims"] else None
                    ),
                    "agreement_gain_over_always_inconclusive": (
                        (metric["primary_agreements"] + metric["alternative_only_agreements"]
                         - metric["always_inconclusive_agreements"]) / metric["scored_claims"]
                        if metric["scored_claims"] else None
                    ),
                    "non_abstaining_reference_agreement_yield": (
                        metric["non_abstaining_agreements"] / metric["planned_scored_claims"]
                        if metric["planned_scored_claims"] else None
                    ),
                } for group, metric in quality.items()
            },
            "interpretation": (
                "Reference agreement can reward an evidence-limited inconclusive alternative; it is not judgment "
                "accuracy. The always-inconclusive baseline uses the same saved observations, not a new SDK run. "
                "Decision coverage and agreement gain expose blanket abstention. Confusion counts compare "
                "dispositions only, not qualification status, and do not declare an allowed abstention wrong. "
                "Unsettled and multiple-disposition references are not unique gold labels. Provisional, synthetic "
                "and previously exposed development results cannot establish independent real-report accuracy. "
                "Missing/failed cases remain in the planned-yield denominator; no rate authorizes rollout."
            ),
        },
    }


class AssessmentRunner(Protocol):
    async def run(self, report: CandidateInput, protocol: FrozenAssessmentProtocol) -> CandidateExecution: ...


async def evaluate_candidates(
    candidates: list[AssessmentCandidate], protocol: FrozenAssessmentProtocol, runner: AssessmentRunner, output: Path,
) -> dict[str, object]:
    """No implicit client/acquisition/retry; integrated runner receives blinded input only."""
    validate_protocol(candidates, protocol)
    if any(case.reference_status != "human_reviewed" for case in candidates):
        raise ValueError("Human reference review is pending; do not run this provisional development cohort")
    validate_frozen_implementation(protocol)
    output.mkdir(parents=True, exist_ok=False)
    (output / "protocol.json").write_text(protocol.model_dump_json(indent=2) + "\n", encoding="utf-8")
    results: list[CandidateExecution] = []
    for case in candidates:
        validate_frozen_implementation(protocol)
        started = time.monotonic()
        row: CandidateExecution | None = None
        try:
            # Each role inside the runner shares the protocol's budget for its own corrections.
            row = await runner.run(case.input.model_copy(deep=True), protocol.model_copy(deep=True))
            validate_frozen_implementation(protocol)
            score_candidates(candidates, [row], protocol)
        except (ValueError, OSError, TimeoutError) as error:
            # Preserve invalid data without retrying or inventing zero execution/usage.
            if row is not None:
                (output / f"{case.input.id}.invalid-response.json").write_text(
                    row.model_dump_json(indent=2) + "\n", encoding="utf-8",
                )
            row = CandidateExecution(
                id=case.input.id, input_sha256=record_hash(case.input), protocol_sha256=record_hash(protocol),
                status="timeout" if isinstance(error, TimeoutError) else (
                    "operational_failure" if isinstance(error, OSError) else "invalid_record"
                ),
                sdk_called=None if row is None else row.sdk_called,
                actual_checker_executions=None,
                claims=[], observations=[], raw_sdk_usage=[] if row is None else row.raw_sdk_usage,
                usage_unavailable_reason="Runner did not supply a validated SDK usage ledger" if row is None else row.usage_unavailable_reason,
                elapsed_seconds=time.monotonic() - started, error=str(error) or type(error).__name__,
                artifact_ids=[] if row is None else row.artifact_ids,
                checker_receipts=[],
                additional_claims=[] if row is None else row.additional_claims,
            )
        results.append(row)
        (output / f"{row.id}.json").write_text(row.model_dump_json(indent=2) + "\n", encoding="utf-8")
        (output / "summary.json").write_text(json.dumps(score_candidates(candidates, results, protocol), indent=2) + "\n", encoding="utf-8")
    return score_candidates(candidates, results, protocol)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("inspect", "freeze", "score"))
    parser.add_argument("--cases", type=Path, default=CASES)
    parser.add_argument("--protocol", type=Path)
    parser.add_argument("--records", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--sources", type=Path, help="Frozen typed retrieved normative evidence, not reference answers")
    parser.add_argument("--utility-reviews", type=Path, help="Explicit human/provisional utility judgments for saved claims")
    args = parser.parse_args()
    cases = load_candidates(args.cases)
    if args.operation == "inspect":
        print("| Candidate | Origin | Pattern (reference only) | Claim reference | Review |")
        print("|---|---|---|---|---|")
        for case in cases:
            claims = "; ".join(
                f"{claim.claim_id}: {','.join(claim.acceptable_dispositions)} ({claim.expected_status})"
                + "".join(
                    f"; or {item.disposition} ({item.status}) when {item.condition}" for item in claim.alternatives
                ) for claim in case.judgment.claims
            )
            print(f"| {case.input.id} | {case.input.origin} | {case.judgment.observation_pattern} | {claims} | {case.reference_status} |")
        return 0
    if args.protocol is None:
        parser.error("--protocol is required")
    protocol = FrozenAssessmentProtocol.model_validate_json(args.protocol.read_bytes())
    if args.operation == "freeze":
        if args.output is None:
            parser.error("--output is required")
        sources = [] if args.sources is None else TypeAdapter(list[ValidityEvidence]).validate_json(args.sources.read_bytes())
        save_frozen_candidates(cases, protocol, args.output, sources)
    else:
        if args.records is None:
            parser.error("--records is required")
        results = TypeAdapter(list[CandidateExecution]).validate_json(args.records.read_bytes())
        reviews = [] if args.utility_reviews is None else TypeAdapter(list[ClaimMetricReview]).validate_json(
            args.utility_reviews.read_bytes(),
        )
        print(json.dumps(score_candidates(cases, results, protocol, reviews), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
