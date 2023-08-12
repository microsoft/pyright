# This sample tests error cases associated with the "type" statement
# introduced in PEP 695.

from typing import Callable


T1 = 0

type TA1[T1] = int

class ClassA[T2]:
    type TA2 = int; type TA3 = str

    type TA4 = int

    T2 = 4


T2 = 4


type TA5[S1, *S2, **S3] = Callable[S3, S1] | tuple[*S2]

X1 = TA5[int, tuple[int, str], ...]

type TA6 = TA5[int, tuple[int, str], ...]

val1: TA5
val2: TA6

if 1 < 2:
    # This should generate an error because it is obscured.
    type TA7 = int
else:
    type TA7 = int


def func1() -> type[int]:
    ...

# This should generate an error because a call expression is not
# allowed in a type alias definition.
type TA8 = func1()

# This should generate an error because a tuple and index expression is not
# allowed in a type alias definition.
type TA9 = (int, str, str)[0]


type TA10 = int

# This should generate an error.
TA10.bit_count(1)

# This should generate an error.
TA10(0)

# This should generate an error.
class DerivedInt(TA10): pass

def func2(x: object):
    # This should generate an error.
    if isinstance(x, TA10):
        reveal_type(x)

