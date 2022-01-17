# This sample tests type narrowing for the "in" operator.

from typing import Literal, Optional, Union
import random


def verify_str(p: str) -> None:
    ...


def verify_int(p: int) -> None:
    ...


def verify_none(p: None) -> None:
    ...


x: Optional[str]
y: Union[int, str]
if random.random() < 0.5:
    x = None
    y = 1
else:
    x = "2"
    y = "2"

if x in ["2"]:
    verify_str(x)

    # This should generate an error because x should
    # be narrowed to a str.
    verify_none(x)

if y in [2]:
    verify_int(y)

    # This should generate an error because y should
    # be narrowed to an int.
    verify_str(y)


def func1(x: Optional[Union[int, str]], y: Literal[1, 2, "b"], b: int):
    if x in (1, 2, "a"):
        reveal_type(x, expected_text="Literal[1, 2, 'a']")

    if x in (1, "2"):
        reveal_type(x, expected_text="Literal[1, '2']")

    if x in (1, None):
        reveal_type(x, expected_text="Literal[1] | None")

    if x in (1, b, "a"):
        reveal_type(x, expected_text="int | Literal['a']")

    if y in (1, b, "a"):
        reveal_type(y, expected_text="Literal[1, 2]")

    if y in (1, "a"):
        reveal_type(y, expected_text="Literal[1]")

    if y in (1, "b"):
        reveal_type(y, expected_text="Literal[1, 'b']")


def func2(a: Literal[1, 2, 3]):
    x = (1, 2)
    if a in x:
        reveal_type(a, expected_text="Literal[1, 2]")
    else:
        reveal_type(a, expected_text="Literal[1, 2, 3]")
