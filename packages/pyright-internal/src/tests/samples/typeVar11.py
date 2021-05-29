# This sample tests that literal values are retained by the constraint
# solver if they are found as type arguments.

from typing import Literal, Set


_L1 = Literal["foo", "bar"]


def combine(set1: Set[_L1], set2: Set[_L1]) -> None:
    x = set1 | set2
    t1: Literal["Set[Literal['foo', 'bar']]"] = reveal_type(x)
