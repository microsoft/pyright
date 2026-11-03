# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

import asyncio
import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

from issue_review_timing import phase_timing


class PhaseTimingTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.path = Path(temporary.name) / "timings.jsonl"

    def records(self):
        return [json.loads(line) for line in self.path.read_text(encoding="utf-8").splitlines()]

    def test_pairs_utc_timestamps_monotonic_durations_and_explicit_nonadditive_nesting(self):
        with patch("issue_review_timing.monotonic", side_effect=[10, 11, 13, 15]):
            with phase_timing(self.path, "controller.prepare"):
                with phase_timing(self.path, "target.acquire", target="historical"):
                    pass
        outer_start, inner_start, inner_end, outer_end = self.records()
        self.assertEqual(inner_start["parent_id"], outer_start["id"])
        self.assertEqual(inner_end["id"], inner_start["id"])
        self.assertEqual(outer_end["id"], outer_start["id"])
        self.assertIsNone(outer_start["parent_id"])
        self.assertEqual(inner_end["elapsed_seconds"], 2)
        self.assertEqual(outer_end["elapsed_seconds"], 5)
        self.assertEqual(inner_end["target"], "historical")
        for record in self.records():
            self.assertIsNotNone(datetime.fromisoformat(record["at"]).tzinfo)
            self.assertEqual(record["nested_intervals"], "non_additive")
        with phase_timing(self.path, "unrelated"):
            pass
        self.assertIsNone(self.records()[-1]["parent_id"])

    def test_failure_and_cancellation_remain_failures_without_logging_exception_payloads(self):
        for error, expected in ((ValueError("private source"), "failed"), (asyncio.CancelledError(), "cancelled")):
            with self.subTest(expected=expected), self.assertRaises(type(error)):
                with phase_timing(self.path, "controller.check"):
                    raise error
            start, end = self.records()[-2:]
            self.assertEqual(start["type"], "phase.start")
            self.assertEqual(end["type"], "phase.end")
            self.assertEqual(end["status"], expected)
            self.assertEqual(end["exception"], type(error).__name__)
            self.assertNotIn("private", json.dumps(end))
