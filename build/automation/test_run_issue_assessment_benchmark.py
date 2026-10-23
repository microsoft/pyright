# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

"""Offline adapter checks; constructed ledgers are never real execution evidence."""

import importlib.metadata
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from evaluate_issue_assessment import (
    AssessmentCandidate, CandidateFile, CandidateInput, CandidateScope, load_candidates, make_protocol, score_candidates,
)
from issue_review_assessment import capture_report
from issue_review_assessment_models import AssessmentDraft, AssessmentReceipt
from issue_review_models import ReproductionTarget
from issue_review_sources import SourceAssociation, materialize_setup
from issue_review_reproduction import TargetStore
from issue_review_validity import PROFILE, ValidityAssessment, ValidityEvidence, ValidityInput, content_hash, record_hash
from run_issue_assessment_benchmark import (
    FrozenTargetAssignment, ProductionAssessmentRunner, arguments, candidate_snapshot, execution_ledger,
    implementation_files, main, profile_files, scoped_sources,
)
from review_issues import SDK, GitHub
from test_issue_review_assessment import body, draft_for, output, targets as fixture_targets
from test_issue_review_validity import claim as fixture_claim


def protocol():
    return make_protocol(
        load_candidates(), model="OFFLINE TEST ONLY",
        sdk_version=importlib.metadata.version("github-copilot-sdk"), role_budget_seconds=180,
        implementation_files=[Path(__file__)], profiles=[PROFILE], normative_sources=[],
    )


def assignment(report):
    return FrozenTargetAssignment(
        input_sha256=record_hash(report), provenance="OFFLINE TEST ONLY; targets are not verified or executed",
        targets=[
            ReproductionTarget(
                role=role, identity="offline-" + role, version="1.1.414", source="offline fixture",
                selection_reason="Offline target mapping contract; not a real trusted target",
            ) for role in ("historical", "main", "latest")
        ],
    )


class SnapshotTests(unittest.TestCase):
    def test_all_six_snapshots_recapture_exact_originals_without_reference_identity(self):
        frozen = protocol()
        for case in load_candidates():
            with self.subTest(case=case.input.id):
                snapshot = candidate_snapshot(case.input, frozen, assignment(case.input), [])
                self.assertNotIn(case.input.id, snapshot.report_id)
                self.assertNotIn(case.input.id, snapshot.provenance)
                self.assertEqual(snapshot.issue.body, case.input.report)
                self.assertEqual(snapshot.issue.number, 0)
                self.assertIsNone(snapshot.issue.created_at)
                self.assertEqual(snapshot.issue.updated_at, "not-provided-in-frozen-input")
                self.assertTrue(snapshot.blind)
                capture = capture_report(snapshot.issue, [], report_id=snapshot.report_id)
                associations = []
                for file in case.input.files:
                    if file.role == "original_source":
                        matching = [block for block in capture.blocks if block.canonical_sha256 == file.sha256]
                        self.assertEqual(len(matching), 1)
                        associations.append(SourceAssociation(source_id=matching[0].id, path=file.path))
                setup = materialize_setup(capture, associations, snapshot.setting_choices)
                self.assertFalse(setup.blockers, setup.blockers)
                self.assertEqual(
                    {name: content_hash(content) for name, content in setup.files.items()},
                    snapshot.expected_original_hashes,
                )
                self.assertEqual(
                    {choice.setting for choice in snapshot.setting_choices},
                    {item.name for item in case.input.settings if item.provenance == "assumed"},
                )

    def test_wrong_input_target_binding_is_refused(self):
        report = load_candidates()[0].input
        wrong = assignment(load_candidates()[1].input)
        with self.assertRaisesRegex(ValueError, "different candidate input"):
            candidate_snapshot(report, protocol(), wrong, [])

    def test_normative_scope_projection_preserves_saved_content_and_excludes_unknown_claims(self):
        report = load_candidates()[0].input
        original = ValidityEvidence(
            id="offline-source", kind="typing_spec", provenance="synthetic_fixture",
            location="https://typing.python.org/en/latest/spec/annotations.html", section="Offline fixture",
            content="Offline fixture, not a retrieved quotation", sha256=content_hash("Offline fixture, not a retrieved quotation"),
            claim_ids=[report.claims[0].id, "unrelated-claim"], source_id=None, setup_id=None,
            target="not_applicable", observation="not_applicable", version=None,
            retrieved_at="2026-10-22T00:00:00Z",
        )
        projected = scoped_sources(report, [original])
        self.assertEqual(projected[0].claim_ids, [report.claims[0].id])
        self.assertEqual(projected[0].sha256, original.sha256)
        self.assertEqual(projected[0].content, original.content)
        self.assertEqual(original.claim_ids, [report.claims[0].id, "unrelated-claim"])


class ExecutionLedgerTests(unittest.TestCase):
    def test_discovery_and_raw_usage_are_separate_from_verification_and_dollar_cost(self):
        report = load_candidates()[0].input
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            discovery = directory / "discovery-assignment"
            discovery.mkdir()
            fixture = AssessmentReceipt(
                id="offline-discovery", kind="discovery", policy_hash="offline", plan_hash="offline",
                claim_id=report.claims[0].id, problems=[], observation="captured",
                raw={
                    "target": assignment(report).targets[0].model_dump(mode="json"), "exit_code": 0,
                    "command": "OFFLINE FIXTURE; never executed", "cwd": temporary,
                    "stdout": "{}", "stderr": "", "input_hash": "offline-inputs",
                },
            )
            (discovery / "receipt.json").write_text(fixture.model_dump_json(), encoding="utf-8")
            role = directory / "roles" / "readiness"
            role.mkdir(parents=True)
            (role / "sdk-events.jsonl").write_text(json.dumps({
                "at": "2026-10-22T00:00:00Z", "type": "assistant.usage",
                "data": {"event_id": "offline-event", "input_tokens": 19, "max_prompt_tokens": 1024, "cost": 0.2},
            }) + "\n", encoding="utf-8")
            receipts, total, sdk_called, usage, artifacts = execution_ledger(directory, report, protocol())
            self.assertEqual(total, 1)
            self.assertTrue(sdk_called)
            self.assertEqual(receipts[0].role, "discovery")
            self.assertIn(receipts[0].artifact_id, artifacts)
            self.assertEqual(
                {item.name: item.unit for item in usage},
                {"input_tokens": "tokens", "max_prompt_tokens": "token_capacity", "cost": "sdk_reported_cost_units"},
            )
            blocked = directory / "verification-assignment"
            blocked.mkdir()
            unfinished = fixture.model_copy(update={
                "id": "offline-unfinished", "kind": "verification_original", "observation": "blocked",
                "raw": {"error": "Offline fixture: process completion is unknown"},
            })
            (blocked / "original-main-receipt.json").write_text(unfinished.model_dump_json(), encoding="utf-8")
            receipts, total, _, _, _ = execution_ledger(directory, report, protocol())
            self.assertIsNone(total)
            self.assertEqual(len(receipts), 1)

    def test_no_recorded_sdk_or_checker_activity_is_not_filled_with_usage(self):
        with tempfile.TemporaryDirectory() as temporary:
            receipts, total, sdk_called, usage, _ = execution_ledger(
                Path(temporary), load_candidates()[0].input, protocol(),
            )
            self.assertEqual(receipts, [])
            self.assertEqual(total, 0)
            self.assertFalse(sdk_called)
            self.assertEqual(usage, [])


class CLIGuardTests(unittest.IsolatedAsyncioTestCase):
    async def test_provisional_references_block_before_any_sdk_screening_or_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            targets = root / "targets.json"
            sources = root / "sources.json"
            targets.write_text(json.dumps([assignment(case.input).model_dump(mode="json") for case in load_candidates()]), encoding="utf-8")
            sources.write_text("[]", encoding="utf-8")
            frozen = root / "frozen"
            await main(arguments(["freeze", "--targets", str(targets), "--sources", str(sources), "--output", str(frozen)]))
            output = root / "not-created"
            args = arguments([
                "run", "--targets", str(targets), "--sources", str(sources), "--output", str(output),
                "--protocol", str(frozen / "protocol.json"), "--target-cache", str(root / "absent-cache"),
                "--cli-path", "OFFLINE FIXTURE; must not launch",
            ])
            with (
                patch("run_issue_assessment_benchmark.CopilotClient") as client,
                patch("run_issue_assessment_benchmark.InjectionScreening.from_environment") as screening,
            ):
                with self.assertRaisesRegex(ValueError, "Human reference review is pending"):
                    await main(args)
                client.assert_not_called()
                screening.assert_not_called()
            self.assertFalse(output.exists())


class ProductionPipelineTests(unittest.IsolatedAsyncioTestCase):
    async def exercise_pipeline(self, *, blocked_validity):
        report_body = body()
        source = "value = 1\nreveal_type(value)\nresult: int = value\n"
        report = CandidateInput(
            id="case-offline-adapter", origin="synthetic_contract", report=report_body,
            files=[CandidateFile(path="sample.py", content=source, sha256=content_hash(source), role="original_source")],
            settings=[], claims=[CandidateScope(id="assignment", summary="The checker reports Unsupported rejection.")],
            limitations=["OFFLINE TEST ONLY: model and checker transports are mocked"],
        )
        case = AssessmentCandidate.model_validate({**load_candidates()[0].model_dump(), "input": report})
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            selected = fixture_targets(root / "fake-targets")
            manifest, sources = root / "targets.json", root / "sources.json"
            manifest.write_text(json.dumps([FrozenTargetAssignment(
                input_sha256=record_hash(report), provenance="OFFLINE TEST ONLY; no real targets",
                targets=selected,
            ).model_dump(mode="json")]), encoding="utf-8")
            sources.write_text("[]", encoding="utf-8")
            frozen = make_protocol(
                [case], model="OFFLINE TEST ONLY", sdk_version=importlib.metadata.version("github-copilot-sdk"),
                role_budget_seconds=180, implementation_files=implementation_files(), profiles=profile_files(),
                normative_sources=[], runtime_files=[manifest, sources],
            )
            calls = []

            async def mocked_process(command, cwd):
                calls.append((command, cwd))
                target = next(item for item in selected if item.cli == command[1])
                return output(cwd, target.version, broken=target.role == "historical")

            store = TargetStore(root / "fake-cache", mocked_process)
            store.verify = lambda target: None  # Explicitly offline; never authenticates a real checker.
            github, sdk = GitHub(), SDK(AsyncMock(), frozen.model, 180)

            async def mocked_model(agent, prompt, scratch, *, schema, validate, native_tools, **_kwargs):
                self.assertEqual(native_tools, [])
                (scratch / "sdk-events.jsonl").write_text(json.dumps({
                    "at": "2026-10-22T00:00:00Z", "type": "controller.lifecycle",
                    "data": {"phase": "session_create", "fixture": "OFFLINE TEST; SDK not actually called"},
                }) + "\n", encoding="utf-8")
                if schema is AssessmentDraft:
                    snapshot = candidate_snapshot(report, frozen, FrozenTargetAssignment(
                        input_sha256=record_hash(report), provenance="Offline fixture", targets=selected,
                    ), [])
                    capture = capture_report(snapshot.issue, [], report_id=snapshot.report_id)
                    raw = draft_for(capture, unsupported=True).model_dump_json()
                else:
                    self.assertIs(schema, ValidityAssessment)
                    if blocked_validity:
                        raise TimeoutError("OFFLINE TEST: validity transport timed out")
                    inputs = ValidityInput.model_validate_json((scratch / "input.json").read_bytes())
                    raw = ValidityAssessment(
                        schema_version=1, input_sha256=record_hash(inputs), limitations=["Offline fixture only"],
                        claims=[fixture_claim(
                            claim_id=item.id, source_id=item.source_id, setup_id=item.setup_id,
                            disposition="inconclusive", status="inconclusive", basis="insufficient",
                            scope="Offline fixture claim " + item.id, rules=[], precedents=[],
                            reasoning="Offline transport tests controller integration, not semantic truth",
                            evidence_ids=item.evidence_ids, counterevidence_status="unresolved",
                            assumptions=item.assumptions, limitations=[*item.limitations, "Offline fixture only"],
                            information_requests=[{
                                "requested": "Applicable normative evidence", "reason": "No real research in this fixture",
                                "distinguishes": "Mandatory typing rules versus implementation policy",
                            }],
                        ) for item in inputs.claims],
                    ).model_dump_json()
                validate(raw)
                return raw

            with (
                patch.object(github, "screen", AsyncMock()),
                patch.object(github, "api", AsyncMock(side_effect=AssertionError("No live lookup"))),
                patch.object(github, "issue", AsyncMock(side_effect=AssertionError("No live issue"))),
                patch.object(github, "comments", AsyncMock(side_effect=AssertionError("No live comments"))),
                patch.object(sdk, "run", side_effect=mocked_model),
            ):
                row = await ProductionAssessmentRunner(
                    github, sdk, store, root / "run", manifest, sources,
                ).run(report, frozen)
            self.assertEqual(len(calls), 3)
            self.assertEqual(row.actual_checker_executions, 3)
            self.assertTrue(all(item.role == "original" and item.original_precision_verified for item in row.checker_receipts))
            self.assertEqual(sum(item.status == "absent" for item in row.observations), 2)
            self.assertEqual([item.id for item in row.additional_claims], ["editor"])
            self.assertFalse(score_candidates([case], [row], frozen)["reference_scope_complete"])
            if blocked_validity:
                self.assertEqual(row.status, "operational_failure")
                self.assertEqual(row.claims, [])
                self.assertTrue(row.phase_failures)
                assert row.error is not None
                self.assertIn("validity transport timed out", row.error)
            else:
                self.assertEqual(row.status, "completed")
                self.assertEqual({item.claim_id for item in row.claims}, {"assignment", "editor"})

    async def test_actual_controller_with_mocked_transports_preserves_inline_precision_and_additional_claims(self):
        await self.exercise_pipeline(blocked_validity=False)

    async def test_blocked_validity_keeps_successful_checker_receipts_and_explicit_phase_failure(self):
        await self.exercise_pipeline(blocked_validity=True)


if __name__ == "__main__":
    unittest.main()
