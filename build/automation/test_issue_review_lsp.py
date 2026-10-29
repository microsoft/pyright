# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

import asyncio
import ctypes
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch

from copilot import ToolInvocation
from copilot.generated.session_events import PermissionRequestCustomTool, PermissionRequestShell
from pydantic import JsonValue, ValidationError

from issue_review_lsp import (
    MAX_EVENTS, MAX_FRAME, MAX_INPUT, MAX_STDERR, MAX_WIRE, LanguageServerRuntime, LspProbeRequest, ProgressSession,
    capture_inputs, environment, observed_lsp_result, parse_json, summarize,
)
from issue_review_reproduction import tree_hash
from issue_review_models import Check, ReproductionTarget
from review_issues import (
    ROOT, AutomationError, InvestigationTools, PermissionDecisionApproveOnce, PermissionDecisionReject,
    validate_review_execution,
)
from test_review_issues import FakeGitHub, audit


SERVER = r'''
import json, os, subprocess, sys, time
mode = sys.argv[1]
root_uri = ""
def send(value):
    body = json.dumps({"jsonrpc":"2.0", **value}).encode()
    header = ("Content-Length: %d\r\n\r\n" % len(body)).encode()
    sys.stdout.buffer.write(header[:8]); sys.stdout.buffer.flush()
    sys.stdout.buffer.write(header[8:] + body); sys.stdout.buffer.flush()
def receive():
    headers = {}
    while True:
        line = sys.stdin.buffer.readline()
        if not line: sys.exit(0)
        if line == b"\r\n": break
        key, value = line.split(b":", 1)
        headers[key.lower()] = value.strip()
    return json.loads(sys.stdin.buffer.read(int(headers[b"content-length"])))
if mode in {"descendant", "cancel", "failure-descendant"}:
    child = subprocess.Popen([sys.executable, "-I", "-c", "import time; time.sleep(120)"])
    with open(sys.argv[2], "w") as stream:
        stream.write(str(child.pid))
if mode in {"oversized", "failure-descendant"}:
    sys.stdout.buffer.write(b"Content-Length: 999999999\r\n\r\n" + b"x" * 1000000)
    sys.stdout.buffer.flush()
    time.sleep(120)
if mode == "stderr":
    sys.stderr.write("x" * 1000000); sys.stderr.flush(); time.sleep(120)
while True:
    message = receive()
    method = message.get("method")
    if method == "initialize":
        root_uri = message["params"]["rootUri"]
        send({"id": message["id"], "result":{"capabilities":{}}})
    elif method == "initialized":
        send({"id":"config", "method":"workspace/configuration", "params":{"items":[{"section":"python"}]}})
    elif message.get("id") == "config":
        if mode == "unknown":
            send({"id":"unsafe", "method":"workspace/executeCommand", "params":{"command":"not executed"}})
        if mode == "exit":
            sys.exit(2)
        for token in (1, "1"):
            send({"id":"create-" + str(type(token)), "method":"window/workDoneProgress/create", "params":{"token":token}})
            send({"method":"$/progress","params":{"token":token,"value":{"kind":"begin","title":""}}})
            send({"method":"$/progress","params":{"token":token,"value":{"kind":"report","message":"1 file to analyze"}}})
        uri = root_uri + "/a.py"
        send({"method":"textDocument/publishDiagnostics","params":{"uri":uri,"diagnostics":[{"message":"prior"}]}})
        send({"method":"textDocument/publishDiagnostics","params":{"uri":uri,"diagnostics":[]}})
        if mode != "shutdown-end":
            for token in (1, "1"):
                send({"method":"$/progress","params":{"token":token,"value":{"kind":"end"}}})
    elif method == "shutdown":
        if mode == "shutdown-end":
            for token in (1, "1"):
                send({"method":"$/progress","params":{"token":token,"value":{"kind":"end"}}})
        send({"id":message["id"],"result":None})
    elif method == "exit":
        sys.exit(0)
'''


def event(method, params, phase="observation"):
    return {"direction": "server", "phase": phase, "message": {"method": method, "params": params}}


def complete_record():
    return {
        "id": "lsp", "kind": "language_server_observation", "capability": "workspace_progress_v1",
        "target_id": "checkout", "action_ineligible": True,
        "cases": [
            {
                "case": name, "command": "node owned-server --stdio", "cwd": "owned-" + name, "exit_code": 0,
                "observation": {
                    "status": "observed", "exit_code": 0, "observation_window_complete": True,
                    "configuration_seen": True,
                },
            } for name in ("original", "target_313_control", "open_files_control")
        ],
    }


class LspInputsTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        (self.directory / "a.py").write_text("# inspected, never executed\nx: int = 1\n", encoding="utf-8")
        self.config = self.directory / "pyrightconfig.json"
        self.config.write_text('{"pythonVersion":"3.14"}', encoding="utf-8")

    def test_explicit_config_and_original_source_are_preserved(self):
        original = b"# a.py\r\nx: int = 1\r\n"
        (self.directory / "a.py").write_bytes(original)
        inputs = capture_inputs(self.directory, LspProbeRequest())
        self.assertEqual(inputs["a.py"].encode(), original)
        self.assertEqual(inputs["pyrightconfig.json"], self.config.read_text())

    def test_missing_config_or_source_is_not_silently_supplied(self):
        self.config.unlink()
        with self.assertRaisesRegex(ValueError, "explicit"):
            capture_inputs(self.directory, LspProbeRequest())
        self.config.write_text('{"pythonVersion":"3.14"}', encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "existing"):
            capture_inputs(self.directory, LspProbeRequest(open_file="missing.py"))

    def test_escaping_project_and_open_file_paths_are_rejected(self):
        for path in ("..", "../outside", "C:\\outside", "\\\\host\\share", "a:stream"):
            with self.subTest(path=path), self.assertRaises(ValueError):
                capture_inputs(self.directory, LspProbeRequest(project=path))
            with self.subTest(open_file=path), self.assertRaises(ValueError):
                capture_inputs(self.directory, LspProbeRequest(open_file=path))

    def test_only_bounded_source_and_restricted_config_are_accepted(self):
        for config in (
            {"pythonVersion": "3.13"}, {"pythonVersion": "3.14", "extends": "../other"},
            {"pythonVersion": "3.14", "venvPath": "outside"},
            {"pythonVersion": "3.14", "include": ["../outside"]},
            {"pythonVersion": "3.14", "typeCheckingMode": []},
            {"pythonVersion": "3.14", "reportUnknownVariableType": {}},
        ):
            self.config.write_text(json.dumps(config), encoding="utf-8")
            with self.subTest(config=config), self.assertRaises(ValueError):
                capture_inputs(self.directory, LspProbeRequest())
        self.config.write_text('{"pythonVersion":"3.14"}', encoding="utf-8")
        (self.directory / "a.py").write_text("x" * MAX_INPUT, encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "bound"):
            capture_inputs(self.directory, LspProbeRequest())

    def test_other_project_files_are_not_ignored(self):
        (self.directory / "pyproject.toml").write_text("[tool.pyright]", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "Unsupported LSP input"):
            capture_inputs(self.directory, LspProbeRequest())

    def test_request_has_no_arbitrary_protocol_command_or_interpreter_field(self):
        for arguments in (
            {"messages": []}, {"command": "shell"}, {"pythonPath": "reporter.exe"},
            {"observation_seconds": 31}, {"observation_seconds": 0},
        ):
            with self.subTest(arguments=arguments), self.assertRaises(ValidationError):
                LspProbeRequest.model_validate(arguments)

    def test_duplicate_and_nonfinite_json_are_rejected(self):
        for text in ('{"a":1,"a":2}', '{"a":NaN}', '{"a":Infinity}'):
            with self.subTest(text=text), self.assertRaises(ValueError):
                parse_json(text)

    def test_environment_does_not_forward_node_python_or_cloud_injection(self):
        with patch.dict(os.environ, {"NODE_OPTIONS": "--require reporter", "PYTHONPATH": "reporter", "SECRET": "not captured"}):
            env = environment(self.directory / "home")
        self.assertNotIn("NODE_OPTIONS", env)
        self.assertNotIn("PYTHONPATH", env)
        self.assertNotIn("SECRET", env)
        self.assertEqual(env["HOME"], str(self.directory / "home"))


class LspSummaryTests(unittest.TestCase):
    def test_token_identity_create_begin_report_end_and_diagnostic_clears(self):
        events = []
        for token in (1, "1"):
            events.extend([
                event("window/workDoneProgress/create", {"token": token}),
                event("$/progress", {"token": token, "value": {"kind": "begin", "title": ""}}),
                event("$/progress", {"token": token, "value": {"kind": "report", "message": "1 file to analyze"}}),
            ])
        events.extend([
            event("$/progress", {"token": 1, "value": {"kind": "end"}}),
            event("textDocument/publishDiagnostics", {"uri": "file:///a.py", "diagnostics": [{"message": "x"}]}),
            event("textDocument/publishDiagnostics", {"uri": "file:///a.py", "diagnostics": []}),
            event("$/progress", {"token": "1", "value": {"kind": "end"}}, "shutdown"),
        ])
        result = summarize(events)
        self.assertEqual(result["active_tokens_at_observation_end"], ["1"])
        self.assertTrue(result["shutdown_progress"])
        tokens, publications = result["tokens"], result["diagnostic_publications"]
        assert isinstance(tokens, list) and isinstance(publications, list)
        publication = publications[1]
        assert isinstance(publication, dict) and isinstance(publication["interpretation"], str)
        self.assertEqual(len(tokens), 2)
        self.assertEqual(publication["previous_count"], 1)
        self.assertIn("may clear", publication["interpretation"])
        self.assertEqual(result["protocol_errors"], [])

    def test_uncreated_or_unbegun_tokens_and_duplicate_lifecycles_are_invalid(self):
        for events in (
            [event("$/progress", {"token": "bad", "value": {"kind": "end"}})],
            [event("window/workDoneProgress/create", {"token": True})],
            [event("window/workDoneProgress/create", {"token": 1})] * 2,
        ):
            self.assertTrue(summarize(events)["protocol_errors"])

    def test_created_without_begin_is_not_an_active_analysis(self):
        result = summarize([event("window/workDoneProgress/create", {"token": 2})])
        self.assertEqual(result["created_without_begin"], [2])
        self.assertEqual(result["active_tokens_at_observation_end"], [])

    def test_partial_or_failed_cases_do_not_establish_completed_observation(self):
        self.assertTrue(observed_lsp_result(complete_record()))
        for field, value in (("status", "blocked"), ("configuration_seen", False), ("observation_window_complete", False), ("exit_code", 1)):
            record = complete_record()
            record["cases"][1]["observation"][field] = value
            self.assertFalse(observed_lsp_result(record))
        record = complete_record()
        record["error"] = "changed inputs"
        self.assertFalse(observed_lsp_result(record))


class LspProtocolTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        (self.directory / "a.py").write_text("x: int = 1\n", encoding="utf-8")

    async def run_server(self, mode="normal"):
        session = ProgressSession(self.directory, "a.py", "workspace", 1, Path(sys.executable))
        command = [sys.executable, "-I", "-u", "-c", SERVER, mode, str(self.directory / "descendant.pid")]
        return session, await session.run(command, environment(self.directory / "home"))

    async def test_real_framed_protocol_completes_and_drains_both_streams(self):
        session, result = await self.run_server()
        self.assertEqual(result["status"], "observed", result.get("error"))
        self.assertEqual(result["exit_code"], 0)
        self.assertTrue(result["configuration_seen"])
        observation = result["observation"]
        assert isinstance(observation, dict) and isinstance(observation["diagnostic_publications"], list)
        publication = observation["diagnostic_publications"][-1]
        assert isinstance(publication, dict)
        self.assertEqual(observation["active_tokens_at_observation_end"], [])
        self.assertEqual(publication["previous_count"], 1)
        self.assertTrue(any(isinstance(event["message"], dict) and event["message"].get("method") == "shutdown" for event in session.events))

    async def test_shutdown_progress_does_not_complete_observation_tokens(self):
        _, result = await self.run_server("shutdown-end")
        self.assertEqual(result["status"], "observed", result.get("error"))
        observation = result["observation"]
        assert isinstance(observation, dict)
        self.assertEqual(observation["active_tokens_at_observation_end"], [1, "1"])

    async def test_oversized_frames_stderr_early_exit_and_unknown_requests_fail_closed(self):
        for mode in ("oversized", "stderr", "exit", "unknown"):
            with self.subTest(mode=mode):
                home = self.directory / "home"
                if home.exists():
                    home.rmdir()
                _, result = await self.run_server(mode)
                self.assertEqual(result["status"], "blocked")
                self.assertTrue(result.get("error"))
                assert isinstance(result["stderr"], str)
                self.assertLessEqual(len(result["stderr"]), MAX_STDERR)
                if mode == "unknown":
                    self.assertEqual(result["unsupported_requests"], ["workspace/executeCommand"])

    async def test_bad_json_headers_and_configuration_queries_are_rejected(self):
        session = ProgressSession(self.directory, "a.py", "workspace", 1, Path(sys.executable))
        for content in (
            b"Content-Length: -1\r\n\r\n",
            b"Content-Length: 1\r\nContent-Length: 1\r\n\r\nx",
            b"Content-Length: " + str(MAX_FRAME + 1).encode() + b"\r\n\r\n",
            b"Content-Length: 3\r\n\r\n[]x",
            b"Content-Length: 5\r\n\r\n{}",
        ):
            stream = asyncio.StreamReader()
            stream.feed_data(content)
            stream.feed_eof()
            with self.subTest(content=content), self.assertRaises((ValueError, asyncio.IncompleteReadError)):
                await session.receive(stream)
        queries: list[JsonValue] = [
            {"items": [{"section": "execute"}]},
            {"items": [{"section": "python", "scopeUri": "file:///outside"}]},
            {"items": []},
        ]
        for query in queries:
            with self.subTest(query=query), self.assertRaises(ValueError):
                session.configuration(query)

    async def test_aggregate_wire_and_event_limits_reject_without_truncating_success(self):
        session = ProgressSession(self.directory, "a.py", "workspace", 1, Path(sys.executable))
        session.record("server", {}, MAX_WIRE)
        with self.assertRaisesRegex(ValueError, "bound"):
            session.record("server", {}, 1)
        session = ProgressSession(self.directory, "a.py", "workspace", 1, Path(sys.executable))
        for _ in range(MAX_EVENTS):
            session.record("server", {}, 1)
        with self.assertRaisesRegex(ValueError, "bound"):
            session.record("server", {}, 1)
        self.assertEqual(len(session.events), MAX_EVENTS)

    @unittest.skipUnless(os.name == "nt", "Windows file URI encoding")
    async def test_server_encoded_drive_colon_matches_only_the_owned_workspace(self):
        session = ProgressSession(self.directory, "a.py", "workspace", 1, Path(sys.executable))
        uri = self.directory.as_uri().replace("C:", "c%3A")
        self.assertTrue(session.matches_uri(uri, self.directory))
        self.assertFalse(session.matches_uri(uri + "/outside", self.directory))
        values = session.configuration({"items": [{"section": "python", "scopeUri": uri}]})
        self.assertEqual(len(values), 1)

    async def test_normal_exit_and_cancellation_kill_owned_descendants(self):
        for mode in ("descendant", "cancel", "failure-descendant"):
            with self.subTest(mode=mode):
                pidfile = self.directory / "descendant.pid"
                pidfile.unlink(missing_ok=True)
                home = self.directory / "home"
                if home.exists():
                    home.rmdir()
                session = ProgressSession(self.directory, "a.py", "workspace", 30 if mode == "cancel" else 1, Path(sys.executable))
                command = [sys.executable, "-I", "-u", "-c", SERVER, mode, str(pidfile)]
                task = asyncio.create_task(session.run(command, environment(home)))
                async def cleanup(task=task):
                    if not task.done():
                        task.cancel()
                    await asyncio.gather(task, return_exceptions=True)
                self.addAsyncCleanup(cleanup)
                async with asyncio.timeout(5):
                    while not pidfile.exists() or not pidfile.read_text():
                        await asyncio.sleep(0.01)
                pid = int(pidfile.read_text())
                if mode == "cancel":
                    task.cancel()
                    with self.assertRaises(asyncio.CancelledError):
                        await task
                    self.assertEqual(session.result["status"], "cancelled")
                elif mode == "descendant":
                    self.assertEqual((await task)["status"], "observed", session.result)
                else:
                    self.assertEqual((await task)["status"], "blocked")
                if os.name == "nt":
                    from ctypes import wintypes
                    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
                    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
                    kernel.OpenProcess.restype = wintypes.HANDLE
                    kernel.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
                    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
                    handle = kernel.OpenProcess(0x1000, False, pid)
                    if handle:
                        try:
                            code = wintypes.DWORD()
                            self.assertTrue(kernel.GetExitCodeProcess(handle, ctypes.byref(code)))
                            self.assertNotEqual(code.value, 259, "Owned descendant remained running")
                        finally:
                            kernel.CloseHandle(handle)

    async def test_cancellation_during_launch_joins_then_kills_the_owned_process(self):
        launch = asyncio.create_subprocess_exec
        entered = asyncio.Event()

        async def delayed(*args, **kwargs):
            entered.set()
            await asyncio.sleep(0.05)
            return await launch(*args, **kwargs)

        session = ProgressSession(self.directory, "a.py", "workspace", 1, Path(sys.executable))
        command = [sys.executable, "-I", "-u", "-c", SERVER, "normal"]
        with patch("issue_review_lsp.asyncio.create_subprocess_exec", delayed):
            task = asyncio.create_task(session.run(command, environment(self.directory / "home")))
            await entered.wait()
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
        self.assertEqual(session.result["status"], "cancelled")
        self.assertIsNotNone(session.result["exit_code"])


class LspRuntimeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.scratch = self.directory / "scratch"
        self.scratch.mkdir()
        (self.scratch / "a.py").write_text("raise RuntimeError('source is not executed')\n", encoding="utf-8")
        (self.scratch / "pyrightconfig.json").write_text('{"pythonVersion":"3.14"}\n', encoding="utf-8")
        self.package = self.directory / "package"
        (self.package / "dist").mkdir(parents=True)
        (self.package / "dist" / "pyright-langserver.js").write_text("// fixture", encoding="utf-8")
        (self.package / "langserver.index.js").write_text("// fixture", encoding="utf-8")
        self.runtime = LanguageServerRuntime(ROOT, self.scratch, self.directory / "evidence")

    async def test_controls_are_separate_and_original_inputs_unchanged(self):
        before = tree_hash(self.scratch)
        self.runtime.target = AsyncMock(return_value=(self.package, {"identity": "fixture"}))
        cases = []

        async def run(session, command, env):
            cases.append((session.mode, json.loads((session.workspace / "pyrightconfig.json").read_text())["pythonVersion"]))
            session.result.update({
                "status": "observed", "exit_code": 0, "observation_window_complete": True,
                "configuration_seen": True,
            })
            return session.result

        with patch.object(ProgressSession, "run", run):
            result = await self.runtime.run(LspProbeRequest(observation_seconds=1))
        self.assertEqual(cases, [("workspace", "3.14"), ("workspace", "3.13"), ("openFilesOnly", "3.14")])
        self.assertEqual(tree_hash(self.scratch), before)
        self.assertTrue(result["action_ineligible"])
        self.assertFalse(result["faithful_reproduction"])
        assert isinstance(result["artifact"], str)
        self.assertTrue(Path(result["artifact"]).is_file())
        self.assertTrue(observed_lsp_result(result))

    async def test_missing_prepared_wrappers_are_blocked_without_resealing(self):
        target = ReproductionTarget(
            role="historical", identity="npm:pyright@1.1.414", version="1.1.414", source="fixture",
            selection_reason="fixture", directory=str(self.package),
        )
        store = Mock(restore=Mock(), verify=Mock())
        self.runtime.prepared_store = store
        self.runtime.prepared_targets = {"opaque": target}
        (self.package / "langserver.index.js").unlink()
        before = tree_hash(self.package)
        with self.assertRaisesRegex(ValueError, "Sealed"):
            await self.runtime.target("opaque")
        self.assertEqual(tree_hash(self.package), before)
        with self.assertRaisesRegex(ValueError, "Unknown"):
            await self.runtime.target("1.1.414")

    async def test_cancellation_retains_partial_receipt_outside_original_inputs(self):
        self.runtime.target = AsyncMock(return_value=(self.package, {"identity": "fixture"}))

        async def cancel(session, command, env):
            session.result["status"] = "cancelled"
            raise asyncio.CancelledError

        with patch.object(ProgressSession, "run", cancel), self.assertRaises(asyncio.CancelledError):
            await self.runtime.run(LspProbeRequest())
        artifacts = list((self.directory / "evidence").glob("*\\observation.json" if os.name == "nt" else "*/observation.json"))
        self.assertEqual(len(artifacts), 1)
        record = json.loads(artifacts[0].read_text())
        self.assertIn("cancelled", record["error"])
        self.assertFalse(observed_lsp_result(record))


class LspInvestigationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.tools = InvestigationTools(FakeGitHub(), self.directory / "scratch", ROOT / "packages" / "pyright" / "index.js", {}, evidence=self.directory)

    async def test_ordinary_behavior_has_bounded_tools_without_shell_or_github_mutations(self):
        self.assertIn("lsp_progress_probe", [tool.name for tool in self.tools.tools])
        request = PermissionRequestCustomTool(tool_name="lsp_progress_probe", tool_description="bounded probe", args={})
        self.assertIsInstance(self.tools.permission(request, {"session_id": "test"}), PermissionDecisionApproveOnce)
        request = PermissionRequestShell(
            intention="execute arbitrary LSP", full_command_text="node arbitrary",
            can_offer_session_approval=False, commands=[], has_write_file_redirection=False,
            possible_paths=[], possible_urls=[],
        )
        self.assertIsInstance(self.tools.permission(request, {"session_id": "test"}), PermissionDecisionReject)

    async def test_receipt_pages_preserve_exact_protocol_and_invalid_paths_fail(self):
        record = complete_record()
        record["events"] = "x" * 20000
        self.tools.lsp.run = AsyncMock(return_value=record)
        result = await self.tools.lsp_progress_probe(ToolInvocation(
            session_id="test", tool_call_id="probe", tool_name="lsp_progress_probe", arguments={},
        ))
        self.assertEqual(result.result_type, "success")
        self.assertIn("lsp_read_evidence", result.text_result_for_llm)
        result = await self.tools.lsp_read_evidence(ToolInvocation(
            session_id="test", tool_call_id="read", tool_name="lsp_read_evidence",
            arguments={"evidence_id": "lsp", "pointer": "/events", "max_chars": 20},
        ))
        self.assertEqual(json.loads(result.text_result_for_llm)["content"], '"' + "x" * 19)
        result = await self.tools.lsp_read_evidence(ToolInvocation(
            session_id="test", tool_call_id="read", tool_name="lsp_read_evidence",
            arguments={"evidence_id": "../file", "pointer": ""},
        ))
        self.assertEqual(result.result_type, "failure")

    async def test_screening_stop_prevents_protocol_execution(self):
        self.tools.screening_stopped = True
        self.tools.lsp.run = AsyncMock()
        result = await self.tools.lsp_progress_probe(ToolInvocation(
            session_id="test", tool_call_id="probe", tool_name="lsp_progress_probe", arguments={},
        ))
        self.assertEqual(result.result_type, "failure")
        self.tools.lsp.run.assert_not_awaited()

    def test_prepared_target_bindings_are_shared_with_the_bounded_lsp_runtime(self):
        store = Mock()
        target = ReproductionTarget(
            role="latest", identity="npm:pyright@1.1.414", version="1.1.414",
            source="fixture", selection_reason="Controller-selected fixture",
        )
        tools = InvestigationTools(
            FakeGitHub(), self.directory / "bound-scratch", ROOT / "packages" / "pyright" / "index.js", {},
            evidence=self.directory / "bound-evidence", prepared_store=store, prepared_targets=[target],
        )
        assert tools.prepared_checks is not None
        self.assertIs(tools.lsp.prepared_store, store)
        self.assertIs(tools.lsp.prepared_targets, tools.prepared_checks.targets)

    def test_prepared_lsp_checks_do_not_upgrade_release_reproduction(self):
        record = complete_record()
        record["target_id"] = "opaque-prepared-target"
        report = audit()
        report.product_surface = "language_server"
        for target in report.claims[0].reproduction:
            target.status, target.check_ids = "blocked", []
        report.checks = [Check(
            id="lsp-check", status="executed", command="node owned-server --stdio", cwd="owned-original",
            exit_code=0, observations="Qualified prepared-target LSP observation only.",
        )]
        validate_review_execution(report, [record])
        self.assertFalse(report.observed_product())
        report.claims[0].reproduction[0].status = "reproduced"
        report.claims[0].reproduction[0].check_ids = ["lsp-check"]
        with self.assertRaisesRegex(AutomationError, "faithful"):
            validate_review_execution(report, [record])

    async def test_cli_receipts_cannot_satisfy_lsp_or_editor_claims(self):
        target = Mock(target="checkout", status="reproduced", check_ids=["check"])
        report = Mock(
            product_surface="language_server",
            claims=[Mock(id="C1", reproduction=[target])],
            checks=[Mock(id="check", status="executed", command="cli", cwd="here", exit_code=0)],
        )
        cli = {"kind": "pyright", "command": "cli", "cwd": "here", "exit_code": 0,
               "stdout": '{"version":"1.1.414","generalDiagnostics":[]}'}
        with self.assertRaises(AutomationError):
            validate_review_execution(report, [cli])
        record = complete_record()
        case = record["cases"][0]
        report.checks[0].command, report.checks[0].cwd = case["command"], case["cwd"]
        with self.assertRaises(AutomationError):
            validate_review_execution(report, [record])
        target.status = "blocked"
        validate_review_execution(report, [record])
        report.product_surface = "editor"
        target.status = "reproduced"
        with self.assertRaises(AutomationError):
            validate_review_execution(report, [record])
        report.product_surface = "language_server"
        target.target = "reported_release"
        with self.assertRaises(AutomationError):
            validate_review_execution(report, [record])


if __name__ == "__main__":
    unittest.main()
