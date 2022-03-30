# This sample tests the type narrowing case for unions of NamedTuples
# where one or more of the entries is tested against type None by attribute.

from typing import NamedTuple, Union

IntFirst = NamedTuple("IntFirst", [
    ("first", int),
    ("second", None),
])

StrSecond = NamedTuple("StrSecond", [
    ("first", None),
    ("second", str),
])

def func1(a: Union[IntFirst, StrSecond]) -> IntFirst:
    if a.second is None:
        reveal_type(a, expected_text="IntFirst")
        return a
    else:
        reveal_type(a, expected_text="StrSecond")
        raise ValueError()


UnionFirst = NamedTuple("UnionFirst", [
    ("first", Union[None, int]),
    ("second", None),
])

def func2(a: Union[UnionFirst, StrSecond]):
    if a.first is None:
        reveal_type(a, expected_text="UnionFirst | StrSecond")
    else:
        reveal_type(a, expected_text="UnionFirst")

