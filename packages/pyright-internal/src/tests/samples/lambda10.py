# This sample tests the handling of immediately-called lambdas.

# pyright: strict

from typing import Callable

func1: Callable[[int, int], int] = lambda x, y, /: (
    lambda x, y: max(
        reveal_type(x, expected_text="int"), reveal_type(y, expected_text="int")
    )
    // min(x, y)
)(abs(reveal_type(x, expected_text="int")), abs(reveal_type(y, expected_text="int")))

v1 = func1(-2, 4)
reveal_type(v1, expected_text="int")


v2 = (lambda a, b: a + b)(3, 4)
reveal_type(v2, expected_text="int")


v3 = (lambda a, b: a + b)("foo", "bar")
reveal_type(v3, expected_text="LiteralString")

v4 = (lambda a, b: a + b)("foo", (lambda c, d: c + d)("b", "ar"))
reveal_type(v4, expected_text="LiteralString")
