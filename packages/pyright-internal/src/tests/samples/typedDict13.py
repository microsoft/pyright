# This sample tests that TypedDicts that inherit from other
# TypedDicts do not override field names with incompatible types.

from typing import TypedDict


ParentTD = TypedDict("ParentTD", {"name": str, "age": int})


class ChildTD(ParentTD):
    # This should generate an error because the type of "age" is redefined.
    age: float

    name: str
