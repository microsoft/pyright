# This sample tests `is` comparisons involving NewType instances.

from types import EllipsisType, NoneType
from typing import NewType, reveal_type

Apple = NewType("Apple", NoneType)
Banana = NewType("Banana", bool)
Cherry = NewType("Cherry", int)
Dragonfruit = NewType("Dragonfruit", EllipsisType)


def f(a: Apple, b: Banana, c: Cherry, d: Dragonfruit) -> None:
    if a is None:
        reveal_type(a, expected_text="Apple")

    if b is True:
        reveal_type(b, expected_text="Banana")

    if c is False:
        reveal_type(c, expected_text="Cherry")

    if d is ...:
        reveal_type(d, expected_text="Dragonfruit")


f(Apple(None), Banana(True), Cherry(False), Dragonfruit(...))
