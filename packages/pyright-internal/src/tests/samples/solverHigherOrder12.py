# This sample tests the case involving a higher-order function and a
# class that uses a contravariant type variable.

from collections.abc import Callable
from typing import TypeVar, Generic

T = TypeVar("T", contravariant=True)
A = TypeVar("A")
B = TypeVar("B")
C = TypeVar("C")


class ClassA(Generic[T]):
    pass


def func1(c: Callable[[A], None], v: A):
    pass


def func2(c: ClassA[B]) -> None:
    pass


def func3(c: ClassA[int]):
    func1(func2, c)
