# This sample tests the handling of super() with no parameters
# and a base class with an annotated cls or self parameter that
# relies on the subclass being passed as a parameter.

from typing import Generic, TypeVar

_T1 = TypeVar("_T1")
_T2 = TypeVar("_T2", bound="Parent2")


class Parent1(Generic[_T1]):
    @classmethod
    def construct(cls: type[_T1]) -> _T1:
        return cls()


class Child1(Parent1["Child1"]):
    @classmethod
    def construct(cls) -> "Child1":
        return super().construct()


reveal_type(Child1.construct(), expected_text="Child1")


class Parent2:
    @classmethod
    def construct(cls: type[_T2]) -> _T2: ...


class Child2(Parent2):
    @classmethod
    def construct(cls: type[_T2]) -> _T2:
        return super().construct()


reveal_type(Child2.construct(), expected_text="Child2")
