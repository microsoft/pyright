# This sample verifies that a type compatibility check that involves
# a union of a concrete type and a TypeVar does not depend on the order
# in the union.

from typing import TypeVar

_T = TypeVar("_T")


def f1(x: tuple[int | _T]) -> _T | None:
    pass


def f2(x: tuple[_T | int]) -> None | _T:
    pass


def g1(z: tuple[int] | tuple[_T]) -> _T | None:
    reveal_type(f1(z), expected_text="_T@g1 | None")
    reveal_type(f2(z), expected_text="_T@g1 | None")


def g2(z: tuple[_T] | tuple[int]) -> _T | None:
    reveal_type(f1(z), expected_text="_T@g2 | None")
    reveal_type(f2(z), expected_text="_T@g2 | None")
