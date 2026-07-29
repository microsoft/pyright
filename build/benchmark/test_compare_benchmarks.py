import io
import unittest
from contextlib import redirect_stdout

import compare_benchmarks


def _result(time: float, memory: float, ok: bool = True) -> dict:
    return {
        "platform": "linux",
        "architecture": "x86_64",
        "python_version": "3.14.6",
        "memory_limit_mb": 8192,
        "runs_per_package": 1,
        "warmup_runs": 0,
        "timeout_s": 600,
        "results": [
            {
                "package_name": "example",
                "commit": "abc123",
                "check_paths": ["src"],
                "exclude_directories": [],
                "metrics": {
                    "pyright": {
                        "ok": ok,
                        "execution_time_s": time,
                        "peak_memory_mb": memory,
                    }
                },
            }
        ],
    }


class CompareBenchmarksTest(unittest.TestCase):
    def test_accepts_changes_within_threshold(self) -> None:
        with redirect_stdout(io.StringIO()):
            failures = compare_benchmarks.compare(
                _result(10.0, 100.0), _result(10.5, 105.0), 10.0
            )

        self.assertEqual(failures, [])

    def test_rejects_time_and_memory_regressions(self) -> None:
        with redirect_stdout(io.StringIO()):
            failures = compare_benchmarks.compare(
                _result(10.0, 100.0), _result(12.0, 120.0), 10.0
            )

        self.assertEqual(len(failures), 2)

    def test_rejects_failed_candidate(self) -> None:
        with redirect_stdout(io.StringIO()):
            failures = compare_benchmarks.compare(
                _result(10.0, 100.0), _result(0.0, 0.0, ok=False), 10.0
            )

        self.assertEqual(
            failures, ["example/pyright: candidate result failed or is missing"]
        )

    def test_rejects_environment_mismatch(self) -> None:
        candidate = _result(10.0, 100.0)
        candidate["python_version"] = "3.13.0"
        with redirect_stdout(io.StringIO()):
            failures = compare_benchmarks.compare(
                _result(10.0, 100.0), candidate, 10.0
            )

        self.assertEqual(
            failures,
            ["environment mismatch for python_version: '3.14.6' != '3.13.0'"],
        )

    def test_rejects_package_commit_mismatch(self) -> None:
        candidate = _result(10.0, 100.0)
        candidate["results"][0]["commit"] = "def456"
        with redirect_stdout(io.StringIO()):
            failures = compare_benchmarks.compare(
                _result(10.0, 100.0), candidate, 10.0
            )

        self.assertEqual(
            failures,
            ["example/pyright: package commit changed from abc123 to def456"],
        )

    def test_rejects_package_scope_mismatch(self) -> None:
        candidate = _result(10.0, 100.0)
        candidate["results"][0]["exclude_directories"] = ["tests"]
        with redirect_stdout(io.StringIO()):
            failures = compare_benchmarks.compare(
                _result(10.0, 100.0), candidate, 10.0
            )

        self.assertEqual(
            failures,
            [
                "example/pyright: package exclude_directories changed from [] to ['tests']"
            ],
        )

    def test_renders_markdown_summary_and_failure(self) -> None:
        report = compare_benchmarks.render_markdown(
            _result(10.0, 100.0), _result(12.0, 105.0), 10.0
        )

        self.assertIn("**1 regression check(s) failed.**", report)
        self.assertIn(
            "| example | pyright | 12.000s | +20.0% | 105.0 MB | +5.0% | Regression |",
            report,
        )
        self.assertIn("- example/pyright: time regressed 20.0%", report)


if __name__ == "__main__":
    unittest.main()