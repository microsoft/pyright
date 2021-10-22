# This sample tests the handling of binary operators when used with
# generic types.

from typing import Literal, TypeVar

_TInt = TypeVar("_TInt", bound=int)


def func1(n: _TInt) -> _TInt:
    x = n + 1
    t_x: Literal["int"] = reveal_type(x)

    # This should generate an error.
    return x


_TIntOrStr = TypeVar("_TIntOrStr", int, str)


def func2(n: _TIntOrStr) -> _TIntOrStr:
    x = n + n
    t_x: Literal["int* | str*"] = reveal_type(x)

    return x
