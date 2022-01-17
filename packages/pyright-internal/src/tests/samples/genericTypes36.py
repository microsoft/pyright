# This sample tests the handling of constrained types
# when one of the constraints is a narrower version
# of another. The order of the constraints as they appear
# within the TypeVar definition shouldn't matter.

from typing import TypeVar

_T1 = TypeVar("_T1", float, str)


def add1(a: _T1, b: _T1) -> _T1:
    return a + b


a1 = add1(3, 5.5)
reveal_type(a1, expected_text="float")
b1 = add1(3.3, 5)
reveal_type(b1, expected_text="float")
c1 = add1("3", "5")
reveal_type(c1, expected_text="str")


_T2 = TypeVar("_T2", float, int)


def add2(a: _T2, b: _T2) -> _T2:
    return a + b


a2 = add2(3, 5.5)
reveal_type(a2, expected_text="float")
b2 = add2(3.3, 5)
reveal_type(b2, expected_text="float")
c2 = add2(3, 5)
reveal_type(c2, expected_text="int")
