# This sample tests the matching of nested callables that each use
# ParamSpec.

from typing import Callable, Generic, TypeVar

from typing_extensions import Concatenate, ParamSpec

P = ParamSpec("P")
Q = ParamSpec("Q")

T = TypeVar("T")
U = TypeVar("U")


class Foo(Generic[P, T, Q, U]):
    ...


def foo(func: Callable[Concatenate[Callable[P, T], Q], U]) -> Foo[P, T, Q, U]:
    ...


@foo
def bar(func: Callable[[int], float], a: str) -> bool:
    ...


reveal_type(bar, expected_text="Foo[(int), float, (a: str), bool]")
