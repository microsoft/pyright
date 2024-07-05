# This sample tests the assignment of invariant and contravariant
# type variables to other type variables.


from typing import Callable, Generic, TypeVar


T1 = TypeVar("T1")
T2 = TypeVar("T2")
T3 = TypeVar("T3")


class ClassA(Generic[T1]): ...


class ClassB(Generic[T2]):
    def broken(self, p0: ClassA[T2], p1: Callable[[T2], object]):
        func(p0, p1)


def func(
    p0: ClassA[T3],
    p1: Callable[[T3], object],
): ...
