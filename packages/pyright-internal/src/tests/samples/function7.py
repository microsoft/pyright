# This test validates that a function can be treated as an object
# for type checking purposes.

from typing import Hashable


def func1(a: int) -> int:
    return a


x: object = func1

y: Hashable = func1
