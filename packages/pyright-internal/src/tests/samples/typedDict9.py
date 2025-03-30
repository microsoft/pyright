# This sample tests the handling of nested TypedDict fields.

from typing import Literal, TypedDict


class Inner1(TypedDict):
    inner_key: str


class Inner2(TypedDict):
    inner_key: Inner1


class Outer1(TypedDict):
    outer_key: Inner2


o1: Outer1 = {"outer_key": {"inner_key": {"inner_key": "hi"}}}

# This should generate an error because the inner-most value
# should be a string.
o2: Outer1 = {"outer_key": {"inner_key": {"inner_key": 1}}}


class Inner3(TypedDict):
    x: int


class Inner4(TypedDict):
    x: int


class Outer2(TypedDict):
    y: str
    z: Literal[""] | Inner3


class Outer3(TypedDict):
    y: str
    z: Literal[""] | Inner4


def func1(td: Outer3): ...


o3: Outer2 = {"y": "", "z": {"x": 0}}
o4: Outer3 = o3
