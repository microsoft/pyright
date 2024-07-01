# This sample validates that type(self) can be instantiated without
# error even if the class is abstract.

from abc import ABC, abstractmethod
from typing import TypeVar

T_A = TypeVar("T_A", bound="A")


class A(ABC):
    @abstractmethod
    def some_method(self) -> str: ...

    def some_factory_method_1(self):
        return type(self)()

    def some_factory_method_2(self: T_A) -> T_A:
        return type(self)()
