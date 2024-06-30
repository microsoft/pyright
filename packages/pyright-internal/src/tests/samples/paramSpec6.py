# This sample tests that ParamSpecs support parameters with default values.

from typing import Callable, ParamSpec, TypeVar

P = ParamSpec("P")
R = TypeVar("R")


def func1(fn: Callable[P, R]) -> Callable[P, R]: ...


def func2(a: str, b: str = "") -> str: ...


func1(func2)("")
