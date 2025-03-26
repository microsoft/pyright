# This sample tests the type analyzer's type narrowing
# logic for literals.

from typing import Literal, LiteralString, TypeVar, Union


def func1(p1: Literal["a", "b", "c"]):
    if p1 != "b":
        if p1 == "c":
            reveal_type(p1, expected_text="Literal['c']")
            pass
        else:
            reveal_type(p1, expected_text="Literal['a']")

    if p1 != "a":
        reveal_type(p1, expected_text="Literal['c', 'b']")
    else:
        reveal_type(p1, expected_text="Literal['a']")


def func2(p1: Literal[1, 4, 7]):
    if p1 == 4 or p1 == 1:
        reveal_type(p1, expected_text="Literal[4, 1]")
    else:
        reveal_type(p1, expected_text="Literal[7]")


def func3(a: Union[int, None]):
    if a == 1 or a == 2:
        reveal_type(a, expected_text="Literal[1, 2]")


T = TypeVar("T", bound=Literal["a", "b"])


def func4(x: T) -> T:
    if x == "a":
        reveal_type(x, expected_text="Literal['a']")
        return x
    else:
        reveal_type(x, expected_text="Literal['b']")
        return x


S = TypeVar("S", Literal["a"], Literal["b"])


def func5(x: S) -> S:
    if x == "a":
        reveal_type(x, expected_text="Literal['a']")
        return x
    else:
        reveal_type(x, expected_text="Literal['b']")
        return x


def func6(x: LiteralString):
    if x == "a":
        reveal_type(x, expected_text="Literal['a']")
    else:
        reveal_type(x, expected_text="LiteralString")
