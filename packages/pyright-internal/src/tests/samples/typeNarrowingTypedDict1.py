# This sample tests type narrowing for TypedDict types based
# on whether a key is in or not in the dict.

from typing import Literal, TypedDict, Union, final


@final
class TD1(TypedDict):
    a: str
    b: int


@final
class TD2(TypedDict):
    a: int
    c: str


@final
class TD3(TypedDict, total=False):
    a: int
    d: str


class TD4(TypedDict):
    a: int
    c: str


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
    # This should generate an error for TD3.
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

    # This should generate two errors, one for TD1 and another for TD2.
    v6 = p["d"]


def f7(p: TD3):
    pass


def f8(p: TD3):
    if "a" in p:
        f7(p)


def f9(p: Union[TD1, TD4]):
    if "b" in p:
        tp1: Literal["TD1 | TD4"] = reveal_type(p)
    else:
        tp2: Literal["TD4"] = reveal_type(p)
