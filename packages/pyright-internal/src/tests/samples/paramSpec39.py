# This sample tests the case where a function that uses a ParamSpec
# is passed to itself. This should not cause a crash or infinite recursion
# within the type evaluator.

from typing import TypeVar, Callable
from typing_extensions import ParamSpec  # pyright: ignore[reportMissingModuleSource]

P = ParamSpec("P")
R = TypeVar("R")


def func1(x: Callable[P, R]) -> Callable[P, R]:
    return x


func1(func1)
