# This sample tests a case where a default argument in a parent class
# needs to be specialized in the context of a child class.

from typing import Generic, Iterable, Iterator, TypeVar

T = TypeVar("T")


class IterableProxy(Iterable[T]):
    def __iter__(self) -> Iterator[T]: ...


class Parent(Generic[T]):
    def m1(self, v: Iterable[T] = IterableProxy()) -> None: ...


class Child(Parent[T]):
    def m2(self) -> None:
        self.m1()
