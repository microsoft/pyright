from typing import Any

from ..span import SpanContext

class Propagator:
    def inject(self, span_context: SpanContext, carrier: dict[Any, Any]) -> None: ...
    def extract(self, carrier: dict[Any, Any]) -> SpanContext: ...
