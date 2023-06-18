# This sample tests the case where a generic class is passed as an
# argument to a function that accepts a generic callable parameter.
# The class-scoped TypeVars for the class must be preserved when
# solving the higher-order TypeVars.

from itertools import compress
from typing import Any, Iterable


def func1(a: Iterable[Iterable[tuple[str, int]]], b: Any) -> None:
    c = map(compress, a, b)
    reveal_type(c, expected_text="map[compress[tuple[str, int]]]")
