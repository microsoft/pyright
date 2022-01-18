# This sample tests the handling of complex recursive types.

# pyright: strict, reportUnusedVariable=false

from typing import Dict, List, Optional, Union


JSONArray = List["JSONType"]
JSONObject = Dict[str, "JSONType"]

JSONPrimitive = Union[str, float, int, bool, None]
JSONStructured = Union[JSONArray, JSONObject]

JSONType = Union[JSONPrimitive, JSONStructured]


# Using type alias checking for list:
def f2(args: JSONStructured):
    if isinstance(args, List):
        reveal_type(
            args,
            expected_text="List[str | float | int | bool | JSONArray | Dict[str, JSONType] | None]",
        )
    else:
        reveal_type(
            args,
            expected_text="Dict[str, str | float | int | bool | List[JSONType] | JSONObject | None]",
        )
        dargs: JSONObject = args


# Using type alias checking for dict:
def f3(args: JSONStructured):
    if isinstance(args, Dict):
        reveal_type(
            args,
            expected_text="Dict[str, str | float | int | bool | List[JSONType] | JSONObject | None]",
        )
    else:
        reveal_type(
            args,
            expected_text="List[str | float | int | bool | JSONArray | Dict[str, JSONType] | None]",
        )
        largs: JSONArray = args


# Using type alias for "is None" narrowing:
LinkedList = Optional[tuple[int, "LinkedList"]]


def g(xs: LinkedList):
    while xs is not None:
        x, rest = xs
        yield x
        xs = rest
