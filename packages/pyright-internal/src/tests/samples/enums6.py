# This sample tests the handling of instance variables within
# an enum class that are initialized by a custom initializer.
# They should not be treated as enum objects.

from enum import Enum
from typing import Literal


class Descriptor:
    def __get__(self, instance, owner=None) -> complex:
        return 3j


class MyEnum(Enum):
    ENTRY = (123, "abc")

    desc = Descriptor()

    _exempt_ = 12

    foo: int
    bar: str

    def __init__(self, foo: int, bar: str) -> None:
        self.foo = foo
        self.bar = bar


baz = 123 + MyEnum.ENTRY.foo
t_baz: Literal["int"] = reveal_type(baz)

t_exempt: Literal["int"] = reveal_type(MyEnum._exempt_)

t_desc: Literal["complex"] = reveal_type(MyEnum.desc)
