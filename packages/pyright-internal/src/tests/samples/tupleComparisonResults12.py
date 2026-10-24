# Empty-list inference must not add Unknown to tuple ordering results.
from typing import Any, assert_type, final


def takes_bool(value: bool) -> None:
    pass


def empty_left(right: list[int]) -> None:
    result = ([],) < (right,)
    assert_type(result, bool)
    takes_bool(result)
    assert_type(([],) <= (right,), bool)
    assert_type(([],) > (right,), bool)
    assert_type(([],) >= (right,), bool)


def empty_right(left: list[int]) -> None:
    result = (left,) < ([],)
    assert_type(result, bool)
    takes_bool(result)
    assert_type((left,) <= ([],), bool)
    assert_type((left,) > ([],), bool)
    assert_type((left,) >= ([],), bool)


def empty_alias(right: list[int]) -> None:
    empty = ([],)
    result = empty < (right,)
    assert_type(result, bool)
    takes_bool(result)


def dynamic_left(left: list[Any], right: list[int]) -> None:
    assert_type((left,) < (right,), Any | bool)
    assert_type((left,) <= (right,), Any | bool)
    assert_type((left,) > (right,), Any | bool)
    assert_type((left,) >= (right,), Any | bool)


def dynamic_right(left: list[int], right: list[Any]) -> None:
    assert_type((left,) < (right,), Any | bool)
    assert_type((left,) <= (right,), Any | bool)
    assert_type((left,) > (right,), Any | bool)
    assert_type((left,) >= (right,), Any | bool)


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


def empty_with_custom_elements(other: list[ReturnsText]) -> None:
    assert_type(([],) < (other,), bool)
    assert_type(([],) <= (other,), bool)
    assert_type(([],) > (other,), bool)
    assert_type(([],) >= (other,), bool)
    assert_type((other,) < ([],), bool)
    assert_type((other,) <= ([],), bool)
    assert_type((other,) > ([],), bool)
    assert_type((other,) >= ([],), bool)


def typed_empty_control(other: list[ReturnsText]) -> None:
    values: list[ReturnsText] = []
    values.append(ReturnsText())
    assert_type((values,) < (other,), str | bool)
    assert_type((values,) <= (other,), str | bool)
    assert_type((values,) > (other,), str | bool)
    assert_type((values,) >= (other,), str | bool)


def invalid_elements(left: list[str], right: list[int]) -> None:
    _ = (left,) < (right,)  # This should generate an operator error.
