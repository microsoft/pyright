# This sample tests that NamedTuple _replace rejects unknown fields
# and type-incompatible field values, matching runtime TypeError behavior.


from collections import namedtuple
from typing import NamedTuple


class NT1(NamedTuple):
    x: int
    y: str


nt1 = NT1(1, "")
nt1_clone = nt1._replace(x=2)
reveal_type(nt1_clone, expected_text="NT1")

# This should generate an error.
nt1._replace(z=1)

# This should generate an error.
nt1._replace(y=1)


NT2 = namedtuple("NT2", ["a", "b"])
nt2 = NT2(1, 2)
nt2_clone = nt2._replace(a=3)
reveal_type(nt2_clone, expected_text="NT2")

# This should generate an error.
nt2._replace(c=1)


NT3 = NamedTuple("NT3", [("n", int), ("s", str)])
nt3 = NT3(1, "")
nt3_clone = nt3._replace(s="ok")
reveal_type(nt3_clone, expected_text="NT3")

# This should generate an error.
nt3._replace(t="no")

# This should generate an error.
nt3._replace(n="")
