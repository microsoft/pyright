# This sample tests the case where a @property decorator is applied to
# a method that has been previously decorated.

from typing import Concatenate, ParamSpec, Protocol, TypeVar, Callable

P = ParamSpec("P")
R = TypeVar("R")
S = TypeVar("S", bound="HasAttr")


def deco1(func: Callable[P, R]) -> Callable[P, R]: ...


class ClassA:
    @property
    @deco1
    def prop(self) -> int:
        return 1


a = ClassA()
reveal_type(a.prop, expected_text="int")


class HasAttr(Protocol):
    my_attr: str


def decorate(
    func: Callable[Concatenate[S, P], R],
) -> Callable[Concatenate[S, P], R]: ...


class ClassB:
    my_attr: str

    @property
    @decorate
    def prop(self) -> int:
        return 1


b = ClassB()
reveal_type(b.prop, expected_text="int")
