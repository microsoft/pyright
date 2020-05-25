# This sample verifies that bitwise or operator is not
# interpreted as a Union operator in cases where it
# shouldn't be.

from typing import Any

class my_class:
    def __init__(self, v):
        self._v = v


def test_bad_syntax(a: Any, b: Any):
    r = my_class(a | b)
    print(r)
