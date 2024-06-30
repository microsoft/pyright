# This sample tests the case of a context manager within a try/except block.

from typing import ContextManager


def create_context() -> ContextManager[str]: ...


def possible_exception() -> None: ...


def func1():
    x: str | None = None
    ctx: str | None = None
    try:
        with create_context() as ctx:
            x = "0"
            possible_exception()
    except Exception:
        reveal_type(x, expected_text="Literal['0'] | None")
        reveal_type(ctx, expected_text="str | None")


def func2():
    ctx: str | None = None
    try:
        with create_context() as ctx:
            possible_exception()
            return
    except Exception:
        reveal_type(ctx, expected_text="str | None")
