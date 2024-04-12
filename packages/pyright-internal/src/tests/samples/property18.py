# This sample tests the case where a @property decorator is applied to
# a method that has been previously decorated.

from typing import ParamSpec, TypeVar, Callable

P = ParamSpec("P")
R = TypeVar("R")


def deco1(func: Callable[P, R]) -> Callable[P, R]: ...


class ClassA:
    @property
    @deco1
    def prop(self) -> int:
        return 1


a = ClassA()
reveal_type(a.prop, expected_text="int")
