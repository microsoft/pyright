# This sample tests recursive evaluation of a factory's return type while
# the factory is used as a decorator within that return type's class.

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Callable


class Identity:
    def __call__[T](self, fn: Callable[..., T]) -> Callable[..., T]:
        return fn


class Factory(ABC):
    def __new__(cls) -> Identity | Decorated:
        return Identity()

    @abstractmethod
    def missing(self) -> None: ...


class Decorated(Identity):
    @Factory()
    def method(self) -> int:
        return 1
