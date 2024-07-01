# This sample tests the case where the constraint solver can choose one
# of several types that satisfy the constraints.

from typing import TypeVar

T = TypeVar("T")


def to_list(t: list[T] | T) -> list[T]: ...


x = to_list([1, 2, 3])
reveal_type(x, expected_text="list[int]")
