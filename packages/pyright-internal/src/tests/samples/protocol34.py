# This sample tests a case where a method calls its own constructor
# with a specialized type that uses its own TypeVar and the expected
# type is a protocol.

from typing import Generic, TypeVar, Protocol

T = TypeVar("T")


class X(Protocol):
    def f(self) -> int: ...


class Y(Generic[T]):
    def f(self) -> T:
        raise NotImplementedError

    def g(self) -> X:
        # This should generate a type error.
        return Y[T]()
