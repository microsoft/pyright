# This sample tests protocol class assignment in a case that involves tricky
# recursion.

from typing import Protocol, Sequence, TypeVar, overload

_T_co = TypeVar("_T_co", covariant=True)


class SupportsIndex(Protocol):
    def __index__(self) -> int: ...


class TupleLike(Sequence[_T_co]):
    @overload
    def __getitem__(self, index: SupportsIndex) -> _T_co: ...

    @overload
    def __getitem__(self, index: slice) -> "TupleLike[_T_co]": ...

    def __getitem__(
        self, index: slice | SupportsIndex
    ) -> "_T_co | TupleLike[_T_co]": ...


class NestedSequence(Protocol[_T_co]):
    @overload
    def __getitem__(self, index: int, /) -> "_T_co | NestedSequence[_T_co]": ...

    @overload
    def __getitem__(self, index: slice, /) -> "NestedSequence[_T_co]": ...


def func(t: TupleLike[int]):
    x: int | NestedSequence[int] = t
    y: NestedSequence[int] = t
