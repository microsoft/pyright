# This sample tests variance inference for recursive type aliases whose
# type arguments grow or are permuted with each expansion.

from typing import Callable, Generic, TypeAlias, TypeVar

type GrowingList[T] = list[GrowingList[T | GrowingList[T]]]

type GrowingCallable[T] = Callable[
    [GrowingCallable[T]], GrowingCallable[T | GrowingCallable[T]]
]


def func1(x: GrowingList[int]): ...


def func2(x: GrowingCallable[int]): ...


T1 = TypeVar("T1")
T2 = TypeVar("T2")
T3 = TypeVar("T3")
T4 = TypeVar("T4")
T_co = TypeVar("T_co", covariant=True)

RotatingList: TypeAlias = tuple[list[T1], T2, T3, T4, "RotatingList[T2, T3, T4, T1] | None"]

RotatingCallable: TypeAlias = tuple[
    Callable[[T1], None], T2, T3, T4, "RotatingCallable[T2, T3, T4, T1] | None"
]

RotatingTuple: TypeAlias = tuple[T1, T2, T3, T4, "RotatingTuple[T2, T3, T4, T1] | None"]


# This should generate an error because the variance is incompatible.
class ClassA(RotatingList[int, int, int, T_co], Generic[T_co]): ...


# This should generate an error because the variance is incompatible.
class ClassB(RotatingCallable[int, int, int, T_co], Generic[T_co]): ...


class ClassC(RotatingList[int, int, int, T1], Generic[T1]): ...


class ClassD(RotatingTuple[int, int, int, T_co], Generic[T_co]): ...
