# This sample validates that a variable that is annotated as
# Type[X] where X refers to an abstract base class does not
# emit an error when the variable is instantiated.

from abc import ABC, abstractmethod
from typing import Type


class Base(ABC):
    @abstractmethod
    def foo(self, x: int) -> int:
        pass


def foo1(base_cls: Type[Base]):
    base_cls()


def foo2():
    # This should generate an error.
    Base()


def foo3(base_cls: type[Base]):
    base_cls()
