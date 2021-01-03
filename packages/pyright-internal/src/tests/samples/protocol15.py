# This sample tests the handling of protocols with properties that
# make use of generics.

from typing import Protocol, TypeVar

T = TypeVar("T")


class Proto(Protocol):
    @property
    def f(self: T) -> T:
        ...


class Concrete:
    @property
    def f(self) -> "Concrete":
        return self


x: Proto = Concrete()
