# This sample tests the type analyzer's handling of a variant
# of the TypedDict "alternate syntax" defined in the Python docs.

from typing import TypedDict

Movie = TypedDict("Movie", name=str, year=int)


def get_movie_name(movie: Movie):
    return movie["name"]


name2 = get_movie_name({"name": "ET", "year": 1982})

movie1: Movie = {"name": "Blade Runner", "year": 1982}

movie2: Movie = {
    "name": "Blade Runner",
    # This should generate an error because
    # the type is incorrect.
    "year": "1982",
}

movie3: Movie = {
    # This should generate an error because
    # all keys are required.
    "name": "Blade Runner"
}

movie4: Movie = {
    # This should generate an error because
    # the key name is not supported.
    "name2": "Blade Runner"
}
