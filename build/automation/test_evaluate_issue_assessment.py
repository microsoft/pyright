# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

import json
import re
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock

from pydantic import TypeAdapter

from evaluate_issue_assessment import (
    AssessmentCandidate, CandidateExecution, CandidateObservation, CandidateScope, CheckerExecutionReceipt, ClaimMetricReview,
    FrozenAssessmentProtocol, HumanApproval, evaluate_candidates, load_candidates,
    make_protocol, save_frozen_candidates, score_candidates, validate_protocol,
    validate_frozen_implementation,
)
from issue_review_validity import PROFILE, content_hash, record_hash

ROOT = Path(__file__).resolve().parents[2]


def protocol(cases=None):
    cases = load_candidates() if cases is None else cases
    return make_protocol(
        cases, model="offline-test-only", sdk_version="offline-test",
        role_budget_seconds=180, implementation_files=[Path(__file__)], profiles=[PROFILE], normative_sources=[],
    )


def execution(case=None, frozen=None, **updates):
    case = load_candidates()[1] if case is None else case
    frozen = protocol([case]) if frozen is None else frozen
    return CandidateExecution.model_validate({
        "id": case.input.id, "input_sha256": record_hash(case.input), "protocol_sha256": record_hash(frozen),
        "status": "completed", "sdk_called": True, "actual_checker_executions": 0,
        "claims": [{
            "claim_id": claim.id, "disposition": case.judgment.claims[index].acceptable_dispositions[0],
            "status": case.judgment.claims[index].expected_status if case.judgment.claims[index].expected_status != "not_settled" else "qualified",
            "reasoning": "Offline constructed result; not an actual SDK observation",
            "evidence_ids": ["offline-fixture"], "information_requests": [],
            "limitations": ["Offline model/metric contract only"],
        } for index, claim in enumerate(case.input.claims)],
        "observations": [], "raw_sdk_usage": [],
        "usage_unavailable_reason": "Offline fixture, SDK was not actually called",
        "elapsed_seconds": 2.5, "error": None, "artifact_ids": ["offline-artifact"], **updates,
    })


def approved_test_copy(case):
    """This approval is used only inside isolated unit fixtures, never the candidate file."""
    return AssessmentCandidate.model_validate({
        **case.model_dump(), "reference_status": "human_reviewed",
        "approval": HumanApproval(
            reviewer="UNIT TEST FIXTURE ONLY", reviewed_at="2026-10-22T22:00:00Z",
            judgment_sha256=record_hash(case.judgment), input_sha256=record_hash(case.input),
        ),
    })


def checker_receipt(case, frozen, *, identifier="controller-original", provenance="controller_execution", role="original"):
    return CheckerExecutionReceipt.model_validate({
        "id": identifier, "input_sha256": record_hash(case.input), "protocol_sha256": record_hash(frozen),
        "claim_ids": [claim.id for claim in case.input.claims], "target": "main", "role": role,
        "provenance": provenance, "artifact_id": "offline-receipt-artifact",
        "sha256": content_hash("Explicit offline receipt fixture, not a real execution"),
    })


class CandidateReferenceTests(unittest.TestCase):
    def test_six_provisional_development_cases_keep_real_reports_separate_from_contracts(self):
        cases = load_candidates()
        self.assertEqual(len(cases), 6)
        self.assertEqual(sum(case.input.origin == "synthetic_contract" for case in cases), 4)
        self.assertEqual(sum(case.input.origin == "retained_report" for case in cases), 2)
        self.assertTrue(all(case.reference_status == "provisional" and case.approval is None for case in cases))
        self.assertTrue(all(case.split == "development" for case in cases))
        self.assertEqual({case.judgment.observation_pattern for case in cases[:4]}, {"not_executed"})
        self.assertEqual(cases[-2].judgment.observation_pattern, "historical_only_pattern")
        self.assertEqual(cases[-1].judgment.observation_pattern, "main_reproduced")
        for case in cases:
            if case.input.origin == "retained_report":
                self.assertTrue(all(claim.expected_status == "not_settled" for claim in case.judgment.claims))
                self.assertTrue(any(setting.provenance == "assumed" for setting in case.input.settings))

    def test_synthetic_reports_are_capture_ready_and_do_not_reveal_target_or_control_outcomes(self):
        for case in load_candidates()[:4]:
            blocks = re.findall(r"```(?:python|json)\n(.*?)```", case.input.report, re.DOTALL)
            self.assertEqual(set(blocks), {item.content for item in case.input.files})
            config = json.loads(next(item.content for item in case.input.files if item.role == "configuration"))
            self.assertEqual(set(config), {"pythonVersion", "typeCheckingMode"})
            for name, value in config.items():
                setting = next(item for item in case.input.settings if item.name == name)
                self.assertEqual((setting.value, setting.provenance), (value, "reported"))
                self.assertIn(value, case.input.report)
            for forbidden in ("do not execute", "suppose", "hypothetical", "main target", "historical target", "control run", "both-negative"):
                self.assertNotIn(forbidden, case.input.report.lower())
        negative = load_candidates()[2]
        self.assertIn('Type "Literal[1]" is not assignable to declared type "int" (reportAssignmentType)', negative.input.report)
        self.assertNotIn("affirmative", negative.input.model_dump_json().lower())

    def test_retained_exact_sources_and_assumed_configs_match_frozen_hashes(self):
        expected = {
            "case-retained-dataclass-callable": (
                "9eb22ae77913fc45318a63d086501dd497c3ffaa8bfcd707183ab0be4e4d8d5f",
                "3adae16cf3a45b91d850a95c34fa4827e90b15b39fce267fd8744705b63d872a", "strict",
            ),
            "case-retained-unpack-comprehension": (
                "67bda77d1aa389459a511f5dae76030ed42a3627668015c0af44b5ce17f4841d",
                "9ffd506fbe1a26721177c17b6a2d06764c96f72b3a21bf2bd640bf565131cbc7", "standard",
            ),
        }
        for case in load_candidates():
            if case.input.id not in expected:
                continue
            source_hash, config_hash, mode = expected[case.input.id]
            source, configuration = case.input.files
            self.assertEqual(source.sha256, source_hash)
            self.assertEqual(configuration.sha256, config_hash)
            self.assertIn(source.content.rstrip("\n"), case.input.report)
            setting = next(item for item in case.input.settings if item.name == "typeCheckingMode")
            self.assertEqual((setting.value, setting.provenance), (mode, "assumed"))

    def test_inputs_never_include_reference_answers_outcomes_or_solution_controls(self):
        for case in load_candidates():
            raw = case.input.model_dump_json()
            for hidden in (
                '"judgment"', '"reference_status"', '"approval"', '"acceptable_dispositions"',
                '"observation_pattern"', "historical_only_pattern", "saved_observation",
            ):
                self.assertNotIn(hidden, raw)
            self.assertTrue(all(file.role in {"original_source", "configuration"} for file in case.input.files))
            if case.input.origin == "retained_report":
                self.assertNotIn("github.com/microsoft/pyright/issues/", raw)

    def test_candidate_loader_rejects_duplicate_ids_and_family_split_leakage(self):
        first, second = load_candidates()[:2]
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "cases.json"
            for cases in ([first, first], [first, second.model_copy(update={"split": "holdout"})]):
                path.write_bytes(TypeAdapter(list[AssessmentCandidate]).dump_json(cases))
                with self.assertRaises(ValueError):
                    load_candidates(path)

    def test_human_review_requires_actual_record_bound_to_input_and_judgment(self):
        case = load_candidates()[0]
        raw = case.model_dump()
        raw["reference_status"] = "human_reviewed"
        with self.assertRaises(ValueError):
            AssessmentCandidate.model_validate(raw)
        approved = approved_test_copy(case)
        modified = approved.model_dump()
        modified["input"]["report"] = "Different report"
        with self.assertRaisesRegex(ValueError, "exact input and judgment"):
            AssessmentCandidate.model_validate(modified)
        self.assertEqual(case.reference_status, "provisional")

    def test_frozen_protocol_detects_input_reference_and_implementation_changes(self):
        cases = load_candidates()
        frozen = protocol(cases)
        validate_protocol(cases, frozen)
        changed = cases[0].model_copy(deep=True)
        changed.judgment.rationale = "Changed expected answer"
        with self.assertRaisesRegex(ValueError, "changed"):
            validate_protocol([changed, *cases[1:]], frozen)
        raw = frozen.model_dump()
        raw["candidate_inputs"].append(raw["candidate_inputs"][0])
        with self.assertRaises(ValueError):
            FrozenAssessmentProtocol.model_validate(raw)
        self.assertEqual(frozen.implementation[0].sha256, content_hash(Path(__file__).read_text(encoding="utf-8")))
        self.assertEqual(frozen.profiles[0].sha256, content_hash(PROFILE.read_text(encoding="utf-8")))

    def test_freeze_preserves_existing_runs_and_separates_hidden_references(self):
        cases = load_candidates()
        frozen = protocol(cases)
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary) / "frozen"
            save_frozen_candidates(cases, frozen, directory)
            first_input = (directory / "inputs" / f"{cases[0].input.id}.json").read_text()
            hidden = (directory / "references" / f"{cases[0].input.id}.json").read_text()
            self.assertNotIn("acceptable_dispositions", first_input)
            self.assertIn("acceptable_dispositions", hidden)
            with self.assertRaises(FileExistsError):
                save_frozen_candidates(cases, frozen, directory)

    def test_changed_implementation_cannot_run_under_a_frozen_protocol(self):
        cases = load_candidates()
        with tempfile.TemporaryDirectory() as temporary:
            implementation = Path(temporary) / "implementation.py"
            implementation.write_text("original", encoding="utf-8")
            frozen = make_protocol(
                cases, model="offline-only", sdk_version="offline-only", role_budget_seconds=180,
                implementation_files=[implementation], profiles=[PROFILE], normative_sources=[],
            )
            validate_frozen_implementation(frozen)
            implementation.write_text("changed", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "changed"):
                validate_frozen_implementation(frozen)

    def test_runtime_inputs_bind_exact_bytes_including_line_endings(self):
        with tempfile.TemporaryDirectory() as temporary:
            runtime = Path(temporary) / "targets.json"
            runtime.write_bytes(b"{}\n")
            frozen = make_protocol(
                load_candidates(), model="offline-only", sdk_version="offline-only", role_budget_seconds=180,
                implementation_files=[Path(__file__)], profiles=[PROFILE], normative_sources=[],
                runtime_files=[runtime],
            )
            validate_frozen_implementation(frozen)
            runtime.write_bytes(b"{}\r\n")
            with self.assertRaisesRegex(ValueError, "runtime input changed"):
                validate_frozen_implementation(frozen)


class CandidateMetricTests(unittest.TestCase):
    def test_inconclusive_reference_alternative_is_conditioned_on_no_verified_reproduction(self):
        case = load_candidates()[0]
        frozen = protocol([case])
        base = execution(case, frozen)
        findings = [{
            **item.model_dump(), "disposition": "inconclusive", "status": "inconclusive",
            "information_requests": ["Obtain report-faithful execution and effective environment provenance"],
        } for item in base.claims]
        row = execution(case, frozen, claims=findings)
        self.assertEqual(score_candidates([case], [row], frozen)["reference_agreements"], 1)
        receipt = checker_receipt(case, frozen)
        reproduced = execution(
            case, frozen, claims=findings, checker_receipts=[receipt], actual_checker_executions=1,
            artifact_ids=[receipt.artifact_id], observations=[{
                "claim_id": case.input.claims[0].id, "target": "main", "status": "reproduced",
                "qualification": "verified", "original_receipt_ids": [receipt.id],
                "affirmative_control_receipt_ids": [], "limitations": [],
            }],
        )
        self.assertEqual(score_candidates([case], [reproduced], frozen)["reference_agreements"], 0)
        self.assertEqual(case.reference_status, "provisional")
        self.assertIsNone(case.approval)

    def test_inline_original_precision_can_qualify_absence_but_not_by_receipt_name_alone(self):
        case = load_candidates()[1]
        frozen = protocol([case])
        original = checker_receipt(case, frozen).model_copy(update={"original_precision_verified": True})
        row = execution(
            case, frozen, checker_receipts=[original], actual_checker_executions=1,
            artifact_ids=[original.artifact_id],
            observations=[{
                "claim_id": case.input.claims[0].id, "target": "main", "status": "absent",
                "qualification": "verified", "original_receipt_ids": [original.id],
                "affirmative_control_receipt_ids": [],
                "affirmative_original_precision_receipt_ids": [original.id], "limitations": [],
            }],
        )
        self.assertEqual(score_candidates([case], [row], frozen)["verified_target_observations"], 1)
        raw = row.model_dump()
        raw["checker_receipts"][0]["original_precision_verified"] = False
        with self.assertRaisesRegex(ValueError, "Inline precision"):
            CandidateExecution.model_validate(raw)
        raw["checker_receipts"][0]["role"] = "discovery"
        raw["checker_receipts"][0]["original_precision_verified"] = True
        with self.assertRaisesRegex(ValueError, "Inline precision"):
            CandidateExecution.model_validate(raw)

    def test_completed_partial_assessment_retains_individual_phase_failures(self):
        case = load_candidates()[1]
        frozen = protocol([case])
        row = execution(case, frozen, phase_failures=["Offline fixture: one refinement timed out"])
        summary = score_candidates([case], [row], frozen)
        self.assertEqual(summary["completed"], 1)
        self.assertEqual(summary["cases_with_phase_failures"], 1)
        self.assertEqual(summary["phase_failures"], 1)

    def test_discovery_counts_execution_but_cannot_replace_verification(self):
        case = load_candidates()[1]
        frozen = protocol([case])
        receipt = checker_receipt(case, frozen, role="discovery")
        row = execution(
            case, frozen, checker_receipts=[receipt], actual_checker_executions=1,
            artifact_ids=[receipt.artifact_id],
        )
        summary = score_candidates([case], [row], frozen)
        self.assertEqual(summary["actual_checker_executions"], 1)
        self.assertEqual(summary["verified_target_observations"], 0)
        with self.assertRaisesRegex(ValueError, "original/control receipts"):
            CandidateExecution.model_validate({
                **row.model_dump(),
                "observations": [{
                    "claim_id": case.input.claims[0].id, "target": "main", "status": "reproduced",
                    "qualification": "verified", "original_receipt_ids": [receipt.id],
                    "affirmative_control_receipt_ids": [], "limitations": [],
                }],
            })

    def test_confirmed_receipts_survive_an_unknown_total(self):
        case = load_candidates()[1]
        frozen = protocol([case])
        receipt = checker_receipt(case, frozen)
        row = execution(
            case, frozen, checker_receipts=[receipt], actual_checker_executions=None,
            artifact_ids=[receipt.artifact_id],
        )
        summary = score_candidates([case], [row], frozen)
        self.assertEqual(summary["actual_checker_executions"], 1)
        self.assertEqual(summary["unknown_checker_execution_cases"], 1)
        self.assertTrue(summary["checker_counts_are_confirmed_lower_bounds"])

    def test_zero_execution_has_no_passing_or_vacuous_score(self):
        cases = load_candidates()
        summary = score_candidates(cases, [], protocol(cases))
        self.assertEqual(summary["sdk_executed_cases"], 0)
        self.assertEqual(summary["actual_checker_executions"], 0)
        self.assertIsNone(summary["reference_agreement_rate"])
        self.assertIsNone(summary["false_by_design_rate"])
        self.assertIsNone(summary["passing_score"])
        self.assertFalse(summary["execution_complete"])
        missing = summary["missing_cases"]
        assert isinstance(missing, list)
        self.assertEqual(len(missing), 6)

    def test_correct_and_incorrect_design_are_claim_level_reference_agreement_only(self):
        cases = load_candidates()[:2]
        frozen = protocol(cases)
        first = execution(cases[0], frozen)
        wrong = first.model_copy(deep=True)
        wrong.claims[0].disposition = "as_designed"
        wrong.claims[0].status = "supported"
        correct = execution(cases[1], frozen)
        summary = score_candidates(cases, [wrong, correct], frozen)
        self.assertEqual(summary["correct_by_design"], 1)
        self.assertEqual(summary["incorrect_by_design"], 1)
        self.assertEqual(summary["false_by_design_rate"], 0.5)
        self.assertEqual(summary["actual_checker_executions"], 0)
        self.assertEqual(summary["human_reviewed_references"], 0)
        interpretation = summary["interpretation"]
        assert isinstance(interpretation, str)
        self.assertIn("not general accuracy", interpretation)

    def test_real_unsettled_semantics_are_not_hidden_gold_or_wrong_design_labels(self):
        case = load_candidates()[-1]
        frozen = protocol([case])
        row = execution(case, frozen)
        row.claims[0].disposition = "as_designed"
        row.claims[0].status = "supported"
        summary = score_candidates([case], [row], frozen)
        self.assertEqual(summary["scored_claims"], 0)
        self.assertEqual(summary["incorrect_by_design"], 0)
        self.assertIsNone(summary["false_by_design_rate"])

    def test_useful_information_is_human_reviewed_not_nonempty_text_keyword_scoring(self):
        case = load_candidates()[3]
        frozen = protocol([case])
        row = execution(case, frozen)
        row.claims[0].information_requests = ["Tell me something irrelevant"]
        summary = score_candidates([case], [row], frozen)
        self.assertEqual(summary["needs_info_with_requests"], 1)
        self.assertEqual(summary["useful_needs_info"], 0)
        self.assertEqual(summary["unscored_needs_info"], 1)
        review = ClaimMetricReview(
            case_id=case.input.id, claim_id=case.input.claims[0].id,
            classification="useful_needs_info", reviewer="UNIT TEST ONLY",
            rationale="In this isolated test the human utility judgment is represented explicitly",
            status="human_reviewed",
        )
        summary = score_candidates([case], [row], frozen, [review])
        self.assertEqual(summary["useful_needs_info"], 1)
        self.assertEqual(summary["unscored_needs_info"], 0)
        with self.assertRaises(ValueError):
            score_candidates([case], [row], frozen, [review, review])

    def test_potential_abstention_is_not_declared_unnecessary_without_human_judgment(self):
        case = load_candidates()[1]
        frozen = protocol([case])
        row = execution(case, frozen)
        row.claims[0].disposition = "inconclusive"
        row.claims[0].status = "inconclusive"
        summary = score_candidates([case], [row], frozen)
        self.assertEqual(summary["potentially_unnecessary_abstention"], 1)
        self.assertEqual(summary["unnecessary_abstention"], 0)

    def test_failures_timeouts_invalid_records_and_missing_cases_are_separate(self):
        cases = load_candidates()
        frozen = protocol(cases)
        rows = [
            execution(case, frozen, status=status, sdk_called=None, actual_checker_executions=None,
                      claims=[], error="Explicit offline failure")
            for case, status in zip(cases[:3], ("timeout", "operational_failure", "invalid_record"))
        ]
        summary = score_candidates(cases, rows, frozen)
        self.assertEqual(summary["timeouts"], 1)
        self.assertEqual(summary["operational_failures"], 1)
        self.assertEqual(summary["invalid_records"], 1)
        self.assertEqual(summary["unknown_sdk_execution_cases"], 3)
        self.assertEqual(summary["unknown_checker_execution_cases"], 3)
        self.assertEqual(summary["completed"], 0)
        missing = summary["missing_cases"]
        assert isinstance(missing, list)
        self.assertEqual(len(missing), 3)

    def test_hypothetical_patterns_never_increment_actual_checker_coverage(self):
        case = load_candidates()[2]
        frozen = protocol([case])
        row = execution(case, frozen)
        row.observations = [
            CandidateObservation(
                claim_id="reported-diagnostic", target=target, status="absent", qualification="synthetic_contract",
                original_receipt_ids=[f"synthetic-{target}"], affirmative_control_receipt_ids=[f"synthetic-control-{target}"],
                limitations=["Hypothetical, not execution"],
            ) for target in ("historical", "main")
        ]
        summary = score_candidates([case], [row], frozen)
        self.assertEqual(summary["synthetic_target_observations"], 2)
        self.assertEqual(summary["verified_target_observations"], 0)
        row.actual_checker_executions = 1
        with self.assertRaisesRegex(ValueError, "controller receipt ledger"):
            score_candidates([case], [row], frozen)

    def test_assumed_settings_are_counted_separately_from_verified_target_observations(self):
        case = load_candidates()[-1]
        frozen = protocol([case])
        row = execution(
            case, frozen, actual_checker_executions=1, checker_receipts=[checker_receipt(case, frozen)],
            artifact_ids=["offline-artifact", "offline-receipt-artifact"],
        )
        row.observations = [CandidateObservation(
            claim_id=case.input.claims[0].id, target="main", status="reproduced", qualification="assumed_settings",
            original_receipt_ids=["controller-original"], affirmative_control_receipt_ids=[],
            limitations=["Standard mode assumed"],
        )]
        summary = score_candidates([case], [row], frozen)
        self.assertEqual(summary["assumed_target_observations"], 1)
        self.assertEqual(summary["verified_target_observations"], 0)
        self.assertEqual(summary["checker_executed_cases"], 1)
        self.assertEqual(summary["retained_report_actual_checker_executions"], 1)
        self.assertEqual(summary["synthetic_input_actual_checker_executions"], 0)

    def test_fresh_controller_facts_on_synthetic_source_are_real_coverage_not_public_issue_coverage(self):
        case = load_candidates()[0]
        frozen = protocol([case])
        row = execution(
            case, frozen, actual_checker_executions=1, checker_receipts=[checker_receipt(case, frozen)],
            artifact_ids=["offline-artifact", "offline-receipt-artifact"],
            observations=[{
                "claim_id": case.input.claims[0].id, "target": "main", "status": "reproduced",
                "qualification": "verified", "original_receipt_ids": ["controller-original"],
                "affirmative_control_receipt_ids": [], "limitations": ["Offline actual-runner contract fixture"],
            }],
        )
        summary = score_candidates([case], [row], frozen)
        self.assertEqual(summary["actual_checker_executions"], 1)
        self.assertEqual(summary["synthetic_input_actual_checker_executions"], 1)
        self.assertEqual(summary["synthetic_input_verified_target_observations"], 1)
        self.assertEqual(summary["retained_report_actual_checker_executions"], 0)
        self.assertEqual(summary["synthetic_target_observations"], 0)

    def test_invented_hypothetical_stale_or_mismatched_receipts_cannot_be_promoted_to_real_facts(self):
        case = load_candidates()[0]
        frozen = protocol([case])
        observed = {
            "claim_id": case.input.claims[0].id, "target": "main", "status": "reproduced",
            "qualification": "verified", "original_receipt_ids": ["controller-original"],
            "affirmative_control_receipt_ids": [], "limitations": [],
        }
        for updates in (
            {"observations": [observed]},
            {"actual_checker_executions": 1, "checker_receipts": [checker_receipt(case, frozen, provenance="synthetic_contract")]},
            {"checker_receipts": [checker_receipt(case, frozen, provenance="synthetic_contract")], "observations": [observed]},
            {"actual_checker_executions": 1, "checker_receipts": [checker_receipt(case, frozen).model_copy(update={"protocol_sha256": "0" * 64})]},
            {"actual_checker_executions": 1, "checker_receipts": [checker_receipt(case, frozen, role="control")],
             "observations": [observed], "artifact_ids": ["offline-receipt-artifact"]},
        ):
            with self.subTest(updates=updates), self.assertRaises(ValueError):
                execution(case, frozen, **updates)

    def test_negative_observation_needs_positive_control_and_cannot_use_unobserved_qualifier(self):
        for qualification, controls in (("verified", []), ("unobserved", ["control"])):
            with self.subTest(qualification=qualification), self.assertRaises(ValueError):
                CandidateObservation.model_validate({
                    "claim_id": "claim", "target": "main", "status": "absent", "qualification": qualification,
                    "original_receipt_ids": ["original"], "affirmative_control_receipt_ids": controls, "limitations": [],
                })

    def test_unknown_duplicate_missing_claims_and_frozen_hash_mismatches_are_rejected(self):
        case = load_candidates()[1]
        frozen = protocol([case])
        row = execution(case, frozen)
        for updates in (
            {"id": "case-unknown"}, {"input_sha256": "0" * 64}, {"protocol_sha256": "0" * 64},
            {"claims": []}, {"claims": row.claims * 2},
        ):
            with self.subTest(updates=updates), self.assertRaises(ValueError):
                score_candidates([case], [row.model_copy(update=updates)], frozen)
        with self.assertRaises(ValueError):
            score_candidates([case], [row, row], frozen)

    def test_raw_usage_and_latency_are_retained_without_dollar_or_zero_conversion(self):
        case = load_candidates()[1]
        frozen = protocol([case])
        row = execution(case, frozen, raw_sdk_usage=[
            {"event_id": "usage-1", "name": "input_tokens", "value": 123.0, "unit": "tokens"},
            {"event_id": "usage-1", "name": "cost", "value": 0.42, "unit": "provider_credits"},
        ], usage_unavailable_reason=None)
        summary = score_candidates([case], [row], frozen)
        self.assertEqual(summary["latency_seconds"], [2.5])
        rows = summary["results"]
        assert isinstance(rows, list) and isinstance(rows[0], dict)
        self.assertEqual(rows[0]["raw_sdk_usage"], row.model_dump()["raw_sdk_usage"])
        self.assertTrue(summary["raw_usage_is_unconverted"])

    def test_additional_discovered_claims_are_retained_unscored_and_require_reference_review(self):
        case = load_candidates()[1]
        frozen = protocol([case])
        row = execution(case, frozen)
        extra = row.claims[0].model_copy(update={"claim_id": "new-material-claim"})
        row.claims.append(extra)
        row.additional_claims = [CandidateScope(id="new-material-claim", summary="Additional independently discovered scope")]
        row = CandidateExecution.model_validate_json(row.model_dump_json())
        summary = score_candidates([case], [row], frozen)
        self.assertEqual(summary["scored_claims"], 1)
        self.assertEqual(summary["unreferenced_additional_claims"], 1)
        self.assertTrue(summary["additional_claim_review_required"])
        self.assertTrue(summary["execution_complete"])
        self.assertFalse(summary["reference_scope_complete"])
        with self.assertRaises(ValueError):
            score_candidates([case], [row.model_copy(update={"additional_claims": []})], frozen)
        with self.assertRaisesRegex(ValueError, "replace or relabel"):
            score_candidates([case], [execution(case, frozen, additional_claims=[{"id": "assignment", "summary": "Wrong identity reuse"}])], frozen)


class OfflineEvaluationTests(unittest.IsolatedAsyncioTestCase):
    async def test_provisional_cohort_cannot_start_sdk_or_create_run(self):
        cases = load_candidates()
        runner = AsyncMock()
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "run"
            with self.assertRaisesRegex(ValueError, "Human reference review"):
                await evaluate_candidates(cases, protocol(cases), runner, output)
            runner.run.assert_not_awaited()
            self.assertFalse(output.exists())

    async def test_runner_receives_only_input_and_frozen_protocol_not_expected_answers(self):
        cases = [approved_test_copy(load_candidates()[1])]
        frozen = protocol(cases)
        runner = AsyncMock()
        runner.run.return_value = execution(cases[0], frozen)
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "run"
            summary = await evaluate_candidates(cases, frozen, runner, output)
            self.assertEqual(summary["completed"], 1)
            sent_input, sent_protocol = runner.run.call_args.args
            self.assertNotIn("acceptable_dispositions", sent_input.model_dump_json())
            self.assertNotIn("acceptable_dispositions", sent_protocol.model_dump_json())
            self.assertEqual(len(list(output.glob("case-*.json"))), 1)

    async def test_invalid_response_preserved_without_selective_retry_and_later_cases_not_hidden(self):
        cases = [approved_test_copy(case) for case in load_candidates()[:2]]
        frozen = protocol(cases)
        runner = AsyncMock()
        invalid = execution(cases[0], frozen, input_sha256="0" * 64)
        runner.run.side_effect = [invalid, execution(cases[1], frozen)]
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "run"
            summary = await evaluate_candidates(cases, frozen, runner, output)
            self.assertEqual(summary["invalid_records"], 1)
            self.assertEqual(summary["completed"], 1)
            self.assertEqual(runner.run.await_count, 2)
            self.assertTrue((output / f"{cases[0].input.id}.invalid-response.json").exists())
            self.assertFalse(summary["execution_complete"])

    async def test_timeout_has_unknown_coverage_not_fabricated_zero_execution(self):
        cases = [approved_test_copy(load_candidates()[1])]
        frozen = protocol(cases)
        runner = AsyncMock()
        runner.run.side_effect = TimeoutError("Role exhausted its shared 180s")
        with tempfile.TemporaryDirectory() as temporary:
            summary = await evaluate_candidates(cases, frozen, runner, Path(temporary) / "run")
        self.assertEqual(summary["timeouts"], 1)
        self.assertEqual(summary["unknown_sdk_execution_cases"], 1)
        self.assertEqual(runner.run.await_count, 1)

    async def test_integrated_runner_can_return_real_receipt_bound_execution_for_synthetic_input(self):
        cases = [approved_test_copy(load_candidates()[0])]
        frozen = protocol(cases)
        runner = AsyncMock()
        runner.run.return_value = execution(
            cases[0], frozen, actual_checker_executions=1,
            checker_receipts=[checker_receipt(cases[0], frozen)],
            artifact_ids=["offline-receipt-artifact"],
        )
        with tempfile.TemporaryDirectory() as temporary:
            summary = await evaluate_candidates(cases, frozen, runner, Path(temporary) / "run")
        self.assertEqual(summary["completed"], 1)
        self.assertEqual(summary["invalid_records"], 0)
        self.assertEqual(summary["synthetic_input_actual_checker_executions"], 1)
        self.assertEqual(summary["retained_report_actual_checker_executions"], 0)


if __name__ == "__main__":
    unittest.main()
