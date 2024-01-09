# This sample tests the case where the constraint solver's solution involves
# a union of type variables.

from os import PathLike
from typing import AnyStr, Generic, Iterable, Iterator, Protocol, TypeAlias, TypeVar

V = TypeVar("V")
V_co = TypeVar("V_co", covariant=True)
U = TypeVar("U")


class ClassA(Generic[V_co]):
    pass


class ClassB(Generic[V_co]):
    def __init__(self, x: ClassA[V_co]):
        pass


def func1(a: ClassA[V], b: ClassA[U], c: bool) -> ClassB[V | U]:
    x: ClassA[V | U] = a
    reveal_type(x, expected_text="ClassA[V@func1]")
    if c:
        x = b
        reveal_type(x, expected_text="ClassA[U@func1]")
    r = ClassB(x)

    reveal_type(r, expected_text="ClassB[U@func1 | V@func1]")
    return r


class ClassC(Generic[AnyStr]):
    ...


class ClassD(Iterator[ClassC[AnyStr]], Protocol):
    ...


GenericPath: TypeAlias = AnyStr | PathLike[AnyStr]


def func2(iter: Iterable[object]) -> bool:
    ...


def func3(path: GenericPath[AnyStr]) -> ClassD[AnyStr]:
    ...


def func4(val: str):
    func2(func3(val))
