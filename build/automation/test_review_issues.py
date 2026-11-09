# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

import asyncio
import json
import logging
import os
import subprocess
import sys
import tempfile
import time
import tomllib
import unittest
from argparse import Namespace
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from copilot import ToolInvocation
from copilot._jsonrpc import JsonRpcError, ProcessExitedError
from copilot.generated.rpc import PermissionDecisionApproveOnce, PermissionDecisionReject
from copilot.generated.session_events import (
    AssistantMessageData,
    AssistantMessageDeltaData,
    AssistantReasoningData,
    AssistantReasoningDeltaData,
    AssistantTurnEndData,
    AssistantTurnStartData,
    AssistantTurnRetryData,
    AssistantUsageData,
    ModelCallFailureData,
    ModelCallFailureSource,
    ModelCallStartData,
    PermissionRequestRead,
    PermissionRequestShell,
    PermissionRequestWrite,
    SessionEvent,
    SessionEventType,
    SessionIdleData,
    SessionIndexedSearchData,
    SessionMode,
    UserMessageData,
)
from copilot.session import CopilotSession
from pydantic import JsonValue, ValidationError

from issue_review_models import (
    Adjudication,
    Audit,
    BlockedChallenge,
    DraftCheck,
    DuplicateCandidate,
    DuplicateEvidence,
    DuplicateFindings,
    DuplicateReport,
    Entry,
    ExploratoryReproductionScenario,
    HistoricalSearch,
    Issue,
    Label,
    ReviewFindings,
    ReproductionGate,
    ReconstructionResponse,
    ReproductionPlan,
    ReproductionScenario,
    RootCause,
    RootCauseChallenge,
    RootCauseFindings,
    RootCauseGate,
)
from issue_review_sdk_diagnostics import RuntimeDiagnostics, WhitespaceStallGuard
from review_issues import (
    AGENTS,
    REPOSITORY,
    ROOT,
    SDK,
    SDKRecovery,
    Agent,
    AutomationError,
    Console,
    ChunkResult,
    CheckPreflight,
    GitHub,
    GitHubRead,
    InvestigationTools,
    ReproductionEvidenceTools,
    RunCheck,
    atomic_write,
    arguments,
    chunk_table,
    claim_evidence_summary,
    context_hash,
    dry_run_proposal,
    main as review_main,
    reject_operator_approval,
    require_run_mode,
    review_reproduction_errors,
    review_validation_feedback,
    validate_review_execution,
    validate_reproduction_report,
    response_schema,
    save_dry_run_proposals,
    save_overnight_report,
    state_lock,
)


def issue() -> Issue:
    return Issue(
        number=123, title="A precise report", body="A small reproducer", comments=0,
        state="open", updated_at="2026-01-01T00:00:00Z",
        html_url=f"https://github.com/{REPOSITORY}/issues/123", labels=[Label(name="bug")],
    )


def audit() -> Audit:
    return Audit.model_validate({
        "schema_version": 1, "repository": REPOSITORY, "issue_number": 123,
        "issue_url": issue().html_url, "issue_updated_at": issue().updated_at,
        "reviewed_at": "2026-01-01T01:00:00Z", "checkout_revision": "a" * 40,
        "summary": "The rejection follows the applicable static rule.",
        "claims": [{
            "id": "claim", "summary": "A rejected assignment",
            "disposition": "specification_correct", "confidence": "high",
            "confidence_reason": "The rule and counterexample agree",
            "reproduction": [
                {"target": "reported_release", "version": None, "status": "not_attempted", "check_ids": []},
                {"target": "current_release", "version": None, "status": "not_attempted", "check_ids": []},
                {"target": "checkout", "version": "1.1.414", "status": "reproduced", "check_ids": ["check"]},
            ],
            "basis": "An applicable rule explains this diagnostic", "source_ids": ["spec"],
            "counterevidence": "Runtime acceptance does not prove a static assignment",
            "falsification": "A different applicable assignment rule", "user_impact": "A clearer diagnostic could help",
            "expectation": {
                "kind": "mandatory_rule", "expected_behavior": "Reject the incompatible assignment",
                "reason": "The applicable assignment requirement establishes this expectation",
                "evidence": [{
                    "source_id": "spec", "authority": "typing_requirement", "excerpt": "An assignment rule",
                    "application": "This fixture's assignment has the rule's incompatible types",
                }],
            },
        }],
        "checks": [{
            "id": "check", "status": "executed", "command": "node pyright.js",
            "cwd": "scratch", "exit_code": 1, "observations": "reportAssignmentType at line 1",
        }],
        "sources": [{
            "id": "spec", "kind": "typing_spec", "location": "https://typing.python.org/en/latest/spec/",
            "finding": "An assignment rule", "applicability": "Applies to this case",
        }],
        "historical_searches": [{"query": "assignment", "outcome": "Competing decisions inspected"}],
        "uncertainties": ["Releases and mypy were not independently executed"],
        "next_action": "Explain the rule",
    })


def no_duplicates() -> DuplicateReport:
    return DuplicateReport(
        repository=REPOSITORY, issue_number=123, summary="No shared cause found in bounded searches",
        candidates=[], uncertainties=[], search_complete=True,
        searches=[HistoricalSearch(query="assignment", outcome="Strongest candidates inspected; no duplicate found")],
    )


def lsp_findings() -> ReviewFindings:
    report = audit()
    report.product_surface = "language_server"
    report.claims[0].id = "policy-attribution"
    control = report.claims[0].model_copy(deep=True)
    control.id, control.summary = "cli-control", "Ancillary CLI observation, not integration reproduction"
    report.claims.append(control)
    report.sources[0].kind, report.sources[0].location = "repository", r"fixture\tests\intent.py"
    for claim in report.claims:
        assert claim.expectation is not None
        claim.expectation.kind = "intended_behavior"
        claim.expectation.evidence[0].authority = "accepted_policy"
        claim.expectation.evidence[0].intent_basis = "regression_test"
        for reproduction in claim.reproduction:
            reproduction.status = "blocked"
    return ReviewFindings(
        markdown="# Findings\n\nIntegration reproduction is blocked; the CLI control is an executed observation only.",
        audit=report,
    )


def search_record() -> dict[str, JsonValue]:
    return {
        "tool": "github_read", "request": {"operation": "search", "query": "assignment"},
        "investigator": "duplicates",
        "result": {"incomplete_results": False, "items": []},
    }


def product_record(report: Audit) -> dict[str, JsonValue]:
    return {
        "kind": "pyright", "command": report.checks[0].command, "cwd": report.checks[0].cwd,
        "investigator": "review",
        "exit_code": report.checks[0].exit_code, "stdout": '{"version":"1.1.414","generalDiagnostics":[]}',
        "stderr": "", "inputs": [{"file": "sample.py", "content": "value: int = 'wrong'\n"}],
    }


def save_evidence(console: Console, entry: Entry, *, validity: str = "by design") -> None:
    entry.review_markdown = "# Behavior findings\n\nAn applicable rule and observed product check.\n"
    entry.duplicates_markdown = "# Duplicate findings\n\nNo shared cause found in a bounded search.\n"
    entry.duplicates = entry.duplicates or no_duplicates()
    directory = console.directory(entry.issue.number)
    atomic_write(directory / "review.md", entry.review_markdown)
    atomic_write(directory / "duplicates.md", entry.duplicates_markdown)
    assert entry.review is not None
    atomic_write(directory / "checks.jsonl", "\n".join(
        json.dumps(record) for record in (product_record(entry.review), search_record())
    ) + "\n")
    entry.adjudication = Adjudication.model_validate({
        "issue_number": entry.issue.number, "report_hash": console.report_hash(entry),
        "validity": validity, "duplicate_status": "no dupe found", "duplicate_of": None,
        "rationale": "The inspected reports and observed product evidence support these tags.",
    })


class FakeGitHub(GitHub):
    def __init__(self):
        super().__init__()
        self.current = issue()
        self.discussion: list[JsonValue] = []
        self.mutations: list[str] = []
        self.fail: str | None = None
        self.ambiguous_comment = False
        self.change_after_comment = False
        self.canonical = issue().model_copy(update={
            "number": 456, "html_url": f"https://github.com/{REPOSITORY}/issues/456",
        })

    async def screen(self, value: JsonValue, directory: Path, source: str) -> None:
        """Existing workflow fixtures are trusted; safety tests exercise the real gate separately."""

    async def issue(self, number: int) -> Issue:
        return (self.current if number == 123 else self.canonical).model_copy(deep=True)

    async def comments(self, number: int) -> list[JsonValue]:
        return json.loads(json.dumps(self.discussion))

    async def login(self) -> str:
        return "reviewer"

    def touch(self) -> None:
        self.current.updated_at = f"2026-01-01T00:01:{len(self.mutations):02d}Z"

    async def api(self, method: str, endpoint: str, payload: JsonValue = None, *, pages: bool = False) -> JsonValue:
        operation = endpoint.rsplit("/", 1)[-1] if method == "POST" else "close"
        self.mutations.append(operation)
        if self.fail == operation:
            raise AutomationError(f"Simulated {operation} failure")
        if operation == "comments":
            if not isinstance(payload, dict):
                raise AssertionError("Missing comment body")
            comment: JsonValue = {
                "id": 7, "html_url": "https://github.com/microsoft/pyright/issues/123#issuecomment-7",
                "body": payload["body"], "user": {"login": "reviewer"},
            }
            self.discussion.append(comment)
            self.current.comments += 1
            if self.change_after_comment:
                self.current.body = "A material reporter correction"
            self.touch()
            if self.ambiguous_comment:
                self.ambiguous_comment = False
                raise AutomationError("Network response lost after successful comment publication")
            return comment
        if operation == "labels":
            self.current.labels.append(Label(name="as designed"))
        elif operation == "close":
            self.current.state, self.current.state_reason = "closed", "not_planned"
        else:
            raise AssertionError(f"Unexpected mutation {operation}")
        self.touch()
        return {}


class ContextTests(unittest.TestCase):
    def test_evidence_delivery_code_is_part_of_the_resume_fingerprint(self):
        module = ROOT / "build" / "automation" / "issue_review_evidence.py"
        with patch("review_issues.git", return_value="fixed"), patch.object(Path, "read_bytes", return_value=b"unchanged"):
            before = context_hash([], "test")
            with patch.object(Path, "read_bytes", lambda path: b"changed" if path == module else b"unchanged"):
                after = context_hash([], "test")
        self.assertNotEqual(before, after)


class ModelTests(unittest.TestCase):
    def test_concern_grouping_retains_diagnostic_detail_and_does_not_merge_independent_uncertainty(self):
        report = audit()
        report.claims[0].summary = "Reject an unsupported construction"
        report.checks[0].observations = "Primary rejection; secondary call mismatch; Unknown member; Unknown argument"
        self.assertTrue(report.design_claims_supported())
        independent = report.claims[0].model_copy(deep=True)
        independent.id = "independent-recovery-concern"
        independent.summary = "The reporter separately alleges incorrect error recovery"
        independent.confidence = "medium"
        report.claims.append(independent)
        checked = Audit.model_validate_json(report.model_dump_json())
        self.assertFalse(checked.design_claims_supported())
        self.assertEqual(len(checked.claims), 2)
        self.assertEqual(checked.claims[1].confidence, "medium")
        self.assertIn("Unknown argument", checked.checks[0].observations)

    def test_reproduction_policy_feedback_matches_host_rejection(self):
        for surface in ("cli", "language_server", "editor", "packaging", "other"):
            for status in ("reproduced", "not_reproduced", "blocked", "not_attempted", "not_applicable"):
                for target_index in range(3):
                    with self.subTest(surface=surface, status=status, target_index=target_index):
                        report = audit()
                        report.product_surface = surface
                        for target in report.claims[0].reproduction:
                            target.status = "blocked"
                        report.claims[0].reproduction[target_index].status = status
                        report.claims[0].reproduction[target_index].check_ids = ["check"]
                        errors = review_reproduction_errors(report.model_dump(mode="json"))
                        forbidden = status in {"reproduced", "not_reproduced"} and (
                            target_index != 2 or surface != "cli"
                        )
                        if forbidden:
                            self.assertEqual(len(errors), 1)
                            self.assertIn(f"audit.claims[0].reproduction[{target_index}].status", errors[0])
                            self.assertIn('claim "claim"', errors[0])
                            with self.assertRaises(AutomationError) as rejected:
                                validate_review_execution(report, [product_record(report)])
                            self.assertEqual(str(rejected.exception), errors[0])
                            raw = ReviewFindings(markdown="# Findings", audit=report).model_dump_json()
                            self.assertEqual(review_validation_feedback(raw, errors[0]), errors[0])
                        else:
                            self.assertEqual(errors, [])
                            validate_review_execution(report, [product_record(report)])

    def test_reproduction_feedback_collects_all_claims_and_targets_without_editing(self):
        findings = lsp_findings()
        findings.audit.claims[0].reproduction[0].status = "reproduced"
        findings.audit.claims[1].reproduction[1].status = "not_reproduced"
        findings.audit.claims[1].reproduction[2].status = "reproduced"
        raw = findings.model_dump_json()
        primary = "A separate source-authority validation error"
        feedback = review_validation_feedback(raw, primary)
        self.assertTrue(feedback.startswith(primary))
        for claim_index, target_index in ((0, 0), (1, 1), (1, 2)):
            self.assertIn(f"audit.claims[{claim_index}].reproduction[{target_index}].status", feedback)
        self.assertEqual(feedback.count("reviewer experiments do not establish faithful released-checker"), 2)
        self.assertIn("cli-control", feedback)
        self.assertIn("policy-attribution", feedback)
        self.assertEqual(findings.model_dump_json(), raw)

    def test_reproduction_feedback_preserves_schema_errors_for_malformed_records(self):
        cases: list[JsonValue] = [
            None, [], {}, {"audit": []}, {"audit": {"claims": None}},
            {"audit": {"claims": {}}},
            {"audit": {"product_surface": {}, "claims": [
                {"id": "control", "reproduction": [{"target": "checkout", "status": "reproduced"}]},
            ]}},
            {"audit": {"product_surface": "language_server", "claims": [
                None, [], {"reproduction": None}, {"reproduction": {}},
                {"id": {}, "reproduction": [
                    None, {}, {"target": {}, "status": {}}, {"target": [], "status": ["reproduced"]},
                ]},
            ]}},
        ]
        for raw in ["{"] + [json.dumps(case) for case in cases]:
            with self.subTest(raw=raw):
                with self.assertRaises(ValidationError) as rejected:
                    ReviewFindings.model_validate_json(raw)
                primary = str(rejected.exception)
                self.assertEqual(review_validation_feedback(raw, primary), primary)

    def test_partial_policy_feedback_does_not_certify_an_invalid_or_legacy_record(self):
        partial: JsonValue = {"audit": {"product_surface": "language_server", "claims": [{
            "id": "control", "reproduction": [{"target": "checkout", "status": "reproduced"}],
        }]}}
        raw = json.dumps(partial)
        with self.assertRaises(ValidationError) as rejected:
            ReviewFindings.model_validate_json(raw)
        feedback = review_validation_feedback(raw, str(rejected.exception))
        self.assertIn("non-CLI product surface", feedback)
        self.assertIn("audit.claims[0].reproduction[0].status", feedback)
        legacy = audit().model_dump(mode="json")
        del legacy["product_surface"]
        report = Audit.model_validate(legacy)
        self.assertEqual(report.product_surface, "cli")
        self.assertEqual(review_reproduction_errors(legacy), [])
        validate_review_execution(report, [product_record(report)])

    def test_supported_bug_survives_unresolved_unobserved_ancillary_claim(self):
        report = audit()
        report.claims[0].disposition = "bug"
        ancillary = report.claims[0].model_copy(deep=True)
        ancillary.id, ancillary.disposition, ancillary.confidence = "regression-history", "inconclusive", "low"
        for reproduction in ancillary.reproduction:
            reproduction.status, reproduction.check_ids = "blocked", []
        report.claims.append(ancillary)
        result = Adjudication(
            issue_number=123, report_hash="hash", validity="bug", duplicate_status="no dupe found",
            duplicate_of=None, rationale="Checkout bug observed; regression history remains unverified.",
        )
        result.validate_reports(report, no_duplicates())
        self.assertTrue(report.observed_bug())
        self.assertFalse(report.resolved_claims())
        self.assertFalse(report.closure_candidate())
        entry = Entry(input_hash="input", context_hash="context", issue=issue(), review=report,
                      duplicates=no_duplicates(), adjudication=result)
        self.assertIsNone(entry.closure_reason())
        result.validity = "by design"
        with self.assertRaises(ValueError):
            result.validate_reports(report, no_duplicates())
        result.validity = "bug"
        for mutation in ("confidence", "observed", "surface"):
            changed = report.model_copy(deep=True)
            if mutation == "confidence":
                changed.claims[0].confidence = "low"
            elif mutation == "observed":
                changed.claims[0].reproduction[2].status = "blocked"
            else:
                changed.product_surface = "language_server"
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                result.validate_reports(changed, no_duplicates())

    def test_keep_current_requires_explicit_complete_canonical_evidence(self):
        duplicates = no_duplicates()
        duplicates.candidates = [DuplicateCandidate(
            issue_number=456, relation="duplicate", confidence="high", shared_cause="Same established cause",
            differences="Older report is broader", canonical_reason="The current issue is the focused maintained report",
            canonical_issue_number=123, evidence=[DuplicateEvidence(
                url="https://github.com/microsoft/pyright/issues/456", finding="Same cause in the raw-name subcase",
            )],
        )]
        result = Adjudication(
            issue_number=123, report_hash="hash", validity="by design", duplicate_status="keep current",
            duplicate_of=None, rationale="Retain this report as canonical; do not close either report.",
        )
        result.validate_reports(audit(), duplicates)
        entry = Entry(input_hash="input", context_hash="context", issue=issue(), review=audit(),
                      duplicates=duplicates, adjudication=result)
        self.assertIsNone(entry.closure_reason())
        for mutation in ("incomplete", "unknown", "conflict", "unresolved", "no_link"):
            changed = duplicates.model_copy(deep=True)
            candidate = changed.candidates[0]
            if mutation == "incomplete":
                changed.search_complete = False
            elif mutation == "unknown":
                candidate.canonical_issue_number = None
            elif mutation == "conflict":
                candidate.canonical_issue_number = 456
            elif mutation == "unresolved":
                candidate.relation = "inconclusive"
            else:
                candidate.evidence[0].url = "https://example.test/unrelated"
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                result.validate_reports(audit(), changed)
        result.duplicate_status, result.duplicate_of = "dupe", 456
        with self.assertRaises(ValueError):
            result.validate_reports(audit(), duplicates)

    def test_policy_disposition_and_target_reproduction_are_reported_independently(self):
        report = audit()
        report.claims[0].reproduction[2].status = "not_reproduced"
        unresolved = report.claims[0].model_copy(deep=True)
        unresolved.id = "historical-diagnostic"
        unresolved.summary = "The historical diagnostic remains unresolved | not a policy verdict"
        unresolved.disposition = "inconclusive"
        unresolved.confidence = "medium"
        report.claims.append(unresolved)
        summary = claim_evidence_summary(report)
        self.assertIn("specification correct", summary)
        self.assertIn("inconclusive", summary)
        self.assertIn("not reproduced", summary)
        self.assertIn("Reported release", summary)
        self.assertIn("Current release", summary)
        self.assertIn("historical-diagnostic", summary)
        self.assertIn(r"\| not a policy verdict", summary)
        self.assertFalse(report.closure_candidate())

    def test_adjudication_does_not_force_binary_answers(self):
        review, duplicates = audit(), no_duplicates()
        result = Adjudication(
            issue_number=123, report_hash="hash", validity="needs investigation",
            duplicate_status="needs investigation", duplicate_of=None,
            rationale="The relevant product surface was unavailable.",
        )
        review.product_surface = "editor"
        review.claims[0].reproduction[2].status = "blocked"
        result.validate_reports(review, duplicates)
        for validity in ("by design", "bug"):
            forced = result.model_copy(update={"validity": validity})
            with self.assertRaises(ValueError):
                forced.validate_reports(review, duplicates)
        self.assertEqual(result.tags(), "needs investigation | needs investigation")

    def test_no_duplicate_requires_completed_search_and_resolved_candidates(self):
        result = Adjudication(
            issue_number=123, report_hash="hash", validity="by design",
            duplicate_status="no dupe found", duplicate_of=None, rationale="Evidence agrees.",
        )
        duplicates = no_duplicates()
        result.validate_reports(audit(), duplicates)
        for field, value in (("search_complete", False), ("searches", [])):
            changed = duplicates.model_copy(update={field: value})
            with self.assertRaises(ValueError):
                result.validate_reports(audit(), changed)

    def test_conservative_closure_gate(self):
        original = audit()
        self.assertTrue(original.closure_candidate())
        for disposition in ("bug", "stub_or_environment", "enhancement", "inconclusive"):
            changed = original.model_copy(deep=True)
            changed.claims[0].disposition = disposition
            self.assertFalse(changed.closure_candidate())
        for confidence in ("medium", "low"):
            changed = original.model_copy(deep=True)
            changed.claims[0].confidence = confidence
            self.assertFalse(changed.closure_candidate())
        changed = original.model_copy(deep=True)
        changed.claims[0].reproduction[2].status = "blocked"
        self.assertFalse(changed.closure_candidate())
        changed = original.model_copy(deep=True)
        changed.claims.append(original.claims[0].model_copy(update={"id": "other", "disposition": "bug"}))
        self.assertFalse(changed.closure_candidate())

    def test_rejects_unresolved_or_fabricated_evidence(self):
        for mutate in (
            lambda data: data["claims"][0].update(source_ids=["missing"]),
            lambda data: data["checks"][0].update(status="blocked"),
            lambda data: data["claims"][0]["reproduction"][2].update(check_ids=[]),
            lambda data: data["claims"][0]["reproduction"][2].update(target="reported_release"),
            lambda data: data.update(issue_number=124),
            lambda data: data.update(checkout_revision="not-a-sha"),
            lambda data: data.update(reviewed_at="2026-01-01"),
        ):
            data = json.loads(audit().model_dump_json())
            mutate(data)
            with self.assertRaises(ValidationError):
                Audit.model_validate(data)

    def test_duplicate_reports_and_fact_checks(self):
        report = {
            "repository": REPOSITORY, "issue_number": 123, "summary": "No established duplicate",
            "candidates": [], "uncertainties": ["Root cause still unconfirmed"],
        }
        self.assertEqual(DuplicateReport.model_validate(report).candidates, [])
        with self.assertRaises(ValidationError):
            DraftCheck(approved=True, problems=["An unsupported claim"])

    def test_state_lock_and_atomic_checkpoint(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            with state_lock(directory):
                with self.assertRaises(AutomationError):
                    with state_lock(directory):
                        self.fail("Acquired an already-held lock")
            atomic_write(directory / "report.json", "{}")
            self.assertEqual((directory / "report.json").read_text(), "{}")
            self.assertFalse((directory / "run.lock").exists())

    def test_agent_loading(self):
        profile = Agent.load(AGENTS / "pyright-issue-by-design-reviewer.md", "pyright-issue-by-design-reviewer")
        self.assertEqual(profile.config([], skill=True).get("skills"), ["pyright-issue-analysis"])
        with self.assertRaises(AutomationError):
            Agent.load(profile.path, "rich-mirror")

    def test_original_reviewer_remains_a_separate_nonexecuting_role(self):
        original = Agent.load(AGENTS / "pyright-issue-reviewer.md", "pyright-issue-reviewer")
        backlog = Agent.load(AGENTS / "pyright-issue-by-design-reviewer.md", "pyright-issue-by-design-reviewer")
        self.assertIn("Do not edit files, execute commands", original.prompt)
        self.assertIn("Maintainer response draft", original.prompt)
        self.assertNotIn("ReviewFindings", original.prompt)
        self.assertIn("ReviewFindings", backlog.prompt)
        self.assertIn("running the actual Pyright executable", backlog.prompt)
        self.assertNotEqual(original.path, backlog.path)

    def test_script_metadata_matches_development_requirements(self):
        directory = Path(__file__).parent
        script = (directory / "review_issues.py").read_text(encoding="utf-8")
        block = script.split("# /// script\n", 1)[1].split("# ///", 1)[0]
        metadata = tomllib.loads("\n".join(line[2:] for line in block.splitlines()))
        requirements = (directory / "requirements.txt").read_text(encoding="utf-8").splitlines()
        self.assertEqual(metadata["requires-python"], ">=3.11")
        self.assertCountEqual(metadata["dependencies"], requirements)

    def test_indexed_search_opt_out_diagnostic_is_supported_by_sdk(self):
        diagnostic = SessionIndexedSearchData.from_dict({
            "kind": "status", "disabledReason": "use_tgrep_false", "eligible": False,
        })
        assert diagnostic.disabled_reason is not None
        self.assertEqual(diagnostic.disabled_reason.value, "use_tgrep_false")

    def test_provider_schema_defers_unsupported_constraints_to_local_validation(self):
        wire_schema = json.dumps(response_schema(Audit))
        self.assertIn('"minItems": 1', wire_schema)
        self.assertNotIn('"minItems": 3', wire_schema)
        self.assertNotIn("exclusiveMinimum", wire_schema)
        invalid = json.loads(audit().model_dump_json())
        invalid["claims"][0]["reproduction"].pop()
        with self.assertRaises(ValidationError):
            Audit.model_validate(invalid)

    def test_all_response_schemas_require_every_property_recursively(self):
        def check(value: JsonValue):
            if isinstance(value, dict):
                properties = value.get("properties")
                if isinstance(properties, dict):
                    self.assertEqual(value.get("required"), list(properties))
                    self.assertIs(value.get("additionalProperties"), False)
                self.assertNotIn("default", value)
                for item in value.values():
                    check(item)
            elif isinstance(value, list):
                for item in value:
                    check(item)

        for model in (
            Audit, ReviewFindings, DuplicateReport, DuplicateFindings, Adjudication, DraftCheck,
            RootCauseFindings, RootCauseGate, RootCauseChallenge, ReproductionPlan, BlockedChallenge,
            ReproductionScenario, ExploratoryReproductionScenario, ReproductionGate,
        ):
            with self.subTest(model=model.__name__):
                check(response_schema(model))
        for model, names in ((Audit, ["product_surface"]), (DuplicateReport, ["searches", "search_complete"])):
            required = response_schema(model)["required"]
            assert isinstance(required, list)
            for name in names:
                self.assertIn(name, required)

    def test_strict_wire_schema_preserves_nullable_fields_and_local_defaults(self):
        schema = json.dumps(response_schema(Adjudication))
        self.assertIn('"type": "null"', schema)
        data = json.loads(audit().model_dump_json())
        data.pop("product_surface")
        self.assertEqual(Audit.model_validate(data).product_surface, "cli")

    def test_reproduction_wire_schemas_have_only_typed_closed_objects(self):
        def check(schema):
            if "$ref" not in schema and "anyOf" not in schema:
                self.assertIn("type", schema, "Strict response schemas cannot contain an unconstrained JsonValue")
            if schema.get("type") == "object":
                self.assertIs(schema.get("additionalProperties"), False)
                self.assertEqual(schema.get("required"), list(schema.get("properties", {})))
            for child in schema.get("$defs", {}).values():
                check(child)
            for child in schema.get("properties", {}).values():
                check(child)
            for child in schema.get("anyOf", []):
                check(child)
            if "items" in schema:
                check(schema["items"])
        for model in (ReproductionScenario, ExploratoryReproductionScenario, ReproductionGate, ReconstructionResponse):
            with self.subTest(model=model.__name__):
                schema = response_schema(model)
                self.assertEqual(schema["type"], "object")
                check(schema)

    def test_model_defaults_to_gpt_61_sol_and_can_be_overridden(self):
        with patch("sys.argv", ["review_issues.py"]):
            self.assertEqual(arguments().model, "gpt-6.1-sol")
        with patch("sys.argv", ["review_issues.py", "--model", "other-model"]):
            self.assertEqual(arguments().model, "other-model")


class ConsoleTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.enterContext(patch("review_issues.show"))
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.github = FakeGitHub()
        self.profile = Agent.load(AGENTS / "pyright-issue-by-design-reviewer.md", "pyright-issue-by-design-reviewer")
        self.console = Console(
            self.github, SDK(AsyncMock(), None, 30), Path(self.temporary.name),
            self.profile, self.profile, None, "context", "a" * 40, {},
        )
        snapshot = issue()
        self.entry = Entry(
            input_hash=self.console.key(snapshot), context_hash="context", issue=snapshot, review=audit(),
            comment="A supported conversational explanation.",
            draft_check=DraftCheck(approved=True, problems=[]),
        )
        save_evidence(self.console, self.entry)

    async def test_comment_precedes_label_and_close(self):
        await self.console.close(self.entry)
        self.assertEqual(self.github.mutations, ["comments", "labels", "close"])
        self.assertEqual(self.entry.decision, "closed")
        restored = self.console.load(123)
        assert restored is not None
        self.assertEqual(restored.decision, "closed")
        comment = self.github.discussion[0]
        assert isinstance(comment, dict)
        self.assertIn("pyright-issue-review:", str(comment["body"]))
        self.assertIn("bug", [label.name for label in self.github.current.labels])

    async def test_comment_failure_never_closes(self):
        self.github.fail = "comments"
        with self.assertRaises(AutomationError):
            await self.console.close(self.entry)
        self.assertEqual(self.github.mutations, ["comments"])
        self.assertEqual(self.github.current.state, "open")

    async def test_ambiguous_post_reconciles_without_duplicate(self):
        self.github.ambiguous_comment = True
        with self.assertRaises(AutomationError):
            await self.console.close(self.entry)
        restored = self.console.load(123)
        assert restored is not None
        await self.console.close(restored)
        self.assertEqual(self.github.mutations, ["comments", "labels", "close"])
        self.assertEqual(len(self.github.discussion), 1)

    async def test_label_failure_can_resume_without_duplicate(self):
        self.github.fail = "labels"
        with self.assertRaises(AutomationError):
            await self.console.close(self.entry)
        self.github.fail = None
        await self.console.close(self.entry)
        self.assertEqual(self.github.mutations, ["comments", "labels", "labels", "close"])
        self.assertEqual(len(self.github.discussion), 1)

    async def test_close_failure_preserves_post_and_label(self):
        self.github.fail = "close"
        with self.assertRaises(AutomationError):
            await self.console.close(self.entry)
        self.github.fail = None
        await self.console.close(self.entry)
        self.assertEqual(self.github.mutations, ["comments", "labels", "close", "close"])

    async def test_stale_review_is_not_closed(self):
        self.github.current.body = "A changed premise"
        with self.assertRaises(AutomationError):
            await self.console.close(self.entry)
        self.assertEqual(self.github.mutations, [])

    async def test_changed_local_inputs_never_publish(self):
        self.console.current_context = lambda: "a different source or profile"
        with self.assertRaises(AutomationError):
            await self.console.close(self.entry)
        self.assertEqual(self.github.mutations, [])

    async def test_concurrent_reporter_change_stops_after_comment(self):
        self.github.change_after_comment = True
        with self.assertRaises(AutomationError):
            await self.console.close(self.entry)
        self.assertEqual(self.github.mutations, ["comments"])
        self.assertEqual(self.github.current.state, "open")

    async def test_changed_discussion_prevents_resume(self):
        self.github.fail = "labels"
        with self.assertRaises(AutomationError):
            await self.console.close(self.entry)
        self.github.discussion.append({"id": 8, "body": "A material correction", "user": {"login": "reporter"}})
        self.github.current.comments += 1
        self.github.fail = None
        with self.assertRaises(AutomationError):
            await self.console.close(self.entry)
        self.assertNotIn("close", self.github.mutations)

    async def test_by_design_automatically_posts_explanation_and_closes_without_confirmation(self):
        self.console.ask = lambda _question: self.fail("Publication is automatic")
        self.console.writer = Agent(self.profile.path, "rich-mirror", "Writer", "Preserve facts.")
        with patch.object(self.console, "investigate_root_cause", AsyncMock()) as investigate:
            await self.console.decide(self.entry)
        investigate.assert_not_awaited()
        self.assertEqual(self.github.mutations, ["comments", "labels", "close"])
        self.assertIn(self.entry.comment or "", str(self.github.discussion[0]))

    async def test_mixed_or_read_only_reports_never_prompt_for_closure(self):
        self.console.ask = lambda _question: self.fail("Unexpected closure prompt")
        self.console.rca_enabled = False
        assert self.entry.review is not None
        self.entry.review.claims[0].disposition = "bug"
        save_evidence(self.console, self.entry, validity="bug")
        await self.console.decide(self.entry)
        saved = self.console.load(123)
        assert saved is not None
        self.assertEqual(saved.decision, "reviewed")
        self.entry.review = audit()
        save_evidence(self.console, self.entry)
        self.console.read_only = True
        await self.console.decide(self.entry)
        with self.assertRaises(AutomationError):
            await self.console.close(self.entry)
        self.assertEqual(self.github.mutations, [])

    async def test_dry_run_saves_action_and_claims_without_drafting_or_publication(self):
        self.console.read_only = True
        self.entry.comment, self.entry.draft_check = None, None
        with patch.object(self.console.sdk, "run", AsyncMock()) as run:
            await self.console.evaluate(self.entry)
            await self.console.decide(self.entry)
        result = ChunkResult(self.entry.issue, self.entry)
        save_dry_run_proposals(self.console.state, "context", [result], 1, rca_enabled=True)
        proposal = json.loads((self.console.state / "123" / "proposal.json").read_text(encoding="utf-8"))
        summary = json.loads((self.console.state / "proposals.json").read_text(encoding="utf-8"))
        self.assertEqual(proposal["proposed_action"], "close_by_design")
        self.assertTrue(proposal["by_design_closure_candidate"])
        self.assertFalse(proposal["publication_ready"])
        self.assertTrue(proposal["publication_checks_pending"])
        self.assertEqual(proposal["claims"][0]["confidence"], "high")
        self.assertEqual(proposal["reference_status"], "unreviewed")
        self.assertTrue(summary["complete"])
        run.assert_not_awaited()
        self.assertEqual(self.github.mutations, [])

    async def test_dry_run_proposal_respects_claim_confidence_and_duplicate_uncertainty(self):
        assert self.entry.review is not None
        self.entry.review.claims[0].confidence = "medium"
        save_evidence(self.console, self.entry, validity="needs investigation")
        proposal = dry_run_proposal(ChunkResult(self.entry.issue, self.entry), rca_enabled=False)
        self.assertEqual(proposal["proposed_action"], "leave_open")
        self.assertFalse(proposal["by_design_closure_candidate"])
        self.assertTrue(proposal["blocking_reasons"])
        self.entry.review = audit()
        save_evidence(self.console, self.entry)
        assert self.entry.adjudication is not None
        self.entry.adjudication.duplicate_status = "needs investigation"
        proposal = dry_run_proposal(ChunkResult(self.entry.issue, self.entry), rca_enabled=False)
        self.assertEqual(proposal["proposed_action"], "leave_open")
        self.assertIn("Duplicate investigation", str(proposal["blocking_reasons"]))

    async def test_dry_run_proposes_duplicate_precedence_and_preserves_failures(self):
        self.duplicate_entry()
        proposal = dry_run_proposal(ChunkResult(self.entry.issue, self.entry), rca_enabled=True)
        self.assertEqual(proposal["proposed_action"], "close_duplicate")
        self.assertEqual(proposal["duplicate_of"], 456)
        result = ChunkResult(self.entry.issue, self.entry, "failed", "Evidence validation failed")
        save_dry_run_proposals(self.console.state, "context", [result], 2, rca_enabled=True)
        summary = json.loads((self.console.state / "proposals.json").read_text(encoding="utf-8"))
        self.assertFalse(summary["complete"])
        self.assertEqual(summary["proposals"][0]["proposed_action"], "blocked")
        self.assertFalse(summary["proposals"][0]["by_design_closure_candidate"])
        self.assertEqual(self.github.mutations, [])

    async def test_partial_bug_does_not_weaken_duplicate_closure_and_is_completed_triage(self):
        self.duplicate_entry()
        assert self.entry.review is not None
        ancillary = self.entry.review.claims[0].model_copy(deep=True)
        ancillary.id, ancillary.disposition, ancillary.confidence = "numpy-example", "inconclusive", "low"
        self.entry.review.claims.append(ancillary)
        self.assertIsNone(self.entry.closure_reason())
        proposal = dry_run_proposal(ChunkResult(self.entry.issue, self.entry), rca_enabled=False, closure_only=True)
        self.assertEqual(proposal["proposed_action"], "leave_open")
        self.assertIn("Additional unresolved claims", str(proposal["blocking_reasons"]))
        self.assertNotIn("RCA disabled", str(proposal["blocking_reasons"]))
        result = ChunkResult(self.entry.issue, self.entry, proposal=proposal)
        save_overnight_report(self.console.state, "context", [self.entry.issue], [result], read_only=True, finished=True)
        report = json.loads((self.console.state / "overnight-report.json").read_text())
        self.assertEqual(report["counts"]["keep_open_bug"], 1)
        self.assertEqual(report["counts"]["needs_review"], 0)
        self.assertEqual(report["counts"]["would_close"], 0)
        self.assertEqual(report["issues"][0]["triage_category"], "keep_open_bug")
        markdown = (self.console.state / "overnight-report.md").read_text()
        self.assertIn("numpy-example", markdown)
        self.assertIn("Next action", markdown)
        self.assertEqual(self.github.mutations, [])

    async def test_keep_current_adjudication_requires_actual_counterpart_and_discussion_reads(self):
        self.duplicate_entry()
        assert self.entry.duplicates is not None
        self.entry.duplicates.candidates[0].canonical_issue_number = 123
        self.entry.adjudication = None
        result = Adjudication(
            issue_number=123, report_hash=self.console.report_hash(self.entry), validity="bug",
            duplicate_status="keep current", duplicate_of=None,
            rationale="The focused current issue should remain canonical.",
        )
        self.console.sdk.run = AsyncMock(return_value=result.model_dump_json())
        with self.assertRaisesRegex(AutomationError, "actual canonical issue and discussion reads"):
            await self.console.adjudicate(self.entry)
        path = self.console.directory(123) / "checks.jsonl"
        with path.open("a", encoding="utf-8") as stream:
            for operation, response in (("issue", self.github.canonical.model_dump(mode="json")), ("comments", [])):
                stream.write(json.dumps({
                    "tool": "github_read", "investigator": "duplicates", "request": {"operation": operation, "number": 456},
                    "result": response,
                }) + "\n")
        result.report_hash = self.console.report_hash(self.entry)
        self.console.sdk.run = AsyncMock(return_value=result.model_dump_json())
        await self.console.adjudicate(self.entry)
        self.assertEqual(self.entry.adjudication, result)
        self.assertIsNone(self.entry.closure_reason())
        self.assertIn("Keep current", chunk_table([ChunkResult(self.entry.issue, self.entry)], rca_enabled=False))
        self.assertEqual(self.github.mutations, [])

    async def test_overnight_distinguishes_service_failure_screening_and_missing_product_evidence(self):
        for message, category in (
            ("Classifier could not validate evidence (TimeoutError); analysis is blocked without override.",
             "infrastructure_failure"),
            ("Injection screening flagged; analysis is blocked without override.", "screening_blocked"),
        ):
            result = ChunkResult(self.entry.issue, None, "skipped", message)
            save_overnight_report(self.console.state, "context", [self.entry.issue], [result], read_only=True, finished=True)
            row = json.loads((self.console.state / "overnight-report.json").read_text())["issues"][0]
            self.assertEqual(row["triage_category"], category)
            self.assertEqual(row["blocking_reasons"], [message])
            self.assertTrue(row["next_action"])
        assert self.entry.review is not None
        self.entry.review.product_surface = "language_server"
        self.entry.review.claims[0].reproduction[2].status = "blocked"
        save_evidence(self.console, self.entry, validity="needs investigation")
        save_overnight_report(
            self.console.state, "context", [self.entry.issue], [ChunkResult(self.entry.issue, self.entry)],
            read_only=True, finished=True,
        )
        row = json.loads((self.console.state / "overnight-report.json").read_text())["issues"][0]
        self.assertEqual(row["triage_category"], "reproduction_needed")

    async def test_non_interactive_mode_cannot_enable_publication(self):
        with self.assertRaisesRegex(AutomationError, "requires --dry-run"):
            await review_main(Namespace(non_interactive=True, read_only=False))

    async def test_overnight_constructor_denies_approval_and_disables_rca(self):
        console = Console(
            self.github, self.console.sdk, self.console.state, self.profile, self.profile, None,
            "context", "a" * 40, {}, closure_only=True,
            ask=lambda _prompt: self.fail("Overnight must not prompt"),
        )
        self.assertFalse(console.rca_enabled)
        self.assertNotEqual(console.key(issue()), self.console.key(issue()))
        with self.assertRaisesRegex(AutomationError, "cannot grant human approval"):
            console.ask("Execute Python?")
        with self.assertRaisesRegex(AutomationError, "RCA comments are disabled"):
            await console.prepare_root_cause_comment(self.entry)
        with self.assertRaisesRegex(AutomationError, "RCA comments are disabled"):
            await console.post_root_cause(self.entry)
        self.assertEqual(self.github.mutations, [])

    async def test_overnight_by_design_uses_same_dry_run_and_live_gates(self):
        self.console.closure_only, self.console.rca_enabled = True, False
        self.entry.input_hash = self.console.key(self.entry.issue)
        self.console.read_only = True
        await self.console.evaluate(self.entry)
        proposal = dry_run_proposal(ChunkResult(self.entry.issue, self.entry), rca_enabled=False, closure_only=True)
        self.assertEqual(proposal["proposed_action"], "close_by_design")
        await self.console.decide(self.entry)
        self.assertEqual(self.github.mutations, [])
        self.console.read_only = False
        with patch.object(self.console, "ensure_root_cause", AsyncMock()) as rca:
            await self.console.decide(self.entry)
        rca.assert_not_awaited()
        self.assertEqual(self.github.mutations, ["comments", "labels", "close"])

    async def test_overnight_report_preserves_candidate_and_partial_publication_failure(self):
        proposal = dry_run_proposal(ChunkResult(self.entry.issue, self.entry), rca_enabled=False, closure_only=True)
        self.github.fail = "labels"
        with self.assertRaises(AutomationError):
            await self.console.close(self.entry)
        result = ChunkResult(self.entry.issue, self.entry, "failed", "Label publication failed", proposal=proposal)
        pending = issue().model_copy(update={"number": 456, "html_url": self.github.canonical.html_url})
        save_overnight_report(
            self.console.state, "context", [self.entry.issue, pending], [result], read_only=False, finished=False,
        )
        report = json.loads((self.console.state / "overnight-report.json").read_text(encoding="utf-8"))
        row = report["issues"][0]
        self.assertEqual(row["candidate_action"], "close_by_design")
        self.assertEqual(row["proposed_action"], "blocked")
        self.assertEqual(row["outcome"], "failed")
        self.assertEqual(row["publication_status"], "comment_posted")
        self.assertEqual(report["counts"]["closed"], 0)
        self.assertEqual(report["counts"]["pending"], 1)
        self.assertFalse(report["execution_complete"])
        self.assertIn("Label publication failed", (self.console.state / "overnight-report.md").read_text(encoding="utf-8"))
        self.github.fail = None
        await self.console.close(self.entry)
        result.status, result.message = "ready", ""
        save_overnight_report(self.console.state, "context", [self.entry.issue], [result], read_only=False, finished=True)
        report = json.loads((self.console.state / "overnight-report.json").read_text(encoding="utf-8"))
        self.assertEqual(report["counts"]["closed"], 1)
        self.assertEqual(report["issues"][0]["candidate_action"], "close_by_design")

    async def test_overnight_policy_cannot_reuse_other_modes(self):
        for previous, overnight in (({}, True), ({"overnight": True}, False)):
            atomic_write(self.console.state / "run.json", json.dumps(previous))
            with self.assertRaisesRegex(AutomationError, "publication policy changed"):
                require_run_mode(self.console.state, False, overnight=overnight)
        atomic_write(self.console.state / "run.json", '{"overnight": true}')
        require_run_mode(self.console.state, False, overnight=True)
        with self.assertRaisesRegex(AutomationError, "reproduction mode changed"):
            require_run_mode(self.console.state, True, overnight=True)

    async def test_overnight_markdown_includes_assessment_and_component_timeouts(self):
        result = ChunkResult(self.entry.issue, self.entry)
        result.proposal = dry_run_proposal(result, rca_enabled=False, closure_only=True)
        result.proposal["reproduction_blocking_reasons"] = [
            "Reproducer SDK turn timed out after 240s; faithful historical observation remains blocked",
        ]
        save_overnight_report(self.console.state, "context", [self.entry.issue], [result], read_only=True, finished=True)
        markdown = (self.console.state / "overnight-report.md").read_text(encoding="utf-8")
        self.assertIn("Assessment:** by design", markdown)
        self.assertIn("The inspected reports and observed product evidence", markdown)
        self.assertIn("Historical/main reproduction blockers", markdown)
        self.assertIn("Reproducer SDK turn timed out after 240s", markdown)
        self.assertIn("not successful reproduction on every target", markdown)

    async def test_overnight_experimental_settings_cannot_enable_live_closures(self):
        with self.assertRaisesRegex(AutomationError, "assumptions cannot authorize closures"):
            await review_main(Namespace(overnight=True, exploratory_reproduction=True, read_only=False))

    async def test_writer_is_required_and_audits_resume(self):
        self.entry.comment, self.entry.draft_check = None, None
        with self.assertRaises(AutomationError):
            await self.console.prepare_comment(self.entry)
        self.console.save(self.entry)
        with patch.object(self.console.sdk, "run", AsyncMock(side_effect=AssertionError("Unexpected repeat SDK run"))):
            resumed = await self.console.review(issue(), retry_failed=False)
        self.assertEqual(resumed.review, self.entry.review)

    async def test_review_binds_reproduction_to_actual_checker_provenance(self):
        for scenario in ("valid", "release", "runtime_only", "unlogged", "invalid_product_output", "wrong_surface"):
            self.console.state = Path(self.temporary.name) / scenario
            report = audit()
            if scenario == "release":
                report.claims[0].reproduction[0].status = "reproduced"
                report.claims[0].reproduction[0].check_ids = ["check"]
            if scenario == "wrong_surface":
                report.product_surface = "editor"

            async def execute(_agent, _prompt, _scratch, **options):
                self.assertIn("including ancillary CLI controls", _prompt)
                self.assertIn("Do not change product_surface or omit material claims", _prompt)
                self.assertIn("Group claims by independent user concern", _prompt)
                self.assertIn("separately alleged diagnostic-quality or error-recovery concern", _prompt)
                record = product_record(report)
                if scenario == "runtime_only":
                    record["kind"] = "python"
                if scenario == "invalid_product_output":
                    record["stdout"] = "An assertion rather than valid Pyright output"
                ledger = [] if scenario == "unlogged" else [record]
                atomic_write(
                    options["evidence"] / "checks.jsonl",
                    "".join(json.dumps(item) + "\n" for item in ledger),
                )
                raw = ReviewFindings(markdown="# Findings\n\nActual and expected behavior.", audit=report).model_dump_json()
                options["validate"](raw)
                return raw

            with (
                patch.object(self.console.sdk, "run", AsyncMock(side_effect=execute)),
                patch.object(self.console, "investigate_duplicates", AsyncMock()),
                patch.object(self.console, "adjudicate", AsyncMock()),
            ):
                if scenario == "valid":
                    saved = await self.console.review(issue(), retry_failed=True)
                    self.assertEqual(saved.review, report)
                    self.assertIsNotNone(saved.scratch_directory)
                    markdown = (self.console.directory(123) / "review.md").read_text(encoding="utf-8")
                    self.assertIn("Controller-recorded product evidence", markdown)
                    self.assertIn("node pyright.js", markdown)
                    self.assertIn("generalDiagnostics", markdown)
                    self.assertIn("value: int = 'wrong'", markdown)
                else:
                    with self.assertRaises(AutomationError):
                        await self.console.review(issue(), retry_failed=True)
            self.assertEqual(self.github.mutations, [])

    async def test_pending_closure_survives_resume_but_not_changed_context(self):
        self.github.fail = "labels"
        with self.assertRaises(AutomationError):
            await self.console.close(self.entry)
        self.assertEqual(
            (await self.console.review(self.github.current, retry_failed=False)).closure,
            self.entry.closure,
        )
        self.console.context_hash = "changed"
        with self.assertRaises(AutomationError):
            await self.console.review(self.github.current, retry_failed=False)

    async def test_missing_runtime_tools_fail_before_inference(self):
        session = AsyncMock()
        session.rpc.agent.get_current.return_value = SimpleNamespace(agent=SimpleNamespace(name=self.profile.name))
        session.rpc.tools.get_current_metadata.return_value = SimpleNamespace(tools=[])
        client = AsyncMock()
        client.create_session.return_value = session
        scratch = Path(self.temporary.name)
        tools = InvestigationTools(self.github, scratch, ROOT / "packages" / "pyright" / "index.js", {})
        with self.assertRaisesRegex(AutomationError, "missing required tools"):
            await SDK(client, None, 30).run(self.profile, "A test", scratch, tools=tools)
        session.send_and_wait.assert_not_awaited()
        session.disconnect.assert_awaited_once()
        configuration = client.create_session.call_args.kwargs
        self.assertEqual(configuration["agent"], "pyright-issue-by-design-reviewer")
        self.assertEqual(configuration["custom_agents"][0]["skills"], ["pyright-issue-analysis"])

    async def test_review_and_duplicate_roles_receive_only_links_from_the_screened_target(self):
        body_link = "https://github.com/microsoft/linked-body/issues/1"
        comment_link = "https://github.com/microsoft/linked-comment/issues/2"
        invented_link = "https://github.com/microsoft/invented-by-reviewer/issues/3"
        snapshot = issue()
        snapshot.body = f"An issue with a direct link: {body_link}"
        self.github.discussion = [{"body": f"The relevant comment links {comment_link}"}]
        self.console.state = Path(self.temporary.name) / "linked-pipeline"
        self.console.duplicate = Agent.load(AGENTS / "pyright-issue-dupe-investigator.md", "pyright-issue-dupe-investigator")
        observed_roles = []

        async def investigate(agent, prompt, scratch, **options):
            tools = options["tools"]
            observed_roles.append(agent.name)
            self.assertEqual(set(tools.linked_issues), {body_link, comment_link})
            self.assertNotIn(invented_link, tools.linked_issues)
            self.assertIn(body_link, prompt)
            self.assertIn(comment_link, prompt)
            if agent.name == self.profile.name:
                report = audit()
                tools.log(product_record(report))
                raw = ReviewFindings(
                    markdown=f"# Findings\n\nAn investigator-generated reference: {invented_link}",
                    audit=report,
                ).model_dump_json()
                options["validate"](raw)
                return raw
            tools.log(search_record())
            raw = DuplicateFindings(markdown="# Duplicates\n\nNo established duplicate.", report=no_duplicates()).model_dump_json()
            options["validate"](raw)
            return raw

        with (
            patch.object(self.console.sdk, "run", AsyncMock(side_effect=investigate)),
            patch.object(self.console, "adjudicate", AsyncMock()),
        ):
            entry = await self.console.review(snapshot, retry_failed=True)
        self.assertEqual(observed_roles, [self.profile.name, self.console.duplicate.name])
        self.assertIsNotNone(entry.review)
        self.assertIsNotNone(entry.duplicates)
        scopes = [row for row in self.console.records(123) if isinstance(row, dict) and row.get("kind") == "linked_issue_scope"]
        self.assertEqual(len(scopes), 2)
        self.assertEqual(self.github.mutations, [])

    async def test_duplicate_agent_is_read_only_and_never_runs_checks(self):
        self.console.duplicate = Agent.load(
            AGENTS / "pyright-issue-dupe-investigator.md", "pyright-issue-dupe-investigator"
        )
        self.entry.duplicates, self.entry.adjudication = None, None
        self.console.save(self.entry)
        report = no_duplicates()
        raw = DuplicateFindings(markdown="# Duplicate findings\n\nNo shared cause found.", report=report).model_dump_json()

        async def investigated(agent, prompt, scratch, **options):
            options["tools"].log(search_record())
            options["validate"](raw)
            return raw

        with (
            patch.object(self.console.sdk, "run", AsyncMock(side_effect=investigated)) as run,
            patch.object(self.console, "adjudicate", AsyncMock()),
        ):
            entry = await self.console.review(issue(), retry_failed=False)
        self.assertEqual(entry.duplicates, report)
        self.assertEqual(run.await_count, 1)
        self.assertEqual(run.call_args.args[0].name, "pyright-issue-dupe-investigator")
        self.assertEqual((self.console.directory(123) / "duplicates.md").read_text(), "# Duplicate findings\n\nNo shared cause found.\n")
        self.assertEqual(self.github.mutations, [])

    async def test_duplicate_validation_can_obtain_missing_reads_before_saving(self):
        self.console.state = Path(self.temporary.name) / "duplicate-read-correction"
        self.entry.duplicates, self.entry.adjudication = None, None
        report = no_duplicates()
        report.candidates = [DuplicateCandidate(
            issue_number=456, relation="duplicate", confidence="high", shared_cause="The same verified contract",
            differences="Different names", canonical_reason="Stronger explanation", canonical_issue_number=456,
            evidence=[DuplicateEvidence(url=self.github.canonical.html_url, finding="Same contract")],
        )]
        raw = DuplicateFindings(markdown="# Duplicate findings\n\nThe same contract applies.", report=report).model_dump_json()

        async def investigated(agent, prompt, scratch, **options):
            tools = options["tools"]
            tools.log(search_record())
            tools.log({"tool": "github_read", "request": {"operation": "comments", "number": 456}, "result": []})
            with self.assertRaisesRegex(AutomationError, "actual canonical issue and discussion reads"):
                options["validate"](raw)
            self.assertFalse((self.console.directory(123) / "duplicates-response.txt").exists())
            self.assertFalse((self.console.directory(123) / "duplicates.json").exists())
            tools.log({
                "tool": "github_read", "request": {"operation": "issue", "number": 456},
                "result": self.github.canonical.model_dump(mode="json"),
            })
            options["validate"](raw)
            return raw

        with patch.object(self.console.sdk, "run", AsyncMock(side_effect=investigated)):
            await self.console.investigate_duplicates(self.entry)
        self.assertEqual(self.entry.duplicates, report)
        self.assertEqual((self.console.directory(123) / "duplicates-response.txt").read_text(), raw)
        self.assertEqual(self.github.mutations, [])

    async def test_duplicate_wrong_identity_cannot_be_saved_even_if_sdk_skips_validation(self):
        self.console.state = Path(self.temporary.name) / "duplicate-invalid-identity"
        self.entry.duplicates, self.entry.adjudication = None, None
        report = no_duplicates()
        report.issue_number = 789
        raw = DuplicateFindings(markdown="# Findings\n\nWrong issue.", report=report).model_dump_json()
        with (
            patch.object(self.console.sdk, "run", AsyncMock(return_value=raw)),
            self.assertRaisesRegex(AutomationError, "wrong issue"),
        ):
            await self.console.investigate_duplicates(self.entry)
        self.assertIsNone(self.entry.duplicates)
        self.assertFalse((self.console.directory(123) / "duplicates.json").exists())
        self.assertEqual(self.github.mutations, [])

    async def test_false_duplicate_budget_stop_can_be_corrected_before_saving(self):
        self.console.state = Path(self.temporary.name) / "duplicate-budget-correction"
        self.entry.duplicates, self.entry.adjudication = None, None
        data = no_duplicates().model_dump()
        data.update(search_complete=False, exhausted_budget="requests")
        failed = DuplicateReport.model_validate(data)
        bad = DuplicateFindings(markdown="# Findings\n\nRequest allowance exhausted.", report=failed).model_dump_json()
        good = DuplicateFindings(markdown="# Findings\n\nBounded research completed.", report=no_duplicates()).model_dump_json()

        async def investigated(agent, prompt, scratch, **options):
            self.assertIn("NOT ordinary Pyright", prompt)
            self.assertIn("Group claims by independent user concern", prompt)
            tools = options["tools"]
            for _ in range(8):
                tools.log({"tool": "github_read", "request": {"operation": "issue", "number": 123}, "result": {}})
            tools.log({"kind": "linked_issue_limit", "limit": "requests"})
            with self.assertRaisesRegex(AutomationError, "external linked-issue"):
                options["validate"](bad)
            self.assertFalse((self.console.directory(123) / "duplicates.json").exists())
            tools.log(search_record())
            options["validate"](good)
            return good

        with patch.object(self.console.sdk, "run", AsyncMock(side_effect=investigated)):
            await self.console.investigate_duplicates(self.entry)
        assert self.entry.duplicates is not None
        self.assertTrue(self.entry.duplicates.search_complete)
        self.assertIsNone(self.entry.duplicates.exhausted_budget)
        self.assertEqual(self.github.mutations, [])

    async def test_both_roles_receive_curated_topic_leads_without_inheriting_verdicts(self):
        snapshot = issue().model_copy(update={"title": "Custom classmethod receiver", "body": "A descriptor"})
        self.console.state = Path(self.temporary.name) / "history-leads"
        self.console.duplicate = Agent.load(AGENTS / "pyright-issue-dupe-investigator.md", "pyright-issue-dupe-investigator")
        observed = []

        async def investigated(agent, prompt, scratch, **options):
            observed.append(agent.name)
            self.assertIn("https://github.com/microsoft/pyright/issues/5865", prompt)
            if agent.name == self.profile.name:
                report = audit()
                options["tools"].log(product_record(report))
                raw = ReviewFindings(markdown="# Findings\n\nSpecification evidence.", audit=report).model_dump_json()
            else:
                report = no_duplicates()
                report.search_complete = False
                report.uncertainties = ["Historical lead is uninspected in this synthetic test"]
                raw = DuplicateFindings(markdown="# Findings\n\nHistory is incomplete.", report=report).model_dump_json()
            options["validate"](raw)
            return raw

        with (
            patch.object(self.console.sdk, "run", AsyncMock(side_effect=investigated)),
            patch.object(self.console, "adjudicate", AsyncMock()),
        ):
            await self.console.review(snapshot, retry_failed=True)
        self.assertEqual(observed, [self.profile.name, self.console.duplicate.name])
        leads = [
            row for row in self.console.records(123) if isinstance(row, dict) and row.get("kind") == "policy_history_leads"
        ]
        self.assertEqual(len(leads), 2)
        self.assertEqual(leads[0]["leads"], leads[1]["leads"])
        self.assertEqual(self.github.mutations, [])

    async def test_timeout_aborts_and_disconnects_sdk(self):
        session = AsyncMock()
        session.session_id = "test"
        session.rpc.agent.get_current.return_value = SimpleNamespace(agent=SimpleNamespace(name=self.profile.name))
        session.rpc.tools.get_current_metadata.return_value = SimpleNamespace(tools=[])
        session.send_and_wait.side_effect = TimeoutError()
        client = AsyncMock()
        client.create_session.return_value = session
        sdk = SDK(client, None, 1)
        with self.assertRaisesRegex(AutomationError, "SDK turn timed out"):
            await sdk.run(self.profile, "A bounded test", Path(self.temporary.name))
        session.abort.assert_awaited_once()
        session.disconnect.assert_awaited_once()
        self.assertEqual(client.create_session.call_args.kwargs["agent"], self.profile.name)

    async def test_runner_disables_indexing_only_in_copilot_child_environment(self):
        writer = Path(self.temporary.name) / "rich-mirror.md"
        atomic_write(writer, "---\nname: rich-mirror\n---\nA test-only writer.\n")
        args = Namespace(
            state_dir=Path(self.temporary.name) / "state", cli_path="copilot", writer_agent=writer,
            read_only=True, model=None, issues=[], chunk_size=5, timeout=30, retry_failed=False,
            duplicates=False,
        )
        github = AsyncMock()
        github.api.return_value = {"tag_name": "test"}
        with (
            patch("review_issues.GitHub", return_value=github),
            patch("review_issues.InjectionScreening.from_environment"),
            patch("review_issues.process", AsyncMock(return_value=(0, "test", ""))),
            patch("review_issues.context_hash", return_value="test"),
            patch("review_issues.git", return_value="a" * 40),
            patch.dict(os.environ, {
                "USE_TGREP": "true", "ISSUE_REVIEW_ENV_TEST": "preserved",
                "AZURE_CLIENT_SECRET": "test-only-secret", "AZURE_ENDPOINT": "https://scorer.example.invalid",
                "DEPLOYMENT_NAME": "screen-test",
            }),
            patch("review_issues.CopilotClient") as constructor,
        ):
            await review_main(args)
            self.assertEqual(constructor.call_count, 1)
            child_env = constructor.call_args.kwargs["env"]
            self.assertEqual(child_env["USE_TGREP"], "false")
            self.assertEqual(child_env["ISSUE_REVIEW_ENV_TEST"], "preserved")
            self.assertFalse({"AZURE_CLIENT_SECRET", "AZURE_ENDPOINT", "DEPLOYMENT_NAME"} & child_env.keys())
            self.assertEqual(os.environ["AZURE_CLIENT_SECRET"], "test-only-secret")
            self.assertEqual(os.environ["USE_TGREP"], "true")
            capabilities = json.loads((args.state_dir / "capabilities.json").read_text())
            self.assertFalse(capabilities["mypy"]["available"])
            self.assertEqual(capabilities["mypy"]["stdout"], "test")
            self.assertIn("Version preflight failed", capabilities["mypy"]["error"])

    async def test_invalid_output_gets_only_one_same_session_correction(self):
        valid = '{"approved":true,"problems":[]}'
        invalid = '{"approved":true,"problems":["An unsupported claim"]}'
        for second, succeeds in ((valid, True), (invalid, False)):
            session = AsyncMock()
            session.session_id = "test"
            session.rpc.agent.get_current.return_value = SimpleNamespace(agent=SimpleNamespace(name=self.profile.name))
            session.rpc.tools.get_current_metadata.return_value = SimpleNamespace(tools=[])
            session.send_and_wait.side_effect = [
                SimpleNamespace(data=AssistantMessageData(content=content, message_id="message"))
                for content in (invalid, second)
            ]
            client = AsyncMock()
            client.create_session.return_value = session
            sdk = SDK(client, None, 30)
            if succeeds:
                self.assertEqual(await sdk.run(self.profile, "A test", Path(self.temporary.name), schema=DraftCheck), valid)
            else:
                with self.assertRaises(ValidationError):
                    await sdk.run(self.profile, "A test", Path(self.temporary.name), schema=DraftCheck)
            self.assertEqual(session.send_and_wait.await_count, 2)
            correction = session.send_and_wait.await_args_list[1].args[0]
            self.assertIn("remaining authorized tools", correction)
            self.assertIn("preserve an inconclusive result", correction)
            self.assertIn("rca_run", correction)
            client.create_session.assert_awaited_once()
            session.disconnect.assert_awaited_once()

    async def test_review_correction_reports_schema_and_surface_errors_together(self):
        findings = lsp_findings()
        invalid = findings.model_copy(deep=True)
        expectation = invalid.audit.claims[0].expectation
        assert expectation is not None
        expectation.evidence[0].intent_basis = "maintainer_decision"
        invalid.audit.claims[1].reproduction[2].status = "reproduced"
        raw, corrected = invalid.model_dump_json(), findings.model_dump_json()
        session = AsyncMock()
        session.session_id = "compound-review-errors"
        session.rpc.agent.get_current.return_value = SimpleNamespace(agent=SimpleNamespace(name=self.profile.name))
        session.rpc.tools.get_current_metadata.return_value = SimpleNamespace(tools=[])
        calls = 0

        async def respond(prompt, **_options):
            nonlocal calls
            calls += 1
            if calls == 2:
                self.assertIn("Accepted intent requires the actual maintainer decision: policy-attribution", prompt)
                self.assertIn("cli-control", prompt)
                self.assertIn("audit.claims[1].reproduction[2]", prompt)
                self.assertIn("non-CLI product surface", prompt)
                self.assertIn("including ancillary CLI controls", prompt)
            return SimpleNamespace(data=AssistantMessageData(
                content=raw if calls == 1 else corrected, message_id="result",
            ))

        session.send_and_wait.side_effect = respond
        client = AsyncMock()
        client.create_session.return_value = session
        validated = []

        def validate(content: str) -> None:
            report = ReviewFindings.model_validate_json(content).audit
            report.require_expectations()
            validate_review_execution(report, [product_record(report)])
            validated.append(content)

        result = await SDK(client, None, 30).run(
            self.profile, "Offline behavior investigation", Path(self.temporary.name),
            schema=ReviewFindings, validate=validate,
        )
        self.assertEqual(result, corrected)
        self.assertEqual(validated, [corrected])
        self.assertEqual(invalid.model_dump_json(), raw)
        saved = Path(self.temporary.name) / f"{self.profile.name}-response-1.txt"
        self.assertEqual(saved.read_text(encoding="utf-8"), raw)
        self.assertEqual(session.send_and_wait.await_count, 2)
        client.create_session.assert_awaited_once()
        session.disconnect.assert_awaited_once()
        self.assertEqual(self.github.mutations, [])

    async def test_review_correction_cannot_skip_gates_or_gain_another_attempt(self):
        findings = lsp_findings()
        schema_invalid = findings.model_copy(deep=True)
        expectation = schema_invalid.audit.claims[0].expectation
        assert expectation is not None
        expectation.evidence[0].intent_basis = "maintainer_decision"
        surface_invalid = findings.model_copy(deep=True)
        surface_invalid.audit.claims[1].reproduction[2].status = "reproduced"
        initial = schema_invalid.model_copy(deep=True)
        initial.audit.claims[1].reproduction[2].status = "reproduced"
        for name, correction, error_type in (
            ("source-invalid", schema_invalid.model_dump_json(), ValidationError),
            ("surface-invalid", surface_invalid.model_dump_json(), AutomationError),
            ("unlogged-execution", findings.model_dump_json(), AutomationError),
            ("malformed-json", "{", ValidationError),
            ("partial-record", '{"audit":{"product_surface":"language_server","claims":[]}}', ValidationError),
        ):
            with self.subTest(correction=name):
                session = AsyncMock()
                session.session_id = "bounded-review-correction"
                session.rpc.agent.get_current.return_value = SimpleNamespace(agent=SimpleNamespace(name=self.profile.name))
                session.rpc.tools.get_current_metadata.return_value = SimpleNamespace(tools=[])
                session.send_and_wait.side_effect = [
                    SimpleNamespace(data=AssistantMessageData(content=content, message_id="result"))
                    for content in (initial.model_dump_json(), correction)
                ]
                client = AsyncMock()
                client.create_session.return_value = session

                def validate(content: str) -> None:
                    report = ReviewFindings.model_validate_json(content).audit
                    validate_review_execution(report, [] if name == "unlogged-execution" else [product_record(report)])

                with self.assertRaises(error_type):
                    await SDK(client, None, 30).run(
                        self.profile, "Offline invalid review", Path(self.temporary.name),
                        schema=ReviewFindings, validate=validate,
                    )
                self.assertEqual(session.send_and_wait.await_count, 2)
                client.create_session.assert_awaited_once()
                session.disconnect.assert_awaited_once()
                if name == "surface-invalid":
                    prompt = session.send_and_wait.await_args_list[1].args[0]
                    self.assertIn("policy-attribution", prompt)
                    self.assertIn("cli-control", prompt)
                self.assertEqual(self.github.mutations, [])

    async def test_installed_sdk_wraps_each_reproduction_schema_once_without_live_transport(self):
        client = AsyncMock()
        client.request.return_value = {"messageId": "offline-message"}
        session = CopilotSession("offline-session", client)
        for model in (ReproductionScenario, ExploratoryReproductionScenario, ReproductionGate):
            with self.subTest(model=model.__name__):
                schema = response_schema(model)
                await session.send("Offline schema serialization only", response_schema=schema)
                method, params = client.request.await_args.args
                self.assertEqual(method, "session.send")
                self.assertEqual(params["responseFormat"], {
                    "type": "json_schema", "jsonSchema": {"name": "response", "strict": True, "schema": schema},
                })
                self.assertEqual(params["responseFormat"]["jsonSchema"]["schema"]["type"], "object")
                self.assertNotIn("responseFormat", params["responseFormat"]["jsonSchema"]["schema"])

    async def test_reproduction_sdk_keeps_raw_and_decoded_records_and_revalidates_after_correction(self):
        profile = Agent.load(AGENTS / "pyright-issue-reproduction-gate.md", "pyright-issue-reproduction-gate")
        wire = {
            "approved": True, "problems": [], "claim_ids": ["claim"],
            "receipt_hashes": [{"key": "original:main", "value": "a" * 64}],
        }
        valid = json.dumps(wire)
        invalid = json.dumps({**wire, "receipt_hashes": wire["receipt_hashes"] * 2})
        session = AsyncMock()
        session.session_id = "offline-session"
        session.rpc.agent.get_current.return_value = SimpleNamespace(agent=SimpleNamespace(name=profile.name))
        session.rpc.tools.get_current_metadata.return_value = SimpleNamespace(tools=[])
        session.send_and_wait.side_effect = [
            SimpleNamespace(data=AssistantMessageData(content=content, message_id="offline-message"))
            for content in (invalid, valid)
        ]
        client = AsyncMock()
        client.create_session.return_value = session
        seen = []

        def validate(content):
            seen.append(ReproductionGate.model_validate_json(content))

        scratch = Path(self.temporary.name)
        result = await SDK(client, "gpt-6.1-sol", 30).run(
            profile, "Validate exact receipts", scratch, schema=ReproductionGate, validate=validate, native_tools=[],
        )
        self.assertEqual(len(seen), 1)
        self.assertEqual(seen[0].receipt_hashes, {"original:main": "a" * 64})
        self.assertEqual(json.loads(result), seen[0].model_dump())
        for attempt, raw in enumerate((invalid, valid), 1):
            self.assertEqual((scratch / f"{profile.name}-response-{attempt}.txt").read_text(), raw)
        self.assertEqual((scratch / f"{profile.name}-last-response.txt").read_text(), valid)
        self.assertEqual((scratch / f"{profile.name}-decoded-response-2.json").read_text(), result)
        for call in session.send_and_wait.await_args_list:
            self.assertIn("Structured-output transport:", call.args[0])
            self.assertEqual(call.kwargs["response_schema"], response_schema(ReproductionGate))
        session.disconnect.assert_awaited_once()

    async def test_exploratory_sdk_retains_raw_wire_and_decoded_configuration_disclosures(self):
        from test_issue_review_reproduction import exploratory_scenario

        profile = Agent.load(AGENTS / "pyright-issue-reproducer.md", "pyright-issue-reproducer")
        expected = exploratory_scenario()
        wire = json.loads(expected.model_dump_json())
        for name in ("files", "control_files", "configuration"):
            wire[name] = [
                {"key": key, "value": json.dumps(value) if name == "configuration" else value}
                for key, value in wire[name].items()
            ]
        raw = json.dumps(wire)
        session = AsyncMock()
        session.session_id = "offline-session"
        session.rpc.agent.get_current.return_value = SimpleNamespace(agent=SimpleNamespace(name=profile.name))
        session.rpc.tools.get_current_metadata.return_value = SimpleNamespace(tools=[])
        session.send_and_wait.return_value = SimpleNamespace(
            data=AssistantMessageData(content=raw, message_id="offline-message")
        )
        client = AsyncMock()
        client.create_session.return_value = session
        scratch = Path(self.temporary.name)
        decoded = await SDK(client, "gpt-6.1-sol", 30).run(
            profile, "Offline transport only", scratch, schema=ExploratoryReproductionScenario, native_tools=[],
        )
        self.assertEqual(ExploratoryReproductionScenario.model_validate_json(decoded), expected)
        self.assertEqual((scratch / f"{profile.name}-response-1.txt").read_text(), raw)
        self.assertEqual((scratch / f"{profile.name}-decoded-response-1.json").read_text(), decoded)
        self.assertEqual(session.send_and_wait.await_args.kwargs["response_schema"], response_schema(ExploratoryReproductionScenario))

    async def test_reconstruction_quote_validation_uses_existing_bounded_sdk_correction(self):
        from test_issue_review_reproduction import exploratory_scenario

        profile = Agent.load(AGENTS / "pyright-issue-reproducer.md", "pyright-issue-reproducer")
        expected = exploratory_scenario()
        quote = "First quoted passage."
        report = quote + "\n\nIntervening source and version blocks.\n\nSecond quoted passage."
        expected.claims[0].report_quote = quote
        wire = json.loads(expected.model_dump_json())
        for name in ("files", "control_files", "configuration"):
            wire[name] = [
                {"key": key, "value": json.dumps(value) if name == "configuration" else value}
                for key, value in wire[name].items()
            ]
        valid = json.dumps(wire)
        wire["claims"][0]["report_quote"] = quote + "\nSecond quoted passage."
        invalid = json.dumps(wire)
        session = AsyncMock()
        session.session_id = "offline-session"
        session.rpc.agent.get_current.return_value = SimpleNamespace(agent=SimpleNamespace(name=profile.name))
        session.rpc.tools.get_current_metadata.return_value = SimpleNamespace(tools=[])
        session.send_and_wait.side_effect = [
            SimpleNamespace(data=AssistantMessageData(content=content, message_id="offline-message"))
            for content in (invalid, valid)
        ]
        client = AsyncMock()
        client.create_session.return_value = session
        scratch = Path(self.temporary.name)
        result = await SDK(client, "gpt-6.1-sol", 30).run(
            profile, "Reconstruct the exact report", scratch, schema=ExploratoryReproductionScenario,
            validate=lambda content: validate_reproduction_report(
                ExploratoryReproductionScenario.model_validate_json(content), report,
            ),
            native_tools=[],
        )
        self.assertEqual(ExploratoryReproductionScenario.model_validate_json(result), expected)
        self.assertEqual(session.send_and_wait.await_count, 2)
        self.assertIn("exact contiguous span", session.send_and_wait.await_args_list[1].args[0])
        self.assertEqual((scratch / f"{profile.name}-response-1.txt").read_text(), invalid)
        self.assertEqual((scratch / f"{profile.name}-response-2.txt").read_text(), valid)
        session.disconnect.assert_awaited_once()

    async def test_malformed_diagnostic_predicates_use_only_one_same_session_correction(self):
        from test_issue_review_reproduction import exploratory_scenario

        profile = Agent.load(AGENTS / "pyright-issue-reproducer.md", "pyright-issue-reproducer")
        expected = exploratory_scenario()
        message = 'Type mismatch\n\u00a0\u00a0Exact detail'
        expected.claims[0].broken[0].message = message
        wire = json.loads(expected.model_dump_json())
        for name in ("files", "control_files", "configuration"):
            wire[name] = [
                {"key": key, "value": json.dumps(value) if name == "configuration" else value}
                for key, value in wire[name].items()
            ]
        valid = json.dumps(wire)
        wire["claims"][0]["broken"][0]["message"] = message.replace("\u00a0", "\0a0")
        invalid = json.dumps(wire)
        for corrected in (True, False):
            with self.subTest(corrected=corrected):
                session = AsyncMock()
                session.session_id = "bounded-predicate-correction"
                session.rpc.agent.get_current.return_value = SimpleNamespace(agent=SimpleNamespace(name=profile.name))
                session.rpc.tools.get_current_metadata.return_value = SimpleNamespace(tools=[])
                session.send_and_wait.side_effect = [
                    SimpleNamespace(data=AssistantMessageData(content=content, message_id="offline"))
                    for content in (invalid, valid if corrected else invalid)
                ]
                client = AsyncMock()
                client.create_session.return_value = session
                scratch = Path(self.temporary.name) / f"predicate-{corrected}"
                scratch.mkdir()
                validated = []
                sdk = SDK(client, None, 30)
                async def request():
                    return await sdk.run(
                        profile, "Preserve exact diagnostic text", scratch, schema=ExploratoryReproductionScenario,
                        validate=lambda content: validated.append(content), native_tools=[],
                    )
                if corrected:
                    result = await request()
                    self.assertEqual(ExploratoryReproductionScenario.model_validate_json(result), expected)
                    self.assertEqual(len(validated), 1)
                else:
                    with self.assertRaisesRegex(ValueError, "NUL"):
                        await request()
                    self.assertEqual(validated, [])
                self.assertEqual(session.send_and_wait.await_count, 2)
                self.assertIn("NUL", session.send_and_wait.await_args_list[1].args[0])
                self.assertEqual((scratch / f"{profile.name}-response-1.txt").read_text(), invalid)
                self.assertFalse((scratch / f"{profile.name}-decoded-response-1.json").exists())
                client.create_session.assert_awaited_once()
                session.disconnect.assert_awaited_once()

    async def test_duplicate_sdk_session_has_no_write_or_execution_tools(self):
        profile = Agent.load(AGENTS / "pyright-issue-dupe-investigator.md", "pyright-issue-dupe-investigator")
        names = ["view", "grep", "rg", "glob", "web_fetch", "github_read"]
        session = AsyncMock()
        session.session_id = "test"
        session.rpc.agent.get_current.return_value = SimpleNamespace(agent=SimpleNamespace(name=profile.name))
        session.rpc.tools.get_current_metadata.return_value = SimpleNamespace(
            tools=[SimpleNamespace(name=name) for name in names]
        )
        session.send_and_wait.return_value = SimpleNamespace(
            data=AssistantMessageData(content="Markdown findings result", message_id="message")
        )
        client = AsyncMock()
        client.create_session.return_value = session
        scratch = Path(self.temporary.name)
        tools = InvestigationTools(self.github, scratch, ROOT / "packages" / "pyright" / "index.js", {})
        await SDK(client, None, 30).run(profile, "A test", scratch, tools=tools)
        configuration = client.create_session.call_args.kwargs
        self.assertEqual(configuration["available_tools"], names)
        self.assertEqual([tool.name for tool in configuration["tools"]], ["github_read"])

    async def test_sdk_accepts_model_specific_search_and_scratch_write_tools(self):
        scratch = Path(self.temporary.name)
        tools = InvestigationTools(self.github, scratch, ROOT / "packages" / "pyright" / "index.js", {})
        for variants in (["rg", "apply_patch"], ["grep", "create", "edit"]):
            with self.subTest(variants=variants):
                session = AsyncMock()
                session.session_id = "capability-test"
                session.rpc.agent.get_current.return_value = SimpleNamespace(agent=SimpleNamespace(name=self.profile.name))
                active = ["view", "glob", "web_fetch", *[tool.name for tool in tools.tools], *variants]
                session.rpc.tools.get_current_metadata.return_value = SimpleNamespace(
                    tools=[SimpleNamespace(name=name) for name in active],
                )
                session.send_and_wait.return_value = SimpleNamespace(
                    data=AssistantMessageData(content="A capability-selection fixture.", message_id="message"),
                )
                client = AsyncMock()
                client.create_session.return_value = session
                await SDK(client, "gpt-6.1-sol", 30).run(self.profile, "A bounded test", scratch, tools=tools)
                requested = client.create_session.call_args.kwargs["available_tools"]
                self.assertTrue(set(active) <= set(requested))
                self.assertNotIn("powershell", requested)
                self.assertNotIn("task", requested)

    async def test_sdk_rejects_missing_capabilities_and_unexpected_tools_before_inference(self):
        scratch = Path(self.temporary.name)
        tools = InvestigationTools(self.github, scratch, ROOT / "packages" / "pyright" / "index.js", {})
        complete = {"view", "glob", "web_fetch", *[tool.name for tool in tools.tools], "rg", "apply_patch"}
        for active in (
            complete - {"rg"}, complete - {"apply_patch"}, complete - {"run_check"}, complete | {"powershell"},
            complete - {"apply_patch"} | {"create"},
        ):
            with self.subTest(active=active):
                session = AsyncMock()
                session.rpc.agent.get_current.return_value = SimpleNamespace(agent=SimpleNamespace(name=self.profile.name))
                session.rpc.tools.get_current_metadata.return_value = SimpleNamespace(
                    tools=[SimpleNamespace(name=name) for name in active],
                )
                client = AsyncMock()
                client.create_session.return_value = session
                with self.assertRaises(AutomationError):
                    await SDK(client, "gpt-6.1-sol", 30).run(self.profile, "A bounded test", scratch, tools=tools)
                session.send_and_wait.assert_not_awaited()
                session.disconnect.assert_awaited_once()

    async def test_duplicate_gpt_tools_never_include_any_scratch_writer(self):
        scratch = Path(self.temporary.name)
        profile = Agent.load(AGENTS / "pyright-issue-dupe-investigator.md", "pyright-issue-dupe-investigator")
        tools = InvestigationTools(self.github, scratch, ROOT / "packages" / "pyright" / "index.js", {})
        session = AsyncMock()
        session.session_id = "duplicate-capability-test"
        session.rpc.agent.get_current.return_value = SimpleNamespace(agent=SimpleNamespace(name=profile.name))
        session.rpc.tools.get_current_metadata.return_value = SimpleNamespace(
            tools=[SimpleNamespace(name=name) for name in ["view", "rg", "glob", "web_fetch", "github_read"]],
        )
        session.send_and_wait.return_value = SimpleNamespace(
            data=AssistantMessageData(content="A read-only duplicate fixture.", message_id="message"),
        )
        client = AsyncMock()
        client.create_session.return_value = session
        await SDK(client, "gpt-6.1-sol", 30).run(profile, "A bounded test", scratch, tools=tools)
        requested = client.create_session.call_args.kwargs["available_tools"]
        self.assertFalse(set(requested) & {"apply_patch", "create", "edit", "run_check", "powershell"})

    async def test_sdk_forwards_selected_model_to_each_analysis_role(self):
        profiles = [
            self.profile,
            Agent.load(AGENTS / "pyright-issue-dupe-investigator.md", "pyright-issue-dupe-investigator"),
            self.console.adjudicator, *self.console.rca_agents,
            Agent(self.profile.path, "rich-mirror", "Writer", "Preserve verified facts."),
        ]
        for profile in profiles:
            with self.subTest(agent=profile.name):
                session = AsyncMock()
                session.session_id = "model-test"
                session.rpc.agent.get_current.return_value = SimpleNamespace(agent=SimpleNamespace(name=profile.name))
                session.rpc.tools.get_current_metadata.return_value = SimpleNamespace(tools=[])
                session.send_and_wait.return_value = SimpleNamespace(
                    data=AssistantMessageData(content="A model-selection fixture.", message_id="message"),
                )
                client = AsyncMock()
                client.create_session.return_value = session
                await SDK(client, "gpt-6.1-sol", 30).run(profile, "A bounded model-selection test", Path(self.temporary.name))
                self.assertEqual(client.create_session.call_args.kwargs["model"], "gpt-6.1-sol")

    async def test_sdk_timeout_aborts_and_preserves_actionable_failure_details(self):
        session = AsyncMock()
        session.session_id = "timed-out-session"
        session.rpc.agent.get_current.return_value = SimpleNamespace(agent=SimpleNamespace(name=self.profile.name))
        session.rpc.tools.get_current_metadata.return_value = SimpleNamespace(tools=[])
        async def stall(*_args, **_options):
            await asyncio.sleep(10)
        session.send_and_wait.side_effect = stall
        client = AsyncMock()
        client.create_session.return_value = session
        scratch = Path(self.temporary.name)
        with self.assertRaisesRegex(AutomationError, "timed out.*0.01"):
            await SDK(client, "gpt-6.1-sol", 0.01).run(self.profile, "A bounded test", scratch)
        session.abort.assert_awaited_once()
        session.disconnect.assert_awaited_once()
        records = [json.loads(line) for line in (scratch / "sdk-events.jsonl").read_text().splitlines()]
        failure = next(record for record in records if record["type"] == "controller.timeout")
        self.assertEqual(failure["type"], "controller.timeout")
        self.assertEqual(failure["data"]["session_id"], session.session_id)
        self.assertEqual(failure["data"]["exception"], "TimeoutError")
        self.assertTrue(failure["data"]["deadline_expired"])
        self.assertEqual(failure["data"]["attempt"], 1)
        self.assertEqual(failure["data"]["phase"], "response_wait")
        self.assertEqual(records[-1]["data"]["phase"], "disconnect_finished")
        self.assertTrue(records[-1]["data"]["completed"])

    async def test_independent_rca_budget_does_not_change_the_general_timeout(self):
        session = AsyncMock()
        session.session_id = "rca-budget"
        session.rpc.agent.get_current.return_value = SimpleNamespace(agent=SimpleNamespace(name=self.profile.name))
        session.rpc.tools.get_current_metadata.return_value = SimpleNamespace(tools=[])
        async def complete(*_args, **_options):
            await asyncio.sleep(0.02)
            return SimpleNamespace(data=AssistantMessageData(
                content='{"approved":true,"problems":[]}', message_id="result",
            ))
        session.send_and_wait.side_effect = complete
        client = AsyncMock()
        client.create_session.return_value = session
        sdk = SDK(client, None, 0.001)
        result = await sdk.run(
            self.profile, "A separately budgeted RCA", Path(self.temporary.name), schema=DraftCheck, timeout=1,
        )
        self.assertTrue(DraftCheck.model_validate_json(result).approved)
        self.assertEqual(sdk.timeout, 0.001)
        session.abort.assert_not_awaited()

    async def test_output_correction_shares_one_active_budget(self):
        session = AsyncMock()
        session.session_id = "shared-correction-budget"
        session.rpc.agent.get_current.return_value = SimpleNamespace(agent=SimpleNamespace(name=self.profile.name))
        session.rpc.tools.get_current_metadata.return_value = SimpleNamespace(tools=[])
        calls = 0
        async def invalid_then_slow(*_args, **_options):
            nonlocal calls
            calls += 1
            await asyncio.sleep(0.05 if calls == 1 else 0.1)
            return SimpleNamespace(data=AssistantMessageData(
                content='{}' if calls == 1 else '{"approved":true,"problems":[]}', message_id="result",
            ))
        session.send_and_wait.side_effect = invalid_then_slow
        client = AsyncMock()
        client.create_session.return_value = session
        with self.assertRaisesRegex(AutomationError, "active timeout 0.12s"):
            await SDK(client, None, 1).run(
                self.profile, "Correct once within the original budget", Path(self.temporary.name),
                schema=DraftCheck, timeout=0.12,
            )
        self.assertEqual(calls, 2)
        session.abort.assert_awaited_once()
        records = [
            json.loads(line) for line in (Path(self.temporary.name) / "sdk-events.jsonl").read_text().splitlines()
        ]
        waits = [record["data"] for record in records if record["type"] == "controller.lifecycle"
                 and record["data"]["phase"] == "response_wait"]
        self.assertEqual([record["attempt"] for record in waits], [1, 2])
        self.assertLess(waits[1]["remaining_active_seconds"], waits[0]["remaining_active_seconds"])
        failure = next(record["data"] for record in records if record["type"] == "controller.timeout")
        self.assertEqual(failure["attempt"], 2)
        self.assertEqual(failure["phase"], "response_wait")
        self.assertTrue(failure["deadline_expired"])
        rejected = next(record["data"] for record in records if record["type"] == "controller.validation_rejected")
        self.assertEqual(rejected["attempt"], 1)
        self.assertEqual(rejected["phase"], "schema_validation")
        self.assertTrue(rejected["retry"])

    async def test_adjudicator_reads_both_markdown_reports_without_tools(self):
        self.entry.adjudication = None

        async def adjudicate(agent, prompt, scratch, **options):
            self.assertEqual(agent.name, "pyright-issue-adjudicator")
            self.assertIn("Group claims by independent user concern", prompt)
            self.assertIn(self.entry.review_markdown, prompt)
            self.assertIn(self.entry.duplicates_markdown, prompt)
            self.assertNotIn("tools", options)
            result = Adjudication(
                issue_number=123, report_hash=self.console.report_hash(self.entry), validity="by design",
                duplicate_status="no dupe found", duplicate_of=None, rationale="Both investigations support these tags.",
            )
            options["validate"](result.model_dump_json())
            return result.model_dump_json()

        with patch.object(self.console.sdk, "run", AsyncMock(side_effect=adjudicate)) as run:
            await self.console.adjudicate(self.entry)
            await self.console.adjudicate(self.entry)
        self.assertEqual(run.await_count, 1)
        assert self.entry.adjudication is not None
        self.assertEqual(self.entry.adjudication.tags(), "by design | no dupe found")
        self.assertTrue((self.console.directory(123) / "adjudication.json").exists())
        self.assertEqual(self.github.mutations, [])

    async def test_adjudicator_sdk_denies_tools_and_skills(self):
        profile = self.console.adjudicator
        session = AsyncMock()
        session.session_id = "adjudicator-test"
        session.rpc.agent.get_current.return_value = SimpleNamespace(agent=SimpleNamespace(name=profile.name))
        session.rpc.tools.get_current_metadata.return_value = SimpleNamespace(tools=[])
        session.send_and_wait.return_value = SimpleNamespace(
            data=AssistantMessageData(content='{"approved":true,"problems":[]}', message_id="message")
        )
        client = AsyncMock()
        client.create_session.return_value = session
        await SDK(client, None, 30).run(profile, "A bounded test", Path(self.temporary.name), schema=DraftCheck)
        options = client.create_session.call_args.kwargs
        self.assertEqual(options["available_tools"], [])
        self.assertEqual(options["tools"], [])
        self.assertFalse(options["enable_skills"])
        request = PermissionRequestRead(intention="read", path=str(ROOT / "package.json"))
        self.assertIsInstance(options["on_permission_request"](request, {"session_id": "test"}), PermissionDecisionReject)

    def test_chunk_table_displays_one_row_per_issue_and_not_report_prose(self):
        table = chunk_table([
            ChunkResult(self.entry.issue, self.entry),
            ChunkResult(self.github.canonical, status="failed", message="A failed\ncheck | details"),
        ], rca_enabled=True)
        self.assertIn("| Issue", table)
        for header in ("By Design", "Dupe", "Root Cause Summary"):
            self.assertIn(header, table)
        self.assertIn("#123", table)
        self.assertIn("#456", table)
        self.assertIn("Yes", table)
        self.assertIn("Not needed", table)
        self.assertIn("A failed check / details", table)
        self.assertNotIn("Behavior findings", table)
        self.assertEqual(len(table.splitlines()), 4)

    async def test_modified_reports_or_execution_evidence_block_publication(self):
        for name in ("review.md", "duplicates.md", "checks.jsonl"):
            with self.subTest(name=name):
                save_evidence(self.console, self.entry)
                path = self.console.directory(123) / name
                path.write_text("{}\n" if name.endswith("jsonl") else "Edited findings", encoding="utf-8")
                with self.assertRaises(AutomationError):
                    await self.console.close(self.entry)
                self.assertEqual(self.github.mutations, [])

    async def test_needs_investigation_on_either_axis_runs_rca_without_allowing_closure(self):
        for axis in ("validity", "duplicate_status"):
            with self.subTest(axis=axis):
                save_evidence(self.console, self.entry)
                assert self.entry.adjudication is not None
                setattr(self.entry.adjudication, axis, "needs investigation")
                self.entry.decision = "pending"
                self.entry.rca_opt_in = "not_asked"
                self.console.ask = lambda _question: self.fail("No RCA opt-in prompt")
                with patch.object(self.console, "ensure_root_cause", AsyncMock()) as investigate:
                    await self.console.evaluate(self.entry)
                    await self.console.decide(self.entry)
                investigate.assert_awaited_once_with(self.entry)
                with self.assertRaises(AutomationError):
                    await self.console.close(self.entry)
                self.assertEqual(self.github.mutations, [])

    def duplicate_entry(self) -> None:
        assert self.entry.review is not None and self.entry.duplicates is not None
        self.entry.review.claims[0].disposition = "bug"
        self.entry.duplicates.candidates = [DuplicateCandidate.model_validate(dict(
            issue_number=456, relation="duplicate", confidence="high", shared_cause="Same proven cause",
            differences="Only variable names differ", canonical_reason="The canonical tracks the fix",
            evidence=[{"url": self.github.canonical.html_url, "finding": "Same reduced trigger"}],
        ))]
        save_evidence(self.console, self.entry, validity="bug")
        assert self.entry.adjudication is not None
        self.entry.adjudication.duplicate_status, self.entry.adjudication.duplicate_of = "dupe", 456
        self.entry.canonical_issue = self.github.canonical.model_copy(deep=True)
        self.entry.comment = f"Duplicate of [#456]({self.github.canonical.html_url}). The same correction addresses both."

    async def test_duplicate_closure_posts_explanation_without_as_designed_label(self):
        self.duplicate_entry()
        await self.console.close(self.entry)
        self.assertEqual(self.github.mutations, ["comments", "close"])
        self.assertEqual(self.entry.decision, "closed")
        self.assertNotIn("as designed", [label.name for label in self.github.current.labels])
        assert self.entry.closure is not None
        self.assertEqual((self.entry.closure.reason, self.entry.closure.duplicate_of), ("duplicate", 456))

    async def test_duplicate_automatically_posts_canonical_link_and_closes(self):
        self.duplicate_entry()
        self.console.writer = Agent(self.profile.path, "rich-mirror", "A test writer", "Preserve verified facts.")
        self.console.ask = lambda _question: self.fail("Publication is automatic")
        await self.console.decide(self.entry)
        self.assertEqual(self.github.mutations, ["comments", "close"])
        self.assertIn(self.github.canonical.html_url, str(self.github.discussion[0]))

    async def test_duplicate_publication_resume_never_reposts(self):
        self.duplicate_entry()
        self.github.ambiguous_comment = True
        with self.assertRaises(AutomationError):
            await self.console.close(self.entry)
        await self.console.close(self.entry)
        self.assertEqual(self.github.mutations, ["comments", "close"])
        self.assertEqual(len(self.github.discussion), 1)

    async def test_canonical_change_blocks_duplicate_closure(self):
        self.duplicate_entry()
        self.github.canonical.body = "This is actually a different trigger"
        with self.assertRaisesRegex(AutomationError, "Canonical issue changed"):
            await self.console.close(self.entry)
        self.assertEqual(self.github.mutations, [])

    async def test_unsupported_adjudication_gets_rejected_not_downgraded_silently(self):
        self.entry.adjudication = None
        for scenario in ("wrong_hash", "unproven_dupe", "failed_search"):
            result = Adjudication(
                issue_number=123, report_hash=self.console.report_hash(self.entry), validity="by design",
                duplicate_status="no dupe found", duplicate_of=None, rationale="A proposed classification.",
            )
            if scenario == "wrong_hash":
                result.report_hash = "another investigation"
            elif scenario == "unproven_dupe":
                result.duplicate_status, result.duplicate_of = "dupe", 456
            else:
                atomic_write(self.console.directory(123) / "checks.jsonl", json.dumps(product_record(audit())) + "\n")
                result.report_hash = self.console.report_hash(self.entry)

            async def execute(_agent, _prompt, _scratch, **options):
                options["validate"](result.model_dump_json())
                return result.model_dump_json()

            with patch.object(self.console.sdk, "run", AsyncMock(side_effect=execute)):
                with self.assertRaises((AutomationError, ValueError)):
                    await self.console.adjudicate(self.entry)
            self.assertIsNone(self.entry.adjudication)
            self.assertEqual(self.github.mutations, [])

    async def test_dry_run_alias_and_duplicate_compatibility_flag(self):
        with patch("sys.argv", ["review_issues.py", "--dry-run", "--duplicates"]):
            args = arguments()
        self.assertTrue(args.read_only)

    async def test_full_pipeline_saves_both_markdown_reports_and_adjudicates_design_issue(self):
        self.console.duplicate = Agent.load(
            AGENTS / "pyright-issue-dupe-investigator.md", "pyright-issue-dupe-investigator"
        )
        calls: list[str] = []

        async def execute(agent, prompt, scratch, **options):
            calls.append(agent.name)
            if agent.name == "pyright-issue-by-design-reviewer":
                tools = options["tools"]
                self.assertIs(tools.check_preflight, self.console.check_preflight)
                self.assertIn("One-time controller tool preflight", prompt)
                self.assertIn("arguments=[]", prompt)
                self.assertIn("Omit ALL repo:", prompt)
                self.assertIn("not semantic checks", prompt)
                tools.log(product_record(audit()))
                result = ReviewFindings(
                    markdown="# Product findings\n\nThe actual diagnostic follows the rule.", audit=audit(),
                )
            elif agent.name == "pyright-issue-dupe-investigator":
                self.assertIn("Omit ALL repo:", prompt)
                options["tools"].log(search_record())
                result = DuplicateFindings(
                    markdown="# Duplicate findings\n\nThe search found no shared cause.", report=no_duplicates(),
                )
            else:
                self.assertNotIn("tools", options)
                entry = self.console.load(123)
                assert entry is not None
                result = Adjudication(
                    issue_number=123, report_hash=self.console.report_hash(entry), validity="by design",
                    duplicate_status="no dupe found", duplicate_of=None, rationale="The evidence is consistent.",
                )
            raw = result.model_dump_json()
            options.get("validate", lambda _raw: None)(raw)
            return raw

        with patch.object(self.console.sdk, "run", AsyncMock(side_effect=execute)):
            entry = await self.console.review(issue(), retry_failed=False)
        self.assertEqual(calls, [
            "pyright-issue-by-design-reviewer", "pyright-issue-dupe-investigator", "pyright-issue-adjudicator",
        ])
        self.assertIsNotNone(entry.adjudication)
        self.assertIn("actual diagnostic", (self.console.directory(123) / "review.md").read_text())
        self.assertIn("Claim assessment and reproduction", (self.console.directory(123) / "review.md").read_text())
        self.assertIn("search found no shared cause", (self.console.directory(123) / "duplicates.md").read_text())
        self.assertEqual(entry.closure_reason(), "by_design")
        self.assertEqual(self.github.mutations, [])

    async def test_adjudicator_verifies_and_snapshots_a_supported_duplicate(self):
        self.duplicate_entry()
        self.entry.adjudication = None
        records = self.console.records(123) + [
            {
                "tool": "github_read", "investigator": "duplicates", "request": {"operation": "issue", "number": 456},
                "result": self.github.canonical.model_dump(),
            },
            {"tool": "github_read", "investigator": "duplicates", "request": {"operation": "comments", "number": 456}, "result": []},
        ]
        atomic_write(self.console.directory(123) / "checks.jsonl", "".join(json.dumps(item) + "\n" for item in records))
        proposed = Adjudication(
            issue_number=123, report_hash=self.console.report_hash(self.entry), validity="bug",
            duplicate_status="dupe", duplicate_of=456, rationale="The same demonstrated cause affects both examples.",
        )
        self.entry.canonical_issue = None
        with patch.object(self.console.sdk, "run", AsyncMock(return_value=proposed.model_dump_json())):
            await self.console.adjudicate(self.entry)
        self.assertEqual(self.entry.canonical_issue, self.github.canonical)
        self.assertEqual(self.entry.closure_reason(), "duplicate")
        self.assertEqual(self.github.mutations, [])

    async def test_reviewers_historical_search_does_not_prove_duplicate_search_completion(self):
        self.entry.adjudication = None
        record = search_record()
        record["investigator"] = "review"
        atomic_write(self.console.directory(123) / "checks.jsonl", json.dumps(record) + "\n")
        proposed = Adjudication(
            issue_number=123, report_hash=self.console.report_hash(self.entry), validity="by design",
            duplicate_status="no dupe found", duplicate_of=None, rationale="The behavior reviewer searched history.",
        )
        with patch.object(self.console.sdk, "run", AsyncMock(return_value=proposed.model_dump_json())):
            with self.assertRaisesRegex(AutomationError, "GitHub search record"):
                await self.console.adjudicate(self.entry)
        self.assertIsNone(self.entry.adjudication)

    async def test_duplicate_draft_uses_writer_then_toolless_factual_check(self):
        self.duplicate_entry()
        self.entry.comment, self.entry.draft_check = None, None
        self.console.writer = Agent(self.profile.path, "rich-mirror", "A test writer", "Preserve verified facts.")
        comment = f"Duplicate of [#456]({self.github.canonical.html_url}). The same correction handles both triggers."
        with patch.object(self.console.sdk, "run", AsyncMock(side_effect=[
            comment, DraftCheck(approved=True, problems=[]).model_dump_json(),
        ])) as run:
            self.assertEqual(await self.console.prepare_comment(self.entry), comment)
        self.assertEqual(run.call_args_list[0].args[0].name, "rich-mirror")
        for call in run.call_args_list:
            self.assertNotIn("tools", call.kwargs)
        self.assertIn("canonical", run.call_args_list[0].args[1])
        self.assertEqual(self.github.mutations, [])

    async def test_main_evaluates_chunk_concurrently_and_displays_table_before_publication(self):
        snapshots = {123: issue(), 456: self.github.canonical}
        steps: list[tuple[str, int]] = []
        started: set[int] = set()
        both_started = asyncio.Event()
        evaluations_started: set[int] = set()
        both_evaluating = asyncio.Event()
        active_publications = peak_publications = 0

        async def review(snapshot, **_options):
            steps.append(("review", snapshot.number))
            started.add(snapshot.number)
            if len(started) == 2:
                both_started.set()
            await asyncio.wait_for(both_started.wait(), 2)
            return Entry(input_hash="input", context_hash="context", issue=snapshot)

        async def evaluate(entry):
            steps.append(("evaluate", entry.issue.number))
            evaluations_started.add(entry.issue.number)
            if len(evaluations_started) == 2:
                both_evaluating.set()
            await asyncio.wait_for(both_evaluating.wait(), 2)

        async def decide(entry):
            nonlocal active_publications, peak_publications
            self.assertEqual(sum(step == "evaluate" for step, _ in steps), 2)
            self.assertTrue(any("Root Cause Summary" in call.args[0] for call in output.call_args_list))
            active_publications += 1
            peak_publications = max(peak_publications, active_publications)
            await asyncio.sleep(0)
            steps.append(("decide", entry.issue.number))
            active_publications -= 1
            return True

        args = Namespace(
            state_dir=Path(self.temporary.name) / "ordered-state", cli_path="copilot", writer_agent=None,
            read_only=True, model=None, issues=[123, 456], chunk_size=2, timeout=30, retry_failed=False,
        )
        github = AsyncMock()
        github.issue.side_effect = lambda number: snapshots[number]
        github.api.return_value = {"tag_name": "test"}
        with (
            patch("review_issues.GitHub", return_value=github),
            patch("review_issues.InjectionScreening.from_environment"),
            patch("review_issues.process", AsyncMock(return_value=(0, "test", ""))),
            patch("review_issues.context_hash", return_value="context"),
            patch("review_issues.git", return_value="a" * 40),
            patch("review_issues.CopilotClient"),
            patch("review_issues.show") as output,
            patch("review_issues.Console") as constructor,
        ):
            console = constructor.return_value
            console.load.return_value = None
            console.review = AsyncMock(side_effect=review)
            console.evaluate = AsyncMock(side_effect=evaluate)
            console.decide = AsyncMock(side_effect=decide)
            await review_main(args)
        self.assertEqual(steps[:2], [("review", 123), ("review", 456)])
        self.assertEqual(steps[-2:], [("decide", 123), ("decide", 456)])
        self.assertEqual(peak_publications, 1)

    async def test_unexpected_chunk_failure_cancels_other_issue_tasks(self):
        snapshots = {123: issue(), 456: self.github.canonical}
        args = Namespace(
            state_dir=Path(self.temporary.name) / "cancelled-chunk", cli_path="copilot", writer_agent=None,
            read_only=True, model=None, issues=[123, 456], chunk_size=2, timeout=30, retry_failed=False,
        )
        github = AsyncMock()
        github.issue.side_effect = lambda number: snapshots[number]
        github.api.return_value = {"tag_name": "test"}
        started, cancelled = asyncio.Event(), asyncio.Event()

        async def review(snapshot, **_options):
            if snapshot.number == 123:
                await started.wait()
                raise RuntimeError("Unexpected controller failure")
            started.set()
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()

        with (
            patch("review_issues.GitHub", return_value=github),
            patch("review_issues.InjectionScreening.from_environment"),
            patch("review_issues.process", AsyncMock(return_value=(0, "test", ""))),
            patch("review_issues.context_hash", return_value="context"),
            patch("review_issues.git", return_value="a" * 40),
            patch("review_issues.CopilotClient"),
            patch("review_issues.Console") as constructor,
        ):
            console = constructor.return_value
            console.load.return_value = None
            console.review = AsyncMock(side_effect=review)
            console.evaluate, console.decide = AsyncMock(), AsyncMock()
            with self.assertRaisesRegex(RuntimeError, "Unexpected controller failure"):
                await asyncio.wait_for(review_main(args), 2)
            self.assertTrue(cancelled.is_set())
            console.decide.assert_not_awaited()
            self.assertFalse((args.state_dir / "run.lock").exists())

    async def test_overnight_processes_every_chunk_without_prompts_and_reports_cached_issues(self):
        snapshots = {123: issue(), 456: self.github.canonical, 789: issue().model_copy(update={"number": 789})}
        cached = Entry(
            input_hash="input", context_hash="context", issue=snapshots[789], decision="reviewed",
        )
        args = Namespace(
            state_dir=Path(self.temporary.name) / "overnight-chunks", cli_path="copilot", writer_agent=None,
            read_only=True, model=None, issues=[123, 456, 789], chunk_size=1, timeout=30, retry_failed=False,
            overnight=True, non_interactive=True,
        )
        github = AsyncMock()
        github.issue.side_effect = lambda number: snapshots[number]
        github.api.return_value = {"tag_name": "test"}

        async def review(snapshot, **_options):
            return Entry(input_hash="input", context_hash="context", issue=snapshot)

        with (
            patch("review_issues.GitHub", return_value=github),
            patch("review_issues.InjectionScreening.from_environment"),
            patch("review_issues.process", AsyncMock(return_value=(0, "test", ""))),
            patch("review_issues.context_hash", return_value="context"),
            patch("review_issues.git", return_value="a" * 40),
            patch("review_issues.CopilotClient"),
            patch("builtins.input", side_effect=AssertionError("Unexpected overnight prompt")),
            patch("review_issues.Console") as constructor,
        ):
            console = constructor.return_value
            console.load.side_effect = lambda number: cached if number == 789 else None
            console.key.return_value = "input"
            console.review = AsyncMock(side_effect=review)
            console.evaluate, console.decide = AsyncMock(), AsyncMock()
            await review_main(args)
        self.assertEqual([call.args[0].number for call in console.review.await_args_list], [123, 456])
        self.assertEqual(console.decide.await_count, 2)
        self.assertFalse(constructor.call_args.kwargs["prepare_targets"])
        self.assertTrue(constructor.call_args.kwargs["closure_only"])
        self.assertIs(constructor.call_args.kwargs["ask"], reject_operator_approval)
        report = json.loads((args.state_dir / "overnight-report.json").read_text(encoding="utf-8"))
        self.assertEqual([row["issue_number"] for row in report["issues"]], [123, 456, 789])
        self.assertEqual(report["counts"]["needs_review"], 3)
        self.assertTrue(report["execution_complete"])
        self.assertFalse(report["github_mutations_enabled"])

    async def test_overnight_unexpected_failure_reports_pending_issues_and_releases_lock(self):
        args = Namespace(
            state_dir=Path(self.temporary.name) / "overnight-interrupted", cli_path="copilot", writer_agent=None,
            read_only=True, model=None, issues=[123, 456], chunk_size=1, timeout=30, retry_failed=False, overnight=True,
        )
        github = AsyncMock()
        github.issue.side_effect = lambda number: issue() if number == 123 else self.github.canonical
        github.api.return_value = {"tag_name": "test"}
        with (
            patch("review_issues.GitHub", return_value=github),
            patch("review_issues.InjectionScreening.from_environment"),
            patch("review_issues.process", AsyncMock(return_value=(0, "test", ""))),
            patch("review_issues.context_hash", return_value="context"),
            patch("review_issues.git", return_value="a" * 40),
            patch("review_issues.CopilotClient"),
            patch("review_issues.Console") as constructor,
        ):
            console = constructor.return_value
            console.load.return_value = None
            console.review = AsyncMock(side_effect=RuntimeError("Unexpected controller failure"))
            console.evaluate, console.decide = AsyncMock(), AsyncMock()
            with self.assertRaisesRegex(RuntimeError, "Unexpected controller failure"):
                await review_main(args)
        report = json.loads((args.state_dir / "overnight-report.json").read_text(encoding="utf-8"))
        self.assertFalse(report["execution_complete"])
        self.assertEqual(report["counts"]["pending"], 2)
        self.assertIn("Unexpected controller failure", report["run_error"])
        self.assertFalse((args.state_dir / "run.lock").exists())
        console.decide.assert_not_awaited()

    async def test_chunk_failure_preserves_other_results_and_still_prints_the_table(self):
        snapshots = {123: issue(), 456: self.github.canonical}
        args = Namespace(
            state_dir=Path(self.temporary.name) / "failed-chunk", cli_path="copilot", writer_agent=None,
            read_only=True, model=None, issues=[123, 456], chunk_size=2, timeout=30, retry_failed=False,
        )
        github = AsyncMock()
        github.issue.side_effect = lambda number: snapshots[number]
        github.api.return_value = {"tag_name": "test"}

        async def review(snapshot, **_options):
            if snapshot.number == 123:
                raise AutomationError("One investigation failed")
            return Entry(input_hash="input", context_hash="context", issue=snapshot)

        with (
            patch("review_issues.GitHub", return_value=github),
            patch("review_issues.InjectionScreening.from_environment"),
            patch("review_issues.process", AsyncMock(return_value=(0, "test", ""))),
            patch("review_issues.context_hash", return_value="context"),
            patch("review_issues.git", return_value="a" * 40),
            patch("review_issues.CopilotClient"),
            patch("review_issues.show") as output,
            patch("review_issues.Console") as constructor,
        ):
            console = constructor.return_value
            console.load.return_value = None
            console.review = AsyncMock(side_effect=review)
            console.evaluate = AsyncMock()
            console.decide = AsyncMock(return_value=True)
            with self.assertRaisesRegex(AutomationError, "1 investigation/publication steps failed"):
                await review_main(args)
            console.evaluate.assert_awaited_once()
            self.assertEqual(console.decide.call_args.args[0].issue.number, 456)
            table = next(call.args[0] for call in output.call_args_list if "Root Cause Summary" in call.args[0])
            self.assertIn("#123", table)
            self.assertIn("#456", table)
            self.assertIn("One investigation failed", table)

    async def test_main_keeps_validated_judgments_when_only_rca_fails(self):
        assert self.entry.review is not None
        self.entry.review.claims[0].disposition = "bug"
        save_evidence(self.console, self.entry, validity="bug")
        self.entry.root_cause = RootCause(
            input_hash=self.console.report_hash(self.entry), directory=str(self.console.state / "rca"),
            status="failed", error="RCA timed out",
        )
        args = Namespace(
            state_dir=self.console.state, cli_path="copilot", writer_agent=None,
            read_only=True, model=None, issues=[123], chunk_size=1, timeout=30, retry_failed=False,
        )
        github = AsyncMock()
        github.issue.return_value = self.entry.issue
        github.api.return_value = {"tag_name": "test"}
        with (
            patch("review_issues.GitHub", return_value=github),
            patch("review_issues.InjectionScreening.from_environment"),
            patch("review_issues.process", AsyncMock(return_value=(0, "test", ""))),
            patch("review_issues.context_hash", return_value="context"),
            patch("review_issues.git", return_value="a" * 40),
            patch("review_issues.CopilotClient"),
            patch("review_issues.Console", return_value=self.console),
            patch.object(self.console, "review", AsyncMock(return_value=self.entry)),
            patch.object(self.console, "evaluate", AsyncMock(side_effect=AutomationError("RCA timed out"))),
            patch.object(self.console, "decide", AsyncMock()) as decide,
            patch("review_issues.show"),
        ):
            with self.assertRaisesRegex(AutomationError, "1 investigation/publication steps failed"):
                await review_main(args)
        decide.assert_not_awaited()
        summary = json.loads((args.state_dir / "proposals.json").read_text())
        self.assertEqual(summary["behavior_evaluated_issues"], 1)
        self.assertEqual(summary["rca_failed_issues"], 1)
        self.assertEqual(summary["failed_issues"], 1)
        self.assertEqual(summary["proposals"][0]["validity"], "bug")
        self.assertEqual(summary["proposals"][0]["proposed_action"], "blocked")
        self.assertIsNotNone(self.entry.elapsed_seconds)


class SDKLifecycleTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.scratch = Path(self.temporary.name)
        self.agent = Agent.load(AGENTS / "pyright-issue-reproducer.md", "pyright-issue-reproducer")

    def records(self):
        return [json.loads(line) for line in (self.scratch / "sdk-events.jsonl").read_text().splitlines()]

    def session(self):
        session = AsyncMock()
        session.session_id = "offline-lifecycle"
        session.rpc.agent.get_current.return_value = SimpleNamespace(agent=SimpleNamespace(name=self.agent.name))
        session.rpc.tools.get_current_metadata.return_value = SimpleNamespace(tools=[])
        return session

    def event(self, kind, data, *, agent_id=None):
        return SessionEvent(
            id=uuid4(), timestamp=datetime.now(timezone.utc), type=SessionEventType(kind), data=data,
            agent_id=agent_id,
        )

    def recovery_client(self, *, repeated=False, correction=False, resume_progress=False):
        client = AsyncMock()
        sessions = []
        cancelled = []

        async def create(**options):
            session = self.session()
            index = len(sessions)
            session.session_id = f"offline-recovery-{index}"
            sessions.append(session)
            callback = options["on_event"]
            calls = 0

            async def respond(*_args, **_kwargs):
                nonlocal calls
                calls += 1
                if correction and calls == 1:
                    return SimpleNamespace(data=AssistantMessageData(content="invalid JSON", message_id="invalid"))
                if index == 0 or repeated:
                    for _ in range(2):
                        callback(self.event("assistant.message_delta", AssistantMessageDeltaData(
                            delta_content=" ", message_id="reply",
                        )))
                    if resume_progress:
                        callback(self.event("assistant.reasoning_delta", AssistantReasoningDeltaData(
                            delta_content="private meaningful progress", reasoning_id="reason",
                        )))
                        return SimpleNamespace(data=AssistantMessageData(
                            content='{"approved":true,"problems":[]}', message_id="reply",
                        ))
                    try:
                        await asyncio.Event().wait()
                    finally:
                        cancelled.append(index)
                return SimpleNamespace(data=AssistantMessageData(
                    content='{"approved":true,"problems":[]}', message_id="reply",
                ))

            session.send_and_wait.side_effect = respond
            return session

        client.create_session.side_effect = create
        return client, sessions, cancelled

    def small_guard(self):
        return patch("review_issues.WhitespaceStallGuard", side_effect=lambda: WhitespaceStallGuard(
            min_seconds=0, min_chunks=2, min_bytes=2,
        ))

    async def test_whitespace_stall_aborts_drains_and_retries_once_in_a_fresh_linked_session(self):
        client, sessions, cancelled = self.recovery_client()
        with self.small_guard():
            result = await SDK(client, None, 10).run(self.agent, "Offline", self.scratch, schema=DraftCheck)
        self.assertTrue(DraftCheck.model_validate_json(result).approved)
        self.assertEqual(len(sessions), 2)
        self.assertEqual(cancelled, [0])
        sessions[0].abort.assert_awaited_once()
        sessions[1].abort.assert_not_awaited()
        for session in sessions:
            session.disconnect.assert_awaited_once()
        records = self.records()
        stall = next(row["data"] for row in records if row["type"] == "controller.whitespace_stall")
        self.assertTrue(stall["retry_allowed"])
        self.assertEqual(stall["guard"]["chunks"], 2)
        metadata = [json.loads(line) for line in (self.scratch / "sdk-sessions.jsonl").read_text().splitlines()]
        self.assertEqual([row["recovery_index"] for row in metadata], [0, 1])
        self.assertEqual(metadata[1]["previous_session_id"], sessions[0].session_id)
        self.assertFalse([task for task in asyncio.all_tasks() if task.get_name().startswith(("sdk-response-", "sdk-whitespace-"))])

    async def test_recurring_whitespace_stall_is_an_explicit_failure_not_an_unbounded_retry(self):
        client, sessions, cancelled = self.recovery_client(repeated=True)
        with self.small_guard(), self.assertRaisesRegex(AutomationError, "recovery exhausted"):
            await SDK(client, None, 10).run(self.agent, "Offline", self.scratch, schema=DraftCheck)
        self.assertEqual(len(sessions), 2)
        self.assertEqual(cancelled, [0, 1])
        for session in sessions:
            session.abort.assert_awaited_once()
            session.disconnect.assert_awaited_once()
        self.assertFalse((self.scratch / f"{self.agent.name}-last-response.txt").exists())

    async def test_fresh_retry_setup_consumes_the_original_deadline(self):
        client, sessions, _cancelled = self.recovery_client()
        create = client.create_session.side_effect
        cleanup_finished = asyncio.Event()
        recovery = SDKRecovery()
        original_deadline = None

        async def slow_create(**options):
            nonlocal original_deadline
            session = await create(**options)
            if len(sessions) == 1:
                async def disconnect():
                    nonlocal original_deadline
                    original_deadline = recovery.deadline
                    await asyncio.sleep(0.01)
                    cleanup_finished.set()
                session.disconnect.side_effect = disconnect
            else:
                self.assertTrue(cleanup_finished.is_set())
                self.assertEqual(recovery.deadline, original_deadline)
                assert recovery.setup_timeout is not None
                self.assertEqual(recovery.setup_timeout.when(), original_deadline)
                async def setup():
                    assert recovery.setup_timeout is not None
                    recovery.setup_timeout.reschedule(asyncio.get_running_loop().time())
                    await asyncio.Event().wait()
                session.rpc.tools.initialize_and_validate.side_effect = setup
            return session

        client.create_session.side_effect = slow_create
        with (
            self.small_guard(), patch("review_issues.SDKRecovery", return_value=recovery),
            self.assertRaisesRegex(AutomationError, "original SDK deadline"),
        ):
            await SDK(client, None, 30).run(self.agent, "Offline", self.scratch, schema=DraftCheck)
        self.assertEqual(len(sessions), 2)
        sessions[1].send_and_wait.assert_not_awaited()
        for session in sessions:
            session.disconnect.assert_awaited_once()
        stalls = [row for row in self.records() if row["type"] == "controller.whitespace_stall"]
        self.assertEqual(len(stalls), 1)

    async def test_validation_correction_cannot_gain_an_extra_fresh_session(self):
        client, sessions, _cancelled = self.recovery_client(correction=True)
        with self.small_guard(), self.assertRaisesRegex(AutomationError, "recovery not safe"):
            await SDK(client, None, 10).run(self.agent, "Offline", self.scratch, schema=DraftCheck)
        self.assertEqual(len(sessions), 1)
        self.assertEqual(sessions[0].send_and_wait.await_count, 2)
        self.assertEqual((self.scratch / f"{self.agent.name}-response-1.txt").read_text(), "invalid JSON")
        self.assertFalse((self.scratch / f"{self.agent.name}-response-2.txt").exists())

    async def test_meaningful_progress_clears_a_queued_stall_before_it_can_abort(self):
        client, sessions, _cancelled = self.recovery_client(resume_progress=True)
        with self.small_guard():
            result = await SDK(client, None, 10).run(self.agent, "Offline", self.scratch, schema=DraftCheck)
        self.assertTrue(DraftCheck.model_validate_json(result).approved)
        self.assertEqual(len(sessions), 1)
        sessions[0].abort.assert_not_awaited()
        self.assertNotIn("private meaningful progress", (self.scratch / "sdk-events.jsonl").read_text())

    async def test_unstructured_turns_do_not_enable_whitespace_recovery(self):
        client, sessions, cancelled = self.recovery_client()
        with self.small_guard(), self.assertRaisesRegex(AutomationError, "timed out"):
            await SDK(client, None, 0.2).run(self.agent, "Offline", self.scratch)
        self.assertEqual(len(sessions), 1)
        self.assertEqual(cancelled, [0])
        self.assertFalse([row for row in self.records() if row["type"] == "controller.whitespace_stall"])

    async def test_tool_bearing_structured_turns_never_replay_tools_for_whitespace(self):
        client, sessions, cancelled = self.recovery_client()
        create = client.create_session.side_effect
        tools = ReproductionEvidenceTools(FakeGitHub(), self.scratch, [])

        async def create_tools(**options):
            session = await create(**options)
            session.rpc.tools.get_current_metadata.return_value = SimpleNamespace(
                tools=[SimpleNamespace(name=tool.name) for tool in tools.tools],
            )
            return session

        client.create_session.side_effect = create_tools
        with self.small_guard(), self.assertRaisesRegex(AutomationError, "timed out"):
            await SDK(client, None, 0.2).run(
                self.agent, "Offline", self.scratch, schema=DraftCheck, tools=tools, native_tools=[],
            )
        self.assertEqual(len(sessions), 1)
        self.assertEqual(cancelled, [0])
        self.assertFalse([row for row in self.records() if row["type"] == "controller.whitespace_stall"])

    async def test_subagent_whitespace_never_triggers_root_recovery(self):
        sdk, session, _actual = await self.installed_wait([
            self.event("assistant.message_delta", AssistantMessageDeltaData(delta_content=" ", message_id="child"), agent_id="child")
            for _ in range(10)
        ])
        with self.small_guard(), self.assertRaisesRegex(AutomationError, "timed out"):
            await sdk.run(self.agent, "Offline", self.scratch, schema=DraftCheck)
        self.assertFalse([row for row in self.records() if row["type"] == "controller.whitespace_stall"])
        session.abort.assert_awaited_once()

    async def test_cancellation_drains_structured_wait_and_guard_without_recovery(self):
        client, sessions, cancelled = self.recovery_client()
        waiting = asyncio.Event()
        create = client.create_session.side_effect

        async def create_wait(**options):
            session = await create(**options)
            async def wait(*_args, **_kwargs):
                waiting.set()
                try:
                    await asyncio.Event().wait()
                finally:
                    cancelled.append(0)
            session.send_and_wait.side_effect = wait
            return session

        client.create_session.side_effect = create_wait
        task = asyncio.create_task(SDK(client, None, 30).run(self.agent, "Offline", self.scratch, schema=DraftCheck))
        await waiting.wait()
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertEqual(len(sessions), 1)
        self.assertEqual(cancelled, [0])
        sessions[0].abort.assert_awaited_once()
        sessions[0].disconnect.assert_awaited_once()
        self.assertFalse([item for item in asyncio.all_tasks() if item.get_name().startswith(("sdk-response-", "sdk-whitespace-"))])

    async def installed_wait(self, events, *, timeout=0.05):
        transport = AsyncMock()
        actual = CopilotSession("offline-lifecycle", transport)
        session = self.session()
        session.send_and_wait.side_effect = actual.send_and_wait

        async def send(_method, _params):
            for event in events:
                actual._dispatch_event(event)
            return {"messageId": "request-id"}

        transport.request.side_effect = send
        client = AsyncMock()

        async def create(**options):
            self.assertTrue(options["streaming"])
            self.assertTrue(options["include_sub_agent_streaming_events"])
            actual.on(options["on_event"])
            return session

        client.create_session.side_effect = create
        return SDK(client, None, timeout), session, actual

    async def test_final_message_and_usage_without_idle_do_not_bypass_installed_completion_wait(self):
        content = '{"approved":true,"problems":[]}'
        events = [
            self.event("user.message", UserMessageData(content="private prompt", message_id="request-id")),
            self.event("assistant.usage", AssistantUsageData(model="offline", input_tokens=3, output_tokens=2)),
            self.event("assistant.message", AssistantMessageData(
                content=content, message_id="reply-id", originating_message_id="request-id",
            )),
        ]
        events[1:1] = [
            self.event("assistant.message_delta", AssistantMessageDeltaData(
                delta_content="private partial content", message_id="reply-id",
            )) for _ in range(20)
        ] + [
            self.event("assistant.reasoning_delta", AssistantReasoningDeltaData(
                delta_content="private reasoning", reasoning_id="reason-id",
            )) for _ in range(20)
        ] + [
            self.event("assistant.message_delta", AssistantMessageDeltaData(
                delta_content="private subagent partial content", message_id="child-id",
            ), agent_id="child") for _ in range(10)
        ] + [
            self.event("assistant.reasoning", AssistantReasoningData(
                content="private complete reasoning", reasoning_id="complete-reason",
            ), agent_id=scope) for scope in (None, "child")
        ]
        sdk, session, actual = await self.installed_wait(events)
        with self.assertRaisesRegex(AutomationError, "timed out"):
            await sdk.run(self.agent, "private prompt", self.scratch, schema=DraftCheck, native_tools=[])
        records = self.records()
        final = next(record["data"] for record in records if record["type"] == "assistant.message")
        self.assertEqual(final["message_id"], "reply-id")
        self.assertEqual(final["originating_message_id"], "request-id")
        self.assertEqual(final["content_bytes"], len(content.encode("utf-8")))
        self.assertEqual(len(final["content_sha256"]), 64)
        self.assertEqual(final["tool_request_count"], 0)
        self.assertEqual(len([record for record in records if record["type"] == "assistant.message_delta"]), 2)
        self.assertEqual(len([record for record in records if record["type"] == "assistant.reasoning_delta"]), 1)
        failure = next(record["data"] for record in records if record["type"] == "controller.timeout")
        self.assertEqual(failure["event_counts"]["root:assistant.message_delta"], 20)
        self.assertEqual(failure["event_counts"]["subagent:assistant.message_delta"], 10)
        self.assertEqual(failure["event_counts"]["root:assistant.reasoning_delta"], 20)
        self.assertEqual(failure["event_counts"]["root:assistant.reasoning"], 1)
        self.assertEqual(failure["event_counts"]["subagent:assistant.reasoning"], 1)
        self.assertEqual(failure["event_counts"]["root:assistant.message"], 1)
        self.assertEqual(failure["event_counts"]["root:assistant.usage"], 1)
        self.assertNotIn("root:session.idle", failure["event_counts"])
        self.assertTrue(failure["deadline_expired"])
        self.assertEqual(failure["last_event"]["type"], "assistant.message")
        self.assertEqual(failure["phase"], "response_wait")
        self.assertEqual(failure["generation_activity"]["root"]["events"], 42)
        self.assertEqual(failure["generation_activity"]["subagent"]["events"], 11)
        self.assertEqual(failure["generation_activity"]["root"]["nonempty_events"], 42)
        reasoning = failure["stream_activity"]["root:assistant.reasoning_delta"]
        self.assertEqual(reasoning["utf8_bytes"], 20 * len("private reasoning".encode()))
        self.assertEqual(reasoning["adjacent_same_stream_repeats"], 19)
        self.assertGreaterEqual(failure["seconds_since_last_event"], 0)
        self.assertGreaterEqual(failure["generation_activity"]["root"]["seconds_since_last_generation"], 0)
        self.assertFalse((self.scratch / f"{self.agent.name}-response-1.txt").exists())
        text = (self.scratch / "sdk-events.jsonl").read_text()
        self.assertNotIn("private prompt", text)
        self.assertNotIn("private partial content", text)
        self.assertNotIn("private reasoning", text)
        self.assertNotIn("private complete reasoning", text)
        self.assertNotIn("private subagent partial content", text)
        self.assertNotIn(content, text)
        self.assertFalse(actual._structured_waits)
        session.abort.assert_awaited_once()
        session.disconnect.assert_awaited_once()

    async def test_retry_and_model_call_diagnostics_are_visible_without_private_payloads(self):
        sdk, session, _actual = await self.installed_wait([
            self.event("model.call_start", ModelCallStartData(turn_id="turn-id", model="offline")),
            self.event("model.call_failure", ModelCallFailureData(
                source=next(iter(ModelCallFailureSource)), status_code=429, retry_attempt=1,
                error_message="private provider payload",
            )),
            self.event("assistant.turn_retry", AssistantTurnRetryData(
                turn_id="turn-id", model="offline", reason="private retry explanation",
            )),
        ])
        with self.assertRaisesRegex(AutomationError, "timed out"):
            await sdk.run(self.agent, "Offline", self.scratch)
        rows = self.records()
        failure = next(row["data"] for row in rows if row["type"] == "controller.timeout")
        self.assertEqual(failure["event_counts"]["root:model.call_start"], 1)
        self.assertEqual(failure["event_counts"]["root:assistant.turn_retry"], 1)
        self.assertEqual(failure["generation_activity"], {})
        model = next(row["data"] for row in rows if row["type"] == "model.call_failure")
        self.assertEqual(model["status_code"], 429)
        self.assertEqual(model["retry_attempt"], 1)
        text = (self.scratch / "sdk-events.jsonl").read_text()
        self.assertNotIn("private provider payload", text)
        self.assertNotIn("private retry explanation", text)
        session.abort.assert_awaited_once()

    async def test_empty_and_repeated_deltas_are_numeric_metadata_not_completed_output(self):
        events = [
            self.event("assistant.message_delta", AssistantMessageDeltaData(delta_content=text, message_id="reply"))
            for text in ("", " ", " ", "private-chunk", "private-chunk", "")
        ] + [
            self.event("assistant.reasoning_delta", AssistantReasoningDeltaData(
                delta_content="private reasoning", reasoning_id="reason",
            ), agent_id=scope) for scope in (None, "child")
        ] + [
            self.event("assistant.message_delta", AssistantMessageDeltaData(
                delta_content="private subagent", message_id="child-reply",
            ), agent_id="child")
        ]
        sdk, session, _actual = await self.installed_wait(events)
        with self.assertRaisesRegex(AutomationError, "timed out"):
            await sdk.run(self.agent, "Offline", self.scratch)
        timeout = next(row["data"] for row in self.records() if row["type"] == "controller.timeout")
        activity = timeout["stream_activity"]["root:assistant.message_delta"]
        self.assertEqual(activity["events"], 6)
        self.assertEqual(activity["utf8_bytes"], 2 + 2 * len("private-chunk".encode()))
        self.assertEqual(activity["empty_events"], 2)
        self.assertEqual(activity["whitespace_events"], 2)
        self.assertEqual(activity["adjacent_same_stream_repeats"], 2)
        self.assertEqual(activity["max_identical_chunk_run"], 2)
        self.assertEqual(timeout["generation_activity"]["root"]["nonempty_events"], 5)
        self.assertIsNotNone(timeout["generation_activity"]["root"]["last_nonempty_elapsed_seconds"])
        self.assertGreaterEqual(timeout["generation_activity"]["root"]["seconds_since_last_nonempty"], 0)
        self.assertEqual(timeout["stream_activity"]["subagent:assistant.reasoning_delta"]["events"], 1)
        self.assertEqual(len(timeout["stream_activity"]), 4)
        metadata = json.loads((self.scratch / "sdk-sessions.jsonl").read_text().splitlines()[-1])
        self.assertEqual(metadata["diagnostics_schema_version"], 3)
        text = (self.scratch / "sdk-events.jsonl").read_text()
        self.assertNotIn("private-chunk", text)
        self.assertNotIn("private reasoning", text)
        self.assertNotIn("private subagent", text)
        session.abort.assert_awaited_once()

    async def test_only_empty_deltas_leave_nonempty_generation_unobserved(self):
        sdk, _session, _actual = await self.installed_wait([
            self.event("assistant.message_delta", AssistantMessageDeltaData(delta_content="", message_id="reply"))
            for _ in range(50)
        ])
        with self.assertRaisesRegex(AutomationError, "timed out"):
            await sdk.run(self.agent, "Offline", self.scratch)
        timeout = next(row["data"] for row in self.records() if row["type"] == "controller.timeout")
        self.assertEqual(timeout["generation_activity"]["root"]["events"], 50)
        self.assertEqual(timeout["generation_activity"]["root"]["nonempty_events"], 0)
        self.assertIsNone(timeout["generation_activity"]["root"]["last_nonempty_elapsed_seconds"])
        self.assertIsNone(timeout["generation_activity"]["root"]["seconds_since_last_nonempty"])
        self.assertEqual(timeout["stream_activity"]["root:assistant.message_delta"]["empty_events"], 50)
        self.assertEqual(timeout["stream_activity"]["root:assistant.message_delta"]["utf8_bytes"], 0)

    async def test_responsive_heartbeat_does_not_imply_generation_or_extend_controller_timeout(self):
        session, client = self.session(), AsyncMock()
        async def wait(*_args, **_kwargs):
            await asyncio.Event().wait()
        session.send_and_wait.side_effect = wait
        client.create_session.return_value = session
        with (
            patch("review_issues.SDK_HEARTBEAT_SECONDS", 0.01),
            patch("review_issues.SDK_PING_TIMEOUT_SECONDS", 0.02),
            self.assertRaisesRegex(AutomationError, "not evidence of model progress"),
        ):
            await SDK(client, None, 0.1).run(self.agent, "Offline", self.scratch)
        failure = next(row["data"] for row in self.records() if row["type"] == "controller.timeout")
        self.assertTrue(failure["deadline_expired"])
        self.assertEqual(failure["last_heartbeat"]["rpc_status"], "responsive")
        self.assertFalse(failure["last_heartbeat"]["proves_model_progress"])
        self.assertEqual(failure["last_heartbeat"]["scope"], "shared_runtime")
        self.assertEqual(failure["generation_activity"], {})
        self.assertIsNone(failure["last_event"])
        self.assertIsNotNone(failure["seconds_since_last_rpc_success"])
        self.assertFalse(failure["heartbeat_in_flight"])
        client.ping.assert_awaited()
        self.assertFalse([task for task in asyncio.all_tasks() if task.get_name().startswith("sdk-heartbeat-")])

    async def test_ping_failure_or_timeout_is_diagnostic_and_does_not_fail_a_valid_response(self):
        errors = {
            "error": RuntimeError("private transport credential"),
            "rpc_error": JsonRpcError(-32601, "private transport credential"),
            "process_exit": ProcessExitedError("private transport credential"),
        }
        for mode in (*errors, "timeout"):
            with self.subTest(mode=mode):
                session, client = self.session(), AsyncMock()
                ping_finished = asyncio.Event()

                async def ping():
                    try:
                        if mode in errors:
                            raise errors[mode]
                        await asyncio.Event().wait()
                    finally:
                        ping_finished.set()

                async def respond(*_args, **_kwargs):
                    await ping_finished.wait()
                    await asyncio.sleep(0)
                    return SimpleNamespace(data=AssistantMessageData(content="Offline result", message_id="reply"))

                client.ping.side_effect = ping
                client.create_session.return_value = session
                session.send_and_wait.side_effect = respond
                with patch("review_issues.SDK_HEARTBEAT_SECONDS", 0.001), patch("review_issues.SDK_PING_TIMEOUT_SECONDS", 0.01):
                    result = await SDK(client, None, 1).run(self.agent, "Offline", self.scratch)
                self.assertEqual(result, "Offline result")
                probes = [row["data"] for row in self.records() if row["type"] == "controller.heartbeat"]
                self.assertEqual(probes[-1]["rpc_status"], "timeout" if mode == "timeout" else "error")
                if mode == "rpc_error":
                    self.assertEqual(probes[-1]["rpc_error_code"], -32601)
                self.assertNotIn("private transport credential", (self.scratch / "sdk-events.jsonl").read_text())
                session.abort.assert_not_awaited()
                session.disconnect.assert_awaited_once()

    async def test_cancellation_drains_inflight_ping_and_unregisters_runtime_correlation(self):
        session, client = self.session(), AsyncMock()
        ping_started, ping_cancelled = asyncio.Event(), asyncio.Event()

        async def ping():
            ping_started.set()
            try:
                await asyncio.Event().wait()
            finally:
                ping_cancelled.set()

        async def wait(*_args, **_kwargs):
            await asyncio.Event().wait()

        client.ping.side_effect = ping
        client.create_session.return_value = session
        session.send_and_wait.side_effect = wait
        async with RuntimeDiagnostics(self.scratch / "runtime.jsonl") as diagnostics:
            with patch("review_issues.SDK_HEARTBEAT_SECONDS", 0.001):
                task = asyncio.create_task(SDK(client, None, 30, diagnostics=diagnostics).run(self.agent, "Offline", self.scratch))
                await asyncio.wait_for(ping_started.wait(), 1)
                task.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await task
            self.assertTrue(ping_cancelled.is_set())
            self.assertEqual(diagnostics._sessions, {})
        records = self.records()
        cancelled = next(row["data"] for row in records if row["type"] == "controller.cancelled")
        self.assertEqual(cancelled["last_heartbeat"]["rpc_status"], "cancelled")
        self.assertFalse(cancelled["heartbeat_in_flight"])
        session.abort.assert_awaited_once()
        session.disconnect.assert_awaited_once()
        before = (self.scratch / "sdk-events.jsonl").read_bytes()
        await asyncio.sleep(0.01)
        self.assertEqual((self.scratch / "sdk-events.jsonl").read_bytes(), before)

    async def test_successful_completion_cancels_an_inflight_ping_without_aborting_the_turn(self):
        session, client = self.session(), AsyncMock()
        ping_started, ping_cancelled = asyncio.Event(), asyncio.Event()

        async def ping():
            ping_started.set()
            try:
                await asyncio.Event().wait()
            finally:
                ping_cancelled.set()

        async def respond(*_args, **_kwargs):
            await ping_started.wait()
            return SimpleNamespace(data=AssistantMessageData(content="Offline result", message_id="reply"))

        client.ping.side_effect = ping
        client.create_session.return_value = session
        session.send_and_wait.side_effect = respond
        with patch("review_issues.SDK_HEARTBEAT_SECONDS", 0.001):
            result = await SDK(client, None, 1).run(self.agent, "Offline", self.scratch)
        self.assertEqual(result, "Offline result")
        self.assertTrue(ping_cancelled.is_set())
        session.abort.assert_not_awaited()
        session.disconnect.assert_awaited_once()
        self.assertFalse([task for task in asyncio.all_tasks() if task.get_name().startswith("sdk-heartbeat-")])

    async def test_heartbeats_run_during_approval_pause_without_changing_the_active_deadline(self):
        session, client = self.session(), AsyncMock()
        active_budget, approval_pause = 0.3, 0.6
        tools = ReproductionEvidenceTools(FakeGitHub(), self.scratch, [])
        session.rpc.tools.get_current_metadata.return_value = SimpleNamespace(
            tools=[SimpleNamespace(name=tool.name) for tool in tools.tools],
        )

        async def respond(*_args, **_kwargs):
            deadline = tools.deadline
            assert deadline is not None
            when = deadline.when()
            assert when is not None
            clock = asyncio.get_running_loop().time
            remaining = when - clock()
            deadline.reschedule(None)
            await asyncio.sleep(approval_pause)
            deadline.reschedule(clock() + remaining)
            return SimpleNamespace(data=AssistantMessageData(content="Offline result", message_id="reply"))

        client.create_session.return_value = session
        session.send_and_wait.side_effect = respond
        with patch("review_issues.SDK_HEARTBEAT_SECONDS", 0.05):
            result = await SDK(client, None, active_budget).run(self.agent, "Offline", self.scratch, tools=tools, native_tools=[])
        self.assertGreater(approval_pause, active_budget)
        self.assertEqual(result, "Offline result")
        heartbeats = [row["data"] for row in self.records() if row["type"] == "controller.heartbeat"]
        self.assertTrue(any(row["deadline_paused"] and row["rpc_status"] == "responsive" for row in heartbeats))
        self.assertIsNone(tools.deadline)
        session.abort.assert_not_awaited()

    async def test_correction_resets_generation_activity_but_shares_the_original_deadline(self):
        session, client = self.session(), AsyncMock()
        listener = None
        attempts = 0

        async def create(**options):
            nonlocal listener
            listener = options["on_event"]
            return session

        async def respond(*_args, **_kwargs):
            nonlocal attempts
            attempts += 1
            assert listener is not None
            if attempts == 1:
                listener(self.event("assistant.message_delta", AssistantMessageDeltaData(
                    delta_content="private first attempt", message_id="first",
                )))
                return SimpleNamespace(data=AssistantMessageData(content="invalid JSON", message_id="first"))
            await asyncio.Event().wait()

        client.create_session.side_effect = create
        session.send_and_wait.side_effect = respond
        with self.assertRaisesRegex(AutomationError, "timed out"):
            await SDK(client, None, 0.5).run(self.agent, "Offline", self.scratch, schema=DraftCheck)
        failure = next(row["data"] for row in self.records() if row["type"] == "controller.timeout")
        self.assertEqual(failure["attempt"], 2)
        self.assertEqual(failure["generation_activity"], {})
        self.assertEqual(failure["stream_activity"], {})
        self.assertEqual(failure["event_counts"], {})
        waits = [row["data"] for row in self.records() if row["type"] == "controller.lifecycle" and row["data"]["phase"] == "response_wait"]
        self.assertLess(waits[1]["remaining_active_seconds"], waits[0]["remaining_active_seconds"])
        returned = next(row["data"] for row in self.records() if row["type"] == "controller.lifecycle" and row["data"]["phase"] == "response_returned")
        self.assertEqual(returned["stream_activity"]["root:assistant.message_delta"]["events"], 1)
        self.assertEqual(returned["generation_activity"]["root"]["nonempty_events"], 1)
        self.assertNotIn("private first attempt", (self.scratch / "sdk-events.jsonl").read_text())

    async def test_parallel_turn_timeout_does_not_cancel_healthy_sibling_or_misattribute_runtime_logs(self):
        client = AsyncMock()
        sessions = {}
        both_started = asyncio.Event()
        running = 0

        async def create(**options):
            nonlocal running
            key = Path(options["additional_directories"][0]).name
            session = self.session()
            session.session_id = "parallel-" + key
            sessions[key] = session

            async def respond(*_args, **_kwargs):
                nonlocal running
                running += 1
                if running == 2:
                    logging.getLogger("copilot._jsonrpc").warning("[CLI] %s", "shared transport private payload")
                    both_started.set()
                await both_started.wait()
                if key == "healthy":
                    return SimpleNamespace(data=AssistantMessageData(content="Offline result", message_id="reply"))
                await asyncio.sleep(0.01)
                raise TimeoutError("Offline nested response timeout")

            session.send_and_wait.side_effect = respond
            return session

        client.create_session.side_effect = create
        for key in ("healthy", "timeout"):
            (self.scratch / key).mkdir()
        async with RuntimeDiagnostics(self.scratch / "runtime.jsonl") as diagnostics:
            sdk = SDK(client, None, 3, diagnostics=diagnostics)
            with patch("review_issues.SDK_HEARTBEAT_SECONDS", 0.005):
                results = await asyncio.gather(*(
                    sdk.run(self.agent, "Offline", self.scratch / key) for key in ("healthy", "timeout")
                ), return_exceptions=True)
            self.assertEqual(diagnostics._sessions, {})
        self.assertEqual(results[0], "Offline result")
        self.assertIsInstance(results[1], AutomationError)
        sessions["healthy"].abort.assert_not_awaited()
        sessions["timeout"].abort.assert_awaited_once()
        for session in sessions.values():
            session.disconnect.assert_awaited_once()
        rows = [json.loads(line) for line in (self.scratch / "runtime.jsonl").read_text().splitlines()]
        log = next(row for row in rows if row["type"] == "runtime.log")
        self.assertEqual(log["correlation"], "active_sessions_only")
        self.assertEqual({row["session_id"] for row in log["sessions"]}, {"parallel-healthy", "parallel-timeout"})
        self.assertNotIn("private payload", (self.scratch / "runtime.jsonl").read_text())

    async def test_autopilot_idle_is_recorded_but_does_not_complete_structured_output(self):
        sdk, session, _actual = await self.installed_wait([
            self.event("assistant.message", AssistantMessageData(
                content='{"approved":true,"problems":[]}', message_id="reply-id", originating_message_id="request-id",
            )),
            self.event("session.idle", SessionIdleData(mode=SessionMode.AUTOPILOT)),
        ])
        with self.assertRaisesRegex(AutomationError, "timed out"):
            await sdk.run(self.agent, "Offline only", self.scratch, schema=DraftCheck, native_tools=[])
        idle = next(record["data"] for record in self.records() if record["type"] == "session.idle")
        self.assertEqual(idle["mode"], "autopilot")
        self.assertIsNone(idle["agent_id"])
        session.abort.assert_awaited_once()

    async def test_correlated_root_message_and_idle_still_require_and_pass_host_validation(self):
        content = '{"approved":true,"problems":[]}'
        sdk, session, _actual = await self.installed_wait([
            self.event("assistant.turn_start", AssistantTurnStartData(turn_id="turn-id")),
            self.event("assistant.message", AssistantMessageData(
                content="unrelated root content", message_id="other", originating_message_id="different-request",
            )),
            self.event("assistant.message", AssistantMessageData(
                content="subagent content", message_id="child-reply", originating_message_id="request-id",
            ), agent_id="child"),
            self.event("session.idle", SessionIdleData(mode=SessionMode.INTERACTIVE), agent_id="child"),
            self.event("assistant.message", AssistantMessageData(
                content=content, message_id="reply-id", originating_message_id="request-id",
            )),
            self.event("assistant.turn_end", AssistantTurnEndData(turn_id="turn-id")),
            self.event("session.idle", SessionIdleData(mode=SessionMode.INTERACTIVE)),
        ], timeout=1)
        seen = []
        result = await sdk.run(
            self.agent, "Offline only", self.scratch, schema=DraftCheck, native_tools=[], validate=seen.append,
        )
        self.assertEqual(result, content)
        self.assertEqual(seen, [content])
        self.assertEqual((self.scratch / f"{self.agent.name}-response-1.txt").read_text(), content)
        records = self.records()
        phases = [record["data"]["phase"] for record in records if record["type"] == "controller.lifecycle"]
        self.assertIn("response_returned", phases)
        self.assertIn("response_decode", phases)
        self.assertIn("schema_validation", phases)
        self.assertIn("host_validation", phases)
        self.assertIn("validated", phases)
        messages = [record["data"] for record in records if record["type"] == "assistant.message"]
        self.assertEqual([item["originating_message_id"] for item in messages], [
            "different-request", "request-id", "request-id",
        ])
        self.assertEqual(messages[1]["agent_id"], "child")
        turn_events = [record for record in records if record["type"].startswith("assistant.turn_")]
        self.assertEqual([record["data"]["turn_id"] for record in turn_events], ["turn-id", "turn-id"])
        session.abort.assert_not_awaited()
        session.disconnect.assert_awaited_once()

    async def test_nested_timeout_is_distinguished_from_exhausted_controller_deadline(self):
        session, client = self.session(), AsyncMock()
        session.send_and_wait.side_effect = TimeoutError("offline nested timeout")
        client.create_session.return_value = session
        with self.assertRaisesRegex(AutomationError, "timed out"):
            await SDK(client, None, 30).run(self.agent, "Offline", self.scratch)
        failure = next(record["data"] for record in self.records() if record["type"] == "controller.timeout")
        self.assertFalse(failure["deadline_expired"])
        self.assertGreater(failure["remaining_active_seconds"], 0)
        self.assertEqual(failure["phase"], "response_wait")
        session.abort.assert_awaited_once()
        session.disconnect.assert_awaited_once()

    async def test_cancellation_propagates_after_logged_abort_and_disconnect(self):
        session, client = self.session(), AsyncMock()
        waiting = asyncio.Event()

        async def wait(*_args, **_kwargs):
            waiting.set()
            await asyncio.Event().wait()

        session.send_and_wait.side_effect = wait
        client.create_session.return_value = session
        task = asyncio.create_task(SDK(client, None, 30).run(self.agent, "Offline", self.scratch))
        await waiting.wait()
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        records = self.records()
        self.assertIn("controller.cancelled", [record["type"] for record in records])
        self.assertNotIn("controller.timeout", [record["type"] for record in records])
        self.assertEqual(records[-1]["data"]["phase"], "disconnect_finished")
        self.assertTrue(records[-1]["data"]["completed"])
        session.abort.assert_awaited_once()
        session.disconnect.assert_awaited_once()

    async def test_disconnect_failure_remains_explicit_and_is_not_reported_as_success(self):
        session, client = self.session(), AsyncMock()
        session.send_and_wait.return_value = SimpleNamespace(data=AssistantMessageData(
            content="Offline response", message_id="reply-id",
        ))
        session.disconnect.side_effect = RuntimeError("offline detach failure")
        client.create_session.return_value = session
        with self.assertRaisesRegex(RuntimeError, "offline detach failure"):
            await SDK(client, None, 30).run(self.agent, "Offline", self.scratch)
        record = self.records()[-1]
        self.assertEqual(record["data"]["phase"], "disconnect_finished")
        self.assertFalse(record["data"]["completed"])


class CheckPreflightTests(unittest.IsolatedAsyncioTestCase):
    async def test_parallel_reviews_share_one_probe_per_executable(self):
        source_cli = ROOT / "packages" / "pyright" / "index.js"
        preflight = CheckPreflight(source_cli)

        async def execute(command, cwd, **options):
            self.assertEqual(cwd, ROOT)
            self.assertEqual(options, {"timeout": 10})
            return (0, "mypy 1.20.0\n", "") if "-m" in command else (0, "pyright 1.1.414\n", "")

        with patch("review_issues.process", AsyncMock(side_effect=execute)) as run:
            results = await asyncio.gather(*(preflight.get() for _ in range(10)))
            self.assertIs(await preflight.get(), results[0])
        self.assertTrue(all(result is results[0] for result in results))
        self.assertEqual(run.await_count, 2)
        commands = [call.args[0] for call in run.await_args_list]
        self.assertIn(["node", str(source_cli), "--version"], commands)
        self.assertIn([sys.executable, "-I", "-B", "-m", "mypy", "--version"], commands)
        self.assertEqual(results[0].pyright.version, "pyright 1.1.414")
        self.assertEqual(results[0].mypy.version, "mypy 1.20.0")
        self.assertTrue(results[0].pyright.available)
        self.assertTrue(results[0].mypy.available)
        self.assertEqual(
            results[0].mypy.command,
            subprocess.list2cmdline([sys.executable, "-I", "-B", "-m", "mypy", "--version"]),
        )

    async def test_failed_or_unrecognized_version_never_becomes_available(self):
        for result in ((1, "", "No module named mypy"), (0, "", ""), (0, "another checker 1.0", "")):
            with self.subTest(result=result), patch("review_issues.process", AsyncMock(return_value=result)) as run:
                preflight = CheckPreflight(ROOT / "packages" / "pyright" / "index.js")
                capabilities = await preflight.get()
                self.assertIs(await preflight.get(), capabilities)
                self.assertFalse(capabilities.mypy.available)
                self.assertIsNone(capabilities.mypy.version)
                self.assertEqual(capabilities.mypy.exit_code, result[0])
                self.assertEqual(capabilities.mypy.stdout, result[1])
                self.assertEqual(capabilities.mypy.stderr, result[2])
                self.assertIn("Version preflight failed", capabilities.mypy.error or "")
                self.assertEqual(run.await_count, 2)

    async def test_launch_and_timeout_failures_are_explicit_and_cached(self):
        for error in (FileNotFoundError("node unavailable"), TimeoutError("bounded version probe timed out")):
            with self.subTest(error=error), patch("review_issues.process", AsyncMock(side_effect=error)) as run:
                preflight = CheckPreflight(ROOT / "packages" / "pyright" / "index.js")
                capabilities = await preflight.get()
                self.assertIs(await preflight.get(), capabilities)
                for capability in (capabilities.pyright, capabilities.mypy):
                    self.assertFalse(capability.available)
                    self.assertIsNone(capability.exit_code)
                    self.assertEqual(capability.error, str(error))
                self.assertEqual(run.await_count, 2)

    async def test_cancellation_does_not_cache_a_partial_preflight(self):
        started = asyncio.Event()
        calls = 0

        async def wait(*_args, **_options):
            nonlocal calls
            calls += 1
            if calls == 2:
                started.set()
            await asyncio.Event().wait()

        preflight = CheckPreflight(ROOT / "packages" / "pyright" / "index.js")
        with patch("review_issues.process", AsyncMock(side_effect=wait)):
            pending = asyncio.create_task(preflight.get())
            await asyncio.wait_for(started.wait(), 2)
            pending.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await pending
        with patch("review_issues.process", AsyncMock(return_value=(0, "mypy 1.20.0\n", ""))) as run:
            result = await preflight.get()
        self.assertTrue(result.mypy.available)
        self.assertEqual(run.await_count, 2)


class ToolTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.scratch = Path(self.temporary.name).resolve()
        self.tools = InvestigationTools(FakeGitHub(), self.scratch, ROOT / "packages" / "pyright" / "index.js", {})

    def test_schemas_and_tool_descriptions_expose_scope_and_argument_constraints(self):
        github_schema = GitHubRead.model_json_schema()["properties"]
        check_schema = RunCheck.model_json_schema()["properties"]
        self.assertIn("never include repo:", github_schema["query"]["description"])
        self.assertIn("Must be []", check_schema["arguments"]["description"])
        self.assertIn("Existing scratch-relative .py", check_schema["file"]["description"])
        descriptions = {tool.name: tool.description for tool in self.tools.tools}
        self.assertIn("Omit ALL repo:", descriptions["github_read"])
        self.assertIn("arguments=[]", descriptions["run_check"])

    async def test_rejected_search_scopes_are_not_stripped_or_sent_and_retain_correction(self):
        with patch.object(self.tools.github, "api", AsyncMock()) as api:
            for scope in ("repo:microsoft/pyright", "ORG:microsoft", "user:rchiodo"):
                request = {"operation": "search", "query": f"{scope} is:issue ReadOnly"}
                result = await self.tools.github_read(ToolInvocation(
                    session_id="test", tool_call_id="call", tool_name="github_read", arguments=request,
                ))
                self.assertEqual(result.result_type, "failure")
                self.assertIn('"query":"is:issue ReadOnly required"', result.text_result_for_llm)
                saved = json.loads((self.scratch / "checks.jsonl").read_text().splitlines()[-1])
                self.assertEqual(saved["request"]["query"], request["query"])
            api.assert_not_awaited()

    async def test_valid_search_gets_exactly_one_controller_owned_repository_scope(self):
        with patch.object(self.tools.github, "api", AsyncMock(return_value={"items": []})) as api:
            result = await self.tools.github_read(ToolInvocation(
                session_id="test", tool_call_id="call", tool_name="github_read",
                arguments={"operation": "search", "query": "is:issue ReadOnly required"},
            ))
        self.assertEqual(result.result_type, "success")
        self.assertIn("q=repo%3Amicrosoft%2Fpyright+is%3Aissue+ReadOnly+required", api.call_args.args[1])
        api.assert_awaited_once()

    async def test_static_arguments_remain_rejected_without_execution_or_preflight(self):
        with patch("review_issues.process", AsyncMock()) as run:
            for kind in ("pyright", "mypy"):
                request = {"kind": kind, "arguments": ["--pythonversion", "3.13"]}
                result = await self.tools.run_check(ToolInvocation(
                    session_id="test", tool_call_id="call", tool_name="run_check", arguments=request,
                ))
                self.assertEqual(result.result_type, "failure")
                self.assertIn("arguments=[]", result.text_result_for_llm)
                saved = json.loads((self.scratch / "checks.jsonl").read_text().splitlines()[-1])
                self.assertEqual(saved["request"]["arguments"], request["arguments"])
            run.assert_not_awaited()

    async def test_missing_mypy_file_is_rejected_before_preflight(self):
        with patch("review_issues.process", AsyncMock()) as run:
            result = await self.tools.run_check(ToolInvocation(
                session_id="test", tool_call_id="call", tool_name="run_check",
                arguments={"kind": "mypy", "file": "missing.py"},
            ))
        self.assertEqual(result.result_type, "failure")
        self.assertIn("Create it first", result.text_result_for_llm)
        run.assert_not_awaited()

    async def test_unavailable_mypy_is_shared_across_roles_without_repeated_analysis_attempts(self):
        atomic_write(self.scratch / "sample.py", "value: int = 1\n")
        second = InvestigationTools(
            FakeGitHub(), self.scratch, ROOT / "packages" / "pyright" / "index.js", {},
            check_preflight=self.tools.check_preflight,
        )
        invocation = ToolInvocation(
            session_id="test", tool_call_id="call", tool_name="run_check",
            arguments={"kind": "mypy", "file": "sample.py"},
        )
        with patch("review_issues.process", AsyncMock(return_value=(1, "", "No module named mypy"))) as run:
            results = await asyncio.gather(*(tool.run_check(invocation) for tool in (self.tools, second, self.tools)))
        self.assertEqual(run.await_count, 2)
        self.assertTrue(all(call.args[0][-1] == "--version" for call in run.await_args_list))
        for result in results:
            self.assertEqual(result.result_type, "failure")
            self.assertIn("comparison as unperformed", result.text_result_for_llm)
        self.assertFalse((self.scratch / "empty-mypy.ini").exists())
        records = [json.loads(line) for line in (self.scratch / "checks.jsonl").read_text().splitlines()]
        self.assertTrue(all(record.get("tool") == "run_check" and "exit_code" not in record for record in records))

    async def test_available_mypy_uses_the_same_isolated_interpreter_without_caller_arguments(self):
        atomic_write(self.scratch / "sample.py", "value: int = 'wrong'\n")

        async def execute(command, _cwd, **_options):
            if command[-1] == "--version":
                return (0, "mypy 1.20.0\n", "") if "-m" in command else (0, "pyright 1.1.414\n", "")
            return 1, "sample.py:1: error: Incompatible types in assignment\n", ""

        with patch("review_issues.process", AsyncMock(side_effect=execute)) as run:
            result = await self.tools.run_check(ToolInvocation(
                session_id="test", tool_call_id="call", tool_name="run_check",
                arguments={"kind": "mypy", "file": "sample.py"},
            ))
        self.assertEqual(run.await_count, 3)
        command = run.call_args.args[0]
        self.assertEqual(command[:5], [sys.executable, "-I", "-B", "-m", "mypy"])
        self.assertIn("--no-incremental", command)
        self.assertEqual(command[-1], str(self.scratch / "sample.py"))
        self.assertEqual(result.result_type, "success")
        record = json.loads(result.text_result_for_llm)
        self.assertEqual(record["exit_code"], 1)
        self.assertIn("Incompatible types", record["stdout"])
        self.assertEqual((self.scratch / "empty-mypy.ini").read_text(), "[mypy]\n")

    async def test_parallel_roles_serialize_approval_prompts_and_pause_deadlines_while_queued(self):
        approval_lock = asyncio.Lock()
        active = peak = 0

        def approve(_question):
            nonlocal active, peak
            active += 1
            peak = max(peak, active)
            time.sleep(0.05)
            active -= 1
            return "y"

        tools = [
            InvestigationTools(
                FakeGitHub(), self.scratch / str(index), ROOT / "packages" / "pyright" / "index.js", {},
                ask=approve, approval_lock=approval_lock,
            )
            for index in range(2)
        ]

        async def request(tool):
            async with asyncio.timeout(0.2) as deadline:
                tool.deadline = deadline
                return await tool.request_approval("Approve? ", "Inspected probe")

        await approval_lock.acquire()
        tasks = [asyncio.create_task(request(tool)) for tool in tools]
        try:
            await asyncio.sleep(0.05)
            for tool in tools:
                assert tool.deadline is not None
                self.assertIsNone(tool.deadline.when())
            await asyncio.sleep(0.25)
        finally:
            approval_lock.release()
        self.assertEqual(await asyncio.gather(*tasks), ["y", "y"])
        self.assertEqual(peak, 1)

    async def test_permissions_restrict_reads_writes_and_shell(self):
        for path, allowed in ((ROOT / "package.json", True), (self.scratch / "a.py", True), (ROOT.parent / "secret", False)):
            request = PermissionRequestRead(intention="read", path=str(path))
            verdict = self.tools.permission(request, {"session_id": "test"})
            self.assertIsInstance(verdict, PermissionDecisionApproveOnce if allowed else PermissionDecisionReject)
        for path, allowed in ((self.scratch / "a.py", True), (ROOT / "package.json", False), (self.scratch / ".." / "secret", False)):
            request = PermissionRequestWrite(can_offer_session_approval=False, diff="", file_name=str(path), intention="write")
            self.assertIsInstance(
                self.tools.permission(request, {"session_id": "test"}),
                PermissionDecisionApproveOnce if allowed else PermissionDecisionReject,
            )
        request = PermissionRequestShell(
            intention="mutate GitHub", full_command_text="gh issue close 123",
            can_offer_session_approval=False, commands=[], has_write_file_redirection=False,
            possible_paths=[], possible_urls=[],
        )
        self.assertIsInstance(self.tools.permission(request, {"session_id": "test"}), PermissionDecisionReject)

    async def test_runtime_requires_approval_and_does_not_run_on_decline(self):
        atomic_write(self.scratch / "runtime.py", "raise RuntimeError('must not execute')\n")
        self.tools.ask = lambda _question: ""
        result = await self.tools.run_check(ToolInvocation(
            session_id="test", tool_call_id="call", tool_name="run_check",
            arguments={"kind": "python", "file": "runtime.py"},
        ))
        self.assertEqual(result.result_type, "failure")
        self.assertIn("declined", result.text_result_for_llm)

    async def test_non_interactive_probe_denial_is_explicit_and_never_executes(self):
        atomic_write(self.scratch / "runtime.py", "raise RuntimeError('must not execute')\n")
        self.tools.ask = reject_operator_approval
        with patch("review_issues.process", AsyncMock()) as run:
            result = await self.tools.run_check(ToolInvocation(
                session_id="test", tool_call_id="call", tool_name="run_check",
                arguments={"kind": "python", "file": "runtime.py"},
            ))
        self.assertEqual(result.result_type, "failure")
        self.assertIn("Non-interactive dry run", result.text_result_for_llm)
        run.assert_not_awaited()

    async def test_configs_cannot_escape_scratch_or_load_external_plugins(self):
        config = self.scratch / "pyrightconfig.json"
        for value in ({"include": ["../private"]}, {"extends": "../pyrightconfig.json"}, {"venvPath": "../private"}):
            atomic_write(config, json.dumps(value))
            with self.assertRaises(AutomationError):
                self.tools.validate_config(config)
        atomic_write(config, '{"include":["sample.py"],"typeCheckingMode":"strict"}')
        self.tools.validate_config(config)

    async def test_explicit_issue_selection_rejects_pull_requests(self):
        github = GitHub()
        with patch.object(github, "api", AsyncMock(return_value={"pull_request": {}})):
            with self.assertRaisesRegex(AutomationError, "pull request"):
                await github.issue(123)

    async def test_controller_ledger_is_outside_agent_write_scope(self):
        evidence = self.scratch / "controller"
        scratch = self.scratch / "scratch"
        scratch.mkdir()
        tools = InvestigationTools(
            FakeGitHub(), scratch, ROOT / "packages" / "pyright" / "index.js", {}, evidence=evidence
        )
        tools.log({"command": "an observed execution"})
        request = PermissionRequestWrite(
            can_offer_session_approval=False, diff="", file_name=str(evidence / "checks.jsonl"), intention="write",
        )
        self.assertIsInstance(tools.permission(request, {"session_id": "test"}), PermissionDecisionReject)
        self.assertTrue((evidence / "checks.jsonl").exists())


if __name__ == "__main__":
    unittest.main()
