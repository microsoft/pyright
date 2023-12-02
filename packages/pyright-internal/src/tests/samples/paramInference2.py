# This sample tests the logic that infers parameter types based on
# annotated base class methods when the base class is generic.

# pyright: reportIncompatibleMethodOverride=false

from typing import Generic, TypeVar

T = TypeVar("T")


class Parent(Generic[T]):
    def method1(self, a: T, b: list[T]) -> None:
        ...


class Child(Parent[float]):
    def method1(self, a, b):
        reveal_type(self, expected_text="Self@Child")
        reveal_type(a, expected_text="float")
        reveal_type(b, expected_text="list[float]")
        return a
