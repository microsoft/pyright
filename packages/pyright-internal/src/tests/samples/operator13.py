# This sample tests that the reflected form of a binary operator is given
# priority when the right operand's type is a proper subclass of the left
# operand's type and it overrides the reflected magic method.

from enum import IntFlag, auto
from types import NotImplementedType
from typing import Never, Self, overload


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


class RebindingBase:
    def __add__(self, other: object) -> int:
        return 7

    def __radd__(self, other: object) -> str:
        return "reflected"


class SameImplementation(RebindingBase):
    __radd__ = RebindingBase.__radd__


class DifferentImplementation(RebindingBase):
    def reflected(self, other: object) -> str:
        return "different"

    __radd__ = reflected


class Intermediate(RebindingBase): ...


class IndirectSameImplementation(Intermediate):
    __radd__ = Intermediate.__radd__


class Mixin: ...


class MultipleInheritance(Mixin, DifferentImplementation): ...


def func3(
    base: RebindingBase,
    same: SameImplementation,
    different: DifferentImplementation,
    indirect: IndirectSameImplementation,
    multiple: MultipleInheritance,
):
    reveal_type(base + same, expected_text="int")
    reveal_type((base + same).bit_length(), expected_text="int")
    reveal_type(base + indirect, expected_text="int")
    reveal_type(base + different, expected_text="str")
    reveal_type(base + multiple, expected_text="str")

    value = RebindingBase()
    value += same
    reveal_type(value, expected_text="int")


class OverloadedBase:
    def __add__(self, other: object) -> int:
        return 7

    @overload
    def __radd__(self, other: "OverloadedBase") -> str: ...
    @overload
    def __radd__(self, other: int) -> str: ...
    def __radd__(self, other: "OverloadedBase | int") -> str:
        return "reflected"


class SameOverloadedImplementation(OverloadedBase):
    __radd__ = OverloadedBase.__radd__


def func4(base: OverloadedBase, same: SameOverloadedImplementation):
    reveal_type(base + same, expected_text="int")


class DeclineBase:
    def __add__(self, other: object) -> int:
        return 7


class Declines(DeclineBase):
    def __radd__(self, other: object) -> NotImplementedType:
        return NotImplemented


class SometimesDeclines(DeclineBase):
    def __radd__(self, other: object) -> str | NotImplementedType:
        return NotImplemented


class ReturnsNone(DeclineBase):
    def __radd__(self, other: object) -> None:
        return None


class Inapplicable(DeclineBase):
    def __radd__(self, other: str) -> str:
        return other


def func5(
    base: DeclineBase,
    declines: Declines,
    sometimes: SometimesDeclines,
    returns_none: ReturnsNone,
    inapplicable: Inapplicable,
):
    reveal_type(base + declines, expected_text="int")
    reveal_type((base + declines).bit_length(), expected_text="int")
    reveal_type(base + sometimes, expected_text="str | int")
    reveal_type(base + returns_none, expected_text="None")
    reveal_type(base + inapplicable, expected_text="int")
    reveal_type(declines.__radd__(base), expected_text="NotImplementedType")

    value = DeclineBase()
    value += declines
    reveal_type(value, expected_text="int")


class Raises:
    def __add__(self, other: object) -> Never:
        raise RuntimeError


class DeclinesToRaises(Raises):
    def __radd__(self, other: object) -> NotImplementedType:
        return NotImplemented


def func6(base: Raises, declines: DeclinesToRaises):
    reveal_type(base + declines, expected_text="Never")


class BothDecline:
    def __add__(self, other: object) -> NotImplementedType:
        return NotImplemented


class AlsoDeclines(BothDecline):
    def __radd__(self, other: object) -> NotImplementedType:
        return NotImplemented


def func7(base: BothDecline, declines: AlsoDeclines):
    # This should generate an error because neither implementation supports addition.
    _ = base + declines


class ComparisonBase:
    def __lt__(self, other: object) -> int:
        return 7

    def __gt__(self, other: object) -> str:
        return "reflected"


class ComparisonAlias(ComparisonBase):
    __gt__ = ComparisonBase.__gt__


def func8(base: ComparisonBase, alias: ComparisonAlias):
    # Unlike arithmetic, comparisons prioritize the subclass even for the same function.
    reveal_type(base < alias, expected_text="str")


class RaisesFirst(DeclineBase):
    def __radd__(self, other: object) -> Never:
        raise RuntimeError


def func9(base: DeclineBase, raises: RaisesFirst):
    reveal_type(base + raises, expected_text="Never")


class SometimesDecliningBase:
    def __add__(self, other: object) -> int | NotImplementedType:
        return 7


class AlwaysDeclines(SometimesDecliningBase):
    def __radd__(self, other: object) -> NotImplementedType:
        return NotImplemented


class SometimesAlsoDeclines(BothDecline):
    def __radd__(self, other: object) -> str | NotImplementedType:
        return "reflected"


def func10(base: SometimesDecliningBase, declines: AlwaysDeclines, both: BothDecline, sometimes: SometimesAlsoDeclines):
    reveal_type(base + declines, expected_text="int")
    reveal_type(both + sometimes, expected_text="str")


def make_reflected():
    def reflected(self: object, other: object) -> str:
        return "reflected"

    return reflected


class FactoryBase:
    def __add__(self, other: object) -> int:
        return 7

    __radd__ = make_reflected()


class FactoryDerived(FactoryBase):
    __radd__ = make_reflected()


class FactoryAlias(FactoryBase):
    __radd__ = FactoryBase.__radd__


def func11(base: FactoryBase, derived: FactoryDerived, alias: FactoryAlias):
    reveal_type(base + derived, expected_text="str")
    reveal_type(base + alias, expected_text="int")
