# This sample tests that the exception-swallowing behavior of a context
# manager is determined from the specialized __exit__ / __aexit__ return
# type when the context manager is generic and the return type is annotated
# with a TypeVar.

from typing import Generic, Literal, Self, TypeVar, assert_type

T = TypeVar("T", bound="bool | None")


class ContextManager(Generic[T]):
    def __enter__(self) -> Self: ...
    def __exit__(self, exc_type, exc_val, exc_tb) -> T: ...


# The __exit__ return type specializes to None, so the exception is never
# suppressed and the entire body must have run.
foo = "str"
with ContextManager[None]() as ctx:
    foo = 1
assert_type(foo, Literal[1])


# The __exit__ return type specializes to bool, so the exception may have
# been suppressed and the body may not have run.
bar = "str"
with ContextManager[bool]() as ctx:
    bar = 1
assert_type(bar, Literal["str", 1])


class AsyncContextManager(Generic[T]):
    async def __aenter__(self) -> Self: ...
    async def __aexit__(self, exc_type, exc_val, exc_tb) -> T: ...


async def func1() -> None:
    baz = "str"
    async with AsyncContextManager[None]() as ctx:
        baz = 1
    assert_type(baz, Literal[1])

    qux = "str"
    async with AsyncContextManager[bool]() as ctx:
        qux = 1
    assert_type(qux, Literal["str", 1])
