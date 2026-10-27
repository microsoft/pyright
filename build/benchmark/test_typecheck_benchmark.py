import io
import json
import os
import subprocess
import tempfile
import tomllib
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

    def test_manifest_prefers_implementations_deduplicates_and_prunes_defaults(self) -> None:
        source = self.root / "source"
        source.mkdir()
        for name in ("module.py", "module.pyi", "stub.pyi", "clean.py", ".hidden.py"):
            (source / name).write_text("")
        for name in ("node_modules", "__pycache__", ".hidden", "tests"):
            (source / name).mkdir()
            (source / name / "ignored.py").write_text("")
        paths, missing = benchmark._resolve_check_paths(
            self.root, ["source", "source/module.py", "missing"], ["tests"]
        )
        self.assertEqual(missing, ["missing"])
        self.assertEqual(
            [path.relative_to(source).name for path in paths],
            ["clean.py", "module.py", "stub.pyi"],
        )
        stub_only, _ = benchmark._resolve_check_paths(
            self.root, ["source/module.pyi"], []
        )
        self.assertEqual(stub_only, [source / "module.pyi"])

    def test_source_file_counts_do_not_include_imported_dependencies(self) -> None:
        cases = [
            ("pyright", "Total files parsed and bound: 500\nTotal files checked: 5\n", 5),
            ("pyright-threads", "Found 5 files to analyze\nFound 5 source files\n", 5),
            ("pyrefly", " INFO 5 modules (500 dependent modules); 1000 lines\n", 5),
            ("mypy", "Found 1 error in 1 file (checked 5 source files)\n", 5),
            ("zuban", "Success: no issues found in 1 source file\n", 1),
            ("ty", "DEBUG Checking file 'first.py'\nDEBUG Checking file 'first.py'\n"
             "DEBUG Checking file 'second.pyi'\nDEBUG Checking all files took 0.1s\n", 2),
            ("ty", "DEBUG Checking all files took 0.0s\n", 0),
            ("ty", "All checks passed!\n", None),
            ("pyrefly", " INFO 0 errors\n", None),
            ("mypy", "errors prevented further checking\n", None),
        ]
        for checker, output, expected in cases:
            with self.subTest(checker=checker, output=output):
                self.assertEqual(benchmark._parse_source_file_count(checker, output), expected)

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

    def test_pyright_command_uses_configured_entry_point(self) -> None:
        entry_point = self.root / "historical" / "index.js"
        bundle = entry_point.parent / "dist" / "pyright.js"
        bundle.parent.mkdir(parents=True)
        entry_point.touch()
        bundle.touch()

        with (
            patch.dict(
                os.environ,
                {benchmark.PYRIGHT_ENTRY_POINT_ENV: str(entry_point)},
            ),
            patch.object(benchmark, "_executable", return_value="node"),
        ):
            command = benchmark._pyright_command()

        self.assertEqual(command, ["node", str(entry_point.resolve())])

    def test_pip_pyright_command_uses_active_python_environment(self) -> None:
        with patch.object(
            benchmark.subprocess,
            "run",
            return_value=unittest.mock.Mock(returncode=0),
        ) as run:
            command = benchmark._checker_command("pyright-pip")

        run.assert_called_once_with(
            [benchmark.sys.executable, "-c", "import pyright"],
            capture_output=True,
            timeout=10,
        )
        self.assertEqual(
            command, [benchmark.sys.executable, "-m", "pyright"]
        )

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

    def test_prepare_local_pyright_builds_with_pnpm(self) -> None:
        entry_point = self.root / "index.js"
        bundle = self.root / "dist" / "pyright.js"
        bundle.parent.mkdir()

        def run_build(*args, **kwargs):
            entry_point.touch()
            bundle.touch()
            return unittest.mock.Mock(returncode=0)

        with (
            patch.object(benchmark, "PYRIGHT_ENTRY_POINT", entry_point),
            patch.object(benchmark, "PYRIGHT_BUNDLE", bundle),
            patch.object(benchmark, "PYRIGHT_PACKAGE_DIR", self.root),
            patch.object(benchmark, "_executable", side_effect=lambda name: name),
            patch.object(benchmark.subprocess, "run", side_effect=run_build) as run,
            redirect_stdout(io.StringIO()),
        ):
            benchmark.prepare_local_pyright(skip_build=False)

        run.assert_called_once_with(
            ["pnpm", "run", "build"],
            cwd=self.root,
            timeout=benchmark.BUILD_TIMEOUT,
        )

    def test_prepare_local_pyright_accepts_configured_entry_point(self) -> None:
        entry_point = self.root / "historical" / "index.js"
        bundle = entry_point.parent / "dist" / "pyright.js"
        bundle.parent.mkdir(parents=True)
        entry_point.touch()
        bundle.touch()

        with (
            patch.dict(
                os.environ,
                {benchmark.PYRIGHT_ENTRY_POINT_ENV: str(entry_point)},
            ),
            patch.object(benchmark, "_executable", return_value="node"),
            patch.object(benchmark.subprocess, "run") as run,
        ):
            benchmark.prepare_local_pyright(skip_build=False)

        run.assert_not_called()

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
        self.assertEqual(config["pythonVersion"], benchmark.TARGET_PYTHON_VERSION)
        self.assertEqual(command[-3:-1], ["--pythonpath", benchmark.sys.executable])
        self.assertIs(config["useLibraryCodeForTypes"], True)
        configs[0].unlink()

    def test_threaded_pyright_uses_runner_cpu_count_without_stats(self) -> None:
        source_dir = self.root / "src"
        source_dir.mkdir()
        with patch.object(
            benchmark, "_checker_command", return_value=["node", "pyright.js"]
        ):
            command, configs = benchmark._build_checker_command(
                "pyright-threads", self.root, [source_dir]
            )

        self.assertEqual(
            command,
            [
                "node",
                "pyright.js",
                "--project",
                str(configs[0]),
                "--pythonpath",
                benchmark.sys.executable,
                "--threads",
            ],
        )
        self.assertNotIn("--stats", command)
        configs[0].unlink()

    def test_pip_pyright_uses_pyright_config(self) -> None:
        with patch.object(
            benchmark,
            "_checker_command",
            return_value=[benchmark.sys.executable, "-m", "pyright"],
        ):
            command, configs = benchmark._build_checker_command(
                "pyright-pip", self.root, None
            )

        self.assertEqual(command[-1], "--stats")
        self.assertEqual(len(configs), 1)
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
            patch.object(benchmark, "install_deps", return_value=False) as install,
            patch.object(benchmark, "_benchmark_directory") as run_directory,
        ):
            result = benchmark._benchmark_package(
                package, self.root, ["pyright"], 30, 1, 0, 4096
            )

        self.assertEqual(result["error"], "Dependency installation failed")
        self.assertEqual(result["commit"], "abc123")
        install.assert_called_once_with(
            self.root, package, self.root / "example-dependencies"
        )
        run_directory.assert_not_called()

    def test_install_deps_uses_package_specific_target(self) -> None:
        dependency_path = self.root / "dependencies"
        config = {
            "install": True,
            "deps": ["example-dependency"],
            "install_env": {"EXAMPLE_OPTION": "enabled"},
        }

        with patch.object(
            benchmark.subprocess,
            "run",
            return_value=unittest.mock.Mock(returncode=0),
        ) as run:
            installed = benchmark.install_deps(self.root, config, dependency_path)

        self.assertTrue(installed)
        self.assertEqual(
            run.call_args.args[0],
            [
                benchmark.sys.executable,
                "-m",
                "pip",
                "install",
                "--target",
                str(dependency_path),
                "--ignore-installed",
                "--no-compile",
                ".",
                "example-dependency",
            ],
        )
        environment = run.call_args.kwargs["env"]
        self.assertEqual(environment["EXAMPLE_OPTION"], "enabled")
        self.assertEqual(environment["PYTHONNOUSERSITE"], "1")
        self.assertEqual(
            environment["PYTHONPATH"].split(os.pathsep)[0], str(dependency_path)
        )

    def test_packages_use_independent_dependency_environments(self) -> None:
        packages = [
            {"name": "first", "github_url": "https://example.com/first"},
            {"name": "second", "github_url": "https://example.com/second"},
        ]
        with (
            patch.object(
                benchmark,
                "clone_package",
                side_effect=[self.root / "first", self.root / "second"],
            ),
            patch.object(benchmark, "get_package_commit", return_value="abc123"),
            patch.object(benchmark, "install_deps", return_value=True) as install,
            patch.object(
                benchmark,
                "_benchmark_directory",
                side_effect=lambda **kwargs: {
                    "package_name": kwargs["name"],
                    "github_url": kwargs["github_url"],
                    "error": None,
                    "metrics": {},
                },
            ) as run_directory,
        ):
            for package in packages:
                benchmark._benchmark_package(
                    package, self.root, ["pyright"], 30, 1, 0, 4096
                )

        install_targets = [call.args[2] for call in install.call_args_list]
        checker_targets = [
            Path(call.kwargs["environment"]["PYTHONPATH"].split(os.pathsep)[0])
            for call in run_directory.call_args_list
        ]
        self.assertEqual(
            install_targets,
            [self.root / "first-dependencies", self.root / "second-dependencies"],
        )
        self.assertEqual(checker_targets, install_targets)

    def test_zuban_uses_explicit_config_and_mode(self) -> None:
        source_dir = self.root / "src" / "package"
        source_dir.mkdir(parents=True)
        with patch.object(benchmark, "_checker_command", return_value=["zuban"]):
            command, configs = benchmark._build_checker_command(
                "zuban", self.root, [source_dir]
            )

        self.assertEqual(
            command,
            [
                "zuban", "check", "--mode", "default",
                "--config-file", str(configs[0]),
                "--python-executable", benchmark.sys.executable,
            ],
        )
        config = tomllib.loads(configs[0].read_text())["tool"]["mypy"]
        self.assertEqual(config["files"], [str(source_dir.relative_to(self.root))])
        self.assertIs(config["exclude_gitignore"], False)
        configs[0].unlink()

    def test_ty_profiles_share_scope_but_not_return_inference(self) -> None:
        with patch.object(benchmark, "_executable", return_value="ty") as executable:
            self.assertEqual(benchmark._checker_command("ty-infer"), ["ty"])
        executable.assert_called_once_with("ty")
        for checker in ("ty", "ty-infer"):
            with self.subTest(checker=checker), patch.object(
                benchmark, "_checker_command", return_value=["ty"]
            ):
                command, configs = benchmark._build_checker_command(
                    checker, self.root, [self.root / "source"]
                )
                config = tomllib.loads(configs[0].read_text())
                self.assertEqual(
                    command, ["ty", "check", "--config-file", str(configs[0])]
                )
                self.assertEqual(
                    config["src"],
                    {
                        "include": ["source"],
                        "respect-ignore-files": False,
                        "exclude": ["!**", *benchmark.PYRIGHT_DEFAULT_EXCLUDES],
                    },
                )
                self.assertEqual(
                    config["environment"]["python"], benchmark.sys.executable
                )
                self.assertEqual(
                    config.get("analysis", {}).get("return-type-inference"),
                    "always" if checker == "ty-infer" else None,
                )
                configs[0].unlink()

    def test_pyrefly_config_disables_ignore_files_and_pins_inference(self) -> None:
        config_path = benchmark._write_pyrefly_config(self.root, ["source"])
        config = tomllib.loads(config_path.read_text())
        self.assertEqual(config["project-includes"], ["source"])
        self.assertIs(config["use-ignore-files"], False)
        self.assertIs(config["check-unannotated-defs"], True)
        self.assertEqual(config["infer-return-types"], "checked")
        self.assertEqual(config["python-interpreter-path"], benchmark.sys.executable)
        config_path.unlink()

    def test_mypy_config_preserves_testing_paths(self) -> None:
        testing_dir = self.root / "testing"
        testing_dir.mkdir()
        with patch.object(benchmark, "_checker_command", return_value=["mypy"]):
            command, configs = benchmark._build_checker_command(
                "mypy", self.root, [testing_dir]
            )

        self.assertEqual(
            command,
            ["mypy", "--no-incremental", "--config-file", str(configs[0])],
        )
        self.assertEqual(
            tomllib.loads(configs[0].read_text(encoding="utf-8"))["tool"]["mypy"],
            {
                "files": ["testing"],
                "check_untyped_defs": True,
                "python_version": benchmark.TARGET_PYTHON_VERSION,
                "python_executable": benchmark.sys.executable,
            },
        )
        configs[0].unlink()

    def test_run_checker_removes_temporary_config(self) -> None:
        process_result: benchmark.ProcessResult = {
            "stdout": (
                "Analysis stats\n"
                "Total files parsed and bound: 1234\n"
                "Total files checked: 567\n"
                "\nTiming stats\n"
                "Find Source Files:    0.1sec\n"
                "Read Source Files:    0.2sec\n"
                "Tokenize:             0.3sec\n"
                "Parse:                0.4sec\n"
                "Resolve Imports:      0.5sec\n"
                "Bind:                 0.6sec\n"
                "Check:                0.7sec\n"
                "Detect Cycles:        0.8sec\n"
            ),
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
        self.assertEqual(result["files_parsed"], 1234)
        self.assertEqual(result["files_checked"], 567)
        self.assertEqual(
            result["phase_times_s"],
            {
                "find_source_files": 0.1,
                "read_source_files": 0.2,
                "tokenize": 0.3,
                "parse": 0.4,
                "resolve_imports": 0.5,
                "bind": 0.6,
                "check": 0.7,
                "detect_cycles": 0.8,
            },
        )
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
        self.assertEqual(result["error_message"], "Fatal error (exit code 2)")

    def test_pyrefly_no_matching_files_is_not_a_successful_measurement(self) -> None:
        process_result: benchmark.ProcessResult = {
            "stdout": "",
            "stderr": "No Python files matched pattern `source`\n",
            "returncode": 1,
            "timed_out": False,
            "execution_time_s": 0.1,
            "peak_memory_mb": 10.0,
            "oom_killed": False,
        }
        with (
            patch.object(benchmark, "_checker_command", return_value=["pyrefly"]),
            patch.object(
                benchmark, "run_process_with_timeout", return_value=process_result
            ),
        ):
            result = benchmark.run_checker("pyrefly", self.root, None, 30, 4096)
        self.assertFalse(result["ok"])
        self.assertIn("No Python files matched", result["error_message"])

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
        self.assertEqual(output["checker_config_version"], benchmark.CHECKER_CONFIG_VERSION)
        self.assertEqual(
            output["node_options"], benchmark.os.environ.get("NODE_OPTIONS", "")
        )
        self.assertEqual(output["warmup_runs"], 0)
        self.assertEqual(output["uncounted_validation_runs_per_checker"], 1)
        self.assertEqual(output["python_version"], benchmark.platform.python_version())
        self.assertEqual(output["runner_image"], "local")
        self.assertEqual(output["architecture"], benchmark.platform.machine())
        self.assertEqual(output["runner_class"], "local")
        self.assertEqual(
            output["dependency_isolation"], benchmark.DEPENDENCY_ISOLATION
        )

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

    def test_zero_warmups_runs_an_audit_before_measured_checks(self) -> None:
        calls: list[bool] = []
        (self.root / "clean.py").write_text("")

        def run_checker(
            checker: str,
            package_path: Path,
            check_paths: list[Path] | None,
            timeout: int,
            memory_limit_mb: int,
            capture_output: bool = True,
            environment: dict[str, str] | None = None,
            audit_files: bool = False,
        ) -> benchmark.TimingMetrics:
            calls.append(audit_files)
            return {
                "ok": True,
                "execution_time_s": 1.0,
                "peak_memory_mb": 2.0,
                "oom_killed": False,
                "files_selected": 1,
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
            "    pyright source-file audit: 1/1 verified\n"
            "    Running pyright (2 measured)...\n"
            "      Run 1/2... 1.000s, 2.0 MB\n"
            "      Run 2/2... 1.000s, 2.0 MB\n"
            "      Mean: 1.000s, 2.0 MB (stddev: 0.000s)\n",
        )

    def test_all_warmups_and_runs_capture_output(self) -> None:
        captures: list[bool] = []
        (self.root / "clean.py").write_text("")

        def run_checker(
            checker: str,
            package_path: Path,
            check_paths: list[Path] | None,
            timeout: int,
            memory_limit_mb: int,
            capture_output: bool = True,
            environment: dict[str, str] | None = None,
            audit_files: bool = False,
        ) -> benchmark.TimingMetrics:
            captures.append(capture_output)
            return {
                "ok": True,
                "execution_time_s": 1.0,
                "peak_memory_mb": 2.0,
                "oom_killed": False,
                "files_selected": 1,
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

        self.assertEqual(captures, [True, True, True, True])

    def test_file_count_mismatch_prevents_timed_runs(self) -> None:
        for name in ("clean.py", "second.py"):
            (self.root / name).write_text("")
        audit: benchmark.TimingMetrics = {
            "ok": True, "execution_time_s": 0.1, "peak_memory_mb": 10.0,
            "oom_killed": False, "files_selected": 1,
        }
        with (
            patch.object(benchmark, "_checker_command", return_value=["checker"]),
            patch.object(benchmark, "run_checker", return_value=audit) as run,
            redirect_stdout(io.StringIO()),
        ):
            result = benchmark._benchmark_directory(
                name="local", github_url=None, package_path=self.root,
                resolved_paths=None, type_checkers=["ty"], timeout=30,
                runs=3, warmup=1, memory_limit_mb=4096,
            )
        run.assert_called_once()
        self.assertIs(run.call_args.kwargs["audit_files"], True)
        self.assertEqual(result["source_file_count"], 2)
        self.assertEqual(result["source_files"], ["clean.py", "second.py"])
        self.assertEqual(len(result["source_manifest_sha256"]), 64)
        self.assertFalse(result["metrics"]["ty"]["ok"])
        self.assertFalse(result["metrics"]["ty"]["file_count_verified"])
        self.assertIn("expected 2, ty reported 1", result["metrics"]["ty"]["error_message"])

    def test_empty_source_selection_is_not_a_full_repository_fallback(self) -> None:
        with patch.object(benchmark, "run_checker") as run:
            result = benchmark._benchmark_directory(
                name="local", github_url=None, package_path=self.root,
                resolved_paths=[], type_checkers=["ty"], timeout=30,
                runs=1, warmup=0, memory_limit_mb=4096,
            )
        run.assert_not_called()
        self.assertEqual(result["error"], "No Python source files selected")

    def test_count_changes_after_the_audit_reject_measured_results(self) -> None:
        (self.root / "clean.py").write_text("")
        audit: benchmark.TimingMetrics = {
            "ok": True, "execution_time_s": 0.1, "peak_memory_mb": 10.0,
            "oom_killed": False, "files_selected": 1,
        }
        measured: benchmark.TimingMetrics = {**audit, "files_selected": 0}
        with (
            patch.object(benchmark, "_checker_command", return_value=["checker"]),
            patch.object(benchmark, "run_checker", side_effect=[audit, measured]),
            redirect_stdout(io.StringIO()),
        ):
            result = benchmark._benchmark_directory(
                name="local", github_url=None, package_path=self.root,
                resolved_paths=None, type_checkers=["pyright"], timeout=30,
                runs=1, warmup=0, memory_limit_mb=4096,
            )
        self.assertFalse(result["metrics"]["pyright"]["ok"])
        self.assertIn("Source-file count changed", result["metrics"]["pyright"]["error_message"])


@unittest.skipUnless(
    os.environ.get("TYPECHECK_BENCHMARK_INTEGRATION") == "1",
    "Set TYPECHECK_BENCHMARK_INTEGRATION=1 with all checkers installed",
)
class CheckerConfigIntegrationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory(dir=benchmark.SCRIPT_DIR)
        self.addCleanup(self.temp_dir.cleanup)
        self.root = Path(self.temp_dir.name)

    def _run(
        self, checker: str, check_paths: list[Path] | None = None
    ) -> subprocess.CompletedProcess[str]:
        command, configs = benchmark._build_checker_command(
            checker, self.root, check_paths or [self.root / "source"]
        )
        self.assertIsNotNone(command, f"{checker} must be installed for integration tests")
        try:
            return subprocess.run(
                command, cwd=self.root, capture_output=True, text=True, timeout=60
            )
        finally:
            for config in configs:
                config.unlink()

    def test_native_configs_and_ignore_files_do_not_change_benchmark_scope(self) -> None:
        source = self.root / "source"
        source.mkdir()
        (source / "selected.py").write_text('value: int = "wrong"\n')
        (source / "ignored.py").write_text('value: int = "wrong"\n')
        (self.root / "outside.py").write_text('value: int = "wrong"\n')
        for directory in ("dist", "venv", "tests", "node_modules", ".hidden"):
            path = source / directory
            path.mkdir()
            (path / f"{directory.strip('.')}_probe.py").write_text(
                'value: int = "wrong"\n'
            )
        for name, content in (
            ("paired.py", 'value: int = "wrong"\n'),
            ("paired.pyi", "value: int\n"),
            ("standalone.pyi", "value: int\n"),
            ("clean.py", "value: int = 1\n"),
        ):
            (source / name).write_text(content)
        (self.root / ".ignore").write_text("source/ignored.py\n")
        (self.root / ".gitignore").write_text("source/ignored.py\n")
        native_configs = {
            "pyrightconfig.json": '{"typeCheckingMode":"off","exclude":["**"]}',
            "ty.toml": '[rules]\nall = "ignore"\n',
            "pyrefly.toml": 'project-includes = ["outside.py"]\n'
            "[errors]\nbad-assignment = false\n",
            "mypy.ini": "[mypy]\nignore_errors = True\n",
            "pyproject.toml": '[project]\nname = "hostile"\nversion = "0"\n'
            'requires-python = ">=3.8"\n'
            '[tool.ty.rules]\nall = "ignore"\n'
            "[tool.pyrefly.errors]\nbad-assignment = false\n"
            "[tool.mypy]\nignore_errors = true\n"
            "[tool.zuban]\nignore_errors = true\n",
        }
        for directory in (self.root, source):
            for name, content in native_configs.items():
                (directory / name).write_text(content)

        manifest, missing = benchmark._resolve_check_paths(self.root, ["source"], [])
        self.assertEqual(missing, [])
        self.assertEqual(len(manifest), 8)
        self.assertNotIn(source / "paired.pyi", manifest)
        for checker in [*benchmark.DEFAULT_TYPE_CHECKERS, "ty-infer", "pyright-threads"]:
            with self.subTest(checker=checker):
                audit = benchmark.run_checker(
                    checker, self.root, manifest, 60, 0, audit_files=True
                )
                self.assertTrue(audit["ok"], audit)
                self.assertEqual(audit["files_selected"], len(manifest), audit)
                result = self._run(checker, manifest)
                output = result.stdout + result.stderr
                self.assertEqual(result.returncode, 1, output)
                for name in ("selected", "ignored", "dist_probe", "venv_probe", "tests_probe"):
                    self.assertIn(f"{name}.py", output, output)
                for name in ("outside", "node_modules_probe", "hidden_probe"):
                    self.assertNotIn(f"{name}.py", output, output)
        for directory in (self.root, source):
            for name, content in native_configs.items():
                self.assertEqual((directory / name).read_text(), content)

    def test_pyrefly_enables_optional_diagnostics(self) -> None:
        source = self.root / "source"
        source.mkdir()
        (source / "unused_ignore.py").write_text("value: int = 1  # type: ignore\n")
        result = self._run("pyrefly")
        output = result.stdout + result.stderr
        self.assertEqual(result.returncode, 1, output)
        self.assertIn("[unused-type-ignore]", output)

    def test_ty_inference_profile_changes_inferred_return_checking(self) -> None:
        source = self.root / "source"
        source.mkdir()
        (source / "inferred.py").write_text(
            'def inferred():\n    return "wrong"\n\nvalue: int = inferred()\n'
        )
        default = self._run("ty")
        inferred = self._run("ty-infer")
        self.assertEqual(default.returncode, 0, default.stdout + default.stderr)
        self.assertEqual(inferred.returncode, 1, inferred.stdout + inferred.stderr)
        self.assertIn("invalid-assignment", inferred.stdout + inferred.stderr)

    def test_zuban_preserves_nested_source_paths(self) -> None:
        source = self.root / "source" / "nested"
        source.mkdir(parents=True)
        (source / "selected.py").write_text('value: int = "wrong"\n')
        result = self._run("zuban", [source])
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("selected.py", result.stdout + result.stderr)

    def test_ty_does_not_merge_user_level_rule_suppression(self) -> None:
        source = self.root / "source"
        source.mkdir()
        selected = source / "selected.py"
        selected.write_text('value: int = "wrong"\n')
        user_config = self.root / "user-config"
        (user_config / "ty").mkdir(parents=True)
        (user_config / "ty" / "ty.toml").write_text('[rules]\nall = "ignore"\n')
        outputs: list[benchmark.ProcessResult] = []
        original_run = benchmark.run_process_with_timeout

        def capture(*args, **kwargs):
            output = original_run(*args, **kwargs)
            outputs.append(output)
            return output

        with (
            patch.dict(os.environ, {
                "APPDATA": str(user_config), "XDG_CONFIG_HOME": str(user_config)
            }),
            patch.object(benchmark, "run_process_with_timeout", side_effect=capture),
        ):
            for checker in ("ty", "ty-infer"):
                with self.subTest(checker=checker):
                    result = benchmark.run_checker(
                        checker, self.root, [selected], 60, 0, audit_files=True
                    )
                    self.assertTrue(result["ok"], result)
                    self.assertEqual(result["files_selected"], 1)
                    self.assertEqual(outputs[-1]["returncode"], 1, outputs[-1])
                    self.assertIn("invalid-assignment", outputs[-1]["stdout"])


if __name__ == "__main__":
    unittest.main()
