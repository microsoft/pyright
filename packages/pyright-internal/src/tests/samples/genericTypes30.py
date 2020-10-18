# This sample verifies that "Generic" is tagged as
# invalid in contexts outside of a class definition.

from typing import Generic, TypeVar


_T1 = TypeVar("_T1")


class Foo(Generic[_T1]):
    pass


# This should generate an error.
def func1(a: _T1) -> Generic[_T1]:
    ...


# This should generate an error.
def func2(p1: Generic[_T1]) -> _T1:
    ...


AAA = Generic

# This should generate an error.
def func3(a: _T1) -> AAA[_T1]:
    ...


class Foo2(AAA[_T1]):
    ...
