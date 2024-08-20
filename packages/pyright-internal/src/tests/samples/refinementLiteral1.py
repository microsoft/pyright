# This sample tests basic interactions between Literal and refinement types.

# pyright: reportMissingModuleSource=false

from typing import Literal, cast
from typing_extensions import StrValue


def func1(a: int @ "x") -> int @ "x":
    return a


v1 = func1(-1)
reveal_type(v1, expected_text="Literal[-1]")


def func2(a: int @ "x", b: int @ "y") -> int @ "x" | int @ "y":
    return a if a > b else b


v2 = func2(-1, 2)
reveal_type(v2, expected_text="Literal[-1, 2]")


def func3(a: str @ StrValue("x"), b: str @ StrValue("y")) -> str @ StrValue("x + y"):
    return cast(str @ StrValue("x + y"), a + b)


v3 = func3("hi ", "there")
reveal_type(v3, expected_text="Literal['hi there']")


def func4(x: int @ 2):
    y1: Literal[2] = x
    y2: Literal[1, 2] = x

    # This should result in an error.
    y3: Literal[3] = x


def func5(x: bool @ False):
    y1: Literal[False] = x

    y2: bool @ False = x

    # This should result in an error.
    y3: Literal[True] = x

    # This should result in an error.
    y4: bool @ True = x


def is_greater(a: int @ "a", b: int @ "b") -> bool @ "a > b":
    return a > b


def func6():
    reveal_type(is_greater(1, 2), expected_text="Literal[False]")
    reveal_type(is_greater(2, 1), expected_text="Literal[True]")
