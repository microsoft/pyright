# This sample tests that the reflected form of a binary operator is given
# priority when the right operand's type is a proper subclass of the left
# operand's type and it overrides the reflected magic method.

from enum import IntFlag, auto
from typing import Self


class Flags(IntFlag):
    A = auto()
    B = auto()


reveal_type(int() & Flags.A, expected_text="Flags")
reveal_type(int() | Flags.A, expected_text="Flags")
reveal_type(int() ^ Flags.A, expected_text="Flags")

# The left operand's own method is used when both operands have the same type.
reveal_type(int() & int(), expected_text="int")


class Base:
    def __add__(self, other: "Base") -> "Base": ...

    def __radd__(self, other: "Base") -> "Base": ...


class Derived(Base):
    def __radd__(self, other: Base) -> Self:
        return self


class DerivedNoOverride(Base): ...


def func1(base: Base, derived: Derived, no_override: DerivedNoOverride):
    # The subclass overrides __radd__, so it takes priority.
    reveal_type(base + derived, expected_text="Derived")

    # The subclass doesn't override __radd__, so the normal order applies.
    reveal_type(base + no_override, expected_text="Base")

    # The right operand isn't a subclass of the left operand.
    reveal_type(derived + base, expected_text="Base")


# A class-scoped assignment that aliases a method overrides a method of the
# same name in a base class rather than adopting its declared signature.
class Base2:
    def __and__(self, other: "Base2") -> "Base2": ...

    def __rand__(self, other: "Base2") -> "Base2": ...


class Derived2(Base2):
    def __and__(self, other: "Base2") -> "Derived2": ...

    __rand__ = __and__


def func2(base: Base2, derived: Derived2):
    reveal_type(base & derived, expected_text="Derived2")
