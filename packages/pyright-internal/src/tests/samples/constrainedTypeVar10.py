# This sample tests the handling of constrained type variables
# that include unions.

from typing import TypeVar

T1 = TypeVar("T1", int, str)
T2 = TypeVar("T2", int, str, int | str)
T3 = TypeVar("T3", int, str, int | str | list[int])


def func1(x: T1) -> T1:
    return x


def func2(x: T2) -> T2:
    return x


def func3(x: T3) -> T3:
    return x


def func4(y: int | str):
    # This should generate an error because T1 doesn't
    # include a union constraint.
    func1(y)

    func2(y)

    func3(y)
