# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

"""Content-free SDK/runtime diagnostics shared by concurrent investigation sessions."""

from __future__ import annotations

import hashlib
import json
import logging
import math
import re
import threading
from collections import Counter
from dataclasses import dataclass, field, fields, is_dataclass
from datetime import datetime, timedelta, timezone
from enum import Enum
from pathlib import Path
from time import monotonic
from types import TracebackType

from pydantic import JsonValue

LABEL = re.compile(r"[A-Za-z0-9_.-]{1,96}")
CREDENTIAL = re.compile(r"(?i)(?:gh[pousr]_|github_pat_|bearer|password|secret|token[=_-])")
UUID = re.compile(r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}")
LABEL_FIELDS = {
    "model", "model_provider", "reasoning_effort", "finish_reason", "error_type", "error_code",
    "info_type", "warning_type", "tool_name", "source", "outcome", "result", "transport",
    "failure_kind", "bad_request_kind", "api_endpoint", "websocket_fallback_reason",
}
ID_FIELDS = {
    "api_call_id", "provider_call_id", "service_request_id", "turn_id", "parent_tool_call_id", "tool_call_id",
    "interaction_id",
}
NUMBER_FIELDS = {
    "input_tokens", "output_tokens", "reasoning_tokens", "cache_read_tokens", "cache_write_tokens",
    "accepted_prediction_tokens", "rejected_prediction_tokens", "cost", "duration", "dispatch_duration",
    "time_to_first_token", "output_ttft", "inter_token_latency", "retry_attempt", "status_code",
    "request_body_bytes", "max_output_tokens", "max_prompt_tokens", "websocket_fallback_after", "success",
}
SIGNALS = {
    "retry": r"\b(?:retry|retrying|backoff)\b",
    "timeout": r"\b(?:timeout|timed out)\b",
    "rate_limit": r"\b(?:rate.limit|throttl\w*)\b",
    "connection": r"\b(?:connection|disconnect\w*|socket|transport)\b",
    "error": r"\b(?:error|failed|failure)\b",
}
DIAGNOSTIC_EVENTS = {
    "session.info", "session.warning", "session.model_change", "session.model_deselected",
    "assistant.turn_retry", "model.call_start", "model.call_failure", "model.call_finished", "model.call_final_result",
}
DISPATCH_EVENTS = DIAGNOSTIC_EVENTS | {
    "user.message", "assistant.message", "assistant.message_delta", "assistant.reasoning", "assistant.reasoning_delta",
    "assistant.turn_start", "assistant.turn_end", "assistant.usage", "session.idle", "session.error",
    "session.start", "session.resume", "session.shutdown", "tool.execution_start", "tool.execution_complete",
    "permission.requested",
}
DISPATCH_SUMMARY_SECONDS = 30
DIAGNOSTICS_SCHEMA_VERSION = 2


def text_metadata(text: str) -> dict[str, JsonValue]:
    encoded = text.encode("utf-8")
    return {"bytes": len(encoded), "sha256": hashlib.sha256(encoded).hexdigest()}


def event_metadata(data: object) -> dict[str, JsonValue]:
    result: dict[str, JsonValue] = {}
    if not is_dataclass(data) or isinstance(data, type):
        return result
    for field in fields(data):
        name, value = field.name, getattr(data, field.name)
        if value is None:
            continue
        if name in NUMBER_FIELDS:
            if isinstance(value, timedelta):
                result[name + "_seconds"] = value.total_seconds()
            elif isinstance(value, (bool, int)) or isinstance(value, float) and math.isfinite(value):
                result[name] = value
        elif name in LABEL_FIELDS:
            label = value.value if isinstance(value, Enum) else value
            if isinstance(label, str):
                if LABEL.fullmatch(label) and not CREDENTIAL.search(label):
                    result[name] = label
                else:
                    result[name + "_metadata"] = text_metadata(label)
        elif name in ID_FIELDS and isinstance(value, str):
            if UUID.fullmatch(value):
                result[name] = value
            else:
                result[name + "_metadata"] = text_metadata(value)
        elif name in {"message", "error_message", "reason", "stack", "tip", "url"} and isinstance(value, str):
            result[name + "_metadata"] = text_metadata(value)
    return result


@dataclass
class DeltaActivity:
    events: int = 0
    utf8_bytes: int = 0
    empty_events: int = 0
    whitespace_events: int = 0
    adjacent_same_stream_repeats: int = 0
    adjacent_same_stream_repeated_bytes: int = 0
    max_identical_chunk_run: int = 0
    first_elapsed_seconds: float | None = None
    last_elapsed_seconds: float | None = None
    last_nonempty_elapsed_seconds: float | None = None
    _last_identity: tuple[str | None, str | None] | None = field(default=None, repr=False)
    _last_digest: bytes | None = field(default=None, repr=False)
    _current_run: int = field(default=0, repr=False)

    def observe(self, content: str, identity: tuple[str | None, str | None], elapsed: float) -> None:
        encoded = content.encode("utf-8")
        if self.events == 0:
            self.first_elapsed_seconds = elapsed
        self.events += 1
        self.utf8_bytes += len(encoded)
        self.last_elapsed_seconds = elapsed
        self.empty_events += not content
        self.whitespace_events += content.isspace()
        fingerprint = hashlib.sha256(encoded).digest() if encoded else None
        if encoded:
            self.last_nonempty_elapsed_seconds = elapsed
            if identity == self._last_identity and fingerprint == self._last_digest:
                self.adjacent_same_stream_repeats += 1
                self.adjacent_same_stream_repeated_bytes += len(encoded)
                self._current_run += 1
            else:
                self._current_run = 1
            self.max_identical_chunk_run = max(self.max_identical_chunk_run, self._current_run)
        else:
            self._current_run = 0
        self._last_identity, self._last_digest = identity, fingerprint

    def snapshot(self, elapsed: float) -> dict[str, JsonValue]:
        return {
            "events": self.events, "utf8_bytes": self.utf8_bytes, "empty_events": self.empty_events,
            "whitespace_events": self.whitespace_events,
            "adjacent_same_stream_repeats": self.adjacent_same_stream_repeats,
            "adjacent_same_stream_repeated_bytes": self.adjacent_same_stream_repeated_bytes,
            "max_identical_chunk_run": self.max_identical_chunk_run,
            "first_elapsed_seconds": self.first_elapsed_seconds, "last_elapsed_seconds": self.last_elapsed_seconds,
            "last_nonempty_elapsed_seconds": self.last_nonempty_elapsed_seconds,
            "seconds_since_last_nonempty": None if self.last_nonempty_elapsed_seconds is None else elapsed - self.last_nonempty_elapsed_seconds,
        }


@dataclass
class WhitespaceStallGuard:
    min_seconds: float = 60
    min_chunks: int = 1024
    min_bytes: int = 16 * 1024
    max_gap_seconds: float = 10
    first: float | None = None
    last: float | None = None
    chunks: int = 0
    utf8_bytes: int = 0
    _identity: str | None = field(default=None, repr=False)

    def reset(self) -> None:
        self.first = self.last = self._identity = None
        self.chunks = self.utf8_bytes = 0

    def observe(self, content: str, identity: str | None, elapsed: float, *, reasoning: bool = False) -> None:
        if content.strip():
            self.reset()
        elif content and not reasoning:
            if self._identity != identity or self.last is None or elapsed - self.last > self.max_gap_seconds:
                self.reset()
            if self.first is None:
                self.first = elapsed
            self.last, self._identity = elapsed, identity
            self.chunks += 1
            self.utf8_bytes += len(content.encode("utf-8"))

    def stalled(self) -> bool:
        return (
            self.first is not None and self.last is not None and self.last - self.first >= self.min_seconds
            and self.chunks >= self.min_chunks and self.utf8_bytes >= self.min_bytes
        )

    def snapshot(self) -> dict[str, JsonValue]:
        return {
            "first_elapsed_seconds": self.first, "last_elapsed_seconds": self.last,
            "chunks": self.chunks, "utf8_bytes": self.utf8_bytes,
            "min_seconds": self.min_seconds, "min_chunks": self.min_chunks, "min_bytes": self.min_bytes,
            "max_gap_seconds": self.max_gap_seconds,
        }


class RuntimeDiagnostics(logging.Handler):
    def __init__(self, path: Path, *, max_records: int = 20_000, max_bytes: int = 8 * 1024 * 1024):
        super().__init__(logging.DEBUG)
        if max_records < 1 or max_bytes < 1:
            raise ValueError("Runtime diagnostic capture limits must be positive")
        self.path = path
        self._max_records, self._max_bytes = max_records, max_bytes
        self._records, self._dropped = 0, 0
        self._reserved_records, self._reserved_bytes = max(1, max_records // 4), max(1, max_bytes // 4)
        self._lane_records = {"general": 0, "important": 0}
        self._lane_bytes = {"general": 0, "important": 0}
        self._lane_dropped = {"general": 0, "important": 0}
        self._coalesced, self._unreported_dispatch_events = 0, 0
        self._dispatch: dict[str, Counter[str]] = {}
        self._next_dispatch_summary = monotonic() + DISPATCH_SUMMARY_SECONDS
        self._sessions: dict[str, dict[str, str]] = {}
        self._state_lock = threading.RLock()
        self._logger = logging.getLogger("copilot")
        self._level, self._propagate = self._logger.level, self._logger.propagate

    def register(self, session_id: str, agent: str, directory: Path) -> None:
        with self._state_lock:
            self._sessions[session_id] = {"session_id": session_id, "agent": agent, "directory": str(directory)}

    def unregister(self, session_id: str) -> None:
        with self._state_lock:
            self._flush_dispatch(session_id)
            self._sessions.pop(session_id)

    def summary(self) -> dict[str, JsonValue]:
        with self._state_lock:
            return {
                "path": str(self.path), "scope": "shared_runtime",
                "records": self._records, "dropped_records": self._dropped,
                "dropped_by_priority": {**self._lane_dropped},
                "coalesced_dispatch_events": self._coalesced,
                "pending_dispatch_events": sum(sum(counts.values()) for counts in self._dispatch.values()),
                "unreported_dispatch_events": self._unreported_dispatch_events,
            }

    def _append(self, line: str) -> None:
        with self.path.open("a", encoding="utf-8", newline="\n") as stream:
            stream.write(line)

    def _write(self, record: dict[str, JsonValue]) -> None:
        self._append(json.dumps({"at": datetime.now(timezone.utc).isoformat(), **record}) + "\n")

    def _drop_record(self, lane: str) -> None:
        self._dropped += 1
        self._lane_dropped[lane] += 1
        if self._lane_dropped[lane] == 1:
            self._write({
                "type": "runtime.diagnostics_limit", "priority": lane,
                "max_records": self._max_records, "max_bytes": self._max_bytes,
            })

    def _capture(self, record: dict[str, JsonValue], *, important: bool = False) -> bool:
        lane = "important" if important else "general"
        record_limit = self._reserved_records if important else self._max_records - self._reserved_records
        byte_limit = self._reserved_bytes if important else self._max_bytes - self._reserved_bytes
        if self._lane_dropped[lane]:
            self._drop_record(lane)
            return False
        line = json.dumps({"at": datetime.now(timezone.utc).isoformat(), **record}) + "\n"
        size = len(line.encode("utf-8"))
        if self._lane_records[lane] >= record_limit or self._lane_bytes[lane] + size > byte_limit:
            self._drop_record(lane)
            return False
        self._append(line)
        self._records += 1
        self._lane_records[lane] += 1
        self._lane_bytes[lane] += size
        return True

    def _flush_dispatch(self, session_id: str | None = None) -> None:
        for identifier in list(self._dispatch) if session_id is None else [session_id]:
            counts = self._dispatch.pop(identifier, None)
            if not counts:
                continue
            session = self._sessions.get(identifier)
            if not self._capture({
                "type": "runtime.dispatch_summary",
                "correlation": "session_id_match" if session is not None else "unattributed",
                "sessions": [] if session is None else [{**session}],
                "event_counts": {key: count for key, count in counts.items()},
            }):
                self._unreported_dispatch_events += sum(counts.values())

    def emit(self, record: logging.LogRecord) -> None:
        with self._state_lock:
            identifier = record.__dict__.get("session_id")
            if record.name == "copilot.session" and record.msg == "CopilotSession._dispatch_event dispatch" and record.levelno == logging.DEBUG:
                kind = record.__dict__.get("event_type")
                kind = kind.value if isinstance(kind, Enum) else kind
                key = identifier if isinstance(identifier, str) and identifier in self._sessions else ""
                counts = self._dispatch.get(key)
                if counts is None:
                    counts = self._dispatch[key] = Counter()
                counts[kind if isinstance(kind, str) and kind in DISPATCH_EVENTS else "other"] += 1
                self._coalesced += 1
                if monotonic() >= self._next_dispatch_summary:
                    self._flush_dispatch()
                    self._next_dispatch_summary = monotonic() + DISPATCH_SUMMARY_SECONDS
                return
            operation = re.match(r"(Copilot(?:Client|Session)\.[A-Za-z0-9_]+)\b", str(record.msg))
            important = record.levelno >= logging.WARNING or operation is not None or bool(record.exc_info)
            lane = "important" if important else "general"
            if self._lane_dropped[lane]:
                self._drop_record(lane)
                return
            message = record.getMessage()
            if isinstance(identifier, str):
                session = self._sessions.get(identifier)
                candidates = [] if session is None else [session]
                correlation = "unregistered_session_id" if session is None else "session_id_match"
                correlation_source = "structured_field"
            else:
                matched = [session for identifier, session in self._sessions.items() if identifier in message]
                candidates = matched or list(self._sessions.values())
                correlation = "session_id_match" if matched else "active_sessions_only" if candidates else "runtime_only"
                correlation_source = "message_text" if matched else "active_sessions"
            elapsed_ms = record.__dict__.get("elapsed_ms")
            self._capture({
                "type": "runtime.log", "source": "cli" if record.msg == "[CLI] %s" else "sdk",
                "logger": record.name if LABEL.fullmatch(record.name) else "copilot",
                "level": record.levelname, "message_metadata": text_metadata(message),
                "sdk_operation": None if operation is None else operation[1],
                "elapsed_ms": elapsed_ms if isinstance(elapsed_ms, (int, float)) and math.isfinite(elapsed_ms) else None,
                "text_signals": [key for key, pattern in SIGNALS.items() if re.search(pattern, message, re.IGNORECASE)],
                "correlation": correlation, "correlation_source": correlation_source,
                "sessions": [{**session} for session in candidates],
                "exception_type": None if not record.exc_info or record.exc_info[0] is None else record.exc_info[0].__name__,
            }, important=important)

    async def __aenter__(self) -> RuntimeDiagnostics:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._write({
            "type": "runtime.diagnostics_start", "content_policy": "metadata_only", "runtime_log_level": "debug",
            "schema_version": DIAGNOSTICS_SCHEMA_VERSION,
            "dispatch_summary_interval_seconds": DISPATCH_SUMMARY_SECONDS,
            "reserved_important_records": self._reserved_records, "reserved_important_bytes": self._reserved_bytes,
        })
        self._level, self._propagate = self._logger.level, self._logger.propagate
        self._logger.setLevel(logging.DEBUG)
        self._logger.propagate = False
        self._logger.addHandler(self)
        return self

    async def __aexit__(
        self, exc_type: type[BaseException] | None, exc: BaseException | None, traceback: TracebackType | None,
    ) -> None:
        self._logger.removeHandler(self)
        self._logger.setLevel(self._level)
        self._logger.propagate = self._propagate
        try:
            with self._state_lock:
                self._flush_dispatch()
                self._write({"type": "runtime.diagnostics_end", **self.summary()})
        finally:
            self.close()
