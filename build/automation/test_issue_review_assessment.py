# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

import base64
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from typing import Literal
from unittest.mock import AsyncMock, patch

from copilot.session_events import AssistantMessageData
from pydantic import ValidationError

import assess_issues
from issue_review_assessment import (
    AssessmentController, associations, build_plan, capture_report, choices, original_inputs, report_text,
)
from issue_review_assessment_models import (
    AssessmentClaimDraft, AssessmentDraft, AssessmentInput, AssessmentPolicy, AssessmentReceipt,
    ClaimProgress, ControlSource, DeclaredClaim, VerificationRefinement,
)
from issue_review_models import Issue, ReproductionClaim, ReproductionTarget
from issue_review_reproduction import TargetStore, fingerprint
from issue_review_sources import SettingChoice, check_bundled_stub_capability, inspect_requirements, materialize_setup
from review_issues import AGENTS, SDK, Agent, AutomationError, GitHub, reproduction_response, response_schema


def issue(body: str) -> Issue:
    return Issue(
        number=11037, title="Material reported typing behavior", body=body,
        html_url="https://github.com/microsoft/pyright/issues/11037", state="open",
        updated_at="2025-10-22T00:00:00Z", created_at="2025-10-16T00:00:00Z", comments=0, labels=[],
    )


def body(*, diagnostic: bool = True, indent: bool = False) -> str:
    source = "value = 1\nreveal_type(value)\nresult: int = value\n"
    if indent:
        fence = "- Example:\n\n  ```python\n" + "".join("  " + line + "\n" for line in source.splitlines()) + "  ```\n"
    else:
        fence = "```python\n" + source + "```\n"
    return (
        'pythonVersion="3.13"\ntypeCheckingMode="standard"\n' + fence
        + ("The checker reports Unsupported rejection. Type of \"value\" is \"Literal[1]\".\n" if diagnostic
           else "The assignment is incorrectly rejected.\n")
        + "Editor completions remain stale.\n"
    )


def predicates() -> dict:
    symptom = {
        "file": "sample.py", "line": 3, "severity": "error", "message": "Unsupported rejection",
        "rule": "reportAssignmentType", "present": True,
    }
    precision = {
        "file": "sample.py", "line": 2, "severity": "information", "message": 'Type of "value" is "Literal[1]"',
        "rule": None, "present": True,
    }
    return {
        "id": "assignment", "report_quote": "The checker reports Unsupported rejection.",
        "surface": "cli", "broken": [symptom], "resolved": [{**symptom, "present": False}], "precision": [precision],
    }


def draft_for(capture, *, partial: bool = False, unsupported: bool = False) -> AssessmentDraft:
    report_quote = "The assignment is incorrectly rejected." if partial else "The checker reports Unsupported rejection."
    data = predicates()
    data["report_quote"] = report_quote
    source = capture.blocks[0].id
    claims = [{
        "id": "assignment", "summary": report_quote, "report_quote": report_quote,
        "surface": "cli", "source_ids": [source], "readiness": "partial" if partial else "ready",
        "reasons": ["Exact diagnostic text is absent"] if partial else [],
        "verification": None if partial else data,
        "discovery": {
            "question": "Observe the reported original assignment rejection without guessing diagnostic wording",
            "locations": [{"source_id": source, "start_line": 3, "end_line": 3}],
            "symptom_kind": "diagnostic", "failure_direction": "unexpected_presence",
            "reported_message": None, "reported_rule": None,
        } if partial else None,
        "control_files": [],
    }]
    if unsupported:
        claims.append({
            "id": "editor", "summary": "Stale completions", "report_quote": "Editor completions remain stale.",
            "surface": "editor", "source_ids": [], "readiness": "blocked",
            "reasons": ["No supported editor observation"], "verification": None, "discovery": None, "control_files": [],
        })
    return AssessmentDraft.model_validate({
        "schema_version": 1, "summary": "Preserve both supported and unsupported material claims",
        "reported_version": None, "version_quote": None, "sources": [{"source_id": source, "path": "sample.py"}],
        "setting_choices": [], "claims": claims, "limitations": ["No cause or issue disposition inferred"],
    })


def targets(root: Path) -> list[ReproductionTarget]:
    versions: list[tuple[Literal["historical", "main", "latest"], str]] = [
        ("historical", "1.1.1"), ("main", "1.1.2"), ("latest", "1.1.3"),
    ]
    return [ReproductionTarget(
        role=role, identity="a" * 40 if role == "main" else f"npm:pyright@{version}",
        version=version, source="https://github.com/microsoft/pyright.git" if role == "main"
        else f"https://registry.npmjs.org/pyright/-/pyright-{version}.tgz",
        selection_reason="Explicitly synthetic offline target fixture", directory=str(root / role),
        cli=str(root / role / "index.js"), tree_hash="b" * 64, status="ready",
    ) for role, version in versions]


def output(cwd: Path, version: str, *, broken: bool, stderr: str = "", extra: list | None = None) -> tuple[int, str, str]:
    diagnostics = [{
        "file": str(cwd / "sample.py"), "range": {"start": {"line": 1}},
        "severity": "information", "message": 'Type of "value" is "Literal[1]"',
    }]
    if broken:
        diagnostics.append({
            "file": str(cwd / "sample.py"), "range": {"start": {"line": 2}},
            "severity": "error", "message": "Unsupported rejection", "rule": "reportAssignmentType",
        })
    diagnostics.extend(extra or [])
    return int(broken), json.dumps({
        "version": version, "generalDiagnostics": diagnostics, "summary": {"filesAnalyzed": 1},
    }), stderr


class ModelTests(unittest.TestCase):
    def test_systemic_schema_rejection_recognizes_provider_status_formats_not_ordinary_failures(self):
        for message in (
            "HTTP 400 invalid response_format",
            '{"status_code":400,"message":"invalid JSON schema"}',
            "statusCode: 400: schema rejected",
            "BadRequest: invalid response_format",
        ):
            with self.subTest(message=message):
                self.assertTrue(assess_issues.schema_rejected(AutomationError(message)))
        for message in ("HTTP 400 authentication error", "TimeoutError: schema response exhausted budget"):
            with self.subTest(message=message):
                self.assertFalse(assess_issues.schema_rejected(AutomationError(message)))

    def test_partial_11037_needs_no_diagnostics_or_mandatory_precision(self):
        capture = capture_report(issue(body(diagnostic=False)), [])
        draft = draft_for(capture, partial=True)
        claim = draft.claims[0]
        self.assertIsNone(claim.verification)
        self.assertEqual(claim.control_files, [])
        self.assertEqual(claim.readiness, "partial")

    def test_blocked_without_original_is_expressible(self):
        claim = AssessmentClaimDraft(
            id="missing", summary="Original source absent", report_quote="Original source absent", surface="cli",
            source_ids=[], readiness="blocked", reasons=["No original source"], verification=None,
            discovery=None, control_files=[],
        )
        self.assertIsNone(claim.verification)

    def test_claim_ids_cannot_escape_or_alias_controller_directories(self):
        data = draft_for(capture_report(issue(body(diagnostic=False)), []), partial=True).claims[0].model_dump()
        for identifier in ("../escape", "..\\escape", "a/b", "a\\b", ".", "a:b", "a" * 65, ""):
            with self.subTest(identifier=identifier), self.assertRaises(ValidationError):
                AssessmentClaimDraft.model_validate({**data, "id": identifier})

    def test_ready_does_not_weaken_existing_claim_precision_requirements(self):
        data = predicates()
        for field in ("broken", "resolved", "precision"):
            with self.subTest(field=field), self.assertRaises(ValidationError):
                ReproductionClaim.model_validate({**data, field: []})
        capture = capture_report(issue(body()), [])
        draft = draft_for(capture)
        data = draft.claims[0].model_dump()
        for update in (
            {"readiness": "blocked", "reasons": ["Unsupported"]},
            {"readiness": "partial", "reasons": ["Missing text"]},
            {"readiness": "ready", "verification": None},
        ):
            with self.assertRaises(ValidationError):
                AssessmentClaimDraft.model_validate({**data, **update})

    def test_honest_blocked_refinement_cannot_keep_withdrawn_predicates(self):
        data = {
            "schema_version": 1, "claim_id": "assignment", "discovery_id": "observation",
            "readiness": "blocked", "verification": None, "control_files": [],
            "reasons": ["Historical output cannot establish the intended diagnostic"], "explanation": "Unknown remains unknown",
        }
        result = VerificationRefinement.model_validate(data)
        self.assertIsNone(result.verification)
        with self.assertRaises(ValidationError):
            VerificationRefinement.model_validate({**data, "verification": predicates()})

    def test_provider_schemas_closed_objects_without_dynamic_maps_or_root_wrappers(self):
        for model in (AssessmentDraft, VerificationRefinement):
            schema = response_schema(model)
            self.assertEqual(schema["type"], "object")
            self.assertNotIn("anyOf", schema)
            self.assertNotIn("oneOf", schema)

            def walk(node):
                if isinstance(node, dict):
                    if node.get("type") == "object":
                        self.assertIs(node.get("additionalProperties"), False)
                        self.assertEqual(set(node["required"]), set(node["properties"]))
                    for value in node.values():
                        walk(value)
                elif isinstance(node, list):
                    for value in node:
                        walk(value)
            walk(schema)

    def test_assessment_decode_rejects_duplicates_and_nonfinite_json_without_coercion(self):
        capture = capture_report(issue(body(diagnostic=False)), [])
        content = draft_for(capture, partial=True).model_dump_json()
        self.assertEqual(AssessmentDraft.model_validate_json(reproduction_response(AssessmentDraft, content)).claims[0].readiness, "partial")
        for changed in (
            content.replace('"schema_version":1', '"schema_version":1,"schema_version":1'),
            content.replace('"schema_version":1', '"schema_version":NaN'),
            content.replace('"schema_version":1', '"schema_version":1e9999'),
            content.replace('"schema_version":1', '"schema_version":"1"'),
        ):
            with self.assertRaises(ValueError):
                reproduction_response(AssessmentDraft, changed)


class ControllerTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.calls = []
        self.test_targets = targets(self.root / "targets")

        async def runner(command, cwd):
            self.calls.append((command, cwd))
            target = next(target for target in self.test_targets if target.cli == command[1])
            return output(cwd, target.version, broken=target.role == "historical")

        self.store = TargetStore(self.root / "trusted-cache", runner)
        self.store.verify = lambda target: None  # Explicit offline fixture; no checker process exists.

    def controller(
        self, *, partial=False, unsupported=False, report=None, reported_message=None,
        direction: Literal["unexpected_presence", "unexpected_absence"] = "unexpected_presence",
        report_quote=None, with_controls=False,
    ):
        current = issue(report or body(diagnostic=not partial))
        capture = capture_report(current, [])
        draft = draft_for(capture, partial=partial, unsupported=unsupported)
        if draft.claims[0].discovery is not None:
            draft.claims[0].discovery.failure_direction = direction
            draft.claims[0].discovery.reported_message = reported_message
            if report_quote is not None:
                draft.claims[0].report_quote = report_quote
                draft.claims[0].summary = report_quote
                draft.claims[0].discovery.question = report_quote
        if with_controls:
            draft.claims[0].control_files = [
                ControlSource(path="sample.py", content=capture.blocks[0].content + "reveal_type(value)\n"),
            ]
        prepared = materialize_setup(capture, associations(draft), choices(draft))
        policy = AssessmentPolicy(
            input_hash=fingerprint({"issue": current.model_dump(mode="json"), "comments": []}),
            implementation_hash="implementation", profile_hash="profile", model="gpt-6.1-sol",
        )
        plan = build_plan(policy, draft, capture, prepared, report_text(current, []))
        return AssessmentController(self.root / "run", policy, current, [], capture, draft, prepared, plan)

    async def test_unsupported_claim_does_not_suppress_independent_ready_claim(self):
        controller = self.controller(unsupported=True)
        self.assertEqual(controller.plan.readiness, "partial")
        self.assertEqual([claim.readiness for claim in controller.plan.claims], ["ready", "blocked"])
        plan = controller.freeze_verification("assignment", self.test_targets)
        receipts = await controller.verify(plan, self.store)
        progress = controller.verification_progress(plan, receipts)
        self.assertEqual(progress.target_observations, {"historical": "reproduced", "main": "not_reproduced", "latest": "not_reproduced"})
        result = controller.result([progress])
        self.assertEqual(len(result.progress), 2)
        self.assertEqual(result.progress[1].status, "blocked")
        self.assertIsNone(result.action())
        self.assertIsNone(result.plan.action())

    async def test_historical_discovery_is_captured_not_reproduction_and_uses_pristine_source(self):
        controller = self.controller(partial=True)
        plan = controller.freeze_discovery("assignment", self.test_targets[0])
        self.assertEqual(len(self.calls), 0)
        receipt = await controller.discover(plan, self.store)
        self.assertEqual(receipt.kind, "discovery")
        self.assertEqual(receipt.observation, "captured")
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(receipt.raw["inputs"], plan.inputs)
        self.assertNotIn("reproduced", receipt.observation)
        with self.assertRaises(ValidationError):
            AssessmentReceipt.model_validate({**receipt.model_dump(), "observation": "not_reproduced"})

    async def test_discovery_refinement_then_independent_verification_never_reuses_receipts(self):
        controller = self.controller(partial=True)
        discovery_plan = controller.freeze_discovery("assignment", self.test_targets[0])
        discovery = await controller.discover(discovery_plan, self.store)
        data = predicates()
        data["report_quote"] = controller.claim("assignment").report_quote
        refinement = VerificationRefinement(
            schema_version=1, claim_id="assignment", discovery_id=discovery.id,
            readiness="ready", verification=ReproductionClaim.model_validate(data), control_files=[], reasons=[],
            explanation="Exact historical diagnostic captured at frozen line3; independent precision already in original",
        )
        controller.validate_refinement("assignment", discovery, refinement)
        plan = controller.freeze_verification("assignment", self.test_targets, discovery=discovery, refinement=refinement)
        self.assertEqual(len(self.calls), 1)
        receipts = await controller.verify(plan, self.store)
        self.assertEqual(len(self.calls), 4)
        self.assertNotEqual(receipts[0].raw["cwd"], discovery.raw["cwd"])
        self.assertNotEqual(receipts[0].id, discovery.id)
        with self.assertRaises(ValueError):
            controller.verification_progress(plan, [discovery, *receipts[1:]])
        self.assertEqual(controller.verification_progress(plan, receipts).status, "complete")

    async def test_refinement_proposes_new_controls_before_fresh_verification_without_changing_originals(self):
        quote = "The checker reports Unsupported rejection."
        report = body().replace("reveal_type(value)", "# Original has no type query")
        controller = self.controller(
            partial=True, report=report, report_quote=quote, reported_message="Unsupported rejection",
        )

        async def no_diagnostic_runner(command, cwd):
            self.calls.append((command, cwd))
            target = next(target for target in self.test_targets if target.cli == command[1])
            return 0, json.dumps({
                "version": target.version, "generalDiagnostics": [], "summary": {"filesAnalyzed": 1},
            }), ""

        self.store.runner = no_diagnostic_runner
        discovery = await controller.discover(controller.freeze_discovery("assignment", self.test_targets[0]), self.store)
        original = dict(controller.claim_setup("assignment").files)
        self.assertNotIn("reveal_type", original["sample.py"])
        data = {**predicates(), "report_quote": controller.claim("assignment").report_quote}
        data["precision"] = [{**data["precision"][0], "line": 4}]
        proposed = VerificationRefinement(
            schema_version=1, claim_id="assignment", discovery_id=discovery.id, readiness="ready",
            verification=ReproductionClaim.model_validate(data), reasons=[],
            control_files=[ControlSource(path="sample.py", content=original["sample.py"] + "reveal_type(value)\n")],
            explanation="Proposed Literal[1] precision expectation; no new control has been executed",
        )
        sdk = SDK(AsyncMock(), "gpt-6.1-sol", 180)
        agent = Agent.load(AGENTS / "pyright-issue-assessor.md", "pyright-issue-assessor")

        async def role(_agent, prompt, _scratch, **kwargs):
            self.assertIn("planning stage, not an execution gate", prompt)
            self.assertIn("proposed precision expectations", prompt)
            self.assertIn("not semantic correctness", prompt)
            self.assertEqual(len(self.calls), 1)
            kwargs["validate"](proposed.model_dump_json())
            return proposed.model_dump_json()

        with patch.object(sdk, "run", side_effect=role):
            refined = await assess_issues.refinement(controller, "assignment", discovery, sdk, agent)
        plan = controller.freeze_verification("assignment", self.test_targets, discovery=discovery, refinement=refined)
        self.assertEqual(plan.scenario.files, original)
        self.assertEqual(len(self.calls), 1)
        base_runner = self.store.runner

        async def runner(command, cwd):
            exit_code, stdout, stderr = await base_runner(command, cwd)
            if cwd.parent.name == "control":
                parsed = json.loads(stdout)
                parsed["generalDiagnostics"] = [{
                    "file": str(cwd / "sample.py"), "range": {"start": {"line": 3}},
                    "severity": "information", "message": 'Type of "value" is "Literal[1]"',
                }]
                stdout = json.dumps(parsed)
            return exit_code, stdout, stderr

        self.store.runner = runner
        receipts = await controller.verify(plan, self.store)
        self.assertEqual(len(self.calls), 7)
        self.assertEqual([receipt.kind for receipt in receipts], [
            *(["verification_original"] * 3), *(["verification_control"] * 3),
        ])
        progress = controller.verification_progress(plan, receipts)
        self.assertEqual(progress.status, "complete")
        self.assertEqual(set(progress.target_observations.values()), {"not_reproduced"})

    async def test_refinement_validation_catches_invalid_control_tree_within_role_correction_budget(self):
        controller = self.controller(partial=True)
        discovery = await controller.discover(controller.freeze_discovery("assignment", self.test_targets[0]), self.store)
        refined = VerificationRefinement(
            schema_version=1, claim_id="assignment", discovery_id=discovery.id, readiness="ready",
            verification=ReproductionClaim.model_validate({
                **predicates(), "report_quote": controller.claim("assignment").report_quote,
            }), control_files=[ControlSource(path="different.py", content="reveal_type(1)\n")], reasons=[],
            explanation="Invalid control tree must fail before the role's validation callback accepts it",
        )
        with self.assertRaisesRegex(ValueError, "source-file set"):
            controller.validate_refinement("assignment", discovery, refined)

    async def test_refinement_cannot_change_scope_quote_or_invent_diagnostic(self):
        controller = self.controller(partial=True)
        discovery = await controller.discover(controller.freeze_discovery("assignment", self.test_targets[0]), self.store)
        data = predicates()
        data["report_quote"] = controller.claim("assignment").report_quote
        for change in (
            {"report_quote": "Different claim"},
            {"broken": [{**data["broken"][0], "message": "Invented diagnostic"}]},
            {"resolved": [{**data["resolved"][0], "line": 1}]},
        ):
            refined = VerificationRefinement(
                schema_version=1, claim_id="assignment", discovery_id=discovery.id, readiness="ready",
                verification=ReproductionClaim.model_validate({**data, **change}), control_files=[], reasons=[],
                explanation="Not a valid refinement",
            )
            with self.assertRaises(ValueError):
                controller.validate_refinement("assignment", discovery, refined)

    async def test_reported_unexpected_diagnostic_can_be_verified_absent_without_inverting_claim(self):
        quote = "The checker reports Unsupported rejection."
        controller = self.controller(
            partial=True, report=body(), report_quote=quote, reported_message="Unsupported rejection",
        )

        async def negative_runner(command, cwd):
            self.calls.append((command, cwd))
            target = next(target for target in self.test_targets if target.cli == command[1])
            return output(cwd, target.version, broken=False)

        self.store.runner = negative_runner
        discovery = await controller.discover(controller.freeze_discovery("assignment", self.test_targets[0]), self.store)
        data = {**predicates(), "report_quote": quote}
        refinement = VerificationRefinement(
            schema_version=1, claim_id="assignment", discovery_id=discovery.id, readiness="ready",
            verification=ReproductionClaim.model_validate(data), control_files=[], reasons=[],
            explanation="The exact complaint was frozen from the report; discovery contradicts it",
        )
        controller.validate_refinement("assignment", discovery, refinement)
        inverted = refinement.model_copy(update={
            "verification": ReproductionClaim.model_validate({
                **data, "broken": data["resolved"], "resolved": data["broken"],
            }),
        })
        with self.assertRaisesRegex(ValueError, "invert"):
            controller.validate_refinement("assignment", discovery, inverted)
        plan = controller.freeze_verification("assignment", self.test_targets, discovery=discovery, refinement=refinement)
        receipts = await controller.verify(plan, self.store)
        progress = controller.verification_progress(plan, receipts)
        self.assertEqual(set(progress.target_observations.values()), {"not_reproduced"})
        self.assertEqual(progress.status, "complete")
        self.assertEqual(len(self.calls), 4)

    async def test_missing_diagnostic_claim_cannot_become_unexpected_diagnostic_after_discovery_emits_it(self):
        quote = "The checker fails to report Unsupported rejection."
        report = body().replace("The checker reports Unsupported rejection.", quote)
        controller = self.controller(
            partial=True, report=report, report_quote=quote, direction="unexpected_absence",
            reported_message="Unsupported rejection",
        )
        discovery = await controller.discover(controller.freeze_discovery("assignment", self.test_targets[0]), self.store)
        data = {**predicates(), "report_quote": quote}
        inverted = VerificationRefinement(
            schema_version=1, claim_id="assignment", discovery_id=discovery.id, readiness="ready",
            verification=ReproductionClaim.model_validate(data), control_files=[], reasons=[],
            explanation="This would incorrectly change the complaint to match discovery",
        )
        with self.assertRaisesRegex(ValueError, "invert"):
            controller.validate_refinement("assignment", discovery, inverted)
        faithful = inverted.model_copy(update={
            "verification": ReproductionClaim.model_validate({
                **data, "broken": data["resolved"], "resolved": data["broken"],
            }),
        })
        controller.validate_refinement("assignment", discovery, faithful)
        plan = controller.freeze_verification("assignment", self.test_targets, discovery=discovery, refinement=faithful)
        receipts = await controller.verify(plan, self.store)
        self.assertEqual(controller.verification_progress(plan, receipts).target_observations["historical"], "not_reproduced")

    async def test_unknown_unobserved_diagnostic_stays_unresolved_instead_of_mining_unrelated_text(self):
        controller = self.controller(partial=True)

        async def negative_runner(command, cwd):
            return output(cwd, self.test_targets[0].version, broken=False)

        self.store.runner = negative_runner
        discovery = await controller.discover(controller.freeze_discovery("assignment", self.test_targets[0]), self.store)
        data = {**predicates(), "report_quote": controller.claim("assignment").report_quote}
        refinement = VerificationRefinement(
            schema_version=1, claim_id="assignment", discovery_id=discovery.id, readiness="ready",
            verification=ReproductionClaim.model_validate(data), control_files=[], reasons=[],
            explanation="Unknown diagnostic wording cannot be manufactured for a negative test",
        )
        with self.assertRaisesRegex(ValueError, "unobserved predicate"):
            controller.validate_refinement("assignment", discovery, refinement)

    async def test_validity_bridge_controls_never_become_original_symptom_evidence(self):
        from issue_review_validity import ValidityInput

        controller = self.controller(with_controls=True)
        plan = controller.freeze_verification("assignment", self.test_targets)
        receipts = await controller.verify(plan, self.store)
        result = controller.result([controller.verification_progress(plan, receipts)])
        args = assess_issues.arguments(["--issue", "11037", "--state-dir", str(controller.directory)])
        sdk, github = SDK(AsyncMock(), "gpt-6.1-sol", 180), GitHub()

        async def inspect_bridge(agent, prompt, scratch, **kwargs):
            inputs = ValidityInput.model_validate_json((scratch / "input.json").read_text())
            execution = [item for item in inputs.evidence if item.kind == "execution"]
            self.assertEqual(len(execution), 6)
            controls = [item for item in execution if "Precision control only" in item.section]
            self.assertEqual(len(controls), 3)
            self.assertTrue(all(item.observation == "unobserved" for item in controls))
            originals = [item for item in execution if item not in controls]
            self.assertEqual([item.observation for item in originals].count("verified_reproduced"), 1)
            self.assertEqual([item.observation for item in originals].count("verified_absent"), 2)
            raise ValueError("Offline inspection completed; no semantic role dispatched")

        with patch.object(sdk, "run", side_effect=inspect_bridge), patch.object(github, "screen", AsyncMock()):
            with self.assertRaisesRegex(ValueError, "Offline inspection completed"):
                await assess_issues.validity_phase(controller, args, sdk, result, github=github)

    async def test_blocked_discovery_receipt_is_not_a_captured_validity_fact(self):
        from issue_review_validity import ValidityInput

        controller = self.controller(partial=True)

        async def blocked_runner(command, cwd):
            return output(cwd, self.test_targets[0].version, broken=True, stderr="Explicit offline setup failure")

        self.store.runner = blocked_runner
        receipt = await controller.discover(controller.freeze_discovery("assignment", self.test_targets[0]), self.store)
        self.assertEqual(receipt.observation, "blocked")
        result = controller.result([ClaimProgress(
            claim_id="assignment", phase="discovery", status="blocked", receipt_ids=[receipt.id],
            target_observations={}, reasons=receipt.problems,
        )])
        args = assess_issues.arguments(["--issue", "11037", "--state-dir", str(controller.directory)])
        sdk, github = SDK(AsyncMock(), "gpt-6.1-sol", 180), GitHub()

        async def inspect_bridge(agent, prompt, scratch, **kwargs):
            inputs = ValidityInput.model_validate_json((scratch / "input.json").read_text())
            execution = [item for item in inputs.evidence if item.kind == "execution"]
            self.assertEqual(len(execution), 1)
            self.assertEqual(execution[0].observation, "unobserved")
            self.assertIn("Blocked historical discovery", execution[0].section)
            raise ValueError("Offline blocked-discovery inspection completed")

        with patch.object(sdk, "run", side_effect=inspect_bridge), patch.object(github, "screen", AsyncMock()):
            with self.assertRaisesRegex(ValueError, "inspection completed"):
                await assess_issues.validity_phase(controller, args, sdk, result, github=github)

    async def test_blocked_refinement_reason_reaches_current_validity_context_without_erasing_discovery(self):
        from issue_review_validity import ValidityInput

        controller = self.controller(partial=True)
        discovery = await controller.discover(controller.freeze_discovery("assignment", self.test_targets[0]), self.store)
        refined = VerificationRefinement(
            schema_version=1, claim_id="assignment", discovery_id=discovery.id, readiness="blocked",
            verification=None, control_files=[], reasons=["No justified precise type expectation"],
            explanation="A genuine planning blocker, not a request for preexisting verification receipts",
        )
        controller.save_once("discovery-assignment/refinement.json", refined.model_dump(mode="json"))
        progress = assess_issues.saved_progress(controller)
        self.assertEqual(progress[0].status, "captured")
        self.assertEqual(progress[0].receipt_ids, [discovery.id])
        self.assertEqual(progress[0].reasons, ["Verification planning blocked: No justified precise type expectation"])
        result = controller.result(progress)
        sdk, github = SDK(AsyncMock(), "gpt-6.1-sol", 180), GitHub()
        args = assess_issues.arguments(["--issue", "11037", "--state-dir", str(controller.directory)])

        async def inspect(_agent, _prompt, scratch, **_kwargs):
            inputs = ValidityInput.model_validate_json((scratch / "input.json").read_bytes())
            self.assertIn(progress[0].reasons[0], inputs.claims[0].limitations)
            execution = [item for item in inputs.evidence if item.kind == "execution"]
            self.assertEqual([item.observation for item in execution], ["discovery_only"])
            raise ValueError("Offline refinement blocker inspection completed")

        with patch.object(sdk, "run", side_effect=inspect), patch.object(github, "screen", AsyncMock()):
            with self.assertRaisesRegex(ValueError, "inspection completed"):
                await assess_issues.validity_phase(controller, args, sdk, result, github=github)

    async def test_controls_are_sealed_and_all_original_targets_precede_controls(self):
        controller = self.controller()
        claim = controller.draft.claims[0]
        data = claim.model_dump()
        data["control_files"] = [{"path": "sample.py", "content": controller.prepared.files["sample.py"] + "\nreveal_type(value)\n"}]
        claim = AssessmentClaimDraft.model_validate(data)
        controller.draft.claims[0] = claim
        # A changed draft cannot upgrade an already frozen assessment.
        with self.assertRaises(ValueError):
            controller.freeze_verification("assignment", self.test_targets)
        other = self.root / "controls"
        other.mkdir()
        current = issue(body())
        capture = capture_report(current, [])
        draft = draft_for(capture)
        draft.claims[0] = AssessmentClaimDraft.model_validate({**draft.claims[0].model_dump(), "control_files": data["control_files"]})
        prepared = materialize_setup(capture, associations(draft), choices(draft))
        policy = AssessmentPolicy(
            input_hash=fingerprint({"issue": current.model_dump(mode="json"), "comments": []}),
            implementation_hash="implementation", profile_hash="profile", model="gpt-6.1-sol",
        )
        plan = build_plan(policy, draft, capture, prepared, report_text(current, []))
        controller = AssessmentController(other, policy, current, [], capture, draft, prepared, plan)
        verification = controller.freeze_verification("assignment", self.test_targets)
        self.assertTrue((other / "verification-assignment" / "control-inputs.json").is_file())
        await controller.verify(verification, self.store)
        self.assertEqual([str(cwd.parent.name) for _, cwd in self.calls], ["original"] * 3 + ["control"] * 3)

    async def test_missing_import_stderr_zero_files_and_precision_loss_stay_blocked(self):
        for mode in ("stderr", "missing_import", "zero", "precision"):
            with self.subTest(mode=mode):
                current_root = self.root
                self.root = current_root / mode
                controller = self.controller()
                plan = controller.freeze_verification("assignment", self.test_targets)

                async def bad_runner(command, cwd):
                    code, stdout, stderr = output(cwd, self.test_targets[0].version, broken=True)
                    data = json.loads(stdout)
                    if mode == "stderr":
                        stderr = "Unrecognized configuration"
                    elif mode == "missing_import":
                        data["generalDiagnostics"].append({"rule": "reportMissingImports", "message": "could not be resolved"})
                    elif mode == "zero":
                        data["summary"]["filesAnalyzed"] = 0
                    else:
                        data["generalDiagnostics"][0]["message"] = 'Type of "value" is "Unknown"'
                    return code, json.dumps(data), stderr

                store = TargetStore(self.root / "cache", bad_runner)
                store.verify = lambda target: None
                receipts = await controller.verify(plan, store)
                self.assertTrue(all(receipt.observation == "blocked" for receipt in receipts))
                self.assertNotEqual(controller.verification_progress(plan, receipts).status, "complete")
                self.root = current_root

    async def test_discovery_refuses_main_and_tampered_frozen_inputs(self):
        controller = self.controller(partial=True)
        with self.assertRaises(ValidationError):
            controller.freeze_discovery("assignment", self.test_targets[1])
        plan = controller.freeze_discovery("assignment", self.test_targets[0])
        plan.inputs["sample.py"] = "value = None\n"
        with self.assertRaises(ValueError):
            await controller.discover(plan, self.store)
        self.assertEqual(len(self.calls), 0)

    async def test_exact_source_list_indentation_and_reported_configuration_preserved(self):
        controller = self.controller(report=body(indent=True))
        self.assertEqual(controller.prepared.files["sample.py"], "value = 1\nreveal_type(value)\nresult: int = value\n")
        self.assertEqual(controller.prepared.configuration, {"pythonVersion": "3.13", "typeCheckingMode": "standard"})
        self.assertEqual(original_inputs(controller.prepared)["sample.py"], controller.capture.blocks[0].content)

    async def test_deeper_ambiguous_container_and_missing_original_stay_honestly_blocked(self):
        current = issue("Original source absent.\n" + body(indent=True).replace("  ", "    "))
        capture = capture_report(current, [])
        self.assertEqual(capture.blocks, ())
        self.assertTrue(capture.limitations)
        draft = AssessmentDraft(
            schema_version=1, summary="Missing source", reported_version=None, version_quote=None,
            sources=[], setting_choices=[], limitations=[],
            claims=[AssessmentClaimDraft(
                id="original", summary="Source unobservable", report_quote="Original source absent.",
                surface="cli", source_ids=[], readiness="blocked", reasons=["Unsupported original fence"],
                verification=None, discovery=None, control_files=[],
            )],
        )
        prepared = materialize_setup(capture, [], [])
        policy = AssessmentPolicy(
            input_hash="offline", implementation_hash="offline", profile_hash="offline", model="offline",
        )
        plan = build_plan(policy, draft, capture, prepared, report_text(current, []))
        self.assertEqual(plan.readiness, "blocked")
        self.assertIsNone(plan.claims[0].verification)
        self.assertTrue(any("deeper" in item for item in plan.limitations))

    async def test_unavailable_static_setup_is_not_invented_or_installed(self):
        controller = self.controller(report=body().replace("value = 1", "import unavailable_dependency\nvalue = 1"))
        self.assertEqual(controller.plan.claims[0].readiness, "blocked")
        self.assertTrue(any("unsupported" in reason for reason in controller.plan.claims[0].reasons))
        self.assertEqual(self.calls, [])

    async def test_captured_reported_checker_version_cannot_silently_fall_back_to_issue_date(self):
        current = issue(body() + "\nPyright 1.1.414\n")
        capture = capture_report(current, [])
        draft = draft_for(capture)
        prepared = materialize_setup(capture, associations(draft), [])
        policy = AssessmentPolicy(input_hash="offline", implementation_hash="offline", profile_hash="offline", model="offline")
        with self.assertRaisesRegex(ValueError, "captured explicit Pyright version"):
            build_plan(policy, draft, capture, prepared, report_text(current, []))
        draft.reported_version, draft.version_quote = "1.1.414", "Pyright 1.1.414"
        self.assertEqual(build_plan(policy, draft, capture, prepared, report_text(current, [])).readiness, "ready")

    async def test_controller_setup_capabilities_are_frozen_and_never_model_prose(self):
        controller = self.controller(report=body().replace("value = 1", "import typing_extensions\nvalue = 1"))
        self.assertEqual(controller.plan.readiness, "blocked")
        requirements = inspect_requirements(controller.capture, controller.prepared)
        self.assertEqual(len(requirements), 1)
        target = self.test_targets[0]
        stub = Path(target.directory or "") / "dist" / "typeshed-fallback" / "stdlib" / "typing_extensions.pyi"
        stub.parent.mkdir(parents=True)
        stub.write_text("# Explicit fake offline bundled stub fixture\n", encoding="utf-8")
        capability = check_bundled_stub_capability(requirements[0], target, self.store.verify)
        self.assertEqual(capability.status, "available")
        policy = AssessmentPolicy.model_validate({
            **controller.policy.model_dump(),
            "setup_capabilities_hash": fingerprint([capability.model_dump(mode="json")]),
        })
        plan = build_plan(
            policy, controller.draft, controller.capture, controller.prepared, report_text(controller.issue, []),
            capabilities=[capability],
        )
        self.assertEqual(plan.readiness, "ready")
        saved = AssessmentController(
            self.root / "capability-resume", policy, controller.issue, [], controller.capture,
            controller.draft, controller.prepared, plan,
        )
        with patch.object(assess_issues, "implementation_hash", return_value="implementation"):
            resumed = assess_issues.load_controller(saved.directory)
        self.assertEqual(resumed.plan, plan)
        self.assertIsInstance(resumed.plan.capabilities[0].evidence, tuple)
        with self.assertRaisesRegex(ValueError, "frozen"):
            build_plan(controller.policy, controller.draft, controller.capture, controller.prepared,
                       report_text(controller.issue, []), capabilities=[capability])
        with self.assertRaises(ValidationError):
            AssessmentDraft.model_validate({**controller.draft.model_dump(), "capabilities": [capability.model_dump()]})

    async def test_every_action_surface_is_host_disallowed_even_for_complete_observations(self):
        controller = self.controller()
        for action in ("draft", "writer", "label", "create_label", "comment", "close", "publish", "RCA", "pending_ledger_resume"):
            with self.subTest(action=action), self.assertRaisesRegex(ValueError, "permanently read-only"):
                controller.require_read_only(action)
        result = controller.result([])
        with self.assertRaisesRegex(ValueError, "permanently read-only"):
            result.require_action()
        self.assertIsNone(result.action())

    async def test_unexecuted_target_is_explicit_not_negative(self):
        controller = self.controller()
        plan = controller.freeze_verification("assignment", self.test_targets)
        self.store.verify = lambda target: (_ for _ in ()).throw(ValueError("Missing trusted target"))
        receipts = await controller.verify(plan, self.store)
        self.assertEqual(self.calls, [])
        self.assertTrue(all(receipt.raw["kind"] == "assessment_unexecuted" for receipt in receipts))
        self.assertEqual(set(controller.verification_progress(plan, receipts).target_observations.values()), {"blocked"})

    async def test_saved_old_checkpoint_is_not_loaded_or_upgraded(self):
        path = self.root / "old"
        path.mkdir()
        (path / "entry.json").write_text('{"reproduction_stage":{"exploratory":true}}')
        with self.assertRaisesRegex(ValueError, "incompatible"):
            assess_issues.load_controller(path)
        controller = self.controller()
        controller.policy.allow_assumed_settings = True
        with self.assertRaises(ValueError):
            controller.require_identity()

    async def test_end_to_end_command_has_explicit_roles_and_all_discovery_before_main(self):
        from issue_review_validity import ValidityAssessment, ValidityInput, record_hash

        current = issue(body(diagnostic=False))
        capture = capture_report(current, [])
        draft = draft_for(capture, partial=True, unsupported=True)
        sdk = SDK(AsyncMock(), "gpt-6.1-sol", 180)
        github = GitHub()
        order = []
        args = assess_issues.arguments(["--issue", "11037", "--state-dir", str(self.root / "end-to-end")])
        original_runner = self.store.runner

        async def runner(command, cwd):
            target = next(target for target in self.test_targets if target.cli == command[1])
            order.append(target.role)
            return await original_runner(command, cwd)

        self.store.runner = runner

        async def run(agent, prompt, scratch, *, schema, validate, **kwargs):
            self.assertEqual(kwargs["native_tools"], [])
            self.assertEqual(kwargs["timeout"], 180)
            if schema is AssessmentDraft:
                order.append("readiness")
                content = draft.model_dump_json()
            elif schema is VerificationRefinement:
                order.append("refinement")
                receipt = AssessmentReceipt.model_validate_json(prompt.split("\nHistorical discovery ONLY:\n")[1])
                data = predicates()
                data["report_quote"] = draft.claims[0].report_quote
                content = VerificationRefinement(
                    schema_version=1, claim_id="assignment", discovery_id=receipt.id, readiness="ready",
                    verification=ReproductionClaim.model_validate(data), control_files=[], reasons=[],
                    explanation="Historical captured rejection scoped to frozen original assignment; verify afresh",
                ).model_dump_json()
            elif schema is ValidityAssessment:
                order.append("validity")
                inputs = ValidityInput.model_validate_json((scratch / "input.json").read_text())
                self.assertEqual({item.id for item in inputs.claims}, {"assignment", "editor"})
                self.assertTrue(all(
                    item.language_context is not None and item.language_context.target_python_version == "3.13"
                    and item.language_context.provenance == "reported" for item in inputs.claims
                ))
                self.assertEqual([item.kind for item in inputs.evidence].count("execution"), 3)
                self.assertTrue(all(item.provenance == "controller_execution" for item in inputs.evidence if item.kind == "execution"))
                self.assertTrue(all(
                    any("Readiness-stage reason" in limitation for limitation in claim.limitations)
                    for claim in inputs.claims
                ))
                self.assertTrue(any(
                    "Current controller progress: phase=verification, status=complete" in limitation
                    for limitation in inputs.claims[0].limitations
                ))
                content = json.dumps({
                    "schema_version": 1, "input_sha256": record_hash(inputs), "limitations": ["No authority supplied"],
                    "claims": [{
                        "claim_id": claim.id, "source_id": claim.source_id, "setup_id": claim.setup_id,
                        "disposition": "inconclusive", "status": "inconclusive", "confidence": "low",
                        "confidence_reason": "No applicable rule or policy retrieved", "scope": claim.context,
                        "basis": "insufficient", "reasoning": "Reproduction does not independently establish validity",
                        "rules": [], "precedents": [], "evidence_ids": claim.evidence_ids,
                        "counterevidence_ids": [], "counterevidence": "Alternative interpretations remain",
                        "counterevidence_status": "unresolved", "falsification": "Retrieve and apply the exact applicable rule",
                        "user_impact": "Reported behavior remains a concern", "assumptions": [],
                        "limitations": [], "information_requests": [{
                            "requested": "Applicable typing rule", "reason": "No normative evidence",
                            "distinguishes": "Bug from intended discretionary behavior",
                        }],
                    } for claim in inputs.claims],
                })
            else:
                raise AssertionError("No other model role is authorized")
            validate(content)
            return content

        with (
            patch.object(github, "issue", AsyncMock(return_value=current)),
            patch.object(github, "comments", AsyncMock(return_value=[])),
            patch.object(github, "screen", AsyncMock()),
            patch.object(github, "api", AsyncMock(side_effect=AssertionError("No extra GitHub endpoint"))),
            patch.object(sdk, "run", side_effect=run),
            patch.object(assess_issues, "choose_targets", AsyncMock(return_value=self.test_targets)),
            patch.object(assess_issues, "implementation_hash", return_value="offline-implementation"),
        ):
            result = await assess_issues.assess(args, github, sdk, store=self.store)
        self.assertEqual(order, ["readiness", "historical", "refinement", "historical", "main", "latest", "validity"])
        self.assertEqual(result.progress[0].status, "complete")
        self.assertEqual(result.progress[1].status, "blocked")
        self.assertIsNone(result.action())
        saved = json.loads((args.state_dir / "result-assess.json").read_text())
        self.assertEqual(saved["failures"], [])
        self.assertEqual(saved["proposed_labels"], [])
        self.assertIsNone(saved["state_reason"])
        self.assertEqual(saved["assessment"]["validity"]["claims"][0]["disposition"], "inconclusive")
        for finding in saved["assessment"]["validity"]["claims"]:
            self.assertIn("No whole-issue disposition or publication eligibility", finding["limitations"])
            self.assertIn("Target language setting only; no observed Python runtime behavior", finding["limitations"])

    async def test_multiple_discoveries_finish_before_main_and_schema_rejection_stops_later_model_roles(self):
        original_runner = self.store.runner
        for reject_schema in (False, True):
            with self.subTest(reject_schema=reject_schema):
                current = issue(body(diagnostic=False))
                capture = capture_report(current, [])
                draft = draft_for(capture, partial=True)
                draft.claims.append(draft.claims[0].model_copy(deep=True, update={
                    "id": "second", "summary": "Second explicitly separate scoped test claim",
                }))
                sdk, github = SDK(AsyncMock(), "gpt-6.1-sol", 180), GitHub()
                args = assess_issues.arguments([
                    "--issue", "11037", "--state-dir", str(self.root / str(reject_schema)),
                    *([] if reject_schema else ["--skip-validity"]),
                ])
                order = []

                async def runner(command, cwd):
                    target = next(target for target in self.test_targets if target.cli == command[1])
                    order.append(target.role)
                    return await original_runner(command, cwd)

                self.store.runner = runner

                async def run(agent, prompt, scratch, *, schema, validate, **kwargs):
                    if schema is AssessmentDraft:
                        order.append("readiness")
                        content = draft.model_dump_json()
                    elif schema is VerificationRefinement:
                        order.append("refinement")
                        if reject_schema:
                            raise AutomationError("HTTP 400 invalid response_format JSON schema")
                        receipt = AssessmentReceipt.model_validate_json(prompt.split("\nHistorical discovery ONLY:\n")[1])
                        data = {
                            **predicates(), "id": receipt.claim_id, "report_quote": draft.claims[0].report_quote,
                        }
                        content = VerificationRefinement(
                            schema_version=1, claim_id=receipt.claim_id, discovery_id=receipt.id, readiness="ready",
                            verification=ReproductionClaim.model_validate(data), control_files=[], reasons=[],
                            explanation="Exact captured scoped diagnostic; comparison requires fresh verification",
                        ).model_dump_json()
                    else:
                        raise AssertionError("No later model role may run after provider schema rejection")
                    validate(content)
                    return content

                with (
                    patch.object(github, "issue", AsyncMock(return_value=current)),
                    patch.object(github, "comments", AsyncMock(return_value=[])),
                    patch.object(github, "screen", AsyncMock()),
                    patch.object(sdk, "run", side_effect=run),
                    patch.object(assess_issues, "choose_targets", AsyncMock(return_value=self.test_targets)),
                    patch.object(assess_issues, "implementation_hash", return_value="offline"),
                ):
                    result = await assess_issues.assess(args, github, sdk, store=self.store)
                if reject_schema:
                    self.assertEqual(order, ["readiness", "historical", "refinement", "historical"])
                    self.assertTrue(result.failures)
                    self.assertEqual({item.status for item in result.progress}, {"captured"})
                else:
                    self.assertEqual(order[:5], ["readiness", "historical", "refinement", "historical", "refinement"])
                    self.assertEqual(order[5:], ["historical", "main", "latest"] * 2)
                    self.assertEqual({item.status for item in result.progress}, {"complete"})
                    self.assertEqual(result.failures, [])

    async def test_relative_state_directory_generates_absolute_probe_project_and_cwd_for_cli_and_api(self):
        current = issue(body())
        draft = draft_for(capture_report(current, []))
        github, sdk = GitHub(), SDK(AsyncMock(), "gpt-6.1-sol", 180)
        original_runner = self.store.runner

        async def runner(command, cwd):
            self.assertTrue(cwd.is_absolute())
            project = Path(command[command.index("--project") + 1])
            self.assertTrue(project.is_absolute())
            self.assertEqual(project, cwd / "pyrightconfig.json")
            return await original_runner(command, cwd)

        async def run(agent, prompt, scratch, *, validate, **kwargs):
            content = draft.model_dump_json()
            validate(content)
            return content

        self.store.runner = runner
        with (
            patch.object(github, "issue", AsyncMock(return_value=current)),
            patch.object(github, "comments", AsyncMock(return_value=[])),
            patch.object(github, "screen", AsyncMock()),
            patch.object(sdk, "run", side_effect=run),
            patch.object(assess_issues, "choose_targets", AsyncMock(return_value=self.test_targets)),
            patch.object(assess_issues, "implementation_hash", return_value="offline"),
        ):
            for programmatic in (False, True):
                with self.subTest(programmatic=programmatic), tempfile.TemporaryDirectory(dir=Path.cwd()) as temporary:
                    relative = Path(temporary).relative_to(Path.cwd()) / "run"
                    args = assess_issues.arguments([
                        "--issue", "11037", "--state-dir", str(relative), "--skip-validity",
                    ])
                    self.assertTrue(args.state_dir.is_absolute())
                    if programmatic:
                        args.state_dir = relative
                    self.calls.clear()
                    result = await assess_issues.assess(args, github, sdk, store=self.store)
                    self.assertEqual(args.state_dir, (Path.cwd() / relative).resolve())
                    self.assertEqual(len(self.calls), 3)
                    self.assertEqual(result.progress[0].status, "complete")
                    self.assertTrue((args.state_dir / "assessment.json").is_file())

    async def test_later_verification_failure_keeps_completed_observations_and_never_retries(self):
        controller = self.controller(unsupported=True)
        controller._implementation = lambda: "implementation"
        args = assess_issues.arguments([
            "--issue", "11037", "--state-dir", str(controller.directory), "--phase", "verify",
            "--claim", "assignment", "--skip-validity",
        ])
        github, sdk = GitHub(), SDK(AsyncMock(), "gpt-6.1-sol", 180)
        original_runner = self.store.runner

        async def runner(command, cwd):
            target = next(target for target in self.test_targets if target.cli == command[1])
            if target.role == "main":
                self.calls.append((command, cwd))
                raise OSError("Explicit offline missing target runner fixture")
            return await original_runner(command, cwd)

        self.store.runner = runner
        with (
            patch.object(assess_issues, "load_controller", return_value=controller),
            patch.object(assess_issues, "implementation_hash", return_value="implementation"),
            patch.object(assess_issues, "choose_targets", AsyncMock(return_value=self.test_targets)),
            patch.object(github, "screen", AsyncMock()),
            patch.object(sdk, "run", AsyncMock(side_effect=AssertionError("No model role in verify"))),
        ):
            result = await assess_issues.assess(args, github, sdk, store=self.store)
            with self.assertRaises(FileExistsError):
                await assess_issues.assess(args, github, sdk, store=self.store)
        self.assertEqual(result.progress[0].target_observations, {
            "historical": "reproduced", "main": "blocked", "latest": "not_reproduced",
        })
        self.assertEqual(result.progress[0].status, "partial")
        self.assertEqual(result.progress[1].status, "blocked")
        self.assertEqual(len(self.calls), 3)

    async def test_frozen_target_resume_reuses_assignment_without_network_or_new_acquisition(self):
        controller = self.controller()
        args = assess_issues.arguments(["--issue", "11037", "--state-dir", str(controller.directory)])
        request = {
            "registry": args.registry, "requested_main": args.main_sha, "catalog": None,
            "cache": str(self.store.directory.resolve()), "prepare_targets": False,
        }
        assess_issues.save(controller.directory / "target-selection.json", {
            "request": request, "targets": [target.model_dump(mode="json") for target in self.test_targets],
        })
        assess_issues.save(controller.directory / "targets.json", [target.model_dump(mode="json") for target in self.test_targets])
        github = GitHub()
        with patch.object(github, "api", AsyncMock(side_effect=AssertionError("No reselection"))):
            resumed = await assess_issues.choose_targets(args, controller, github, self.store)
            self.assertEqual(resumed, self.test_targets)
            args.main_sha = "c" * 40
            with self.assertRaisesRegex(ValueError, "incompatible"):
                await assess_issues.choose_targets(args, controller, github, self.store)

    async def test_readiness_failure_preserves_capture_policy_and_honest_blocked_record(self):
        args = assess_issues.arguments(["--issue", "11037", "--state-dir", str(self.root / "failed-readiness")])
        github, sdk = GitHub(), SDK(AsyncMock(), "gpt-6.1-sol", 180)
        agent = Agent.load(AGENTS / "pyright-issue-assessor.md", "pyright-issue-assessor")
        with (
            patch.object(github, "issue", AsyncMock(return_value=issue(body(diagnostic=False)))),
            patch.object(github, "comments", AsyncMock(return_value=[])),
            patch.object(github, "screen", AsyncMock()),
            patch.object(sdk, "run", AsyncMock(side_effect=TimeoutError("Original shared role allowance exhausted"))),
            patch.object(assess_issues, "implementation_hash", return_value="offline"),
        ):
            with self.assertRaises(TimeoutError):
                await assess_issues.readiness(args, github, sdk, agent)
        saved = json.loads((args.state_dir / "readiness-failure.json").read_text())
        self.assertEqual(saved["readiness"], "blocked")
        self.assertIsNone(saved["action"])
        self.assertTrue((args.state_dir / "capture.json").is_file())
        self.assertFalse((args.state_dir / "assessment.json").exists())

    def snapshot(self):
        current = issue(body()).model_copy(update={
            "number": 0, "html_url": "fixture:opaque-ae78", "created_at": None,
        })
        capture = capture_report(current, [], report_id="opaque-ae78")
        draft = draft_for(capture, unsupported=True)
        snapshot = AssessmentInput(
            report_id="opaque-ae78", origin="synthetic_contract", provenance="Controller-curated offline fixture",
            issue=current, comments=[], declared_claims=[DeclaredClaim(
                id=draft.claims[0].id, summary=draft.claims[0].summary,
            )], setting_choices=[], limitations=["No actual historical issue or target outcome is stipulated"],
            expected_original_hashes={"sample.py": hashlib.sha256(capture.blocks[0].content.encode()).hexdigest()},
            blind=True, target_selection_provenance="Explicit labelled fake targets, never a historical-date selection",
            frozen_targets_hash=fingerprint([target.model_dump(mode="json") for target in self.test_targets]),
            normative_evidence_hash=fingerprint([]),
        )
        return snapshot, draft

    async def test_frozen_input_runs_real_pipeline_without_issue_lookup_and_keeps_new_material_claims(self):
        from issue_review_validity import ValidityInput

        snapshot, draft = self.snapshot()
        args = assess_issues.arguments([
            "--issue", "0", "--state-dir", str(self.root / "frozen"), "--skip-validity",
        ])
        github, sdk = GitHub(), SDK(AsyncMock(), "gpt-6.1-sol", 180)

        async def run(agent, prompt, scratch, *, schema, validate, **kwargs):
            self.assertIs(schema, AssessmentDraft)
            self.assertIn("EXACT declared IDs AND summaries", prompt)
            self.assertNotIn("expected_original_hashes", prompt)
            content = draft.model_dump_json()
            validate(content)
            return content

        with (
            patch.object(github, "issue", AsyncMock(side_effect=AssertionError("No live issue"))),
            patch.object(github, "comments", AsyncMock(side_effect=AssertionError("No live comments"))),
            patch.object(github, "api", AsyncMock(side_effect=AssertionError("No identity/research/target lookup"))),
            patch.object(github, "screen", AsyncMock()),
            patch.object(sdk, "run", side_effect=run),
            patch.object(assess_issues, "implementation_hash", return_value="offline"),
        ):
            result = await assess_issues.assess(
                args, github, sdk, store=self.store, assessment_input=snapshot, frozen_targets=self.test_targets,
            )
            controller = assess_issues.load_controller(args.state_dir)

            async def inspect_identity(agent, prompt, scratch, **kwargs):
                inputs = ValidityInput.model_validate_json((scratch / "input.json").read_text())
                self.assertEqual(inputs.report_id, snapshot.report_id)
                self.assertNotEqual(inputs.report_id, "0")
                raise ValueError("Offline frozen validity identity inspection completed")

            with patch.object(sdk, "run", side_effect=inspect_identity):
                with self.assertRaisesRegex(ValueError, "identity inspection completed"):
                    await assess_issues.validity_phase(controller, args, sdk, result, github=github)
        self.assertEqual({claim.id for claim in result.plan.claims}, {"assignment", "editor"})
        self.assertEqual(result.progress[0].status, "complete")
        self.assertEqual(result.progress[1].status, "blocked")
        self.assertEqual(result.policy.assessment_input_hash, fingerprint(snapshot.model_dump(mode="json")))
        saved = json.loads((args.state_dir / "assessment.json").read_text())
        self.assertEqual(saved["capture"]["report_id"], snapshot.report_id)
        self.assertEqual(saved["issue"]["number"], 0)
        self.assertIsNone(saved["issue"]["created_at"])
        self.assertEqual(json.loads((args.state_dir / "target-selection.json").read_text())["mode"], "controller_frozen")

    async def test_missing_or_renamed_declared_scope_is_invalid_not_guessed_or_mapped(self):
        snapshot, draft = self.snapshot()
        capture = capture_report(snapshot.issue, [], report_id=snapshot.report_id)
        prepared = materialize_setup(capture, associations(draft), [])
        policy = AssessmentPolicy(
            input_hash="offline", implementation_hash="offline", profile_hash="offline", model="offline",
            assessment_input_hash=fingerprint(snapshot.model_dump(mode="json")),
        )
        draft.claims[0].summary = "A different scope"
        with self.assertRaisesRegex(ValueError, "declared scope"):
            build_plan(policy, draft, capture, prepared, report_text(snapshot.issue, []), assessment_input=snapshot)

    async def test_frozen_source_manifest_mismatch_blocks_before_any_checker(self):
        snapshot, draft = self.snapshot()
        snapshot.expected_original_hashes["sample.py"] = "0" * 64
        capture = capture_report(snapshot.issue, [], report_id=snapshot.report_id)
        prepared = materialize_setup(capture, associations(draft), [])
        policy = AssessmentPolicy(
            input_hash="offline", implementation_hash="offline", profile_hash="offline", model="offline",
            assessment_input_hash=fingerprint(snapshot.model_dump(mode="json")),
        )
        with self.assertRaisesRegex(ValueError, "frozen original manifest"):
            build_plan(policy, draft, capture, prepared, report_text(snapshot.issue, []), assessment_input=snapshot)
        self.assertEqual(self.calls, [])

    async def test_blind_source_or_target_drift_and_research_flags_stop_before_dispatch(self):
        snapshot, _ = self.snapshot()
        assumed = snapshot.model_copy(deep=True)
        assert assumed.issue.body is not None
        assumed.issue.body = assumed.issue.body.replace('typeCheckingMode="standard"\n', "")
        assumed.setting_choices = [SettingChoice(
            setting="typeCheckingMode", value="standard", reason="Bounded experimental choice for omitted checking mode",
        )]
        github, sdk = GitHub(), SDK(AsyncMock(), "gpt-6.1-sol", 180)
        cases = (
            (["--reference", "https://github.com/microsoft/pyright/issues/1"], snapshot, None),
            ([], snapshot.model_copy(update={"normative_evidence_hash": "0" * 64}), None),
            ([], snapshot.model_copy(update={"frozen_targets_hash": "0" * 64}), self.test_targets),
            ([], assumed, None),
            (["--issue", "11037"], snapshot, None),
        )
        with (
            patch.object(sdk, "run", AsyncMock(side_effect=AssertionError("No unapproved role"))),
            patch.object(github, "screen", AsyncMock(side_effect=AssertionError("Rejected before issue input"))),
        ):
            for flags, value, targets_value in cases:
                args = assess_issues.arguments([
                    "--issue", "0", "--state-dir", str(self.root / "never-created"), *flags,
                ])
                with self.subTest(flags=flags), self.assertRaises(ValueError):
                    await assess_issues.assess(
                        args, github, sdk, store=self.store, assessment_input=value, frozen_targets=targets_value,
                    )
        self.assertFalse((self.root / "never-created").exists())

    async def test_resume_cannot_add_normative_sources_when_frozen_input_authorized_none(self):
        from issue_review_validity import ValidityEvidence, content_hash

        snapshot, draft = self.snapshot()
        snapshot.normative_evidence_hash = None
        args = assess_issues.arguments([
            "--issue", "0", "--state-dir", str(self.root / "normative-replay"), "--phase", "readiness",
        ])
        github, sdk = GitHub(), SDK(AsyncMock(), "gpt-6.1-sol", 180)

        async def run(agent, prompt, scratch, *, validate, **kwargs):
            content = draft.model_dump_json()
            validate(content)
            return content

        with (
            patch.object(assess_issues, "implementation_hash", return_value="offline"),
            patch.object(github, "screen", AsyncMock()),
            patch.object(sdk, "run", side_effect=run),
        ):
            await assess_issues.assess(args, github, sdk, assessment_input=snapshot)
            content = "Explicit synthetic reference fixture; no authority was retrieved or authorized."
            injected = ValidityEvidence(
                id="unauthorized-reference", kind="typing_spec", provenance="synthetic_fixture",
                location="https://typing.python.org/en/latest/spec/annotations.html",
                section="Synthetic offline replay guard fixture", content=content, sha256=content_hash(content),
                claim_ids=["assignment"], source_id=None, setup_id=None, target="not_applicable",
                observation="not_applicable", version=None, retrieved_at="2025-10-22T00:00:00Z",
            )
            (args.state_dir / "frozen-normative-evidence.json").write_text(json.dumps([
                injected.model_dump(mode="json"),
            ]), encoding="utf-8")
            args.phase = "validity"
            with (
                patch.object(sdk, "run", AsyncMock(side_effect=AssertionError("No unapproved role"))),
                patch.object(github, "screen", AsyncMock(side_effect=AssertionError("Reject before rescreen"))),
            ):
                with self.assertRaisesRegex(ValueError, "frozen assessment input"):
                    await assess_issues.assess(args, github, sdk)
        self.assertFalse((args.state_dir / "started-validity.json").exists())

    async def test_synthetic_input_cannot_borrow_live_issue_identity_or_creation_date(self):
        snapshot, _ = self.snapshot()
        for change in ({"number": 11037}, {"created_at": "2025-10-16T00:00:00Z"}, {"html_url": "https://github.com/microsoft/pyright/issues/1"}):
            with self.subTest(change=change), self.assertRaises(ValidationError):
                AssessmentInput.model_validate({
                    **snapshot.model_dump(), "issue": snapshot.issue.model_copy(update=change),
                })

    async def test_authority_reader_rejects_unapproved_urls_without_github_access(self):
        from issue_review_validity import ReferenceRead

        github = GitHub()
        with patch.object(github, "api", AsyncMock(side_effect=AssertionError("No unapproved GET"))):
            for location in (
                "file:///private/secret", "https://attacker.invalid/spec.html",
                "https://github.com/microsoft/pyright/blob/main/docs/type-concepts.md",
                "https://github.com/microsoft/pyright/issues/1?token=secret",
                "https://typing.python.org/en/latest/spec/",
            ):
                with self.subTest(location=location), self.assertRaises(ValueError):
                    await assess_issues.AssessmentReferenceReader(github).read_reference(ReferenceRead(location=location))

    async def test_pinned_policy_and_precedent_retrieval_are_bounded_get_only(self):
        from issue_review_validity import ReferenceRead

        github = GitHub()
        content = "Documented project behavior.\n" * 200
        requests = []

        async def api(method, endpoint):
            requests.append((method, endpoint))
            if "/contents/" in endpoint:
                return {"encoding": "base64", "content": base64.b64encode(content.encode()).decode()}
            if "/comments" in endpoint:
                return [{"body": "A scoped decision", "author_association": "MEMBER"}]
            return {"title": "Prior discussion", "body": "A closely related scenario", "created_at": "2025-10-01"}

        with patch.object(github, "api", side_effect=api):
            reader = assess_issues.AssessmentReferenceReader(github)
            page = await reader.read_reference(ReferenceRead(
                location="https://github.com/microsoft/pyright/blob/" + "a" * 40 + "/docs/type-concepts.md",
            ))
            self.assertEqual(len(page.content), 4000)
            self.assertEqual(page.total_chars, len(content))
            precedent = await reader.read_reference(ReferenceRead(location="https://github.com/microsoft/pyright/issues/42"))
            self.assertIn("A scoped decision", precedent.content)
        self.assertTrue(all(method == "GET" for method, _ in requests))
        self.assertEqual(requests[0][1], "repos/microsoft/pyright/contents/docs/type-concepts.md?ref=" + "a" * 40)
        self.assertEqual(len(requests), 3)


class SDKTests(unittest.IsolatedAsyncioTestCase):
    async def test_honest_partial_wire_uses_one_shared_sdk_correction_budget(self):
        with tempfile.TemporaryDirectory() as temporary:
            scratch = Path(temporary)
            agent = Agent.load(AGENTS / "pyright-issue-assessor.md", "pyright-issue-assessor")
            capture = capture_report(issue(body(diagnostic=False)), [])
            valid = draft_for(capture, partial=True).model_dump_json()
            session, client = AsyncMock(), AsyncMock()
            session.session_id = "offline-assessment"
            session.rpc.agent.get_current.return_value = SimpleNamespace(agent=SimpleNamespace(name=agent.name))
            session.rpc.tools.get_current_metadata.return_value = SimpleNamespace(tools=[])
            session.send_and_wait.side_effect = [
                SimpleNamespace(data=AssistantMessageData(content='{"schema_version":1}', message_id="invalid")),
                SimpleNamespace(data=AssistantMessageData(content=valid, message_id="valid")),
            ]
            client.create_session.return_value = session
            seen = []
            content = await SDK(client, "gpt-6.1-sol", 180).run(
                agent, "Offline honest assessment", scratch, schema=AssessmentDraft,
                native_tools=[], timeout=180, validate=seen.append,
            )
            self.assertEqual(AssessmentDraft.model_validate_json(content).claims[0].readiness, "partial")
            self.assertEqual(len(seen), 1)
            self.assertEqual(session.send_and_wait.await_count, 2)
            self.assertEqual(client.create_session.call_args.kwargs["available_tools"], [])
            records = [json.loads(line) for line in (scratch / "sdk-events.jsonl").read_text().splitlines()]
            waits = [record["data"] for record in records if record["type"] == "controller.lifecycle"
                     and record["data"]["phase"] == "response_wait"]
            self.assertLess(waits[1]["remaining_active_seconds"], waits[0]["remaining_active_seconds"])
            self.assertTrue((scratch / "pyright-issue-assessor-decoded-response-2.json").is_file())
            correction = session.send_and_wait.call_args_list[1].args[0]
            self.assertIn("planning stages", correction)
            self.assertNotIn("If execution was unavailable", correction)

    async def test_validity_correction_uses_exact_evidence_binding_feedback_and_controller_metadata(self):
        from issue_review_validity import (
            ValidityAssessment, finalize_validity_response,
        )
        from test_issue_review_validity import assessment, inputs

        frozen = inputs()
        proposal = assessment(frozen).model_dump()
        proposal["claims"][0]["rules"][0]["section"] = "Wrong human-readable section"
        proposal["claims"][0]["limitations"] = []
        corrected = json.loads(json.dumps(proposal))
        corrected["claims"][0]["rules"][0]["section"] = None
        with tempfile.TemporaryDirectory() as temporary:
            scratch = Path(temporary)
            agent = Agent.load(AGENTS / "pyright-issue-assessment-validity.md", "pyright-issue-assessment-validity")
            session, client = AsyncMock(), AsyncMock()
            session.session_id = "offline-validity-correction"
            session.rpc.agent.get_current.return_value = SimpleNamespace(agent=SimpleNamespace(name=agent.name))
            session.rpc.tools.get_current_metadata.return_value = SimpleNamespace(tools=[])
            session.send_and_wait.side_effect = [
                SimpleNamespace(data=AssistantMessageData(content=json.dumps(proposal), message_id="wrong")),
                SimpleNamespace(data=AssistantMessageData(content=json.dumps(corrected), message_id="corrected")),
            ]
            client.create_session.return_value = session

            def validate(content):
                finalize_validity_response(frozen, ValidityAssessment.model_validate_json(content))

            raw = await SDK(client, "gpt-6.1-sol", 180).run(
                agent, "Offline validity correction", scratch, schema=ValidityAssessment,
                native_tools=[], timeout=180, validate=validate,
            )
            result = finalize_validity_response(frozen, ValidityAssessment.model_validate_json(raw))
            self.assertEqual(result.claims[0].rules[0].section, frozen.evidence[2].section)
            self.assertEqual(result.claims[0].limitations, frozen.claims[0].limitations)
            self.assertEqual(session.send_and_wait.await_count, 2)
            correction = session.send_and_wait.call_args_list[1].args[0]
            self.assertIn("rule.section=null", correction)
            self.assertIn("Variable annotations", correction)
            self.assertIn("controller attachment", correction)
            decoded = json.loads((scratch / "pyright-issue-assessment-validity-decoded-response-2.json").read_bytes())
            self.assertIsNone(decoded["claims"][0]["rules"][0]["section"])
            self.assertEqual(decoded["claims"][0]["limitations"], [])
            records = [json.loads(line) for line in (scratch / "sdk-events.jsonl").read_text().splitlines()]
            waits = [item["data"]["remaining_active_seconds"] for item in records
                     if item["type"] == "controller.lifecycle" and item["data"]["phase"] == "response_wait"]
            self.assertLess(waits[1], waits[0])


if __name__ == "__main__":
    unittest.main()
