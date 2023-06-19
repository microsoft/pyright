# This sample validates that Never is treated as a bottom type for
# covariant type arguments.

from typing import Generic, Never, TypeVar

U = TypeVar("U")

T_co = TypeVar("T_co", covariant=True)


class ClassA(Generic[T_co]):
    pass


def func1(x: U) -> ClassA[U]:
    return ClassA[Never]()


T = TypeVar("T")


class ClassB(Generic[T]):
    pass


def func2(x: U) -> ClassB[U]:
    # This should generate an error because T is invariant.
    return ClassB[Never]()
