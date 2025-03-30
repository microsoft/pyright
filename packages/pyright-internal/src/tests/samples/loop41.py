# This sample tests a few cases that involve a loop with a conditional. These
# case regressed and were not caught by any other test cases.

from typing import TypeVar, Any

T = TypeVar("T")


def func1(x: T) -> T: ...


def func2(schema: bool): ...


def func3(v1: list[bool], v2: int | str):
    for _ in v1:
        if v2 in set([1, 2, 3]):
            func1(v2)

            # This should generate an error.
            func2(v2)


def func4(x: Any, b: Any):
    a = x
    while a < 1:
        if a:
            b = int(b)
        else:
            b = a

        if b:
            # This should generate an error.
            return a.x(dummy)
