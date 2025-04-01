# This sample tests the case where a generic function
# returns a generic Callable.

from typing import Callable, TypeVar


_T = TypeVar("_T")


def func1(val1: _T) -> Callable[[_T], None]:
    def f(a: str): ...

    # This should generate an error because str isn't
    # compatible with _T.
    return f


def func2(val1: _T) -> Callable[[_T], None]:
    def f(a: _T): ...

    return f
