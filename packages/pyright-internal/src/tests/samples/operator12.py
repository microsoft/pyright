# This sample tests the handling of operators when used with constrained
# type variables.

from typing import Generic, TypeVar

T = TypeVar("T", int, float)


class A(Generic[T]):
    def __init__(self, x: T):
        self.x: T = x

    def __neg__(self) -> "A[T]":
        return A[T](x=-self.x)
