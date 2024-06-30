# This sample verifies that a generic type alias with a Callable
# works correctly.

# pyright: reportInvalidTypeVarUse=false

from typing import Callable, TypeVar

T = TypeVar("T")
F = Callable[[T], T]


def func1() -> F[T]:
    def g(x: T) -> T: ...

    return g


func2 = func1()
v1 = func2("foo")
reveal_type(v1, expected_text="str")

v2 = func2(1)
reveal_type(v2, expected_text="int")
