# This sample tests generic NamedTuple class pattern matching.

from typing import NamedTuple


class Thing[T: bool](NamedTuple):
    foo: T


def test(value: object) -> str:
    match value:
        case Thing():
            reveal_type(value.foo, expected_text="bool")
            return "thing" if value.foo else ""
        case _:
            return ""


def test_literal(value: Thing[bool] | object) -> str:
    match value:
        case Thing(foo=True):
            reveal_type(value.foo, expected_text="bool")
            return "thing"
        case _:
            return ""


class Animal:
    pass


class Container[T: Animal](NamedTuple):
    item: T


def test_nonfinal_bound(value: object) -> None:
    # T's bound (Animal) is not final, so falling back to the bound is a real
    # widening. An unsolved bounded parameter should surface as the bound rather
    # than Unknown.
    match value:
        case Container():
            reveal_type(value.item, expected_text="Animal")


class Base[T: bool]:
    pass


class Sub(Base[bool]):
    pass


def test_subclass(value: Sub) -> None:
    # The subject is a subclass of the bounded-generic pattern class. Matching
    # `case Base()` must keep the narrowed subclass type rather than rebuilding
    # it from the widened base class.
    match value:
        case Base():
            reveal_type(value, expected_text="Sub")


def f[S: bool](value: Thing[S]) -> None:
    # The subject's type argument is an in-scope TypeVar. Matching must preserve
    # the narrowed `S` rather than widening it to the bound `bool`.
    match value:
        case Thing():
            reveal_type(value.foo, expected_text="S@f")


def test_positional(value: object) -> None:
    # Positional matching binds via __match_args__; confirm it still works for a
    # generic NamedTuple whose parameter falls back to its bound.
    match value:
        case Thing(x):
            reveal_type(x, expected_text="bool")


class GenericBase[U]:
    pass


class BoundedDerived[T: bool](GenericBase[int]):
    foo: T


def test_generic_supertype(value: GenericBase[int]) -> None:
    # `BoundedDerived` has a generic supertype `GenericBase[int]`. The fallback must
    # read the pattern class's own unsolved bounded parameter (so `T` resolves to its
    # bound `bool`), not the supertype's unrelated `int` type argument.
    match value:
        case BoundedDerived():
            reveal_type(value.foo, expected_text="bool")
