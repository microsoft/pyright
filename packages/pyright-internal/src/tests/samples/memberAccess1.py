# This sample validates that member access magic functions
# like __get__ and __set__ are handled correctly.

from contextlib import ExitStack
from typing import Any, ContextManager, Generic, Optional, Type, TypeVar, overload
from functools import cached_property

_T = TypeVar("_T")


class Column(Generic[_T]):
    @overload
    def __get__(self, instance: None, owner: Any) -> "Column[_T]":  # type: ignore
        ...

    @overload
    def __get__(self, instance: Any, owner: Any) -> _T:
        ...


class ClassA:
    bar = Column[str]()

    @classmethod
    def func1(cls):
        a: Column[str] = cls.bar


reveal_type(ClassA.bar, expected_text="Column[str]")
reveal_type(ClassA().bar, expected_text="str")


class ClassB:
    @cached_property
    def baz(self) -> int:
        return 3


c: cached_property[int] = ClassB.baz
d: int = ClassB().baz


class Factory:
    def __get__(self, obj: Any, cls: Type[_T]) -> _T:
        return cls()


class ClassC:
    instance: Factory


reveal_type(ClassC.instance, expected_text="ClassC")


class GenericDescriptor(Generic[_T]):
    value: _T

    def __get__(self, instance: Optional[object], cls: Type[object]) -> _T:
        ...

    def __set__(self, instance: object, value: _T) -> None:
        ...


class ClassD:
    abc: GenericDescriptor[str] = GenericDescriptor()
    stack: ExitStack

    def test(self, value: ContextManager[str]) -> None:
        self.abc = self.stack.enter_context(value)
