# This sample tests the scoping rules for assignment expressions
# within a list comprehension.

# pyright: strict

from typing import Tuple


def func1() -> Tuple[str, int]:
    a = 3
    y = 4
    _ = [(a := x) for x in ["1", "2"] for _ in ["1", "2"]]

    # The type of "y" should be int because the "y" within
    # the list comprehension doesn't leak outside. On the
    # other hand, "a" does leak outside the list comprehension.
    return (a, y)


def get_value(x: int) -> int: ...


x = sum(max(value for x in range(10) if (value := get_value(x))) for _ in range(10))
