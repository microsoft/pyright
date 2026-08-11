# This sample tests narrowing of a union of closed TypedDicts based on
# an "in" check for a key. A closed TypedDict cannot contain a key that
# is not one of its known items, so such a check can discriminate.


from typing import TypedDict


class Foo(TypedDict, closed=True):
    foo: int


class Bar(TypedDict, closed=True):
    bar: int


def func1(u: Foo | Bar) -> int:
    if "foo" in u:
        reveal_type(u, expected_text="Foo")
        return u["foo"]
    else:
        reveal_type(u, expected_text="Bar")
        return u["bar"]


def func2(u: Foo | Bar) -> int:
    if "bar" not in u:
        reveal_type(u, expected_text="Foo")
        return u["foo"]
    else:
        reveal_type(u, expected_text="Bar")
        return u["bar"]


class Baz(TypedDict, extra_items=int):
    baz: int


def func3(u: Foo | Baz) -> None:
    # "Baz" allows extra items, so it cannot be eliminated here.
    if "foo" in u:
        reveal_type(u, expected_text="Foo | Baz")
    else:
        reveal_type(u, expected_text="Baz")


class Open(TypedDict):
    other: int


def func4(u: Foo | Open) -> None:
    # An open TypedDict without "extra_items" is narrowed on a key check
    # even though it is not sound to do so; this is idiomatic and is
    # relied upon in practice.
    if "foo" in u:
        reveal_type(u, expected_text="Foo")
    else:
        reveal_type(u, expected_text="Open")
