# This sample tests the detection of Final mismatches between a protocol
# and a purported instance of a protocol.

from dataclasses import dataclass, field
from typing import NamedTuple, Protocol, Final


class ProtoA(Protocol):
    x: Final[int] = field()


@dataclass
class ConcreteA:
    x: int = 0


# This should generate an error
a1: ProtoA = ConcreteA(0)


class ProtoB(Protocol):
    y: int


@dataclass
class ConcreteB:
    y: Final[int] = 0


# This should generate an error
b1: ProtoB = ConcreteB(0)


class ProtoC(Protocol):
    x: Final[int]


class ConcreteC1(NamedTuple):
    x: int


@dataclass(frozen=True)
class ConcreteC2:
    x: int


c1: ProtoC = ConcreteC1(0)
c2: ProtoC = ConcreteC2(0)
