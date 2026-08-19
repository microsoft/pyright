import io
import json
import re
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

import compare_benchmarks

REPO_ROOT = Path(__file__).resolve().parents[2]


def _result(time: float, memory: float, ok: bool = True) -> dict:
    return {
        "platform": "linux",
        "architecture": "x86_64",
        "runner_class": "github-ubuntu-latest",
        "runner_image": "ubuntu24",
        "cpu_count": 4,
        "python_version": "3.14.6",
        "memory_limit_mb": 8192,
        "runs_per_package": 1,
        "warmup_runs": 0,
        "timeout_s": 600,
        "dependency_isolation": "pip-target-per-package",
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

    def test_rejects_preparation_failure_in_strict_mode(self) -> None:
        candidate = _result(0.0, 0.0, ok=False)
        candidate["results"][0]["error"] = "Dependency installation failed"
        candidate["results"][0]["metrics"] = {}
        with redirect_stdout(io.StringIO()):
            failures = compare_benchmarks.compare(
                _result(10.0, 100.0),
                candidate,
                10.0,
                fail_on_preparation_error=True,
            )

        self.assertEqual(
            failures, ["example/pyright: candidate package preparation failed"]
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

    def test_rejects_runner_image_mismatch(self) -> None:
        candidate = _result(10.0, 100.0)
        candidate["runner_image"] = "ubuntu22"

        with redirect_stdout(io.StringIO()):
            failures = compare_benchmarks.compare(
                _result(10.0, 100.0), candidate, 10.0
            )

        self.assertEqual(
            failures,
            ["environment mismatch for runner_image: 'ubuntu24' != 'ubuntu22'"],
        )

    def test_rejects_dependency_isolation_mismatch(self) -> None:
        candidate = _result(10.0, 100.0)
        candidate["dependency_isolation"] = "shared"

        with redirect_stdout(io.StringIO()):
            failures = compare_benchmarks.compare(
                _result(10.0, 100.0), candidate, 10.0
            )

        self.assertEqual(
            failures,
            [
                "environment mismatch for dependency_isolation: "
                "'pip-target-per-package' != 'shared'"
            ],
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

    def test_reports_candidate_result_without_baseline(self) -> None:
        candidate = _result(10.0, 100.0)
        candidate["results"][0]["metrics"]["mypy"] = {
            "ok": True,
            "execution_time_s": 20.0,
            "peak_memory_mb": 200.0,
        }

        output = io.StringIO()
        with redirect_stdout(output):
            failures = compare_benchmarks.compare(
                _result(10.0, 100.0), candidate, 10.0
            )
        report = compare_benchmarks.render_markdown(
            _result(10.0, 100.0), candidate, 10.0
        )

        self.assertEqual(failures, [])
        self.assertIn("example              mypy          20.000s", output.getvalue())
        self.assertIn("N/A", output.getvalue())
        self.assertIn(
            "1 candidate result(s) have no baseline and were not regression-gated",
            report,
        )
        self.assertIn(
            "| example | mypy | 20.000s | N/A | 200.0 MB | N/A | 🟡 No baseline |",
            report,
        )

    def test_reports_malformed_metrics_without_crashing(self) -> None:
        candidate = _result(10.0, 100.0)
        candidate["results"] = [123]

        report = compare_benchmarks.render_markdown(
            _result(10.0, 100.0), candidate, 10.0
        )

        self.assertIn("candidate: results\\[0\\] must be an object", report)

    def test_load_rejects_non_finite_json_numbers(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            result_file = Path(temp_dir) / "result.json"
            result_file.write_text('{"results": [], "value": NaN}', encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "non-finite number NaN"):
                compare_benchmarks._load_results(result_file)

    def test_workflow_profile_matches_checked_in_baseline(self) -> None:
        workflow = (
            REPO_ROOT / ".github" / "workflows" / "typecheck_benchmark_pr.yml"
        ).read_text(encoding="utf-8")
        timeout_match = re.search(
            r"typecheck_benchmark\.py \\\s+"
            r"-c pyright -r 1 -w 0 -t (\d+)",
            workflow,
        )
        self.assertIsNotNone(timeout_match)

        baseline = json.loads(
            (
                REPO_ROOT
                / "build"
                / "benchmark"
                / "baselines"
                / "latest-linux-x64.json"
            ).read_text(encoding="utf-8")
        )
        config = json.loads(
            (
                REPO_ROOT / "build" / "benchmark" / "install_envs.json"
            ).read_text(encoding="utf-8")
        )

        self.assertEqual(int(timeout_match.group(1)), baseline["timeout_s"])
        baseline_packages = {
            package["package_name"]: package for package in baseline["results"]
        }
        for package in config["packages"]:
            package_name = package.get("name") or package["github_url"].rsplit(
                "/", 1
            )[-1]
            baseline_package = baseline_packages[package_name]
            self.assertEqual(
                package.get("check_paths", []), baseline_package["check_paths"]
            )
            self.assertEqual(
                package.get("exclude_directories", []),
                baseline_package["exclude_directories"],
            )

    def test_workflows_use_current_pnpm_setup(self) -> None:
        for workflow_name in (
            "typecheck_benchmark_pr.yml",
            "typecheck_benchmark_weekly.yml",
        ):
            workflow = (
                REPO_ROOT / ".github" / "workflows" / workflow_name
            ).read_text(encoding="utf-8")

            self.assertIn("uses: pnpm/action-setup@", workflow)
            self.assertIn("cache: 'pnpm'", workflow)
            self.assertIn("pnpm-lock.yaml", workflow)
            self.assertNotIn(".github/actions/npm-cache-dir", workflow)

    def test_pr_benchmark_requires_authorized_comment(self) -> None:
        trigger_workflow = (
            REPO_ROOT
            / ".github"
            / "workflows"
            / "typecheck_benchmark_trigger.yml"
        ).read_text(encoding="utf-8")
        benchmark_workflow = (
            REPO_ROOT / ".github" / "workflows" / "typecheck_benchmark_pr.yml"
        ).read_text(encoding="utf-8")

        self.assertIn("issue_comment:", trigger_workflow)
        self.assertIn("github.event.comment.body == '/benchmark'", trigger_workflow)
        self.assertIn("github.event.issue.state == 'open'", trigger_workflow)
        self.assertIn("getCollaboratorPermissionLevel", trigger_workflow)
        self.assertIn("['admin', 'maintain', 'write']", trigger_workflow)
        self.assertIn("issues: write", trigger_workflow)
        self.assertNotIn("actions/checkout", trigger_workflow)
        self.assertIn("types:\n      - labeled", benchmark_workflow)
        self.assertNotIn("paths:", benchmark_workflow)
        self.assertIn(
            "github.event.label.name == 'run-typecheck-benchmark'",
            benchmark_workflow,
        )

    def test_pr_workflow_prefers_trusted_baseline_with_bootstrap_fallback(self) -> None:
        workflow = (
            REPO_ROOT / ".github" / "workflows" / "typecheck_benchmark_pr.yml"
        ).read_text(encoding="utf-8")

        trusted = "benchmark-baseline/build/benchmark/baselines/latest-linux-x64.json"
        bootstrap = "build/benchmark/baselines/latest-linux-x64.json"
        self.assertLess(
            workflow.index('if [[ -f "$trusted" ]]'),
            workflow.index('elif [[ -f "$bootstrap" ]]'),
        )
        self.assertIn('echo "path=$trusted" >> "$GITHUB_OUTPUT"', workflow)
        self.assertIn('echo "path=$bootstrap" >> "$GITHUB_OUTPUT"', workflow)
        self.assertIn('"${{ steps.baseline.outputs.path }}"', workflow)


if __name__ == "__main__":
    unittest.main()
