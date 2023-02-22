# This sample tests that a __new__ method allows for the Self
# to be associated with the provided `cls` argument rather than
# the class bound to the `__new__` method.

import enum
from typing_extensions import Self, reveal_type


class Enum1(enum.IntEnum):
    def __new__(cls, value: int, doc: str) -> Self:
        member = int.__new__(cls, value)
        reveal_type(member, expected_text="Self@Enum1")
        member._value_ = value
        member.__doc__ = doc
        return member
