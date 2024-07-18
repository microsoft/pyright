# This sample tests calls to a generic class constructor from within the class.

from typing import Callable, Generic, TypeVar

T = TypeVar("T")
U = TypeVar("U")
W = TypeVar("W")


class ClassA(Generic[T]):
    def __init__(self, vals: list[U], func: Callable[[U], T]):
        self._vals = list(map(func, vals))

    def method1(self, func: Callable[[T], W]) -> "ClassA[W]":
        return ClassA(self._vals, func)


class ClassB(Generic[T]):
    def __init__(self, vals: list[U], func: Callable[[U], T]):
        self._vals = list(map(func, vals))

    def method1(self, func: Callable[[T], W]) -> "ClassB[W]":
        return func0(self, func)


def func0(c: ClassB[T], func: Callable[[T], W]) -> ClassB[W]:
    return ClassB(c._vals, func)


class ClassC(Generic[T, U]):
    def __init__(self):
        pass

    def test2(self) -> None:
        x1: ClassC[U, T]
        x1 = ClassC[U, T]()
