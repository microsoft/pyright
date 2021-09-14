# This sample tests the case where dependent types within
# a loop are assigned using tuples.

from typing import Literal


def fibonacci():
    a, b = 1, 1
    while True:
        yield a
        a, b = b, a + b
        t1: Literal["int"] = reveal_type(a)
        t2: Literal["int"] = reveal_type(b)
