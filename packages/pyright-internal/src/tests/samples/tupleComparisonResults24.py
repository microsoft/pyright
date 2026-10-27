# This sample tests closed container results reached before a recursive cutoff.

from typing import Never, assert_type


class Value[T]:
    def __lt__(self, other: object) -> list[str]:
        return ["ordered"]

    def __le__(self, other: object) -> list[str]:
        return ["ordered"]

    def __gt__(self, other: object) -> list[str]:
        return ["ordered"]

    def __ge__(self, other: object) -> list[str]:
        return ["ordered"]


type Tree[T] = tuple[Value[T], tuple[Tree[list[T]], ...]]


def bool_only(value: bool) -> None:
    pass


def compare(left: Tree[int], right: Tree[int]) -> None:
    assert_type(left < right, list[str] | bool)
    assert_type(left <= right, list[str] | bool)
    assert_type(left > right, list[str] | bool)
    assert_type(left >= right, list[str] | bool)

    # These should generate errors rather than erase the reached list result.
    bool_only(left < right)
    bool_only(left <= right)
    bool_only(left > right)
    bool_only(left >= right)


def bad_lt(left: Tree[int], right: Tree[int]) -> bool:
    # This should generate an error.
    return left < right


def bad_le(left: Tree[int], right: Tree[int]) -> bool:
    # This should generate an error.
    return left <= right


def bad_gt(left: Tree[int], right: Tree[int]) -> bool:
    # This should generate an error.
    return left > right


def bad_ge(left: Tree[int], right: Tree[int]) -> bool:
    # This should generate an error.
    return left >= right


type Payload = dict[str, list[tuple[int, str]]]


class NestedValue[T]:
    def __lt__(self, other: object) -> Payload:
        return {"items": [(1, "ordered")]}

    def __le__(self, other: object) -> Payload:
        return {"items": [(1, "ordered")]}

    def __gt__(self, other: object) -> Payload:
        return {"items": [(1, "ordered")]}

    def __ge__(self, other: object) -> Payload:
        return {"items": [(1, "ordered")]}


type NestedTree[T] = tuple[NestedValue[T], tuple[NestedTree[list[T]], ...]]


def nested(left: NestedTree[int], right: NestedTree[int]) -> None:
    assert_type(left < right, Payload | bool)
    assert_type(left <= right, Payload | bool)
    assert_type(left > right, Payload | bool)
    assert_type(left >= right, Payload | bool)

    # These should generate errors for closed aliases and nested containers too.
    bool_only(left < right)
    bool_only(left <= right)
    bool_only(left > right)
    bool_only(left >= right)


def finite(left: Value[int], right: Value[int]) -> None:
    assert_type((left, ()) < (right, ()), list[str] | bool)
    assert_type((left, ()) <= (right, ()), list[str] | bool)
    assert_type((left, ()) > (right, ()), list[str] | bool)
    assert_type((left, ()) >= (right, ()), list[str] | bool)


class EmptyValue[T]:
    def __lt__(self, other: object) -> list[Never]:
        return []


type EmptyTree[T] = tuple[EmptyValue[T], tuple[EmptyTree[list[T]], ...]]


def empty_lt(left: EmptyTree[int], right: EmptyTree[int]) -> bool:
    assert_type(left < right, list[Never] | bool)
    # This should generate an error.
    return left < right


def empty_gt(left: EmptyTree[int], right: EmptyTree[int]) -> bool:
    assert_type(left > right, list[Never] | bool)
    # This should generate an error.
    return left > right
