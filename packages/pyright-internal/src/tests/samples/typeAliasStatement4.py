# This sample tests the use of recursive (self-referencing) type aliases,
# which are allowed in PEP 695.

from typing import Callable


type TA1[T] = T | list[TA1[T]]

x1: TA1[int] = 1
x2: TA1[int] = [1]

type TA2[S: int, T: str, **P] = Callable[P, T] | list[S] | list[TA2[S, T, P]]


# This should generate an error because str isn't compatible with S bound.
x3: TA2[str, str, ...]

x4: TA2[int, str, ...]

# This should generate an error because int isn't compatible with T bound.
x5: TA2[int, int, ...]

x6: TA2[int, str, [int, str]]

# This should generate an error because it is unresolvable.
type TA3 = TA3

# This should generate an error because it is unresolvable.
type TA4[T] = T | TA4[str]

type TA5[T] = T | list[TA5[T]]

# This should generate an error because it is unresolvable.
type TA6 = "TA7"
type TA7 = TA6

type JSONNode = list[JSONNode] | dict[str, JSONNode] | str | float

# This should generate an error because it is unresolvable.
type TA8[**P] = TA8[P, int]
