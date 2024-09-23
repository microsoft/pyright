# This sample validates that Never is treated as a bottom type for
# covariant type arguments.

from typing import Generic, Never, TypeVar

U = TypeVar("U")

T_co = TypeVar("T_co", covariant=True)
T_contra = TypeVar("T_contra", contravariant=True)
T = TypeVar("T")


class ClassA(Generic[T_co]):
    pass


def func1(x: U) -> ClassA[U]:
    return ClassA[Never]()


class ClassB(Generic[T]):
    pass


def func2(x: U) -> ClassB[U]:
    # This should generate an error because T is invariant.
    return ClassB[Never]()


class ClassC(Generic[T_contra]):
    def __init__(self, x: T_contra): ...


def func3(x: U) -> U | ClassC[Never]:
    return ClassC(x)
