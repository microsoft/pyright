# This sample tests the case where a specialized class is constructed
# from within the class implementation and uses a class TypeVar in
# the specialization.

from typing import Generic, TypeVar

T = TypeVar("T")


class ClassA(Generic[T]):
    def return_from_variable(self) -> "ClassA[T]":
        value = ClassA[T]()
        reveal_type(value, expected_text="ClassA[T@ClassA]")
        return value


x = ClassA[int]()
v1 = x.return_from_variable()

reveal_type(v1, expected_text="ClassA[int]")
