# This sample tests that invariant type variables are enforced.

from typing import Hashable


def func1(x: list[Hashable]): ...


def func2(x: list[object]): ...


v1: list[int] = [1]

# This should generate an error.
func1(v1)

# This should generate an error.
func2(v1)
