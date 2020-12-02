# This sample tests the handling of complex recursive types.

# pyright: strict, reportUnusedVariable=false

from typing import Dict, List, Literal, Union


JSONArray = List["JSONType"]
JSONObject = Dict[str, "JSONType"]

JSONPrimitive = Union[str, float, int, bool, None]
JSONStructured = Union[JSONArray, JSONObject]

JSONType = Union[JSONPrimitive, JSONStructured]


# Using type alias checking for list:
def f2(args: JSONStructured):
    if isinstance(args, List):
        t1: Literal["JSONArray"] = reveal_type(args)
    else:
        t2: Literal["Dict[str, JSONType]"] = reveal_type(args)
        dargs: JSONObject = args


# Using type alias checking for dict:
def f3(args: JSONStructured):
    if isinstance(args, Dict):
        t1: Literal["JSONObject"] = reveal_type(args)
    else:
        t2: Literal["JSONArray"] = reveal_type(args)
        largs: JSONArray = args
