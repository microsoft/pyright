# This sample tests the case where a recursive type alias is used
# to define a TypedDict that refers to itself in one of its fields.

from __future__ import annotations

from typing import TypedDict


class ClassA(TypedDict, total=False):
    options: list[CorD]
    type: int


class ClassB(ClassA):
    id: int
    name: str


class ClassC(TypedDict):
    type: int


class ClassD(TypedDict):
    options: list[CorD]
    type: int


CorD = ClassC | ClassD


def foo(a: CorD):
    reveal_type(a, expected_text="ClassC | ClassD")
    options = a.get("options", [])
    reveal_type(options, expected_text="list[ClassC | ClassD] | Any | list[Any]")

    for option in options:
        reveal_type(option, expected_text="ClassC | ClassD | Any")
        reveal_type(option["type"], expected_text="int | Any")
