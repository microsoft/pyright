# This sample tests the handling of a generic type alias that uses
# a union that collapses to a single type when specialized.

from typing import TypeVar

V = TypeVar("V")
U = TypeVar("U")

Alias = V | U


def func1(x: Alias[V, V]) -> V:
    return x


def func2(x: list[Alias[V, V]]) -> list[V]:
    return x


def func3(x: Alias[int, int]):
    reveal_type(x, expected_text="int")
