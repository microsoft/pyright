# This sample tests that a recursive call to a generic function
# evaluates correctly.

# pyright: strict
from typing import TypeVar

_T = TypeVar("_T")


def func(x: list[_T]) -> list[_T]:
    result = func(x)
    return result
