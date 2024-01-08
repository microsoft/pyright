# This sample tests the type analyzer's handling of TypedDict
# "alternate syntax" defined in PEP 589.

from typing import NotRequired, Required, TypedDict

Movie = TypedDict("Movie", {"name": str, "year": int})

# This should generate an error because the arguments are missing.
Movie2 = TypedDict()

# This should generate an error because the arguments are missing.
Movie3 = TypedDict("Movie3")

# This should generate an error because the argument type is wrong.
Movie4 = TypedDict("Movie4", 3)

# This should generate an error because the argument type is wrong.
Movie5 = TypedDict(3, {})

Movie6 = TypedDict("Movie6", {}, total=False)
Movie7 = TypedDict("Movie7", {}, total=True)

# This should generate an error because the total param
# accepts only True or False.
Movie8 = TypedDict("Movie8", {}, total=3)

# This should generate an error because the third arg is unknown.
Movie9 = TypedDict("Movie9", {}, random=3)

# This should generate an error because the third arg is unknown.
Movie10 = TypedDict("Movie10", {}, 3)

# This should generate an error because a fourth arg
# is not supported.
Movie11 = TypedDict("Movie11", {}, total=True, foo=3)


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

MovieNotTotal = TypedDict("MovieNotTotal", {"name": str, "year": int}, total=False)

movie5: MovieNotTotal = {"name": "Blade Runner"}


def foo(unknown_str_value: str):
    a = movie5[unknown_str_value]


Movie12 = TypedDict(
    "Movie12", {"title": Required[str], "predecessor": NotRequired["Movie12"]}
)

movie12: Movie12 = {"title": "Two Towers", "predecessor": {"title": "Fellowship"}}


# This should generate an error because the name doesn't match.
# the arguments are missing.
Movie13 = TypedDict("NotMovie13", {"name": str, "year": int})
