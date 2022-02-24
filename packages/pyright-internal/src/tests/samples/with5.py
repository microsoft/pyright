# This sample tests the case of a context manager within a try/except block.

from typing import Optional, ContextManager


def create_context() -> ContextManager[str]:
    ...


def possible_exception() -> None:
    ...


def func1():
    x: Optional[str] = None
    ctx: Optional[str] = None
    try:
        with create_context() as ctx:
            x = "0"
            possible_exception()
    except Exception:
        reveal_type(x, expected_text="Literal['0'] | None")
        reveal_type(ctx, expected_text="str | None")


def func2():
    ctx: Optional[str] = None
    try:
        with create_context() as ctx:
            possible_exception()
            return
    except Exception:
        reveal_type(ctx, expected_text="str | None")
