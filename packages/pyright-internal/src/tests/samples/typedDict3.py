# This sample tests the type analyzer's handling of TypedDict classes.

from typing import TypeVar, TypedDict


class Movie(TypedDict, total=False):
    name: str
    year: int


class BookBasedMovie(Movie, total=True):
    based_on: str


movie1 = Movie(year=1982, name="Blade Runner")

# This should generate an error because
# the type is incorrect.
movie2 = Movie(name="Blade Runner", year="1982")

movie3 = Movie(name="Blade Runner")

# This should generate an error because
# the key name is not supported.
movie4 = Movie(name2="Blade Runner")


book1 = BookBasedMovie(year=1979, name="Moonraker", based_on="Moonraker")

book2 = BookBasedMovie(based_on="Moonraker", year=1979)

book3 = BookBasedMovie(based_on="Moonraker")

# This should generate an error because 'author' isn't
# a defined field.
book4 = BookBasedMovie(based_on="Moonraker", author="Ian Fleming")

# This should generate an error because 'based_on' is
# a required field, and it's not provided.
book5 = BookBasedMovie(year=1982, name="Blade Runner")
