# This sample tests the validation of member values.

from enum import Enum


class Enum1(Enum):
    _value_: int
    RED = 1

    # This should generate an error because of a type mismatch.
    GREEN = "green"


class Enum2(Enum):
    def __new__(cls, value: int):
        obj = object.__new__(cls)
        obj._value_ = value

    RED = 1

    # This should generate an error because of a type mismatch.
    GREEN = "green"

    # This should generate an error because of a type mismatch.
    BLUE = (1, "blue")


class Enum3(Enum):
    def __init__(self, value: int):
        self._value_ = value

    RED = 1

    # This should generate an error because of a type mismatch.
    GREEN = "green"

    # This should generate an error because of a type mismatch.
    BLUE = (1, "blue")


class Enum4(Enum):
    def __init__(self, value: int, other: str):
        self._value_ = value

    # This should generate an error because of a type mismatch.
    RED = 1

    # This should generate an error because of a type mismatch.
    GREEN = "green"

    BLUE = (1, "blue")

    # This should generate an error because of a type mismatch.
    GRAY = (1, "blue", 1)
