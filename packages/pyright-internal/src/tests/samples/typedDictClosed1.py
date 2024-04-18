# This sample tests basic usage of "closed" TypedDict classes as
# introduced in PEP 728.

from typing import NotRequired, Required, TypedDict
from typing_extensions import ReadOnly  # pyright: ignore[reportMissingModuleSource]


class Movie(TypedDict, closed=True):
    name: str
    __extra_items__: bool


m1: Movie = {"name": "Blade Runner", "novel_adaptation": True}

# This should generate an error because int is not compatible with bool.
m2: Movie = {"name": "Blade Runner", "year": 1982}


MovieAlt = TypedDict("MovieAlt", {"name": str, "__extra_items__": bool}, closed=True)

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


class MovieNotClosed(TypedDict):
    name: str
    __extra_items__: bool


m_nc1: MovieNotClosed = {"name": "Blade Runner", "__extra_items__": True}

# This should generate an error because "novel_adaptations" is not a known item.
m_nc2: MovieNotClosed = {"name": "Blade Runner", "novel_adaptation": True}


class MovieBase(TypedDict, closed=True):
    name: str
    __extra_items__: ReadOnly[str | None]


class MovieChild(MovieBase):
    __extra_items__: NotRequired[str]


mc_1: MovieChild = {"name": "Blade Runner", "other_extra_key": None}

# THis should generate an error because the type of "__extra_items__" is incompatible.
mc_2: MovieChild = {"name": "Blade Runner", "__extra_items__": None}


class BadTD1(TypedDict, closed=True):
    # This should generate an error.
    __extra_items__: Required[str]


class BadTD2(TypedDict, closed=True):
    # This should generate an error.
    __extra_items__: NotRequired[str]
