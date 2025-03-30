# This sample tests error detection of duplicate enum members and
# an attempt to subclass an enum.

from enum import Enum


class Color(Enum):
    red = "red"
    blue = "blue"
    yellow = "yellow"

    # This should generate an error because the enum member
    # already exists.
    blue = "blue"

    def __init__(self, value: str):
        if value == "blue":
            self.foo = False
        else:
            self.foo = True


class NonEnum: ...


# This should generate an error because enums cannot
# be subclassed.
class ExtraColor(NonEnum, Color):
    pass


# This should generate an error because reassignment of enum
# values is not allowed.
Color.red = "new"


class EnumWithoutValue(Enum):
    def do_something(self):
        pass

    @property
    def y(self) -> None:
        pass


class EnumWithValue(EnumWithoutValue):
    x = 0


# This should generate an error because enums with values
# cannot be subclassed.
class EnumSubclass(EnumWithValue):
    z: int
