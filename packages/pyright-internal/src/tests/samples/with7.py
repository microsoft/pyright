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
