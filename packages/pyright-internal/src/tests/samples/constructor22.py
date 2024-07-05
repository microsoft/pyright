# This sample tests the case where a method within a generic class
# constructs an instance of the same type using a type variable
# within that class.

from typing import Generic, Protocol, Tuple, TypeVar


T = TypeVar("T", covariant=True)


class A(Protocol[T]):
    def a(self) -> "A[Tuple[T]]": ...

    def b(self) -> "A[Tuple[T]]": ...

    def c(self) -> "T": ...


class B(Generic[T]):
    def __init__(self, t: T):
        self._t = t

    def a(self) -> A[Tuple[T]]:
        t = (self._t,)
        y = B(t)
        v = f(y.b())
        reveal_type(v, expected_text="tuple[T@B]")
        return y

    def b(self) -> A[Tuple[T]]:
        x = (self._t,)
        reveal_type(x, expected_text="tuple[T@B]")
        y = B(x)
        reveal_type(y, expected_text="B[tuple[T@B]]")
        return y

    def c(self) -> T:
        return self._t


def f(a: A[Tuple[T]]) -> T:
    return a.c()[0]
