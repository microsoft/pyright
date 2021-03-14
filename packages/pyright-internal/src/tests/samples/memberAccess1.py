# This sample validates that member access magic functions
# like __get__ and __set__ are handled correctly.

from typing import Any, Generic, Literal, Type, TypeVar, overload
from functools import cached_property

_T = TypeVar("_T")


class Column(Generic[_T]):
    @overload
    def __get__(self, instance: None, owner: Any) -> "Column[_T]":  # type: ignore
        ...

    @overload
    def __get__(self, instance: Any, owner: Any) -> _T:
        ...


class Foo:
    bar = Column[str]()

    @classmethod
    def func1(cls):
        a: Column[str] = cls.bar


t1: Literal["Column[str]"] = reveal_type(Foo.bar)
t2: Literal["str"] = reveal_type(Foo().bar)


class Foo2:
    @cached_property
    def baz(self) -> int:
        return 3


c: cached_property[int] = Foo2.baz
d: int = Foo2().baz


class Factory:
    def __get__(self, obj: Any, cls: Type[_T]) -> _T:
        return cls()


class SomeClass:
    instance: Factory


t3: Literal["SomeClass"] = reveal_type(SomeClass.instance)
