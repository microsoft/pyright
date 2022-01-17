# This sample verifies that a generic type alias with a Callable
# works correctly.

# pyright: reportInvalidTypeVarUse=false

from typing import Callable, TypeVar

T = TypeVar("T")
F = Callable[[T], T]


def f() -> F[T]:
    def g(x: T) -> T:
        ...

    return g


g = f()
v1 = g("foo")
reveal_type(v1, expected_text="str")

v2 = g(1)
reveal_type(v2, expected_text="int")
