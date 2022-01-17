# This sample tests the case where a callable type within a function
# signature contains a generic return type within a union.

from typing import Optional, TypeVar
from collections.abc import Callable


T = TypeVar("T")
U = TypeVar("U")


def g(f: Callable[[T], Optional[U]], x: T) -> U:
    y = f(x)

    reveal_type(y, expected_text="U@g | None")

    if y is not None:
        reveal_type(y, expected_text="U@g")
        return y

    raise ValueError()


def h(x: T, f: Callable[[T], Optional[U]]) -> U:
    def g() -> U:
        y = f(x)
        if y is not None:
            return y

        raise ValueError()

    return g()
