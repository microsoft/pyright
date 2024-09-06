# This sample tests that type aliasing works.

from typing import Any, Literal

# Make sure it works with and without forward references.
TupleAlias = tuple["int", int]

v1: tuple[int, int]
v2: TupleAlias

v1 = (1, 2)
v2 = (1, 2)


AnyAlias = Any

v3: AnyAlias = 3


class A:
    Value1 = Literal[1]

    Value2 = 1


reveal_type(A.Value1, expected_text="type[Literal[1]]")
reveal_type(A.Value2, expected_text="int")


def func1(x: A.Value1):
    reveal_type(x, expected_text="Literal[1]")


Alias1 = Literal[0, 1]

v4: dict[Alias1, Any] = {}

if v4:
    pass

v5: list[Alias1] = []


Alias2 = int | str
Alias3 = int
Alias4 = type[int]


def func2(x: Alias2):
    reveal_type(type(x), expected_text="type[int] | type[str]")


def func3(v2: type[Alias2], v3: type[Alias3], v4: type[Alias4]):
    reveal_type(v2, expected_text="type[int] | type[str]")
    reveal_type(v3, expected_text="type[int]")
    reveal_type(v4, expected_text="type[type[int]]")


class B:
    TA1 = list

    def __init__(self) -> None:
        self.val = self.TA1


b = B()
reveal_type(b.val, expected_text="type[list[Unknown]]")
