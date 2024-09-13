# This sample tests the handling of tuple types when used with TypeIs.

# pyright: reportMissingModuleSource=false

from typing_extensions import TypeIs


def is_tuple_of_strings(v: tuple[int | str, ...]) -> TypeIs[tuple[str, ...]]:
    return all(isinstance(x, str) for x in v)


def test1(t: tuple[int]) -> None:
    if is_tuple_of_strings(t):
        reveal_type(t, expected_text="Never")
    else:
        reveal_type(t, expected_text="tuple[int]")


def test2(t: tuple[str, int]) -> None:
    if is_tuple_of_strings(t):
        reveal_type(t, expected_text="Never")
    else:
        reveal_type(t, expected_text="tuple[str, int]")


def test3(t: tuple[int | str]) -> None:
    if is_tuple_of_strings(t):
        reveal_type(t, expected_text="tuple[str]")
    else:
        reveal_type(t, expected_text="tuple[int | str]")


def test4(t: tuple[int | str, int | str]) -> None:
    if is_tuple_of_strings(t):
        reveal_type(t, expected_text="tuple[str, str]")
    else:
        reveal_type(t, expected_text="tuple[int | str, int | str]")


def test5(t: tuple[int | str, ...]) -> None:
    if is_tuple_of_strings(t):
        reveal_type(t, expected_text="tuple[str, ...]")
    else:
        reveal_type(t, expected_text="tuple[int | str, ...]")


def test6(t: tuple[str, *tuple[int | str, ...], str]) -> None:
    if is_tuple_of_strings(t):
        reveal_type(t, expected_text="tuple[str, *tuple[str, ...], str]")
    else:
        reveal_type(t, expected_text="tuple[str, *tuple[int | str, ...], str]")
