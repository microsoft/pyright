# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

"""Fixed, observation-only workspace progress/diagnostics experiments, not an arbitrary LSP client."""

from __future__ import annotations

import asyncio
import ctypes
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal
from urllib.parse import unquote, urlparse

from pydantic import Field, JsonValue

from issue_review_editor import copy_assets, owned_tree
from issue_review_models import Record, ReproductionTarget
from issue_review_reproduction import TargetStore, relative_path, run_target_io, tree_hash

MAX_FRAME = 256 * 1024
MAX_WIRE = 2 * 1024 * 1024
MAX_EVENTS = 2048
MAX_STDERR = 65536
MAX_INPUT = 65536
MAX_FILES = 16
CAPABILITY = (
    "Headless stdio Pyright workspace progress/diagnostic publication only. "
    "Requires an explicit Python 3.14 pyrightconfig.json and at most 16 inspected .py/.pyi files. "
    "Runs separate 3.14/workspace, 3.13/workspace and 3.14/openFilesOnly cases. "
    "The 3.13 control changes the configured static target, NOT the actual interpreter. "
    "Interpreter is the controller's Python; versions and missing exact matches remain qualifications. "
    "No document diagnostic pulls, arbitrary requests, editor automation, acquisition, or mutations. "
    "Bounded observations are experimental/action-ineligible, not root-cause or closure evidence."
)


class LspProbeRequest(Record):
    project: str = Field(default=".", min_length=1, max_length=256, description="Scratch-relative inspected input folder.")
    open_file: str = Field(default="a.py", min_length=1, max_length=256, description="Existing relative .py opened only in the openFilesOnly control.")
    target_id: str = Field(default="checkout", min_length=1, max_length=128, description="checkout or a controller-advertised opaque prepared target ID; never a path/version.")
    observation_seconds: int = Field(default=15, ge=1, le=30)


def no_links(path: Path) -> None:
    if path.is_symlink() or getattr(path.lstat(), "st_file_attributes", 0) & 0x400:
        raise ValueError(f"LSP inputs/runtime cannot contain filesystem links: {path}")


def parse_json(text: str | bytes) -> JsonValue:
    def pairs(items: list[tuple[str, JsonValue]]) -> dict[str, JsonValue]:
        values: dict[str, JsonValue] = {}
        for key, value in items:
            if key in values:
                raise ValueError("Duplicate JSON key")
            values[key] = value
        return values

    def invalid(value: str) -> None:
        raise ValueError(f"Nonfinite JSON value: {value}")

    return json.loads(text, object_pairs_hook=pairs, parse_constant=invalid)


def capture_inputs(scratch: Path, request: LspProbeRequest) -> dict[str, str]:
    relative = relative_path(request.project) if request.project != "." else Path()
    project = scratch / relative
    for path in (scratch, *[scratch.joinpath(*relative.parts[:index]) for index in range(1, len(relative.parts) + 1)]):
        no_links(path)
    if not project.resolve().is_relative_to(scratch.resolve()) or not project.is_dir():
        raise ValueError("LSP project must be an existing scratch-relative folder")
    inputs: dict[str, str] = {}
    total = 0
    paths = 0
    for directory, folders, files in os.walk(project, followlinks=False):
        for name in sorted([*folders, *files]):
            paths += 1
            if paths > 64:
                raise ValueError("LSP input tree exceeds its path bound")
            path = Path(directory) / name
            no_links(path)
            if not path.resolve().is_relative_to(project.resolve()):
                raise ValueError("LSP input escapes its project")
            if path.is_dir():
                continue
            relative_name = str(path.relative_to(project))
            if path.suffix not in {".py", ".pyi"} and relative_name != "pyrightconfig.json":
                raise ValueError(f"Unsupported LSP input: {relative_name}; use a dedicated minimal project folder")
            with path.open("rb") as stream:
                content = stream.read(MAX_INPUT + 1)
            total += len(content)
            if len(inputs) >= MAX_FILES + 1 or total > MAX_INPUT:
                raise ValueError("LSP input exceeds the 16-source/64-KiB bound")
            inputs[relative_name] = content.decode("utf-8")
    config = parse_json(inputs.get("pyrightconfig.json", "null"))
    if not isinstance(config, dict) or config.get("pythonVersion") != "3.14":
        raise ValueError("This scenario requires an explicit Python 3.14 pyrightconfig.json")
    for key, value in config.items():
        if key == "pythonVersion":
            continue
        if key == "typeCheckingMode" and isinstance(value, str) and value in {"off", "basic", "standard", "strict"}:
            continue
        raise ValueError(f"Unsupported LSP configuration setting: {key}")
    opened = str(relative_path(request.open_file))
    if opened not in inputs or Path(opened).suffix != ".py":
        raise ValueError("The openFilesOnly control needs an existing relative .py file")
    return inputs


def token_key(token: JsonValue) -> str:
    if type(token) not in {str, int}:
        raise ValueError("Progress tokens must be strings or integers")
    return json.dumps(token)


def resume_owned_process(pid: int) -> None:
    """Windows launch is suspended until the kill-on-close job owns all future descendants."""
    if os.name != "nt":
        return
    from ctypes import wintypes

    class ThreadEntry(ctypes.Structure):
        _fields_ = [
            ("size", wintypes.DWORD), ("usage", wintypes.DWORD), ("thread_id", wintypes.DWORD),
            ("process_id", wintypes.DWORD), ("base_priority", wintypes.LONG),
            ("delta_priority", wintypes.LONG), ("flags", wintypes.DWORD),
        ]

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
    kernel.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    kernel.Thread32First.argtypes = kernel.Thread32Next.argtypes = [wintypes.HANDLE, ctypes.POINTER(ThreadEntry)]
    kernel.OpenThread.argtypes, kernel.OpenThread.restype = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD], wintypes.HANDLE
    kernel.ResumeThread.argtypes, kernel.ResumeThread.restype = [wintypes.HANDLE], wintypes.DWORD
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    snapshot = kernel.CreateToolhelp32Snapshot(0x00000004, 0)
    if snapshot == ctypes.c_void_p(-1).value:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        entry = ThreadEntry()
        entry.size = ctypes.sizeof(entry)
        found = kernel.Thread32First(snapshot, ctypes.byref(entry))
        while found:
            if entry.process_id == pid:
                thread = kernel.OpenThread(0x0002, False, entry.thread_id)
                if not thread:
                    raise ctypes.WinError(ctypes.get_last_error())
                try:
                    if kernel.ResumeThread(thread) == 0xFFFFFFFF:
                        raise ctypes.WinError(ctypes.get_last_error())
                    return
                finally:
                    kernel.CloseHandle(thread)
            found = kernel.Thread32Next(snapshot, ctypes.byref(entry))
        raise ValueError("Owned suspended server has no primary thread to resume")
    finally:
        kernel.CloseHandle(snapshot)


def summarize(events: list[dict[str, JsonValue]]) -> dict[str, JsonValue]:
    """Keep token identity/lifecycle and publication order, never infer empties are errors."""
    tokens: dict[str, dict[str, JsonValue]] = {}
    diagnostics: list[JsonValue] = []
    shutdown_progress: list[JsonValue] = []
    prior: dict[str, int] = {}
    errors: list[JsonValue] = []
    for index, event in enumerate(events):
        if event.get("direction") != "server":
            continue
        message = event.get("message")
        if not isinstance(message, dict):
            continue
        method, params = message.get("method"), message.get("params")
        if method not in {"window/workDoneProgress/create", "$/progress", "textDocument/publishDiagnostics"}:
            continue
        if not isinstance(params, dict):
            errors.append(f"Invalid parameters for {method}")
            continue
        if method == "textDocument/publishDiagnostics":
            uri, values = params.get("uri"), params.get("diagnostics")
            if not isinstance(uri, str) or not isinstance(values, list):
                errors.append("Invalid diagnostics publication")
                continue
            count = len(values)
            diagnostics.append({
                "event": index, "uri": uri, "version": params.get("version"), "count": count,
                "phase": event.get("phase"),
                "previous_count": prior.get(uri),
                "empty": count == 0,
                "interpretation": "empty publication; may clear diagnostics, not independently an error"
                if count == 0 else "nonempty publication",
            })
            prior[uri] = count
            continue
        token = params.get("token")
        try:
            key = token_key(token)
        except ValueError as error:
            errors.append(str(error))
            continue
        if event.get("phase") != "observation":
            shutdown_progress.append({"event": index, "token": token, "method": method, "value": params.get("value")})
            continue
        state = tokens.setdefault(key, {"token": token, "created": False, "begun": False, "ended": False, "events": []})
        history = state["events"]
        assert isinstance(history, list)
        if method == "window/workDoneProgress/create":
            if state["created"]:
                errors.append("Duplicate progress token creation")
            state["created"] = True
            history.append({"event": index, "kind": "create"})
        else:
            value = params.get("value")
            kind = value.get("kind") if isinstance(value, dict) else None
            if kind not in {"begin", "report", "end"} or not state["created"]:
                errors.append("Progress has unknown kind or no matching token creation")
            if kind == "begin":
                if state["begun"]:
                    errors.append("Duplicate progress begin")
                state["begun"] = True
            elif kind in {"report", "end"} and (not state["begun"] or state["ended"]):
                errors.append("Progress report/end outside an active begin/end lifecycle")
            if kind == "end":
                state["ended"] = True
            history.append({"event": index, "kind": kind, "value": value})
    return {
        "tokens": list(tokens.values()), "diagnostic_publications": diagnostics, "shutdown_progress": shutdown_progress,
        "protocol_errors": errors,
        "active_tokens_at_observation_end": [state["token"] for state in tokens.values() if state["begun"] and not state["ended"]],
        "created_without_begin": [state["token"] for state in tokens.values() if not state["begun"]],
        "interpretation": "An active token at this bounded cutoff is an observation, not proof of a hang, idle state, remaining-file identity or root cause.",
    }


class ProgressSession:
    """The wire vocabulary is fixed here, never supplied by the investigator."""

    def __init__(self, workspace: Path, open_file: str, mode: str, seconds: int, interpreter: Path):
        self.workspace, self.open_file, self.mode = workspace, open_file, mode
        self.seconds, self.interpreter = seconds, interpreter
        self.events: list[dict[str, JsonValue]] = []
        self.phase: Literal["observation", "shutdown"] = "observation"
        self.started = time.monotonic()
        self.wire_bytes = 0
        self.stderr = bytearray()
        self.pending: dict[int, asyncio.Future[JsonValue]] = {}
        self.sequence = 0
        self.writer: asyncio.StreamWriter | None = None
        self.configuration_seen = False
        self.unsupported: list[JsonValue] = []
        self.server_errors: list[JsonValue] = []
        self.file_publication_seen = False
        self.result: dict[str, JsonValue] = {"status": "blocked", "exit_code": None}

    def record(self, direction: str, message: dict[str, JsonValue], size: int) -> None:
        self.wire_bytes += size
        if self.wire_bytes > MAX_WIRE or len(self.events) >= MAX_EVENTS:
            raise ValueError("LSP protocol input/output exceeds its bound; capture is incomplete")
        self.events.append({
            "direction": direction, "phase": self.phase, "elapsed_seconds": round(time.monotonic() - self.started, 6),
            "message": message,
        })

    async def send(self, message: dict[str, JsonValue]) -> None:
        body = json.dumps({"jsonrpc": "2.0", **message}, ensure_ascii=True, allow_nan=False).encode()
        if len(body) > MAX_FRAME:
            raise ValueError("LSP outbound message exceeds its frame bound")
        self.record("client", {"jsonrpc": "2.0", **message}, len(body))
        assert self.writer is not None
        self.writer.write(f"Content-Length: {len(body)}\r\n\r\n".encode("ascii") + body)
        await self.writer.drain()

    async def request(self, method: str, params: JsonValue, reader: asyncio.Task[None]) -> JsonValue:
        self.sequence += 1
        identifier = self.sequence
        future = asyncio.get_running_loop().create_future()
        self.pending[identifier] = future
        try:
            await self.send({"id": identifier, "method": method, "params": params})
            done, _ = await asyncio.wait([future, reader], timeout=10, return_when=asyncio.FIRST_COMPLETED)
            if future in done:
                return future.result()
            if reader in done:
                await reader
                raise ValueError(f"LSP stream ended before {method} response")
            raise TimeoutError(f"LSP {method} response timed out")
        finally:
            self.pending.pop(identifier, None)
            if not future.done():
                future.cancel()

    def configuration(self, params: JsonValue) -> list[JsonValue]:
        if not isinstance(params, dict) or not isinstance(items := params.get("items"), list) or not 1 <= len(items) <= 8:
            raise ValueError("Unsupported LSP configuration query")
        python: dict[str, JsonValue] = {
            "pythonPath": str(self.interpreter), "analysis": {"diagnosticMode": self.mode},
        }
        values: dict[str, JsonValue] = {"python": python, "python.analysis": python["analysis"], "pyright": {}}
        result: list[JsonValue] = []
        for item in items:
            if not isinstance(item, dict) or not isinstance(section := item.get("section"), str) or section not in values:
                raise ValueError("Unsupported LSP configuration section/scope")
            scope = item.get("scopeUri")
            if scope is not None:
                if not isinstance(scope, str):
                    raise ValueError("Invalid LSP configuration scope URI")
                if not self.matches_uri(scope, self.workspace):
                    raise ValueError("Unsupported LSP configuration scope URI")
            result.append(values[section])
            if section in {"python", "python.analysis"}:
                self.configuration_seen = True
        return result

    @staticmethod
    def matches_uri(value: str, path: Path) -> bool:
        uri = urlparse(value)
        decoded = unquote(uri.path)
        if os.name == "nt" and re.match(r"^/[A-Za-z]:/", decoded):
            decoded = decoded[1:]
        return (
            uri.scheme == "file" and not uri.netloc and not uri.params and not uri.query and not uri.fragment
            and Path(decoded).is_absolute() and Path(decoded) == path
        )

    async def receive(self, stream: asyncio.StreamReader) -> None:
        while True:
            try:
                header = await stream.readuntil(b"\r\n\r\n")
            except asyncio.IncompleteReadError as error:
                if not error.partial:
                    return
                raise ValueError("Truncated LSP header") from error
            if len(header) > 1024:
                raise ValueError("LSP header exceeds its bound")
            headers: dict[str, str] = {}
            for line in header[:-4].decode("ascii").split("\r\n"):
                name, separator, value = line.partition(":")
                name = name.lower()
                if not separator or name in headers or name not in {"content-length", "content-type"}:
                    raise ValueError("Invalid/duplicate LSP header")
                headers[name] = value.strip()
            length = headers.get("content-length", "")
            if not length.isascii() or not length.isdecimal() or not 0 < int(length) <= MAX_FRAME:
                raise ValueError("Invalid or oversized LSP Content-Length")
            body = await stream.readexactly(int(length))
            message = parse_json(body)
            if not isinstance(message, dict) or message.get("jsonrpc") != "2.0":
                raise ValueError("Invalid LSP JSON-RPC envelope")
            self.record("server", message, len(body))
            if "method" in message:
                method, params = message["method"], message.get("params")
                if not isinstance(method, str):
                    raise ValueError("Invalid LSP method")
                if "id" not in message:
                    if method in {"window/logMessage", "window/showMessage"} and isinstance(params, dict) and params.get("type") in (1, 2):
                        self.server_errors.append(params)
                    if self.phase == "observation" and method == "textDocument/publishDiagnostics" and isinstance(params, dict):
                        uri = params.get("uri")
                        if isinstance(uri, str) and self.matches_uri(uri, self.workspace / self.open_file):
                            self.file_publication_seen = True
                    continue
                identifier = message["id"]
                if type(identifier) not in {str, int}:
                    raise ValueError("Invalid server request ID")
                if method == "workspace/configuration":
                    response: JsonValue = self.configuration(params)
                elif method == "window/workDoneProgress/create" and isinstance(params, dict) and set(params) == {"token"}:
                    token_key(params["token"])
                    response = None
                else:
                    self.unsupported.append(method)
                    await self.send({"id": identifier, "error": {"code": -32601, "message": "Unsupported by bounded progress probe"}})
                    continue
                await self.send({"id": identifier, "result": response})
            elif type(identifier := message.get("id")) is int and identifier in self.pending:
                future = self.pending[identifier]
                if future.done():
                    raise ValueError("Duplicate LSP response")
                if "error" in message:
                    future.set_exception(ValueError(f"LSP response error: {message['error']}"))
                elif "result" in message:
                    future.set_result(message["result"])
                else:
                    raise ValueError("LSP response has neither result nor error")
            else:
                raise ValueError("Unmatched LSP response")

    async def read_stderr(self, stream: asyncio.StreamReader) -> None:
        while data := await stream.read(4096):
            remaining = MAX_STDERR - len(self.stderr)
            self.stderr.extend(data[:remaining])
            if len(data) > remaining:
                raise ValueError("LSP stderr exceeds its bound; capture is incomplete")

    async def run(self, command: list[str], env: dict[str, str]) -> dict[str, JsonValue]:
        launch = asyncio.create_task(asyncio.create_subprocess_exec(
            *command, cwd=self.workspace, env=env, stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            limit=1024, start_new_session=os.name != "nt",
            creationflags=0x00000004 if os.name == "nt" else 0,
        ))
        cancelled_during_launch = False
        while not launch.done():
            try:
                await asyncio.shield(launch)
            except asyncio.CancelledError:
                cancelled_during_launch = True
        child = launch.result()
        self.result["pid"] = child.pid
        assert child.stdin is not None and child.stdout is not None and child.stderr is not None
        self.writer = child.stdin
        reader = asyncio.create_task(self.receive(child.stdout))
        stderr = asyncio.create_task(self.read_stderr(child.stderr))
        try:
            with owned_tree(child.pid):
                try:
                    if cancelled_during_launch:
                        raise asyncio.CancelledError
                    resume_owned_process(child.pid)
                    async with asyncio.timeout(self.seconds + 25):
                        initialized = await self.request("initialize", {
                            "processId": os.getpid(), "rootUri": self.workspace.as_uri(),
                            "workspaceFolders": [{"uri": self.workspace.as_uri(), "name": "progress-probe"}],
                            "capabilities": {
                                "window": {"workDoneProgress": True},
                                "workspace": {"configuration": True, "workspaceFolders": True},
                                "textDocument": {"publishDiagnostics": {"versionSupport": True}},
                            },
                        }, reader)
                        self.result["initialize_result"] = initialized
                        await self.send({"method": "initialized", "params": {}})
                        await self.send({"method": "workspace/didChangeConfiguration", "params": {"settings": {}}})
                        if self.mode == "openFilesOnly":
                            await self.send({"method": "textDocument/didOpen", "params": {"textDocument": {
                                "uri": (self.workspace / self.open_file).as_uri(), "languageId": "python", "version": 1,
                                "text": (self.workspace / self.open_file).read_text(encoding="utf-8"),
                            }}})
                        self.result["observation_started_seconds"] = round(time.monotonic() - self.started, 6)
                        done, _ = await asyncio.wait([reader, stderr], timeout=self.seconds, return_when=asyncio.FIRST_COMPLETED)
                        for task in done:
                            await task
                        if done:
                            raise ValueError("LSP process/stream ended before the observation window completed")
                        self.result["observation_window_complete"] = True
                        self.result["observation"] = summarize(self.events)
                        if self.server_errors or self.unsupported:
                            self.result.update({"status": "blocked", "error": "Server errors or unsupported requests were recorded"})
                        self.phase = "shutdown"
                        await self.request("shutdown", None, reader)
                        await self.send({"method": "exit"})
                        self.writer.close()
                        # wait() can also wait for inherited pipes; close the owned job before draining them.
                        async with asyncio.timeout(3):
                            while child.returncode is None:
                                await asyncio.sleep(0.01)
                        self.result["exit_code"] = child.returncode
                        observation = self.result["observation"]
                        assert isinstance(observation, dict)
                        if (
                            child.returncode != 0 or self.unsupported or not self.configuration_seen
                            or not self.file_publication_seen or self.server_errors or observation["protocol_errors"]
                        ):
                            raise ValueError("LSP exit, configuration handshake, source diagnostic publication or progress protocol was incomplete/invalid")
                        self.result["status"] = "observed"
                finally:
                    if child.returncode is None:
                        try:
                            child.terminate()
                        except ProcessLookupError:
                            pass
        except asyncio.CancelledError:
            self.result.update({"status": "cancelled", "error": "Controller cancelled the LSP probe"})
            raise
        except (OSError, ValueError, TimeoutError, asyncio.IncompleteReadError, asyncio.LimitOverrunError) as error:
            self.result["error"] = str(error)
        finally:
            async def cleanup() -> None:
                assert self.writer is not None and child.stdout is not None and child.stderr is not None
                if child.returncode is None:
                    try:
                        child.kill()
                    except ProcessLookupError:
                        pass
                self.writer.close()
                if self.result["status"] == "observed":
                    try:
                        await asyncio.wait_for(asyncio.gather(reader, stderr, return_exceptions=True), 3)
                    except TimeoutError:
                        self.result.update({"status": "blocked", "error": "Owned LSP streams did not reach EOF after exit"})
                else:
                    for task in (reader, stderr):
                        if not task.done():
                            task.cancel()
                outcomes = await asyncio.gather(reader, stderr, return_exceptions=True)
                for outcome in outcomes:
                    if isinstance(outcome, Exception):
                        self.result.update({"status": "blocked", "error": str(outcome)})

                async def drain(stream: asyncio.StreamReader) -> None:
                    while await stream.read(65536):
                        pass
                # Drain concurrently with wait: a parser/output-bound failure can leave full pipes.
                await asyncio.wait_for(asyncio.gather(drain(child.stdout), drain(child.stderr), child.wait()), 5)
            cleanup_task = asyncio.create_task(cleanup())
            cancelled = False
            while not cleanup_task.done():
                try:
                    await asyncio.shield(cleanup_task)
                except asyncio.CancelledError:
                    cancelled = True
            await cleanup_task
            self.result.update({
                "exit_code": child.returncode, "events": [event for event in self.events],
                "stderr": bytes(self.stderr).decode("utf-8", errors="replace"),
                "configuration_seen": self.configuration_seen, "unsupported_requests": self.unsupported,
                "file_publication_seen": self.file_publication_seen, "server_errors": self.server_errors,
                "wire_bytes": self.wire_bytes, "elapsed_seconds": round(time.monotonic() - self.started, 6),
            })
            if self.stderr:
                self.result.update({"status": "blocked", "error": "Nonempty language-server stderr; configuration/environment validity is unverified"})
            self.result["observation"] = summarize(self.events)
            if cancelled:
                self.result.update({"status": "cancelled", "error": "Controller cancelled during LSP cleanup"})
                raise asyncio.CancelledError
        return self.result


def environment(home: Path) -> dict[str, str]:
    home.mkdir()
    values = {key: value for key, value in os.environ.items() if key.upper() in {
        "PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "SYSTEMDRIVE", "TMP", "TEMP",
    }}
    values.update({key: str(home) for key in ("HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "XDG_CONFIG_HOME")})
    values["PYTHONNOUSERSITE"] = "1"
    return values


class LanguageServerRuntime:
    def __init__(
        self, root: Path, scratch: Path, directory: Path, *,
        prepared_store: TargetStore | None = None, prepared_targets: dict[str, ReproductionTarget] | None = None,
    ):
        self.root, self.scratch, self.directory = root.resolve(), scratch.resolve(), directory.resolve()
        self.prepared_store, self.prepared_targets = prepared_store, prepared_targets or {}
        self.lock = asyncio.Lock()
        self.attempts = 0

    async def target(self, identifier: str) -> tuple[Path, dict[str, JsonValue]]:
        if identifier == "checkout":
            package = self.root / "packages" / "pyright"
            for name in ("langserver.index.js", str(Path("dist") / "pyright-langserver.js")):
                if not (package / name).is_file():
                    raise ValueError(f"Prepared checkout LSP build is missing {package / name}; caller must build it")
            revision = await run_target_io(subprocess.check_output, ["git", "rev-parse", "HEAD"], cwd=self.root, timeout=5)
            return package, {
                "role": "checkout", "identity": revision.decode("ascii").strip(),
                "source": str(self.root), "source_tree_hash": await run_target_io(
                    tree_hash, self.root / "packages" / "pyright-internal" / "src",
                ),
                "version": json.loads((package / "package.json").read_text(encoding="utf-8"))["version"],
                "note": "Checkout build, not a published release even when versions match.",
            }
        target = self.prepared_targets.get(identifier)
        if self.prepared_store is None or target is None:
            raise ValueError("Unknown LSP target ID; only checkout or advertised prepared targets are available")
        await run_target_io(self.prepared_store.restore, target)
        await run_target_io(self.prepared_store.verify, target)
        assert target.directory is not None
        package = Path(target.directory)
        if not (package / "langserver.index.js").is_file() or not (package / "dist" / "pyright-langserver.js").is_file():
            raise ValueError("Sealed prepared target lacks the upstream language-server wrapper/bundle; not modified or resealed")
        return package, target.model_dump(mode="json")

    async def run(self, request: LspProbeRequest) -> dict[str, JsonValue]:
        async with self.lock:
            if self.attempts >= 3:
                raise ValueError("The three-attempt LSP allowance is exhausted; use saved observations")
            self.attempts += 1
            inputs = await run_target_io(capture_inputs, self.scratch, request)
            package, provenance = await self.target(request.target_id)
            attempt = self.directory / uuid.uuid4().hex
            attempt.mkdir(parents=True)
            snapshot = attempt / "runtime"
            snapshot.mkdir()
            no_links(package / "langserver.index.js")
            source_hash = await run_target_io(tree_hash, package / "dist")
            await run_target_io(copy_assets, package / "dist", snapshot / "dist")
            await run_target_io(shutil.copyfile, package / "langserver.index.js", snapshot / "langserver.index.js")
            if await run_target_io(tree_hash, snapshot / "dist") != source_hash:
                raise ValueError("Source LSP bundle changed while copying")
            if request.target_id != "checkout" and self.prepared_store is not None:
                await run_target_io(self.prepared_store.verify, self.prepared_targets[request.target_id])
            runtime_hash = await run_target_io(tree_hash, snapshot)
            node = shutil.which("node")
            if node is None:
                raise ValueError("Node is unavailable; caller must prepare the server runtime")
            node_env = environment(attempt / "runtime-home")
            node_version = await run_target_io(subprocess.check_output, [node, "--version"], env=node_env, timeout=5)
            cases: list[JsonValue] = []
            record: dict[str, JsonValue] = {
                "id": attempt.name, "kind": "language_server_observation", "product_surface": "language_server",
                "started_at": datetime.now(timezone.utc).isoformat(),
                "capability": "workspace_progress_v1", "target_id": request.target_id, "target": provenance,
                "probe_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                "request": request.model_dump(mode="json"), "inputs": {name: content for name, content in inputs.items()}, "runtime_hash": runtime_hash,
                "source_directory": str(self.scratch / request.project),
                "interpreter": {"executable": sys.executable, "version": sys.version, "platform": sys.platform},
                "node": {"executable": node, "version": node_version.decode("ascii").strip()},
                "cases": cases, "action_ineligible": True, "faithful_reproduction": False,
                "qualifications": [
                    "Inspected reconstructed workspace; original client initialize exchange was not supplied.",
                    "Controller interpreter is not necessarily the reported interpreter; static-target controls do not switch interpreters.",
                    "Configured checking-mode omission is preserved; server defaults are not evidence of reported settings.",
                    "Empty diagnostics may clear earlier diagnostics; publication alone proves neither a defect nor remaining-file identity.",
                    "Bounded progress cutoff is not proof of idle state, a permanent hang, templatelib causation, resolution or a duplicate.",
                ],
            }
            try:
                for name, version, mode in (
                    ("original", "3.14", "workspace"), ("target_313_control", "3.13", "workspace"),
                    ("open_files_control", "3.14", "openFilesOnly"),
                ):
                    workspace = attempt / name
                    workspace.mkdir()
                    case_inputs = dict(inputs)
                    if version == "3.13":
                        config = json.loads(case_inputs["pyrightconfig.json"])
                        config["pythonVersion"] = version
                        case_inputs["pyrightconfig.json"] = json.dumps(config, indent=2) + "\n"
                    for filename, content in case_inputs.items():
                        path = workspace / filename
                        path.parent.mkdir(parents=True, exist_ok=True)
                        path.write_bytes(content.encode("utf-8"))
                    before = await run_target_io(tree_hash, workspace)
                    env = environment(attempt / (name + "-home"))
                    command = [node, str(snapshot / "langserver.index.js"), "--stdio"]
                    session = ProgressSession(workspace, request.open_file, mode, request.observation_seconds, Path(sys.executable))
                    case: dict[str, JsonValue] = {
                        "case": name, "command": subprocess.list2cmdline(command), "cwd": str(workspace),
                        "inputs": {name: content for name, content in case_inputs.items()}, "input_hash": before,
                        "environment": {name: value for name, value in env.items()},
                        "settings": {"python": {"pythonPath": sys.executable, "analysis": {"diagnosticMode": mode}}},
                        "python_target": version, "observation_seconds": request.observation_seconds,
                        "observation": session.result,
                    }
                    cases.append(case)
                    await session.run(command, env)
                    case["exit_code"] = session.result.get("exit_code")
                    if await run_target_io(tree_hash, workspace) != before:
                        raise ValueError("LSP workspace changed during execution")
                if await run_target_io(capture_inputs, self.scratch, request) != inputs or await run_target_io(tree_hash, snapshot) != runtime_hash:
                    raise ValueError("LSP source/configuration/runtime changed during execution")
                if request.target_id != "checkout" and self.prepared_store is not None:
                    await run_target_io(self.prepared_store.verify, self.prepared_targets[request.target_id])
            except asyncio.CancelledError:
                record["error"] = "Controller cancelled; partial observations retained, not successful evidence"
                raise
            except (OSError, ValueError, TimeoutError) as error:
                record["error"] = str(error)
            finally:
                record["artifact"] = str(attempt / "observation.json")
                (attempt / "observation.json").write_text(json.dumps(record, indent=2), encoding="utf-8")
            return record


def observed_lsp_result(record: JsonValue) -> bool:
    if (
        not isinstance(record, dict) or record.get("kind") != "language_server_observation"
        or record.get("capability") != "workspace_progress_v1" or record.get("error")
        or not isinstance(cases := record.get("cases"), list) or len(cases) != 3
    ):
        return False
    names: set[str] = set()
    for case in cases:
        if not isinstance(case, dict) or not isinstance(name := case.get("case"), str):
            return False
        names.add(name)
    return all(
        isinstance(case, dict) and isinstance(observation := case.get("observation"), dict)
        and observation.get("status") == "observed" and observation.get("observation_window_complete") is True
        and observation.get("configuration_seen") is True and observation.get("exit_code") == 0
        for case in cases
    ) and names == {"original", "target_313_control", "open_files_control"}
