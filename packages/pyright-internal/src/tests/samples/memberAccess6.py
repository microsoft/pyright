# This sample tests member access "set" operations when the target
# member is an object that doesn't provide a __set__ method.

# pyright: strict

from typing import Any, Generic, Optional, Type, TypeVar, overload


_T = TypeVar("_T")


class FooBase:
    pass


class Column(Generic[_T]):
    def __init__(self: "Column[_T]", type: Type[_T]) -> None:
        ...

    @overload
    def __get__(self: "Column[_T]", instance: None, type: Any) -> "Column[_T]":
        ...

    @overload
    def __get__(self: "Column[_T]", instance: FooBase, type: Any) -> _T:
        ...

    def __get__(self, instance: Optional[FooBase], type: Any) -> Optional[_T]:
        ...


class Foo(FooBase):
    bar: Column[str] = Column(str)
    baz = Column(str)


Foo.bar
Foo().bar
Foo.baz
Foo().baz

foo = Foo()

# This should generate an error because bar is declared as containing a
# Column[str], which doesn't provide a __set__ method.
foo.bar = ""

# This should generate an error because baz's inferred type is
# Column[str], which doesn't provide a __set__ method.
foo.baz = ""
