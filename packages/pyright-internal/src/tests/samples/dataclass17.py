# This sample tests the "slots" parameter for dataclasses introduced
# in Python 3.10.

from dataclasses import dataclass


# This should generate an error because __slots__ is already defined.
@dataclass(slots=True)
class A:
    x: int

    __slots__ = ()


@dataclass(slots=True)
class B:
    x: int

    def __init__(self):
        self.x = 3

        # This should generate an error because "y" is not in slots.
        self.y = 3


@dataclass(slots=False)
class C:
    x: int

    __slots__ = ("x",)

    def __init__(self):
        self.x = 3

        # This should generate an error because "y" is not in slots.
        self.y = 3
