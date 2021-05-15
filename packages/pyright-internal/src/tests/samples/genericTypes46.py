# This sample tests the assignment of constrained TypeVars to a union
# that allows for all of the types in the constraint.

from typing import Iterator, Optional, Sequence, TypeVar, Union


def func(a: Union[int, float]):
    ...


_T1 = TypeVar("_T1", int, float)


def func1(a: _T1, b: _T1):
    return func(a)


_T2 = TypeVar("_T2", int, float, complex)


def func2(a: _T2, b: _T2):
    # This should generate an error.
    return func(a)


_T3 = TypeVar("_T3", int, float)


def func3(xs: Sequence[Optional[_T3]]) -> Iterator[_T3]:
    return (x for x in xs if x is not None)


def func4(xs: Sequence[Optional[_T3]]) -> Iterator[_T3]:
    return func3(xs)


def func5(xs: Sequence[Optional[_T2]]) -> Iterator[_T2]:
    # This should generate two errors.
    return func3(xs)
