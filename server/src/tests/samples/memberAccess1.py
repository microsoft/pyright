# This sample validates that member access magic functions
# like __get__ and __set__ are handled correctly.


from typing import Any, Generic, TypeVar, overload

_T = TypeVar('_T')

class Column(Generic[_T]):
    @overload
    def __get__(self, instance: None, owner: Any) -> 'Column[_T]': ...
    @overload
    def __get__(self, instance: object, owner: Any) -> _T: ...

class Foo:
    bar = Column[str]()


a: Column[str] = Foo.bar
b: str = Foo().bar




