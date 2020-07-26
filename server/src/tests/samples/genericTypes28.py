# This sample tests that Optional types can be matched
# to Type[T] expressions.

from typing import Optional, Type, TypeVar

_T1 = TypeVar("_T1")
_T2 = TypeVar("_T2", bound=None)

def foo1(a: Type[_T1]) -> _T1:
    return a()

a = foo1(Optional[int])

def foo2(a: Type[_T2]) -> _T2:
    return a()

b = foo2(type(None))

# This should generate an error because None is
# not a type; it's an instance of the NoneType class.
c = foo2(None)
