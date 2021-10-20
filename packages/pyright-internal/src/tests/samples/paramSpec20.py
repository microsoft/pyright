# This sample tests the handling of class specialization expressions
# that provide signatures for ParamSpecs.

from typing import Callable, Concatenate, Generic, ParamSpec, TypeVar


T = TypeVar("T")
P1 = ParamSpec("P1")
P2 = ParamSpec("P2")


class X(Generic[T, P1]):
    f: Callable[P1, int]
    x: T


def x1(x: X[int, P2]) -> str:
    ...


def x2(x: X[int, Concatenate[int, P2]]) -> str:
    ...


def X3(x: X[int, [int, bool]]) -> str:
    ...


def x4(x: X[int, ...]) -> str:
    ...


# This should generate an error because "int" can't be bound to a ParamSpec.
def x5(x: X[int, int]) -> str:
    ...


# This should generate an error.
def x6(x: X[..., ...]) -> str:
    ...


# This should generate an error.
def x7(x: X[[int], [int, int]]) -> str:
    ...


class Z(Generic[P1]):
    f: Callable[P1, int]


def z1(x: Z[[int, str, bool]]) -> str:
    ...


def z2(x: Z[int, str, bool]) -> str:
    ...


# This should generate an error.
def z3(x: Z[[int, [str], bool]]) -> str:
    ...


# This should generate an error.
def z4(x: Z[[[int, str, bool]]]) -> str:
    ...


# This should generate an error.
def z5(x: Z[[...]]) -> str:
    ...
