# This sample tests the type checker's reportUnnecessaryCast feature.

from typing import Annotated, Never, NoReturn, TypeVar, cast


def func1(a: int):
    # This should generate an error if
    # reportUnnecessaryCast is enabled.
    v1 = cast(int, a)


def func2(a: int | str):
    v1 = cast(int, a)

    b: str = "hello"
    v2 = cast(int, b)


def func3(a: int | None):
    v1 = cast(int, a)

    # This should generate an error if
    # reportUnnecessaryCast is enabled.
    v2 = cast(int | None, a)


T = TypeVar("T")


def func4(a: list[T]) -> list[T]:
    # This should generate an error if
    # reportUnnecessaryCast is enabled.
    v1 = cast(list[T], a)

    return a


def func5(a: Never):
    # This should generate an error if
    # reportUnnecessaryCast is enabled.
    v1 = cast(NoReturn, a)


def func6(a: type[int], b: int):
    v1 = cast(int, a)
    v2 = cast(type[int], b)

    # This should generate an error if
    # reportUnnecessaryCast is enabled.
    v3 = cast(type[int], a)

    # This should generate an error if
    # reportUnnecessaryCast is enabled.
    v4 = cast(int, b)


AnnotatedInt = cast(type[int], Annotated[int, ...])
