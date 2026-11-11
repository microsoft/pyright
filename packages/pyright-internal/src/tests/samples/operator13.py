# This sample tests reflected arithmetic precedence without changing ordinary
# operator fallback or the meaning of direct dunder calls.

from enum import IntFlag, auto
from types import NotImplementedType
from typing import Generic, TypeVar


class Flags(IntFlag):
    A = auto()
    B = auto()


def flags_check(value: int, flag: Flags):
    reveal_type(value & flag, expected_text="Flags")
    reveal_type(value | flag, expected_text="Flags")
    reveal_type(value ^ flag, expected_text="Flags")
    reveal_type(flag & value, expected_text="Flags")
    reveal_type(flag | value, expected_text="Flags")
    reveal_type(flag ^ value, expected_text="Flags")
    reveal_type(value & Flags.A, expected_text="Flags")
    reveal_type(value | Flags.A, expected_text="Flags")
    reveal_type(value ^ Flags.A, expected_text="Flags")
    reveal_type(value & int(), expected_text="int")
    reveal_type(value | int(), expected_text="int")
    reveal_type(value ^ int(), expected_text="int")
    reveal_type(value.__and__(flag), expected_text="int")
    reveal_type(flag.__rand__(value), expected_text="Flags")

    a = value
    a &= flag
    reveal_type(a, expected_text="Flags")
    b = value
    b |= flag
    reveal_type(b, expected_text="Flags")
    c = value
    c ^= flag
    reveal_type(c, expected_text="Flags")

    flag &= value
    reveal_type(flag, expected_text="Flags")
    flag |= value
    reveal_type(flag, expected_text="Flags")
    flag ^= value
    reveal_type(flag, expected_text="Flags")


class Base:
    def __add__(self, other: object) -> str:
        return "forward"

    def __radd__(self, other: object) -> object:
        return "base reflected"


class Override(Base):
    def __radd__(self, other: object) -> int:
        return 1


class Inherited(Base):
    pass


class Leaf(Override):
    pass


class Alias(Base):
    __radd__ = Base.__radd__


class NewAlias(Base):
    def reflect(self, other: object) -> int:
        return 1

    __radd__ = reflect


class Declines(Base):
    def __radd__(self, other: object) -> NotImplementedType:
        return NotImplemented


class MaybeDeclines(Base):
    def __radd__(self, other: object) -> int | NotImplementedType:
        return 1 if bool() else NotImplemented


class InferredDecline(Base):
    def __radd__(self, other: object):
        return NotImplemented


class Unrelated:
    def __radd__(self, other: object) -> int:
        return 1


class InPlace(Base):
    def __iadd__(self, other: object) -> float:
        return 1.0


class ForwardDeclines:
    def __add__(self, other: object) -> NotImplementedType:
        return NotImplemented

    def __radd__(self, other: object) -> object:
        return 0


class PartialOverride(ForwardDeclines):
    def __radd__(self, other: object) -> int | NotImplementedType:
        return 1 if bool() else NotImplemented


def partial_check(base: ForwardDeclines, child: PartialOverride):
    reveal_type(base + child, expected_text="int")


class FullOverride(ForwardDeclines):
    def __radd__(self, other: object) -> NotImplementedType:
        return NotImplemented


def full_decline_check(base: ForwardDeclines, child: FullOverride):
    # This should generate an error because both implementations decline.
    _ = base + child


def precedence_check(base: Base, override: Override):
    reveal_type(base + override, expected_text="int")
    reveal_type(base + Inherited(), expected_text="str")
    reveal_type(base + Leaf(), expected_text="int")
    reveal_type(base + Alias(), expected_text="str")
    reveal_type(base + NewAlias(), expected_text="int")
    reveal_type(base + Declines(), expected_text="str")
    reveal_type(base + MaybeDeclines(), expected_text="int | str")
    reveal_type(base + InferredDecline(), expected_text="str")
    reveal_type(base + Unrelated(), expected_text="str")
    reveal_type(override + base, expected_text="str")
    reveal_type(override + override, expected_text="str")
    reveal_type(base.__add__(override), expected_text="str")
    reveal_type(Declines().__radd__(base), expected_text="NotImplementedType")

    inplace = InPlace()
    inplace += override
    reveal_type(inplace, expected_text="float")


T = TypeVar("T")
FlagT = TypeVar("FlagT", bound=Flags)


def generic_flags_check(value: int, flag: FlagT) -> FlagT:
    reveal_type(value & flag, expected_text="FlagT@generic_flags_check")
    reveal_type(value | flag, expected_text="FlagT@generic_flags_check")
    reveal_type(value ^ flag, expected_text="FlagT@generic_flags_check")
    return value & flag


class Series(Generic[T]):
    def __add__(self, other: T) -> "Series[T]":
        return self

    def __radd__(self, other: "Series[T]") -> "Series[T]":
        return self


def generic_check(series: Series[int]):
    reveal_type(series + series, expected_text="Series[int]")


class GenericBase(Generic[T]):
    def __init__(self, value: T):
        self.value = value

    def __add__(self, other: object) -> str:
        return "forward"

    def __radd__(self, other: object) -> T:
        return self.value


class GenericChild(GenericBase[int]):
    pass


def generic_inheritance_check(base: GenericBase[str], child: GenericChild):
    reveal_type(base + child, expected_text="str")


def resize(size: list[int], short: int, long: int):
    requested = size if isinstance(size, int) else size[0]
    reveal_type(long * requested, expected_text="int")
    return int(long * requested / short)


def padding_check(padding: tuple[int, int], limit: int):
    py, px = (padding, padding) if isinstance(padding, int) else padding
    reveal_type(2 * py, expected_text="int")
    return 0 <= 2 * py <= limit and 0 <= 2 * px <= limit
