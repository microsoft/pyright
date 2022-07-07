# This sample tests that a **kwargs parameter captured by a ParamSpec
# is preserved.

from typing import Callable, Generic, ParamSpec, TypeVar


P = ParamSpec("P")
T = TypeVar("T")


class Foo(Generic[P, T]):
    def __init__(self, callback: Callable[P, T]):
        self.callback = callback

    def method(self, *args: P.args, **kwargs: P.kwargs) -> T:
        return self.callback(*args, **kwargs)


def func(obj: object, **kwargs: object) -> object:
    ...


reveal_type(Foo(func).method, expected_text="(obj: object, **kwargs: object) -> object")
