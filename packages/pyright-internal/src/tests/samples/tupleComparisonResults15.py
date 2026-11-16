# Recursive specializations can recreate equivalent tuple instances.
from typing import assert_type


type Left[T] = tuple[T, tuple[Right[T], ...]]
type Right[T] = tuple[T, tuple[Left[T], ...]]


def compare(left: Left[str], right: Right[str]) -> None:
    assert_type(left < right, bool)
    assert_type(left <= right, bool)
    assert_type(left > right, bool)
    assert_type(left >= right, bool)


def same_alias(left: Left[str], right: Left[str]) -> None:
    assert_type(left < right, bool)


type First[T] = tuple[T, tuple[Second[T], ...]]
type Second[T] = tuple[T, tuple[Third[T], ...]]
type Third[T] = tuple[T, tuple[First[T], ...]]


def three_aliases(left: First[str], right: Third[str]) -> None:
    assert_type(left < right, bool)


class ReturnsText:
    def __lt__(self, other: object) -> str:
        return "text"


def nonbool_result(left: Left[ReturnsText], right: Right[ReturnsText]) -> str | bool:
    result = left < right
    assert_type(result, str | bool)
    return result


def invalid_result(left: Left[ReturnsText], right: Right[ReturnsText]) -> bool:
    return left < right  # This should generate a return-type error.


def invalid_elements(left: Left[str], right: Right[int]) -> None:
    _ = left < right  # This should generate an operator error.
