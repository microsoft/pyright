# This sample tests the simple aliasing of a generic class with no
# type arguments.

from typing import Generic, TypeVar
import collections
from collections import OrderedDict


_T = TypeVar("_T")


class ClassA(Generic[_T]):
    def __init__(self, x: _T):
        pass


A = ClassA
reveal_type(A(3), expected_text="ClassA[int]")


TA1 = collections.OrderedDict
TA2 = OrderedDict


TA1[int, int]
TA2[int, int]

TA3 = TA1

TA3[int, int]


TA4 = dict | OrderedDict

# This should generate two errors because the two types in TA4
# are already specialized.

x: TA4[int, int]
