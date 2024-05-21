from typing import Any
from typing_extensions import Self

__tracebackhide__: bool

class ExtractingMixin:
    def extracting(self, *names: Any, **kwargs: dict[str, Any]) -> Self: ...
