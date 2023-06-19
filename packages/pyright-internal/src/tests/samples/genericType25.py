# This sample tests that a union that includes two types that are subtypes
# of each other (like tuple[Any] and tuple[int]) is handled correctly
# when performing type compatibility tests.

from typing import Any


def func(t: tuple[Any] | tuple[int]):
    # This should generate a type violation.
    x: int = t
