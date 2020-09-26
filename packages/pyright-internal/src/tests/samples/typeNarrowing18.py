# This sample tests type narrowing for TypedDict types based
# on whether a key is in or not in the dict.

from typing import Literal, TypedDict, Union


class TD1(TypedDict):
    a: str
    b: int


class TD2(TypedDict):
    a: int
    c: str


class TD3(TypedDict, total=False):
    a: int
    d: str


def f1(p: Union[TD1, TD2]):
    if "b" in p:
        tp1: Literal["TD1"] = reveal_type(p)
    else:
        tp2: Literal["TD2"] = reveal_type(p)


def f2(p: Union[TD1, TD2]):
    if "b" not in p:
        tp1: Literal["TD2"] = reveal_type(p)
    else:
        tp2: Literal["TD1"] = reveal_type(p)


def f3(p: Union[TD1, TD3]):
    if "d" in p:
        tp1: Literal["TD3"] = reveal_type(p)
    else:
        tp2: Literal["TD1 | TD3"] = reveal_type(p)


def f4(p: Union[TD1, TD3]):
    if "d" not in p:
        tp1: Literal["TD1 | TD3"] = reveal_type(p)
    else:
        tp2: Literal["TD3"] = reveal_type(p)


def f5(p: Union[TD1, TD3]):
    if "a" in p:
        tp1: Literal["TD1 | TD3"] = reveal_type(p)
    else:
        tp2: Literal["TD3"] = reveal_type(p)

