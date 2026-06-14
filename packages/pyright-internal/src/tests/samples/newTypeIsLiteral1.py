# This sample tests `is` comparisons involving NewType instances.

from types import NoneType
from typing import NewType, reveal_type

Apple = NewType("Apple", NoneType)
Banana = NewType("Banana", bool)
Cherry = NewType("Cherry", int)


def f(a: Apple, b: Banana, c: Cherry) -> None:
    if a is None:
        reveal_type(a, expected_text="Apple")

    if b is True:
        reveal_type(b, expected_text="Banana")

    if c is False:
        reveal_type(c, expected_text="Cherry")


f(Apple(None), Banana(True), Cherry(False))
