# This sample tests the case where a generic function that returns a tuple
# is called with an expected type.

from typing import Iterable, Literal, TypeVar

A = TypeVar("A")
B = TypeVar("B")


def func1(a: A, b: B) -> tuple[Iterable[A], Iterable[B]]:
    return ((a,), (b,))


def func2(a: A, b: B) -> tuple[Iterable[B], Iterable[A]]:
    return ([b], [a])


def func3() -> tuple[Iterable[str], Iterable[int]]:
    return func1("", 3)


def func4() -> tuple[Iterable[Literal["hi"]], Iterable[Literal[3]]]:
    return func2(3, "hi")
