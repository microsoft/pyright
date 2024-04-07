# This sample tests the case where a generic function returns a Callable type
# that is specialized with unsolved type variables.

from collections.abc import Container
from typing import TypeVar, Callable


T = TypeVar("T")
VT = TypeVar("VT")


def func1(container: Container[T]) -> Callable[[T], bool]: ...


def func2(a: T, b: Container[VT]) -> T:
    cmp = func1(b)

    # This should generate an error.
    cmp(a)

    return a
