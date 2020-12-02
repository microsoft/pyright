# This sample verifies that "Never" doesn't appear in
# an inferred function return type.

from typing import Literal


def func1(a: str = ""):
    if not isinstance(a, str):
        t1: Literal["Never"] = reveal_type(a)
        return [a]


x1 = func1()
t1: Literal["list[Unknown] | None"] = reveal_type(x1)
