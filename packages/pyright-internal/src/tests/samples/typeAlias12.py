# This sample tests the handling of a generic type alias that uses
# a union that collapses to a single type when specialized.

from typing import TypeVar

V = TypeVar("V")
U = TypeVar("U")

Alias = V | U


def fn(x: Alias[V, V]) -> V:
    return x


def fn2(x: list[Alias[V, V]]) -> list[V]:
    return x


reveal_type(Alias[int, int], expected_text="type[int]")
