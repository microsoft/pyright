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
from dataclasses import fields, is_dataclass
from datetime import datetime, timedelta, timezone
from enum import Enum
from pathlib import Path
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


class RuntimeDiagnostics(logging.Handler):
    def __init__(self, path: Path, *, max_records: int = 20_000, max_bytes: int = 8 * 1024 * 1024):
        super().__init__(logging.DEBUG)
        self.path = path
        self._max_records, self._max_bytes = max_records, max_bytes
        self._records, self._bytes, self._dropped = 0, 0, 0
        self._sessions: dict[str, dict[str, str]] = {}
        self._state_lock = threading.RLock()
        self._logger = logging.getLogger("copilot")
        self._level, self._propagate = self._logger.level, self._logger.propagate

    def register(self, session_id: str, agent: str, directory: Path) -> None:
        with self._state_lock:
            self._sessions[session_id] = {"session_id": session_id, "agent": agent, "directory": str(directory)}

    def unregister(self, session_id: str) -> None:
        with self._state_lock:
            self._sessions.pop(session_id)

    def summary(self) -> dict[str, JsonValue]:
        with self._state_lock:
            return {
                "path": str(self.path), "scope": "shared_runtime",
                "records": self._records, "dropped_records": self._dropped,
            }

    def _write(self, record: dict[str, JsonValue]) -> None:
        line = json.dumps({"at": datetime.now(timezone.utc).isoformat(), **record}) + "\n"
        with self.path.open("a", encoding="utf-8") as stream:
            stream.write(line)
        self._bytes += len(line.encode("utf-8"))

    def emit(self, record: logging.LogRecord) -> None:
        with self._state_lock:
            if self._records >= self._max_records or self._bytes >= self._max_bytes:
                self._dropped += 1
                if self._dropped == 1:
                    self._write({"type": "runtime.diagnostics_limit", "max_records": self._max_records, "max_bytes": self._max_bytes})
                return
            message = record.getMessage()
            operation = re.match(r"(CopilotClient\.[A-Za-z0-9_]+)\b", str(record.msg))
            matched = [session for identifier, session in self._sessions.items() if identifier in message]
            candidates = matched or list(self._sessions.values())
            self._write({
                "type": "runtime.log", "source": "cli" if record.msg == "[CLI] %s" else "sdk",
                "logger": record.name if LABEL.fullmatch(record.name) else "copilot",
                "level": record.levelname, "message_metadata": text_metadata(message),
                "sdk_operation": None if operation is None else operation[1],
                "elapsed_ms": record.__dict__.get("elapsed_ms")
                if isinstance(record.__dict__.get("elapsed_ms"), (int, float)) else None,
                "text_signals": [key for key, pattern in SIGNALS.items() if re.search(pattern, message, re.IGNORECASE)],
                "correlation": "session_id_match" if matched else "active_sessions_only" if candidates else "runtime_only",
                "sessions": [{**session} for session in candidates],
                "exception_type": None if not record.exc_info or record.exc_info[0] is None else record.exc_info[0].__name__,
            })
            self._records += 1

    async def __aenter__(self) -> RuntimeDiagnostics:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._write({"type": "runtime.diagnostics_start", "content_policy": "metadata_only", "runtime_log_level": "debug"})
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
        with self._state_lock:
            self._write({"type": "runtime.diagnostics_end", **self.summary()})
        self.close()
