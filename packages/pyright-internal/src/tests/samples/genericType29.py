# This sample tests the case where a contravariant type parameter
# has a union type that must be matched against another union
# type for purposes of bidirectional type inference.

from typing import Generic, TypeVar

T1 = TypeVar("T1", contravariant=True)
T2 = TypeVar("T2")


class A(Generic[T1]): ...


def func1(x: A[T2]) -> A[T2 | None]: ...


x1: A[int | None] = func1(A[int]())
