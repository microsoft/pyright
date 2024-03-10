# This sample tests the handling of Required and NotRequired
# (PEP 655) in TypedDict definitions.

# pyright: reportMissingModuleSource=false

from typing import Annotated, TypedDict
from typing_extensions import (  # pyright: ignore[reportMissingModuleSource]
    NotRequired,
    Required,
)


class TD1(TypedDict):
    a: Required[int]
    b: NotRequired[int]

    # This should generate an error because NotRequired can't be
    # used in this context.
    c: NotRequired[NotRequired[int]]

    # This should generate an error because Required can't be
    # used in this context.
    d: Required[Required[int]]

    e: NotRequired[Annotated[int, "hi"]]

    # This should generate an error because it's missing type args.
    f: Required

    # This should generate an error because it's missing type args.
    g: NotRequired


# This should generate an error because Required can't be
# used in this context.
x: Required[int]

# This should generate an error because NotRequired can't be
# used in this context.
y: Required[int]


class Foo:
    # This should generate an error because Required can't be
    # used in this context.
    x: Required[int]

    # This should generate an error because NotRequired can't be
    # used in this context.
    y: Required[int]
