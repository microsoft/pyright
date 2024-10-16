# This sample tests the case where an attribute is accessed
# via a bound TypeVar.

from dataclasses import dataclass


@dataclass
class DC1:
    x: int


class GenericClass[T: DC1]:
    def method1(self, t: T):
        pass

    def method2(self, t: T):
        # This should generate an error.
        self.method1(t.x)
