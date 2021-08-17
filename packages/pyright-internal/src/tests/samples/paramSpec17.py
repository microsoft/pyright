# This sample validates that *P.args and **P.kwargs can be used as a
# tuple and dict, respectively.

# pyright: strict

from collections.abc import Callable
from typing import Any
from typing_extensions import ParamSpec

P = ParamSpec("P")


def repr_func_call(func: Callable[P, object], *args: P.args, **kwargs: P.kwargs) -> str:
    arg_reprs = [repr(arg) for arg in args]
    arg_reprs.extend(k + "=" + repr(v) for k, v in kwargs.items())

    return func.__name__ + "(" + ", ".join(arg_reprs) + ")"


repr_func_call(print)


def add_values(a: int, b: int):
    ...


def foo(*args: Any, **kwargs: Any):
    repr_func_call(add_values, *args, **kwargs)
