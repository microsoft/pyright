# This sample tests bidirectional type inference for | operators. This
# should apply only to TypedDict types.

from typing import TypeVar, Generic, Callable, Union

T1 = TypeVar("T1")
T2 = TypeVar("T2")


class S(Generic[T1]):
    def __or__(self, other: "S[T2]") -> "S[Union[T1, T2]]":
        ...


def to(x: Callable[..., T1]) -> "S[T1]":
    ...


x1 = to(int) | to(float)
