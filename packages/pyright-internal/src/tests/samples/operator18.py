# This sample tests that a polymorphic receiver does not erase a known decline.

from datetime import datetime
from types import NotImplementedType
from typing import Self, TypeVar, final


class Offset:
    def __add__(self, other):
        return self.apply(other)

    def __radd__(self, other):
        return self.__add__(other)

    def __neg__(self) -> Self:
        return self

    def __rsub__(self, other):
        if isinstance(other, Offset) and type(self) is not type(other):
            raise TypeError
        # This should generate an error for the base helper's inferred contract.
        result = -self + other
        reveal_type(result, expected_text="Unknown")
        return result

    def apply(self, other):
        return NotImplemented


class Declared:
    def __add__(self, other: object) -> NotImplementedType:
        return NotImplemented

    def check(self):
        # This should generate an error.
        _ = self + self


@final
class FinalClass:
    def __add__(self, other):
        return NotImplemented

    def check(self):
        # This should generate an error.
        _ = self + self


class FinalMethod:
    @final
    def __add__(self, other):
        return NotImplemented

    def check(self):
        # This should generate an error.
        _ = self + self


T = TypeVar("T", bound=Offset)


def generic(left: T, right: T):
    # This should generate an error.
    _ = left + right


def concrete(left: Offset, right: Offset):
    # This should generate an error.
    _ = left + right


class Comparison:
    def __lt__(self, other):
        return NotImplemented

    def check(self):
        reveal_type(self < self, expected_text="NotImplementedType")


class Successful:
    def __add__(self, other: object) -> int | NotImplementedType:
        return 42

    def check(self):
        reveal_type(self + self, expected_text="int")

    def bad_return(self) -> str:
        # This should generate an error.
        return self + self


class TypedOffset:
    def __add__(self, other: object):
        return self.apply(other)

    def __neg__(self) -> Self:
        return self

    def __rsub__(self, other: object) -> Self | datetime:
        return -self + other

    def apply(self, other: object) -> Self | datetime | NotImplementedType:
        return NotImplemented


def typed_offset(value: TypedOffset):
    reveal_type(value + value, expected_text="TypedOffset | datetime")
