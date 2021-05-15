# This sample validates that parameter types specified for "self"
# and "cls" parameters are compatible with the containing class.

from typing import Iterator, Type, TypeVar


class Parent:
    pass


_T = TypeVar("_T")
_TChild1 = TypeVar("_TChild1", bound="Child1")


class Child1:
    def m1(self: "Child1"):
        ...

    # This should generate an error.
    def m2(self: Parent):
        ...

    # This should generate an error.
    def m3(self: Type["Child1"]):
        ...

    def m4(self: _TChild1) -> _TChild1:
        ...

    # This should generate an error.
    def m5(self: Type[_TChild1]) -> _TChild1:
        ...

    def m6(self: _T) -> _T:
        ...

    # This should generate an error.
    def __new__(cls: "Child1"):
        ...

    @classmethod
    def cm1(cls: Type["Child1"]):
        ...

    @classmethod
    # This should generate an error.
    def cm2(cls: "Child1"):
        ...

    @classmethod
    # This should generate an error.
    def cm3(cls: Type[Parent]):
        ...

    @classmethod
    def cm4(cls: Type[_TChild1]) -> _TChild1:
        ...

    @classmethod
    # This should generate an error.
    def cm5(cls: _TChild1) -> _TChild1:
        ...

    @classmethod
    def cm6(cls: Type[_T]) -> _T:
        ...


class MyMeta(type):
    def m1(self: Type[_T]) -> Iterator[_T]:
        ...
