# This sample tests that the assignment of an instantiable generic class
# without supplied type arguments is given default type arguments (typically
# Unknown) when the TypeVar is solved.

from typing import Any, TypeVar, reveal_type

T = TypeVar("T")


def deco1(t: type[T], val: Any) -> T:
    return val


v1 = deco1(dict, {"foo": "bar"})
reveal_type(v1, expected_text="dict[Unknown, Unknown]")


def deco2(t: T, val: Any) -> T:
    return val


v2 = deco2(dict, {"foo": "bar"})
reveal_type(v2, expected_text="type[dict[Unknown, Unknown]]")
