# This sample tests a case that involves a loop with a conditional. This
# case regressed and was not caught by any other test cases.

from typing import TypeVar

T = TypeVar("T")


def func1(x: T) -> T:
    ...


def func2(schema: bool):
    ...


def func3(v1: list[bool], v2: int | str):
    for _ in v1:
        if v2 in set([1, 2, 3]):
            func1(v2)

            # This should generate an error.
            func2(v2)
