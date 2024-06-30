# This sample tests the case where a generic class is parameterized
# by a ParamSpec, and this ParamSpec is used in a method with
# *args and **kwargs parameters. In cases where the ParamSpec captures
# a generic function, the TypeVars for this generic function should
# still be solvable.

from typing import Callable, Generic, ParamSpec, TypeVar


S = TypeVar("S")
T = TypeVar("T")

P = ParamSpec("P")
R = TypeVar("R")


def func1(a: S, b: T) -> dict[S, T]: ...


class DecoratorClass1(Generic[P, R]):
    def __init__(self, func: Callable[P, R]):
        self._func = func

    def __call__(self, *args: P.args, **kwargs: P.kwargs) -> R:
        return self._func(*args, **kwargs)

    def other(self, val: int, *args: P.args, **kwargs: P.kwargs) -> R: ...


decorated_func1 = DecoratorClass1(func1)

reveal_type(
    decorated_func1,
    expected_text="DecoratorClass1[(a: S@func1, b: T@func1), dict[S@func1, T@func1]]",
)

func1_ret = decorated_func1(1, "")
reveal_type(func1_ret, expected_text="dict[int, str]")


func1_other_ret = decorated_func1.other(0, 1, "")
reveal_type(func1_other_ret, expected_text="dict[int, str]")


def func2(func: Callable[P, R]) -> Callable[P, R]: ...


d1 = func2(func1)
d2 = func2(d1)
d3 = d2(1, "")
reveal_type(d3, expected_text="dict[int, str]")
