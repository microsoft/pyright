# This sample tests the case where a function that uses a ParamSpec
# is passed to itself. This should not cause a crash or infinite recursion
# within the type evaluator.

from typing import TypeVar, Callable
from typing_extensions import ParamSpec

P = ParamSpec("P")
T = TypeVar("T")


def test(x: Callable[P, T]) -> Callable[P, T]:
    return x


test(test)
