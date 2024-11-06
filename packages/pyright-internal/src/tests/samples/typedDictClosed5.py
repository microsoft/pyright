# This sample tests type compatibility between closed TypedDicts and
# Mapping types.

from typing import Mapping, TypedDict


class MovieExtraStr(TypedDict, extra_items=str):
    name: str


class MovieExtraInt(TypedDict, extra_items=int):
    name: str


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


def func2(movie: MovieNotClosed) -> None:
    reveal_type(movie.items(), expected_text="dict_items[str, object]")
    reveal_type(movie.keys(), expected_text="dict_keys[str, object]")
    reveal_type(movie.values(), expected_text="dict_values[str, object]")


class MovieClosed(TypedDict, closed=True):
    name: str
    year: int


def func3(movie: MovieClosed) -> None:
    reveal_type(
        movie.items(), expected_text="dict_items[Literal['name', 'year'], str | int]"
    )
    reveal_type(
        movie.keys(), expected_text="dict_keys[Literal['name', 'year'], str | int]"
    )
    reveal_type(
        movie.values(), expected_text="dict_values[Literal['name', 'year'], str | int]"
    )
