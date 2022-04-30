# This sample validates that a member's descriptor protocol is
# accessed via a member access expression only when accessing it
# through a class variable, not through an instance variable.

from typing import Any


class Descriptor:
    def __get__(self, obj: Any, objtype: Any = None) -> float:
        return 1.0


class ClassA:
    x: Descriptor

    def __init__(self, x: Descriptor):
        reveal_type(self.x, expected_type="float")

    def func1(self):
        reveal_type(self.x, expected_type="float")


class ClassB:
    def __init__(self, x: Descriptor):
        self.x = x
        reveal_type(self.x, expected_type="Descriptor")

    def func1(self):
        reveal_type(self.x, expected_type="Descriptor")
