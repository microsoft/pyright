# This sample tests specialization of nested generic classes.

# pyright: strict


from typing import Collection, Generic, Iterable, TypeVar

A = TypeVar("A")
T = TypeVar("T")


class ClassA(Collection[T]):
    def __init__(self, value: Iterable[T]) -> None:
        self.values = tuple(value)


class ClassB(Generic[T]):
    pass


def func1(input: ClassA[ClassB[A]]) -> ClassB[ClassA[A]]:
    v = input.values
    result = func1(ClassA(v))

    return result
