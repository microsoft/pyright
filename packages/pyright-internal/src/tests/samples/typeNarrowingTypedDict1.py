# This sample tests type narrowing for TypedDict types based
# on whether a key is in or not in the dict.

from typing import TypedDict


class TD1(TypedDict):
    a: str
    b: int


class TD2(TypedDict):
    a: int
    c: str


class TD3(TypedDict, total=False):
    a: int
    d: str


def f1(p: TD1 | TD2):
    if "b" in p:
        reveal_type(p, expected_text="TD1 | TD2")
    else:
        reveal_type(p, expected_text="TD2")


def f2(p: TD1 | TD2):
    if "b" not in p:
        reveal_type(p, expected_text="TD2")
    else:
        reveal_type(p, expected_text="TD1 | TD2")


def f3(p: TD1 | TD3):
    if "d" in p:
        reveal_type(p, expected_text="TD1 | TD3")
    else:
        reveal_type(p, expected_text="TD1 | TD3")


def f4(p: TD1 | TD3):
    if "d" not in p:
        reveal_type(p, expected_text="TD1 | TD3")
    else:
        reveal_type(p, expected_text="TD1 | TD3")


def f5(p: TD1 | TD3):
    if "a" in p:
        reveal_type(p, expected_text="TD1 | TD3")
    else:
        reveal_type(p, expected_text="TD3")


def f6(p: TD1 | TD2 | TD3):
    # This should generate an error for TD3.
    v1 = p["a"]

    v2 = p.get("a")

    if "c" in p:
        # This should generate an error for TD1 and TD3
        v3 = p["c"]
        reveal_type(v3, expected_text="Unknown | str")

    if "a" in p and "d" in p:
        v4 = p["a"]
        reveal_type(v4, expected_text="str | int")

        # This should generate an error for TD1 and TD2
        v5 = p["d"]
        reveal_type(v5, expected_text="Unknown | str")

    # This should generate three errors, two for TD1 and TD2 (because
    # "d" is not a valid key) and one for TD3 (because "d" is not required).
    v6 = p["d"]


def f7(p: TD3):
    pass


def f8(p: TD3):
    if "a" in p:
        f7(p)
