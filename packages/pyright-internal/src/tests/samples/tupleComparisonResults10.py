# Preserve ordinary tuple contracts when value equality is not represented by types.
from typing import Literal, assert_type, final


def identity_prefix(value: object) -> None:
    assert_type((value, 0) < (value, 1), bool)
    assert_type((value, 0) <= (value, 1), bool)
    assert_type((value, 0) > (value, 1), bool)
    assert_type((value, 0) >= (value, 1), bool)


def float_alias() -> None:
    number = 1.0
    saved = number
    number = 2.0
    assert_type((saved, "text") < (2, 3), bool)
    assert_type((saved, "text") <= (2, 3), bool)
    assert_type((saved, "text") > (2, 3), bool)
    assert_type((saved, "text") >= (2, 3), bool)
    assert_type(saved, float)


def known_prefix() -> None:
    assert_type((1, "text") < (2, 3), bool)
    assert_type((1, "text") < (1, 3), bool)  # This should generate an operator error.
    assert_type((True, "text") < (1, 3), bool)  # This should generate an operator error.


@final
class RequiresString:
    def __lt__(self, other: str) -> bool:
        return False


def declared_arguments(value: RequiresString) -> None:
    _ = (value,) < (1,)  # This should generate an operator error.
    _ = (1, value) < (1, 0)  # This should generate an operator error.


def float_prefix_contract(value: RequiresString) -> None:
    number = 1.0
    assert_type((number, value) < (2, 0), bool)


def nested_float_prefix(value: object, flag: bool) -> None:
    left = ((1.0,), value)
    right = ((2,), 3)
    assert_type(left < right, bool)
    assert_type(left <= right, bool)
    assert_type(left > right, bool)
    assert_type(left >= right, bool)
    deeper = (((1.0,),), value)
    assert_type(deeper < (((2,),), 3), bool)
    mixed = ((1.0 if flag else 1,), value)
    assert_type(mixed < right, bool)


def bounded_float_prefix[T: float](number: T, value: object) -> T:
    assert_type((number, value) < (2, 3), bool)
    return number


@final
class ReturnsText:
    def __lt__(self, other: object) -> str:
        return "text"


def numeric_prefix_result(first: ReturnsText, second: ReturnsText) -> None:
    # A float type alone does not prove that the custom suffix is unreachable.
    assert_type((1.0, first) < (2, 0), str | bool)
    assert_type((first, 1.0) < (second, 2), str | bool)
    assert_type(((first, 1.0), object()) < ((second, 2), 3), str | bool)


def nested_declared_arguments(value: RequiresString) -> None:
    _ = ((value, 1.0), object()) < ((0, 2), 3)  # This should generate an operator error.


def nested_identity_contract(value: object, custom: RequiresString) -> None:
    assert_type(((value, 0), 0) < ((value, 1), 0), bool)
    assert_type((((value, 0),), 0) >= (((value, 1),), 0), bool)
    left = ((custom, 0), 0)
    right = ((custom, 1), 0)
    saved_left = left
    saved_right = right
    assert_type(saved_left < saved_right, bool)
    assert_type(((value, 1.0), value) < ((value, 2), 3), bool)


type Tree[T] = tuple[T, RequiresString, tuple[Tree[list[T]], ...]]


def required_alias_contract(
    first: tuple[Tree[int], tuple[float, Tree[int]]],
    second: tuple[Tree[int], tuple[int, Tree[int]]],
) -> None:
    # The types do not establish whether the user comparison is reached.
    assert_type(first < second, bool)


def identity_without_element_ordering(value: RequiresString, items: tuple[RequiresString, ...]) -> None:
    assert_type((value, 0) < (value, 1), bool)
    assert_type(items < items, bool)
    assert_type(items <= items, bool)
    assert_type(items > items, bool)
    assert_type(items >= items, bool)
    # A direct identity proof that exceeds the 64-node cap uses the old contract.
    assert_type(
        (value, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
        < (value, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
        bool,
    )


data = ((1, "a"),)
arithmetic_row = (data[0][0] + 1,)
assert_type([arithmetic_row], list[tuple[int]])


def literal_guard() -> None:
    number = data[0][0]
    if number == 1:
        row = (number,)
        assert_type([row], list[tuple[Literal[1]]])


def membership_guard() -> None:
    number = data[0][0]
    if number in (1, 2):
        row = (number,)
        rows = [row]
        assert_type(rows, list[tuple[Literal[1, 2]]])
        rows.append((2,))


def truthiness_guard() -> None:
    number = ((True,),)[0][0]
    if number:
        row = (number,)
        assert_type([row], list[tuple[Literal[True]]])


def inferred_guard(number: int) -> None:
    if number == data[0][0]:
        row = (number,)
        assert_type([row], list[tuple[int]])
    first = data[0][0]
    second = data[0][0]
    if first == second:
        row = (first,)
        assert_type([row], list[tuple[int]])


def pattern_guard() -> None:
    number = data[0][0]
    match number:
        case 1:
            row = (number,)
            assert_type([row], list[tuple[Literal[1]]])
