# This sample tests the case where the constraint solver can choose one
# of several types that satisfy the constraints.

from typing import Literal, TypeVar, Union

T = TypeVar("T")


def to_list(t: Union[list[T], T]) -> list[T]:
    ...


x = to_list([1, 2, 3])
t1: Literal["list[int]"] = reveal_type(x)
