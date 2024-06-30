# This sample tests the handling of a higher-order function
# that accepts a generic function as a callback.

from typing import Callable, TypeVar

A = TypeVar("A")
B = TypeVar("B")


def func1(fn: Callable[[A, B], A], b: B) -> A: ...


def func2(a: A, x: A) -> A: ...


def func3(a: A) -> A:
    return func1(func2, a)
