# This sample tests the handling of instance variables within
# an enum class that are initialized by a custom initializer.
# They should not be treated as enum objects.

from enum import Enum


class Descriptor:
    def __get__(self, instance, owner=None) -> complex:
        return 3j


class EnumA(Enum):
    ENTRY = (123, "abc")

    desc = Descriptor()

    _exempt_ = 12

    foo: int
    bar: str

    def __init__(self, foo: int, bar: str) -> None:
        self.foo = foo
        self.bar = bar


baz = 123 + EnumA.ENTRY.foo
reveal_type(baz, expected_text="int")

reveal_type(EnumA._exempt_, expected_text="int")

reveal_type(EnumA.desc, expected_text="complex")
