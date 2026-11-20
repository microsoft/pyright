# Intrinsic flag results also apply when assigning operator methods to callbacks.

from enum import EJECT, IntEnum, IntFlag
from typing import Callable, Literal, Never, Protocol, TypeVar


class Flags(IntFlag, boundary=EJECT):
    A = 1
    B = 2


class Keep(IntFlag):
    A = 1


class Negative(IntFlag, boundary=EJECT):
    A = -1


class Large(IntFlag, boundary=EJECT):
    A = 1606938044258990275541962092341162602522202993782792835301376


class Integers(IntEnum):
    ZERO = 0
    THREE = 3


def zero(flag: Flags) -> Callable[[Literal[0]], Flags]:
    return flag.__or__


def union(flag: Flags) -> Callable[[Literal[0, 1, 3]], Flags]:
    return flag.__xor__


def negative_operand(flag: Flags) -> Callable[[Literal[-1]], Flags]:
    return flag.__or__


def negative_flag(flag: Negative) -> Callable[[Literal[0]], Negative]:
    return flag.__xor__


def large(flag: Large) -> Callable[
    [Literal[1606938044258990275541962092341162602522202993782792835301376]], Large
]:
    return flag.__or__


def boolean(flag: Flags) -> Callable[[bool], Flags]:
    return flag.__or__


def enum_argument(flag: Flags) -> Callable[[Integers], Flags]:
    return flag.__or__


def captured(flag: Flags) -> Callable[[Literal[3]], Flags]:
    operation = flag.__or__
    return operation


def unbound() -> Callable[[Flags, Literal[0]], Flags]:
    return IntFlag.__or__


def unbound_keep() -> Callable[[Keep, int], Keep]:
    return IntFlag.__or__


class KeywordCallback(Protocol):
    def __call__(self, *, other: Literal[3]) -> Flags: ...


def keyword(flag: Flags) -> KeywordCallback:
    return flag.__or__


class UnboundKeywordCallback(Protocol):
    def __call__(_self, *, other: Literal[3], self: Flags) -> Flags: ...


def unbound_keyword() -> UnboundKeywordCallback:
    return IntFlag.__or__


FlagT = TypeVar("FlagT", bound=Flags)


def generic(flag: FlagT) -> Callable[[Literal[3]], FlagT]:
    return flag.__or__


def factory(flag: FlagT, other: FlagT):
    operation: Callable[[int], int] = flag.__or__
    return operation


def factory_check(flag: Flags):
    operation = factory(flag, flag)
    reveal_type(operation(3), expected_text="Flags")
    callback: Callable[[Literal[3]], Flags] = operation
    reveal_type(callback(3), expected_text="Flags")


def unbound_union() -> Callable[[Flags | Keep, Literal[0]], Flags | Keep]:
    return IntFlag.__or__


UnionT = TypeVar("UnionT", bound=Flags | Keep)


def unbound_generic() -> Callable[[UnionT, Literal[0]], UnionT]:
    return IntFlag.__or__


def empty_domain(flag: Flags) -> tuple[
    Callable[[Never], Flags], Callable[[Never], Flags], Callable[[Never], Flags]
]:
    return flag.__or__, flag.__xor__, flag.__and__


def negative_empty_domain(flag: Negative) -> tuple[
    Callable[[Never], Negative], Callable[[Never], Negative], Callable[[Never], Negative]
]:
    return flag.__or__, flag.__xor__, flag.__and__


def invalid_empty_return(flag: Flags) -> Callable[[Never], str]:
    # This should generate an error: empty domains do not relax return compatibility.
    return flag.__or__


def unsafe(flag: Flags) -> Callable[[int], Flags]:
    # This should generate an error: arbitrary ints may eject.
    return flag.__or__


def invalid_literal(flag: Flags) -> Callable[[Literal[8]], Flags]:
    # This should generate an error: the bit is outside the enum's mask.
    return flag.__or__


def invalid_union(flag: Flags) -> Callable[[Literal[0, 8]], Flags]:
    # This should generate an error: one alternative may eject.
    return flag.__or__


def invalid_parameter(flag: Flags) -> Callable[[str], Flags]:
    # This should generate an error: return refinement cannot repair parameter mismatches.
    return flag.__or__


def invalid_receiver() -> Callable[[str, Literal[0]], Flags]:
    # This should generate an error: the unbound receiver must be an IntFlag.
    return IntFlag.__or__


def invalid_boolean(flag: Large) -> Callable[[bool], Large]:
    # This should generate an error: True would introduce an invalid bit.
    return flag.__or__
