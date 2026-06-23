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
