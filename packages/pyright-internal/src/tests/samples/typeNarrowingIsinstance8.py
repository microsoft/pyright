# This sample tests the case where an issubclass type guard narrows
# to an abstract base class. When attempting to instantiate the
# class, there should be no "cannot instantiate ABC" error.

# pyright: strict

from abc import ABC, abstractmethod
from typing import Any


class Base(ABC):
    @abstractmethod
    def f(self) -> None: ...


def func1(cls: Any):
    assert issubclass(cls, Base)
    reveal_type(cls, expected_text="type[Base]")
    _ = cls()


def func2(cls: Any):
    assert isinstance(cls, type)
    reveal_type(cls, expected_text="type")
    assert issubclass(cls, Base)
    reveal_type(cls, expected_text="type[Base]")
    _ = cls()
