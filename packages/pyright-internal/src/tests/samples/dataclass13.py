# This sample tests the handling of frozen dataclass types.

from dataclasses import dataclass


@dataclass(frozen=False)
class DC1:
    val1: int = 6


@dataclass(frozen=True)
class DC2:
    val2: int = 4


# This should generate an error because a frozen dataclass
# cannot inherit from a non-frozen dataclass.
@dataclass(frozen=True)
class DC3(DC1):
    val3: int = 4


@dataclass(frozen=True)
class DC4(DC2):
    val4: int = 4


a = DC1(val1=3)
a.val1 = 3

b = DC4(val2=3, val4=5)

# This should generate an error because the dataclass is frozen.
b.val2 = 3

# This should generate an error because the dataclass is frozen.
b.val4 = 3
