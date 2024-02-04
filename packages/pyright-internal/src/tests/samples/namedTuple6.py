# This sample tests that writes to named attributes within a named
# tuple class are flagged as errors.

from collections import namedtuple
from typing import NamedTuple


class NT1(NamedTuple):
    val1: str
    val2: int


nt1 = NT1("x", 0)

# This should generate an error.
nt1.val1 = ""

# This should generate an error.
nt1[0] = ""

# This should generate an error.
del nt1.val1

# This should generate an error.
del nt1[0]

NT2 = NamedTuple("NT2", [("val1", str), ("val2", int)])

nt2 = NT2("x", 0)

# This should generate an error.
nt2.val2 = 3

NT3 = namedtuple("NT3", ["val1", "val2"])

nt3 = NT3("x", 0)

# This should generate an error.
nt3.val1 = ""
