# This sample tests diagnostic rule categorization for ReadOnly TypedDict key modifications.

from typing import NotRequired, TypedDict
from typing_extensions import ReadOnly


class TD1(TypedDict):
    a: ReadOnly[int]
    b: NotRequired[ReadOnly[str]]


def func1(td: TD1):
    # This should generate an error because "a" is ReadOnly.
    td["a"] = 1

    # This should generate an error because "a" is ReadOnly.
    del td["a"]

    # This should generate an error because "b" is ReadOnly.
    td["b"] = "hello"

    # This should generate an error because "b" is ReadOnly.
    del td["b"]
