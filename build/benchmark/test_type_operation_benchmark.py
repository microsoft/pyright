import argparse
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import type_operation_benchmark as benchmark


class TypeOperationBenchmarkTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        self.baseline = root / "baseline"
        self.candidate = root / "candidate"
        (self.baseline / "packages" / "pyright-internal" / "typeshed-fallback").mkdir(parents=True)
        self.args = argparse.Namespace(
            baseline_root=self.baseline,
            candidate_root=self.candidate,
            workloads=["literal-union"],
            sizes=[10],
            runs=2,
            node="node",
            timeout=10,
        )
        self.enterContext(patch.object(benchmark, "build_info", return_value={}))
        self.enterContext(patch.object(benchmark.subprocess, "check_output", return_value="v24\n"))

    def run_with_diagnostics(self, *, change_message=False, lose_negative=False):
        order = []

        def fake_process(command, *_args, **_kwargs):
            name = Path(command[1]).parents[3].name
            order.append(name)
            diagnostic = {
                "file": command[-1],
                "range": {"start": {"line": 9, "character": 6}},
                "severity": "error",
                "rule": "reportArgumentType",
                "message": "Changed" if change_message and name == "candidate" else "Invalid key",
            }
            return {
                "returncode": 1,
                "timed_out": False,
                "oom_killed": False,
                "stderr": "",
                "stdout": json.dumps(
                    {
                        "generalDiagnostics": [] if lose_negative else [diagnostic],
                        "summary": {"filesAnalyzed": 1},
                    }
                ),
                "execution_time_s": len(order),
                "peak_memory_mb": 0.0,
            }

        with patch.object(benchmark, "run_process_with_timeout", side_effect=fake_process):
            return benchmark.run(self.args), order

    def test_pairs_runs_in_alternating_order_and_keeps_raw_samples(self):
        report, order = self.run_with_diagnostics()
        self.assertEqual(order, ["baseline", "candidate", "candidate", "baseline"])
        case = report["cases"][0]
        self.assertEqual(case["medianWallSeconds"], {"baseline": 2.5, "candidate": 2.5})
        self.assertEqual(case["samples"]["baseline"][0], {"wallSeconds": 1, "peakRssMiB": None})

    def test_rejects_diagnostic_difference_on_same_line_and_rule(self):
        with self.assertRaisesRegex(ValueError, "candidate run 1: Diagnostic mismatch"):
            self.run_with_diagnostics(change_message=True)

    def test_rejects_missing_negative_diagnostic(self):
        with self.assertRaisesRegex(ValueError, "baseline run 1: Expected only"):
            self.run_with_diagnostics(lose_negative=True)


if __name__ == "__main__":
    unittest.main()
