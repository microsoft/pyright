# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

"""Version-one read-only assessment records, separate from publication/reproduction checkpoints."""

from typing import Annotated, Literal, Self

from pydantic import Field, JsonValue, model_validator

from issue_review_models import (
    ConfigurationAssumption, Issue, Record, ReproductionClaim, ReproductionScenario, ReproductionTarget, Text,
)
from issue_review_sources import Digest, SettingChoice, SetupCapability, SourceAssociation

Readiness = Literal["ready", "partial", "blocked"]
ClaimId = Annotated[str, Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")]


class DeclaredClaim(Record):
    id: ClaimId
    summary: Text


class AssessmentSetupSelection(Record):
    setup_hash: Digest
    associations: list[SourceAssociation] = Field(min_length=1, max_length=30)
    setting_choices: list[SettingChoice] = Field(max_length=2)


class AssessmentSetupEvidence(Record):
    schema_version: Literal[1] = 1
    capture_hash: Digest
    targets_hash: Digest
    capabilities: list[SetupCapability] = Field(max_length=64)
    selections: list[AssessmentSetupSelection] = Field(default_factory=list, max_length=16)


class AssessmentInput(Record):
    """Controller snapshot, never an SDK response or a store of expected answers."""

    schema_version: Literal[1] = 1
    report_id: Text
    origin: Literal["synthetic_contract", "retained_report", "captured_report"]
    provenance: Text
    issue: Issue
    comments: list[dict[str, JsonValue]]
    declared_claims: list[DeclaredClaim] = Field(min_length=1, max_length=16)
    setting_choices: list[SettingChoice] = Field(max_length=2)
    limitations: list[Text]
    expected_original_hashes: dict[str, str] = Field(default_factory=dict, max_length=30)
    blind: bool = False
    target_selection_provenance: Text
    frozen_targets_hash: str | None = None
    normative_evidence_hash: str | None = None

    @model_validator(mode="after")
    def unique_scope(self) -> Self:
        if len({claim.id for claim in self.declared_claims}) != len(self.declared_claims):
            raise ValueError("Declared material scope IDs must be unique")
        if len({choice.setting for choice in self.setting_choices}) != len(self.setting_choices):
            raise ValueError("Controller setting choices must be unique")
        if self.origin == "synthetic_contract" and (
            self.issue.number != 0 or self.issue.created_at is not None
            or self.issue.html_url.startswith("https://github.com/")
        ):
            raise ValueError("Synthetic input must use fixture identity without an invented issue creation date")
        return self


class SourceReference(Record):
    source_id: Text
    path: Text = Field(description="Safe relative Python/stub path ending in .py or .pyi, never pyrightconfig.json.")
    filename_quote: str | None = Field(
        default=None,
        description="Copy this source's captured filename_evidence.quote exactly, or null when absent. Not a CLI command or an inferred path.",
    )


class ControlSource(Record):
    path: Text
    content: Text


class ClaimLocation(Record):
    source_id: Text
    start_line: int = Field(ge=1)
    end_line: int = Field(ge=1)

    @model_validator(mode="after")
    def ordered(self) -> Self:
        if self.end_line < self.start_line:
            raise ValueError("Claim source locations must be ordered")
        return self


class ReportedSymptom(Record):
    source_id: Text
    line: int = Field(ge=1)
    message: Text
    rule: Text | None


class DiscoveryScope(Record):
    question: Text
    locations: list[ClaimLocation] = Field(min_length=1)
    symptom_kind: Literal["diagnostic", "revealed_type"]
    failure_direction: Literal["unexpected_presence", "unexpected_absence"]
    reported_message: Text | None = Field(
        description="Exact reported message or exact controller-derived CLI candidate; preserve whitespace. Null if unknown.",
    )
    reported_rule: Text | None
    reported_symptoms: list[ReportedSymptom] = Field(
        default_factory=list, max_length=64,
        description="Exact pre-discovery wording for distinct reported diagnostics at their source locations. Never predicted or discovery-derived.",
    )

    @model_validator(mode="after")
    def scoped_symptoms(self) -> Self:
        keys = [(item.source_id, item.line, item.message, item.rule) for item in self.reported_symptoms]
        if len(set(keys)) != len(keys):
            raise ValueError("Repeated scoped reported symptom")
        for item in self.reported_symptoms:
            if not any(
                location.source_id == item.source_id and location.start_line <= item.line <= location.end_line
                for location in self.locations
            ):
                raise ValueError("Reported symptoms must lie within frozen discovery locations")
            if (
                self.reported_message is not None and item.message != self.reported_message
                or self.reported_rule is not None and item.rule is not None and item.rule != self.reported_rule
            ):
                raise ValueError("Scoped reported symptoms contradict the frozen common wording/rule")
        return self


class AssessmentClaimDraft(Record):
    id: ClaimId
    summary: Text
    report_quote: Text
    surface: Literal["cli", "editor", "lsp", "other"] = Field(
        description="Static diagnostics/revealed types use cli; editor/LSP/runtime-only concerns are not CLI proxies.",
    )
    source_ids: list[Text] = Field(description="Only Python/stub IDs present in sources, not captured JSON configuration IDs.")
    readiness: Readiness
    reasons: list[Text]
    verification: ReproductionClaim | None
    discovery: DiscoveryScope | None
    control_files: list[ControlSource]

    @model_validator(mode="after")
    def honest_readiness(self) -> Self:
        if len(set(self.source_ids)) != len(self.source_ids):
            raise ValueError("Claim source IDs must be unique")
        if self.readiness == "ready":
            if self.verification is None or self.reasons or self.discovery is not None:
                raise ValueError("Ready claims require exact verification predicates, not unresolved reasons/discovery")
            if (
                self.verification.id != self.id or self.verification.report_quote != self.report_quote
                or self.verification.surface != self.surface or self.surface != "cli" or not self.source_ids
            ):
                raise ValueError("Executable claim identity, scope and supported surface must agree")
        elif self.verification is not None or self.control_files or not self.reasons:
            raise ValueError("Unknown/blocked claims need honest reasons and no executable predicates/controls")
        if self.discovery is not None:
            if self.readiness != "partial" or self.surface != "cli" or not self.source_ids:
                raise ValueError("Only partial CLI claims with captured originals may request historical discovery")
            if any(location.source_id not in self.source_ids for location in self.discovery.locations):
                raise ValueError("Discovery locations must belong to the preserved claim source scope")
        return self


class AssessmentDraft(Record):
    schema_version: Literal[1]
    summary: Text
    reported_version: str | None
    version_quote: str | None
    sources: list[SourceReference] = Field(max_length=30)
    setting_choices: list[ConfigurationAssumption]
    claims: list[AssessmentClaimDraft] = Field(min_length=1, max_length=16)
    limitations: list[Text]

    @model_validator(mode="after")
    def identities(self) -> Self:
        if (self.reported_version is None) != (self.version_quote is None):
            raise ValueError("Explicit checker versions require exact report evidence")
        for values, label in (
            ([claim.id for claim in self.claims], "claim IDs"),
            ([source.source_id for source in self.sources], "source associations"),
            ([choice.setting for choice in self.setting_choices], "setting choices"),
        ):
            if len(values) != len(set(values)):
                raise ValueError(f"Assessment {label} must be unique")
        associated = {source.source_id for source in self.sources}
        if any(not set(claim.source_ids) <= associated for claim in self.claims):
            raise ValueError("Claims may reference only associated controller-captured source IDs")
        return self


class VerificationRefinement(Record):
    schema_version: Literal[1]
    claim_id: ClaimId
    discovery_id: Text
    readiness: Literal["ready", "blocked"]
    verification: ReproductionClaim | None = Field(
        description="Proposed frozen predicates, not executed observations. Ready means the controller can now verify them independently.",
    )
    control_files: list[ControlSource] = Field(
        description="Proposed complete separate precision tree with unchanged paths/configuration. No prior control execution is required; originals remain untouched.",
    )
    reasons: list[Text]
    explanation: Text

    @model_validator(mode="after")
    def same_claim(self) -> Self:
        if self.readiness == "ready" and (self.verification is None or self.reasons):
            raise ValueError("Ready refinements require strict predicates and no unresolved reasons")
        if self.readiness == "blocked" and (self.verification is not None or self.control_files or not self.reasons):
            raise ValueError("Unresolved discovery must remain honest without invented verification fields")
        if self.verification is not None and self.claim_id != self.verification.id:
            raise ValueError("Discovery refinement must retain the original claim identity")
        return self


class AssessmentPolicy(Record):
    schema_version: Literal[1] = 1
    mode: Literal["read_only_assessment"] = Field(default="read_only_assessment", frozen=True)
    read_only: Literal[True] = Field(default=True, frozen=True)
    input_hash: Text
    implementation_hash: Text
    profile_hash: Text
    model: Text
    role_budget_seconds: Literal[180] = 180
    allow_assumed_settings: bool = False
    setup_capabilities_hash: Text = "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
    setup_selections_hash: Text = "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
    assessment_input_hash: str | None = None


class ClaimAssessment(Record):
    id: ClaimId
    summary: Text
    report_quote: Text
    surface: Literal["cli", "editor", "lsp", "other"]
    source_ids: list[Text]
    readiness: Readiness
    reasons: list[Text]
    verification: ReproductionClaim | None = None
    discovery: DiscoveryScope | None = None
    scenario: ReproductionScenario | None = None

    @model_validator(mode="after")
    def executable_fields(self) -> Self:
        if self.readiness == "ready":
            if self.verification is None or self.scenario is None or self.reasons or self.discovery is not None:
                raise ValueError("Ready assessment claims require an independently checked frozen scenario")
            if self.scenario.claims != [self.verification]:
                raise ValueError("Per-claim scenarios must retain the exact verified claim")
        elif self.verification is not None or self.scenario is not None or not self.reasons:
            raise ValueError("Incomplete claims cannot masquerade as executable verification")
        if self.readiness == "blocked" and self.discovery is not None:
            raise ValueError("Blocked claims cannot execute discovery")
        return self


class AssessmentPlan(Record):
    schema_version: Literal[1] = 1
    policy_hash: Text
    input_hash: Text
    source_hash: Text
    setup_hash: Text
    draft_hash: Text
    claims: list[ClaimAssessment] = Field(min_length=1)
    limitations: list[Text]
    assumptions: list[Text]
    capabilities: list[SetupCapability] = Field(default_factory=list, max_length=64)
    setup_selections: list[AssessmentSetupSelection] = Field(default_factory=list, max_length=16)

    @property
    def readiness(self) -> Readiness:
        if all(claim.readiness == "ready" for claim in self.claims):
            return "ready"
        if any(claim.readiness == "ready" or claim.discovery is not None for claim in self.claims):
            return "partial"
        return "blocked"

    def action(self) -> None:
        return None


class DiscoveryPlan(Record):
    schema_version: Literal[1] = 1
    kind: Literal["historical_discovery"] = "historical_discovery"
    policy_hash: Text
    assessment_hash: Text
    source_hash: Text
    setup_hash: Text
    claim_id: ClaimId
    report_quote: Text
    scope: DiscoveryScope
    inputs: dict[str, str]
    historical_target: ReproductionTarget

    @model_validator(mode="after")
    def historical_only(self) -> Self:
        if self.historical_target.role != "historical":
            raise ValueError("Discovery must not see a main/latest target")
        return self


class VerificationPlan(Record):
    schema_version: Literal[1] = 1
    kind: Literal["frozen_verification"] = "frozen_verification"
    policy_hash: Text
    assessment_hash: Text
    source_hash: Text
    setup_hash: Text
    claim_id: ClaimId
    discovery_id: str | None
    discovery_hash: str | None
    scenario: ReproductionScenario
    targets: list[ReproductionTarget] = Field(min_length=1)

    @model_validator(mode="after")
    def separate_evidence(self) -> Self:
        if (self.discovery_id is None) != (self.discovery_hash is None):
            raise ValueError("Discovery-derived verification must bind both receipt ID and hash")
        if len(self.scenario.claims) != 1 or self.scenario.claims[0].id != self.claim_id:
            raise ValueError("Frozen verification must identify exactly one unchanged claim scope")
        roles = [target.role for target in self.targets]
        if len(set(roles)) != len(roles) or set(roles) != {"historical", "main", "latest"}:
            raise ValueError("Verification freezes exact historical/main/latest assignments")
        return self


class AssessmentReceipt(Record):
    schema_version: Literal[1] = 1
    id: Text
    kind: Literal["discovery", "verification_original", "verification_control"]
    policy_hash: Text
    plan_hash: Text
    claim_id: ClaimId
    raw: dict[str, JsonValue]
    problems: list[Text]
    observation: Literal["captured", "reproduced", "not_reproduced", "verified", "blocked"]

    @model_validator(mode="after")
    def discovery_is_not_verification(self) -> Self:
        if self.kind == "discovery" and self.observation not in {"captured", "blocked"}:
            raise ValueError("Discovery is never reproduction/fixed/not-reproducible evidence")
        return self


class ClaimProgress(Record):
    claim_id: ClaimId
    phase: Literal["unobserved", "discovery", "verification"]
    status: Literal["unobserved", "captured", "complete", "partial", "blocked"]
    receipt_ids: list[Text]
    target_observations: dict[str, Literal["reproduced", "not_reproduced", "blocked", "unobserved"]]
    reasons: list[Text]


class AssessmentRun(Record):
    schema_version: Literal[1] = 1
    policy: AssessmentPolicy
    plan: AssessmentPlan
    progress: list[ClaimProgress]
    validity: JsonValue | None = None
    failures: list[Text] = Field(default_factory=list)

    def action(self) -> None:
        return None

    def require_action(self) -> None:
        raise ValueError("Version-one assessment is permanently read-only; drafting/publication/resume is forbidden")
