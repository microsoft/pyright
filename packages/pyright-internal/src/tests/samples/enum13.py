# This sample tests the handling of IntEnum and StrEnum literal values.

from enum import IntEnum, StrEnum, ReprEnum
from typing import Literal, LiteralString


class IntEnum1(IntEnum):
    MEMBER_1 = 1
    MEMBER_2 = 2


i1: Literal[1] = IntEnum1.MEMBER_1

# This should generate an error.
i2: Literal[1] = IntEnum1.MEMBER_2


class StrEnum1(StrEnum):
    MEMBER_1 = "a"
    MEMBER_2 = "b"


s1: Literal["a"] = StrEnum1.MEMBER_1

# This should generate an error.
s2: Literal["b"] = StrEnum1.MEMBER_1

s3: LiteralString = StrEnum1.MEMBER_1


class BytesEnum(bytes, ReprEnum):
    MEMBER_1 = b"1"
    MEMBER_2 = b"2"


b1: Literal[b"1"] = BytesEnum.MEMBER_1

# This should generate an error.
b2: Literal[b"2"] = BytesEnum.MEMBER_1
