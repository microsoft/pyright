# This sample tests the case where a recursive type alias is used
# to define a TypedDict that refers to itself in one of its fields.

from __future__ import annotations

from typing import Union, TypedDict


class _FooOptional(TypedDict, total=False):
    options: list[AllBar]
    type: int


class Foo(_FooOptional):
    id: int
    name: str


class BarA(TypedDict):
    type: int


class BarB(TypedDict):
    options: list[AllBar]
    type: int


AllBar = Union[BarA, BarB]


def foo(a: AllBar):
    reveal_type(a, expected_text="BarA | BarB")
    options = a.get("options", [{"type": 0}])
    reveal_type(options, expected_text="Any | list[dict[str, int]] | list[BarA | BarB]")

    for option in options:
        reveal_type(option, expected_text="Any | dict[str, int] | BarA | BarB")
        reveal_type(option["type"], expected_text="Any | int")
