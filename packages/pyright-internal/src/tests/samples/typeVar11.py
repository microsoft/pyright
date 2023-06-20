# This sample tests that literal values are retained by the constraint
# solver if they are found as type arguments.

from typing import Literal


_L1 = Literal["foo", "bar"]


def combine(set1: set[_L1], set2: set[_L1]) -> None:
    x = set1 | set2
    reveal_type(x, expected_text="set[Literal['foo', 'bar']]")
