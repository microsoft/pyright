# This sample tests the support for functools.total_ordering.

from functools import total_ordering


@total_ordering
class ClassA:
    val1: int

    def __gt__(self, other: object) -> bool:
        ...


a = ClassA()
b = ClassA()
a < b
a <= b
a > b
a >= b
a == b
a != b

# This should generate an error because it doesn't declare
# any of the required ordering functions.
@total_ordering
class ClassB:
    val1: int
