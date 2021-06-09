# This sample tests the handling of generic classes parameterized
# with a ParamSpec.

from typing import Callable, Generic, Literal, TypeVar
from typing_extensions import ParamSpec

P = ParamSpec("P")
T = TypeVar("T")


class Foo(Generic[P, T]):
    def __init__(self, func: Callable[P, T]) -> None:
        ...


def foo(foo: Foo[P, T], *args: P.args, **kwargs: P.kwargs) -> T:
    ...


def func(a: int) -> str:
    ...


a = Foo(func)
t_a: Literal["Foo[(a: int), str]"] = reveal_type(a)

c = foo(a, 2)
t_c: Literal["str"] = reveal_type(c)
