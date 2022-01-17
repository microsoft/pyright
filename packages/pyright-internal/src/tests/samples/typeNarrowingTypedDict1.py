# This sample tests type narrowing for TypedDict types based
# on whether a key is in or not in the dict.

from typing import TypedDict, Union, final


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
        reveal_type(p, expected_text="TD1")
    else:
        reveal_type(p, expected_text="TD2")


def f2(p: Union[TD1, TD2]):
    if "b" not in p:
        reveal_type(p, expected_text="TD2")
    else:
        reveal_type(p, expected_text="TD1")


def f3(p: Union[TD1, TD3]):
    if "d" in p:
        reveal_type(p, expected_text="TD3")
    else:
        reveal_type(p, expected_text="TD1 | TD3")


def f4(p: Union[TD1, TD3]):
    if "d" not in p:
        reveal_type(p, expected_text="TD1 | TD3")
    else:
        reveal_type(p, expected_text="TD3")


def f5(p: Union[TD1, TD3]):
    if "a" in p:
        reveal_type(p, expected_text="TD1 | TD3")
    else:
        reveal_type(p, expected_text="TD3")


def f6(p: Union[TD1, TD2, TD3]):
    # This should generate an error for TD3.
    v1 = p["a"]

    v2 = p.get("a")

    if "c" in p:
        v3 = p["c"]
        reveal_type(v3, expected_text="str")

    if "a" in p and "d" in p:
        v4 = p["a"]
        reveal_type(v4, expected_text="int")

        v5 = p["d"]
        reveal_type(v5, expected_text="str")

    # This should generate two errors, one for TD1 and another for TD2.
    v6 = p["d"]


def f7(p: TD3):
    pass


def f8(p: TD3):
    if "a" in p:
        f7(p)


def f9(p: Union[TD1, TD4]):
    if "b" in p:
        reveal_type(p, expected_text="TD1 | TD4")
    else:
        reveal_type(p, expected_text="TD4")
