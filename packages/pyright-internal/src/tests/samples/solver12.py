# This sample validates that a generic type can be used to solve a
# TypeVar in a generic method where the "self" parameter is itself generic.

from typing import TypeVar

_T1 = TypeVar("_T1", bound="ClassA")
_T2 = TypeVar("_T2", bound="ClassA")


class ClassA:
    def chain(self: _T1) -> _T1: ...


def func1(p1: _T2) -> _T2:
    return p1.chain()
