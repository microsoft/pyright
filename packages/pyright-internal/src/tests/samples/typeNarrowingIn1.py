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
        t1: Literal["Literal[1, 2, 'a']"] = reveal_type(x)

    if x in (1, "2"):
        t2: Literal["Literal[1, '2']"] = reveal_type(x)

    if x in (1, None):
        t3: Literal["Literal[1] | None"] = reveal_type(x)

    if x in (1, b, "a"):
        t4: Literal["int | Literal['a']"] = reveal_type(x)

    if y in (1, b, "a"):
        t5: Literal["Literal[1, 2]"] = reveal_type(y)

    if y in (1, "a"):
        t6: Literal["Literal[1]"] = reveal_type(y)

    if y in (1, "b"):
        t7: Literal["Literal[1, 'b']"] = reveal_type(y)


def func2(a: Literal[1, 2, 3]):
    x = (1, 2)
    if a in x:
        t1: Literal["Literal[1, 2]"] = reveal_type(a)
    else:
        t2: Literal["Literal[1, 2, 3]"] = reveal_type(a)
