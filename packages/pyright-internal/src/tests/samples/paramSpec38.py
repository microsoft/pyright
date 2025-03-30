# This sample tests that a **kwargs parameter captured by a ParamSpec
# is preserved.

from typing import Callable, Generic, ParamSpec, TypeVar


P = ParamSpec("P")
R = TypeVar("R")


class ClassA(Generic[P, R]):
    def __init__(self, callback: Callable[P, R]):
        self.callback = callback

    def method(self, *args: P.args, **kwargs: P.kwargs) -> R:
        return self.callback(*args, **kwargs)


def func1(obj: object, **kwargs: object) -> object: ...


reveal_type(
    ClassA(func1).method, expected_text="(obj: object, **kwargs: object) -> object"
)
