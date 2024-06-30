# This sample tests ParamSpec processing when the source
# callable type has keyword-only or positional-only
# parameter separators.

from typing import Callable, ParamSpec, TypeVar


P = ParamSpec("P")
R = TypeVar("R")


def decorator(fn: Callable[P, R]) -> Callable[P, R]:
    return fn


def func1(*, value: str) -> None: ...


f1 = decorator(func1)
reveal_type(f1, expected_text="(*, value: str) -> None")


def func2(value: str, /) -> None: ...


f2 = decorator(func2)
reveal_type(f2, expected_text="(value: str, /) -> None")
