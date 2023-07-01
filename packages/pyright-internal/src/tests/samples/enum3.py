# This sample tests that enum values are treated as constant even if
# they are not named as such.

from enum import Enum


class EnumA(Enum):
    bad = 0
    good = 1


class EnumB:
    def __init__(self):
        self.status = EnumA.bad
        self.foo = 1


myobj = EnumB()

reveal_type(myobj.status, expected_text="EnumA")

myobj.status = EnumA.good
reveal_type(myobj.status, expected_text="Literal[EnumA.good]")
