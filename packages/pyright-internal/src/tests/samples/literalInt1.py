# This sample tests the LiteralInt type.

# pyright: reportMissingModuleSource=false

from typing import Literal
from typing_extensions import LiteralInt


x: LiteralInt = 3


def func1(p1: int, p2: Literal[1, 2, 3]):
    # This should generate an error.
    v1: LiteralInt = p1

    v2: LiteralInt = p2

    v3: LiteralInt = 3

    v4: LiteralInt = p2 + 4

    x = [p2]
    reveal_type(x, expected_text="list[int]")


def func2[T: LiteralInt](p1: T) -> T:
    v1: LiteralInt = p1

    return p1


def func3(p1: Literal[3], p2: Literal[-1, 1]):
    v1 = func2(p1)
    reveal_type(v1, expected_text="Literal[3]")

    v2 = func2(p2)
    reveal_type(v2, expected_text="Literal[-1, 1]")


def func4(p1: list[LiteralInt]):
    # This should generate an error.
    v: list[int] = p1
