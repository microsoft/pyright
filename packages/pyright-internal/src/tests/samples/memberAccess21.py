# This sample tests the case where a member access is performed through
# an object using a field that is annotated as a ClassVar. Normally this
# is disallowed, but it is permitted if the type of the ClassVar is
# a descriptor object.

from typing import ClassVar, Generic, TypeVar, overload, Self

T = TypeVar("T")


class Descriptor(Generic[T]):
    @overload
    def __get__(self, instance: None, owner) -> Self: ...

    @overload
    def __get__(self, instance: object, owner) -> T: ...

    def __get__(self, instance: object | None, owner) -> Self | T: ...

    def __set__(self, instance: object, value: T) -> None: ...

    def is_null(self) -> bool: ...


class Example:
    field1: ClassVar = Descriptor[str]()

    field2: ClassVar = ""

    def reset(self) -> None:
        self.field1 = ""

        # This should generate an error because field2 isn't
        # a descriptor object.
        self.field2 = ""
