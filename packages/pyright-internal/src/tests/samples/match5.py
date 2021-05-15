# This sample tests type checking for match statements (as
# described in PEP 634) that contain mapping patterns.

from typing import Dict, Literal, TypedDict

def test_unknown(value_to_match):
    match value_to_match:
        case {"hello": a1, **a2}:
            t_a1: Literal["Unknown"] = reveal_type(a1)
            t_a2: Literal["dict[Unknown, Unknown]"] = reveal_type(a2)
            t_v1: Literal["Unknown"] = reveal_type(value_to_match)


def test_dict(value_to_match: Dict[str | int, str | int]):
    match value_to_match:
        case {1: a1}:
            t_a1: Literal["str | int"] = reveal_type(a1)
            t_v1: Literal["Dict[str | int, str | int]"] = reveal_type(value_to_match)

        case {"hi": b1, "hi2": b2, **b3}:
            t_b1: Literal["str | int"] = reveal_type(b1)
            t_b2: Literal["str | int"] = reveal_type(b2)
            t_b3: Literal["dict[str | int, str | int]"] = reveal_type(b3)
            t_v2: Literal["Dict[str | int, str | int]"] = reveal_type(value_to_match)

        case {3j: c1}:
            t_c1: Literal["Never"] = reveal_type(c1)
            t_v3: Literal["Never"] = reveal_type(value_to_match)


class Movie(TypedDict):
    title: str
    release_year: int
    gross_earnings: float

class MovieInfo:
    field_of_interest: Literal["release_year", "gross_earnings"]

def test_typed_dict(value_to_match: Movie):
    match value_to_match:
        case {"title": a1, "release_year": a2, **a3}:
            t_a1: Literal["str"] = reveal_type(a1)
            t_a2: Literal["int"] = reveal_type(a2)
            t_a3: Literal["dict[str, Unknown]"] = reveal_type(a3)
            t_v1: Literal["Movie"] = reveal_type(value_to_match)

        case {3: b1, "title": b2}:
            t_b1: Literal["Never"] = reveal_type(b1)
            t_b2: Literal["Never"] = reveal_type(b2)
            t_v2: Literal["Never"] = reveal_type(value_to_match)

        case {"director": c1}:
            t_c1: Literal["Never"] = reveal_type(c1)
            t_v2: Literal["Never"] = reveal_type(value_to_match)
        
        case {MovieInfo.field_of_interest: d1}:
            t_d1: Literal["int | float"] = reveal_type(d1)
            t_v1: Literal["Movie"] = reveal_type(value_to_match)


def test_union(value_to_match: Dict[str | int, str | int] | Movie | str):
    match value_to_match:
        case {3: a1}:
            t_a1: Literal["str | int"] = reveal_type(a1)
            t_v1: Literal["Dict[str | int, str | int]"] = reveal_type(value_to_match)

        case {"gross_earnings": b1}:
            t_b1: Literal["str | int | float"] = reveal_type(b1)
            t_v2: Literal["Dict[str | int, str | int] | Movie"] = reveal_type(value_to_match)

