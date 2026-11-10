# This sample tests that classes decorated with dataclass_transform are neither
# frozen nor non-frozen when used as base classes.

from abc import ABC
from typing_extensions import dataclass_transform


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
