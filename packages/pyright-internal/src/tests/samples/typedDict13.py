# This sample tests that TypedDicts that inherit from other
# TypedDicts do not override field names with incompatible types.

# pyright: reportIncompatibleVariableOverride=true

from typing import Any, NotRequired, Required, TypedDict


ParentA = TypedDict("ParentA", {"name": str, "age": int})


class ChildA(ParentA):
    # This should generate an error because the type of "age" is redefined.
    age: float

    name: str


class ParentB(TypedDict):
    x: Any


class ChildB(ParentB):
    x: int


class ParentC(TypedDict):
    x: Required[int]


class ChildC(ParentC):
    # This should generate an error because "x" is Required in the parent.
    x: NotRequired[int]


class ParentD(TypedDict):
    x: Required[int]


class ChildD(ParentD):
    # This should generate an error because "x" is NotRequired in the parent.
    x: NotRequired[int]


class ParentE(TypedDict, total=True):
    x: int


class ChildE(ParentE, total=False):
    # This should generate an error because "x" is Required in the parent.
    x: int
