# This sample validates that type(self) can be instantiated without
# error even if the class is abstract.

from abc import ABC, abstractmethod
from typing import TypeVar

_ASub = TypeVar("_ASub", bound="A")


class A(ABC):
    @abstractmethod
    def some_method(self) -> str:
        ...

    def some_factory_method_1(self):
        return type(self)()

    def some_factory_method_2(self: _ASub) -> _ASub:
        return type(self)()
