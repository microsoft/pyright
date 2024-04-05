# This sample tests narrowing of subject subexpressions in match statements.

from typing import Literal, TypedDict


class TD1(TypedDict):
    name: Literal["a"]
    extra_value: int


class TD2(TypedDict):
    name: Literal["b"]
    other_extra_value: int


class TD3(TypedDict):
    name: Literal["c"]
    extra_value: int


def func1(item: TD1 | TD2):
    match item["name"]:
        case "d":
            reveal_type(item, expected_text="Never")
        case "a":
            reveal_type(item, expected_text="TD1")
        case "b":
            reveal_type(item, expected_text="TD2")


def func2(item: TD1 | TD2 | TD3):
    match item["name"]:
        case "a" | "c":
            reveal_type(item, expected_text="TD1 | TD3")
        case _:
            reveal_type(item, expected_text="TD2")


T1 = tuple[Literal[0], int]
T2 = tuple[Literal[1], str]


def func3(item: T1 | T2):
    match item[0]:
        case 0:
            reveal_type(item, expected_text="tuple[Literal[0], int]")
        case 1:
            reveal_type(item, expected_text="tuple[Literal[1], str]")


def func4(a: object, b: int) -> None:
    match a, b:
        case (complex(), 3):
            reveal_type(a, expected_text="complex")
            reveal_type(b, expected_text="Literal[3]")


Token = (
    str
    | tuple[Literal["define"], str, str]
    | tuple[Literal["include"], str]
    | tuple[Literal["use"], str, int, int]
)


def func5(token: Token):
    match token:
        case str(x):
            reveal_type(token, expected_text="str")
        case "define", _, _:
            reveal_type(token, expected_text="tuple[Literal['define'], str, str]")
        case "include", _:
            reveal_type(token, expected_text="tuple[Literal['include'], str]")
        case "use", _, _, _:
            reveal_type(token, expected_text="tuple[Literal['use'], str, int, int]")
        case _:
            reveal_type(token, expected_text="Never")


def func6(a: int | str, b: int | str) -> None:
    match a, b:
        case (_, _):
            reveal_type(a, expected_text="int | str")
            reveal_type(b, expected_text="int | str")
        case (x, y):
            reveal_type(x, expected_text="Never")
            reveal_type(y, expected_text="Never")
            reveal_type(a, expected_text="Never")
            reveal_type(b, expected_text="Never")


def func7(a: str | None, b: str | None) -> None:
    match (a, b):
        case (_, None):
            return
        case (None, _):
            return
    reveal_type(a, expected_text="str")
    reveal_type(b, expected_text="str")
