# This sample tests that a recursive type alias defined in terms of itself
# via a forward reference resolves correctly without producing Unknown types.
# This is a regression test for https://github.com/microsoft/pyright/issues/10850.
# The bug caused nondeterministic (order-dependent) type evaluation where
# analyzing files in different orders could produce Unknown types.

from typing import TypeVar

J = TypeVar("J", bound="JSON")
JSONObjectOf = dict[str, J]
JSON = str | JSONObjectOf["JSON"]
JSONObject = JSONObjectOf[JSON]


def identity(json: JSONObjectOf[JSON]) -> JSONObjectOf[JSON]:
    return json


def identity2(json: JSONObject) -> JSONObject:
    return json


# These assignments verify that JSON resolved correctly (not to Unknown).
# A str should be assignable to JSON.
v1: JSON = "hello"

# A nested dict[str, str] should be assignable to JSON.
v2: JSON = {"key": "value"}

# An int should NOT be assignable to JSON. This should generate an error.
v3: JSON = 42  # This is an error.

# A dict with int values should NOT be assignable to JSON. This should
# generate an error.
v4: JSONObject = {"key": 42}  # This is an error.
