# This sample tests the enum.member and enum.nonmember classes introduced
# in Python 3.11.

from enum import Enum, member, nonmember
from typing import ClassVar, Literal


class Enum1(Enum):
    MEMBER = 1
    ANOTHER_MEMBER = member(2)
    NON_MEMBER = nonmember(3)

    @member
    @staticmethod
    def ALSO_A_MEMBER() -> Literal[4]:
        return 4


reveal_type(Enum1.MEMBER, expected_text="Literal[Enum1.MEMBER]")
reveal_type(Enum1.ANOTHER_MEMBER, expected_text="Literal[Enum1.ANOTHER_MEMBER]")
reveal_type(Enum1.ALSO_A_MEMBER, expected_text="Literal[Enum1.ALSO_A_MEMBER]")
reveal_type(Enum1.NON_MEMBER, expected_text="int")


reveal_type(Enum1.MEMBER.value, expected_text="Literal[1]")
reveal_type(Enum1.ANOTHER_MEMBER.value, expected_text="int")
reveal_type(Enum1.ALSO_A_MEMBER.value, expected_text="() -> Literal[4]")


class Enum2(Enum):
    MEMBER: int = member(1)
    NON_MEMBER: int = nonmember(1)
    NON_MEMBER2: ClassVar[dict[str, str | int]] = nonmember({})


reveal_type(Enum2.MEMBER, expected_text="Literal[Enum2.MEMBER]")
reveal_type(Enum2.NON_MEMBER, expected_text="int")
reveal_type(Enum2.NON_MEMBER2, expected_text="dict[str, str | int]")

reveal_type(Enum2.MEMBER.value, expected_text="int")
