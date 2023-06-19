# This sample tests the case where an enum class is used as a bound
# for a TypeVar and instantiated.

# pyright: strict

from enum import Enum
from typing import TypeVar

TEnum = TypeVar("TEnum", bound=Enum)


def func1(enum_cls: type[TEnum], enum_value: object) -> TEnum:
    enum_member = enum_cls(enum_value)
    reveal_type(enum_member, expected_text="TEnum@func1")
    return enum_member
