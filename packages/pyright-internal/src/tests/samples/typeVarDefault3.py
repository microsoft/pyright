# This sample tests error handling for PEP 696. TypeVars without default
# types cannot be after TypeVars with default types.

from typing import Generic
from typing_extensions import TypeVar


T0 = TypeVar("T0", default=object)
T1 = TypeVar("T1")
T2 = TypeVar("T2", default=str)


# This should generate an error because T1 is after T2.
class ClassA(Generic[T2, T1]):
    ...


# This should generate an error because T1 is after T2.
class ClassB(dict[T2, T1]):
    ...


class ClassC(dict[T2, T1], Generic[T1, T2]):
    ...


# This should generate an error because T1 is after T2.
def funcA(a: T2, b: T1) -> T1 | T2:
    ...


# This should generate an error because T1 is after T2.
TA_A = dict[T2, T1]


class ClassD(Generic[T0]):
    def method1(self, a: T0, b: T1, /) -> T0 | T1:
        ...
