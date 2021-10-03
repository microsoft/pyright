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


# This should generate an error because enums cannot
# be subclassed.
class ExtraColor(Color):
    pass


# This should generate an error because reassignment of enum
# values is not allowed.
Color.red = "new"
