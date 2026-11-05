# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

import asyncio
import json
import logging
import tempfile
import unittest
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

from copilot.session_events import (
    AssistantUsageData, ModelCallFailureData, ModelCallFailureSource, SessionErrorData, SessionEventType,
)

from issue_review_sdk_diagnostics import DeltaActivity, RuntimeDiagnostics, WhitespaceStallGuard, event_metadata, text_metadata


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


class DeltaActivityTests(unittest.TestCase):
    def test_exact_utf8_empty_whitespace_repeat_counts_and_arrival_times(self):
        activity = DeltaActivity()
        for elapsed, content in enumerate(("", " ", " ", "\u00e9", "\u00e9", "\u00e9", "")):
            activity.observe(content, (None, "message"), elapsed)
        self.assertEqual(activity.snapshot(9), {
            "events": 7, "utf8_bytes": 8, "empty_events": 2, "whitespace_events": 2,
            "adjacent_same_stream_repeats": 3, "adjacent_same_stream_repeated_bytes": 5,
            "max_identical_chunk_run": 3, "first_elapsed_seconds": 0, "last_elapsed_seconds": 6,
            "last_nonempty_elapsed_seconds": 5, "seconds_since_last_nonempty": 4,
        })

    def test_repetition_does_not_cross_streams_agents_or_empty_chunks(self):
        activity = DeltaActivity()
        observations = [
            (("agent-a", "message-a"), "private delta"),
            (("agent-a", "message-b"), "private delta"),
            (("agent-a", "message-a"), "private delta"),
            (("agent-a", "message-a"), "private delta"),
            (("agent-b", "message-a"), "private delta"),
            (("agent-b", "message-a"), ""),
            (("agent-b", "message-a"), "private delta"),
        ]
        for elapsed, (identity, content) in enumerate(observations):
            activity.observe(content, identity, elapsed)
        result = activity.snapshot(9)
        self.assertEqual(result["adjacent_same_stream_repeats"], 1)
        self.assertEqual(result["adjacent_same_stream_repeated_bytes"], len("private delta".encode()))
        self.assertEqual(result["max_identical_chunk_run"], 2)
        for secret in ("private delta", "agent-a", "message-a", text_metadata("private delta")["sha256"]):
            self.assertNotIn(secret, json.dumps(result))
        self.assertNotIn("private delta", repr(activity))
        fields_before = set(vars(activity))
        for elapsed in range(10_000):
            activity.observe("private delta", ("changing-agent", str(elapsed)), elapsed)
        self.assertEqual(set(vars(activity)), fields_before)
        self.assertEqual(activity._last_identity, ("changing-agent", "9999"))

    def test_empty_events_are_not_nonempty_output(self):
        activity = DeltaActivity()
        activity.observe("", (None, "message"), 1)
        activity.observe("", (None, "message"), 2)
        result = activity.snapshot(5)
        self.assertEqual(result["events"], 2)
        self.assertEqual(result["empty_events"], 2)
        self.assertEqual(result["utf8_bytes"], 0)
        self.assertEqual(result["max_identical_chunk_run"], 0)
        self.assertIsNone(result["last_nonempty_elapsed_seconds"])
        self.assertIsNone(result["seconds_since_last_nonempty"])


class WhitespaceStallGuardTests(unittest.TestCase):
    def test_exact_thresholds_require_sustained_arrivals_and_enough_chunks_and_bytes(self):
        guard = WhitespaceStallGuard()
        for index in range(1023):
            guard.observe(" " * 16, "reply", index * 60 / 1023)
        self.assertFalse(guard.stalled())
        guard.observe(" " * 15, "reply", 60)
        self.assertFalse(guard.stalled())
        guard.observe(" ", "reply", 60)
        self.assertTrue(guard.stalled())
        self.assertEqual(guard.chunks, 1025)
        self.assertEqual(guard.utf8_bytes, 16384)

    def test_burst_then_silence_empty_events_or_changed_stream_cannot_trigger(self):
        guard = WhitespaceStallGuard()
        for _ in range(1024):
            guard.observe(" " * 16, "reply", 0)
        self.assertFalse(guard.stalled())
        guard.observe("", "reply", 60)
        self.assertFalse(guard.stalled())
        guard.observe(" ", "reply", 60)
        self.assertEqual(guard.chunks, 1)
        guard.observe(" ", "different-reply", 61)
        self.assertEqual(guard.chunks, 1)
        guard.observe(" " * 20000, None, 62, reasoning=True)
        self.assertEqual(guard.chunks, 1)

    def test_meaningful_message_or_reasoning_resets_without_retaining_text(self):
        for reasoning in (False, True):
            guard = WhitespaceStallGuard(min_seconds=0, min_chunks=1, min_bytes=1)
            guard.observe(" ", "reply", 0)
            self.assertTrue(guard.stalled())
            guard.observe("private source/reasoning", "reply", 1, reasoning=reasoning)
            self.assertFalse(guard.stalled())
            self.assertEqual(guard.chunks, 0)
            self.assertNotIn("private", repr(guard))
            self.assertNotIn("reply", json.dumps(guard.snapshot()))


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
                async with RuntimeDiagnostics(path, max_records=2 if limit == "records" else 10, max_bytes=1 if limit == "bytes" else 8192):
                    for _ in range(5):
                        logging.getLogger("copilot.client").debug("private raw debug payload")
                rows = [json.loads(line) for line in path.read_text().splitlines()]
                self.assertEqual(sum(row["type"] == "runtime.diagnostics_limit" for row in rows), 1)
                self.assertEqual(rows[-1]["dropped_records"], 4 if limit == "records" else 5)
                self.assertEqual(rows[-1]["records"], 1 if limit == "records" else 0)
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

    async def test_dispatch_flood_is_coalesced_without_losing_late_warnings(self):
        logger = logging.getLogger("copilot.session")
        async with RuntimeDiagnostics(self.path, max_records=12, max_bytes=8192) as diagnostics:
            diagnostics.register("session-a", "reproducer", self.path.parent)
            for _ in range(10_000):
                logger.debug(
                    "CopilotSession._dispatch_event dispatch",
                    extra={"session_id": "session-a", "event_type": "assistant.message_delta"},
                )
            logger.warning("private late provider warning", extra={"session_id": "session-a"})
            diagnostics.unregister("session-a")
        rows = self.records()
        self.assertEqual(rows[0]["schema_version"], 3)
        warning = next(row for row in rows if row.get("level") == "WARNING")
        self.assertEqual(warning["correlation"], "session_id_match")
        summaries = [row for row in rows if row["type"] == "runtime.dispatch_summary"]
        self.assertEqual(sum(row["event_counts"]["assistant.message_delta"] for row in summaries), 10_000)
        self.assertEqual(rows[-1]["coalesced_dispatch_events"], 10_000)
        self.assertEqual(rows[-1]["dropped_records"], 0)
        self.assertLess(self.path.stat().st_size, 8192)
        self.assertNotIn("private late provider warning", self.path.read_text())

    async def test_structured_session_id_takes_precedence_over_message_mentions(self):
        logger = logging.getLogger("copilot.session")
        async with RuntimeDiagnostics(self.path) as diagnostics:
            diagnostics.register("session-a", "reproducer", self.path.parent / "a")
            diagnostics.register("session-b", "reviewer", self.path.parent / "b")
            logger.debug(
                "CopilotSession.send_and_wait session-b",
                extra={"session_id": "session-a", "elapsed_ms": 3},
            )
            logger.warning("private failure", extra={"session_id": "private-unregistered-id"})
            diagnostics.unregister("session-a")
            diagnostics.unregister("session-b")
        rows = [row for row in self.records() if row["type"] == "runtime.log"]
        self.assertEqual([item["session_id"] for item in rows[0]["sessions"]], ["session-a"])
        self.assertEqual(rows[0]["correlation_source"], "structured_field")
        self.assertEqual(rows[0]["sdk_operation"], "CopilotSession.send_and_wait")
        self.assertEqual(rows[1]["correlation"], "unregistered_session_id")
        self.assertEqual(rows[1]["sessions"], [])
        self.assertNotIn("private-unregistered-id", self.path.read_text())

    async def test_debug_noise_cannot_consume_reserved_warning_and_error_records(self):
        logger = logging.getLogger("copilot.session")
        async with RuntimeDiagnostics(self.path, max_records=12, max_bytes=16384):
            for _ in range(500):
                logger.debug("private debug noise")
            logger.debug("CopilotSession.send_and_wait start")
            logger.warning("private warning")
            logger.error("private error")
            logger.warning("private third warning")
            logger.warning("private over-limit warning")
        rows = self.records()
        captured = [row for row in rows if row["type"] == "runtime.log"]
        self.assertEqual(len(captured), 12)
        self.assertEqual([row["level"] for row in captured[-3:]], ["WARNING", "ERROR", "WARNING"])
        self.assertEqual(rows[-1]["dropped_by_priority"], {"general": 492, "important": 1})
        self.assertEqual(sum(row["type"] == "runtime.diagnostics_limit" for row in rows), 2)

    async def test_sdk_operation_flood_cannot_consume_reserved_alert_capacity(self):
        logger = logging.getLogger("copilot.session")
        for limit in ("records", "bytes"):
            with self.subTest(limit=limit):
                path = self.path.with_name("operations-" + limit + ".jsonl")
                async with RuntimeDiagnostics(
                    path, max_records=12 if limit == "records" else 2000,
                    max_bytes=16384 if limit == "records" else 8192,
                ) as diagnostics:
                    diagnostics.register("session-a", "reviewer", path.parent)
                    for _ in range(500):
                        logger.debug("CopilotSession.send_and_wait private routine RPC", extra={"session_id": "session-a"})
                    logger.warning("CopilotSession.send_and_wait private warning", extra={"session_id": "session-a"})
                    logger.error("CopilotSession.abort private error", extra={"session_id": "session-a"})
                    diagnostics.unregister("session-a")
                rows = [json.loads(line) for line in path.read_text().splitlines()]
                alerts = [row for row in rows if row.get("level") in {"WARNING", "ERROR"}]
                self.assertEqual([row["level"] for row in alerts], ["WARNING", "ERROR"])
                self.assertEqual(alerts[0]["sdk_operation"], "CopilotSession.send_and_wait")
                self.assertTrue(all(row["correlation"] == "session_id_match" for row in alerts))
                self.assertGreater(rows[-1]["dropped_by_priority"]["general"], 0)
                self.assertEqual(rows[-1]["dropped_by_priority"]["important"], 0)
                self.assertEqual(rows[0]["important_retention"], "warnings_errors_exceptions_only")
                self.assertNotIn("private", path.read_text())

    async def test_low_severity_exception_keeps_reserved_capacity_after_operation_flood(self):
        logger = logging.getLogger("copilot.session")
        async with RuntimeDiagnostics(self.path, max_records=12, max_bytes=16384):
            for _ in range(500):
                logger.debug("CopilotSession.send_and_wait private routine RPC")
            try:
                raise ValueError("private exception payload")
            except ValueError:
                logger.debug("CopilotSession.send_and_wait private exception", exc_info=True)
        rows = self.records()
        exception = next(row for row in rows if row.get("exception_type") == "ValueError")
        self.assertEqual(exception["level"], "DEBUG")
        self.assertEqual(exception["sdk_operation"], "CopilotSession.send_and_wait")
        self.assertEqual(rows[-1]["dropped_by_priority"]["important"], 0)
        self.assertNotIn("private", self.path.read_text())

    async def test_byte_limits_reserve_warning_capacity_with_bounded_control_record_overhead(self):
        logger = logging.getLogger("copilot.session")
        async with RuntimeDiagnostics(self.path, max_records=2000, max_bytes=8192):
            for _ in range(1000):
                logger.debug("private debug noise")
            logger.warning("private late warning")
        captured = [(json.loads(line), len(line)) for line in self.path.read_bytes().splitlines(keepends=True)]
        general_bytes = sum(size for row, size in captured if row["type"] == "runtime.log" and row["level"] == "DEBUG")
        important_bytes = sum(size for row, size in captured if row["type"] == "runtime.log" and row["level"] == "WARNING")
        self.assertGreater(general_bytes, 0)
        self.assertGreater(important_bytes, 0)
        self.assertLessEqual(general_bytes, 6144)
        self.assertLessEqual(important_bytes, 2048)
        footer = captured[-1][0]
        self.assertGreater(footer["dropped_by_priority"]["general"], 0)
        self.assertEqual(footer["dropped_by_priority"]["important"], 0)
        control_bytes = sum(size for row, size in captured if row["type"] != "runtime.log")
        self.assertLess(control_bytes, 4096)

    async def test_dispatch_summaries_have_bounded_labels_and_flush_periodically_and_on_exit(self):
        logger = logging.getLogger("copilot.session")
        with patch("issue_review_sdk_diagnostics.monotonic", return_value=0) as clock:
            async with RuntimeDiagnostics(self.path) as diagnostics:
                diagnostics.register("session-a", "reproducer", self.path.parent / "a")
                diagnostics.register("session-b", "reviewer", self.path.parent / "b")
                for identifier in ("session-a", "session-b"):
                    await asyncio.to_thread(
                        logger.debug, "CopilotSession._dispatch_event dispatch",
                        extra={"session_id": identifier, "event_type": SessionEventType("assistant.message_delta")},
                    )
                for index in range(500):
                    logger.debug(
                        "CopilotSession._dispatch_event dispatch",
                        extra={"session_id": f"private-session-{index}", "event_type": f"private-event-{index}"},
                    )
                self.assertEqual(len(diagnostics._dispatch), 3)
                self.assertEqual(diagnostics.summary()["pending_dispatch_events"], 502)
                before = self.path.read_bytes()
                diagnostics.summary()
                self.assertEqual(self.path.read_bytes(), before)
                clock.return_value = 31
                logger.debug(
                    "CopilotSession._dispatch_event dispatch",
                    extra={"session_id": "session-a", "event_type": SessionEventType("assistant.message_delta")},
                )
                self.assertEqual(diagnostics.summary()["pending_dispatch_events"], 0)
                logger.debug(
                    "CopilotSession._dispatch_event dispatch",
                    extra={"session_id": "session-b", "event_type": "assistant.message_delta"},
                )
                diagnostics.unregister("session-a")
        rows = self.records()
        summaries = [row for row in rows if row["type"] == "runtime.dispatch_summary"]
        self.assertEqual(len(summaries), 4)
        self.assertEqual(sum(sum(row["event_counts"].values()) for row in summaries), 504)
        unknown = next(row for row in summaries if row["correlation"] == "unattributed")
        self.assertEqual(unknown["sessions"], [])
        self.assertEqual(unknown["event_counts"], {"other": 500})
        self.assertEqual(rows[-1]["coalesced_dispatch_events"], 504)
        self.assertEqual(rows[-1]["pending_dispatch_events"], 0)
        for secret in ("private-session-", "private-event-"):
            self.assertNotIn(secret, self.path.read_text())

    async def test_dropped_dispatch_summaries_account_for_every_coalesced_event(self):
        logger = logging.getLogger("copilot.session")
        async with RuntimeDiagnostics(self.path, max_records=1):
            for _ in range(100):
                logger.debug(
                    "CopilotSession._dispatch_event dispatch",
                    extra={"session_id": "unregistered", "event_type": "assistant.message_delta"},
                )
            logger.warning("private warning")
        footer = self.records()[-1]
        self.assertEqual(footer["records"], 1)
        self.assertEqual(footer["coalesced_dispatch_events"], 100)
        self.assertEqual(footer["unreported_dispatch_events"], 100)
        self.assertEqual(footer["dropped_by_priority"], {"general": 1, "important": 0})

    def test_capture_limits_must_be_positive(self):
        for limits in ({"max_records": 0}, {"max_bytes": -1}):
            with self.subTest(limits=limits), self.assertRaisesRegex(ValueError, "must be positive"):
                RuntimeDiagnostics(self.path, **limits)
