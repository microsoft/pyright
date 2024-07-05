# This sample tests the handling of protocols with properties and
# methods that make use of generics.

from typing import Callable, Protocol, TypeVar

T = TypeVar("T")


class Proto(Protocol):
    @property
    def f(self: T) -> T: ...

    def m(self, item: T, callback: Callable[[T], str]) -> str: ...


class Concrete:
    @property
    def f(self: T) -> T:
        return self

    def m(self, item: T, callback: Callable[[T], str]) -> str: ...


x: Proto = Concrete()
