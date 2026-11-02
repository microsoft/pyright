# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

import asyncio
import json
import logging
import tempfile
import unittest
from datetime import timedelta
from pathlib import Path

from copilot.session_events import AssistantUsageData, ModelCallFailureData, ModelCallFailureSource, SessionErrorData

from issue_review_sdk_diagnostics import RuntimeDiagnostics, event_metadata, text_metadata


class EventMetadataTests(unittest.TestCase):
    def test_usage_keeps_numeric_cost_and_timing_without_account_or_content_payloads(self):
        data = event_metadata(AssistantUsageData(
            model="gpt-6.1-sol", input_tokens=12, output_tokens=7, cost=0.25,
            duration=timedelta(seconds=2), time_to_first_token=timedelta(milliseconds=500),
        ))
        self.assertEqual(data, {
            "model": "gpt-6.1-sol", "input_tokens": 12, "output_tokens": 7, "cost": 0.25,
            "duration_seconds": 2, "time_to_first_token_seconds": 0.5,
        })

    def test_errors_keep_status_retry_and_safe_correlation_but_not_freeform_text(self):
        request = "c1ab577f-7bc6-4b69-a2e4-e6db1825d9bb"
        data = event_metadata(ModelCallFailureData(
            source=next(iter(ModelCallFailureSource)), retry_attempt=2, status_code=429,
            provider_call_id=request, service_request_id="private-request-token",
            error_message="Bearer private-credential; reporter source and private prompt",
        ))
        self.assertEqual(data["retry_attempt"], 2)
        self.assertEqual(data["status_code"], 429)
        self.assertEqual(data["provider_call_id"], request)
        self.assertEqual(data["service_request_id_metadata"], text_metadata("private-request-token"))
        serialized = json.dumps(data)
        for secret in ("Bearer", "private-credential", "reporter source", "private prompt", "private-request-token"):
            self.assertNotIn(secret, serialized)
        error = event_metadata(SessionErrorData(
            error_type="provider", message="private error", error_code="ghp_private", stack="private stack",
            url="https://example.test/?token=private",
        ))
        self.assertEqual(error["error_type"], "provider")
        for secret in ("private error", "ghp_private", "private stack", "example.test"):
            self.assertNotIn(secret, json.dumps(error))


class RuntimeDiagnosticsTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.path = Path(temporary.name) / "runtime.jsonl"

    def records(self):
        return [json.loads(line) for line in self.path.read_text().splitlines()]

    async def test_cli_stderr_and_sdk_debug_are_filtered_and_concurrent_correlation_is_honest(self):
        session_a, session_b = "session-a", "session-b"
        logger = logging.getLogger("copilot._jsonrpc")
        previous_level, previous_propagate = logging.getLogger("copilot").level, logging.getLogger("copilot").propagate
        async with RuntimeDiagnostics(self.path) as diagnostics:
            diagnostics.register(session_a, "reproducer", self.path.parent / "a")
            diagnostics.register(session_b, "reviewer", self.path.parent / "b")
            await asyncio.to_thread(logger.warning, "[CLI] %s", "retry session-a Bearer credential private prompt")
            logger.warning("[CLI] %s", "connection failure private source")
            logging.getLogger("copilot.client").debug(
                "CopilotClient.start runtime connected", extra={"elapsed_ms": 12.5},
            )
            diagnostics.unregister(session_a)
            diagnostics.unregister(session_b)
        self.assertEqual(logging.getLogger("copilot").level, previous_level)
        self.assertEqual(logging.getLogger("copilot").propagate, previous_propagate)
        rows = [record for record in self.records() if record["type"] == "runtime.log"]
        self.assertEqual(rows[0]["source"], "cli")
        self.assertEqual(rows[0]["text_signals"], ["retry"])
        self.assertEqual(rows[0]["correlation"], "session_id_match")
        self.assertEqual([item["session_id"] for item in rows[0]["sessions"]], [session_a])
        self.assertEqual(rows[1]["correlation"], "active_sessions_only")
        self.assertEqual({item["session_id"] for item in rows[1]["sessions"]}, {session_a, session_b})
        self.assertEqual(rows[2]["sdk_operation"], "CopilotClient.start")
        self.assertEqual(rows[2]["elapsed_ms"], 12.5)
        text = self.path.read_text()
        for secret in ("Bearer", "credential", "private prompt", "private source", "runtime connected"):
            self.assertNotIn(secret, text)

    async def test_capture_is_bounded_and_reports_dropped_records(self):
        for limit in ("records", "bytes"):
            with self.subTest(limit=limit):
                path = self.path.with_name(limit + ".jsonl")
                async with RuntimeDiagnostics(path, max_records=1 if limit == "records" else 10, max_bytes=1 if limit == "bytes" else 8192):
                    for _ in range(5):
                        logging.getLogger("copilot.client").debug("private raw debug payload")
                rows = [json.loads(line) for line in path.read_text().splitlines()]
                self.assertEqual(sum(row["type"] == "runtime.diagnostics_limit" for row in rows), 1)
                self.assertEqual(rows[-1]["dropped_records"], 4 if limit == "records" else 5)
                self.assertNotIn("private raw debug payload", path.read_text())

    async def test_logging_configuration_is_restored_even_on_failure(self):
        logger = logging.getLogger("copilot")
        old_handlers, old_level, old_propagate = [*logger.handlers], logger.level, logger.propagate
        with self.assertRaisesRegex(RuntimeError, "offline failure"):
            async with RuntimeDiagnostics(self.path):
                self.assertFalse(logger.propagate)
                raise RuntimeError("offline failure")
        self.assertEqual(logger.handlers, old_handlers)
        self.assertEqual(logger.level, old_level)
        self.assertEqual(logger.propagate, old_propagate)
        self.assertEqual(self.records()[-1]["type"], "runtime.diagnostics_end")
