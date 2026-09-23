# Regression test for https://github.com/microsoft/pyright/issues/11483
# Generic ContextManager[T] should treat __exit__ return type like typing.ContextManager[bool].

from typing import Generic, Self, TypeVar, reveal_type

T = TypeVar("T", bound="bool|None")


class ContextManager(Generic[T]):
    def __enter__(self) -> Self: ...

    def __exit__(self, exc_type, exc_val, exc_tb) -> T: ...


def test_generic_bool_context_manager() -> None:
    foo = "str"
    with ContextManager[bool]() as ctx:
        reveal_type(ctx.__exit__(None, None, None), expected_text="bool")
        foo = 1
    reveal_type(foo, expected_text="Literal['str', 1]")


TEnter = TypeVar("TEnter")
TExit = TypeVar("TExit", bound="bool|None")


class SplitContextManager(Generic[TEnter, TExit]):
    def __enter__(self) -> TEnter: ...

    def __exit__(self, exc_type, exc_val, exc_tb) -> TExit: ...


def test_multi_typevar_context_manager() -> None:
    bar = "str"
    with SplitContextManager[int, bool]() as ctx:
        reveal_type(ctx, expected_text="int")
        bar = 1
    reveal_type(bar, expected_text="Literal['str', 1]")


class AsyncContextManager(Generic[T]):
    async def __aenter__(self) -> Self: ...

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> T: ...


async def test_generic_async_context_manager() -> None:
    # __aexit__ specializes to bool, so the exception may have been suppressed
    # and the body may not have run.
    baz = "str"
    async with AsyncContextManager[bool]() as ctx:
        baz = 1
    reveal_type(baz, expected_text="Literal['str', 1]")

    # __aexit__ specializes to None, so the exception is never suppressed and
    # the entire body must have run.
    qux = "str"
    async with AsyncContextManager[None]() as ctx:
        qux = 1
    reveal_type(qux, expected_text="Literal[1]")
