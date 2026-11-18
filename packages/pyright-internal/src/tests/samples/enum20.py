# Numeric values only prove EJECT closure when the operand operation is standard.

from enum import EJECT, IntEnum, IntFlag
from typing import Callable, Literal, TypedDict


class Flags(IntFlag, boundary=EJECT):
    A = 1
    B = 2


class TwistedInt(int):
    def __rand__(self, other: int, /) -> int:
        return 8


class TwistedEnum(IntEnum):
    ZERO = 0

    def __ror__(self, other: int, /) -> int:
        return 8

    def __rxor__(self, other: int, /) -> int:
        return 8

    def __rand__(self, other: int, /) -> int:
        return 8


class Integers(IntEnum):
    ZERO = 0
    THREE = 3
    NEGATIVE = -1


class AliasedIntegers(IntEnum):
    ZERO = 0
    THREE = 3
    __ror__ = int.__or__
    __rxor__ = int.__rxor__
    __rand__ = int.__and__


class Operand(TypedDict):
    other: Literal[TwistedEnum.ZERO]


def unsafe(value: int, flag: Flags, arguments: Operand):
    reveal_type(flag.__and__(value), expected_text="int")
    reveal_type(flag & TwistedInt(0), expected_text="int")
    reveal_type(flag | TwistedEnum.ZERO, expected_text="int")
    reveal_type(flag ^ TwistedEnum.ZERO, expected_text="int")
    reveal_type(flag & TwistedEnum.ZERO, expected_text="int")
    # Each should generate an error: a valid reflected method can introduce bit8.
    flag.__and__(value).name
    flag.__or__(TwistedEnum.ZERO).name
    IntFlag.__xor__(flag, TwistedEnum.ZERO).name
    flag.__and__(**arguments).name


def unsafe_int_callback(flag: Flags) -> Callable[[int], Flags]:
    # This should generate an error: int includes subclasses with custom reflection.
    return flag.__and__


def unsafe_enum_callback(flag: Flags) -> Callable[[TwistedEnum], Flags]:
    # This should generate an error: finite values alone do not prove closure.
    return flag.__or__


def unsafe_literal_callback(flag: Flags) -> Callable[[Literal[TwistedEnum.ZERO]], Flags]:
    # This should generate an error: a literal enum retains its reflected methods.
    return flag.__xor__


def unsafe_unbound_callback() -> Callable[[Flags, TwistedInt], Flags]:
    # This should generate an error: unbound methods use the same operand proof.
    return IntFlag.__and__


def safe(flag: Flags, value: Integers, alias: AliasedIntegers, boolean: bool):
    reveal_type(flag & value, expected_text="Flags")
    reveal_type(flag | Integers.THREE, expected_text="Flags")
    reveal_type(flag ^ Integers.ZERO, expected_text="Flags")
    reveal_type(flag & alias, expected_text="Flags")
    reveal_type(flag | alias, expected_text="Flags")
    reveal_type(flag ^ alias, expected_text="Flags")
    reveal_type(flag & boolean, expected_text="Flags")
    reveal_type(flag & -8, expected_text="Flags")
    reveal_type(flag & 8, expected_text="Flags")
    reveal_type(flag & flag, expected_text="Flags")


def safe_boolean_callback(flag: Flags) -> Callable[[bool], Flags]:
    return flag.__and__


def safe_enum_callback(flag: Flags) -> Callable[[Integers], Flags]:
    return flag.__and__


def safe_literal_callback(flag: Flags) -> Callable[[Literal[-8, 0, 8]], Flags]:
    return flag.__and__


def safe_alias_callback(flag: Flags) -> Callable[[AliasedIntegers], Flags]:
    return flag.__or__
