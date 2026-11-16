# This sample tests class equality guards that do not imply class identity.

from typing import Any, assert_type, final


class EqualMeta(type):
    def __eq__(cls, other: object) -> bool:
        return True


@final
class Left(metaclass=EqualMeta):
    def only_left(self) -> str:
        return "left"


@final
class Right(metaclass=EqualMeta):
    pass


class IntMarker(int, metaclass=EqualMeta):
    pass


def reverse_custom(value: Left | Right) -> str:
    if Left == type(value):
        assert_type(value, Left | Right)
        # This should generate an error because equality can succeed for Right.
        return value.only_left()
    return ""


def forward_custom(value: Left | Right) -> str:
    if type(value) == Left:
        assert_type(value, Left | Right)
        # This should generate an error because equality can succeed for Right.
        return value.only_left()
    return ""


def dynamic_class(value: int | str, expected: type[int]) -> int:
    if expected == type(value):
        assert_type(value, int | str)
        # This should generate an error because expected can have a custom metaclass.
        return value.bit_length()
    return 0


def dynamic_operators(value: int | str, expected: type[int]):
    if type(value) == expected:
        assert_type(value, int | str)
    else:
        assert_type(value, int | str)

    if expected != type(value):
        assert_type(value, int | str)
    else:
        assert_type(value, int | str)

    if type(value) != expected:
        assert_type(value, int | str)
    else:
        assert_type(value, int | str)


def dynamic_reference(value: int | str):
    # An int or str subclass can have a different metaclass.
    if int == type(value):
        assert_type(value, int | str)

    # Forward bare-class comparisons retain legacy narrowing behavior.
    if type(value) == int:
        assert_type(value, int)


def gradual_reference(value: Any):
    if int == type(value):
        assert_type(value, Any)


@final
class FinalA:
    pass


@final
class FinalB:
    pass


def closed_classes(value: FinalA | FinalB, expected: type[FinalA]):
    if expected == type(value):
        assert_type(value, FinalA)
    else:
        assert_type(value, FinalB)

    if type(value) == expected:
        assert_type(value, FinalA)

    if expected != type(value):
        assert_type(value, FinalB)
    else:
        assert_type(value, FinalA)

    if type(value) != expected:
        assert_type(value, FinalB)
    else:
        assert_type(value, FinalA)


reverse_custom(Right())
forward_custom(Right())
dynamic_class("reachable", IntMarker)
