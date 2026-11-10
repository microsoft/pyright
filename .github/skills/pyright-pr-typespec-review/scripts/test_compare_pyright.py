#!/usr/bin/env python3
"""Regression tests for the runner; no Pyright installation is required."""
import copy
import json
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
import unittest
from unittest import mock


RUNNER = Path(__file__).with_name("compare_pyright.py")


class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="pyright-runner-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "case.py").write_text('reveal_type(0)\nx: int = "bad"\n', encoding="utf-8")
        (self.root / "pyrightconfig.json").write_text('{"include": ["case.py"]}', encoding="utf-8")
        self.cli = self.root / "fixture_cli.py"
        self.cli.write_text(
            "import json, pathlib, sys\n"
            "data = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))\n"
            "print(json.dumps(data))\n"
            "sys.exit(int(isinstance(data, dict) and isinstance(data.get('summary'), dict) "
            "and bool(data['summary'].get('errorCount'))))\n",
            encoding="utf-8",
        )
        self.cfg = {
            "project": "pyrightconfig.json", "case_root": ".", "output_dir": "results",
            "cases": [{"file": "case.py", "expect": "accept"}],
        }
        for label in ("base", "candidate"):
            self.cfg[label] = {"argv": [sys.executable, str(self.cli), str(self.root / f"{label}.json")]}
            self.report(label, [self.diagnostic()])

    def diagnostic(self, file="case.py", severity="information", line=1, rule=None):
        result = {
            "file": str(self.root / file), "severity": severity,
            "message": 'Type of "0" is "Literal[0]"' if severity == "information" else "Incompatible assignment",
            "range": {"start": {"line": line - 1, "character": 0},
                      "end": {"line": line - 1, "character": 1}},
        }
        if rule is not None:
            result["rule"] = rule
        return result

    def report(self, label, diagnostics, files=1):
        self.write_report(label, {
            "generalDiagnostics": diagnostics,
            "summary": {"filesAnalyzed": files,
                        "errorCount": sum(d["severity"] == "error" for d in diagnostics)},
        })

    def write_report(self, label, report):
        (self.root / f"{label}.json").write_text(json.dumps(report), encoding="utf-8")

    def run_config(self, cfg=None, expected=0, extra_args=()):
        path = self.root / "runner-config.json"
        path.write_text(json.dumps(self.cfg if cfg is None else cfg), encoding="utf-8")
        result = subprocess.run([sys.executable, "-B", str(RUNNER), str(path), *extra_args],
                                capture_output=True, encoding="utf-8", timeout=15)
        self.assertEqual(result.returncode, expected, (result.stdout, result.stderr))
        self.assertNotIn("Traceback", result.stderr)
        return result

    def comparison(self, output="results"):
        return json.loads((self.root / output / "comparison.json").read_text(encoding="utf-8"))

    def test_preflight_does_not_execute_or_create_outputs(self):
        marker = self.root / "checker-invoked.txt"
        for label in ("base", "candidate"):
            self.cfg[label]["argv"] = [sys.executable, "-c",
                "import pathlib; pathlib.Path(" + repr(str(marker)) + ").write_text('called'); raise SystemExit(2)"]
        result = self.run_config(extra_args=("--validate-only",))
        self.assertEqual(json.loads(result.stdout),
                         {"configuration_valid": True, "cases": 1, "checkers_executed": False})
        self.assertFalse(marker.exists())
        self.assertFalse((self.root / "results").exists())

    def test_preflight_rejects_unchanged_with_error_obligations(self):
        self.cfg["cases"][0].update(expect="unchanged", errors=[{"line": 2, "rule": "reportAssignmentType"}])
        result = self.run_config(expected=2, extra_args=("--validate-only",))
        self.assertIn("errors requires reject", result.stderr)
        self.assertFalse((self.root / "results").exists())

    def test_preflight_rejects_missing_source_and_file_output(self):
        variants = [dict(self.cfg, cases=[{"file": "missing.py", "expect": "accept"}]),
                    dict(self.cfg, output_dir="case.py")]
        for cfg in variants:
            with self.subTest(cfg=cfg):
                self.run_config(cfg, expected=2, extra_args=("--validate-only",))
                self.assertFalse((self.root / "results").exists())

    def test_preflight_does_not_claim_execution_or_coverage(self):
        self.cfg["candidate"]["argv"] = [str(self.root / "nonexistent-checker")]
        self.run_config(extra_args=("--validate-only",))
        self.run_config(expected=2)
        self.assertFalse((self.root / "results" / "comparison.json").exists())

    def test_clean_case_with_information_evidence_passes(self):
        self.run_config()
        self.assertEqual(self.comparison()["summary"]["candidate_expectations_met"], 1)
        for label in ("base", "candidate"):
            coverage = json.loads((self.root / "results" / f"{label}.coverage.json").read_text())
            self.assertEqual(coverage, {"verified_cases": ["case.py"], "missing_cases": []})

    def test_explicit_null_timeout_runs_without_deadline(self):
        self.cfg["timeout_seconds"] = None
        self.run_config()
        self.assertEqual(self.comparison()["summary"]["candidate_expectations_met"], 1)

    def test_omitted_and_null_timeout_reach_checker_without_deadline(self):
        runner = runpy.run_path(str(RUNNER))
        out = self.root / "results"
        out.mkdir()
        completed = subprocess.CompletedProcess(
            ["checker"],
            0,
            stdout=(self.root / "base.json").read_bytes(),
            stderr=b"",
        )

        def resolve(value):
            return (self.root / value).resolve()

        for explicit_timeout in (False, True):
            with self.subTest(explicit_timeout=explicit_timeout):
                cfg = copy.deepcopy(self.cfg)
                if explicit_timeout:
                    cfg["timeout_seconds"] = None
                with mock.patch.object(runner["subprocess"], "run", return_value=completed) as run:
                    runner["execute"]("base", cfg["base"], cfg, resolve, out)
                self.assertIsNone(run.call_args.kwargs["timeout"])

    def test_skipped_case_cannot_pass_despite_unrelated_file_count(self):
        for label in ("base", "candidate"):
            for expectation in ("accept", "unchanged", "reject"):
                with self.subTest(label=label, expectation=expectation):
                    self.report("base", [self.diagnostic()])
                    self.report("candidate", [self.diagnostic()])
                    self.report(label, [self.diagnostic(file="support.py")], files=10)
                    cfg = copy.deepcopy(self.cfg)
                    cfg["cases"][0]["expect"] = expectation
                    cfg["output_dir"] = f"missing-{label}-{expectation}"
                    self.run_config(cfg, expected=2)
                    out = self.root / cfg["output_dir"]
                    self.assertFalse((out / "comparison.json").exists())
                    coverage = json.loads((out / f"{label}.coverage.json").read_text())
                    self.assertEqual(coverage["missing_cases"], ["case.py"])
                    self.assertTrue((out / f"{label}.stdout.json").is_file())

    def test_newly_accepted_invalid_case_remains_expectation_failure(self):
        self.cfg["cases"][0].update(expect="reject", errors=[{"line": 2, "rule": "reportAssignmentType"}])
        self.report("base", [self.diagnostic(), self.diagnostic(severity="error", line=2, rule="reportAssignmentType")])
        self.run_config(expected=1)
        summary = self.comparison()["summary"]
        self.assertEqual(summary["newly_accepted"], ["case.py"])
        self.assertEqual(summary["expectation_failures"], ["case.py"])

    def test_zero_files_also_saves_missing_coverage_details(self):
        self.report("base", [], files=0)
        self.run_config(expected=2)
        coverage = json.loads((self.root / "results" / "base.coverage.json").read_text())
        self.assertEqual(coverage["missing_cases"], ["case.py"])

    def test_exact_negative_expectation_and_wrong_line(self):
        self.cfg["cases"][0].update(expect="reject", errors=[{"line": 2, "rule": "reportAssignmentType"}])
        for label in ("base", "candidate"):
            self.report(label, [self.diagnostic(severity="error", line=2, rule="reportAssignmentType")])
        self.run_config()
        self.cfg["cases"][0]["errors"][0]["line"] = 3
        self.cfg["output_dir"] = "wrong-line"
        self.run_config(expected=1)

    def test_unchanged_information_is_compared(self):
        self.cfg["cases"][0]["expect"] = "unchanged"
        self.run_config()
        info = self.diagnostic()
        info["message"] = 'Type of "0" is "int"'
        self.report("candidate", [info])
        self.cfg["output_dir"] = "changed-information"
        self.run_config(expected=1)

    def test_unlisted_errors_still_fail(self):
        self.report("candidate", [self.diagnostic(), self.diagnostic(file="support.py", severity="error")], files=2)
        self.run_config(expected=1)
        self.assertEqual(len(self.comparison()["summary"]["unlisted_error_files"]["candidate"]), 1)

    def test_invalid_error_entries_are_input_failures(self):
        entries = [1, None, [], "line", {}, {"line": True}, {"line": 0},
                   {"line": "2"}, {"line": 2, "rule": []}, {"line": 2, "rule": ""}]
        for entry in entries:
            with self.subTest(entry=entry):
                cfg = copy.deepcopy(self.cfg)
                cfg["cases"][0].update(expect="reject", errors=[entry])
                self.run_config(cfg, expected=2)
                self.assertFalse((self.root / "results").exists())

    def test_invalid_config_shapes_are_input_failures(self):
        variants = [[], dict(self.cfg, cases=[1]), dict(self.cfg, base=[]),
                    dict(self.cfg, candidate=[]), dict(self.cfg, common_args=1)]
        for timeout in (0, -1, True, "1", 300, 2_073_599, float("nan"), float("inf")):
            variants.append(dict(self.cfg, timeout_seconds=timeout))
        variants.extend([
            dict(self.cfg, timeout_seconds=2_073_600),
            dict(self.cfg, timeout_seconds=2_073_600, timeout_reason=""),
            dict(self.cfg, timeout_reason="No finite limit is configured"),
        ])
        for cfg in variants:
            with self.subTest(cfg=cfg):
                self.run_config(cfg, expected=2)
                self.assertFalse((self.root / "results").exists())

    def test_documented_minimum_timeout_is_valid(self):
        self.cfg["timeout_seconds"] = 2_073_600
        self.cfg["timeout_reason"] = "The host platform requires a finite subprocess wait"
        self.run_config(extra_args=("--validate-only",))

    def test_malformed_cli_output_is_infrastructure_failure(self):
        reports = [[], {"generalDiagnostics": [], "summary": []},
                   {"generalDiagnostics": [1], "summary": {"errorCount": 0, "filesAnalyzed": 1}},
                   {"generalDiagnostics": [], "summary": {"errorCount": 0, "filesAnalyzed": "1"}}]
        for report in reports:
            with self.subTest(report=report):
                self.write_report("base", report)
                self.run_config(expected=2)
                self.assertFalse((self.root / "results" / "comparison.json").exists())

    def test_timeout_preserves_partial_bytes_and_marks_incomplete(self):
        runner = runpy.run_path(str(RUNNER))
        out = self.root / "results"
        out.mkdir()
        error = subprocess.TimeoutExpired(
            ["checker"], 2_073_600, output=b"partial stdout\xe2", stderr=b"partial stderr"
        )
        cfg = dict(
            self.cfg,
            timeout_seconds=2_073_600,
            timeout_reason="The host platform requires a finite subprocess wait",
        )

        def resolve(value):
            return (self.root / value).resolve()

        with mock.patch.object(runner["subprocess"], "run", side_effect=error):
            with self.assertRaisesRegex(ValueError, "command did not complete"):
                runner["execute"]("base", cfg["base"], cfg, resolve, out)
        self.assertEqual((out / "base.stdout.json").read_bytes(), b"partial stdout\xe2")
        self.assertEqual((out / "base.stderr.txt").read_bytes(), b"partial stderr")
        meta = json.loads((out / "base.run.json").read_text())
        self.assertFalse(meta["completed"])
        self.assertTrue(meta["timed_out"])
        self.assertFalse((out / "comparison.json").exists())

    def test_command_start_failure_is_infrastructure_failure(self):
        self.cfg["base"]["argv"] = [str(self.root / "nonexistent-executable")]
        self.run_config(expected=2)
        meta = json.loads((self.root / "results" / "base.run.json").read_text())
        self.assertFalse(meta["completed"])
        self.assertFalse(meta["timed_out"])


if __name__ == "__main__":
    unittest.main()
