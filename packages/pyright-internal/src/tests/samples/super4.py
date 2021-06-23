# This sample tests the handling of super() with no parameters
# and a base class with an annotated cls or self parameter that
# relies on the subclass being passed as a parameter.


from __future__ import annotations
import typing

T = typing.TypeVar("T")


class Base(typing.Generic[T]):
    @classmethod
    def construct(cls: typing.Type[T]) -> T:
        return cls()


class Derived(Base["Derived"]):
    @classmethod
    def construct(cls) -> Derived:
        return super().construct()


d: Derived = Derived.construct()
