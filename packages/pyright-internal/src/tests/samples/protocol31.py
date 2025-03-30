# This sample tests the case where an implementation of a protocol
# implements a function with a named + positional parameter but
# the protocol has a name-only parameter.

from typing import Generic, Protocol, TypeVar

T = TypeVar("T")
Tct = TypeVar("Tct", contravariant=True)


class Interface(Protocol[Tct]):
    def run(self, *, value1: Tct, value2: int) -> object: ...


class Implementation(Generic[Tct]):
    def run(self, value2: float, value1: Tct) -> object:
        return None


def get(_: T) -> Interface[T]:
    return Implementation[T]()
