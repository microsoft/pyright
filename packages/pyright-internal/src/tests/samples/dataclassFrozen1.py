# This sample tests the handling of frozen dataclass types.

from dataclasses import dataclass
from typing import ClassVar


@dataclass(frozen=False)
class DC1:
    val1: int = 6


@dataclass(frozen=True)
class DC2:
    val2: float = 4


# This should generate an error because a frozen dataclass
# cannot inherit from a non-frozen dataclass.
@dataclass(frozen=True)
class DC3(DC1):
    val3: int = 4


@dataclass(frozen=True)
class DC4(DC2):
    val4: int = 4

    val5: ClassVar[int]


# This should generate an error because a non-frozen dataclass
# cannot inherit from a frozen dataclass.
@dataclass(frozen=False)
class DC5(DC2):
    val4: int = 5


a = DC1(val1=3)
a.val1 = 3

b = DC4(val2=3, val4=5)

DC4.val5 = 3

# This should generate an error because the dataclass is frozen.
b.val2 = 3

# This should generate an error because the dataclass is frozen.
b.val4 = 3


@dataclass(frozen=True)
class DC6(DC2):
    val2: int = 6
