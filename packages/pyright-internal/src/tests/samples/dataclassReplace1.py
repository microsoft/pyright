# This sample tests the synthesis of a "__replace__" method for dataclass
# classes in Python 3.13 and newer.

from dataclasses import dataclass
from typing import NamedTuple


@dataclass
class DC1:
    a: int
    b: str
    c: str = ""


dc1: DC1 = DC1(1, "")

dc1_clone = dc1.__replace__(b="", a=1, c="")
reveal_type(dc1_clone, expected_text="DC1")

dc1.__replace__(c="")
dc1.__replace__(b="2")

# This should generate an error.
dc1.__replace__(b=2)

# This should generate an error.
dc1.__replace__(d="")


class NT1(NamedTuple):
    a: int
    b: str
    c: str = ""


nt1 = NT1(1, "")

nt1_clone = nt1.__replace__(c="")
reveal_type(nt1_clone, expected_text="NT1")

# This should generate an error.
nt1.__replace__(b=2)

# This should generate an error.
nt1.__replace__(d="")




@dataclass(frozen=True)
class DC2:
    x: int | str


@dataclass(frozen=True)
class DC3(DC2):
    x: str
    y: str


class DC4(DC2):
    # This should generate an error because DC4 is not
    # a dataclass, and it inherits the __replace__ method
    # from DC2, which means that x can be mutated.
    x: str
    y: str
