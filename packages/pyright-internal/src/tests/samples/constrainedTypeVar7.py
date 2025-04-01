# This sample tests the assignment of constrained TypeVars to a union
# that allows for all of the types in the constraint.

from typing import Iterator, Optional, Sequence, TypeVar, Union


def func0(a: Union[int, float]): ...


_T1 = TypeVar("_T1", int, float)


def func1(a: _T1, b: _T1):
    return func0(a)


_T2 = TypeVar("_T2", int, float, complex)


def func2(a: _T2, b: _T2):
    # This should generate an error.
    return func0(a)


_T3 = TypeVar("_T3", int, float)


def func3(xs: Sequence[Optional[_T3]]) -> Iterator[_T3]:
    return (x for x in xs if x is not None)


def func4(xs: Sequence[Optional[_T3]]) -> Iterator[_T3]:
    return func3(xs)


def func5(xs: Sequence[Optional[_T2]]) -> Iterator[_T2]:
    # This should generate an error.
    return func3(xs)


class A: ...


class B(A): ...


_T4 = TypeVar("_T4", A, B)
_T5 = TypeVar("_T5", B, A)


def func6(t: type[_T4]) -> type[_T4]:
    return t


def func7(t: type[_T5]) -> type[_T5]:
    return t


val6 = func6(B)
val7 = func7(B)

reveal_type(val6, expected_text="type[B]")
reveal_type(val7, expected_text="type[B]")
