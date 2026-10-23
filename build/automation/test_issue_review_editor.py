# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

import asyncio
import copy
import ctypes
import hashlib
import json
import os
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from copilot import ToolInvocation
from copilot.session_events import AssistantMessageData

from issue_review_editor import (
    EditorRuntime, EditorUnavailable, compatible_host, copy_assets, editor_failure, editor_signature, fingerprint,
    update_in_progress,
)
from issue_review_models import ReproductionPlan
from issue_review_rca import Breakpoint, RootCauseRun, RootCauseRuntime
from review_issues import AGENTS, SDK, Agent, AutomationError, RootCauseTools
from test_review_issues import FakeGitHub


def editor_record(identifier="clean", debug=False, failure=True):
    cases = []
    for name in ("python_env", "venv", "python_envs/venv"):
        environment = str(Path("owned") / identifier / name)
        executable = str(Path(environment) / "Scripts" / "python.exe")
        value = environment if failure and name == "python_env" else executable
        cases.append({
            "case": name, "exit_code": 0, "settings": {"python.languageServer": "None"},
            "inputs": {"environment": environment, "expected_executable": executable},
            "observation": {
                "pid": 123, "host_version": "1.142.0", "complete": True, "errors": [],
                "startup": {"VIRTUAL_ENV": environment, "PATH": str(Path(executable).parent) + os.pathsep + "original-path"},
                "extensions": [
                    {"id": "ms-pyright.vscode-pyright", "version": "1.1.414"},
                    {"id": "ms-python.python", "version": "2026.1.0"},
                ],
                "execution_details": {"execCommand": [value]}, "forwarded_paths": [value],
                "server_paths": [value], "failure_observed": failure and name == "python_env", "feature_flags": {"usingNewInterpreterStorage": True},
                "hits": [{
                    "file": "extension.ts", "actual_source": {"line": 354},
                    "evaluations": [{"error": None, "result": {"result": {"type": "string", "value": value}}}],
                }] if debug else [],
            },
        })
    return {
        "id": identifier, "kind": "editor_debugger" if debug else "editor_run", "exit_code": 0,
        "runtime_hash": "private-assets", "cases": cases, "investigator": "root_cause",
        "capabilities": {
            "host_version": "1.142.0", "pyright_version": "1.1.414", "python": "3.14",
            "extensions": {"ms-python.python": {"version": "2026.1.0"}},
        },
    }


class EditorTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.root = self.directory / "repo"
        package = self.root / "packages" / "vscode-pyright"
        (package / "dist").mkdir(parents=True)
        (package / "src").mkdir()
        for name in ("extension.js", "extension.js.map", "server.js"):
            (package / "dist" / name).write_text("fixture", encoding="utf-8")
        metadata = {"name": "vscode-pyright", "publisher": "ms-pyright", "version": "1.1.414", "engines": {"vscode": "^1.101.0"}}
        (package / "package.json").write_text(json.dumps(metadata), encoding="utf-8")
        python = self.directory / "installed" / "ms-python.python-test"
        python.mkdir(parents=True)
        metadata.update({"name": "python", "publisher": "ms-python"})
        (python / "package.json").write_text(json.dumps(metadata), encoding="utf-8")
        code = self.directory / "host" / "Code.exe"
        (code.parent / "resources" / "app").mkdir(parents=True)
        code.touch()
        (code.parent / "resources" / "app" / "package.json").write_text('{"version":"1.142.0"}', encoding="utf-8")
        self.runner, self.code = AsyncMock(), code
        self.runtime = EditorRuntime(self.root, self.directory / "attempt", self.runner, code, python)
        self.runtime.directory.mkdir()

    async def test_preflight_is_read_only_and_rejects_missing_or_incompatible_assets(self):
        capability = await self.runtime.preflight()
        self.assertTrue(capability["available"])
        self.runner.assert_not_awaited()
        self.assertFalse(self.runtime.snapshot.exists())
        self.runtime.capabilities = None
        (self.code.parent / "resources" / "app" / "package.json").write_text('{"version":"1.85.1"}', encoding="utf-8")
        capability = await self.runtime.preflight()
        self.assertFalse(capability["available"])
        self.assertIn("engine", str(capability["missing"]))

    async def test_host_that_installs_bootstrap_extensions_is_rejected_before_launch(self):
        bootstrap = self.code.parent / "bootstrap" / "extensions"
        bootstrap.mkdir(parents=True)
        (bootstrap / "unrequested.vsix").touch()
        self.assertFalse((await self.runtime.preflight())["available"])
        self.runner.assert_not_awaited()

    async def test_update_preflight_blocks_copying_hashing_launch_and_repeated_attempts(self):
        with patch("issue_review_editor.update_in_progress", return_value=True), \
                patch("issue_review_editor.copy_assets") as copying, \
                patch("issue_review_editor.fingerprint") as hashing, \
                patch("issue_review_editor.editor_process") as launching:
            capability = await self.runtime.preflight()
            self.assertFalse(capability["available"])
            self.assertIn("update mutex", str(capability["missing"]))
            for _ in range(2):
                with self.assertRaisesRegex(EditorUnavailable, "Finish the VS Code update"):
                    await self.runtime.run(RootCauseRun())
            with self.assertRaisesRegex(ValueError, "update mutex"):
                await self.runtime.prepare()
        copying.assert_not_called()
        hashing.assert_not_called()
        launching.assert_not_called()
        self.runner.assert_not_awaited()
        self.assertFalse(self.runtime.snapshot.exists())

    async def test_update_after_cached_preflight_is_rechecked(self):
        self.assertTrue((await self.runtime.preflight())["available"])
        with patch("issue_review_editor.update_in_progress", return_value=True):
            capability = await self.runtime.preflight()
        self.assertFalse(capability["available"])
        self.assertIn("update mutex", str(capability["missing"]))

    @unittest.skipUnless(os.name == "nt", "Windows update mutex")
    async def test_native_update_query_closes_its_read_only_handle(self):
        from ctypes import wintypes
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.CreateMutexW.argtypes, kernel.CreateMutexW.restype = [ctypes.c_void_p, wintypes.BOOL, wintypes.LPCWSTR], wintypes.HANDLE
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        product = {"win32VersionedUpdate": True, "win32MutexName": "pyright-rca-test-" + self.directory.name}
        self.assertFalse(update_in_progress(product))
        handle = kernel.CreateMutexW(None, False, str(product["win32MutexName"]) + "-updating")
        self.assertTrue(handle)
        try:
            self.assertTrue(update_in_progress(product))
            self.assertTrue(update_in_progress(product))
        finally:
            kernel.CloseHandle(handle)
        self.assertFalse(update_in_progress(product))

    async def test_streaming_digest_preserves_existing_receipts_and_exclusions(self):
        directory = self.directory / "digest"
        (directory / "extensions").mkdir(parents=True)
        (directory / "z.bin").write_bytes(bytes(range(256)) * 8192)
        (directory / "a.js").write_text("first", encoding="utf-8")
        for name in ("extensions.json", ".obsolete"):
            (directory / "extensions" / name).write_text("ignored", encoding="utf-8")
        old_files = {
            str(path.relative_to(directory)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(directory.rglob("*"))
            if path.is_file() and path.relative_to(directory) not in {
                Path("extensions") / "extensions.json", Path("extensions") / ".obsolete",
            }
        }
        expected = hashlib.sha256(json.dumps(old_files, sort_keys=True).encode()).hexdigest()
        progress = Mock()
        with patch.object(Path, "read_bytes", side_effect=AssertionError("Use streaming reads")):
            self.assertEqual(fingerprint(directory, progress), expected)
        self.assertEqual(progress.call_args.args[1], 2)
        self.assertEqual({call.args[0] for call in progress.call_args_list}, {"files_hashed"})

    async def test_copy_progress_keeps_link_rejection_and_reports_completed_files(self):
        source, destination = self.directory / "assets", self.directory / "copy"
        source.mkdir()
        (source / "file.js").write_text("owned", encoding="utf-8")
        progress = Mock()
        copy_assets(source, destination, progress)
        self.assertEqual((destination / "file.js").read_text(), "owned")
        self.assertIn("paths_checked", {call.args[0] for call in progress.call_args_list})
        self.assertEqual(progress.call_args.args[:2], ("files_copied", 1))
        (source / "second.js").write_text("must not be copied after cancellation", encoding="utf-8")
        def cancel(kind, count, _path):
            if kind == "files_copied" and count == 1:
                raise RuntimeError("operation cancelled")
        with self.assertRaisesRegex(RuntimeError, "operation cancelled"):
            copy_assets(source, self.directory / "cancelled", cancel)
        self.assertEqual(len(list((self.directory / "cancelled").iterdir())), 1)
        with patch.object(Path, "is_symlink", return_value=True):
            with self.assertRaisesRegex(ValueError, "filesystem links"):
                copy_assets(source, self.directory / "rejected")
        self.assertFalse((self.directory / "rejected").exists())

    async def test_phase_heartbeats_failures_and_cancellation_are_durable(self):
        self.assertEqual(self.runtime.heartbeat_seconds, 15)
        self.runtime.heartbeat_seconds = 0.01
        heartbeat = asyncio.Event()
        emit = self.runtime.emit
        def observed(status, **details):
            emit(status, **details)
            if status == "running":
                heartbeat.set()
        with patch("builtins.print") as output, patch.object(self.runtime, "emit", side_effect=observed):
            async with self.runtime.phase("fixture hashing"):
                counter = self.runtime.counter()
                counter("files_hashed", 7, "fixture.js")
                await asyncio.wait_for(heartbeat.wait(), 5)
            with self.assertRaisesRegex(ValueError, "fixture failure"):
                async with self.runtime.phase("fixture failure"):
                    raise ValueError("fixture failure")
            with self.assertRaises(TimeoutError):
                async with asyncio.timeout(0.03):
                    async with self.runtime.phase("fixture cancellation"):
                        counter = self.runtime.counter()
                        await asyncio.sleep(10)
            with self.assertRaisesRegex(RuntimeError, "operation cancelled"):
                counter("files_hashed", 8, "must-not-continue.js")
        records = [json.loads(line) for line in (self.runtime.directory / "editor-events.jsonl").read_text().splitlines()]
        hashing = [record for record in records if record["phase"] == "fixture hashing"]
        self.assertEqual(hashing[0]["status"], "started")
        self.assertTrue(any(record["status"] == "running" for record in hashing))
        self.assertEqual(hashing[-1]["status"], "completed")
        self.assertEqual(hashing[-1]["progress"]["completed"], 7)
        self.assertTrue(all(record["at"] and record["elapsed_seconds"] >= 0 for record in records))
        self.assertTrue(any(record.get("error") == "fixture failure" and record["status"] == "failed" for record in records))
        self.assertEqual(records[-1]["status"], "cancelled")
        self.assertEqual(records[-1]["exception"], "CancelledError")
        output.assert_called()

    async def test_preparation_logs_each_copy_and_the_complete_receipt_hash(self):
        helpers = self.root / "build" / "automation"
        helpers.mkdir(parents=True)
        for name in ("issue_review_editor_probe.cjs", "issue_review_inspector.cjs"):
            (helpers / name).write_text("// Fixture; not executed.\n", encoding="utf-8")
        with patch("builtins.print"):
            await self.runtime.prepare()
        receipt = json.loads((self.runtime.directory / "editor-runtime.json").read_text())
        self.assertEqual(receipt["sha256"], fingerprint(self.runtime.snapshot))
        events = [json.loads(line) for line in (self.runtime.directory / "editor-events.jsonl").read_text().splitlines()]
        complete = [event for event in events if event["status"] == "completed"]
        self.assertEqual([event["phase"] for event in complete], [
            "copy Pyright", "copy ms-python.python", "hash prepared assets",
        ])
        self.assertEqual(complete[-1]["progress"]["completed"], 7)
        self.runner.assert_not_awaited()

    async def test_actual_versions_and_date_suffixed_engine_ranges(self):
        self.assertTrue(compatible_host("1.141.0-insider", "^1.110.0-20260204"))
        self.assertFalse(compatible_host("1.85.1", "^1.101.0"))
        self.assertFalse(compatible_host("2.0.0", "^1.101.0"))
        self.assertFalse(compatible_host("1.110.0-insider", "^1.110.0-20260204", "2026-02-03T12:00:00Z"))
        with self.assertRaisesRegex(ValueError, "build date"):
            compatible_host("1.110.0-insider", "^1.110.0-20260204")
        with self.assertRaisesRegex(ValueError, "Unsupported"):
            compatible_host("1.141.0", "unknown")

    async def test_editor_assets_resume_only_when_capabilities_and_hash_match(self):
        helpers = self.root / "build" / "automation"
        helpers.mkdir(parents=True)
        for name in ("issue_review_editor_probe.cjs", "issue_review_inspector.cjs"):
            (helpers / name).write_text("// Fixture; not executed.\n", encoding="utf-8")
        with patch("builtins.print"):
            await self.runtime.prepare()
            resumed = EditorRuntime(
                self.root, self.runtime.directory, self.runner, self.code, self.runtime.python_extension,
            )
            await resumed.prepare()
            self.assertEqual(resumed.snapshot_hash, self.runtime.snapshot_hash)
            (resumed.snapshot / "pyright" / "package.json").write_text("{}", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "changed"):
                await EditorRuntime(
                    self.root, self.runtime.directory, self.runner, self.code, self.runtime.python_extension,
                ).prepare()

    async def test_explicit_host_and_extension_paths_are_resolved_before_changing_process_cwd(self):
        python_extension = self.runtime.python_extension
        assert python_extension is not None
        runtime = EditorRuntime(
            self.root, self.runtime.directory, self.runner,
            Path(os.path.relpath(self.code)), Path(os.path.relpath(python_extension)),
        )
        self.assertEqual(runtime.code, self.code.resolve())
        self.assertEqual(runtime.python_extension, self.runtime.python_extension)

    async def test_private_asset_tampering_and_editor_breakpoint_escape_are_rejected(self):
        self.runtime.snapshot.mkdir()
        self.runtime.snapshot_hash = fingerprint(self.runtime.snapshot)
        with self.assertRaisesRegex(ValueError, "vscode-pyright"):
            await self.runtime.run(RootCauseRun(breakpoints=[Breakpoint(file="../outside.ts", line=1)]))
        (self.runtime.snapshot / "changed.js").touch()
        with self.assertRaisesRegex(ValueError, "changed"):
            await self.runtime.run(RootCauseRun())

    async def test_normalization_keeps_versions_controls_api_outcomes_and_startup_fidelity(self):
        clean, debug = editor_record(), editor_record("debug", debug=True)
        self.assertTrue(editor_failure(clean))
        self.assertEqual(editor_signature(clean), editor_signature(debug))
        self.assertFalse(editor_failure(editor_record(failure=False)))
        for mutate in (
            lambda value: value["cases"].pop(),
            lambda value: value["cases"][0]["observation"].update(complete=False),
            lambda value: value["cases"][0]["observation"].update(errors=["Missing API"]),
            lambda value: value["cases"][0]["observation"].update(host_version="1.85.1"),
            lambda value: value["cases"][0]["observation"]["startup"].update(VIRTUAL_ENV="wrong"),
            lambda value: value["cases"][0]["observation"]["startup"].update(PATH="wrong"),
            lambda value: value["cases"][0]["observation"]["extensions"][1].update(version="different"),
        ):
            value = copy.deepcopy(clean)
            mutate(value)
            self.assertIsNone(editor_signature(value))
        debug["cases"][0]["observation"]["failure_observed"] = False
        self.assertNotEqual(editor_signature(clean), editor_signature(debug))

    async def test_editor_consent_denial_never_prepares_or_runs_the_host(self):
        scratch = self.directory / "scratch"
        scratch.mkdir()
        runtime = RootCauseRuntime(self.root, self.runtime.directory, scratch, AsyncMock())
        plan = ReproductionPlan(
            surface="editor", runner="editor_interpreter", target="Current installed host", reason="Interpreter handoff",
            prerequisites=[], setup=["Fresh activated venv"], failure_signal="Directory reaches server", controls=["venv"],
        )
        tools = RootCauseTools(
            FakeGitHub(), scratch, {}, self.runtime.directory, runtime, editor=self.runtime, plan=plan, ask=lambda _: "n",
        )
        invocation = ToolInvocation(session_id="test", tool_call_id="editor", tool_name="rca_editor_run", arguments={})
        with patch.object(self.runtime, "run", AsyncMock()) as run, patch("review_issues.show") as output:
            result = await tools.rca_editor_run(invocation)
        self.assertEqual(result.result_type, "failure")
        self.assertIn("declined", result.text_result_for_llm)
        self.assertIn("declined", tools.last_editor_error or "")
        self.assertTrue(any("FAILED:" in str(call) and "declined" in str(call) for call in output.call_args_list))
        run.assert_not_awaited()
        self.assertFalse(self.runtime.snapshot.exists())

    async def test_wrong_surface_and_debugging_before_failure_are_refused(self):
        scratch = self.directory / "scratch"
        scratch.mkdir()
        runtime = RootCauseRuntime(self.root, self.runtime.directory, scratch, AsyncMock())
        plan = ReproductionPlan(
            surface="editor", runner="editor_interpreter", target="Current", reason="Interpreter handoff",
            prerequisites=[], setup=["Activate actual env"], failure_signal="Wrong server path", controls=["venv"],
        )
        tools = RootCauseTools(
            FakeGitHub(), scratch, {}, self.runtime.directory, runtime, editor=self.runtime, plan=plan,
            ask=lambda _: self.fail("No execution approval should be requested"),
        )
        invocation = ToolInvocation(session_id="test", tool_call_id="cli", tool_name="rca_run", arguments={})
        self.assertIn("CLI proxy", (await tools.rca_run(invocation)).text_result_for_llm)
        invocation.arguments = {"breakpoints": [{"file": "extension.ts", "line": 354}]}
        self.assertIn("clean run", (await tools.rca_editor_run(invocation)).text_result_for_llm)

    async def test_editor_approval_wait_does_not_use_the_sdk_turn_deadline(self):
        await self.runtime.preflight()
        scratch = self.directory / "scratch"
        scratch.mkdir()
        runtime = RootCauseRuntime(self.root, self.runtime.directory, scratch, AsyncMock())
        plan = ReproductionPlan(
            surface="editor", runner="editor_interpreter", target="Current", reason="Actual handoff",
            prerequisites=[], setup=["Activated environment"], failure_signal="Directory handoff", controls=["venv"],
        )
        def approve(_question):
            time.sleep(0.5)
            return "y"
        tools = RootCauseTools(
            FakeGitHub(), scratch, {}, self.runtime.directory, runtime, editor=self.runtime, plan=plan, ask=approve,
        )
        profile = Agent.load(AGENTS / "pyright-issue-root-cause.md", "pyright-issue-root-cause")
        session = AsyncMock()
        session.session_id = "slow-editor-approval"
        session.rpc.agent.get_current.return_value = SimpleNamespace(agent=SimpleNamespace(name=profile.name))
        session.rpc.tools.get_current_metadata.return_value = SimpleNamespace(
            tools=[SimpleNamespace(name=name) for name in [
                "view", "glob", "web_fetch", "rg", "apply_patch", *[tool.name for tool in tools.tools],
            ]],
        )
        invocation = ToolInvocation(session_id=session.session_id, tool_call_id="editor", tool_name="rca_editor_run", arguments={})
        async def product(_request):
            deadline = tools.deadline
            assert deadline is not None
            self.assertIsNotNone(deadline.when())
            await asyncio.sleep(0.01)
            return editor_record(failure=False)
        async def respond(_prompt, **options):
            async def turn():
                result = await tools.rca_editor_run(invocation)
                self.assertEqual(result.result_type, "success")
                return SimpleNamespace(data=AssistantMessageData(content="Observed handoff", message_id="message"))
            return await asyncio.wait_for(turn(), options["timeout"])
        session.send_and_wait.side_effect = respond
        client = AsyncMock()
        client.create_session.return_value = session
        with patch.object(self.runtime, "run", side_effect=product), patch("review_issues.show"):
            result = await SDK(client, "gpt-6.1-sol", 0.25).run(profile, "Observe the handoff", scratch, tools=tools)
        self.assertEqual(result, "Observed handoff")
        self.assertIsNone(tools.deadline)
        session.abort.assert_not_awaited()
        session.disconnect.assert_awaited_once()

    async def test_editor_execution_timeout_is_actionable_and_cleans_up_its_child(self):
        child = AsyncMock()
        child.pid, child.returncode = 12345, None
        child.kill = Mock()
        async def timeout(operation, _seconds):
            operation.close()
            raise TimeoutError()
        progress = Mock()
        with patch("issue_review_editor.asyncio.create_subprocess_exec", return_value=child), \
                patch("issue_review_editor.owned_tree"), \
                patch("issue_review_editor.asyncio.wait_for", side_effect=timeout):
            with self.assertRaisesRegex(TimeoutError, "180.*isolated editor"):
                from issue_review_editor import editor_process
                await editor_process(["Code.exe"], self.directory, {}, progress)
        child.kill.assert_called_once()
        child.wait.assert_awaited_once()
        self.assertEqual(progress.call_args.args, ("cleaning up owned editor processes", child.pid))

    async def test_concurrent_editor_requests_share_approval_and_never_overlap_runtime_preparation(self):
        scratch = self.directory / "scratch"
        scratch.mkdir()
        runtime = RootCauseRuntime(self.root, self.runtime.directory, scratch, AsyncMock())
        plan = ReproductionPlan(
            surface="editor", runner="editor_interpreter", target="Current", reason="Actual handoff",
            prerequisites=[], setup=["Activated environment"], failure_signal="Directory handoff", controls=["venv"],
        )
        approval = Mock(return_value="y")
        tools = RootCauseTools(
            FakeGitHub(), scratch, {}, self.runtime.directory, runtime, editor=self.runtime, plan=plan, ask=approval,
        )
        running = False
        async def product(_request):
            nonlocal running
            self.assertFalse(running)
            running = True
            await asyncio.sleep(0.01)
            running = False
            return editor_record(failure=False)
        with patch.object(self.runtime, "run", side_effect=product), patch("review_issues.show"):
            results = await asyncio.gather(*(
                tools.rca_editor_run(ToolInvocation(
                    session_id="test", tool_call_id=str(index), tool_name="rca_editor_run", arguments={},
                )) for index in range(2)
            ))
        self.assertTrue(all(result.result_type == "success" for result in results))
        approval.assert_called_once()

    async def test_each_editor_call_uses_three_new_profiles_and_preserves_the_activation_trigger(self):
        self.runtime.snapshot.mkdir()
        self.runtime.snapshot_hash = fingerprint(self.runtime.snapshot)
        self.runtime.capabilities = {"available": True}
        self.runtime.extensions = {"ms-python.python": self.directory / "removed-original"}
        copied = self.runtime.snapshot / "extensions" / "ms-python.python"
        copied.mkdir(parents=True)
        (copied / "package.json").write_text('{"version":"2026.1.0"}', encoding="utf-8")
        self.runtime.snapshot_hash = fingerprint(self.runtime.snapshot)
        calls = []
        async def runner(command, cwd):
            Path(command[-1]).mkdir(parents=True)
            return 0, "", ""
        self.runtime.runner = runner
        async def host(command, cwd, env, progress):
            manifest = json.loads(Path(env["PYRIGHT_RCA_EDITOR_MANIFEST"]).read_text(encoding="utf-8"))
            self.assertEqual(env["VIRTUAL_ENV"], manifest["environment"])
            self.assertEqual(env["PATH"].split(os.pathsep)[0], str(Path(manifest["expected_executable"]).parent))
            self.assertEqual(env["VSCODE_CWD"], str(cwd))
            self.assertEqual(str(cwd), manifest["workspace"])
            case = Path(manifest["profile"]).parent
            self.assertRegex(case.name, r"^case-[123]$")
            self.assertEqual(Path(manifest["environment"]).relative_to(case), Path("envs") / manifest["case"])
            self.assertIn("--sync", command)
            settings = json.loads((Path(manifest["profile"]) / "User" / "settings.json").read_text())
            self.assertNotIn("python.defaultInterpreterPath", settings)
            self.assertNotIn("python.pythonPath", settings)
            self.assertEqual(settings["extensions.allowed"]["ms-python.python"], ["2026.1.0"])
            calls.append(manifest["profile"])
            Path(manifest["artifact"]).write_text(json.dumps({
                "id": manifest["id"], "case": manifest["case"], "complete": False, "errors": ["Fixture, not a real product run"],
            }), encoding="utf-8")
            return 2, "", ""
        async def prepared():
            self.runtime.snapshot_hash = fingerprint(self.runtime.snapshot)
        self.runtime.snapshot_hash = None
        with patch.object(self.runtime, "prepare", side_effect=prepared), \
                patch("issue_review_editor.editor_process", side_effect=host), \
                patch("issue_review_editor.fingerprint", wraps=fingerprint) as hashing:
            first = await self.runtime.run(RootCauseRun())
            self.assertEqual(hashing.call_count, 1, "Do not rehash an immediately prepared snapshot before its first run")
            second = await self.runtime.run(RootCauseRun())
            self.assertEqual(hashing.call_count, 3, "Subsequent runs need before/after integrity verification")
        self.assertEqual(len(calls), len(set(calls)))
        self.assertEqual(len(calls), 6)
        self.assertEqual(first["exit_code"], 2)
        self.assertNotEqual(first["id"], second["id"])
        events = [json.loads(line) for line in (self.runtime.directory / "editor-events.jsonl").read_text().splitlines()]
        complete = [event for event in events if event["status"] == "completed"]
        venvs = [event for event in complete if event["phase"].endswith(": create venv")]
        hosts = [event for event in complete if event["phase"].endswith(": run editor/probe")]
        self.assertEqual(len(venvs), 6)
        self.assertEqual(len(hosts), 6)
        self.assertTrue(all(event["exit_code"] == 0 and "-m venv" in event["command"] for event in venvs))
        self.assertTrue(all(event["exit_code"] == 2 and event["cwd"].endswith("workspace") for event in hosts))

    async def test_startup_update_race_preserves_logs_and_prevents_another_expensive_run(self):
        self.runtime.snapshot.mkdir()
        self.runtime.snapshot_hash = fingerprint(self.runtime.snapshot)
        self.runtime.capabilities = {"available": True}
        self.runner.return_value = (0, "", "")
        with patch("issue_review_editor.editor_process", return_value=(1, "", "Code - Insiders is currently being updated.")) as host, \
                patch("issue_review_editor.fingerprint", wraps=fingerprint) as hashing:
            for _ in range(2):
                with self.assertRaisesRegex(EditorUnavailable, "Finish the update"):
                    await self.runtime.run(RootCauseRun())
        self.assertEqual(host.await_count, 1)
        self.assertEqual(hashing.call_count, 1)
        stderr = list((self.runtime.directory / "editor-runs").glob("*/*/stderr.txt"))
        self.assertEqual(len(stderr), 1)
        self.assertIn("currently being updated", stderr[0].read_text())
        assert self.runtime.last_progress is not None
        self.assertEqual(self.runtime.last_progress["status"], "failed")
        self.assertEqual(self.runtime.last_progress["exception"], "EditorUnavailable")

    async def test_sdk_timeout_preserves_the_last_editor_phase_and_underlying_failure(self):
        scratch = self.directory / "scratch"
        scratch.mkdir()
        runtime = RootCauseRuntime(self.root, self.runtime.directory, scratch, AsyncMock())
        tools = RootCauseTools(FakeGitHub(), scratch, {}, self.runtime.directory, runtime, editor=self.runtime)
        tools.last_editor_error = "Host updater still held"
        self.runtime.last_progress = {"phase": "verify assets before run", "status": "running", "elapsed_seconds": 42}
        profile = Agent.load(AGENTS / "pyright-issue-root-cause.md", "pyright-issue-root-cause")
        session = AsyncMock()
        session.session_id = "editor-timeout"
        session.rpc.agent.get_current.return_value = SimpleNamespace(agent=SimpleNamespace(name=profile.name))
        session.rpc.tools.get_current_metadata.return_value = SimpleNamespace(
            tools=[SimpleNamespace(name=name) for name in [
                "view", "glob", "web_fetch", "rg", "apply_patch", *[tool.name for tool in tools.tools],
            ]],
        )
        session.send_and_wait.side_effect = TimeoutError()
        client = AsyncMock()
        client.create_session.return_value = session
        with self.assertRaisesRegex(AutomationError, "verify assets before run.*Host updater still held"):
            await SDK(client, "gpt-6.1-sol", 900).run(profile, "A fixture", scratch, tools=tools, evidence=self.runtime.directory)
        events = [
            json.loads(line) for line in (self.runtime.directory / "sdk-events.jsonl").read_text().splitlines()
        ]
        timeouts = [event for event in events if event["type"] == "controller.timeout"]
        self.assertEqual(len(timeouts), 1)
        event = timeouts[0]
        self.assertEqual(event["data"]["last_editor_error"], tools.last_editor_error)
        self.assertEqual(event["data"]["editor_progress"], self.runtime.last_progress)
        self.assertTrue(event["data"]["editor_events"].endswith("editor-events.jsonl"))
        session.abort.assert_awaited_once()
        session.disconnect.assert_awaited_once()
