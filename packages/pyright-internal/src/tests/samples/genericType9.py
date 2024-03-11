# This sample tests the case where a method is invoked on a
# generic class that is not specialized prior to binding to
# the method but is specialized implicitly via the arguments
# to the method.

from typing import Generic, TypeVar

_T1 = TypeVar("_T1")
_T2 = TypeVar("_T2")


class ClassA(Generic[_T1]):
    @staticmethod
    def func1(value: _T1) -> "ClassA[_T1]":
        return ClassA[_T1]()

    @classmethod
    def func2(cls, value: _T1) -> "ClassA[_T1]":
        return cls()


class ClassASub1(ClassA[_T2]):
    pass


class ClassASub2(ClassA[int]):
    pass


def test1(val_str: str, val_int: int):
    reveal_type(ClassA.func1(val_str), expected_text="ClassA[Unknown]")
    reveal_type(ClassASub1.func1(val_str), expected_text="ClassA[Unknown]")
    reveal_type(ClassASub2.func1(val_int), expected_text="ClassA[int]")

    # This should generate an error because the argument type doesn't match.
    ClassASub2.func1(val_str)

    reveal_type(ClassA.func2(val_str), expected_text="ClassA[Unknown]")
    reveal_type(ClassASub1.func2(val_str), expected_text="ClassA[Unknown]")
    reveal_type(ClassASub2.func2(val_int), expected_text="ClassA[int]")

    # This should generate an error because the argument type doesn't match.
    ClassASub2.func2(val_str)
