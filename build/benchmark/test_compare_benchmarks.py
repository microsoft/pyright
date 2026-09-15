import io
import json
import re
import subprocess
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

import compare_benchmarks

REPO_ROOT = Path(__file__).resolve().parents[2]


def _load_yaml(path: Path) -> dict:
    script = """
const fs = require('fs');
const YAML = require('yaml');
process.stdout.write(JSON.stringify(YAML.parse(fs.readFileSync(process.argv[1], 'utf8'))));
"""
    result = subprocess.run(
        ["node", "-e", script, str(path)],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)


def _result(time: float, memory: float, ok: bool = True) -> dict:
    return {
        "platform": "linux",
        "architecture": "x86_64",
        "runner_class": "github-ubuntu-latest",
        "runner_image": "ubuntu24",
        "cpu_count": 4,
        "python_version": "3.14.6",
        "memory_limit_mb": 8192,
        "node_options": "--max-old-space-size=6656",
        "runs_per_package": 1,
        "warmup_runs": 0,
        "uncounted_validation_runs_per_checker": 0,
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
                        "files_checked": 123,
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

    def test_report_includes_pyright_stats(self) -> None:
        candidate = _result(10.0, 100.0)
        metrics = candidate["results"][0]["metrics"]["pyright"]
        metrics["files_parsed"] = 456
        metrics["phase_times_s"] = {
            "find_source_files": 0.1,
            "read_source_files": 0.2,
            "tokenize": 0.3,
            "parse": 0.4,
            "resolve_imports": 0.5,
            "bind": 0.6,
            "check": 7.8,
            "detect_cycles": 0.9,
        }

        report = compare_benchmarks.render_markdown(
            _result(10.0, 100.0), candidate, 10.0
        )

        self.assertIn("### Pyright stats", report)
        self.assertIn(
            "| example | 456 | 123 | 0.100s | 0.200s | 0.300s | 0.400s | "
            "0.500s | 0.600s | 7.800s | 0.900s |",
            report,
        )

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

| Package | Checker | Files checked | Time | Time delta | Peak memory | Memory delta | Status |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| example | pyright | N/A | N/A | N/A | N/A | N/A | 🟡 Preparation failed |
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

    def test_accepts_timeout_limit_change(self) -> None:
        candidate = _result(10.0, 100.0)
        candidate["timeout_s"] = 1800

        with redirect_stdout(io.StringIO()):
            failures = compare_benchmarks.compare(
                _result(10.0, 100.0), candidate, 10.0
            )

        self.assertEqual(failures, [])

    def test_reports_success_without_failed_baseline(self) -> None:
        baseline = _result(0.0, 0.0, ok=False)
        candidate = _result(12.0, 345.0)

        with redirect_stdout(io.StringIO()):
            failures = compare_benchmarks.compare(baseline, candidate, 10.0)

        self.assertEqual(failures, [])
        report = compare_benchmarks.render_markdown(baseline, candidate, 10.0)
        self.assertIn(
            "| example | pyright | 123 | 12.000s | N/A | 345.0 MB | N/A | 🟡 No baseline |",
            report,
        )

    def test_strict_mode_rejects_failure_without_successful_baseline(self) -> None:
        baseline = _result(0.0, 0.0, ok=False)
        candidate = _result(0.0, 0.0, ok=False)

        with redirect_stdout(io.StringIO()):
            failures = compare_benchmarks.compare(
                baseline,
                candidate,
                10.0,
                fail_on_preparation_error=True,
            )

        self.assertEqual(
            failures, ["example/pyright: candidate result failed or is missing"]
        )
        report = compare_benchmarks.render_markdown(
            baseline,
            candidate,
            10.0,
            fail_on_preparation_error=True,
        )
        self.assertIn(
            "| example | pyright | N/A | N/A | N/A | N/A | N/A | 🔴 Failed |",
            report,
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

    def test_rejects_node_options_mismatch(self) -> None:
        candidate = _result(10.0, 100.0)
        candidate["node_options"] = "--max-old-space-size=7168"

        with redirect_stdout(io.StringIO()):
            failures = compare_benchmarks.compare(
                _result(10.0, 100.0), candidate, 10.0
            )

        self.assertEqual(
            failures,
            [
                "environment mismatch for node_options: "
                "'--max-old-space-size=6656' != '--max-old-space-size=7168'"
            ],
        )

    def test_allows_uncounted_validation_run_mismatch(self) -> None:
        candidate = _result(10.0, 100.0)
        candidate["uncounted_validation_runs_per_checker"] = 1

        with redirect_stdout(io.StringIO()):
            failures = compare_benchmarks.compare(
                _result(10.0, 100.0), candidate, 10.0
            )

        self.assertEqual(failures, [])

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

| Package | Checker | Files checked | Time | Time delta | Peak memory | Memory delta | Status |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| example | pyright | 123 | 12.000s | +20.0% | 105.0 MB | +5.0% | 🔴 Regression |

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

| Package | Checker | Files checked | Time | Time delta | Peak memory | Memory delta | Status |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| example | pyright | 123 | 10.000s | +0.0% | 100.0 MB | +0.0% | 🟢 Pass |

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
            "| example | mypy | N/A | 20.000s | N/A | 200.0 MB | N/A | 🟡 No baseline |",
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

        self.assertEqual(int(timeout_match.group(1)), 1800)
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
        weekly_workflow_path = (
            REPO_ROOT / ".github" / "workflows" / "typecheck_benchmark_weekly.yml"
        )
        weekly_workflow_data = _load_yaml(weekly_workflow_path)
        self.assertEqual(
            weekly_workflow_data["jobs"]["benchmark"]["if"],
            "${{ github.repository == 'microsoft/pyright' }}",
        )
        self.assertEqual(
            weekly_workflow_data["jobs"]["report"]["if"],
            "${{ always() && github.repository == 'microsoft/pyright' }}",
        )
        self.assertEqual(
            weekly_workflow_data["jobs"]["benchmark"]["strategy"]["matrix"]["checker"],
            ["pyright", "pyrefly", "ty", "mypy", "zuban"],
        )
        weekly_benchmark_steps = weekly_workflow_data["jobs"]["benchmark"]["steps"]
        self.assertEqual(
            [step.get("uses") for step in weekly_benchmark_steps],
            [
                "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
                "actions/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97",
                None,
                None,
                "pnpm/action-setup@f520eceda224fe1a4aed5a2a27a194379a409996",
                "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
                None,
                None,
                "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
            ],
        )
        self.assertEqual(
            weekly_benchmark_steps[1]["with"],
            {
                "python-version": "${{ env.PYTHON_VERSION }}",
                "cache": "pip",
                "cache-dependency-path": "build/benchmark/install_envs.json\n.github/workflows/typecheck_benchmark_weekly.yml\n",
            },
        )
        self.assertEqual(
            weekly_benchmark_steps[5]["with"],
            {
                "node-version": "${{ env.NODE_VERSION }}",
                "cache": "pnpm",
                "cache-dependency-path": "pnpm-lock.yaml",
            },
        )
        self.assertEqual(
            weekly_benchmark_steps[3]["if"],
            "${{ matrix.checker != 'pyright' }}",
        )
        self.assertEqual(
            weekly_benchmark_steps[4]["if"],
            "${{ matrix.checker == 'pyright' }}",
        )
        self.assertEqual(
            weekly_benchmark_steps[5]["if"],
            "${{ matrix.checker == 'pyright' }}",
        )
        self.assertEqual(
            weekly_benchmark_steps[6],
            {
                "name": "Build Pyright CLI",
                "if": "${{ matrix.checker == 'pyright' }}",
                "timeout-minutes": 10,
                "env": {"SKIP_LERNA_BOOTSTRAP": "yes"},
                "run": "pnpm install --frozen-lockfile --prefer-offline\npnpm --dir packages/pyright run build\n",
            },
        )
        self.assertEqual(
            weekly_benchmark_steps[7]["env"],
            {
                "BENCHMARK_RUNNER_CLASS": "github-ubuntu-latest",
                "NODE_OPTIONS": "${{ matrix.checker == 'pyright' && '--max-old-space-size=6656' || '' }}",
                "PYTHONNOUSERSITE": "1",
            },
        )
        self.assertEqual(
            weekly_benchmark_steps[7]["run"],
            "checkers=('${{ matrix.checker }}')\nextra_args=()\nif [[ '${{ matrix.checker }}' == 'pyright' ]]; then\n  checkers+=(pyright-threads)\n  extra_args+=(--skip-pyright-build)\nfi\npython build/benchmark/typecheck_benchmark.py \\\n  -c \"${checkers[@]}\" -r 3 -w 1 -t 1800 \\\n  --memory-limit-mb 8192 --os-name linux-x64 \\\n  --output build/benchmark/results \\\n  \"${extra_args[@]}\"\n",
        )
        weekly_report_steps = weekly_workflow_data["jobs"]["report"]["steps"]
        self.assertEqual(
            [step.get("uses") for step in weekly_report_steps],
            [
                "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
                "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
                None,
                "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
                None,
            ],
        )
        self.assertEqual(
            weekly_workflow_data["jobs"]["publish"],
            {
                "name": "Publish comparison report",
                "needs": "report",
                "if": "${{ github.repository == 'microsoft/pyright' && github.ref == 'refs/heads/main' }}",
                "permissions": {
                    "actions": "read",
                    "contents": "read",
                    "pages": "write",
                    "id-token": "write",
                },
                "uses": "./.github/workflows/publish_pages.yml",
                "with": {"benchmark-run-id": "${{ github.run_id }}"},
            },
        )

        docs_workflow_path = REPO_ROOT / ".github" / "workflows" / "publish_docs.yml"
        docs_workflow_data = _load_yaml(docs_workflow_path)
        self.assertEqual(
            docs_workflow_data,
            {
                "name": "Publish documentation site",
                "on": {
                    "push": {
                        "branches": ["main"],
                        "paths": [
                            ".github/workflows/publish_docs.yml",
                            ".github/workflows/publish_pages.yml",
                            "docs/**",
                        ],
                    },
                    "workflow_dispatch": None,
                },
                "permissions": {},
                "jobs": {
                    "publish": {
                        "name": "Publish current documentation",
                        "if": "${{ github.repository == 'microsoft/pyright' && github.ref == 'refs/heads/main' }}",
                        "permissions": {
                            "actions": "read",
                            "contents": "read",
                            "pages": "write",
                            "id-token": "write",
                        },
                        "uses": "./.github/workflows/publish_pages.yml",
                    }
                },
            },
        )

        pages_workflow_path = (
            REPO_ROOT / ".github" / "workflows" / "publish_pages.yml"
        )
        pages_workflow_data = _load_yaml(pages_workflow_path)
        self.assertEqual(
            pages_workflow_data["on"],
            {
                "workflow_call": {
                    "inputs": {
                        "benchmark-run-id": {
                            "description": "Workflow run containing the weekly benchmark report artifact",
                            "required": False,
                            "default": "",
                            "type": "string",
                        },
                        "history-run-id": {
                            "description": "Workflow run containing the Pyright release history artifact",
                            "required": False,
                            "default": "",
                            "type": "string",
                        },
                    }
                }
            },
        )
        pages_job = pages_workflow_data["jobs"]["publish"]
        self.assertEqual(
            {
                key: pages_job[key]
                for key in (
                    "name",
                    "runs-on",
                    "permissions",
                    "concurrency",
                    "environment",
                )
            },
            {
                "name": "Publish documentation site",
                "runs-on": "ubuntu-latest",
                "permissions": {
                    "actions": "read",
                    "contents": "read",
                    "pages": "write",
                    "id-token": "write",
                },
                "concurrency": {"group": "pages", "cancel-in-progress": True},
                "environment": {
                    "name": "github-pages",
                    "url": "${{ steps.deployment.outputs.page_url }}",
                },
            },
        )
        steps = pages_job["steps"]
        self.assertEqual(
            [step.get("name") for step in steps],
            [
                None,
                "Find retained report artifacts",
                "Download latest benchmark report",
                "Download Pyright release history",
                "Add report to documentation site",
                "Configure Pages",
                "Upload Pages artifact",
                "Deploy to GitHub Pages",
            ],
        )
        self.assertEqual(
            [step.get("uses") for step in steps],
            [
                "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
                "actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3",
                "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
                "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
                None,
                "actions/configure-pages@45bfe0192ca1faeb007ade9deae92b16b8254a0d",
                "actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9",
                "actions/deploy-pages@368f82528645a54fb793d4d04e342629a3f51346",
            ],
        )
        self.assertEqual(
            steps[0]["with"],
            {"ref": "main", "persist-credentials": False},
        )
        self.assertEqual(
            steps[2]["with"],
            {
                "pattern": "weekly-typecheck-report-*",
                "path": "weekly-report",
                "merge-multiple": True,
                "repository": "${{ github.repository }}",
                "run-id": "${{ steps.reports.outputs.benchmark-run-id }}",
                "github-token": "${{ secrets.GITHUB_TOKEN }}",
            },
        )
        self.assertEqual(
            steps[3]["with"],
            {
                "name": "pyright-release-history",
                "path": "release-history",
                "repository": "${{ github.repository }}",
                "run-id": "${{ steps.reports.outputs.history-run-id }}",
                "github-token": "${{ secrets.GITHUB_TOKEN }}",
            },
        )
        self.assertEqual(
            steps[6]["with"],
            {"path": "docs", "include-hidden-files": True},
        )

        pr_workflow_path = (
            REPO_ROOT / ".github" / "workflows" / "typecheck_benchmark_pr.yml"
        )
        pr_workflow_data = _load_yaml(pr_workflow_path)
        self.assertEqual(
            pr_workflow_data["run-name"],
            "Type checker benchmark for PR #${{ inputs.pr_number }}",
        )
        self.assertEqual(
            pr_workflow_data["env"],
            {
                "BENCHMARK_RUNNER_CLASS": "github-ubuntu-latest",
                "NODE_VERSION": "24.15.0",
                "PYTHON_VERSION": "3.14.6",
            },
        )
        pr_benchmark_steps = pr_workflow_data["jobs"]["benchmark"]["steps"]
        self.assertEqual(
            pr_workflow_data["jobs"]["benchmark"]["if"],
            "${{ github.repository == 'microsoft/pyright' }}",
        )
        self.assertEqual(
            pr_workflow_data["jobs"]["comment"]["if"],
            "${{ always() && needs.benchmark.result != 'cancelled' && github.repository == 'microsoft/pyright' }}",
        )
        self.assertEqual(
            [step.get("uses") for step in pr_benchmark_steps],
            [
                "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
                "actions/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97",
                "pnpm/action-setup@f520eceda224fe1a4aed5a2a27a194379a409996",
                "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
                None,
                None,
                "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
                None,
                None,
                None,
                None,
                "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
                None,
            ],
        )
        self.assertEqual(
            pr_benchmark_steps[5],
            {
                "name": "Install JavaScript dependencies",
                "timeout-minutes": 10,
                "env": {"SKIP_LERNA_BOOTSTRAP": "yes"},
                "run": "pnpm install --frozen-lockfile --prefer-offline",
            },
        )
        self.assertEqual(
            pr_benchmark_steps[9]["env"],
            {
                "NODE_OPTIONS": "--max-old-space-size=6656",
                "PYTHONNOUSERSITE": "1",
            },
        )
        history_workflow_data = _load_yaml(
            REPO_ROOT
            / ".github"
            / "workflows"
            / "typecheck_benchmark_history.yml"
        )
        self.assertEqual(
            history_workflow_data["jobs"]["releases"]["if"],
            "${{ github.repository == 'microsoft/pyright' }}",
        )
        self.assertEqual(
            history_workflow_data["jobs"]["benchmark"]["if"],
            "${{ github.repository == 'microsoft/pyright' }}",
        )
        self.assertEqual(
            history_workflow_data["jobs"]["report"]["if"],
            "${{ always() && github.repository == 'microsoft/pyright' && needs.releases.result == 'success' }}",
        )

    def test_pr_benchmark_requires_authorized_comment(self) -> None:
        trigger_workflow_path = (
            REPO_ROOT
            / ".github"
            / "workflows"
            / "typecheck_benchmark_trigger.yml"
        )
        trigger_workflow = trigger_workflow_path.read_text(encoding="utf-8")
        trigger_workflow_data = _load_yaml(trigger_workflow_path)
        benchmark_workflow_path = (
            REPO_ROOT / ".github" / "workflows" / "typecheck_benchmark_pr.yml"
        )
        benchmark_workflow = benchmark_workflow_path.read_text(encoding="utf-8")
        benchmark_workflow_data = _load_yaml(benchmark_workflow_path)

        self.assertEqual(
            trigger_workflow_data["on"],
            {
                "issue_comment": {"types": ["created"]},
                "pull_request_target": {
                    "types": [
                        "opened",
                        "reopened",
                        "synchronize",
                        "ready_for_review",
                    ],
                    "paths": ["packages/pyright-internal/src/analyzer/**"],
                },
            },
        )
        self.assertIn(
            "context.payload.comment.body.trim() !== '/benchmark'", trigger_workflow
        )
        self.assertEqual(
            trigger_workflow_data["jobs"]["trigger"]["if"],
            "${{ github.repository == 'microsoft/pyright' && ((github.event_name == 'pull_request_target' && !github.event.pull_request.draft) || (github.event_name == 'issue_comment' && github.event.issue.pull_request && startsWith(github.event.comment.body, '/benchmark'))) }}",
        )
        self.assertNotIn("github.event.issue.state == 'open'", trigger_workflow)
        self.assertIn(
            "pullRequest.data.state !== 'open' && !pullRequest.data.merged",
            trigger_workflow,
        )
        self.assertIn("github.rest.repos.getCommit", trigger_workflow)
        self.assertIn("candidateCommit.data.parents[0]?.sha", trigger_workflow)
        self.assertIn(
            "const automatic = context.eventName === 'pull_request_target'",
            trigger_workflow,
        )
        self.assertIn(
            "candidateCommit.data.parents[1]?.sha !== pullRequest.data.head.sha",
            trigger_workflow,
        )
        self.assertNotIn("pullRequest.data.base.sha", trigger_workflow)
        self.assertIn("getCollaboratorPermissionLevel", trigger_workflow)
        self.assertIn("['admin', 'maintain', 'write']", trigger_workflow)
        self.assertIn("actions: write", trigger_workflow)
        self.assertIn("pull-requests: read", trigger_workflow)
        self.assertIn("createWorkflowDispatch", trigger_workflow)
        self.assertIn("workflow_id: 'typecheck_benchmark_pr.yml'", trigger_workflow)
        self.assertIn("base_sha: baseSha", trigger_workflow)
        self.assertIn("merge_sha: candidateSha", trigger_workflow)
        self.assertNotIn("actions/checkout", trigger_workflow)
        self.assertIn(
            "actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3 # v9.0.0",
            trigger_workflow,
        )
        self.assertNotIn("actions/github-script@v7", trigger_workflow)
        self.assertIn(
            "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7",
            benchmark_workflow,
        )
        self.assertIn(
            "actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3 # v9.0.0",
            benchmark_workflow,
        )
        self.assertNotIn("actions/checkout@v4", benchmark_workflow)
        self.assertNotIn("actions/github-script@v7", benchmark_workflow)
        self.assertIn("workflow_dispatch:", benchmark_workflow)
        self.assertNotIn("paths:", benchmark_workflow)
        self.assertNotIn("pull_request:", benchmark_workflow)
        self.assertNotIn("cache: 'pip'", benchmark_workflow)
        self.assertNotIn("cache: 'pnpm'", benchmark_workflow)
        self.assertIn("persist-credentials: false", benchmark_workflow)
        self.assertIn("inputs.base_sha", benchmark_workflow)
        self.assertIn("ref: ${{ inputs.merge_sha }}", benchmark_workflow)
        self.assertIn("-merge-${{ inputs.merge_sha }}", benchmark_workflow)
        self.assertIn("run_id: context.runId", benchmark_workflow)
        self.assertIn(
            "candidateCommit.data.parents[0]?.sha !== expectedBaseSha",
            benchmark_workflow,
        )
        self.assertIn(
            "candidateCommit.data.parents[1]?.sha !== expectedHeadSha",
            benchmark_workflow,
        )
        self.assertIn(
            "pullRequest.data.merge_commit_sha !== expectedMergeSha",
            benchmark_workflow,
        )
        self.assertIn("pullRequest.data.merged &&", benchmark_workflow)
        self.assertIn(
            "Compared candidate \\`${process.env.CANDIDATE_SHA}\\` against its first parent",
            benchmark_workflow,
        )
        self.assertEqual(
            [
                step.get("with")
                for step in benchmark_workflow_data["jobs"]["comment"]["steps"]
                if step.get("name") == "Check out trusted baseline"
            ],
            [
                {
                    "ref": "${{ inputs.base_sha }}",
                    "path": "benchmark-baseline",
                    "sparse-checkout": "build/benchmark/baselines",
                    "persist-credentials": False,
                }
            ],
        )
        self.assertIn(
            "benchmark-baseline/build/benchmark/baselines/latest-linux-x64.json",
            benchmark_workflow,
        )
        benchmark_job = benchmark_workflow_data["jobs"]["benchmark"]
        comment_job = benchmark_workflow_data["jobs"]["comment"]
        self.assertEqual(benchmark_job["permissions"], {"contents": "read"})
        self.assertEqual(
            comment_job["permissions"],
            {
                "actions": "read",
                "contents": "read",
                "pull-requests": "write",
            },
        )
        self.assertEqual(comment_job["needs"], "benchmark")
        self.assertEqual(
            [
                job_name
                for job_name, job in benchmark_workflow_data["jobs"].items()
                if job.get("permissions", {}).get("pull-requests") == "write"
            ],
            ["comment"],
        )
        self.assertFalse(
            (
                REPO_ROOT
                / ".github"
                / "workflows"
                / "typecheck_benchmark_comment.yml"
            ).exists()
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
