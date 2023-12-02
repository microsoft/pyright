# This sample tests bidirectional type inference when assigning
# a value to a TypedDict element.

from typing import TypedDict


class Thing(TypedDict):
    v1: bool
    v2: str


class Thing2(TypedDict):
    v3: Thing | None
    v4: list[str | int] | None


thing2: Thing2 = {"v3": None, "v4": None}
thing2["v3"] = {"v1": False, "v2": "a"}
thing2["v4"] = []
thing2["v4"] = [3]
thing2["v4"] = ["hi"]
thing2["v4"] = ["hi", 4]

# This should generate an error
thing2["v4"] = ["hi", 4.0]
