# This sample tests handling of tuples and tracking
# of specific types within a tuple.

from typing import Generic, TypeVar, Self

_T = TypeVar("_T")


class ClassA(tuple[int, str, int, _T]):
    def __new__(cls) -> Self: ...


objA = ClassA[complex]()

(a, b, c, d) = objA

aa1: int = a
bb1: str = b
cc1: int = c
dd1: complex = d

reveal_type(objA[0], expected_text="int")
reveal_type(objA[1], expected_text="str")
reveal_type(objA[2], expected_text="int")
reveal_type(objA[3], expected_text="complex")

# This should generate an error because the trailing
# comma turns the index value into a tuple.
e = objA[0,]

for aaa in objA:
    print(aaa)


class ClassB(tuple[_T, ...]):
    def __new__(cls) -> Self: ...


objB = ClassB[complex]()

(x, y, z) = objB

reveal_type(x, expected_text="complex")
reveal_type(y, expected_text="complex")
reveal_type(z, expected_text="complex")

xx2: complex = objB[0]
yy2: complex = objB[1]
zz2: complex = objB[2]


def func1(lst: list[str] | None) -> None:
    for item in lst or ():
        reveal_type(item, expected_text="str")


class X(Generic[_T]):
    def __init__(self):
        self._x: tuple[_T, ...] = ()
