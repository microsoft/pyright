# This sample validates narrowing and the use of NotImplementedType in operators.

from typing import TypeVar
from types import EllipsisType, NotImplementedType


def check1(val: int | str | NotImplementedType):
    if isinstance(val, int):
        reveal_type(val, expected_text="int")

    # This should generate an error because str does not support addition with int.
    _ = val + 2


def check2(val: int | str | EllipsisType):
    if isinstance(val, int):
        reveal_type(val, expected_text="int")


def check3(val: int | NotImplementedType):
    if isinstance(val, int):
        reveal_type(val, expected_text="int")
    else:
        reveal_type(val, expected_text="NotImplementedType")


def check4(val: NotImplementedType):
    if isinstance(val, object):
        reveal_type(val, expected_text="NotImplementedType")


class AcceptsSingleton:
    def __contains__(self, value: NotImplementedType) -> bool:
        return value is NotImplemented

    def __add__(self, other: NotImplementedType) -> str:
        return ""


T = TypeVar("T")


class WrapsOperand:
    def __add__(self, other: T) -> list[T]:
        return [other]


def check_operators(value: NotImplementedType):
    reveal_type(value in AcceptsSingleton(), expected_text="bool")
    reveal_type(AcceptsSingleton() + value, expected_text="str")
    result = WrapsOperand() + value
    reveal_type(result, expected_text="list[NotImplementedType]")
    reveal_type(WrapsOperand().__add__(value), expected_text="list[NotImplementedType]")
