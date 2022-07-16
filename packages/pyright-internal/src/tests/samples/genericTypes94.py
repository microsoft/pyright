# This sample tests for the case where a generic callable type is
# specialized with type variables in a recursive manner.

from typing import Callable, Generic, TypeVar

T = TypeVar("T")
U = TypeVar("U")
V = TypeVar("V")


class ClassA(Generic[T, U]):
    x: Callable[[T], U]

    def __init__(self, f: Callable[[T], U]):
        self.x = f

    def __call__(self, x: T) -> U:
        return self.x(x)

    def __add__(self, other: "ClassA[U, V]") -> "ClassA[T, V]":
        f = self.x
        g: Callable[[U], V] = other.x
        return ClassA(lambda x: g(f(x)))
