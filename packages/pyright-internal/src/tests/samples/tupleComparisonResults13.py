# Gradual tails must not erase results already known from a fixed prefix.
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


def left_tail(left: tuple[ReturnsText, *tuple[Any, ...]]) -> None:
    assert_type(left < (0,), str | bool)
    assert_type(left <= (0,), str | bool)
    assert_type(left > (0,), str | bool)
    assert_type(left >= (0,), str | bool)


def right_tail(value: ReturnsText, right: tuple[int, *tuple[Any, ...]]) -> None:
    assert_type((value,) < right, str | bool)
    assert_type((value,) <= right, str | bool)
    assert_type((value,) > right, str | bool)
    assert_type((value,) >= right, str | bool)


def reflected_tail(right: tuple[ReturnsText, *tuple[Any, ...]]) -> None:
    assert_type((0,) < right, str | bool)
    assert_type((0,) <= right, str | bool)
    assert_type((0,) > right, str | bool)
    assert_type((0,) >= right, str | bool)


def fixed_shape_control(value: ReturnsText) -> None:
    assert_type((value,) < (0,), str | bool)
    assert_type((value,) <= (0,), str | bool)
    assert_type((value,) > (0,), str | bool)
    assert_type((value,) >= (0,), str | bool)


def bad_left_lt(left: tuple[ReturnsText, *tuple[Any, ...]]) -> bool:
    return left < (0,)  # This should generate a return-type error.


def bad_left_le(left: tuple[ReturnsText, *tuple[Any, ...]]) -> bool:
    return left <= (0,)  # This should generate a return-type error.


def bad_left_gt(left: tuple[ReturnsText, *tuple[Any, ...]]) -> bool:
    return left > (0,)  # This should generate a return-type error.


def bad_left_ge(left: tuple[ReturnsText, *tuple[Any, ...]]) -> bool:
    return left >= (0,)  # This should generate a return-type error.


def bad_right_lt(value: ReturnsText, right: tuple[int, *tuple[Any, ...]]) -> bool:
    return (value,) < right  # This should generate a return-type error.


def bad_right_le(value: ReturnsText, right: tuple[int, *tuple[Any, ...]]) -> bool:
    return (value,) <= right  # This should generate a return-type error.


def bad_right_gt(value: ReturnsText, right: tuple[int, *tuple[Any, ...]]) -> bool:
    return (value,) > right  # This should generate a return-type error.


def bad_right_ge(value: ReturnsText, right: tuple[int, *tuple[Any, ...]]) -> bool:
    return (value,) >= right  # This should generate a return-type error.


def bad_reflected_lt(right: tuple[ReturnsText, *tuple[Any, ...]]) -> bool:
    return (0,) < right  # This should generate a return-type error.


def bad_reflected_ge(right: tuple[ReturnsText, *tuple[Any, ...]]) -> bool:
    return (0,) >= right  # This should generate a return-type error.


def opaque_tail_control(left: tuple[Any, ...], right: tuple[Any, ...]) -> None:
    assert_type(left < right, bool)
    assert_type(left <= right, bool)
    assert_type(left > right, bool)
    assert_type(left >= right, bool)


class ReturnsAny:
    def __lt__(self, other: object) -> Any:
        return "lt"


def dynamic_return_control(left: tuple[ReturnsAny, *tuple[Any, ...]]) -> None:
    assert_type(left < (0,), Any | bool)
