# This sample tests type compatibility between closed TypedDicts and
# Mapping types.

from typing import Mapping, TypedDict


class MovieExtraStr(TypedDict, closed=True):
    name: str
    __extra_items__: str


class MovieExtraInt(TypedDict, closed=True):
    name: str
    __extra_items__: int


extra_str: MovieExtraStr = {"name": "Blade Runner", "summary": ""}
extra_int: MovieExtraInt = {"name": "No Country for Old Men", "year": 2007}

str_mapping: Mapping[str, str] = extra_str

# This should generate an error.
int_mapping: Mapping[str, int] = extra_int

int_str_mapping: Mapping[str, int | str] = extra_int


def func1(movie: MovieExtraStr) -> None:
    reveal_type(movie.items(), expected_text="dict_items[str, str]")
    reveal_type(movie.keys(), expected_text="dict_keys[str, str]")
    reveal_type(movie.values(), expected_text="dict_values[str, str]")


class MovieNotClosed(TypedDict):
    name: str
    __extra_items__: int


def func2(movie: MovieNotClosed) -> None:
    reveal_type(movie.items(), expected_text="dict_items[str, object]")
    reveal_type(movie.keys(), expected_text="dict_keys[str, object]")
    reveal_type(movie.values(), expected_text="dict_values[str, object]")
