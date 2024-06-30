# This sample tests the handling of function assignments that involve
# ParamSpecs.

from typing import overload, ParamSpec, TypeVar, Callable

P = ParamSpec("P")
R = TypeVar("R")


@overload
def func1(f: Callable[P, R]) -> Callable[P, R]: ...


@overload
def func1() -> Callable[[Callable[P, R]], Callable[P, R]]: ...


def func1(
    f: Callable[P, R] | None = None,
) -> Callable[P, R] | Callable[[Callable[P, R]], Callable[P, R]]: ...
