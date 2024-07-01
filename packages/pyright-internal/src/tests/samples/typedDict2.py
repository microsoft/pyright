# This sample tests the type analyzer's handling of TypedDict classes.

from typing import TypedDict


class Movie(TypedDict, total=False):
    name: str
    year: int


class BookBasedMovie(Movie, total=True):
    based_on: str


def get_movie_name(movie: Movie):
    return movie.get("name")


name2 = get_movie_name({"name": "ET", "year": 1982})

movie1: Movie = {"name": "Blade Runner", "year": 1982}

movie2: Movie = {
    "name": "Blade Runner",
    # This should generate an error because
    # the type is incorrect.
    "year": "1982",
}

movie3: Movie = {"name": "Blade Runner"}

movie4: Movie = {
    # This should generate an error because
    # the key name is not supported.
    "name2": "Blade Runner"
}

movie5: Movie = Movie(movie3)
movie6: Movie = Movie(movie3, year=2030, name="New movie")

book1: BookBasedMovie = {"name": "Moonraker", "year": 1979, "based_on": "Moonraker"}

book2: BookBasedMovie = {"year": 1979, "based_on": "Moonraker"}

book3: BookBasedMovie = {"based_on": "Moonraker"}

book4: BookBasedMovie = {
    # This should generate an error because 'author' isn't
    # a defined field.
    "author": "Ian Fleming",
    "based_on": "Moonraker",
}

book5: BookBasedMovie = {
    "name": "Moonraker",
    "year": 1979,
    # This should generate an error because 'based_on' is
    # a required field, and it's not provided.
}
