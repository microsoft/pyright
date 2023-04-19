# This sample tests narrowing of subject subexpressions in match statements.

from typing import Literal, TypedDict


class TD1(TypedDict):
    name: Literal["a"]
    extra_value: int


class TD2(TypedDict):
    name: Literal["b"]
    other_extra_value: int


def func1(item: TD1 | TD2):
    match item["name"]:
        case "c":
            reveal_type(item, expected_text="Never")
        case "a":
            reveal_type(item, expected_text="TD1")
        case "b":
            reveal_type(item, expected_text="TD2")


T1 = tuple[Literal[0], int]
T2 = tuple[Literal[1], str]


def func2(item: T1 | T2):
    match item[0]:
        case 0:
            reveal_type(item, expected_text="tuple[Literal[0], int]")
        case 1:
            reveal_type(item, expected_text="tuple[Literal[1], str]")
