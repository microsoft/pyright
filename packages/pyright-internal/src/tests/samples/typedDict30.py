# This sample tests the "get" and "pop" methods of a TypedDict when
# the key argument is a union of str literals.

from typing import Any, Literal, NotRequired, ReadOnly, TypedDict, assert_type

from typing_extensions import TypedDict as TypedDictExt


class Person(TypedDict):
    name: str
    age: int
    nickname: NotRequired[str]
    alias: NotRequired[bytes]


class Config(TypedDict):
    host: NotRequired[ReadOnly[str]]
    port: NotRequired[int]


class Closed(TypedDictExt, closed=True):
    a: int
    b: int
    optional: NotRequired[int]


class Parent(TypedDict):
    marker: int


def get_required(p: Person, k: Literal["name", "age"]):
    assert_type(p.get(k), str | int)
    assert_type(Person.get(p, k), str | int)
    assert_type(p.get(k, 0), str | int)


def get_mixed(p: Person, k: Literal["name", "nickname"]):
    assert_type(p.get(k), str | None)
    assert_type(p.get(k, 1.0), str | float)


def get_unknown(p: Person, k: Literal["name", "missing"]):
    assert_type(p.get(k), str | Any | None)


def pop_optional(p: Person, k: Literal["nickname", "alias"]):
    assert_type(p.pop(k), str | bytes)
    assert_type(p.pop(k, 0), str | bytes | int)


def pop_required(p: Person, k: Literal["name", "nickname"]):
    # Required keys use the pop(str) -> object fallback, as with a single key.
    assert_type(p.pop(k), object | str)


def pop_unknown(t: Parent, k: Literal["a", "b"]):
    assert_type(t.pop(k, 0), object | int)


def pop_readonly(c: Config, k: Literal["host", "port"]):
    assert_type(c.pop(k), object | int)


def pop_closed(t: Closed, k: Literal["a", "b"]):
    # This should generate two errors because "a" and "b" are required.
    t.pop(k)

    # This should generate an error because "a" and "b" are required.
    t.pop(k, 0)


def setdefault_readonly(c: Config, k: Literal["host", "port"]):
    # This should generate an error because "host" is read-only.
    c.setdefault(k, 0)


def setdefault_mixed(p: Person, k: str | Literal["name"]):
    # This should generate two errors because "str" is not a known key.
    p.setdefault(k, "")
