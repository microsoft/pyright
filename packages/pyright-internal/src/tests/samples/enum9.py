# This sample tests the enum.member and enum.nonmember classes introduced
# in Python 3.11.

import sys
from enum import Enum, member, nonmember
from typing import Literal


class Enum1(Enum):
    MEMBER = 1
    ANOTHER_MEMBER = member(2)
    NON_MEMBER = nonmember(3)

    @member
    @staticmethod
    def ALSO_A_MEMBER() -> Literal[4]:
        return 4

    @member
    class ClassA:
        pass

    @nonmember
    class ClassB:
        pass

    class ClassC:
        pass


reveal_type(Enum1.MEMBER, expected_text="Literal[Enum1.MEMBER]")
reveal_type(Enum1.ANOTHER_MEMBER, expected_text="Literal[Enum1.ANOTHER_MEMBER]")
reveal_type(Enum1.ALSO_A_MEMBER, expected_text="Literal[Enum1.ALSO_A_MEMBER]")
reveal_type(Enum1.NON_MEMBER, expected_text="int")
reveal_type(Enum1.ClassA, expected_text="Literal[Enum1.ClassA]")
reveal_type(Enum1.ClassB, expected_text="type[ClassB]")

if sys.version_info >= (3, 13):
    reveal_type(Enum1.ClassC, expected_text="type[ClassC]")
else:
    reveal_type(Enum1.ClassC, expected_text="Literal[Enum1.ClassC]")


reveal_type(Enum1.MEMBER.value, expected_text="Literal[1]")
reveal_type(Enum1.ANOTHER_MEMBER.value, expected_text="int")
reveal_type(Enum1.ALSO_A_MEMBER.value, expected_text="() -> Literal[4]")
reveal_type(Enum1.ClassA.value, expected_text="type[ClassA]")

if sys.version_info < (3, 13):
    reveal_type(Enum1.ClassC.value, expected_text="type[ClassC]")
