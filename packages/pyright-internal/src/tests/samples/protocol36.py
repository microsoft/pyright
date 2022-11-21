# This sample tests the handling of nested protocols.

from typing import Protocol, TypeVar, overload

_T_co = TypeVar("_T_co", covariant=True)

class _NestedSequence(Protocol[_T_co]):
    @overload
    def __getitem__(self, __i: int) -> _T_co | "_NestedSequence[_T_co]":
        ...
    @overload
    def __getitem__(self, __s: slice) -> "_NestedSequence[_T_co]":
        ...


def func(v1: list[list[list[int]]]):
    a: _NestedSequence[int] = v1
    b: _NestedSequence[int] = [[[3, 4]]]
