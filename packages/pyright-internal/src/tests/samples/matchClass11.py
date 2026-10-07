# This sample tests positional captures from protocol intersections.

from typing import Protocol, runtime_checkable
from typing_extensions import assert_type


class Foo:
    __match_args__ = ("label",)
    label: str


class IntFoo(int):
    __match_args__ = ("label",)
    label: str


@runtime_checkable
class HasValue(Protocol):
    __match_args__ = ("value",)
    value: int


def accepts_str(value: str) -> None:
    pass


def test_positional(value: Foo) -> None:
    match value:
        case HasValue(item):
            assert_type(item, int)
            # This should generate an error because the capture is an int.
            accepts_str(item)


def test_nested_positional(value: Foo) -> None:
    match value:
        case HasValue(int() as item):
            assert_type(item, int)
            # This should generate an error because the capture is an int.
            accepts_str(item)


def test_keyword(value: Foo) -> None:
    match value:
        case HasValue(value=int() as item):
            assert_type(item, int)
            # This should generate an error because the capture is an int.
            accepts_str(item)


def test_builtin_subclass(value: IntFoo) -> None:
    match value:
        case HasValue(item):
            assert_type(item, int)
            # This should generate an error because the capture is an int.
            accepts_str(item)
