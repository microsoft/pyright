# This sample tests the type analyzer's handling of TypedDict classes.

from typing import Literal, TypedDict


class Movie(TypedDict, total=False):
    name: str
    year: int


class BookBasedMovie(Movie, total=True):
    based_on: str


movie1 = Movie(name="Blade Runner", year=1982)


def get_value(movie: Movie, key: Literal["year", "name"]) -> int | str | None:
    if "year" in movie and "name" in movie:
        return movie[key]


def make_movie(name: str, year: int) -> Movie:
    return {"name": name, "year": year}


name1 = movie1.get("name", "Blue Nile")
year1 = movie1.get("year", 1921)
movie2 = make_movie(name1, year1)

# This should generate an error because all indices need
# to be string literals.
year2 = movie1[3]

# This should generate an error because only one index
# is allowed.
year3 = movie1[3, 3]

movie1["name"] = "Transformers"
movie1["year"] = 2007

# This should generate an error because the RHS is the wrong type.
movie1["name"] = [3]

# This should generate an error because the RHS is the wrong type.
movie1["year"] = {}

del movie1["year"]

# This should generate an error because the key is not in the dictionary.
del movie1["year2"]

# This should generate an error because entries in a TypedDict
# are not accessible through member access.
name2 = movie1.name

book1 = BookBasedMovie(based_on="E.T.")
make_movie(name=book1["based_on"], year=1923)

del book1["name"]

# This should generate an error because you can't delete a required key.
del book1["based_on"]

# Make sure "in" operator works with TypedDict.
movie3 = Movie()
if "d" in movie3:
    pass
