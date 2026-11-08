# This sample tests receiver specialization after call-site return inference.

from typing import Generic, TypeVar


class Base:
    def pick(self, argument):
        if argument:
            return self
        return argument

    def concrete(self, argument):
        if argument:
            return Base()
        return argument

    def declared(self, argument) -> "Base":
        return self

    @classmethod
    def make(cls, argument):
        if argument:
            return cls()
        return argument

    @staticmethod
    def identity(argument):
        return argument


class Derived(Base):
    def derived_only(self) -> int:
        return 42


class Other(Base):
    pass


def demonstrate(value: Derived, other: Other):
    selected = value.pick(1)
    reveal_type(selected, expected_text="Derived")
    selected.derived_only()

    reveal_type(other.pick(1), expected_text="Other")
    reveal_type(value.pick(1), expected_text="Derived")
    reveal_type(other.pick(0), expected_text="Other | Literal[0]")
    reveal_type(value.pick(""), expected_text="Derived | Literal['']")
    reveal_type(other.pick(1), expected_text="Other")
    reveal_type(Base.pick(value, 1), expected_text="Derived")
    reveal_type(Base.pick(other, 1), expected_text="Other")
    reveal_type(value.concrete(1), expected_text="Base")
    reveal_type(value.declared(1), expected_text="Base")
    reveal_type(value.identity(1), expected_text="Unknown")
    reveal_type(Derived.make(1), expected_text="Derived | Unknown")
    reveal_type(Other.make(1), expected_text="Other | Unknown")
    reveal_type(Derived.make(1), expected_text="Derived | Unknown")


def unknown_argument(value: Derived, other: Other, argument):
    reveal_type(value.pick(argument), expected_text="Derived | Unknown")
    reveal_type(other.pick(argument), expected_text="Other | Unknown")
    reveal_type(value.pick(argument), expected_text="Derived | Unknown")


def union_receiver(value: Derived | Other):
    selected = value.pick(1)
    reveal_type(selected, expected_text="Derived | Other")
    # This should generate an error because Other has no derived_only method.
    selected.derived_only()


T = TypeVar("T")


class GenericBase(Generic[T]):
    def pick(self, argument):
        if argument:
            return self
        return argument


class GenericDerived(GenericBase[T]):
    pass


def generic_receivers(first: GenericDerived[int], second: GenericDerived[str]):
    reveal_type(first.pick(1), expected_text="GenericDerived[int]")
    reveal_type(second.pick(1), expected_text="GenericDerived[str]")
    reveal_type(first.pick(1), expected_text="GenericDerived[int]")


class PowerBase:
    def __pow__(self, exponent):
        if exponent < 0:
            return NotImplemented
        if exponent > 2:
            return exponent
        return self


class PowerDerived(PowerBase):
    pass


def power_receiver(value: PowerDerived):
    reveal_type(value.__pow__(2), expected_text="NotImplementedType | PowerDerived | Literal[2]")
