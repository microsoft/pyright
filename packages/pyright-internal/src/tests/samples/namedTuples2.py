# This test validates that NamedTuple instances can be destructured
# and indexed to get to their constituent element types.

from typing import NamedTuple


class MyDataClass(NamedTuple):
    entry_1: str
    entry_2: int


nt1 = MyDataClass("yes", 1)

(a1, a2) = nt1
a1_1: str = a1
a2_1: int = a2

# These should generate an error because a1 and a2 are
# the wrong types.
a1_2: int = a1
a2_2: str = a2


b1 = nt1[0]
b2 = nt1[1]
b1_1: str = b1
b2_1: int = b2

# These should generate an error because a1 and a2 are
# the wrong types.
b1_2: int = b1
b2_2: str = b2


MyNT = NamedTuple("MyNT", [("hi", int), ("bye", str)])

nt2 = MyNT(3, "yo")

(c1, c2) = nt2
c1_2: int = c1
c2_2: str = c2

# These should generate an error because a1 and a2 are
# the wrong types.
c1_1: str = c1
c2_1: int = c2

d1 = nt2[0]
d2 = nt2[1]
d1_2: int = d1
d2_2: str = d2

# These should generate an error because a1 and a2 are
# the wrong types.
d1_1: str = d1
d2_1: int = d2
