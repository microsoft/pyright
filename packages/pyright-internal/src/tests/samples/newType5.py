# This sample tests the case where an Any type is passed as the second
# argument to NewType.

from typing import Any, NewType

# This should generate an error.
A = NewType("A", Any)


def func(x: A) -> A:
    x()
    x(1, 2, 3)

    y: list[int] = [x, x()]

    return x
