# This sample validates that mutable class and instance variables
# are treated as invariant during protocol matching.

from typing import ClassVar, Protocol


class P1(Protocol):
    v1: float


class C1(Protocol):
    v1: int


def func1(c1: C1):
    # This should generate an error because v1 is invariant.
    x: P1 = c1


class P2(Protocol):
    v1: ClassVar[float]


class C2(Protocol):
    v1: int


def func2(c2: C2):
    # This should generate an error because v1 is invariant.
    x: P2 = c2
