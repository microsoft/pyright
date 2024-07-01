# This sample tests a case where a __new__ method in a generic class
# returns an instance of the class but with different type arguments
# than expected. This is arguably an error case, but pyright needs
# to handle it gracefully.

from __future__ import annotations
from typing import Generic, TypeVar


T = TypeVar("T", contravariant=True)
S = TypeVar("S", contravariant=True)


class ClassA(Generic[T]): ...


class ClassB(Generic[S, T], ClassA[T]): ...


class ClassC(ClassB[S, T]):
    def __new__(cls, subcon: ClassA[S]) -> ClassC[S, list[S]]: ...


class ClassD(ClassB[S, T]):
    def __new__(cls, subcon: ClassA[S]) -> ClassD[S, list[S]]: ...


c = ClassA[int]()

intermediate = ClassC(c)
v1 = ClassD(intermediate)
reveal_type(v1, expected_text="ClassD[list[int], list[list[int]]]")

v2 = ClassD(ClassC(c))
reveal_type(v2, expected_text="ClassD[list[int], list[list[int]]]")
