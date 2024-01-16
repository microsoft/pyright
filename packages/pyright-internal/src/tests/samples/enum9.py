# This sample tests the enum.member and enum.nonmember classes introduced
# in Python 3.11.

import enum
from typing import Literal


class E(enum.Enum):
    MEMBER = 1
    ANOTHER_MEMBER = enum.member(2)
    NON_MEMBER = enum.nonmember(3)

    @enum.member
    @staticmethod
    def ALSO_A_MEMBER() -> Literal[4]:
        return 4


reveal_type(E.MEMBER, expected_text="Literal[E.MEMBER]")
reveal_type(E.ANOTHER_MEMBER, expected_text="Literal[E.ANOTHER_MEMBER]")
reveal_type(E.ALSO_A_MEMBER, expected_text="Literal[E.ALSO_A_MEMBER]")
reveal_type(E.NON_MEMBER, expected_text="int")


reveal_type(E.MEMBER.value, expected_text="Literal[1]")
reveal_type(E.ANOTHER_MEMBER.value, expected_text="int")
reveal_type(E.ALSO_A_MEMBER.value, expected_text="() -> Literal[4]")
