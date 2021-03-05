# This sample verifies that a generic type alias with a Callable
# works correctly.

# pyright: reportInvalidTypeVarUse=false

from typing import Callable, Literal, TypeVar

T = TypeVar("T")
F = Callable[[T], T]


def f() -> F[T]:
    def g(x: T) -> T:
        ...

    return g


g = f()
v1 = g("foo")
t_v1: Literal["str"] = reveal_type(v1)

v2 = g(1)
t_v2: Literal["int"] = reveal_type(v2)
