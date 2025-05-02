# This sample tests specialization of nested generic classes.

# pyright: strict


from typing import Collection, Generic, Iterable, Iterator, TypeVar

A = TypeVar("A")
T = TypeVar("T")


class ClassA(Collection[T]):
    def __init__(self, value: Iterable[T]) -> None:
        self.values = tuple(value)

    def __contains__(self, item: object) -> bool:
        return True

    def __iter__(self) -> Iterator[T]:
        return iter(self.values)

    def __len__(self) -> int:
        return len(self.values)


class ClassB(Generic[T]):
    pass


def func1(input: ClassA[ClassB[A]]) -> ClassB[ClassA[A]]:
    v = input.values
    result = func1(ClassA(v))

    return result
