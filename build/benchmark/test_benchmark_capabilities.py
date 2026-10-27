import os
import unittest
from pathlib import Path

import benchmark_capabilities as capabilities
import typecheck_benchmark as benchmark


def _output(paths: list[Path], phase: str) -> capabilities.CapabilityOutput:
    diagnostics = []
    for path in paths:
        for line, text in enumerate(path.read_text().splitlines(), 1):
            if phase == "negative" and "# expect-error" in text:
                diagnostics.append(f"{path}:{line}:1: error: expected")
    return {
        "stdout": "\n".join(diagnostics),
        "stderr": "",
        "returncode": 1 if diagnostics else 0,
        "timed_out": False,
        "oom_killed": False,
        "files_selected": len(paths),
    }


class BenchmarkCapabilitiesTest(unittest.TestCase):
    def test_requires_positive_precision_and_negative_diagnostics(self) -> None:
        def run(checker, root, paths):
            output = _output(paths, root.name)
            if root.name == "positive":
                output["stdout"] = "generics.py:6:1: error: Any is not int"
                output["returncode"] = 1
            else:
                output["stdout"] = "\n".join(
                    line for line in output["stdout"].splitlines()
                    if "unannotated_return.py:" not in line
                )
                output["stdout"] += "\nprotocols.py:4:1: error: unexpected"
            return output

        suite = capabilities.run_capability_suite(["checker"], run)
        result = suite["results"]["checker"]
        self.assertTrue(result["ok"])
        self.assertFalse(result["cases"]["generics"]["passed"])
        self.assertFalse(result["cases"]["unannotated_return"]["passed"])
        self.assertFalse(result["cases"]["protocols"]["passed"])
        self.assertTrue(result["cases"]["overloads"]["passed"])
        self.assertIn("Any is not int", result["evidence"]["positive"]["stdout"])

    def test_missing_assert_type_control_cannot_pass_other_cases(self) -> None:
        def run(checker, root, paths):
            output = _output(paths, root.name)
            output["stdout"] = "\n".join(
                line for line in output["stdout"].splitlines()
                if "assert_type.py:" not in line
            )
            return output

        suite = capabilities.run_capability_suite(["checker"], run)
        cases = suite["results"]["checker"]["cases"]
        self.assertTrue(all(not case["passed"] for case in cases.values()))

    def test_incomplete_or_unrecognized_runs_are_not_coverage(self) -> None:
        for fault in ("count", "timeout", "fatal", "format", "outside"):
            with self.subTest(fault=fault):
                def run(checker, root, paths):
                    output = _output(paths, root.name)
                    if fault == "count":
                        output["files_selected"] = len(paths) - 1
                    elif fault == "timeout":
                        output["timed_out"] = True
                    elif fault == "fatal":
                        output["returncode"] = 2
                    elif fault == "format":
                        output["returncode"] = 1
                        output["stdout"] = "Unrecognized diagnostics"
                    else:
                        output["returncode"] = 1
                        output["stdout"] = "capability_support.py:1: error: unexpected"
                    return output

                result = capabilities.run_capability_suite(["checker"], run)["results"]["checker"]
                self.assertFalse(result["ok"])
                self.assertIn("error", result)
                self.assertNotIn("cases", result)

    def test_checker_start_failure_does_not_hide_other_checkers(self) -> None:
        def run(checker, root, paths):
            if checker == "missing":
                raise FileNotFoundError("Not installed")
            return _output(paths, root.name)

        results = capabilities.run_capability_suite(["missing", "installed"], run)["results"]
        self.assertFalse(results["missing"]["ok"])
        self.assertIn("Not installed", results["missing"]["error"])
        self.assertTrue(all(case["passed"] for case in results["installed"]["cases"].values()))

    @unittest.skipUnless(
        os.environ.get("TYPECHECK_BENCHMARK_INTEGRATION") == "1",
        "Set TYPECHECK_BENCHMARK_INTEGRATION=1 with all checkers installed",
    )
    def test_real_profiles_verify_precision_and_inference_difference(self) -> None:
        def run(checker, root, paths):
            result = benchmark._run_checker_process(
                checker, root, paths, 60, 0, audit_files=True,
            )
            return {
                **result,
                "files_selected": benchmark._parse_source_file_count(
                    checker, result["stdout"] + "\n" + result["stderr"]
                ),
            }

        checkers = [*benchmark.DEFAULT_TYPE_CHECKERS, "ty-infer", "pyright-threads"]
        suite = capabilities.run_capability_suite(checkers, run)
        for checker, result in suite["results"].items():
            with self.subTest(checker=checker):
                self.assertTrue(result["ok"], result)
                self.assertTrue(result["cases"]["assert_type"]["passed"], result)
                self.assertTrue(result["cases"]["generics"]["passed"], result)
                self.assertTrue(result["cases"]["imported_types"]["passed"], result)
        self.assertFalse(suite["results"]["ty"]["cases"]["unannotated_return"]["passed"])
        self.assertTrue(suite["results"]["ty-infer"]["cases"]["unannotated_return"]["passed"])


if __name__ == "__main__":
    unittest.main()
