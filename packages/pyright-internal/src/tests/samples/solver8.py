# This sample tests the constraint solver's special-case handling of
# Optional[T] within a function.

from typing import Optional, TypeVar

_T = TypeVar("_T")


def func1(v: Optional[_T]) -> _T:
    if v is None:
        raise ValueError
    return v


def func2(v: _T) -> _T:
    if v is None:
        raise ValueError
    return v


f: Optional[int] = None

a: int = func1(f)

# This should generate an error because type var _T
# should be matched to "Optional[int]".
b: int = func2(f)
