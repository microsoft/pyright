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
                        "execution_time_stats": {
                            "min": time,
                            "max": time,
                            "mean": time,
                            "median": time,
                            "stddev": 0.0,
                        },
                        "peak_memory_stats": {
                            "min": memory,
                            "max": memory,
                            "mean": memory,
                            "median": memory,
                            "stddev": 0.0,
                        },
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

    def test_compares_median_run_statistics(self) -> None:
        baseline = _result(100.0, 1000.0)
        candidate = _result(100.0, 1000.0)
        baseline_metrics = baseline["results"][0]["metrics"]["pyright"]
        candidate_metrics = candidate["results"][0]["metrics"]["pyright"]
        baseline_metrics["execution_time_stats"]["median"] = 10.0
        baseline_metrics["peak_memory_stats"]["median"] = 100.0
        candidate_metrics["execution_time_stats"]["median"] = 11.0
        candidate_metrics["peak_memory_stats"]["median"] = 105.0

        with redirect_stdout(io.StringIO()):
            failures = compare_benchmarks.compare(
                baseline, candidate, 20.0, statistic="median"
            )
        report = compare_benchmarks.render_markdown(
            baseline, candidate, 20.0, statistic="median"
        )

        self.assertEqual(failures, [])
        self.assertIn("Statistic: `median`", report)
        self.assertIn("| example | pyright | 123 | 11.000s | +10.0%", report)

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

    def test_pr_workflow_uses_paired_multi_run_profile(self) -> None:
        workflow = (
            REPO_ROOT / ".github" / "workflows" / "typecheck_benchmark_pr.yml"
        ).read_text(encoding="utf-8")
        profile_matches = re.findall(
            r"typecheck_benchmark\.py \\\s+"
            r"-c pyright -r (\d+) -w (\d+) -t (\d+)",
            workflow,
        )

        self.assertEqual(profile_matches, [("3", "1", "1800"), ("3", "1", "1800")])
        self.assertEqual(workflow.count("--statistic median"), 2)
        self.assertIn("--candidate-statistic median", workflow)

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
                "actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9",
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
            {"node-version": "${{ env.NODE_VERSION }}"},
        )
        self.assertEqual(
            weekly_benchmark_steps[6],
            {
                "name": "Locate benchmark pnpm store",
                "if": "${{ matrix.checker == 'pyright' }}",
                "id": "benchmark-pnpm",
                "run": 'echo "path=$(pnpm store path --silent)" >> "$GITHUB_OUTPUT"\necho "lock-hash=$(sha256sum pnpm-lock.yaml | cut -d\' \' -f1)" >> "$GITHUB_OUTPUT"\n',
            },
        )
        self.assertEqual(
            weekly_benchmark_steps[7],
            {
                "name": "Restore and save trusted benchmark pnpm store",
                "if": "${{ matrix.checker == 'pyright' }}",
                "uses": "actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9",
                "with": {
                    "path": "${{ steps.benchmark-pnpm.outputs.path }}",
                    "key": "typecheck-benchmark-pnpm-${{ runner.os }}-node-${{ env.NODE_VERSION }}-${{ steps.benchmark-pnpm.outputs.lock-hash }}",
                },
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
            weekly_benchmark_steps[8],
            {
                "name": "Build Pyright CLI",
                "if": "${{ matrix.checker == 'pyright' }}",
                "timeout-minutes": 10,
                "env": {"SKIP_LERNA_BOOTSTRAP": "yes"},
                "run": "pnpm install --frozen-lockfile --prefer-offline\npnpm --dir packages/pyright run build\n",
            },
        )
        self.assertEqual(
            weekly_benchmark_steps[9]["env"],
            {
                "BENCHMARK_RUNNER_CLASS": "github-ubuntu-latest",
                "NODE_OPTIONS": "${{ matrix.checker == 'pyright' && '--max-old-space-size=6656' || '' }}",
                "PYTHONNOUSERSITE": "1",
            },
        )
        self.assertEqual(
            weekly_benchmark_steps[9]["run"],
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
                "Download retained PR histories",
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
            steps[4]["env"],
            {"GH_TOKEN": "${{ secrets.GITHUB_TOKEN }}"},
        )
        self.assertIn("pr-history-artifacts.json", steps[4]["run"])
        self.assertIn("pr_history_artifacts.py", steps[4]["run"])
        self.assertIn("retained-pr-histories.json", steps[4]["run"])
        self.assertIn(".run_attempt", steps[4]["run"])
        self.assertIn(
            "pr-histories/$pr_number/$run_id/$run_attempt",
            steps[4]["run"],
        )
        self.assertIn("listArtifactsForRepo", steps[1]["with"]["script"])
        self.assertIn(
            "attempt-(\\d+)-base",
            steps[1]["with"]["script"],
        )
        self.assertIn(
            "run.data.path !== '.github/workflows/typecheck_benchmark_trigger.yml'",
            steps[1]["with"]["script"],
        )
        self.assertEqual(
            steps[7]["with"],
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
            "${{ always() && needs.aggregate.result != 'cancelled' && github.repository == 'microsoft/pyright' }}",
        )
        self.assertEqual(
            [step.get("uses") for step in pr_benchmark_steps],
            [
                "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
                "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
                "actions/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97",
                "pnpm/action-setup@f520eceda224fe1a4aed5a2a27a194379a409996",
                "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
                None,
                "actions/cache/restore@55cc8345863c7cc4c66a329aec7e433d2d1c52a9",
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
            ],
        )
        self.assertEqual(
            pr_benchmark_steps[5],
            {
                "name": "Locate benchmark pnpm store",
                "id": "benchmark-pnpm",
                "run": 'echo "path=$(pnpm store path --silent)" >> "$GITHUB_OUTPUT"\necho "lock-hash=$(sha256sum benchmark-base/pnpm-lock.yaml | cut -d\' \' -f1)" >> "$GITHUB_OUTPUT"\n',
            },
        )
        self.assertEqual(
            pr_benchmark_steps[6],
            {
                "name": "Restore trusted benchmark pnpm store",
                "uses": "actions/cache/restore@55cc8345863c7cc4c66a329aec7e433d2d1c52a9",
                "with": {
                    "path": "${{ steps.benchmark-pnpm.outputs.path }}",
                    "key": "typecheck-benchmark-pnpm-${{ runner.os }}-node-${{ env.NODE_VERSION }}-${{ steps.benchmark-pnpm.outputs.lock-hash }}",
                },
            },
        )
        self.assertEqual(
            pr_benchmark_steps[8],
            {
                "name": "Install base JavaScript dependencies",
                "timeout-minutes": 10,
                "working-directory": "benchmark-base",
                "env": {"SKIP_LERNA_BOOTSTRAP": "yes"},
                "run": "pnpm install --frozen-lockfile --prefer-offline",
            },
        )
        self.assertEqual(
            pr_benchmark_steps[11],
            {
                "name": "Install candidate JavaScript dependencies",
                "timeout-minutes": 10,
                "env": {"SKIP_LERNA_BOOTSTRAP": "yes"},
                "run": "pnpm install --frozen-lockfile --prefer-offline",
            },
        )
        self.assertEqual(
            pr_benchmark_steps[10]["working-directory"],
            "benchmark-base",
        )
        self.assertEqual(
            pr_benchmark_steps[10]["env"],
            {
                "NODE_OPTIONS": "--max-old-space-size=6656",
                "PYTHONNOUSERSITE": "1",
            },
        )
        self.assertEqual(
            pr_benchmark_steps[13]["env"],
            {
                "NODE_OPTIONS": "--max-old-space-size=6656",
                "PYTHONNOUSERSITE": "1",
                "PYRIGHT_BENCHMARK_ENTRY_POINT": "${{ github.workspace }}/packages/pyright/index.js",
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

    def test_pages_skips_unavailable_pr_history_runs(self) -> None:
        script = r"""
const assert = require('assert').strict;
const fs = require('fs');
const YAML = require('yaml');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const workflow = YAML.parse(fs.readFileSync('.github/workflows/publish_pages.yml', 'utf8'));
const script = workflow.jobs.publish.steps.find(
    (step) => step.name === 'Find retained report artifacts'
).with.script;
const discover = new AsyncFunction('github', 'context', 'core', 'process', 'require', script);
function artifact(id, changes = {}) {
    return {
        id, name: `typecheck-benchmark-history-pr-7-run-${id}-attempt-1-` +
            `base-${'a'.repeat(40)}-candidate-${'b'.repeat(40)}`,
        workflow_run: { id }, expired: false, created_at: '2026-10-07T00:00:00Z',
        ...changes,
    };
}
const artifacts = [
    artifact(1),
    artifact(2),
    artifact(3),
    artifact(4),
    artifact(5, { expired: true }),
    artifact(6, { name: 'unrelated' }),
    artifact(7, { workflow_run: undefined }),
];
async function check(error, candidates = artifacts) {
    const warnings = [];
    const outputs = {};
    const files = {};
    const lookups = [];
    const github = {
        rest: { actions: {
            listArtifactsForRepo: 'artifacts',
            getWorkflowRun: async ({ owner, repo, run_id }) => {
                assert.equal(owner, 'microsoft');
                assert.equal(repo, 'pyright');
                lookups.push(run_id);
                if (run_id === 2 && error) throw error;
                return { data: { path: run_id === 4
                    ? '.github/workflows/unrelated.yml'
                    : '.github/workflows/typecheck_benchmark_trigger.yml' } };
            },
        } },
        paginate: async (method) => {
            assert.equal(method, 'artifacts');
            return candidates;
        },
    };
    const core = {
        warning: (message) => warnings.push(message),
        setOutput: (name, value) => { outputs[name] = value; },
        setFailed: (message) => { throw new Error(message); },
    };
    await discover(
        github,
        { repo: { owner: 'microsoft', repo: 'pyright' } },
        core,
        { env: { BENCHMARK_RUN_ID: '100', HISTORY_RUN_ID: '101' } },
        (name) => {
            assert.equal(name, 'fs');
            return { writeFileSync: (path, contents) => { files[path] = contents; } };
        }
    );
    return { warnings, outputs, lookups, retained: JSON.parse(files['pr-history-artifacts.json']) };
}
async function main() {
    const result = await check({ status: 404 });
    assert.deepEqual(result.lookups, [1, 2, 3, 4]);
    assert.deepEqual(result.retained, [artifacts[0], artifacts[2]].map((artifact) => ({
        id: artifact.id, name: artifact.name, run_id: artifact.workflow_run.id,
        created_at: artifact.created_at,
    })));
    assert.deepEqual(result.warnings, [
        'Skipping PR history artifact 2: workflow run 2 is unavailable (404).',
    ]);
    assert.deepEqual(result.outputs, { 'benchmark-run-id': '100', 'history-run-id': '101' });
    const available = await check();
    assert.deepEqual(available.retained.map((artifact) => artifact.id), [1, 2, 3]);
    assert.deepEqual(available.warnings, []);
    const missing = await check({ status: 404 }, [artifact(2)]);
    assert.deepEqual(missing.retained, []);
    assert.equal(missing.warnings.length, 1);
    for (const error of [{ status: 403 }, { status: 429 }, { status: 500 }, new Error('network')]) {
        await assert.rejects(check(error), (thrown) => thrown === error);
    }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
"""
        subprocess.run(
            ["node", "-e", script],
            cwd=REPO_ROOT,
            check=True,
            capture_output=True,
            text=True,
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
                "workflow_run": {
                    "workflows": ["Validation"],
                    "types": ["completed"],
                },
            },
        )
        self.assertIn(
            "context.payload.comment.body.trim() !== '/benchmark'", trigger_workflow
        )
        self.assertEqual(
            trigger_workflow_data["jobs"]["trigger"]["if"],
            "${{ github.repository == 'microsoft/pyright' && ((github.event_name == 'workflow_run' && github.event.workflow_run.event == 'pull_request' && github.event.workflow_run.conclusion == 'success') || (github.event_name == 'issue_comment' && github.event.issue.pull_request && startsWith(github.event.comment.body, '/benchmark'))) }}",
        )
        self.assertNotIn("github.event.issue.state == 'open'", trigger_workflow)
        self.assertIn(
            "pullRequest.data.state !== 'open' && !pullRequest.data.merged",
            trigger_workflow,
        )
        self.assertIn("github.rest.repos.getCommit", trigger_workflow)
        self.assertIn("candidateCommit.data.parents[0]?.sha", trigger_workflow)
        self.assertIn(
            "require('./build/resolveValidatedPullRequest.js')",
            trigger_workflow,
        )
        self.assertIn(
            "candidateCommit.data.parents[1]?.sha !== pullRequest.data.head.sha",
            trigger_workflow,
        )
        self.assertNotIn("pullRequest.data.base.sha", trigger_workflow)
        self.assertIn("getCollaboratorPermissionLevel", trigger_workflow)
        self.assertIn("['admin', 'maintain', 'write']", trigger_workflow)
        self.assertEqual(
            trigger_workflow_data["permissions"],
            {"contents": "read", "pull-requests": "write"},
        )
        self.assertEqual(
            trigger_workflow_data["jobs"]["trigger"]["permissions"],
            {
                "actions": "read",
                "contents": "read",
                "pull-requests": "read",
                "checks": "write",
            },
        )
        self.assertNotIn("actions: write", trigger_workflow)
        self.assertNotIn("createWorkflowDispatch", trigger_workflow)
        self.assertEqual(
            trigger_workflow_data["jobs"]["benchmark"]["uses"],
            "./.github/workflows/typecheck_benchmark_pr.yml",
        )
        self.assertEqual(
            trigger_workflow_data["jobs"]["benchmark"]["with"],
            {
                "pr_number": "${{ needs.trigger.outputs.pr-number }}",
                "head_sha": "${{ needs.trigger.outputs.head-sha }}",
                "base_sha": "${{ needs.trigger.outputs.base-sha }}",
                "merge_sha": "${{ needs.trigger.outputs.merge-sha }}",
            },
        )
        self.assertEqual(
            trigger_workflow_data["jobs"]["benchmark"]["permissions"],
            {
                "actions": "read",
                "contents": "read",
                "id-token": "write",
                "pages": "write",
                "pull-requests": "write",
            },
        )
        checkout = trigger_workflow_data["jobs"]["trigger"]["steps"][0]
        self.assertEqual(
            checkout["with"],
            {
                "ref": "${{ github.event.repository.default_branch }}",
                "persist-credentials": False,
            },
        )
        self.assertIn("github.rest.actions.listWorkflowRuns", trigger_workflow)
        self.assertIn("status: 'success'", trigger_workflow)
        self.assertIn(
            "file.filename.startsWith('packages/pyright-internal/src/analyzer/')",
            trigger_workflow,
        )
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

    def test_primer_waits_for_validation_and_uses_read_only_candidate(self) -> None:
        workflow = _load_yaml(
            REPO_ROOT / ".github" / "workflows" / "mypy_primer_pr.yaml"
        )
        self.assertEqual(
            workflow["on"],
            {"workflow_run": {"workflows": ["Validation"], "types": ["completed"]}},
        )
        self.assertIn(
            "github.event.workflow_run.conclusion == 'success'",
            workflow["jobs"]["resolve"]["if"],
        )
        self.assertEqual(
            workflow["permissions"], {"contents": "read", "pull-requests": "read"}
        )
        primer = workflow["jobs"]["mypy_primer"]
        self.assertEqual(primer["needs"], "resolve")
        self.assertEqual(
            primer["if"], "${{ needs.resolve.outputs.pr-number != '' }}"
        )
        self.assertEqual(primer["permissions"], {"contents": "read"})
        checkout = primer["steps"][0]["with"]
        self.assertEqual(checkout["ref"], "${{ needs.resolve.outputs.merge-sha }}")
        self.assertFalse(checkout["persist-credentials"])
        self.assertFalse(
            any(step.get("with", {}).get("cache") for step in primer["steps"])
        )
        script = primer["steps"][5]["run"]
        self.assertNotIn("GITHUB_SHA", script)
        self.assertIn('git branch new_commit "$PRIMER_SHA"', script)

    def test_validated_pr_resolution_and_benchmark_only_path_filter(self) -> None:
        script = r"""
const assert = require('assert').strict;
const fs = require('fs');
const YAML = require('yaml');
const resolve = require('./build/resolveValidatedPullRequest.js');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const workflows = ['typecheck_benchmark_trigger.yml', 'mypy_primer_pr.yaml'].map(
    (name) => YAML.parse(fs.readFileSync(`.github/workflows/${name}`, 'utf8'))
);
async function check(runChanges = {}, prChanges = {}, filenames = [], script, requireSuccess = true) {
    const run = {
        name: 'Validation', path: '.github/workflows/validation.yml',
        event: 'pull_request', conclusion: 'success',
        repository: { full_name: 'microsoft/pyright' },
        head_repository: { id: 17, owner: { login: 'external' } },
        head_branch: 'feature', head_sha: 'a'.repeat(40), ...runChanges,
    };
    const pr = {
        number: 7, state: 'open', merge_commit_sha: 'b'.repeat(40),
        head: { sha: 'a'.repeat(40), repo: { id: 17 } }, ...prChanges,
    };
    const outputs = {};
    const core = {
        notice: () => {}, setFailed: (message) => { throw new Error(message); },
        setOutput: (name, value) => { outputs[name] = value; },
    };
    const context = {
        eventName: 'workflow_run', repo: { owner: 'microsoft', repo: 'pyright' },
        payload: { workflow_run: run },
    };
    const github = {
        rest: {
            pulls: {
                list: 'list', listFiles: 'files', get: async () => ({ data: pr }),
            },
            repos: {
                getCommit: async () => ({ data: {
                    parents: [{ sha: 'c'.repeat(40) }, { sha: pr.head.sha }],
                } }),
            },
            checks: {
                listForRef: 'checks',
                create: async (parameters) => ({ data: { ...parameters, id: 42 } }),
            },
        },
        paginate: async (method, parameters) => {
            if (method === 'list') {
                assert.equal(parameters.head, 'external:feature');
                return [pr];
            }
            if (method === 'checks') return [];
            assert.equal(method, 'files');
            return filenames.map((filename) => ({ filename }));
        },
    };
    if (script) {
        await new AsyncFunction('github', 'context', 'core', 'require', script)(
            github, context, core, require
        );
        return outputs['pr-number'];
    }
    return resolve({ github, context, core, requireSuccess });
}
(async () => {
    assert.equal((await check()).pullRequest.number, 7);
    for (const conclusion of ['failure', 'cancelled', null]) {
        assert.equal(await check({ conclusion }), undefined);
        assert.equal((await check({ conclusion }, {}, [], undefined, false)).pullRequest.number, 7);
    }
    assert.equal(await check({ event: 'push' }), undefined);
    assert.equal(await check({ path: '.github/workflows/other.yml' }), undefined);
    assert.equal(await check({ repository: { full_name: 'external/pyright' } }), undefined);
    assert.equal(await check({}, { head: { sha: 'd'.repeat(40), repo: { id: 17 } } }), undefined);
    assert.equal(await check({}, { head: { sha: 'a'.repeat(40), repo: { id: 18 } } }), undefined);
    assert.equal(await check({}, { state: 'closed' }), undefined);
    const scripts = [
        workflows[0].jobs.trigger.steps.find((step) => step.id === 'resolve').with.script,
        workflows[1].jobs.resolve.steps.find((step) => step.id === 'resolve').with.script,
    ];
    for (const [filename, expected] of [
        ['packages/pyright-internal/src/analyzer/checker.ts', [7, 7]],
        ['packages/pyright-internal/src/tests/sample.py', [undefined, 7]],
        ['packages/pyright/index.js', [undefined, 7]],
        ['packages/pyright-internal/typeshed-fallback/stdlib/os.pyi', [undefined, 7]],
        ['README.md', [undefined, 7]],
        ['.github/workflows/validation.yml', [undefined, 7]],
    ]) {
        for (let index = 0; index < scripts.length; index++) {
            assert.equal(await check({}, {}, [filename], scripts[index]), expected[index]);
        }
    }
})().catch((error) => { console.error(error); process.exitCode = 1; });
"""
        subprocess.run(["node", "-e", script], cwd=REPO_ROOT, check=True)

    def test_follow_up_checks_are_queued_and_report_actual_results(self) -> None:
        script = r"""
const assert = require('assert').strict;
const fs = require('fs');
const YAML = require('yaml');
const report = require('./build/reportPullRequestCheck.js');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const load = (name) => YAML.parse(fs.readFileSync(`.github/workflows/${name}`, 'utf8'));
const queue = load('pr_follow_up_checks.yml');
assert.deepEqual(queue.on.pull_request_target, {
    branches: ['main'], types: ['opened', 'synchronize', 'reopened'],
});
assert.deepEqual(queue.on.workflow_run, { workflows: ['Validation'], types: ['completed'] });
assert.equal(queue.permissions.checks, 'write');
assert.ok(queue.jobs.report.if.includes("github.event.workflow_run.conclusion != 'success'"));
assert.deepEqual(queue.jobs.report.strategy.matrix.check, ['mypy_primer', 'Type checker benchmark']);
assert.equal(queue.jobs.report.concurrency['cancel-in-progress'], false);
assert.ok(queue.jobs.report.concurrency.group.includes('matrix.check'));
const workflows = [
    [load('mypy_primer_pr.yaml'), 'resolve', 'mypy_primer', 'RESOLVE_RESULT', 'PRIMER_RESULT'],
    [load('typecheck_benchmark_trigger.yml'), 'trigger', 'benchmark', 'TRIGGER_RESULT', 'BENCHMARK_RESULT'],
];
const context = {
    repo: { owner: 'microsoft', repo: 'pyright' },
    serverUrl: 'https://github.com', runId: 123,
};
let checks = [];
let nextId = 1;
const updates = [];
const github = {
    rest: { checks: {
        listForRef: 'checks',
        create: async (parameters) => {
            if (parameters.status === 'completed') {
                assert.ok(parameters.conclusion);
                assert.ok(Number.isFinite(Date.parse(parameters.completed_at)));
            }
            const check = { ...parameters, id: nextId++ };
            checks.unshift(check);
            return { data: check };
        },
        update: async (parameters) => {
            if (parameters.status === 'completed') {
                assert.ok(parameters.conclusion);
                assert.ok(Number.isFinite(Date.parse(parameters.completed_at)));
            }
            const check = checks.find((check) => check.id === parameters.check_run_id);
            assert.ok(check);
            Object.assign(check, parameters);
            updates.push(parameters);
            return { data: check };
        },
    } },
    paginate: async (method, parameters) => {
        assert.equal(method, 'checks');
        return checks.filter((check) =>
            check.head_sha === parameters.ref && check.name === parameters.check_name
        );
    },
};
const execute = async (script, eventContext = context) =>
    new AsyncFunction('github', 'context', 'core', 'require', script)(
        github, eventContext, { notice: () => {} }, require
    );
(async () => {
    const args = {
        github, context, name: 'mypy_primer', headSha: 'a'.repeat(40),
        status: 'queued', summary: 'Waiting for Validation to pass.',
    };
    const id = await report(args);
    assert.equal(checks[0].status, 'queued');
    assert.equal(checks[0].head_sha, args.headSha);
    assert.equal(checks[0].details_url, 'https://github.com/microsoft/pyright/actions/runs/123');
    await report(args);
    assert.equal(checks.length, 1);
    assert.equal(await report({ ...args, status: 'in_progress' }), id);
    assert.ok(Number.isFinite(Date.parse(checks[0].started_at)));
    await report(args);
    assert.equal(checks[0].status, 'in_progress');
    await report({ ...args, status: 'completed', conclusion: 'skipped' });
    assert.equal(checks[0].status, 'in_progress');
    const rerunId = await report({ ...args, status: 'in_progress' });
    assert.notEqual(rerunId, id);
    await report({ ...args, checkId: id, conclusion: 'cancelled' });
    assert.equal(checks[0].status, 'in_progress');
    assert.equal(checks[1].conclusion, 'cancelled');
    await report({ ...args, checkId: rerunId, conclusion: 'success' });
    await report(args);
    assert.equal(checks[0].conclusion, 'success');
    await report({ ...args, headSha: 'b'.repeat(40) });
    assert.equal(checks[0].status, 'queued');
    await report({ ...args, headSha: 'b'.repeat(40), status: 'completed', conclusion: 'skipped' });
    assert.equal(checks[0].conclusion, 'skipped');
    await report({ ...args, headSha: 'd'.repeat(40), status: 'completed', conclusion: 'skipped' });
    assert.equal(checks[0].conclusion, 'skipped');

    for (const [workflow, resolveJob, workerJob, resolveEnv, workerEnv] of workflows) {
        const resolver = workflow.jobs[resolveJob];
        const reporter = workflow.jobs.report;
        assert.equal(resolver.permissions.checks, 'write');
        assert.equal(resolver.concurrency['cancel-in-progress'], false);
        assert.ok(resolver.concurrency.group.includes('github.event.workflow_run.head_sha'));
        assert.ok(resolver.outputs['check-id']);
        assert.deepEqual(reporter.needs, [resolveJob, workerJob]);
        assert.ok(reporter.if.includes('always()'));
        assert.ok(reporter.if.includes(`needs.${resolveJob}.outputs.check-id != ''`));
        assert.deepEqual(reporter.permissions, { contents: 'read', checks: 'write' });
        for (const job of [resolver, reporter]) {
            assert.equal(job.steps[0].with.ref, '${{ github.event.repository.default_branch }}');
            assert.equal(job.steps[0].with['persist-credentials'], false);
        }
        const step = reporter.steps[1];
        assert.equal(step.env.CHECK_ID, '${{ needs.' + resolveJob + '.outputs.check-id }}');
        assert.equal(step.env[resolveEnv], '${{ needs.' + resolveJob + '.result }}');
        assert.equal(step.env[workerEnv], '${{ needs.' + workerJob + '.result }}');
        for (const [resolveResult, workerResult, expected] of [
            ['success', 'success', 'success'],
            ['success', 'failure', 'failure'],
            ['failure', 'skipped', 'failure'],
            ['success', 'cancelled', 'cancelled'],
            ['cancelled', 'skipped', 'cancelled'],
            ['success', 'skipped', 'skipped'],
        ]) {
            process.env.CHECK_ID = String(rerunId);
            process.env[resolveEnv] = resolveResult;
            process.env[workerEnv] = workerResult;
            await execute(step.with.script);
            assert.equal(updates.at(-1).conclusion, expected);
        }
    }
    const primer = workflows[0][0].jobs.mypy_primer;
    const benchmark = load('typecheck_benchmark_pr.yml').jobs.benchmark;
    assert.deepEqual(primer.permissions, { contents: 'read' });
    assert.deepEqual(benchmark.permissions, { contents: 'read' });
    assert.equal(queue.jobs.report.steps[0].with.ref, '${{ github.event.repository.default_branch }}');
    assert.equal(queue.jobs.report.steps[0].with['persist-credentials'], false);
    const queueScript = queue.jobs.report.steps[1].with.script;
    assert.equal(queue.jobs.report.steps[1].env.CHECK_NAME, '${{ matrix.check }}');
    for (const name of queue.jobs.report.strategy.matrix.check) {
        process.env.CHECK_NAME = name;
        await execute(queueScript, {
            ...context, eventName: 'pull_request_target',
            payload: { pull_request: { head: { sha: 'c'.repeat(40) } } },
        });
    }
    assert.deepEqual(checks.slice(0, 2).map((check) => check.status), ['queued', 'queued']);
    assert.deepEqual(checks.slice(0, 2).map((check) => check.head_sha), ['c'.repeat(40), 'c'.repeat(40)]);
    await execute(queueScript, {
        ...context, eventName: 'workflow_run',
        payload: { workflow_run: {
            name: 'Validation', path: '.github/workflows/other.yml',
            event: 'pull_request', conclusion: 'failure',
        } },
    });
    assert.equal(checks[0].status, 'queued');
})().catch((error) => { console.error(error); process.exitCode = 1; });
"""
        subprocess.run(["node", "-e", script], cwd=REPO_ROOT, check=True)

    def test_benchmark_workflow_preserves_candidate_and_reporting(self) -> None:
        workflow_path = (
            REPO_ROOT / ".github" / "workflows" / "typecheck_benchmark_pr.yml"
        )
        benchmark_workflow = workflow_path.read_text(encoding="utf-8")
        benchmark_workflow_data = _load_yaml(workflow_path)
        self.assertNotIn("actions/checkout@v4", benchmark_workflow)
        self.assertNotIn("actions/github-script@v7", benchmark_workflow)
        self.assertIn("workflow_call:", benchmark_workflow)
        self.assertNotIn("workflow_dispatch:", benchmark_workflow)
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
        comment_steps = benchmark_workflow_data["jobs"]["comment"]["steps"]
        self.assertEqual(
            [
                step.get("name")
                for step in comment_steps
                if step.get("name") in (
                    "Render comparison history charts",
                    "Upload comparison history charts",
                )
            ],
            ["Render comparison history charts", "Upload comparison history charts"],
        )
        history_render = next(
            step
            for step in comment_steps
            if step.get("name") == "Render comparison history charts"
        )
        self.assertEqual(
            history_render,
            {
                "name": "Render comparison history charts",
                "if": "${{ steps.download.outputs.pr-number != '' }}",
                "run": "python build/benchmark/render_pyright_history.py \\\n  base.json \\\n  candidate.json \\\n  --existing-history docs/typecheck-benchmark/history/history.json \\\n  --candidate-label 'Base' \\\n  --candidate-label 'PR #${{ inputs.pr_number }}' \\\n  --candidate-statistic median \\\n  --output pr-history\n",
            },
        )
        history_upload = next(
            step
            for step in comment_steps
            if step.get("name") == "Upload comparison history charts"
        )
        self.assertEqual(
            {
                key: history_upload[key]
                for key in ("name", "id", "if", "uses", "with")
            },
            {
                "name": "Upload comparison history charts",
                "id": "history",
                "if": "${{ steps.download.outputs.pr-number != '' }}",
                "uses": "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
                "with": {
                    "name": "typecheck-benchmark-history-pr-${{ inputs.pr_number }}-run-${{ github.run_id }}-attempt-${{ github.run_attempt }}-base-${{ inputs.base_sha }}-candidate-${{ inputs.merge_sha }}",
                    "path": "pr-history/",
                    "if-no-files-found": "error",
                    "retention-days": 90,
                },
            },
        )
        post_comment = next(
            step for step in comment_steps if step.get("name") == "Post benchmark comment"
        )
        self.assertEqual(
            post_comment["env"],
            {
                "PR_NUMBER": "${{ steps.download.outputs.pr-number }}",
                "BASE_SHA": "${{ inputs.base_sha }}",
                "CANDIDATE_SHA": "${{ inputs.merge_sha }}",
                "HISTORY_ARTIFACT_URL": "${{ steps.history.outputs.artifact-url }}",
                "HISTORY_URL": "https://microsoft.github.io/pyright/typecheck-benchmark/pr/${{ inputs.pr_number }}/${{ github.run_id }}/${{ github.run_attempt }}/",
            },
        )
        packages_job = benchmark_workflow_data["jobs"]["packages"]
        benchmark_job = benchmark_workflow_data["jobs"]["benchmark"]
        aggregate_job = benchmark_workflow_data["jobs"]["aggregate"]
        comment_job = benchmark_workflow_data["jobs"]["comment"]
        publish_job = benchmark_workflow_data["jobs"]["publish"]
        self.assertEqual(
            packages_job["outputs"],
            {
                "count": "${{ steps.packages.outputs.count }}",
                "matrix": "${{ steps.packages.outputs.matrix }}",
            },
        )
        self.assertEqual(benchmark_job["needs"], "packages")
        self.assertEqual(benchmark_job["timeout-minutes"], 300)
        self.assertEqual(
            benchmark_job["strategy"],
            {
                "fail-fast": False,
                "matrix": {
                    "package": "${{ fromJson(needs.packages.outputs.matrix) }}"
                },
            },
        )
        self.assertIn("--package-names '${{ matrix.package }}'", benchmark_workflow)
        self.assertEqual(benchmark_job["permissions"], {"contents": "read"})
        self.assertEqual(aggregate_job["needs"], ["packages", "benchmark"])
        self.assertIn(
            "build/benchmark/merge_benchmark_results.py", benchmark_workflow
        )
        self.assertEqual(
            comment_job["permissions"],
            {
                "actions": "read",
                "contents": "read",
                "pull-requests": "write",
            },
        )
        self.assertEqual(comment_job["needs"], "aggregate")
        self.assertEqual(
            {
                key: publish_job[key]
                for key in ("needs", "if", "permissions", "uses")
            },
            {
                "needs": "comment",
                "if": "${{ needs.comment.result == 'success' && github.repository == 'microsoft/pyright' }}",
                "permissions": {
                    "actions": "read",
                    "contents": "read",
                    "id-token": "write",
                    "pages": "write",
                },
                "uses": "./.github/workflows/publish_pages.yml",
            },
        )
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

    def test_pr_workflow_benchmarks_exact_base_and_candidate(self) -> None:
        workflow = (
            REPO_ROOT / ".github" / "workflows" / "typecheck_benchmark_pr.yml"
        ).read_text(encoding="utf-8")

        self.assertIn("ref: ${{ inputs.base_sha }}", workflow)
        self.assertIn("working-directory: benchmark-base", workflow)
        self.assertIn(
            "--output ../build/benchmark/results/base",
            workflow,
        )
        self.assertIn(
            "--output build/benchmark/results/candidate",
            workflow,
        )
        self.assertEqual(
            workflow.count(
                "python benchmark-base/build/benchmark/typecheck_benchmark.py"
            ),
            1,
        )
        self.assertIn(
            "build/benchmark/results/base/latest-linux-x64.json",
            workflow,
        )
        self.assertIn(
            "build/benchmark/results/candidate/latest-linux-x64.json",
            workflow,
        )


if __name__ == "__main__":
    unittest.main()
