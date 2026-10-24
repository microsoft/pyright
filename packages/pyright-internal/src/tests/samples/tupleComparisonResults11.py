# Missing optional element facts must not add Unknown or erase reachable results.
from typing import Any, assert_type, final


def empty_lists() -> None:
    assert_type(([],) < ([],), bool)
    assert_type(([],) <= ([],), bool)
    assert_type(([],) > ([],), bool)
    assert_type(([],) >= ([],), bool)


def unknown_lists(left: list[Any], right: list[Any]) -> None:
    assert_type((left,) < (right,), bool)
    assert_type((left,) <= (right,), bool)
    assert_type((left,) > (right,), bool)
    assert_type((left,) >= (right,), bool)


def none_lists(left: tuple[list[None]], right: tuple[list[None]]) -> None:
    assert_type(left < right, bool)
    assert_type(([None],) <= ([None, None],), bool)
    assert_type(([None, None],) > ([None],), bool)
    assert_type(([None],) >= ([None],), bool)


@final
class ReturnsText:
    def __lt__(self, other: object) -> str:
        return "lt"

    def __le__(self, other: object) -> str:
        return "le"

    def __gt__(self, other: object) -> str:
        return "gt"

    def __ge__(self, other: object) -> str:
        return "ge"


def custom_suffix(number: float, value: ReturnsText) -> None:
    assert_type((number, value) < (1, 0), str | bool)
    assert_type((number, value) <= (1, 0), str | bool)
    assert_type((number, value) > (1, 0), str | bool)
    assert_type((number, value) >= (1, 0), str | bool)
    assert_type(((number,), value) < ((1,), 0), str | bool)
    assert_type((number, (value,)) < (1, (0,)), str | bool)


def conditional_union(number: float, value: str | ReturnsText) -> None:
    assert_type((number, value) < (1, 0), str | bool)


type TextTree = tuple[ReturnsText, tuple[TextTree, ...]]


def conditional_alias(number: float, left: TextTree, right: TextTree) -> None:
    assert_type((number, left) < (1, right), str | bool)


def custom_lists(left: list[ReturnsText], right: list[ReturnsText]) -> None:
    assert_type((left,) < (right,), str | bool)
    assert_type((left,) <= (right,), str | bool)
    assert_type((left,) > (right,), str | bool)
    assert_type((left,) >= (right,), str | bool)


def bad_lt(number: float, value: ReturnsText) -> bool:
    return (number, value) < (1, 0)  # This should generate a return-type error.


def bad_le(number: float, value: ReturnsText) -> bool:
    return (number, value) <= (1, 0)  # This should generate a return-type error.


def bad_gt(number: float, value: ReturnsText) -> bool:
    return (number, value) > (1, 0)  # This should generate a return-type error.


def bad_ge(number: float, value: ReturnsText) -> bool:
    return (number, value) >= (1, 0)  # This should generate a return-type error.


def invalid_elements(left: tuple[str], right: tuple[int]) -> None:
    _ = left < right  # This should generate an operator error.


def invalid_lists(left: tuple[list[None]], right: tuple[list[int]]) -> None:
    _ = left < right  # This should generate an operator error.


def required_pair_after_conditional(
    number: float,
    left: list[str],
    right: list[int],
    left_tail: tuple[str],
    right_tail: tuple[int],
) -> None:
    # The later conditional visit must not hide the required list element pair.
    _ = (left, number, left_tail) < (right, 1, right_tail)  # This should generate an operator error.
