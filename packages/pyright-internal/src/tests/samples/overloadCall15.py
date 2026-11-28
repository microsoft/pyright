# This sample tests overload resolution when an earlier overload has a union
# parameter that cannot accept a nested list literal.

# pyright: reportOverlappingOverload=false

from collections.abc import Sequence
from typing import overload


@overload
def overloaded(value: Sequence[str] | Sequence[Sequence[str]]) -> str: ...


@overload
def overloaded(value: Sequence[Sequence[str | int]]) -> int: ...


def overloaded(value: object) -> object: ...


reveal_type(overloaded([["a"], ["b", 1]]), expected_text="int")


@overload
def reversed_union(value: Sequence[Sequence[str]] | Sequence[str]) -> str: ...


@overload
def reversed_union(value: Sequence[Sequence[str | int]]) -> int: ...


def reversed_union(value: object) -> object: ...


reveal_type(reversed_union([["a"], ["b", 1]]), expected_text="int")

annotated: Sequence[Sequence[str | int]] = [["a"], ["b", 1]]
reveal_type(overloaded(annotated), expected_text="int")

# This should still generate an error because neither overload accepts object.
reveal_type(overloaded([["a"], ["b", object()]]), expected_text="Unknown")
