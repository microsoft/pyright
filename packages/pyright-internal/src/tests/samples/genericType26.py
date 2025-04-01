# This sample tests for the case where a generic callable type is
# specialized with type variables in a recursive manner.

from dataclasses import dataclass
from typing import Callable, Generic, Iterable, Iterator, TypeVar, overload

S = TypeVar("S")
T = TypeVar("T")
U = TypeVar("U")
V = TypeVar("V")


class ClassA(Generic[T, U]):
    x: Callable[[T], U]

    def __init__(self, f: Callable[[T], U]):
        self.x = f

    def __call__(self, x: T) -> U:
        return self.x(x)

    def __add__(self, other: "ClassA[U, V]") -> "ClassA[T, V]":
        f = self.x
        g: Callable[[U], V] = other.x
        return ClassA(lambda x: g(f(x)))


class ClassB(Generic[T]):
    value: T

    def __init__(self, val: T) -> None:
        self.value = val

    def method1(self, val: U) -> "ClassB[U]":
        # This should generate an error.
        return ClassB(self.value)


@dataclass
class DC1(Generic[T]):
    value: T


@dataclass
class DC2(Generic[S]):
    value: S


@dataclass
class ClassC(Generic[T, S]):
    value: DC1[T] | DC2[S]

    def method1(self, val: U) -> "ClassC[U, S]":
        if isinstance(self.value, DC1):
            # This should generate an error.
            return ClassC(self.value)
        else:
            return ClassC(self.value)


T_co = TypeVar("T_co", covariant=True)


class ClassD(Generic[T_co]):
    @overload
    def __init__(self, arg: Iterable[T_co]) -> None: ...

    @overload
    def __init__(self, arg: Callable[[], Iterable[T_co]]) -> None: ...

    def __init__(self, arg: Iterable[T_co] | Callable[[], Iterable[T_co]]) -> None: ...

    def __iter__(self) -> Iterator[T_co]: ...


class ClassE(ClassD[T_co]):
    def method(self) -> "ClassE[ClassE[T_co]]":
        def inner():
            for x in self:
                yield ClassE(lambda: [x])

        return ClassE(inner)
