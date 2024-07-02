# This sample tests the type narrowing case for unions of NamedTuples
# where one or more of the entries is tested against type None by attribute.

from typing import NamedTuple, Union

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


def func1(a: Union[IntFirst, StrSecond]) -> IntFirst:
    if a.second is None:
        reveal_type(a, expected_text="IntFirst")
        return a
    else:
        reveal_type(a, expected_text="StrSecond")
        raise ValueError()


UnionFirst = NamedTuple(
    "UnionFirst",
    [
        ("first", Union[None, int]),
        ("second", None),
    ],
)


def func2(a: Union[UnionFirst, StrSecond]):
    if a.first is None:
        reveal_type(a, expected_text="UnionFirst | StrSecond")
    else:
        reveal_type(a, expected_text="UnionFirst")


class A:
    @property
    def prop1(self) -> int | None: ...

    member1: None
    member2: int | None
    member3: int | None
    member4: int | None


class B:
    @property
    def prop1(self) -> int: ...

    member1: int
    member2: int | None
    member3: None
    member4: int


def func3(c: Union[A, B]):
    if c.prop1 is None:
        reveal_type(c, expected_text="A | B")
    else:
        reveal_type(c, expected_text="A | B")


def func4(c: Union[A, B]):
    if c.member1 is None:
        reveal_type(c, expected_text="A")
    else:
        reveal_type(c, expected_text="B")


def func5(c: Union[A, B]):
    if c.member2 is None:
        reveal_type(c, expected_text="A | B")
    else:
        reveal_type(c, expected_text="A | B")


def func6(c: Union[A, B]):
    if c.member3 is not None:
        reveal_type(c, expected_text="A")
    else:
        reveal_type(c, expected_text="A | B")


def func7(c: Union[A, B]):
    if c.member4 is not None:
        reveal_type(c, expected_text="A | B")
    else:
        reveal_type(c, expected_text="A")
