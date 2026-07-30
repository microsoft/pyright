import io
import unittest
from contextlib import redirect_stdout

import compare_benchmarks


def _result(time: float, memory: float, ok: bool = True) -> dict:
    return {
        "platform": "linux",
        "architecture": "x86_64",
        "runner_class": "github-ubuntu-latest",
        "cpu_count": 4,
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

        self.assertEqual(
            failures,
            [
                "example/pyright: time regressed 20.0% (limit 10.0%)",
                "example/pyright: memory regressed 20.0% (limit 10.0%)",
            ],
        )

    def test_accepts_regressions_within_absolute_noise_floors(self) -> None:
        with redirect_stdout(io.StringIO()):
            failures = compare_benchmarks.compare(
                _result(1.0, 100.0),
                _result(1.5, 150.0),
                20.0,
                time_noise_floor_s=1.0,
                memory_noise_floor_mb=100.0,
            )

        self.assertEqual(failures, [])

    def test_rejects_failed_candidate(self) -> None:
        with redirect_stdout(io.StringIO()):
            failures = compare_benchmarks.compare(
                _result(10.0, 100.0), _result(0.0, 0.0, ok=False), 10.0
            )

        self.assertEqual(
            failures, ["example/pyright: candidate result failed or is missing"]
        )

    def test_reports_preparation_failure_without_regression(self) -> None:
        candidate = _result(0.0, 0.0, ok=False)
        candidate["results"][0]["error"] = "Dependency installation failed"
        candidate["results"][0]["metrics"] = {}
        with redirect_stdout(io.StringIO()):
            failures = compare_benchmarks.compare(
                _result(10.0, 100.0), candidate, 10.0
            )

        self.assertEqual(failures, [])
        report = compare_benchmarks.render_markdown(
            _result(10.0, 100.0), candidate, 10.0
        )
        self.assertEqual(
            report,
            """## Type checker benchmark

🟢 **No performance regressions detected.**

🟡 **1 package(s) could not be prepared and were not measured.**

Regression threshold: `10.0%`

| Package | Checker | Time | Time delta | Peak memory | Memory delta | Status |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| example | pyright | N/A | N/A | N/A | N/A | 🟡 Preparation failed |
""",
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
            _result(10.0, 100.0),
            _result(12.0, 105.0),
            10.0,
            time_noise_floor_s=1.0,
            memory_noise_floor_mb=100.0,
        )

        self.assertEqual(
            report,
            """## Type checker benchmark

🔴 **1 regression check(s) failed.**

Regression threshold: `10.0%`
Variance guard: `>1.0s` time and `>100.0 MB` memory

| Package | Checker | Time | Time delta | Peak memory | Memory delta | Status |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| example | pyright | 12.000s | +20.0% | 105.0 MB | +5.0% | 🔴 Regression |

### Failures

- example/pyright: time regressed 20\\.0% \\(limit 10\\.0%\\)
""",
        )

    def test_escapes_untrusted_markdown_in_report(self) -> None:
        candidate = _result(10.0, 100.0)
        candidate["python_version"] = "[click](https://example.com)\n# heading"

        report = compare_benchmarks.render_markdown(
            _result(10.0, 100.0), candidate, 10.0
        )

        self.assertEqual(
            report,
            """## Type checker benchmark

🔴 **1 regression check(s) failed.**

Regression threshold: `10.0%`

| Package | Checker | Time | Time delta | Peak memory | Memory delta | Status |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| example | pyright | 10.000s | +0.0% | 100.0 MB | +0.0% | 🟢 Pass |

### Failures

- environment mismatch for python\\_version: '3\\.14\\.6' \\!= '\\[click\\]\\(https://example\\.com\\)\\\\n\\# heading'
""",
        )


if __name__ == "__main__":
    unittest.main()