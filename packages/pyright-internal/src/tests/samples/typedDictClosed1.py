# This sample tests basic usage of "closed" TypedDict classes as
# introduced in PEP 728.

from typing import NotRequired, Required, TypedDict
from typing_extensions import ReadOnly  # pyright: ignore[reportMissingModuleSource]


class Movie(TypedDict, extra_items=bool):
    name: str


m1: Movie = {"name": "Blade Runner", "novel_adaptation": True}

# This should generate an error because int is not compatible with bool.
m2: Movie = {"name": "Blade Runner", "year": 1982}


MovieAlt = TypedDict("MovieAlt", {"name": str}, extra_items=bool)

m_alt1: MovieAlt = {"name": "Blade Runner", "novel_adaptation": True}

# This should generate an error because int is not compatible with bool.
m_alt2: MovieAlt = {"name": "Blade Runner", "year": 1982}


def func1(movie: Movie) -> None:
    reveal_type(movie["name"], expected_text="str")

    if "novel_adaptation" in movie:
        reveal_type(movie["novel_adaptation"], expected_text="bool")

    movie["other1"] = True

    # This should generate a type incompatibility error.
    movie["other2"] = 1


class MovieBase(TypedDict, extra_items=ReadOnly[str | None]):
    name: str


# This should generate an error.
class BadTD1(TypedDict, extra_items=Required[str]):
    pass


# This should generate an error.
class BadTD2(TypedDict, extra_items=NotRequired[str]):
    pass


# This should generate an error.
class BadTD3(TypedDict, closed=True, extra_items=str):
    pass


# This should generate an error because "closed" and
# "extra_items" cannot both be specified.
class BadTD4(TypedDict, closed=False, extra_items=bool):
    name: str
