# This sample verifies that the "tuple" type is treated
# analogously to "Tuple" type.

from typing import Iterable, TypeVar, Self


_T = TypeVar("_T")


class ClassA(tuple[int, str, int, _T]):
    def __new__(cls) -> Self: ...


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


class ClassB(tuple[_T, ...]):
    def __new__(cls) -> Self: ...


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

TupleTypeAlias1 = tuple[str, int, float]

t1_1: TupleTypeAlias1 = ("hi", 2, 3.4)

# This should generate an error.
t1_2: TupleTypeAlias1 = ("hi", 2)

# This should generate an error.
t1_3: TupleTypeAlias1 = ("hi", 2.3, 4)

TupleTypeAlias2 = tuple[str, ...]

t2_1: TupleTypeAlias2 = ("hi", "", "")
t2_2: TupleTypeAlias2 = ()

# This should generate an error.
t2_3: TupleTypeAlias2 = ("hi", 2)

TupleTypeAlias3 = tuple[()]

t3_1: TupleTypeAlias2 = ()

# This should generate an error.
t3_2: TupleTypeAlias2 = (3, 4)


T = TypeVar("T")


def baz(v: Iterable[T]) -> tuple[T]: ...


def qux() -> None:
    foo = ["foo"]
    quux = baz(foo)
    for s in quux:
        reveal_type(s, expected_text="str")
