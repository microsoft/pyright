# This sample tests the case where a comprehension requires bidirectional
# type inference for correct analysis.

# pyright: strict

from typing import TypedDict


class X(TypedDict):
    x: str


xs: list[X] = []
xs.extend({"x": c} for c in "abc")


def func1(data: dict[str, int]):
    sum(data.get(k, 0) for k in "")


def func2(data: dict[str, int]):
    sum([data.get(k, 0) for k in ""])
