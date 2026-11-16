# This sample tests the "get" and "pop" methods of a TypedDict when
# the key argument is a union of str literals.

from typing import Any, Generic, Literal, NotRequired, ReadOnly, TypeVar, TypedDict, assert_type, overload

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


def pop_mixed_unknown(p: Person, k: Literal["nickname", "missing"]):
    assert_type(p.pop(k), str | object)
    assert_type(p.pop(k, 0), str | object | int)
    assert_type(Person.pop(p, k), str | object)
    assert_type(Person.pop(p, k, 0), str | object | int)


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


T = TypeVar("T")


class Box(TypedDict, Generic[T], total=False):
    a: T
    b: list[T]


IntBox = Box[int]


def pop_generic(t: Box[int], k: Literal["a", "b"]):
    assert_type(t.pop(k, 0), int | list[int])
    assert_type(IntBox.pop(t, k, 0), int | list[int])
    assert_type(Box.pop(t, k, 0), object | int)

    # This should generate an error because the result can be list[int].
    bound: int | list[str] = t.pop(k, 0)

    # This should generate an error rather than accepting an Unknown result.
    unbound: int | list[str] = Box.pop(t, k, 0)


def get_generic(t: Box[T], k: Literal["a", "b"], default: T):
    assert_type(t.get(k), T | list[T] | None)
    assert_type(t.get(k, default), T | list[T])
    assert_type(t.pop(k, default), T | list[T])


@overload
def take(value: list[float]) -> int: ...


@overload
def take(value: bytes) -> bytes: ...


def take(value: list[float] | bytes) -> int | bytes:
    return value if isinstance(value, bytes) else len(value)


def get_contextual_default(t: Closed, k: Literal["missing1", "missing2"]):
    assert_type(take(t.get(k, [1])), int)
    assert_type(take(t.get("missing1", [1])), int)
    direct: list[float] = t.get(k, [1])
    assert_type(direct, list[float])


class Lists(TypedDict):
    a: NotRequired[list[float]]
    b: NotRequired[list[float]]


def contextual_optional_default(t: Lists, k: Literal["a", "b"]):
    assert_type(take(t.get(k, [1])), int)
    assert_type(t.pop(k, [1]), list[float] | list[int])
