#!/usr/bin/env python3
# Adapted directly for Pyright from the MIT-licensed original benchmark in
# lolpack/type_coverage_py:
# https://github.com/lolpack/type_coverage_py/blob/85667d6f090ce9648d88cd7a9777b492f3b95f1c/typecheck_benchmark/daily_runner.py
# Original source repository: https://github.com/lolpack/type_coverage_py
# Copyright (c) 2024 Aaron Pollack
# The upstream MIT license is reproduced in UPSTREAM_LICENSE.txt.
# Pyright modifications are licensed under the MIT license found in LICENSE.txt
# at the root of this repository.

"""Compare type-checker wall time and peak memory on configured Python projects.

This benchmark measures speed and peak RSS only. It does not compare diagnostics
or type-checking precision. Configured projects are cloned into a temporary
directory and installed into the active Python environment before they are
checked; --local benchmarks an existing directory without clone or installation.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import signal
import statistics
import subprocess
import sys
import tempfile
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Sequence, TypedDict

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[1]
PYRIGHT_PACKAGE_DIR = REPO_ROOT / "packages" / "pyright"
PYRIGHT_CLI = PYRIGHT_PACKAGE_DIR / "dist" / "pyright.js"

DEFAULT_TYPE_CHECKERS = ["pyright", "pyrefly", "ty", "mypy", "zuban"]
DEFAULT_TIMEOUT = 300
DEFAULT_MEMORY_LIMIT_MB = 4096
CLONE_TIMEOUT = 300
INSTALL_TIMEOUT = 600
BUILD_TIMEOUT = 600
UPSTREAM_SOURCE = {
    "repository_url": "https://github.com/lolpack/type_coverage_py",
    "commit": "85667d6f090ce9648d88cd7a9777b492f3b95f1c",
    "source_file_url": (
        "https://github.com/lolpack/type_coverage_py/blob/"
        "85667d6f090ce9648d88cd7a9777b492f3b95f1c/"
        "typecheck_benchmark/daily_runner.py"
    ),
}


class BenchmarkError(Exception):
    """An error that prevents the benchmark from running."""


class RunStats(TypedDict):
    min: float
    max: float
    mean: float
    median: float
    stddev: float


class RequiredTimingMetrics(TypedDict):
    ok: bool
    execution_time_s: float
    peak_memory_mb: float
    oom_killed: bool


class TimingMetrics(RequiredTimingMetrics, total=False):
    error_message: str | None
    runs: int
    execution_times_s: list[float]
    peak_memories_mb: list[float]
    execution_time_stats: RunStats
    peak_memory_stats: RunStats


class PackageResult(TypedDict, total=False):
    package_name: str
    github_url: str | None
    local_path: str
    error: str | None
    metrics: dict[str, TimingMetrics]


class AggregateStats(TypedDict):
    packages_tested: int
    packages_failed: int
    avg_execution_time_s: float
    p50_execution_time_s: float
    p90_execution_time_s: float
    p95_execution_time_s: float
    max_execution_time_s: float
    total_execution_time_s: float
    avg_peak_memory_mb: float
    p50_peak_memory_mb: float
    p90_peak_memory_mb: float
    p95_peak_memory_mb: float
    max_peak_memory_mb: float


class ProcessResult(TypedDict):
    stdout: str
    stderr: str
    returncode: int
    timed_out: bool
    execution_time_s: float
    peak_memory_mb: float
    oom_killed: bool


def _executable(name: str) -> str | None:
    return shutil.which(name)


def _pyright_command() -> list[str] | None:
    node = _executable("node")
    if not node or not PYRIGHT_CLI.is_file():
        return None
    return [node, str(PYRIGHT_CLI)]


def _checker_command(checker: str) -> list[str] | None:
    if checker == "pyright":
        return _pyright_command()
    if checker == "mypy":
        try:
            result = subprocess.run(
                [sys.executable, "-c", "import mypy"],
                capture_output=True,
                timeout=10,
            )
        except (OSError, subprocess.TimeoutExpired):
            return None
        return [sys.executable, "-m", "mypy"] if result.returncode == 0 else None

    executable = _executable(checker)
    return [executable] if executable else None


def prepare_local_pyright(skip_build: bool) -> None:
    """Build the repository's Pyright CLI before any timed invocation."""
    if not _executable("node"):
        raise BenchmarkError("Node.js is required to run the local Pyright CLI")

    if skip_build:
        if not PYRIGHT_CLI.is_file():
            raise BenchmarkError(
                f"--skip-pyright-build requires an existing local CLI at {PYRIGHT_CLI}"
            )
        return

    npm = _executable("npm")
    if not npm:
        raise BenchmarkError("npm is required to build the local Pyright CLI")

    print("Building the local Pyright CLI (excluded from benchmark timings)...")
    try:
        result = subprocess.run(
            [npm, "run", "build"],
            cwd=PYRIGHT_PACKAGE_DIR,
            timeout=BUILD_TIMEOUT,
        )
    except subprocess.TimeoutExpired as exc:
        raise BenchmarkError(
            f"Pyright build timed out after {BUILD_TIMEOUT} seconds"
        ) from exc
    except OSError as exc:
        raise BenchmarkError(f"Unable to run npm: {exc}") from exc

    if result.returncode != 0:
        raise BenchmarkError(f"Pyright build failed with exit code {result.returncode}")
    if not PYRIGHT_CLI.is_file():
        raise BenchmarkError(f"Pyright build did not produce {PYRIGHT_CLI}")


def _monitor_memory_linux(
    pid: int,
    peak_kb: list[int],
    stop_event: threading.Event,
    memory_limit_kb: int,
    killed: list[bool],
) -> None:
    """Poll /proc for peak RSS and kill the process group above the limit."""
    status_path = Path(f"/proc/{pid}/status")
    while not stop_event.is_set():
        try:
            vm_hwm = 0
            vm_rss = 0
            for line in status_path.read_text(encoding="utf-8").splitlines():
                if line.startswith("VmHWM:"):
                    vm_hwm = int(line.split()[1])
                elif line.startswith("VmRSS:"):
                    vm_rss = int(line.split()[1])
            peak_kb[0] = max(peak_kb[0], vm_hwm)
            if memory_limit_kb > 0 and vm_rss > memory_limit_kb:
                killed[0] = True
                try:
                    os.killpg(os.getpgid(pid), signal.SIGKILL)
                except (ProcessLookupError, OSError):
                    pass
                break
        except (FileNotFoundError, ProcessLookupError, OSError, ValueError):
            break
        stop_event.wait(0.01)


def _parse_macos_time_stderr(stderr: str) -> tuple[float, str]:
    """Extract peak RSS from /usr/bin/time -l output mixed into stderr."""
    peak_bytes = 0
    filtered_lines: list[str] = []
    in_time_output = False
    for line in stderr.splitlines(keepends=True):
        stripped = line.strip()
        if re.match(r"\d+\.\d+\s+real\s+", stripped):
            in_time_output = True
            continue
        if in_time_output:
            match = re.match(r"(\d+)\s+maximum resident set size", stripped)
            if match:
                peak_bytes = int(match.group(1))
                continue
            if re.match(r"\d+\s+\w", stripped):
                continue
            in_time_output = False
        filtered_lines.append(line)
    peak_mb = round(peak_bytes / (1024 * 1024), 1) if peak_bytes else 0.0
    return peak_mb, "".join(filtered_lines)


def run_process_with_timeout(
    cmd: list[str],
    cwd: Path,
    timeout: int,
    memory_limit_mb: int = DEFAULT_MEMORY_LIMIT_MB,
    capture_output: bool = True,
) -> ProcessResult:
    """Run a command with timeout and platform-appropriate memory measurement."""
    use_macos_time = sys.platform == "darwin" and Path("/usr/bin/time").is_file()
    actual_cmd = ["/usr/bin/time", "-l", *cmd] if use_macos_time else cmd
    need_stderr_pipe = capture_output or use_macos_time
    popen_args: dict[str, Any] = {
        "cwd": cwd,
        "stdout": subprocess.PIPE if capture_output else subprocess.DEVNULL,
        "stderr": subprocess.PIPE if need_stderr_pipe else subprocess.DEVNULL,
        "text": True,
    }
    if sys.platform != "win32":
        popen_args["start_new_session"] = True

    start_time = time.perf_counter()
    process = subprocess.Popen(actual_cmd, **popen_args)

    peak_kb = [0]
    killed = [False]
    stop_event = threading.Event()
    monitor_thread: threading.Thread | None = None
    if sys.platform == "linux":
        memory_limit_kb = memory_limit_mb * 1024 if memory_limit_mb > 0 else 0
        monitor_thread = threading.Thread(
            target=_monitor_memory_linux,
            args=(process.pid, peak_kb, stop_event, memory_limit_kb, killed),
            daemon=True,
        )
        monitor_thread.start()

    timed_out = False
    try:
        stdout, stderr = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
        _terminate_process(process)
        stdout, stderr = process.communicate()
    except BaseException:
        _terminate_process(process)
        try:
            process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
        raise
    finally:
        stop_event.set()
        if monitor_thread:
            monitor_thread.join(timeout=2)

    execution_time = round(time.perf_counter() - start_time, 3)
    stdout = stdout or ""
    stderr = stderr or ""
    if sys.platform == "linux":
        peak_memory_mb = round(peak_kb[0] / 1024, 1)
    elif use_macos_time:
        peak_memory_mb, stderr = _parse_macos_time_stderr(stderr)
    else:
        peak_memory_mb = 0.0

    return {
        "stdout": stdout,
        "stderr": stderr,
        "returncode": -1 if timed_out or killed[0] else process.returncode,
        "timed_out": timed_out,
        "execution_time_s": execution_time,
        "peak_memory_mb": peak_memory_mb,
        "oom_killed": killed[0],
    }


def _terminate_process(process: subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return
    if sys.platform == "win32":
        process.kill()
    else:
        try:
            os.killpg(os.getpgid(process.pid), signal.SIGKILL)
        except (ProcessLookupError, OSError):
            process.kill()


def load_install_envs(install_envs_file: Path | None = None) -> list[dict[str, Any]]:
    """Load installable project definitions from install_envs.json."""
    config_path = install_envs_file or SCRIPT_DIR / "install_envs.json"
    if not config_path.is_file():
        raise BenchmarkError(f"Install environment file not found: {config_path}")

    try:
        data = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise BenchmarkError(f"Unable to load {config_path}: {exc}") from exc

    packages: list[dict[str, Any]] = []
    for package in data.get("packages", []):
        github_url = package.get("github_url")
        if not github_url:
            continue
        if not package.get("install", False) and not package.get("deps"):
            continue
        name = package.get("name") or github_url.rstrip("/").split("/")[-1]
        packages.append({**package, "name": name})
    return packages


def get_type_checker_versions(type_checkers: list[str]) -> dict[str, str]:
    """Get versions using the same commands that will be benchmarked."""
    versions: dict[str, str] = {}
    for checker in type_checkers:
        command = _checker_command(checker)
        if not command:
            versions[checker] = "not installed"
            continue

        try:
            result = subprocess.run(
                [*command, "--version"],
                capture_output=True,
                text=True,
                timeout=10,
            )
            output = result.stdout.strip() or result.stderr.strip()
        except (OSError, subprocess.TimeoutExpired):
            output = ""

        if not output:
            versions[checker] = "unknown"
            continue
        match = re.search(r"\d+(?:\.\d+)+(?:[A-Za-z0-9.+-]*)?", output)
        versions[checker] = match.group(0) if match else output.splitlines()[0]
    return versions


def clone_package(github_url: str, name: str, destination: Path) -> Path | None:
    """Shallow-clone a configured project into the benchmark temp directory."""
    target = destination / name
    print(f"  Cloning {github_url}...")
    try:
        result = subprocess.run(
            ["git", "clone", "--depth", "1", "--quiet", github_url, str(target)],
            capture_output=True,
            text=True,
            timeout=CLONE_TIMEOUT,
        )
    except subprocess.TimeoutExpired:
        print(f"  Clone timed out after {CLONE_TIMEOUT} seconds")
        return None
    except OSError as exc:
        print(f"  Unable to run git: {exc}")
        return None

    if result.returncode != 0:
        print(f"  Clone failed: {result.stderr.strip()[:300]}")
        return None
    return target


def install_deps(package_path: Path, config: dict[str, Any]) -> bool:
    """Install the project and configured dependencies into the active environment."""
    environment = os.environ.copy()
    environment.update(config.get("install_env", {}))

    commands: list[tuple[str, list[str]]] = []
    if config.get("install", False):
        commands.append(
            (
                "Installing package (pip install -e .)",
                [sys.executable, "-m", "pip", "install", "-e", "."],
            )
        )

    deps = config.get("deps", [])
    if deps:
        commands.append(
            (
                f"Installing dependencies: {', '.join(deps)}",
                [sys.executable, "-m", "pip", "install", *deps],
            )
        )

    for description, command in commands:
        print(f"  {description}")
        try:
            result = subprocess.run(
                command,
                cwd=package_path,
                capture_output=True,
                text=True,
                timeout=INSTALL_TIMEOUT,
                env=environment,
            )
        except subprocess.TimeoutExpired:
            print(f"  Installation timed out after {INSTALL_TIMEOUT} seconds")
            return False
        except OSError as exc:
            print(f"  Unable to run pip: {exc}")
            return False
        if result.returncode != 0:
            details = result.stderr.strip() or result.stdout.strip()
            print(f"  Installation failed: {details[-500:]}")
            return False

    return True


def _relative_check_paths(
    package_path: Path, check_paths: list[Path] | None
) -> list[str] | None:
    if not check_paths:
        return None
    return [
        str(path.relative_to(package_path)) if path.is_absolute() else str(path)
        for path in check_paths
    ]


def _new_config_path(package_path: Path, checker: str, suffix: str) -> Path:
    file_descriptor, path = tempfile.mkstemp(
        prefix=f".typecheck-benchmark-{checker}-",
        suffix=suffix,
        dir=package_path,
    )
    os.close(file_descriptor)
    return Path(path)


def _write_pyright_config(package_path: Path, check_paths: list[str] | None) -> Path:
    config_path = _new_config_path(package_path, "pyright", ".json")
    config = {
        "include": check_paths or ["."],
        "exclude": [],
        "typeCheckingMode": "basic",
        "useLibraryCodeForTypes": True,
    }
    config_path.write_text(json.dumps(config), encoding="utf-8")
    return config_path


def _write_mypy_config(
    package_path: Path, check_paths: list[str] | None, checker: str
) -> Path:
    config_path = _new_config_path(package_path, checker, ".ini")
    lines = ["[mypy]"]
    if check_paths:
        lines.append(f"files = {', '.join(check_paths)}")
    lines.extend(
        [
            "check_untyped_defs = True",
            "exclude = (?x)(",
            "    /tests/",
            "    | /test_",
            "    | /testing/",
            "  )",
            "",
        ]
    )
    config_path.write_text("\n".join(lines), encoding="utf-8")
    return config_path


def _write_ty_config(package_path: Path, check_paths: list[str] | None) -> Path:
    config_path = _new_config_path(package_path, "ty", ".toml")
    lines: list[str] = []
    if check_paths:
        paths = ", ".join(json.dumps(path) for path in check_paths)
        lines.extend(["[src]", f"include = [{paths}]"])
    config_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return config_path


def _write_pyrefly_config(package_path: Path, check_paths: list[str] | None) -> Path:
    config_path = _new_config_path(package_path, "pyrefly", ".toml")
    lines: list[str] = []
    if check_paths:
        paths = ", ".join(json.dumps(path) for path in check_paths)
        lines.append(f"project_includes = [{paths}]")
    config_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return config_path


def _failure_message(result: ProcessResult) -> str:
    combined_output = f"{result['stderr']}\n{result['stdout']}".strip()
    for line in combined_output.splitlines():
        if line.strip():
            return line.strip()[:300]
    return f"Fatal error (exit code {result['returncode']})"


def _build_checker_command(
    checker: str,
    package_path: Path,
    check_paths: list[Path] | None,
) -> tuple[list[str] | None, list[Path]]:
    """Build one checker command and return temporary configs to remove."""
    base_command = _checker_command(checker)
    if not base_command:
        return None, []

    relative_paths = _relative_check_paths(package_path, check_paths)
    if checker == "pyright":
        config_path = _write_pyright_config(package_path, relative_paths)
        return [
            *base_command,
            "--project",
            str(config_path),
            "--outputjson",
        ], [config_path]
    if checker == "pyrefly":
        config_path = _write_pyrefly_config(package_path, relative_paths)
        return [
            *base_command,
            "check",
            "--config",
            str(config_path),
        ], [config_path]
    if checker == "ty":
        config_path = _write_ty_config(package_path, relative_paths)
        return [
            *base_command,
            "check",
            "--config-file",
            str(config_path),
        ], [config_path]
    if checker == "mypy":
        config_path = _write_mypy_config(package_path, relative_paths, "mypy")
        command = [
            *base_command,
            "--no-incremental",
            "--config-file",
            str(config_path),
        ]
        if not relative_paths:
            command.append(".")
        return command, [config_path]
    if checker == "zuban":
        return [*base_command, "check", *(relative_paths or ["."])], []
    return None, []


def run_checker(
    checker: str,
    package_path: Path,
    check_paths: list[Path] | None,
    timeout: int,
    memory_limit_mb: int,
    capture_output: bool = True,
) -> TimingMetrics:
    """Run one checker once using a minimal checker-specific configuration."""
    command, config_paths = _build_checker_command(
        checker, package_path, check_paths
    )
    if not command:
        error_message = (
            "Not installed"
            if checker in DEFAULT_TYPE_CHECKERS
            else f"Unknown checker: {checker}"
        )
        return {
            "ok": False,
            "execution_time_s": 0.0,
            "peak_memory_mb": 0.0,
            "oom_killed": False,
            "error_message": error_message,
        }

    try:
        try:
            result = run_process_with_timeout(
                command,
                cwd=package_path,
                timeout=timeout,
                memory_limit_mb=memory_limit_mb,
                capture_output=capture_output,
            )
        except OSError as exc:
            return {
                "ok": False,
                "execution_time_s": 0.0,
                "peak_memory_mb": 0.0,
                "oom_killed": False,
                "error_message": f"Unable to start {checker}: {exc}",
            }
    finally:
        for config_path in config_paths:
            config_path.unlink(missing_ok=True)

    if result["oom_killed"]:
        memory = result["peak_memory_mb"]
        memory_text = f" at {memory:.1f} MB" if memory > 0 else ""
        return {
            "ok": False,
            "execution_time_s": result["execution_time_s"],
            "peak_memory_mb": memory,
            "oom_killed": True,
            "error_message": (
                f"OOM: exceeded the {memory_limit_mb} MB memory limit{memory_text}"
            ),
        }
    if result["timed_out"]:
        return {
            "ok": False,
            "execution_time_s": result["execution_time_s"],
            "peak_memory_mb": result["peak_memory_mb"],
            "oom_killed": False,
            "error_message": f"Timed out after {timeout} seconds",
        }

    combined_output = f"{result['stderr']}\n{result['stdout']}"
    if capture_output and "errors prevented further checking" in combined_output:
        return {
            "ok": False,
            "execution_time_s": result["execution_time_s"],
            "peak_memory_mb": result["peak_memory_mb"],
            "oom_killed": False,
            "error_message": "Fatal: errors prevented further checking",
        }

    # All supported checkers use exit code 1 for ordinary type errors.
    if result["returncode"] not in (0, 1):
        return {
            "ok": False,
            "execution_time_s": result["execution_time_s"],
            "peak_memory_mb": result["peak_memory_mb"],
            "oom_killed": False,
            "error_message": _failure_message(result),
        }

    return {
        "ok": True,
        "execution_time_s": result["execution_time_s"],
        "peak_memory_mb": result["peak_memory_mb"],
        "oom_killed": False,
    }


def compute_percentile(values: Sequence[float], percentile: float) -> float:
    if not values:
        return 0.0
    sorted_values = sorted(values)
    index = (percentile / 100) * (len(sorted_values) - 1)
    lower = int(index)
    upper = min(lower + 1, len(sorted_values) - 1)
    fraction = index - lower
    return sorted_values[lower] + fraction * (
        sorted_values[upper] - sorted_values[lower]
    )


def compute_run_stats(values: list[float]) -> RunStats:
    return {
        "min": round(min(values), 3),
        "max": round(max(values), 3),
        "mean": round(statistics.mean(values), 3),
        "median": round(statistics.median(values), 3),
        "stddev": round(statistics.stdev(values), 3) if len(values) > 1 else 0.0,
    }


def compute_aggregate_stats(
    results: list[PackageResult], type_checkers: list[str]
) -> dict[str, AggregateStats]:
    aggregate: dict[str, AggregateStats] = {}
    for checker in type_checkers:
        times: list[float] = []
        memories: list[float] = []
        packages_failed = 0

        for package_result in results:
            if package_result.get("error"):
                packages_failed += 1
                continue
            metric = package_result.get("metrics", {}).get(checker)
            if not metric:
                continue
            if not metric.get("ok"):
                packages_failed += 1
                continue
            times.append(metric["execution_time_s"])
            if metric.get("peak_memory_mb", 0.0) > 0:
                memories.append(metric["peak_memory_mb"])

        aggregate[checker] = {
            "packages_tested": len(times),
            "packages_failed": packages_failed,
            "avg_execution_time_s": round(statistics.mean(times), 3)
            if times
            else 0.0,
            "p50_execution_time_s": round(compute_percentile(times, 50), 3),
            "p90_execution_time_s": round(compute_percentile(times, 90), 3),
            "p95_execution_time_s": round(compute_percentile(times, 95), 3),
            "max_execution_time_s": round(max(times), 3) if times else 0.0,
            "total_execution_time_s": round(sum(times), 3),
            "avg_peak_memory_mb": round(statistics.mean(memories), 1)
            if memories
            else 0.0,
            "p50_peak_memory_mb": round(compute_percentile(memories, 50), 1),
            "p90_peak_memory_mb": round(compute_percentile(memories, 90), 1),
            "p95_peak_memory_mb": round(compute_percentile(memories, 95), 1),
            "max_peak_memory_mb": round(max(memories), 1) if memories else 0.0,
        }
    return aggregate


def _benchmark_directory(
    *,
    name: str,
    github_url: str | None,
    package_path: Path,
    resolved_paths: list[Path] | None,
    type_checkers: list[str],
    timeout: int,
    runs: int,
    warmup: int,
    memory_limit_mb: int,
    local_path: str | None = None,
) -> PackageResult:
    metrics: dict[str, TimingMetrics] = {}
    for checker in type_checkers:
        if not _checker_command(checker):
            print(f"    Skipping {checker}: not installed")
            metrics[checker] = {
                "ok": False,
                "execution_time_s": 0.0,
                "peak_memory_mb": 0.0,
                "oom_killed": False,
                "error_message": "Not installed",
            }
            continue

        effective_warmup = max(1, warmup)
        if warmup == 0:
            run_description = f"1 validation check + {runs} measured"
        else:
            run_description = f"{warmup} warmup + {runs} measured"
        print(f"    Running {checker} ({run_description})...")
        execution_times: list[float] = []
        peak_memories: list[float] = []
        failure: TimingMetrics | None = None

        for run_index in range(effective_warmup + runs):
            is_warmup = run_index < effective_warmup
            capture_output = run_index == 0
            if is_warmup and warmup == 0:
                label = "Check"
            elif is_warmup:
                label = f"Warmup {run_index + 1}/{warmup}"
            else:
                label = f"Run {run_index - effective_warmup + 1}/{runs}"
            print(f"      {label}...", end=" ", flush=True)
            metric = run_checker(
                checker,
                package_path,
                resolved_paths,
                timeout,
                memory_limit_mb,
                capture_output=capture_output,
            )
            if not metric.get("ok"):
                print(f"failed: {metric.get('error_message', 'Unknown error')}")
                failure = metric
                break

            memory = metric.get("peak_memory_mb", 0.0)
            memory_text = f", {memory:.1f} MB" if memory > 0 else ""
            suffix = " (discarded)" if is_warmup else ""
            print(f"{metric['execution_time_s']:.3f}s{memory_text}{suffix}")
            if not is_warmup:
                execution_times.append(metric["execution_time_s"])
                peak_memories.append(memory)

        if failure:
            failure["runs"] = len(execution_times)
            metrics[checker] = failure
            continue

        mean_time = round(statistics.mean(execution_times), 3)
        mean_memory = round(statistics.mean(peak_memories), 1)
        result_metric: TimingMetrics = {
            "ok": True,
            "execution_time_s": mean_time,
            "peak_memory_mb": mean_memory,
            "oom_killed": False,
            "runs": len(execution_times),
            "execution_times_s": execution_times,
            "peak_memories_mb": peak_memories,
            "execution_time_stats": compute_run_stats(execution_times),
            "peak_memory_stats": compute_run_stats(peak_memories),
        }
        metrics[checker] = result_metric
        memory_text = f", {mean_memory:.1f} MB" if mean_memory > 0 else ""
        print(
            f"      Mean: {mean_time:.3f}s{memory_text} "
            f"(stddev: {result_metric['execution_time_stats']['stddev']:.3f}s)"
        )

    result: PackageResult = {
        "package_name": name,
        "github_url": github_url,
        "error": None,
        "metrics": metrics,
    }
    if local_path:
        result["local_path"] = local_path
    return result


def _benchmark_package(
    package: dict[str, Any],
    temp_path: Path,
    type_checkers: list[str],
    timeout: int,
    runs: int,
    warmup: int,
    memory_limit_mb: int,
) -> PackageResult:
    name = package["name"]
    github_url = package["github_url"]
    package_path = clone_package(github_url, name, temp_path)
    if not package_path:
        return {
            "package_name": name,
            "github_url": github_url,
            "error": "Failed to clone",
            "metrics": {},
        }

    if not install_deps(package_path, package):
        print("  Warning: dependency installation had issues; continuing anyway")

    resolved_paths: list[Path] | None = None
    raw_check_paths = package.get("check_paths")
    if raw_check_paths:
        configured_paths = [package_path / path for path in raw_check_paths]
        resolved_paths = [path for path in configured_paths if path.exists()]
        missing = [
            str(path.relative_to(package_path))
            for path in configured_paths
            if not path.exists()
        ]
        if missing:
            print(f"  Warning: missing configured check paths: {', '.join(missing)}")
        if resolved_paths:
            print(
                "  Checking: "
                + ", ".join(
                    str(path.relative_to(package_path)) for path in resolved_paths
                )
            )
        else:
            print("  Warning: configured check paths do not exist; checking full repo")

    return _benchmark_directory(
        name=name,
        github_url=github_url,
        package_path=package_path,
        resolved_paths=resolved_paths,
        type_checkers=type_checkers,
        timeout=timeout,
        runs=runs,
        warmup=warmup,
        memory_limit_mb=memory_limit_mb,
    )


def _save_results(
    results: list[PackageResult],
    aggregate: dict[str, AggregateStats],
    type_checkers: list[str],
    versions: dict[str, str],
    output_dir: Path,
    runs: int,
    warmup: int,
    timeout: int,
    memory_limit_mb: int,
    os_name: str | None,
    local_dir: Path | None,
) -> Path:
    timestamp = datetime.now(timezone.utc)
    date = timestamp.strftime("%Y-%m-%d")
    suffix = f"_{os_name}" if os_name else ""
    dated_file = output_dir / f"benchmark_{date}{suffix}.json"
    latest_file = output_dir / (f"latest-{os_name}.json" if os_name else "latest.json")

    output: dict[str, Any] = {
        "timestamp": timestamp.isoformat(),
        "date": date,
        "platform": sys.platform,
        "upstream_source": UPSTREAM_SOURCE,
        "memory_measurement": (
            "/proc/<pid>/status"
            if sys.platform == "linux"
            else "/usr/bin/time -l"
            if sys.platform == "darwin" and Path("/usr/bin/time").is_file()
            else "unavailable"
        ),
        "memory_limit_mb": memory_limit_mb,
        "type_checkers": type_checkers,
        "type_checker_versions": versions,
        "package_count": len(results),
        "runs_per_package": runs,
        "warmup_runs": warmup,
        "uncounted_validation_runs_per_checker": 1 if warmup == 0 else 0,
        "timeout_s": timeout,
        "aggregate": aggregate,
        "results": results,
    }
    if os_name:
        output["os"] = os_name
    if local_dir:
        output["local_directory"] = str(local_dir)

    serialized = json.dumps(output, indent=2) + "\n"
    dated_file.write_text(serialized, encoding="utf-8")
    latest_file.write_text(serialized, encoding="utf-8")
    return dated_file


def _print_summary(
    aggregate: dict[str, AggregateStats], type_checkers: list[str]
) -> None:
    print(
        f"\n{'Checker':<10} {'Pkgs':>5} {'Failed':>6} {'P50 time':>10} "
        f"{'Mean time':>10} {'P95 time':>10} {'P50 mem':>10} {'Max mem':>10}"
    )
    print("-" * 87)
    for checker in type_checkers:
        stats = aggregate[checker]
        if stats["packages_tested"] == 0:
            print(
                f"{checker:<10} {'N/A':>5} {stats['packages_failed']:>6} "
                f"{'N/A':>10}"
            )
            continue
        print(
            f"{checker:<10} {stats['packages_tested']:>5} "
            f"{stats['packages_failed']:>6} "
            f"{stats['p50_execution_time_s']:>9.3f}s "
            f"{stats['avg_execution_time_s']:>9.3f}s "
            f"{stats['p95_execution_time_s']:>9.3f}s "
            f"{stats['p50_peak_memory_mb']:>9.1f}M "
            f"{stats['max_peak_memory_mb']:>9.1f}M"
        )


def run_benchmark(
    *,
    package_limit: int | None,
    package_names: list[str] | None,
    type_checkers: list[str],
    timeout: int,
    output_dir: Path | None,
    os_name: str | None,
    install_envs_file: Path | None,
    runs: int,
    warmup: int,
    memory_limit_mb: int,
    local_dir: Path | None,
    skip_pyright_build: bool,
) -> Path:
    if "pyright" in type_checkers:
        prepare_local_pyright(skip_pyright_build)

    destination = output_dir or SCRIPT_DIR / "results"
    destination.mkdir(parents=True, exist_ok=True)

    resolved_local_dir: Path | None = None
    packages: list[dict[str, Any]] = []
    if local_dir:
        resolved_local_dir = local_dir.resolve()
        if not resolved_local_dir.is_dir():
            raise BenchmarkError(f"--local path is not a directory: {local_dir}")
        package_names_for_header = resolved_local_dir.name
    else:
        packages = load_install_envs(install_envs_file)
        if package_names:
            selected_names = set(package_names)
            packages = [
                package for package in packages if package["name"] in selected_names
            ]
        elif package_limit is not None:
            packages = packages[:package_limit]
        if not packages:
            raise BenchmarkError("No configured packages matched the selection")
        package_names_for_header = ", ".join(
            package["name"] for package in packages
        )

    print("=" * 72)
    print("Cross-Type-Checker Speed and Peak-Memory Benchmark")
    print("=" * 72)
    print(f"Packages: {package_names_for_header}")
    if resolved_local_dir:
        print(f"Local directory: {resolved_local_dir}")
    print(f"Type checkers: {', '.join(type_checkers)}")
    print(f"Warmups/measured runs: {warmup}/{runs}")
    print(f"Timeout: {timeout}s per invocation")
    limit_text = f"{memory_limit_mb} MB" if memory_limit_mb else "disabled"
    print(f"Linux memory limit: {limit_text}")

    versions = get_type_checker_versions(type_checkers)
    print("Versions:")
    for checker in type_checkers:
        print(f"  {checker}: {versions[checker]}")

    if resolved_local_dir:
        print(f"\n[1/1] {resolved_local_dir.name} (local)")
        results = [
            _benchmark_directory(
                name=resolved_local_dir.name,
                github_url=None,
                package_path=resolved_local_dir,
                resolved_paths=None,
                type_checkers=type_checkers,
                timeout=timeout,
                runs=runs,
                warmup=warmup,
                memory_limit_mb=memory_limit_mb,
                local_path=str(resolved_local_dir),
            )
        ]
    else:
        results = []
        with tempfile.TemporaryDirectory(
            prefix="pyright-typecheck-benchmark-"
        ) as temp_dir:
            temp_path = Path(temp_dir)
            for index, package in enumerate(packages, 1):
                print(f"\n[{index}/{len(packages)}] {package['name']}")
                results.append(
                    _benchmark_package(
                        package,
                        temp_path,
                        type_checkers,
                        timeout,
                        runs,
                        warmup,
                        memory_limit_mb,
                    )
                )

    aggregate = compute_aggregate_stats(results, type_checkers)
    dated_file = _save_results(
        results,
        aggregate,
        type_checkers,
        versions,
        destination,
        runs,
        warmup,
        timeout,
        memory_limit_mb,
        os_name,
        resolved_local_dir,
    )

    print("\nBenchmark complete.")
    _print_summary(aggregate, type_checkers)
    print(f"\nResults: {dated_file}")
    print(
        "Latest: "
        + str(
            destination
            / (f"latest-{os_name}.json" if os_name else "latest.json")
        )
    )
    return dated_file


def _positive_int(value: str) -> int:
    parsed = int(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("must be greater than zero")
    return parsed


def _nonnegative_int(value: str) -> int:
    parsed = int(value)
    if parsed < 0:
        raise argparse.ArgumentTypeError("must be zero or greater")
    return parsed


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Benchmark wall time and peak RSS for Python type checkers on "
            "configured projects"
        )
    )
    parser.add_argument(
        "--packages",
        "-p",
        type=_positive_int,
        default=None,
        help="maximum number of configured packages to benchmark",
    )
    parser.add_argument(
        "--package-names",
        "-n",
        nargs="+",
        default=None,
        help="specific configured package names to benchmark",
    )
    parser.add_argument(
        "--checkers",
        "-c",
        nargs="+",
        choices=DEFAULT_TYPE_CHECKERS,
        default=DEFAULT_TYPE_CHECKERS,
        help="type checkers to benchmark (default: all)",
    )
    parser.add_argument(
        "--timeout",
        "-t",
        type=_positive_int,
        default=DEFAULT_TIMEOUT,
        help=f"timeout per checker invocation (default: {DEFAULT_TIMEOUT}s)",
    )
    parser.add_argument(
        "--output",
        "-o",
        type=Path,
        default=None,
        help="result directory (default: build/benchmark/results)",
    )
    parser.add_argument(
        "--os-name",
        default=None,
        help="label added to result filenames (for example: ubuntu)",
    )
    parser.add_argument(
        "--install-envs",
        type=Path,
        default=None,
        help="package configuration JSON (default: build/benchmark/install_envs.json)",
    )
    parser.add_argument(
        "--runs",
        "-r",
        type=_positive_int,
        default=5,
        help="measured runs per checker and package (default: 5)",
    )
    parser.add_argument(
        "--warmup",
        "-w",
        type=_nonnegative_int,
        default=1,
        help="discarded warmup runs per checker and package (default: 1)",
    )
    parser.add_argument(
        "--memory-limit-mb",
        type=_nonnegative_int,
        default=DEFAULT_MEMORY_LIMIT_MB,
        help=(
            "Linux RSS limit per checker in MB; 0 disables it "
            f"(default: {DEFAULT_MEMORY_LIMIT_MB})"
        ),
    )
    parser.add_argument(
        "--local",
        type=Path,
        default=None,
        help="benchmark a local directory without cloning, installing, or deleting it",
    )
    parser.add_argument(
        "--skip-pyright-build",
        action="store_true",
        help="use the existing packages/pyright/dist/pyright.js without rebuilding",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.os_name and not re.fullmatch(r"[A-Za-z0-9_.-]+", args.os_name):
        print(
            "error: --os-name may contain only letters, numbers, '.', '_' and '-'",
            file=sys.stderr,
        )
        return 2
    if args.local and (
        args.packages is not None
        or args.package_names is not None
        or args.install_envs is not None
    ):
        print(
            "error: --local cannot be combined with --packages, "
            "--package-names, or --install-envs",
            file=sys.stderr,
        )
        return 2

    try:
        run_benchmark(
            package_limit=args.packages,
            package_names=args.package_names,
            type_checkers=args.checkers,
            timeout=args.timeout,
            output_dir=args.output,
            os_name=args.os_name,
            install_envs_file=args.install_envs,
            runs=args.runs,
            warmup=args.warmup,
            memory_limit_mb=args.memory_limit_mb,
            local_dir=args.local,
            skip_pyright_build=args.skip_pyright_build,
        )
    except BenchmarkError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
