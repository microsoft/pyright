# This sample tests the handling of a __new__ method that
# is part of a generic class but uses its own type parameters.


from typing import Iterable, Iterator, TypeVar


_T_co = TypeVar("_T_co", covariant=True)
_T = TypeVar("_T")


class pairwise(Iterator[_T_co]):
    def __new__(cls, __iterable: Iterable[_T]) -> "pairwise[tuple[_T, _T]]":
        ...


def triplewise(iterable: Iterable[_T]) -> Iterator[tuple[_T, _T, _T]]:
    for (a, _), (b, c) in pairwise(pairwise(iterable)):
        yield a, b, c
