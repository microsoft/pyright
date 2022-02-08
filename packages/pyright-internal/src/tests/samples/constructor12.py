# This sample tests the case where a specialized class is constructed
# from within the class implementation and uses a class TypeVar in
# the specialization.

from typing import Generic, TypeVar

T = TypeVar("T")


class Foo(Generic[T]):
    def return_from_variable(self) -> "Foo[T]":
        value = Foo[T]()
        reveal_type(value, expected_text="Foo[T@Foo]")
        return value


x = Foo[int]()
returned_from_variable = x.return_from_variable()

reveal_type(returned_from_variable, expected_text="Foo[int]")
