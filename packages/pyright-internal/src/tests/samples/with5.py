# This sample tests the case of a context manager within a try/except block.

from types import TracebackType
from typing import Literal, Optional, ContextManager


def create_context() -> ContextManager[str]:
    ...


def possible_exception() -> None:
    ...


x: Optional[str] = None
ctx: Optional[str] = None
try:
    with create_context() as ctx:
        x = "0"
        possible_exception()
except Exception:
    t1: Literal["Literal['0'] | None"] = reveal_type(x)
    t2: Literal["str | None"] = reveal_type(ctx)
