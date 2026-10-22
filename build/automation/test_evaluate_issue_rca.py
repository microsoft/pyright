# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

import inspect
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from copilot import ToolInvocation
from copilot.generated.rpc import PermissionDecisionReject
from copilot.generated.session_events import PermissionRequestRead, PermissionRequestShell

import evaluate_issue_rca
from evaluate_issue_design import BlindReport
from evaluate_issue_rca import (
    PROTOCOL, PROTOCOL_VERSION, BlindSDK, BlindTools, implementation_fingerprints,
    run_cohort, source_path, target_fingerprint,
)
from issue_review_evidence import MAX_RESPONSE_BYTES, evidence_json
from issue_review_rca import RootCauseRuntime
from review_issues import AutomationError, GitHub, RootCauseTools, digest


def invocation(arguments):
    return ToolInvocation(session_id="test", tool_call_id="test", tool_name="test", arguments=arguments)


class BlindRCATests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source = self.root / "historical"
        self.base = self.source / "packages" / "pyright-internal" / "src"
        (self.base / "analyzer").mkdir(parents=True)
        (self.base / "analyzer" / "example.ts").write_text("function oldProducer() {}\n", encoding="utf-8")
        self.scratch = self.root / "scratch"
        self.scratch.mkdir()
        evidence = self.root / "evidence"
        runtime = RootCauseRuntime(self.source, evidence, self.scratch, AsyncMock())
        self.tools = BlindTools(RootCauseTools(GitHub(), self.scratch, {}, evidence, runtime), self.source)

    async def test_only_historical_implementation_is_readable(self):
        result = await self.tools.read_source(invocation({"file": "analyzer/example.ts"}))
        self.assertEqual(result.result_type, "success")
        self.assertIn("oldProducer", result.text_result_for_llm)
        for name in ("../package.json", "../../../package.json", "tests/regression.ts"):
            result = await self.tools.read_source(invocation({"file": name}))
            self.assertEqual(result.result_type, "failure")
        (self.base / "tests").mkdir()
        (self.base / "tests" / "secret.ts").write_text("SECRET oldProducer", encoding="utf-8")
        result = await self.tools.read_source(invocation({"find": "oldProducer"}))
        self.assertNotIn("SECRET", result.text_result_for_llm)

    async def test_frozen_original_and_configuration_cannot_change_even_after_baseline(self):
        result = await self.tools.write_scratch(invocation({"file": "original.py", "content": "changed"}))
        self.assertEqual(result.result_type, "failure")
        (self.scratch / "pyrightconfig.json").write_text("{}", encoding="utf-8")
        result = await self.tools.write_scratch(invocation({"file": "pyrightconfig.json", "content": '{"strict": []}'}))
        self.assertEqual(result.result_type, "failure")
        self.tools.cli_baseline = True
        result = await self.tools.write_scratch(invocation({"file": "pyrightconfig.json", "content": '{"strict": []}'}))
        self.assertEqual(result.result_type, "failure")
        result = await self.tools.write_scratch(invocation({"file": "controls/pyrightconfig.json", "content": '{}'}))
        self.assertEqual(result.result_type, "success")

    async def test_project_schema_and_selected_project_reach_runtime_with_full_tree(self):
        tool = next(tool for tool in self.tools.tools if tool.name == "rca_run")
        assert tool.parameters is not None
        self.assertIn("project", tool.parameters["properties"])
        (self.scratch / "original.py").write_text("value: int = 'bad'\n", encoding="utf-8")
        (self.scratch / "pyrightconfig.json").write_text('{"include":["original.py"]}', encoding="utf-8")
        await self.tools.write_scratch(invocation({"file": "controls/control.py", "content": "value: int = 1\n"}))
        await self.tools.write_scratch(invocation({
            "file": "controls/pyrightconfig.json", "content": '{"include":["control.py"]}',
        }))
        self.tools.runtime.snapshot_hash = "runtime"
        async def run(request):
            return {
                "id": "control-clean", "kind": "product_run",
                "project": str(self.tools.runtime.project_path(request).relative_to(self.scratch)),
                "cwd": str(self.scratch), "runtime_hash": "runtime",
                "inputs": self.tools.runtime.capture_inputs(), "exit_code": 0,
                "stdout": '{"version":"test","summary":{"filesAnalyzed":1},"generalDiagnostics":[]}',
                "debug": {"errors": [], "hits": []},
            }
        self.tools.runtime.run = AsyncMock(side_effect=run)
        result = await self.tools.rca_run(invocation({"project": "controls/pyrightconfig.json"}))
        self.assertEqual(result.result_type, "success", result.text_result_for_llm)
        call = self.tools.runtime.run.await_args
        assert call is not None
        self.assertEqual(call.args[0].project, "controls/pyrightconfig.json")
        record = json.loads(result.text_result_for_llm)
        self.assertEqual(len(record["inputs"]), 4)
        self.assertEqual(self.tools.check_count, 1)
        resumed = BlindTools(self.tools, self.source)
        self.assertEqual(resumed.check_count, 1)
        self.assertEqual(resumed.cli_baselines[0]["project"], str(Path("controls/pyrightconfig.json")))
        request = {"project": "pyrightconfig.json", "breakpoints": [{"file": "analyzer/example.ts", "line": 1}]}
        rejected = await resumed.rca_run(invocation(request))
        self.assertEqual(rejected.result_type, "failure")
        self.assertIn("First run a clean", rejected.text_result_for_llm)
        self.assertEqual(resumed.check_count, 1)

    async def test_fresh_adversary_gets_only_frozen_original_not_primary_controls(self):
        report = BlindReport(
            id="case-anonymous", body="Anonymous report", clarifications=[],
            repro_source="value: int = 'bad'\n", configuration={"typeCheckingMode": "standard"},
        )
        evidence = self.root / "adversary-evidence"
        scratch = self.root / "adversary"
        scratch.mkdir()
        runtime = RootCauseRuntime(self.source, evidence, scratch, AsyncMock())
        tools = RootCauseTools(GitHub(), scratch, {}, evidence, runtime, adversary=True)
        sdk = BlindSDK(None, "test", 10, self.source, report)
        with patch("evaluate_issue_rca.SDK.run", AsyncMock(return_value="ok")) as run:
            await sdk.run(None, "prompt", scratch, tools=tools)
        self.assertEqual((scratch / "original.py").read_text(), report.repro_source)
        self.assertEqual(json.loads((scratch / "pyrightconfig.json").read_text())["include"], ["original.py"])
        self.assertEqual({path.name for path in scratch.iterdir()}, {"original.py", "pyrightconfig.json"})
        call = run.await_args
        assert call is not None
        self.assertEqual(call.kwargs["native_tools"], [])
        self.assertEqual(call.kwargs["tools"].investigator, "root_cause_adversary")

    async def test_bounded_execution_and_page_schema_forward_exact_saved_values_without_attempts(self):
        tool = next(tool for tool in self.tools.tools if tool.name == "rca_read_evidence")
        assert tool.parameters is not None and tool.handler is not None
        properties = tool.parameters["properties"]
        self.assertEqual(set(properties), {"evidence_id", "pointer", "offset", "max_chars"})
        self.assertEqual(properties["max_chars"]["maximum"], 4096)
        (self.scratch / "original.py").write_text("pass\n", encoding="utf-8")
        (self.scratch / "pyrightconfig.json").write_text('{"include":["original.py"]}', encoding="utf-8")
        self.tools.runtime.snapshot_hash = "runtime"
        failure = "Failed original observation\n" * 2000

        async def run(request):
            return {
                "id": "debug" if request.breakpoints else "clean",
                "kind": "debugger" if request.breakpoints else "product_run",
                "project": request.project, "cwd": str(self.scratch), "runtime_hash": "runtime",
                "inputs": self.tools.runtime.capture_inputs(), "exit_code": 0,
                "stdout": '{"version":"test","summary":{"filesAnalyzed":1},"generalDiagnostics":[]}',
                "debug": {"errors": [], "hits": [{
                    "file": "analyzer/example.ts", "actual_source": {"line": 1},
                    "evaluations": [{"expression": "deepObject", "error": failure, "result": None}],
                }] if request.breakpoints else []},
            }

        self.tools.runtime.run = AsyncMock(side_effect=run)
        await self.tools.rca_run(invocation({}))
        result = await self.tools.rca_run(invocation({"breakpoints": [{"file": "analyzer/example.ts", "line": 1}]}))
        self.assertEqual(result.result_type, "success")
        self.assertLessEqual(len(result.text_result_for_llm.encode()), MAX_RESPONSE_BYTES)
        index = json.loads(result.text_result_for_llm)
        self.assertEqual(index["view"], "evidence_index")
        self.assertEqual(index["failed_evaluations"], 1)
        ledger = self.tools.evidence / "checks.jsonl"
        before = ledger.read_bytes()
        selected = "/debug/hits/0/evaluations/0/error"
        arguments = {"evidence_id": "debug", "pointer": selected, "offset": 7, "max_chars": 37}
        pending = tool.handler(invocation(arguments))
        assert inspect.isawaitable(pending)
        page = await pending
        delivered = json.loads(page.text_result_for_llm)
        self.assertEqual(delivered["pointer"], selected)
        self.assertEqual(delivered["offset"], 7)
        self.assertEqual(delivered["next_offset"], 44)
        self.assertEqual(delivered["content"], evidence_json(failure)[7:44])
        self.assertEqual(delivered["record_sha256"], index["record_sha256"])
        self.assertEqual(ledger.read_bytes(), before)
        self.assertEqual(self.tools.check_count, 2)
        self.assertEqual(BlindTools(self.tools, self.source).check_count, 2)
        deliveries = [
            json.loads(line) for line in (self.tools.evidence / "evidence-delivery.jsonl").read_text().splitlines()
        ]
        self.assertEqual(deliveries[-1]["arguments"], arguments)
        self.assertEqual(deliveries[-1]["response"], page.text_result_for_llm)
        self.assertEqual(deliveries[-1]["response_bytes"], len(page.text_result_for_llm.encode()))
        self.assertEqual(deliveries[-1]["attempts"], 2)

    async def test_large_historical_source_uses_production_saved_evidence_transport(self):
        content = "const source = '" + "x" * 20000 + "';\n"
        (self.base / "analyzer" / "example.ts").write_text(content, encoding="utf-8")
        result = await self.tools.read_source(invocation({"file": "analyzer/example.ts"}))
        self.assertLessEqual(len(result.text_result_for_llm.encode()), MAX_RESPONSE_BYTES)
        index = json.loads(result.text_result_for_llm)
        self.assertEqual(index["view"], "evidence_index")
        parts, offset = [], 0
        while True:
            result = await self.tools.rca_read_evidence(invocation({
                "evidence_id": index["id"], "pointer": "/content", "offset": offset, "max_chars": 4096,
            }))
            self.assertEqual(result.result_type, "success")
            self.assertLessEqual(len(result.text_result_for_llm.encode()), MAX_RESPONSE_BYTES)
            page = json.loads(result.text_result_for_llm)
            parts.append(page["content"])
            if page["next_offset"] is None:
                break
            offset = page["next_offset"]
        self.assertEqual(json.loads("".join(parts)), "1: " + content.rstrip("\n"))
        self.assertEqual(self.tools.check_count, 0)

    async def test_escape_writes_and_native_permissions_are_denied(self):
        result = await self.tools.write_scratch(invocation({"file": "../outside.py", "content": "pass"}))
        self.assertEqual(result.result_type, "failure")
        for request in (
            PermissionRequestRead(intention="read", path=str(self.base / "analyzer" / "example.ts")),
            PermissionRequestShell(
                intention="inspect history", full_command_text="git log",
                can_offer_session_approval=False, commands=[], has_write_file_redirection=False,
                possible_paths=[], possible_urls=[],
            ),
        ):
            self.assertIsInstance(self.tools.permission(request, {"session_id": "test"}), PermissionDecisionReject)

    async def test_fix_research_and_editor_proxy_tools_are_absent(self):
        self.assertEqual(
            {tool.name for tool in self.tools.tools},
            {"rca_run", "rca_read_evidence", "write_scratch", "read_historical_source", "rca_read_source"},
        )
        result = await self.tools.read_authority(invocation({"url": "https://github.com/microsoft/pyright/pull/123"}))
        self.assertEqual(result.result_type, "failure")

    async def test_fingerprint_detects_source_changes_but_ignores_withheld_tests(self):
        before = target_fingerprint(self.source, False)
        (self.base / "tests").mkdir()
        (self.base / "tests" / "secret.ts").write_text("withheld", encoding="utf-8")
        self.assertEqual(before, target_fingerprint(self.source, False))
        (self.base / "analyzer" / "example.ts").write_text("changed", encoding="utf-8")
        self.assertNotEqual(before, target_fingerprint(self.source, False))
        with self.assertRaises(AutomationError):
            source_path(self.source, "tests/secret.ts")

    async def test_unavailable_case_is_explicit_and_changed_report_fails_closed(self):
        report = BlindReport(
            id="case-a", body="Original report", clarifications=[],
            repro_source="pass\n", configuration={},
        )
        report_path = self.root / "report.json"
        report_path.write_text(report.model_dump_json(), encoding="utf-8")
        (self.source / "benchmark-provenance.json").write_text(
            json.dumps({"source_sha256": "source", "build_sha256": "build"}), encoding="utf-8",
        )
        manifest = self.root / "manifest.json"
        manifest.write_text(json.dumps({
            "protocol_version": PROTOCOL_VERSION,
            "implementation_sha256": implementation_fingerprints(),
            "protocol_sha256": digest(PROTOCOL),
            "harness_sha256": digest(Path(evaluate_issue_rca.__file__).read_text(encoding="utf-8")),
            "cases": [{
                "id": "case-a", "report": str(report_path), "source": str(self.source),
                "report_sha256": digest(report.model_dump_json()),
                "source_sha256": "source", "build_sha256": "build",
                "availability": "unavailable", "availability_reason": "Requires unsupported editor surface",
            }],
        }), encoding="utf-8")
        results = await run_cohort(manifest, self.root / "run", None, None, SimpleNamespace(chunk_size=1))
        self.assertEqual(results[0]["status"], "unavailable")
        self.assertIsNone(results[0]["root_cause"])
        report_path.write_text(report.model_copy(update={"body": "Changed"}).model_dump_json(), encoding="utf-8")
        results = await run_cohort(manifest, self.root / "changed-run", None, None, SimpleNamespace(chunk_size=1))
        self.assertEqual(results[0]["status"], "failed")
        self.assertIn("differs", results[0]["error"])


if __name__ == "__main__":
    unittest.main()
