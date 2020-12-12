# This sample tests the assignment of constrained TypeVars to a union
# that allows for all of the types in the constraint.

from typing import TypeVar, Union


def func(a: Union[int, float]):
    ...


_T1 = TypeVar("_T1", int, float)


def func1(a: _T1, b: _T1):
    return func(a)


_T2 = TypeVar("_T2", int, float, complex)


def func2(a: _T2, b: _T2):
    # This should generate an error.
    return func(a)
