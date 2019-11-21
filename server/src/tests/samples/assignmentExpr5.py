# This sample tests the scoping rules for assignment expressions
# within a list comprehension.

from typing import Tuple

def foo() -> Tuple[str, int]:
    a = 3
    y = 4
    b = [(a := x) for x in ['1', '2'] for y in ['1', '2']]

    # The type of "y" should be int because the "y" within
    # the list comprehension doesn't leak outside. On the
    # other hand, "a" does leak outside the list comprehension.
    return (a, y)

