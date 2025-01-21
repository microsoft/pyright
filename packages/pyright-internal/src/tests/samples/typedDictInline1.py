# This sample tests support for inlined TypedDict definitions.

from typing import NotRequired, ReadOnly, Required, TypedDict


td1: TypedDict[{"a": int, "b": str}] = {"a": 0, "b": ""}

td2: TypedDict[{"a": TypedDict[{"b": int}]}] = {"a": {"b": 0}}

td3: TypedDict[{"a": "list[float]"}] = {"a": [3]}

td4: TypedDict[
    {"a": NotRequired[int], "b": Required[int], "c": NotRequired[ReadOnly[int]]}
] = {"b": 3}

# This should generate an error because dictionary comprehensions
# are not allowed.
err1: TypedDict[{"a": int for _ in range(1)}]

# This should generate an error because unpacked dictionary
# entries are not allowed.
err2: TypedDict[{**{"a": int}}]

# This should generate an error because an extra type argument is provided.
err3: TypedDict[{"a": int}, str]

# This should generate an error because TypedDict cannot be used without
# a subscript in this context.
err4: TypedDict

# This should generate an error because a dict expression is not a
# valid type expression by itself.
err5: TypedDict[{"a": {"b": int}}] = {"a": {"b": 0}}


def func1(val: TypedDict[{"a": int}]) -> TypedDict[{"a": int}]:
    return {"a": val["a"] + 1}


func1({"a": 3})


type TA1[T] = TypedDict[{"a": int, "b": T, "c": NotRequired[int]}]


class Outer1[T]:
    attr1: TypedDict[{"a": list[T]}]

    def __init__(self, v: T) -> None:
        self.attr1 = {"a": [v]}
