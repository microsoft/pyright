# This sample tests error cases associated with the "type" statement.

from typing import Callable


T1 = 0

type TA1[T1] = int

class ClassA[T2]:
    type TA2 = int; type TA3 = str

    type TA4 = int

    # This should generate an error because T2 is in use.
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

