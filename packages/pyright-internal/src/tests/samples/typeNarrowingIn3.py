# This sample tests cross-type equality in container narrowing.

from enum import IntEnum, StrEnum
from typing import Literal, assert_never, assert_type


def numeric_values(value: float, container: dict[str, Literal[1]]):
    if value in container.values():
        assert_type(value, float)
        value.hex()
        # This should generate an error because equality with an int does not make value an int.
        value.bit_length()

    if value not in container.values():
        assert_type(value, float)
    else:
        assert_type(value, float)
        value.hex()


def numeric_keys(value: float, container: dict[Literal[1], str]):
    if value in container.keys():
        assert_type(value, float)
        value.hex()
        # This should generate an error.
        value.bit_length()


def numeric_union(value: float, container: list[Literal[1]] | tuple[Literal[1], ...]):
    if value in container:
        assert_type(value, float)
        value.hex()
        # This should generate an error.
        value.bit_length()


def numeric_union_reversed(value: float, container: tuple[Literal[1], ...] | list[Literal[1]]):
    if value not in container:
        assert_type(value, float)
    else:
        assert_type(value, float)
        value.hex()
        # This should generate an error.
        value.bit_length()


def numeric_literals(value: int, booleans: dict[str, Literal[True]], number: complex, integers: dict[str, Literal[1]]):
    if value in booleans.values():
        assert_type(value, int)
    if number in integers.values():
        assert_type(number, complex)


class IntChoice(IntEnum):
    ONE = 1


class StrChoice(StrEnum):
    ONE = "one"


def enum_literals(
    number: int,
    text: str,
    numbers: dict[str, Literal[IntChoice.ONE]],
    strings: dict[str, Literal[StrChoice.ONE]],
):
    if number in numbers.values():
        assert_type(number, int)
    if text in strings.values():
        assert_type(text, Literal["one"])


def literal_controls(value: int | None, literal: Literal[1, 2], obj: object, container: dict[str, Literal[1]]):
    if value in container.values():
        assert_type(value, Literal[1])
    if literal in container.values():
        assert_type(literal, Literal[1])
    if obj in container.values():
        assert_type(obj, Literal[1])


def set_values(value: set[int], container: dict[str, frozenset[int]]):
    if value not in container.values():
        assert_type(value, set[int])
    else:
        assert_type(value, set[int])
        value.add(2)

    if value in container.values():
        assert_type(value, set[int])
        value.add(2)
        # This should generate an error because the branch is reachable.
        assert_never(value)


def frozenset_values(value: frozenset[int], container: dict[str, set[int]]):
    if value in container.values():
        assert_type(value, frozenset[int])
        value.union({2})
        # This should generate an error because the branch is reachable.
        assert_never(value)


def set_union(value: set[int], container: list[frozenset[int]] | tuple[frozenset[int], ...]):
    if value in container:
        assert_type(value, set[int])
        value.add(2)
        # This should generate an error because the branch is reachable.
        assert_never(value)


def set_union_reversed(value: set[int], container: tuple[frozenset[int], ...] | list[frozenset[int]]):
    if value not in container:
        assert_type(value, set[int])
    else:
        assert_type(value, set[int])
        value.add(2)
        # This should generate an error because the branch is reachable.
        assert_never(value)


def containment_expressions(
    value: set[int],
    frozen: frozenset[int],
    values: dict[str, frozenset[int]],
    mutable_values: dict[str, set[int]],
    union: list[frozenset[int]] | tuple[frozenset[int], ...],
):
    return (
        value in values.values(),
        value not in values.values(),
        frozen in mutable_values.values(),
        frozen not in mutable_values.values(),
        value in union,
        value not in union,
    )


def set_comparisons(left: set[int], right: frozenset[int]):
    equal = left == right
    different = right != left
    # This should generate an error because equality does not imply identity.
    same = left is right
    # This should generate an error.
    not_same = left is not right
    return equal, different, same, not_same
