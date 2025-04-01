# This sample tests the handling of a __new__ method that
# is part of a generic class but uses its own type parameters.


from typing import Generic, Iterable, Iterator, TypeVar


_T_co = TypeVar("_T_co", covariant=True)
_T = TypeVar("_T")


class A(Iterator[_T_co]):
    def __new__(cls, __iterable: Iterable[_T]) -> "A[tuple[_T, _T]]": ...

    def __next__(self) -> _T_co: ...


def func1(iterable: Iterable[_T]) -> Iterator[tuple[_T, _T, _T]]:
    for (a, _), (b, c) in A(A(iterable)):
        yield a, b, c


class B(Generic[_T_co]):
    def __new__(cls, __iter1: Iterable[_T]) -> "B[_T]": ...


def func2(p1: list[dict]):
    v1 = B(p1)
    reveal_type(v1, expected_text="B[dict[Unknown, Unknown]]")
