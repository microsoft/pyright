# This sample tests the handling of the "|" and "|=" operators
# for TypedDicts.

from typing import NotRequired, ReadOnly, TypedDict

from typing_extensions import TypedDict as TETypedDict  # pyright: ignore[reportMissingModuleSource]


class Person(TypedDict, total=False):
    name: str
    age: int


person: Person = {}

person.update({"name": "Michael"})

person |= {"name": "Michael"}
person = person | {"name": "Michael"}


# This should generate an error.
person |= {"name": "Michael", "other": 1}

# This should generate an error.
person = person | {"name": 1}


class Movie(TypedDict):
    title: str
    year: int
    rating: NotRequired[float]


def func1(movie: Movie, other: Movie):
    reveal_type(movie | {"year": 1999}, expected_text="Movie")
    reveal_type(movie | {"rating": 8.5}, expected_text="Movie")
    reveal_type(movie | other, expected_text="Movie")
    reveal_type(movie | {"other": 1}, expected_text="dict[str, object]")

    movie |= {"year": 1999}
    movie |= {"rating": 8.5}
    movie |= other

    if "rating" in movie:
        movie |= {"year": 2000}

    # This should generate an error.
    movie |= {"year": "1999"}

    # This should generate an error.
    movie |= {"other": 1}


class MovieRO(TypedDict):
    title: ReadOnly[str]
    year: int


def func2(movie: MovieRO, other: MovieRO):
    reveal_type(movie | other, expected_text="MovieRO")

    movie |= {"year": 1999}

    # This should generate an error because "title" is read-only.
    movie |= {"title": "Alien"}


class GenericMovie[T](TypedDict):
    title: str
    extra: T


def func3(movie: GenericMovie[int]):
    reveal_type(movie | {"extra": 1}, expected_text="GenericMovie[int]")
    movie |= {"extra": 1}


def func4(movie: MovieRO):
    reveal_type(movie | {"title": "Alien", "year": 1979}, expected_text="MovieRO")


def func5(movie: Movie):
    if "rating" in movie:
        merged = movie | {}
        reveal_type(merged["rating"], expected_text="float")

        movie |= {"year": 2000}
        reveal_type(movie["rating"], expected_text="float")


class MovieExtraRO(TETypedDict, extra_items=ReadOnly[int]):
    title: str


class MovieExtra(TETypedDict, extra_items=int):
    title: str


def func6(movie: MovieExtraRO, other: MovieExtra):
    # This should generate an error because extra items are read-only.
    movie |= {"year": 1999}

    # This should generate two errors because extra items are read-only.
    movie.update({"year": 1999})

    reveal_type(other | {"year": 1999}, expected_text="MovieExtra")
    other |= {"year": 1999}
    other.update({"year": 1999})
