import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

import typecheck_benchmark as benchmark


class TypecheckBenchmarkTest(unittest.TestCase):
    def test_resolve_check_paths_excludes_named_directories(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            package_path = Path(temp_dir)
            (package_path / "source" / "tests").mkdir(parents=True)
            (package_path / "source" / "module.py").write_text("")
            (package_path / "source" / "types.pyi").write_text("")
            (package_path / "source" / "notes.txt").write_text("")
            (package_path / "source" / "tests" / "test_module.py").write_text("")

            paths, missing = benchmark._resolve_check_paths(
                package_path, ["source"], ["tests"]
            )

            self.assertEqual(missing, [])
            self.assertEqual(
                {path.relative_to(package_path).as_posix() for path in paths},
                {"source/module.py", "source/types.pyi"},
            )

    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory(
            prefix=".typecheck-benchmark-test-",
            dir=benchmark.SCRIPT_DIR,
        )
        self.root = Path(self.temp_dir.name)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_pyright_command_uses_package_entry_point(self) -> None:
        entry_point = self.root / "index.js"
        bundle = self.root / "dist" / "pyright.js"
        bundle.parent.mkdir()
        entry_point.touch()
        bundle.touch()

        with (
            patch.object(benchmark, "PYRIGHT_ENTRY_POINT", entry_point),
            patch.object(benchmark, "PYRIGHT_BUNDLE", bundle),
            patch.object(benchmark, "_executable", return_value="node"),
        ):
            command = benchmark._pyright_command()

        self.assertEqual(command, ["node", str(entry_point)])

    def test_skip_build_requires_entry_point_and_bundle(self) -> None:
        entry_point = self.root / "index.js"
        bundle = self.root / "dist" / "pyright.js"
        bundle.parent.mkdir()
        bundle.touch()

        with (
            patch.object(benchmark, "PYRIGHT_ENTRY_POINT", entry_point),
            patch.object(benchmark, "PYRIGHT_BUNDLE", bundle),
            patch.object(benchmark, "_executable", return_value="node"),
        ):
            with self.assertRaises(benchmark.BenchmarkError) as context:
                benchmark.prepare_local_pyright(skip_build=True)

        self.assertEqual(
            str(context.exception),
            f"--skip-pyright-build requires existing local Pyright files: {entry_point}",
        )

    def test_pyright_config_and_command(self) -> None:
        source_dir = self.root / "src"
        source_dir.mkdir()
        with patch.object(
            benchmark, "_checker_command", return_value=["node", "pyright.js"]
        ):
            command, configs = benchmark._build_checker_command(
                "pyright", self.root, [source_dir]
            )

        self.assertIsNotNone(command)
        self.assertEqual(command[:2], ["node", "pyright.js"])
        self.assertEqual(command[2], "--project")
        self.assertEqual(command[-1], "--stats")
        self.assertNotIn("--outputjson", command)
        config = json.loads(configs[0].read_text(encoding="utf-8"))
        self.assertEqual(config["include"], ["src"])
        self.assertEqual(config["exclude"], benchmark.PYRIGHT_DEFAULT_EXCLUDES)
        self.assertIs(config["useLibraryCodeForTypes"], True)
        configs[0].unlink()

    def test_load_install_envs_includes_source_only_packages(self) -> None:
        config_path = self.root / "install_envs.json"
        config_path.write_text(
            json.dumps(
                {
                    "packages": [
                        {
                            "github_url": "https://github.com/pallets/click",
                            "check_paths": ["src/click"],
                            "install": False,
                        }
                    ]
                }
            ),
            encoding="utf-8",
        )

        packages = benchmark.load_install_envs(config_path)

        self.assertEqual(len(packages), 1)
        self.assertEqual(packages[0]["name"], "click")

    def test_install_failure_is_a_package_failure(self) -> None:
        package = {
            "name": "example",
            "github_url": "https://example.com/example",
            "install": True,
        }
        with (
            patch.object(benchmark, "clone_package", return_value=self.root),
            patch.object(benchmark, "get_package_commit", return_value="abc123"),
            patch.object(benchmark, "install_deps", return_value=False),
            patch.object(benchmark, "_benchmark_directory") as run_directory,
        ):
            result = benchmark._benchmark_package(
                package, self.root, ["pyright"], 30, 1, 0, 4096
            )

        self.assertEqual(result["error"], "Dependency installation failed")
        self.assertEqual(result["commit"], "abc123")
        run_directory.assert_not_called()

    def test_zuban_uses_positional_paths_without_config(self) -> None:
        source_dir = self.root / "src"
        source_dir.mkdir()
        with patch.object(benchmark, "_checker_command", return_value=["zuban"]):
            command, configs = benchmark._build_checker_command(
                "zuban", self.root, [source_dir]
            )

        self.assertEqual(command, ["zuban", "check", "src"])
        self.assertEqual(configs, [])

    def test_run_checker_removes_temporary_config(self) -> None:
        process_result: benchmark.ProcessResult = {
            "stdout": "{}",
            "stderr": "",
            "returncode": 0,
            "timed_out": False,
            "execution_time_s": 1.0,
            "peak_memory_mb": 10.0,
            "oom_killed": False,
        }
        with (
            patch.object(
                benchmark, "_checker_command", return_value=["node", "pyright.js"]
            ),
            patch.object(
                benchmark,
                "run_process_with_timeout",
                return_value=process_result,
            ),
        ):
            result = benchmark.run_checker(
                "pyright", self.root, None, 30, 4096
            )

        self.assertTrue(result["ok"])
        self.assertEqual(
            list(self.root.glob(".typecheck-benchmark-pyright-*.json")), []
        )

    def test_uncaptured_run_rejects_fatal_exit_code(self) -> None:
        process_result: benchmark.ProcessResult = {
            "stdout": "",
            "stderr": "",
            "returncode": 2,
            "timed_out": False,
            "execution_time_s": 1.0,
            "peak_memory_mb": 10.0,
            "oom_killed": False,
        }
        with (
            patch.object(
                benchmark, "_checker_command", return_value=["node", "pyright.js"]
            ),
            patch.object(
                benchmark,
                "run_process_with_timeout",
                return_value=process_result,
            ),
        ):
            result = benchmark.run_checker(
                "pyright",
                self.root,
                None,
                30,
                4096,
                capture_output=False,
            )

        self.assertFalse(result["ok"])
        self.assertIn("exit code 2", result["error_message"])

    def test_results_include_upstream_provenance_and_memory_limit(self) -> None:
        output_file = benchmark._save_results(
            [],
            {},
            [],
            {},
            self.root,
            runs=1,
            warmup=0,
            timeout=30,
            memory_limit_mb=2048,
            os_name=None,
            local_dir=None,
        )
        output = json.loads(output_file.read_text(encoding="utf-8"))

        self.assertEqual(output["upstream_source"], benchmark.UPSTREAM_SOURCE)
        self.assertEqual(output["memory_limit_mb"], 2048)
        self.assertEqual(output["warmup_runs"], 0)
        self.assertEqual(output["uncounted_validation_runs_per_checker"], 1)
        self.assertEqual(output["python_version"], benchmark.platform.python_version())
        self.assertEqual(output["architecture"], benchmark.platform.machine())
        self.assertEqual(output["runner_class"], "local")

    def test_local_mode_builds_pyright_without_clone_or_install(self) -> None:
        package_result: benchmark.PackageResult = {
            "package_name": self.root.name,
            "github_url": None,
            "local_path": str(self.root),
            "error": None,
            "metrics": {},
        }
        result_path = self.root / "result.json"
        with (
            patch.object(benchmark, "prepare_local_pyright") as prepare,
            patch.object(
                benchmark,
                "_benchmark_directory",
                return_value=package_result,
            ) as run_directory,
            patch.object(
                benchmark,
                "get_type_checker_versions",
                return_value={"pyright": "1.2.3"},
            ),
            patch.object(benchmark, "_save_results", return_value=result_path),
            patch.object(benchmark, "_print_summary"),
            patch.object(benchmark, "clone_package") as clone,
            patch.object(benchmark, "install_deps") as install,
            redirect_stdout(io.StringIO()),
        ):
            actual_path = benchmark.run_benchmark(
                package_limit=None,
                package_names=None,
                type_checkers=["pyright"],
                timeout=30,
                output_dir=self.root,
                os_name=None,
                install_envs_file=None,
                runs=1,
                warmup=0,
                memory_limit_mb=4096,
                local_dir=self.root,
                skip_pyright_build=False,
            )

        self.assertEqual(actual_path, result_path)
        prepare.assert_called_once_with(False)
        run_directory.assert_called_once()
        clone.assert_not_called()
        install.assert_not_called()

    def test_zero_warmups_uses_one_captured_check(self) -> None:
        calls: list[bool] = []

        def run_checker(
            checker: str,
            package_path: Path,
            check_paths: list[Path] | None,
            timeout: int,
            memory_limit_mb: int,
            capture_output: bool = True,
        ) -> benchmark.TimingMetrics:
            calls.append(capture_output)
            return {
                "ok": True,
                "execution_time_s": 1.0,
                "peak_memory_mb": 2.0,
                "oom_killed": False,
            }

        stdout = io.StringIO()
        with (
            patch.object(benchmark, "_checker_command", return_value=["checker"]),
            patch.object(benchmark, "run_checker", side_effect=run_checker),
            redirect_stdout(stdout),
        ):
            benchmark._benchmark_directory(
                name="local",
                github_url=None,
                package_path=self.root,
                resolved_paths=None,
                type_checkers=["pyright"],
                timeout=30,
                runs=2,
                warmup=0,
                memory_limit_mb=4096,
            )

        self.assertEqual(calls, [True, False, False])
        self.assertEqual(
            stdout.getvalue(),
            "    Running pyright (1 validation check + 2 measured)...\n"
            "      Check... 1.000s, 2.0 MB (discarded)\n"
            "      Run 1/2... 1.000s, 2.0 MB\n"
            "      Run 2/2... 1.000s, 2.0 MB\n"
            "      Mean: 1.000s, 2.0 MB (stddev: 0.000s)\n",
        )

    def test_only_first_warmup_captures_output(self) -> None:
        captures: list[bool] = []

        def run_checker(
            checker: str,
            package_path: Path,
            check_paths: list[Path] | None,
            timeout: int,
            memory_limit_mb: int,
            capture_output: bool = True,
        ) -> benchmark.TimingMetrics:
            captures.append(capture_output)
            return {
                "ok": True,
                "execution_time_s": 1.0,
                "peak_memory_mb": 2.0,
                "oom_killed": False,
            }

        with (
            patch.object(benchmark, "_checker_command", return_value=["checker"]),
            patch.object(benchmark, "run_checker", side_effect=run_checker),
            redirect_stdout(io.StringIO()),
        ):
            benchmark._benchmark_directory(
                name="local",
                github_url=None,
                package_path=self.root,
                resolved_paths=None,
                type_checkers=["pyright"],
                timeout=30,
                runs=1,
                warmup=2,
                memory_limit_mb=4096,
            )

        self.assertEqual(captures, [True, False, False])


if __name__ == "__main__":
    unittest.main()
