# This sample tests that classes decorated with dataclass_transform are neither
# frozen nor non-frozen when used as base classes.

from abc import ABC
from dataclasses import dataclass
from typing import cast
from typing_extensions import dataclass_transform  # pyright: ignore[reportMissingModuleSource]


@dataclass_transform(frozen_default=True)
class DataClass(ABC):
    def __init_subclass__(cls, frozen: bool = True):
        pass


@dataclass_transform(frozen_default=True)
class ExtendedDataClass(DataClass, ABC):
    pass


class Config(ExtendedDataClass, frozen=False):
    name: str


class FrozenConfig(ExtendedDataClass, frozen=True):
    name: str


@dataclass_transform(frozen_default=True)
class Meta(type):
    def __new__(cls, name, bases, namespace, *, frozen=True, provider=False):
        result = super().__new__(cls, name, bases, namespace)
        if not provider:
            dataclass(cast(type, result), frozen=frozen)
        return result


@dataclass(frozen=True)
class ConcreteFrozen:
    value: int = 0


class NeutralFrozen(ConcreteFrozen, metaclass=Meta, provider=True):
    pass


# This should generate an error because a non-frozen dataclass cannot
# derive from the concrete frozen dataclass through the neutral provider.
class MutableFromFrozen(NeutralFrozen, frozen=False):
    pass


class FrozenFromFrozen(NeutralFrozen, frozen=True):
    pass


@dataclass
class ConcreteMutable:
    value: int = 0


class NeutralMutable(ConcreteMutable, metaclass=Meta, provider=True):
    pass


# This should generate an error because a frozen dataclass cannot derive
# from the concrete non-frozen dataclass through the neutral provider.
class FrozenFromMutable(NeutralMutable, frozen=True):
    pass


class MutableFromMutable(NeutralMutable, frozen=False):
    pass


@dataclass_transform()
class MutableMeta(type):
    pass


# A class that directly specifies a transform-decorated metaclass is neutral,
# so its default frozen behavior should not conflict with its concrete base.
class NeutralProvider(ConcreteFrozen, metaclass=MutableMeta):
    pass
