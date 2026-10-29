# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from copilot import ToolInvocation
from copilot.generated.rpc import PermissionDecisionApproveOnce, PermissionDecisionReject
from copilot.generated.session_events import PermissionRequestCustomTool, PermissionRequestWrite
from pydantic import JsonValue

from issue_review_models import Check, DiagnosticObservations, Entry, ReproductionStage
from issue_review_prepared import PreparedCheck, PreparedChecks, selected_targets, validate_receipt
from issue_review_reproduction import TargetStore, fingerprint, release_target, tree_hash, ReleaseCatalog
from issue_review_safety import ScreeningBlocked
from review_issues import AutomationError, InvestigationTools, ROOT, context_hash, execution_appendix, validate_review_execution
from test_issue_review_reproduction import catalog
from test_review_issues import FakeGitHub, audit, issue, product_record


class PreparedCheckerTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.scratch = self.root / "scratch"
        self.scratch.mkdir()
        self.configuration = {"include": ["sample.py"], "pythonVersion": "3.13", "typeCheckingMode": "standard"}
        self.write_inputs()
        self.runner = AsyncMock(side_effect=self.output)
        self.store = TargetStore(self.root / "cache", self.runner)
        self.target = release_target(
            ReleaseCatalog.model_validate(catalog()), "historical", "1.1.1", "Explicit reported release", False,
        )
        runtime = self.store._metadata_path(self.target).parent / "runtime"
        self.runtime = runtime
        runtime.mkdir(parents=True)
        (runtime / "index.js").write_text("// trusted fixture", encoding="utf-8")
        (runtime / "dist").mkdir()
        (runtime / "dist" / "pyright.js").write_text("// bundled fixture", encoding="utf-8")
        self.target.directory, self.target.cli = str(runtime), str(runtime / "index.js")
        self.target.tree_hash, self.target.status = tree_hash(runtime), "ready"
        self.target.artifact_sha512 = self.target.integrity
        self.store._metadata_path(self.target).write_text(self.target.model_dump_json(), encoding="utf-8")
        self.github = FakeGitHub()
        self.screen = AsyncMock()
        self.github.screen = self.screen
        self.tools = InvestigationTools(
            self.github, self.scratch, ROOT / "packages" / "pyright" / "index.js", {},
            evidence=self.root / "evidence", prepared_store=self.store, prepared_targets=[self.target],
        )
        assert self.tools.prepared_checks is not None
        self.prepared = self.tools.prepared_checks
        self.target_id = next(iter(self.prepared.targets))

    def write_inputs(self):
        (self.scratch / "sample.py").write_text("value: int = 1\n", encoding="utf-8")
        (self.scratch / "pyrightconfig.json").write_text(json.dumps(self.configuration), encoding="utf-8")

    async def output(self, command, cwd):
        return 0, json.dumps({
            "version": self.target.version, "generalDiagnostics": [],
            "summary": {"filesAnalyzed": 1},
        }), ""

    def invocation(self, **changes):
        return ToolInvocation(
            session_id="test", tool_call_id="call", tool_name="run_prepared_check", arguments={
                "target_id": self.target_id, "phase": "original",
                "configuration_reason": "Reporter checking mode is missing; standard and Python 3.13 are experimental.",
                **changes,
            },
        )

    async def run_ok(self, **changes):
        result = await self.tools.run_prepared_check(self.invocation(**changes))
        self.assertEqual(result.result_type, "success", result.text_result_for_llm)
        return next(reversed(self.prepared.receipts.values()))

    async def test_real_store_execution_has_exact_receipt_and_never_acquires(self):
        with (
            patch.object(self.store, "prepare", AsyncMock()) as prepare,
            patch.object(self.store, "catalog", AsyncMock()) as catalog_read,
            patch("issue_review_reproduction.download") as download,
        ):
            receipt = await self.run_ok()
        prepare.assert_not_awaited()
        catalog_read.assert_not_awaited()
        download.assert_not_called()
        assert self.runner.await_args is not None
        command, cwd = self.runner.await_args.args
        self.assertEqual(command[0:2], ["node", self.target.cli])
        self.assertNotEqual(cwd, self.scratch)
        self.assertFalse(cwd.is_relative_to(self.scratch))
        self.assertIn("--pythonpath", command)
        self.assertEqual(receipt["configuration"], self.configuration)
        self.assertEqual(receipt["target"], self.target.model_dump(mode="json"))
        self.assertEqual(receipt["target_selection"], "reported_release")
        self.assertTrue(receipt["experimental"])
        self.assertFalse(receipt["faithful_reproduction"])
        self.assertTrue(receipt["action_ineligible"])
        validate_receipt(receipt)
        saved = json.loads((self.prepared.directory / f"{receipt['id']}.json").read_text())
        self.assertEqual(saved, receipt)
        self.assertEqual(self.screen.await_count, 2)

    def test_context_hash_tracks_new_runtime_code_without_a_git_change(self):
        for name in ("issue_review_prepared.py", "issue_review_lsp.py", "langserver.index.js"):
            contents = {name: b"original"}
            with (
                self.subTest(runtime=name),
                patch("review_issues.git", return_value="unchanged"),
                patch.object(Path, "read_bytes", autospec=True, side_effect=lambda path: contents.get(path.name, b"same")),
            ):
                original = context_hash([], None)
                contents[name] = b"changed"
                self.assertNotEqual(context_hash([], None), original)

    async def test_selected_targets_preserve_as_of_and_exact_artifact_identity(self):
        approximate = self.target.model_copy(update={"approximate": True})
        prepared = PreparedChecks(
            self.store, [approximate, approximate], self.root / "other-evidence", self.tools.screen_evidence,
        )
        advertised = prepared.catalog()
        self.assertEqual(len(advertised), 1)
        self.assertEqual(advertised[0]["target_selection"], "selected_as_of_issue_creation")
        self.assertNotEqual(advertised[0]["target_id"], self.target_id)
        entry = Entry(
            issue=issue(), input_hash="input", context_hash="context",
            reproduction_stage=ReproductionStage(
                input_hash="input", discussion_hash="discussion", directory="stage", targets=[self.target],
            ),
            diagnostic_observations=DiagnosticObservations(
                input_hash="input", discussion_hash="discussion", directory="observations",
                receipts=[{"target": approximate.model_dump(mode="json")}],
            ),
        )
        self.assertEqual(selected_targets(entry), [self.target, approximate])

    async def test_unknown_target_and_arbitrary_arguments_cannot_execute(self):
        for changes in ({"target_id": "a" * 64}, {"command": "evil"}, {"version": "1.1.414"}):
            with self.subTest(changes=changes):
                result = await self.tools.run_prepared_check(self.invocation(**changes))
                self.assertEqual(result.result_type, "failure")
        self.runner.assert_not_awaited()

    async def test_missing_cache_is_explicit_and_never_prepared(self):
        self.store._metadata_path(self.target).unlink()
        with patch.object(self.store, "prepare", AsyncMock()) as prepare:
            result = await self.tools.run_prepared_check(self.invocation())
        self.assertEqual(result.result_type, "failure")
        self.assertIn("not cached", result.text_result_for_llm)
        prepare.assert_not_awaited()
        self.runner.assert_not_awaited()

    async def test_changed_runtime_or_saved_provenance_cannot_execute(self):
        runtime = self.runtime
        (runtime / "index.js").write_text("// changed", encoding="utf-8")
        result = await self.tools.run_prepared_check(self.invocation())
        self.assertEqual(result.result_type, "failure")
        self.assertIn("integrity", result.text_result_for_llm)
        self.runner.assert_not_awaited()
        (runtime / "index.js").write_text("// trusted fixture", encoding="utf-8")
        saved = self.target.model_copy(update={"source": "https://example.com/evil"})
        self.store._metadata_path(self.target).write_text(saved.model_dump_json(), encoding="utf-8")
        result = await self.tools.run_prepared_check(self.invocation())
        self.assertEqual(result.result_type, "failure")
        self.assertIn("provenance", result.text_result_for_llm)
        self.runner.assert_not_awaited()

    async def test_missing_settings_are_not_filled_and_external_scope_is_rejected(self):
        invalid = [
            {"include": ["sample.py"]},
            {**self.configuration, "include": ["../outside.py"]},
            {**self.configuration, "include": [str(self.scratch / "sample.py")]},
            {**self.configuration, "extends": "../pyrightconfig.json"},
            {**self.configuration, "executionEnvironments": [{"extraPaths": [".."]}]},
        ]
        for config in invalid:
            with self.subTest(config=config):
                (self.scratch / "pyrightconfig.json").write_text(json.dumps(config), encoding="utf-8")
                result = await self.tools.run_prepared_check(self.invocation())
                self.assertEqual(result.result_type, "failure")
                self.assertFalse(self.prepared.receipts)
        self.runner.assert_not_awaited()

    async def test_stubs_are_snapshotted_and_oversized_sources_are_rejected(self):
        (self.scratch / "dependency.pyi").write_text("value: int\n", encoding="utf-8")
        receipt = await self.run_ok()
        inputs = receipt["inputs"]
        assert isinstance(inputs, dict)
        self.assertEqual(inputs["dependency.pyi"], "value: int\n")
        (self.scratch / "dependency.pyi").write_text("x" * 65537, encoding="utf-8")
        result = await self.tools.run_prepared_check(self.invocation())
        self.assertEqual(result.result_type, "failure")
        self.assertIn("64 KiB", result.text_result_for_llm)
        self.assertEqual(self.runner.await_count, 1)

    async def test_source_check_receipt_also_preserves_analyzed_stubs(self):
        (self.scratch / "dependency.pyi").write_text("value: int\n", encoding="utf-8")
        with patch("review_issues.process", AsyncMock(return_value=await self.output([], self.scratch))):
            result = await self.tools.run_check(ToolInvocation(
                session_id="test", tool_call_id="source", tool_name="run_check", arguments={"kind": "pyright"},
            ))
        self.assertEqual(result.result_type, "success")
        inputs = {item["file"]: item["content"] for item in json.loads(result.text_result_for_llm)["inputs"]}
        self.assertEqual(inputs["dependency.pyi"], "value: int\n")
        self.assertEqual(inputs["sample.py"], "value: int = 1\n")

    async def test_stub_only_specimen_preserves_inputs_without_a_python_companion(self):
        (self.scratch / "sample.py").unlink()
        stub = "value: int\n"
        (self.scratch / "sample.pyi").write_text(stub, encoding="utf-8")
        self.configuration["include"] = ["sample.pyi"]
        configuration = json.dumps(self.configuration)
        (self.scratch / "pyrightconfig.json").write_text(configuration, encoding="utf-8")
        receipt = await self.run_ok()
        self.assertEqual(receipt["inputs"], {"sample.pyi": stub, "pyrightconfig.json": configuration})
        self.assertEqual(receipt["configuration"], self.configuration)
        validate_receipt(receipt)
        assert self.runner.await_args is not None
        _, cwd = self.runner.await_args.args
        self.assertEqual((cwd / "sample.pyi").read_text(encoding="utf-8"), stub)
        self.assertFalse(list(cwd.rglob("*.py")))

    async def test_relative_root_scope_is_supported(self):
        self.configuration["include"] = ["."]
        self.write_inputs()
        receipt = await self.run_ok()
        self.assertEqual(receipt["configuration"], self.configuration)

    async def test_original_and_controls_are_separate_and_configuration_bound(self):
        result = await self.tools.run_prepared_check(self.invocation(phase="control"))
        self.assertEqual(result.result_type, "failure")
        original = await self.run_ok()
        (self.scratch / "sample.py").write_text("value: int = 1\nreveal_type(value)\n", encoding="utf-8")
        control = await self.run_ok(phase="control", original_receipt_id=original["id"])
        self.assertNotEqual(original["cwd"], control["cwd"])
        self.assertNotEqual(original["input_hash"], control["input_hash"])
        self.assertEqual(control["original_receipt_id"], original["id"])
        inputs = original["inputs"]
        assert isinstance(inputs, dict)
        self.assertEqual(inputs["sample.py"], "value: int = 1\n")
        self.configuration["typeCheckingMode"] = "strict"
        self.write_inputs()
        result = await self.tools.run_prepared_check(self.invocation(phase="control", original_receipt_id=original["id"]))
        self.assertEqual(result.result_type, "failure")
        self.assertIn("same target, file set and configuration", result.text_result_for_llm)
        self.assertEqual(self.runner.await_count, 2)

    async def test_invalid_outputs_and_setup_warnings_are_blocked_with_raw_receipts(self):
        valid = await self.output([], self.scratch)
        invalid = [
            (0, "not json", ""),
            (0, '{"version":"1.1.999","generalDiagnostics":[],"summary":{"filesAnalyzed":1}}', ""),
            (0, '{"version":"1.1.1","generalDiagnostics":[],"summary":{"filesAnalyzed":0}}', ""),
            (2, valid[1], ""),
            (0, valid[1], "Ignored configuration setting"),
        ]
        self.runner.side_effect = None
        for output in invalid:
            self.runner.return_value = output
            result = await self.tools.run_prepared_check(self.invocation())
            self.assertEqual(result.result_type, "failure")
        self.assertEqual(len(list(self.prepared.directory.glob("*.json"))), len(invalid))
        self.assertFalse(self.prepared.receipts)

    async def test_target_and_input_changes_during_execution_remain_blocked(self):
        async def change_inputs(command, cwd):
            (cwd / "sample.py").write_text("modified\n", encoding="utf-8")
            return await self.output(command, cwd)

        self.runner.side_effect = change_inputs
        result = await self.tools.run_prepared_check(self.invocation())
        self.assertEqual(result.result_type, "failure")
        self.assertIn("inputs changed", result.text_result_for_llm)
        self.assertFalse(self.prepared.receipts)

        async def change_target(command, cwd):
            (self.runtime / "index.js").write_text("// modified", encoding="utf-8")
            return await self.output(command, cwd)

        self.runner.side_effect = change_target
        result = await self.tools.run_prepared_check(self.invocation())
        self.assertEqual(result.result_type, "failure")
        self.assertIn("integrity", result.text_result_for_llm)
        self.assertFalse(self.prepared.receipts)

    async def test_screening_is_fail_closed_before_execution_and_before_delivery(self):
        self.screen.side_effect = ScreeningBlocked("Blocked inputs")
        result = await self.tools.run_prepared_check(self.invocation())
        self.assertEqual(result.result_type, "failure")
        self.assertIsNotNone(self.tools.screening_error)
        self.runner.assert_not_awaited()
        self.tools.screening_error = None
        self.screen.side_effect = [None, ScreeningBlocked("Blocked output")]
        result = await self.tools.run_prepared_check(self.invocation())
        self.assertEqual(result.result_type, "failure")
        self.runner.assert_awaited_once()
        self.assertFalse(self.prepared.receipts)
        self.assertEqual(len(list(self.prepared.directory.glob("*.json"))), 1)

    async def test_deadline_cancels_execution_and_stopped_role_cannot_run(self):
        entered, cancelled = asyncio.Event(), asyncio.Event()

        async def wait(command, cwd):
            entered.set()
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()

        self.runner.side_effect = wait
        with self.assertRaises(TimeoutError):
            async with asyncio.timeout(1):
                await self.tools.run_prepared_check(self.invocation())
        self.assertTrue(entered.is_set())
        self.assertTrue(cancelled.is_set())
        self.assertFalse(self.prepared.receipts)
        await self.tools.stop_screening()
        with self.assertRaises(asyncio.CancelledError):
            await self.tools.run_prepared_check(self.invocation())

    async def test_attempt_budget_is_not_reset_after_failure(self):
        for _ in range(12):
            result = await self.tools.run_prepared_check(self.invocation(target_id="a" * 64))
            self.assertEqual(result.result_type, "failure")
        result = await self.tools.run_prepared_check(self.invocation())
        self.assertIn("budget exhausted", result.text_result_for_llm)
        self.runner.assert_not_awaited()

    async def test_large_evidence_is_paged_and_arbitrary_files_cannot_be_read(self):
        (self.scratch / "sample.py").write_text("# " + "x" * 20000, encoding="utf-8")
        result = await self.tools.run_prepared_check(self.invocation())
        self.assertEqual(result.result_type, "success", result.text_result_for_llm)
        index = json.loads(result.text_result_for_llm)
        self.assertEqual(index["view"], "evidence_index")
        self.assertLessEqual(len(result.text_result_for_llm), 12000)
        self.assertIn("read_prepared_evidence", index["note"])
        invocation = ToolInvocation(
            session_id="test", tool_call_id="read", tool_name="read_prepared_evidence",
            arguments={"evidence_id": index["id"], "pointer": "/command"},
        )
        page = await self.tools.read_prepared_evidence(invocation)
        self.assertEqual(page.result_type, "success")
        value = json.loads(page.text_result_for_llm)
        self.assertTrue(value["value_complete"])
        self.assertEqual(json.loads(value["content"]), self.prepared.receipts[index["id"]]["command"])
        invocation.arguments = {"evidence_id": str(self.scratch / "sample.py"), "pointer": ""}
        self.assertEqual((await self.tools.read_prepared_evidence(invocation)).result_type, "failure")

    async def test_audit_cannot_promote_experiment_or_tampered_receipt(self):
        receipt = await self.run_ok()
        report = audit()
        command, cwd, exit_code = receipt["command"], receipt["cwd"], receipt["exit_code"]
        assert isinstance(command, str) and isinstance(cwd, str) and isinstance(exit_code, int)
        check = Check(
            id="prepared", status="executed", command=command, cwd=cwd,
            exit_code=exit_code, observations="Experimental; no faithful historical reproduction",
        )
        report.checks.append(check)
        records: list[JsonValue] = [product_record(report), receipt]
        validate_review_execution(report, records)
        report.claims[0].reproduction[2].check_ids = ["prepared"]
        with self.assertRaisesRegex(AutomationError, "source-CLI"):
            validate_review_execution(report, records)
        report.claims[0].reproduction[2].check_ids = ["check"]
        report.claims[0].reproduction[0].status = "reproduced"
        report.claims[0].reproduction[0].check_ids = ["prepared"]
        with self.assertRaisesRegex(AutomationError, "faithful"):
            validate_review_execution(report, records)
        report.claims[0].reproduction[0].status = "not_attempted"
        for key, value in (("faithful_reproduction", True), ("command", "node invented"), ("stdout", "{}")):
            with self.subTest(key=key):
                with self.assertRaises(AutomationError):
                    validate_review_execution(report, [product_record(report), {**receipt, key: value}])
        appendix = execution_appendix(report, [receipt])
        self.assertIn(self.target.identity, appendix)
        self.assertIn("action_ineligible", appendix)
        self.assertIn("Reporter checking mode is missing", appendix)

    async def test_receipt_rehash_does_not_hide_configuration_command_or_tree_changes(self):
        original = await self.run_ok()
        for changes in (
            {"configuration": {}}, {"command": "node arbitrary"},
            {"input_hash": "0" * 64}, {"target_selection": "selected_as_of_issue_creation"},
        ):
            record = {**original, **changes}
            record["receipt_hash"] = fingerprint({key: value for key, value in record.items() if key != "receipt_hash"})
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                validate_receipt(record)

    async def test_prepared_tools_and_receipts_remain_role_and_write_scoped(self):
        request = PermissionRequestCustomTool(
            tool_name="run_prepared_check", tool_description="Prepared checker", args={},
        )
        self.assertIsInstance(self.tools.permission(request, {"session_id": "test"}), PermissionDecisionApproveOnce)
        ordinary = InvestigationTools(self.github, self.scratch, Path("index.js"), {})
        self.assertIsInstance(ordinary.permission(request, {"session_id": "test"}), PermissionDecisionReject)
        duplicate = InvestigationTools(
            self.github, self.scratch, Path("index.js"), {}, investigator="duplicates",
            prepared_store=self.store, prepared_targets=[self.target],
        )
        self.assertNotIn("run_prepared_check", [tool.name for tool in duplicate.tools])
        receipt = await self.run_ok()
        write = PermissionRequestWrite(
            can_offer_session_approval=False, diff="", intention="change receipt",
            file_name=str(self.prepared.directory / f"{receipt['id']}.json"),
        )
        self.assertIsInstance(self.tools.permission(write, {"session_id": "test"}), PermissionDecisionReject)


if __name__ == "__main__":
    unittest.main()
