# This sample tests the simple aliasing of a generic class with no
# type arguments.

from typing import Generic, Literal, TypeVar


_T = TypeVar("_T")


class ClassA(Generic[_T]):
    def __init__(self, x: _T):
        pass


A = ClassA
t1: Literal["ClassA[int]"] = reveal_type(A(3))
