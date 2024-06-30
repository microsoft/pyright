# This sample tests the case where an operator overload method is
# defined as a callable protocol object.

from typing import Protocol


class ComparisonOp(Protocol):
    def __call__(self, other: object, /) -> bool: ...


class Number:
    __lt__: ComparisonOp
    __le__: ComparisonOp
    __gt__: ComparisonOp
    __ge__: ComparisonOp


n1 = Number()
n2 = Number()

v1 = n1 < n2
v2 = n1 >= n2
v2 = n1 > n2
