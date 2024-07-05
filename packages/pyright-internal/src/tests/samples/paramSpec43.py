# This sample tests the case where a generic class has a function-local
# ParamSpec in its constructor.

from typing import TypeVar, Callable, ParamSpec, Protocol

P = ParamSpec("P")
R = TypeVar("R")


class Decorator(Protocol):
    def __call__(self, __x: Callable[P, R]) -> Callable[P, R]: ...


def func1(deco: Decorator):
    deco(lambda: None)()
    deco(lambda x: x)(1)
    deco(lambda x, y: x)(1, "")
