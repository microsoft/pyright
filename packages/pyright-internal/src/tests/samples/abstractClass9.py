# This sample tests that named tuple fields override abstract methods.

# pyright: reportIncompatibleVariableOverride=false

from abc import ABC, abstractmethod
from typing import NamedTuple


class ClassA(ABC):
    @property
    @abstractmethod
    def myproperty(self) -> str: ...


MixinB = NamedTuple("MixinB", [("myproperty", str)])


class ClassB(MixinB, ClassA):
    pass


ClassB(myproperty="myproperty")
