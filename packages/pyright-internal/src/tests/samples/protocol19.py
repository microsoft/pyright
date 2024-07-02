# This sample tests the detection of Final mismatches between a protocol
# and a purported instance of a protocol.

from dataclasses import dataclass, field
from typing import Protocol, Final


@dataclass
class PossibleY:
    y: Final[int] = 0


class Y(Protocol):
    y: int


def funcY(x: Y) -> Y: ...


# This should generate an error
funcY(PossibleY(17))


@dataclass
class PossibleX:
    x: int = 0


class X(Protocol):
    x: Final[int] = field()


def funcX(x: X) -> X: ...


# This should generate an error
funcX(PossibleX(17))
