# This sample tests constraint solving in methods
# where the type is provided by a default initialization value
# rather than an argument provided directly by the caller.

# We use "strict" here because we want to ensure that there are
# no "unknown" types remaining in this file.

# pyright: strict

from typing import Generic, TypeVar

_A = TypeVar("_A")
_B = TypeVar("_B")


class ClassA(Generic[_A, _B]):
    def __init__(self, a: _A, b: _B = "hello"):
        self._foo_a = a
        self._foo_b = b

    @property
    def value_a(self):
        return self._foo_a

    @property
    def value_b(self):
        return self._foo_b


a1 = ClassA(27)

reveal_type(a1.value_a, expected_text="int")
reveal_type(a1.value_b, expected_text="str")
