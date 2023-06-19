# This sample tests that a recursive call to a generic function
# evaluates correctly.

# pyright: strict

from typing import TypeVar

_T = TypeVar("_T")


def func1(x: list[_T]) -> list[_T]:
    result = func1(x)
    return result
