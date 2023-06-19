# This sample tests the assignment of unions that contain TypeVars.

from typing import TypeVar


T = TypeVar("T")


def func1(x: T | None) -> T | str:
    # This should generate an error.
    return x


def func2(x: T | int) -> T | str:
    # This should generate an error.
    return x
