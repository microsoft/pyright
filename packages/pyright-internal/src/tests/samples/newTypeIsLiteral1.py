# This sample tests `is` comparisons involving NewType instances.

from types import EllipsisType, NoneType
from typing import NewType, reveal_type

Apple = NewType("Apple", NoneType)
Apricot = NewType("Apricot", Apple)
Banana = NewType("Banana", bool)
Plantain = NewType("Plantain", Banana)
Cherry = NewType("Cherry", int)
Dragonfruit = NewType("Dragonfruit", EllipsisType)
Elderberry = NewType("Elderberry", Dragonfruit)


def f(a: Apple, aa: Apricot, b: Banana, bb: Plantain, c: Cherry, d: Dragonfruit, dd: Elderberry) -> None:
    if a is None:
        reveal_type(a, expected_text="Apple")

    if aa is None:
        reveal_type(aa, expected_text="Apricot")

    if b is True:
        reveal_type(b, expected_text="Banana")

    if bb is True:
        reveal_type(bb, expected_text="Plantain")

    if c is False:
        reveal_type(c, expected_text="Cherry")

    if d is ...:
        reveal_type(d, expected_text="Dragonfruit")

    if dd is ...:
        reveal_type(dd, expected_text="Elderberry")

f(
    Apple(None),
    Apricot(Apple(None)),
    Banana(True),
    Plantain(Banana(True)),
    Cherry(False),
    Dragonfruit(...),
    Elderberry(Dragonfruit(...)),
)
