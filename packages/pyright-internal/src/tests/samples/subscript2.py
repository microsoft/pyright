# This sample tests various forms of subscript expressions for
# syntax and semantic (type) errors.

from typing import List, Literal, TypeVar


_T = TypeVar("_T", list, tuple)

def func1(p1: List[int], p2: _T):
    a1 = p1[0]
    t_a1: Literal["int"] = reveal_type(a1)

    a2 = p1[:]
    t_a2: Literal["list[int]"] = reveal_type(a2)

    a3 = p1[1:]
    t_a3: Literal["list[int]"] = reveal_type(a3)

    a4 = p1[1:2]
    t_a4: Literal["list[int]"] = reveal_type(a4)

    a5 = p1[0:1:3]
    t_a5: Literal["list[int]"] = reveal_type(a5)

    a6 = p1[:3]
    t_a6: Literal["list[int]"] = reveal_type(a6)

    a7 = p1[::]
    t_a7: Literal["list[int]"] = reveal_type(a7)

    a8 = p1[::2]
    t_a8: Literal["list[int]"] = reveal_type(a8)

    # This should generate a syntax error.
    b1 = p1[0:1:3:4]

    # This should generate a syntax error.
    b2 = p1[0:::]

    # This should generate a type error.
    c1 = p1[:,]
    t_c1: Literal["Unknown"] = reveal_type(c1)

    # This should generate a type error.
    c2 = p1[:,:]
    t_c2: Literal["Unknown"] = reveal_type(c2)

    # This should generate a type error.
    c3 = p1[1,]
    t_c3: Literal["Unknown"] = reveal_type(c3)

    d1 = p2[0]
    t_d1: Literal["Unknown"] = reveal_type(d1)


