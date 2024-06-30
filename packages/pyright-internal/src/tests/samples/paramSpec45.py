# This sample tests the case where the same function that uses a ParamSpec
# is called multiple times as arguments to the same call.

from typing import Callable, ParamSpec

P = ParamSpec("P")


def func1(func: Callable[P, object], *args: P.args, **kwargs: P.kwargs) -> object: ...


def func2(x: str) -> int: ...


def func3(y: str) -> int: ...


print(func1(func2, x="..."), func1(func3, y="..."))


def func4(fn: Callable[P, int], *args: P.args, **kwargs: P.kwargs) -> int:
    return fn(*args, **kwargs)


def func5(x: int, y: int) -> int:
    return x + y


func5(func4(lambda x: x, 1), func4(lambda x, y: x + y, 2, 3))
