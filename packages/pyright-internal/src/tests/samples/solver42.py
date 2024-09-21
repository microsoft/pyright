# This sample tests the case involving assignment to a union that contains
# multiple instances of the same TypeVar.

from typing import TypeVar


T = TypeVar("T")


def func1(x: tuple[T, list[T]] | list[T]) -> None: ...


def func2(x: tuple[T, list[T]] | None) -> None: ...


def test1(list_of_int: list[int]):
    # This should generate an error.
    func1((None, list_of_int))

    # This should generate an error.
    func2((None, list_of_int))
