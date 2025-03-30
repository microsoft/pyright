# This sample tests the case where functools.partial is applied to
# a function that has a **kwargs parameter that is typed as an
# unpacked TypedDict.

from functools import partial
from typing import TypedDict, NotRequired, Unpack


class TD1(TypedDict):
    c: list[str]
    a: int
    b: NotRequired[str]


def func1(**kwargs: Unpack[TD1]) -> None:
    print(f"a: {kwargs['a']}, b: {kwargs.get('b')}, c: {kwargs['c']}")


func1_1 = partial(func1, c=["a", "b"], a=2)
func1_1(b="2")

func1_2 = partial(func1, a=2, b="", c=["a", "b"])
func1_2(a=2, b="2")

func1_3 = partial(func1, c=["a", "b"])

# This should generate an error.
func1_3(b="2")
