# This sample tests the special-case handling of Optional[T] within
# a function.

from typing import Optional, TypeVar

_T = TypeVar("_T")


def foo1(v: Optional[_T]) -> _T:
    if v is None:
        raise ValueError
    return v

def foo2(v: _T) -> _T:
    if v is None:
        raise ValueError
    return v


f: Optional[int]

# This should not generate an error because type var _T
# should be matched to "int" rather than "Optional[int]".
a: int = foo1(f)

# This should generate an error because type var _T
# should be matched to "Optional[int]".
b: int = foo2(f)
