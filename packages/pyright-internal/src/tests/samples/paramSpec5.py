# This sample tests ParamSpec processing when the source
# callable type has keyword-only or positional-only
# parameter separators.

from typing import Callable, Literal, ParamSpec, TypeVar


P = ParamSpec("P")
R = TypeVar("R")


def decorator(fn: Callable[P, R]) -> Callable[P, R]:
    return fn


def foo(*, value: str) -> None:
    ...


bar = decorator(foo)
t1: Literal["(*, value: str) -> None"] = reveal_type(bar)


def baz(value: str, /) -> None:
    ...


qux = decorator(baz)
t2: Literal["(value: str, /) -> None"] = reveal_type(qux)
