# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

"""Validated records shared by the console, SDK prompts, and checkpoints."""

import re
from datetime import datetime
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, JsonValue, model_validator

Text = Annotated[str, Field(min_length=1)]
Confidence = Literal["high", "medium", "low"]
REPOSITORY = "microsoft/pyright"
DESIGN_DISPOSITIONS = {"specification_correct", "intentional_limitation"}


class Record(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Check(Record):
    id: Text
    status: Literal["executed", "blocked", "proposed"]
    command: str | None = Field(
        description="For executed checks, copy run_check.command VERBATIM. No descriptions, prefixes, changed quoting, or relative paths."
    )
    cwd: str | None = Field(description="For executed checks, copy run_check.cwd VERBATIM.")
    exit_code: int | None
    observations: Text

    @model_validator(mode="after")
    def validate_execution(self) -> Self:
        if self.status == "executed":
            if not self.command or not self.cwd or self.exit_code is None:
                raise ValueError("Executed checks require a command, cwd, and exit code")
        elif self.exit_code is not None:
            raise ValueError("Unexecuted checks cannot have an exit code")
        return self


class Source(Record):
    id: Text
    kind: Literal[
        "typing_spec", "python_docs", "maintainer_decision", "repository",
        "checker_comparison", "reporter",
    ]
    location: Text
    finding: Text
    applicability: Text


class Reproduction(Record):
    target: Literal["reported_release", "current_release", "checkout"]
    version: str | None
    status: Literal[
        "reproduced", "not_reproduced", "blocked", "not_attempted", "not_applicable"
    ]
    check_ids: list[str]


class Claim(Record):
    id: Text
    summary: Text
    disposition: Literal[
        "bug", "specification_correct", "intentional_limitation",
        "stub_or_environment", "enhancement", "inconclusive",
    ]
    confidence: Confidence
    confidence_reason: Text
    reproduction: list[Reproduction] = Field(min_length=3, max_length=3)
    basis: Text
    source_ids: list[str]
    counterevidence: Text
    falsification: Text
    user_impact: Text


class HistoricalSearch(Record):
    query: Text
    outcome: Text


class ReviewEvidence(Record):
    product_surface: Literal["cli", "language_server", "editor", "packaging", "other"] = Field(
        default="cli", description="Surface needed to distinguish the material claims, not merely the reported client.",
    )
    surface_reason: Text | None = Field(
        default=None, description="Why this surface can test the complaint, and what reported integration remains unverified.",
    )
    claims: list[Claim] = Field(min_length=1)
    checks: list[Check]
    sources: list[Source]
    historical_searches: list[HistoricalSearch]
    @model_validator(mode="after")
    def validate_evidence(self) -> Self:
        checks = {check.id: check for check in self.checks}
        sources = {source.id: source for source in self.sources}
        if len(checks) != len(self.checks) or len(sources) != len(self.sources):
            raise ValueError("Duplicate evidence IDs")
        if len({claim.id for claim in self.claims}) != len(self.claims):
            raise ValueError("Duplicate claim IDs")
        for claim in self.claims:
            if not set(claim.source_ids) <= sources.keys():
                raise ValueError(f"Unresolved source reference in {claim.id}")
            if claim.disposition in DESIGN_DISPOSITIONS and not any(
                sources[source_id].kind in {
                    "typing_spec", "python_docs", "maintainer_decision", "repository"
                } for source_id in claim.source_ids
            ):
                raise ValueError(f"Design conclusion lacks applicable source evidence: {claim.id}")
            if {item.target for item in claim.reproduction} != {
                "reported_release", "current_release", "checkout"
            }:
                raise ValueError(f"Missing or repeated reproduction target in {claim.id}")
            for item in claim.reproduction:
                if not set(item.check_ids) <= checks.keys():
                    raise ValueError(f"Unresolved check reference in {claim.id}")
                if item.status in {"reproduced", "not_reproduced"} and not any(
                    checks[check_id].status == "executed" for check_id in item.check_ids
                ):
                    raise ValueError(f"Reproduction has no executed check: {claim.id}")
        return self

    def closure_candidate(self) -> bool:
        return bool(self.historical_searches) and self.design_claims_supported()

    def design_claims_supported(self) -> bool:
        return all(
            claim.disposition in DESIGN_DISPOSITIONS and claim.confidence == "high"
            and any(item.target == "checkout" and item.status in {"reproduced", "not_reproduced"}
                    for item in claim.reproduction)
            for claim in self.claims
        )

    def observed_product(self) -> bool:
        return self.product_surface == "cli" and all(
            any(item.target == "checkout" and item.status in {"reproduced", "not_reproduced"}
                for item in claim.reproduction)
            for claim in self.claims
        )


class Audit(ReviewEvidence):
    schema_version: Literal[1]
    repository: Literal["microsoft/pyright"]
    issue_number: int = Field(gt=0)
    issue_url: Text
    issue_updated_at: str | None
    reviewed_at: Text
    checkout_revision: str | None
    summary: Text
    uncertainties: list[str]
    next_action: Text

    @model_validator(mode="after")
    def validate_metadata(self) -> Self:
        if self.issue_url != f"https://github.com/{REPOSITORY}/issues/{self.issue_number}":
            raise ValueError("Audit URL does not match the target repository and issue")
        for timestamp in (self.reviewed_at, self.issue_updated_at):
            if timestamp and datetime.fromisoformat(timestamp.replace("Z", "+00:00")).tzinfo is None:
                raise ValueError("Audit timestamps must include a timezone")
        if self.checkout_revision is not None:
            if len(self.checkout_revision) != 40 or any(
                character not in "0123456789abcdef" for character in self.checkout_revision
            ):
                raise ValueError("Invalid checkout SHA")
        return self


class ReviewFindings(Record):
    markdown: Text = Field(description=(
        "The full Markdown investigation, not a comment draft. Include the minimal repro/configuration, "
        "actual product invocation and inspected diagnostics/types versus expectations, version/surface limits, "
        "specific typing rules and historical decisions, competing evidence, user impact, confidence and blockers."
    ))
    audit: Audit


class DuplicateEvidence(Record):
    url: Text
    finding: Text


class DuplicateCandidate(Record):
    issue_number: int = Field(gt=0)
    relation: Literal["duplicate", "related", "not_duplicate", "inconclusive"]
    confidence: Confidence
    shared_cause: Text
    differences: Text
    canonical_reason: Text
    evidence: list[DuplicateEvidence] = Field(min_length=1)


class DuplicateReport(Record):
    repository: Literal["microsoft/pyright"]
    issue_number: int = Field(gt=0)
    summary: Text
    candidates: list[DuplicateCandidate]
    uncertainties: list[str]
    searches: list[HistoricalSearch] = Field(default_factory=list)
    search_complete: bool = Field(
        default=False,
        description="True only after the bounded searches and strongest candidate discussions were accessible and inspected.",
    )

    @model_validator(mode="after")
    def validate_candidates(self) -> Self:
        numbers = [candidate.issue_number for candidate in self.candidates]
        if self.issue_number in numbers or len(set(numbers)) != len(numbers):
            raise ValueError("Duplicate candidates must be distinct from each other and the target")
        return self


class DuplicateFindings(Record):
    markdown: Text = Field(description=(
        "The full Markdown duplicate investigation: bounded searches, candidate links, shared-cause evidence, "
        "material differences, canonical-issue rationale, counterevidence, confidence and inaccessible evidence. "
        "Distinguish no duplicate found in the completed search from an incomplete investigation."
    ))
    report: DuplicateReport


class Adjudication(Record):
    issue_number: int = Field(gt=0)
    report_hash: Text
    validity: Literal["by design", "bug", "needs investigation"]
    duplicate_status: Literal["dupe", "no dupe found", "needs investigation"]
    duplicate_of: int | None
    rationale: Text

    @model_validator(mode="after")
    def validate_duplicate(self) -> Self:
        if self.duplicate_status == "dupe":
            if self.duplicate_of is None or self.duplicate_of < 1 or self.duplicate_of == self.issue_number:
                raise ValueError("A duplicate needs a different positive canonical issue number")
        elif self.duplicate_of is not None:
            raise ValueError("Only a duplicate classification can name a canonical issue")
        return self

    def validate_reports(self, audit: Audit, duplicates: DuplicateReport) -> None:
        if self.issue_number != audit.issue_number or self.issue_number != duplicates.issue_number:
            raise ValueError("Adjudication and investigations must refer to the same issue")
        if self.validity == "by design" and not (audit.closure_candidate() and audit.observed_product()):
            raise ValueError("By-design classification needs every claim to pass the observed high-confidence design gate")
        if self.validity == "bug" and not (
            audit.observed_product()
            and any(claim.disposition == "bug" for claim in audit.claims)
            and all(claim.confidence != "low" and claim.disposition in DESIGN_DISPOSITIONS | {"bug"}
                    for claim in audit.claims)
        ):
            raise ValueError("Bug classification needs observed product evidence and resolved, non-low-confidence claims")
        if self.duplicate_status == "dupe" and not any(
            candidate.issue_number == self.duplicate_of and candidate.relation == "duplicate"
            and candidate.confidence == "high"
            and any(
                evidence.url == f"https://github.com/{REPOSITORY}/issues/{self.duplicate_of}"
                or evidence.url.startswith(f"https://github.com/{REPOSITORY}/issues/{self.duplicate_of}#")
                for evidence in candidate.evidence
            )
            for candidate in duplicates.candidates
        ):
            raise ValueError("Duplicate classification needs a high-confidence, source-linked shared-cause finding")
        if self.duplicate_status == "no dupe found" and not (
            duplicates.search_complete and duplicates.searches
            and all(candidate.relation in {"related", "not_duplicate"} for candidate in duplicates.candidates)
        ):
            raise ValueError("No-dupe classification requires a completed bounded search without unresolved candidates")

    def tags(self) -> str:
        duplicate = f"dupe of #{self.duplicate_of}" if self.duplicate_status == "dupe" else self.duplicate_status
        return f"{self.validity} | {duplicate}"


class DraftCheck(Record):
    approved: bool
    problems: list[str]

    @model_validator(mode="after")
    def validate_verdict(self) -> Self:
        if self.approved == bool(self.problems):
            raise ValueError("Approval must agree with the factual problems list")
        return self


class Label(BaseModel):
    name: str


class Issue(BaseModel):
    model_config = ConfigDict(extra="ignore")
    number: int
    title: str
    body: str | None = None
    html_url: str
    state: Literal["open", "closed"]
    state_reason: str | None = None
    updated_at: str
    created_at: str | None = None
    comments: int
    labels: list[Label] = Field(default_factory=list)

    def content_key(self) -> str:
        return self.model_dump_json(exclude={"updated_at", "comments", "state_reason"})


class Closure(Record):
    marker: str
    body: str
    expected_issue: Issue
    discussion_hash: str
    status: Literal["prepared", "comment_posted", "closed", "labeled"] = "prepared"
    comment_id: int | None = None
    comment_url: str | None = None
    reason: Literal["by_design", "duplicate", "fixed", "not_reproducible"] = "by_design"
    duplicate_of: int | None = None
    labels: list[str] = Field(default_factory=list)
    evidence_hash: str | None = None


class Symptom(Record):
    file: Text
    line: int = Field(ge=1)
    severity: Literal["error", "warning", "information"]
    message: Text | None = Field(
        description="Exact wording, or null only for an explicitly approved read-only error rule/location predicate.",
    )
    rule: str | None
    present: bool

    @model_validator(mode="after")
    def bounded_rule_predicate(self) -> Self:
        if self.message is None and (
            self.severity != "error" or re.fullmatch(r"report[A-Z][A-Za-z0-9]*", self.rule or "") is None
        ):
            raise ValueError("A rule/location predicate requires an error and an explicit diagnostic rule")
        return self


class ReproductionClaim(Record):
    id: Text
    report_quote: Text
    surface: Literal["cli", "editor", "lsp", "other"]
    broken: list[Symptom] = Field(min_length=1)
    resolved: list[Symptom] = Field(min_length=1)
    precision: list[Symptom] = Field(
        min_length=1,
        description="Affirmative invariants required on broken and resolved checker targets, not desired repaired types at a broken query. Use justified unaffected original or separate control queries.",
    )
    context_diagnostics: list[Symptom] = Field(
        default_factory=list, max_length=32,
        description="Read-only opt-in only: exact report-grounded historical context diagnostics, not reported symptoms or precision.",
    )

    @model_validator(mode="after")
    def affirmative(self) -> Self:
        if any(item.message is None for item in self.precision):
            raise ValueError("Precision requires exact diagnostic/type wording")
        if any(
            item.message is None or not item.present or item.severity == "information"
            for item in self.context_diagnostics
        ):
            raise ValueError("Context diagnostics require exact affirmative error/warning expectations")
        if not all(item.present for item in self.precision):
            raise ValueError("Precision requires affirmative diagnostic/type observations")
        if not any(item.present for item in [*self.broken, *self.resolved]):
            raise ValueError("The original symptom must be observable without adding type queries")
        return self


class ReproductionScenario(Record):
    summary: Text
    reported_version: str | None
    version_quote: str | None
    files: dict[str, str]
    control_files: dict[str, str] = Field(default_factory=dict)
    configuration: dict[str, JsonValue]
    claims: list[ReproductionClaim] = Field(min_length=1)
    prerequisites: list[str]
    limitations: list[str]

    @model_validator(mode="after")
    def validate_version_evidence(self) -> Self:
        if (self.reported_version is None) != (self.version_quote is None):
            raise ValueError("An explicit reported version requires its exact report quote")
        return self


EXPLORATORY_SETTINGS = {
    "pythonVersion": [f"3.{minor}" for minor in range(8, 16)],
    "typeCheckingMode": ["basic", "standard", "strict"],
}


class ConfigurationAssumption(Record):
    setting: Literal["pythonVersion", "typeCheckingMode"]
    value: Text
    reason: Text

    @model_validator(mode="after")
    def bounded(self) -> Self:
        if self.value not in EXPLORATORY_SETTINGS[self.setting]:
            raise ValueError("Exploratory setting is outside the controller's bounded choices")
        return self


class ReportedConfigurationSetting(Record):
    setting: Literal["pythonVersion", "typeCheckingMode"]
    value: Text
    report_quote: Text


class ExploratoryReproductionScenario(ReproductionScenario):
    configuration_assumptions: list[ConfigurationAssumption]
    reported_configuration: list[ReportedConfigurationSetting]

    @model_validator(mode="after")
    def disclosed_settings(self) -> Self:
        settings = [*self.configuration_assumptions, *self.reported_configuration]
        keys = [item.setting for item in settings]
        if len(keys) != len(set(keys)):
            raise ValueError("Chosen and reported settings must have unique, non-overlapping disclosures")
        if set(keys) != set(EXPLORATORY_SETTINGS).intersection(self.configuration):
            raise ValueError("Every effective Python/checking setting needs a reported quote or assumption")
        if any(self.configuration.get(item.setting) != item.value for item in settings):
            raise ValueError("Every disclosed setting must match the frozen configuration")
        return self


class ReproductionTarget(Record):
    role: Literal["historical", "main", "latest"]
    identity: Text
    version: Text
    source: Text
    selection_reason: Text
    approximate: bool = False
    published_at: str | None = None
    integrity: str | None = None
    registry: str = "https://registry.npmjs.org"
    artifact_sha512: str | None = None
    directory: str | None = None
    cli: str | None = None
    tree_hash: str | None = None
    status: Literal["selected", "ready", "blocked"] = "selected"
    error: str | None = None


class ReproductionGate(DraftCheck):
    claim_ids: list[str]
    receipt_hashes: dict[str, str]


class ResponseMapEntry(Record):
    key: str
    value: str


class ReproductionScenarioTransport(Record):
    summary: Text
    reported_version: str | None
    version_quote: str | None
    files: list[ResponseMapEntry] = Field(description="Entries map relative file paths to exact original source text.")
    control_files: list[ResponseMapEntry] = Field(description="Entries map relative file paths to exact separate control source text.")
    configuration: list[ResponseMapEntry] = Field(
        description='Entries map setting names to JSON-encoded values; for example {"key":"pythonVersion","value":"\\"3.13\\""} or {"key":"reportUnknownVariableType","value":"true"}.'
    )
    claims: list[ReproductionClaim] = Field(min_length=1)
    prerequisites: list[str]
    limitations: list[str]


class ReproductionGateTransport(DraftCheck):
    claim_ids: list[str]
    receipt_hashes: list[ResponseMapEntry] = Field(description="Entries map exact receipt IDs to their exact digest strings.")


class ExploratoryReproductionScenarioTransport(ReproductionScenarioTransport):
    configuration_assumptions: list[ConfigurationAssumption]
    reported_configuration: list[ReportedConfigurationSetting]


class ReproductionStage(Record):
    input_hash: Text
    discussion_hash: Text
    directory: Text
    status: Literal["running", "complete", "blocked", "failed"] = "running"
    scenario: ReproductionScenario | ExploratoryReproductionScenario | None = None
    exploratory: bool = Field(default=False, frozen=True)
    policy_hash: str | None = None
    targets: list[ReproductionTarget] = Field(default_factory=list)
    receipt_ids: list[str] = Field(default_factory=list)
    outcomes: dict[str, Literal["reproduced", "not_reproduced", "blocked"]] = Field(default_factory=dict)
    gate: ReproductionGate | None = None
    evidence_hash: str | None = None
    error: str | None = None
    proposed_labels: list[str] = Field(default_factory=list)
    comment_hash: str | None = None

    def observation_only(self) -> bool:
        return self.exploratory or isinstance(self.scenario, ExploratoryReproductionScenario)

    def action(self) -> Literal["fixed", "not_reproducible"] | None:
        if self.observation_only():
            return None
        if self.status != "complete" or self.gate is None or not self.gate.approved:
            return None
        if self.outcomes.get("main") != "not_reproduced":
            return None
        if self.outcomes.get("historical") == "reproduced":
            return "fixed"
        if self.outcomes.get("historical") == "not_reproduced":
            return "not_reproducible"
        return None


class ReproductionPlan(Record):
    surface: Literal["cli", "editor", "lsp", "research", "other"]
    runner: Literal["cli", "editor_interpreter", "none"]
    target: Text
    reason: Text
    prerequisites: list[str]
    setup: list[Text]
    failure_signal: Text
    controls: list[Text]

    @model_validator(mode="after")
    def validate_surface(self) -> Self:
        if self.runner == "cli" and self.surface != "cli":
            raise ValueError("A CLI run cannot reproduce another product surface")
        if self.runner == "editor_interpreter" and self.surface != "editor":
            raise ValueError("The interpreter-handoff runner requires the editor surface")
        if self.surface == "research" and self.runner != "none":
            raise ValueError("Normative research does not need gratuitous product execution")
        return self


class BlockedChallenge(Record):
    retry: bool
    reason: Text
    alternative: ReproductionPlan | None
    missing_prerequisites: list[str]

    @model_validator(mode="after")
    def validate_retry(self) -> Self:
        if self.retry != (self.alternative is not None):
            raise ValueError("A retry requires exactly one concrete alternative plan")
        if self.retry and self.missing_prerequisites:
            raise ValueError("A retry cannot silently waive missing prerequisites")
        return self


class RootCauseFindings(Record):
    issue_number: int = Field(gt=0)
    status: Literal["found", "inconclusive", "blocked"]
    kind: Literal["implementation", "specification", "environment", "duplicate", "unknown"]
    markdown: Text
    cause: Text
    location: str | None
    evidence_ids: list[str]
    alternatives: list[str]
    limitations: list[str]

    @model_validator(mode="after")
    def validate_cause(self) -> Self:
        if self.status == "found" and (not self.evidence_ids or self.kind == "unknown"):
            raise ValueError("A found cause requires actual evidence and an identified cause kind")
        if self.status == "found" and self.kind == "implementation" and not self.location:
            raise ValueError("An implementation cause must identify the producer location")
        return self


class RootCauseGate(Record):
    accepted: bool = Field(
        description="Whether PRIMARY investigator evidence warrants the next independent challenge. "
        "This is a pre-adversary decision, not final RCA acceptance or publication approval.",
    )
    reason: Text
    evidence_ids: list[str]
    missing_evidence: list[str] = Field(
        description="Missing PRIMARY-stage evidence only. The independent adversary has not run yet; "
        "its future countercheck is not a prerequisite for accepting this primary packet.",
    )

    @model_validator(mode="after")
    def validate_gate(self) -> Self:
        if self.accepted and (self.missing_evidence or not self.evidence_ids):
            raise ValueError("A passing gate needs observed evidence and no outstanding required evidence")
        return self


class RootCauseChallenge(Record):
    verdict: Literal["survived", "refuted", "uncertain"]
    markdown: Text
    explanation: Text
    evidence_ids: list[str] = Field(
        description="Controller IDs from this adversary's successful counterchecks and source reads. "
        "A survived implementation/integration claim must cite an actual executed product countercheck; "
        "an authoritative source alone is insufficient."
    )


class RootCausePublication(Record):
    marker: Text
    body: Text
    expected_issue: Issue
    discussion_hash: Text
    evidence_hash: Text
    status: Literal["prepared", "posted"] = "prepared"
    comment_id: int | None = None
    comment_url: str | None = None


class RootCause(Record):
    input_hash: Text
    directory: Text
    status: Literal["running", "found", "inconclusive", "blocked", "failed"] = "running"
    checkpoint_version: Literal[1] | None = None
    stage: Literal["planning", "investigation", "blocked_challenge", "gate", "challenge", "complete"] = "planning"
    findings: RootCauseFindings | None = None
    plan: ReproductionPlan | None = None
    blocked_challenge: BlockedChallenge | None = None
    prior_findings: list[RootCauseFindings] = Field(default_factory=list)
    prior_plans: list[ReproductionPlan] = Field(default_factory=list)
    gate: RootCauseGate | None = None
    challenge: RootCauseChallenge | None = None
    markdown: str | None = None
    evidence_hash: str | None = None
    comment: str | None = None
    draft_check: DraftCheck | None = None
    post_decision: Literal["pending", "declined", "posted"] = "pending"
    publication: RootCausePublication | None = None
    error: str | None = None

    def publishable(self) -> bool:
        return (
            self.status == "found" and self.findings is not None and self.findings.status == "found"
            and self.gate is not None and self.gate.accepted
            and self.challenge is not None and self.challenge.verdict == "survived"
            and self.markdown is not None and self.evidence_hash is not None
        )


class Entry(Record):
    input_hash: str
    context_hash: str
    issue: Issue
    review: Audit | None = None
    duplicates: DuplicateReport | None = None
    review_markdown: str | None = None
    duplicates_markdown: str | None = None
    adjudication: Adjudication | None = None
    canonical_issue: Issue | None = None
    comment: str | None = None
    draft_check: DraftCheck | None = None
    closure: Closure | None = None
    decision: Literal["pending", "reviewed", "keep", "closed", "failed"] = "pending"
    error: str | None = None
    elapsed_seconds: float | None = None
    scratch_directory: str | None = None
    rca_opt_in: Literal["not_asked", "declined", "accepted"] = "not_asked"
    root_cause: RootCause | None = None
    reproduction_stage: ReproductionStage | None = None

    def unresolved(self) -> bool:
        return self.adjudication is not None and self.closure_reason() is None

    def closure_reason(self) -> Literal["by_design", "duplicate"] | None:
        if self.reproduction_stage is not None and self.reproduction_stage.observation_only():
            return None
        if self.review is None or self.duplicates is None or self.adjudication is None:
            return None
        self.adjudication.validate_reports(self.review, self.duplicates)
        if "needs investigation" in {self.adjudication.validity, self.adjudication.duplicate_status}:
            return None
        if self.adjudication.duplicate_status == "dupe":
            return "duplicate"
        return "by_design" if self.adjudication.validity == "by design" else None
