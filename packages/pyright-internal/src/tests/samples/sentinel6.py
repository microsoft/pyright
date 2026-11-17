# This sample tests narrowing of a union containing a sentinel
# by equality and membership tests against string literals.
# A sentinel literal can only ever compare equal to itself, so it
# should be eliminated when the compared value is a different literal.

from typing_extensions import sentinel  # pyright: ignore[reportMissingModuleSource]

S = sentinel("S")


def func1(a: str | S):
    if a == "a":
        reveal_type(a, expected_text="Literal['a']")

    if a in ("a", "b"):
        reveal_type(a, expected_text="Literal['a', 'b']")
