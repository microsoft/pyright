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
        "benchmark_profile_hash": "profile-v1",
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

    def test_rejects_unexpected_source_revision(self) -> None:
        baseline = _result(10.0, 100.0)
        candidate = _result(10.0, 100.0)
        baseline["source_revision"] = "a" * 40
        candidate["source_revision"] = "b" * 40

        failures = compare_benchmarks.compare(
            baseline,
            candidate,
            10.0,
            baseline_revision="c" * 40,
            candidate_revision="b" * 40,
        )

        self.assertEqual(
            failures,
            [
                "baseline: source revision "
                f"{'a' * 40!r} does not match {'c' * 40!r}"
            ],
        )

    def test_report_identifies_compared_revisions(self) -> None:
        baseline = _result(10.0, 100.0)
        candidate = _result(10.0, 100.0)
        baseline_revision = "a" * 40
        candidate_revision = "b" * 40
        baseline["source_revision"] = baseline_revision
        candidate["source_revision"] = candidate_revision

        report = compare_benchmarks.render_markdown(
            baseline,
            candidate,
            10.0,
            baseline_revision=baseline_revision,
            candidate_revision=candidate_revision,
        )

        self.assertIn(f"Base commit: `{baseline_revision}`", report)
        self.assertIn(f"Candidate merge commit: `{candidate_revision}`", report)

    def test_allows_successful_benchmark_profile_change(self) -> None:
        candidate = _result(10.0, 100.0)
        candidate["benchmark_profile_hash"] = "profile-v2"

        failures = compare_benchmarks.compare(
            _result(10.0, 100.0),
            candidate,
            10.0,
            allow_incompatible=True,
        )
        report = compare_benchmarks.render_markdown(
            _result(10.0, 100.0),
            candidate,
            10.0,
            allow_incompatible=True,
        )

        self.assertEqual(failures, [])
        self.assertIn("Performance results are not comparable", report)
        self.assertIn(r"benchmark\_profile\_hash", report)

    def test_incompatible_results_still_require_successful_measurements(self) -> None:
        candidate = _result(0.0, 0.0, ok=False)
        candidate["benchmark_profile_hash"] = "profile-v2"

        failures = compare_benchmarks.compare(
            _result(10.0, 100.0),
            candidate,
            10.0,
            allow_incompatible=True,
        )

        self.assertEqual(
            failures, ["candidate: example/pyright result failed or is missing"]
        )

    def test_pr_workflow_uses_matching_base_and_candidate_profiles(self) -> None:
        workflow = (
            REPO_ROOT / ".github" / "workflows" / "typecheck_benchmark_pr.yml"
        ).read_text(encoding="utf-8")
        timeout_matches = re.findall(
            r"typecheck_benchmark\.py \\\s+"
            r"-c pyright -r 1 -w 0 -t (\d+)",
            workflow,
        )
        self.assertEqual(timeout_matches, ["1800", "1800"])
        self.assertIn("data['source_revision'] = os.environ['BASE_SHA']", workflow)
        self.assertIn("data['source_revision'] = os.environ['MERGE_SHA']", workflow)
        self.assertIn("data['benchmark_profile_hash'] = profile.hexdigest()", workflow)
        self.assertNotIn("build/benchmark/baselines/", workflow)

    def test_workflows_use_current_pnpm_setup(self) -> None:
        for workflow_name in (
            "typecheck_benchmark_pr.yml",
            "typecheck_benchmark_weekly.yml",
        ):
            workflow = (
                REPO_ROOT / ".github" / "workflows" / workflow_name
            ).read_text(encoding="utf-8")

            self.assertIn("uses: pnpm/action-setup@", workflow)
            self.assertIn(
                "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7",
                workflow,
            )
            self.assertIn(
                "actions/setup-python@ece7cb06caefa5fff74198d8649806c4678c61a1 # v6",
                workflow,
            )
            self.assertIn("SKIP_LERNA_BOOTSTRAP: 'yes'", workflow)
            self.assertIn("--max-old-space-size=6656", workflow)
            self.assertIn("timeout-minutes: 10", workflow)
            self.assertIn("pnpm install --frozen-lockfile --prefer-offline", workflow)
            self.assertIn(
                "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1",
                workflow,
            )
            self.assertNotIn("actions/upload-artifact@v4", workflow)
            self.assertNotIn("actions/checkout@v4", workflow)
            self.assertNotIn("actions/setup-python@v5", workflow)
            self.assertNotIn("apt-get", workflow)
            self.assertNotIn(".github/actions/npm-cache-dir", workflow)

        weekly_workflow = (
            REPO_ROOT / ".github" / "workflows" / "typecheck_benchmark_weekly.yml"
        ).read_text(encoding="utf-8")
        self.assertIn("cache: 'pnpm'", weekly_workflow)
        self.assertIn("pnpm-lock.yaml", weekly_workflow)
        self.assertIn(
            "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1",
            weekly_workflow,
        )
        self.assertNotIn("actions/download-artifact@v4", weekly_workflow)

        pr_workflow = (
            REPO_ROOT / ".github" / "workflows" / "typecheck_benchmark_pr.yml"
        ).read_text(encoding="utf-8")
        self.assertIn(
            "run-name: 'Type checker benchmark for PR #${{ inputs.pr_number }}'",
            pr_workflow,
        )
        self.assertIn("PNPM_VERSION: '10.12.2'", pr_workflow)
        self.assertIn("version: ${{ env.PNPM_VERSION }}", pr_workflow)

    def test_pr_benchmark_requires_authorized_comment(self) -> None:
        trigger_workflow = (
            REPO_ROOT
            / ".github"
            / "workflows"
            / "typecheck_benchmark_trigger.yml"
        ).read_text(encoding="utf-8")
        benchmark_workflow_path = (
            REPO_ROOT / ".github" / "workflows" / "typecheck_benchmark_pr.yml"
        )
        benchmark_workflow = benchmark_workflow_path.read_text(encoding="utf-8")
        benchmark_workflow_data = _load_yaml(benchmark_workflow_path)

        self.assertIn("issue_comment:", trigger_workflow)
        self.assertIn(
            "startsWith(github.event.comment.body, '/benchmark')", trigger_workflow
        )
        self.assertIn(
            "context.payload.comment.body.trim() !== '/benchmark'", trigger_workflow
        )
        self.assertIn("github.event.issue.state == 'open'", trigger_workflow)
        self.assertIn("getCollaboratorPermissionLevel", trigger_workflow)
        self.assertIn("['admin', 'maintain', 'write']", trigger_workflow)
        self.assertIn("actions: write", trigger_workflow)
        self.assertIn("pull-requests: read", trigger_workflow)
        self.assertIn("createWorkflowDispatch", trigger_workflow)
        self.assertIn("workflow_id: 'typecheck_benchmark_pr.yml'", trigger_workflow)
        self.assertIn("base_sha: pullRequest.data.base.sha", trigger_workflow)
        self.assertIn("merge_sha: pullRequest.data.merge_commit_sha", trigger_workflow)
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
        self.assertIn("if: ${{ always() }}", benchmark_workflow)
        self.assertIn("run_id: context.runId", benchmark_workflow)
        self.assertIn("pullRequest.data.base.sha !== expectedBaseSha", benchmark_workflow)
        self.assertIn(
            "pullRequest.data.merge_commit_sha !== expectedMergeSha",
            benchmark_workflow,
        )
        base_job = benchmark_workflow_data["jobs"]["base-benchmark"]
        candidate_job = benchmark_workflow_data["jobs"]["candidate-benchmark"]
        comparison_job = benchmark_workflow_data["jobs"]["comparison"]
        comment_job = benchmark_workflow_data["jobs"]["comment"]
        self.assertEqual(base_job["permissions"], {"contents": "read"})
        self.assertEqual(candidate_job["permissions"], {"contents": "read"})
        self.assertEqual(comparison_job["permissions"], {"contents": "read"})
        self.assertEqual(
            comment_job["permissions"],
            {
                "actions": "read",
                "contents": "read",
                "pull-requests": "write",
            },
        )
        self.assertEqual(comment_job["needs"], "comparison")
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

    def test_pr_workflow_caches_only_the_base_result(self) -> None:
        workflow = (
            REPO_ROOT / ".github" / "workflows" / "typecheck_benchmark_pr.yml"
        ).read_text(encoding="utf-8")
        workflow_data = _load_yaml(
            REPO_ROOT / ".github" / "workflows" / "typecheck_benchmark_pr.yml"
        )
        base_job = json.dumps(workflow_data["jobs"]["base-benchmark"])
        candidate_job = json.dumps(workflow_data["jobs"]["candidate-benchmark"])

        self.assertIn("actions/cache/restore@0057852", base_job)
        self.assertIn("actions/cache/save@0057852", base_job)
        self.assertNotIn("restore-keys", base_job)
        self.assertNotIn("actions/cache/", candidate_job)
        self.assertIn("ref: ${{ inputs.base_sha }}", workflow)
        self.assertIn("ref: ${{ inputs.merge_sha }}", workflow)
        self.assertIn("--baseline-revision", workflow)
        self.assertIn("--candidate-revision", workflow)
        self.assertIn("--allow-incompatible", workflow)
        self.assertIn("issues.listComments", workflow)
        self.assertIn("updateComment", workflow)
        self.assertIn("comment.user?.login === 'github-actions[bot]'", workflow)
        self.assertIn("ref: ${{ github.sha }}", workflow)
        self.assertNotIn("git push", workflow)
        self.assertNotIn("contents: write", workflow)


if __name__ == "__main__":
    unittest.main()
