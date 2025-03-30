# This sample tests member access "set" operations when the target
# member is an object that doesn't provide a __set__ method.

# pyright: strict

from typing import Any, Generic, TypeVar, overload


_T = TypeVar("_T")


class ParentA:
    pass


class Column(Generic[_T]):
    def __init__(self, type: type[_T]) -> None: ...

    @overload
    def __get__(self: "Column[_T]", instance: None, type: Any) -> "Column[_T]": ...

    @overload
    def __get__(self: "Column[_T]", instance: ParentA, type: Any) -> _T: ...

    def __get__(
        self, instance: ParentA | None, type: Any
    ) -> _T | None | "Column[_T]": ...


class ChildA(ParentA):
    attr1: Column[str] = Column(str)
    attr2 = Column(str)


ChildA.attr1
ChildA().attr1
ChildA.attr2
ChildA().attr2

foo = ChildA()

# This should generate an error because bar is declared as containing a
# Column[str], which doesn't provide a __set__ method.
foo.attr1 = ""

# This should generate an error because baz's inferred type is
# Column[str], which doesn't provide a __set__ method.
foo.attr2 = ""
