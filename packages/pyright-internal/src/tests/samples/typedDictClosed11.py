# This sample tests narrowing of a union of closed TypedDicts based on
# an "in" check for a key. A closed TypedDict cannot contain a key that
# is not one of its known items, so such a check can discriminate.


from typing import Never, NotRequired, TypedDict


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


class NeverItem(TypedDict):
    always: int
    never: Never


def func5(td: NeverItem) -> None:
    # A declared item typed as Never can never be present either, so the
    # same elimination applies to it and not only to the "extra items"
    # entry synthesized for a closed TypedDict.
    if "never" in td:
        reveal_type(td, expected_text="Never")
    else:
        reveal_type(td, expected_text="NeverItem")


class Left(TypedDict, closed=True):
    common: int
    left: int


class Right(TypedDict, closed=True):
    common: int
    right: NotRequired[int]


def func6(u: Left | Right) -> None:
    # "common" is a required known item of both, so neither is eliminated.
    if "common" in u:
        reveal_type(u, expected_text="Left | Right")
    else:
        reveal_type(u, expected_text="Never")


def func7(td: Right) -> None:
    # "right" is a known item that is not required, so the subtype is kept
    # and the key is marked as provided rather than eliminated.
    if "right" in td:
        reveal_type(td, expected_text="Right")
        reveal_type(td["right"], expected_text="int")


def func8(td: Baz) -> None:
    # "extra_items" constrains the type of the extra keys, not which of them
    # are present, so an "in" check for a key that is not a known item cannot
    # eliminate the type in either branch.
    if "other" in td:
        reveal_type(td, expected_text="Baz")
    else:
        reveal_type(td, expected_text="Baz")

        # This should generate an error because "baz" is an int.
        td["baz"] = ""


def func9(td: Baz) -> None:
    if "other" not in td:
        reveal_type(td, expected_text="Baz")

        # This should generate an error because "baz" is an int.
        td["baz"] = ""
    else:
        reveal_type(td, expected_text="Baz")
