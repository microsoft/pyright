# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

"""Controller-owned, permanently read-only readiness, historical discovery and fresh verification."""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
import uuid
from collections.abc import Awaitable, Callable, Collection, Sequence
from pathlib import Path
from typing import Literal

from pydantic import JsonValue

from issue_review_assessment_models import (
    AssessmentClaimDraft, AssessmentDraft, AssessmentInput, AssessmentPlan, AssessmentPolicy, AssessmentReceipt, AssessmentRun,
    AssessmentSetupSelection, ClaimAssessment, ClaimProgress, DiscoveryPlan, VerificationPlan, VerificationRefinement,
)
from issue_review_models import Issue, ReproductionScenario, ReproductionTarget
from issue_review_reproduction import (
    PredicateConflict, TargetStore, classify, fingerprint, observe_claims, relative_path, run_target_io, scenario_inputs,
    static_stub_source_warning, tree_hash,
)
from issue_review_sources import (
    MaterializedSetup, ReportDocument, SettingChoice, SetupCapability, SourceAssociation, SourceCapture,
    capture_sources, inspect_requirements, materialize_setup, reported_diagnostics, resolve_setup, verify_capture,
    reported_setting_qualifications, verify_materialized_setup,
)

Screen = Callable[[JsonValue, Path, str], Awaitable[None]]


def report_text(issue: Issue, comments: Sequence[dict[str, JsonValue]]) -> str:
    return issue.title + "\n" + (issue.body or "") + "\n" + "\n".join(
        str(comment["body"]) for comment in comments if isinstance(comment.get("body"), str)
    )


def capture_report(
    issue: Issue, comments: Sequence[dict[str, JsonValue]], *, report_id: str | None = None,
) -> SourceCapture:
    documents = [ReportDocument(
        id=f"issue:{issue.number}", kind="issue_body", provenance=issue.html_url,
        revision=issue.updated_at, text=issue.body or "",
    )]
    for comment in comments:
        body = comment.get("body")
        if not isinstance(comment.get("id"), (str, int)) or not isinstance(body, str):
            raise ValueError("Captured comments require exact IDs and body text, not summaries")
        documents.append(ReportDocument(
            id=f"comment:{comment['id']}", kind="comment",
            provenance=str(comment.get("html_url") or issue.html_url + "#issuecomment-" + str(comment["id"])),
            revision=str(comment.get("updated_at") or comment.get("created_at") or issue.updated_at),
            text=body,
        ))
    return capture_sources(report_id or str(issue.number), documents)


def associations(draft: AssessmentDraft) -> list[SourceAssociation]:
    return [SourceAssociation(source_id=source.source_id, path=source.path, filename_quote=source.filename_quote)
            for source in draft.sources]


def choices(draft: AssessmentDraft) -> list[SettingChoice]:
    return [SettingChoice(setting=choice.setting, value=choice.value, reason=choice.reason)
            for choice in draft.setting_choices]


def validate_setup_selections(
    selections: Sequence[AssessmentSetupSelection], capture: SourceCapture,
    capabilities: Sequence[SetupCapability],
) -> None:
    if len(selections) > 16 or len({item.setup_hash for item in selections}) != len(selections):
        raise ValueError("Approved setup selections must be bounded and unique")
    known: dict[str, SourceAssociation] = {}
    covered: set[str] = set()
    for selection in selections:
        prepared = materialize_setup(
            capture, selection.associations, selection.setting_choices, reported_settings=selection.reported_settings,
        )
        if prepared.digest != selection.setup_hash:
            raise ValueError("Approved setup selection differs from its exact source/layout/settings/assumptions")
        original_inputs(prepared)
        for association in selection.associations:
            if association.source_id in known and known[association.source_id] != association:
                raise ValueError("Approved setup selections have conflicting source associations")
            known[association.source_id] = association
        requirements = inspect_requirements(capture, prepared)
        required = {fingerprint(item.model_dump(mode="json")) for item in requirements}
        matching = [item for item in capabilities if item.requirement_hash in required]
        resolution = resolve_setup(requirements, matching)
        if resolution.status != "ready":
            raise ValueError("Approved setup selection lacks exact capability evidence: " + "; ".join(resolution.blockers))
        covered.update(required)
    if selections and any(item.requirement_hash not in covered for item in capabilities):
        raise ValueError("Approved capability does not belong to any supplied setup selection")


def controls(claim: AssessmentClaimDraft | VerificationRefinement) -> dict[str, str]:
    result = {}
    for item in claim.control_files:
        if item.path in result:
            raise ValueError("Duplicate control file path")
        result[item.path] = item.content
    return result


def original_inputs(prepared: MaterializedSetup) -> dict[str, str]:
    if prepared.blockers:
        raise ValueError("Unresolved source/setup: " + "; ".join(prepared.blockers))
    files = prepared.files
    paths = [relative_path(name) for name in files]
    if (
        not 1 <= len(paths) <= 30 or not any(path.suffix == ".py" for path in paths)
        or any(path.suffix not in {".py", ".pyi"} for path in paths)
        or len({str(path).casefold() for path in paths}) != len(paths)
        or any(len(content.encode("utf-8")) > 65536 for content in files.values())
    ):
        raise ValueError("Assessment needs 1-30 bounded, non-aliasing captured Python/stub files")
    config = dict(prepared.configuration)
    allowed = {"pythonVersion", "pythonPlatform", "typeCheckingMode", "enableExperimentalFeatures"}
    if any(key not in allowed and not key.startswith("report") for key in config):
        raise ValueError("Assessment cannot change paths/imports/plugins or analysis scope")
    if config.get("typeCheckingMode") not in {"basic", "standard", "strict"} or not re.fullmatch(
        r"3\.\d+", str(config.get("pythonVersion", "")),
    ):
        raise ValueError("Applicable explicit effective Python/checking settings are required")
    config["include"] = [str(relative_path(name)) for name in sorted(files) if name.endswith(".py")]
    return {**files, "pyrightconfig.json": json.dumps(config, sort_keys=True, indent=2) + "\n"}


def strict_scenario(
    draft: AssessmentDraft, claim: AssessmentClaimDraft, prepared: MaterializedSetup,
) -> ReproductionScenario:
    if claim.verification is None:
        raise ValueError("Unknown claims do not have verification predicates")
    scenario = ReproductionScenario(
        summary=claim.summary, reported_version=draft.reported_version, version_quote=draft.version_quote,
        files=dict(prepared.files), control_files=controls(claim), configuration=dict(prepared.configuration),
        claims=[claim.verification], prerequisites=[], limitations=list(draft.limitations),
    )
    scenario_inputs(scenario)
    return scenario


def build_plan(
    policy: AssessmentPolicy, draft: AssessmentDraft, capture: SourceCapture,
    prepared: MaterializedSetup, report: str,
    *, claim_blockers: dict[str, list[str]] | None = None,
    capabilities: Sequence[SetupCapability] = (),
    setup_selections: Sequence[AssessmentSetupSelection] = (),
    assessment_input: AssessmentInput | None = None,
) -> AssessmentPlan:
    verify_capture(capture)
    verify_materialized_setup(capture, associations(draft), choices(draft), prepared)
    if draft.setting_choices and not policy.allow_assumed_settings:
        raise ValueError("This controller policy does not permit assumed settings")
    if policy.setup_capabilities_hash != fingerprint([item.model_dump(mode="json") for item in capabilities]):
        raise ValueError("Controller setup capabilities differ from the frozen readiness policy")
    if policy.setup_selections_hash != fingerprint([item.model_dump(mode="json") for item in setup_selections]):
        raise ValueError("Controller setup selections differ from the frozen readiness policy")
    validate_setup_selections(setup_selections, capture, capabilities)
    chosen = {item.source_id: item for item in associations(draft)}
    for selection in setup_selections:
        if {item.setting: item for item in selection.setting_choices} != {
            item.setting: item for item in choices(draft)
        }:
            raise ValueError("Use the exact controller-approved setup setting choices, including assumption provenance")
        for association in selection.associations:
            if association.source_id in chosen and chosen[association.source_id] != association:
                raise ValueError("Use the exact controller-approved source association; do not rename or relabel it")
    if assessment_input is not None:
        if policy.assessment_input_hash != fingerprint(assessment_input.model_dump(mode="json")):
            raise ValueError("Frozen assessment input identity changed")
        declared = {claim.id: claim.summary for claim in assessment_input.declared_claims}
        actual = {claim.id: claim.summary for claim in draft.claims}
        if not declared.keys() <= actual.keys() or any(actual[key] != value for key, value in declared.items()):
            raise ValueError("Every declared scope needs its exact original ID/summary; new material claims must be added separately")
        if {choice.setting: choice for choice in choices(draft)} != {
            choice.setting: choice for choice in assessment_input.setting_choices
        }:
            raise ValueError("Frozen controller setting choices cannot be changed or relabeled")
        if assessment_input.expected_original_hashes and any(
            assessment_input.expected_original_hashes.get(path) != hashlib.sha256(content.encode("utf-8")).hexdigest()
            for path, content in prepared.files.items()
        ):
            raise ValueError("Captured source content/filename association differs from the frozen original manifest")
    if draft.version_quote is not None and (
        draft.version_quote not in report or draft.reported_version is None
        or draft.reported_version not in draft.version_quote and not any(
            item.setting == "pyrightVersion" and item.supported and item.value == draft.reported_version
            and item.evidence.quote == draft.version_quote for item in capture.declarations
        )
    ):
        raise ValueError("Reported checker version requires a contiguous exact report quote")
    reported_versions = {
        declaration.value for declaration in capture.declarations
        if declaration.setting == "pyrightVersion" and declaration.supported and isinstance(declaration.value, str)
    }
    if len(reported_versions) == 1 and draft.reported_version != next(iter(reported_versions)):
        raise ValueError("Use the controller-captured explicit Pyright version, not a date-based or invented substitute")
    source_by_id = {source.id: source for source in capture.blocks}
    if len(capabilities) > 64 or len({item.requirement_hash for item in capabilities}) != len(capabilities):
        raise ValueError("Controller setup capabilities must be bounded and unique")
    diagnostics = reported_diagnostics(capture)

    def reported_message(value: str | None) -> bool:
        if value is None:
            return True
        if any(value == item.message for item in diagnostics):
            return True
        if any(value == item.rendered_message and value != item.message for item in diagnostics):
            raise ValueError(
                "Reported message contains CLI presentation indentation; copy the exact controller-provided "
                "diagnostic candidate message, retaining its quoted provenance, not a manually normalized variant"
            )
        return value in report

    results = []
    scope_limitations = []
    for claim in draft.claims:
        if claim.report_quote not in report:
            raise ValueError("Every claim needs one exact contiguous report/discussion quote")
        if any(source_id not in source_by_id for source_id in claim.source_ids):
            raise ValueError("Claim references an unavailable controller-captured source")
        selected = materialize_setup(
            capture, [item for item in associations(draft) if item.source_id in claim.source_ids], choices(draft),
            reported_settings=claim.reported_settings,
        )
        scope_limitations.extend(
            f"Claim {claim.id}: {qualification}" for qualification in reported_setting_qualifications(selected)
        )
        approved = [
            item for item in setup_selections
            if {association.source_id for association in item.associations} == set(claim.source_ids)
        ]
        if approved and not any(item.reported_settings == claim.reported_settings for item in approved):
            raise ValueError("Use the exact controller-approved reported setting selections, including context/provenance")
        reasons = list(selected.blockers) + list((claim_blockers or {}).get(claim.id, []))
        if selected.files:
            requirements = inspect_requirements(capture, selected)
            required = {fingerprint(item.model_dump(mode="json")) for item in requirements}
            reasons.extend(resolve_setup(requirements, [
                item for item in capabilities if item.requirement_hash in required
            ]).blockers)
        for location in claim.discovery.locations if claim.discovery is not None else []:
            if location.end_line > len(source_by_id[location.source_id].content.splitlines()):
                raise ValueError("Discovery location lies outside the captured pristine source")
        for context in claim.discovery.reported_context if claim.discovery is not None else []:
            if not policy.allow_rule_location_predicates:
                raise ValueError("Reported diagnostic context requires the explicit rule/location policy")
            if (
                context.report_quote not in report
                or context.line > len(source_by_id[context.source_id].content.splitlines())
            ):
                raise ValueError("Diagnostic context requires an exact report quote and captured source location")
        if claim.discovery is not None and (
            not reported_message(claim.discovery.reported_message)
            or claim.discovery.reported_rule is not None and claim.discovery.reported_rule not in report
            or any(
                not reported_message(item.message) or item.rule is not None and item.rule not in report
                for item in claim.discovery.reported_symptoms
            )
        ):
            raise ValueError(
                f"Claim {claim.id}: frozen reported wording/rule must be exact report evidence or an exact "
                "controller-provided CLI diagnostic candidate. Preserve whitespace; otherwise use null, not a guess."
            )
        scenario = None
        if claim.readiness == "ready" and not reasons:
            try:
                if claim.verification is not None and any(
                    not reported_message(symptom.message)
                    for symptom in [*claim.verification.broken, *claim.verification.resolved]
                ):
                    raise ValueError("Exact original diagnostic wording is unavailable; use historical discovery, not guesses")
                if claim.verification is not None and (
                    claim.verification.context_diagnostics
                    or any(item.message is None for item in [*claim.verification.broken, *claim.verification.resolved])
                ):
                    raise ValueError("Rule/location predicates require opted-in historical discovery/refinement")
                scenario = strict_scenario(draft, claim, selected)
                original_inputs(selected)
            except PredicateConflict:
                raise
            except ValueError as error:
                reasons.append(str(error))
        if claim.surface != "cli":
            reasons.append(f"Unsupported {claim.surface} surface; no CLI proxy")
        if not claim.source_ids:
            reasons.append("Original source is unavailable for this claim")
        if reasons:
            readiness: Literal["ready", "partial", "blocked"] = "blocked"
        else:
            readiness = claim.readiness
        results.append(ClaimAssessment(
            id=claim.id, summary=claim.summary, report_quote=claim.report_quote, surface=claim.surface,
            source_ids=claim.source_ids, readiness=readiness,
            reported_settings=claim.reported_settings,
            reasons=list(dict.fromkeys(reasons or claim.reasons)),
            verification=claim.verification if readiness == "ready" else None,
            scenario=scenario if readiness == "ready" else None,
            discovery=claim.discovery if readiness == "partial" else None,
        ))
    return AssessmentPlan(
        policy_hash=fingerprint(policy.model_dump()), input_hash=policy.input_hash,
        source_hash=capture.digest, setup_hash=prepared.digest, draft_hash=fingerprint(draft.model_dump()),
        claims=results, limitations=list(dict.fromkeys([
            *draft.limitations, *(limitation.detail for limitation in prepared.limitations),
            *([] if assessment_input is None else assessment_input.limitations),
            *(f"Controller-inferred filename, not a reporter fact: {path}" for path in prepared.inferred_paths),
            *scope_limitations,
        ])),
        assumptions=[f"{choice.setting}={choice.value}: {choice.reason}" for choice in draft.setting_choices],
        capabilities=list(capabilities),
        setup_selections=list(setup_selections),
    )


def validate_discovery_output(
    record: dict[str, JsonValue], target: ReproductionTarget, files: dict[str, str],
    *, static_stub_modules: Collection[str] = (),
) -> list[str]:
    problems = []
    if record.get("error") or record.get("exit_code") not in (0, 1):
        problems.append("Historical discovery did not complete successfully")
    if not isinstance(record.get("stderr"), str) or str(record["stderr"]).strip():
        problems.append("Historical discovery has unverified stderr/setup diagnostics")
    try:
        output = json.loads(str(record.get("stdout", "")))
        count = output["summary"]["filesAnalyzed"]
        diagnostics = output["generalDiagnostics"]
        if output["version"] != target.version or type(count) is not int or count < sum(
            name.endswith(".py") for name in files
        ) or not isinstance(diagnostics, list):
            problems.append("Historical discovery has wrong version, missing/zero files or invalid JSON")
        elif any(
            not isinstance(item, dict) or not isinstance(item.get("file"), str)
            or not isinstance(item.get("message"), str) or not item["message"]
            or item.get("severity") not in {"error", "warning", "information"}
            or not isinstance(item.get("range"), dict) or not isinstance(item["range"].get("start"), dict)
            or type(item["range"]["start"].get("line")) is not int or item["range"]["start"]["line"] < 0
            for item in diagnostics
        ):
            problems.append("Historical discovery contains malformed or unsupported diagnostic records")
        elif any(
            (
                item.get("rule") in {"reportMissingImports", "reportMissingModuleSource"}
                or "could not be resolved" in str(item.get("message"))
            ) and not static_stub_source_warning(item, str(record.get("cwd", "")), files, files, static_stub_modules)
            for item in diagnostics
        ):
            problems.append("Unresolved imports invalidate historical discovery")
    except (ValueError, TypeError, KeyError, AttributeError) as error:
        problems.append(f"Historical discovery output is unsupported: {type(error).__name__}: {error}")
    return problems


class AssessmentController:
    """A distinct versioned store; it never constructs Entry or a publication ledger."""

    def __init__(
        self, directory: Path, policy: AssessmentPolicy, issue: Issue, comments: list[dict[str, JsonValue]],
        capture: SourceCapture, draft: AssessmentDraft, prepared: MaterializedSetup, plan: AssessmentPlan,
        *, implementation: Callable[[], str] | None = None,
        assessment_input: AssessmentInput | None = None,
    ):
        self.directory, self.policy, self.issue, self.comments = directory, policy, issue, comments
        self.capture, self.draft, self.prepared, self.plan = capture, draft, prepared, plan
        self._implementation = implementation
        self.assessment_input = assessment_input
        snapshot = {
            "schema_version": 1, "policy": policy.model_dump(mode="json"), "issue": issue.model_dump(mode="json"),
            "comments": comments, "capture": capture.model_dump(mode="json"), "draft": draft.model_dump(mode="json"),
            "prepared": prepared.model_dump(mode="json"), "plan": plan.model_dump(mode="json"),
            "assessment_input": None if assessment_input is None else assessment_input.model_dump(mode="json"),
        }
        path = directory / "assessment.json"
        if path.exists():
            if json.loads(path.read_text(encoding="utf-8")) != snapshot:
                raise ValueError("Assessment checkpoints cannot be replaced/upgraded by toggling a flag")
        else:
            self.save_once("assessment.json", snapshot)

    def require_identity(self) -> None:
        if self._implementation is not None and self._implementation() != self.policy.implementation_hash:
            raise ValueError("Frozen implementation/profile/SDK identity changed")
        snapshot = json.loads((self.directory / "assessment.json").read_text(encoding="utf-8"))
        verify_capture(self.capture)
        verify_materialized_setup(self.capture, associations(self.draft), choices(self.draft), self.prepared)
        expected = fingerprint({"issue": self.issue.model_dump(mode="json"), "comments": self.comments})
        incoming = None if self.assessment_input is None else self.assessment_input.model_dump(mode="json")
        if (
            self.policy.input_hash != expected or self.plan.input_hash != expected
            or self.plan.policy_hash != fingerprint(self.policy.model_dump())
            or self.plan.source_hash != self.capture.digest or self.plan.setup_hash != self.prepared.digest
            or self.plan.draft_hash != fingerprint(self.draft.model_dump())
            or self.policy.setup_capabilities_hash != fingerprint([
                item.model_dump(mode="json") for item in self.plan.capabilities
            ])
            or self.policy.setup_selections_hash != fingerprint([
                item.model_dump(mode="json") for item in self.plan.setup_selections
            ])
            or snapshot["plan"] != self.plan.model_dump(mode="json")
            or snapshot["policy"] != self.policy.model_dump(mode="json")
            or self.policy.assessment_input_hash != (None if incoming is None else fingerprint(incoming))
            or snapshot["assessment_input"] != incoming
        ):
            raise ValueError("Assessment policy/report/source/setup identity changed; old checkpoints cannot be upgraded")
        if self.assessment_input is not None and (
            self.assessment_input.issue != self.issue or self.assessment_input.comments != self.comments
            or capture_report(self.issue, self.comments, report_id=self.assessment_input.report_id) != self.capture
        ):
            raise ValueError("Frozen controller report does not match captured source documents")

    def save_once(self, name: str, value: object) -> str:
        path = self.directory / relative_path(name)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("x", encoding="utf-8", newline="\n") as stream:
            json.dump(value, stream, sort_keys=True, indent=2, allow_nan=False)
            stream.write("\n")
        return fingerprint(value)

    def claim(self, claim_id: str) -> ClaimAssessment:
        claim = next((claim for claim in self.plan.claims if claim.id == claim_id), None)
        if claim is None:
            raise ValueError("Unknown frozen assessment claim ID")
        return claim

    def claim_setup(self, claim_id: str) -> MaterializedSetup:
        claim = self.claim(claim_id)
        return materialize_setup(
            self.capture, [item for item in associations(self.draft) if item.source_id in claim.source_ids],
            choices(self.draft), reported_settings=claim.reported_settings,
        )

    def static_stub_support(self, claim_id: str, target: ReproductionTarget) -> dict[str, list[str]]:
        self.require_identity()
        prepared = self.claim_setup(claim_id)
        requirements = inspect_requirements(self.capture, prepared)
        required = {fingerprint(item.model_dump(mode="json")) for item in requirements}
        capabilities = [item for item in self.plan.capabilities if item.requirement_hash in required]
        if (
            resolve_setup(requirements, capabilities).status != "ready"
            or target.status != "ready" or not target.directory or not target.tree_hash
        ):
            return {}
        support = {}
        for requirement in requirements:
            if requirement.kind != "static_stubs" or requirement.name != "typing_extensions":
                continue
            if any(
                Path(name).stem.casefold() == requirement.name
                or requirement.name in {part.casefold() for part in Path(name).parts[:-1]}
                for name in prepared.files
            ):
                continue
            module_keys = {
                fingerprint(item.model_dump(mode="json")) for item in requirements
                if item.name == requirement.name
            }
            proofs = [item for item in capabilities if item.requirement_hash in module_keys]
            target_hash = fingerprint(target.model_dump(mode="json"))
            if not proofs or not all(
                any(item.locator == target.identity and item.sha256 == target_hash for item in proof.evidence)
                for proof in proofs
            ):
                continue
            stub = Path(target.directory) / "dist" / "typeshed-fallback" / "stdlib" / "typing_extensions.pyi"
            if stub.is_symlink() or not stub.resolve().is_relative_to(Path(target.directory).resolve()):
                raise ValueError("Approved static stub escapes the checker target")
            if not stub.is_file():
                raise ValueError("Approved static stub is missing, empty or exceeds the inspection bound")
            with stub.open("rb") as stream:
                data = stream.read(1048577)
            if not 0 < len(data) <= 1048576:
                raise ValueError("Approved static stub is missing, empty or exceeds the inspection bound")
            stub_hash = hashlib.sha256(data).hexdigest()
            if not any(
                proof.requirement_hash == fingerprint(requirement.model_dump(mode="json"))
                and any(item.locator == str(stub) and item.sha256 == stub_hash for item in proof.evidence)
                for proof in proofs
            ):
                raise ValueError("Approved static stub differs from its captured capability evidence")
            support[requirement.name] = [proof.digest for proof in proofs]
        return support

    def require_read_only(self, operation: str = "publication") -> None:
        raise ValueError(f"Assessment-v1 is permanently read-only: {operation} is forbidden")

    async def rescreen(self, screen: Screen) -> None:
        self.require_identity()
        await screen(
            {"issue": self.issue.model_dump(mode="json"), "comments": list(self.comments)},
            self.directory, f"issue:{self.issue.number}",
        )

    def freeze_discovery(self, claim_id: str, target: ReproductionTarget) -> DiscoveryPlan:
        self.require_identity()
        claim = self.claim(claim_id)
        if claim.readiness != "partial" or claim.discovery is None:
            raise ValueError("Only eligible partial claims may execute historical discovery")
        plan = DiscoveryPlan(
            policy_hash=self.plan.policy_hash, assessment_hash=fingerprint(self.plan.model_dump()),
            source_hash=self.capture.digest, setup_hash=self.claim_setup(claim_id).digest,
            claim_id=claim_id, report_quote=claim.report_quote, scope=claim.discovery,
            inputs=original_inputs(self.claim_setup(claim_id)), historical_target=target,
        )
        self.save_once(f"discovery-{claim_id}/plan.json", plan.model_dump(mode="json"))
        return plan

    def require_discovery_plan(self, plan: DiscoveryPlan) -> None:
        self.require_identity()
        frozen = DiscoveryPlan.model_validate_json(
            (self.directory / f"discovery-{plan.claim_id}" / "plan.json").read_text(encoding="utf-8")
        )
        claim = self.claim(plan.claim_id)
        if (
            frozen != plan or plan.policy_hash != self.plan.policy_hash
            or plan.assessment_hash != fingerprint(self.plan.model_dump())
            or plan.source_hash != self.capture.digest or plan.setup_hash != self.claim_setup(plan.claim_id).digest
            or plan.inputs != original_inputs(self.claim_setup(plan.claim_id)) or plan.scope != claim.discovery
            or plan.report_quote != claim.report_quote
        ):
            raise ValueError("Frozen discovery scope or inputs changed")

    async def discover(self, plan: DiscoveryPlan, store: TargetStore) -> AssessmentReceipt:
        self.require_discovery_plan(plan)
        target = plan.historical_target
        await run_target_io(store.verify, target)
        workspace = self.directory / f"discovery-{plan.claim_id}" / "original"
        workspace.mkdir()
        for name, content in plan.inputs.items():
            path = workspace / relative_path(name)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8", newline="\n")
        before = await run_target_io(tree_hash, workspace)
        command = [
            "node", target.cli or "", "--project", str(workspace / "pyrightconfig.json"),
            "--outputjson", "--pythonpath", str(workspace / "unavailable-python"),
        ]
        raw: dict[str, JsonValue] = {
            "id": uuid.uuid4().hex, "kind": "assessment_discovery", "phase": "original",
            "target": target.model_dump(mode="json"), "inputs": dict(plan.inputs),
            "input_hash": before, "plan_hash": fingerprint(plan.model_dump()),
            "command": subprocess.list2cmdline(command), "cwd": str(workspace),
        }
        if self.claim(plan.claim_id).reported_settings:
            raw["reported_setup_scope"] = {
                "conditional": True, "capture_hash": self.capture.digest,
                "selections": [item.model_dump(mode="json") for item in self.claim(plan.claim_id).reported_settings],
            }
        try:
            code, stdout, stderr = await store.runner(command, workspace)
            raw.update(exit_code=code, stdout=stdout, stderr=stderr)
            await run_target_io(store.verify, target)
            self.require_discovery_plan(plan)
            if await run_target_io(tree_hash, workspace) != before:
                raise ValueError("Historical discovery inputs changed during execution")
        except (OSError, ValueError, TimeoutError) as error:
            raw["error"] = str(error)
        support = {} if raw.get("error") else self.static_stub_support(plan.claim_id, target)
        if support:
            qualification: dict[str, JsonValue] = {
                module: [digest for digest in digests] for module, digests in support.items()
            }
            raw["static_stub_support"] = qualification
        problems = validate_discovery_output(
            raw, target, self.claim_setup(plan.claim_id).files, static_stub_modules=support,
        )
        receipt = AssessmentReceipt(
            id="discovery-" + str(raw["id"]), kind="discovery", policy_hash=plan.policy_hash,
            plan_hash=fingerprint(plan.model_dump()), claim_id=plan.claim_id, raw=raw,
            problems=problems, observation="blocked" if problems else "captured",
        )
        self.save_once(f"discovery-{plan.claim_id}/receipt.json", receipt.model_dump(mode="json"))
        return receipt

    def validate_refinement(
        self, claim_id: str, receipt: AssessmentReceipt, refinement: VerificationRefinement,
    ) -> None:
        self.require_identity()
        claim = self.claim(claim_id)
        saved = AssessmentReceipt.model_validate_json(
            (self.directory / f"discovery-{claim_id}" / "receipt.json").read_text(encoding="utf-8")
        )
        if (
            receipt != saved or receipt.kind != "discovery" or receipt.observation != "captured"
            or receipt.claim_id != claim_id or receipt.policy_hash != self.plan.policy_hash
            or refinement.claim_id != claim_id or refinement.discovery_id != receipt.id
        ):
            raise ValueError("Refinement requires exact captured historical discovery, never verification/old receipts")
        discovery = DiscoveryPlan.model_validate_json(
            (self.directory / f"discovery-{claim_id}" / "plan.json").read_text(encoding="utf-8")
        )
        self.require_discovery_plan(discovery)
        if receipt.plan_hash != fingerprint(discovery.model_dump()):
            raise ValueError("Discovery receipt is not bound to the frozen scope")
        verification = refinement.verification
        if verification is None:
            return
        if verification.report_quote != claim.report_quote or verification.surface != claim.surface:
            raise ValueError("Refinement cannot change the reported claim or product surface")
        output = json.loads(str(receipt.raw["stdout"]))
        scope = discovery.scope.locations
        paths = {source.source_id: source.path for source in self.draft.sources}
        rule_predicates = [
            item for item in [*verification.broken, *verification.resolved] if item.message is None
        ]
        if rule_predicates or verification.context_diagnostics:
            if not self.policy.allow_rule_location_predicates:
                raise ValueError("Rule/location predicates require explicit read-only policy approval")
            if not rule_predicates or (
                discovery.scope.symptom_kind != "diagnostic"
                or discovery.scope.failure_direction != "unexpected_absence"
                or discovery.scope.reported_message is not None
            ):
                raise ValueError("Rule/location predicates are limited to missing diagnostics with unknown wording")
            for symptom in rule_predicates:
                if not any(
                    symptom.file == paths[location.source_id]
                    and location.start_line == location.end_line == symptom.line
                    for location in scope
                ):
                    raise ValueError("Rule/location predicates require an exact frozen single-line location")
                counterpart = verification.resolved if symptom in verification.broken else verification.broken
                if symptom.model_copy(update={"present": not symptom.present}) not in counterpart:
                    raise ValueError("Rule/location predicates must retain the same rule/location in both directions")
                if symptom.rule != discovery.scope.reported_rule and not any(
                    context.relation == "same_rule_comparison"
                    and Path(item["file"]).resolve()
                    == (Path(str(receipt.raw["cwd"])) / relative_path(paths[context.source_id])).resolve()
                    and item["range"]["start"]["line"] == context.line - 1
                    and item["severity"] == "error" and item.get("rule") == symptom.rule
                    for context in discovery.scope.reported_context for item in output["generalDiagnostics"]
                ):
                    raise ValueError("Missing diagnostic rule lacks frozen report or explicit comparison evidence")
            for expected in verification.context_diagnostics:
                if not any(
                    expected.file == paths[context.source_id] and expected.line == context.line
                    and Path(item["file"]).resolve()
                    == (Path(str(receipt.raw["cwd"])) / relative_path(expected.file)).resolve()
                    and item["range"]["start"]["line"] == expected.line - 1
                    and item["message"] == expected.message and item["severity"] == expected.severity
                    and item.get("rule") == expected.rule
                    for context in discovery.scope.reported_context for item in output["generalDiagnostics"]
                ):
                    raise ValueError("Context diagnostics require exact discovery at pre-declared report locations")
            for name, source in controls(refinement).items():
                original = self.claim_setup(claim_id).files.get(name)
                if original is None or not source.startswith(original) or (
                    original and not original.endswith(("\n", "\r"))
                    and source[len(original):] and not source[len(original):].startswith(("\n", "\r"))
                ):
                    raise ValueError("Rule/location precision controls must preserve pristine originals as whole lines")
        for symptom in [*verification.broken, *verification.resolved]:
            if not any(
                symptom.file == paths[location.source_id] and location.start_line <= symptom.line <= location.end_line
                for location in scope
            ):
                raise ValueError("Refinement cannot shop for a symptom outside the frozen reported scope")
        for symptom in verification.broken:
            expected_present = discovery.scope.failure_direction == "unexpected_presence"
            if symptom.present != expected_present:
                raise ValueError("Refinement cannot invert the frozen reported failure direction")
            if discovery.scope.symptom_kind == "revealed_type" and symptom.severity != "information":
                raise ValueError("A revealed-type claim cannot become a different diagnostic surface")
            if discovery.scope.reported_message is not None and symptom.message != discovery.scope.reported_message:
                raise ValueError("Refinement changed the frozen reported symptom wording")
            if discovery.scope.reported_rule is not None and symptom.rule != discovery.scope.reported_rule:
                raise ValueError("Refinement changed the frozen reported diagnostic rule")
            reported = [
                item for item in discovery.scope.reported_symptoms
                if paths[item.source_id] == symptom.file and item.line == symptom.line
            ]
            matches_reported = any(
                item.message == symptom.message and (item.rule is None or item.rule == symptom.rule)
                for item in reported
            )
            if reported and not matches_reported:
                raise ValueError("Refinement changed a scoped frozen reported symptom")
            if symptom.message is None:
                continue
            found = any(
                Path(item["file"]).resolve() == (Path(str(receipt.raw["cwd"])) / relative_path(symptom.file)).resolve()
                and item["range"]["start"]["line"] == symptom.line - 1
                and item["severity"] == symptom.severity and item["message"] == symptom.message
                and (symptom.rule is None or item.get("rule") == symptom.rule)
                for item in output["generalDiagnostics"]
            )
            if not found and discovery.scope.reported_message is None and not matches_reported:
                raise ValueError("An unobserved predicate needs exact reported wording frozen before discovery")
            if not found and symptom.rule is not None and (
                symptom.rule != discovery.scope.reported_rule
                and not any(item.message == symptom.message and item.rule == symptom.rule for item in reported)
            ):
                raise ValueError("An unobserved diagnostic rule must be reported and frozen, or null")
        for location in scope:
            if not any(
                symptom.file == paths[location.source_id] and location.start_line <= symptom.line <= location.end_line
                for symptom in verification.broken
            ):
                raise ValueError("Refinement omitted a frozen reported source location")
        for reported in discovery.scope.reported_symptoms:
            if not any(
                symptom.file == paths[reported.source_id] and symptom.line == reported.line
                and symptom.message == reported.message and (reported.rule is None or symptom.rule == reported.rule)
                for symptom in verification.broken
            ):
                raise ValueError("Refinement omitted a scoped frozen reported symptom")
        known_messages = {item["message"] for item in output["generalDiagnostics"]}
        report = report_text(self.issue, self.comments)
        if any(
            symptom.message is not None and (
                symptom.message not in known_messages and symptom.message not in report
                and symptom.message != discovery.scope.reported_message
                and symptom.message not in {item.message for item in discovery.scope.reported_symptoms}
            )
            for symptom in [*verification.broken, *verification.resolved]
        ):
            raise ValueError("Refinement cannot invent unobserved diagnostic wording")
        original = next(item for item in self.draft.claims if item.id == claim_id)
        ready = AssessmentClaimDraft.model_validate({
            **original.model_dump(), "readiness": "ready", "verification": verification.model_dump(),
            "reasons": [], "discovery": None,
            "control_files": [item.model_dump() for item in refinement.control_files],
        })
        strict_scenario(self.draft, ready, self.claim_setup(claim_id))
        original_inputs(self.claim_setup(claim_id))

    def freeze_verification(
        self, claim_id: str, targets: list[ReproductionTarget], *,
        discovery: AssessmentReceipt | None = None, refinement: VerificationRefinement | None = None,
    ) -> VerificationPlan:
        self.require_identity()
        claim = self.claim(claim_id)
        if discovery is None and refinement is None:
            if claim.readiness != "ready" or claim.scenario is None:
                raise ValueError("Unresolved claims need historical discovery/refinement, not manufactured predicates")
            scenario = claim.scenario
        else:
            if discovery is None or refinement is None:
                raise ValueError("Discovery and its independent frozen refinement must both be supplied")
            self.validate_refinement(claim_id, discovery, refinement)
            if refinement.verification is None:
                raise ValueError("Unresolved discovery cannot become executable verification")
            original = next(item for item in self.draft.claims if item.id == claim_id)
            ready = original.model_copy(update={
                "readiness": "ready", "verification": refinement.verification, "reasons": [], "discovery": None,
                "control_files": refinement.control_files,
            })
            ready = AssessmentClaimDraft.model_validate(ready.model_dump())
            scenario = strict_scenario(self.draft, ready, self.claim_setup(claim_id))
        plan = VerificationPlan(
            policy_hash=self.plan.policy_hash, assessment_hash=fingerprint(self.plan.model_dump()),
            source_hash=self.capture.digest, setup_hash=self.claim_setup(claim_id).digest, claim_id=claim_id,
            discovery_id=None if discovery is None else discovery.id,
            discovery_hash=None if discovery is None else fingerprint(discovery.model_dump()),
            scenario=scenario, targets=targets,
        )
        # Freeze both trees before any verification execution; discovery's input directory is never reused.
        self.save_once(f"verification-{claim_id}/plan.json", plan.model_dump(mode="json"))
        self.save_once(f"verification-{claim_id}/original-inputs.json", scenario_inputs(scenario))
        if scenario.control_files:
            self.save_once(f"verification-{claim_id}/control-inputs.json", scenario_inputs(scenario, phase="control"))
        return plan

    async def verify(self, plan: VerificationPlan, store: TargetStore) -> list[AssessmentReceipt]:
        self.require_identity()
        saved = VerificationPlan.model_validate_json(
            (self.directory / f"verification-{plan.claim_id}" / "plan.json").read_text(encoding="utf-8")
        )
        if (
            saved != plan or plan.policy_hash != self.plan.policy_hash
            or plan.assessment_hash != fingerprint(self.plan.model_dump())
            or plan.source_hash != self.capture.digest or plan.setup_hash != self.claim_setup(plan.claim_id).digest
            or plan.scenario.files != self.claim_setup(plan.claim_id).files
            or plan.scenario.configuration != self.claim_setup(plan.claim_id).configuration
        ):
            raise ValueError("Verification plan/source/setup changed")
        original_inputs(self.claim_setup(plan.claim_id))
        self.save_once(f"verification-{plan.claim_id}/started.json", {"plan_hash": fingerprint(plan.model_dump())})
        receipts = []
        for phase in ["original", *(["control"] if plan.scenario.control_files else [])]:
            for target in plan.targets:
                self.require_identity()
                try:
                    raw = await store.probe(
                        target, plan.scenario,
                        self.directory / f"verification-{plan.claim_id}" / str(phase) / target.role,
                        phase="control" if phase == "control" else "original",
                    )
                    self.require_identity()
                except (OSError, ValueError, TimeoutError) as error:
                    raw = {
                        "id": uuid.uuid4().hex, "kind": "assessment_unexecuted", "phase": phase,
                        "target": target.model_dump(mode="json"), "scenario_hash": fingerprint(plan.scenario.model_dump()),
                        "error": f"{type(error).__name__}: {error}",
                    }
                if self.claim(plan.claim_id).reported_settings:
                    raw["reported_setup_scope"] = {
                        "conditional": True, "capture_hash": self.capture.digest,
                        "selections": [item.model_dump(mode="json") for item in self.claim(plan.claim_id).reported_settings],
                    }
                problems: list[str] = []
                rule_predicates = [
                    item for claim in plan.scenario.claims for item in claim.broken if item.message is None
                ]
                if rule_predicates:
                    predicate_records: list[JsonValue] = [item.model_dump(mode="json") for item in rule_predicates]
                    context_records: list[JsonValue] = [
                        item.model_dump(mode="json") for claim in plan.scenario.claims
                        for item in claim.context_diagnostics
                    ]
                    raw["rule_location_predicates"] = predicate_records
                    raw["context_diagnostics"] = context_records
                    raw["predicate_qualification"] = (
                        "Approved frozen diagnostic rule/location only, not exact wording or semantic proof of a fix"
                    )
                support = {} if raw.get("error") else self.static_stub_support(plan.claim_id, target)
                if support:
                    qualification: dict[str, JsonValue] = {
                        module: [digest for digest in digests] for module, digests in support.items()
                    }
                    raw["static_stub_support"] = qualification
                observed = observe_claims(
                    plan.scenario, raw, problems, static_stub_modules=support,
                    allow_rule_location_predicates=self.policy.allow_rule_location_predicates,
                )
                observation = observed.get(plan.claim_id, "blocked")
                receipt = AssessmentReceipt(
                    id="verification-" + str(raw["id"]),
                    kind="verification_control" if phase == "control" else "verification_original",
                    policy_hash=plan.policy_hash, plan_hash=fingerprint(plan.model_dump()), claim_id=plan.claim_id,
                    raw=raw, problems=problems, observation=observation,
                )
                receipts.append(receipt)
                self.save_once(
                    f"verification-{plan.claim_id}/{phase}-{target.role}-receipt.json", receipt.model_dump(mode="json"),
                )
        return receipts

    def verification_progress(self, plan: VerificationPlan, receipts: Sequence[AssessmentReceipt]) -> ClaimProgress:
        self.require_identity()
        originals, control = {}, {}
        ids = set()
        for receipt in receipts:
            if (
                receipt.kind == "discovery" or receipt.policy_hash != plan.policy_hash
                or receipt.plan_hash != fingerprint(plan.model_dump()) or receipt.claim_id != plan.claim_id
                or receipt.id in ids or receipt.raw.get("scenario_hash") != fingerprint(plan.scenario.model_dump())
            ):
                raise ValueError("Only independent exact-plan verification receipts can qualify observations")
            ids.add(receipt.id)
            target = ReproductionTarget.model_validate(receipt.raw["target"])
            expected = next(item for item in plan.targets if item.role == target.role)
            if target != expected:
                raise ValueError("Verification receipt target differs from the frozen assignment")
            bucket = control if receipt.kind == "verification_control" else originals
            if target.role in bucket:
                raise ValueError("Duplicate target/phase receipt")
            expected_phase = "control" if receipt.kind == "verification_control" else "original"
            if receipt.raw.get("phase") != expected_phase:
                raise ValueError("Verification receipt phase differs from its kind")
            saved = AssessmentReceipt.model_validate_json((
                self.directory / f"verification-{plan.claim_id}" / f"{expected_phase}-{target.role}-receipt.json"
            ).read_text(encoding="utf-8"))
            if saved != receipt:
                raise ValueError("Verification observations require exact controller-recorded execution receipts")
            bucket[target.role] = receipt.raw
        observations: dict[str, Literal["reproduced", "not_reproduced", "blocked", "unobserved"]] = {}
        for target in plan.targets:
            observed = classify(
                plan.scenario, originals[target.role], control.get(target.role),
                static_stub_modules=(
                    self.static_stub_support(plan.claim_id, target)
                    if not originals[target.role].get("error") and not control.get(target.role, {}).get("error") else ()
                ),
                allow_rule_location_predicates=self.policy.allow_rule_location_predicates,
            ) if target.role in originals else "unobserved"
            if observed == "reproduced":
                observations[target.role] = "reproduced"
            elif observed == "not_reproduced":
                observations[target.role] = "not_reproduced"
            elif observed == "blocked":
                observations[target.role] = "blocked"
            elif observed == "unobserved":
                observations[target.role] = "unobserved"
            else:
                raise ValueError("Unsupported observation from the strict reproduction classifier")
        complete = all(value in {"reproduced", "not_reproduced"} for value in observations.values())
        return ClaimProgress(
            claim_id=plan.claim_id, phase="verification",
            status="complete" if complete else "partial" if originals else "unobserved",
            receipt_ids=[receipt.id for receipt in receipts], target_observations=observations,
            reasons=[
                *reported_setting_qualifications(self.claim_setup(plan.claim_id)),
                *([] if complete else ["Some required original/control observations are blocked or unobserved"]),
            ],
        )

    def result(self, progress: Sequence[ClaimProgress], validity: JsonValue | None = None) -> AssessmentRun:
        self.require_identity()
        by_id = {item.claim_id: item for item in progress}
        if len(by_id) != len(progress) or not set(by_id) <= {claim.id for claim in self.plan.claims}:
            raise ValueError("Assessment progress must retain exactly one record per material claim")
        records = []
        for claim in self.plan.claims:
            progress_record = by_id.get(claim.id) or ClaimProgress(
                claim_id=claim.id, phase="unobserved", status="blocked" if claim.readiness == "blocked" else "unobserved",
                receipt_ids=[], target_observations={}, reasons=claim.reasons or ["No execution attempted"],
            )
            records.append(progress_record.model_copy(update={"reasons": list(dict.fromkeys([
                *progress_record.reasons, *reported_setting_qualifications(self.claim_setup(claim.id)),
            ]))}))
        return AssessmentRun(policy=self.policy, plan=self.plan, progress=records, validity=validity)
