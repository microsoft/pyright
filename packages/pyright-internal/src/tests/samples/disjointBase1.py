"""
Tests the typing.disjoint_base decorator introduced in PEP 800.
"""

# Specification: https://typing.readthedocs.io/en/latest/spec/directives.html#disjoint-base
# See also https://peps.python.org/pep-0800/

from dataclasses import dataclass
from typing import Any, NamedTuple, Protocol, TypedDict
from typing_extensions import disjoint_base  # pyright: ignore[reportMissingModuleSource]


def _unknown_base() -> Any: ...


# > It may only be used on nominal classes, including ``NamedTuple``
# > definitions


@disjoint_base
class Left:
    pass


@disjoint_base
class Right:
    pass


@disjoint_base
class LeftChild(Left):
    pass


@disjoint_base
class Record(NamedTuple):
    value: int


class Plain:
    pass


# > If the candidate set contains a single disjoint base, that is the
# > class's disjoint base.


class OtherLeftChild(Left):
    pass


# > If there are multiple candidates, but one of them is a subclass of
# > all other candidates, that class is the disjoint base.


class LeftAndPlain(Left, Plain):
    pass


class LeftChildAndLeft(LeftChild, Left):
    pass


class PlainRecord(Plain, Record):
    pass


# > Type checkers must check for a valid disjoint base when checking class definitions,
# > and emit a diagnostic if they encounter a class
# > definition that lacks a valid disjoint base.


class LeftAndRight(Left, Right):  # This should generate an error
    pass


class LeftChildAndRight(LeftChild, Right):  # This should generate an error
    pass


class LeftAndRightViaChild(LeftAndPlain, Right):  # This should generate an error
    pass


# `Plain` resolves to `object` as its disjoint base. Since `object` is
# compatible with every disjoint base, it must not appear in the reported
# incompatible-base names even though it sits between the conflicting bases.


class LeftPlainRight(Left, Plain, Right):  # This should generate an error
    pass


class LeftRecord(Left, Record):  # This should generate an error
    pass


# An unknown base cannot relate two otherwise-incompatible disjoint bases, so
# the conflict between the known bases must still be reported.


class LeftAndRightWithUnknown(Left, Right, _unknown_base()):  # This should generate an error
    pass


# A known disjoint base inherited transitively through a class whose own MRO
# contains an unknown base must still be reported as conflicting.


class LeftWithUnknown(Left, _unknown_base()):
    pass


class LeftWithUnknownAndRight(LeftWithUnknown, Right):  # This should generate an error
    pass


# > A nominal class is a disjoint base if it [...] contains a non-empty
# > `__slots__` definition.


class SlotBase1:
    __slots__ = ("x",)


class SlotBase2:
    __slots__ = ("y",)


class EmptySlots:
    __slots__ = ()


class SlotAndEmptySlots(SlotBase1, EmptySlots):
    pass


class IncompatibleSlots(SlotBase1, SlotBase2):  # This should generate an error
    pass


@dataclass(slots=True)
class SlottedDataClass:
    value: int


class SlottedDataClassConflict(SlottedDataClass, SlotBase1):  # This should generate an error
    pass


@dataclass(slots=True)
class EmptySlottedDataClass:
    pass


class SlotAndEmptySlottedDataClass(SlotBase1, EmptySlottedDataClass):
    pass


class SlottedProtocol(Protocol):
    __slots__ = ("value",)


class SlotAndSlottedProtocol(SlotBase1, SlottedProtocol):
    pass


# > it is a type checker error to use the decorator on a function,
# > ``TypedDict`` definition, or ``Protocol`` definition.


@disjoint_base  # This should generate an error
def func() -> None:
    pass


@disjoint_base  # This should generate an error
class Movie(TypedDict):
    name: str


@disjoint_base  # This should generate an error
class SupportsClose(Protocol):
    def close(self) -> None:
        ...
