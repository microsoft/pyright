# This sample tests type checking for match statements (as
# described in PEP 634) that contain mapping patterns.

from typing import Literal, TypedDict

from typing_extensions import NotRequired  # pyright: ignore[reportMissingModuleSource]


def test_unknown(value_to_match):
    match value_to_match:
        case {"hello": a1, **a2}:
            reveal_type(a1, expected_text="Unknown")
            reveal_type(a2, expected_text="dict[Unknown, Unknown]")
            reveal_type(value_to_match, expected_text="Unknown")


def test_object(value_to_match: object):
    match value_to_match:
        case {"hello": a1, **a2}:
            reveal_type(a1, expected_text="Unknown")
            reveal_type(a2, expected_text="dict[Unknown, Unknown]")
            reveal_type(value_to_match, expected_text="object")


def test_dict(value_to_match: dict[str | int, str | int]):
    match value_to_match:
        case {1: a1}:
            reveal_type(a1, expected_text="str | int")
            reveal_type(value_to_match, expected_text="dict[str | int, str | int]")

        case {"hi": b1, "hi2": b2, **b3}:
            reveal_type(b1, expected_text="str | int")
            reveal_type(b2, expected_text="str | int")
            reveal_type(b3, expected_text="dict[str | int, str | int]")
            reveal_type(value_to_match, expected_text="dict[str | int, str | int]")

        case {3j: c1}:
            reveal_type(c1, expected_text="Never")
            reveal_type(value_to_match, expected_text="Never")


class Movie(TypedDict):
    title: str
    release_year: int
    gross_earnings: float


class MovieInfo:
    field_of_interest: Literal["release_year", "gross_earnings"]


def test_typed_dict(value_to_match: Movie):
    match value_to_match:
        case {"title": a1, "release_year": a2, **a3}:
            reveal_type(a1, expected_text="str")
            reveal_type(a2, expected_text="int")
            reveal_type(a3, expected_text="dict[str, object]")
            reveal_type(value_to_match, expected_text="Movie")

        case {3: b1, "title": b2}:
            reveal_type(b1, expected_text="Never")
            reveal_type(b2, expected_text="Never")
            reveal_type(value_to_match, expected_text="Never")

        case {"director": c1}:
            reveal_type(c1, expected_text="Never")
            reveal_type(value_to_match, expected_text="Never")

        case {MovieInfo.field_of_interest: d1}:
            reveal_type(d1, expected_text="int | float")
            reveal_type(value_to_match, expected_text="Movie")


def test_union1(value_to_match: dict[str | int, str | int] | Movie | str):
    match value_to_match:
        case {3: a1}:
            reveal_type(a1, expected_text="str | int")
            reveal_type(value_to_match, expected_text="dict[str | int, str | int]")

        case {"gross_earnings": b1}:
            reveal_type(b1, expected_text="str | int | float")
            reveal_type(
                value_to_match, expected_text="dict[str | int, str | int] | Movie"
            )


def test_union2(value_to_match: dict[int, int] | Movie | str):
    match value_to_match:
        case {**kw}:
            reveal_type(kw, expected_text="dict[int | str, int | object]")
            reveal_type(value_to_match, expected_text="dict[int, int] | Movie")

        case x:
            reveal_type(x, expected_text="str")


class IntValue(TypedDict):
    type: Literal["Int"]
    int_value: int


class StrValue(TypedDict):
    type: Literal["Str"]
    str_value: str


class ComplexValue(TypedDict):
    type: NotRequired[Literal["Complex"]]
    complex_value: complex


def test_negative_narrowing1(value: IntValue | StrValue | ComplexValue | int) -> None:
    match value:
        case {"type": "Int"}:
            reveal_type(value, expected_text="IntValue")
        case {"type": "Str" | "Complex"}:
            reveal_type(value, expected_text="StrValue | ComplexValue")
        case _:
            reveal_type(value, expected_text="ComplexValue | int")


def test_negative_narrowing2(value: StrValue | ComplexValue) -> None:
    if "type" not in value:
        raise

    match value:
        case {"type": "Str"}:
            reveal_type(value, expected_text="StrValue")
        case {"type": "Complex"}:
            reveal_type(value, expected_text="ComplexValue")
        case _:
            reveal_type(value, expected_text="Never")


class TD1(TypedDict):
    v1: NotRequired[int]
    v2: NotRequired[int]
    v3: NotRequired[int]


def test_not_required_narrowing(subj: TD1) -> None:
    match subj:
        case {"v1": _}:
            print(subj["v1"])

            # This should generate an error.
            print(subj["v2"])

        case {"v2": 1, "v3": 2}:
            # This should generate an error.
            print(subj["v1"])

            print(subj["v2"])
            print(subj["v3"])
