# This sample tests the type analyzer's handling of TypedDict classes.

from typing import TypedDict


class Movie1(TypedDict, total=False):
    name: str
    year: int


class Movie2(TypedDict, total=False):
    name: str
    year: int


class Movie3(TypedDict, total=True):
    name: str
    year: int


class Movie4(TypedDict, total=True):
    name: str
    year: int
    earnings: float


class Movie5(TypedDict, total=True):
    name: str
    year: float


movie1: Movie1 = Movie2(name="hello", year=1971)

# This should generate an error because
# items are required in Movie3 but not Movie2.
movie2: Movie2 = Movie3(name="hello", year=1971)

# This should generate an error because
# items are required in Movie3 but not Movie2.
movie3: Movie3 = Movie2(name="hello", year=1971)

# This should generate an error.
movie4: Movie4 = Movie3(name="hello", year=1971)

movie5: Movie3 = Movie4(name="hello", year=1971, earnings=23)


movie6 = Movie2(name="hello", year=1971)
movie6["name"] = "goodbye"

movie7 = {"name": "hello", "year": 1971}
movie7["name"] = "goodbye"

movie8: Movie2 = {"year": 1981, "name": "test"}
movie8["year"] = 1982

movie9 = Movie3(name="", year=1971)

# This should generate an error because "year" is mutable,
# so its type must match exactly.
movie10: Movie5 = movie9
