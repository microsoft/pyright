# This sample tests the case where a dataclass uses a ClassVar that
# is also Final.

from dataclasses import dataclass
from typing import ClassVar, Final


@dataclass
class A:
    a: Final[int]
    b: Final[str] = ""
    c: ClassVar[Final[int]] = 0
    d: ClassVar[Final] = 0
    e: Final[ClassVar[int]] = 0


a = A(1)

# This should generate an error.
a.a = 0

# This should generate an error.
a.b = ""

# This should generate an error.
a.c = 0

# This should generate an error.
A.c = 0

# This should generate an error.
A.d = 0

# This should generate an error.
A.e = 0


@dataclass
class B:
    a: ClassVar[Final[int]] = 0
    b: int = 1
