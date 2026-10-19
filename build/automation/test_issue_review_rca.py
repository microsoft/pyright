# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from copilot import ToolInvocation
from pydantic import JsonValue

from issue_review_models import BlockedChallenge, DraftCheck, Entry, ReproductionPlan, RootCause, RootCauseChallenge, RootCauseFindings, RootCauseGate
from issue_review_rca import Breakpoint, RootCauseRun, RootCauseRuntime
from review_issues import AGENTS, SDK, Agent, AutomationError, Console, RootCauseTools, atomic_write, arguments
from test_review_issues import FakeGitHub, audit, issue, save_evidence
from test_issue_review_editor import editor_record


class RootCauseTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.enterContext(patch("review_issues.show"))
        self.enterContext(patch("review_issues.EditorRuntime.preflight", AsyncMock(return_value={
            "available": False, "missing": ["No editor in offline tests"],
        })))
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.state = Path(temporary.name)
        self.github = FakeGitHub()
        profile = Agent.load(AGENTS / "pyright-issue-by-design-reviewer.md", "pyright-issue-by-design-reviewer")
        self.console = Console(
            self.github, SDK(AsyncMock(), None, 30), self.state,
            profile, profile, None, "context", "a" * 40, {},
        )
        self.entry = Entry(
            input_hash=self.console.key(issue()), context_hash="context", issue=issue(), review=audit(),
        )
        self.plan = ReproductionPlan(
            surface="cli", runner="cli", target="Prepared CLI", reason="The issue concerns a parser diagnostic",
            prerequisites=[], setup=["Use the actual example"], failure_signal="The reported rejection",
            controls=["A neighboring valid comprehension"],
        )
        save_evidence(self.console, self.entry, validity="needs investigation")
        directory = self.console.directory(123) / "rca" / "attempt"
        directory.mkdir(parents=True)
        self.root = RootCause(
            input_hash=self.console.report_hash(self.entry), directory=str(directory), status="found",
            findings=RootCauseFindings(
                issue_number=123, status="found", kind="implementation",
                markdown="# Findings\n\nA potential producer; correctness is still unresolved.",
                cause="The parser emits the rejection on this branch.", location="parser/parser.ts:100",
                evidence_ids=["clean", "debug"], alternatives=["An unrelated downstream diagnostic"],
                limitations=["A potential cause, not a design verdict"],
            ),
            gate=RootCauseGate(
                accepted=True, reason="Observed producer and inputs agree.", evidence_ids=["debug"], missing_evidence=[],
            ),
            challenge=RootCauseChallenge(
                verdict="survived", markdown="The independent counterexample isolates the branch.",
                explanation="The competing path did not produce the rejection.", evidence_ids=["counter"],
            ),
            comment="A potential root cause is this parser branch; maintainer review is still needed.",
            draft_check=DraftCheck(approved=True, problems=[]),
        )
        self.entry.root_cause, self.entry.rca_opt_in = self.root, "accepted"
        output = '{"version":"1.1.414","generalDiagnostics":[]}'
        self.records: list[dict[str, JsonValue]] = [
            {
                "id": "clean", "kind": "product_run", "exit_code": 0, "stdout": output,
                "inputs": [{"file": "example.py", "content": "value = 1"}], "runtime_hash": "runtime",
                "debug": {"errors": [], "hits": []}, "investigator": "root_cause",
            },
            {
                "id": "debug", "kind": "debugger", "exit_code": 0, "stdout": output,
                "inputs": [{"file": "example.py", "content": "value = 1"}], "runtime_hash": "runtime",
                "debug": {"errors": [], "hits": [{
                    "file": "parser/parser.ts", "actual_source": {"line": 100},
                    "evaluations": [{"error": None, "result": {"result": {"type": "number", "value": 1}}}],
                }]}, "investigator": "root_cause",
            },
            {
                "id": "counter", "kind": "product_run", "exit_code": 0, "stdout": output,
                "inputs": [{"file": "example.py", "content": "other = 1"}], "runtime_hash": "runtime",
                "debug": {"errors": [], "hits": []}, "investigator": "root_cause_adversary",
            },
        ]
        self.persist_records()
        self.console.save_rca_report(self.entry)

    def persist_records(self):
        atomic_write(Path(self.root.directory) / "checks.jsonl", "".join(json.dumps(r) + "\n" for r in self.records))

    async def test_unresolved_default_no_never_runs_rca_or_closes(self):
        self.entry.root_cause, self.entry.rca_opt_in = None, "not_asked"
        self.console.ask = lambda question: ""
        with patch.object(self.console, "investigate_root_cause", AsyncMock()) as investigate:
            await self.console.decide(self.entry)
        investigate.assert_not_awaited()
        self.assertEqual(self.entry.rca_opt_in, "declined")
        self.assertEqual(self.github.mutations, [])

    async def test_found_result_has_separate_default_no_posting_consent(self):
        prompts = []
        self.console.ask = lambda question: prompts.append(question) or ""
        self.console.writer = self.console.reviewer
        await self.console.decide(self.entry)
        self.assertEqual(len(prompts), 1)
        self.assertIn("potential root cause to issue #123", prompts[0])
        self.assertEqual(self.root.post_decision, "declined")
        self.assertEqual(self.github.mutations, [])

    async def test_rca_opt_in_does_not_grant_posting_permission(self):
        self.entry.root_cause, self.entry.rca_opt_in = None, "not_asked"
        prompts = []
        answers = iter(["y", "n"])
        self.console.ask = lambda question: prompts.append(question) or next(answers)
        self.console.writer = self.console.reviewer

        async def investigate(entry):
            entry.root_cause, entry.rca_opt_in = self.root, "accepted"

        with patch.object(self.console, "investigate_root_cause", AsyncMock(side_effect=investigate)):
            await self.console.decide(self.entry)
        self.assertEqual(len(prompts), 2)
        self.assertEqual(self.github.mutations, [])

    async def test_dry_run_can_save_approved_rca_but_never_drafts_or_posts(self):
        self.console.read_only = True
        self.console.ask = lambda question: self.fail("No posting approval should be requested")
        with patch.object(self.console, "prepare_root_cause_comment", AsyncMock()) as draft:
            await self.console.decide(self.entry)
        draft.assert_not_awaited()
        with self.assertRaisesRegex(AutomationError, "read-only"):
            await self.console.post_root_cause(self.entry)
        self.assertEqual(self.github.mutations, [])

    async def test_posting_is_comment_only_and_acknowledges_only_own_change(self):
        await self.console.post_root_cause(self.entry)
        self.assertEqual(self.github.mutations, ["comments"])
        self.assertEqual(self.github.current.state, "open")
        self.assertEqual([label.name for label in self.github.current.labels], ["bug"])
        self.assertEqual(self.entry.input_hash, self.console.key(self.github.current))
        self.assertEqual(self.entry.issue.comments, 1)
        assert self.root.publication is not None
        self.assertEqual(self.root.publication.expected_issue.comments, 0)
        self.assertEqual(self.root.publication.status, "posted")

    async def test_ambiguous_post_reconciles_and_never_duplicates(self):
        self.github.ambiguous_comment = True
        with self.assertRaisesRegex(AutomationError, "response lost"):
            await self.console.post_root_cause(self.entry)
        restored = self.console.load(123)
        assert restored is not None
        await self.console.post_root_cause(restored)
        self.assertEqual(self.github.mutations, ["comments"])
        with self.assertRaisesRegex(AutomationError, "already posted"):
            await self.console.post_root_cause(restored)

    async def test_retry_reoffers_declined_pending_publication_without_losing_marker(self):
        self.github.ambiguous_comment = True
        with self.assertRaises(AutomationError):
            await self.console.post_root_cause(self.entry)
        assert self.root.publication is not None
        marker = self.root.publication.marker
        self.root.post_decision = "declined"
        self.console.retry_rca = True
        self.console.ask = lambda question: "y"
        await self.console.offer_root_cause(self.entry)
        self.assertEqual(self.root.publication.marker, marker)
        self.assertEqual(self.root.post_decision, "posted")
        self.assertEqual(self.github.mutations, ["comments"])

    async def test_stale_issue_local_inputs_or_concurrent_correction_blocks_posting(self):
        self.github.current.title = "Changed report"
        with self.assertRaisesRegex(AutomationError, "changed"):
            await self.console.post_root_cause(self.entry)
        self.github.current = issue()
        self.console.current_context = lambda: "new context"
        with self.assertRaisesRegex(AutomationError, "Local inputs"):
            await self.console.post_root_cause(self.entry)
        self.console.current_context = lambda: "context"
        self.github.change_after_comment = True
        with self.assertRaisesRegex(AutomationError, "changed around"):
            await self.console.post_root_cause(self.entry)
        self.assertEqual(self.github.mutations, ["comments"])
        self.assertEqual(self.root.post_decision, "pending")

    async def test_tampered_markdown_ledger_and_private_runtime_block_posting(self):
        for artifact in ("root-cause.md", "checks.jsonl", "runtime/new.js"):
            with self.subTest(artifact=artifact):
                path = Path(self.root.directory) / artifact
                original = path.read_text(encoding="utf-8") if path.exists() else None
                atomic_write(path, (original or "") + "changed")
                with self.assertRaises((AutomationError, ValueError)):
                    await self.console.post_root_cause(self.entry)
                if original is not None:
                    atomic_write(path, original)
                else:
                    path.unlink()
                    path.parent.rmdir()
        self.assertEqual(self.github.mutations, [])

    async def test_failed_gate_or_challenge_cannot_be_published(self):
        assert self.root.gate is not None and self.root.challenge is not None
        self.root.gate.accepted = False
        self.assertFalse(self.root.publishable())
        with self.assertRaisesRegex(AutomationError, "evidence-gated"):
            await self.console.post_root_cause(self.entry)
        self.root.gate.accepted, self.root.challenge.verdict = True, "uncertain"
        self.assertFalse(self.root.publishable())

    async def test_cause_requires_real_hits_state_valid_product_and_clean_comparison(self):
        assert self.root.findings is not None
        mutations: list[tuple[str, JsonValue]] = [
            ("stdout", "{}"), ("exit_code", 2), ("debug", {"errors": [], "hits": []}),
            ("inputs", []), ("runtime_hash", "different runtime"),
        ]
        for field, value in mutations:
            with self.subTest(field=field):
                original = self.records[1][field]
                self.records[1][field] = value
                self.persist_records()
                with self.assertRaisesRegex(AutomationError, "matching clean/debug"):
                    self.console.validate_rca_findings(self.entry, self.root, self.root.findings)
                self.records[1][field] = original
        self.persist_records()
        self.root.findings.location = "parser/parser.ts:99"
        with self.assertRaisesRegex(AutomationError, "actual hits"):
            self.console.validate_rca_findings(self.entry, self.root, self.root.findings)

    async def test_challenger_requires_its_own_successful_execution(self):
        assert self.root.challenge is not None
        for field, value in (("investigator", "root_cause"), ("stdout", "{}"), ("exit_code", 2)):
            original = self.records[2][field]
            self.records[2][field] = value
            self.persist_records()
            with self.assertRaisesRegex(AutomationError, "actual independent"):
                self.console.validate_rca_challenge(self.root, self.root.challenge)
            self.records[2][field] = original

    async def test_retry_reoffers_declined_rca_without_automatic_execution(self):
        self.entry.root_cause, self.entry.rca_opt_in = None, "declined"
        self.console.retry_rca = True
        self.console.ask = lambda question: "n"
        with patch.object(self.console, "investigate_root_cause", AsyncMock()) as investigate:
            await self.console.offer_root_cause(self.entry)
        investigate.assert_not_awaited()
        self.assertEqual(self.entry.rca_opt_in, "declined")
        with patch.object(sys, "argv", ["review_issues.py", "--retry-rca"]):
            self.assertTrue(arguments().retry_rca)

    async def test_root_comment_uses_rich_mirror_then_toolless_factual_check(self):
        self.root.comment, self.root.draft_check = None, None
        self.console.writer = Agent(self.console.reviewer.path, "rich-mirror", "Writer", "Preserve facts.")
        with patch.object(self.console.sdk, "run", AsyncMock(side_effect=[
            "A potential cause; maintainer review is needed.", DraftCheck(approved=True, problems=[]).model_dump_json(),
        ])) as run:
            await self.console.prepare_root_cause_comment(self.entry)
        self.assertEqual(run.call_args_list[0].args[0].name, "rich-mirror")
        for call in run.call_args_list:
            self.assertNotIn("tools", call.kwargs)
        self.assertEqual(self.github.mutations, [])

    async def test_missing_writer_or_rejected_fact_check_blocks_drafting_or_posting(self):
        self.root.comment, self.root.draft_check = None, None
        with self.assertRaisesRegex(AutomationError, "rich-mirror is unavailable"):
            await self.console.prepare_root_cause_comment(self.entry)
        self.console.writer = self.console.reviewer
        with patch.object(self.console.sdk, "run", AsyncMock(side_effect=[
            "Unsupported certainty.", DraftCheck(approved=False, problems=["Claims certainty"]).model_dump_json(),
        ])):
            with self.assertRaisesRegex(AutomationError, "failed factual checking"):
                await self.console.prepare_root_cause_comment(self.entry)
        with self.assertRaisesRegex(AutomationError, "fact-checked"):
            await self.console.post_root_cause(self.entry)
        self.assertEqual(self.github.mutations, [])

    async def test_full_found_pipeline_runs_independent_roles_and_preserves_tags(self):
        assert self.root.findings is not None and self.root.gate is not None and self.root.challenge is not None
        results = [value.model_dump_json() for value in (self.plan, self.root.findings, self.root.gate, self.root.challenge)]
        roles = []
        tags = self.entry.adjudication

        async def response(agent, prompt, scratch, **kwargs):
            roles.append(agent.name)
            if "tools" in kwargs:
                atomic_write(kwargs["tools"].evidence / "checks.jsonl", "".join(json.dumps(r) + "\n" for r in self.records))
            value = results.pop(0)
            kwargs["validate"](value)
            return value

        with patch.object(self.console.sdk, "run", AsyncMock(side_effect=response)):
            await self.console.investigate_root_cause(self.entry)
        self.assertEqual(roles, [
            "pyright-issue-root-cause", "pyright-issue-root-cause",
            "pyright-issue-root-cause-gate", "pyright-issue-root-cause-adversary",
        ])
        assert self.entry.root_cause is not None
        self.assertTrue(self.entry.root_cause.publishable())
        self.console.require_rca_evidence(self.entry)
        self.assertEqual(self.entry.adjudication, tags)
        self.assertEqual(self.github.mutations, [])

    async def test_failed_publication_retains_checkpoint_when_issue_changed(self):
        self.github.ambiguous_comment = True
        with self.assertRaises(AutomationError):
            await self.console.post_root_cause(self.entry)
        self.github.current.body = "Changed after publication"
        restored = await self.console.review(self.github.current, retry_failed=False)
        self.assertIsNotNone(restored.root_cause)
        with self.assertRaisesRegex(AutomationError, "changed around"):
            await self.console.post_root_cause(restored)
        self.assertEqual(self.github.mutations, ["comments"])

    async def test_interrupted_attempt_cannot_appear_to_be_still_running(self):
        self.root.status = "running"
        self.console.ask = lambda question: self.fail("Retry requires --retry-rca")
        await self.console.offer_root_cause(self.entry)
        self.assertEqual(self.root.status, "failed")
        self.assertIn("interrupted", self.root.markdown or "")

    async def test_gate_rejection_and_blockers_save_readable_reports(self):
        assert self.root.findings is not None
        for findings, responses in (
            (self.root.findings, [RootCauseGate(
                accepted=False, reason="Missing causal link.", evidence_ids=[], missing_evidence=["Relevant state"],
            ).model_dump_json()]),
            (self.root.findings.model_copy(update={"status": "blocked"}), []),
        ):
            with self.subTest(status=findings.status):
                async def response(agent, prompt, scratch, **kwargs):
                    if kwargs["schema"] is ReproductionPlan:
                        self.assertNotIn("tools", kwargs)
                        return self.plan.model_dump_json()
                    if kwargs["schema"] is BlockedChallenge:
                        return BlockedChallenge(
                            retry=False, reason="The required host is unavailable", alternative=None,
                            missing_prerequisites=["Editor host"],
                        ).model_dump_json()
                    if agent.name == "pyright-issue-root-cause":
                        evidence = kwargs["tools"].evidence
                        atomic_write(evidence / "checks.jsonl", "".join(json.dumps(r) + "\n" for r in self.records))
                        return findings.model_dump_json()
                    return responses.pop(0)
                with patch.object(self.console.sdk, "run", AsyncMock(side_effect=response)):
                    await self.console.investigate_root_cause(self.entry)
                root = self.entry.root_cause
                assert root is not None
                self.assertFalse(root.publishable())
                self.assertTrue((Path(root.directory) / "root-cause.md").is_file())
                self.assertIn("not a confirmed fix", root.markdown or "")

    async def test_investigation_failure_is_explicit_and_reported(self):
        with patch.object(self.console.sdk, "run", AsyncMock(side_effect=AutomationError("Debugger unavailable"))):
            with self.assertRaisesRegex(AutomationError, "Debugger unavailable"):
                await self.console.investigate_root_cause(self.entry)
        root = self.entry.root_cause
        assert root is not None
        self.assertEqual(root.status, "failed")
        self.assertIn("Debugger unavailable", root.markdown or "")

    async def test_blocked_challenge_runs_at_most_one_different_attempt_and_preserves_partial_findings(self):
        assert self.root.findings is not None
        first = self.root.findings.model_copy(update={"status": "blocked", "markdown": "First attempt has useful partial evidence."})
        second = first.model_copy(update={"markdown": "Alternative attempt remains blocked."})
        alternative = self.plan.model_copy(update={"setup": ["Reuse the already inspected repro instead of an empty file"]})
        responses = [
            self.plan, first,
            BlockedChallenge(retry=True, reason="The original example is already available", alternative=alternative, missing_prerequisites=[]),
            second,
        ]
        schemas = []
        async def response(agent, prompt, scratch, **kwargs):
            schemas.append(kwargs["schema"])
            if len(schemas) == 4:
                root = self.entry.root_cause
                assert root is not None
                self.assertEqual(root.status, "running")
                saved = self.console.load(123)
                assert saved is not None and saved.root_cause is not None
                self.assertEqual(saved.root_cause.status, "running")
            if "tools" in kwargs:
                atomic_write(kwargs["tools"].evidence / "checks.jsonl", "".join(json.dumps(r) + "\n" for r in self.records))
            return responses.pop(0).model_dump_json()
        with patch.object(self.console.sdk, "run", AsyncMock(side_effect=response)):
            await self.console.investigate_root_cause(self.entry)
        self.assertEqual(schemas, [ReproductionPlan, RootCauseFindings, BlockedChallenge, RootCauseFindings])
        root = self.entry.root_cause
        assert root is not None
        self.assertEqual(root.prior_findings, [first])
        self.assertEqual(root.prior_plans, [self.plan])
        self.assertEqual(root.plan, alternative)
        self.assertIn(first.markdown, root.markdown or "")
        self.assertIn(second.markdown, root.markdown or "")
        self.assertIn(self.plan.model_dump_json(indent=2), root.markdown or "")
        self.assertIn(alternative.model_dump_json(indent=2), root.markdown or "")
        self.assertEqual(root.status, "blocked")
        self.assertFalse(root.publishable())
        self.assertEqual(self.github.mutations, [])

    async def test_blocked_challenge_cannot_retry_by_rewording_the_same_execution_plan(self):
        assert self.root.findings is not None
        first = self.root.findings.model_copy(update={"status": "blocked"})
        alternative = self.plan.model_copy(update={
            "reason": "Try the same thing with a different explanation",
            "prerequisites": ["Already available"],
            "failure_signal": "A rewording of the same diagnostic",
        })
        responses = [
            self.plan, first,
            BlockedChallenge(retry=True, reason="Different explanation", alternative=alternative, missing_prerequisites=[]),
        ]
        async def response(agent, prompt, scratch, **kwargs):
            if "tools" in kwargs:
                atomic_write(kwargs["tools"].evidence / "checks.jsonl", "".join(json.dumps(r) + "\n" for r in self.records))
            return responses.pop(0).model_dump_json()
        with patch.object(self.console.sdk, "run", AsyncMock(side_effect=response)) as run:
            with self.assertRaisesRegex(AutomationError, "unchanged"):
                await self.console.investigate_root_cause(self.entry)
        self.assertEqual(run.await_count, 3)
        self.assertEqual(self.github.mutations, [])

    async def test_reported_editor_surface_rejects_a_cli_plan_before_execution(self):
        assert self.entry.review is not None
        self.entry.review.product_surface = "editor"
        self.entry.review_markdown = "This report needs the actual extension host."
        save_evidence(self.console, self.entry, validity="needs investigation")
        with patch.object(self.console.sdk, "run", AsyncMock(return_value=self.plan.model_dump_json())) as run:
            with self.assertRaisesRegex(AutomationError, "CLI proxy"):
                await self.console.investigate_root_cause(self.entry)
        self.assertEqual(run.await_count, 1)
        self.assertNotIn("tools", run.call_args.kwargs)

    async def test_editor_cause_needs_integration_failure_matching_controls_and_actual_producer_state(self):
        assert self.root.findings is not None
        self.root.plan = ReproductionPlan(
            surface="editor", runner="editor_interpreter", target="Current installed target", reason="Actual interpreter handoff",
            prerequisites=[], setup=["Fresh environment and profile"], failure_signal="Directory reaches server",
            controls=["venv", "python_envs/venv"],
        )
        self.root.findings.location = "packages/vscode-pyright/src/extension.ts:354"
        self.records = [editor_record(), editor_record("debug", debug=True)]
        cases = self.records[1]["cases"]
        assert isinstance(cases, list) and isinstance(cases[0], dict)
        observation = cases[0]["observation"]
        assert isinstance(observation, dict)
        self.persist_records()
        self.console.validate_rca_findings(self.entry, self.root, self.root.findings)
        mutations: list[tuple[str, JsonValue]] = [
            ("hits", []), ("failure_observed", False), ("host_version", "1.85.1"),
            ("errors", ["Failed observation"]), ("complete", False),
        ]
        for field, value in mutations:
            original = observation[field]
            observation[field] = value
            self.persist_records()
            with self.assertRaises(AutomationError):
                self.console.validate_rca_findings(self.entry, self.root, self.root.findings)
            observation[field] = original
        self.records = [editor_record(failure=False), editor_record("debug", debug=True, failure=False)]
        self.persist_records()
        with self.assertRaisesRegex(AutomationError, "actual planned surface"):
            self.console.validate_rca_findings(self.entry, self.root, self.root.findings)


class RuntimeTests(unittest.IsolatedAsyncioTestCase):
    async def test_private_copy_and_actual_invocation_artifacts(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "packages" / "pyright" / "dist"
            source.mkdir(parents=True)
            for name in ("pyright.js", "pyright-internal.js", "pyright-internal.js.map", "vendor.js"):
                (source / name).write_text("prepared bundle", encoding="utf-8")
            directory, scratch = root / "attempt", root / "scratch"
            scratch.mkdir()
            (scratch / "pyrightconfig.json").write_text("{}", encoding="utf-8")
            async def runner(command, cwd):
                manifest = json.loads(Path(command[-1]).read_text(encoding="utf-8"))
                atomic_write(Path(manifest["artifact"]), json.dumps({"id": manifest["id"], "errors": [], "hits": []}))
                return 0, '{"version":"1.1.414","generalDiagnostics":[]}', ""
            runtime = RootCauseRuntime(root, directory, scratch, runner)
            await runtime.prepare()
            record = await runtime.run(RootCauseRun())
            self.assertEqual(record["kind"], "product_run")
            self.assertEqual((source / "pyright.js").read_text(), "prepared bundle")
            (runtime.snapshot / "pyright.js").write_text("tampered", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "changed"):
                await runtime.run(RootCauseRun())

    async def test_missing_maps_and_breakpoint_path_escape_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            runtime = RootCauseRuntime(root, root / "attempt", root / "scratch", AsyncMock())
            with self.assertRaisesRegex(ValueError, "source maps"):
                await runtime.prepare()
            runtime.snapshot.mkdir(parents=True)
            runtime.snapshot_hash = runtime.fingerprint()
            with self.assertRaisesRegex(ValueError, "inside pyright-internal"):
                await runtime.run(RootCauseRun(breakpoints=[Breakpoint(file="../outside.ts", line=1)]))

    async def test_unapproved_authority_host_cannot_be_requested(self):
        with tempfile.TemporaryDirectory() as temporary:
            scratch = Path(temporary)
            runtime = RootCauseRuntime(scratch, scratch, scratch, AsyncMock())
            tools = RootCauseTools(FakeGitHub(), scratch, {}, scratch, runtime)
            invocation = ToolInvocation(
                session_id="test", tool_call_id="source", tool_name="rca_read_source",
                arguments={"url": "https://example.com/untrusted"},
            )
            result = await tools.rca_read_source(invocation)
            self.assertEqual(result.result_type, "failure")
            self.assertIn("approved authoritative HTTPS", result.text_result_for_llm)
