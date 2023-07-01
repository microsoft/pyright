# This sample tests the type narrowing case for unions of NamedTuples
# where one or more of the entries is tested against type None by index.

from typing import NamedTuple

IntFirst = NamedTuple(
    "IntFirst",
    [
        ("first", int),
        ("second", None),
    ],
)

StrSecond = NamedTuple(
    "StrSecond",
    [
        ("first", None),
        ("second", str),
    ],
)


def func1(a: IntFirst | StrSecond) -> IntFirst:
    if a[1] is None:
        reveal_type(a, expected_text="IntFirst")
        return a
    else:
        reveal_type(a, expected_text="StrSecond")
        raise ValueError()


UnionFirst = NamedTuple(
    "UnionFirst",
    [
        ("first", None | int),
        ("second", None),
    ],
)


def func2(a: UnionFirst | StrSecond):
    if a[0] is None:
        reveal_type(a, expected_text="UnionFirst | StrSecond")
    else:
        reveal_type(a, expected_text="UnionFirst")
