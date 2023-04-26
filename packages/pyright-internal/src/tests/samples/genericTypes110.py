# This sample tests bidirectional type inference for cases that involve
# constructors and dict inference.

from typing import TypeVar

T = TypeVar("T")


def func1(some_dict: dict[str, set[T] | frozenset[T]]) -> list[T]:
    return []


v1 = func1({"foo": set({1, 2, 3})})
reveal_type(v1, expected_text="list[int]")

v2 = func1({"foo": frozenset({1, 2, 3})})
reveal_type(v2, expected_text="list[int]")
