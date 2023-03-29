# This sample tests code that uses an augmented assignment to a subscript
# within a loop.

# pyright: strict

from typing import Any


def func1(any: Any):
    l: list[int] = any
    while any:
        if any:
            l[0] += 0
        else:
            l[0] += 0
