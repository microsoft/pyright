# This sample tests the case where a higher-order function accepts
# a callable parameterized by a ParamSpec and a generic function
# is passed to it.

from typing import Callable, TypeVar, ParamSpec


P = ParamSpec("P")
S = TypeVar("S")
T = TypeVar("T")


def deco1(func: Callable[P, T], *args: P.args, **kwargs: P.kwargs) -> T: ...


def func1(val1: T, val2: S, val3: S) -> T: ...


reveal_type(deco1(func1, val1=1, val2=3, val3="s"), expected_text="int")
reveal_type(deco1(func1, 1, 3, "s"), expected_text="int")


def func2(val1: T, val2: S) -> T | list[S]: ...


reveal_type(deco1(func2, val1=1, val2="s"), expected_text="int | list[str]")
reveal_type(deco1(func2, 1, "s"), expected_text="int | list[str]")
