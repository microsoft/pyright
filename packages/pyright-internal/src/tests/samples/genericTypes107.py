# This sample tests the case where a function that includes a tuple
# parameter type is assignable to a generic callable that also includes
# a tuple type.

from typing import Callable, TypeVar

X = TypeVar("X")
Y = TypeVar("Y")


def deco1(func: Callable[[tuple[X]], Y]) -> Callable[[X], Y]:
    ...


def func1(x: tuple[str]) -> int:
    ...


v1 = deco1(func1)
reveal_type(v1, expected_text="(str) -> int")


def deco2(func: Callable[[tuple[X, ...]], Y]) -> Callable[[X], Y]:
    ...


def func2(x: tuple[str]) -> int:
    ...


v2 = deco2(func2)
reveal_type(v2, expected_text="(str) -> int")
