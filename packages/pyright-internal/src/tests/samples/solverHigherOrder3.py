# This sample tests a case where a generic function is passed as
# an argument to itself, creating a recursive situation that
# caused an infinite loop.

from random import random
from typing import Any, Callable, TypeVar

T = TypeVar("T")
U = TypeVar("U")


def func1(x: T, y: U) -> T | U:
    return x if random() > 0.5 else y


def func2(x: T, y: T) -> T:
    return x if random() > 0.5 else y


reveal_type(
    func2(func1, func2), expected_text="(x: T(1)@func2, y: T(1)@func2) -> T(1)@func2"
)


S = TypeVar("S", bound=Callable[..., Any])


def func3(x: S) -> S:
    return x


reveal_type(func3(func3), expected_text="(x: S(1)@func3) -> S(1)@func3")
