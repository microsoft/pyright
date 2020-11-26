# This sample tests that type variables chain properly.

from typing import Generic, Iterable, Iterator, Tuple, TypeVar
from itertools import chain

T = TypeVar("T")


class ClassA(Iterator[T]):
    def __init__(self, it: Iterable[T]) -> None:
        ...

    def __next__(self) -> T:
        ...

    def __iter__(self) -> Iterator[T]:
        ...


def bar(it: Iterable[T]) -> Iterator[T]:
    return ClassA(it)


def baz(it_of_its: Iterable[Iterable[T]]) -> Iterator[T]:
    return chain(*it_of_its)


class ClassB(Generic[T]):
    def __init__(self, xs: Iterable[T]) -> None:
        self.xs = xs

    def indexed(self) -> "ClassB[Tuple[int, T]]":
        return ClassB(enumerate(self.xs))
