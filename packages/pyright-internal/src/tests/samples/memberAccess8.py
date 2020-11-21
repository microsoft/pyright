# This sample tests the use of a generic property class.

from typing import Any, Generic, Literal, TypeVar


_T = TypeVar("_T")


class Column(Generic[_T]):
    def __get__(self, instance: object, type: Any) -> _T:
        ...

    def __set__(self, instance: object, value: _T) -> _T:
        ...

    def __delete__(self, instance: object) -> None:
        ...


class Foo:
    bar: Column[str] = Column()
    baz: Column[list[int]] = Column()


foo = Foo()

v1 = foo.bar
t1: Literal["str"] = reveal_type(v1)

foo.bar = ""
del foo.bar


v2 = foo.baz
t2: Literal["list[int]"] = reveal_type(v2)

foo.baz = [1]
del foo.baz
