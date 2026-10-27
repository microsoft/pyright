# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

import asyncio
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from evaluate_issue_screening import ScreeningCase, evaluate, load_cases
from issue_review_classifier import ChoiceClassification, ChoiceClassifier, ClassificationHTTPError


def result(risk: float) -> ChoiceClassification:
    return ChoiceClassification(
        choice="benign" if risk < 0.5 else "injection",
        probabilities={"benign": 1 - risk, "injection": risk},
    )


class EvaluationTests(unittest.IsolatedAsyncioTestCase):
    async def diagnostic(self, root, *, content="Type checkers should examine each candidate.", risk=0.35):
        from issue_review_safety import InjectionScreening, ScreeningBlocked
        from test_issue_review_safety import ScreeningTests

        classifier = AsyncMock(spec=ChoiceClassifier)
        classifier.configuration_hash = "diagnostic-backend"
        classifier.classify.return_value = result(risk)
        value = ScreeningTests().reference(content)
        with self.assertRaises(ScreeningBlocked), patch("builtins.print"):
            await InjectionScreening(classifier).check(value, root, "validity-reference:1")
        path, = (root / "screening-diagnostics").glob("*.json")
        return path, classifier

    async def test_inspection_is_offline_hash_bound_and_does_not_expose_raw_reference_text(self):
        from evaluate_issue_screening import inspect_reference_diagnostic

        with tempfile.TemporaryDirectory() as temporary:
            path, classifier = await self.diagnostic(Path(temporary), content="Untrusted reference text.")
            before = path.read_bytes()
            with patch("evaluate_issue_screening.MicrosoftDecisionClassifier.from_environment", side_effect=AssertionError("No network")):
                report = inspect_reference_diagnostic(path)
            self.assertEqual(report["original_status"], "uncertain")
            self.assertEqual(report["classifier_requests"], 1)
            self.assertEqual(report["diagnostic_sha256"], hashlib.sha256(before).hexdigest())
            self.assertNotIn("Untrusted reference text.", str(report))
            self.assertEqual(path.read_bytes(), before)
            classifier.classify.assert_awaited_once()

    async def test_reclassification_replays_exact_same_policy_input_without_changing_original_decision(self):
        from evaluate_issue_screening import replay_reference_diagnostic

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path, original = await self.diagnostic(root / "original")
            before = path.read_bytes()
            classifier = AsyncMock(spec=ChoiceClassifier)
            classifier.configuration_hash = "diagnostic-backend"
            classifier.classify.return_value = result(0.01)
            report = await replay_reference_diagnostic(path, classifier, root / "replay")
            self.assertEqual(classifier.classify.call_args, original.classify.call_args)
            self.assertEqual(report["original_status"], "uncertain")
            self.assertEqual(report["replay_status"], "allowed")
            self.assertFalse(report["same_observed_status"])
            self.assertFalse(report["automatic_review_resume"])
            self.assertNotIn("passed", report)
            self.assertEqual(path.read_bytes(), before)
            self.assertFalse(list(root.rglob("validity-reference-*.json")))
            with self.assertRaises(FileExistsError):
                await replay_reference_diagnostic(path, classifier, root / "replay")
            classifier.classify.assert_awaited_once()

    async def test_policy_drift_and_tampering_are_rejected_before_any_classifier_call(self):
        from evaluate_issue_screening import replay_reference_diagnostic
        from issue_review_safety import load_reference_screening_diagnostic

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path, _ = await self.diagnostic(root / "original")
            classifier = AsyncMock(spec=ChoiceClassifier)
            classifier.configuration_hash = "different-backend"
            with self.assertRaisesRegex(ValueError, "policy"):
                await replay_reference_diagnostic(path, classifier, root / "replay")
            classifier.classify.assert_not_awaited()
            self.assertFalse((root / "replay").exists())
            payload = json.loads(path.read_bytes())
            payload["requests"][0]["state"]["content"] = "Changed classifier input"
            path.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "hash-bound"):
                load_reference_screening_diagnostic(path)

    async def test_partial_original_replays_the_whole_input_not_only_its_passing_prefix(self):
        from evaluate_issue_screening import replay_reference_diagnostic
        from issue_review_safety import InjectionScreening
        from test_issue_review_safety import ScreeningTests

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            classifier = AsyncMock(spec=ChoiceClassifier)
            classifier.configuration_hash = "diagnostic-backend"
            classifier.classify.side_effect = [result(0), asyncio.CancelledError]
            with patch("builtins.print"), self.assertRaises(asyncio.CancelledError):
                await InjectionScreening(classifier).check(
                    ScreeningTests().reference("\U0001f600" * 4000), root / "original", "validity-reference:1",
                )
            path, = (root / "original" / "screening-diagnostics").glob("*.json")
            original_calls = classifier.classify.call_args_list[:]
            classifier.reset_mock(side_effect=True)
            classifier.classify.return_value = result(0)
            with patch("builtins.print"):
                report = await replay_reference_diagnostic(path, classifier, root / "replay")
            self.assertEqual(classifier.classify.call_args_list[:2], original_calls)
            self.assertEqual(report["original_status"], "cancelled")
            self.assertEqual(report["replay_status"], "allowed")
            self.assertGreater(classifier.classify.await_count, 2)

    async def test_cli_inspection_needs_no_environment_or_classifier_and_cannot_overwrite_results(self):
        import sys

        from evaluate_issue_screening import main

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path, _ = await self.diagnostic(root / "original")
            output = root / "inspection.json"
            args = ["evaluate_issue_screening.py", "--diagnostic", str(path), "--output", str(output)]
            with patch.object(sys, "argv", args), patch(
                "evaluate_issue_screening.MicrosoftDecisionClassifier.from_environment",
                side_effect=AssertionError("Offline inspection must not create a service client"),
            ), patch("builtins.print"):
                self.assertEqual(await main(), 0)
                self.assertEqual(json.loads(output.read_bytes())["original_status"], "uncertain")
            before = output.read_bytes()
            with patch.object(sys, "argv", [*args, "--reclassify"]), patch(
                "evaluate_issue_screening.MicrosoftDecisionClassifier.from_environment",
                side_effect=AssertionError("Existing output must reject before any service setup"),
            ), self.assertRaises(FileExistsError):
                await main()
            self.assertEqual(output.read_bytes(), before)

    def test_builtin_cases_have_unique_ids_and_separate_validation_examples(self):
        cases = load_cases(None, "all")
        development = load_cases(None, "development")
        validation = load_cases(None, "validation")
        self.assertEqual(len({case.id for case in cases}), len(cases))
        self.assertTrue(development)
        self.assertTrue(validation)
        self.assertFalse({case.id for case in development} & {case.id for case in validation})
        self.assertEqual({case.category for case in validation}, {"benign", "attack"})

    async def test_metrics_distinguish_false_positives_misses_and_operational_failures(self):
        classifier = AsyncMock(spec=ChoiceClassifier)
        classifier.configuration_hash = "evaluation-test"
        classifier.classify.side_effect = [result(0.7), result(0), ClassificationHTTPError(500)]
        cases = [
            ScreeningCase(id="false-positive", category="benign", split="validation", evidence="private fixture"),
            ScreeningCase(id="miss", category="attack", split="validation", evidence="private fixture"),
            ScreeningCase(id="service-error", category="attack", split="validation", evidence="private fixture"),
        ]
        with tempfile.TemporaryDirectory() as temporary, patch("builtins.print"):
            report = await evaluate(cases, classifier, Path(temporary))
        self.assertEqual(classifier.classify.await_count, 3)
        self.assertEqual(report["benign_blocked"], 1)
        self.assertEqual(report["unsafe_allowed"], 1)
        self.assertEqual(report["operational_errors"], 1)
        self.assertFalse(report["passed"])
        self.assertNotIn("private fixture", str(report))

    async def test_expected_policy_blocks_count_as_blocks_not_service_failures(self):
        classifier = AsyncMock(spec=ChoiceClassifier)
        classifier.configuration_hash = "evaluation-test"
        classifier.classify.side_effect = [result(0.01), result(0.6), result(0.4)]
        cases = [
            ScreeningCase(id="ordinary", category="benign", split="validation", evidence="example"),
            ScreeningCase(id="hostile", category="attack", split="validation", evidence="example"),
            ScreeningCase(id="unclear", category="ambiguous", split="development", evidence="example"),
        ]
        with tempfile.TemporaryDirectory() as temporary, patch("builtins.print"):
            report = await evaluate(cases, classifier, Path(temporary))
        self.assertTrue(report["passed"])
        self.assertEqual(report["operational_errors"], 0)
