# This sample tests the case where the tuple constructor is called
# explicitly with bidirectional type inference.

from typing import Any, Iterable

# This should generate an error.
v1: tuple[float] = tuple([1.0, 2.0])

# This should generate an error.
v2: tuple[float] | tuple[float, float] = tuple([1.0, 2.0])

v3: tuple[float, ...] = tuple([1, 2])


def f(x: Iterable[Any], y: Iterable):
    a: tuple[int, int] = tuple(x)
    b: tuple[int, int] = tuple(y)
