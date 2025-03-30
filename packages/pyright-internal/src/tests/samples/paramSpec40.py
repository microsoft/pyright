# This sample tests the interaction between a generic callable parameterized
# with a ParamSpec and another generic callable that is parameterized
# with a TypeVar.

from typing import Callable, ParamSpec, TypeVar, TypedDict, Unpack

_P = ParamSpec("_P")
_R = TypeVar("_R")


def call(obj: Callable[_P, _R], *args: _P.args, **kwargs: _P.kwargs) -> _R:
    return obj(*args, **kwargs)


def func1():
    return 0


def func2():
    return 0.0


result1 = map(call, [func1])
reveal_type(result1, expected_text="map[int]")

result2 = map(call, [func1, func2])
reveal_type(result2, expected_text="map[float]")


class TD1(TypedDict, total=False):
    e: str
    f: str


def func3(
    a: int, b: int, /, *, c: str = ..., d: str = ..., **kwargs: Unpack[TD1]
) -> float: ...


call(func3, 1, 2, e="", c="")
call(func3, 1, 2, c="", d="", e="")
call(func3, 1, 2, e="")
