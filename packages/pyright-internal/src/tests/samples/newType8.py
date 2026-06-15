# This sample tests narrowing of NewType instances using the "is" operator
# against None and bool literals. At runtime, a NewType instance is simply
# an instance of its base type, so these comparisons can succeed and the
# narrowed branches are reachable.

# pyright: reportUnreachable=true

from types import NoneType
from typing import NewType

Apple = NewType("Apple", NoneType)
Banana = NewType("Banana", bool)
Cherry = NewType("Cherry", int)

# A NewType whose base is itself a NewType (recursive base).
Date = NewType("Date", Apple)


def f(a: Apple, b: Banana, c: Cherry, d: Date) -> None:
    if a is None:
        reveal_type(a, expected_text="None")

    if b is True:
        reveal_type(b, expected_text="Literal[True]")

    if c is False:
        reveal_type(c, expected_text="Literal[False]")

    if d is None:
        reveal_type(d, expected_text="None")


def g(c: Cherry) -> None:
    # A NewType based on int cannot overlap with None, so this branch
    # remains unreachable.
    if c is None:
        # This should generate an error because the code is unreachable.
        reveal_type(c)
