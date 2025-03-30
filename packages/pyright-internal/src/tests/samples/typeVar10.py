# This sample tests the handling of constrained TypeVars when used
# within call arguments.

from typing import TypeVar


class A:
    def method(self, x: "A") -> "A": ...


class B:
    def method(self, x: "B") -> "B": ...


T = TypeVar("T", A, B)


def check(x: T, y: T) -> T:
    return x.method(y)
