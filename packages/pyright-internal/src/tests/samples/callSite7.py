# This sample tests receiver Self preservation through inherited factory calls.

from typing import Generic, TypeVar


class Base:
    @classmethod
    def build(cls, args):
        if not args:
            return args
        return cls()

    def rebuild(self, *args):
        return self.build(args)

    def pick(self, argument):
        if argument:
            return self
        return argument


class Derived(Base):
    def derived_only(self) -> int:
        return 42

    def forwarded(self):
        return self.pick(1)


class Other(Base):
    pass


def demonstrate(value: Derived, other: Other) -> None:
    reveal_type(value.rebuild(1, 2), expected_text="Unknown | Derived")
    value.rebuild(1, 2).derived_only()
    reveal_type(value.build((1, 2)), expected_text="Unknown | Derived")
    reveal_type(other.rebuild(1, 2), expected_text="Unknown | Other")
    reveal_type(value.rebuild(1, 2), expected_text="Unknown | Derived")


class Further(Derived):
    pass


def further(value: Further):
    reveal_type(value.rebuild(1, 2), expected_text="Unknown | Further")
    reveal_type(value.forwarded(), expected_text="Further")


T = TypeVar("T")


class GenericBase(Generic[T]):
    @classmethod
    def build(cls, args):
        if not args:
            return args
        return cls()

    def rebuild(self, *args):
        return self.build(args)


class GenericDerived(GenericBase[T]):
    pass


def generic_receivers(first: GenericDerived[int], second: GenericDerived[str]):
    reveal_type(first.rebuild(1, 2), expected_text="Unknown | GenericDerived[int]")
    reveal_type(second.rebuild(1, 2), expected_text="Unknown | GenericDerived[str]")
    reveal_type(first.rebuild(1, 2), expected_text="Unknown | GenericDerived[int]")


Receiver = TypeVar("Receiver", Derived, Other)


def constrained_receiver(value: Receiver) -> Receiver:
    return value.pick(1)


BoundReceiver = TypeVar("BoundReceiver", bound=Derived)


def bounded_receiver(value: BoundReceiver) -> BoundReceiver:
    return value.pick(1)
