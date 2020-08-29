# This sample tests the ability for a Callable generic
# to be assigned to a Type[_T] parameter.

from typing import Callable, cast

FUNC = Callable[[int], int]
def foo(i: int) -> int:
    return 42

bar = cast(FUNC, foo)

