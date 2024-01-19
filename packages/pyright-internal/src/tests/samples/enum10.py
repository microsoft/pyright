# This sample tests that a call to an enum class does not invoke the
# constructor for the class if the enum class defines members.

from enum import Enum


class Example(Enum):
    A = (1, 2)

    def __init__(self, value, other) -> None:
        self._value_ = value
        self.other = other


Example(1)
