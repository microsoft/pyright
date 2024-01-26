# This sample validates that a variable that is annotated as
# Type[X] where X refers to an abstract base class does not
# emit an error when the variable is instantiated.

from abc import ABC, abstractmethod
from typing import Type, TypeVar


class Base(ABC):
    @abstractmethod
    def method1(self, x: int) -> int:
        pass


def func1(base_cls: Type[Base]):
    base_cls()


def func2():
    # This should generate an error.
    Base()


def func3(base_cls: type[Base]):
    base_cls()


T = TypeVar("T")


def create_instance(cls: Type[T]) -> T:
    return cls()


def func4():
    base = create_instance(Base)
    base.method1(1)
