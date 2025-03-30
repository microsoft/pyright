# This sample tests the case where an attribute is accessed from a
# class that derives from an unknown type or Any.

from typing import Any, overload
from dummy import UnknownX  # type: ignore


class Desc:
    @overload
    def __get__(self, instance: None, owner: Any) -> "Desc": ...

    @overload
    def __get__(self, instance: object, owner: Any) -> int: ...

    def __get__(self, instance: object | None, owner: Any) -> "Desc | int": ...


class DerivesFromUnknown(UnknownX):
    y: Desc


class DerivesFromAny(Any):
    y: Desc


v1 = DerivesFromUnknown().x
reveal_type(v1, expected_text="Unknown")

v2 = DerivesFromAny().x
reveal_type(v2, expected_text="Any")

reveal_type(DerivesFromUnknown().y, expected_text="int")
reveal_type(DerivesFromAny().y, expected_text="int")
