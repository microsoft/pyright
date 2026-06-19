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
