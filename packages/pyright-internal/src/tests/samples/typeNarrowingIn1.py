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


def func1(x: Optional[Union[int, str]]):
    if x in (1, 2):
        t1: Literal["int"] = reveal_type(x)

    if x in (1, "2"):
        t2: Literal["int | str"] = reveal_type(x)

    if x in (1, None):
        t3: Literal["int | None"] = reveal_type(x)
