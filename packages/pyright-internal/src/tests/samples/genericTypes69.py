# This sample tests the case where a method within a generic class
# constructs an instance of the same type using a type variable
# within that class.

from typing import Generic, Literal, Protocol, Tuple, TypeVar


T = TypeVar("T")


class A(Protocol[T]):
    def b(self) -> "A[Tuple[T]]":
        ...


class B(Generic[T]):
    def __init__(self, t: T):
        self._t = t

    def b(self) -> A[Tuple[T]]:
        x = (self._t,)
        t1: Literal["tuple[T@B]"] = reveal_type(x)
        y = B(x)
        t2: Literal["B[tuple[T@B]]"] = reveal_type(y)
        return y
