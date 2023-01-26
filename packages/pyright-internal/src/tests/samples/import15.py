# This sample tests the case where a symbol is imported from two different
# sources, one of them in a try block and another in an except block.

try:
    from typing import TypedDict
except ImportError:
    from typing_extensions import TypedDict


class TD1(TypedDict):
    x: int
