# This sample tests the handling of binary operators when used with
# generic types.

from typing import TypeVar

_TInt = TypeVar("_TInt", bound=int)


def func1(n: _TInt) -> _TInt:
    x = n + 1
    reveal_type(x, expected_text="int")

    # This should generate an error.
    return x


_TIntOrStr = TypeVar("_TIntOrStr", int, str)


def func2(n: _TIntOrStr) -> _TIntOrStr:
    x = n + n
    reveal_type(x, expected_text="int* | str*")

    return x
