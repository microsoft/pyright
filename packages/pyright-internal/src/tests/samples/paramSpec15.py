# This sample tests the handling of generic classes parameterized
# with a ParamSpec.

from typing import Callable, Generic, TypeVar
from typing_extensions import ParamSpec  # pyright: ignore[reportMissingModuleSource]

P = ParamSpec("P")
T = TypeVar("T")


class Foo(Generic[P, T]):
    def __init__(self, func: Callable[P, T]) -> None: ...


def foo(foo: Foo[P, T], *args: P.args, **kwargs: P.kwargs) -> T: ...


def func(a: int) -> str: ...


a = Foo(func)
reveal_type(a, expected_text="Foo[(a: int), str]")

c = foo(a, 2)
reveal_type(c, expected_text="str")
