# This sample validates that member access magic functions
# like __get__ and __set__ are handled correctly.

from contextlib import ExitStack
from typing import Any, ContextManager, Generic, TypeVar, overload
from functools import cached_property

_T = TypeVar("_T")


class DescriptorA(Generic[_T]):
    @overload
    def __get__(self, instance: None, owner: Any) -> "DescriptorA[_T]":  # type: ignore
        ...

    @overload
    def __get__(self, instance: Any, owner: Any) -> _T:
        ...


class ClassA:
    bar = DescriptorA[str]()

    @classmethod
    def func1(cls):
        a: DescriptorA[str] = cls.bar


reveal_type(ClassA.bar, expected_text="DescriptorA[str]")
reveal_type(ClassA().bar, expected_text="str")


class ClassB:
    @cached_property
    def baz(self) -> int:
        return 3


c: cached_property[int] = ClassB.baz
d: int = ClassB().baz


class Factory:
    def __get__(self, obj: Any, cls: type[_T]) -> _T:
        return cls()


class ClassC:
    instance: Factory


reveal_type(ClassC.instance, expected_text="ClassC")


class DescriptorD(Generic[_T]):
    value: _T

    def __get__(self, instance: object | None, cls: type[object]) -> _T:
        ...

    def __set__(self, instance: object, value: _T) -> None:
        ...


class ClassD:
    abc: DescriptorD[str] = DescriptorD()
    stack: ExitStack

    def test(self, value: ContextManager[str]) -> None:
        self.abc = self.stack.enter_context(value)


class DescriptorE:
    def __get__(self, instance: "ClassE | None", owner: "type[ClassE]"):
        return None


class MetaDescriptorE:
    def __get__(self, instance: "type[ClassE] | None", owner: "type[MetaclassE]"):
        return None


class MetaclassE(type):
    y = MetaDescriptorE()


class ClassE(metaclass=MetaclassE):
    x = DescriptorE()


ClassE.x
ClassE().x
ClassE.y
