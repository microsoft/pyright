# This sample tests a case where a generic function is passed as
# an argument to itself, creating a recursive situation that
# caused an infinite loop.

from random import random
from typing import TypeVar

T = TypeVar("T")
U = TypeVar("U")


def f(x: T, y: U) -> T | U:
    return x if random() > 0.5 else y


def g(x: T, y: T) -> T:
    return x if random() > 0.5 else y


reveal_type(g(f, g), expected_text="(x: T@g, y: T@g) -> T@g")

