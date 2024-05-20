# This sample tests the case where a generic function has a default argument
# value for a parameter with a generic type.

from collections.abc import Callable
from typing import Iterable, Mapping, TypeVar

T = TypeVar("T")

default_value: dict[str, int] = {}


def func1(x: T, y: Mapping[str, T] = default_value, /) -> T: ...
def func2(x: T, y: Mapping[str, T] = default_value) -> T: ...
def func3(x: T, *, y: Mapping[str, T] = default_value) -> T: ...


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


# This should generate an error.
test1(func4, 1)

# This should generate an error.
test1(func5, 1)

# This should generate an error.
test1(func6, 1)
