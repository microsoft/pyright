# This sample tests the interactions between the synthesized
# type for "self" and protocol matching.

from typing import Protocol


class ProtocolBase(Protocol):
    def a(self) -> None: ...

    def b(self) -> None: ...


class ProtocolExtended(ProtocolBase, Protocol):
    def c(self) -> None: ...


class Base:
    def a(self) -> None:
        pass


class ImplementsBase(Base):
    def b(self) -> None:
        pass


class ImplementsExtended(ImplementsBase):
    def c(self) -> None:
        pass


a: ProtocolExtended
a = ImplementsExtended()
