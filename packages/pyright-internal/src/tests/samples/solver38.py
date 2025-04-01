# This sample tests a complex TypeVar unification scenario.

from typing import Protocol, TypeVar

A = TypeVar("A", contravariant=True)
B = TypeVar("B", covariant=True)
T = TypeVar("T")
U = TypeVar("U")
V = TypeVar("V")


class Getter(Protocol[A, B]):
    def __call__(self, x: A, /) -> B: ...


class PolymorphicListItemGetter(Protocol):
    def __call__(self, l: list[T], /) -> T: ...


def compose(get1: Getter[T, U], get2: Getter[U, V]) -> Getter[T, V]: ...


class HasMethod(Protocol):
    @property
    def method(self) -> int: ...


def get_value(x: HasMethod) -> int: ...


def upcast(x: PolymorphicListItemGetter) -> Getter[list[HasMethod], HasMethod]:
    return x


def test(poly_getter: PolymorphicListItemGetter):
    compose(poly_getter, get_value)
    compose(upcast(poly_getter), get_value)
