# Inherited value storage can change both the flag mask and enum alias payloads.

from enum import EJECT, IntEnum, IntFlag
from typing import Callable, Literal


class ValueMixin:
    _value_: int = 8


class StoredFlag(ValueMixin, IntFlag, boundary=EJECT):
    A = 1


class StoredValues(ValueMixin, IntEnum):
    ONE = 1
    TWO = 2


class OnlyTwo(IntFlag, boundary=EJECT):
    TWO = 2


def stored_name(flag: StoredFlag) -> str | None:
    # This should generate an error: the actual value is 8 and the operation ejects 9.
    return flag.__or__(1).name


def stored_callback(flag: StoredFlag) -> Callable[[Literal[1]], StoredFlag]:
    # This should generate an error: custom storage invalidates assigned-value proofs.
    return flag.__or__


def operand_name(flag: OnlyTwo) -> str | None:
    # This should generate an error: TWO aliases ONE at runtime and introduces bit 1.
    return flag.__or__(StoredValues.TWO).name


def operand_callback(flag: OnlyTwo) -> Callable[[Literal[StoredValues.TWO]], OnlyTwo]:
    # This should generate an error: enum literal values require standard storage too.
    return flag.__or__


class NumericValue(int):
    def __and__(self, other: int, /) -> int:
        return 9

    def __xor__(self, other: int, /) -> int:
        return 9


class NumericStorage:
    _value_: int = NumericValue(8)


class NumericFlag(NumericStorage, IntFlag, boundary=EJECT):
    A = 1


def stored_and_name(flag: NumericFlag) -> str | None:
    # This should generate an error: int storage may have custom forward operations.
    return flag.__and__(8).name


def stored_xor_name(flag: NumericFlag) -> str | None:
    # This should generate an error: the stored operation ejects 9.
    return flag.__xor__(1).name


def stored_and_callback(flag: NumericFlag) -> Callable[[Literal[8]], NumericFlag]:
    # This should generate an error: a literal operand cannot repair custom storage.
    return flag.__and__


def stored_xor_callback(flag: NumericFlag) -> Callable[[Literal[1]], NumericFlag]:
    # This should generate an error: callback proofs require standard storage too.
    return flag.__xor__


class OrdinaryMixin:
    description: str = "ordinary"


class OrdinaryFlag(OrdinaryMixin, IntFlag, boundary=EJECT):
    A = 1
    B = 2


def ordinary(flag: OrdinaryFlag) -> Callable[[Literal[3]], OrdinaryFlag]:
    reveal_type(flag | 3, expected_text="OrdinaryFlag")
    reveal_type(flag & 8, expected_text="OrdinaryFlag")
    return flag.__or__
