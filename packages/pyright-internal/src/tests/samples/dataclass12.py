# This sample tests the case where a dataclass declares an instance
# variable and a subclass redeclares it as a class variable.

# pyright: reportIncompatibleVariableOverride=false

from dataclasses import dataclass
from typing import ClassVar


@dataclass
class Base:
    x: int
    y: int


@dataclass
class Special(Base):
    x: ClassVar[int] = 1
    z: int


@dataclass
class VerySpecial(Special):
    y: ClassVar[int] = 2


Base(x=1, y=2)
Special(y=2, z=3)
Special(2, 3)

# This should generate an error
Special(x=1, y=2, z=3)

# This should generate an error
Special(1, 2, 3)

VerySpecial(z=3)

# This should generate an error
VerySpecial(x=1, z=3)
