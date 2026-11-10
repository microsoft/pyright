# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

import asyncio
import json
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path
from unittest.mock import AsyncMock, patch

from copilot import ToolInvocation

from issue_review_evidence import evidence_json
from issue_review_models import (
    DraftCheck, DuplicateCandidate, Entry, ReconstructionResponse, ReproductionGate, ReproductionStage, ReproductionTarget,
)
from issue_review_reproduction import ReleaseCatalog
from issue_review_safety import ScreeningBlocked
from review_issues import (
    AGENTS, Agent, AutomationError, ChunkResult, ClosureRehearsal, Console, GitHub, arguments, atomic_write,
    digest, import_rehearsal_entry, main, require_run_mode, save_closure_rehearsals,
)
from test_issue_review_reproduction import (
    FakeTargets, ReproductionGitHub, blocked_reconstruction, catalog, default_scenario, scenario_with_controls,
)
from test_review_issues import FakeGitHub, audit, issue, no_duplicates, save_evidence


class RehearsalTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.enterContext(patch("review_issues.show"))
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.state = Path(temporary.name) / "derived"
        self.github = FakeGitHub()
        self.profile = Agent.load(AGENTS / "pyright-issue-by-design-reviewer.md", "pyright-issue-by-design-reviewer")
        self.writer = Agent(self.profile.path, "rich-mirror", "Writer", "Preserve verified facts.")
        self.comment = "This follows the rule; the unavailable releases remain unverified."
        self.sdk = AsyncMock()
        self.sdk.run.side_effect = [self.comment, DraftCheck(approved=True, problems=[]).model_dump_json()]
        self.console = Console(
            self.github, self.sdk, self.state, self.profile, self.profile, self.writer,
            "context", "a" * 40, {}, rehearse_closures=True,
        )
        self.entry = Entry(
            input_hash=self.console.key(issue()), context_hash="context", issue=issue(), review=audit(),
        )
        save_evidence(self.console, self.entry)

    def report(self):
        return ClosureRehearsal.model_validate_json((self.console.directory(123) / "rehearsal.json").read_text())

    def duplicate(self):
        assert self.entry.duplicates is not None
        self.entry.duplicates.candidates = [DuplicateCandidate.model_validate({
            "issue_number": 456, "relation": "duplicate", "confidence": "high",
            "shared_cause": "The same demonstrated limitation", "differences": "Only variable names",
            "canonical_reason": "An inspected maintainer decision",
            "evidence": [{"url": self.github.canonical.html_url, "finding": "Same reduced trigger"}],
        })]
        save_evidence(self.console, self.entry)
        assert self.entry.adjudication is not None
        self.entry.adjudication.duplicate_status, self.entry.adjudication.duplicate_of = "dupe", 456
        self.entry.canonical_issue = self.github.canonical.model_copy(deep=True)
        self.comment = f"Duplicate of [#456]({self.github.canonical.html_url}). The same limitation applies."
        self.sdk.run.side_effect = [self.comment, DraftCheck(approved=True, problems=[]).model_dump_json()]

    def blocked_execution(self):
        stage = ReproductionStage(
            input_hash=self.entry.input_hash, discussion_hash=digest("[]"),
            directory=str(self.state / "123" / "reproduction" / "fixture"), status="complete",
            scenario=scenario_with_controls(),
            targets=[
                ReproductionTarget.model_validate({
                    "role": role, "identity": identity, "version": version, "source": source,
                    "selection_reason": "Approximate historical release" if role == "historical" else "Pinned target",
                    "approximate": role == "historical",
                })
                for role, identity, version, source in (
                    ("historical", "npm:pyright@1.1.408", "1.1.408", "npm"),
                    ("main", "a" * 40, "1.1.414", "upstream"),
                    ("latest", "npm:pyright@1.1.414", "1.1.414", "npm"),
                )
            ],
            outcomes={"historical": "blocked", "main": "blocked", "latest": "blocked"},
        )
        records = [
            {
                "id": f"{target.role}-{phase}", "kind": "reproduction", "phase": phase,
                "target": target.model_dump(mode="json"),
                "command": f"node fixture-{target.role} --outputjson" if phase == "original" else None,
                "exit_code": 1 if phase == "original" else None,
                "stdout": '{"generalDiagnostics":[]}' if phase == "original" else None,
                "stderr": "" if phase == "original" else None,
                "outcome": "blocked",
                "blocking_reasons": [
                    "The original diagnostic contract was not satisfied" if phase == "original" else
                    "Original observation was blocked; separate controls cannot replace it",
                ],
            }
            for phase in ("original", "control") for target in stage.targets
        ]
        atomic_write(Path(stage.directory) / "receipts.jsonl", "\n".join(json.dumps(record) for record in records))
        stage.receipt_ids = [record["id"] for record in records]
        assert stage.scenario is not None
        stage.gate = ReproductionGate(
            approved=False, problems=["Strict comparison is blocked"],
            claim_ids=[claim.id for claim in stage.scenario.claims],
            receipt_hashes={
                str(record["id"]): digest(evidence_json(record))
                for record in self.console.reproduction_gate_records(stage)
            },
        )
        stage.evidence_hash = self.console.reproduction_hash(stage)
        self.entry.reproduction_stage = stage
        return stage

    def test_execution_facts_distinguish_absent_unsealed_and_blocked_reconstruction(self):
        absent = self.console.closing_execution_facts(self.entry)
        self.assertEqual(absent["evidence_status"], "not_recorded")
        self.assertIsNone(absent["receipts"])
        stage = ReproductionStage(
            input_hash=self.entry.input_hash, discussion_hash=digest("[]"),
            directory=str(self.state / "123" / "reproduction" / "fixture"), status="running",
        )
        self.entry.reproduction_stage = stage
        unsealed = self.console.closing_execution_facts(self.entry)
        self.assertEqual(unsealed["evidence_status"], "unsealed")
        self.assertIsNone(unsealed["receipts"])
        stage.status, stage.blocked = "blocked", blocked_reconstruction()
        stage.evidence_hash = self.console.reproduction_hash(stage)
        blocked = self.console.closing_execution_facts(self.entry)
        self.assertEqual(blocked["evidence_status"], "sealed")
        self.assertEqual(blocked["receipts"], [])
        self.assertEqual(blocked["reconstruction_blocked"], stage.blocked.model_dump(mode="json"))
        self.assertIsNone(blocked["gate_approved"])

    def test_command_completion_is_separate_from_attempts_and_later_integrity_errors(self):
        stage = self.blocked_execution()
        records = self.console.reproduction_records(stage)
        records[0].update(exit_code=None, stdout=None, stderr=None, error="Checker timed out")
        atomic_write(Path(stage.directory) / "receipts.jsonl", "\n".join(json.dumps(record) for record in records))
        stage.status, stage.gate = "blocked", None
        stage.evidence_hash = self.console.reproduction_hash(stage)
        facts = self.console.closing_execution_facts(self.entry)
        assert isinstance(facts["receipts"], list) and isinstance(facts["receipts"][0], dict)
        receipt = facts["receipts"][0]
        self.assertTrue(receipt["command_recorded"])
        self.assertFalse(receipt["completed"])
        self.assertIsNone(receipt["exit_code"])
        self.assertEqual(receipt["error"], "Checker timed out")
        records[0].update(exit_code=1, stdout="{}", stderr="", error="Inputs changed after checker completion")
        atomic_write(Path(stage.directory) / "receipts.jsonl", "\n".join(json.dumps(record) for record in records))
        stage.evidence_hash = self.console.reproduction_hash(stage)
        facts = self.console.closing_execution_facts(self.entry)
        assert isinstance(facts["receipts"], list) and isinstance(facts["receipts"][0], dict)
        self.assertTrue(facts["receipts"][0]["completed"])
        self.assertEqual(facts["receipts"][0]["error"], "Inputs changed after checker completion")

    def test_completed_stage_without_seal_or_required_ledger_cannot_supply_facts(self):
        stage = self.blocked_execution()
        saved = stage.evidence_hash
        stage.evidence_hash = None
        with self.assertRaisesRegex(AutomationError, "lack frozen"):
            self.console.closing_execution_facts(self.entry)
        stage.evidence_hash = saved
        (Path(stage.directory) / "receipts.jsonl").unlink()
        with self.assertRaisesRegex(AutomationError, "execution facts"):
            self.console.closing_execution_facts(self.entry)

    def test_rejected_gate_still_requires_exact_receipt_bindings(self):
        stage = self.blocked_execution()
        assert stage.gate is not None
        stage.gate.receipt_hashes.clear()
        stage.evidence_hash = self.console.reproduction_hash(stage)
        with self.assertRaisesRegex(AutomationError, "exact raw receipt hash"):
            self.console.closing_execution_facts(self.entry)

    def test_invalid_command_results_cannot_establish_completion(self):
        stage = self.blocked_execution()
        stage.gate = None
        original = self.console.reproduction_records(stage)
        for field, value in (("exit_code", True), ("command", None), ("stdout", None), ("target", {})):
            records = [dict(record) for record in original]
            records[0][field] = value
            atomic_write(Path(stage.directory) / "receipts.jsonl", "\n".join(json.dumps(record) for record in records))
            stage.evidence_hash = self.console.reproduction_hash(stage)
            with self.subTest(field=field), self.assertRaisesRegex(AutomationError, "invalid target or command result"):
                self.console.closing_execution_facts(self.entry)

    async def test_executed_blocked_facts_reach_writer_and_factual_correction(self):
        stage = self.blocked_execution()
        rejected = DraftCheck(approved=False, problems=["Released checkers ran; their observations were blocked"])
        revised = "Released checkers ran, but the strict comparison remained blocked. The policy evidence is separate."
        self.sdk.run.side_effect = [
            "No released package was executed.", rejected.model_dump_json(),
            revised, DraftCheck(approved=True, problems=[]).model_dump_json(),
        ]
        await self.console.evaluate(self.entry)
        self.assertEqual(self.report().status, "passed")
        self.assertEqual(self.entry.comment, revised)
        facts = json.loads((self.state / "123" / "comment-execution-facts.json").read_text())
        self.assertFalse(facts["gate_approved"])
        self.assertEqual(facts["outcomes"], stage.outcomes)
        self.assertEqual([record["completed"] for record in facts["receipts"]], [True] * 3 + [False] * 3)
        self.assertEqual([record["version"] for record in facts["receipts"][:3]], ["1.1.408", "1.1.414", "1.1.414"])
        self.assertTrue(facts["receipts"][0]["approximate"])
        self.assertEqual([record["exit_code"] for record in facts["receipts"][:3]], [1] * 3)
        self.assertEqual([record["phase"] for record in facts["receipts"]], ["original"] * 3 + ["control"] * 3)
        packet = "\nController execution facts (controller-owned, not reviewer probes):\n" + json.dumps(facts)
        for call in self.sdk.run.await_args_list:
            self.assertIn(packet, call.args[1])
        self.assertIn("not the same as not executed", self.sdk.run.await_args_list[1].args[1])
        self.assertIsNone(stage.action())
        self.assertEqual(self.github.mutations, [])

    async def test_public_reply_keeps_execution_evidence_without_requiring_an_audit_inventory(self):
        self.blocked_execution()
        await self.console.evaluate(self.entry)
        writer, factual = [call.args[1] for call in self.sdk.run.await_args_list]
        self.assertIn("author-facing reply, not an audit report", writer)
        self.assertIn("two or three short paragraphs", writer)
        self.assertIn("only when they affect", writer)
        self.assertIn("Do not require an inventory", factual)
        self.assertIn("omission makes a claim misleading", factual)
        for prompt in (writer, factual):
            self.assertIn('"completed": true', prompt)
            self.assertIn('"gate_approved": false', prompt)
            self.assertIn("not the same as not executed", prompt)
        self.assertEqual(self.report().status, "passed")
        self.assertEqual(self.github.mutations, [])

    async def test_changed_execution_receipts_stop_drafting(self):
        stage = self.blocked_execution()
        path = Path(stage.directory) / "receipts.jsonl"
        atomic_write(path, path.read_text().replace('"exit_code": 1', '"exit_code": 0'))
        with self.assertRaisesRegex(AutomationError, "execution facts"):
            await self.console.evaluate(self.entry)
        self.sdk.run.assert_not_awaited()
        self.assertEqual(self.github.mutations, [])

    async def test_changed_execution_facts_cannot_reuse_approval(self):
        stage = self.blocked_execution()
        await self.console.evaluate(self.entry)
        stage.status = "blocked"
        stage.evidence_hash = self.console.reproduction_hash(stage)
        self.console.rehearse_closures = False
        self.console.read_only = False
        with self.assertRaisesRegex(AutomationError, "execution facts"):
            await self.console.prepare_comment(self.entry)
        with self.assertRaisesRegex(AutomationError, "execution facts"):
            await self.console.closure_preflight(self.entry)
        self.assertEqual(self.sdk.run.await_count, 2)
        self.assertEqual(self.github.mutations, [])

    async def test_missing_or_changed_execution_snapshot_cannot_authorize_closure(self):
        self.blocked_execution()
        await self.console.evaluate(self.entry)
        path = self.state / "123" / "comment-execution-facts.json"
        atomic_write(path, '{"receipts":[]}')
        with self.assertRaisesRegex(AutomationError, "execution facts changed"):
            await self.console.closure_preflight(self.entry)
        path.unlink()
        with self.assertRaisesRegex(AutomationError, "execution facts snapshot is missing"):
            await self.console.closure_preflight(self.entry)
        self.assertEqual(self.sdk.run.await_count, 2)
        self.assertEqual(self.github.mutations, [])

    async def test_execution_change_during_factual_check_cannot_gain_approval(self):
        stage = self.blocked_execution()

        async def run(agent, prompt, scratch, **kwargs):
            if agent.name == "rich-mirror":
                return self.comment
            stage.status = "blocked"
            stage.evidence_hash = self.console.reproduction_hash(stage)
            return DraftCheck(approved=True, problems=[]).model_dump_json()

        self.sdk.run.side_effect = run
        with self.assertRaisesRegex(AutomationError, "execution facts"):
            await self.console.evaluate(self.entry)
        self.assertIsNone(self.entry.draft_check)
        self.assertEqual(self.report().status, "rejected")
        self.assertEqual(self.github.mutations, [])

    async def test_by_design_runs_real_draft_and_factual_paths_without_a_publication_ledger(self):
        self.assertTrue(self.console.read_only)
        self.assertFalse(self.console.rca_enabled)
        self.assertFalse(self.github.mutations_enabled)
        await self.console.evaluate(self.entry)
        await self.console.decide(self.entry)
        report = self.report()
        self.assertEqual(report.status, "passed")
        self.assertEqual(report.proposed_action, "close_by_design")
        self.assertEqual(report.proposed_comment, self.comment)
        self.assertEqual(report.draft_check, DraftCheck(approved=True, problems=[]))
        self.assertEqual(report.stages, {
            "eligibility": "passed", "writer": "passed", "factual_review": "passed",
            "final_eligibility": "passed", "github_mutations_and_confirmation": "untested",
        })
        self.assertEqual([call.args[0].name for call in self.sdk.run.await_args_list],
                         ["rich-mirror", "pyright-issue-by-design-reviewer"])
        self.assertIsNone(self.entry.closure)
        self.assertNotEqual(self.entry.decision, "closed")
        self.assertFalse(report.publication_ready)
        self.assertEqual(self.github.mutations, [])
        self.assertEqual(self.github.current.state, "open")
        for operation in (self.console.close, self.console.publish_reproduction, self.console.post_root_cause):
            with self.assertRaises(AutomationError):
                await operation(self.entry)
        self.assertEqual(self.github.mutations, [])

    async def test_duplicate_rechecks_canonical_and_keeps_real_writer_reference(self):
        self.duplicate()
        with patch.object(self.console, "canonical_unchanged", wraps=self.console.canonical_unchanged) as canonical:
            await self.console.evaluate(self.entry)
        self.assertGreaterEqual(canonical.await_count, 2)
        self.assertEqual(self.report().proposed_action, "close_duplicate")
        self.assertIn(self.github.canonical.html_url, self.report().proposed_comment or "")
        writer = self.sdk.run.await_args_list[0].args[1]
        self.assertIn("author-facing reply, not an audit report", writer)
        self.assertIn("same underlying cause", writer)
        self.assertIn("Avoid a candidate-selection debate", writer)
        self.assertEqual(self.github.mutations, [])

    async def test_approved_cached_draft_is_not_mistaken_for_a_tested_writing_stage(self):
        self.entry.comment, self.entry.draft_check = "Old approved comment", DraftCheck(approved=True, problems=[])
        await self.console.evaluate(self.entry)
        self.assertEqual(self.sdk.run.await_count, 2)
        self.assertEqual(self.report().proposed_comment, self.comment)

    async def test_stale_context_rejects_before_writing_without_resealing(self):
        self.entry.context_hash = "frozen-old-context"
        original_input = self.entry.input_hash
        with self.assertRaisesRegex(AutomationError, "context is stale"):
            await self.console.evaluate(self.entry)
        report = self.report()
        self.assertEqual(report.status, "rejected")
        self.assertEqual(report.stages["eligibility"], "rejected")
        self.assertEqual(report.stages["writer"], "untested")
        self.assertEqual(report.stages["factual_review"], "untested")
        self.assertEqual(self.entry.context_hash, "frozen-old-context")
        self.assertEqual(self.entry.input_hash, original_input)
        self.sdk.run.assert_not_awaited()

    async def test_changed_evidence_rejects_without_drafting(self):
        atomic_write(self.state / "123" / "review.md", "Tampered report")
        with self.assertRaisesRegex(AutomationError, "changed"):
            await self.console.evaluate(self.entry)
        self.assertEqual(self.report().stages["writer"], "untested")
        self.sdk.run.assert_not_awaited()

    async def test_unresolved_claim_is_not_promoted_to_a_closure(self):
        assert self.entry.review is not None
        self.entry.review.claims[0].confidence = "low"
        save_evidence(self.console, self.entry, validity="needs investigation")
        await self.console.evaluate(self.entry)
        self.assertEqual(self.report().status, "ineligible")
        self.assertEqual(self.report().stages["eligibility"], "rejected")
        self.assertEqual(self.report().stages["writer"], "untested")
        self.assertTrue(self.report().blocking_reasons)
        self.sdk.run.assert_not_awaited()
        self.assertEqual(self.github.mutations, [])

    async def test_ineligible_investigation_still_rejects_tampered_evidence(self):
        assert self.entry.review is not None
        self.entry.review.claims[0].confidence = "low"
        save_evidence(self.console, self.entry, validity="needs investigation")
        atomic_write(self.state / "123" / "review.md", "Tampered report")
        with self.assertRaisesRegex(AutomationError, "changed"):
            await self.console.evaluate(self.entry)
        self.assertEqual(self.report().status, "rejected")
        self.sdk.run.assert_not_awaited()

    async def test_ineligible_investigation_still_rejects_changed_issue(self):
        assert self.entry.review is not None
        self.entry.review.claims[0].confidence = "low"
        save_evidence(self.console, self.entry, validity="needs investigation")
        self.github.current.body = "A material correction"
        with self.assertRaisesRegex(AutomationError, "Issue changed"):
            await self.console.evaluate(self.entry)
        self.assertEqual(self.report().status, "rejected")
        self.sdk.run.assert_not_awaited()

    async def test_changed_canonical_rejects_before_drafting(self):
        self.duplicate()
        self.github.canonical.body = "A changed canonical premise"
        with self.assertRaisesRegex(AutomationError, "Canonical issue changed"):
            await self.console.evaluate(self.entry)
        self.assertEqual(self.report().stages["writer"], "untested")
        self.sdk.run.assert_not_awaited()

    async def test_changed_issue_rejects_before_drafting(self):
        self.github.current.body = "A material correction"
        with self.assertRaisesRegex(AutomationError, "Issue changed"):
            await self.console.evaluate(self.entry)
        self.sdk.run.assert_not_awaited()

    async def test_observation_only_cannot_enter_rehearsal_even_with_behavior_evidence(self):
        self.console.exploratory_reproduction = True
        with self.assertRaisesRegex(AutomationError, "observation-only"):
            await self.console.evaluate(self.entry)
        self.assertEqual(self.report().stages["eligibility"], "rejected")
        self.assertEqual(self.report().stages["writer"], "untested")
        self.sdk.run.assert_not_awaited()

    async def test_factual_rejection_preserves_comment_and_problems(self):
        rejected = DraftCheck(approved=False, problems=["The release was never executed"]).model_dump_json()
        self.sdk.run.side_effect = [
            self.comment, rejected, self.comment, rejected,
        ]
        with self.assertRaisesRegex(AutomationError, "factual checking"):
            await self.console.evaluate(self.entry)
        report = self.report()
        self.assertEqual(report.proposed_comment, self.comment)
        self.assertEqual(report.stages["writer"], "passed")
        self.assertEqual(report.stages["factual_review"], "rejected")
        self.assertEqual(report.stages["final_eligibility"], "untested")
        self.assertEqual(report.draft_check.problems if report.draft_check else [], ["The release was never executed"])
        self.assertEqual(self.sdk.run.await_count, 4)
        for index in ("1", "2"):
            attempt = self.state / "123" / "comment-attempts" / index
            self.assertEqual((attempt / "comment.md").read_text(), self.comment)
            self.assertEqual((attempt / "draft-check.json").read_text(), rejected)
        with self.assertRaisesRegex(AutomationError, "attempts already exist"):
            await self.console.prepare_comment(self.entry)
        self.assertEqual(self.sdk.run.await_count, 4)
        self.assertEqual(self.github.mutations, [])

    async def test_one_correction_uses_same_packet_and_preserves_rejected_attempt(self):
        self.duplicate()
        self.github.current.body = "The reporter says another checker rejects it; we did not execute that comparison."
        self.entry.issue = self.github.current.model_copy(deep=True)
        self.entry.input_hash = self.console.key(self.entry.issue)
        rejected = DraftCheck(approved=False, problems=["Do not claim an executed comparison"]).model_dump_json()
        revised = self.comment + " The comparison is reporter-supplied, not independently executed."
        self.sdk.run.side_effect = [
            self.comment, rejected, revised, DraftCheck(approved=True, problems=[]).model_dump_json(),
        ]
        await self.console.evaluate(self.entry)
        report = self.report()
        self.assertEqual(report.status, "passed")
        self.assertEqual(report.proposed_comment, revised)
        self.assertTrue(report.draft_check and report.draft_check.approved)
        calls = self.sdk.run.await_args_list
        self.assertEqual([call.args[0].name for call in calls], [
            "rich-mirror", self.profile.name, "rich-mirror", self.profile.name,
        ])
        for call in calls:
            self.assertIn(self.entry.issue.model_dump_json(), call.args[1])
            self.assertIn(self.entry.review_markdown, call.args[1])
            self.assertIn(self.entry.duplicates_markdown, call.args[1])
            self.assertNotIn("tools", call.kwargs)
        self.assertIn(rejected, calls[2].args[1])
        first = self.state / "123" / "comment-attempts" / "1"
        self.assertEqual((first / "comment.md").read_text(), self.comment)
        self.assertEqual((first / "draft-check.json").read_text(), rejected)
        self.assertEqual((first.parent / "2" / "comment.md").read_text(), revised)
        self.assertFalse(report.publication_ready)
        self.assertEqual(self.github.mutations, [])

    async def test_correction_failure_does_not_mark_rejected_factual_check_passed(self):
        rejected = DraftCheck(approved=False, problems=["Unverified release"]).model_dump_json()
        self.sdk.run.side_effect = [self.comment, rejected, TimeoutError("Writer correction timed out")]
        with self.assertRaises(TimeoutError):
            await self.console.evaluate(self.entry)
        report = self.report()
        self.assertEqual(report.status, "rejected")
        self.assertEqual(report.stages["writer"], "rejected")
        self.assertEqual(report.stages["factual_review"], "rejected")
        self.assertEqual(report.stages["final_eligibility"], "untested")
        self.assertEqual(report.proposed_comment, self.comment)
        self.assertFalse(report.draft_check and report.draft_check.approved)
        first = self.state / "123" / "comment-attempts" / "1"
        self.assertEqual((first / "draft-check.json").read_text(), rejected)
        self.assertEqual(self.sdk.run.await_count, 3)

    async def test_corrected_draft_timeout_retains_both_drafts_without_stale_approval(self):
        rejected = DraftCheck(approved=False, problems=["Unverified release"]).model_dump_json()
        revised = "This is verified only on main, not a released fix."
        self.sdk.run.side_effect = [self.comment, rejected, revised, TimeoutError("Second check timed out")]
        with self.assertRaises(TimeoutError):
            await self.console.evaluate(self.entry)
        report = self.report()
        self.assertEqual(report.proposed_comment, revised)
        self.assertIsNone(report.draft_check)
        self.assertIsNone(self.entry.draft_check)
        self.assertEqual(report.stages["factual_review"], "rejected")
        self.assertEqual(report.stages["final_eligibility"], "untested")
        first = self.state / "123" / "comment-attempts" / "1"
        self.assertEqual((first / "draft-check.json").read_text(), rejected)
        self.assertEqual((first / "comment.md").read_text(), self.comment)
        self.assertEqual((first.parent / "2" / "comment.md").read_text(), revised)
        self.assertEqual(self.sdk.run.await_count, 4)

    async def test_cancelled_correction_preserves_rejection_and_cannot_restart(self):
        rejected = DraftCheck(approved=False, problems=["Unverified release"]).model_dump_json()
        self.sdk.run.side_effect = [self.comment, rejected, asyncio.CancelledError()]
        with self.assertRaises(asyncio.CancelledError):
            await self.console.evaluate(self.entry)
        report = self.report()
        self.assertEqual(report.status, "rejected")
        self.assertEqual(report.stages["writer"], "rejected")
        self.assertEqual(report.stages["factual_review"], "rejected")
        self.assertIn("cancelled", " ".join(report.blocking_reasons))
        first = self.state / "123" / "comment-attempts" / "1"
        self.assertEqual((first / "draft-check.json").read_text(), rejected)
        with self.assertRaisesRegex(AutomationError, "attempts already exist"):
            await self.console.prepare_comment(self.entry)
        self.assertEqual(self.sdk.run.await_count, 3)

    async def test_factual_transport_or_schema_failure_never_starts_correction(self):
        for failure in (ScreeningBlocked("Screening rejected"), "not JSON"):
            with self.subTest(failure=failure):
                self.console.state = self.state / ("screening" if isinstance(failure, Exception) else "schema")
                save_evidence(self.console, self.entry)
                self.sdk.run.reset_mock()
                self.sdk.run.side_effect = [self.comment, failure]
                with self.assertRaises((ScreeningBlocked, ValueError)):
                    await self.console.evaluate(self.entry)
                self.assertEqual(self.sdk.run.await_count, 2)
                self.assertEqual(self.report().stages["factual_review"], "rejected")
                self.assertFalse((self.console.directory(123) / "comment-attempts" / "2").exists())

    async def test_freshness_failure_after_first_rejection_blocks_correction(self):
        async def respond(agent, *_args, **_kwargs):
            if agent.name == "rich-mirror":
                return self.comment
            self.github.current.body = "Changed before correction"
            return DraftCheck(approved=False, problems=["Unverified claim"]).model_dump_json()
        self.sdk.run.side_effect = respond
        with self.assertRaisesRegex(AutomationError, "Issue changed"):
            await self.console.evaluate(self.entry)
        self.assertEqual(self.sdk.run.await_count, 2)
        self.assertEqual(self.report().stages["factual_review"], "rejected")
        self.assertEqual(self.report().stages["final_eligibility"], "untested")

    async def test_missing_settings_reach_rehearsal_scenario_model_with_defaults(self):
        self.console.reproduction_store = FakeTargets(self.state / "targets", {})
        self.assertFalse(self.console.observe_blocked)
        self.assertTrue(self.console.rehearse_closures)
        self.sdk.run.side_effect = TimeoutError("Scenario model reached its bounded deadline")
        await self.console.reproduce(self.entry)
        stage = self.entry.reproduction_stage
        assert stage is not None
        self.assertEqual(stage.status, "blocked")
        self.assertIn("Scenario model reached", stage.error or "")
        self.assertIsNone(stage.scenario)
        self.assertEqual(self.sdk.run.await_count, 1)
        self.assertIs(self.sdk.run.await_args.kwargs["schema"], ReconstructionResponse)
        self.assertIn("DEFAULT-SETTINGS policy", self.sdk.run.await_args.args[1])

    async def test_factual_timeout_preserves_draft_without_a_success_claim(self):
        self.sdk.run.side_effect = [self.comment, TimeoutError("Factual reviewer timed out")]
        with self.assertRaises(TimeoutError):
            await self.console.evaluate(self.entry)
        report = self.report()
        self.assertEqual(report.proposed_comment, self.comment)
        self.assertIsNone(report.draft_check)
        self.assertEqual(report.stages["factual_review"], "rejected")
        self.assertEqual(report.stages["final_eligibility"], "untested")

    async def test_invalid_duplicate_draft_is_retained_and_not_fact_checked(self):
        self.duplicate()
        self.sdk.run.side_effect = ["No canonical link"]
        with self.assertRaisesRegex(AutomationError, "must link"):
            await self.console.evaluate(self.entry)
        report = self.report()
        self.assertEqual(report.proposed_comment, "No canonical link")
        self.assertEqual(report.stages["writer"], "rejected")
        self.assertEqual(report.stages["factual_review"], "untested")
        self.assertEqual(self.sdk.run.await_count, 1)

    async def test_final_discussion_freshness_is_rechecked_after_factual_review(self):
        async def respond(agent, *_args, **_kwargs):
            if agent.name == "rich-mirror":
                return self.comment
            self.github.discussion.append({"body": "A late correction"})
            return DraftCheck(approved=True, problems=[]).model_dump_json()
        self.sdk.run.side_effect = respond
        with self.assertRaisesRegex(AutomationError, "discussion"):
            await self.console.evaluate(self.entry)
        report = self.report()
        self.assertEqual(report.stages["factual_review"], "passed")
        self.assertEqual(report.stages["final_eligibility"], "rejected")
        self.assertEqual(report.proposed_comment, self.comment)
        self.assertEqual(self.github.mutations, [])

    async def test_final_context_is_rechecked_after_factual_review(self):
        async def respond(agent, *_args, **_kwargs):
            if agent.name == "rich-mirror":
                return self.comment
            self.console.current_context = lambda: "Changed implementation"
            return DraftCheck(approved=True, problems=[]).model_dump_json()
        self.sdk.run.side_effect = respond
        with self.assertRaisesRegex(AutomationError, "context is stale"):
            await self.console.evaluate(self.entry)
        self.assertEqual(self.report().stages["final_eligibility"], "rejected")

    async def test_final_canonical_is_rechecked_after_factual_review(self):
        self.duplicate()
        async def respond(agent, *_args, **_kwargs):
            if agent.name == "rich-mirror":
                return self.comment
            self.github.canonical.body = "Changed while the draft was being checked"
            return DraftCheck(approved=True, problems=[]).model_dump_json()
        self.sdk.run.side_effect = respond
        with self.assertRaisesRegex(AutomationError, "Canonical issue changed"):
            await self.console.evaluate(self.entry)
        self.assertEqual(self.report().stages["factual_review"], "passed")
        self.assertEqual(self.report().stages["final_eligibility"], "rejected")
        self.assertEqual(self.github.mutations, [])

    async def test_missing_writer_or_screening_is_a_saved_rejection(self):
        self.console.writer = None
        with self.assertRaisesRegex(AutomationError, "rich-mirror"):
            await self.console.evaluate(self.entry)
        self.assertEqual(self.report().stages["writer"], "rejected")
        with patch.object(self.github, "screen_issue", AsyncMock(side_effect=ScreeningBlocked("Screening blocked"))):
            with self.assertRaises(ScreeningBlocked):
                await self.console.evaluate(self.entry)
        self.assertEqual(self.report().stages["eligibility"], "rejected")

    async def test_fixed_uses_actual_receipt_gate_and_writes_only_derived_artifacts(self):
        self.github = ReproductionGitHub()
        targets = FakeTargets(self.state / "targets", {
            "historical": "reproduced", "main": "not_reproduced", "latest": "reproduced",
        })
        self.console.github, self.console.reproduction_store = self.github, targets
        self.github.mutations_enabled = False
        self.console._reproduction_catalog = ReleaseCatalog.model_validate(catalog())
        self.console._reproduction_main = "a" * 40
        self.entry = Entry(
            input_hash=self.console.key(self.github.current), context_hash="context",
            issue=self.github.current.model_copy(deep=True),
        )
        checked_pages = []
        check_tools = []

        async def respond(agent, _prompt, _directory, **options):
            schema = options.get("schema")
            if schema is ReconstructionResponse:
                scenario = default_scenario(reported={
                    "pythonVersion": "Python 3.10", "typeCheckingMode": "typeCheckingMode=standard",
                })
                return ReconstructionResponse(scenario=scenario, blocked=None).model_dump_json()
            if schema is ReproductionGate:
                raw = ReproductionGate(
                    approved=True, problems=[], claim_ids=["assignment"], receipt_hashes={
                        identifier: digest(evidence_json(receipt))
                        for identifier, receipt in options["tools"].receipts.items()
                    },
                ).model_dump_json()
                options["validate"](raw)
                return raw
            if schema is DraftCheck:
                self.assertIn("Do not require an inventory", _prompt)
                self.assertIn("omission makes a claim misleading", _prompt)
                self.assertIn("Main passing alone NEVER means a released fix", _prompt)
                tools = options["tools"]
                check_tools.append(tools)
                self.assertEqual(tools.delivered, {})
                for identifier in tools.receipts:
                    offset = 0
                    while True:
                        result = await tools.read_receipt(ToolInvocation(
                            session_id="test", tool_call_id="read", tool_name="rca_read_evidence",
                            arguments={"evidence_id": identifier, "pointer": "", "offset": offset, "max_chars": 4096},
                        ))
                        page = json.loads(result.text_result_for_llm)
                        if page["next_offset"] is None:
                            break
                        offset = page["next_offset"]
                    checked_pages.append(identifier)
                approved = len(check_tools) == 2
                raw = DraftCheck(
                    approved=approved, problems=[] if approved else ["Preserve the awaiting-release qualification"],
                ).model_dump_json()
                options["validate"](raw)
                return raw
            self.assertIn("author-facing reply, not an audit report", _prompt)
            self.assertIn("two or three short paragraphs", _prompt)
            return "This reproduced historically and is fixed on main, awaiting release."

        self.sdk.run.side_effect = respond
        await self.console.reproduce(self.entry)
        stage = self.entry.reproduction_stage
        assert stage is not None
        original = Path(stage.directory)
        frozen = {path: path.read_bytes() for path in original.rglob("*") if path.is_file()}
        self.console.state = self.state / "fixed-derived"
        await self.console.evaluate(self.entry)
        report = ClosureRehearsal.model_validate_json(
            (self.console.state / "123" / "rehearsal.json").read_text()
        )
        self.assertEqual(report.status, "passed")
        self.assertEqual(report.proposed_action, "close_fixed")
        self.assertTrue(checked_pages)
        self.assertEqual(len(check_tools), 2)
        self.assertIsNot(check_tools[0], check_tools[1])
        self.assertEqual(stage.comment_hash, digest(report.proposed_comment or ""))
        first_check = json.loads(
            (self.console.directory(123) / "comment-attempts" / "1" / "draft-check.json").read_text()
        )
        self.assertFalse(first_check["approved"])
        self.assertEqual(frozen, {path: path.read_bytes() for path in original.rglob("*") if path.is_file()})
        self.assertIsNone(self.entry.closure)
        self.assertEqual(self.github.mutations, [])
        targets.directory.joinpath("historical", "index.js").write_text("Changed target")
        with self.assertRaisesRegex((AutomationError, ValueError), "integrity|changed"):
            await self.console.evaluate(self.entry)
        self.assertEqual(self.github.mutations, [])

    async def test_transport_denies_every_mutating_verb_and_graphql_before_process(self):
        github = GitHub(mutations_enabled=False)
        with patch("review_issues.process", AsyncMock(return_value=(0, "{}", ""))) as process:
            for method in ("POST", "PATCH", "PUT", "DELETE", "post"):
                with self.subTest(method=method):
                    with self.assertRaisesRegex(AutomationError, "structurally disabled"):
                        await github.api(method, "repos/microsoft/pyright/issues/123")
            with self.assertRaises(AutomationError):
                await github.api("GET", "graphql?query=mutation")
            with self.assertRaises(AutomationError):
                await github.api("GET", "https://api.github.com/graphql?query=mutation")
            process.assert_not_awaited()
            await github.api("GET", "repos/microsoft/pyright/issues/123")
            process.assert_awaited_once()

    async def test_source_import_is_byte_preserving_and_cannot_overlap(self):
        source = self.state
        self.console.save(self.entry)
        original = {path: path.read_bytes() for path in (source / "123").iterdir() if path.is_file()}
        output = source.parent / "replay"
        imported = import_rehearsal_entry(source, output, 123)
        self.assertEqual(imported, self.entry)
        self.assertEqual(original, {path: path.read_bytes() for path in (source / "123").iterdir() if path.is_file()})
        self.assertEqual(
            (output / "123" / "entry.json").read_bytes(), (source / "123" / "entry.json").read_bytes(),
        )
        for destination in (source, source / "nested", source.parent):
            with self.assertRaisesRegex(AutomationError, "non-overlapping"):
                import_rehearsal_entry(source, destination, 123)
        with self.assertRaisesRegex(AutomationError, "fresh output"):
            import_rehearsal_entry(source, output, 123)

    async def test_frozen_source_main_never_reinvestigates_or_reseals_stale_context(self):
        self.console.save(self.entry)
        frozen = {path: path.read_bytes() for path in (self.state / "123").iterdir() if path.is_file()}
        self.github.current.state = "closed"
        output = self.state.parent / "main-rehearsal"
        args = Namespace(
            state_dir=output, cli_path="copilot", writer_agent=self.profile.path,
            read_only=False, model=None, issues=[123], chunk_size=1, timeout=30, retry_failed=False,
            rehearse_closures=True, rehearsal_from=self.state,
        )
        load_agent = Agent.load
        with (
            patch("review_issues.Agent.load", side_effect=lambda path, name: (
                self.writer if name == "rich-mirror" else load_agent(path, name)
            )),
            patch("review_issues.GitHub", return_value=self.github),
            patch.object(self.github, "api", AsyncMock(return_value={})),
            patch("review_issues.InjectionScreening.from_environment"),
            patch("review_issues.process", AsyncMock(return_value=(0, "test runtime", ""))),
            patch("review_issues.context_hash", return_value="new-context"),
            patch("review_issues.git", return_value="a" * 40),
            patch("review_issues.CopilotClient"),
            patch("review_issues.SDK.run", AsyncMock()) as run,
            patch.object(Console, "review", AsyncMock()) as review,
        ):
            with self.assertRaisesRegex(AutomationError, "steps failed"):
                await main(args)
        run.assert_not_awaited()
        review.assert_not_awaited()
        self.assertEqual(frozen, {path: path.read_bytes() for path in (self.state / "123").iterdir() if path.is_file()})
        report = ClosureRehearsal.model_validate_json((output / "123" / "rehearsal.json").read_text())
        self.assertEqual(report.stages["eligibility"], "rejected")
        self.assertEqual(report.source_context_hash, "context")
        self.assertEqual(report.context_hash, "new-context")
        saved = Entry.model_validate_json((output / "123" / "entry.json").read_text())
        self.assertEqual(saved.input_hash, self.entry.input_hash)
        self.assertEqual(saved.context_hash, self.entry.context_hash)
        metadata = json.loads((output / "run.json").read_text())
        self.assertFalse(metadata["automatic_publication"])
        self.assertTrue(metadata["rehearse_closures"])
        self.assertFalse(metadata["prepare_targets"])
        self.assertFalse(metadata["rca_enabled"])
        self.assertEqual(self.github.mutations, [])

    async def test_summary_never_calls_an_unreached_stage_successful(self):
        save_closure_rehearsals(
            self.state, "context", [ChunkResult(issue(), status="failed", message="Investigation timed out")], 2,
        )
        report = self.report()
        self.assertEqual(report.status, "rejected")
        self.assertEqual(set(report.stages.values()), {"untested"})
        summary = json.loads((self.state / "rehearsals.json").read_text())
        self.assertFalse(summary["complete"])
        self.assertFalse(summary["github_mutations_enabled"])

    async def test_mixed_batch_completes_for_ineligibility_but_fails_for_operational_errors(self):
        for transport_failure in (False, True):
            with self.subTest(transport_failure=transport_failure):
                output = self.state.parent / f"mixed-{transport_failure}"
                args = Namespace(
                    state_dir=output, cli_path="copilot", writer_agent=self.profile.path,
                    read_only=False, model=None, issues=[123, 456], chunk_size=1, timeout=30,
                    retry_failed=False, rehearse_closures=True,
                )

                async def investigated(console, snapshot, **_options):
                    if snapshot.number == 456 and transport_failure:
                        raise AutomationError("Simulated investigation transport failure")
                    report = audit().model_copy(update={
                        "issue_number": snapshot.number, "issue_url": snapshot.html_url,
                    }, deep=True)
                    if snapshot.number == 456:
                        report.claims[0].confidence = "low"
                    entry = Entry(
                        input_hash=console.key(snapshot), context_hash="context",
                        issue=snapshot, review=report,
                        duplicates=no_duplicates().model_copy(update={"issue_number": snapshot.number}),
                    )
                    save_evidence(
                        console, entry, validity="needs investigation" if snapshot.number == 456 else "by design",
                    )
                    console.save(entry)
                    return entry

                load_agent = Agent.load
                with (
                    patch("review_issues.Agent.load", side_effect=lambda path, name: (
                        self.writer if name == "rich-mirror" else load_agent(path, name)
                    )),
                    patch("review_issues.GitHub", return_value=self.github),
                    patch.object(self.github, "api", AsyncMock(return_value={})),
                    patch("review_issues.InjectionScreening.from_environment"),
                    patch("review_issues.process", AsyncMock(return_value=(0, "test runtime", ""))),
                    patch("review_issues.context_hash", return_value="context"),
                    patch("review_issues.git", return_value="a" * 40),
                    patch("review_issues.CopilotClient"),
                    patch("review_issues.SDK.run", AsyncMock(side_effect=[
                        self.comment, DraftCheck(approved=True, problems=[]).model_dump_json(),
                    ])) as run,
                    patch.object(Console, "review", autospec=True, side_effect=investigated),
                ):
                    if transport_failure:
                        with self.assertRaisesRegex(AutomationError, "1 investigation/publication steps failed"):
                            await main(args)
                    else:
                        await main(args)
                self.assertEqual(run.await_count, 2)
                summary = json.loads((output / "rehearsals.json").read_text())
                self.assertTrue(summary["complete"])
                self.assertEqual(summary["completed_issues"], 2)
                self.assertEqual(summary["outcome_counts"], {
                    "passed": 1, "ineligible": int(not transport_failure), "rejected": int(transport_failure),
                })
                self.assertEqual(summary["rehearsals"][0]["status"], "passed")
                other = summary["rehearsals"][1]
                self.assertEqual(other["status"], "rejected" if transport_failure else "ineligible")
                self.assertEqual(other["stages"]["writer"], "untested")
                self.assertFalse(summary["github_mutations_enabled"])
                if not transport_failure:
                    saved = json.loads((output / "456" / "entry.json").read_text())
                    self.assertIsNone(saved["error"])
                    self.assertEqual(saved["adjudication"]["validity"], "needs investigation")
                self.assertEqual(self.github.mutations, [])

    async def test_cli_is_explicit_bounded_and_cannot_upgrade_run_policy(self):
        with patch("sys.argv", ["review_issues.py", "--dry-run"]):
            self.assertFalse(arguments().rehearse_closures)
        with patch("sys.argv", ["review_issues.py", "--rehearse-closures", "--issues", "123"]):
            self.assertTrue(arguments().rehearse_closures)
        with self.assertRaisesRegex(AutomationError, "bounded"):
            await main(Namespace(rehearse_closures=True, issues=None))
        with self.assertRaisesRegex(AutomationError, "observation-only"):
            await main(Namespace(rehearse_closures=True, issues=[123], exploratory_reproduction=True))
        with self.assertRaisesRegex(AutomationError, "requires --rehearse-closures"):
            await main(Namespace(rehearsal_from=self.state))
        atomic_write(self.state / "run.json", json.dumps({
            "exploratory_reproduction": False, "overnight": False, "rehearse_closures": True,
        }))
        with self.assertRaisesRegex(AutomationError, "rehearsal policy changed"):
            require_run_mode(self.state, False)
        require_run_mode(self.state, False, rehearse_closures=True)


if __name__ == "__main__":
    unittest.main()
