# This sample tests the synthesized methods get, setdefault
# pop, __delitem__, clear, and popitem for a TypedDict.

from typing import TypedDict, final
from typing_extensions import (  # pyright: ignore[reportMissingModuleSource]
    NotRequired,
    Required,
)


class TD1(TypedDict):
    bar: NotRequired[str]


class TD2(TD1):
    foo: Required[str]


td1: TD1 = {}
td2: TD2 = {"foo": "hi"}

v1: str | None = td1.get("bar")

v2: str = td1.get("bar", "")

v3: str | int = td1.get("bar", 3)

v4: str = td1.setdefault("bar", "1")

# This should generate an error.
td1.setdefault("bar", 3)

# This should generate an error.
td1.setdefault("bar")

# This should generate an error.
td1.setdefault("baz", "")

v6: str = td1.pop("bar")
v7: str | int = td1.pop("bar", 1)
v8: str | int = td1.pop("bar", 3)

v9 = td2.pop("foo")
reveal_type(v9, expected_text="object")

v10 = td2.pop("foo", None)
reveal_type(v10, expected_text="object | None")

td1.__delitem__("bar")


@final
class TD3(TypedDict):
    foo: int
    baz: NotRequired[int]


class TD4(TypedDict):
    bar: str


C = TD3 | TD4


def func1(a: TD3, b: TD4, c: C, s: str) -> int | None:
    a1 = a.get("foo")
    reveal_type(a1, expected_text="int")
    a2 = a.get("foo", 1.0)
    reveal_type(a2, expected_text="int")
    a3 = a.get("bar")
    reveal_type(a3, expected_text="Any | None")
    a4 = a.get("bar", 1.0)
    reveal_type(a4, expected_text="Any | float")
    a5 = a.get("baz")
    reveal_type(a5, expected_text="int | None")
    a6 = a.get("baz", 1.0)
    reveal_type(a6, expected_text="int | float")
    a7 = a.get(s)
    reveal_type(a7, expected_text="Any | None")
    a8 = a.get(s, 1.0)
    reveal_type(a8, expected_text="Any | float")

    b1 = b.get("bar")
    reveal_type(b1, expected_text="str")
    b2 = b.get("bar", 1.0)
    reveal_type(b2, expected_text="str")
    b3 = b.get("foo")
    reveal_type(b3, expected_text="Any | None")
    b4 = b.get("foo", 1.0)
    reveal_type(b4, expected_text="Any | float")
    b5 = b.get(s)
    reveal_type(b5, expected_text="Any | None")
    b6 = b.get(s, 1.0)
    reveal_type(b6, expected_text="Any | float")

    c1 = c.get("foo")
    reveal_type(c1, expected_text="int | Any | None")
    c2 = c.get("foo", 1.0)
    reveal_type(c2, expected_text="int | Any | float")
    c3 = c.get("bar")
    reveal_type(c3, expected_text="Any | str | None")
    c4 = c.get("bar", 1.0)
    reveal_type(c4, expected_text="Any | float | str")
    c5 = c.get("baz")
    reveal_type(c5, expected_text="int | Any | None")
    c6 = c.get("baz", 1.0)
    reveal_type(c6, expected_text="int | float | Any")


class TD7(TypedDict, total=False):
    a: dict[str, str]
    b: list[str]


def func2(td7: TD7):
    v1 = td7.get("a", [])
    reveal_type(v1, expected_text="dict[str, str] | list[Any]")

    v2 = td7.get("a", {})
    reveal_type(v2, expected_text="dict[str, str]")

    v3 = td7.get("b", [])
    reveal_type(v3, expected_text="list[str]")
