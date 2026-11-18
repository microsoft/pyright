# This sample verifies that explicit class type arguments constrain type variables
# inferred from a generic __new__ return type.

from typing import Any, Generic, TypeVar, assert_type, cast

T = TypeVar("T")
U = TypeVar("U")


class Box(Generic[T]):
    def __new__(cls, value: U) -> "Box[U]":
        return cast(Any, object.__new__(cls))


class Factory(Generic[T]):
    def __new__(cls, values: list[U]) -> list[U]:
        return cast(Any, values)


assert_type(Box(1), Box[int])
assert_type(Box("value"), Box[str])
assert_type(Box[int](1), Box[int])

# This should generate an error because the explicit type argument constrains value to int.
Box[int]("value")

result: list[object] = Factory[int]([1])
assert_type(result, list[object])
assert_type(Factory[int]([1]), list[int])
