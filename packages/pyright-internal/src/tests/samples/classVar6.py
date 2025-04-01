# This sample tests that a ClassVar is disallowed when used in a
# NamedTuple or TypedDict class as reflected in the runtime.

from typing import ClassVar, NamedTuple, TypedDict


class NT1(NamedTuple):
    # This should generate an error.
    x: ClassVar

    # This should generate an error.
    y: ClassVar[int]


class TD1(TypedDict):
    # This should generate an error.
    x: ClassVar

    # This should generate an error.
    y: ClassVar[int]
