# This sample tests the case where an operator (__or__) cannot be
# properly evaluated when using bidirectional type inference but
# can be without.

from typing import Iterable


def func(a: set[int], b: set[str]):
    x1: Iterable[int | str] = a | a

    x2: set[int] = a | a

    # This should generate an error
    x3: set[int | str] = a | a

    x4: set[int | str] = a | b
