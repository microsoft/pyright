# This sample tests the constraint solver's handling of callables
# whose input parameters are contravariant.

from typing import TypeVar, Callable

T = TypeVar("T")
U = TypeVar("U")
V = TypeVar("V")


def compose2(f: Callable[[T], U], g: Callable[[U], V]) -> Callable[[T], V]:
    def composition(x: T) -> V:
        return g(f(x))

    return composition


def add_one(x: int) -> int:
    return x + 1


def make_str(x: int) -> str:
    return str(x)


add_two: Callable[[int], str] = compose2(add_one, make_str)
