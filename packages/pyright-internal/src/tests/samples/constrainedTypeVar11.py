# This sample tests for proper handling of constrained or bound TypeVars.

from typing import Generic, TypeVar


class IntSubclass1(int):
    pass


_T1 = TypeVar("_T1", int, IntSubclass1)


def add1(value: _T1) -> _T1:
    reveal_type(value + 1, expected_text="int*")

    # This should generate an error
    return value + 5


class IntSubclass2(int):
    def __add__(self, value: object) -> "IntSubclass2": ...


_T2 = TypeVar("_T2", int, IntSubclass2)


def add2(value: _T2) -> _T2:
    reveal_type(value + 1, expected_text="int* | IntSubclass2*")
    return value + 5
