# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

"""Paired wall-clock phase records, separate from immutable comparison inputs."""

import asyncio
import json
import threading
import uuid
from collections.abc import Awaitable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime, timezone
from pathlib import Path
from time import monotonic
from typing import TypeVar

from pydantic import JsonValue

_parent: ContextVar[str | None] = ContextVar("issue_review_timing_parent", default=None)
_lock = threading.Lock()
T = TypeVar("T")


async def timed_phase(path: Path, phase: str, operation: Awaitable[T], *, target: str | None = None) -> T:
    with phase_timing(path, phase, target=target):
        return await operation


@contextmanager
def phase_timing(path: Path, phase: str, *, target: str | None = None) -> Iterator[None]:
    identifier, parent = uuid.uuid4().hex, _parent.get()
    started_at, started = datetime.now(timezone.utc).isoformat(), monotonic()

    def write(kind: str, **fields: JsonValue) -> None:
        with _lock:
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("a", encoding="utf-8", newline="\n") as stream:
                stream.write(json.dumps({
                    "type": kind, "id": identifier, "parent_id": parent, "phase": phase, "target": target,
                    "at": datetime.now(timezone.utc).isoformat(), "started_at": started_at,
                    "nested_intervals": "non_additive", **fields,
                }) + "\n")

    write("phase.start")
    token = _parent.set(identifier)
    status, exception = "succeeded", None
    try:
        yield
    except BaseException as error:
        status = "cancelled" if isinstance(error, asyncio.CancelledError) else "failed"
        exception = type(error).__name__
        raise
    finally:
        _parent.reset(token)
        write("phase.end", elapsed_seconds=max(0, monotonic() - started), status=status, exception=exception)
