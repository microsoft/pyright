# This sample tests the case where a generic function has a default argument
# value for a parameter with a generic type.

from collections.abc import Callable
from typing import Iterable, TypeVar

T = TypeVar("T")

default_value: dict[str, int] = {}


def func1(x: T, y: dict[str, T] = default_value, /) -> T: ...


def func2(x: T, y: dict[str, T] = default_value) -> T: ...


def func3(x: T, *, y: dict[str, T] = default_value) -> T: ...


def test1(func: Callable[[T], T], value: T) -> T:
    return func(value)


# This should generate an error.
test1(func1, "")

# This should generate an error.
test1(func2, "")

# This should generate an error.
test1(func3, "")

reveal_type(test1(func1, 1), expected_text="int")
reveal_type(test1(func2, 1), expected_text="int")
reveal_type(test1(func3, 1), expected_text="int")


def func4(x: T, y: Iterable[T] = default_value, z: T = "", /) -> T: ...


def func5(x: T, y: Iterable[T] = default_value, z: T = "") -> T: ...


def func6(x: T, *, y: Iterable[T] = default_value, z: T = "") -> T: ...


reveal_type(test1(func4, 1), expected_text="str | int")
reveal_type(test1(func5, 1), expected_text="str | int")
reveal_type(test1(func6, 1), expected_text="str | int")


class A[T]:
    def __init__(self, value: T) -> None:
        self._value: T = value

    def update(self, value: T = 0, /) -> "A[T]":
        return A(value)


a = A("")

a.update("")

# This should generate an error.
a.update()
