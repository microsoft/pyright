# Inference from [] does not prove that a list is still empty.
from typing import Any, assert_type, final


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


def alias_left(other: list[ReturnsText]) -> None:
    values = []
    alias = values
    alias.append(ReturnsText())
    result = (values,) < (other,)
    reveal_type(result, expected_text="Unknown | bool")
    reveal_type((values,) <= (other,), expected_text="Unknown | bool")
    reveal_type((values,) > (other,), expected_text="Unknown | bool")
    reveal_type((values,) >= (other,), expected_text="Unknown | bool")
    assert_type(result, bool)  # This should generate an assert-type error.


def alias_right(other: list[ReturnsText]) -> None:
    values = []
    alias = values
    alias.append(ReturnsText())
    result = (other,) < (values,)
    reveal_type(result, expected_text="Unknown | bool")
    reveal_type((other,) <= (values,), expected_text="Unknown | bool")
    reveal_type((other,) > (values,), expected_text="Unknown | bool")
    reveal_type((other,) >= (values,), expected_text="Unknown | bool")
    assert_type(result, bool)  # This should generate an assert-type error.


def both_aliases() -> None:
    left = []
    left_alias = left
    left_alias.append(ReturnsText())
    right = []
    right_alias = right
    right_alias.append(ReturnsText())
    result = (left,) < (right,)
    reveal_type(result, expected_text="Unknown | bool")
    reveal_type((left,) <= (right,), expected_text="Unknown | bool")
    reveal_type((left,) > (right,), expected_text="Unknown | bool")
    reveal_type((left,) >= (right,), expected_text="Unknown | bool")
    assert_type(result, bool)  # This should generate an assert-type error.


def unmodified_alias(other: list[int]) -> None:
    empty = ([],)
    result = empty < (other,)
    reveal_type(result, expected_text="Unknown | bool")
    assert_type(result, bool)  # This should generate an assert-type error.


def direct_mutation(other: list[ReturnsText]) -> None:
    values = []
    values.append(ReturnsText())
    result = (values,) < (other,)
    reveal_type(result, expected_text="Unknown | bool")
    assert_type(result, bool)  # This should generate an assert-type error.


def dynamic_elements(left: list[Any], right: list[Any]) -> None:
    result = (left,) < (right,)
    assert_type(result, Any | bool)
    assert_type((left,) <= (right,), Any | bool)
    assert_type((left,) > (right,), Any | bool)
    assert_type((left,) >= (right,), Any | bool)
    assert_type(result, bool)  # This should generate an assert-type error.


def fresh_and_aliased_positions(other: list[ReturnsText]) -> None:
    values = []
    alias = values
    alias.append(ReturnsText())
    reveal_type(([], values) < (other, other), expected_text="Unknown | bool")
    reveal_type((values, []) < (other, other), expected_text="Unknown | bool")
    reveal_type((other, other) < ([], values), expected_text="Unknown | bool")
    reveal_type((other, other) < (values, []), expected_text="Unknown | bool")


def unpacked_positions(other: list[ReturnsText]) -> None:
    values = []
    alias = values
    alias.append(ReturnsText())
    pair = (None, values)
    nothing: tuple[()] = ()
    reveal_type((*pair, [], *nothing) < (None, other, []), expected_text="Unknown | bool")


def nested_alias(other: list[ReturnsText]) -> None:
    values = []
    alias = values
    alias.append(ReturnsText())
    reveal_type(((values,),) < ((other,),), expected_text="Unknown | bool")


def concrete_lists(left: list[ReturnsText], right: list[ReturnsText]) -> None:
    assert_type((left,) < (right,), str | bool)
    assert_type((left,) <= (right,), str | bool)
    assert_type((left,) > (right,), str | bool)
    assert_type((left,) >= (right,), str | bool)


class Reflected:
    def __lt__(self, other: list[object]) -> str:
        return "lt"

    def __le__(self, other: list[object]) -> str:
        return "le"

    def __gt__(self, other: list[object]) -> str:
        return "gt"

    def __ge__(self, other: list[object]) -> str:
        return "ge"


def fresh_with_custom_operand(value: Reflected) -> None:
    assert_type(([],) < (value,), str | bool)
    assert_type(([],) <= (value,), str | bool)
    assert_type(([],) > (value,), str | bool)
    assert_type(([],) >= (value,), str | bool)
    assert_type((value,) < ([],), str | bool)
    assert_type((value,) <= ([],), str | bool)
    assert_type((value,) > ([],), str | bool)
    assert_type((value,) >= ([],), str | bool)


def bad_concrete_return(left: list[ReturnsText], right: list[ReturnsText]) -> bool:
    return (left,) < (right,)  # This should generate a return-type error.


def bad_reflected_return(value: Reflected) -> bool:
    return ([],) < (value,)  # This should generate a return-type error.
