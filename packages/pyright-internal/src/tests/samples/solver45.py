# This sample tests the case where an expression is assigned to an unpacked
# tuple, and the correctly-inferred type of the expression depends on
# bidirectional type inference.

from typing import Literal, TypedDict


def func1[S, T](v: S | T, s: type[S], t: type[T]) -> tuple[S | None, T | None]: ...


def test1():
    a: int | None
    b: str | None

    a, b = func1(1, int, str)


class TD1(TypedDict):
    a: int


def test2():
    a: TD1
    b: TD1

    a, b = ({"a": 1}, {"a": 2})


def test3():
    a: Literal[1]
    b: Literal[2]

    a, b = (1, 2)
