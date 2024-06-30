# This sample tests type narrowing for a discriminated union that uses
# literal patterns to discriminate between objects with literal tags.

from typing import Literal


class A:
    tag: Literal["a"]
    name: str


class B:
    tag: Literal["b"]
    num: int


class C:
    tag: Literal["c"]
    num: int


def g(d: A | B | C) -> None:
    match d.tag:
        case "d":
            reveal_type(d.tag, expected_text="Never")
            reveal_type(d, expected_text="Never")
        case "a" | "c":
            reveal_type(d.tag, expected_text="Literal['a', 'c']")
            reveal_type(d, expected_text="A | C")
        case "b":
            reveal_type(d.tag, expected_text="Literal['b']")
            reveal_type(d, expected_text="B")
