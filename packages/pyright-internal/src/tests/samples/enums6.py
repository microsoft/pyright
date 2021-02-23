# This sample tests the handling of instance variables within
# an enum class that are initialized by a custom initializer.
# They should not be treated as enum objects.

from enum import Enum
from typing import Literal


class MyEnum(Enum):
    ENTRY = (123, "abc")

    foo: int
    bar: str

    def __init__(self, foo: int, bar: str) -> None:
        self.foo = foo
        self.bar = bar


baz = 123 + MyEnum.ENTRY.foo
t_baz: Literal["int"] = reveal_type(baz)
