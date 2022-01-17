# This sample tests that enum values are treated as constant even if
# they are not named as such.

from enum import Enum


class Status(Enum):
    bad = 0
    good = 1


class Myclass:
    def __init__(self):
        self.status = Status.bad
        self.foo = 1


myobj = Myclass()

reveal_type(myobj.status, expected_text="Status")

myobj.status = Status.good
reveal_type(myobj.status, expected_text="Literal[Status.good]")
