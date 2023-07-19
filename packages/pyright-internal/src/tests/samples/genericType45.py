# This sample tests that invariance is properly enforced when appropriate.

from typing import Any, TypeVar

T = TypeVar("T")


def func1(v: list[float | str]):
    # This should generate an error.
    x1: list[float] = v

    x2: list[str | float] = v

    # This should generate an error.
    x3: list[float | str | None] = v

    x4: list[Any | str] = v

    # This should generate an error.
    x5: list[int | str] = v

    x6: list[float | int | str] = v


def func2(v: list[T]) -> T:
    x1: list[T] = v

    x2: list[Any | T] = v

    # This should generate an error.
    x3: list[int | T] = v

    return v[0]


def func3(v: list[float | T]) -> float | T:
    # This should generate an error.
    x1: list[T] = v

    x2: list[Any | T] = v

    x3: list[T | float] = v

    # This should generate an error.
    x4: list[T | int] = v

    x5: list[float | int | T] = v

    return v[0]


def func4(v: list[Any | int | str]):
    x1: list[Any | int] = v

    x2: list[Any | list[str]] = v

    x3: list[Any | int | str | list[str]] = v
