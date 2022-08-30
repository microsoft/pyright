# This sample tests the case where an instance member write
# targets an instance variable with a TypeVar type.

from typing import Generic, TypeVar

T = TypeVar("T")


class ClassA(Generic[T]):
    def __init__(self, value: T) -> None:
        self.value: T = value

    def set_value(self, value: int):
        # This should generate an error.
        self.value = value
