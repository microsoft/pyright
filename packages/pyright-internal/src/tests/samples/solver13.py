# This sample tests that type variables chain properly.

from typing import Generic, Iterable, Iterator, TypeVar
from itertools import chain

T = TypeVar("T")


class ClassA(Iterator[T]):
    def __init__(self, it: Iterable[T]) -> None: ...

    def __next__(self) -> T: ...

    def __iter__(self) -> Iterator[T]: ...


def func1(val: Iterable[T]) -> Iterator[T]:
    return ClassA(val)


def func2(val: Iterable[Iterable[T]]) -> Iterator[T]:
    return chain(*val)


class ClassB(Generic[T]):
    def __init__(self, xs: Iterable[T]) -> None:
        self.xs = xs

    def indexed(self) -> "ClassB[tuple[int, T]]":
        return ClassB(enumerate(self.xs))
