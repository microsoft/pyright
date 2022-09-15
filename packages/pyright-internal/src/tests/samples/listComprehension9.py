# This sample tests the case where a comprehension requires bidirectional
# type inference for correct analysis.

from typing import TypedDict


class X(TypedDict):
    x: str


xs: list[X] = []
xs.extend({"x": c} for c in "abc")
