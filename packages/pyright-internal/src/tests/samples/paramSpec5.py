# This sample tests ParamSpec processing when the source
# callable type has keyword-only or positional-only
# parameter separators.

from typing import Callable, ParamSpec, TypeVar


P = ParamSpec("P")
R = TypeVar("R")


def decorator(fn: Callable[P, R]) -> Callable[P, R]:
    return fn


def foo(*, value: str) -> None:
    ...


bar = decorator(foo)
reveal_type(bar, expected_text="(*, value: str) -> None")


def baz(value: str, /) -> None:
    ...


qux = decorator(baz)
reveal_type(qux, expected_text="(value: str, /) -> None")
