# This sample tests type inference and diagnostic behavior for TypedDict
# methods (get, pop, setdefault) when called with union key types.

from typing import Any, Literal, NotRequired, ReadOnly, TypedDict, assert_type

class Person(TypedDict):
    name: str
    age: int
    nickname: NotRequired[str]

class Config(TypedDict):
    host: ReadOnly[str]
    port: int

def test_get_union_literal_keys(p: Person, k: Literal["name", "age"]):
    v = p.get(k)
    assert_type(v, str | int)

def test_get_union_with_not_required(p: Person, k: Literal["name", "nickname"]):
    v = p.get(k)
    assert_type(v, str | None)

def test_get_union_with_unknown_key(p: Person, k: Literal["name", "missing"], default_val: int):
    v1 = p.get(k)
    assert_type(v1, str | Any | None)

    v2 = p.get(k, default_val)
    assert_type(v2, str | Any | int)

def test_pop_union_literal_keys(p: Person, k: Literal["name", "age"]):
    v = p.pop(k)
    assert_type(v, str | int)

def test_pop_readonly_diagnostic(c: Config, k: Literal["host", "port"]):
    # This should report an error because "host" is ReadOnly.
    c.pop(k)

def test_setdefault_union_literal_keys(p: Person, k: Literal["name", "age"]):
    # This should report an error for default "val" not matching int ("age").
    v = p.setdefault(k, "val")
    assert_type(v, str | int)

def test_unbound_method_union_keys(p: Person, k: Literal["name", "age"]):
    v = Person.get(p, k)
    assert_type(v, str | int)
