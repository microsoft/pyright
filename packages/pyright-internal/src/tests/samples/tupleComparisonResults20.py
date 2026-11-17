# This sample tests bounded comparison of growing recursive tuple aliases.

from typing import Self, assert_type


class TextBox[T]:
    def __lt__(self, other: object) -> str:
        return "ordered"

    def __le__(self, other: object) -> str:
        return "ordered"

    def __gt__(self, other: object) -> str:
        return "ordered"

    def __ge__(self, other: object) -> str:
        return "ordered"


class Pair[T, U]:
    def __lt__(self, other: Self) -> bool:
        return True

    def __le__(self, other: Self) -> bool:
        return True

    def __gt__(self, other: Self) -> bool:
        return True

    def __ge__(self, other: Self) -> bool:
        return True


type TextTree[T] = tuple[T, tuple[TextTree[TextBox[T]], ...]]
type PairTree[T] = tuple[T, tuple[PairTree[Pair[T, T]], ...]]


def bool_only(value: bool) -> None:
    pass


def text_tree(left: TextTree[int], right: TextTree[int]) -> None:
    assert_type(left < right, str | bool)
    assert_type(left <= right, str | bool)
    assert_type(left > right, str | bool)
    assert_type(left >= right, str | bool)

    # Already reached non-bool results survive a bounded recursive fallback.
    bool_only(left < right)
    bool_only(left <= right)
    bool_only(left > right)
    bool_only(left >= right)


def pair_tree(left: PairTree[int], right: PairTree[int]) -> None:
    assert_type(left < right, bool)
    assert_type(left <= right, bool)
    assert_type(left > right, bool)
    assert_type(left >= right, bool)


type UnusedTree[T] = tuple[int, tuple[UnusedTree[list[T]], ...]]


def unused_parameter(
    left: UnusedTree[TextBox[int]], right: UnusedTree[TextBox[int]]
) -> None:
    assert_type(left, UnusedTree[TextBox[int]])
    assert_type(right, UnusedTree[TextBox[int]])
    assert_type(left < right, bool)
    assert_type(left <= right, bool)
    assert_type(left > right, bool)
    assert_type(left >= right, bool)

    bool_only(left < right)
    bool_only(left <= right)
    bool_only(left > right)
    bool_only(left >= right)
