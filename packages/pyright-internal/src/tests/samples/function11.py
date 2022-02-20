# This sample tests the case where a function type is assigned to another
# and the source contains parameters that are annotated as literals and
# the destination has corresponding TypeVars.

from typing import Callable, TypeVar, Literal

_A = TypeVar("_A")


def wrapper(fn: Callable[[_A], int]) -> _A:
    ...


def f3(a: Literal[0]) -> int:
    ...


wrapper(f3)
