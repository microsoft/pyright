# This sample validates that *P.args and **P.kwargs can be used as a
# tuple and dict, respectively.

# pyright: strict

from collections.abc import Callable
from typing import Any
from typing_extensions import ParamSpec  # pyright: ignore[reportMissingModuleSource]

P = ParamSpec("P")


def func1(func: Callable[P, object], *args: P.args, **kwargs: P.kwargs) -> str:
    arg_reprs = [repr(arg) for arg in args]
    arg_reprs.extend(k + "=" + repr(v) for k, v in kwargs.items())

    return func.__name__ + "(" + ", ".join(arg_reprs) + ")"


def func2(*values: object, sep: str | None = ..., end: str | None = ...) -> None: ...


func1(func2)


def func3(a: int, b: int): ...


def func4(*args: Any, **kwargs: Any):
    func1(func3, *args, **kwargs)
