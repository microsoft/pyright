# This sample tests handling of tuples and tracking
# of specific types within a tuple.

from typing import List, Literal, Optional, Tuple, TypeVar

_T = TypeVar("_T")


class ClassA(Tuple[int, str, int, _T]):
    pass


objA = ClassA[complex]()

(a, b, c, d) = objA

aa1: int = a
bb1: str = b
cc1: int = c
dd1: complex = d

t_A0: Literal["int"] = reveal_type(objA[0])
t_A1: Literal["str"] = reveal_type(objA[1])
t_A2: Literal["int"] = reveal_type(objA[2])
t_A3: Literal["complex"] = reveal_type(objA[3])

# This should generate an error because the trailing
# comma turns the index value into a tuple.
e = objA[
    0,
]

for aaa in objA:
    print(aaa)


class ClassB(Tuple[_T, ...]):
    pass


objB = ClassB[complex]()

(x, y, z) = objB

t_x: Literal["complex"] = reveal_type(x)
t_y: Literal["complex"] = reveal_type(y)
t_z: Literal["complex"] = reveal_type(z)

xx2: complex = objB[0]
yy2: complex = objB[1]
zz2: complex = objB[2]


def func1(lst: Optional[List[str]]) -> None:
    for item in lst or ():
        t1: Literal["str"] = reveal_type(item)
