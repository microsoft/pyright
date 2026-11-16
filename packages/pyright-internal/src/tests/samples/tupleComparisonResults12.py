# A bare [] cannot exclude equality callbacks on the other list operand.
from typing import Any, assert_type, final


def takes_bool(value: bool) -> None:
    pass


def empty_left(right: list[int]) -> None:
    result = ([],) < (right,)
    reveal_type(result, expected_text="Unknown | bool")
    takes_bool(result)
    reveal_type(([],) <= (right,), expected_text="Unknown | bool")
    reveal_type(([],) > (right,), expected_text="Unknown | bool")
    reveal_type(([],) >= (right,), expected_text="Unknown | bool")


def empty_right(left: list[int]) -> None:
    result = (left,) < ([],)
    reveal_type(result, expected_text="Unknown | bool")
    takes_bool(result)
    reveal_type((left,) <= ([],), expected_text="Unknown | bool")
    reveal_type((left,) > ([],), expected_text="Unknown | bool")
    reveal_type((left,) >= ([],), expected_text="Unknown | bool")


def empty_alias(right: list[int]) -> None:
    empty = ([],)
    result = empty < (right,)
    reveal_type(result, expected_text="Unknown | bool")
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
    reveal_type(([],) < (other,), expected_text="Unknown | bool")
    reveal_type(([],) <= (other,), expected_text="Unknown | bool")
    reveal_type(([],) > (other,), expected_text="Unknown | bool")
    reveal_type(([],) >= (other,), expected_text="Unknown | bool")
    reveal_type((other,) < ([],), expected_text="Unknown | bool")
    reveal_type((other,) <= ([],), expected_text="Unknown | bool")
    reveal_type((other,) > ([],), expected_text="Unknown | bool")
    reveal_type((other,) >= ([],), expected_text="Unknown | bool")


def typed_empty_control(other: list[ReturnsText]) -> None:
    values: list[ReturnsText] = []
    values.append(ReturnsText())
    assert_type((values,) < (other,), str | bool)
    assert_type((values,) <= (other,), str | bool)
    assert_type((values,) > (other,), str | bool)
    assert_type((values,) >= (other,), str | bool)


def invalid_elements(left: list[str], right: list[int]) -> None:
    _ = (left,) < (right,)  # This should generate an operator error.
