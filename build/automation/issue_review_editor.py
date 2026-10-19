# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

"""Owned extension-host experiments; never reuse the operator's editor profile."""

from __future__ import annotations

import asyncio
import ctypes
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
import uuid
from contextlib import asynccontextmanager, contextmanager
from datetime import datetime, timezone
from itertools import chain
from pathlib import Path
from typing import AsyncIterator, Callable, Iterator

from pydantic import JsonValue

from issue_review_rca import JSON, RootCauseRun, Runner


def editor_signature(record: dict[str, JsonValue]) -> JsonValue:
    """Normalize only owned paths; retain versions, settings and actual API/handoff outcomes."""
    if record.get("kind") not in {"editor_run", "editor_debugger"} or record.get("exit_code") != 0:
        return None
    cases, capability = record.get("cases"), record.get("capabilities")
    if not isinstance(cases, list) or len(cases) != 3 or not isinstance(capability, dict):
        return None
    signatures: list[JsonValue] = []
    names = set()
    for case in cases:
        if not isinstance(case, dict) or case.get("exit_code") != 0:
            return None
        observation, inputs = case.get("observation"), case.get("inputs")
        if not isinstance(observation, dict) or not isinstance(inputs, dict):
            return None
        if not observation.get("complete") or observation.get("errors") or observation.get("host_version") != capability.get("host_version"):
            return None
        startup, details = observation.get("startup"), observation.get("execution_details")
        forwarded, extensions, versions = observation.get("forwarded_paths"), observation.get("extensions"), capability.get("extensions")
        server_paths = observation.get("server_paths")
        if (
            not isinstance(startup, dict) or startup.get("VIRTUAL_ENV") != inputs.get("environment")
            or not isinstance(details, dict) or not isinstance(forwarded, list) or not forwarded
            or not isinstance(server_paths, list) or not server_paths
            or not isinstance(extensions, list) or not isinstance(versions, dict)
            or not isinstance(observation.get("pid"), int) or not isinstance(case.get("settings"), dict)
        ):
            return None
        expected = inputs.get("expected_executable")
        startup_path = startup.get("PATH")
        if not isinstance(expected, str) or not isinstance(startup_path, str) or startup_path.split(os.pathsep)[0] != str(Path(expected).parent):
            return None
        active_versions: dict[str, JsonValue] = {
            identifier: extension.get("version") for extension in extensions
            if isinstance(extension, dict) and isinstance(identifier := extension.get("id"), str)
        }
        if active_versions.get("ms-pyright.vscode-pyright") != capability.get("pyright_version") or any(
            not isinstance(version, dict) or active_versions.get(identifier) != version.get("version")
            for identifier, version in versions.items()
        ):
            return None
        def normalize(value: JsonValue, inputs: dict[str, JsonValue] = inputs) -> JsonValue:
            if isinstance(value, str):
                for key, marker in (("expected_executable", "$PYTHON"), ("environment", "$ENV")):
                    target = inputs.get(key)
                    if isinstance(target, str) and os.path.normcase(value) == os.path.normcase(target):
                        return marker
                return value
            if isinstance(value, list):
                return [normalize(item) for item in value]
            return value
        normalized_forwarded, normalized_server = normalize(forwarded), normalize(server_paths)
        if not isinstance(normalized_forwarded, list) or not isinstance(normalized_server, list):
            return None
        if observation.get("failure_observed") != ("$ENV" in normalized_forwarded and "$ENV" in normalized_server):
            return None
        names.add(case.get("case"))
        signatures.append({
            "case": case.get("case"), "host_version": observation.get("host_version"),
            "python": capability.get("python"), "extensions": active_versions,
            "settings": case.get("settings"), "exec_command": normalize(details.get("execCommand")),
            "forwarded": normalize(list(dict.fromkeys(value for value in forwarded if isinstance(value, str)))),
            "server_paths": normalize(list(dict.fromkeys(value for value in server_paths if isinstance(value, str)))),
            "failure": observation.get("failure_observed"), "feature_flags": observation.get("feature_flags"),
        })
    return signatures if names == {"python_env", "venv", "python_envs/venv"} else None


def editor_failure(record: dict[str, JsonValue]) -> bool:
    cases = record.get("cases")
    return editor_signature(record) is not None and isinstance(cases, list) and any(
        isinstance(case, dict) and isinstance(observation := case.get("observation"), dict)
        and observation.get("failure_observed") is True for case in cases
    )


Progress = Callable[[str, int, str], None]


def fingerprint(directory: Path, progress: Progress | None = None) -> str:
    files: dict[str, str] = {}
    for path in directory.rglob("*"):
        relative = str(path.relative_to(directory))
        if progress:
            progress("files_hashed", len(files), relative)
        if path.is_file() and path.relative_to(directory) not in {
            Path("extensions") / "extensions.json", Path("extensions") / ".obsolete",
        }:
            with path.open("rb") as stream:
                files[relative] = hashlib.file_digest(stream, "sha256").hexdigest()
            if progress:
                progress("files_hashed", len(files), relative)
    return hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest()


def copy_assets(source: Path, destination: Path, progress: Progress | None = None) -> None:
    for count, path in enumerate(chain((source,), source.rglob("*")), 1):
        if progress:
            progress("paths_checked", count, str(path))
        if path.is_symlink() or getattr(path.lstat(), "st_file_attributes", 0) & 0x400:
            raise ValueError(f"Editor assets cannot contain filesystem links: {source}")
    copied = 0

    def copy_file(path: str, target: str) -> str:
        nonlocal copied
        if progress:
            progress("files_copied", copied, path)
        result = shutil.copy2(path, target)
        copied += 1
        if progress:
            progress("files_copied", copied, path)
        return result

    shutil.copytree(source, destination, copy_function=copy_file)


class EditorUnavailable(ValueError):
    """A host prerequisite cannot be repaired by repeating this experiment."""


def update_in_progress(product: dict[str, JsonValue]) -> bool:
    name = product.get("win32MutexName")
    if os.name != "nt" or not product.get("win32VersionedUpdate") or not isinstance(name, str):
        return False
    from ctypes import wintypes

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.OpenMutexW.argtypes, kernel.OpenMutexW.restype = [wintypes.DWORD, wintypes.BOOL, wintypes.LPCWSTR], wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    # Inspect existence only, matching the host's update guard; never acquire or release its mutex.
    handle = kernel.OpenMutexW(0x00100000, False, name + "-updating")
    if handle:
        kernel.CloseHandle(handle)
        return True
    error = ctypes.get_last_error()
    if error == 2:
        return False
    raise ctypes.WinError(error)


@contextmanager
def owned_tree(pid: int) -> Iterator[None]:
    if os.name != "nt":
        try:
            yield
        finally:
            try:
                os.killpg(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        return
    # Kill-on-close is confined to the newly launched editor and its descendants.
    from ctypes import wintypes

    class BasicLimits(ctypes.Structure):
        _fields_ = [
            ("per_process_time", ctypes.c_int64), ("per_job_time", ctypes.c_int64),
            ("flags", wintypes.DWORD), ("minimum", ctypes.c_size_t), ("maximum", ctypes.c_size_t),
            ("processes", wintypes.DWORD), ("affinity", ctypes.c_size_t),
            ("priority", wintypes.DWORD), ("scheduling", wintypes.DWORD),
        ]

    class IoCounters(ctypes.Structure):
        _fields_ = [(name, ctypes.c_uint64) for name in (
            "read_operations", "write_operations", "other_operations", "read_bytes", "write_bytes", "other_bytes",
        )]

    class Limits(ctypes.Structure):
        _fields_ = [
            ("basic", BasicLimits), ("io", IoCounters), ("process_memory", ctypes.c_size_t),
            ("job_memory", ctypes.c_size_t), ("peak_process", ctypes.c_size_t), ("peak_job", ctypes.c_size_t),
        ]

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateJobObjectW.argtypes, kernel.CreateJobObjectW.restype = [ctypes.c_void_p, wintypes.LPCWSTR], wintypes.HANDLE
    kernel.OpenProcess.argtypes, kernel.OpenProcess.restype = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD], wintypes.HANDLE
    kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    job = kernel.CreateJobObjectW(None, None)
    if not job:
        raise ctypes.WinError(ctypes.get_last_error())
    handle = None
    try:
        limits = Limits()
        limits.basic.flags = 0x2000
        if not kernel.SetInformationJobObject(job, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
            raise ctypes.WinError(ctypes.get_last_error())
        handle = kernel.OpenProcess(0x0100 | 0x0001, False, pid)
        if not handle or not kernel.AssignProcessToJobObject(job, handle):
            raise ctypes.WinError(ctypes.get_last_error())
        yield
    finally:
        if handle:
            kernel.CloseHandle(handle)
        kernel.CloseHandle(job)


async def editor_process(
    command: list[str], cwd: Path, env: dict[str, str], progress: Callable[[str, int], None] | None = None,
) -> tuple[int, str, str]:
    child = await asyncio.create_subprocess_exec(
        *command, cwd=cwd, env=env, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        start_new_session=os.name != "nt",
    )
    try:
        with owned_tree(child.pid):
            try:
                if progress:
                    progress("waiting for editor/probe", child.pid)
                output, error = await asyncio.wait_for(child.communicate(), 180)
                if child.returncode is None:
                    raise ValueError("Editor exited without an exit status")
                return child.returncode, output.decode("utf-8", errors="replace"), error.decode("utf-8", errors="replace")
            finally:
                if progress:
                    progress("cleaning up owned editor processes", child.pid)
    except TimeoutError as error:
        raise TimeoutError(f"Timed out after 180s waiting for isolated editor in {cwd}: {subprocess.list2cmdline(command)}") from error
    finally:
        if child.returncode is None:
            child.kill()
        await child.wait()


class EditorRuntime:
    heartbeat_seconds = 15.0

    def __init__(self, root: Path, directory: Path, runner: Runner, code: Path | None = None, python_extension: Path | None = None):
        self.root, self.directory, self.runner = root, directory, runner
        candidates = [
            Path(command).parent.parent / executable
            for launcher, executable in (("code", "Code.exe"), ("code-insiders", "Code - Insiders.exe"))
            if (command := shutil.which(launcher)) and os.name == "nt"
        ]
        self.code = code or next((
            candidate for candidate in candidates
            if candidate.is_file() and not (candidate.parent / "bootstrap" / "extensions").is_dir()
        ), candidates[0] if candidates else None)
        if self.code is not None:
            self.code = self.code.expanduser().resolve()
        self.python_extension = python_extension.expanduser().resolve() if python_extension is not None else None
        self.snapshot = directory / "editor-runtime"
        self.snapshot_hash: str | None = None
        self.capabilities: dict[str, JsonValue] | None = None
        self.extensions: dict[str, Path] = {}
        self.product: dict[str, JsonValue] = {}
        self.blocker: str | None = None
        self.last_progress: dict[str, JsonValue] | None = None
        self._phase = ""
        self._phase_started = 0.0
        self._phase_details: dict[str, JsonValue] = {}
        self._phase_metrics: dict[str, JsonValue] = {}
        self._phase_cancelled = threading.Event()

    def emit(self, status: str, **details: JsonValue) -> None:
        elapsed = round(time.monotonic() - self._phase_started, 1)
        record: dict[str, JsonValue] = {
            "at": datetime.now(timezone.utc).isoformat(), "phase": self._phase,
            "status": status, "elapsed_seconds": elapsed,
            **self._phase_details, **self._phase_metrics, **details,
        }
        self.last_progress = record
        with (self.directory / "editor-events.jsonl").open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(record) + "\n")
        progress = record.get("progress")
        counts = f"; {progress['counter']}={progress['completed']}" if isinstance(progress, dict) else ""
        activity = f"; {record['activity']}, pid={record['pid']}" if "activity" in record else ""
        print(f"  [editor RCA] {self._phase}: {status} ({elapsed:g}s{counts}{activity}).", flush=True)

    @asynccontextmanager
    async def phase(self, name: str, **details: JsonValue) -> AsyncIterator[None]:
        self._phase, self._phase_started = name, time.monotonic()
        self._phase_details, self._phase_metrics = details, {}
        self._phase_cancelled = threading.Event()
        self.emit("started")

        async def heartbeat() -> None:
            while True:
                await asyncio.sleep(self.heartbeat_seconds)
                self.emit("running")

        task = asyncio.create_task(heartbeat())
        try:
            yield
        except BaseException as error:
            self.emit(
                "cancelled" if isinstance(error, asyncio.CancelledError) else "failed",
                error=str(error), exception=type(error).__name__,
            )
            raise
        else:
            self.emit("completed")
        finally:
            self._phase_cancelled.set()
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    def counter(self) -> Progress:
        metrics, cancelled = self._phase_metrics, self._phase_cancelled

        def report(kind: str, count: int, path: str) -> None:
            if cancelled.is_set():
                raise RuntimeError("Editor asset operation cancelled")
            metrics["progress"] = {"counter": kind, "completed": count, "last_file": path}

        return report

    async def hash_assets(self, phase: str, expected: str | None = None) -> str:
        async with self.phase(phase):
            value = await asyncio.to_thread(fingerprint, self.snapshot, self.counter())
            if expected is not None and value != expected:
                raise ValueError("Private editor assets changed")
            return value

    def ensure_host_available(self) -> None:
        if self.blocker is None and update_in_progress(self.product):
            self.blocker = (
                "The installed editor's update mutex is active. Finish the VS Code update, then retry RCA. "
                "Repeating this experiment cannot fix the host; no update lock will be bypassed."
            )
        if self.blocker:
            raise EditorUnavailable(self.blocker)

    def discover_extension(self, identifier: str) -> Path:
        if identifier == "ms-python.python" and self.python_extension is not None:
            candidates = [self.python_extension]
        else:
            base = self.python_extension.parent if self.python_extension else Path.home() / ".vscode" / "extensions"
            candidates = list(base.glob(identifier + "-*"))
        candidates = [path for path in candidates if (path / "package.json").is_file()]
        if len(candidates) != 1:
            raise ValueError(f"Need one installed {identifier} extension, found {len(candidates)}; specify --rca-python-extension and its installed companion directory")
        candidate = candidates[0].resolve()
        package = json.loads((candidate / "package.json").read_text(encoding="utf-8"))
        if package.get("publisher", "") + "." + package.get("name", "") != identifier:
            raise ValueError(f"Extension identity does not match {identifier}: {candidate}")
        return candidate

    async def preflight(self) -> dict[str, JsonValue]:
        if self.capabilities is not None:
            try:
                self.ensure_host_available()
            except (OSError, EditorUnavailable) as error:
                self.capabilities.update(available=False, missing=[str(error)])
            return self.capabilities
        result: dict[str, JsonValue] = {
            "runner": "editor_interpreter", "available": False,
            "scope": "Current prepared Pyright, installed VS Code/Python extension, fresh profiles; not historical binaries.",
            "scenario": "Actual Python-extension interpreter API -> Pyright handoff, with python_env, venv, python_envs/venv controls.",
            "missing": [],
        }
        try:
            if self.code is None or not self.code.is_file():
                raise ValueError("Existing VS Code executable unavailable; supply --rca-code-path (no downloads)")
            if os.name == "nt" and len(str(self.directory.resolve() / "editor-runs" / ("x" * 32) / "case-3" / "envs" / "python_envs" / "venv" / "Scripts" / "python.exe")) > 240:
                raise ValueError("Editor probe paths would exceed conservative Windows path limits; choose a shorter --state-dir")
            bootstrap = self.code.parent / "bootstrap" / "extensions"
            if bootstrap.is_dir() and any(bootstrap.iterdir()):
                raise ValueError("This editor auto-installs bootstrap extensions into fresh profiles; choose a non-bootstrap host with --rca-code-path")
            package = self.root / "packages" / "vscode-pyright"
            for name in ("extension.js", "extension.js.map", "server.js"):
                if not (package / "dist" / name).is_file():
                    raise ValueError("Prepared editor extension/maps unavailable; run pnpm run build:extension:dev before RCA")
            self.extensions["ms-python.python"] = self.discover_extension("ms-python.python")
            pending = ["ms-python.python"]
            while pending:
                identifier = pending.pop()
                metadata = json.loads((self.extensions[identifier] / "package.json").read_text(encoding="utf-8"))
                dependencies = metadata.get("extensionDependencies", [])
                for dependency in dependencies:
                    if dependency not in self.extensions:
                        self.extensions[dependency] = self.discover_extension(dependency)
                        pending.append(dependency)
            # Preserve installed Python companions, but never activate a competing language server.
            for identifier in ("ms-python.debugpy", "ms-python.vscode-python-envs"):
                base = self.extensions["ms-python.python"].parent
                if list(base.glob(identifier + "-*")) and identifier not in self.extensions:
                    self.extensions[identifier] = self.discover_extension(identifier)
            host_package = self.code.parent / "resources" / "app" / "package.json"
            if not host_package.is_file():
                launcher = self.code.parent / "bin" / ("code-insiders.cmd" if "Insiders" in self.code.name else "code.cmd")
                match = re.search(
                    r"%~dp0\.\.\\([^\"\r\n]*resources\\app)\\out\\cli\.js",
                    launcher.read_text(encoding="utf-8"),
                )
                if not match:
                    raise ValueError("Cannot locate this editor's versioned application resources")
                host_package = (self.code.parent / match[1] / "package.json").resolve()
                if not host_package.is_relative_to(self.code.parent.resolve()):
                    raise ValueError("Editor application resources escaped the installation directory")
            host = json.loads(host_package.read_text(encoding="utf-8"))
            product_file = host_package.with_name("product.json")
            product = json.loads(product_file.read_text(encoding="utf-8")) if product_file.is_file() else {}
            self.product = product
            self.ensure_host_available()
            for extension in [package, *self.extensions.values()]:
                metadata = json.loads((extension / "package.json").read_text(encoding="utf-8"))
                if not compatible_host(host["version"], metadata["engines"]["vscode"], product.get("date")):
                    raise ValueError(f"Installed editor {host['version']} does not satisfy {extension.name}'s engine; choose a compatible existing host")
            result.update({
                "available": True, "host_version": host["version"], "code": str(self.code),
                "host_commit": product.get("commit"), "host_build_date": product.get("date"),
                "pyright_version": json.loads((package / "package.json").read_text(encoding="utf-8"))["version"],
                "extensions": {
                    identifier: {"path": str(path), "version": json.loads((path / "package.json").read_text(encoding="utf-8"))["version"]}
                    for identifier, path in self.extensions.items()
                },
                "python": sys.version, "python_executable": sys.executable,
            })
        except (OSError, ValueError, KeyError) as error:
            result["missing"] = [str(error)]
        self.capabilities = result
        return result

    async def prepare(self) -> None:
        capability = await self.preflight()
        if not capability["available"]:
            raise ValueError(f"Editor prerequisites missing: {capability['missing']}")
        self.snapshot.mkdir()
        package = self.root / "packages" / "vscode-pyright"
        pyright = self.snapshot / "pyright"
        pyright.mkdir()
        shutil.copy2(package / "package.json", pyright / "package.json")
        async with self.phase("copy Pyright", source=str(package / "dist")):
            await asyncio.to_thread(copy_assets, package / "dist", pyright / "dist", self.counter())
        for identifier, source in self.extensions.items():
            async with self.phase(f"copy {identifier}", source=str(source)):
                await asyncio.to_thread(copy_assets, source, self.snapshot / "extensions" / identifier, self.counter())
        for helper in ("issue_review_editor_probe.cjs", "issue_review_inspector.cjs"):
            shutil.copy2(self.root / "build" / "automation" / helper, pyright / helper)
        installed = []
        for identifier in self.extensions:
            location = self.snapshot / "extensions" / identifier
            package_json = json.loads((location / "package.json").read_text(encoding="utf-8"))
            installed.append({
                "identifier": {"id": identifier}, "version": package_json["version"],
                "location": {"scheme": "file", "path": ("/" if os.name == "nt" else "") + location.as_posix()},
                "relativeLocation": identifier,
                "metadata": package_json.get("__metadata", {}),
            })
        (self.snapshot / "extensions" / "extensions.json").write_text(json.dumps(installed), encoding="utf-8")
        self.snapshot_hash = await self.hash_assets("hash prepared assets")
        (self.directory / "editor-runtime.json").write_text(json.dumps({
            "capabilities": capability, "snapshot": str(self.snapshot), "sha256": self.snapshot_hash,
            "note": "Private product assets, not a security sandbox. No reporter code or personal profile.",
        }, indent=2), encoding="utf-8")

    async def run(self, request: RootCauseRun) -> dict[str, JsonValue]:
        self.ensure_host_available()
        if self.snapshot_hash is None:
            await self.prepare()
        else:
            await self.hash_assets("verify assets before run", self.snapshot_hash)
        source_root = self.root / "packages" / "vscode-pyright" / "src"
        for breakpoint in request.breakpoints:
            source = (source_root / breakpoint.file).resolve()
            if not source.is_relative_to(source_root.resolve()) or source.suffix != ".ts" or not source.is_file():
                raise ValueError("Editor breakpoints must name existing TypeScript inside vscode-pyright/src")
            if any(len(value) > 2000 for value in breakpoint.expressions):
                raise ValueError("Debugger expressions are limited to 2000 characters")
        identifier = uuid.uuid4().hex
        attempt = self.directory / "editor-runs" / identifier
        attempt.mkdir(parents=True)
        records: list[JsonValue] = []
        for index, name in enumerate(("python_env", "venv", "python_envs/venv"), 1):
            self.ensure_host_available()
            case = attempt / f"case-{index}"
            workspace, profile, environment = case / "workspace", case / "profile", case / "envs" / name
            workspace.mkdir(parents=True)
            (profile / "User").mkdir(parents=True)
            settings = {
                "python.languageServer": "None", "extensions.autoCheckUpdates": False, "extensions.autoUpdate": False,
                "update.mode": "none", "telemetry.telemetryLevel": "off", "workbench.startupEditor": "none",
                "security.workspace.trust.enabled": False,
                "extensions.ignoreRecommendations": True, "chat.disableAIFeatures": True,
                "extensions.allowed": {
                    "*": False, "ms-pyright.vscode-pyright": True,
                    **{identifier: [json.loads((self.snapshot / "extensions" / identifier / "package.json").read_text(encoding="utf-8"))["version"]]
                       for identifier in self.extensions},
                },
            }
            (profile / "User" / "settings.json").write_text(json.dumps(settings), encoding="utf-8")
            (workspace / "main.py").write_text("# Editor activation probe; no reporter Python is executed.\n", encoding="utf-8")
            venv_command = [sys.executable, "-I", "-m", "venv", "--without-pip", str(environment)]
            async with self.phase(
                f"case {index}/3 ({name}): create venv",
                directory=str(case), command=subprocess.list2cmdline(venv_command), cwd=str(case),
            ):
                code, output, error = await self.runner(venv_command, case)
                self._phase_metrics["exit_code"] = code
                if code:
                    raise ValueError(f"Cannot prepare owned standard-library venv: {error}\n{output}")
            environment = environment.resolve()
            scripts = environment / ("Scripts" if os.name == "nt" else "bin")
            executable = scripts / ("python.exe" if os.name == "nt" else "python")
            env = {key: value for key, value in os.environ.items() if key not in (
                "ELECTRON_RUN_AS_NODE", "VSCODE_IPC_HOOK_CLI", "VSCODE_IPC_HOOK", "PYTHONHOME",
            )}
            env.update({
                "VIRTUAL_ENV": str(environment), "PATH": str(scripts) + os.pathsep + env.get("PATH", ""),
                "VSCODE_CWD": str(workspace),
            })
            artifact, manifest = case / "observation.json", case / "request.json"
            request_data = {
                "id": identifier, "case": name, "artifact": str(artifact), "profile": str(profile),
                "environment": str(environment), "expected_executable": str(executable), "workspace": str(workspace),
                "source_root": str(source_root), "dependency_root": str(self.root / "packages" / "pyright-internal"),
                "bundle": str(self.snapshot / "pyright" / "dist" / "extension.js"),
                "breakpoints": [breakpoint.model_dump() for breakpoint in request.breakpoints],
            }
            manifest.write_text(json.dumps(request_data), encoding="utf-8")
            env["PYRIGHT_RCA_EDITOR_MANIFEST"] = str(manifest)
            if self.code is None:
                raise ValueError("Editor executable disappeared")
            command = [
                str(self.code), "--new-window", "--user-data-dir", str(profile),
                "--extensions-dir", str(self.snapshot / "extensions"),
                "--extensionDevelopmentPath", str(self.snapshot / "pyright"),
                "--extensionTestsPath", str(self.snapshot / "pyright" / "issue_review_editor_probe.cjs"),
                "--skip-welcome", "--skip-release-notes", "--disable-workspace-trust",
                "--sync", "off", "--skip-add-to-recently-opened",
                "--disable-extension=ms-pyright.pyright", "--disable-extension=ms-python.vscode-pylance",
                "--disable-extension=github.copilot-chat", str(workspace),
            ]
            def process_progress(activity: str, pid: int) -> None:
                self._phase_metrics.update(activity=activity, pid=pid)
                self.emit("running")

            async with self.phase(
                f"case {index}/3 ({name}): run editor/probe",
                directory=str(case), command=subprocess.list2cmdline(command), cwd=str(workspace),
            ):
                self.ensure_host_available()
                code, output, error = await editor_process(command, workspace, env, process_progress)
                self._phase_metrics["exit_code"] = code
                (case / "stdout.txt").write_text(output, encoding="utf-8")
                (case / "stderr.txt").write_text(error, encoding="utf-8")
                if not artifact.is_file():
                    diagnostic = error + output
                    if "currently being updated" in diagnostic or (
                        "checkInnoSetupMutex:" in diagnostic and "still held after" in diagnostic
                    ):
                        self.blocker = (
                            "The editor refused startup because an update is in progress. "
                            f"Finish the update before retrying RCA. Logs: {case}"
                        )
                        raise EditorUnavailable(self.blocker)
                    raise ValueError(f"Editor produced no probe artifact for {name} (exit {code}): {error}\n{output[-3000:]}")
                observed = JSON.validate_json(artifact.read_text(encoding="utf-8"))
                if not isinstance(observed, dict) or observed.get("id") != identifier or observed.get("case") != name:
                    raise ValueError("Editor artifact does not match its controller invocation")
            records.append({
                "case": name, "exit_code": code, "command": subprocess.list2cmdline(command),
                "inputs": request_data, "settings": settings, "observation": observed,
            })
        await self.hash_assets("verify assets after run", self.snapshot_hash)
        return {
            "id": identifier, "kind": "editor_debugger" if request.breakpoints else "editor_run",
            "exit_code": 0 if all(isinstance(case, dict) and case.get("exit_code") == 0 for case in records) else 2,
            "cases": records, "runtime_hash": self.snapshot_hash,
            "source_root": "packages/vscode-pyright/src", "capabilities": self.capabilities,
        }
def compatible_host(version: str, requirement: str, build_date: str | None = None) -> bool:
    match = re.fullmatch(r"(\^|>=)?(\d+)\.(\d+)\.(\d+)(?:-(\d{8}))?", requirement)
    current = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)(?:-[\w.-]+)?", version)
    if not match or not current:
        raise ValueError(f"Unsupported host engine range {requirement!r} or version {version!r}; verify compatibility explicitly")
    actual = tuple(int(part) for part in current.groups())
    minimum = tuple(int(part) for part in match.groups()[1:4])
    if match[5] and actual == minimum:
        if build_date is None:
            raise ValueError("Date-gated minimum editor version needs the actual host build date")
        if build_date[:10].replace("-", "") < match[5]:
            return False
    if match[1] == ">=":
        return actual >= minimum
    if match[1] == "^":
        index = next((index for index, value in enumerate(minimum) if value), 2)
        maximum = tuple(value if part < index else value + 1 if part == index else 0 for part, value in enumerate(minimum))
        return minimum <= actual < maximum
    return actual == minimum
