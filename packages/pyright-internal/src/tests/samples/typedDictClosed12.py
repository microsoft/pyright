# This sample tests that a LiteralString key on a TypedDict is treated
# like a str key whose value is not known statically.

from typing import Literal, LiteralString, TypedDict, reveal_type


class TD1(TypedDict, extra_items=str):
    known: int


class TD2(TypedDict):
    known: int


class TD3(TypedDict, closed=True):
    known: int


def func1(
    td1: TD1,
    td2: TD2,
    td3: TD3,
    k: LiteralString,
    s: str,
    lit: Literal["known"],
) -> None:
    reveal_type(td1[k], expected_text="Unknown")
    reveal_type(td1[s], expected_text="Unknown")
    reveal_type(td2[k], expected_text="Unknown")
    reveal_type(td3[k], expected_text="Unknown")
    reveal_type(td1[lit], expected_text="int")

    td1[k] = "a"
    td2[k] = 1
    td3[k] = 1

    del td1[k]
    del td2[k]

    # This should generate an error because "other" is not a defined key.
    td3["other"]
