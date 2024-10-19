# This sample tests type consistency rules for closed TypedDicts.

from typing import NotRequired, TypedDict
from typing_extensions import ReadOnly  # pyright: ignore[reportMissingModuleSource]


class Movie1(TypedDict, extra_items=int | None):
    name: str


class MovieDetails1(TypedDict, extra_items=int | None):
    name: str
    year: NotRequired[int]


details1: MovieDetails1 = {"name": "Kill Bill Vol. 1", "year": 2003}

# This should generate an error because of a type incompatibility.
movie1: Movie1 = details1


class MovieDetails2(TypedDict, extra_items=int | None):
    name: str
    year: int | None


details2: MovieDetails2 = {"name": "Kill Bill Vol. 1", "year": 2003}

# This should generate an error because "year" is not required.
movie2: Movie1 = details2


class Movie3(TypedDict, extra_items=ReadOnly[str | int]):
    name: str


class MovieDetails3(TypedDict, extra_items=int):
    name: str
    year: NotRequired[int]


details3: MovieDetails3 = {"name": "Kill Bill Vol. 2", "year": 2004}
movie3: Movie3 = details3


class MovieExtraInt(TypedDict, extra_items=int):
    name: str


class MovieExtraStr(TypedDict, extra_items=str):
    name: str


def func1(p1: MovieExtraInt, p2: MovieExtraStr):
    # This should generate an error because of a type inconsistency.
    extra_int: MovieExtraInt = p2

    # This should generate an error because of a type inconsistency.
    extra_str: MovieExtraStr = p1


class MovieNotClosed(TypedDict):
    name: str


def func2(p1: MovieExtraInt, p2: MovieNotClosed):
    # This should generate an error because of a type inconsistency.
    extra_int: MovieExtraInt = p2

    not_closed: MovieNotClosed = p1
