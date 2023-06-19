# This sample tests the specialization of property return types.

from typing import TypeVar, Generic

T = TypeVar("T")


class ClassA(Generic[T]):
    def __init__(self, bar: T):
        self._bar = bar

    @property
    def prop1(self) -> T:
        return self._bar

    def method1(self) -> T:
        reveal_type(self._bar, expected_text="T@ClassA")
        return self._bar


a = ClassA[int](3)

# This should work fine because a.bar should be an int
a.prop1.bit_length()
