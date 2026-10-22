# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

import asyncio
import json
import os
import tempfile
import time
import tomllib
import unittest
from argparse import Namespace
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from copilot import ToolInvocation
from copilot.generated.rpc import PermissionDecisionApproveOnce, PermissionDecisionReject
from copilot.generated.session_events import (
    AssistantMessageData,
    PermissionRequestRead,
    PermissionRequestShell,
    PermissionRequestWrite,
    SessionIndexedSearchData,
)
from copilot.session import CopilotSession
from pydantic import JsonValue, ValidationError

from issue_review_models import (
    Adjudication,
    Audit,
    BlockedChallenge,
    DraftCheck,
    DuplicateCandidate,
    DuplicateFindings,
    DuplicateReport,
    Entry,
    ExploratoryReproductionScenario,
    HistoricalSearch,
    Issue,
    Label,
    ReviewFindings,
    ReproductionGate,
    ReproductionPlan,
    ReproductionScenario,
    RootCause,
    RootCauseChallenge,
    RootCauseFindings,
    RootCauseGate,
)
from review_issues import (
    AGENTS,
    REPOSITORY,
    ROOT,
    SDK,
    Agent,
    AutomationError,
    Console,
    ChunkResult,
    GitHub,
    InvestigationTools,
    atomic_write,
    arguments,
    chunk_table,
    claim_evidence_summary,
    context_hash,
    dry_run_proposal,
    main as review_main,
    reject_operator_approval,
    validate_reproduction_report,
    response_schema,
    save_dry_run_proposals,
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
        for model in (ReproductionScenario, ExploratoryReproductionScenario, ReproductionGate):
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

    async def test_non_interactive_mode_cannot_enable_publication(self):
        with self.assertRaisesRegex(AutomationError, "requires --dry-run"):
            await review_main(Namespace(non_interactive=True, read_only=False))

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

    async def test_duplicate_agent_is_read_only_and_never_runs_checks(self):
        self.console.duplicate = Agent.load(
            AGENTS / "pyright-issue-dupe-investigator.md", "pyright-issue-dupe-investigator"
        )
        self.entry.duplicates, self.entry.adjudication = None, None
        self.console.save(self.entry)
        report = no_duplicates()
        raw = DuplicateFindings(markdown="# Duplicate findings\n\nNo shared cause found.", report=report).model_dump_json()
        with (
            patch.object(self.console.sdk, "run", AsyncMock(return_value=raw)) as run,
            patch.object(self.console, "adjudicate", AsyncMock()),
        ):
            entry = await self.console.review(issue(), retry_failed=False)
        self.assertEqual(entry.duplicates, report)
        self.assertEqual(run.await_count, 1)
        self.assertEqual(run.call_args.args[0].name, "pyright-issue-dupe-investigator")
        self.assertEqual((self.console.directory(123) / "duplicates.md").read_text(), "# Duplicate findings\n\nNo shared cause found.\n")
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
                active = ["view", "glob", "web_fetch", "github_read", "run_check", *variants]
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
        complete = {"view", "glob", "web_fetch", "github_read", "run_check", "rg", "apply_patch"}
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
        failure = records[-1]
        self.assertEqual(failure["type"], "controller.timeout")
        self.assertEqual(failure["data"]["session_id"], session.session_id)
        self.assertEqual(failure["data"]["exception"], "TimeoutError")

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

    async def test_adjudicator_reads_both_markdown_reports_without_tools(self):
        self.entry.adjudication = None

        async def adjudicate(agent, prompt, scratch, **options):
            self.assertEqual(agent.name, "pyright-issue-adjudicator")
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
                tools.log(product_record(audit()))
                result = ReviewFindings(
                    markdown="# Product findings\n\nThe actual diagnostic follows the rule.", audit=audit(),
                )
            elif agent.name == "pyright-issue-dupe-investigator":
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
                "investigator": "duplicates", "request": {"operation": "issue", "number": 456},
                "result": self.github.canonical.model_dump(),
            },
            {"investigator": "duplicates", "request": {"operation": "comments", "number": 456}, "result": []},
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


class ToolTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.scratch = Path(self.temporary.name).resolve()
        self.tools = InvestigationTools(FakeGitHub(), self.scratch, ROOT / "packages" / "pyright" / "index.js", {})

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
