# This sample tests that a __new__ method allows for the Self
# to be associated with the provided `cls` argument rather than
# the class bound to the `__new__` method.

import enum
from typing_extensions import (  # pyright: ignore[reportMissingModuleSource]
    Self,
    reveal_type,
)


class Enum1(enum.IntEnum):
    def __new__(cls, value: int, doc: str) -> Self:
        member = int.__new__(cls, value)
        reveal_type(member, expected_text="Self@Enum1")
        member._value_ = value
        member.__doc__ = doc
        return member


class MyStr(str):
    pass


v1 = str.__new__(MyStr)
reveal_type(v1, expected_text="MyStr")
