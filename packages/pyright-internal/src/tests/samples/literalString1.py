# This sample tests the evaluation of LiteralString as described
# in PEP 675.

from typing_extensions import Literal, LiteralString


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


def func2(a: str):
    ...


def func3(a: LiteralString):
    func2(a)
    a.lower()
