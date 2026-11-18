# Intrinsic flag returns use parameter bindings, including unpacked arguments.

from enum import EJECT, IntFlag
from typing import Literal, Never, TypedDict, TypeVar


class Flags(IntFlag, boundary=EJECT):
    A = 1
    B = 2


class Keep(IntFlag):
    A = 1


class Negative(IntFlag, boundary=EJECT):
    A = -1


class OtherArgs(TypedDict):
    other: Literal[0, 3]


class FullArgs(OtherArgs):
    self: Flags


class IntArgs(TypedDict):
    other: int


class FullIntArgs(IntArgs):
    self: Flags


def bound(flag: Flags, keywords: OtherArgs, positional: tuple[Literal[0, 3]]) -> Flags:
    reveal_type(flag.__or__(**keywords), expected_text="Flags")
    reveal_type(flag.__xor__(**keywords), expected_text="Flags")
    reveal_type(flag.__and__(**keywords), expected_text="Flags")
    reveal_type(flag.__ror__(*positional), expected_text="Flags")
    reveal_type(flag.__rxor__(*positional), expected_text="Flags")
    reveal_type(flag.__rand__(*positional), expected_text="Flags")
    operation = flag.__or__
    reveal_type(operation(**keywords), expected_text="Flags")
    return operation(*positional)


def concrete(keywords: FullArgs, positional: tuple[Flags, Literal[0, 3]]) -> Flags:
    reveal_type(Flags.__or__(**keywords), expected_text="Flags")
    reveal_type(Flags.__xor__(**keywords), expected_text="Flags")
    reveal_type(Flags.__and__(**keywords), expected_text="Flags")
    reveal_type(Flags.__ror__(*positional), expected_text="Flags")
    reveal_type(Flags.__rxor__(*positional), expected_text="Flags")
    reveal_type(Flags.__rand__(*positional), expected_text="Flags")
    return Flags.__or__(**keywords)


def unbound(keywords: FullArgs, positional: tuple[Flags, Literal[0, 3]]) -> Flags:
    reveal_type(IntFlag.__or__(**keywords), expected_text="Flags")
    reveal_type(IntFlag.__xor__(**keywords), expected_text="Flags")
    reveal_type(IntFlag.__and__(**keywords), expected_text="Flags")
    reveal_type(IntFlag.__ror__(*positional), expected_text="Flags")
    reveal_type(IntFlag.__rxor__(*positional), expected_text="Flags")
    reveal_type(IntFlag.__rand__(*positional), expected_text="Flags")
    return IntFlag.__or__(*positional)


def mixed(flag: Flags, keywords: OtherArgs, positional: tuple[Literal[0, 3]]) -> Flags:
    reveal_type(IntFlag.__or__(flag, *positional), expected_text="Flags")
    reveal_type(IntFlag.__xor__(*(flag,), **keywords), expected_text="Flags")
    reveal_type(IntFlag.__and__(*(flag,), other=3), expected_text="Flags")
    return IntFlag.__or__(other=3, self=flag)


def correlated(positional: tuple[Flags, Literal[0]] | tuple[Keep, int]) -> Flags | Keep:
    reveal_type(IntFlag.__or__(*positional), expected_text="Flags | Keep")
    reveal_type(IntFlag.__xor__(*positional), expected_text="Flags | Keep")
    reveal_type(IntFlag.__and__(*positional), expected_text="Flags | Keep")
    return IntFlag.__or__(*positional)


FlagT = TypeVar("FlagT", bound=Flags)


def generic(flag: FlagT, positional: tuple[FlagT, Literal[0]]) -> FlagT:
    reveal_type(flag.__or__(*(3,)), expected_text="FlagT@generic")
    reveal_type(IntFlag.__or__(*positional), expected_text="FlagT@generic")
    return IntFlag.__or__(*positional)


def negative(flag: Negative) -> Negative:
    reveal_type(flag.__or__(*(0,)), expected_text="Negative")
    reveal_type(Negative.__xor__(*(flag, 0)), expected_text="Negative")
    reveal_type(IntFlag.__and__(*(flag, 0)), expected_text="Negative")
    return flag.__xor__(*(0,))


def boolean(flag: Flags, values: tuple[bool]) -> Flags:
    return flag.__or__(*values)


def empty(flag: Flags, value: Never) -> Flags:
    return flag.__or__(value)


def invalid_bound(flag: Flags, keywords: IntArgs, positional: tuple[int]):
    # Each should generate an error: arbitrary operands may eject.
    flag.__or__(**keywords).name
    flag.__xor__(*positional).name


def invalid_unbound(keywords: FullIntArgs, positional: tuple[Flags, int]):
    # Each should generate an error: binding arguments does not prove safe bits.
    IntFlag.__or__(**keywords).name
    IntFlag.__xor__(*positional).name
