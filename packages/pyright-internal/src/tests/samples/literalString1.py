# This sample tests the evaluation of LiteralString as described
# in PEP 675.

from typing_extensions import LiteralString


def func1(a: str, b: bytes):
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
