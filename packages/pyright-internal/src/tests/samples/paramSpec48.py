# This sample tests the case where a function with a ParamSpec is called
# with *args and **kwargs that are defined as Any.

from typing import Any, Callable, Concatenate, ParamSpec


P = ParamSpec("P")


def func3(f: Callable[Concatenate[int, P], int], *args: Any, **kwargs: Any) -> int:
    return f(*args, **kwargs)


def func4(f: Callable[Concatenate[int, ...], int], *args: Any, **kwargs: Any) -> int:
    return f(*args, **kwargs)
