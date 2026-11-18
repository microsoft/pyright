# Flag boundaries affect the standard bitwise methods, not user-defined methods.

from enum import CONFORM, EJECT, KEEP, STRICT, FlagBoundary, IntFlag, auto
from typing import Callable, Literal, TypedDict, TypeVar


class EjectFlag(IntFlag, boundary=EJECT):
    A = 1
    B = 2


class KeepFlag(IntFlag):
    A = 1


class ExplicitKeep(IntFlag, boundary=KEEP):
    A = 1


class StrictFlag(IntFlag, boundary=STRICT):
    A = 1


class ConformFlag(IntFlag, boundary=CONFORM):
    A = 1


class EjectBase(IntFlag, boundary=EJECT):
    pass


class InheritedEject(EjectBase):
    A = 1


class OverriddenKeep(EjectBase, boundary=KEEP):
    A = 1


class NegativeEject(IntFlag, boundary=EJECT):
    A = -1


class AutoEject(IntFlag, boundary=EJECT):
    A = auto()
    B = auto()
    AB = A | B
    C = auto()


class SparseEject(IntFlag, boundary=EJECT):
    A = 1
    B = 4


class BooleanEject(IntFlag, boundary=EJECT):
    A = True


class CustomEject(IntFlag, boundary=EJECT):
    A = 1

    def __ror__(self, other: int) -> str:
        return "custom"


def bitwise(value: int, flag: EjectFlag):
    reveal_type(value | flag, expected_text="int")
    reveal_type(flag | value, expected_text="int")
    reveal_type(value ^ flag, expected_text="int")
    reveal_type(flag ^ value, expected_text="int")
    reveal_type(value & flag, expected_text="int")
    reveal_type(flag & value, expected_text="int")
    reveal_type(flag | flag, expected_text="EjectFlag")
    reveal_type(flag ^ flag, expected_text="EjectFlag")
    reveal_type(flag & flag, expected_text="EjectFlag")
    reveal_type(flag.__ror__(value), expected_text="int")
    reveal_type(flag.__or__(value), expected_text="int")
    reveal_type(EjectFlag.__ror__(flag, value), expected_text="int")
    reveal_type(flag.__rand__(value), expected_text="int")
    reveal_type(flag.__or__(flag), expected_text="EjectFlag")
    bound = flag.__ror__
    reveal_type(bound(value), expected_text="int")
    reveal_type(bound(flag), expected_text="EjectFlag")
    reveal_type(flag | 3, expected_text="EjectFlag")
    reveal_type(flag ^ 3, expected_text="EjectFlag")
    reveal_type(flag | 8, expected_text="int")
    reveal_type(flag.__ror__(0), expected_text="EjectFlag")
    reveal_type(EjectFlag.__ror__(flag, 3), expected_text="EjectFlag")
    reveal_type(IntFlag.__ror__(flag, value), expected_text="int")
    reveal_type(IntFlag.__or__(flag, 3), expected_text="EjectFlag")
    reveal_type(IntFlag.__or__(other=3, self=flag), expected_text="EjectFlag")
    reveal_type(flag | -1, expected_text="EjectFlag")
    reveal_type(flag ^ -4, expected_text="EjectFlag")
    reveal_type(flag | -8, expected_text="int")
    reveal_type(flag | KeepFlag.A, expected_text="EjectFlag")
    reveal_type(flag | True, expected_text="EjectFlag")
    reveal_type(IntFlag.__or__(KeepFlag.A, value), expected_text="KeepFlag")
    function: Callable[[int], int] = flag.__ror__
    reveal_type(function(value), expected_text="int")


def unsafe(value: int):
    # Each should generate an error: EJECT can return int.
    (value | EjectFlag.A).name
    (value ^ EjectFlag.A).name
    (EjectFlag.A | value).name
    EjectFlag.A.__ror__(value).name
    (value & EjectFlag.A).name
    (EjectFlag.A & value).name
    EjectFlag.A.__and__(value).name


class OperatorArgs(TypedDict):
    self: EjectFlag
    other: int


def general(flag: IntFlag, value: int, arguments: OperatorArgs):
    reveal_type(flag | value, expected_text="int")
    reveal_type(flag & value, expected_text="int")
    reveal_type(flag ^ value, expected_text="int")
    # Each should generate an error: the receiver may have EJECT behavior.
    (flag | value).name
    IntFlag.__or__(**arguments).name


class OpenFlag(IntFlag):
    pass


def open_base(flag: OpenFlag, value: int):
    reveal_type(flag | value, expected_text="int")


def valid(value: int, flag: EjectFlag):
    reveal_type((0 & flag).name, expected_text="str | None")
    reveal_type(value | KeepFlag.A, expected_text="KeepFlag")
    reveal_type(value ^ KeepFlag.A, expected_text="KeepFlag")
    reveal_type(value | ExplicitKeep.A, expected_text="ExplicitKeep")
    reveal_type(value | StrictFlag.A, expected_text="StrictFlag")
    reveal_type(value | ConformFlag.A, expected_text="ConformFlag")
    reveal_type(value | InheritedEject.A, expected_text="int")
    reveal_type(value | OverriddenKeep.A, expected_text="OverriddenKeep")
    reveal_type(value | CustomEject.A, expected_text="str")
    reveal_type(value & NegativeEject.A, expected_text="int")
    reveal_type(NegativeEject.A & value, expected_text="int")
    reveal_type(value & AutoEject.A, expected_text="int")
    reveal_type(AutoEject.A | AutoEject.B, expected_text="AutoEject")
    reveal_type(AutoEject.A | 7, expected_text="AutoEject")
    reveal_type(AutoEject.A | 8, expected_text="int")
    reveal_type(BooleanEject.A & value, expected_text="int")
    reveal_type(SparseEject.A | -1, expected_text="int")
    reveal_type(SparseEject.A | -3, expected_text="SparseEject")


def augmentation(value: int, flag: EjectFlag):
    a = value
    a |= flag
    reveal_type(a, expected_text="int")
    b = value
    b ^= flag
    reveal_type(b, expected_text="int")
    c = value
    c &= flag
    reveal_type(c, expected_text="int")
    d = flag
    d |= value
    reveal_type(d, expected_text="int")
    e = flag
    e ^= value
    reveal_type(e, expected_text="int")


def dynamic_boundary(boundary: FlagBoundary):
    class DynamicFlag(IntFlag, boundary=boundary):
        A = 1

    reveal_type(DynamicFlag.A.__ror__(int()), expected_text="int")


def aliased_boundary():
    boundary: Literal[FlagBoundary.EJECT] = EJECT

    class AliasedFlag(IntFlag, boundary=boundary):
        A = 1

    reveal_type(AliasedFlag.A.__ror__(int()), expected_text="int")


def optional_boundary(boundary: Literal[FlagBoundary.KEEP] | None):
    class OptionalFlag(EjectBase, boundary=boundary):
        A = 1

    reveal_type(OptionalFlag.A.__ror__(int()), expected_text="int")


FlagT = TypeVar("FlagT", bound=EjectFlag)


def generic(flag: FlagT) -> FlagT:
    reveal_type(flag | flag, expected_text="FlagT@generic")
    reveal_type(flag | 3, expected_text="FlagT@generic")
    reveal_type(flag & 0, expected_text="FlagT@generic")
    reveal_type(flag & int(), expected_text="int")
    reveal_type(flag | int(), expected_text="int")
    return flag | flag


Functional = IntFlag("Functional", {"A": 1}, boundary=EJECT)
reveal_type(Functional.A.__ror__(int()), expected_text="int")
reveal_type(Functional.A.__and__(int()), expected_text="int")

FunctionalNames = IntFlag("FunctionalNames", "A B C", boundary=EJECT)
reveal_type(FunctionalNames.C.value, expected_text="Literal[4]")
reveal_type(FunctionalNames.A | 7, expected_text="FunctionalNames")
reveal_type(FunctionalNames.A | 8, expected_text="int")

FunctionalStart = IntFlag("FunctionalStart", ["A", "B", "C"], boundary=EJECT, start=8)
reveal_type(FunctionalStart.C.value, expected_text="Literal[32]")
reveal_type(FunctionalStart.A | 3, expected_text="int")
reveal_type(FunctionalStart.A | 56, expected_text="FunctionalStart")
