# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

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
