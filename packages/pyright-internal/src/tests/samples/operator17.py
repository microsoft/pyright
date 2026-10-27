# This sample tests inferred inherited operators that delegate to an overridden helper.

from types import NotImplementedType
from typing import Never


class Base:
    def __add__(self, other: object):
        return self.apply(other)

    def __radd__(self, other: object):
        return self.apply(other)

    def apply(self, other: object):
        return NotImplemented


class Number(Base):
    # This should generate an error for the base helper's inferred return type.
    def apply(self, other: object) -> int:
        return 42


class Text(Base):
    # This should generate an error for the base helper's inferred return type.
    def apply(self, other: object) -> str:
        return "value"


class ReturnsNone(Base):
    # This should generate an error for the base helper's inferred return type.
    def apply(self, other: object) -> None:
        return None


class Raises(Base):
    def apply(self, other: object) -> Never:
        raise RuntimeError


class Declines(Base):
    pass


class Fallback:
    def __radd__(self, other: object) -> str:
        return "fallback"


def operands(number: Number, text: Text, base: Base):
    reveal_type(number + number, expected_text="int")
    reveal_type(number + base, expected_text="int")
    reveal_type(base + number, expected_text="int")
    reveal_type(text + text, expected_text="str")
    reveal_type(number + text, expected_text="int")
    reveal_type(text + number, expected_text="str")
    reveal_type(number.__add__(number), expected_text="int")
    reveal_type(text.__add__(text), expected_text="str")
    # This should generate an error.
    (number + number).no_such_member()


def bad_return(number: Number) -> str:
    # This should generate an error.
    return number + number


def bad_assignment(number: Number):
    # This should generate an error.
    value: str = number + number


def none_result(value: ReturnsNone):
    reveal_type(value + value, expected_text="None")


def never_result(value: Raises):
    reveal_type(value + value, expected_text="Never")


def declining_results(base: Base, value: Declines, fallback: Fallback):
    reveal_type(value + fallback, expected_text="str")
    # This should generate an error.
    _ = base + base
    # This should generate an error.
    _ = value + value


class BaseMeta(type):
    def __add__(cls, other: object):
        return cls.apply(other)

    def apply(cls, other: object):
        return NotImplemented


class NumberMeta(BaseMeta):
    # This should generate an error for the base helper's inferred return type.
    def apply(cls, other: object) -> int:
        return 42


class First(metaclass=NumberMeta): ...


class Second(metaclass=NumberMeta): ...


def metaclasses():
    reveal_type(First + Second, expected_text="int")


def bad_metaclass_return() -> str:
    # This should generate an error.
    return First + Second


class DeclaredBase(Base):
    def __add__(self, other: object) -> NotImplementedType:
        return self.apply(other)


class InheritedDeclaredNumber(DeclaredBase):
    # This should generate an error for the base helper's inferred return type.
    def apply(self, other: object) -> int:
        return 42


def declared_return(value: InheritedDeclaredNumber):
    reveal_type(value.__add__(value), expected_text="NotImplementedType")
    # This should generate an error.
    _ = value + value


class UnknownResult(Base):
    # This should generate an error for the narrower parameter type.
    def apply(self, other: list):
        return other[0]


def unknown_return(value: UnknownResult) -> str:
    # This should generate an error rather than accepting an Unknown result.
    return value + value
