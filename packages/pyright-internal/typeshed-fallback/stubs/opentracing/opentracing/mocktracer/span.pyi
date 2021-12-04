from typing import Any

from ..span import Span, SpanContext
from ..tracer import Tracer

class MockSpan(Span):
    operation_name: str | None
    start_time: Any
    parent_id: int | None
    tags: dict[str, Any]
    finish_time: float
    finished: bool
    logs: list[LogData]
    def __init__(
        self,
        tracer: Tracer,
        operation_name: str | None = ...,
        context: SpanContext | None = ...,
        parent_id: int | None = ...,
        tags: dict[str, Any] | None = ...,
        start_time: float | None = ...,
    ) -> None: ...
    def set_operation_name(self, operation_name: str) -> Span: ...
    def set_tag(self, key: str, value: str | bool | int | float) -> Span: ...
    def log_kv(self, key_values: dict[str, Any], timestamp: float | None = ...) -> Span: ...
    def finish(self, finish_time: float | None = ...) -> None: ...
    def set_baggage_item(self, key: str, value: str) -> Span: ...
    def get_baggage_item(self, key: str) -> str | None: ...

class LogData:
    key_values: dict[str, Any]
    timestamp: float | None
    def __init__(self, key_values: dict[str, Any], timestamp: float | None = ...) -> None: ...
