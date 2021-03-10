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


def f6(p: Union[TD1, TD2, TD3]):
    # This should generate an error
    v1 = p["a"]

    v2 = p.get("a")

    if "c" in p:
        v3 = p["c"]
        t_v3: Literal["str"] = reveal_type(v3)

    if "a" in p and "d" in p:
        v4 = p["a"]
        t_v4: Literal["int"] = reveal_type(v4)

        v5 = p["d"]
        t_v5: Literal["str"] = reveal_type(v5)

    # This should generate an error
    v6 = p["d"]

