# This sample tests the case where a callback protocol uses a function-
# scoped type variable.

from typing import Generic, Protocol, TypeVar

T = TypeVar("T")
T_co = TypeVar("T_co", covariant=True)
U_co = TypeVar("U_co", covariant=True)


class A(Generic[T_co, U_co]): ...


class BProto(Protocol):
    def __call__(self, x: T) -> A[list[T], T]: ...


def func1() -> BProto:
    def make_a(x: T) -> A[list[T], T]: ...

    return make_a
