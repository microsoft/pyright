# This sample tests that enum values are treated as constant even if
# they are not named as such.

from enum import Enum
from typing import Literal


class Status(Enum):
    bad = 0
    good = 1


class Myclass:
    def __init__(self):
        self.status = Status.bad
        self.foo = 1


myobj = Myclass()

t1: Literal["Status"] = reveal_type(myobj.status)

myobj.status = Status.good
t2: Literal["Literal[Status.good]"] = reveal_type(myobj.status)
