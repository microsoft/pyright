# This sample tests basic usage of "closed" TypedDict classes as
# introduced in PEP 728.

from typing import TypedDict, Unpack


class Movie1(TypedDict, extra_items=int):
    name: str


def func1(movie: Movie1) -> None:
    del movie["year"]

    # This should generate an error.
    del movie["name"]


class Movie2(TypedDict, extra_items=int):
    name: str


def func2(**kwargs: Unpack[Movie2]) -> None: ...


func2(name="")

func2(name="", foo=1)

# This should generate an error.
func2(name=1)

# This should generate an error.
func2(name="", foo="")


m1 = Movie1(name="ET", year=1984)

# This should generate an error.
m2 = Movie1(name="ET", year="1984")
