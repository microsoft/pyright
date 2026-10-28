# This sample tests NotImplemented fallback through chained arithmetic operators.

from types import NotImplementedType
from typing import Generic, Never, TypeVar


class Returned:
    def __add__(self, other: object) -> int | NotImplementedType:
        return NotImplemented


class Fallback:
    def __radd__(self, other: object) -> int:
        return 42


class Base:
    def __mul__(self, other: object) -> int:
        return 1


class Child(Base):
    def __rmul__(self, other: object) -> Returned:
        return Returned()


def bad_return() -> str:
    result = Base() * Child() + Fallback()
    reveal_type(result, expected_text="int")
    # This should generate an error.
    return result


def bad_assignment():
    # This should generate an error.
    value: str = Base() * Child() + Fallback()


def parameterized(left: Base, right: Child) -> str:
    # This should generate an error.
    return left * right + Fallback()


def reversed_operands() -> str:
    # This should generate an error.
    return Child() * Base() + Fallback()


def augmented_assignment():
    value = Returned()
    value += Fallback()
    reveal_type(value, expected_text="int")


class AlwaysDeclines:
    def __add__(self, other: object) -> NotImplementedType:
        return NotImplemented


class StringFallback:
    def __radd__(self, other: object) -> str:
        return "fallback"


class SometimesDeclines:
    def __radd__(self, other: object) -> str | NotImplementedType:
        return NotImplemented


class ReflectedDeclines:
    def __radd__(self, other: object) -> NotImplementedType:
        return NotImplemented


class ReturnsNone:
    def __radd__(self, other: object) -> None:
        return None


def fallback_results(
    left: Returned,
    declines: AlwaysDeclines,
    right: StringFallback,
    sometimes: SometimesDeclines,
    both: ReflectedDeclines,
    returns_none: ReturnsNone,
):
    reveal_type(left + right, expected_text="int | str")
    reveal_type(declines + right, expected_text="str")
    reveal_type(left + sometimes, expected_text="int | str")
    reveal_type(declines + sometimes, expected_text="str")
    reveal_type(left + both, expected_text="int")
    reveal_type(left + returns_none, expected_text="int | None")
    reveal_type(left.__add__(right), expected_text="int | NotImplementedType")
    reveal_type(sometimes.__radd__(left), expected_text="str | NotImplementedType")
    # This should generate an error.
    _ = declines + both


class Raises:
    def __radd__(self, other: object) -> Never:
        raise RuntimeError


def never_fallback(left: AlwaysDeclines, right: Raises):
    reveal_type(left + right, expected_text="Never")


def partial_never_fallback(left: Returned, right: Raises):
    reveal_type(left + right, expected_text="int")


class SameType:
    def __add__(self, other: object) -> NotImplementedType:
        return NotImplemented

    def __radd__(self, other: object) -> str:
        return "not called"


class SamePartialType:
    def __add__(self, other: object) -> int | NotImplementedType:
        return 1

    def __radd__(self, other: object) -> str:
        return "not called"


def same_type(left: SameType, right: SameType, partial: SamePartialType):
    # This should generate an error.
    _ = left + right
    reveal_type(partial + partial, expected_text="int")


T = TypeVar("T")


class GenericDeclines(Generic[T]):
    def __add__(self, other: object) -> NotImplementedType:
        return NotImplemented

    def __radd__(self, other: object) -> str:
        return "not called"


def generic_same_type(left: GenericDeclines[int], right: GenericDeclines[str]):
    # This should generate an error.
    _ = left + right


class SameMeta(type):
    def __add__(cls, other: object) -> NotImplementedType:
        return NotImplemented

    def __radd__(cls, other: object) -> str:
        return "not called"


class First(metaclass=SameMeta): ...


class Second(metaclass=SameMeta): ...


def same_metaclass():
    # This should generate an error.
    _ = First + Second


class Comparison:
    def __lt__(self, other: object) -> int | NotImplementedType:
        return NotImplemented

    def __gt__(self, other: object) -> str | NotImplementedType:
        return NotImplemented


def comparison_control(left: Comparison, right: Comparison):
    reveal_type(left < right, expected_text="int | NotImplementedType")
