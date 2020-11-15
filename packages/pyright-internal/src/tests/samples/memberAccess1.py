# This sample validates that member access magic functions
# like __get__ and __set__ are handled correctly.

from typing import Any, Generic, TypeVar, overload
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


a: Column[str] = Foo.bar
b: str = Foo().bar


class Foo2:
    @cached_property
    def baz(self) -> int:
        return 3


c: cached_property[int] = Foo2.baz
d: int = Foo2().baz
