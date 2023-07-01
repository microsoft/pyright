# This sample tests the case where a type variable is bound to a union.

from typing import Callable, TypeVar

T = TypeVar("T")
IntStr = str | int
T1 = TypeVar("T1", bound=IntStr)
T2 = TypeVar("T2", bound=IntStr)


def custom_eq(x: IntStr, y: IntStr) -> bool:
    return True


def eq(f: Callable[[T1], T2], x: T1, y: T2) -> bool:
    return custom_eq(f(x), y)
