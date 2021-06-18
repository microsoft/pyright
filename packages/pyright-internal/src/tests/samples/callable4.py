# This sample tests the case where a callable type within a function
# signature contains a generic return type within a union.

from typing import Literal, Optional, TypeVar
from collections.abc import Callable


T = TypeVar("T")
U = TypeVar("U")


def g(f: Callable[[T], Optional[U]], x: T) -> U:
    y = f(x)

    t_y1: Literal["U@g | None"] = reveal_type(y)

    if y is not None:
        t_y2: Literal["U@g"] = reveal_type(y)
        return y

    raise ValueError()
