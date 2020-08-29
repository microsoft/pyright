# This sample tests handling of tuples and tracking
# of specific types within a tuple.

from typing import NamedTuple, Tuple, TypeVar

_T = TypeVar("_T")


class ClassA(Tuple[int, str, int, _T]):
    pass


objA = ClassA[complex]()

(a, b, c, d) = objA

aa1: int = a
bb1: str = b
cc1: int = c
dd1: complex = d

aa2: int = objA[0]
bb2: str = objA[1]
cc2: int = objA[2]
dd2: complex = objA[3]

# These should generate errors because
# these are not the correct types.
aa3: str = a
bb3: complex = b
cc3: str = c
dd3: int = d

for aaa in objA:
    print(aaa)


class ClassB(Tuple[_T, ...]):
    pass

objB = ClassB[complex]()

(x, y, z) = objB

xx1: complex = x
yy1: complex = y
zz1: complex = z

xx2: complex = objB[0]
yy2: complex = objB[1]
zz2: complex = objB[2]

# These should generate errors because
# these are not the correct types.
xx3: int = x
yy3: int = y
zz3: int = z


