# This sample tests the handling of nested protocols.

from typing import Protocol, TypeVar, overload

_T_co = TypeVar("_T_co", covariant=True)


class NestedSequence(Protocol[_T_co]):
    @overload
    def __getitem__(self, __i: int) -> _T_co | "NestedSequence[_T_co]": ...

    @overload
    def __getitem__(self, __s: slice) -> "NestedSequence[_T_co]": ...


def func(v1: list[list[list[int]]]):
    a: NestedSequence[int] = v1
    b: NestedSequence[int] = [[[3, 4]]]
