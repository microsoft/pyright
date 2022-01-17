# This sample tests type checking for match statements (as
# described in PEP 634) that contain mapping patterns.

from typing import Dict, Literal, TypedDict

def test_unknown(value_to_match):
    match value_to_match:
        case {"hello": a1, **a2}:
            reveal_type(a1, expected_text="Unknown")
            reveal_type(a2, expected_text="dict[Unknown, Unknown]")
            reveal_type(value_to_match, expected_text="Unknown")


def test_dict(value_to_match: Dict[str | int, str | int]):
    match value_to_match:
        case {1: a1}:
            reveal_type(a1, expected_text="str | int")
            reveal_type(value_to_match, expected_text="Dict[str | int, str | int]")

        case {"hi": b1, "hi2": b2, **b3}:
            reveal_type(b1, expected_text="str | int")
            reveal_type(b2, expected_text="str | int")
            reveal_type(b3, expected_text="dict[str | int, str | int]")
            reveal_type(value_to_match, expected_text="Dict[str | int, str | int]")

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
            reveal_type(a3, expected_text="dict[str, Unknown]")
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


def test_union(value_to_match: Dict[str | int, str | int] | Movie | str):
    match value_to_match:
        case {3: a1}:
            reveal_type(a1, expected_text="str | int")
            reveal_type(value_to_match, expected_text="Dict[str | int, str | int]")

        case {"gross_earnings": b1}:
            reveal_type(b1, expected_text="str | int | float")
            reveal_type(value_to_match, expected_text="Dict[str | int, str | int] | Movie")

