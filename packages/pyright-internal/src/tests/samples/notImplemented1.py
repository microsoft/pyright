# This sample validates narrowing and magic method resolution for
# types.NotImplementedType.

from types import EllipsisType, NotImplementedType


def check1(val: int | str | NotImplementedType):
    if isinstance(val, int):
        reveal_type(val, expected_text="int")

    # This should generate an error for both str and NotImplementedType.
    _ = val + 2


def check2(val: int | str | EllipsisType):
    if isinstance(val, int):
        reveal_type(val, expected_text="int")


def check3(val: int | NotImplementedType):
    if isinstance(val, int):
        reveal_type(val, expected_text="int")

    # This should generate an error for NotImplementedType.
    _ = val + 2


def check4(val: NotImplementedType):
    if isinstance(val, object):
        reveal_type(val, expected_text="NotImplementedType")


class AcceptsObject:
    def __radd__(self, other: object) -> str:
        return ""


# The reflected method can still explicitly accept NotImplemented as an object.
reveal_type(NotImplemented + AcceptsObject(), expected_text="str")
