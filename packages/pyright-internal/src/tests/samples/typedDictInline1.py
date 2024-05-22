# This sample tests support for inlined TypedDict definitions.

from typing import Dict


td1: dict[{"a": int, "b": str}] = {"a": 0, "b": ""}

td2: dict[{"a": dict[{"b": int}]}] = {"a": {"b": 0}}

td3: dict[{"a": "list[float]"}] = {"a": [3]}

# This should generate two errors because dictionary literals can be used
# only with dict or Dict.
err1: list[{"a": 1}]

# This should generate an error because dictionary comprehensions
# are not allowed.
err2: dict[{"a": int for _ in range(1)}]

# This should generate an error because unpacked dictionary
# entries are not allowed.
err3: dict[{**{"a": int}}]

# This should generate three errors because Dict doesn't support inlined
# TypedDict. It generates an exception at runtime.
err4: Dict[{"c": int}]

# This should generate an error because an extra type argument is provided.
err5: dict[{"a": int}, str]


def func1(val: dict[{"a": int}]) -> dict[{"a": int}]:
    return {"a": val["a"] + 1}


func1({"a": 3})
