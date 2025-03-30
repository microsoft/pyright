# This sample tests the evaluation of LiteralString as described
# in PEP 675.

from typing import Iterable
from typing_extensions import (  # pyright: ignore[reportMissingModuleSource]
    Literal,
    LiteralString,
)


def func1(a: str, b: bytes, c: Literal["a"], d: Literal["a", "b"], e: Literal["a", 1]):
    # This should generate an error.
    v1: LiteralString = a

    # This should generate an error.
    v2: LiteralString = b

    # This should generate an error.
    v3: LiteralString = b""

    v4: LiteralString = "Hello!"

    v5: LiteralString = "Hello " + "Bob"

    # This should generate an error.
    v6: LiteralString = f"{a}"

    # This should generate an error.
    v7: LiteralString[int]

    v8: LiteralString = c

    v9: LiteralString = d

    # This should generate an error.
    v10: LiteralString = e


def func2(a: str): ...


def func3(a: LiteralString):
    func2(a)
    a.lower()

    _ = a + "hi" + a.capitalize()


def func4(a: LiteralString, parts: Iterable[LiteralString]):
    v1 = "".join(parts)
    reveal_type(v1, expected_text="LiteralString")

    v2 = "".join([a, a])
    reveal_type(v2, expected_text="LiteralString")


def func5(
    a: LiteralString, b: str, parts: Iterable[tuple[LiteralString, LiteralString]]
):
    v1: LiteralString = f"{a} {a}"

    v2: LiteralString = f"{a}{a}"

    v3: LiteralString = f"{'xxx'}{'xxx'}"

    # This should generate an error because "b" is not literal.
    v4: LiteralString = f"{a} {b}"


def func6(a: LiteralString):
    v1 = a.capitalize()

    v2 = a[0]

    a = "hi"

    v3: list[LiteralString] = "1 2 3".split(" ")


def func7(a: Literal["a", "b"], b: Literal["a", 1]):
    v1: LiteralString = f"{a}"

    # This should generate an error because "b" is not a string literal.
    v2: LiteralString = f"{b}"


def func8(a: list[LiteralString], b: list[Literal["a"]]):
    # This should generate an error because of invariance rules.
    v1: list[str] = a

    # This should generate an error because of invariance rules.
    v2: list[LiteralString] = b
