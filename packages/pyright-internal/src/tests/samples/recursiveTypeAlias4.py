# This sample tests the handling of complex recursive types.

# pyright: strict, reportUnusedVariable=false

from typing import Dict, List, Literal, Optional, Union


JSONArray = List["JSONType"]
JSONObject = Dict[str, "JSONType"]

JSONPrimitive = Union[str, float, int, bool, None]
JSONStructured = Union[JSONArray, JSONObject]

JSONType = Union[JSONPrimitive, JSONStructured]


# Using type alias checking for list:
def f2(args: JSONStructured):
    if isinstance(args, List):
        t1: Literal[
            "List[str | float | int | bool | Type[List[JSONType]] | Dict[str, Type[str] | Type[float] | Type[int] | Type[bool] | Type[List[JSONType]] | Type[Dict[str, ...]] | None] | None]"
        ] = reveal_type(args)
    else:
        t2: Literal[
            "Dict[str, Type[str] | Type[float] | Type[int] | Type[bool] | Type[List[str | float | int | bool | JSONArray | Dict[str, ...] | None]] | Type[Dict[str, ...]] | None]"
        ] = reveal_type(args)
        dargs: JSONObject = args


# Using type alias checking for dict:
def f3(args: JSONStructured):
    if isinstance(args, Dict):
        t1: Literal[
            "Dict[str, Type[str] | Type[float] | Type[int] | Type[bool] | Type[List[str | float | int | bool | JSONArray | Dict[str, ...] | None]] | Type[Dict[str, ...]] | None]"
        ] = reveal_type(args)
    else:
        t2: Literal[
            "List[str | float | int | bool | Type[List[JSONType]] | Dict[str, Type[str] | Type[float] | Type[int] | Type[bool] | Type[List[JSONType]] | Type[Dict[str, ...]] | None] | None]"
        ] = reveal_type(args)
        largs: JSONArray = args


# Using type alias for "is None" narrowing:
LinkedList = Optional[tuple[int, "LinkedList"]]


def g(xs: LinkedList):
    while xs is not None:
        x, rest = xs
        yield x
        xs = rest
