# This sample tests that protocol compatibility caching produces
# the correct result when the first example of protocol matching within
# the file does not require invariance enforcement but some later one
# does. The cached protocol compatibility cannot be used in this case.

from dataclasses import dataclass
from typing import Protocol


class P1(Protocol):
    x: int


class P2(Protocol):
    y: P1


@dataclass
class A:
    x: int


@dataclass
class B:
    y: A


y: P1 = A(3)

# This should generate an error.
x: P2 = B(A(3))

z: P1 = A(3)
