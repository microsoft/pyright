# This sample tests the type analyzer's type narrowing
# logic for literals.

from typing import Literal, Union


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
