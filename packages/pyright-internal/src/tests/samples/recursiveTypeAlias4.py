# This sample tests the handling of complex recursive types.

# pyright: strict, reportUnusedVariable=false

from typing import Generator


JSONArray = list["JSONType"]
JSONObject = dict[str, "JSONType"]

JSONPrimitive = str | float | int | bool | None
JSONStructured = JSONArray | JSONObject

JSONType = JSONPrimitive | JSONStructured


# Using type alias checking for list:
def f2(args: JSONStructured):
    if isinstance(args, list):
        reveal_type(
            args,
            expected_text="list[str | float | int | bool | list[JSONType] | dict[str, JSONType] | None]",
        )
    else:
        reveal_type(
            args,
            expected_text="dict[str, str | float | int | bool | list[JSONType] | dict[str, JSONType] | None]",
        )
        dargs: JSONObject = args


# Using type alias checking for dict:
def f3(args: JSONStructured):
    if isinstance(args, dict):
        reveal_type(
            args,
            expected_text="dict[str, str | float | int | bool | list[JSONType] | dict[str, JSONType] | None]",
        )
    else:
        reveal_type(
            args,
            expected_text="list[str | float | int | bool | list[JSONType] | dict[str, JSONType] | None]",
        )
        largs: JSONArray = args


# Using type alias for "is None" narrowing:
LinkedList = tuple[int, "LinkedList"] | None


def g(xs: LinkedList) -> Generator[int, None, None]:
    while xs is not None:
        x, rest = xs
        yield x
        xs = rest
