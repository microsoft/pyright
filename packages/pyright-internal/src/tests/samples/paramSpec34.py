# This sample tests the handling of nested functions that involve ParamSpecs.

import functools
from typing import Callable, TypeVar
from typing_extensions import ParamSpec  # pyright: ignore[reportMissingModuleSource]

P = ParamSpec("P")
R = TypeVar("R")


def deprecated(
    instead: str | None = None,
) -> Callable[[Callable[P, R]], Callable[P, R]]:
    def actual_decorator(func: Callable[P, R]) -> Callable[P, R]:
        @functools.wraps(func)
        def decorated(*args: P.args, **kwargs: P.kwargs) -> R:
            return func(*args, **kwargs)

        return decorated

    return actual_decorator
