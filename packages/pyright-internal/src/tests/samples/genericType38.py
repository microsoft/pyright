# This sample tests bidirectional type inference with nested constructors.

from typing import Generic, Iterable, Iterator, TypeVar, overload, Any
from itertools import chain

_T = TypeVar("_T")


class ClassA(Generic[_T]):
    @overload
    def __init__(self, _: _T): ...

    @overload
    def __init__(self, _: Any): ...

    def __init__(self, _: Any): ...


class ClassB(Generic[_T]):
    def __init__(self, _: ClassA[_T]): ...


v1 = ClassA(0)
v2 = ClassB(v1)
v3 = ClassB(ClassA(0))

reveal_type(v1, expected_text="ClassA[int]")
reveal_type(v2, expected_text="ClassB[int]")
reveal_type(v3, expected_text="ClassB[int]")


def func1(x: list[_T], /) -> list[_T]:
    return x


def func2(any: Any):
    v1 = list([any])
    v2 = func1(v1)
    v3 = func1(list([any]))

    reveal_type(v1, expected_text="list[Any]")
    reveal_type(v2, expected_text="list[Any]")
    reveal_type(v3, expected_text="list[Any]")


def func3(val1: Iterator[Iterable[int]]):
    val2 = list(chain.from_iterable(val1))
    reveal_type(val2, expected_text="list[int]")
