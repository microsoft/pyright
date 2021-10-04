# This sample tests a case where a class that conforms to a protocol
# uses the protocol in its method signatures.

from typing import Generic, Tuple, TypeVar

from typing_extensions import Protocol

T = TypeVar("T")
U = TypeVar("U")


class A(Protocol[T]):
    def a(self) -> T:
        ...

    def b(self, v: "A[U]") -> "A[Tuple[T, U]]":
        ...


class B(Generic[T]):
    def __init__(self, t: T):
        self._t = t

    def a(self) -> T:
        return self._t

    def b(self, v: A[U]) -> A[Tuple[T, U]]:
        x = B((self._t, v.a()))
        return x
