# This sample tests type narrowing for the "in" operator.

from typing import Optional, Union
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
