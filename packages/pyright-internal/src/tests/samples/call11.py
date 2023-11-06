# This sample tests the case where a call expression involves a union
# on the LHS where the subtypes of the union have different signatures.

# pyright: strict

from __future__ import annotations
from typing import Any, Callable, Generic, Self, TypeAlias, TypeVar

T = TypeVar("T")
E = TypeVar("E")
U = TypeVar("U")
F = TypeVar("F")

Either: TypeAlias = "Left[T]" | "Right[E]"


class Left(Generic[T]):
    def __init__(self, value: T) -> None:
        self.value = value

    def map_left(self, fn: Callable[[T], U]) -> Left[U]:
        return Left(fn(self.value))

    def map_right(self, fn: Callable[[Any], Any]) -> Self:
        return self


class Right(Generic[E]):
    def __init__(self, value: E) -> None:
        self.value = value

    def map_left(self, fn: Callable[[Any], Any]) -> Self:
        return self

    def map_right(self, fn: Callable[[E], F]) -> Right[F]:
        return Right(fn(self.value))


def func() -> Either[int, str]:
    raise NotImplementedError


result = func().map_left(lambda lv: lv + 1).map_right(lambda rv: rv + "a")
reveal_type(result, expected_text="Right[str] | Left[int]")
