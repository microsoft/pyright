# This sample tests that union type compatibility does not depend on
# the order of the elements in the union.

from __future__ import annotations

from typing import MutableSequence, Protocol, SupportsIndex, TypeVar, overload

T_co = TypeVar("T_co", covariant=True)
_T = TypeVar("_T")


class MyList(MutableSequence[_T]):
    @overload
    def __getitem__(self, __i: SupportsIndex) -> _T:  # type: ignore
        ...

    @overload
    def __getitem__(self, __s: slice) -> MyList[_T]:
        ...


class NestedSequence(Protocol[T_co]):
    @overload
    def __getitem__(self, index: int, /) -> T_co | NestedSequence[T_co]:
        ...

    @overload
    def __getitem__(self, index: slice, /) -> NestedSequence[T_co]:
        ...


def func1(b: MyList[int | MyList[int]]):
    _: NestedSequence[int] = b


def func2(c: MyList[MyList[int] | int]):
    _: NestedSequence[int] = c
