# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from copilot import ToolInvocation
from copilot.generated.rpc import PermissionDecisionReject
from copilot.generated.session_events import AssistantMessageData, PermissionRequestRead, PermissionRequestShell
from pydantic import JsonValue, ValidationError

from evaluate_issue_design import (
    BenchmarkTools, DesignFindings, ReferenceCase, blind_text, capture, evaluate, load_cases,
    make_report, product_fingerprint, run_baseline, score, validate_findings,
)
from review_issues import AGENTS, ROOT, SDK, Agent, AutomationError
from issue_review_models import Audit, ReviewEvidence
from test_review_issues import FakeGitHub, audit


def reference(**updates) -> ReferenceCase:
    return ReferenceCase.model_validate({
        "id": "case-a01", "issue_number": 123, "family": "annotations", "split": "development",
        "expected": "by design", "rationale": "A reference rule, still provisional",
        "reference_urls": ["https://github.com/microsoft/pyright/issues/123#issuecomment-2"],
        "input_review_notes": "Only the report and selected pre-resolution clarification are visible",
        "resolution_comment_id": 2, "visible_comment_ids": [1], **updates,
    })


def comments() -> list[JsonValue]:
    return [
        {"id": 1, "body": "Clarification, see #123", "created_at": "2026-01-01T00:00:00Z"},
        {"id": 2, "body": "SECRET ANSWER: as designed", "created_at": "2026-01-02T00:00:00Z"},
        {"id": 3, "body": "Thanks for the resolution", "created_at": "2026-01-03T00:00:00Z"},
    ]


def invocation(arguments) -> ToolInvocation:
    return ToolInvocation(session_id="test", tool_call_id="test", tool_name="test", arguments=arguments)


def blind_findings(**updates) -> DesignFindings:
    evidence = audit().model_dump(include=set(ReviewEvidence.model_fields))
    return DesignFindings.model_validate({
        **evidence, "historical_searches": [],
        "markdown": "Evidence", "verdict": "by design", "confidence": "high",
        "basis": "An applicable rule", "counterevidence": "A discriminating control",
        "falsification": "A conflicting applicable rule", "limitations": [],
        **updates,
    })


class BlindingTests(unittest.TestCase):
    def test_report_has_no_identity_metadata_or_resolution(self):
        report = make_report(reference(), "A failing annotation. See https://github.com/microsoft/pyright/issues/123", comments(), {123})
        serialized = report.model_dump_json()
        for hidden in ("SECRET ANSWER", "as designed", "Thanks", "github.com", "123", "labels", "state", "expected"):
            self.assertNotIn(hidden, serialized)
        self.assertIn("Clarification", serialized)

    def test_only_explicit_pre_resolution_clarifications_are_allowed(self):
        for identifiers in ([2], [3], [99]):
            with self.subTest(identifiers=identifiers), self.assertRaises(AutomationError):
                make_report(reference(visible_comment_ids=identifiers), "Report", comments(), {123})
        with self.assertRaises(AutomationError):
            make_report(reference(resolution_comment_id=None), "Report", comments(), {123})

    def test_missing_resolution_cannot_silently_fall_back(self):
        with self.assertRaises(AutomationError):
            make_report(reference(resolution_comment_id=99, visible_comment_ids=[]), "Report", comments(), {123})

    def test_reviewed_body_can_remove_answer_added_by_edit(self):
        report = make_report(
            reference(input_body="Original report", visible_comment_ids=[]),
            "Report edited to contain SECRET ANSWER", comments(), {123},
        )
        self.assertEqual(report.body, "Original report")

    def test_only_the_explicitly_inspected_code_block_is_frozen(self):
        body = "```python\nvalue: int = 'wrong'\n```\n\n```\nprint('not the selected example')\n```"
        report = make_report(reference(repro_block=1), body, comments(), {123})
        self.assertEqual(report.repro_source, "value: int = 'wrong'\n")
        with self.assertRaises(AutomationError):
            make_report(reference(repro_block=3), body, comments(), {123})

    def test_identity_redaction_is_not_unbounded_substring_replacement(self):
        self.assertEqual(blind_text("See #123, not the integer 1234", {123}), "See #[issue identity withheld], not the integer 1234")

    def test_cohort_rejects_duplicate_cases_and_cross_split_families(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "cases.json"
            for cases in (
                [reference(), reference()],
                [reference(), reference(id="case-b01", issue_number=456, split="holdout")],
            ):
                path.write_text(json.dumps([case.model_dump() for case in cases]), encoding="utf-8")
                with self.assertRaises(AutomationError):
                    load_cases(path)

    def test_checked_in_cohort_is_provisional_and_has_both_outcomes(self):
        cases = load_cases(Path(__file__).with_name("design_benchmark_cases.json"))
        development = [case for case in cases if case.split == "development"]
        self.assertEqual({case.expected for case in development}, {"by design", "bug"})
        self.assertTrue(all(case.reference_status == "provisional" for case in cases))

    def test_second_iteration_expands_development_without_consuming_holdout(self):
        initial = load_cases(Path(__file__).with_name("design_benchmark_cases.json"))
        expanded = load_cases(Path(__file__).with_name("design_benchmark_iteration2.json"))
        holdout = [case for case in initial if case.split == "holdout"]
        self.assertEqual(len(expanded), 7)
        self.assertTrue(all(case.split == "development" and case.reference_status == "provisional" for case in expanded))
        self.assertTrue({case.issue_number for case in expanded}.isdisjoint(case.issue_number for case in holdout))
        self.assertTrue({case.family for case in expanded}.isdisjoint(case.family for case in holdout))
        fresh = {case.issue_number for case in expanded} - {case.issue_number for case in initial}
        self.assertEqual(fresh, {9442, 11203, 11207, 11194})
        self.assertEqual({case.issue_number for case in expanded if case.expected == "bug"}, {11859, 11836})
        self.assertTrue(all(case.repro_block == 1 for case in expanded))

    def test_false_design_and_abstention_are_separate_from_errors(self):
        cases = [reference(), reference(id="case-a02", issue_number=456, expected="bug", family="other")]
        summary = score(cases, [{"id": "case-a01", "verdict": "needs investigation"}, {"id": "case-a02", "verdict": "by design"}])
        self.assertEqual(summary["false_design_against_reference"], 1)
        self.assertEqual(summary["abstentions"], 1)
        self.assertEqual(summary["operational_errors"], 0)
        self.assertEqual(summary["human_reviewed_references"], 0)
        self.assertIn("not established accuracy", str(summary["interpretation"]))
        self.assertTrue(summary["complete"])
        self.assertFalse(score(cases, [{"id": "case-a01", "error": "Interrupted"}])["complete"])

    def test_resolved_results_need_evidence(self):
        with self.assertRaises(ValidationError):
            blind_findings(
                markdown="Predicted", verdict="by design", confidence="high", basis="A guess",
                counterevidence="None", falsification="A counterexample", limitations=[], checks=[], sources=[],
            )

    def test_claim_and_closure_gates_match_production_without_exposing_identity(self):
        for scenario in ("supported", "medium", "bug", "blocked", "no_history"):
            original = audit().model_dump()
            if scenario == "medium":
                original["claims"][0]["confidence"] = "medium"
            elif scenario == "bug":
                original["claims"][0]["disposition"] = "bug"
            elif scenario == "blocked":
                original["claims"][0]["reproduction"][2]["status"] = "blocked"
            elif scenario == "no_history":
                original["historical_searches"] = []
            production = Audit.model_validate(original)
            findings = blind_findings(**production.model_dump(include=set(ReviewEvidence.model_fields)))
            self.assertEqual(findings.design_claims_supported(), production.design_claims_supported())
            self.assertEqual(findings.closure_candidate(), production.closure_candidate())
            self.assertEqual(findings.observed_product(), production.observed_product())
            self.assertNotIn("issue_number", findings.model_dump())
            self.assertNotIn("issue_url", findings.model_dump())
        findings = blind_findings(confidence="low")
        self.assertTrue(findings.design_claims_supported())
        self.assertFalse(findings.closure_candidate())

    def test_false_closure_scoring_requires_explicit_references_and_actual_results(self):
        cases = [
            reference(expected="bug", expected_design_closure=False),
            reference(id="case-a02", issue_number=456, family="other"),
            reference(id="case-a03", issue_number=789, family="third", expected_design_closure=False),
        ]
        summary = score(cases, [
            {"id": "case-a01", "verdict": "by design", "design_closure_candidate": True},
            {"id": "case-a02", "verdict": "by design", "design_closure_candidate": False},
            {"id": "case-a03", "error": "Blocked before inference"},
        ])
        self.assertEqual(summary["closure_evaluated_cases"], 2)
        self.assertEqual(summary["closure_scored_cases"], 1)
        self.assertEqual(summary["false_closure_proposals"], 1)
        self.assertEqual(summary["closure_reference_agreements"], 0)
        self.assertEqual(summary["operational_errors"], 1)
        with self.assertRaises(ValidationError):
            reference(expected="bug", expected_design_closure=True)


class BenchmarkToolTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary.name)
        self.scratch = self.directory / "scratch"
        self.scratch.mkdir()
        self.tools = BenchmarkTools(self.scratch, self.directory, {11206})

    async def asyncTearDown(self):
        self.temporary.cleanup()

    async def test_capture_preserves_hidden_snapshot_but_public_report_is_anonymous(self):
        github = FakeGitHub()
        github.discussion = comments()
        data = self.directory / "dataset"
        await capture([reference()], data, github)
        public = (data / "reports" / "case-a01.json").read_text(encoding="utf-8")
        hidden = (data / "references" / "case-a01" / "snapshot.json").read_text(encoding="utf-8")
        self.assertNotIn("SECRET ANSWER", public)
        self.assertIn("SECRET ANSWER", hidden)
        self.assertEqual(github.mutations, [])
        with self.assertRaises(AutomationError):
            await capture([reference()], data, github)

    async def test_capture_failure_does_not_release_unscreened_report(self):
        github = FakeGitHub()
        github.discussion = comments()
        github.screen = AsyncMock(side_effect=ValueError("Classifier blocked"))
        data = self.directory / "dataset"
        with self.assertRaises(ValueError):
            await capture([reference()], data, github)
        self.assertFalse((data / "reports" / "case-a01.json").exists())

    async def test_original_baseline_is_separate_from_editable_control_scratch(self):
        report = make_report(reference(repro_block=1), "```python\nvalue: int = 'wrong'\n```", comments(), {123})
        with patch("review_issues.process", new_callable=AsyncMock, return_value=(
            1, '{"version":"1.1.414","generalDiagnostics":[]}', "",
        )) as run:
            baseline = await run_baseline(report, self.directory)
        self.assertIsNotNone(baseline)
        self.assertEqual((self.directory / "original" / "original.py").read_text(), "value: int = 'wrong'\n")
        self.assertEqual(run.call_args.args[1], self.directory / "original")
        denied = await self.tools.write_scratch(invocation({"file": r"..\original\original.py", "content": "changed"}))
        self.assertEqual(denied.result_type, "failure")
        self.assertEqual((self.directory / "original" / "original.py").read_text(), report.repro_source)

    async def test_mutated_capture_cannot_start_model_analysis(self):
        github = FakeGitHub()
        github.discussion = comments()
        case = reference()
        data = self.directory / "dataset"
        await capture([case], data, github)
        path = data / "reports" / "case-a01.json"
        value = json.loads(path.read_text(encoding="utf-8"))
        value["body"] = "A materially different report"
        path.write_text(json.dumps(value), encoding="utf-8")
        sdk = SDK(AsyncMock(), "gpt-6.1-sol", 30)
        with (
            patch.object(sdk, "run", new_callable=AsyncMock) as run,
            patch("evaluate_issue_design.product_fingerprint", return_value="prepared"),
            patch("evaluate_issue_design.process", new_callable=AsyncMock, return_value=(0, "revision", "")),
        ):
            summary = await evaluate([case], data, self.directory / "result", sdk, AsyncMock(), {123})
        self.assertEqual(summary["operational_errors"], 1)
        run.assert_not_awaited()

    async def test_hidden_reference_never_enters_the_model_prompt(self):
        github = FakeGitHub()
        github.discussion = comments()
        case = reference(rationale="SECRET REFERENCE RATIONALE")
        data = self.directory / "dataset"
        await capture([case], data, github)
        findings = blind_findings(
            markdown="Insufficient evidence", verdict="needs investigation", confidence="low", basis="Blocked",
            counterevidence="Unknown", falsification="A product check", limitations=["Blocked"],
        )
        sdk = SDK(AsyncMock(), "gpt-6.1-sol", 30)
        with (
            patch.object(sdk, "run", new_callable=AsyncMock, return_value=findings.model_dump_json()) as run,
            patch("evaluate_issue_design.product_fingerprint", return_value="prepared"),
            patch("evaluate_issue_design.process", new_callable=AsyncMock, return_value=(0, "revision", "")),
        ):
            summary = await evaluate([case], data, self.directory / "result", sdk, AsyncMock(), {123})
        self.assertEqual(summary["operational_errors"], 0)
        prompt = run.call_args.args[1]
        self.assertNotIn("SECRET REFERENCE RATIONALE", prompt)
        self.assertNotIn("SECRET ANSWER", prompt)
        self.assertNotIn("/issues/123", prompt)
        self.assertEqual(run.call_args.kwargs["native_tools"], [])

    async def test_scratch_write_cannot_escape_or_create_executables(self):
        for file in (r"..\hidden.json", "probe.exe", str(ROOT / "hidden.py")):
            result = await self.tools.write_scratch(invocation({"file": file, "content": "not allowed"}))
            self.assertEqual(result.result_type, "failure")
        result = await self.tools.write_scratch(invocation({"file": "sample.py", "content": "x: int = 'wrong'\n"}))
        self.assertEqual(result.result_type, "success")

    async def test_native_reads_and_shell_are_denied(self):
        for request in (
            PermissionRequestRead(intention="read reference", path=str(ROOT / "build" / "automation" / "design_benchmark_cases.json")),
            PermissionRequestShell(
                intention="read hidden issue", full_command_text="gh issue view 11206",
                can_offer_session_approval=False, commands=[], has_write_file_redirection=False,
                possible_paths=[], possible_urls=[],
            ),
        ):
            self.assertIsInstance(self.tools.permission(request, {"session_id": "test"}), PermissionDecisionReject)

    async def test_github_other_hosts_queries_and_hidden_files_cannot_be_read(self):
        for location in (
            "https://github.com/microsoft/pyright/issues/11206",
            "https://raw.githubusercontent.com/microsoft/pyright/main/anything",
            "https://typing.python.org.evil.invalid/",
            "https://typing.python.org/en/latest/spec/?search=11206",
            r"build\automation\design_benchmark_cases.json",
            r"docs\..\build\automation\design_benchmark_cases.json",
        ):
            with patch("evaluate_issue_design.http.client.HTTPSConnection") as connection:
                result = await self.tools.read_reference(invocation({"location": location}))
            self.assertEqual(result.result_type, "failure")
            connection.assert_not_called()

    async def test_reference_mentioning_target_is_withheld(self):
        with patch.object(Path, "read_text", return_value="An answer in issues/11206"):
            result = await self.tools.read_reference(invocation({"location": r"docs\type-concepts.md"}))
        self.assertEqual(result.result_type, "failure")
        self.assertNotIn("11206", result.text_result_for_llm)

    async def test_large_references_are_accessible_through_bounded_searchable_pages(self):
        content = "Navigation\n" + "x" * 12000 + "\nActual relevant rule\n" + "\u03b1" * 8000
        with patch.object(Path, "read_text", return_value=content):
            first = await self.tools.read_reference(invocation({"location": r"docs\example.md"}))
        initial = json.loads(first.text_result_for_llm)
        self.assertEqual(initial["offset"], 0)
        self.assertIsNotNone(initial["next_offset"])
        with patch.object(Path, "read_text", side_effect=AssertionError("Reference should be frozen and cached")):
            found = await self.tools.read_reference(invocation({
                "location": r"docs\example.md", "find": "Actual relevant rule",
            }))
        page = json.loads(found.text_result_for_llm)
        self.assertIn("Actual relevant rule", page["content"])
        self.assertGreater(page["offset"], 10000)
        self.assertEqual(page["total_chars"], len(content))
        self.assertLessEqual(len(found.text_result_for_llm), 12000)
        continued = await self.tools.read_reference(invocation({
            "location": r"docs\example.md", "offset": page["next_offset"],
        }))
        self.assertEqual(json.loads(continued.text_result_for_llm)["offset"], page["next_offset"])

    async def test_product_hash_is_reused_only_when_file_metadata_is_unchanged(self):
        base = self.directory / "packages" / "pyright"
        (base / "dist").mkdir(parents=True)
        (base / "index.js").write_text("wrapper", encoding="utf-8")
        bundle = base / "dist" / "pyright.js"
        bundle.write_text("original", encoding="utf-8")
        with patch("evaluate_issue_design.ROOT", self.directory):
            original = product_fingerprint()
            with patch.object(Path, "read_bytes", side_effect=AssertionError("Unchanged bundles should not be reread")):
                self.assertEqual(product_fingerprint(), original)
            bundle.write_text("a different prepared bundle", encoding="utf-8")
            self.assertNotEqual(product_fingerprint(), original)

    async def test_oversized_reference_metadata_fails_without_a_pagination_loop(self):
        location = "https://typing.python.org/" + "\u03b1" * 2000
        self.tools.references[location] = "x"
        result = await self.tools.read_reference(invocation({"location": location}))
        self.assertEqual(result.result_type, "failure")
        self.assertIn("metadata exceeds", result.text_result_for_llm)

    async def test_python_execution_never_starts(self):
        with patch("review_issues.process", new_callable=AsyncMock) as run:
            result = await self.tools.run_check(invocation({"kind": "python"}))
        self.assertEqual(result.result_type, "failure")
        run.assert_not_awaited()

    async def test_resolved_report_cannot_invent_product_or_source_reads(self):
        from issue_review_models import Check, Source
        findings = blind_findings(
            markdown="Evidence", verdict="by design", confidence="high", basis="Rule",
            counterevidence="Control", falsification="Different result", limitations=[],
            checks=[Check(id="check", status="executed", command="node test", cwd="scratch", exit_code=1, observations="A diagnostic")],
            sources=[Source(id="spec", kind="typing_spec", location="https://typing.python.org/en/latest/spec/",
                            finding="Rule", applicability="Relevant")],
        )
        with self.assertRaises(AutomationError):
            validate_findings(findings, [])
        record = {"kind": "pyright", "command": "node test", "cwd": "scratch", "exit_code": 1,
                  "stdout": '{"version":"1.1.414","generalDiagnostics":[]}'}
        with self.assertRaises(AutomationError):
            validate_findings(findings, [record])
        validate_findings(findings, [
            record, {"tool": "read_reference", "location": "https://typing.python.org/en/latest/spec/", "content": "Rule"},
        ])

    async def test_blinded_report_cannot_fabricate_history_or_release_execution(self):
        findings = blind_findings(historical_searches=audit().historical_searches)
        record = {
            "kind": "pyright", "command": "node pyright.js", "cwd": "scratch", "exit_code": 1,
            "stdout": '{"version":"1.1.414","generalDiagnostics":[]}',
        }
        with self.assertRaisesRegex(AutomationError, "Historical searches"):
            validate_findings(findings, [record])
        findings = blind_findings()
        findings.claims[0].reproduction[0].status = "reproduced"
        findings.claims[0].reproduction[0].check_ids = ["check"]
        with self.assertRaisesRegex(AutomationError, "released-checker"):
            validate_findings(findings, [record])

    async def test_each_observed_claim_needs_its_own_actual_pyright_check(self):
        from issue_review_models import Check
        findings = blind_findings()
        findings.checks.append(Check(
            id="mypy", status="executed", command="mypy sample.py", cwd="scratch", exit_code=1,
            observations="Not a Pyright result",
        ))
        findings.claims[0].reproduction[2].check_ids = ["mypy"]
        records: list[JsonValue] = [
            {"kind": "pyright", "command": "node pyright.js", "cwd": "scratch", "exit_code": 1,
             "stdout": '{"version":"1.1.414","generalDiagnostics":[]}'},
            {"kind": "mypy", "command": "mypy sample.py", "cwd": "scratch", "exit_code": 1, "stdout": "An error"},
        ]
        with self.assertRaisesRegex(AutomationError, "actual source-CLI"):
            validate_findings(findings, records)

    async def test_sdk_custom_only_mode_exposes_no_builtin_tools_or_skills(self):
        profile = Agent.load(AGENTS / "pyright-issue-by-design-reviewer.md", "pyright-issue-by-design-reviewer")
        session = AsyncMock()
        session.session_id = "blind-test"
        session.rpc.agent.get_current.return_value = SimpleNamespace(agent=SimpleNamespace(name=profile.name))
        names = [tool.name for tool in self.tools.tools]
        session.rpc.tools.get_current_metadata.return_value = SimpleNamespace(tools=[SimpleNamespace(name=name) for name in names])
        session.send_and_wait.return_value = SimpleNamespace(data=AssistantMessageData(content="Findings", message_id="test"))
        client = AsyncMock()
        client.create_session.return_value = session
        await SDK(client, "gpt-6.1-sol", 30).run(profile, "Anonymous report", self.scratch, tools=self.tools, native_tools=[])
        configuration = client.create_session.call_args.kwargs
        self.assertEqual(configuration["available_tools"], names)
        self.assertFalse(configuration["enable_skills"])
        self.assertFalse(configuration["enable_config_discovery"])
        self.assertEqual(configuration["custom_agents"][0]["skills"], [])


if __name__ == "__main__":
    unittest.main()
