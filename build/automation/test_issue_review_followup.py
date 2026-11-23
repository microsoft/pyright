# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from issue_review_models import (
    BlockedChallenge, Entry, ProviderPolicyFailure, ReproductionPlan, RootCause, RootCauseFindings,
    RootCauseChallenge, RootCauseGate,
)
from review_issues import (
    AGENTS, REPOSITORY, SDK, Agent, AutomationError, Console, GitHub, arguments, atomic_write,
    followup_mechanism_status, main, require_followup_candidate, require_run_mode, run_rca_followup,
)
from test_review_issues import FakeGitHub, audit, issue, save_evidence


class FollowupTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.enterContext(patch("review_issues.show"))
        self.enterContext(patch("review_issues.EditorRuntime.preflight", AsyncMock(return_value={
            "available": False, "missing": ["No editor in offline tests"],
        })))
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        self.source, self.state = root / "triage", root / "followup"
        atomic_write(self.source / "run.json", json.dumps({"repository": REPOSITORY, "context_hash": "old-context"}))
        self.github = FakeGitHub()
        self.profile = Agent.load(AGENTS / "pyright-issue-root-cause.md", "pyright-issue-root-cause")
        self.console = Console(
            self.github, SDK(AsyncMock(), None, 10), self.state, self.profile, self.profile, None,
            "new-context", "a" * 40, {}, rca_only=True,
        )
        self.source_console = Console(
            self.github, SDK(AsyncMock(), None, 10), self.source, self.profile, self.profile, None,
            "old-context", "b" * 40, {},
        )
        self.snapshot = issue()
        self.previous = self.save_source(self.snapshot)
        self.calls: list[str] = []
        self.sdk_run = AsyncMock(side_effect=self.execute)
        self.console.sdk.run = self.sdk_run

    def save_source(self, snapshot):
        report = audit()
        report.issue_number, report.issue_url = snapshot.number, snapshot.html_url
        entry = Entry(
            input_hash=self.source_console.key(snapshot), context_hash="old-context", issue=snapshot,
            review=report, decision="reviewed",
        )
        save_evidence(self.source_console, entry, validity="needs investigation")
        assert entry.duplicates is not None and entry.adjudication is not None
        entry.duplicates.issue_number = snapshot.number
        entry.adjudication.report_hash = self.source_console.report_hash(entry)
        self.source_console.save(entry)
        return entry

    async def execute(self, agent, prompt, scratch, **options):
        self.calls.append(agent.name)
        schema = options["schema"]
        if schema is not BlockedChallenge:
            self.assertIn("PRIOR TRIAGE BACKGROUND ONLY, NOT CURRENT EVIDENCE", prompt)
            self.assertIn("NOT been recertified", prompt)
            self.assertIn("Fresh screened issue discussion", prompt)
        if schema is ReproductionPlan:
            result = ReproductionPlan(
                surface="cli", runner="cli", target="Prepared current CLI", reason="A static diagnostic",
                prerequisites=[], setup=["Reconstruct the original input"], failure_signal="The diagnostic",
                controls=["A neighboring case"],
            )
        elif schema is RootCauseFindings:
            result = RootCauseFindings(
                issue_number=123, status="inconclusive", kind="unknown",
                markdown="Missing original information remains unresolved.", cause="The original binding is missing.",
                location=None, evidence_ids=[], alternatives=["A different original binding"],
                limitations=["Prior triage is not fresh reproduction evidence"],
            )
        else:
            self.assertIs(schema, BlockedChallenge)
            result = BlockedChallenge(
                retry=False, reason="No experiment recovers the omitted original binding.",
                alternative=None, missing_prerequisites=["Original binding"],
            )
        raw = result.model_dump_json()
        options.get("validate", lambda _: None)(raw)
        return raw

    async def run_followup(self, snapshots=None, *, retry_failed=False):
        await run_rca_followup(
            self.console, self.source, snapshots or [self.snapshot], 1, retry_failed=retry_failed,
        )

    def summary(self):
        return json.loads((self.state / "rca-followup.json").read_text(encoding="utf-8"))

    async def test_old_context_is_background_only_and_current_rca_uses_unchanged_gates(self):
        before = {p: p.read_bytes() for p in self.source.rglob("*") if p.is_file()}
        with (
            patch.object(self.console, "review", AsyncMock(side_effect=AssertionError("No re-triage"))),
            patch.object(self.console, "evaluate", AsyncMock(side_effect=AssertionError("No closure evaluation"))),
            patch.object(self.console, "decide", AsyncMock(side_effect=AssertionError("No publication decisions"))),
        ):
            await self.run_followup()
        entry = self.console.load(123)
        assert entry is not None and entry.root_cause is not None and entry.rca_followup is not None
        self.assertEqual(entry.context_hash, "new-context")
        self.assertIsNone(entry.review)
        self.assertIsNone(entry.adjudication)
        self.assertIsNone(entry.reproduction_stage)
        self.assertIsNone(entry.closure)
        assert self.previous.adjudication is not None
        self.assertNotEqual(entry.root_cause.input_hash, self.previous.adjudication.report_hash)
        self.assertEqual(entry.root_cause.status, "inconclusive")
        self.assertEqual(len(self.calls), 3)
        self.assertTrue(self.summary()["complete"])
        self.assertFalse(self.summary()["publication_ready"])
        self.assertEqual(self.summary()["results"][0]["mechanism_status"], "not_established")
        self.assertEqual(self.summary()["results"][0]["semantic_disposition"], "not_adjudicated")
        self.assertEqual(self.github.mutations, [])
        self.assertEqual(before, {p: p.read_bytes() for p in self.source.rglob("*") if p.is_file()})
        self.assertEqual(
            (self.state / "123" / "triage-entry.json").read_bytes(),
            (self.source / "123" / "entry.json").read_bytes(),
        )
        await self.run_followup()
        self.assertEqual(len(self.calls), 3)
        self.assertEqual(self.summary()["completed_issues"], 1)

    def test_mechanism_requires_countercheck_and_does_not_promote_a_refuted_candidate(self):
        findings = RootCauseFindings(
            issue_number=123, status="found", kind="implementation", markdown="Observed an early return.",
            cause="Validation exits early.", location="analyzer/typeEvaluator.ts:123", evidence_ids=["primary"],
            alternatives=[], limitations=[],
        )
        rca = RootCause(
            input_hash="input", directory="capture", status="inconclusive", findings=findings,
            markdown="Local report", evidence_hash="hash",
            gate=RootCauseGate(accepted=True, reason="Primary evidence matches", evidence_ids=["primary"], missing_evidence=[]),
        )
        self.assertEqual(followup_mechanism_status(rca), "candidate")
        rca.challenge = RootCauseChallenge(
            verdict="refuted", markdown="Control disagrees.", explanation="Control disagrees.", evidence_ids=["control"],
        )
        self.assertEqual(followup_mechanism_status(rca), "not_established")
        rca.challenge.verdict = "survived"
        rca.status = "found"
        self.assertEqual(followup_mechanism_status(rca), "counterchecked")

    async def test_all_chunks_run_and_completed_entries_are_reused_without_model_requests(self):
        other = self.github.canonical
        self.save_source(other)

        async def inconclusive(entry):
            root = self.console.directory(entry.issue.number) / "rca" / "test"
            atomic_write(root / "checks.jsonl", "")
            entry.root_cause = RootCause(
                input_hash=self.console.report_hash(entry), directory=str(root),
                status="inconclusive", stage="complete",
            )
            self.console.save_rca_report(entry)
            await asyncio.sleep(0)

        with patch.object(self.console, "ensure_root_cause", AsyncMock(side_effect=inconclusive)) as rca:
            await self.run_followup([self.snapshot, other])
            self.assertEqual(rca.await_count, 2)
            await self.run_followup([self.snapshot, other])
            self.assertEqual(rca.await_count, 2)
        self.assertEqual(self.summary()["outcome_counts"]["inconclusive"], 2)
        self.assertTrue(self.summary()["complete"])
        self.sdk_run.assert_not_awaited()

    async def test_changed_background_discussion_runtime_or_cohort_is_not_resealed(self):
        await self.run_followup()
        original = (self.state / "123" / "triage-entry.json").read_bytes()
        entry_bytes = (self.state / "123" / "entry.json").read_bytes()
        result_bytes = (self.state / "123" / "followup-result.json").read_bytes()
        for scenario in ("packet", "discussion", "context", "cohort", "receipt", "semantic verdict", "mechanism"):
            with self.subTest(scenario=scenario):
                if scenario == "packet":
                    (self.state / "123" / "triage-entry.json").write_bytes(original + b"\n")
                elif scenario == "discussion":
                    self.github.discussion = [{"id": 8, "body": "A new binding"}]
                elif scenario == "context":
                    self.console.context_hash = "changed"
                elif scenario == "receipt":
                    entry = self.console.load(123)
                    assert entry is not None and entry.root_cause is not None
                    atomic_write(Path(entry.root_cause.directory) / "checks.jsonl", '{"id":"invented"}\n')
                elif scenario in ("semantic verdict", "mechanism"):
                    result = json.loads(result_bytes)
                    key, value = ("semantic_disposition", "bug") if scenario == "semantic verdict" else (
                        "mechanism_status", "counterchecked",
                    )
                    result[key] = value
                    atomic_write(self.state / "123" / "followup-result.json", json.dumps(result))
                with self.assertRaises(AutomationError):
                    await self.run_followup([self.snapshot, self.github.canonical] if scenario == "cohort" else None)
                self.assertEqual(len(self.calls), 3)
                (self.state / "123" / "triage-entry.json").write_bytes(original)
                (self.state / "123" / "entry.json").write_bytes(entry_bytes)
                (self.state / "123" / "followup-result.json").write_bytes(result_bytes)
                self.github.discussion = []
                self.console.context_hash = "new-context"

    async def test_closed_and_ineligible_cases_are_explicit_without_substitution_or_sdk_calls(self):
        self.github.current.state = "closed"
        await self.run_followup([self.github.current])
        self.assertEqual(self.summary()["outcome_counts"]["skipped"], 1)
        self.assertEqual(self.summary()["planned_issues"], 1)
        self.assertEqual(self.summary()["mechanism_counts"]["not_established"], 1)
        self.sdk_run.assert_not_awaited()
        for change in (
            {"decision": "failed"}, {"closure": None, "review": None},
            {"decision": "closed"}, {"adjudication": None},
        ):
            with self.subTest(change=change), self.assertRaises(AutomationError):
                require_followup_candidate(self.previous.model_copy(update=change), 123)

    async def test_saved_provider_rejection_never_starts_another_session(self):
        await self.run_followup()
        entry = self.console.load(123)
        assert entry is not None and entry.root_cause is not None
        failure = ProviderPolicyFailure(
            agent="pyright-issue-root-cause", session_id="session", event_id="event",
            error_code="cyber_policy", status_code=422,
        )
        entry.root_cause.status, entry.root_cause.policy_failure = "failed", failure
        self.console.save_rca_report(entry)
        self.console.retry_rca = True
        with self.assertRaises(AutomationError):
            await self.run_followup(retry_failed=True)
        self.assertEqual(len(self.calls), 3)
        self.previous.root_cause = entry.root_cause
        with self.assertRaisesRegex(AutomationError, "Provider-policy"):
            require_followup_candidate(self.previous, 123)

    async def test_failed_investigation_resumes_its_plan_without_retriage_or_new_attempt(self):
        primary_calls = 0

        async def fail_once(agent, prompt, scratch, **options):
            nonlocal primary_calls
            if options["schema"] is RootCauseFindings:
                primary_calls += 1
                if primary_calls == 1:
                    raise TimeoutError("A simulated interrupted investigation")
            return await self.execute(agent, prompt, scratch, **options)

        self.sdk_run.side_effect = fail_once
        with self.assertRaises(AutomationError):
            await self.run_followup()
        entry = self.console.load(123)
        assert entry is not None and entry.root_cause is not None
        attempt = entry.root_cause.directory
        self.assertEqual(self.summary()["outcome_counts"]["failed"], 1)
        await_count = self.sdk_run.await_count
        with self.assertRaises(AutomationError):
            await self.run_followup()
        self.assertEqual(self.sdk_run.await_count, await_count)
        self.console.retry_rca = True
        await self.run_followup()
        restored = self.console.load(123)
        assert restored is not None and restored.root_cause is not None
        self.assertEqual(restored.root_cause.directory, attempt)
        self.assertEqual(restored.root_cause.status, "inconclusive")
        self.assertEqual(self.sdk_run.await_count, 4)
        self.assertEqual(self.github.mutations, [])

    async def test_main_routes_only_to_read_only_followup_and_preserves_run_provenance(self):
        with patch("sys.argv", [
            "review_issues.py", "--rca-from", str(self.source), "--issues", "123",
            "--state-dir", str(self.state), "--cli-path", "copilot",
        ]):
            args = arguments()
        capability = SimpleNamespace(available=False, error="Offline fixture", version=None)
        capabilities = SimpleNamespace(
            pyright=capability, mypy=capability, model_dump_json=lambda **_: "{}",
        )
        self.github.api = AsyncMock(return_value={"tag_name": "test"})
        with (
            patch("review_issues.GitHub", return_value=self.github) as github,
            patch("review_issues.InjectionScreening.from_environment"),
            patch("review_issues.process", AsyncMock(return_value=(0, "test runtime", ""))),
            patch("review_issues.context_hash", return_value="new-context"),
            patch("review_issues.git", return_value="a" * 40),
            patch("review_issues.CheckPreflight.get", AsyncMock(return_value=capabilities)),
            patch("review_issues.CopilotClient"),
            patch("review_issues.Console", return_value=self.console),
            patch("review_issues.run_rca_followup", AsyncMock()) as followup,
            patch.object(self.console, "review", AsyncMock(side_effect=AssertionError("No re-triage"))),
            patch.object(self.console, "evaluate", AsyncMock(side_effect=AssertionError("No closure evaluation"))),
            patch.object(self.console, "decide", AsyncMock(side_effect=AssertionError("No publication"))),
        ):
            await main(args)
            run = (self.state / "run.json").read_bytes()
            await main(args)
        self.assertEqual(followup.await_count, 2)
        self.assertFalse(github.call_args.kwargs["mutations_enabled"])
        metadata = json.loads(run)
        self.assertFalse(metadata["automatic_publication"])
        self.assertFalse(metadata["prepare_targets"])
        self.assertTrue(metadata["rca_enabled"])
        self.assertEqual(run, (self.state / "run.json").read_bytes())

    async def test_mode_cannot_be_promoted_to_publication_and_transport_denies_mutations(self):
        atomic_write(self.state / "run.json", json.dumps({
            "rca_from": str(self.source), "exploratory_reproduction": False,
        }))
        require_run_mode(self.state, False, rca_from=self.source)
        with self.assertRaises(AutomationError):
            require_run_mode(self.state, False)
        await self.run_followup()
        entry = self.console.load(123)
        assert entry is not None
        self.console.rca_only = False
        with self.assertRaises(AutomationError):
            self.console.require_report_evidence(entry)
        github = GitHub(mutations_enabled=False)
        with patch("review_issues.process", AsyncMock()) as process:
            for method, endpoint in (("POST", "repos/microsoft/pyright/issues/123/comments"), ("GET", "graphql")):
                with self.assertRaisesRegex(AutomationError, "structurally disabled"):
                    await github.api(method, endpoint)
        process.assert_not_awaited()

    async def test_invalid_cli_combinations_fail_before_external_calls(self):
        for extra in (
            [], ["--issues", "123", "--overnight"], ["--issues", "123", "--no-rca"],
            ["--issues", "123", "--rehearse-closures"], ["--issues", "123", "--exploratory-reproduction"],
        ):
            with self.subTest(extra=extra), patch(
                "sys.argv", ["review_issues.py", "--rca-from", str(self.source), *extra],
            ):
                args = arguments()
                with self.assertRaises(AutomationError):
                    await main(args)


if __name__ == "__main__":
    unittest.main()
