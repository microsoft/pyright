# This sample tests the case where a declared class variable with type
# type[T] is assigned a value in a base class that is not a type.

from typing import Any, Generic, TypeVar

T = TypeVar("T")


class Parent(Generic[T]):
    y: type[T]


class Child(Parent[Any]):
    # This should generate an error.
    y = 42
