# This sample tests various forms of subscript expressions for
# syntax and semantic (type) errors.

from typing import TypeVar


_T = TypeVar("_T", list, tuple)

def func1(p1: list[int], p2: _T):
    a1 = p1[0]
    reveal_type(a1, expected_text="int")

    a2 = p1[:]
    reveal_type(a2, expected_text="list[int]")

    a3 = p1[1:]
    reveal_type(a3, expected_text="list[int]")

    a4 = p1[1:2]
    reveal_type(a4, expected_text="list[int]")

    a5 = p1[0:1:3]
    reveal_type(a5, expected_text="list[int]")

    a6 = p1[:3]
    reveal_type(a6, expected_text="list[int]")

    a7 = p1[::]
    reveal_type(a7, expected_text="list[int]")

    a8 = p1[::2]
    reveal_type(a8, expected_text="list[int]")

    # This should generate a syntax error.
    b1 = p1[0:1:3:4]

    # This should generate a syntax error.
    b2 = p1[0:::]

    # This should generate a type error.
    c1 = p1[:,]
    reveal_type(c1, expected_text="Unknown")

    # This should generate a type error.
    c2 = p1[:,:]
    reveal_type(c2, expected_text="Unknown")

    # This should generate a type error.
    c3 = p1[1,]
    reveal_type(c3, expected_text="Unknown")

    d1 = p2[0]
    reveal_type(d1, expected_text="Unknown")


