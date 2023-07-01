# This sample tests the case where a callable type within a function
# signature contains a generic return type within a union.

from typing import TypeVar
from collections.abc import Callable


T = TypeVar("T")
U = TypeVar("U")


def func1(f: Callable[[T], U | None], x: T) -> U:
    y = f(x)

    reveal_type(y, expected_text="U@func1 | None")

    if y is not None:
        reveal_type(y, expected_text="U@func1")
        return y

    raise ValueError()


def func2(x: T, f: Callable[[T], U | None]) -> U:
    def g() -> U:
        y = f(x)
        if y is not None:
            return y

        raise ValueError()

    return g()
