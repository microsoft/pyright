# This sample tests the case where a generic type Type[T] is
# instantiated.

from typing import Generic, TypeVar

T = TypeVar("T")


class Foo(Generic[T]):
    def __init__(self) -> None:
        message_t = self.message_type()
        reveal_type(message_t(), expected_text="T@Foo")

    def message_type(self) -> type[T]:
        ...
